const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { listManagedLocalExcel, normalizedManagedRelativePath } = require("./file_browser");
const { localRetentionSelection, remoteRetentionSelection } = require("./retention");
const { safeRemotePath, verifyPayloadPair } = require("./baidu_provider");
const fingerprint = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const recordFingerprint = row => fingerprint(Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("creator_"))));
const error = code => Object.assign(new Error("清理预览已失效或文件不满足安全条件，请重新扫描"), { code });
const knownName = name => /^黎明教育_全量数据_.*\.xlsx$/.test(name);
const MAX_ORPHAN_SIZE = 50 * 1024 * 1024;
function eligibleRecordIds(records, settings, service, db) {
  const local = new Set(localRetentionSelection(records, { daily: settings.daily_retention, monthly: settings.monthly_retention, manual: settings.manual_retention }).candidates.map(row => row.id));
  const selection = remoteRetentionSelection(records, settings.remote_retention);
  const remote = new Set(); let remaining = selection.rows.length, valid = selection.rows.filter(row => row.remote_status === "success").length;
  for (const row of selection.candidates) {
    if (remaining <= selection.keep) break;
    if (row.remote_status === "success" && valid <= 1) continue;
    remote.add(row.id); remaining--; if (row.remote_status === "success") valid--;
  }
  return new Set(records.filter(row => {
    const hasLocal = Boolean(row.managed_relative_path) && row.status !== "deleted";
    const hasRemote = Boolean(row.remote_path || row.remote_checksum_path) && row.remote_status !== "deleted";
    return (hasLocal || hasRemote) && (!hasLocal || local.has(row.id)) && (!hasRemote || remote.has(row.id)) && service.deletionPolicy(db, row).deletable;
  }).map(row => row.id));
}
class BackupCleanupService {
  constructor({ service, settings, remote }) { this.service = service; this.settings = settings; this.remote = remote; this.plans = new Map(); }
  records(db) { return db.prepare("SELECT * FROM backup_records ORDER BY backup_time DESC,id DESC").all(); }
  assertExclusiveRecord(row, records) {
    const normalize = value => String(value || "").replaceAll("\\", "/");
    const local = normalize(row.managed_relative_path);
    const remote = [row.remote_path, row.remote_checksum_path].filter(Boolean);
    if (records.some(other => other.id !== row.id && ((local && normalize(other.managed_relative_path) === local) || [other.remote_path, other.remote_checksum_path].some(value => value && remote.includes(value))))) throw error("CLEANUP_SHARED_REFERENCE");
  }
  localFile(relative) {
    relative = String(relative).replaceAll("\\", "/");
    const excel = relative.endsWith(".sha256") ? relative.slice(0, -7) : relative;
    const normalized = normalizedManagedRelativePath(excel);
    if (normalized !== excel || relative.includes("\\")) throw error("CLEANUP_UNSAFE_PATH");
    const root = this.service.root, target = path.resolve(this.service.dataDir, relative);
    const parts = path.relative(root, target).split(path.sep);
    if (parts.some(part => !part || part.startsWith("."))) throw error("CLEANUP_UNSAFE_PATH");
    let current = root;
    for (const part of ["", ...parts]) {
      if (part) current = path.join(current, part);
      let stat; try { stat = fs.lstatSync(current); } catch (e) { if (e.code === "ENOENT") return null; throw error("CLEANUP_LOCAL_UNAVAILABLE"); }
      if (stat.isSymbolicLink()) throw error("CLEANUP_SYMLINK");
    }
    const realRoot = fs.realpathSync(root), real = fs.realpathSync(target), rel = path.relative(realRoot, real);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw error("CLEANUP_UNSAFE_PATH");
    const stat = fs.statSync(target); if (!stat.isFile()) throw error("CLEANUP_UNSAFE_PATH");
    return { source: "local", relative_path: relative, filename: path.basename(relative), size: stat.size, created_at: (stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime).toISOString(), signature: fingerprint([stat.dev, stat.ino, stat.size, stat.mtimeMs]), target };
  }
  async remoteFiles(root) {
    const files = new Map(); let start = 0;
    for (let page = 0; page < 100; page++) {
      const result = await this.remote.client.listDirectory(root, { start, limit: 200 });
      for (const item of result.list) {
        const name = String(item.path || "").slice(root.length + 1);
        if (!String(item.path || "").startsWith(root + "/") || name.includes("/") || name.startsWith(".") || name.includes("\\") || Number(item.isdir) || !/\.xlsx(?:\.sha256)?$/i.test(name) || typeof item.fs_id !== "string" || !/^\d+$/.test(item.fs_id)) continue;
        const value = { source: "baidu", filename: name, relative_path: name, size: Number.isFinite(Number(item.size)) ? Number(item.size) : null, created_at: (item.server_ctime || item.server_mtime) ? new Date(Number(item.server_ctime || item.server_mtime) * 1000).toISOString() : "", fs_id: item.fs_id, remote_path: item.path };
        value.signature = fingerprint([value.fs_id, value.size, item.server_mtime, item.md5 || ""]); files.set(item.path, value);
      }
      if (!result.has_more) return files;
      if (result.next_start <= start) throw error("CLEANUP_REMOTE_PAGINATION"); start = result.next_start;
    }
    throw error("CLEANUP_SCAN_LIMIT");
  }
  hasRecoveryCopy(records, source, remote = new Map()) {
    return records.some(row => {
      if (row.backup_format !== "full_data_excel") return false;
      if (source === "baidu") return row.remote_status === "success" && row.remote_integrity_status === "verified" && remote.has(row.remote_path) && remote.has(row.remote_checksum_path);
      if (row.status !== "success" || !row.verified_at || row.deleted_at || !row.managed_relative_path) return false;
      try {
        const excel = this.localFile(row.managed_relative_path), checksum = this.localFile(row.managed_relative_path + ".sha256");
        if (!excel || !checksum || excel.size > MAX_ORPHAN_SIZE || checksum.size > 4096) return false;
        const result = verifyPayloadPair(fs.readFileSync(excel.target), fs.readFileSync(checksum.target), excel.filename);
        return result.sha256 === row.sha256;
      } catch { return false; }
    });
  }
  async orphanPair(files) {
    if (files.length !== 2 || files[0].size > MAX_ORPHAN_SIZE || files[0].size == null || files[1].size > 4096) throw error("CLEANUP_ORPHAN_UNVERIFIED");
    const bytes = files[0].source === "local" ? fs.readFileSync(files[0].target) : await this.remote.client.downloadFile({ fileId: files[0].fs_id, remotePath: files[0].remote_path });
    const checksum = files[1].source === "local" ? fs.readFileSync(files[1].target) : await this.remote.client.downloadFile({ fileId: files[1].fs_id, remotePath: files[1].remote_path });
    verifyPayloadPair(bytes, checksum, files[0].filename);
    return fingerprint([crypto.createHash("sha256").update(bytes).digest("hex"), checksum.toString("utf8")]);
  }
  publicEntry(entry) { return { kind: entry.kind, backup_id: entry.backup_id || null, backup_type: entry.backup_type || "无记录完整备份", reason: entry.reason, files: entry.files.map(({ source, filename, relative_path, size, created_at }) => ({ source, filename, relative_path, size, created_at })) }; }
  async scan(owner) {
    const lock = this.service.acquireLock(); let db;
    try {
      db = this.service.database(); const records = this.records(db), settings = this.settings(), root = safeRemotePath(settings.remote_directory);
      const local = await listManagedLocalExcel({ dataDir: this.service.dataDir, records });
      let remote = new Map(), remoteAvailable = false; const warnings = [];
      if (this.remote.configurationStatus().authorized) {
        try { remote = await this.remoteFiles(root); remoteAvailable = true; } catch { warnings.push("百度扫描未完成；本轮不会清理任何百度文件或关联远端的备份"); }
      } else warnings.push("百度未授权，仅扫描本地文件");
      const ids = eligibleRecordIds(records, settings, this.service, db), entries = [];
      const localRefs = new Set(records.flatMap(row => [row.managed_relative_path, row.managed_relative_path ? row.managed_relative_path + ".sha256" : ""]).map(value => String(value || "").replaceAll("\\", "/")));
      const remoteRefs = new Set(records.flatMap(row => [row.remote_path, row.remote_checksum_path]));
      for (const row of records.filter(row => ids.has(row.id))) {
        try {
          this.assertExclusiveRecord(row, records);
          const files = [];
          if (row.managed_relative_path) for (const rel of [row.managed_relative_path, row.managed_relative_path + ".sha256"]) { const file = this.localFile(rel); if (file) files.push(file); }
          if (row.remote_path || row.remote_checksum_path) {
            if (!remoteAvailable) continue;
            for (const rel of [row.remote_path, row.remote_checksum_path].filter(Boolean)) {
              if (!rel.startsWith(root + "/") || !/\.xlsx(?:\.sha256)?$/.test(rel) || rel.slice(root.length+1).includes("/")) throw error("CLEANUP_UNSAFE_PATH");
              if (remote.has(rel)) files.push(remote.get(rel));
            }
          }
          if (files.length) entries.push({ kind: "backup", backup_id: row.id, backup_type: row.retention_class, record_signature: recordFingerprint(row), reason: "超过现有保留策略，所有关联副本均允许清理", files });
        } catch { /* Unknown paths remain protected. */ }
      }
      const localRecovery = this.hasRecoveryCopy(records, "local"), remoteRecovery = this.hasRecoveryCopy(records, "baidu", remote);
      for (const item of local.items.filter(item => localRecovery && !item.backup_record && knownName(item.filename))) {
        try {
          const files = [this.localFile(item.relative_path), this.localFile(item.relative_path + ".sha256")];
          if (files.some(file => !file || localRefs.has(file.relative_path))) continue;
          const digest = await this.orphanPair(files); entries.push({ kind: "orphan", reason: "无记录引用，完整 v4 与 SHA-256 配对校验通过", files, digest });
        } catch { /* Unrecognized or incomplete historical files remain protected. */ }
      }
      for (const file of remote.values()) {
        if (!remoteRecovery || !knownName(file.filename) || remoteRefs.has(file.remote_path)) continue;
        const pair = remote.get(file.remote_path + ".sha256"); if (!pair || remoteRefs.has(pair.remote_path)) continue;
        try { const files = [file, pair], digest = await this.orphanPair(files); entries.push({ kind: "orphan", reason: "百度无记录引用，完整 v4 与 SHA-256 配对校验通过", files, digest }); } catch { /* Fail closed. */ }
      }
      if (entries.length > 100) warnings.push("单次最多预览100组，完成后可重新扫描");
      const chosen = entries.slice(0, 100), allFiles = chosen.flatMap(entry => entry.files);
      const summary = { local_files: allFiles.filter(f => f.source === "local").length, remote_files: allFiles.filter(f => f.source === "baidu").length, local_bytes: allFiles.filter(f => f.source === "local").reduce((n,f) => n + f.size, 0), remote_bytes: allFiles.filter(f => f.source === "baidu").some(f => f.size == null) ? null : allFiles.filter(f => f.source === "baidu").reduce((n,f) => n + f.size, 0), backups: chosen.filter(e => e.kind === "backup").length, orphan_files: chosen.filter(e => e.kind === "orphan").reduce((n,e) => n + e.files.length, 0), scanned_files: local.items.reduce((count, item) => count + 1 + (item.checksum_status === "present" ? 1 : 0), 0) + remote.size };
      for (const [key, plan] of this.plans) if (plan.expires < Date.now() || plan.owner === owner) this.plans.delete(key);
      const token = crypto.randomBytes(24).toString("hex"), expires = Date.now() + 10 * 60_000;
      this.plans.set(token, { owner, expires, entries: chosen, root, summary });
      return { preview_id: token, expires_at: new Date(expires).toISOString(), summary, entries: chosen.map(entry => this.publicEntry(entry)), warnings };
    } finally { db?.close(); this.service.releaseLock(lock); }
  }
  async recheckFiles(entry, root) {
    const remote = entry.files.some(f => f.source === "baidu") ? await this.remoteFiles(root) : new Map();
    for (const file of entry.files) {
      const current = file.source === "local" ? this.localFile(file.relative_path) : remote.get(file.remote_path);
      if (!current || current.signature !== file.signature) throw error("CLEANUP_STALE_FILE");
    }
  }
  async execute(owner, token, confirmed) {
    const plan = this.plans.get(token);
    if (!confirmed || !plan || plan.owner !== owner || plan.expires < Date.now()) throw error("CLEANUP_PREVIEW_REQUIRED");
    this.plans.delete(token); const results = [];
    if (safeRemotePath(this.settings().remote_directory) !== plan.root) throw error("CLEANUP_DIRECTORY_CHANGED");
    for (const entry of plan.entries) {
      let cleanup = {}, reason = "";
      try {
        if (entry.kind === "backup") {
          const result = await this.service.deleteBackup(entry.backup_id, { remoteDeleter: row => this.remote.delete(row), beforeDelete: async (db,row) => {
            const records = this.records(db);
            this.assertExclusiveRecord(row, records);
            if (recordFingerprint(row) !== entry.record_signature || !eligibleRecordIds(records, this.settings(), this.service, db).has(row.id)) throw error("CLEANUP_STALE_RECORD");
            const currentRemote = row.remote_path || row.remote_checksum_path ? await this.remoteFiles(plan.root) : new Map();
            const currentFiles = [];
            if (row.managed_relative_path) for (const relative of [row.managed_relative_path, row.managed_relative_path + ".sha256"]) { const file = this.localFile(relative); if (file) currentFiles.push(file); }
            for (const relative of [row.remote_path, row.remote_checksum_path].filter(Boolean)) if (currentRemote.has(relative)) currentFiles.push(currentRemote.get(relative));
            const identity = files => files.map(file => `${file.source}:${file.relative_path}`).sort();
            if (fingerprint(identity(currentFiles)) !== fingerprint(identity(entry.files))) throw error("CLEANUP_STALE_FILE");
            await this.recheckFiles(entry, plan.root);
            const latest = this.records(db), latestRow = latest.find(item => item.id === row.id);
            if (!latestRow || recordFingerprint(latestRow) !== entry.record_signature || !eligibleRecordIds(latest, this.settings(), this.service, db).has(row.id)) throw error("CLEANUP_STALE_RECORD");
            this.assertExclusiveRecord(latestRow, latest);
          } }); cleanup = result.cleanup; if (!result.ok) reason = "CLEANUP_PARTIAL";
        } else {
          const lock = this.service.acquireLock(); let db;
          try {
            db = this.service.database(); const records = this.records(db);
            if (entry.files.some(file => records.some(row => file.source === "local" ? [row.managed_relative_path, row.managed_relative_path + ".sha256"].map(value => String(value || "").replaceAll("\\", "/")).includes(file.relative_path) : [row.remote_path,row.remote_checksum_path].includes(file.remote_path)))) throw error("CLEANUP_NOW_REFERENCED");
            const remoteRecoveryFiles = entry.files[0].source === "baidu" ? await this.remoteFiles(plan.root) : new Map();
            if (!this.hasRecoveryCopy(records, entry.files[0].source, remoteRecoveryFiles)) throw error("CLEANUP_LAST_RECOVERY_COPY");
            await this.recheckFiles(entry, plan.root);
            if (await this.orphanPair(entry.files) !== entry.digest) throw error("CLEANUP_STALE_FILE");
            const latest = this.records(db);
            if (entry.files.some(file => latest.some(row => file.source === "local" ? [row.managed_relative_path, row.managed_relative_path + ".sha256"].map(value => String(value || "").replaceAll("\\", "/")).includes(file.relative_path) : [row.remote_path, row.remote_checksum_path].includes(file.remote_path)))) throw error("CLEANUP_NOW_REFERENCED");
            if (!this.hasRecoveryCopy(latest, entry.files[0].source, remoteRecoveryFiles)) throw error("CLEANUP_LAST_RECOVERY_COPY");
            for (const [i,file] of entry.files.entries()) {
              const key = `${file.source === "local" ? "local" : "remote"}_${i ? "checksum" : "excel"}`;
              try { if (file.source === "local") fs.unlinkSync(file.target); else await this.remote.client.deleteFile(file.remote_path, file.fs_id); cleanup[key] = "deleted"; }
              catch { cleanup[key] = "delete_failed"; }
            }
          } finally { db?.close(); this.service.releaseLock(lock); }
        }
      } catch (e) { reason = /^[A-Z0-9_]+$/.test(e.code || "") ? e.code : "CLEANUP_FAILED"; }
      const files = entry.files.map(file => {
        const key = `${file.source === "local" ? "local" : "remote"}_${file.relative_path.endsWith(".sha256") ? "checksum" : "excel"}`;
        const status = cleanup[key] || "skipped"; return { ...this.publicEntry({ files: [file] }).files[0], status };
      });
      const ok = !reason && files.every(f => ["deleted", "already_absent", "not_present"].includes(f.status));
      results.push({ backup_id: entry.backup_id || null, kind: entry.kind, ok, reason: reason || (ok ? "" : "CLEANUP_PARTIAL"), files });
    }
    const files = results.flatMap(r => r.files), deleted = files.filter(f => f.status === "deleted");
    return { ok: results.every(r => r.ok), scanned_files: plan.summary.scanned_files, deleted_files: deleted.length, failed_files: files.filter(f => !["deleted","already_absent","not_present"].includes(f.status)).length, local_bytes: deleted.filter(f => f.source === "local").reduce((n,f) => n + f.size,0), remote_bytes: deleted.filter(f => f.source === "baidu").reduce((n,f) => n + (f.size || 0),0), orphan_files: results.filter(r => r.kind === "orphan").flatMap(r => r.files).filter(f => f.status === "deleted").length, results };
  }
}
module.exports = { BackupCleanupService, eligibleRecordIds };
