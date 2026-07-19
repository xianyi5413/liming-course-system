const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { after, before, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { DEFAULT_COURSE_STATUSES, FULL_BY_KEY } = require("../src/excel/field_definitions");

const projectRoot = path.resolve(__dirname, "..");
const serverScript = path.join(projectRoot, "src", "server.js");
const monthKey = "2026-04-01";
const expectedSheets = [
  "4月总表", "4月学生费用汇总", "学生费用明细", "充值记录", "薪资汇总",
  "导出说明", "课程原始记录", "充值原始记录", "期初余额", "学生档案",
  "学生年级阶段", "教师档案", "学生单价规则", "单节费用覆盖", "费用标准",
  "教师薪资规则", "教师月度调整", "教师车费", "班级", "员工", "员工薪资",
  "员工考勤", "日常开销",
];

let tempRoot;
let dataDir;
let dbPath;
let serverProcess;
let baseUrl;
let cookie;
let workbookBuffer;
let workbook;
let allMonthsZip;
let legacyBackupId;
let businessCountsBefore;

function xmlDecode(value) {
  return String(value || "")
    .replaceAll("&quot;", '"').replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function xmlAttr(tag, name) {
  return xmlDecode(String(tag || "").match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] || "");
}

function readZip(buffer) {
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 66000); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  assert.ok(eocd >= 0, "ZIP end directory must exist");
  const entries = new Map();
  const total = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < total; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
    const size = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name.replaceAll("\\", "/"), Buffer.from(buffer.subarray(start, start + size)));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function cellColumnIndex(ref) {
  let value = 0;
  for (const char of String(ref).match(/[A-Z]+/i)?.[0]?.toUpperCase() || "") value = value * 26 + char.charCodeAt(0) - 64;
  return value - 1;
}

function parseWorkbook(buffer) {
  const entries = readZip(buffer);
  const workbookXml = entries.get("xl/workbook.xml").toString("utf8");
  const relsXml = entries.get("xl/_rels/workbook.xml.rels").toString("utf8");
  const rels = new Map([...relsXml.matchAll(/<Relationship\b([^>]*)\/?\>/g)]
    .map(([, tag]) => [xmlAttr(tag, "Id"), `xl/${xmlAttr(tag, "Target")}`]));
  const sheets = new Map();
  for (const [, tag] of workbookXml.matchAll(/<sheet\b([^>]*)\/?\>/g)) {
    const name = xmlAttr(tag, "name");
    const sheetPath = rels.get(xmlAttr(tag, "r:id"));
    const xml = entries.get(sheetPath).toString("utf8");
    const rows = [];
    for (const [, rowXml] of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const values = [];
      for (const [, cellTag, cellXml] of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const column = cellColumnIndex(xmlAttr(cellTag, "r"));
        const inline = [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlDecode(match[1])).join("");
        const raw = xmlDecode(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "");
        values[column] = xmlAttr(cellTag, "t") === "inlineStr" ? inline : (raw === "" ? "" : Number(raw));
      }
      rows.push(values);
    }
    sheets.set(name, { rows, xml });
  }
  return { entries, sheets, names: [...sheets.keys()] };
}

function rowsAsObjects(sheet) {
  const [headers = [], ...rows] = sheet.rows;
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(url, child) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error(`test server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/api/version`);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error("test server did not start");
}

function insertFixture(db) {
  db.exec(`
    UPDATE settings SET value = '0' WHERE key = 'auto_backup_enabled';
    INSERT INTO settings(key,value) VALUES ('custom_course_statuses','["调课"]') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
    DELETE FROM lessons; DELETE FROM recharge_records; DELETE FROM student_opening_balances;
    DELETE FROM fee_overrides; DELETE FROM student_grade_stages; DELETE FROM student_pricing;
    DELETE FROM teacher_salary_rules; DELETE FROM class_groups; DELETE FROM teacher_adjustments_monthly;
    DELETE FROM teacher_travel_fees; DELETE FROM staff_attendance; DELETE FROM staff_salary_monthly;
    DELETE FROM operating_expenses; DELETE FROM staff; DELETE FROM students; DELETE FROM teachers;

    INSERT INTO students(id,name,grade,phone,guardian,notes,status,joined_at,left_at) VALUES
      (1,'在读学生','初一','13800000001','家长甲','=HYPERLINK("https://invalid")','在读','2026-01-01',''),
      (2,'离校学生','初二','','','当月仍有课程','离校','2025-01-01','2026-04-15'),
      (3,'未引用离校学生','初三','','','','离校','2025-01-01','2026-01-01'),
      (4,'李 雷','高一','','','Unicode 与空格','在读','2026-02-01',''),
      (5,'暂停学生','高二','','','有效但当月未引用','暂停','2026-02-01','');
    INSERT INTO student_grade_stages(id,student_name,stage,start_date,end_date,created_at,updated_at) VALUES
      (11,'在读学生','初一','2025-09-01','','2026-01-01 08:00:00','2026-04-01 09:00:00'),
      (12,'离校学生','初二','2025-09-01','2026-04-15','2026-01-01 08:00:00','2026-04-15 09:00:00'),
      (13,'未引用离校学生','初三','2025-09-01','2026-01-01','2025-09-01','2026-01-01');
    INSERT INTO teachers(id,name,phone,notes,status,joined_at,left_at) VALUES
      (1,'在职教师','13900000001','','在职','2025-01-01',''),
      (2,'离职教师','','当月仍有课程','离职','2025-01-01','2026-04-20'),
      (3,'未引用离职教师','','','离职','2025-01-01','2026-01-01'),
      (4,'暂停教师','','有效但当月未引用','暂停','2025-01-01','');
    INSERT INTO teacher_salary_rules(id,teacher_name,grade,subject,student_names,salary_per_unit,unit_hours,is_active,notes) VALUES
      (21,'在职教师','初一','数学','在读学生',200,2,1,'启用'),
      (22,'离职教师','初二','英语','离校学生',180,2,0,'当月课程引用'),
      (23,'未引用离职教师','初三','物理','未引用离校学生',150,2,0,'不应导出');
    INSERT INTO lessons(id,teacher_name,date,lesson_status,time_slot,classroom,grade,subject,student_names,notes,course_status,status,teacher_salary,teacher_salary_source,teacher_salary_rule_id,month_key,sort_order,created_at,updated_at) VALUES
      (101,'在职教师','2026-04-05','上课','09:00-11:00','A1','初一','数学','在读学生、李 雷','-测试备注','已上','已上',200,'rule',21,'2026-04-01',1,'2026-04-01 08:00:00','2026-04-05 12:00:00'),
      (102,'离职教师','2026-04-06','上课','13:00-15:00','A2','初二','英语','离校学生','当月引用','未上','调课',180,'rule',22,'2026-04-01',2,'2026-04-01 08:00:00','2026-04-06 16:00:00'),
      (201,'未引用离职教师','2026-05-05','上课','09:00-11:00','A3','初三','物理','未引用离校学生','其他月份','已上','已上',150,'rule',23,'2026-05-01',1,'2026-05-01','2026-05-05');
    INSERT INTO recharge_records(id,student_name,grade,prev_actual,prev_gift,cur_recharge,cur_gift,recharge_date,notes,source,month_key) VALUES
      (301,'在读学生','初一',100,50,1000,100,'2026-04-03','@充值备注','manual','2026-04-01'),
      (302,'李 雷','高一',0,0,0,0,'','未登记提醒占位','synthetic-reminder','2026-04-01'),
      (303,'未引用离校学生','初三',0,0,500,0,'2026-05-03','其他月份','manual','2026-05-01');
    INSERT INTO student_opening_balances(id,month_key,student_name,grade,opening_actual_balance,opening_gift_balance,notes,created_at,updated_at) VALUES
      (401,'2026-04-01','在读学生','初一',100,50,'原始期初','2026-03-31 20:00:00','2026-04-01 08:00:00'),
      (402,'2026-04-01','离校学生','初二',200,20,'离校生期初','2026-03-31 20:00:00','2026-04-01 08:00:00'),
      (403,'2026-05-01','未引用离校学生','初三',999,99,'其他月份','2026-04-30','2026-05-01');
    INSERT INTO fee_overrides(lesson_id,student_name,unit_price,updated_at) VALUES
      (101,'在读学生',88,'2026-04-05 12:01:00'), (201,'未引用离校学生',77,'2026-05-05');
    INSERT INTO student_pricing(id,student_name,grade,subject,student_names,custom_price,notes) VALUES
      (501,'在读学生','初一','数学','在读学生',88,'现有规则');
    INSERT INTO class_groups(id,teacher,grade,subject,students_key,students_display,class_name,created_at,updated_at) VALUES
      (601,'在职教师','初一','数学','在读学生','在读学生','初一数学班','2026-01-01','2026-04-01');
    INSERT INTO teacher_adjustments_monthly(teacher_name,month_key,week1_transport,week2_transport,week3_transport,week4_transport,notes) VALUES
      ('离职教师','2026-04-01',10,20,0,0,'当月调整'), ('未引用离职教师','2026-05-01',99,0,0,0,'其他月份');
    INSERT INTO teacher_travel_fees(id,month_key,teacher_name,week_index,week_start,week_end,amount,notes,created_at,updated_at) VALUES
      (701,'2026-04-01','离职教师',1,'2026-03-30','2026-04-05',30,'当月车费','2026-04-05','2026-04-05'),
      (702,'2026-05-01','未引用离职教师',1,'2026-04-27','2026-05-03',90,'其他月份','2026-05-03','2026-05-03');
    INSERT INTO staff(id,name,role,base_salary,pay_type,daily_rate,standard_work_days,phone,status,joined_at,left_at,notes) VALUES
      (1,'在职员工','教务主管',5000,'月薪',0,26,'','在职','2025-01-01','',''),
      (2,'离职员工','前台',4000,'月薪',0,26,'','离职','2025-01-01','2026-04-10','当月薪资引用'),
      (3,'未引用离职员工','其他',3000,'月薪',0,26,'','离职','2025-01-01','2026-01-01',''),
      (4,'暂停员工','其他',3000,'月薪',0,26,'','暂停','2025-01-01','','有效但当月未引用');
    INSERT INTO staff_salary_monthly(id,staff_id,month_key,salary_actual,bonus,deduction,notes) VALUES
      (801,2,'2026-04-01',3500,100,50,'当月'), (802,3,'2026-05-01',3000,0,0,'其他月份');
    INSERT INTO staff_attendance(id,staff_id,attendance_date,month_key,status,pay_units,hours,reason,notes,updated_at) VALUES
      (901,1,'2026-04-02','2026-04-01','上班',1,8,'','正常','2026-04-02 18:00:00'),
      (902,3,'2026-05-02','2026-05-01','上班',1,8,'','其他月份','2026-05-02');
    INSERT INTO operating_expenses(id,category,expense_date,amount,vendor,notes,month_key) VALUES
      (1001,'办公','2026-04-08',123.45,'文具店','当月','2026-04-01'),
      (1002,'维修','2026-05-08',999,'维修店','其他月份','2026-05-01');
  `);
}

function businessCounts(db) {
  const tables = ["lessons", "recharge_records", "student_opening_balances", "students", "teachers", "staff", "backup_records"];
  return Object.fromEntries(tables.map((table) => [table, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-monthly-core-"));
  dataDir = path.join(tempRoot, "data with space");
  dbPath = path.join(dataDir, "synthetic.sqlite");
  fs.mkdirSync(dataDir, { recursive: true });
  const env = { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath, SESSION_COOKIE_SECURE: "0" };
  const initialized = spawnSync(process.execPath, [serverScript, "--init-db"], { cwd: projectRoot, env, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(dbPath);
  insertFixture(db);
  const legacyPath = path.join(dataDir, "backups", "legacy-core.zip");
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  fs.writeFileSync(legacyPath, "legacy-backup-content");
  legacyBackupId = Number(db.prepare(`
    INSERT INTO backup_records(backup_type,included_months,filename,file_path,file_size,status,message)
    VALUES ('manual',1,'legacy-core.zip',?,?,'success','legacy fixture')
  `).run(legacyPath, fs.statSync(legacyPath).size).lastInsertRowid);
  businessCountsBefore = businessCounts(db);
  db.close();

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, [serverScript], {
    cwd: projectRoot,
    env: { ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(baseUrl, serverProcess);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "boss", password: "123456" }),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";", 1)[0];

  const coreResponse = await fetch(`${baseUrl}/api/export/core-workbook.xlsx?month=2026-04`, { headers: { cookie } });
  assert.equal(coreResponse.status, 200);
  workbookBuffer = Buffer.from(await coreResponse.arrayBuffer());
  workbook = parseWorkbook(workbookBuffer);
  const zipResponse = await fetch(`${baseUrl}/api/export/core-workbooks-all.zip`, { headers: { cookie } });
  assert.equal(zipResponse.status, 200);
  allMonthsZip = Buffer.from(await zipResponse.arrayBuffer());
});

after(async () => {
  if (serverProcess && serverProcess.exitCode == null) {
    serverProcess.kill();
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }
  if (tempRoot && path.basename(tempRoot).startsWith("liming-monthly-core-")) fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("original five worksheets keep their names and order", () => {
  assert.deepEqual(workbook.names.slice(0, 5), expectedSheets.slice(0, 5));
});

test("enhanced worksheets have the required order", () => {
  assert.deepEqual(workbook.names, expectedSheets);
});

test("legacy worksheet names remain compatible while course headers use the current UI order", () => {
  assert.deepEqual(workbook.sheets.get("4月总表").rows[1].slice(0, 10), ["授课老师", "日期", "星期", "时间", "教室", "状态", "年级", "科目", "学生", "备注"]);
  assert.deepEqual(workbook.sheets.get("充值记录").rows[1].slice(0, 4), ["学生姓名", "年级", "上月实际结转", "上月赠送结转"]);
});

test("export information identifies a monthly archive and lists all sheets", () => {
  const rows = workbook.sheets.get("导出说明").rows;
  const blankIndex = rows.findIndex((row) => row.length === 0);
  const metadata = new Map(rows.slice(1, blankIndex).map((row) => [row[0], row[1]]));
  assert.equal(metadata.get("导出类型"), "monthly_core_excel");
  assert.equal(metadata.get("月份"), monthKey);
  assert.match(metadata.get("导出时间（UTC）"), /Z$/);
  assert.match(metadata.get("导出时间（Asia\/Shanghai）"), /\+08:00$/);
  assert.match(metadata.get("用途说明"), /不是系统完整恢复备份/);
  assert.equal(metadata.get("工作表清单"), expectedSheets.join("、"));
  const listedNames = rows.slice(blankIndex + 2).map((row) => row[0]);
  assert.deepEqual(listedNames, expectedSheets);
});

test("every worksheet has a record count and data classification", () => {
  const rows = workbook.sheets.get("导出说明").rows;
  const headerIndex = rows.findIndex((row) => row[0] === "工作表");
  const records = rows.slice(headerIndex + 1);
  assert.equal(records.length, expectedSheets.length);
  assert.ok(records.every((row) => Number.isFinite(row[1]) && row[1] >= 0 && row[2]));
});

test("opening balances export exact current-month source records", () => {
  const rows = rowsAsObjects(workbook.sheets.get("期初余额"));
  assert.deepEqual(rows.map((row) => row.ID), [401, 402]);
  assert.deepEqual(rows.map((row) => row.month_key), [monthKey, monthKey]);
  assert.deepEqual(rows.map((row) => [row.期初实际余额, row.期初赠送余额]), [[100, 50], [200, 20]]);
  assert.equal(rows.some((row) => row.ID === 403 || row.期初实际余额 === 999), false);
});

test("lesson raw records are complete and limited to the selected month", () => {
  const rows = rowsAsObjects(workbook.sheets.get("课程原始记录"));
  assert.deepEqual(rows.map((row) => row.ID), [101, 102]);
  assert.ok(rows.every((row) => row.month_key === monthKey));
  assert.equal(rows[0].教师薪资规则ID, 21);
  assert.equal(rows[0].创建时间, "2026-04-01 08:00:00");
});

test("recharge raw records exclude reminder placeholders and other months", () => {
  const rows = rowsAsObjects(workbook.sheets.get("充值原始记录"));
  assert.deepEqual(rows.map((row) => row.ID), [301]);
  assert.equal(rows.some((row) => row.备注 === "未登记提醒占位"), false);
});

test("inactive students and teachers referenced by the month are retained", () => {
  const students = rowsAsObjects(workbook.sheets.get("学生档案"));
  const teachers = rowsAsObjects(workbook.sheets.get("教师档案"));
  assert.ok(students.some((row) => row.学生姓名 === "离校学生" && row.状态 === "离校"));
  assert.equal(students.some((row) => row.学生姓名 === "未引用离校学生"), false);
  assert.ok(teachers.some((row) => row.教师姓名 === "离职教师" && row.状态 === "离职"));
  assert.equal(teachers.some((row) => row.教师姓名 === "未引用离职教师"), false);
  assert.ok(students.some((row) => row.学生姓名 === "暂停学生"));
  assert.ok(teachers.some((row) => row.教师姓名 === "暂停教师"));
});

test("IDs and relationship fields are preserved", () => {
  const overrides = rowsAsObjects(workbook.sheets.get("单节费用覆盖"));
  assert.deepEqual(overrides, [{ 学生姓名: "在读学生", 单节费用: 88, 课程ID: 101, 更新时间: "2026-04-05 12:01:00" }]);
  const salaries = rowsAsObjects(workbook.sheets.get("员工薪资"));
  assert.equal(salaries[0].员工ID, 2);
});

test("all month-only sheets exclude other-month rows", () => {
  for (const name of ["教师月度调整", "教师车费", "员工薪资", "员工考勤", "日常开销"]) {
    const rows = rowsAsObjects(workbook.sheets.get(name));
    assert.ok(rows.length > 0, `${name} should have a fixture row`);
    assert.ok(rows.every((row) => row.month_key === monthKey), `${name} contains another month`);
  }
});

test("reference data includes active rows and current-month inactive references", () => {
  const rules = rowsAsObjects(workbook.sheets.get("教师薪资规则"));
  assert.deepEqual(rules.map((row) => row.ID), [21, 22]);
  const staff = rowsAsObjects(workbook.sheets.get("员工"));
  assert.ok(staff.some((row) => row.员工姓名 === "在职员工"));
  assert.ok(staff.some((row) => row.员工姓名 === "离职员工"));
  assert.equal(staff.some((row) => row.员工姓名 === "未引用离职员工"), false);
  assert.ok(staff.some((row) => row.员工姓名 === "暂停员工"));
});

test("amounts remain numeric while dates and empty values remain text", () => {
  const expense = rowsAsObjects(workbook.sheets.get("日常开销"))[0];
  assert.equal(expense.金额, 123.45);
  assert.equal(expense.日期, "2026-04-08");
  assert.equal(rowsAsObjects(workbook.sheets.get("学生档案"))[0].离校日期, "");
});

test("formula-like user input is emitted only as inline string data", () => {
  const studentSheet = workbook.sheets.get("学生档案");
  const courseSheet = workbook.sheets.get("课程原始记录");
  assert.doesNotMatch(studentSheet.xml, /<f\b/i);
  assert.doesNotMatch(courseSheet.xml, /<f\b/i);
  assert.equal(rowsAsObjects(studentSheet).find((row) => row.学生姓名 === "在读学生").备注, '=HYPERLINK("https://invalid")');
  assert.equal(rowsAsObjects(courseSheet)[0].备注, "-测试备注");
});

test("course raw columns exactly follow the unified current-system definition", () => {
  const expected = FULL_BY_KEY.lessons.columns.filter((column) => column.is_user_visible).map((column) => column.display_name);
  assert.deepEqual(workbook.sheets.get("课程原始记录").rows[0], expected);
});

test("course status has exactly one user-visible column named 状态", () => {
  const headers = workbook.sheets.get("课程原始记录").rows[0];
  assert.equal(headers.filter((header) => header === "状态").length, 1);
  assert.equal(headers.some((header) => /上课状态|课程状态|lesson_status|course_status/.test(header)), false);
});

test("monthly workbook does not expose the obsolete 上课情况 label", () => {
  const headers = [...workbook.sheets.values()].flatMap((sheet) => sheet.rows.slice(0, 2).flat());
  assert.equal(headers.includes("上课情况"), false);
});

test("course status values match defaults plus the configured custom enum", () => {
  const statuses = rowsAsObjects(workbook.sheets.get("课程原始记录")).map((row) => row.状态);
  const allowed = new Set([...DEFAULT_COURSE_STATUSES, "调课"]);
  assert.ok(statuses.every((status) => allowed.has(status)));
  assert.ok(statuses.includes("调课"));
});

test("technical course fields follow all current-system business fields", () => {
  const headers = workbook.sheets.get("课程原始记录").rows[0];
  const lastBusiness = headers.indexOf("备注");
  for (const technical of ["ID", "month_key", "排序", "教师薪资规则ID", "创建时间", "更新时间"]) assert.ok(headers.indexOf(technical) > lastBusiness, technical);
});

test("monthly export and full backup reference the same course field objects", () => {
  assert.equal(FULL_BY_KEY.lessons.columns, require("../src/excel/field_definitions").LESSON_COLUMNS);
  assert.deepEqual(workbook.sheets.get("课程原始记录").rows[0], FULL_BY_KEY.lessons.columns.filter((column) => column.is_user_visible).map((column) => column.display_name));
});

test("workbook contains no credential or server-infrastructure fields", () => {
  const headers = [...workbook.sheets.values()].flatMap((sheet) => sheet.rows[0] || []).join("|");
  assert.doesNotMatch(headers, /password_hash|session|cookie|token|secret|ssh|docker|绝对路径/i);
  assert.doesNotMatch(workbookBuffer.toString("utf8"), /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i);
  assert.doesNotMatch(workbookBuffer.toString("utf8"), /pbkdf2\$/i);
});

test("Unicode and spaces survive a complete workbook parse", () => {
  assert.ok(rowsAsObjects(workbook.sheets.get("学生档案")).some((row) => row.学生姓名 === "李 雷"));
  assert.ok(workbookBuffer.length > 0);
});

test("workbook is macro-free OOXML with all worksheet parts present", () => {
  assert.ok(workbook.entries.has("[Content_Types].xml"));
  assert.equal([...workbook.entries.keys()].some((name) => /vbaProject|\.bin$/i.test(name)), false);
  assert.equal([...workbook.entries.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).length, expectedSheets.length);
});

test("all-month core ZIP reuses the enhanced monthly workbook", () => {
  const entries = readZip(allMonthsZip);
  const aprilEntry = [...entries.entries()].find(([name]) => name.startsWith("2026-04/") && name.endsWith(".xlsx"));
  assert.ok(aprilEntry);
  assert.deepEqual(parseWorkbook(aprilEntry[1]).names, expectedSheets);
});

test("existing opening-balance export and import still work", async () => {
  const exported = await fetch(`${baseUrl}/api/opening-balances/export.xlsx`, { headers: { cookie } });
  assert.equal(exported.status, 200);
  const buffer = Buffer.from(await exported.arrayBuffer());
  const parsed = parseWorkbook(buffer);
  assert.deepEqual(parsed.names, ["期初余额"]);
  const form = new FormData();
  form.append("file", new Blob([buffer]), "opening-balances.xlsx");
  const imported = await fetch(`${baseUrl}/api/opening-balances/import`, { method: "POST", headers: { cookie }, body: form });
  assert.equal(imported.status, 200);
  const result = await imported.json();
  assert.equal(result.failed, 0);
  assert.ok(result.imported + result.skipped >= 2);
});

test("legacy backup_records listing and download are unaffected", async () => {
  const list = await fetch(`${baseUrl}/api/backups`, { headers: { cookie } });
  assert.equal(list.status, 200);
  const payload = await list.json();
  assert.ok(payload.records.some((row) => row.id === legacyBackupId && row.filename === "legacy-core.zip"));
  const download = await fetch(`${baseUrl}/api/backups/${legacyBackupId}/download`, { headers: { cookie } });
  assert.equal(download.status, 200);
  assert.equal(Buffer.from(await download.arrayBuffer()).toString("utf8"), "legacy-backup-content");
});

test("existing student-balance regression passes against the synthetic database", () => {
  const result = spawnSync(process.execPath, [serverScript, "--verify-student-balances"], {
    cwd: projectRoot,
    env: { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.ok(report.cases.length >= 10 && report.cases.every((item) => item.name));
});

test("exports do not change business rows or backup metadata", () => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const afterCounts = businessCounts(db);
  db.close();
  assert.deepEqual(afterCounts, businessCountsBefore);
});
