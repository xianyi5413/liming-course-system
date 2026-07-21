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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-preflight-v4-"));
  const dataDir = path.join(tempRoot, "data");
  const dbPath = path.join(dataDir, "synthetic.sqlite");
  fs.mkdirSync(dataDir, { recursive: true });
  const initialized = spawnSync(process.execPath, [path.join(root, "src", "server.js"), "--init-db"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath }, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  try { return await action({ tempRoot, dataDir, dbPath }); }
  finally { try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }
}

function insertOpening(db, id, student) {
  db.prepare(`INSERT INTO student_opening_balances(id,student_name,grade,opening_actual_balance,opening_gift_balance,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, student, "初一", 1000, 200, "全局期初记录", "2026-07-20", "2026-07-20");
}

test("global opening balance passes preflight without any month field", () => withDatabase(({ dbPath }) => {
  const db = new DatabaseSync(dbPath); insertOpening(db, 9101, "全局余额学生");
  const result = runDataPreflight(db);
  assert.equal(result.ok, true);
  assert.equal(result.issues.some((issue) => /OPENING_BALANCE/.test(issue.code)), false);
  assert.equal(db.prepare("PRAGMA table_info(student_opening_balances)").all().some((column) => column.name === "month_key"), false);
  db.close();
}));

test("global opening balance stays month-free through full Excel round-trip", () => withDatabase(({ tempRoot, dbPath }) => {
  const db = new DatabaseSync(dbPath); insertOpening(db, 9201, "全局余额学生"); db.close();
  const workbook = path.join(tempRoot, "global-opening.xlsx");
  exportFullData({ dbPath, outputPath: workbook, createdAt: new Date("2026-07-21T02:00:00Z") });
  const verified = verifyFullData(workbook);
  assert.deepEqual(verified.workbook.sheetMap.get("期初余额").rows[0], ["学生姓名", "年级", "期初实际余额", "期初赠送余额", "备注"]);
  assert.equal(Object.prototype.hasOwnProperty.call(verified.data.student_opening_balances[0], "month_key"), false);
  const restoredPath = path.join(tempRoot, "restored.sqlite");
  const initialized = spawnSync(process.execPath, [path.join(root, "src", "server.js"), "--init-db"], { cwd: root, env: { ...process.env, DATA_DIR: path.dirname(restoredPath), DB_PATH: restoredPath }, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  restoreFullData({ dbPath: restoredPath, inputPath: workbook });
  const restored = new DatabaseSync(restoredPath, { readOnly: true });
  assert.equal(restored.prepare("SELECT student_name FROM student_opening_balances WHERE id=9201").get().student_name, "全局余额学生");
  assert.equal(restored.prepare("PRAGMA table_info(student_opening_balances)").all().some((column) => column.name === "month_key"), false); restored.close();
}));

test("manual and scheduled backups accept a global opening balance", async () => withDatabase(async ({ dataDir, dbPath }) => {
  const db = new DatabaseSync(dbPath); insertOpening(db, 9301, "备份学生"); db.close();
  const service = new BackupService({ dbPath, dataDir, appVersion: "preflight-v4-test" });
  const manual = await service.create({ trigger: "manual", createdAt: new Date("2026-07-21T01:00:00Z") });
  assert.equal(manual.record.status, "success");
  const scheduled = spawnSync(process.execPath, [path.join(root, "scripts", "excel_backup", "run_scheduled_backup.js"), "--scheduled-for", "2026-07-22", "--schedule-key", "full-data:2026-07-22"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath, BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "" }, encoding: "utf8" });
  assert.equal(scheduled.status, 0, scheduled.stderr);
}));

test("database unique constraint rejects a second opening balance for the same student", () => withDatabase(({ dbPath }) => {
  const db = new DatabaseSync(dbPath); insertOpening(db, 9401, "唯一学生");
  assert.throws(() => insertOpening(db, 9402, "唯一学生"), /UNIQUE constraint failed/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM student_opening_balances WHERE student_name='唯一学生'").get().count, 1);
  db.close();
}));
