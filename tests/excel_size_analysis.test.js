const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const { exportFullData, restoreFullData, verifyFullData } = require("../src/excel/full_backup");
const { readZip } = require("../src/excel/xlsx_codec");

const root = path.resolve(__dirname, "..");
let tempRoot; let source; let target; let withLogs; let withoutLogs;

function init(dbPath) {
  const result = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], { cwd: root, env: { ...process.env, DATA_DIR: path.dirname(dbPath), DB_PATH: dbPath }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-excel-size-")); source = path.join(tempRoot, "source.sqlite"); target = path.join(tempRoot, "target.sqlite"); withLogs = path.join(tempRoot, "with.xlsx"); withoutLogs = path.join(tempRoot, "without.xlsx");
  init(source); init(target);
  const db = new DatabaseSync(source); const insert = db.prepare("INSERT INTO operation_logs(operator_name,operator_account,operation_type,operation_content,target_type,target_id,result_status,created_at,extra_json) VALUES ('合成人员','synthetic','合成测试',?,'test','1','success','2026-07-24 12:00:00',?)");
  db.exec("BEGIN"); for (let index = 0; index < 800; index += 1) insert.run(`合成操作 ${index} ${"说明".repeat(40)}`, JSON.stringify({ synthetic: true, index, repeated: "value".repeat(30) })); db.exec("COMMIT"); db.close();
  exportFullData({ dbPath: source, outputPath: withLogs, appVersion: "test", includeOperationLogs: true });
  exportFullData({ dbPath: source, outputPath: withoutLogs, appVersion: "test", includeOperationLogs: false });
});
after(() => { if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

test("XLSX entries use Deflate and stay far below their expanded XML", () => {
  const bytes = fs.readFileSync(withLogs); const entries = readZip(bytes); const expanded = [...entries.values()].reduce((sum, value) => sum + value.length, 0);
  assert.ok(bytes.length < expanded * 0.35, `${bytes.length}/${expanded}`);
  assert.equal(bytes.readUInt16LE(8), 8);
});

test("operation logs remain configurable and their size impact is measurable", () => {
  const included = verifyFullData(withLogs); const excluded = verifyFullData(withoutLogs);
  assert.equal(included.operation_logs_included, true); assert.equal(excluded.operation_logs_included, false);
  assert.ok(fs.statSync(withLogs).size > fs.statSync(withoutLogs).size);
  assert.equal(excluded.data.operation_logs.length, 0);
});

test("whole-column amount styles are absent while cell number styles remain", () => {
  const verified = verifyFullData(withLogs); const xml = verified.workbook.sheetMap.get("所有学生费用明细").xml;
  assert.doesNotMatch(xml, /<col\b[^>]*style="2"/);
  assert.match(verified.workbook.entries.get("xl/styles.xml").toString("utf8"), /numFmtId="4"/);
});

test("optimized workbook restores completely and can be verified again", () => {
  restoreFullData({ inputPath: withLogs, dbPath: target, mode: "overwrite" });
  const restored = path.join(tempRoot, "restored.xlsx"); exportFullData({ dbPath: target, outputPath: restored, appVersion: "test", includeOperationLogs: true });
  const first = verifyFullData(withLogs); const second = verifyFullData(restored);
  for (const table of ["lessons", "recharge_records", "student_grade_stages", "teacher_salary_rules", "operation_logs"]) assert.equal(second.data[table].length, first.data[table].length, table);
});
