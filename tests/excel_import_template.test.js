const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, before, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { VISIBLE_SHEET_NAMES, HIDDEN_SHEET_NAMES } = require("../src/excel/field_definitions");
const { createWorkbook, parseWorkbook } = require("../src/excel/xlsx_codec");
const { verifyFullData } = require("../src/excel/full_backup");
const { TEMPLATE_FILE_TYPE, TEMPLATE_FILENAME, TEMPLATE_GUIDE_SHEET, createTemplateBuffer, previewImport, importFullExcel, passwordHash } = require("../src/excel/import_service");

const root = path.resolve(__dirname, ".."); const serverScript = path.join(root, "src", "server.js"); let tempRoot; let targetPath; let templatePath;
function initDatabase(dbPath) { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); const result = spawnSync(process.execPath, [serverScript, "--init-db"], { cwd: root, env: { ...process.env, DB_PATH: dbPath, DATA_DIR: path.dirname(dbPath) }, encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); }
function filledTemplate() {
  const parsed = parseWorkbook(createTemplateBuffer()); const sheets = parsed.sheets.map((sheet) => ({ name: sheet.name, state: sheet.state, rows: sheet.rows.map((row) => [...row]) })); const add = (name, row) => sheets.find((sheet) => sheet.name === name).rows.push(row);
  add("教师档案", ["模板教师", "13900000001", "在职", "2025-01-01", "", "教师备注"]);
  add("学生档案", ["模板学生", "初一", "2026-01-01", "2026-06-30", "2026-07-01", "2027-06-30", "", "", "", "", "", "", "", "", "", "模板家长", "13800000001", "在读", "2026-01-01", "", "学生备注"]);
  add("费用标准", ["初一", 1, 300, "初一-1", "1对1"]); add("所有学生单价", ["模板学生", "初一", "数学", "模板学生", 188.5, "自动", "规则"]);
  add("所有教师薪资规则", ["模板教师", "初一", "数学", "模板学生", 200, "已设置", "薪资规则"]); add("所有班级管理", ["模板教师", "初一", "数学", "模板学生", "模板班"]);
  add("所有课程数据", ["模板教师", "2026-04-08", "周三", "09:00-11:00", "A1", "已上", "初一", "数学", "模板学生", "课程"]);
  add("所有充值记录", ["2026年4月", "模板学生", "初一", 1000, 100, "2026-04-03", "充值"]); add("期初余额", ["模板学生", "初一", 100, 50, "期初"]);
  add("所有教师车费明细", ["2026-04-01", "模板教师", 1, "2026-04-01", "2026-04-07", 20, "车费"]);
  add("员工", ["模板员工", "教务", "月薪", 5000, 0, 26, "13700000001", "在职", "2025-01-01", "", "员工"]);
  add("所有员工薪资", ["2026-04-01", "模板员工", 5200, 300, 100, "工资"]); add("所有员工考勤", ["模板员工", "2026-04-02", "上班", 1, 8, "", "考勤"]); add("所有日常开销", ["2026-04-09", "办公", 88.8, "模板商家", "开销"]);
  add("系统设置", ["当前月份", "2026-04-01"]); add("基础数据", ["教室", "A1", "有效", 1]); add("基础数据", ["科目", "数学", "有效", 1]);
  add("操作日志", ["模板操作人", "template_user", "初始化", "初始化模板", "成功", "2026-04-10 10:00:00"]);
  add("角色管理", ["老板", "模板老板角色", "lessons；audit", "可编辑", "系统角色"]); add("账号管理", ["template_user", "模板账号", "老板", "模板教师", "lessons；audit", "启用", "TemplatePass123"]);
  return createWorkbook(sheets);
}
function mutate(buffer, fn) { const workbook = parseWorkbook(buffer); const sheets = workbook.sheets.map((sheet) => ({ name: sheet.name, state: sheet.state, rows: sheet.rows.map((row) => [...row]) })); fn(sheets); return createWorkbook(sheets); }

before(() => { tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-template-v3-")); targetPath = path.join(tempRoot, "target", "target.sqlite"); templatePath = path.join(tempRoot, TEMPLATE_FILENAME); initDatabase(targetPath); fs.writeFileSync(templatePath, filledTemplate()); });
after(() => { if (tempRoot && path.basename(tempRoot).startsWith("liming-template-v3-")) { try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {} } });

test("blank template has 22 visible sheets plus filling guide", () => assert.deepEqual(parseWorkbook(createTemplateBuffer()).sheets.map((sheet) => sheet.name), [...VISIBLE_SHEET_NAMES, TEMPLATE_GUIDE_SHEET]));
test("blank template contains no hidden recovery worksheets", () => assert.equal(parseWorkbook(createTemplateBuffer()).sheets.some((sheet) => HIDDEN_SHEET_NAMES.includes(sheet.name)), false));
test("every blank template worksheet is visible", () => assert.equal(parseWorkbook(createTemplateBuffer()).sheets.every((sheet) => sheet.state === "visible"), true));
test("blank template data worksheets contain only headers", () => { const workbook = parseWorkbook(createTemplateBuffer()); for (const name of VISIBLE_SHEET_NAMES.filter((item) => item !== "导出说明")) assert.equal(workbook.sheetMap.get(name).rows.length, 1, name); });
test("account template uses initial password and no password hash", () => { const headers = parseWorkbook(createTemplateBuffer()).sheetMap.get("账号管理").rows[0]; assert.equal(headers.at(-1), "初始密码"); assert.equal(JSON.stringify(headers).includes("password_hash"), false); });
test("template guide contains only synthetic examples", () => assert.doesNotMatch(JSON.stringify(parseWorkbook(createTemplateBuffer()).sheetMap.get(TEMPLATE_GUIDE_SHEET).rows), /pbkdf2\$|access_token|138\d{8}/i));
test("filled template preview succeeds", () => { const result = previewImport(templatePath); assert.equal(result.ok, true); assert.equal(result.kind, "template"); assert.equal(result.format_version, 3); });
test("filled template normalizes to the same 22 plus hidden full format", () => { const result = previewImport(templatePath); assert.equal(result.preview_counts["所有课程数据"], 1); assert.equal(result.preview_counts["学生档案"], 1); });
test("initial password hashing never returns plaintext", () => { const hash = passwordHash("TemplatePass123", "00112233445566778899aabbccddeeff"); assert.match(hash, /^pbkdf2\$/); assert.equal(hash.includes("TemplatePass123"), false); });
test("schema-only initialization import succeeds", () => { const result = importFullExcel({ dbPath: targetPath, inputPath: templatePath, mode: "initialize" }); assert.equal(result.ok, true); assert.equal(result.input_kind, "template"); });
test("template restores two grade stages from one student row", () => { const db = new DatabaseSync(targetPath, { readOnly: true }); const rows = db.prepare("SELECT stage,start_date,end_date FROM student_grade_stages ORDER BY start_date").all().map((row) => ({ ...row })); assert.deepEqual(rows, [{ stage: "初一", start_date: "2026-01-01", end_date: "2026-06-30" }, { stage: "初二", start_date: "2026-07-01", end_date: "2027-06-30" }]); db.close(); });
test("template restores role permissions from one role row", () => { const db = new DatabaseSync(targetPath, { readOnly: true }); assert.deepEqual(db.prepare("SELECT permission_key FROM role_permissions ORDER BY permission_key").all().map((row) => row.permission_key), ["audit", "lessons"]); db.close(); });
test("template restores account bindings and page permissions from one row", () => { const db = new DatabaseSync(targetPath, { readOnly: true }); const user = db.prepare("SELECT id FROM users WHERE username='template_user'").get(); assert.equal(db.prepare("SELECT teacher_name FROM user_teacher_bindings WHERE user_id=?").get(user.id).teacher_name, "模板教师"); assert.equal(db.prepare("SELECT COUNT(*) AS count FROM user_page_permissions WHERE user_id=?").get(user.id).count, 2); db.close(); });
test("template account password is immediately hashed", () => { const db = new DatabaseSync(targetPath, { readOnly: true }); const hash = db.prepare("SELECT password_hash FROM users WHERE username='template_user'").get().password_hash; assert.match(hash, /^pbkdf2\$/); assert.equal(hash.includes("TemplatePass123"), false); db.close(); });
test("template initialization restores core business rows", () => { const db = new DatabaseSync(targetPath, { readOnly: true }); assert.equal(db.prepare("SELECT COUNT(*) AS count FROM lessons").get().count, 1); assert.equal(db.prepare("SELECT COUNT(*) AS count FROM recharge_records").get().count, 1); assert.equal(db.prepare("SELECT COUNT(*) AS count FROM staff_attendance").get().count, 1); db.close(); });
test("initialization mode rejects a non-empty target", () => assert.throws(() => importFullExcel({ dbPath: targetPath, inputPath: templatePath, mode: "initialize" }), (error) => error.code === "FULL_EXCEL_INITIALIZE_TARGET_NOT_EMPTY"));
test("overwrite mode creates and validates a pre-import v3 backup", () => { const dir = path.join(tempRoot, "pre backups"); const result = importFullExcel({ dbPath: targetPath, inputPath: templatePath, mode: "overwrite", preBackupDir: dir }); assert.equal(result.ok, true); assert.equal(verifyFullData(path.join(dir, result.pre_backup.filename)).version, 3); });
test("template with a missing visible sheet is rejected", () => { const broken = path.join(tempRoot, "missing.xlsx"); fs.writeFileSync(broken, mutate(filledTemplate(), (sheets) => sheets.splice(1, 1))); assert.throws(() => previewImport(broken), (error) => error.code === "FULL_EXCEL_TEMPLATE_SHEET_ORDER_INVALID"); });
test("template with a renamed business column is rejected", () => { const broken = path.join(tempRoot, "column.xlsx"); fs.writeFileSync(broken, mutate(filledTemplate(), (sheets) => { sheets.find((sheet) => sheet.name === "学生档案").rows[0][0] = "错误列"; })); assert.throws(() => previewImport(broken), (error) => error.code === "FULL_EXCEL_COLUMNS_INVALID"); });
test("template with overlapping grade stages is rejected", () => { const broken = path.join(tempRoot, "overlap.xlsx"); fs.writeFileSync(broken, mutate(filledTemplate(), (sheets) => { const row = sheets.find((sheet) => sheet.name === "学生档案").rows[1]; row[3] = "2026-08-01"; row[4] = "2026-07-01"; })); assert.throws(() => previewImport(broken), (error) => error.code === "FULL_EXCEL_GRADE_TIMELINE_OVERLAP"); });
test("template current grade must have its matching stage when stage dates are supplied", () => { const broken = path.join(tempRoot, "grade-stage.xlsx"); fs.writeFileSync(broken, mutate(filledTemplate(), (sheets) => { const row = sheets.find((sheet) => sheet.name === "学生档案").rows[1]; row[1] = "高一"; })); assert.throws(() => previewImport(broken), (error) => error.code === "FULL_EXCEL_CURRENT_GRADE_STAGE_MISSING"); });
test("template rejects technical boolean text in a human price-status column", () => { const broken = path.join(tempRoot, "price-status.xlsx"); fs.writeFileSync(broken, mutate(filledTemplate(), (sheets) => { sheets.find((sheet) => sheet.name === "所有教师薪资规则").rows[1][5] = "1"; })); assert.throws(() => previewImport(broken), (error) => error.code === "FULL_EXCEL_ENUM_INVALID"); });
test("template with an internal hidden sheet is rejected", () => { const broken = path.join(tempRoot, "hidden.xlsx"); fs.writeFileSync(broken, mutate(filledTemplate(), (sheets) => sheets.push({ name: "__关系映射", state: "veryHidden", rows: [["x"]] }))); assert.throws(() => previewImport(broken), (error) => error.code === "FULL_EXCEL_TEMPLATE_SHEET_ORDER_INVALID"); });
test("failed import leaves no normalized temporary workbook", () => { const broken = path.join(tempRoot, "bad.xlsx"); fs.writeFileSync(broken, mutate(filledTemplate(), (sheets) => { const row = sheets.find((sheet) => sheet.name === "账号管理").rows[1]; row[row.length - 1] = "123"; })); assert.throws(() => importFullExcel({ dbPath: targetPath, inputPath: broken, mode: "overwrite", preBackupDir: path.join(tempRoot, "pre2") })); assert.deepEqual(fs.readdirSync(tempRoot).filter((name) => name.startsWith(".normalized-")), []); });
test("template filename advertises v3", () => assert.match(TEMPLATE_FILENAME, /_v3\.xlsx$/));
test("v2 template is rejected with an explicit re-export message", () => { const old = mutate(filledTemplate(), (sheets) => { const row = sheets.find((sheet) => sheet.name === "导出说明").rows.find((item) => item[0] === "格式版本"); row[1] = 2; }); assert.throws(() => previewImport(old), (error) => error.code === "FULL_EXCEL_FORMAT_INVALID" && /v3/.test(error.message)); });
test("template file type remains distinct from full backup", () => assert.equal(TEMPLATE_FILE_TYPE, "liming_full_data_template"));
