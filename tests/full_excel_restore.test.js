const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { after, before, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { FULL_TABLE_DEFINITIONS, EXCLUDED_TABLES } = require("../src/excel/field_definitions");
const { createWorkbook, parseWorkbook } = require("../src/excel/xlsx_codec");
const { BACKUP_FORMAT, FORMAT_VERSION, exportFullBackup, verifyFullBackup, restoreFullBackup } = require("../src/excel/full_backup");

const root = path.resolve(__dirname, "..");
const serverScript = path.join(root, "src", "server.js");
let tempRoot; let sourcePath; let targetPath; let backupPath; let verified; let sourceSnapshot;

function passwordHash(password, salt = "00112233445566778899aabbccddeeff") {
  return `pbkdf2$${salt}$${crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex")}`;
}

function initDatabase(dbPath) {
  const dataDir = path.dirname(dbPath); fs.mkdirSync(dataDir, { recursive: true });
  const result = spawnSync(process.execPath, [serverScript, "--init-db"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function seedCompleteData(db) {
  db.exec(`
    INSERT INTO settings(key,value) VALUES ('custom_course_statuses','["调课"]') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
    INSERT INTO settings(key,value) VALUES ('baidu_access_token','must-not-export');
    INSERT INTO teachers(id,name,phone,notes,status,joined_at,left_at) VALUES (101,'恢复教师','13900000000','教师备注','在职','2025-01-01','');
    INSERT INTO students(id,name,grade,phone,guardian,notes,status,joined_at,left_at) VALUES (201,'恢复学生','初二','13800000000','恢复家长','学生备注','在读','2025-09-01','');
    INSERT INTO student_grade_stages(id,student_name,stage,start_date,end_date,created_at,updated_at) VALUES (301,'恢复学生','初二','2025-09-01','','2025-09-01 08:00:00','2026-04-01 08:00:00');
    INSERT INTO student_pricing(id,student_name,grade,subject,student_names,custom_price,notes) VALUES (401,'恢复学生','初二','数学','恢复学生',188.5,'单价备注');
    INSERT INTO teacher_salary_rules(id,teacher_name,grade,subject,student_names,salary_per_unit,unit_hours,is_active,notes,created_at,updated_at) VALUES (501,'恢复教师','初二','数学','恢复学生',220.5,2,1,'薪资规则','2026-01-01','2026-04-01');
    INSERT INTO class_groups(id,teacher,grade,subject,students_key,students_display,class_name,created_at,updated_at) VALUES (601,'恢复教师','初二','数学','恢复学生','恢复学生','恢复班级','2026-01-01','2026-04-01');
    INSERT INTO lessons(id,teacher_name,date,lesson_status,time_slot,classroom,grade,subject,student_names,notes,course_status,status,teacher_salary,teacher_salary_source,teacher_salary_rule_id,month_key,sort_order,created_at,updated_at) VALUES (701,'恢复教师','2026-04-08','上课','09:00-11:00','A1','初二','数学','恢复学生','=公式文本','未上','调课',220.5,'rule',501,'2026-04-01',7,'2026-04-01 08:00:00','2026-04-08 12:00:00');
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
    INSERT INTO audit_logs(id,run_at,run_id,issue_key,source,severity,entity,field,before_value,after_value,status,notes) VALUES (1501,'2026-04-10','run-1','issue-1','internal','HIGH','lesson','status','旧','新','open','检查备注');
    INSERT INTO audit_ignores(issue_key,ignored_at,source,entity,field,notes) VALUES ('ignored-1','2026-04-10','internal','student','name','忽略备注');
    INSERT INTO audit_events(id,actor_user_id,actor_username,actor_role,action,entity_type,entity_id,before_json,after_json,ip,user_agent,created_at) VALUES (1601,1,'boss','owner','update','lesson','701','{}','{}','127.0.0.1','test-agent','2026-04-10');
    INSERT INTO parent_message_greetings(id,send_object_key,send_object_name,send_object_type,students,greeting,global_tail,full_message,updated_at) VALUES (1701,'CLASS|恢复班级','恢复班级','class','恢复学生','你好','尾句','你好尾句','2026-04-10');
    INSERT INTO course_notice_completion_records(id,unique_key,grade,subject,students,teacher,date,time,status,classroom,send_object_key,send_object_name,send_object_type,completed_at,completed_by) VALUES (1801,'notice-1','初二','数学','恢复学生','恢复教师','2026-04-08','09:00-11:00','已上','A1','CLASS|恢复班级','恢复班级','class','2026-04-08','boss');
    INSERT INTO operation_logs(id,campus_name,operator_name,operator_account,operation_type,operation_content,target_type,target_id,result_status,client_ip,user_agent,created_at,extra_json) VALUES (1901,'黎明教育','Qing','boss','测试操作','测试内容','lesson','701','success','127.0.0.1','test-agent','2026-04-10','{}');
    INSERT INTO users(id,username,display_name,role,teacher_name,readonly_override,permission_override_enabled,password_hash,status,created_at,updated_at) VALUES (2001,'restore_user','恢复账号','academic','恢复教师',NULL,1,'${passwordHash("restore-pass")}', 'active','2026-04-01','2026-04-01');
    INSERT INTO user_teacher_bindings(id,user_id,teacher_name,created_at) VALUES (2101,2001,'恢复教师','2026-04-01');
    INSERT INTO user_page_permissions(user_id,permission_key,enabled,created_at,updated_at) VALUES (2001,'lessons',1,'2026-04-01','2026-04-01');
    INSERT INTO user_filter_presets(user_id,view_key,filter_key,filter_value_json,created_at,updated_at) VALUES (2001,'lessons','teacher_names','["恢复教师"]','2026-04-01','2026-04-01');
    INSERT INTO role_filter_presets(id,role_code,view_key,filter_key,filter_value_json,created_at,updated_at) VALUES (2201,'academic','lessons','status','"调课"','2026-04-01','2026-04-01');
    INSERT INTO backup_records(id,backup_type,included_months,filename,file_path,file_size,status,message) VALUES (2301,'manual',1,'legacy.zip','/sensitive/server/path/legacy.zip',123,'success','不应导出');
  `);
}

function snapshot(db) {
  const tables = [...new Set(FULL_TABLE_DEFINITIONS.filter((definition) => definition.key !== "user_auth").map((definition) => definition.source_table))];
  return Object.fromEntries(tables.map((table) => {
    let rows = db.prepare(`SELECT * FROM ${table}`).all();
    if (table === "settings") rows = rows.filter((row) => row.key !== "baidu_access_token");
    return [table, rows.map((row) => JSON.stringify(row)).sort()];
  }));
}

function rebuiltWorkbook(mutator) {
  const parsed = parseWorkbook(fs.readFileSync(backupPath));
  const sheets = parsed.sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows.map((row) => [...row]) }));
  mutator(sheets);
  return createWorkbook(sheets);
}

async function freePort() { return await new Promise((resolve) => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-full-excel-"));
  sourcePath = path.join(tempRoot, "source A", "source.sqlite"); targetPath = path.join(tempRoot, "target B", "target.sqlite"); backupPath = path.join(tempRoot, "output with space", "黎明教育_系统完整数据备份_20260719_120000.xlsx");
  initDatabase(sourcePath); const source = new DatabaseSync(sourcePath); seedCompleteData(source); sourceSnapshot = snapshot(source); source.close();
  initDatabase(targetPath);
  exportFullBackup({ dbPath: sourcePath, outputPath: backupPath, appVersion: "test-version", createdAt: new Date("2026-07-19T04:00:00Z") });
  verified = verifyFullBackup(backupPath);
});

after(() => { if (tempRoot && path.basename(tempRoot).startsWith("liming-full-excel-")) fs.rmSync(tempRoot, { recursive: true, force: true }); });

test("complete export uses the fixed format and version", () => { assert.equal(verified.format, BACKUP_FORMAT); assert.equal(verified.version, FORMAT_VERSION); });
test("every recoverable definition has an exact worksheet", () => { assert.ok(FULL_TABLE_DEFINITIONS.every((definition) => verified.workbook.sheetMap.has(definition.sheet_name))); });
test("field definitions cover every source-table column", () => {
  const db = new DatabaseSync(sourcePath, { readOnly: true });
  for (const table of new Set(FULL_TABLE_DEFINITIONS.map((definition) => definition.source_table))) {
    const actual = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((row) => row.name).sort();
    const defined = [...new Set(FULL_TABLE_DEFINITIONS.filter((definition) => definition.source_table === table).flatMap((definition) => definition.columns.map((column) => column.source_field).filter(Boolean)))].sort();
    assert.deepEqual(defined, actual, table);
  }
  db.close();
});
test("backup_records and secret settings are excluded", () => { assert.equal(verified.workbook.sheetMap.has("旧备份记录"), false); assert.equal(verified.data.settings.some((row) => row.key === "baidu_access_token"), false); assert.equal(EXCLUDED_TABLES[0].table, "backup_records"); });
test("password hashes exist only in the sensitive authentication sheet", () => {
  assert.ok(verified.data.user_auth.some((row) => row.id === 2001 && String(row.password_hash).startsWith("pbkdf2$")));
  assert.equal(verified.data.users.some((row) => Object.hasOwn(row, "password_hash")), false);
  for (const sheet of verified.workbook.sheets.filter((sheet) => sheet.name !== "账号认证数据")) assert.equal(sheet.rows.flat().some((value) => String(value).startsWith("pbkdf2$")), false);
});
test("formula-like business text remains string data and no formula nodes are generated", () => {
  const lessonSheet = verified.workbook.sheetMap.get("课程原始记录");
  assert.doesNotMatch(lessonSheet.xml, /<f\b/i);
  const noteIndex = lessonSheet.rows[0].indexOf("备注");
  assert.equal(lessonSheet.rows[1][noteIndex], "=公式文本");
});
test("primary keys, foreign keys, amounts, dates and compatibility statuses survive validation", () => { assert.equal(verified.data.lessons[0].id, 701); assert.equal(verified.data.lessons[0].teacher_salary_rule_id, 501); assert.equal(verified.data.fee_overrides[0].lesson_id, 701); assert.equal(verified.data.operating_expenses[0].amount, 88.8); assert.equal(verified.data.lessons[0].lesson_status, "上课"); assert.equal(verified.data.lessons[0].course_status, "未上"); });
test("validator rejects an unknown column", () => { const buffer = rebuiltWorkbook((sheets) => { sheets.find((sheet) => sheet.name === "员工").rows[0][0] = "未知字段"; }); assert.throws(() => verifyFullBackup(buffer), (error) => error.code === "FULL_EXCEL_COLUMNS_INVALID"); });
test("validator rejects a missing required worksheet", () => { const buffer = rebuiltWorkbook((sheets) => sheets.splice(sheets.findIndex((sheet) => sheet.name === "课程原始记录"), 1)); assert.throws(() => verifyFullBackup(buffer), (error) => error.code === "FULL_EXCEL_SHEET_MISSING"); });
test("validator rejects broken relations", () => { const buffer = rebuiltWorkbook((sheets) => { const sheet = sheets.find((item) => item.name === "单节费用覆盖"); const index = sheet.rows[0].indexOf("课程ID"); sheet.rows[1][index] = 999999; }); assert.throws(() => verifyFullBackup(buffer), (error) => error.code === "FULL_EXCEL_RELATION_INVALID"); });
test("complete restore replaces initialized defaults and preserves every field", () => {
  const result = restoreFullBackup({ dbPath: targetPath, inputPath: backupPath }); assert.equal(result.integrity_check, "ok"); assert.equal(result.foreign_key_violation_count, 0);
  const target = new DatabaseSync(targetPath, { readOnly: true }); assert.deepEqual(snapshot(target), sourceSnapshot); assert.equal(target.prepare("SELECT COUNT(*) AS count FROM backup_records").get().count, 0); assert.equal(target.prepare("SELECT value FROM settings WHERE key='baidu_access_token'").get(), undefined); target.close();
});
test("restored database passes SQLite integrity and foreign-key checks", () => { const db = new DatabaseSync(targetPath, { readOnly: true }); assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok"); assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []); db.close(); });
test("failed validation leaves the target database unchanged", () => { const before = new DatabaseSync(targetPath, { readOnly: true }); const beforeSnapshot = snapshot(before); before.close(); const broken = path.join(tempRoot, "broken.xlsx"); fs.writeFileSync(broken, rebuiltWorkbook((sheets) => { sheets.find((sheet) => sheet.name === "用户账号").rows[0][0] = "错误用户名"; })); assert.throws(() => restoreFullBackup({ dbPath: targetPath, inputPath: broken })); const afterDb = new DatabaseSync(targetPath, { readOnly: true }); assert.deepEqual(snapshot(afterDb), beforeSnapshot); afterDb.close(); });
test("database constraint failure rolls back the entire overwrite transaction", () => {
  const dbBefore = new DatabaseSync(targetPath, { readOnly: true }); const before = snapshot(dbBefore); dbBefore.close();
  const broken = path.join(tempRoot, "duplicate-student.xlsx");
  fs.writeFileSync(broken, rebuiltWorkbook((sheets) => {
    const studentSheet = sheets.find((sheet) => sheet.name === "学生档案"); const duplicate = [...studentSheet.rows[1]]; duplicate[studentSheet.rows[0].indexOf("ID")] = 9999; studentSheet.rows.push(duplicate);
    const info = sheets.find((sheet) => sheet.name === "完整备份说明"); const countRow = info.rows.find((row) => row[0] === "学生档案"); countRow[2] = Number(countRow[2]) + 1;
  }));
  assert.throws(() => restoreFullBackup({ dbPath: targetPath, inputPath: broken }));
  const dbAfter = new DatabaseSync(targetPath, { readOnly: true }); assert.deepEqual(snapshot(dbAfter), before); dbAfter.close();
});
test("export, verify and restore CLI complete an isolated round trip", () => {
  const cliBackup = path.join(tempRoot, "cli", "cli-full.xlsx"); const cliTarget = path.join(tempRoot, "cli-target", "target.sqlite"); initDatabase(cliTarget);
  const run = (script, args) => spawnSync(process.execPath, [path.join(root, "scripts", "excel_backup", script), ...args], { cwd: root, encoding: "utf8" });
  const exported = run("export_full_excel.js", ["--db", sourcePath, "--output", cliBackup, "--app-version", "cli-test"]); assert.equal(exported.status, 0, exported.stderr); assert.equal(JSON.parse(exported.stdout).ok, true);
  const checked = run("verify_full_excel.js", ["--input", cliBackup]); assert.equal(checked.status, 0, checked.stderr); assert.equal(JSON.parse(checked.stdout).ok, true);
  const restored = run("restore_full_excel.js", ["--db", cliTarget, "--input", cliBackup, "--confirm", "OVERWRITE"]); assert.equal(restored.status, 0, restored.stderr); assert.equal(JSON.parse(restored.stdout).integrity_check, "ok");
  const db = new DatabaseSync(cliTarget, { readOnly: true }); assert.deepEqual(snapshot(db), sourceSnapshot); db.close();
});
test("restored account can log in with its original password", async () => {
  const port = await freePort(); const child = spawn(process.execPath, [serverScript], { cwd: root, env: { ...process.env, DATA_DIR: path.dirname(targetPath), DB_PATH: targetPath, PORT: String(port), SESSION_COOKIE_SECURE: "0" }, stdio: "ignore" });
  try { for (let i = 0; i < 80; i += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 50)); }
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "restore_user", password: "restore-pass" }) }); assert.equal(response.status, 200); assert.equal((await response.json()).user.username, "restore_user");
  } finally { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
});
