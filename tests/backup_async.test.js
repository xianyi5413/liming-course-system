const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const { BackupService } = require("../src/backup/backup_service");

const root = path.resolve(__dirname, "..");
let tempRoot; let dbPath; let service;

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-backup-async-"));
  dbPath = path.join(tempRoot, "synthetic.sqlite");
  const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], { cwd: root, env: { ...process.env, DATA_DIR: tempRoot, DB_PATH: dbPath }, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  service = new BackupService({ dbPath, dataDir: tempRoot, appVersion: "test" });
});
after(() => { if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

test("manual remote requests queue once and expose persistent pollable stages", () => {
  const first = service.queueRemoteManual({ createdByUserId: 1, includeOperationLogs: false });
  const duplicate = service.queueRemoteManual({ createdByUserId: 1, includeOperationLogs: false });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.record.id, first.record.id);
  for (const stage of ["preflight", "exporting", "hashing", "uploading_excel", "uploading_checksum", "verifying_metadata", "downloading_for_verification", "integrity_check"]) assert.equal(service.markJobStage(first.record.id, stage).job_status, stage);
  assert.equal(service.markJobStage(first.record.id, "success", "", 0).job_completed_at.length > 0, true);
});

test("attaching a worker PID never regresses an already advanced stage", () => {
  const queued = service.queueRemoteManual({ createdByUserId: 1 });
  service.markJobStage(queued.record.id, "exporting", "", 101);
  const attached = service.setJobPid(queued.record.id, 202);
  assert.equal(attached.job_status, "exporting");
  assert.equal(attached.job_pid, 202);
  service.markJobStage(queued.record.id, "success", "", 0);
});

test("an orphaned running job is marked interrupted on restart recovery", () => {
  const queued = service.queueRemoteManual({ createdByUserId: 1 });
  service.markJobStage(queued.record.id, "uploading_excel", "", 99999999);
  assert.deepEqual(service.recoverInterruptedJobs(), [queued.record.id]);
  const db = service.database(); try { const row = service.record(db, queued.record.id); assert.equal(row.job_status, "failed"); assert.equal(row.job_error_code, "BACKUP_WORKER_INTERRUPTED"); } finally { db.close(); }
});

test("a failed record with no managed file can be deleted without last-success protection", async () => {
  const db = service.database(); let id;
  try { id = Number(db.prepare("INSERT INTO backup_records(backup_type,filename,status,backup_format,format_version,trigger,retention_class,managed_relative_path,remote_status,pinned) VALUES ('manual','','failed','full_data_excel',4,'manual','manual','','failed',0)").run().lastInsertRowid); } finally { db.close(); }
  const result = await service.deleteBackup(id);
  assert.equal(result.result.local, "deleted");
  assert.equal(result.record.status, "deleted");
});

test("web contract starts remote backup with HTTP 202 and polls by job id", () => {
  const source = fs.readFileSync(path.join(root, "src/server.js"), "utf8");
  assert.match(source, /url\.pathname === "\/api\/data-center\/baidu\/backups"[\s\S]*queueRemoteManual[\s\S]*sendJson\(res,[\s\S]*202\)/);
  assert.equal(source.includes("/^\\/api\\/data-center\\/backups\\/(\\d+)\\/job$/"), true);
  assert.match(source, /spawn\(process\.execPath/);
  assert.doesNotMatch(source, /url\.pathname === "\/api\/data-center\/baidu\/backups"[\s\S]{0,900}await backupService\(\)\.create/);
});

test("job records do not persist secrets or remote download links", () => {
  const db = new DatabaseSync(dbPath, { readOnly: true }); const columns = new Set(db.prepare("PRAGMA table_info(backup_records)").all().map((row) => row.name)); db.close();
  for (const name of ["job_status", "job_error_code", "job_started_at", "job_updated_at", "job_completed_at", "job_pid"]) assert.equal(columns.has(name), true);
  for (const forbidden of ["access_token", "refresh_token", "app_secret", "dlink", "session"]) assert.equal(columns.has(forbidden), false);
});
