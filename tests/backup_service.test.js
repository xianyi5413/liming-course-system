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
  for (const name of ["backup_format", "format_version", "trigger", "managed_relative_path", "sha256", "remote_status", "remote_checksum_file_id", "remote_checksum_path", "remote_file_status", "remote_checksum_status", "remote_integrity_status", "deleted_at"]) assert.equal(columns.has(name), true, name);
});

test("manual backup atomically publishes a validated full Excel and checksum", () => {
  assert.equal(created.ok, true); assert.equal(created.record.status, "success"); assert.equal(created.record.backup_format, "full_data_excel");
  const filename = path.join(dataDir, created.record.managed_relative_path); assert.equal(fs.existsSync(filename), true); assert.equal(fs.existsSync(`${filename}.sha256`), true);
  const verified = verifyFullData(filename);
  assert.equal(verified.ok, true); assert.equal(verified.version, FORMAT_VERSION); assert.equal(created.record.format_version, FORMAT_VERSION);
  assert.deepEqual(verified.workbook.sheets.filter((sheet) => sheet.state === "visible").map((sheet) => sheet.name), expectedVisibleSheetNames());
  assert.deepEqual(verified.workbook.sheetMap.get("所有学生费用明细").rows[0], ["学生姓名", "授课老师", "日期", "星期", "时间", "教室", "状态", "年级", "科目", "备注", "单人费用"]);
  assert.deepEqual(verified.workbook.sheetMap.get("所有教师课时明细").rows[0], ["授课老师", "日期", "星期", "时间", "教室", "状态", "年级", "科目", "学生", "备注", "教师薪资"]);
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

test("manual and automatic backups record successful remote Excel and checksum pairs", async () => {
  const directory = path.join(tempRoot, "remote-success"); const database = path.join(directory, "data.sqlite"); initDatabase(database); const calls = [];
  const uploader = async ({ localPath }) => { calls.push(localPath); assert.equal(fs.existsSync(localPath), true); assert.equal(fs.existsSync(`${localPath}.sha256`), true); return { file_id: "excel-id", path: `/apps/liming/${path.basename(localPath)}`, checksum_file_id: "sha-id", checksum_path: `/apps/liming/${path.basename(localPath)}.sha256`, file_status: "success", checksum_status: "success", integrity_status: "verified" }; };
  const remoteService = new BackupService({ dbPath: database, dataDir: directory, remoteUploader: uploader });
  const manual = await remoteService.create({ trigger: "manual", remoteEnabled: true, createdAt: new Date("2026-07-22T01:00:00Z") });
  const automatic = await remoteService.create({ trigger: "automatic", remoteEnabled: true, scheduledDate: "2026-07-22", scheduleKey: "remote:2026-07-22", createdAt: new Date("2026-07-22T02:00:00Z") });
  for (const record of [manual.record, automatic.record]) assert.deepEqual({ overall: record.remote_status, excel: record.remote_file_status, checksum: record.remote_checksum_status, integrity: record.remote_integrity_status, checksumId: record.remote_checksum_file_id }, { overall: "success", excel: "success", checksum: "success", integrity: "verified", checksumId: "sha-id" });
  assert.equal(calls.length, 2);
});

test("remote download verification updates the persisted integrity fact", async () => {
  const directory = path.join(tempRoot, "remote-integrity"); const database = path.join(directory, "data.sqlite"); initDatabase(database);
  const remoteService = new BackupService({ dbPath: database, dataDir: directory });
  const record = (await remoteService.create({ trigger: "manual", createdAt: new Date("2026-07-22T02:30:00Z") })).record;
  const failed = remoteService.markRemoteIntegrity(record.id, "failed", "BAIDU_REMOTE_SHA256_MISMATCH");
  assert.deepEqual({ overall: failed.remote_status, integrity: failed.remote_integrity_status, error: failed.remote_error_safe }, { overall: "failed", integrity: "failed", error: "BAIDU_REMOTE_SHA256_MISMATCH" });
  const verified = remoteService.markRemoteIntegrity(record.id, "verified");
  assert.deepEqual({ overall: verified.remote_status, integrity: verified.remote_integrity_status, error: verified.remote_error_safe }, { overall: "failed", integrity: "verified", error: "" });
});

test("partial remote upload and partial pair deletion remain explicit", async () => {
  const directory = path.join(tempRoot, "remote-partial"); const database = path.join(directory, "data.sqlite"); initDatabase(database);
  const error = Object.assign(new Error("sidecar failed"), { code: "BAIDU_API_FAILED", details: { remote: { file_id: "excel-id", path: "/apps/liming/partial.xlsx", checksum_path: "/apps/liming/partial.xlsx.sha256", file_status: "success", checksum_status: "failed", integrity_status: "not_verified" } } });
  const remoteService = new BackupService({ dbPath: database, dataDir: directory, remoteUploader: async () => { throw error; } });
  const first = await remoteService.create({ trigger: "manual", remoteEnabled: true, createdAt: new Date("2026-07-22T03:00:00Z") });
  assert.deepEqual({ overall: first.record.remote_status, excel: first.record.remote_file_status, checksum: first.record.remote_checksum_status, integrity: first.record.remote_integrity_status }, { overall: "partial_failed", excel: "success", checksum: "failed", integrity: "not_verified" });
  assert.equal(fs.existsSync(path.join(directory, first.record.managed_relative_path)), true);
  await remoteService.create({ trigger: "manual", remoteEnabled: false, createdAt: new Date("2026-07-22T04:00:00Z") });
  const deleted = await remoteService.deleteBackup(first.record.id, { remoteDeleter: async () => ({ excel: "deleted", checksum: "delete_failed" }) });
  assert.deepEqual({ remote: deleted.result.remote, excel: deleted.result.remote_excel, checksum: deleted.result.remote_checksum }, { remote: "delete_partial", excel: "deleted", checksum: "delete_failed" });
  assert.equal(deleted.record.remote_status, "delete_partial");
});
