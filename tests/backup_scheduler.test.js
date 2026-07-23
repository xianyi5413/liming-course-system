const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { after, before, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { BackupService } = require("../src/backup/backup_service");
const { FORMAT_VERSION, verifyFullData } = require("../src/excel/full_backup");
const { loadBackupSettings, saveBackupSettings, shanghaiParts, dueState, remoteDueState, startBackupScheduler } = require("../src/backup/scheduler");

const root = path.resolve(__dirname, ".."); let tempRoot; let dataDir; let dbPath;
function init() { tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-scheduler-")); dataDir = path.join(tempRoot, "data"); dbPath = path.join(dataDir, "test.sqlite"); fs.mkdirSync(dataDir); const result = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath }, encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); }
function fakeSpawnCollector() {
  const calls = [];
  const spawnImpl = (executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { child.killed = true; };
    calls.push({ executable, args, options, child });
    return child;
  };
  return { calls, spawnImpl };
}
const readyBaidu = Object.freeze({ oauth_configured: true, authorized: true });
before(init); after(() => { if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true }); });

test("backup settings use safe defaults and persist validated values", () => {
  assert.equal(loadBackupSettings(dbPath).enabled, false); assert.equal(loadBackupSettings(dbPath).remote_plaintext_acknowledged, false);
  const saved = saveBackupSettings(dbPath, { enabled: true, time: "03:15", daily_retention: 7, retry_count: 2, timezone: "UTC", remote_plaintext_acknowledged: true });
  assert.deepEqual({ enabled: saved.enabled, time: saved.time, daily: saved.daily_retention, retry: saved.retry_count, timezone: saved.timezone, risk_acknowledged: saved.remote_plaintext_acknowledged }, { enabled: true, time: "03:15", daily: 7, retry: 2, timezone: "Asia/Shanghai", risk_acknowledged: true });
});

test("schedule dates are calculated explicitly in Asia/Shanghai", () => {
  assert.deepEqual(shanghaiParts(new Date("2026-07-20T18:31:00Z")), { date: "2026-07-21", time: "02:31", weekday: 2, monthday: 21, month: "2026-07" });
});

test("scheduler waits before the configured time and becomes due afterward", () => {
  saveBackupSettings(dbPath, { enabled: true, time: "02:30", retry_count: 3 });
  assert.equal(dueState(dbPath, loadBackupSettings(dbPath), new Date("2026-07-20T18:29:00Z")).reason, "before_time");
  const due = dueState(dbPath, loadBackupSettings(dbPath), new Date("2026-07-20T18:31:00Z")); assert.equal(due.due, true); assert.equal(due.key, "full-data:2026-07-21");
});

test("remote schedules are independent and respect manual daily weekly and monthly periods", () => {
  const base = { ...loadBackupSettings(dbPath), enabled: false, remote_enabled: true, remote_time: "03:30", remote_retry_count: 3, remote_plaintext_acknowledged: true };
  assert.equal(remoteDueState(dbPath, { ...base, remote_frequency: "manual" }, new Date("2026-08-05T00:00:00Z")).reason, "manual");
  assert.equal(remoteDueState(dbPath, { ...base, remote_frequency: "daily" }, new Date("2026-08-05T00:00:00Z"), readyBaidu).due, true);
  assert.equal(remoteDueState(dbPath, { ...base, remote_frequency: "weekly", remote_weekday: 3 }, new Date("2026-08-05T00:00:00Z"), readyBaidu).due, true);
  assert.equal(remoteDueState(dbPath, { ...base, remote_frequency: "weekly", remote_weekday: 4 }, new Date("2026-08-05T00:00:00Z"), readyBaidu).reason, "wrong_weekday");
  assert.equal(remoteDueState(dbPath, { ...base, remote_frequency: "monthly", remote_monthday: 5 }, new Date("2026-08-05T00:00:00Z"), readyBaidu).due, true);
  assert.equal(remoteDueState(dbPath, { ...base, remote_frequency: "monthly", remote_monthday: 6 }, new Date("2026-08-05T00:00:00Z"), readyBaidu).reason, "wrong_monthday");
});

test("remote schedule reuses a failed local record for bounded retry and prevents restart duplicates", () => {
  const settings = { ...loadBackupSettings(dbPath), enabled: false, remote_enabled: true, remote_frequency: "daily", remote_time: "03:30", remote_retry_count: 3, remote_plaintext_acknowledged: true };
  const key = "full-data-remote:daily:2026-08-06"; const db = new DatabaseSync(dbPath); db.prepare("INSERT INTO backup_records(backup_type,filename,status,backup_format,format_version,trigger,retention_class,schedule_key,remote_status,remote_attempt_count,remote_updated_at) VALUES ('auto','remote.xlsx','success','full_data_excel',4,'remote_automatic','remote',?,'failed',1,'2026-08-05 18:00:00')").run(key); const id = Number(db.prepare("SELECT id FROM backup_records WHERE schedule_key=?").get(key).id); db.close();
  const retry = remoteDueState(dbPath, settings, new Date("2026-08-06T00:00:00Z"), readyBaidu); assert.equal(retry.reason, "retry"); assert.equal(retry.retry_backup_id, id); assert.equal(retry.attempt, 2);
  const successDb = new DatabaseSync(dbPath); successDb.prepare("UPDATE backup_records SET remote_status='success' WHERE id=?").run(id); successDb.close(); assert.equal(remoteDueState(dbPath, settings, new Date("2026-08-06T00:01:00Z"), readyBaidu).reason, "already_successful");
});

test("unconfigured Baidu application is not due and the scheduler does not spawn", () => {
  saveBackupSettings(dbPath, { enabled: false, remote_enabled: true, remote_frequency: "daily", remote_time: "00:00", remote_plaintext_acknowledged: true });
  const fake = fakeSpawnCollector(); const warnings = [];
  const scheduler = startBackupScheduler({ dbPath, dataDir, runImmediately: false, spawnImpl: fake.spawnImpl, nowProvider: () => new Date("2026-08-07T00:00:00Z"), remoteStatusProvider: () => ({ oauth_configured: false, authorized: false }), logger: { warn: (message) => warnings.push(message), error() {}, info() {} } });
  try {
    scheduler.check(); scheduler.check();
    assert.equal(fake.calls.length, 0);
    assert.equal(remoteDueState(dbPath, loadBackupSettings(dbPath), new Date("2026-08-07T00:00:00Z"), { oauth_configured: false }).reason, "not_configured");
    assert.equal(warnings.length, 1);
  } finally { scheduler.stop(); }
});

test("unauthorized Baidu account is not due and the scheduler does not spawn", () => {
  saveBackupSettings(dbPath, { enabled: false, remote_enabled: true, remote_frequency: "daily", remote_time: "00:00", remote_plaintext_acknowledged: true });
  const fake = fakeSpawnCollector();
  const scheduler = startBackupScheduler({ dbPath, dataDir, runImmediately: false, spawnImpl: fake.spawnImpl, nowProvider: () => new Date("2026-08-08T00:00:00Z"), remoteStatusProvider: () => ({ oauth_configured: true, authorized: false }), logger: { warn() {}, error() {}, info() {} } });
  try {
    scheduler.check();
    assert.equal(fake.calls.length, 0);
    assert.equal(remoteDueState(dbPath, loadBackupSettings(dbPath), new Date("2026-08-08T00:00:00Z"), { oauth_configured: true, authorized: false }).reason, "not_authorized");
  } finally { scheduler.stop(); }
});

test("unacknowledged plaintext risk is not due and the scheduler does not spawn", () => {
  saveBackupSettings(dbPath, { enabled: false, remote_enabled: true, remote_frequency: "daily", remote_time: "00:00", remote_plaintext_acknowledged: false });
  const fake = fakeSpawnCollector();
  const scheduler = startBackupScheduler({ dbPath, dataDir, runImmediately: false, spawnImpl: fake.spawnImpl, nowProvider: () => new Date("2026-08-09T00:00:00Z"), remoteStatusProvider: () => readyBaidu, logger: { warn() {}, error() {}, info() {} } });
  try {
    scheduler.check();
    assert.equal(fake.calls.length, 0);
    assert.equal(remoteDueState(dbPath, loadBackupSettings(dbPath), new Date("2026-08-09T00:00:00Z"), readyBaidu).reason, "plaintext_not_acknowledged");
  } finally { scheduler.stop(); }
});

test("ready Baidu schedule spawns the isolated remote child", () => {
  saveBackupSettings(dbPath, { enabled: false, remote_enabled: true, remote_frequency: "daily", remote_time: "00:00", remote_plaintext_acknowledged: true });
  const fake = fakeSpawnCollector();
  const scheduler = startBackupScheduler({ dbPath, dataDir, runImmediately: false, spawnImpl: fake.spawnImpl, nowProvider: () => new Date("2026-08-10T00:00:00Z"), remoteStatusProvider: () => readyBaidu, logger: { warn() {}, error() {}, info() {} } });
  try {
    scheduler.check();
    assert.equal(fake.calls.length, 1);
    assert.deepEqual(fake.calls[0].args.slice(-2), ["--kind", "remote"]);
  } finally { scheduler.stop(); }
});

test("scheduler automatically runs on the next check after Baidu readiness recovers", () => {
  saveBackupSettings(dbPath, { enabled: false, remote_enabled: true, remote_frequency: "daily", remote_time: "00:00", remote_plaintext_acknowledged: false });
  const fake = fakeSpawnCollector(); const secretDirectory = path.join(dataDir, "backups", "full-excel", ".secrets");
  const scheduler = startBackupScheduler({ dbPath, dataDir, runImmediately: false, spawnImpl: fake.spawnImpl, nowProvider: () => new Date("2026-08-11T00:00:00Z"), logger: { warn() {}, error() {}, info() {} } });
  try {
    scheduler.check(); assert.equal(fake.calls.length, 0);
    fs.mkdirSync(secretDirectory, { recursive: true });
    fs.writeFileSync(path.join(secretDirectory, "baidu-config.json"), JSON.stringify({ app_key: "K", app_secret: "S", redirect_uri: "http://127.0.0.1/callback", last_test_at: "", last_test_result: "not_tested" }));
    fs.writeFileSync(path.join(secretDirectory, "baidu-token.json"), JSON.stringify({ access_token: "TOKEN", refresh_token: "REFRESH", expires_at: Date.now() + 3600000 }));
    saveBackupSettings(dbPath, { remote_plaintext_acknowledged: true });
    scheduler.check(); assert.equal(fake.calls.length, 1);
  } finally { scheduler.stop(); fs.rmSync(secretDirectory, { recursive: true, force: true }); }
});

test("a raced NOT_READY child result applies cooldown instead of retrying every minute", () => {
  saveBackupSettings(dbPath, { enabled: false, remote_enabled: true, remote_frequency: "daily", remote_time: "00:00", remote_plaintext_acknowledged: true });
  const fake = fakeSpawnCollector(); let now = new Date("2026-08-12T00:00:00Z");
  const scheduler = startBackupScheduler({ dbPath, dataDir, runImmediately: false, spawnImpl: fake.spawnImpl, nowProvider: () => now, remoteStatusProvider: () => readyBaidu, notReadyCooldownMs: 10 * 60_000, logger: { warn() {}, error() {}, info() {} } });
  try {
    scheduler.check(); assert.equal(fake.calls.length, 1);
    fake.calls[0].child.stderr.write('{"ok":false,"code":"BAIDU_AUTOMATIC_BACKUP_NOT_READY"}\n');
    fake.calls[0].child.emit("exit", 1);
    now = new Date("2026-08-12T00:01:00Z"); scheduler.check(); assert.equal(fake.calls.length, 1);
    now = new Date("2026-08-12T00:09:59Z"); scheduler.check(); assert.equal(fake.calls.length, 1);
    now = new Date("2026-08-12T00:10:00Z"); scheduler.check(); assert.equal(fake.calls.length, 2);
  } finally { scheduler.stop(); }
});

test("local automatic backup still spawns when Baidu is not configured", () => {
  saveBackupSettings(dbPath, { enabled: true, time: "00:00", remote_enabled: true, remote_frequency: "daily", remote_time: "00:00", remote_plaintext_acknowledged: true });
  const fake = fakeSpawnCollector();
  const scheduler = startBackupScheduler({ dbPath, dataDir, runImmediately: false, spawnImpl: fake.spawnImpl, nowProvider: () => new Date("2026-08-13T00:00:00Z"), remoteStatusProvider: () => { throw new Error("remote status must not block a due local backup"); }, logger: { warn() {}, error() {}, info() {} } });
  try {
    scheduler.check();
    assert.equal(fake.calls.length, 1);
    assert.deepEqual(fake.calls[0].args.slice(-2), ["--kind", "local"]);
  } finally { scheduler.stop(); }
});

test("scheduled child keeps defensive NOT_READY validation without creating a backup record", () => {
  saveBackupSettings(dbPath, { enabled: false, remote_enabled: true, remote_frequency: "daily", remote_time: "00:00", remote_plaintext_acknowledged: true });
  const key = "full-data-remote:daily:2026-08-14"; const beforeDb = new DatabaseSync(dbPath, { readOnly: true }); const before = Number(beforeDb.prepare("SELECT COUNT(*) AS count FROM backup_records WHERE schedule_key=?").get(key).count); beforeDb.close();
  const run = spawnSync(process.execPath, [path.join(root, "scripts/excel_backup/run_scheduled_backup.js"), "--scheduled-for", "2026-08-14", "--schedule-key", key, "--kind", "remote"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath, BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "" }, encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stderr).code, "BAIDU_AUTOMATIC_BACKUP_NOT_READY");
  const afterDb = new DatabaseSync(dbPath, { readOnly: true }); const after = Number(afterDb.prepare("SELECT COUNT(*) AS count FROM backup_records WHERE schedule_key=?").get(key).count); afterDb.close();
  assert.equal(after, before);
});

test("isolated scheduled child creates one backup and restart check does not duplicate it", async () => {
  const run = spawnSync(process.execPath, [path.join(root, "scripts/excel_backup/run_scheduled_backup.js"), "--scheduled-for", "2026-07-21", "--schedule-key", "full-data:2026-07-21"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath, APP_VERSION: "scheduler-test" }, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(run.stdout).ok, true);
  const db = new DatabaseSync(dbPath, { readOnly: true }); const record = db.prepare("SELECT format_version,managed_relative_path FROM backup_records WHERE schedule_key=? AND status='success'").get("full-data:2026-07-21"); db.close();
  assert.equal(Number(record.format_version), FORMAT_VERSION); const verified = verifyFullData(path.join(dataDir, record.managed_relative_path)); assert.equal(verified.version, FORMAT_VERSION);
  assert.equal(verified.workbook.sheetMap.get("所有学生费用明细").rows[0].includes("规则费用"), false);
  assert.equal(verified.workbook.sheetMap.get("所有教师课时明细").rows[0].includes("规则薪资"), false);
  const state = dueState(dbPath, { ...loadBackupSettings(dbPath), enabled: true }, new Date("2026-07-20T19:00:00Z")); assert.equal(state.reason, "already_successful");
  const again = new BackupService({ dbPath, dataDir });
  await assert.rejects(() => again.create({ trigger: "automatic", scheduledDate: "2026-07-21", scheduleKey: "full-data:2026-07-21" }), (error) => error.code === "BACKUP_SCHEDULE_ALREADY_SUCCESSFUL");
});

test("failed attempts use bounded retry waits and remain recorded", () => {
  const db = new DatabaseSync(dbPath); db.prepare("INSERT INTO backup_records(backup_type,filename,file_path,status,message,backup_format,trigger,retention_class,schedule_key,backup_time) VALUES ('auto','','','failed','SAFE','full_data_excel','automatic','daily','full-data:2026-07-22','2026-07-21 18:25:00')").run(); db.close();
  const settings = { ...loadBackupSettings(dbPath), enabled: true };
  const waiting = dueState(dbPath, settings, new Date("2026-07-21T18:30:00Z")); assert.equal(waiting.reason, "retry_wait");
  const retry = dueState(dbPath, settings, new Date("2026-07-21T18:36:00Z")); assert.equal(retry.reason, "retry"); assert.equal(retry.attempt, 2);
});

test("retention only removes verified unpinned managed backups and keeps the final valid backup", async () => {
  const dir = path.join(tempRoot, "retention-data"); const database = path.join(dir, "retention.sqlite"); fs.mkdirSync(dir); const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], { cwd: root, env: { ...process.env, DATA_DIR: dir, DB_PATH: database }, encoding: "utf8" }); assert.equal(initialized.status, 0, initialized.stderr);
  const service = new BackupService({ dbPath: database, dataDir: dir }); const records = [];
  for (let index = 0; index < 3; index += 1) records.push((await service.create({ trigger: "manual", retentionClass: "manual", createdAt: new Date(`2026-07-20T04:00:0${index}Z`) })).record);
  service.updateMetadata(records[0].id, { pinned: true }); const result = service.applyRetention({ manual: 1, daily: 1, monthly: 1 });
  assert.equal(result.removed.length, 1); assert.equal(service.list().find((row) => row.id === records[0].id).status, "success"); assert.equal(service.list().filter((row) => row.status === "success").length, 2);
});
