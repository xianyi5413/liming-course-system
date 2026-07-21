const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { exportFullData, verifyFullData } = require("../../src/excel/full_backup");

const projectRoot = path.resolve(__dirname, "../..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function passwordHash(password, salt = "0123456789abcdeffedcba9876543210") {
  return `pbkdf2$${salt}$${crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex")}`;
}

function seedSyntheticData(db) {
  db.exec(`
    INSERT INTO settings(key,value) VALUES ('month_key','2026-07-01') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
    INSERT INTO settings(key,value) VALUES ('custom_course_statuses','["调课"]') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
    INSERT INTO teachers(id,name,phone,notes,status,joined_at,left_at) VALUES (9101,'合成教师','13900000001','仅用于Excel人工验收','在职','2025-01-01','');
    INSERT INTO students(id,name,grade,phone,guardian,notes,status,joined_at,left_at) VALUES (9201,'合成学生😀','初三','13800000001','合成监护人','=此文本不是公式','在读','2025-09-01','');
    INSERT INTO student_grade_stages(id,student_name,stage,start_date,end_date) VALUES (9301,'合成学生😀','初二','2025-09-01','2026-06-30');
    INSERT INTO student_grade_stages(id,student_name,stage,start_date,end_date) VALUES (9302,'合成学生😀','初三','2026-07-01','');
    INSERT INTO student_pricing(id,student_name,grade,subject,student_names,custom_price,notes) VALUES (9401,'合成学生😀','初三','数学','合成学生😀',188.5,'合成单价');
    INSERT INTO teacher_salary_rules(id,teacher_name,grade,subject,student_names,salary_per_unit,unit_hours,is_active,notes) VALUES (9501,'合成教师','初三','数学','合成学生😀',220,2,1,'合成规则');
    INSERT INTO class_groups(id,teacher,grade,subject,students_key,students_display,class_name) VALUES (9601,'合成教师','初三','数学','合成学生😀','合成学生😀','合成班');
    INSERT INTO lessons(id,teacher_name,date,lesson_status,time_slot,classroom,grade,subject,student_names,notes,course_status,status,teacher_salary,teacher_salary_source,teacher_salary_rule_id,month_key,sort_order) VALUES (9701,'合成教师','2026-07-20','上课','09:00-11:00','A教室','初三','数学','合成学生😀','路径 含空格；+保持文本','未上','调课',220,'rule',9501,'2026-07-01',1);
    INSERT INTO fee_overrides(lesson_id,student_name,unit_price) VALUES (9701,'合成学生😀',199.5);
    INSERT INTO recharge_records(id,student_name,grade,cur_recharge,cur_gift,recharge_date,notes,source,month_key) VALUES (9801,'合成学生😀','初三',2000,200,'2026-07-19','合成充值','manual','2026-07-01');
    INSERT INTO student_opening_balances(id,month_key,student_name,grade,opening_actual_balance,opening_gift_balance,notes) VALUES (9901,'2026-07-01','合成学生😀','初三',100,50,'原始期初余额');
    INSERT INTO teacher_travel_fees(id,month_key,teacher_name,week_index,week_start,week_end,amount,notes) VALUES (10001,'2026-07-01','合成教师',1,'2026-07-01','2026-07-07',20,'合成车费');
    INSERT INTO staff(id,name,role,base_salary,pay_type,daily_rate,standard_work_days,phone,status,joined_at,left_at,notes) VALUES (10101,'合成员工','教务',5000,'月薪',0,26,'13700000001','在职','2025-01-01','','合成员工');
    INSERT INTO staff_salary_monthly(id,staff_id,month_key,salary_actual,bonus,deduction,notes) VALUES (10201,10101,'2026-07-01',5200,300,100,'合成工资');
    INSERT INTO staff_attendance(id,staff_id,attendance_date,month_key,status,pay_units,hours,reason,notes) VALUES (10301,10101,'2026-07-20','2026-07-01','上班',1,8,'','合成考勤');
    INSERT INTO operating_expenses(id,category,expense_date,amount,vendor,notes,month_key) VALUES (10401,'办公','2026-07-20',88.8,'合成商家','合成开销','2026-07-01');
    INSERT INTO users(id,username,display_name,role,teacher_name,permission_override_enabled,password_hash,status) VALUES (10501,'excel_acceptance','合成验收账号','academic','合成教师',1,'${passwordHash("synthetic-only-password")}','active');
    INSERT INTO user_teacher_bindings(id,user_id,teacher_name) VALUES (10601,10501,'合成教师');
    INSERT INTO user_page_permissions(user_id,permission_key,enabled) VALUES (10501,'lessons',1);
  `);
  const longContent = `合成长文本说明：${"长文本😀".repeat(6500)}`;
  const longJson = JSON.stringify({ synthetic: true, emoji: "😀".repeat(17000) });
  db.prepare("INSERT INTO operation_logs(id,operator_name,operator_account,operation_type,operation_content,target_type,target_id,result_status,created_at,extra_json) VALUES (?,?,?,?,?,?,?,?,?,?)").run(10701, "合成验收人", "excel_acceptance", "合成长文本测试", longContent, "lesson", "9701", "success", "2026-07-20 13:22:28", longJson);
}

function main() {
  const output = path.resolve(argument("--output", path.join(projectRoot, "artifacts", "黎明教育_全量数据_合成验收_v3.xlsx")));
  if (fs.existsSync(output)) throw new Error(`验收文件已存在：${path.basename(output)}`);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-excel-acceptance-"));
  try {
    const dbPath = path.join(temporaryRoot, "synthetic.sqlite");
    const initialized = spawnSync(process.execPath, [path.join(projectRoot, "src/server.js"), "--init-db"], { cwd: projectRoot, env: { ...process.env, DATA_DIR: temporaryRoot, DB_PATH: dbPath }, encoding: "utf8" });
    if (initialized.status !== 0) throw new Error("合成数据库初始化失败");
    const db = new DatabaseSync(dbPath);
    try { seedSyntheticData(db); } finally { db.close(); }
    exportFullData({ dbPath, outputPath: output, appVersion: "synthetic-acceptance-v3", appGitCommit: "synthetic", createdAt: new Date("2026-07-20T05:22:28.000Z") });
    const verified = verifyFullData(output);
    process.stdout.write(`${JSON.stringify({ ok: true, output, format_version: verified.version, visible_sheets: verified.workbook.sheets.filter((sheet) => sheet.state === "visible").length, hidden_sheets: verified.workbook.sheets.filter((sheet) => sheet.state === "veryHidden").length })}\n`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

try { main(); }
catch (error) { process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "ACCEPTANCE_FIXTURE_FAILED", message: String(error.message || error).replace(/[A-Za-z]:\\[^\s]+/g, "<path>") })}\n`); process.exitCode = 1; }
