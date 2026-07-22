const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { assertDataPreflight } = require("./data_preflight");
const { backupFailureDisplay, safeBackupFailure, serializeBackupFailure } = require("./backup_failure");
const { FORMAT_VERSION, exportFullData, fullDataFilename, verifyFullData } = require("../excel/full_backup");

const BACKUP_FORMAT = "full_data_excel";
const MANAGED_SUBDIR = path.join("backups", "full-excel");
const BACKUP_COLUMNS = {
  backup_format: "TEXT DEFAULT 'legacy_core_zip'", format_version: "INTEGER DEFAULT 0", trigger: "TEXT DEFAULT ''",
  retention_class: "TEXT DEFAULT ''", managed_relative_path: "TEXT DEFAULT ''", sha256: "TEXT DEFAULT ''",
  verified_at: "TEXT DEFAULT ''", schedule_key: "TEXT DEFAULT ''", created_by_user_id: "INTEGER",
  note: "TEXT DEFAULT ''", pinned: "INTEGER NOT NULL DEFAULT 0", remote_status: "TEXT DEFAULT 'not_configured'",
  remote_file_id: "TEXT DEFAULT ''", remote_path: "TEXT DEFAULT ''", remote_error_safe: "TEXT DEFAULT ''",
  remote_checksum_file_id: "TEXT DEFAULT ''", remote_checksum_path: "TEXT DEFAULT ''",
  remote_file_status: "TEXT DEFAULT ''", remote_checksum_status: "TEXT DEFAULT ''", remote_integrity_status: "TEXT DEFAULT ''",
  remote_updated_at: "TEXT DEFAULT ''", remote_attempt_count: "INTEGER NOT NULL DEFAULT 0", deleted_at: "TEXT DEFAULT ''", operation_logs_included: "INTEGER NOT NULL DEFAULT 1",
};

class BackupError extends Error { constructor(code, message, details = {}) { super(message); this.name = "BackupError"; this.code = code; this.details = details; } }
function ensureBackupColumns(db) {
  const existing = new Set(db.prepare("PRAGMA table_info(backup_records)").all().map((column) => column.name));
  for (const [column, definition] of Object.entries(BACKUP_COLUMNS)) if (!existing.has(column)) db.exec(`ALTER TABLE backup_records ADD COLUMN ${column} ${definition}`);
  db.exec("DROP INDEX IF EXISTS idx_backup_records_schedule_key; CREATE UNIQUE INDEX idx_backup_records_schedule_key ON backup_records(schedule_key) WHERE TRIM(COALESCE(schedule_key,'')) <> '' AND status='success'; CREATE INDEX IF NOT EXISTS idx_backup_records_managed ON backup_records(backup_format,status,backup_time DESC);");
}
function sha256File(filename) { const hash = crypto.createHash("sha256"); const fd = fs.openSync(filename, "r"); const chunk = Buffer.allocUnsafe(1024 * 1024); try { let length; while ((length = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, length)); return hash.digest("hex"); } finally { fs.closeSync(fd); } }
function inside(root, target) { const relative = path.relative(root, target); return relative && !relative.startsWith("..") && !path.isAbsolute(relative); }
function safeMessage(error) { return String(error?.code || error?.name || "BACKUP_FAILED").replace(/[^A-Z0-9_-]/gi, "_").slice(0, 100); }

class BackupService {
  constructor({ dbPath, dataDir, appVersion = "unknown", appGitCommit = process.env.APP_GIT_COMMIT || "", remoteUploader = null }) { this.dbPath = path.resolve(dbPath); this.dataDir = path.resolve(dataDir); this.root = path.resolve(this.dataDir, MANAGED_SUBDIR); this.appVersion = appVersion; this.appGitCommit = String(appGitCommit).slice(0, 40); this.remoteUploader = remoteUploader; }
  database() { const db = new DatabaseSync(this.dbPath); ensureBackupColumns(db); return db; }
  rootStatus() {
    try {
      if (!inside(this.dataDir, this.root)) return { status: "invalid" };
      if (fs.existsSync(this.root)) {
        if (fs.lstatSync(this.root).isSymbolicLink() || !fs.statSync(this.root).isDirectory()) return { status: "invalid" };
        fs.accessSync(this.root, fs.constants.R_OK | fs.constants.W_OK);
        return { status: "available" };
      }
      let candidate = path.dirname(this.root);
      while (!fs.existsSync(candidate) && inside(this.dataDir, candidate)) candidate = path.dirname(candidate);
      fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);
      return { status: "not_created" };
    } catch { return { status: "unwritable" }; }
  }
  ensureRoot() {
    if (!inside(this.dataDir, this.root)) throw new BackupError("BACKUP_ROOT_INVALID", "受管备份目录无效");
    const parent = path.dirname(this.root); fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.root) && fs.lstatSync(this.root).isSymbolicLink()) throw new BackupError("BACKUP_ROOT_SYMLINK", "受管备份目录不能是符号链接");
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 }); try { fs.chmodSync(this.root, 0o700); } catch {}
    return this.root;
  }
  acquireLock() {
    this.ensureRoot(); const lock = path.join(this.root, ".backup.lock");
    const create = () => { const fd = fs.openSync(lock, "wx", 0o600); try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })); } finally { fs.closeSync(fd); } return lock; };
    try { return create(); } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let stale = false;
      try { const metadata = JSON.parse(fs.readFileSync(lock, "utf8")); const age = Date.now() - Date.parse(metadata.started_at); let alive = true; try { process.kill(Number(metadata.pid), 0); } catch (probe) { alive = probe.code === "EPERM"; } stale = !alive && age > 60_000; } catch { stale = fs.statSync(lock).mtimeMs < Date.now() - 30 * 60_000; }
      if (stale) { try { fs.rmSync(lock); return create(); } catch {} }
      throw new BackupError("BACKUP_ALREADY_RUNNING", "已有备份或恢复任务正在执行");
    }
  }
  releaseLock(lock) { try { fs.rmSync(lock, { force: true }); } catch {} }
  insertRecord(db, options) {
    const result = db.prepare(`INSERT INTO backup_records(backup_type,included_months,filename,file_path,file_size,status,message,scheduled_date,backup_format,format_version,trigger,retention_class,managed_relative_path,sha256,verified_at,schedule_key,created_by_user_id,note,pinned,remote_status,operation_logs_included) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(options.trigger === "automatic" ? "auto" : "manual", 0, options.filename, "", 0, "creating", "", options.scheduledDate || "", BACKUP_FORMAT, FORMAT_VERSION, options.trigger, options.retentionClass, "", "", "", options.scheduleKey || "", options.createdByUserId || null, options.note || "", options.pinned ? 1 : 0, options.remoteEnabled ? "pending" : "not_configured", options.includeOperationLogs === false ? 0 : 1);
    return Number(result.lastInsertRowid);
  }
  record(db, id) { return db.prepare("SELECT * FROM backup_records WHERE id=?").get(Number(id)); }
  dto(row) { const dto = { id: row.id, backup_time: row.backup_time || row.created_at || "", backup_format: row.backup_format || "legacy_core_zip", format_version: Number(row.format_version || 0), backup_type: row.backup_type || "", trigger: row.trigger || row.backup_type || "", retention_class: row.retention_class || "", filename: row.filename || "", managed_relative_path: row.managed_relative_path || "", file_size: Number(row.file_size || 0), sha256: row.sha256 || "", status: row.status || "", verified_at: row.verified_at || "", schedule_key: row.schedule_key || "", created_by_user_id: row.created_by_user_id || null, note: row.note || "", pinned: Number(row.pinned || 0), operation_logs_included: Number(row.operation_logs_included ?? 1) === 1, remote_attempt_count: Number(row.remote_attempt_count || 0), remote_status: (row.backup_format || "legacy_core_zip") === BACKUP_FORMAT ? (row.remote_status || "not_configured") : "legacy", remote_file_id: row.remote_file_id || "", remote_path: row.remote_path || "", remote_checksum_file_id: row.remote_checksum_file_id || "", remote_checksum_path: row.remote_checksum_path || "", remote_file_status: row.remote_file_status || "", remote_checksum_status: row.remote_checksum_status || "", remote_integrity_status: row.remote_integrity_status || "", remote_error_safe: row.remote_error_safe || "", remote_updated_at: row.remote_updated_at || "", deleted_at: row.deleted_at || "", message: row.message || "" }; return { ...dto, failure: backupFailureDisplay(dto) }; }
  updateRemoteResult(db, id, remote = {}, error = null) {
    const fileStatus = remote.file_status || (error ? "failed" : "success");
    const checksumStatus = remote.checksum_status || (error ? "failed" : "success");
    const integrityStatus = remote.integrity_status || (error ? "not_verified" : "verified");
    const overall = error ? (fileStatus === "success" || checksumStatus === "success" ? "partial_failed" : "failed") : "success";
    const failure = error ? safeBackupFailure(error, { stage: "remote" }) : null;
    db.prepare(`UPDATE backup_records SET remote_status=?,remote_file_id=?,remote_path=?,remote_checksum_file_id=?,remote_checksum_path=?,remote_file_status=?,remote_checksum_status=?,remote_integrity_status=?,remote_error_safe=?,message=?,remote_updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
      overall, remote.file_id || "", remote.path || "", remote.checksum_file_id || "", remote.checksum_path || "", fileStatus, checksumStatus, integrityStatus, failure?.code || "", failure ? serializeBackupFailure(failure) : "", id,
    );
  }
  markRemoteIntegrity(id, status, errorCode = "") {
    const normalized = status === "verified" ? "verified" : "failed";
    const db = this.database();
    try {
      const row = this.record(db, id);
      if (!row) throw new BackupError("BACKUP_NOT_FOUND", "备份记录不存在");
      const remoteStatus = normalized === "verified" ? (row.remote_status || "success") : "failed";
      db.prepare("UPDATE backup_records SET remote_status=?,remote_integrity_status=?,remote_error_safe=?,remote_updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(remoteStatus, normalized, normalized === "failed" ? String(errorCode || "BAIDU_REMOTE_VERIFY_FAILED").slice(0, 100) : "", id);
      return this.dto(this.record(db, id));
    } finally { db.close(); }
  }
  list(limit = 100) { const db = this.database(); try { return db.prepare("SELECT * FROM backup_records ORDER BY backup_time DESC,id DESC LIMIT ?").all(Math.max(1, Math.min(500, Number(limit) || 100))).map((row) => this.dto(row)); } finally { db.close(); } }
  managedPath(row) { if (row.backup_format !== BACKUP_FORMAT || !row.managed_relative_path || path.isAbsolute(row.managed_relative_path)) throw new BackupError("BACKUP_PATH_UNMANAGED", "记录不是受管全量备份"); const target = path.resolve(this.dataDir, row.managed_relative_path); if (!inside(this.root, target)) throw new BackupError("BACKUP_PATH_INVALID", "备份相对路径无效"); if (!fs.existsSync(target)) throw new BackupError("BACKUP_FILE_MISSING", "备份文件不存在"); if (fs.lstatSync(target).isSymbolicLink() || !inside(this.root, fs.realpathSync(target))) throw new BackupError("BACKUP_PATH_SYMLINK", "备份文件路径无效"); return target; }
  verify(id) { const db = this.database(); try { const row = this.record(db, id); if (!row) throw new BackupError("BACKUP_NOT_FOUND", "备份记录不存在"); const filename = this.managedPath(row); verifyFullData(filename); const digest = sha256File(filename); if (digest !== row.sha256) throw new BackupError("BACKUP_SHA256_MISMATCH", "备份SHA-256不匹配"); db.prepare("UPDATE backup_records SET verified_at=CURRENT_TIMESTAMP,message='' WHERE id=?").run(id); return this.dto(this.record(db, id)); } catch (error) { try { db.prepare("UPDATE backup_records SET message=? WHERE id=?").run(serializeBackupFailure(safeBackupFailure(error)), id); } catch {} throw error; } finally { db.close(); } }
  async create(options = {}) {
    const lock = this.acquireLock(); const db = this.database(); const trigger = options.trigger === "automatic" ? "automatic" : (options.trigger || "manual"); const retentionClass = options.retentionClass || (trigger === "automatic" ? "daily" : "manual"); const filename = fullDataFilename(options.createdAt || new Date()); let id; let staging = ""; let published = ""; let checksumFile = ""; let publishedByThisRun = false; let checksumPublishedByThisRun = false;
    try {
      if (options.scheduleKey && db.prepare("SELECT 1 FROM backup_records WHERE schedule_key=? AND status='success' LIMIT 1").get(options.scheduleKey)) throw new BackupError("BACKUP_SCHEDULE_ALREADY_SUCCESSFUL", "该计划日期已经成功备份");
      id = this.insertRecord(db, { ...options, trigger, retentionClass, filename });
      assertDataPreflight(db);
      staging = path.join(this.root, `.staging-${id}-${crypto.randomUUID()}`); fs.mkdirSync(staging, { mode: 0o700 });
      const staged = path.join(staging, filename); const stagedHash = `${staged}.sha256`; exportFullData({ dbPath: this.dbPath, outputPath: staged, appVersion: this.appVersion, appGitCommit: this.appGitCommit, createdAt: options.createdAt || new Date(), includeOperationLogs: options.includeOperationLogs !== false }); verifyFullData(staged); const digest = sha256File(staged); fs.writeFileSync(stagedHash, `${digest}  ${filename}\n`, { flag: "wx", mode: 0o600 }); fs.chmodSync(staged, 0o600);
      published = path.join(this.root, filename); checksumFile = `${published}.sha256`; if (fs.existsSync(published) || fs.existsSync(checksumFile)) throw new BackupError("BACKUP_TARGET_EXISTS", "备份目标已存在");
      fs.renameSync(staged, published); publishedByThisRun = true;
      try { fs.renameSync(stagedHash, checksumFile); checksumPublishedByThisRun = true; }
      catch (error) { fs.rmSync(published, { force: true }); publishedByThisRun = false; throw error; }
      const relative = path.relative(this.dataDir, published); const size = fs.statSync(published).size; db.prepare("UPDATE backup_records SET managed_relative_path=?,file_size=?,sha256=?,status='success',verified_at=CURRENT_TIMESTAMP,message='' WHERE id=?").run(relative, size, digest, id);
      let row = this.record(db, id);
      if (options.remoteEnabled && this.remoteUploader) {
        db.prepare("UPDATE backup_records SET remote_status='uploading',remote_attempt_count=remote_attempt_count+1,remote_updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
        try { const remote = await this.remoteUploader({ record: this.dto(row), localPath: published }); this.updateRemoteResult(db, id, remote); }
        catch (error) { this.updateRemoteResult(db, id, error?.details?.remote || {}, error); }
      } else if (options.remoteEnabled) { const failure = safeBackupFailure("BAIDU_NOT_CONFIGURED", { stage: "remote" }); db.prepare("UPDATE backup_records SET remote_status='failed',remote_error_safe=?,message=?,remote_updated_at=CURRENT_TIMESTAMP WHERE id=?").run(failure.code, serializeBackupFailure(failure), id); }
      row = this.record(db, id); return { ok: true, record: this.dto(row) };
    } catch (error) {
      if (id) try { db.prepare("UPDATE backup_records SET status='failed',message=? WHERE id=?").run(serializeBackupFailure(safeBackupFailure(error, { stage: "local" })), id); } catch {}
      if (publishedByThisRun && published) try { fs.rmSync(published, { force: true }); } catch {} if (checksumPublishedByThisRun && checksumFile) try { fs.rmSync(checksumFile, { force: true }); } catch {}
      throw error;
    } finally { if (staging && inside(this.root, staging)) try { fs.rmSync(staging, { recursive: true, force: true }); } catch {} db.close(); this.releaseLock(lock); }
  }
  updateMetadata(id, values = {}) { const db = this.database(); try { const row = this.record(db, id); if (!row) throw new BackupError("BACKUP_NOT_FOUND", "备份记录不存在"); db.prepare("UPDATE backup_records SET note=?,pinned=? WHERE id=?").run(String(values.note ?? row.note ?? "").slice(0, 500), values.pinned === undefined ? Number(row.pinned || 0) : values.pinned ? 1 : 0, id); return this.dto(this.record(db, id)); } finally { db.close(); } }
  promoteMonthly(id, monthKey) {
    const db = this.database();
    try {
      const existing = db.prepare("SELECT id FROM backup_records WHERE backup_format=? AND retention_class='monthly' AND status='success' AND schedule_key LIKE ? LIMIT 1").get(BACKUP_FORMAT, `full-data:${String(monthKey).slice(0, 7)}%`);
      if (!existing) db.prepare("UPDATE backup_records SET retention_class='monthly' WHERE id=? AND backup_format=? AND status='success'").run(id, BACKUP_FORMAT);
      return this.dto(this.record(db, id));
    } finally { db.close(); }
  }
  applyRetention(policy = {}) {
    const limits = { daily: Math.max(1, Number(policy.daily || 14)), monthly: Math.max(1, Number(policy.monthly || 12)), manual: Math.max(1, Number(policy.manual || 20)) };
    const db = this.database(); const removed = []; const skipped = [];
    try {
      const successful = db.prepare("SELECT * FROM backup_records WHERE backup_format=? AND status='success' AND COALESCE(deleted_at,'')='' ORDER BY backup_time DESC,id DESC").all(BACKUP_FORMAT);
      const candidates = [];
      for (const retentionClass of ["daily", "monthly", "manual"]) {
        const rows = successful.filter((row) => row.retention_class === retentionClass && !Number(row.pinned || 0));
        candidates.push(...rows.slice(limits[retentionClass]));
      }
      const remainingIds = new Set(successful.map((row) => Number(row.id)));
      for (const row of candidates) {
        if (remainingIds.size <= 1) { skipped.push({ id: row.id, reason: "last_valid_backup" }); continue; }
        if (!row.verified_at) { skipped.push({ id: row.id, reason: "not_verified" }); continue; }
        try {
          const filename = this.managedPath(row); const checksum = `${filename}.sha256`;
          fs.rmSync(filename); if (fs.existsSync(checksum)) fs.rmSync(checksum);
          db.prepare("UPDATE backup_records SET status='deleted',deleted_at=CURRENT_TIMESTAMP,message='retention_cleanup' WHERE id=?").run(row.id);
          remainingIds.delete(Number(row.id)); removed.push({ id: row.id, bytes: Number(row.file_size || 0), reason: `${row.retention_class}_limit` });
        } catch (error) { skipped.push({ id: row.id, reason: safeMessage(error) }); }
      }
      return { removed, skipped, policy: limits };
    } finally { db.close(); }
  }
  async retryRemote(id, remoteDirectory) {
    if (!this.remoteUploader) throw new BackupError("BAIDU_NOT_CONFIGURED", "百度网盘尚未配置"); const db = this.database();
    try {
      const row = this.record(db, id); if (!row) throw new BackupError("BACKUP_NOT_FOUND", "备份记录不存在"); const localPath = this.managedPath(row);
      db.prepare("UPDATE backup_records SET remote_status='uploading',remote_file_status='pending',remote_checksum_status='pending',remote_integrity_status='not_verified',remote_error_safe='',remote_attempt_count=remote_attempt_count+1,remote_updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      try { const remote = await this.remoteUploader({ record: this.dto(row), localPath, remoteDirectory }); this.updateRemoteResult(db, id, remote); }
      catch (error) { this.updateRemoteResult(db, id, error?.details?.remote || {}, error); throw error; }
      return this.dto(this.record(db, id));
    } finally { db.close(); }
  }
  async applyRemoteRetention(limit = 20, remoteDeleter = null) {
    const keep = Math.max(1, Math.min(200, Number(limit) || 20));
    if (typeof remoteDeleter !== "function") throw new BackupError("BAIDU_REMOTE_DELETE_UNAVAILABLE", "百度网盘删除能力不可用");
    const db = this.database(); const removed = []; const skipped = [];
    try {
      const allRows = db.prepare("SELECT * FROM backup_records WHERE backup_format=? AND remote_status='success' AND COALESCE(remote_path,'')<>'' ORDER BY remote_updated_at DESC,id DESC").all(BACKUP_FORMAT);
      const rows = allRows.filter((row) => !/\.enc$/i.test(row.remote_path || ""));
      for (const row of allRows.filter((item) => /\.enc$/i.test(item.remote_path || ""))) skipped.push({ id: row.id, reason: "legacy_encrypted" });
      for (const row of rows.filter((item) => Number(item.pinned || 0))) skipped.push({ id: row.id, reason: "pinned" });
      const candidates = rows.filter((row) => !Number(row.pinned || 0)).reverse();
      let remaining = rows.length;
      for (const row of candidates) {
        if (remaining <= keep) break;
        if (remaining <= 1) { skipped.push({ id: row.id, reason: "last_valid_remote_backup" }); continue; }
        const result = await remoteDeleter(this.dto(row));
        const complete = [result.excel, result.checksum].every((value) => ["deleted", "not_present"].includes(value));
        db.prepare("UPDATE backup_records SET remote_status=?,remote_file_status=?,remote_checksum_status=?,remote_error_safe=?,remote_updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(complete ? "deleted" : "delete_partial", result.excel, result.checksum, complete ? "" : "BAIDU_REMOTE_DELETE_PARTIAL", row.id);
        if (complete) { remaining -= 1; removed.push({ id: row.id }); } else skipped.push({ id: row.id, reason: "BAIDU_REMOTE_DELETE_PARTIAL" });
      }
      return { removed, skipped, retention: keep };
    } finally { db.close(); }
  }
  async deleteBackup(id, { remoteDeleter = null } = {}) {
    const db = this.database(); const result = { local: "not_present", local_excel: "not_present", local_checksum: "not_present", remote: "not_present", remote_excel: "not_present", remote_checksum: "not_present" };
    try {
      const row = this.record(db, id); if (!row) throw new BackupError("BACKUP_NOT_FOUND", "备份记录不存在");
      if (row.backup_format !== BACKUP_FORMAT) throw new BackupError("BACKUP_PATH_UNMANAGED", "旧版备份不能由新体系删除");
      if (Number(row.pinned || 0)) throw new BackupError("BACKUP_PINNED", "置顶备份受保护，请先取消置顶");
      if (["creating", "verifying", "uploading", "restoring"].includes(row.status) || row.remote_status === "uploading") throw new BackupError("BACKUP_BUSY", "备份正在使用中");
      const validCount = Number(db.prepare("SELECT COUNT(*) AS count FROM backup_records WHERE backup_format=? AND status='success' AND COALESCE(deleted_at,'')='' ").get(BACKUP_FORMAT).count);
      if (row.status === "success" && validCount <= 1) throw new BackupError("BACKUP_LAST_VALID", "不能删除最后一份有效全量备份");
      try {
        const filename = this.managedPath(row); const checksum = `${filename}.sha256`;
        fs.rmSync(filename); result.local_excel = "deleted";
        if (fs.existsSync(checksum)) {
          if (fs.lstatSync(checksum).isSymbolicLink() || !inside(this.root, fs.realpathSync(checksum))) result.local_checksum = "rejected_symlink";
          else { try { fs.rmSync(checksum); result.local_checksum = "deleted"; } catch { result.local_checksum = "delete_failed"; } }
        }
        result.local = [result.local_excel, result.local_checksum].some((value) => ["delete_failed", "rejected_symlink"].includes(value)) ? "delete_partial" : "deleted";
        db.prepare("UPDATE backup_records SET status=?,deleted_at=CURRENT_TIMESTAMP,message=? WHERE id=?").run(result.local === "deleted" ? "deleted" : "delete_partial", result.local === "deleted" ? "manual_delete" : "BACKUP_LOCAL_DELETE_PARTIAL", id);
      }
      catch (error) { if (error.code !== "BACKUP_FILE_MISSING") throw error; db.prepare("UPDATE backup_records SET status='missing',message='BACKUP_FILE_MISSING' WHERE id=?").run(id); result.local = "missing"; result.local_excel = "missing"; }
      if ((row.remote_path || row.remote_checksum_path) && remoteDeleter) {
        try {
          const remote = await remoteDeleter(this.dto(row)); result.remote_excel = remote.excel || "not_present"; result.remote_checksum = remote.checksum || "not_present";
          const failures = [result.remote_excel, result.remote_checksum].filter((value) => value === "delete_failed").length;
          result.remote = failures === 0 ? "deleted" : failures === 2 ? "delete_failed" : "delete_partial";
          db.prepare("UPDATE backup_records SET remote_status=?,remote_file_status=?,remote_checksum_status=?,remote_error_safe=?,remote_updated_at=CURRENT_TIMESTAMP WHERE id=?").run(result.remote, result.remote_excel, result.remote_checksum, failures ? "BAIDU_REMOTE_DELETE_PARTIAL" : "", id);
        } catch (error) {
          result.remote = "delete_failed"; result.remote_excel = "delete_failed"; result.remote_checksum = row.remote_checksum_path ? "delete_failed" : "not_present";
          db.prepare("UPDATE backup_records SET remote_status='delete_failed',remote_file_status=?,remote_checksum_status=?,remote_error_safe=?,remote_updated_at=CURRENT_TIMESTAMP WHERE id=?").run(result.remote_excel, result.remote_checksum, safeMessage(error), id);
        }
      }
      return { ok: true, result, record: this.dto(this.record(db, id)) };
    } finally { db.close(); }
  }
}

module.exports = { BACKUP_FORMAT, FORMAT_VERSION, MANAGED_SUBDIR, BACKUP_COLUMNS, BackupError, BackupService, ensureBackupColumns, sha256File };
