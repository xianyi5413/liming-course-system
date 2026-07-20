const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, before, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { BackupService, ensureBackupColumns, sha256File } = require("../src/backup/backup_service");
const { FORMAT_VERSION, expectedVisibleSheetNames, verifyFullData } = require("../src/excel/full_backup");

const root = path.resolve(__dirname, "..");
let tempRoot; let dataDir; let dbPath; let service; let created;

function initDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const result = spawnSync(process.execPath, [path.join(root, "src", "server.js"), "--init-db"], {
    cwd: root, env: { ...process.env, DATA_DIR: path.dirname(filename), DB_PATH: filename }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-data-center-"));
  dataDir = path.join(tempRoot, "data with space"); dbPath = path.join(dataDir, "synthetic.sqlite");
  initDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  db.prepare("INSERT INTO students(id,name,grade,status) VALUES (7001,'备份测试学生','初一','在读')").run();
  db.prepare("INSERT INTO backup_records(backup_type,included_months,filename,file_path,file_size,status,message) VALUES ('manual',1,'legacy.zip','legacy/legacy.zip',42,'success','')").run();
  ensureBackupColumns(db); db.close();
  service = new BackupService({ dbPath, dataDir, appVersion: "data-center-test" });
  created = await service.create({ trigger: "manual", retentionClass: "manual", createdByUserId: 1, createdAt: new Date("2026-07-20T04:00:00Z") });
});

after(() => { if (tempRoot && path.basename(tempRoot).startsWith("liming-data-center-")) fs.rmSync(tempRoot, { recursive: true, force: true }); });

test("backup_records receives only the incremental data-center columns", () => {
  const db = new DatabaseSync(dbPath, { readOnly: true }); const columns = new Set(db.prepare("PRAGMA table_info(backup_records)").all().map((row) => row.name)); db.close();
  for (const name of ["backup_format", "format_version", "trigger", "managed_relative_path", "sha256", "remote_status", "deleted_at"]) assert.equal(columns.has(name), true, name);
});

test("manual backup atomically publishes a validated full Excel and checksum", () => {
  assert.equal(created.ok, true); assert.equal(created.record.status, "success"); assert.equal(created.record.backup_format, "full_data_excel");
  const filename = path.join(dataDir, created.record.managed_relative_path); assert.equal(fs.existsSync(filename), true); assert.equal(fs.existsSync(`${filename}.sha256`), true);
  const verified = verifyFullData(filename);
  assert.equal(verified.ok, true); assert.equal(verified.version, FORMAT_VERSION); assert.equal(created.record.format_version, FORMAT_VERSION);
  assert.deepEqual(verified.workbook.sheets.filter((sheet) => sheet.state === "visible").map((sheet) => sheet.name), expectedVisibleSheetNames());
  assert.equal(sha256File(filename), created.record.sha256);
});

test("managed backup paths are relative and do not expose host paths", () => {
  assert.equal(path.isAbsolute(created.record.managed_relative_path), false); assert.equal(JSON.stringify(created.record).includes(tempRoot), false);
});

test("manual backup uses private directory and file modes where supported", () => {
  if (process.platform === "win32") return assert.equal(true, true);
  const filename = path.join(dataDir, created.record.managed_relative_path);
  assert.equal(fs.statSync(path.dirname(filename)).mode & 0o777, 0o700); assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
});

test("verification recomputes workbook integrity and SHA-256", () => {
  const verified = service.verify(created.record.id); assert.match(verified.verified_at, /\d/); assert.equal(verified.sha256, created.record.sha256);
});

test("cross-process lock rejects a concurrent backup", async () => {
  const lock = service.acquireLock();
  try { await assert.rejects(() => service.create({ trigger: "manual" }), (error) => error.code === "BACKUP_ALREADY_RUNNING"); }
  finally { service.releaseLock(lock); }
});

test("a stale lock from a terminated process is reclaimed without touching other files", () => {
  const lock = path.join(dataDir, "backups", "full-excel", ".backup.lock"); fs.writeFileSync(lock, JSON.stringify({ pid: 2147483647, started_at: "2000-01-01T00:00:00.000Z" }), { flag: "wx" });
  const acquired = service.acquireLock(); assert.equal(acquired, lock); service.releaseLock(acquired); assert.equal(fs.existsSync(lock), false);
});

test("legacy records remain visible and are not converted to managed backups", () => {
  const legacy = service.list().find((row) => row.filename === "legacy.zip"); assert.ok(legacy); assert.equal(legacy.backup_format, "legacy_core_zip"); assert.equal(legacy.managed_relative_path, "");
});

test("managed path lookup rejects traversal and missing files", () => {
  assert.throws(() => service.managedPath({ backup_format: "full_data_excel", managed_relative_path: "../outside.xlsx" }), (error) => error.code === "BACKUP_PATH_INVALID");
  assert.throws(() => service.managedPath({ backup_format: "full_data_excel", managed_relative_path: "backups/full-excel/missing.xlsx" }), (error) => error.code === "BACKUP_FILE_MISSING");
});

test("failed publication leaves no staging directory or extra formal file", async () => {
  const date = new Date("2026-07-20T04:00:00Z");
  await assert.rejects(() => service.create({ trigger: "manual", createdAt: date }), (error) => error.code === "BACKUP_TARGET_EXISTS");
  const managed = path.join(dataDir, "backups", "full-excel"); assert.deepEqual(fs.readdirSync(managed).filter((name) => name.startsWith(".staging-")), []);
  assert.equal(fs.readdirSync(managed).filter((name) => name.endsWith(".xlsx")).length, 1);
});

test("metadata updates preserve the backup and support note and pin", () => {
  const updated = service.updateMetadata(created.record.id, { note: "人工核验", pinned: true }); assert.equal(updated.note, "人工核验"); assert.equal(updated.pinned, 1); assert.equal(service.verify(created.record.id).status, "success");
});
