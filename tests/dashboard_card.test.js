const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");

const root = path.resolve(__dirname, "..");
const serverScript = path.join(root, "src", "server.js");

function localDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function waitForServer(server, port, stderr) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) throw new Error(`server exited: ${stderr()}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not start: ${stderr()}`);
}

function seedBase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    INSERT INTO teachers(id,name,status) VALUES (8101,'状态教师','在职');
    INSERT INTO students(id,name,grade,status) VALUES (8201,'状态学生甲','初一','在读'),(8202,'状态学生乙','初一','在读');
    INSERT INTO student_pricing(id,student_name,grade,subject,student_names,custom_price,notes)
      VALUES (8301,'状态学生甲','初一','数学','状态学生甲',188,'有效价格'),(8302,'状态学生乙','初一','英语','状态学生乙',0,'待设置价格');
    INSERT INTO teacher_salary_rules(id,teacher_name,grade,subject,student_names,salary_per_unit,unit_hours,is_active,notes)
      VALUES (8401,'状态教师','初一','数学','状态学生甲',220,2,1,'有效薪资'),
             (8402,'状态教师','初一','英语','状态学生乙',0,2,1,'零金额'),
             (8403,'状态教师','初二','物理','状态学生甲',330,2,-1,'明确停用');
  `);
  db.close();
}

function addCurrentLessons(dbPath, from, to) {
  const db = new DatabaseSync(dbPath);
  const insert = db.prepare(`
    INSERT INTO lessons(
      id,teacher_name,date,lesson_status,time_slot,classroom,grade,subject,
      student_names,notes,course_status,status,month_key,sort_order
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const date = localDateKey();
  const month = `${date.slice(0, 7)}-01`;
  for (let index = from; index <= to; index += 1) insert.run(
    8500 + index, index === 1 ? "姓名较长但仍需清晰显示的状态教师" : "状态教师", date, "上课", "00:00-23:59", index === 1 ? "名称较长的综合多媒体教室一号" : `教室${index}`,
    "初一", "数学", index === 1 ? "状态学生甲；状态学生乙；学生三；学生四；学生五；学生六" : (index % 2 ? "状态学生甲" : "状态学生乙"),
    `正在课程${index}`, "未上", "待上", month, index,
  );
  db.close();
}

async function withBrowser(action) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-dashboard-card-"));
  const database = path.join(tempRoot, "data.sqlite");
  const environment = { ...process.env, DATA_DIR: tempRoot, DB_PATH: database, SESSION_COOKIE_SECURE: "false", BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "" };
  const initialized = spawnSync(process.execPath, [serverScript, "--init-db"], { cwd: root, env: environment, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  seedBase(database);
  const port = await freePort(); let stderr = "";
  const server = spawn(process.execPath, [serverScript], { cwd: root, env: { ...environment, PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  server.stderr.on("data", (chunk) => { stderr += String(chunk); });
  let chrome;
  try {
    await waitForServer(server, port, () => stderr);
    chrome = await launchChrome(path.join(tempRoot, "chrome-profile"));
    await chrome.session.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await chrome.session.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await action({ browser: chrome.session, database });
  } finally {
    if (chrome) { await chrome.session.close(); if (chrome.child.exitCode == null) chrome.child.kill("SIGTERM"); }
    if (server.exitCode == null) server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
    try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {}
  }
}

async function openView(browser, group, view) {
  if (!await browser.evaluate(`Boolean(document.querySelector('.nav-sub-btn[data-view="${view}"]'))`)) await browser.click(`.nav-btn[data-nav-group="${group}"]`);
  await browser.waitFor(`Boolean(document.querySelector('.nav-sub-btn[data-view="${view}"]'))`);
  await browser.click(`.nav-sub-btn[data-view="${view}"]`);
}

async function dashboardMetrics(browser) {
  return browser.evaluate(`(() => {
    const card = document.querySelector('.dashboard-current-section');
    const head = card.querySelector('.section-head');
    const viewport = card.querySelector('.dashboard-current-viewport');
    const list = card.querySelector('.dashboard-current-list');
    const todo = document.querySelector('.dashboard-todo-section');
    const pies = document.querySelector('.dashboard-pie-section');
    const rect = card.getBoundingClientRect();
    return {
      height: rect.height, top: rect.top, bottom: rect.bottom,
      headHeight: head.getBoundingClientRect().height,
      viewportHeight: viewport.getBoundingClientRect().height,
      overflowY: list ? getComputedStyle(list).overflowY : 'none',
      overflowX: list ? getComputedStyle(list).overflowX : 'none',
      clientHeight: list?.clientHeight || 0, scrollHeight: list?.scrollHeight || 0,
      itemCount: list?.children.length || 0,
      todoTop: todo.getBoundingClientRect().top, todoBottom: todo.getBoundingClientRect().bottom,
      piesTop: pies.getBoundingClientRect().top, piesBottom: pies.getBoundingClientRect().bottom,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  })()`);
}

test("student and teacher rule pages share only set or unset visible price statuses", async () => withBrowser(async ({ browser }) => {
  await browser.login("boss", "123456");
  await openView(browser, "students", "studentPricing");
  await browser.waitFor("document.querySelectorAll('.student-pricing-rule-row').length === 2");
  assert.deepEqual(new Set(await browser.evaluate("[...document.querySelectorAll('.student-pricing-table .visible-price-status')].map((node)=>node.textContent.trim())")), new Set(["已设置", "未设置"]));
  assert.equal(await browser.evaluate("[...document.querySelectorAll('.student-pricing-table .visible-price-status')].every((node)=>node.classList.contains('visible-price-status'))"), true);

  await openView(browser, "teachers", "teacherSalaryRules");
  await browser.waitFor("document.querySelectorAll('.teacher-salary-rule-row').length === 3");
  assert.deepEqual((await browser.evaluate("[...document.querySelectorAll('.teacher-salary-rule-table .visible-price-status')].map((node)=>node.textContent.trim())")).reduce((counts, value) => ({ ...counts, [value]: (counts[value] || 0) + 1 }), {}), { 已设置: 2, 未设置: 1 });
  const visibleText = await browser.evaluate("document.querySelector('.teacher-salary-rule-table').closest('.band').textContent");
  assert.doesNotMatch(visibleText, /已停用|是否启用|enabled|disabled|\btrue\b|\bfalse\b/);
  assert.deepEqual(await browser.evaluate(`(() => { const input=document.querySelector('input.teacher-salary-rule-filter-input[data-filter-field="salary_status"]'); return [...input.closest('.multi-select').querySelectorAll('.multi-select-option')].map((node)=>node.dataset.value); })()`), ["已设置", "未设置"]);
  assert.equal(await browser.evaluate("document.querySelectorAll('.student-pricing-table .visible-price-status, .teacher-salary-rule-table .visible-price-status').length >= 3"), true);
  assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
}));

test("dashboard live-course card is stable for zero one six and twenty lessons with internal scrolling", async () => withBrowser(async ({ browser, database }) => {
  await browser.login("boss", "123456");
  await browser.waitFor("Boolean(document.querySelector('.dashboard-current-section .dashboard-current-empty'))");
  const zero = await dashboardMetrics(browser);
  assert.equal(zero.itemCount, 0); assert.equal(zero.height, 360); assert.equal(zero.pageOverflow, false);

  addCurrentLessons(database, 1, 1);
  await browser.evaluate("invalidateRequestCache(['/api/dashboard']); refreshDashboardForActiveMonth()");
  await browser.waitFor("document.querySelectorAll('.dashboard-current-item').length === 1");
  const one = await dashboardMetrics(browser);
  assert.ok(Math.abs(one.height - zero.height) <= 1); assert.equal(one.scrollHeight <= one.clientHeight, true);
  const oneLayout = await browser.evaluate(`(() => { const item=document.querySelector('.dashboard-current-item'); const nodes=[...item.querySelectorAll('.dashboard-current-top, .dashboard-current-fact, .dashboard-current-students, .entity-badge')]; const overlap=nodes.some((a,i)=>nodes.some((b,j)=>{ if(j<=i||a.contains(b)||b.contains(a)) return false; const x=a.getBoundingClientRect(),y=b.getBoundingClientRect(); return x.width>0&&y.width>0&&x.height>0&&y.height>0&&Math.min(x.right,y.right)-Math.max(x.left,y.left)>2&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>2; })); return { overlap, overflow:item.scrollWidth>item.clientWidth, visibleStudents:item.querySelectorAll('.dashboard-current-students .student-badge').length, more:item.querySelector('.dashboard-current-more')?.textContent||'' }; })()`);
  assert.equal(oneLayout.overlap, false); assert.equal(oneLayout.overflow, false); assert.equal(oneLayout.visibleStudents, 5); assert.equal(oneLayout.more, "等1人");

  addCurrentLessons(database, 2, 6);
  await browser.evaluate("invalidateRequestCache(['/api/dashboard']); refreshDashboardForActiveMonth()");
  await browser.waitFor("document.querySelectorAll('.dashboard-current-item').length === 6");
  const six = await dashboardMetrics(browser); assert.equal(six.itemCount, 6); assert.equal(six.overflowX, "hidden"); assert.equal(six.pageOverflow, false);

  addCurrentLessons(database, 7, 20);
  await browser.evaluate("invalidateRequestCache(['/api/dashboard']); refreshDashboardForActiveMonth()");
  await browser.waitFor("document.querySelectorAll('.dashboard-current-item').length === 20");
  const twenty = await dashboardMetrics(browser);
  assert.ok(Math.abs(twenty.height - zero.height) <= 1); assert.equal(twenty.itemCount, 20);
  assert.equal(twenty.overflowY, "auto"); assert.equal(twenty.overflowX, "hidden"); assert.ok(twenty.scrollHeight > twenty.clientHeight);
  assert.ok(Math.abs(twenty.top - twenty.todoTop) <= 1); assert.ok(Math.abs(twenty.bottom - twenty.todoBottom) <= 1);
  assert.ok(Math.abs(twenty.top - twenty.piesTop) <= 1); assert.ok(Math.abs(twenty.bottom - twenty.piesBottom) <= 1);
  const scrollResult = await browser.evaluate(`(() => { const head=document.querySelector('.dashboard-current-section .section-head'); const list=document.querySelector('.dashboard-current-list'); const before=head.getBoundingClientRect().top; list.scrollTop=list.scrollHeight; const last=list.lastElementChild.getBoundingClientRect(); const box=list.getBoundingClientRect(); return { before, after:head.getBoundingClientRect().top, scrollTop:list.scrollTop, lastVisible:last.bottom <= box.bottom + 1 && last.top >= box.top - 1 }; })()`);
  assert.equal(scrollResult.before, scrollResult.after); assert.ok(scrollResult.scrollTop > 0); assert.equal(scrollResult.lastVisible, true);
  const desktopScreenshot = await browser.send("Page.captureScreenshot", { format: "png", fromSurface: true }); assert.ok(desktopScreenshot.data.length > 1000);

  await browser.evaluate("renderViewTransitionSkeleton()");
  await browser.waitFor("document.querySelector('.dashboard-current-empty')?.textContent.includes('正在加载课程')");
  const loading = await dashboardMetrics(browser); assert.equal(loading.height, 360);
  await browser.evaluate("renderLoadFailure(new Error('合成首页故障'))");
  await browser.waitFor("document.querySelector('.dashboard-current-empty')?.textContent.includes('合成首页故障')");
  const failed = await dashboardMetrics(browser); assert.equal(failed.height, 360); assert.deepEqual(browser.exceptions, []);
  assert.equal(browser.consoleErrors.some((message) => message.includes('合成首页故障')), true);
  browser.consoleErrors.length = 0;
  await browser.evaluate("renderDashboard(); wireEvents()");
  await browser.waitFor("document.querySelectorAll('.dashboard-current-item').length === 20");

  await browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await browser.evaluate("window.dispatchEvent(new Event('resize'))");
  await browser.waitFor("document.querySelector('.dashboard-current-section').getBoundingClientRect().height === 320");
  const mobile = await dashboardMetrics(browser);
  assert.equal(mobile.height, 320); assert.equal(mobile.overflowY, "auto"); assert.equal(mobile.overflowX, "hidden"); assert.ok(mobile.scrollHeight > mobile.clientHeight); assert.equal(mobile.pageOverflow, false);
  assert.equal(await browser.evaluate("[...document.querySelectorAll('.dashboard-current-item')].every((item)=>item.scrollWidth<=item.clientWidth+1)"), true);
  const mobileScreenshot = await browser.send("Page.captureScreenshot", { format: "png", fromSurface: true }); assert.ok(mobileScreenshot.data.length > 1000);
  assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
}));
