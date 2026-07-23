const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");

const root = path.resolve(__dirname, "..");
const MONTH = "2026-07-01";
let tempRoot;
let databasePath;
let port;
let server;
let ownerCookie;
let teacherCookie;
let academicCookie;

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
      (9102,'在职甲','初一','英语','张三、李四',280,2,0,'停用规则'),
      (9103,'在职甲','初一','物理','张三、李四',0,2,1,'零金额按现有口径不可用');
    INSERT INTO lessons(id,teacher_name,date,lesson_status,time_slot,classroom,grade,subject,student_names,notes,course_status,status,teacher_salary,teacher_salary_source,teacher_salary_rule_id,month_key,sort_order) VALUES
      (9201,'在职甲','2026-07-01','上课','09:00-11:00','A1','初一','数学','张三； 李四','应更新','已上','已上',120,'manual',NULL,'2026-07-01',1),
      (9202,'在职甲','2026-07-02','上课','09:00-10:00','A1','初一','数学','李四、张三','已一致','已上','已上',150,'auto',9101,'2026-07-01',2),
      (9203,'在职甲','2026-07-03','上课','09:00-11:00','A1','初一','化学','张三、李四','无规则','已上','已上',80,'manual',NULL,'2026-07-01',3),
      (9204,'在职甲','2026-07-04','上课','09:00-11:00','A1','初一','英语','李四、张三','停用规则','已上','已上',80,'manual',NULL,'2026-07-01',4),
      (9205,'在职甲','2026-07-05','上课','09:00-11:00','A1','初一','物理','张三、李四','零金额规则','已上','已上',80,'manual',NULL,'2026-07-01',5),
      (9206,'在职甲','2026-07-06','上课','09:00-11:00','A1','初一','数学','张三、李四','未上课程','未上','待上',0,'empty',NULL,'2026-07-01',6),
      (9207,'在职乙','2026-07-07','上课','09:00-11:00','A2','初一','数学','张三、李四','权限外课程','已上','已上',10,'manual',NULL,'2026-07-01',7),
      (9210,'在职甲','2026-08-01','上课','09:00-11:00','A1','初一','数学','张三、李四','八月课程','已上','已上',300,'auto',9101,'2026-08-01',1);
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
  assert.equal(rows.get(9203).teacher_salary_rule_status, "no_match");
  assert.equal(rows.get(9204).teacher_salary_rule_status, "unavailable");
  assert.equal(rows.get(9205).teacher_salary_rule_status, "unavailable");
  assert.equal(rows.get(9206).teacher_salary_rule_status, "ineligible");
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
    { selected: 6, updated: 1, unchanged: 1, skipped: 4, failed: 0 },
  );
  assert.deepEqual(payload.results.map((item) => item.status), ["updated", "unchanged", "skipped", "skipped", "skipped", "skipped"]);
  assert.deepEqual(payload.results.slice(2).map((item) => item.reason), [
    "未找到匹配的教师薪资规则",
    "匹配规则当前不可用",
    "匹配规则当前不可用",
    "当前课程状态不参与教师计薪",
  ]);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const lesson = db.prepare("SELECT teacher_salary,teacher_salary_source,teacher_salary_rule_id FROM lessons WHERE id=9201").get();
  assert.deepEqual({ ...lesson }, { teacher_salary: 300, teacher_salary_source: "auto", teacher_salary_rule_id: 9101 });
  const log = db.prepare("SELECT operation_content,extra_json FROM operation_logs WHERE operation_type='按规则更新教师薪资' ORDER BY id DESC LIMIT 1").get();
  db.close();
  assert.match(log.operation_content, /所选 6 条，更新 1 条，无需更新 1 条，跳过 4 条/);
  assert.deepEqual(JSON.parse(log.extra_json), {
    selected_count: 6,
    updated_count: 1,
    unchanged_count: 1,
    skipped_count: 4,
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
    await browser.evaluate("window.confirm=()=>true");
    await browser.click(".teacher-salary-select-all");
    await browser.click(".apply-selected-teacher-salary-rules");
    await browser.waitFor("document.querySelector('.teacher-salary-batch-result')?.textContent.includes('更新1节，无需更新1节，跳过4节')");
    assert.equal(await browser.evaluate("document.querySelector('.teacher-salary-batch-result')?.textContent.includes('全部跳过')"), false);
    await browser.click(".teacher-salary-batch-details summary");
    const detailText = await browser.evaluate("document.querySelector('.teacher-salary-batch-details')?.textContent");
    assert.match(detailText, /未找到匹配的教师薪资规则/);
    assert.match(detailText, /匹配规则当前不可用/);
    assert.match(detailText, /当前课程状态不参与教师计薪/);
    assert.equal(await browser.evaluate("document.querySelectorAll('.teacher-salary-lesson-select:checked').length"), 4);

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
