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
const RULE_COUNT = 400; // 400 multi-student lessons expand to 1000 pricing identities.
const VISIBLE_RULE_COUNT = 1000; // Includes every student in each complete group.
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


const queryPath = student => '/api/student-pricing-query?' + new URLSearchParams({student,start:'2026-07-01',end:'2026-07-31'});
test('400-course fixture retains 1000 possible pricing identities while scoped query avoids the retired global endpoint', async()=>{
 assert.equal((await api('/api/student-pricing-page')).response.status,410);
 const db=new DatabaseSync(databasePath);const count=db.prepare('SELECT count(*) AS n FROM student_pricing').get().n;const identities=db.prepare('SELECT student_names FROM lessons').all().reduce((n,row)=>n+row.student_names.split('、').length,0);db.close();assert.equal(count,RULE_COUNT);assert.equal(identities,VISIBLE_RULE_COUNT);
 const cold=await api(queryPath('性能学生001'));assert.equal(cold.response.status,200);assert.equal(cold.payload.rules.length,1);assert.ok(cold.elapsed<1500);assert.ok(cold.bytes<25000);
 assert.ok(cold.payload.rules.every(row=>row.student_name==='性能学生001'));
 const hot=await api(queryPath('性能学生001'));assert.ok(hot.elapsed<600);assert.deepEqual(hot.payload.rules,cold.payload.rules);
 assert.equal((await api(queryPath('性能学生001'),{cookie:academicCookie})).response.status,200,'legacy scoped pricing read remains compatible');
 assert.equal((await api('/api/student-statement?student='+encodeURIComponent('性能学生001'),{cookie:academicCookie})).response.status,403,'pricing-only does not grant the full statement');
 assert.equal((await api('/api/student-pricing/30001',{cookie:readonlyCookie,method:'PATCH',body:{custom_price:1}})).response.status,403);
 console.log('[student-query-scoped-performance]',JSON.stringify({stored_rules:count,candidate_identities:identities,rows:cold.payload.rules.length,cold_ms:cold.elapsed,hot_ms:hot.elapsed,bytes:cold.bytes}));
});
test('single writes and retained legacy batch service preserve precise identities and refresh scoped reads',async()=>{
 const single=await api('/api/student-pricing/30001',{method:'PATCH',body:{custom_price:188.25}});assert.equal(single.response.status,200);assert.equal(single.payload.custom_price,188.25);
 const fresh=await api(queryPath(single.payload.student_name));assert.equal(fresh.payload.rules.find(r=>r.id===30001).custom_price,188.25);
 const batch=await api('/api/student-pricing/batch',{method:'PATCH',body:{ids:[30002,30002,30003],price:199.5}});assert.equal(batch.response.status,200);assert.deepEqual({processed:batch.payload.processed,success:batch.payload.success},{processed:2,success:2});
 for(const row of batch.payload.rows){const read=await api(queryPath(row.student_name));assert.equal(read.payload.rules.find(r=>r.id===row.id).custom_price,199.5);}
});
test('Chromium scoped selection, local saves and repeated entry stay responsive without retired requests',async()=>{
 const chrome=await launchChrome(path.join(tempRoot,'query-performance-chrome')),b=chrome.session;
 try {
  await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await b.login('boss','123456');
  const elapsed=await b.evaluate("(async()=>{const start=performance.now();setActiveView('studentQuery');studentQueryRange={mode:'range',start:'2026-07-01',end:'2026-07-31'};selectedStudent='性能学生001';await load({refreshGlobal:false});return performance.now()-start})()");assert.ok(elapsed<2500);
  for(const width of [1920,1440,1280,1024,390]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
   await b.evaluate("applyStudentQuerySelection('性能学生008')");assert.ok(await b.evaluate("studentQueryRules.every(r=>r.student_name==='性能学生008')"));
   assert.equal(await b.evaluate("document.documentElement.scrollWidth>innerWidth"),false);
   await b.waitFor("document.querySelector('.student-pricing-table')?.dataset.adaptiveLayoutReads==='0'");
   assert.equal(await b.evaluate("Number(document.querySelector('.student-pricing-table').dataset.adaptiveLayoutReads)"),0);
  }
  await b.evaluate("window.confirm=()=>true;const input=document.querySelector('.student-pricing-field[data-field=custom_price]');input.value='221.25';saveStudentPricingField(input)");assert.equal(await b.evaluate('studentQueryRules[0].custom_price'),221.25);
  assert.equal(await b.evaluate("document.querySelectorAll('.student-pricing-select-row,.open-student-pricing-batch-modal').length"),0);
  assert.equal(b.responses.some(r=>r.url.includes('/api/student-pricing-page')),false);
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
  console.log('[student-query-browser-performance]',JSON.stringify({first_ms:elapsed}));
 }finally{await b.close();chrome.child.kill();}
});
