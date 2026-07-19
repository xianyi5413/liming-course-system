const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, before, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { createWorkbook, parseWorkbook } = require("../src/excel/xlsx_codec");
const { exportFullData, verifyFullData, expectedSheetNames } = require("../src/excel/full_backup");
const { TEMPLATE_FILE_TYPE, TEMPLATE_FILENAME, TEMPLATE_GUIDE_SHEET, createTemplateBuffer, previewImport, importFullExcel, passwordHash } = require("../src/excel/import_service");

const root = path.resolve(__dirname, ".."); const serverScript = path.join(root, "src", "server.js");
let tempRoot; let sourcePath; let targetPath; let fullPath; let templatePath;
function initDatabase(dbPath) { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); const result = spawnSync(process.execPath, [serverScript, "--init-db"], { cwd: root, env: { ...process.env, DB_PATH: dbPath, DATA_DIR: path.dirname(dbPath) }, encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); }
function filledTemplate(fullBuffer) {
  const full = parseWorkbook(fullBuffer); const blank = parseWorkbook(createTemplateBuffer());
  const sheets = full.sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows.map((row) => [...row]) }));
  const info = sheets.find((sheet) => sheet.name === "导出说明"); info.rows.find((row) => row[0] === "file_type")[1] = TEMPLATE_FILE_TYPE;
  const auth = sheets.find((sheet) => sheet.name === "账号认证数据"); auth.rows[0][1] = "初始密码"; for (const row of auth.rows.slice(1)) row[1] = "TemplatePass123";
  const guide = blank.sheetMap.get(TEMPLATE_GUIDE_SHEET); sheets.push({ name: guide.name, rows: guide.rows });
  return createWorkbook(sheets);
}
function sheetMutation(buffer, mutate) { const parsed = parseWorkbook(buffer); const sheets = parsed.sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows.map((row) => [...row]) })); mutate(sheets); return createWorkbook(sheets); }

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-template-import-")); sourcePath = path.join(tempRoot, "source", "source.sqlite"); targetPath = path.join(tempRoot, "target", "target.sqlite"); fullPath = path.join(tempRoot, "full.xlsx"); templatePath = path.join(tempRoot, TEMPLATE_FILENAME);
  initDatabase(sourcePath); const db = new DatabaseSync(sourcePath); db.prepare("INSERT INTO students(id,name,grade,status) VALUES (9001,'模板学生','初一','在读')").run(); db.close(); exportFullData({ dbPath: sourcePath, outputPath: fullPath, appVersion: "test" }); fs.writeFileSync(templatePath, filledTemplate(fs.readFileSync(fullPath))); initDatabase(targetPath);
});
after(() => { if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true }); });

test("blank template has fixed worksheets plus filling guide", () => { const workbook = parseWorkbook(createTemplateBuffer()); assert.deepEqual(workbook.sheets.map((sheet) => sheet.name), [...expectedSheetNames(), TEMPLATE_GUIDE_SHEET]); });
test("blank template contains no business rows", () => { const workbook = parseWorkbook(createTemplateBuffer()); for (const name of expectedSheetNames().filter((item) => !["导出说明", "字段定义"].includes(item))) assert.equal(workbook.sheetMap.get(name).rows.length, 1, name); });
test("template authentication uses initial password instead of hash", () => { const rows = parseWorkbook(createTemplateBuffer()).sheetMap.get("账号认证数据").rows; assert.deepEqual(rows[0], ["用户ID", "初始密码"]); assert.equal(JSON.stringify(rows).includes("password_hash"), false); });
test("template examples contain no real account or secret", () => { const text = JSON.stringify(parseWorkbook(createTemplateBuffer()).sheetMap.get(TEMPLATE_GUIDE_SHEET).rows); assert.doesNotMatch(text, /access_token|client_secret|password_hash|138\d{8}/i); });
test("filled template preview validates all relationships", () => { const result = previewImport(templatePath); assert.equal(result.ok, true); assert.equal(result.kind, "template"); assert.equal(result.counts.students > 0, true); });
test("initial password is hashed immediately", () => { const hash = passwordHash("TemplatePass123", "00112233445566778899aabbccddeeff"); assert.match(hash, /^pbkdf2\$/); assert.equal(hash.includes("TemplatePass123"), false); });
test("schema-only system initialization import succeeds", () => { const result = importFullExcel({ dbPath: targetPath, inputPath: templatePath, mode: "initialize" }); assert.equal(result.ok, true); const db = new DatabaseSync(targetPath, { readOnly: true }); assert.equal(db.prepare("SELECT name FROM students WHERE id=9001").get().name, "模板学生"); assert.match(db.prepare("SELECT password_hash FROM users LIMIT 1").get().password_hash, /^pbkdf2\$/); db.close(); });
test("non-empty business database rejects initialization mode", () => { assert.throws(() => importFullExcel({ dbPath: targetPath, inputPath: templatePath, mode: "initialize" }), (error) => error.code === "FULL_EXCEL_INITIALIZE_TARGET_NOT_EMPTY"); });
test("overwrite mode creates and verifies a pre-import backup", () => { const dir = path.join(tempRoot, "pre backups"); const result = importFullExcel({ dbPath: targetPath, inputPath: templatePath, mode: "overwrite", preBackupDir: dir }); assert.equal(result.ok, true); assert.equal(verifyFullData(path.join(dir, result.pre_backup.filename)).ok, true); });
test("template with missing sheet is rejected", () => { const broken = path.join(tempRoot, "missing.xlsx"); fs.writeFileSync(broken, sheetMutation(fs.readFileSync(templatePath), (sheets) => sheets.splice(0, 1))); assert.throws(() => previewImport(broken), (error) => error.code === "FULL_EXCEL_TEMPLATE_SHEET_ORDER_INVALID"); });
test("template with renamed column is rejected", () => { const broken = path.join(tempRoot, "column.xlsx"); fs.writeFileSync(broken, sheetMutation(fs.readFileSync(templatePath), (sheets) => { sheets.find((sheet) => sheet.name === "学生档案").rows[0][0] = "错误列"; })); assert.throws(() => previewImport(broken), (error) => error.code === "FULL_EXCEL_COLUMNS_INVALID"); });
test("failed import leaves no normalized temporary file", () => { assert.throws(() => importFullExcel({ dbPath: targetPath, inputPath: path.join(tempRoot, "column.xlsx"), mode: "overwrite", preBackupDir: path.join(tempRoot, "pre2") })); assert.deepEqual(fs.readdirSync(tempRoot).filter((name) => name.startsWith(".normalized-")), []); });
