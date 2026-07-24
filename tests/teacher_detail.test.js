const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");
const {
  normalizeStoredStudentSet,
  teacherSalaryRuleActivation,
  teacherSalaryRuleDateState,
} = require("../src/domain/teacher_salary_rule");

const root = path.resolve(__dirname, "..");
const MONTH = "2026-07-01";
let tempRoot;
let databasePath;
let port;
let server;
let ownerCookie;
let teacherCookie;
let academicCookie;

const studentSetCases = [
  ["顿号", "张三、李四", "李四、张三"],
  ["中文逗号", "张三，李四", "李四、张三"],
  ["英文逗号", "张三,李四", "李四、张三"],
  ["中文分号", "张三；李四", "李四、张三"],
  ["英文分号", "张三;李四", "李四、张三"],
  ["换行", "张三\n李四", "李四、张三"],
  ["JSON数组字符串", "[\"张三\",\"李四\"]", "李四、张三"],
  ["数组值", ["张三", "李四"], "李四、张三"],
  ["嵌套数组", ["张三", ["李四"]], "李四、张三"],
  ["首尾空格", "  张三 、 李四  ", "李四、张三"],
  ["姓名内历史空格", "张 三、李 四", "李四、张三"],
  ["重复姓名", "张三、李四、张三", "李四、张三"],
  ["顺序稳定", "李四、张三", "李四、张三"],
  ["空值", "", ""],
];

for (const [label, input, expected] of studentSetCases) {
  test(`student set normalization: ${label}`, () => {
    assert.equal(normalizeStoredStudentSet(input), expected);
  });
}

const activationCases = [
  ["numeric enabled", 1, 300, true, "explicit_enabled"],
  ["string enabled", "1", "300", true, "explicit_enabled"],
  ["boolean enabled", true, 300, true, "explicit_enabled"],
  ["Chinese enabled", "启用", 300, true, "explicit_enabled"],
  ["Chinese active", "在用", 300, true, "explicit_enabled"],
  ["English enabled", "enabled", 300, true, "explicit_enabled"],
  ["English active", "active", 300, true, "explicit_enabled"],
  ["legacy candidate amount", 0, 300, true, "legacy_candidate_with_amount"],
  ["legacy candidate string amount", "0", "300.00", true, "legacy_candidate_with_amount"],
  ["unconfigured candidate", 0, 0, false, "candidate_unconfigured"],
  ["explicit negative disabled", -1, 300, false, "explicit_disabled"],
  ["boolean disabled", false, 300, false, "explicit_disabled"],
  ["Chinese disabled", "停用", 300, false, "explicit_disabled"],
  ["Chinese forbidden", "禁用", 300, false, "explicit_disabled"],
  ["English disabled", "disabled", 300, false, "explicit_disabled"],
  ["missing status amount", null, 300, true, "legacy_missing"],
  ["missing status zero", null, 0, true, "legacy_missing"],
  ["invalid status", "unknown", 300, false, "invalid_status"],
];

for (const [label, isActive, salary, enabled, source] of activationCases) {
  test(`activation compatibility: ${label}`, () => {
    assert.deepEqual(
      teacherSalaryRuleActivation({ is_active: isActive, salary_per_unit: salary }),
      { enabled, source },
    );
  });
}

const dateCases = [
  ["empty dates", {}, "2026-07-10", true, "有效"],
  ["start boundary", { start_date: "2026-07-10" }, "2026-07-10", true, "有效"],
  ["end boundary", { end_date: "2026-07-10" }, "2026-07-10", true, "有效"],
  ["before start", { start_date: "2026-07-11" }, "2026-07-10", false, "未生效"],
  ["after end", { end_date: "2026-07-09" }, "2026-07-10", false, "已失效"],
  ["inside range", { start_date: "2026-07-01", end_date: "2026-07-31" }, "2026-07-10", true, "有效"],
];

for (const [label, rule, date, usable, status] of dateCases) {
  test(`rule date compatibility: ${label}`, () => {
    const result = teacherSalaryRuleDateState(rule, { date });
    assert.equal(result.usable, usable);
    assert.equal(result.status, status);
  });
}

const frontendSource = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "src/server.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const sourceContracts = [
  ["frontend reads rule_salary", frontendSource, /optionalNumberValue\(lesson\.rule_salary\)/],
  ["zero is checked without truthiness", frontendSource, /salary != null/],
  ["unmatched label is explicit", frontendSource, /not_matched: "未匹配"/],
  ["unavailable label is explicit", frontendSource, /rule_unavailable: "规则不可用"/],
  ["calculation error label is explicit", frontendSource, /calculation_error: "无法计算"/],
  ["diagnostic entry exists", frontendSource, /查看匹配详情/],
  ["rule writes invalidate lesson cache", frontendSource, /teacher-salary-rules[^]*lessons-range/],
  ["teacher detail GET bypasses cache", frontendSource, /view === "teacherDetail" \? \{ cache: false \}/],
  ["batch and page share resolver", serverSource, /const resolved = resolveTeacherSalaryRuleForLesson\(lesson, rules\)/],
  ["static resource version is current", indexSource, /20260724-teacher-rule-salary-display/g],
];

for (const [label, source, pattern] of sourceContracts) {
  test(`source contract: ${label}`, () => {
    assert.match(source, pattern);
  });
}

async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("teacher detail test server did not start");
}

async function login(username) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "123456" }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

async function api(pathname, { cookie = ownerCookie, method = "GET", body } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

async function julyRows(cookie = ownerCookie) {
  const result = await api("/api/lessons-range?start=2026-07-01&end=2026-07-31&view=teacherDetail&teacher_names=%E5%9C%A8%E8%81%8C%E7%94%B2", { cookie });
  assert.equal(result.response.status, 200);
  return new Map(result.payload.lessons.map((row) => [row.id, row]));
}

function seed(db) {
  const passwordHash = db.prepare("SELECT password_hash FROM users WHERE username='boss'").get().password_hash;
  db.exec(`
    UPDATE settings SET value='${MONTH}' WHERE key='month_key';
    INSERT INTO teachers(id,name,status) VALUES
      (9001,'在职甲','在职'),
      (9002,'在职乙','在职'),
      (9003,'离职丙','离职');
    INSERT INTO teacher_salary_rules(id,teacher_name,grade,subject,student_names,salary_per_unit,unit_hours,is_active,notes) VALUES
      (9101,'在职甲','初一','数学','李四、张 三',300,2,1,'顺序与空格规范化规则'),
      (9102,'在职甲','初一','英语','张三、李四',280,2,-1,'明确停用规则'),
      (9103,'在职甲','初一','物理','张三、李四',0,2,1,'零金额有效规则'),
      (9104,'在职甲','初二','生物','王五',200,2,0,'历史候选已填写金额'),
      (9105,'在职甲','初二','历史','王五','bad',2,1,'无效金额'),
      (9106,'在职甲','初二','语文','王五',220,2,0,'歧义一'),
      (9107,'在职甲','初二','语文','王五',240,2,0,'歧义二'),
      (9108,'在职甲','初二','地理','王五',260,2,1,'时长异常'),
      (9109,'在职甲','初二','化学','["王五","赵六"]',240,2,1,'JSON学生集合');
    INSERT INTO lessons(id,teacher_name,date,lesson_status,time_slot,classroom,grade,subject,student_names,notes,course_status,status,teacher_salary,teacher_salary_source,teacher_salary_rule_id,month_key,sort_order) VALUES
      (9201,'在职甲','2026-07-01','上课','09:00-11:00','A1','初一','数学','张三； 李四','应更新','已上','已上',120,'manual',NULL,'2026-07-01',1),
      (9202,'在职甲','2026-07-02','上课','09:00-10:00','A1','初一','数学','李四、张三','已一致','已上','已上',150,'auto',9101,'2026-07-01',2),
      (9203,'在职甲','2026-07-03','上课','09:00-11:00','A1','初一','化学','张三、李四','无规则','已上','已上',80,'manual',NULL,'2026-07-01',3),
      (9204,'在职甲','2026-07-04','上课','09:00-11:00','A1','初一','英语','李四、张三','停用规则','已上','已上',80,'manual',NULL,'2026-07-01',4),
      (9205,'在职甲','2026-07-05','上课','09:00-11:00','A1','初一','物理','张三、李四','零金额规则','已上','已上',80,'manual',NULL,'2026-07-01',5),
      (9206,'在职甲','2026-07-06','上课','09:00-11:00','A1','初一','数学','张三、李四','未上课程','未上','待上',0,'empty',NULL,'2026-07-01',6),
      (9207,'在职乙','2026-07-07','上课','09:00-11:00','A2','初一','数学','张三、李四','权限外课程','已上','已上',10,'manual',NULL,'2026-07-01',7),
      (9210,'在职甲','2026-08-01','上课','09:00-11:00','A1','初一','数学','张三、李四','八月课程','已上','已上',300,'auto',9101,'2026-08-01',1),
      (9211,'在职甲','2026-07-11','上课','09:00-11:00','A1','初二','生物','王五','历史状态兼容','已上','已上',20,'manual',NULL,'2026-07-01',11),
      (9212,'在职甲','2026-07-12','上课','09:00-11:00','A1','初二','历史','王五','金额异常','已上','已上',20,'manual',NULL,'2026-07-01',12),
      (9213,'在职甲','2026-07-13','上课','09:00-11:00','A1','初二','语文','王五','规则歧义','已上','已上',20,'manual',NULL,'2026-07-01',13),
      (9214,'在职甲','2026-07-14','上课','','A1','初二','地理','王五','时长异常','已上','已上',20,'manual',NULL,'2026-07-01',14),
      (9215,'在职甲','2026-07-15','上课','09:00-10:30','A1','初二','化学','赵六，王五、王五','JSON与非标准时长','已上','已上',20,'manual',NULL,'2026-07-01',15),
      (9220,'在职甲','2026-07-20','上课','09:00-11:00','A1','初三','生物','王五','缓存即时刷新','已上','已上',20,'manual',NULL,'2026-07-01',20);
  `);
  const teacherUser = db.prepare(`
    INSERT INTO users(username,display_name,role,teacher_name,password_hash,status)
    VALUES ('teacher-detail-readonly','只读教师','teacher','在职甲',?,'active')
  `).run(passwordHash);
  db.prepare("INSERT INTO user_teacher_bindings(user_id,teacher_name) VALUES (?,'在职甲')").run(Number(teacherUser.lastInsertRowid));
  db.prepare(`
    INSERT INTO users(username,display_name,role,password_hash,status)
    VALUES ('teacher-detail-academic','范围教务','academic',?,'active')
  `).run(passwordHash);
  db.prepare(`
    INSERT INTO role_filter_presets(role_code,view_key,filter_key,filter_value_json)
    VALUES ('academic','teacherDetail','teacher_names','["在职甲"]')
  `).run();
}

function resetJulySalaries() {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    UPDATE lessons SET teacher_salary=120,teacher_salary_source='manual',teacher_salary_rule_id=NULL WHERE id=9201;
    UPDATE lessons SET teacher_salary=150,teacher_salary_source='auto',teacher_salary_rule_id=9101 WHERE id=9202;
    UPDATE lessons SET teacher_salary=80,teacher_salary_source='manual',teacher_salary_rule_id=NULL WHERE id=9205;
  `);
  db.close();
}

async function openTeacherDetail(browser) {
  if (!await browser.evaluate("Boolean(document.querySelector('.nav-sub-btn[data-view=\"teacherDetail\"]'))")) {
    await browser.click('.nav-btn[data-nav-group="teachers"]');
  }
  await browser.waitFor("Boolean(document.querySelector('.nav-sub-btn[data-view=\"teacherDetail\"]'))");
  await browser.click('.nav-sub-btn[data-view="teacherDetail"]');
  await browser.waitFor("document.querySelector('#topbar')?.textContent.includes('课时明细')");
}

async function selectTeacher(browser, name = "在职甲") {
  await browser.evaluate(`(() => {
    const input = document.querySelector('input.teacher-detail-teacher-select');
    input.value = ${JSON.stringify(name)};
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await browser.waitFor(`Boolean(document.querySelector('.teacher-detail-table .teacher-salary-lesson-select')) && document.querySelector('input.teacher-detail-teacher-select')?.value === ${JSON.stringify(name)}`);
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-teacher-detail-"));
  databasePath = path.join(tempRoot, "teacher-detail.sqlite");
  const environment = {
    ...process.env,
    DATA_DIR: tempRoot,
    DB_PATH: databasePath,
    SESSION_COOKIE_SECURE: "false",
    BAIDU_APP_KEY: "",
    BAIDU_APP_SECRET: "",
    BAIDU_REDIRECT_URI: "",
  };
  const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], {
    cwd: root,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(databasePath);
  seed(db);
  db.close();
  port = await freePort();
  server = spawn(process.execPath, [path.join(root, "src/server.js")], {
    cwd: root,
    env: { ...environment, PORT: String(port) },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  await waitForServer();
  ownerCookie = await login("boss");
  teacherCookie = await login("teacher-detail-readonly");
  academicCookie = await login("teacher-detail-academic");
  const runtimeDb = new DatabaseSync(databasePath);
  runtimeDb.prepare(`
    INSERT INTO lessons(id,teacher_name,date,lesson_status,time_slot,classroom,grade,subject,student_names,notes,course_status,status,teacher_salary,teacher_salary_source,teacher_salary_rule_id,month_key,sort_order)
    VALUES (9208,'历史无档案','2026-07-08','上课','09:00-11:00','A3','初一','数学','张三、李四','历史教师','已上','已上',10,'manual',NULL,'2026-07-01',8)
  `).run();
  runtimeDb.close();
});

after(async () => {
  if (server?.exitCode == null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  if (tempRoot) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch {}
  }
});

test("teacher detail candidates come only from active profiles and honor account scope", async () => {
  const owner = await api("/api/teacher-detail/teachers");
  assert.equal(owner.response.status, 200);
  assert.deepEqual(owner.payload.teachers.map((row) => [row.name, row.status]), [["在职甲", "在职"], ["在职乙", "在职"]]);
  const teacher = await api("/api/teacher-detail/teachers", { cookie: teacherCookie });
  assert.equal(teacher.response.status, 200);
  assert.deepEqual(teacher.payload.teachers.map((row) => row.name), ["在职甲"]);
  const academic = await api("/api/teacher-detail/teachers", { cookie: academicCookie });
  assert.deepEqual(academic.payload.teachers.map((row) => row.name), ["在职甲"]);
});

test("lesson detail and batch update share normalized student matching and duration calculation", async () => {
  resetJulySalaries();
  const detail = await api("/api/lessons-range?start=2026-07-01&end=2026-07-31&view=teacherDetail&teacher_names=%E5%9C%A8%E8%81%8C%E7%94%B2");
  assert.equal(detail.response.status, 200);
  const rows = new Map(detail.payload.lessons.map((row) => [row.id, row]));
  assert.equal(rows.get(9201).teacher_salary_rule_status, "matched");
  assert.equal(rows.get(9201).rule_salary, 300);
  assert.equal(rows.get(9201).rule_salary_rule_id, 9101);
  assert.equal(rows.get(9202).rule_salary, 150);
  assert.equal(rows.get(9202).rule_salary_lesson_hours, 1);
  assert.equal(rows.get(9203).teacher_salary_rule_status, "not_matched");
  assert.equal(rows.get(9204).teacher_salary_rule_status, "rule_unavailable");
  assert.equal(rows.get(9205).teacher_salary_rule_status, "matched");
  assert.equal(rows.get(9205).rule_salary, 0);
  assert.equal(rows.get(9206).teacher_salary_rule_status, "matched");
  assert.equal(rows.get(9206).rule_salary, 300);
  assert.equal(rows.get(9206).payroll_eligible, false);
});

test("mixed string, numeric, duplicate, unchanged and skipped IDs return structured results", async () => {
  resetJulySalaries();
  const { response, payload } = await api("/api/teacher-salary-rules/apply-selected", {
    method: "POST",
    body: { lesson_ids: ["9201", 9202, 9203, 9204, 9205, 9206, 9201], new_salary: 999999 },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    {
      selected: payload.selected_count,
      updated: payload.updated_count,
      unchanged: payload.unchanged_count,
      skipped: payload.skipped_count,
      failed: payload.failed_count,
    },
    { selected: 6, updated: 2, unchanged: 1, skipped: 3, failed: 0 },
  );
  assert.deepEqual(payload.results.map((item) => item.status), ["updated", "unchanged", "skipped", "skipped", "updated", "skipped"]);
  assert.deepEqual(payload.results.filter((item) => item.status === "skipped").map((item) => item.reason), [
    "未找到科目完全一致的规则",
    "规则已停用",
    "当前课程状态不参与教师计薪",
  ]);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const lesson = db.prepare("SELECT teacher_salary,teacher_salary_source,teacher_salary_rule_id FROM lessons WHERE id=9201").get();
  assert.deepEqual({ ...lesson }, { teacher_salary: 300, teacher_salary_source: "auto", teacher_salary_rule_id: 9101 });
  const log = db.prepare("SELECT operation_content,extra_json FROM operation_logs WHERE operation_type='按规则更新教师薪资' ORDER BY id DESC LIMIT 1").get();
  db.close();
  assert.match(log.operation_content, /所选 6 条，更新 2 条，无需更新 1 条，跳过 3 条/);
  assert.deepEqual(JSON.parse(log.extra_json), {
    selected_count: 6,
    updated_count: 2,
    unchanged_count: 1,
    skipped_count: 3,
    failed_count: 0,
  });
});

test("invalid, missing, readonly and out-of-scope requests are handled safely", async () => {
  const invalid = await api("/api/teacher-salary-rules/apply-selected", {
    method: "POST",
    body: { lesson_ids: ["bad-id", 99999] },
  });
  assert.equal(invalid.response.status, 200);
  assert.equal(invalid.payload.failed_count, 2);
  assert.deepEqual(invalid.payload.results.map((item) => item.reason), ["无效课程ID", "课程不存在"]);
  const readonly = await api("/api/teacher-salary-rules/apply-selected", {
    cookie: teacherCookie,
    method: "POST",
    body: { lesson_ids: [9201] },
  });
  assert.equal(readonly.response.status, 403);
  const outOfScope = await api("/api/teacher-salary-rules/apply-selected", {
    cookie: academicCookie,
    method: "POST",
    body: { lesson_ids: [9207] },
  });
  assert.equal(outOfScope.response.status, 403);
  assert.match(outOfScope.payload.error, /无权更新所选课程/);
});

test("salary summary cache is invalidated after a valid batch write", async () => {
  resetJulySalaries();
  const beforeResult = await api(`/api/bootstrap?month=${MONTH}`);
  const before = beforeResult.payload.derived.teacher_summary.find((row) => row.teacher_name === "在职甲");
  const update = await api("/api/teacher-salary-rules/apply-selected", {
    method: "POST",
    body: { lesson_ids: [9201] },
  });
  assert.equal(update.payload.updated_count, 1);
  const afterResult = await api(`/api/bootstrap?month=${MONTH}`);
  const afterRow = afterResult.payload.derived.teacher_summary.find((row) => row.teacher_name === "在职甲");
  assert.equal(afterRow.salary_total - before.salary_total, 180);
});

test("legacy activation, JSON students, nonstandard duration and structured diagnostics work through API", async () => {
  const rows = await julyRows();
  assert.equal(rows.get(9211).rule_match_status, "matched");
  assert.equal(rows.get(9211).rule_salary, 200);
  assert.equal(rows.get(9212).rule_match_status, "rule_unavailable");
  assert.equal(rows.get(9212).rule_match_reason, "规则金额无效");
  assert.equal(rows.get(9213).rule_match_status, "ambiguous");
  assert.equal(rows.get(9213).rule_match_reason, "存在多条完全匹配的有效规则");
  assert.equal(rows.get(9214).rule_match_status, "calculation_error");
  assert.equal(rows.get(9214).rule_match_reason, "课程时长无法识别");
  assert.equal(rows.get(9215).rule_match_status, "matched");
  assert.equal(rows.get(9215).rule_salary, 180);
  assert.equal(rows.get(9215).rule_salary_per_2h, 240);
  assert.deepEqual(rows.get(9215).rule_match_diagnostics, {
    teacher: "匹配",
    grade: "匹配",
    subject: "匹配",
    students: "匹配",
    rule_status: "启用",
    rule_date: "有效",
    lesson_duration: "可计算",
    course_status: "参与计薪",
  });
});

test("ambiguous, unavailable and calculation-error rows are never batch-written", async () => {
  const beforeDb = new DatabaseSync(databasePath, { readOnly: true });
  const before = beforeDb.prepare("SELECT id,teacher_salary FROM lessons WHERE id IN (9212,9213,9214) ORDER BY id").all();
  beforeDb.close();
  const result = await api("/api/teacher-salary-rules/apply-selected", {
    method: "POST",
    body: { lesson_ids: [9212, 9213, 9214] },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.updated_count, 0);
  assert.equal(result.payload.skipped_count, 3);
  assert.deepEqual(result.payload.results.map((row) => row.reason), [
    "规则金额无效",
    "存在多条完全匹配的有效规则",
    "课程时长无法识别",
  ]);
  const afterDb = new DatabaseSync(databasePath, { readOnly: true });
  const afterRows = afterDb.prepare("SELECT id,teacher_salary FROM lessons WHERE id IN (9212,9213,9214) ORDER BY id").all();
  afterDb.close();
  assert.deepEqual(afterRows, before);
});

test("create, string amount update and disable are visible on the next detail request without restart", async () => {
  let rows = await julyRows();
  assert.equal(rows.get(9220).rule_match_status, "not_matched");
  const created = await api("/api/teacher-salary-rules", {
    method: "POST",
    body: {
      teacher_name: "在职甲",
      grade: "初三",
      subject: "生物",
      student_names: "王五",
      salary_per_unit: 220,
      unit_hours: 2,
      is_active: true,
    },
  });
  assert.equal(created.response.status, 201);
  rows = await julyRows();
  assert.equal(rows.get(9220).rule_salary, 220);
  const updated = await api(`/api/teacher-salary-rules/${created.payload.id}`, {
    method: "PUT",
    body: { salary_per_unit: "260.50", is_active: true },
  });
  assert.equal(updated.response.status, 200);
  rows = await julyRows();
  assert.equal(rows.get(9220).rule_salary, 260.5);
  const disabled = await api(`/api/teacher-salary-rules/${created.payload.id}`, { method: "DELETE" });
  assert.equal(disabled.response.status, 200);
  rows = await julyRows();
  assert.equal(rows.get(9220).rule_match_status, "rule_unavailable");
  assert.equal(rows.get(9220).rule_match_reason, "规则已停用");
});

test("teacher readonly account can see own rule result but cannot see out-of-scope lessons", async () => {
  const rows = await julyRows(teacherCookie);
  assert.equal(rows.get(9201).rule_match_status, "matched");
  assert.equal(rows.get(9201).rule_salary, 300);
  assert.equal(rows.has(9207), false);
  const write = await api("/api/teacher-salary-rules/apply-selected", {
    cookie: teacherCookie,
    method: "POST",
    body: { lesson_ids: [9201] },
  });
  assert.equal(write.response.status, 403);
});

test("diagnostics expose safe match states without SQL, paths or unrelated rule payloads", async () => {
  const rows = await julyRows();
  const payload = rows.get(9203);
  assert.equal(payload.rule_match_status, "not_matched");
  assert.equal(payload.rule_match_diagnostics.teacher, "匹配");
  assert.equal(payload.rule_match_diagnostics.grade, "匹配");
  assert.equal(payload.rule_match_diagnostics.subject, "不匹配");
  const serialized = JSON.stringify(payload.rule_match_diagnostics);
  assert.doesNotMatch(serialized, /SELECT|teacher_salary_rules|sqlite|stack|phone|guardian/i);
});

test("real Chromium keeps initial state empty, updates mixed results, and works at 1440px and 390px", async () => {
  resetJulySalaries();
  const db = new DatabaseSync(databasePath);
  db.exec("DELETE FROM lessons WHERE id=9208; DELETE FROM teachers WHERE name='历史无档案';");
  db.close();
  const chrome = await launchChrome(path.join(tempRoot, "chrome-profile"));
  const browser = chrome.session;
  try {
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await browser.login("boss", "123456");
    const rangeResponsesBefore = browser.responses.filter((item) => /\/api\/lessons-range\?.*view=teacherDetail/.test(item.url)).length;
    await openTeacherDetail(browser);
    await browser.waitFor("document.querySelector('.teacher-detail-table .empty')?.textContent.includes('请先选择教师')");
    assert.equal(await browser.evaluate("document.querySelector('.multi-select:has(input.teacher-detail-teacher-select) .multi-select-label')?.textContent.trim()"), "请选择教师");
    assert.equal(await browser.evaluate("document.querySelector('.apply-selected-teacher-salary-rules')?.disabled"), true);
    assert.equal(browser.responses.filter((item) => /\/api\/lessons-range\?.*view=teacherDetail/.test(item.url)).length, rangeResponsesBefore);
    const candidateNames = await browser.evaluate("[...document.querySelector('.multi-select:has(input.teacher-detail-teacher-select)').querySelectorAll('.multi-select-option')].map((item)=>item.dataset.value)");
    assert.deepEqual(candidateNames, ["在职甲", "在职乙"]);

    await selectTeacher(browser);
    assert.equal(browser.responses.some((item) => {
      const responseUrl = new URL(item.url);
      return responseUrl.pathname === "/api/lessons-range"
        && responseUrl.searchParams.get("view") === "teacherDetail"
        && responseUrl.searchParams.get("teacher_names") === "在职甲"
        && item.status === 200;
    }), true, JSON.stringify(browser.responses.filter((item) => item.url.includes("/api/lessons-range"))));
    assert.equal(await browser.evaluate("document.querySelector('.teacher-detail-table tbody tr')?.textContent.includes('300.00')"), true);
    const ruleCellText = await browser.evaluate("[...document.querySelectorAll('.teacher-rule-salary-cell')].map((cell)=>cell.textContent).join('|')");
    assert.match(ruleCellText, /未匹配/);
    assert.match(ruleCellText, /规则不可用/);
    assert.match(ruleCellText, /存在多条匹配规则/);
    assert.match(ruleCellText, /无法计算/);
    assert.match(ruleCellText, /当前状态不参与计薪/);
    assert.match(ruleCellText, /0\.00/);
    await browser.click(".teacher-rule-match-details summary");
    assert.match(await browser.evaluate("document.querySelector('.teacher-rule-match-details')?.textContent"), /教师.*年级.*科目.*学生集合/s);
    await browser.evaluate("window.confirm=()=>true");
    await browser.click(".teacher-salary-select-all");
    await browser.click(".apply-selected-teacher-salary-rules");
    await browser.waitFor("document.querySelector('.teacher-salary-batch-result')?.textContent.includes('更新4节，无需更新1节，跳过7节')");
    assert.equal(await browser.evaluate("document.querySelector('.teacher-salary-batch-result')?.textContent.includes('全部跳过')"), false);
    await browser.click(".teacher-salary-batch-details summary");
    const detailText = await browser.evaluate("document.querySelector('.teacher-salary-batch-details')?.textContent");
    assert.match(detailText, /未找到科目完全一致的规则/);
    assert.match(detailText, /规则已停用/);
    assert.match(detailText, /当前课程状态不参与教师计薪/);
    assert.equal(await browser.evaluate("document.querySelectorAll('.teacher-salary-lesson-select:checked').length"), 7);

    await browser.evaluate(`(() => {
      const select = document.querySelector('.month-select');
      select.value = '2026-08-01';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await browser.waitFor("document.querySelector('#topbar')?.textContent.includes('8月') && document.querySelector('input.teacher-detail-teacher-select')?.value === '在职甲' && document.body.textContent.includes('八月课程')");

    await browser.evaluate("(() => { const input=document.querySelector('input.teacher-detail-teacher-select'); input.value=''; input.dispatchEvent(new Event('change',{bubbles:true})); })()");
    await browser.waitFor("document.querySelector('.teacher-detail-table .empty')?.textContent.includes('请先选择教师')");
    assert.equal(await browser.evaluate("document.querySelector('.apply-selected-teacher-salary-rules')?.disabled"), true);
    assert.equal(await browser.evaluate("document.querySelectorAll('.teacher-salary-lesson-select:checked').length"), 0);

    await selectTeacher(browser);
    await browser.evaluate("setActiveView('dashboard'); load({ refreshGlobal: false })");
    await browser.waitFor("document.querySelector('#topbar')?.textContent.includes('首页')");
    await openTeacherDetail(browser);
    await browser.waitFor("document.querySelector('.teacher-detail-table .empty')?.textContent.includes('请先选择教师')");
    assert.equal(await browser.evaluate("document.querySelector('input.teacher-detail-teacher-select')?.value"), "");

    await selectTeacher(browser);
    await browser.send("Page.reload");
    await browser.waitFor("document.querySelector('.teacher-detail-table .empty')?.textContent.includes('请先选择教师')");
    assert.equal(await browser.evaluate("document.querySelector('input.teacher-detail-teacher-select')?.value"), "");

    await selectTeacher(browser);
    const inactiveDb = new DatabaseSync(databasePath);
    inactiveDb.prepare("UPDATE teachers SET status='离职' WHERE name='在职甲'").run();
    inactiveDb.close();
    await browser.evaluate(`(() => {
      const select = document.querySelector('.month-select');
      select.value = '2026-07-01';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await browser.waitFor("document.querySelector('.teacher-detail-table .empty')?.textContent.includes('请先选择教师') && document.querySelector('input.teacher-detail-teacher-select')?.value === ''");
    const restoreDb = new DatabaseSync(databasePath);
    restoreDb.prepare("UPDATE teachers SET status='在职' WHERE name='在职甲'").run();
    restoreDb.close();

    await browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.waitFor("window.innerWidth === 390");
    assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    assert.deepEqual(browser.exceptions, []);
    assert.deepEqual(browser.consoleErrors, []);
  } finally {
    await browser.close();
    if (chrome.child.exitCode == null) {
      const exited = new Promise((resolve) => chrome.child.once("exit", resolve));
      chrome.child.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
  }
});
