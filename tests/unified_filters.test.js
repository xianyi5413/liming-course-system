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
    INSERT INTO teachers(id,name,status) VALUES (8101,'统一筛选老师','在职'),(8102,'离职筛选老师','离职');
    INSERT INTO students(id,name,grade,status) VALUES (8201,'张三','初一','在读'),(8202,'李四','初一','在读'),(8203,'王五','初二','在读'),(8204,'赵六','初二','离校');
    INSERT INTO student_pricing(id,student_name,grade,subject,student_names,custom_price,notes) VALUES
      (8301,'张三','初一','数学','张三；李四',188,'记录A'),
      (8302,'李四','初二','英语','王五；赵六',199,'记录B');
    INSERT INTO class_groups(id,teacher,grade,subject,students_key,students_display,class_name) VALUES (8401,'统一筛选老师','初一','数学','张三|李四','张三；李四','统一筛选班级');
    INSERT INTO teacher_salary_rules(id,teacher_name,grade,subject,student_names,salary_per_unit,unit_hours,is_active,notes) VALUES (8501,'统一筛选老师','初一','数学','张三；李四',220,2,1,'统一筛选规则');
    INSERT INTO recharge_records(id,student_name,grade,cur_recharge,cur_gift,recharge_date,notes,source,month_key) VALUES (8701,'张三','初一',1000,100,'2026-07-03','统一筛选充值','manual','2026-07-01');
    INSERT INTO recharge_records(id,student_name,grade,cur_recharge,cur_gift,recharge_date,notes,source,month_key) VALUES (8702,'张三','初一',100,0,'2026-08-03','八月充值','manual','2026-08-01');
    INSERT INTO student_opening_balances(id,student_name,grade,opening_actual_balance,opening_gift_balance,notes) VALUES (8801,'张三','初一',500,50,'全局期初余额');
  `);
}

async function withBrowser(action) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-unified-filter-"));
  const database = path.join(tempRoot, "synthetic.sqlite");
  const environment = { ...process.env, DATA_DIR: tempRoot, DB_PATH: database, SESSION_COOKIE_SECURE: "false", BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "" };
  const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], { cwd: root, env: environment, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(database); seed(db); db.close();
  const port = await freePort(); let stderr = "";
  const server = spawn(process.execPath, [path.join(root, "src/server.js")], { cwd: root, env: { ...environment, PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  server.stderr.on("data", (chunk) => { stderr += String(chunk); });
  let chrome;
  try {
    await waitForServer(server, port, () => stderr);
    chrome = await launchChrome(path.join(tempRoot, "chrome-profile"));
    await chrome.session.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await action(chrome.session);
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
  await browser.waitFor(`document.querySelectorAll('.unified-filter-field .lesson-filter-select').length > 0`);
  const stableRows = { recharges: ".recharge-row", openingBalances: ".opening-balance-row", studentPricing: ".student-pricing-rule-row", classGroups: ".class-group-row", studentProfiles: ".profile-row[data-kind=\"students\"]", teacherSalaryRules: ".teacher-salary-rule-row", teacherProfiles: ".profile-row[data-kind=\"teachers\"]" };
  if (stableRows[view]) await browser.waitFor(`document.querySelectorAll(${JSON.stringify(stableRows[view])}).length > 0`);
}

const filterViews = [
  ["students", "recharges", "充值记录"], ["students", "summary", "费用汇总"],
  ["students", "feeDetails", "费用明细"], ["students", "openingBalances", "期初余额"],
  ["students", "studentPricing", "学生单价"], ["students", "classGroups", "班级管理"],
  ["students", "studentProfiles", "学生档案"], ["teachers", "teacherDetail", "教师课时明细"],
  ["teachers", "teacherSalaryRules", "教师薪资规则"], ["teachers", "teacherProfiles", "教师档案"],
];

test("all ten pages reuse the course-list searchable filter control without overflow or stale menus", async () => withBrowser(async (browser) => {
  await browser.login("boss", "123456");
  for (const [group, view, label] of filterViews) {
    await openView(browser, group, view);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const details = await browser.evaluate(`(() => {
      const controls=[...document.querySelectorAll('.unified-filter-field .multi-select')];
      return { count: controls.length, valid: controls.every((item) => item.querySelector('.multi-select-toggle.lesson-filter-select') && item.querySelector('.multi-select-search') && item.querySelector('.multi-select-clear')), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    })()`);
    assert.ok(details.count > 0, `${label} has no unified filters`);
    assert.equal(details.valid, true, `${label} does not reuse the common searchable control`);
    assert.equal(details.overflow, false, `${label} overflows horizontally`);
    await browser.evaluate("document.querySelector('.unified-filter-field .multi-select:not(.has-value)')?.scrollIntoView({block:'center'})");
    await browser.click(".unified-filter-field .multi-select:not(.has-value) .multi-select-label");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const opened = await browser.evaluate("(() => { const target=document.querySelector('.unified-filter-field .multi-select.open'); return { expanded: target?.querySelector('.multi-select-toggle')?.getAttribute('aria-expanded'), open: Boolean(target), floating: Boolean(document.querySelector('.floating-multi-select-menu')), bound: target?.dataset.multiSelectBound || '' }; })()");
    assert.deepEqual(opened, { expanded: "true", open: true, floating: true, bound: "true" }, `${label} menu did not open: ${JSON.stringify({ opened, exceptions: browser.exceptions, consoleErrors: browser.consoleErrors })}`);
    assert.equal(await browser.evaluate("document.querySelector('.unified-filter-field .multi-select.open .multi-select-toggle')?.getAttribute('aria-expanded')"), "true");
    await browser.evaluate("document.querySelector('.floating-multi-select-menu .multi-select-search')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await browser.waitFor("!document.querySelector('.unified-filter-field .multi-select.open')");
  }
  assert.deepEqual(browser.exceptions, []);
  assert.deepEqual(browser.consoleErrors, []);
}));

test("student-pricing student filter matches only student_name and supports search keyboard selection and clear", async () => withBrowser(async (browser) => {
  await browser.login("boss", "123456"); await openView(browser, "students", "studentPricing");
  await browser.waitFor("document.querySelectorAll('.student-pricing-rule-row').length === 2");
  const choose = async (name) => {
    await browser.evaluate("document.querySelector('.student-pricing-filter-input.multi-select-toggle')?.scrollIntoView({block:'center'})");
    await browser.click('.student-pricing-filter-input.multi-select-toggle .multi-select-label');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.student-pricing-filter-bar .multi-select.open'))"), true);
    await browser.evaluate(`(() => { const input=document.querySelector('.floating-multi-select-menu .multi-select-search'); input.value=${JSON.stringify(name)}; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
    await browser.waitFor(`document.querySelector('.student-pricing-filter-input.multi-select-value[data-filter-field="student"]')?.value === ${JSON.stringify(name)}`);
  };
  const visible = () => browser.evaluate("[...document.querySelectorAll('.student-pricing-rule-row')].filter((row)=>getComputedStyle(row).display!=='none').map((row)=>({text:row.textContent,notes:row.querySelector('[data-field=\"notes\"]')?.value||''}))");
  await choose("张三"); assert.equal((await visible()).length, 1); assert.equal((await visible())[0].notes, "记录A");
  await browser.click('.student-pricing-filter-input.multi-select-toggle .multi-select-clear-icon');
  await browser.waitFor("document.querySelectorAll('.student-pricing-rule-row').length === 2");
  await choose("李四"); assert.equal((await visible()).length, 1); assert.equal((await visible())[0].notes, "记录B");
  await browser.click('.student-pricing-filter-input.multi-select-toggle .multi-select-clear-icon');
  await browser.click('.student-pricing-filter-input.multi-select-toggle .multi-select-label');
  await browser.evaluate("(() => { const input=document.querySelector('.floating-multi-select-menu .multi-select-search'); input.value='王五'; input.dispatchEvent(new Event('input',{bubbles:true})); })()");
  assert.equal(await browser.evaluate("[...document.querySelectorAll('.floating-multi-select-menu .multi-select-option')].some((item)=>!item.hidden && item.dataset.value==='王五')"), false);
  await browser.evaluate("document.querySelector('.floating-multi-select-menu .multi-select-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
}));

test("opening balances have no month UI and remain unchanged when the top month changes", async () => withBrowser(async (browser) => {
  await browser.login("boss", "123456"); await openView(browser, "students", "openingBalances");
  const before = await browser.evaluate("document.querySelector('.opening-balance-table tbody')?.textContent.trim()");
  assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.opening-balance-table thead th')].map((cell)=>cell.textContent.trim()||'选择')"), ["选择", "学生姓名", "年级", "期初实际余额", "期初赠送余额", "备注"]);
  assert.equal(await browser.evaluate("Boolean(document.querySelector('.opening-balance-filter [data-filter-field=\"month_key\"], .opening-balance-table input[type=\"month\"]'))"), false);
  await browser.click(".open-opening-balance-modal");
  assert.equal(await browser.evaluate("Boolean(document.querySelector('.opening-balance-modal input[type=\"month\"], .opening-balance-modal [data-field=\"month_key\"]'))"), false);
  await browser.click(".opening-balance-modal-cancel");
  await browser.evaluate("(() => { const select=document.querySelector('.month-select'); select.value='2026-08-01'; select.dispatchEvent(new Event('change',{bubbles:true})); })()");
  await browser.waitFor("document.querySelector('.month-select')?.value === '2026-08-01'");
  assert.equal(await browser.evaluate("document.querySelector('.opening-balance-table tbody')?.textContent.trim()"), before);
  assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
}));
