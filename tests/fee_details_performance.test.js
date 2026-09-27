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
let feeServerMetrics = "";

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
    FEE_DETAILS_PERF_DIAGNOSTICS: "1",
    BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "",
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
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout.on("data", chunk => { feeServerMetrics += String(chunk); });
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

test("fee details synthetic performance and amount equivalence", async () => {
  const full = await api(`/api/bootstrap?month=${MONTH}`);
  assert.equal(full.response.status, 200);
  const expected = full.payload.derived.fee_details;
  assert.ok(expected.length >= 2000);
  const chrome = await launchChrome(path.join(tempRoot, "fee-chrome"));
  const browser = chrome.session;
  try {
    await browser.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await browser.login("boss", "123456");
    await browser.evaluate(`window.feeLongTasks=[];new PerformanceObserver(list=>window.feeLongTasks.push(...list.getEntries().map(e=>e.duration))).observe({entryTypes:['longtask']});`);
    const started = performance.now();
    const initial = await browser.evaluate(`(async()=>{setActiveView('feeDetails');activeMonth='${MONTH}';await load({refreshGlobal:false});return {rows:document.querySelectorAll('.fee-detail-table td.row-index').length,nodes:document.querySelectorAll('*').length};})()`);
    const operable = performance.now()-started;
    await browser.waitFor(`document.querySelectorAll('.fee-detail-table td.row-index').length===${expected.length}`,30000);
    const complete=performance.now()-started;
    const metrics=await browser.evaluate(`({nodes:document.querySelectorAll('*').length,maxLong:Math.max(0,...window.feeLongTasks),adaptive:document.querySelector('.fee-detail-table').dataset.adaptiveMeasurementMs})`);
    assert.deepEqual(await browser.evaluate("state.derived.fee_details.map(r=>[r.id,r.unit_price,r.rule_price])"),expected.map(r=>[r.id,r.unit_price,r.rule_price]));
    console.log(feeServerMetrics.split("\n").filter(line=>line.includes("[fee-details-perf]")).join("\n"));
    console.log(JSON.stringify({label:process.env.FEE_BASELINE?'before':'after',count:expected.length,bootstrapMs:full.elapsed,bytes:full.bytes,operable,complete,initial,...metrics}));
    if(!process.env.FEE_BASELINE){assert.ok(initial.rows<=36);const lite=await api(`/api/fee-details-page?month=${MONTH}`);assert.equal((await api(`/api/fee-details-page?month=${MONTH}`,{cookie:academicCookie})).response.status,403);assert.equal(lite.response.status,200);assert.deepEqual(lite.payload.fee_details.map(r=>[r.id,r.unit_price,r.rule_price]),expected.map(r=>[r.id,r.unit_price,r.rule_price]));console.log(JSON.stringify({feeApiMs:lite.elapsed,feeBytes:lite.bytes}));}
    await browser.evaluate("document.querySelector('.fee-detail-select-all').click()");
    assert.equal(await browser.evaluate("selectedFeeDetailKeys.size"),await browser.evaluate("state.derived.fee_details.filter(canApplyStudentPricingRule).length"));
    const filtered=await browser.evaluate("(()=>{feeDetailsFilter.student=state.derived.fee_details[0].student_name;render();feeDetailsFilter.student=state.derived.fee_details.at(-1).student_name;render();return state.derived.fee_details.filter(r=>feeDetailMatchesFilter(r)).length;})()");
    await browser.waitFor(`document.querySelectorAll('.fee-detail-table td.row-index').length===${filtered}`);
    await browser.evaluate("new Promise(resolve=>setTimeout(resolve,150))");
    assert.equal(await browser.evaluate("document.querySelectorAll('.fee-detail-table td.row-index').length"),filtered);
    assert.ok(await browser.evaluate("[...document.querySelectorAll('.fee-detail-table td.row-index')].every((e,i)=>Number(e.textContent)===i+1)"));
    await browser.evaluate("resetFeeDetailsFilter();render()");
    await browser.waitFor(`document.querySelectorAll('.fee-detail-table td.row-index').length===${expected.length}`,30000);
    const edited=await browser.evaluate("(()=>{const input=[...document.querySelectorAll('.fee-detail-table .fee-override')].at(-1);input.value='123.45';input.dispatchEvent(new Event('change',{bubbles:true}));return {lesson:Number(input.dataset.lessonId),student:input.dataset.studentName};})()");
    await browser.waitFor(`state.derived.fee_details.some(r=>r.lesson_id===${edited.lesson}&&r.student_name===${JSON.stringify(edited.student)}&&r.unit_price===123.45)`);
    assert.deepEqual(await browser.evaluate("Promise.all([loadFeeDetailsPage(),loadFeeDetailsPage()])"),[false,true]);
    assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
  } finally {await browser.close();if(chrome.child.exitCode==null){const done=new Promise(r=>chrome.child.once('exit',r));chrome.child.kill();await done;}}
});
