const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { after, before, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { VISIBLE_SHEET_DEFINITIONS, VISIBLE_SHEET_NAMES, HIDDEN_SHEET_NAMES, SOURCE_TABLE_DEFINITIONS, EXCLUDED_TABLES } = require("../src/excel/field_definitions");
const { createWorkbook, parseWorkbook, readZip, zipStore, validateWorkbookStructure, MAX_CELL_TEXT_LENGTH } = require("../src/excel/xlsx_codec");
const { BACKUP_FORMAT, FORMAT_VERSION, exportFullData, verifyFullData, restoreFullData, expectedSheetNames, SETTING_LABELS } = require("../src/excel/full_backup");

const root = path.resolve(__dirname, ".."); const serverScript = path.join(root, "src", "server.js");
let tempRoot; let sourcePath; let targetPath; let backupPath; let verified; let sourceSnapshot; let longJson; let longContent;

function passwordHash(password, salt = "00112233445566778899aabbccddeeff") { return `pbkdf2$${salt}$${crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex")}`; }
function initDatabase(dbPath) { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); const result = spawnSync(process.execPath, [serverScript, "--init-db"], { cwd: root, env: { ...process.env, DATA_DIR: path.dirname(dbPath), DB_PATH: dbPath }, encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); }
function emptyManagedData(dbPath) { const db = new DatabaseSync(dbPath); db.exec("PRAGMA foreign_keys=OFF"); for (const definition of [...SOURCE_TABLE_DEFINITIONS].sort((a, b) => b.restore_order - a.restore_order)) db.exec(`DELETE FROM ${definition.source_table}`); db.exec("PRAGMA foreign_keys=ON"); db.close(); }
function seedCompleteData(db) {
  db.exec(`
    INSERT INTO settings(key,value) VALUES ('custom_course_statuses','["调课"]') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
    INSERT INTO settings(key,value) VALUES ('baidu_access_token','must-not-export');
    INSERT INTO teachers(id,name,phone,notes,status,joined_at,left_at) VALUES (101,'恢复教师','13900000000','教师备注','在职','2025-01-01','');
    INSERT INTO students(id,name,grade,phone,guardian,notes,status,joined_at,left_at) VALUES (201,'恢复学生','初二','13800000000','恢复家长','学生备注','在读','2025-09-01','');
    INSERT INTO student_grade_stages(id,student_name,stage,start_date,end_date,created_at,updated_at) VALUES (301,'恢复学生','初二','2025-09-01','2026-06-30','2025-09-01 08:00:00','2026-04-01 08:00:00');
    INSERT INTO student_grade_stages(id,student_name,stage,start_date,end_date,created_at,updated_at) VALUES (302,'恢复学生','初三','2026-07-01','','2026-07-01 08:00:00','2026-07-01 08:00:00');
    INSERT INTO student_pricing(id,student_name,grade,subject,student_names,custom_price,notes) VALUES (401,'恢复学生','初二','数学','恢复学生',188.5,'单价备注');
    INSERT INTO teacher_salary_rules(id,teacher_name,grade,subject,student_names,salary_per_unit,unit_hours,is_active,notes,created_at,updated_at) VALUES (501,'恢复教师','初二','数学','恢复学生',220.5,2,1,'薪资规则','2026-01-01','2026-04-01');
    INSERT INTO class_groups(id,teacher,grade,subject,students_key,students_display,class_name,created_at,updated_at) VALUES (601,'恢复教师','初二','数学','恢复学生','恢复学生','恢复班级','2026-01-01','2026-04-01');
    INSERT INTO lessons(id,teacher_name,date,lesson_status,time_slot,classroom,grade,subject,student_names,notes,course_status,status,teacher_salary,teacher_salary_source,teacher_salary_rule_id,month_key,sort_order,created_at,updated_at) VALUES (701,'恢复教师','2026-04-08','上课','09:00-11:00','A1','初二','数学','恢复学生','=公式文本😀','未上','调课',220.5,'rule',501,'2026-04-01',7,'2026-04-01 08:00:00','2026-04-08 12:00:00');
    INSERT INTO fee_overrides(lesson_id,student_name,unit_price,updated_at) VALUES (701,'恢复学生',199.5,'2026-04-08 12:01:00');
    INSERT INTO recharge_records(id,student_name,grade,prev_actual,prev_gift,cur_recharge,cur_gift,recharge_date,notes,source,month_key) VALUES (801,'恢复学生','初二',100,50,2000,200,'2026-04-03','充值备注','manual','2026-04-01');
    INSERT INTO student_opening_balances(id,month_key,student_name,grade,opening_actual_balance,opening_gift_balance,notes,created_at,updated_at) VALUES (901,'2026-04-01','恢复学生','初二',100,50,'期初备注','2026-03-31','2026-04-01');
    INSERT INTO teacher_adjustments(teacher_name,week1_transport,week2_transport,week3_transport,week4_transport,notes) VALUES ('恢复教师',10,20,30,40,'兼容数据');
    INSERT INTO teacher_adjustments_monthly(teacher_name,month_key,week1_transport,week2_transport,week3_transport,week4_transport,notes) VALUES ('恢复教师','2026-04-01',10,20,30,40,'月度调整');
    INSERT INTO teacher_travel_fees(id,month_key,teacher_name,week_index,week_start,week_end,amount,notes,created_at,updated_at) VALUES (1001,'2026-04-01','恢复教师',1,'2026-04-01','2026-04-07',10,'车费','2026-04-07','2026-04-07');
    INSERT INTO staff(id,name,role,base_salary,pay_type,daily_rate,standard_work_days,phone,status,joined_at,left_at,notes) VALUES (1101,'恢复员工','教务主管',5000,'月薪',0,26,'13700000000','在职','2025-01-01','','员工备注');
    INSERT INTO staff_salary_monthly(id,staff_id,month_key,salary_actual,bonus,deduction,notes) VALUES (1201,1101,'2026-04-01',5200,300,100,'工资备注');
    INSERT INTO staff_attendance(id,staff_id,attendance_date,month_key,status,pay_units,hours,reason,notes,updated_at) VALUES (1301,1101,'2026-04-02','2026-04-01','上班',1,8,'','考勤备注','2026-04-02 18:00:00');
    INSERT INTO operating_expenses(id,category,expense_date,amount,vendor,notes,month_key) VALUES (1401,'办公','2026-04-09',88.8,'恢复商家','开销备注','2026-04-01');
    INSERT INTO users(id,username,display_name,role,teacher_name,readonly_override,permission_override_enabled,password_hash,status,created_at,updated_at) VALUES (2001,'restore_user','恢复账号','academic','恢复教师',NULL,1,'${passwordHash("restore-pass")}', 'active','2026-04-01','2026-04-01');
    INSERT INTO user_teacher_bindings(id,user_id,teacher_name,created_at) VALUES (2101,2001,'恢复教师','2026-04-01');
    INSERT INTO user_page_permissions(user_id,permission_key,enabled,created_at,updated_at) VALUES (2001,'lessons',1,'2026-04-01','2026-04-01');
    INSERT INTO user_filter_presets(user_id,view_key,filter_key,filter_value_json,created_at,updated_at) VALUES (2001,'lessons','teacher_names','["恢复教师"]','2026-04-01','2026-04-01');
    INSERT INTO role_filter_presets(id,role_code,view_key,filter_key,filter_value_json,created_at,updated_at) VALUES (2201,'academic','lessons','status','"调课"','2026-04-01','2026-04-01');
    INSERT INTO backup_records(id,backup_type,included_months,filename,file_path,file_size,status,message) VALUES (2301,'manual',1,'legacy.zip','/sensitive/server/path/legacy.zip',123,'success','不应导出');
  `);
  longJson = JSON.stringify({ before: "😀".repeat(17000), nested: { safe: true } }); longContent = `修改说明：${"长文本😀".repeat(6500)}`;
  db.prepare("INSERT INTO operation_logs(id,campus_name,operator_name,operator_account,operation_type,operation_content,target_type,target_id,result_status,client_ip,user_agent,created_at,extra_json) VALUES (1901,'黎明教育','Qing','boss','测试操作',?,'lesson','701','success','127.0.0.1','test-agent','2026-04-10',?)").run(longContent, longJson);
  db.prepare("INSERT INTO audit_events(id,actor_user_id,actor_username,actor_role,action,entity_type,entity_id,before_json,after_json,ip,user_agent,created_at) VALUES (1601,1,'boss','owner','update','lesson','701','{}',?,'127.0.0.1','test-agent','2026-04-10')").run("x".repeat(32767));
}
function snapshot(db) {
  return Object.fromEntries(SOURCE_TABLE_DEFINITIONS.map(({ source_table: table }) => {
    let rows = db.prepare(`SELECT * FROM ${table}`).all(); if (table === "settings") rows = rows.filter((row) => SETTING_LABELS[row.key]); if (table === "operation_logs") rows = rows.map((row) => ({ ...row, client_ip: "", user_agent: "" }));
    return [table, rows.map((row) => JSON.stringify(row)).sort()];
  }));
}
function rebuiltWorkbook(mutator) { const parsed = parseWorkbook(fs.readFileSync(backupPath)); const sheets = parsed.sheets.map((sheet) => ({ name: sheet.name, state: sheet.state, rows: sheet.rows.map((row) => [...row]) })); mutator(sheets); return createWorkbook(sheets); }
function legacyUnsafeWorkbook() { const safe = createWorkbook(Array.from({ length: 33 }, (_, index) => ({ name: index === 32 ? "审计事件" : `旧表${index + 1}`, rows: [["字段"], ["ok"]] }))); const entries = readZip(safe); entries.set("xl/worksheets/sheet33.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="G1" t="inlineStr"><is><t>操作后JSON</t></is></c></row><row r="2"><c r="G2" t="inlineStr"><is><t>${"x".repeat(32767)}</t></is></c></row></sheetData></worksheet>`)); return zipStore([...entries].map(([name, data]) => ({ name, data }))); }
async function freePort() { return await new Promise((resolve) => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-full-excel-v2-")); sourcePath = path.join(tempRoot, "source A", "source.sqlite"); targetPath = path.join(tempRoot, "target B", "target.sqlite"); backupPath = path.join(tempRoot, "output with space", "黎明教育_全量数据_20260720_150000.xlsx");
  initDatabase(sourcePath); const source = new DatabaseSync(sourcePath); seedCompleteData(source); sourceSnapshot = snapshot(source); source.close(); initDatabase(targetPath); emptyManagedData(targetPath); exportFullData({ dbPath: sourcePath, outputPath: backupPath, appVersion: "test-version", createdAt: new Date("2026-07-20T07:00:00Z") }); verified = verifyFullData(backupPath);
});
after(() => { if (tempRoot && path.basename(tempRoot).startsWith("liming-full-excel-v2-")) { try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {} } });

test("legacy corruption sample reproduces sheet33 audit G2 at 32767 UTF-16 units", () => { const parsed = parseWorkbook(legacyUnsafeWorkbook()); assert.equal(parsed.sheets[32].name, "审计事件"); assert.equal(parsed.sheets[32].rows[1][6].length, 32767); });
test("structural validator rejects the legacy 32767-cell workbook", () => assert.throws(() => validateWorkbookStructure(legacyUnsafeWorkbook()), (error) => error.code === "XLSX_CELL_TEXT_TOO_LONG"));
test("writer rejects any unchunked cell above the 30000 limit", () => assert.throws(() => createWorkbook([{ name: "超长", rows: [["值"], ["x".repeat(30001)]] }]), (error) => error.code === "XLSX_CELL_TEXT_TOO_LONG"));
test("full export uses v2", () => { assert.equal(verified.format, BACKUP_FORMAT); assert.equal(verified.version, FORMAT_VERSION); assert.equal(FORMAT_VERSION, 2); });
test("visible workbook has exactly 22 business sheets", () => assert.deepEqual(verified.workbook.sheets.filter((sheet) => sheet.state === "visible").map((sheet) => sheet.name), VISIBLE_SHEET_NAMES));
test("visible sheet order is the approved order", () => assert.deepEqual(VISIBLE_SHEET_NAMES, ["导出说明", "所有课程数据", "所有学生费用明细", "所有充值记录", "期初余额", "所有学生单价", "所有班级管理", "学生档案", "所有教师车费明细", "所有教师课时明细", "所有教师薪资规则", "教师档案", "员工", "所有员工薪资", "所有员工考勤", "所有日常开销", "系统设置", "基础数据", "费用标准", "操作日志", "角色管理", "账号管理"]));
test("full workbook has the exact visible and hidden sequence", () => assert.deepEqual(verified.workbook.sheets.map((sheet) => sheet.name), expectedSheetNames()));
test("four internal recovery sheets are veryHidden", () => { assert.deepEqual(verified.workbook.sheets.filter((sheet) => sheet.state === "veryHidden").map((sheet) => sheet.name), HIDDEN_SHEET_NAMES); });
test("removed technical sheets are not visible", () => { const removed = ["审计事件", "数据检查记录", "数据检查忽略项", "字段定义", "教师调整兼容数据", "账号认证数据", "角色筛选预设", "账号筛选预设", "课程通知完成记录", "家长群问候记录"]; assert.equal(removed.some((name) => verified.workbook.sheetMap.has(name)), false); });
test("course columns are exactly the ten page fields", () => assert.deepEqual(verified.workbook.sheetMap.get("所有课程数据").rows[0], ["授课老师", "日期", "星期", "时间", "教室", "状态", "年级", "科目", "学生", "备注"]));
test("course sheet has no salary IDs timestamps or raw status fields", () => assert.doesNotMatch(verified.workbook.sheetMap.get("所有课程数据").rows[0].join("|"), /薪资|ID|创建|更新|lesson_status|course_status|月份|排序/));
test("student fee details contain no fee or restore-source columns", () => assert.deepEqual(verified.workbook.sheetMap.get("所有学生费用明细").rows[0], ["学生姓名", "授课老师", "日期", "状态", "星期", "时间", "教室", "年级", "科目", "备注"]));
test("recharge sheet contains no source or technical ID", () => assert.deepEqual(verified.workbook.sheetMap.get("所有充值记录").rows[0], ["学生姓名", "年级", "本月实际充值", "本月赠送充值", "充值日期", "备注"]));
test("opening balances use the six approved business columns", () => assert.deepEqual(verified.workbook.sheetMap.get("期初余额").rows[0], ["月份", "学生姓名", "年级", "期初实际余额", "期初赠送余额", "备注"]));
test("class management does not expose students_key", () => assert.deepEqual(verified.workbook.sheetMap.get("所有班级管理").rows[0], ["老师", "年级", "科目", "学生集合", "班级名"]));
test("teacher lesson detail is reference-only without restore flags", () => assert.deepEqual(verified.workbook.sheetMap.get("所有教师课时明细").rows[0], ["授课老师", "日期", "状态", "星期", "时间", "教室", "年级", "科目", "学生", "备注"]));
test("operation log only exposes current page fields", () => assert.deepEqual(verified.workbook.sheetMap.get("操作日志").rows[0], ["操作人", "操作账号", "操作类型", "操作内容", "结果", "操作时间"]));
test("operation log visible sheet contains no raw JSON IP or User-Agent", () => assert.doesNotMatch(JSON.stringify(verified.workbook.sheetMap.get("操作日志").rows), /extra_json|before_json|after_json|127\.0\.0\.1|test-agent|User-Agent|客户端IP/));
test("long operation content and JSON are chunked and fully reassembled", () => { const row = verified.data.operation_logs.find((item) => item.id === 1901); assert.equal(row.operation_content, longContent); assert.equal(row.extra_json, longJson); assert.ok(verified.workbook.sheetMap.get("__长文本分片").rows.length > 3); });
test("long text chunks never split surrogate pairs", () => { for (const row of verified.workbook.sheetMap.get("__长文本分片").rows.slice(1)) { assert.equal(/^[\uDC00-\uDFFF]/.test(row[5]), false); assert.equal(/[\uD800-\uDBFF]$/.test(row[5]), false); } });
test("every string cell is at most 30000 UTF-16 units", () => assert.ok(verified.structure.max_cell_text_length <= MAX_CELL_TEXT_LENGTH));
test("every generated OOXML part parses structurally", () => assert.ok(verified.structure.xml_file_count >= verified.workbook.sheets.length + 5));
test("workbook contains no formulas macros or external links", () => assert.deepEqual({ formulas: verified.structure.formulas, macros: verified.structure.macros, external: verified.structure.external_links }, { formulas: 0, macros: 0, external: 0 }));
test("formula-like note remains literal text", () => { const sheet = verified.workbook.sheetMap.get("所有课程数据"); assert.equal(sheet.rows[1][9], "=公式文本😀"); assert.doesNotMatch(sheet.xml, /<f\b/i); });
test("Unicode emoji survives export and verification", () => assert.equal(verified.data.lessons.find((row) => row.id === 701).notes, "=公式文本😀"));
test("visible business headers do not contain database snake_case", () => { for (const sheet of verified.workbook.sheets.filter((item) => item.state === "visible" && item.name !== "导出说明")) assert.equal(sheet.rows[0].some((value) => /[a-z]+_[a-z]+/.test(String(value))), false, sheet.name); });
test("student grade stages are merged into one visible student row", () => { const sheet = verified.workbook.sheetMap.get("学生档案"); assert.equal(sheet.rows.length, 2); assert.equal(sheet.rows[1][2], "初二：2025-09-01至2026-06-30；初三：2026-07-01至"); });
test("role permissions are serialized on one role row", () => { const sheet = verified.workbook.sheetMap.get("角色管理"); assert.equal(sheet.rows[0].join("|"), "角色名称|角色说明|页面权限|操作权限|状态"); assert.match(sheet.rows.find((row) => row[0] === "教务")[2], /lessons/); });
test("account bindings and page permissions are serialized on one account row", () => { const row = verified.workbook.sheetMap.get("账号管理").rows.find((item) => item[0] === "restore_user"); assert.equal(row[3], "恢复教师"); assert.equal(row[4], "lessons"); });
test("password hashes exist only in veryHidden authentication data", () => { const auth = verified.workbook.sheetMap.get("__账号认证数据"); assert.ok(auth.rows.some((row) => String(row[1]).startsWith("pbkdf2$"))); for (const sheet of verified.workbook.sheets.filter((item) => item.state === "visible")) assert.equal(JSON.stringify(sheet.rows).includes("pbkdf2$"), false); });
test("secret settings server paths and backup_records are excluded", () => { const textValue = JSON.stringify(verified.workbook.sheets.map((sheet) => sheet.rows)); assert.doesNotMatch(textValue, /must-not-export|sensitive\/server\/path|baidu_access_token/); assert.ok(EXCLUDED_TABLES.some((item) => item.table === "backup_records")); });
test("metadata sheet validates every sheet digest", () => assert.equal(verified.workbook.sheetMap.get("__恢复元数据").state, "veryHidden"));
test("tampered hidden mapping is rejected by digest validation", () => { const broken = rebuiltWorkbook((sheets) => { const mapping = sheets.find((sheet) => sheet.name === "__关系映射"); mapping.rows[1][5] = "tampered"; }); assert.throws(() => verifyFullData(broken), (error) => ["FULL_EXCEL_SHEET_DIGEST_INVALID", "FULL_EXCEL_MAPPING_DIGEST_INVALID"].includes(error.code)); });
test("unknown visible column is rejected", () => { const broken = rebuiltWorkbook((sheets) => { sheets.find((sheet) => sheet.name === "员工").rows[0][0] = "未知字段"; }); assert.throws(() => verifyFullData(broken), (error) => error.code === "FULL_EXCEL_COLUMNS_INVALID"); });
test("missing visible worksheet is rejected", () => { const broken = rebuiltWorkbook((sheets) => sheets.splice(sheets.findIndex((sheet) => sheet.name === "所有课程数据"), 1)); assert.throws(() => verifyFullData(broken), (error) => error.code === "FULL_EXCEL_SHEET_ORDER_INVALID"); });
test("old 37-sheet or v1 format is rejected", () => assert.throws(() => verifyFullData(legacyUnsafeWorkbook()), (error) => ["XLSX_CELL_TEXT_TOO_LONG", "FULL_EXCEL_SHEET_ORDER_INVALID", "FULL_EXCEL_FORMAT_INVALID"].includes(error.code)));
test("full restore fills an empty database with the complete recovery scope", () => { const result = restoreFullData({ dbPath: targetPath, inputPath: backupPath }); assert.equal(result.integrity_check, "ok"); const target = new DatabaseSync(targetPath, { readOnly: true }); assert.deepEqual(snapshot(target), sourceSnapshot); target.close(); });
test("restored database passes integrity_check", () => { const db = new DatabaseSync(targetPath, { readOnly: true }); assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok"); db.close(); });
test("restored database passes foreign_key_check", () => { const db = new DatabaseSync(targetPath, { readOnly: true }); assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []); db.close(); });
test("backup_records is not restored", () => { const db = new DatabaseSync(targetPath, { readOnly: true }); assert.equal(db.prepare("SELECT COUNT(*) AS count FROM backup_records").get().count, 0); db.close(); });
test("excluded diagnostic audit events are not restored", () => { const db = new DatabaseSync(targetPath, { readOnly: true }); assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 0); db.close(); });
test("CLI export verify and restore work with spaces and Unicode paths", () => { const output = path.join(tempRoot, "CLI 空格", "全量.xlsx"); const target = path.join(tempRoot, "CLI 目标", "target.sqlite"); initDatabase(target); emptyManagedData(target); const run = (script, args) => spawnSync(process.execPath, [path.join(root, "scripts", "excel_backup", script), ...args], { cwd: root, encoding: "utf8" }); assert.equal(run("export_full_excel.js", ["--db", sourcePath, "--output", output]).status, 0); assert.equal(run("verify_full_excel.js", ["--input", output]).status, 0); assert.equal(run("restore_full_excel.js", ["--db", target, "--input", output, "--confirm", "OVERWRITE"]).status, 0); });
test("full-data filename is Windows-safe", () => assert.doesNotMatch(path.basename(backupPath), /[<>:"/\\|?*]/));
test("restored account can log in with its original password", async () => { const port = await freePort(); const child = spawn(process.execPath, [serverScript], { cwd: root, env: { ...process.env, DATA_DIR: path.dirname(targetPath), DB_PATH: targetPath, PORT: String(port), SESSION_COOKIE_SECURE: "0" }, stdio: "ignore" }); try { for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 50)); } const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "restore_user", password: "restore-pass" }) }); assert.equal(response.status, 200); } finally { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); } });
