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
let tableId;
const table = formula => ({ effective_start: '2026-09-01', effective_end: '2026-09-30', rules: [{ grade: '高一', course_type: '小班课', formula }] });
const workflowPath = '/api/teacher-detail/workflow?start=2026-09-01&end=2026-09-30&teacher=' + encodeURIComponent('合成教师');
async function summary() {
  const result = await api('/api/bootstrap?month=2026-09-01');
  assert.equal(result.response.status, 200);
  return result.payload.derived.teacher_summary.find(row => row.teacher_name === '合成教师');
}

test('synthetic 6000-course workflow queries dates and teachers and stays responsive across three salary tables', async () => {
  const db = new DatabaseSync(databasePath);
  db.exec('BEGIN');
  const teacher = db.prepare("INSERT INTO teachers(name,status) VALUES(?,'在职')");
  const lesson = db.prepare("INSERT INTO lessons(teacher_name,date,month_key,time_slot,grade,subject,course_type,student_names,status,teacher_salary,teacher_salary_source) VALUES(?,?,?,'13:00-15:00','高一','数学','小班课',?,'已上',0,'auto')");
  for (let n = 0; n < 8; n++) {
    const name = `性能教师${n}`; teacher.run(name);
    for (let i = 0; i < 750; i++) {
      const month = ['2026-10', '2026-11', '2026-12'][i % 3];
      lesson.run(name, `${month}-${String(i % 28 + 1).padStart(2, '0')}`, `${month}-01`, `合成${i % 25}甲、合成${i % 25}乙、合成${i % 25}丙`);
    }
  }
  db.exec('COMMIT');
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM lessons WHERE teacher_name=? AND date BETWEEN ? AND ?').all('性能教师0', '2026-10-01', '2026-12-31');
  assert.match(JSON.stringify(plan), /idx_lessons_teacher_date_salary/); db.close();
  for (const [start, end] of [['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30'], ['2026-12-01', '2026-12-31']]) {
    const saved = await api('/api/salary-tables', { method: 'POST', body: { ...table('60+30(n-1)+40K'), effective_start: start, effective_end: end } });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.payload));
  }
  const started = performance.now();
  const response = await api('/api/teacher-detail/workflow?' + new URLSearchParams({ teacher: '性能教师0', start: '2026-10-01', end: '2026-12-31' }));
  assert.equal(response.payload.lessons.length, 750); assert.equal(response.payload.classes.length, 25); assert.equal(response.payload.tables.length, 3);
  assert.ok(performance.now() - started < 2000, 'scoped API should finish within 2 seconds');
  const classStarted = performance.now();
  const allClasses = await api('/api/class-groups');
  assert.equal(allClasses.response.status, 200);
  assert.ok(allClasses.payload.class_groups.reduce((sum, row) => sum + row.course_count, 0) >= 6000);
  assert.ok(allClasses.payload.class_groups.every(row => row.lesson_ids.length === row.course_count && !Object.hasOwn(row, 'lessons')));
  assert.ok(performance.now() - classStarted < 2000, 'class aggregation returns IDs/counts in one request');
  const chrome = await launchChrome(path.join(tempRoot, 'performance-chrome')); const browser = chrome.session;
  try {
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await browser.login('boss', '123456');
    await browser.evaluate("window.salaryLongTasks=[];new PerformanceObserver(list=>window.salaryLongTasks.push(...list.getEntries().map(entry=>entry.duration))).observe({type:'longtask'});");
    await browser.evaluate("setActiveView('teacherDetail');load({refreshGlobal:false})");
    await browser.waitFor("Boolean(document.querySelector('.teacher-class-summary-table'))");
    await browser.evaluate("SalaryUI.applyRange('teacher-detail-salary','2026-10-01','2026-12-31')");
    await browser.waitFor("document.querySelector('[data-range-scope=teacher-detail-salary]')?.dataset.end==='2026-12-31'");
    for (const name of ['性能教师0', '性能教师1']) {
      await browser.evaluate(`(()=>{const input=document.querySelector('input.teacher-detail-teacher-select');input.value=${JSON.stringify(name)};input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await browser.waitFor("document.querySelectorAll('[data-salary-class]').length===25");
      await browser.click('[data-salary-class]');
      await browser.waitFor("document.querySelectorAll('.teacher-class-lessons tbody tr').length===30");
      await browser.click('[data-salary-action=close]');
    }
    await browser.evaluate("SalaryUI.applyRange('teacher-detail-salary','2026-11-01','2026-11-30')");
    await browser.waitFor("document.querySelector('.filter-summary')?.textContent.includes('250 节课程')");
    await browser.evaluate("activeMonth='2026-11-01';setActiveView('teacherSalary');load({refreshGlobal:true})");
    await browser.waitFor("Boolean(document.querySelector('.salary-coefficient-input[data-teacher=\"性能教师1\"]'))");
    await browser.evaluate(`(()=>{const input=document.querySelector('.salary-coefficient-input[data-teacher="性能教师1"]');input.value='0.85';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await browser.waitFor("document.querySelector('.salary-coefficient-input[data-teacher=\"性能教师1\"]')?.value==='0.85'");
    const timings = await browser.evaluate('window.salaryLongTasks');
    assert.ok(Math.max(0, ...timings) < 500, `long task exceeded 500ms: ${JSON.stringify(timings)}`);
    assert.deepEqual(browser.exceptions, []);
  } finally { await browser.close(); chrome.child.kill('SIGTERM'); }
});

test('new salary table drives class grouping, duration, missing K, travel and refreshed totals', async () => {
  assert.equal((await summary()).total_salary, 1290);
  const created = await api('/api/salary-tables', { method: 'POST', body: table('60+30(n-1)+40K') });
  assert.equal(created.response.status, 200, JSON.stringify(created.payload));
  tableId = created.payload.id;
  const grouped = await api(workflowPath);
  assert.equal(grouped.payload.classes.length, 1);
  assert.equal(grouped.payload.lessons.length, 10);
  assert.equal(grouped.payload.lessons[0].salary_rule_expression, '210+40K');
  let row = await summary();
  assert.equal(row.base_salary, 2100); assert.equal(row.performance_base, 400);
  assert.equal(row.transport_total, 300); assert.equal(row.total_salary, null);
  assert.equal(row.salary_pending_reason, '待设置系数');
  const changed = await api('/api/teacher-monthly-performance', { method: 'PUT', body: { teacher_name: '合成教师', month_key: '2026-09-01', coefficient: 0.85 } });
  assert.equal(changed.response.status, 200, JSON.stringify(changed.payload));
  row = await summary();
  assert.equal(row.performance_actual, 340); assert.equal(row.total_salary, 2740);
  assert.equal(row.lesson_count, 10);
  const finance = await api('/api/finance-summary?start=2026-09-01&end=2026-09-30');
  assert.equal(finance.response.status, 200, JSON.stringify(finance.payload));
  assert.equal(finance.payload.overview.teacher_cost.current, 2440, 'finance uses base plus performance once, excluding travel');
  const exported = await fetch(`http://127.0.0.1:${port}/api/export/teacher-salary.xlsx?month=2026-09-01`, { headers: { cookie: ownerCookie } });
  assert.equal(exported.status, 200);
  const workbook = require('../src/excel/xlsx_codec').parseWorkbook(Buffer.from(await exported.arrayBuffer()));
  assert.deepEqual(workbook.sheets[0].rows[1], ['序号','教师姓名','上课课时数','基础课薪','月度绩效','绩效系数','车票合计','薪资合计','备注']);
  assert.equal(workbook.sheets[0].rows[2][7], 2740);
});

test('new mutations honor readonly and teacher scope and never expose other teacher data', async () => {
  assert.equal((await api('/api/salary-tables', { cookie: academicCookie, method: 'POST', body: table('300') })).response.status, 403);
  assert.equal((await api('/api/salary-tables', { cookie: teacherCookie, method: 'POST', body: table('300') })).response.status, 403);
  assert.equal((await api('/api/teacher-detail/salary/1', { cookie: teacherCookie, method: 'PATCH', body: { source: 'manual', amount: 230 } })).response.status, 403);
  assert.equal((await api(workflowPath, { cookie: teacherCookie })).response.status, 200);
  assert.equal((await api(workflowPath.replace(encodeURIComponent('合成教师'), encodeURIComponent('其他教师')), { cookie: teacherCookie })).response.status, 403);
  assert.equal((await api('/api/teacher-monthly-performance', { cookie: academicCookie, method: 'PUT', body: { teacher_name: '其他教师', month_key: '2026-09-01', coefficient: 1 } })).response.status, 403);
  assert.equal((await api('/api/salary-tables', { method: 'POST', body: table('K*K') })).response.status, 400);
  assert.equal((await api('/api/salary-tables', { method: 'POST', body: table('300') })).response.status, 400);
});

test('profile removal keeps payroll history and cleans unused coefficients before a name can be reused', async () => {
  await api('/api/teacher-monthly-performance', { method: 'PUT', body: { teacher_name: '其他教师', month_key: '2026-09-01', coefficient: 0.5 } });
  assert.equal((await api('/api/teachers/9002', { method: 'DELETE' })).response.status, 200);
  const db = new DatabaseSync(databasePath);
  try { assert.equal(db.prepare("SELECT COUNT(*) AS n FROM teacher_monthly_performance WHERE teacher_name='其他教师'").get().n, 0); }
  finally { db.close(); }
});

test('special values survive edits, reset follows rules, and deletion requires fresh impact confirmation', async () => {
  assert.equal((await api('/api/teacher-detail/salary/1', { method: 'PATCH', body: { source: 'manual', amount: 230 } })).response.status, 200);
  assert.equal((await api(`/api/salary-tables/${tableId}`, { method: 'PUT', body: table('220+40K') })).response.status, 200);
  let data = (await api(workflowPath)).payload;
  assert.equal(data.lessons[0].teacher_base_salary, 230); assert.equal(data.lessons[0].rule_base_salary, 220);
  assert.equal((await summary()).base_salary, 2210);
  await api('/api/teacher-detail/salary/1', { method: 'PATCH', body: { source: 'auto' } });
  assert.equal((await summary()).base_salary, 2200);
  assert.equal((await api(`/api/salary-tables/${tableId}`, { method: 'DELETE', body: {} })).response.status, 400);
  const impact = (await api(`/api/salary-tables/${tableId}/impact`)).payload;
  assert.equal(impact.affected, 10);
  assert.equal((await api(`/api/salary-tables/${tableId}`, { method: 'DELETE', body: { ...impact, confirm: true } })).response.status, 200);
  assert.equal((await summary()).total_salary, 1290);
});

test('Chromium salary workflow renders four widths and supports table editor and class dialog', async () => {
  const chrome = await launchChrome(path.join(tempRoot, 'salary-chrome'));
  const browser = chrome.session;
  try {
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await browser.login('boss', '123456');
    await browser.click('.nav-btn[data-nav-group="teachers"]');
    await browser.waitFor("Boolean(document.querySelector('.nav-sub-btn[data-view=\"teacherDetail\"]'))");
    await browser.click('.nav-sub-btn[data-view="teacherDetail"]');
    await browser.waitFor("Boolean(document.querySelector('.teacher-class-summary-table'))");
    await browser.evaluate(`(() => {const input=document.querySelector('input.teacher-detail-teacher-select');input.value='合成教师';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await browser.waitFor("document.querySelectorAll('[data-salary-class]').length === 1");
    for (const width of [1920, 1440, 1024, 390]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await browser.click('[data-salary-class]');
      await browser.waitFor("document.querySelectorAll('.teacher-class-lessons tbody tr').length === 10");
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2'), true);
      await browser.click('[data-salary-action="close"]');
    }
    await browser.click('[data-salary-class]');
    await browser.evaluate(`(()=>{const input=document.querySelector('.salary-base-input[data-id="1"]');input.value='230';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await browser.waitFor("Boolean(document.querySelector('.salary-special .salary-base-input[data-id=\"1\"]'))");
    assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.salary-special .currency-display')).color"), 'rgb(198, 40, 40)');
    await browser.click('[data-salary-action="close"]');
    await browser.click('[data-salary-action="tables"]');
    await browser.waitFor("Boolean(document.querySelector('[data-salary-action=new]'))");
    await browser.click('[data-salary-action="new"]');
    assert.equal(await browser.evaluate("document.querySelectorAll('.salary-formula-table tbody tr').length"), 6);
    assert.equal(await browser.evaluate("document.querySelectorAll('.salary-formula-input[data-type=\"1V3\"]').length"), 3);
    await browser.evaluate(`(()=>{const input=document.querySelector('.salary-formula-input[data-grade="高一"][data-type="小班课"]');input.value='60+30(n-1)+40K';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.equal(await browser.evaluate("document.querySelector('[data-salary-preview=\"高一\"]').textContent"), '210+40K');
    await browser.evaluate("request('/api/auth/logout',{method:'POST'}).then(()=>{auth.user=null;renderLogin();})");
    assert.equal(await browser.evaluate("document.querySelectorAll('.salary-workflow-modal').length"), 0, 'salary dialog must not survive logout');
  } finally { browser.close(); chrome.child.kill('SIGTERM'); }
});

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
  const hash = db.prepare("SELECT password_hash FROM users WHERE username='boss'").get().password_hash;
  db.exec(`UPDATE settings SET value='2026-09-01' WHERE key='month_key';
    INSERT INTO teachers(id,name,status) VALUES(9001,'合成教师','在职'),(9002,'其他教师','在职'),(9003,'离职教师','离职');
    INSERT INTO teacher_adjustments_monthly(teacher_name,month_key,week1_transport) VALUES('合成教师','2026-09-01',300);`);
  const insert = db.prepare("INSERT INTO lessons(teacher_name,date,month_key,time_slot,grade,subject,course_type,student_names,status,teacher_salary,teacher_salary_source) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
  for(let i=1;i<=10;i++) insert.run('合成教师',`2026-09-${String(i).padStart(2,'0')}`,'2026-09-01','09:00-11:00','高一','数学','小班课',i%2?'甲、乙、丙、丁、戊、己':'己、戊、丁、丙、乙、甲','已上',99,'auto');
  const account=db.prepare("INSERT INTO users(username,display_name,role,teacher_name,password_hash,status) VALUES(?,?,?,?,?,'active')");
  account.run('salary-readonly','只读教师','teacher','合成教师',hash);
  account.run('salary-academic','范围教务','academic','',hash);
  db.exec(`INSERT INTO role_filter_presets(role_code,view_key,filter_key,filter_value_json) VALUES('academic','teacherDetail','teacher_names','["合成教师"]');`);
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
  teacherCookie = await login("salary-readonly");
  academicCookie = await login("salary-academic");

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
