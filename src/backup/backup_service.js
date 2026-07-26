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
  job_status: "TEXT DEFAULT ''", job_error_code: "TEXT DEFAULT ''", job_started_at: "TEXT DEFAULT ''",
  job_updated_at: "TEXT DEFAULT ''", job_completed_at: "TEXT DEFAULT ''", job_pid: "INTEGER NOT NULL DEFAULT 0",
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
  record(db, id) {
    return db.prepare(`
      SELECT br.*, u.id AS creator_joined_id, u.username AS creator_username,
        u.display_name AS creator_display_name, u.status AS creator_status
      FROM backup_records br
      LEFT JOIN users u ON u.id = br.created_by_user_id
      WHERE br.id=?
    `).get(Number(id));
  }
  creator(row) {
    const automatic = ["automatic", "remote_automatic"].includes(String(row.trigger || ""))
      || String(row.backup_type || "") === "auto";
    if (automatic) return { created_by_label: "自动备份", created_by_type: "automatic" };
    if (row.created_by_user_id) {
      if (!row.creator_joined_id || row.creator_status === "deleted") {
        return { created_by_label: "已删除账号", created_by_type: "deleted_user" };
      }
      return {
        created_by_label: String(row.creator_display_name || "").trim() || String(row.creator_username || "").trim() || "已删除账号",
        created_by_type: "user",
      };
    }
    return { created_by_label: "历史记录", created_by_type: "historical" };
  }
  dto(row) { const dto = { id: row.id, backup_time: row.backup_time || row.created_at || "", backup_format: row.backup_format || "legacy_core_zip", format_version: Number(row.format_version || 0), backup_type: row.backup_type || "", trigger: row.trigger || row.backup_type || "", retention_class: row.retention_class || "", filename: row.filename || "", managed_relative_path: row.managed_relative_path || "", file_size: Number(row.file_size || 0), sha256: row.sha256 || "", status: row.status || "", verified_at: row.verified_at || "", schedule_key: row.schedule_key || "", created_by_user_id: row.created_by_user_id || null, ...this.creator(row), note: row.note || "", pinned: Number(row.pinned || 0), operation_logs_included: Number(row.operation_logs_included ?? 1) === 1, remote_attempt_count: Number(row.remote_attempt_count || 0), remote_status: (row.backup_format || "legacy_core_zip") === BACKUP_FORMAT ? (row.remote_status || "not_configured") : "legacy", remote_file_id: row.remote_file_id || "", remote_path: row.remote_path || "", remote_checksum_file_id: row.remote_checksum_file_id || "", remote_checksum_path: row.remote_checksum_path || "", remote_file_status: row.remote_file_status || "", remote_checksum_status: row.remote_checksum_status || "", remote_integrity_status: row.remote_integrity_status || "", remote_error_safe: row.remote_error_safe || "", remote_updated_at: row.remote_updated_at || "", deleted_at: row.deleted_at || "", message: row.message || "", job_status: row.job_status || "", job_error_code: row.job_error_code || "", job_started_at: row.job_started_at || "", job_updated_at: row.job_updated_at || "", job_completed_at: row.job_completed_at || "", job_pid: Number(row.job_pid || 0) }; return { ...dto, failure: backupFailureDisplay(dto) }; }
  activeRemoteJob(db) {
    return db.prepare("SELECT * FROM backup_records WHERE trigger='remote_manual' AND job_status IN ('queued','preflight','exporting','hashing','uploading_excel','uploading_checksum','verifying_metadata','downloading_for_verification','integrity_check') ORDER BY id DESC LIMIT 1").get();
  }
  queueRemoteManual(options = {}) {
    const db = this.database();
    try {
      const existing = this.activeRemoteJob(db);
      if (existing) return { created: false, record: this.dto(existing) };
      assertDataPreflight(db);
      this.ensureRoot();
      const filename = fullDataFilename(options.createdAt || new Date());
      const id = this.insertRecord(db, { ...options, trigger: "remote_manual", retentionClass: "remote", filename, remoteEnabled: true });
      db.prepare("UPDATE backup_records SET job_status='queued',job_error_code='',job_updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      return { created: true, record: this.dto(this.record(db, id)) };
    } finally { db.close(); }
  }
  markJobStage(id, stage, errorCode = "", pid = undefined) {
    const allowed = new Set(["queued", "preflight", "exporting", "hashing", "uploading_excel", "uploading_checksum", "verifying_metadata", "downloading_for_verification", "integrity_check", "success", "partial_failed", "failed"]);
    const normalized = allowed.has(stage) ? stage : "failed";
    const terminal = ["success", "partial_failed", "failed"].includes(normalized);
    const db = this.database();
    try {
      const row = this.record(db, id);
      if (!row) throw new BackupError("BACKUP_NOT_FOUND", "备份记录不存在");
      db.prepare(`UPDATE backup_records SET job_status=?,job_error_code=?,job_updated_at=CURRENT_TIMESTAMP,
        job_started_at=CASE WHEN ?='exporting' AND COALESCE(job_started_at,'')='' THEN CURRENT_TIMESTAMP ELSE job_started_at END,
        job_completed_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE job_completed_at END,
        job_pid=CASE WHEN ? IS NULL THEN job_pid ELSE ? END WHERE id=?`)
        .run(normalized, String(errorCode || "").slice(0, 100), normalized, terminal ? 1 : 0, pid === undefined ? null : Number(pid || 0), Number(pid || 0), id);
      return this.dto(this.record(db, id));
    } finally { db.close(); }
  }
  setJobPid(id, pid) {
    const db = this.database();
    try {
      if (!this.record(db, id)) throw new BackupError("BACKUP_NOT_FOUND", "备份记录不存在");
      db.prepare("UPDATE backup_records SET job_pid=?,job_updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(pid || 0), Number(id));
      return this.dto(this.record(db, id));
    } finally { db.close(); }
  }
  recoverInterruptedJobs() {
    const db = this.database(); const recovered = [];
    try {
      const rows = db.prepare("SELECT * FROM backup_records WHERE job_status IN ('queued','preflight','exporting','hashing','uploading_excel','uploading_checksum','verifying_metadata','downloading_for_verification','integrity_check')").all();
      for (const row of rows) {
        let alive = false;
        if (Number(row.job_pid || 0) > 0) try { process.kill(Number(row.job_pid), 0); alive = true; } catch (error) { alive = error.code === "EPERM"; }
        if (alive) continue;
        db.prepare("UPDATE backup_records SET job_status='failed',job_error_code='BACKUP_WORKER_INTERRUPTED',job_updated_at=CURRENT_TIMESTAMP,job_completed_at=CURRENT_TIMESTAMP,job_pid=0,status=CASE WHEN status='creating' THEN 'failed' ELSE status END,message=CASE WHEN COALESCE(message,'')='' THEN 'BACKUP_WORKER_INTERRUPTED' ELSE message END WHERE id=?").run(row.id);
        recovered.push(Number(row.id));
      }
      return recovered;
    } finally { db.close(); }
  }
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
  list(limit = 100) {
    const db = this.database();
    try {
      return db.prepare(`
        SELECT br.*, u.id AS creator_joined_id, u.username AS creator_username,
          u.display_name AS creator_display_name, u.status AS creator_status
        FROM backup_records br
        LEFT JOIN users u ON u.id = br.created_by_user_id
        ORDER BY br.backup_time DESC, br.id DESC
        LIMIT ?
      `).all(Math.max(1, Math.min(500, Number(limit) || 100))).map((row) => this.dto(row));
    } finally { db.close(); }
  }
  managedPath(row) { if (row.backup_format !== BACKUP_FORMAT || !row.managed_relative_path || path.isAbsolute(row.managed_relative_path)) throw new BackupError("BACKUP_PATH_UNMANAGED", "记录不是受管全量备份"); const target = path.resolve(this.dataDir, row.managed_relative_path); if (!inside(this.root, target)) throw new BackupError("BACKUP_PATH_INVALID", "备份相对路径无效"); if (!fs.existsSync(target)) throw new BackupError("BACKUP_FILE_MISSING", "备份文件不存在"); if (fs.lstatSync(target).isSymbolicLink() || !inside(this.root, fs.realpathSync(target))) throw new BackupError("BACKUP_PATH_SYMLINK", "备份文件路径无效"); return target; }
  verify(id) { const db = this.database(); try { const row = this.record(db, id); if (!row) throw new BackupError("BACKUP_NOT_FOUND", "备份记录不存在"); const filename = this.managedPath(row); verifyFullData(filename); const digest = sha256File(filename); if (digest !== row.sha256) throw new BackupError("BACKUP_SHA256_MISMATCH", "备份SHA-256不匹配"); db.prepare("UPDATE backup_records SET verified_at=CURRENT_TIMESTAMP,message='' WHERE id=?").run(id); return this.dto(this.record(db, id)); } catch (error) { try { db.prepare("UPDATE backup_records SET message=? WHERE id=?").run(serializeBackupFailure(safeBackupFailure(error)), id); } catch {} throw error; } finally { db.close(); } }
  async create(options = {}) {
    const lock = this.acquireLock(); const db = this.database(); const trigger = options.trigger === "automatic" ? "automatic" : (options.trigger || "manual"); const retentionClass = options.retentionClass || (trigger === "automatic" ? "daily" : "manual"); const filename = fullDataFilename(options.createdAt || new Date()); let id; let staging = ""; let published = ""; let checksumFile = ""; let publishedByThisRun = false; let checksumPublishedByThisRun = false;
    try {
      if (options.scheduleKey && db.prepare("SELECT 1 FROM backup_records WHERE schedule_key=? AND status='success' LIMIT 1").get(options.scheduleKey)) throw new BackupError("BACKUP_SCHEDULE_ALREADY_SUCCESSFUL", "该计划日期已经成功备份");
      if (options.existingRecordId) {
        id = Number(options.existingRecordId);
        if (!this.record(db, id)) throw new BackupError("BACKUP_NOT_FOUND", "备份任务不存在");
        db.prepare("UPDATE backup_records SET filename=?,status='creating',trigger=?,retention_class=? WHERE id=?").run(filename, trigger, retentionClass, id);
      } else id = this.insertRecord(db, { ...options, trigger, retentionClass, filename });
      assertDataPreflight(db);
      if (options.existingRecordId) this.markJobStage(id, "exporting", "", process.pid);
      staging = path.join(this.root, `.staging-${id}-${crypto.randomUUID()}`); fs.mkdirSync(staging, { mode: 0o700 });
      const staged = path.join(staging, filename); const stagedHash = `${staged}.sha256`; exportFullData({ dbPath: this.dbPath, outputPath: staged, appVersion: this.appVersion, appGitCommit: this.appGitCommit, createdAt: options.createdAt || new Date(), includeOperationLogs: options.includeOperationLogs !== false });
      if (options.existingRecordId) this.markJobStage(id, "hashing", "", process.pid);
      verifyFullData(staged); const digest = sha256File(staged); fs.writeFileSync(stagedHash, `${digest}  ${filename}\n`, { flag: "wx", mode: 0o600 }); fs.chmodSync(staged, 0o600);
      published = path.join(this.root, filename); checksumFile = `${published}.sha256`; if (fs.existsSync(published) || fs.existsSync(checksumFile)) throw new BackupError("BACKUP_TARGET_EXISTS", "备份目标已存在");
      fs.renameSync(staged, published); publishedByThisRun = true;
      try { fs.renameSync(stagedHash, checksumFile); checksumPublishedByThisRun = true; }
      catch (error) { fs.rmSync(published, { force: true }); publishedByThisRun = false; throw error; }
      const relative = path.relative(this.dataDir, published); const size = fs.statSync(published).size; db.prepare("UPDATE backup_records SET managed_relative_path=?,file_size=?,sha256=?,status='success',verified_at=CURRENT_TIMESTAMP,message='' WHERE id=?").run(relative, size, digest, id);
      let row = this.record(db, id);
      if (options.remoteEnabled && this.remoteUploader) {
        db.prepare("UPDATE backup_records SET remote_status='uploading',remote_attempt_count=remote_attempt_count+1,remote_updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
        try { const remote = await this.remoteUploader({ record: this.dto(row), localPath: published, onStage: options.existingRecordId ? (stage) => this.markJobStage(id, stage, "", process.pid) : null }); this.updateRemoteResult(db, id, remote); }
        catch (error) { this.updateRemoteResult(db, id, error?.details?.remote || {}, error); }
      } else if (options.remoteEnabled) { const failure = safeBackupFailure("BAIDU_NOT_CONFIGURED", { stage: "remote" }); db.prepare("UPDATE backup_records SET remote_status='failed',remote_error_safe=?,message=?,remote_updated_at=CURRENT_TIMESTAMP WHERE id=?").run(failure.code, serializeBackupFailure(failure), id); }
      row = this.record(db, id);
      if (options.existingRecordId) this.markJobStage(id, row.remote_status === "success" ? "success" : (row.remote_status === "partial_failed" ? "partial_failed" : "failed"), row.remote_error_safe || "", 0);
      return { ok: true, record: this.dto(this.record(db, id)) };
    } catch (error) {
      if (id) try { db.prepare("UPDATE backup_records SET status='failed',message=? WHERE id=?").run(serializeBackupFailure(safeBackupFailure(error, { stage: "local" })), id); } catch {}
      if (id && options.existingRecordId) try { this.markJobStage(id, "failed", error.code || "BACKUP_JOB_FAILED", 0); } catch {}
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
    const db = this.database();
    const cleanup = {
      local_excel: "already_absent",
      local_checksum: "already_absent",
      remote_excel: "already_absent",
      remote_checksum: "already_absent",
    };
    try {
      const row = this.record(db, id); if (!row) throw new BackupError("BACKUP_NOT_FOUND", "备份记录不存在");
      if (row.backup_format !== BACKUP_FORMAT) throw new BackupError("BACKUP_PATH_UNMANAGED", "旧版备份不能由新体系删除");
      if (Number(row.pinned || 0)) throw new BackupError("BACKUP_PINNED", "置顶备份受保护，请先取消置顶");
      const activeJobs = new Set(["queued", "preflight", "exporting", "hashing", "uploading_excel", "uploading_checksum", "verifying_metadata", "downloading_for_verification", "integrity_check"]);
      if (["creating", "verifying", "uploading", "restoring"].includes(row.status) || row.remote_status === "uploading" || activeJobs.has(row.job_status)) {
        throw new BackupError("BACKUP_BUSY", "备份正在使用中");
      }
      const validCount = Number(db.prepare("SELECT COUNT(*) AS count FROM backup_records WHERE backup_format=? AND status='success' AND COALESCE(deleted_at,'')='' ").get(BACKUP_FORMAT).count);
      if (row.status === "success" && validCount <= 1) throw new BackupError("BACKUP_LAST_VALID", "不能删除最后一份有效全量备份");

      if (row.managed_relative_path) {
        if (path.isAbsolute(row.managed_relative_path)) throw new BackupError("BACKUP_PATH_UNMANAGED", "记录不是受管全量备份");
        const filename = path.resolve(this.dataDir, row.managed_relative_path);
        if (!inside(this.root, filename)) throw new BackupError("BACKUP_PATH_INVALID", "备份相对路径无效");
        const localTargets = [["local_excel", filename], ["local_checksum", `${filename}.sha256`]];
        for (const [key, target] of localTargets) {
          if (!fs.existsSync(target)) continue;
          if (fs.lstatSync(target).isSymbolicLink() || !inside(this.root, fs.realpathSync(target))) {
            cleanup[key] = "rejected_symlink";
            continue;
          }
          try { fs.rmSync(target); cleanup[key] = "deleted"; }
          catch { cleanup[key] = "delete_failed"; }
        }
      }

      if (row.remote_path || row.remote_checksum_path) {
        if (typeof remoteDeleter !== "function") {
          if (row.remote_path) cleanup.remote_excel = "delete_failed";
          if (row.remote_checksum_path) cleanup.remote_checksum = "delete_failed";
        } else {
        try {
            const remote = await remoteDeleter(this.dto(row));
            cleanup.remote_excel = remote.excel === "not_present" ? "already_absent" : (remote.excel || "already_absent");
            cleanup.remote_checksum = remote.checksum === "not_present" ? "already_absent" : (remote.checksum || "already_absent");
        } catch (error) {
            if (row.remote_path) cleanup.remote_excel = "delete_failed";
            if (row.remote_checksum_path) cleanup.remote_checksum = "delete_failed";
          }
        }
      }

      const completeStatuses = new Set(["deleted", "already_absent", "not_present", "missing"]);
      const deleted = Object.values(cleanup).every((status) => completeStatuses.has(status));
      if (deleted) {
        db.prepare("DELETE FROM backup_records WHERE id=?").run(Number(id));
        return { ok: true, deleted: true, backup_id: Number(id), cleanup };
      }

      const localFailed = [cleanup.local_excel, cleanup.local_checksum].some((status) => !completeStatuses.has(status));
      const remoteFailed = [cleanup.remote_excel, cleanup.remote_checksum].some((status) => !completeStatuses.has(status));
      db.prepare(`
        UPDATE backup_records
        SET status=?, message=?, remote_status=?, remote_file_status=?, remote_checksum_status=?,
          remote_error_safe=?, remote_updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(
        localFailed ? "delete_partial" : row.status,
        localFailed ? "BACKUP_LOCAL_DELETE_PARTIAL" : row.message,
        remoteFailed ? "delete_partial" : row.remote_status,
        cleanup.remote_excel,
        cleanup.remote_checksum,
        remoteFailed ? "BAIDU_REMOTE_DELETE_PARTIAL" : "",
        Number(id),
      );
      return { ok: false, deleted: false, backup_id: Number(id), cleanup, record: this.dto(this.record(db, id)) };
    } finally { db.close(); }
  }
}

module.exports = { BACKUP_FORMAT, FORMAT_VERSION, MANAGED_SUBDIR, BACKUP_COLUMNS, BackupError, BackupService, ensureBackupColumns, sha256File };
