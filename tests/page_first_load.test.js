const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");

const root = path.resolve(__dirname, "..");
const MONTH = "2026-07-01";

async function waitForServer(server, port, stderr) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) throw new Error(`server exited: ${stderr()}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not start: ${stderr()}`);
}

function seed(db) {
  db.exec(`
    UPDATE settings SET value='${MONTH}' WHERE key='month_key';
    INSERT INTO teachers(id,name,status) VALUES (7101,'首次加载老师','在职');
    INSERT INTO students(id,name,grade,status) VALUES (7201,'首次加载学生','初一','在读');
    INSERT INTO student_pricing(id,student_name,grade,subject,student_names,custom_price,notes) VALUES (7301,'首次加载学生','初一','数学','首次加载学生',188.50,'首次加载单价');
    UPDATE pricing_standards SET unit_price=166.00,description='首次加载规则' WHERE grade='初一' AND student_count=1;
    INSERT INTO lessons(id,teacher_name,date,lesson_status,time_slot,classroom,grade,subject,student_names,notes,course_status,status,teacher_salary,teacher_salary_source,month_key,sort_order)
      VALUES (7501,'首次加载老师','2026-07-08','上课','09:00-11:00','A1','初一','数学','首次加载学生','首次加载课程','已上','已上',220.00,'manual','2026-07-01',1);
    INSERT INTO recharge_records(id,student_name,grade,cur_recharge,cur_gift,recharge_date,notes,source,month_key) VALUES (7601,'首次加载学生','初一',1000,100,'2026-07-03','首次加载充值','manual','2026-07-01');
    INSERT INTO student_opening_balances(id,month_key,student_name,grade,opening_actual_balance,opening_gift_balance,notes) VALUES (7701,'','首次加载学生','初一',500,50,'全局期初余额');
    INSERT INTO teacher_travel_fees(id,month_key,teacher_name,week_index,week_start,week_end,amount,notes) VALUES (7801,'2026-07-01','首次加载老师',1,'2026-07-01','2026-07-07',30,'首次加载车费');
    INSERT INTO lessons(id,teacher_name,date,lesson_status,time_slot,classroom,grade,subject,student_names,notes,course_status,status,teacher_salary,teacher_salary_source,month_key,sort_order)
      VALUES (7502,'首次加载老师','2026-08-08','上课','09:00-11:00','A2','初一','数学','首次加载学生','八月课程','已上','已上',230.00,'manual','2026-08-01',1);
  `);
}

async function withBrowser(action) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-first-view-"));
  const database = path.join(tempRoot, "data.sqlite");
  const environment = { ...process.env, DATA_DIR: tempRoot, DB_PATH: database, SESSION_COOKIE_SECURE: "false", BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "", BACKUP_ENCRYPTION_KEY: "" };
  const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], { cwd: root, env: environment, encoding: "utf8" }); assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(database); seed(db); db.close();
  const port = await freePort(); let stderr = "";
  const server = spawn(process.execPath, [path.join(root, "src/server.js")], { cwd: root, env: { ...environment, PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"], windowsHide: true }); server.stderr.on("data", (chunk) => { stderr += String(chunk); });
  let chrome;
  try {
    await waitForServer(server, port, () => stderr); chrome = await launchChrome(path.join(tempRoot, "chrome-profile")); await chrome.session.send("Page.navigate", { url: `http://127.0.0.1:${port}/` }); await action(chrome.session);
  } finally {
    if (chrome) { await chrome.session.close(); if (chrome.child.exitCode == null) chrome.child.kill("SIGTERM"); }
    if (server.exitCode == null) server.kill("SIGTERM"); await new Promise((resolve) => setTimeout(resolve, 200));
    try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {}
  }
}

async function openView(browser, group, view) {
  if (!await browser.evaluate(`Boolean(document.querySelector('.nav-sub-btn[data-view="${view}"]'))`)) await browser.click(`.nav-btn[data-nav-group="${group}"]`);
  await browser.waitFor(`Boolean(document.querySelector('.nav-sub-btn[data-view="${view}"]'))`);
  await browser.click(`.nav-sub-btn[data-view="${view}"]`);
}

const scenarios = [
  { name: "费用汇总", group: "students", view: "summary", title: "学生费用汇总", row: ".student-summary-table tbody tr:not(.empty)", text: "首次加载学生" },
  { name: "费用明细", group: "students", view: "feeDetails", title: "学生费用明细", row: ".fee-detail-table tbody tr:not(.empty)", text: "首次加载课程" },
  { name: "学生单价", group: "students", view: "studentPricing", title: "学生单价规则", row: ".student-pricing-rule-row", text: "首次加载学生" },
  { name: "教师薪资汇总", group: "teachers", view: "teacherSalary", title: "薪资汇总", row: ".teacher-salary-summary-row", text: "首次加载老师" },
  { name: "教师车费明细", group: "teachers", view: "teacherTravelFees", title: "车费明细", row: ".teacher-travel-fee-row", text: "首次加载老师" },
];

for (const scenario of scenarios) test(`${scenario.name} from a fresh home session loads current data on first click`, async () => withBrowser(async (browser) => {
  await browser.login("boss", "123456");
  assert.equal(await browser.evaluate("document.querySelector('#topbar')?.textContent.includes('首页')"), true);
  await openView(browser, scenario.group, scenario.view);
  await browser.waitFor(`document.querySelector('#topbar')?.textContent.includes(${JSON.stringify(scenario.title)}) && document.querySelectorAll(${JSON.stringify(scenario.row)}).length > 0 && document.body.textContent.includes(${JSON.stringify(scenario.text)})`);
  assert.equal(await browser.evaluate("document.querySelector('.month-select')?.value || '2026-07-01'"), MONTH);
  assert.equal(browser.responses.some((response) => /\/api\/bootstrap\?/.test(response.url) && /month=2026-07-01/.test(response.url) && response.status === 200), true, JSON.stringify(browser.responses));
  assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  await openView(browser, "home", "dashboard"); await browser.waitFor("document.querySelector('#topbar')?.textContent.includes('首页')");
  await openView(browser, scenario.group, scenario.view); await browser.waitFor(`document.querySelectorAll(${JSON.stringify(scenario.row)}).length > 0`);
  assert.deepEqual(browser.exceptions, []);
}));

test("month switching refreshes the full-bootstrap cache without stale fee details", async () => withBrowser(async (browser) => {
  await browser.login("boss", "123456"); await openView(browser, "students", "feeDetails");
  await browser.waitFor("document.body.textContent.includes('首次加载课程')");
  await browser.evaluate("(() => { const select=document.querySelector('.month-select'); select.value='2026-08-01'; select.dispatchEvent(new Event('change',{bubbles:true})); })()");
  await browser.waitFor("document.querySelector('#topbar')?.textContent.includes('8月') && document.body.textContent.includes('八月课程') && !document.body.textContent.includes('首次加载课程')");
  await browser.evaluate("(() => { const select=document.querySelector('.month-select'); select.value='2026-07-01'; select.dispatchEvent(new Event('change',{bubbles:true})); })()");
  await browser.waitFor("document.querySelector('#topbar')?.textContent.includes('7月') && document.body.textContent.includes('首次加载课程') && !document.body.textContent.includes('八月课程')");
  assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
}));

test("fee and teacher detail headers and row cells share the approved column order", async () => withBrowser(async (browser) => {
  await browser.login("boss", "123456"); await openView(browser, "students", "feeDetails");
  await browser.waitFor("document.querySelectorAll('.fee-detail-table tbody tr:not(.empty)').length > 0");
  assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.fee-detail-table thead th')].map((cell)=>cell.textContent.trim()||'选择')"), ["选择", "学生姓名", "授课老师", "日期", "星期", "时间", "教室", "状态", "年级", "科目", "备注", "单人费用", "规则费用"]);
  assert.equal(await browser.evaluate("document.querySelector('.fee-detail-table tbody tr')?.children.length"), 13);
  assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.fee-detail-scroll')).overflowX !== 'visible'"), true);
  await openView(browser, "teachers", "teacherDetail"); await browser.waitFor("document.querySelectorAll('.teacher-detail-table tbody tr:not(.empty)').length > 0");
  assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.teacher-detail-table thead th')].map((cell)=>cell.textContent.trim()||'选择')"), ["选择", "授课老师", "日期", "星期", "时间", "教室", "状态", "年级", "科目", "学生", "备注", "教师薪资", "规则薪资"]);
  assert.equal(await browser.evaluate("document.querySelector('.teacher-detail-table tbody tr')?.children.length"), 13);
  assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
}));
