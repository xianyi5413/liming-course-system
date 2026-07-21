const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { BackupService } = require("../src/backup/backup_service");
const { runDataPreflight } = require("../src/backup/data_preflight");
const { exportFullData, restoreFullData, verifyFullData } = require("../src/excel/full_backup");

const root = path.resolve(__dirname, "..");

async function withDatabase(action) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-preflight-v3-"));
  const dataDir = path.join(tempRoot, "data");
  const dbPath = path.join(dataDir, "synthetic.sqlite");
  fs.mkdirSync(dataDir, { recursive: true });
  const initialized = spawnSync(process.execPath, [path.join(root, "src", "server.js"), "--init-db"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath }, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  try { return await action({ tempRoot, dataDir, dbPath }); }
  finally { try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }
}

function insertOpening(db, id, student, month = "") {
  db.prepare(`INSERT INTO student_opening_balances(id,month_key,student_name,grade,opening_actual_balance,opening_gift_balance,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, month, student, "初一", 1000, 200, "历史兼容记录", "2026-07-20", "2026-07-20");
}

test("blank legacy opening-balance month is accepted without inference or mutation", () => withDatabase(({ dbPath }) => {
  const db = new DatabaseSync(dbPath); insertOpening(db, 9101, "空月份学生");
  const result = runDataPreflight(db);
  assert.equal(result.ok, true);
  assert.equal(result.issues.some((issue) => /OPENING_BALANCE_MONTH/.test(issue.code)), false);
  assert.equal(db.prepare("SELECT month_key FROM student_opening_balances WHERE id=9101").get().month_key, "");
  db.close();
}));

test("blank technical month stays hidden and round-trips exactly", () => withDatabase(({ tempRoot, dbPath }) => {
  const db = new DatabaseSync(dbPath); insertOpening(db, 9201, "全局余额学生"); db.close();
  const workbook = path.join(tempRoot, "global-opening.xlsx");
  exportFullData({ dbPath, outputPath: workbook, createdAt: new Date("2026-07-21T02:00:00Z") });
  const verified = verifyFullData(workbook);
  assert.deepEqual(verified.workbook.sheetMap.get("期初余额").rows[0], ["学生姓名", "年级", "期初实际余额", "期初赠送余额", "备注"]);
  assert.equal(verified.data.student_opening_balances[0].month_key, "");
  const restoredPath = path.join(tempRoot, "restored.sqlite");
  const initialized = spawnSync(process.execPath, [path.join(root, "src", "server.js"), "--init-db"], { cwd: root, env: { ...process.env, DATA_DIR: path.dirname(restoredPath), DB_PATH: restoredPath }, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  restoreFullData({ dbPath: restoredPath, inputPath: workbook });
  const restored = new DatabaseSync(restoredPath, { readOnly: true });
  assert.equal(restored.prepare("SELECT month_key FROM student_opening_balances WHERE id=9201").get().month_key, ""); restored.close();
}));

test("manual and scheduled backups accept a blank legacy month", async () => withDatabase(async ({ dataDir, dbPath }) => {
  const db = new DatabaseSync(dbPath); insertOpening(db, 9301, "备份学生"); db.close();
  const service = new BackupService({ dbPath, dataDir, appVersion: "preflight-v3-test" });
  const manual = await service.create({ trigger: "manual", createdAt: new Date("2026-07-21T01:00:00Z") });
  assert.equal(manual.record.status, "success");
  const scheduled = spawnSync(process.execPath, [path.join(root, "scripts", "excel_backup", "run_scheduled_backup.js"), "--scheduled-for", "2026-07-22", "--schedule-key", "full-data:2026-07-22"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath, BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "", BACKUP_ENCRYPTION_KEY: "" }, encoding: "utf8" });
  assert.equal(scheduled.status, 0, scheduled.stderr);
}));

test("duplicate opening balances for one student fail with a stable conflict", () => withDatabase(({ dbPath }) => {
  const db = new DatabaseSync(dbPath); insertOpening(db, 9401, "重复学生", ""); insertOpening(db, 9402, "重复学生", "2026-03-01");
  const result = runDataPreflight(db); db.close();
  const issue = result.issues.find((item) => item.code === "OPENING_BALANCE_STUDENT_DUPLICATE");
  assert.equal(result.ok, false); assert.equal(issue.count, 1); assert.equal(issue.records[0].student_name, "重复学生"); assert.equal(issue.records[0].duplicate_count, 2);
  assert.match(result.user_message, /每名学生唯一的权威记录/);
}));

test("duplicate conflict publishes no managed workbook or sidecar", async () => withDatabase(async ({ dataDir, dbPath }) => {
  const db = new DatabaseSync(dbPath); insertOpening(db, 9501, "冲突学生", ""); insertOpening(db, 9502, "冲突学生", "2026-03-01"); db.close();
  const service = new BackupService({ dbPath, dataDir, appVersion: "preflight-v3-test" });
  await assert.rejects(() => service.create({ trigger: "manual", createdAt: new Date("2026-07-21T03:00:00Z") }), (error) => error.code === "BACKUP_DATA_PREFLIGHT_FAILED");
  const managed = path.join(dataDir, "backups", "full-excel");
  const names = fs.existsSync(managed) ? fs.readdirSync(managed) : [];
  assert.deepEqual(names.filter((name) => name.endsWith(".xlsx") || name.endsWith(".sha256") || name.startsWith(".staging-")), []);
}));
