const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, before, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { BackupService } = require("../src/backup/backup_service");
const { runDataPreflight } = require("../src/backup/data_preflight");
const { exportFullData, restoreFullData, verifyFullData } = require("../src/excel/full_backup");

const root = path.resolve(__dirname, "..");
let tempRoot;
let dataDir;
let dbPath;

function initDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const result = spawnSync(process.execPath, [path.join(root, "src", "server.js"), "--init-db"], {
    cwd: root,
    env: { ...process.env, DATA_DIR: path.dirname(filename), DB_PATH: filename },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

function insertOpening(db, values) {
  db.prepare(`INSERT INTO student_opening_balances(id,month_key,student_name,grade,opening_actual_balance,opening_gift_balance,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(values.id, values.month_key, values.student_name, values.grade, values.actual, values.gift, values.notes, values.created_at || "2026-07-20", values.created_at || "2026-07-20");
}

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-preflight-"));
  dataDir = path.join(tempRoot, "data");
  dbPath = path.join(dataDir, "synthetic.sqlite");
  initDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  insertOpening(db, { id: 9101, month_key: "", student_name: "缺月学生", grade: "初一", actual: 1000, gift: 200, notes: "从源Excel 2026年2月.xlsx 迁移" });
  insertOpening(db, { id: 9102, month_key: "2026-03-01", student_name: "正常学生", grade: "初二", actual: 300, gift: 0, notes: "合法记录" });
  db.close();
});

after(() => { if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true }); });

test("blank opening-balance month produces a stable actionable preflight error", () => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const result = runDataPreflight(db);
  db.close();
  const issue = result.issues.find((item) => item.code === "OPENING_BALANCE_MONTH_MISSING");
  assert.equal(result.ok, false);
  assert.equal(issue.count, 1);
  assert.deepEqual(issue.records[0], {
    record_id: 9101,
    student_name: "缺月学生",
    grade: "初一",
    actual_balance: 1000,
    gift_balance: 200,
    notes: "从源Excel 2026年2月.xlsx 迁移",
    month_key: "",
    suggested_month: "2026-02-01",
    suggestion_evidence: "原备注中的源Excel文件名",
    requires_confirmation: true,
  });
  assert.match(result.user_message, /缺月学生/);
  assert.match(result.user_message, /请先补充/);
});

test("preflight never substitutes current page, current date or created_at for a missing month", () => {
  const isolated = path.join(tempRoot, "no-inference.sqlite");
  initDatabase(isolated);
  const db = new DatabaseSync(isolated);
  insertOpening(db, { id: 9201, month_key: "", student_name: "人工确认学生", grade: "初三", actual: 1, gift: 0, notes: "旧账迁移", created_at: "2026-07-21" });
  const record = runDataPreflight(db).issues.find((item) => item.code === "OPENING_BALANCE_MONTH_MISSING").records[0];
  db.close();
  assert.equal(record.month_key, "");
  assert.equal(record.suggested_month, "");
  assert.equal(record.requires_confirmation, true);
});

test("failed manual backup records failure and leaves no Excel, sidecar or staging", async () => {
  const service = new BackupService({ dbPath, dataDir, appVersion: "preflight-test" });
  await assert.rejects(() => service.create({ trigger: "manual", createdAt: new Date("2026-07-21T01:00:00Z") }), (error) => error.code === "BACKUP_DATA_PREFLIGHT_FAILED");
  const managed = path.join(dataDir, "backups", "full-excel");
  const names = fs.existsSync(managed) ? fs.readdirSync(managed) : [];
  assert.deepEqual(names.filter((name) => name.endsWith(".xlsx") || name.endsWith(".sha256") || name.startsWith(".staging-")), []);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const failed = db.prepare("SELECT status,message FROM backup_records ORDER BY id DESC LIMIT 1").get();
  const valid = db.prepare("SELECT month_key FROM student_opening_balances WHERE id=9102").get();
  db.close();
  assert.equal(failed.status, "failed");
  assert.equal(failed.message, "BACKUP_DATA_PREFLIGHT_FAILED");
  assert.equal(valid.month_key, "2026-03-01");
});

test("automatic backup child fails safely without publishing files or crashing the parent process", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "excel_backup", "run_scheduled_backup.js"), "--scheduled-for", "2026-07-21", "--schedule-key", "full-data:2026-07-21"], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath, BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "", BACKUP_ENCRYPTION_KEY: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BACKUP_DATA_PREFLIGHT_FAILED/);
  const managed = path.join(dataDir, "backups", "full-excel");
  assert.deepEqual(fs.readdirSync(managed).filter((name) => name.endsWith(".xlsx") || name.endsWith(".sha256") || name.startsWith(".staging-")), []);
});

test("a confirmed persisted month is preserved in visible, hidden and restored data", () => {
  const validPath = path.join(tempRoot, "valid.sqlite");
  initDatabase(validPath);
  const db = new DatabaseSync(validPath);
  insertOpening(db, { id: 9301, month_key: "2026-02-01", student_name: "完整学生", grade: "高一", actual: 500, gift: 10, notes: "明确月份" });
  db.close();
  const output = path.join(tempRoot, "valid.xlsx");
  exportFullData({ dbPath: validPath, outputPath: output, createdAt: new Date("2026-07-21T02:00:00Z") });
  const verified = verifyFullData(output);
  const visible = verified.workbook.sheetMap.get("期初余额").rows[1][0];
  const hidden = verified.workbook.sheetMap.get("__关系映射").rows.find((row) => row[0] === "期初余额" && row[2] === "student_opening_balances" && row[4] === "month_key")[5];
  assert.equal(visible, "2026-02-01");
  assert.equal(hidden, "2026-02-01");
  assert.equal(verified.data.student_opening_balances[0].month_key, "2026-02-01");
  const restoredPath = path.join(tempRoot, "restored.sqlite");
  initDatabase(restoredPath);
  restoreFullData({ dbPath: restoredPath, inputPath: output });
  const restored = new DatabaseSync(restoredPath, { readOnly: true });
  assert.equal(restored.prepare("SELECT month_key FROM student_opening_balances WHERE id=9301").get().month_key, "2026-02-01");
  restored.close();
});
