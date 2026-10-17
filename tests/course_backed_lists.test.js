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
let teacherCookie;
let academicCookie;
async function summary() {
  const result = await api('/api/bootstrap?month=2026-09-01');
  assert.equal(result.response.status, 200);
  return result.payload.derived.teacher_summary.find(row => row.teacher_name === '合成教师');
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

function seed(db) {
  const hash = db.prepare("SELECT password_hash FROM users WHERE username='boss'").get().password_hash;
  db.exec(`UPDATE settings SET value='2026-09-01' WHERE key='month_key';
    INSERT INTO teachers(id,name,status) VALUES(9001,'合成教师','在职'),(9002,'其他教师','在职');
    INSERT INTO students(name,grade,status) VALUES('张三','高一','在读'),('李四','高一','在读');
    INSERT INTO lessons(id,teacher_name,date,month_key,time_slot,classroom,grade,subject,course_type,student_names,status,teacher_salary,teacher_salary_source) VALUES
    (9001,'合成教师','2026-09-01','2026-09-01','09:00-11:00','A1','高一','数学','1V2','张三、李四','已上',99,'auto'),
    (9002,'合成教师','2026-09-02','2026-09-01','09:00-11:00','B1','高一','数学','1V2','李四、张三','已上',99,'auto'),
    (9003,'其他教师','2026-09-03','2026-09-01','09:00-11:00','B1','高一','数学','1V1','测试学生','待上',0,'empty');`);
  const account=db.prepare("INSERT INTO users(username,display_name,role,teacher_name,password_hash,status) VALUES(?,?,?,?,?,'active')");
  account.run('salary-readonly','只读教师','teacher','合成教师',hash);
  account.run('salary-academic','范围教务','academic','',hash);
  db.exec(`INSERT INTO role_filter_presets(role_code,view_key,filter_key,filter_value_json) VALUES('academic','lessons','teacher_names','["合成教师"]');`);
}
before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-course-backed-"));
  databasePath = path.join(tempRoot, "course-backed.sqlite");
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



let retainedRule, retainedGroup;
const people='存在性甲、存在性乙';
const page=()=>api('/api/bootstrap?month=2026-09-01');
const groups=()=>api('/api/class-groups');
const ownRules=payload=>payload.student_pricing.filter(row=>row.student_names.includes('存在性'));
async function create(day,fields={}) {
 const result=await api('/api/lessons',{method:'POST',body:{teacher_name:'合成教师',date:`2031-01-${day}`,time_slot:'15:00-17:00',classroom:'存在性教室',grade:'高一',subject:'数学',student_names:people,status:'待上',...fields}});
 assert.equal(result.response.status,201,JSON.stringify(result.payload));return result.payload.id;
}
test('class existence keeps all statuses while pricing requires completed courses and preserves historical rules',async()=>{
 const a=await create('01'),b=await create('02',{status:'请假'});
 const initialGroup=(await groups()).payload.class_groups.find(row=>row.students_key.includes('存在性'));
 for (const [id,type] of [[a,'1V1'],[b,'小班课']]) {
  assert.equal((await api('/api/class-groups/course-type',{method:'PATCH',body:{group_key:initialGroup.group_key,lesson_ids:[id],course_type:type,mode:'lesson'}})).response.status,200);
 }
 const pricing=await page(),rules=ownRules(pricing.payload);assert.equal(rules.length,0);
 assert.ok(rules.every(row=>row.total_lessons===0&&row.start_date===''&&row.end_date===''));
 const rulesDb=new DatabaseSync(databasePath);try{retainedRule=rulesDb.prepare("SELECT * FROM student_pricing WHERE student_name='存在性甲'").get();}finally{rulesDb.close();}
 assert.equal((await api(`/api/student-pricing/${retainedRule.id}/courses`)).payload.lessons.length,0);
 const group=(await groups()).payload.class_groups.find(row=>row.students_key.includes('存在性'));
 assert.equal(group.course_count,2);assert.deepEqual(group.course_types,['1V1','小班课']);retainedGroup=group;
 assert.equal((await api(`/api/student-pricing/${retainedRule.id}`,{method:'PATCH',body:{custom_price:240}})).response.status,200);
 await api(`/api/lessons/${a}`,{method:'DELETE'});
 assert.equal((await groups()).payload.class_groups.find(row=>row.id===group.id).course_count,1);
 assert.equal(ownRules((await page()).payload).length,0);
 const originalDb=new DatabaseSync(databasePath);
 try { originalDb.prepare('INSERT INTO fee_overrides(lesson_id,student_name,unit_price) VALUES(?,?,?)').run(9001,'张三',220.25); } finally { originalDb.close(); }
 await api('/api/lessons/batch-delete',{method:'POST',body:{ids:[b]}});
 assert.equal((await groups()).payload.class_groups.some(row=>row.id===group.id),false);
 assert.equal(ownRules((await page()).payload).length,0);
 const db=new DatabaseSync(databasePath);try {assert.equal(db.prepare('SELECT custom_price FROM student_pricing WHERE id=?').get(retainedRule.id).custom_price,240);assert.ok(db.prepare('SELECT id FROM class_groups WHERE id=?').get(group.id));assert.equal(db.prepare('SELECT unit_price FROM fee_overrides WHERE lesson_id=?').get(9001).unit_price,220.25);}finally{db.close();}
 const batch=await api('/api/student-pricing/batch',{method:'PATCH',body:{ids:[retainedRule.id],price:999}});assert.equal(batch.response.status,409);
 const id=await create('03',{student_names:'存在性乙、存在性甲'});
 assert.equal(ownRules((await page()).payload).length,0);
 assert.equal((await groups()).payload.class_groups.find(row=>row.id===group.id).course_count,1);
 await api(`/api/lessons/${id}`,{method:'PATCH',body:{status:'已上'}});
 assert.equal(ownRules((await page()).payload).find(row=>row.id===retainedRule.id).total_lessons,1);
 const moved=await api(`/api/lessons/${id}`,{method:'PATCH',body:{teacher_name:'其他教师',grade:'高二',subject:'英语',student_names:'存在性甲'}});assert.equal(moved.response.status,200,JSON.stringify(moved.payload));
 assert.equal((await groups()).payload.class_groups.some(row=>row.id===group.id),false);
 assert.equal(ownRules((await page()).payload).some(row=>row.id===retainedRule.id),false);
 assert.equal((await page()).payload.student_pricing.find(row=>row.student_name==='存在性甲').grade,'高二');
});

test('Chromium five widths keeps only real-course groups, completed rules, exact details and refreshed cache',async()=>{
 await create('05',{status:'已上'});
 const chrome=await launchChrome(path.join(tempRoot,'existence-browser')),browser=chrome.session;
 try {
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await browser.login('boss','123456');
  for(const width of [1920,1440,1280,1024,390]) {
   await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
   await browser.evaluate("setActiveView('studentQuery');studentQueryRange={mode:'range',start:'2031-01-01',end:'2031-01-31'};selectedStudent='存在性乙';load({refreshGlobal:false})");await browser.waitFor("!!document.querySelector('.student-pricing-table')");
   assert.ok(await browser.evaluate("studentQueryRules.some(row=>row.student_name==='存在性乙'&&row.total_lessons===1)"));
   assert.ok(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.student-set-badges')].every(node=>getComputedStyle(node).flexWrap==='nowrap')"));
   await browser.evaluate("setActiveView('classGroups');load({refreshGlobal:false})");await browser.waitFor("!!document.querySelector('.class-group-table')");
   assert.ok(await browser.evaluate('state.class_groups.every(row=>row.course_count>0)'));
  }

  const outcome=await browser.evaluate(`(async()=>{const before=await request('/api/class-groups');const group=before.class_groups.find(row=>row.students_key==='存在性乙、存在性甲'||row.students_key==='存在性甲、存在性乙');await request('/api/lessons/batch-delete',{method:'POST',body:{ids:group.lesson_ids}});const after=await request('/api/class-groups');return after.class_groups.some(row=>row.id===group.id);})()`);
  assert.equal(outcome,false);
  await browser.evaluate("setActiveView('studentQuery');studentQueryRange={mode:'range',start:'2031-01-01',end:'2031-01-31'};selectedStudent='存在性乙';load({refreshGlobal:false})");await browser.waitFor("!!document.querySelector('.student-pricing-table')");
  assert.equal(await browser.evaluate("studentQueryRules.some(row=>row.student_name==='存在性乙')"),false);
  assert.equal(await browser.evaluate("document.querySelectorAll('.student-pricing-select-row').length"),0);
  assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
 }finally{await browser.close();if(chrome.child.exitCode==null)chrome.child.kill();}
});


test('hidden historical rules, class metadata and retained-course fee overrides survive full Excel restore', () => {
  const { buildFullDataBuffer, restoreFullData } = require('../src/excel/full_backup');
  const db = new DatabaseSync(databasePath);
  const snapshot = connection => Object.fromEntries(['student_pricing', 'class_groups', 'fee_overrides'].map(table =>
    [table, connection.prepare(`SELECT * FROM ${table} ORDER BY ${table === 'fee_overrides' ? 'lesson_id,student_name' : 'id'}`).all().map(row => ({ ...row }))]));
  try {
    const before = snapshot(db);
    assert.ok(before.student_pricing.some(row => row.id === retainedRule.id && row.custom_price === 240));
    assert.ok(before.class_groups.some(row => String(row.id) === retainedGroup.id));
    assert.ok(before.fee_overrides.some(row => row.unit_price === 220.25));
    const file = path.join(tempRoot, 'historical-config.xlsx');
    const target = path.join(tempRoot, 'historical-restored.sqlite');
    fs.writeFileSync(file, buildFullDataBuffer(db).buffer);
    fs.copyFileSync(databasePath, target);
    restoreFullData({ dbPath: target, inputPath: file });
    const restored = new DatabaseSync(target);
    try { assert.deepEqual(snapshot(restored), before); } finally { restored.close(); }
  } finally { db.close(); }
});
