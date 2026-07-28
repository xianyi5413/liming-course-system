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
const RULE_COUNT = 1000;
const STUDENT_COUNT = 500;
const INITIAL_ROW_COUNT = 36;
let tempRoot;
let databasePath;
let port;
let server;
let ownerCookie;
let academicCookie;
let readonlyCookie;

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("student pricing performance server did not start");
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
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  return {
    response,
    payload: raw ? JSON.parse(raw) : {},
    bytes: Buffer.byteLength(raw),
    elapsed: performance.now() - started,
  };
}

function seedPerformanceData(db) {
  const grades = ["初一", "初二", "初三", "高一", "高二", "高三"];
  const subjects = ["数学", "英语"];
  const names = Array.from({ length: STUDENT_COUNT }, (_, index) => `性能学生${String(index + 1).padStart(3, "0")}`);
  const addStudent = db.prepare("INSERT INTO students(id,name,grade,status) VALUES (?,?,?,'在读')");
  const addRule = db.prepare(`
    INSERT INTO student_pricing(id,student_name,grade,subject,student_names,custom_price,notes)
    VALUES (?,?,?,?,?,?,?)
  `);
  const addLesson = db.prepare(`
    INSERT INTO lessons(
      id,teacher_name,date,lesson_status,time_slot,classroom,grade,subject,student_names,
      notes,course_status,status,month_key,sort_order
    ) VALUES (?,'性能老师',?,'上课','09:00-11:00','性能教室',?,?,?,'性能课程','已上','已上',?,?)
  `);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE settings SET value=? WHERE key='month_key'").run(MONTH);
    db.prepare("INSERT INTO teachers(id,name,status) VALUES (19001,'性能老师','在职')").run();
    for (let index = 0; index < STUDENT_COUNT; index += 1) {
      addStudent.run(20000 + index, names[index], grades[index % grades.length]);
    }
    for (let index = 0; index < RULE_COUNT; index += 1) {
      const studentIndex = index % STUDENT_COUNT;
      const grade = grades[studentIndex % grades.length];
      const subject = subjects[Math.floor(index / STUDENT_COUNT)];
      const groupSize = (index % 4) + 1;
      const group = Array.from({ length: groupSize }, (_, offset) => names[(studentIndex + offset) % STUDENT_COUNT]).join("、");
      const day = String((index % 28) + 1).padStart(2, "0");
      addRule.run(30000 + index, names[studentIndex], grade, subject, group, 100 + (index % 70), `性能备注 ${index}`);
      addLesson.run(40000 + index, `2026-07-${day}`, grade, subject, group, MONTH, index);
    }
    const passwordHash = db.prepare("SELECT password_hash FROM users WHERE username='boss'").get().password_hash;
    const academicId = Number(db.prepare(`
      INSERT INTO users(username,display_name,role,password_hash,permission_override_enabled,status)
      VALUES ('pricing-academic','性能教务','academic',?,1,'active')
    `).run(passwordHash).lastInsertRowid);
    const readonlyId = Number(db.prepare(`
      INSERT INTO users(username,display_name,role,password_hash,readonly_override,permission_override_enabled,status)
      VALUES ('pricing-readonly','性能只读','helper',?,1,1,'active')
    `).run(passwordHash).lastInsertRowid);
    for (const userId of [academicId, readonlyId]) {
      db.prepare("INSERT INTO user_page_permissions(user_id,permission_key,enabled) VALUES (?,'studentPricing',1)").run(userId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-student-pricing-performance-"));
  databasePath = path.join(tempRoot, "synthetic.sqlite");
  const environment = {
    ...process.env,
    DATA_DIR: tempRoot,
    DB_PATH: databasePath,
    SESSION_COOKIE_SECURE: "false",
    STUDENT_PRICING_PERF_DIAGNOSTICS: "1",
  };
  const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], {
    cwd: root,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(databasePath);
  seedPerformanceData(db);
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
  academicCookie = await login("pricing-academic");
  readonlyCookie = await login("pricing-readonly");
});

after(async () => {
  if (server?.exitCode == null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  if (tempRoot) {
    try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {}
  }
});

test("1000-rule lightweight endpoint uses fixed batch queries, minimal DTOs and isolated cache scopes", async () => {
  const cold = await api(`/api/student-pricing-page?month=${MONTH}`);
  assert.equal(cold.response.status, 200);
  assert.equal(cold.payload.rules.length, RULE_COUNT);
  assert.ok(cold.elapsed < 1500, `cold endpoint ${cold.elapsed.toFixed(1)}ms`);
  assert.ok(cold.bytes < 500_000, `response ${cold.bytes} bytes`);
  assert.equal(cold.payload.cache_status, "miss");
  assert.equal(cold.payload.diagnostics.sql_query_count, 6);
  const allowedFields = new Set([
    "id", "student_name", "grade", "subject", "student_names", "custom_price",
    "price_status", "notes", "current_month_lessons", "total_lessons",
  ]);
  assert.deepEqual(Object.keys(cold.payload.rules[0]).filter((field) => !allowedFields.has(field)), []);
  assert.doesNotMatch(JSON.stringify(cold.payload), /guardian|phone|balance|recharge|teacher_salary|password|token|secret/i);

  const hot = await api(`/api/student-pricing-page?month=${MONTH}`);
  assert.equal(hot.payload.cache_status, "hit");
  assert.equal(hot.payload.diagnostics.sql_query_count, 0);
  assert.ok(hot.elapsed < 600, `hot endpoint ${hot.elapsed.toFixed(1)}ms`);

  const academic = await api(`/api/student-pricing-page?month=${MONTH}`, { cookie: academicCookie });
  assert.equal(academic.response.status, 200);
  assert.equal(academic.payload.cache_status, "miss");
  assert.notEqual(academic.payload.diagnostics.cache_scope_hash, cold.payload.diagnostics.cache_scope_hash);
  const readonly = await api(`/api/student-pricing-page?month=${MONTH}`, { cookie: readonlyCookie });
  assert.equal(readonly.response.status, 200);
  const deniedWrite = await api(`/api/student-pricing/30001?month=${MONTH}`, {
    cookie: readonlyCookie,
    method: "PATCH",
    body: { custom_price: 1 },
  });
  assert.equal(deniedWrite.response.status, 403);
  console.log("[student-pricing-server-performance]", JSON.stringify({
    rows: RULE_COUNT,
    students: STUDENT_COUNT,
    cold_ms: Number(cold.elapsed.toFixed(1)),
    hot_ms: Number(hot.elapsed.toFixed(1)),
    bytes: cold.bytes,
    cold_queries: cold.payload.diagnostics.sql_query_count,
    hot_queries: hot.payload.diagnostics.sql_query_count,
  }));
});

test("single and batch writes invalidate the page cache and return only affected rows", async () => {
  await api(`/api/student-pricing-page?month=${MONTH}`);
  const single = await api(`/api/student-pricing/30001?month=${MONTH}`, {
    method: "PATCH",
    body: { custom_price: 188.25 },
  });
  assert.equal(single.response.status, 200);
  assert.equal(single.payload.id, 30001);
  assert.equal(single.payload.custom_price, 188.25);
  const afterSingle = await api(`/api/student-pricing-page?month=${MONTH}`);
  assert.equal(afterSingle.payload.cache_status, "miss");
  assert.equal(afterSingle.payload.rules.find((row) => row.id === 30001).custom_price, 188.25);

  const batch = await api(`/api/student-pricing/batch?month=${MONTH}`, {
    method: "PATCH",
    body: { ids: [30002, 30002, 30003], price: 199.5 },
  });
  assert.equal(batch.response.status, 200);
  assert.deepEqual({ processed: batch.payload.processed, success: batch.payload.success }, { processed: 2, success: 2 });
  assert.deepEqual(batch.payload.rows.map((row) => row.id).sort((a, b) => a - b), [30002, 30003]);
  const afterBatch = await api(`/api/student-pricing-page?month=${MONTH}`);
  assert.equal(afterBatch.payload.cache_status, "miss");
  assert.deepEqual(
    afterBatch.payload.rules.filter((row) => [30002, 30003].includes(row.id)).map((row) => row.custom_price),
    [199.5, 199.5],
  );
});

test("real Chromium keeps first paint, progressive rendering, filtering, selection and local saves responsive", async () => {
  const chrome = await launchChrome(path.join(tempRoot, "pricing-performance-chrome"));
  const browser = chrome.session;
  try {
    await browser.send("Page.navigate", { url: `http://127.0.0.1:${port}` });
    await browser.login("boss", "123456");
    await browser.evaluate(`(() => {
      window.__pricingLongTasks=[];
      new PerformanceObserver((list)=>window.__pricingLongTasks.push(...list.getEntries().map((entry)=>entry.duration))).observe({type:'longtask'});
      return true;
    })()`);
    const responseStart = browser.responses.length;
    const started = performance.now();
    if (!await browser.evaluate("Boolean(document.querySelector('.nav-sub-btn[data-view=\"studentPricing\"]'))")) {
      await browser.click('.nav-btn[data-nav-group="students"]');
    }
    await browser.click('.nav-sub-btn[data-view="studentPricing"]');
    await browser.waitFor("Boolean(document.querySelector('.student-pricing-table[data-adaptive-widths]'))", 10_000);
    const operableMs = performance.now() - started;
    const first = await browser.evaluate(`(() => {
      const table=document.querySelector('.student-pricing-table');
      return {
        initial:Number(table.dataset.initialRowCount),
        rendered:Number(table.dataset.renderedRows),
        layoutReads:Number(table.dataset.adaptiveLayoutReads),
        measurement:Number(table.dataset.adaptiveMeasurementMs),
        nodes:document.getElementsByTagName('*').length
      };
    })()`);
    assert.equal(first.initial, INITIAL_ROW_COUNT);
    assert.equal(first.layoutReads, 0);
    assert.ok(operableMs < 2000, `operable ${operableMs.toFixed(1)}ms`);
    await browser.waitFor(`document.querySelector('.student-pricing-table')?.dataset.renderComplete==='true' && document.querySelectorAll('.student-pricing-rule-row').length===${RULE_COUNT}`, 10_000);
    const allDataMs = performance.now() - started;
    assert.ok(allDataMs < 3500, `all rows ${allDataMs.toFixed(1)}ms`);
    const pageResponses = browser.responses.slice(responseStart);
    assert.equal(pageResponses.filter((item) => /\/api\/student-pricing-page\?/.test(item.url)).length, 1);
    assert.equal(pageResponses.some((item) => /\/api\/bootstrap\?.*month=/.test(item.url)), false);
    assert.equal(pageResponses.some((item) => /\/api\/students(?:\?|$)/.test(item.url)), false);

    await browser.click(".student-pricing-select-all");
    await browser.waitFor(`document.querySelector('.batch-selection-summary')?.textContent.includes('${RULE_COUNT}')`);
    await browser.evaluate(`(() => {
      const wrap=document.querySelector('#student-pricing-table-wrap');
      wrap.scrollTop=wrap.scrollHeight;
      return true;
    })()`);
    assert.equal(await browser.evaluate("document.querySelector('.student-pricing-rule-row:last-child .student-pricing-select-row').checked"), true);

    const filterStarted = performance.now();
    await browser.evaluate(`(() => {
      const input=document.querySelector('.student-pricing-filter-input.multi-select-value[data-filter-field="student"]');
      input.value='性能学生001';
      input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await browser.waitFor("document.querySelectorAll('.student-pricing-rule-row').length===2 && document.querySelector('.student-pricing-table')?.dataset.renderComplete==='true'");
    const filterMs = performance.now() - filterStarted;
    assert.ok(filterMs < 500, `filter ${filterMs.toFixed(1)}ms`);
    assert.match(await browser.evaluate("document.querySelector('.batch-selection-summary').textContent"), /2/);

    const saveResponseStart = browser.responses.length;
    await browser.evaluate(`(() => {
      const input=document.querySelector('.student-pricing-field[data-field="custom_price"]');
      input.value='211.25';
      input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await browser.waitFor("document.querySelector('.toast-success')?.textContent.includes('学生单价已保存')");
    const saveResponses = browser.responses.slice(saveResponseStart);
    assert.equal(saveResponses.filter((item) => /\/api\/student-pricing\/\d+/.test(item.url) && item.status === 200).length, 1);
    assert.equal(saveResponses.some((item) => /student-pricing-page|\/api\/bootstrap/.test(item.url)), false);

    const viewportResults = [];
    for (const width of [1440, 1280, 1024, 390]) {
      await browser.send("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: width === 390 });
      await browser.evaluate("window.dispatchEvent(new Event('resize'))");
      await new Promise((resolve) => setTimeout(resolve, 180));
      viewportResults.push(await browser.evaluate(`({
        width:${width},
        pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
        outerOverflow:getComputedStyle(document.querySelector('#student-pricing-table-wrap')).overflowX,
        layoutReads:Number(document.querySelector('.student-pricing-table').dataset.adaptiveLayoutReads)
      })`));
    }
    assert.ok(viewportResults.every((item) => !item.pageOverflow && item.outerOverflow === "auto" && item.layoutReads === 0), JSON.stringify(viewportResults));

    const clearStarted = performance.now();
    await browser.click(".reset-student-pricing-filter");
    await browser.waitFor("Number(document.querySelector('.student-pricing-table')?.dataset.renderedRows)>=36");
    const clearFirstScreenMs = performance.now() - clearStarted;
    assert.ok(clearFirstScreenMs < 500, `clear filter first screen ${clearFirstScreenMs.toFixed(1)}ms`);
    if (!await browser.evaluate("Boolean(document.querySelector('.nav-sub-btn[data-view=\"dashboard\"]'))")) {
      await browser.click('.nav-btn[data-nav-group="home"]');
    }
    await browser.click('.nav-sub-btn[data-view="dashboard"]');
    await browser.waitFor("!document.querySelector('.student-pricing-table')");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.student-pricing-render-progress'))"), false);

    const secondResponseStart = browser.responses.length;
    const secondStarted = performance.now();
    if (!await browser.evaluate("Boolean(document.querySelector('.nav-sub-btn[data-view=\"studentPricing\"]'))")) {
      await browser.click('.nav-btn[data-nav-group="students"]');
    }
    await browser.click('.nav-sub-btn[data-view="studentPricing"]');
    await browser.waitFor("Boolean(document.querySelector('.student-pricing-table[data-adaptive-widths]'))");
    const secondMs = performance.now() - secondStarted;
    assert.ok(secondMs < 800, `second entry ${secondMs.toFixed(1)}ms`);
    assert.equal(browser.responses.slice(secondResponseStart).some((item) => /student-pricing-page/.test(item.url)), false);
    const longTasks = await browser.evaluate("window.__pricingLongTasks");
    assert.ok(Math.max(0, ...longTasks) < 500, JSON.stringify(longTasks));
    assert.deepEqual(browser.exceptions, []);
    assert.deepEqual(browser.consoleErrors, []);
    console.log("[student-pricing-browser-performance]", JSON.stringify({
      operable_ms: Number(operableMs.toFixed(1)),
      all_data_ms: Number(allDataMs.toFixed(1)),
      second_entry_ms: Number(secondMs.toFixed(1)),
      filter_ms: Number(filterMs.toFixed(1)),
      clear_first_screen_ms: Number(clearFirstScreenMs.toFixed(1)),
      initial_rows: first.initial,
      first_dom_nodes: first.nodes,
      adaptive_ms: first.measurement,
      layout_reads: first.layoutReads,
      max_long_task_ms: Number(Math.max(0, ...longTasks).toFixed(1)),
      viewports: viewportResults,
    }));
  } finally {
    await browser.close();
    if (chrome.child.exitCode == null) chrome.child.kill("SIGTERM");
  }
});
