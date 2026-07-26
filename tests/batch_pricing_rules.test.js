const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");

const root = path.resolve(__dirname, "..");
let tempRoot;
let databasePath;
let port;
let server;
let ownerCookie;
let readonlyCookie;
let teacherCookie;

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("batch pricing test server did not start");
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
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-batch-pricing-"));
  databasePath = path.join(tempRoot, "synthetic.sqlite");
  const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], {
    cwd: root,
    env: { ...process.env, DATA_DIR: tempRoot, DB_PATH: databasePath },
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(databasePath);
  const passwordHash = db.prepare("SELECT password_hash FROM users WHERE username='boss'").get().password_hash;
  db.exec(`
    INSERT INTO teachers(id,name,status) VALUES (701,'批量甲','在职'),(702,'批量乙','在职');
    INSERT INTO students(id,name,grade,status) VALUES (711,'合成学生甲','初一','在读'),(712,'合成学生乙','初二','在读');
    INSERT INTO student_pricing(id,student_name,grade,subject,student_names,custom_price,notes) VALUES
      (721,'合成学生甲','初一','数学','合成学生甲',100,'学生备注甲'),
      (722,'合成学生乙','初二','英语','合成学生乙',120,'学生备注乙');
    INSERT INTO teacher_salary_rules(id,teacher_name,grade,subject,student_names,salary_per_unit,unit_hours,is_active,notes) VALUES
      (731,'批量甲','初一','数学','合成学生甲',200,2,1,'教师备注甲'),
      (732,'批量乙','初二','英语','合成学生乙',220,2,-1,'教师备注乙');
  `);
  const readonlyId = Number(db.prepare(`
    INSERT INTO users(username,display_name,role,password_hash,permission_override_enabled,status)
    VALUES ('batch-readonly','批量只读','helper',?,1,'active')
  `).run(passwordHash).lastInsertRowid);
  for (const permission of ["studentPricing", "teacherSalaryRules"]) {
    db.prepare("INSERT INTO user_page_permissions(user_id,permission_key,enabled) VALUES (?,?,1)").run(readonlyId, permission);
  }
  const teacherId = Number(db.prepare(`
    INSERT INTO users(username,display_name,role,teacher_name,readonly_override,password_hash,permission_override_enabled,status)
    VALUES ('batch-teacher','批量老师','teacher','批量甲',0,?,1,'active')
  `).run(passwordHash).lastInsertRowid);
  db.prepare("INSERT INTO user_page_permissions(user_id,permission_key,enabled) VALUES (?,'teacherSalaryRules',1)").run(teacherId);
  db.prepare("INSERT INTO user_teacher_bindings(user_id,teacher_name) VALUES (?,'批量甲')").run(teacherId);
  db.close();
  port = await freePort();
  server = spawn(process.execPath, [path.join(root, "src/server.js")], {
    cwd: root,
    env: { ...process.env, DATA_DIR: tempRoot, DB_PATH: databasePath, PORT: String(port), SESSION_COOKIE_SECURE: "false" },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  await waitForServer();
  ownerCookie = await login("boss");
  readonlyCookie = await login("batch-readonly");
  teacherCookie = await login("batch-teacher");
});

after(async () => {
  if (server?.exitCode == null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test("student batch price deduplicates ids and changes only custom_price", async () => {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const beforeRows = db.prepare("SELECT * FROM student_pricing WHERE id IN (721,722) ORDER BY id").all();
  db.close();
  const result = await api("/api/student-pricing/batch?month=2026-07-01", {
    method: "PATCH",
    body: { ids: [721, 721, 722], price: 180.25 },
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual({ processed: result.payload.processed, success: result.payload.success, failed: result.payload.failed }, { processed: 2, success: 2, failed: [] });
  const checked = new DatabaseSync(databasePath, { readOnly: true });
  const afterRows = checked.prepare("SELECT * FROM student_pricing WHERE id IN (721,722) ORDER BY id").all();
  checked.close();
  assert.deepEqual(afterRows.map((row) => row.custom_price), [180.25, 180.25]);
  for (let index = 0; index < beforeRows.length; index += 1) {
    for (const field of ["student_name", "grade", "subject", "student_names", "notes"]) {
      assert.equal(afterRows[index][field], beforeRows[index][field], field);
    }
  }
});

test("student batch rejects missing ids, invalid amounts, excessive size and readonly writes atomically", async () => {
  const missing = await api("/api/student-pricing/batch", { method: "PATCH", body: { ids: [721, 999999], price: 99 } });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.payload.success, 0);
  assert.equal(missing.payload.failed[0].code, "RULE_NOT_FOUND");
  for (const price of [-1, 100000.001, 100001, "not-a-number"]) {
    const invalid = await api("/api/student-pricing/batch", { method: "PATCH", body: { ids: [721], price } });
    assert.equal(invalid.response.status, 400);
  }
  const tooMany = await api("/api/student-pricing/batch", { method: "PATCH", body: { ids: Array.from({ length: 501 }, (_, index) => index + 1), price: 1 } });
  assert.equal(tooMany.response.status, 400);
  const readonly = await api("/api/student-pricing/batch", { cookie: readonlyCookie, method: "PATCH", body: { ids: [721], price: 1 } });
  assert.equal(readonly.response.status, 403);
  const checked = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(checked.prepare("SELECT custom_price FROM student_pricing WHERE id=721").get().custom_price, 180.25);
  checked.close();
});

test("teacher batch salary changes only salary and invalidates no rule metadata", async () => {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const beforeRows = db.prepare("SELECT * FROM teacher_salary_rules WHERE id IN (731,732) ORDER BY id").all();
  db.close();
  const result = await api("/api/teacher-salary-rules/batch", { method: "PATCH", body: { ids: [731, 731, 732], salary: 360.5 } });
  assert.equal(result.response.status, 200);
  assert.deepEqual({ processed: result.payload.processed, success: result.payload.success }, { processed: 2, success: 2 });
  const checked = new DatabaseSync(databasePath, { readOnly: true });
  const afterRows = checked.prepare("SELECT * FROM teacher_salary_rules WHERE id IN (731,732) ORDER BY id").all();
  checked.close();
  assert.deepEqual(afterRows.map((row) => row.salary_per_unit), [360.5, 360.5]);
  for (let index = 0; index < beforeRows.length; index += 1) {
    for (const field of ["teacher_name", "grade", "subject", "student_names", "unit_hours", "is_active", "notes"]) {
      assert.equal(afterRows[index][field], beforeRows[index][field], field);
    }
  }
});

test("teacher batch enforces transaction, readonly and bound-teacher scope", async () => {
  const missing = await api("/api/teacher-salary-rules/batch", { method: "PATCH", body: { ids: [731, 999999], salary: 400 } });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.payload.success, 0);
  const readonly = await api("/api/teacher-salary-rules/batch", { cookie: readonlyCookie, method: "PATCH", body: { ids: [731], salary: 400 } });
  assert.equal(readonly.response.status, 403);
  const outOfScope = await api("/api/teacher-salary-rules/batch", { cookie: teacherCookie, method: "PATCH", body: { ids: [732], salary: 400 } });
  assert.equal(outOfScope.response.status, 403);
  assert.equal(outOfScope.payload.failed[0].code, "RULE_OUT_OF_SCOPE");
  const own = await api("/api/teacher-salary-rules/batch", { cookie: teacherCookie, method: "PATCH", body: { ids: [731], salary: 400 } });
  assert.equal(own.response.status, 200);
  const checked = new DatabaseSync(databasePath, { readOnly: true });
  assert.deepEqual(
    checked.prepare("SELECT id,salary_per_unit FROM teacher_salary_rules WHERE id IN (731,732) ORDER BY id").all().map((row) => ({ ...row })),
    [{ id: 731, salary_per_unit: 400 }, { id: 732, salary_per_unit: 360.5 }],
  );
  checked.close();
});

test("real Chromium batch selection, indeterminate state, modal update and 390px layout stay coherent", async () => {
  const chrome = await launchChrome(path.join(tempRoot, "batch-chrome-profile"));
  const browser = chrome.session;
  const openView = async (group, view, rowSelector) => {
    if (!await browser.evaluate(`Boolean(document.querySelector('.nav-sub-btn[data-view="${view}"]'))`)) {
      await browser.click(`.nav-btn[data-nav-group="${group}"]`);
    }
    await browser.waitFor(`Boolean(document.querySelector('.nav-sub-btn[data-view="${view}"]'))`);
    await browser.click(`.nav-sub-btn[data-view="${view}"]`);
    await browser.waitFor(`document.querySelectorAll(${JSON.stringify(rowSelector)}).length === 2`);
  };
  try {
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await browser.send("Page.navigate", { url: `http://127.0.0.1:${port}` });
    await browser.login("boss", "123456");
    await openView("students", "studentPricing", ".student-pricing-rule-row");
    await browser.click(".student-pricing-select-all");
    await browser.waitFor("document.querySelector('.batch-selection-summary')?.textContent.includes('2')");
    await browser.evaluate(`(() => {
      const input=document.querySelector('.student-pricing-filter-input.multi-select-value[data-filter-field="student"]');
      input.value='合成学生甲';
      input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await browser.waitFor("document.querySelectorAll('.student-pricing-rule-row').length === 1 && document.querySelector('.batch-selection-summary')?.textContent.includes('1')");
    await browser.click(".open-student-pricing-batch-modal");
    await browser.waitFor("Boolean(document.querySelector('.student-pricing-batch-modal'))");
    const studentModalText = await browser.evaluate("document.querySelector('.student-pricing-batch-modal').textContent");
    assert.match(studentModalText, /已选择 1 条规则/);
    assert.match(studentModalText, /当前筛选：学生：合成学生甲/);
    await browser.evaluate("document.querySelector('.student-pricing-batch-value').value='188.50'");
    const studentResponseStart = browser.responses.length;
    await browser.click(".confirm-student-pricing-batch");
    await browser.waitFor("!document.querySelector('.student-pricing-batch-modal') && document.querySelector('.batch-selection-summary')?.textContent.includes('0')");
    assert.equal(await browser.evaluate("Number(document.querySelector('.student-pricing-field[data-field=\"custom_price\"]').value)"), 188.5);
    assert.equal(await browser.evaluate("document.querySelector('.student-pricing-filter-input.multi-select-value[data-filter-field=\"student\"]').value"), "合成学生甲");
    const studentMutationResponses = browser.responses.slice(studentResponseStart);
    assert.equal(studentMutationResponses.filter((item) => /\/api\/student-pricing\/batch/.test(item.url) && item.status === 200).length, 1);
    assert.equal(studentMutationResponses.some((item) => /\/api\/bootstrap/.test(item.url)), false);

    await openView("teachers", "teacherSalaryRules", ".teacher-salary-rule-row");
    await browser.click(".teacher-salary-rule-select-all");
    await browser.waitFor("document.querySelector('.teacher-salary-rule-toolbar .batch-selection-summary')?.textContent.includes('2')");
    await browser.click(".teacher-salary-rule-select-row");
    assert.equal(await browser.evaluate("document.querySelector('.teacher-salary-rule-select-all').indeterminate"), true);
    for (const width of [1440, 1280]) {
      await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate("window.dispatchEvent(new Event('resize'))");
      const alignment = await browser.evaluate(`(() => {
        const controls=[...document.querySelectorAll('.teacher-salary-rule-toolbar :is(.filter-combo-input,.history-toggle,.filter-summary,.teacher-salary-rule-toolbar-actions)')];
        const boxes=controls.map((item)=>item.getBoundingClientRect()).filter((box)=>box.width>0);
        return { bottomSpread:Math.max(...boxes.map((box)=>box.bottom))-Math.min(...boxes.map((box)=>box.bottom)), heights:[...document.querySelectorAll('.teacher-salary-rule-toolbar .control,.teacher-salary-rule-toolbar .btn')].map((item)=>item.getBoundingClientRect().height), pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth };
      })()`);
      assert.ok(alignment.bottomSpread <= 2, `${width}: ${JSON.stringify(alignment)}`);
      assert.ok(Math.max(...alignment.heights) - Math.min(...alignment.heights) <= 1, `${width}: ${JSON.stringify(alignment)}`);
      assert.equal(alignment.pageOverflow, false, `${width}: ${JSON.stringify(alignment)}`);
    }
    await browser.click(".open-teacher-salary-rule-batch-modal");
    assert.match(await browser.evaluate("document.querySelector('.teacher-salary-rule-batch-modal').textContent"), /每2小时薪资/);
    await browser.evaluate("document.querySelector('.teacher-salary-rule-batch-value').value='388.25'");
    const teacherResponseStart = browser.responses.length;
    await browser.click(".confirm-teacher-salary-rule-batch");
    await browser.waitFor("!document.querySelector('.teacher-salary-rule-batch-modal') && document.querySelector('.teacher-salary-rule-toolbar .batch-selection-summary')?.textContent.includes('0')");
    const teacherMutationResponses = browser.responses.slice(teacherResponseStart);
    assert.equal(teacherMutationResponses.filter((item) => /\/api\/teacher-salary-rules\/batch/.test(item.url) && item.status === 200).length, 1);
    assert.equal(teacherMutationResponses.some((item) => /\/api\/bootstrap/.test(item.url)), false);

    await browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const mobile = await browser.evaluate("({doc:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,tableWrap:getComputedStyle(document.querySelector('.table-wrap')).overflowX})");
    assert.ok(mobile.doc <= mobile.viewport, JSON.stringify(mobile));
    assert.equal(mobile.tableWrap, "auto");
    assert.deepEqual(browser.exceptions, []);
    assert.deepEqual(browser.consoleErrors, []);
  } finally {
    await browser.close();
    if (chrome.child.exitCode == null) chrome.child.kill("SIGTERM");
  }
});
