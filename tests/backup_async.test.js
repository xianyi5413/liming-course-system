const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const { BackupService } = require("../src/backup/backup_service");
const { freePort } = require("./helpers/chrome_cdp");

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

test("a delayed 30 MB worker load does not block login, course or student APIs", async () => {
  const payload = path.join(tempRoot, "simulated-30mb.bin");
  fs.writeFileSync(payload, Buffer.alloc(30 * 1024 * 1024, 0x5a));
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(root, "src/server.js")], {
    cwd: root,
    env: { ...process.env, DATA_DIR: tempRoot, DB_PATH: dbPath, PORT: String(port), SESSION_COOKIE_SECURE: "false", BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "" },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(server.exitCode, null);
  const workerCode = "const fs=require('node:fs'),crypto=require('node:crypto');const b=fs.readFileSync(process.argv[1]);crypto.createHash('sha256').update(b).digest('hex');setTimeout(()=>{},3000);";
  const worker = spawn(process.execPath, ["-e", workerCode, payload], { stdio: "ignore", windowsHide: true });
  try {
    const started = Date.now();
    const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "boss", password: "123456" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const [health, lessons, bootstrap] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/api/version`),
      fetch(`http://127.0.0.1:${port}/api/lessons-range?start=2026-07-01&end=2026-07-31`, { headers: { cookie } }),
      fetch(`http://127.0.0.1:${port}/api/bootstrap?month=2026-07-01`, { headers: { cookie } }),
    ]);
    assert.deepEqual([health.status, lessons.status, bootstrap.status], [200, 200, 200]);
    assert.equal(worker.exitCode, null, "worker should still be in its simulated upload delay");
    assert.ok(Date.now() - started < 2500, "ordinary APIs must finish before the delayed worker");
  } finally {
    if (worker.exitCode == null) worker.kill("SIGTERM");
    if (server.exitCode == null) server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});
