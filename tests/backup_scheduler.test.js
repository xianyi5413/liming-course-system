const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, before, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { BackupService } = require("../src/backup/backup_service");
const { FORMAT_VERSION, verifyFullData } = require("../src/excel/full_backup");
const { loadBackupSettings, saveBackupSettings, shanghaiParts, dueState } = require("../src/backup/scheduler");

const root = path.resolve(__dirname, ".."); let tempRoot; let dataDir; let dbPath;
function init() { tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-scheduler-")); dataDir = path.join(tempRoot, "data"); dbPath = path.join(dataDir, "test.sqlite"); fs.mkdirSync(dataDir); const result = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath }, encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); }
before(init); after(() => { if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true }); });

test("backup settings use safe defaults and persist validated values", () => {
  assert.equal(loadBackupSettings(dbPath).enabled, false);
  const saved = saveBackupSettings(dbPath, { enabled: true, time: "03:15", daily_retention: 7, retry_count: 2, timezone: "UTC" });
  assert.deepEqual({ enabled: saved.enabled, time: saved.time, daily: saved.daily_retention, retry: saved.retry_count, timezone: saved.timezone }, { enabled: true, time: "03:15", daily: 7, retry: 2, timezone: "Asia/Shanghai" });
});

test("schedule dates are calculated explicitly in Asia/Shanghai", () => {
  assert.deepEqual(shanghaiParts(new Date("2026-07-20T18:31:00Z")), { date: "2026-07-21", time: "02:31" });
});

test("scheduler waits before the configured time and becomes due afterward", () => {
  saveBackupSettings(dbPath, { enabled: true, time: "02:30", retry_count: 3 });
  assert.equal(dueState(dbPath, loadBackupSettings(dbPath), new Date("2026-07-20T18:29:00Z")).reason, "before_time");
  const due = dueState(dbPath, loadBackupSettings(dbPath), new Date("2026-07-20T18:31:00Z")); assert.equal(due.due, true); assert.equal(due.key, "full-data:2026-07-21");
});

test("isolated scheduled child creates one backup and restart check does not duplicate it", async () => {
  const run = spawnSync(process.execPath, [path.join(root, "scripts/excel_backup/run_scheduled_backup.js"), "--scheduled-for", "2026-07-21", "--schedule-key", "full-data:2026-07-21"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath, APP_VERSION: "scheduler-test" }, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(run.stdout).ok, true);
  const db = new DatabaseSync(dbPath, { readOnly: true }); const record = db.prepare("SELECT format_version,managed_relative_path FROM backup_records WHERE schedule_key=? AND status='success'").get("full-data:2026-07-21"); db.close();
  assert.equal(Number(record.format_version), FORMAT_VERSION); assert.equal(verifyFullData(path.join(dataDir, record.managed_relative_path)).version, FORMAT_VERSION);
  const state = dueState(dbPath, loadBackupSettings(dbPath), new Date("2026-07-20T19:00:00Z")); assert.equal(state.reason, "already_successful");
  const again = new BackupService({ dbPath, dataDir });
  await assert.rejects(() => again.create({ trigger: "automatic", scheduledDate: "2026-07-21", scheduleKey: "full-data:2026-07-21" }), (error) => error.code === "BACKUP_SCHEDULE_ALREADY_SUCCESSFUL");
});

test("failed attempts use bounded retry waits and remain recorded", () => {
  const db = new DatabaseSync(dbPath); db.prepare("INSERT INTO backup_records(backup_type,filename,file_path,status,message,backup_format,trigger,retention_class,schedule_key,backup_time) VALUES ('auto','','','failed','SAFE','full_data_excel','automatic','daily','full-data:2026-07-22','2026-07-21 18:25:00')").run(); db.close();
  const waiting = dueState(dbPath, loadBackupSettings(dbPath), new Date("2026-07-21T18:30:00Z")); assert.equal(waiting.reason, "retry_wait");
  const retry = dueState(dbPath, loadBackupSettings(dbPath), new Date("2026-07-21T18:36:00Z")); assert.equal(retry.reason, "retry"); assert.equal(retry.attempt, 2);
});

test("retention only removes verified unpinned managed backups and keeps the final valid backup", async () => {
  const dir = path.join(tempRoot, "retention-data"); const database = path.join(dir, "retention.sqlite"); fs.mkdirSync(dir); const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], { cwd: root, env: { ...process.env, DATA_DIR: dir, DB_PATH: database }, encoding: "utf8" }); assert.equal(initialized.status, 0, initialized.stderr);
  const service = new BackupService({ dbPath: database, dataDir: dir }); const records = [];
  for (let index = 0; index < 3; index += 1) records.push((await service.create({ trigger: "manual", retentionClass: "manual", createdAt: new Date(`2026-07-20T04:00:0${index}Z`) })).record);
  service.updateMetadata(records[0].id, { pinned: true }); const result = service.applyRetention({ manual: 1, daily: 1, monthly: 1 });
  assert.equal(result.removed.length, 1); assert.equal(service.list().find((row) => row.id === records[0].id).status, "success"); assert.equal(service.list().filter((row) => row.status === "success").length, 2);
});
