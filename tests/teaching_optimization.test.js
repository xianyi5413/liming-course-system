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
const table = formula => ({ teacher_id: 9001, effective_start: '2026-09-01', effective_end: '2026-09-30', rules: [{ grade: '高一', course_type: '小班课', formula }] });
const workflowPath = '/api/teacher-detail/workflow?start=2026-09-01&end=2026-09-30&teacher=' + encodeURIComponent('合成教师');
async function summary() {
  const result = await api('/api/bootstrap?month=2026-09-01');
  assert.equal(result.response.status, 200);
  return result.payload.derived.teacher_summary.find(row => row.teacher_name === '合成教师');
}

const Display = require('../public/student-display');
const vm = require('node:vm');
test('student display normalizes formats and has deterministic browser/Node order without changing identity keys', () => {
  const expected = ['李四', '王2', '王10', '张三'];
  for (const input of ['张三；王10,李 四\n王2、张三', ['王10', '张三', '李四', '王2'], '["张三","王2","王10","李四"]']) assert.deepEqual(Display.names(input), expected);
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(root, 'public/student-display.js'), 'utf8'), context);
  assert.equal(JSON.stringify(context.StudentDisplay.names('张三、李四')), JSON.stringify(Display.names('李四、张三')));
  assert.equal(normalizeStoredStudentSet('张三、李四'), normalizeStoredStudentSet('李四、张三'));
});

test('batch changes only selected fields; deduplicates IDs, clears notes, and rejects malformed input atomically', async () => {
  const edit = changes => api('/api/lessons/batch', { method: 'PATCH', body: { ids: [9001,9002,9001], changes } });
  let result = await edit({ notes: '合成批量备注', classroom: 'B1' });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload)); assert.equal(result.payload.updated, 2);
  const db = new DatabaseSync(databasePath);
  try {
    assert.equal(db.prepare('SELECT notes FROM lessons WHERE id=9003').get().notes, '');
    assert.equal(db.prepare('SELECT student_names FROM lessons WHERE id=9001').get().student_names, '张三、李四');
    assert.equal((await edit({ notes: '' })).response.status, 200);
    for (const changes of [{}, {student_names:'甲'}, {course_type:'1V1'}, {teacher_salary:10}, {date:'2026-02-30'}, {status:'错误'}, {time_slot:'错误'}, {grade:'未知'}, {classroom:'不存在'}]) assert.equal((await edit(changes)).response.status, 400, JSON.stringify(changes));
    assert.equal((await api('/api/lessons/batch', {method:'PATCH', body:{ids:[9001,999999],changes:{notes:'不得保存'}}})).response.status,400);
    assert.equal(db.prepare('SELECT notes FROM lessons WHERE id=9001').get().notes, '');
    assert.equal((await api('/api/lessons/batch', {method:'PATCH',body:{ids:[],changes:{notes:'x'}}})).response.status,400);
  } finally { db.close(); }
});

test('batch final-state conflicts and permission failures roll back every row', async () => {
  for (const date of ['2026-09-03','2026-09-02']) {
    const result=await api('/api/lessons/batch',{method:'PATCH',body:{ids:[9001,9002],changes:{date}}});
    assert.equal(result.response.status,409,JSON.stringify(result.payload));
  }
  assert.equal((await api('/api/lessons/batch',{cookie:teacherCookie,method:'PATCH',body:{ids:[9001],changes:{notes:'x'}}})).response.status,403);
  assert.equal((await api('/api/lessons/batch',{cookie:academicCookie,method:'PATCH',body:{ids:[9003],changes:{notes:'x'}}})).response.status,403);
  assert.equal((await api('/api/lessons/batch',{cookie:academicCookie,method:'PATCH',body:{ids:[9001],changes:{teacher_name:'其他教师'}}})).response.status,403);
  const db=new DatabaseSync(databasePath); try { assert.equal(db.prepare('SELECT date FROM lessons WHERE id=9001').get().date,'2026-09-01'); } finally {db.close();}
});

test('cross-month batch updates month, status and shared payroll; equal base restores automatic rules', async () => {
  const rules=[{grade:'高一',course_type:'1V2',formula:'200+40K'}];
  for(const month of ['09','10']) assert.equal((await api('/api/salary-tables',{method:'POST',body:{teacher_id:9001,name:'真实表名'+month,effective_start:`2026-${month}-01`,effective_end:`2026-${month}-${month==='09'?'30':'31'}`,rules}})).response.status,200);
  assert.equal((await api('/api/teacher-monthly-performance',{method:'PATCH',body:{teacher_name:'合成教师',month_key:'2026-10-01',coefficient:0.5}})).response.status,200);
  assert.equal((await api('/api/lessons/batch',{method:'PATCH',body:{ids:[9002],changes:{date:'2026-10-02',notes:'跨月'}}})).response.status,200);
  assert.equal((await api('/api/teacher-detail/salary/9001',{method:'PATCH',body:{source:'manual',amount:200}})).response.status,200);
  const db=new DatabaseSync(databasePath);try {
    assert.equal(db.prepare('SELECT month_key FROM lessons WHERE id=9002').get().month_key,'2026-10-01');
    assert.equal(db.prepare('SELECT teacher_base_salary_source FROM lessons WHERE id=9001').get().teacher_base_salary_source,'auto');
  } finally {db.close();}
  let result=await api('/api/teacher-detail/workflow?'+new URLSearchParams({teacher:'合成教师',start:'2026-09-01',end:'2026-10-31'}));
  assert.deepEqual(result.payload.lessons.map(row=>row.teacher_payroll_amount),[240,220]);
  assert.equal(result.payload.classes.length,1);
  assert.equal((await api('/api/lessons/batch',{method:'PATCH',body:{ids:[9002],changes:{status:'请假'}}})).response.status,200);
  result=await api('/api/teacher-detail/workflow?'+new URLSearchParams({teacher:'合成教师',start:'2026-09-01',end:'2026-10-31'}));
  assert.equal(result.payload.lessons[1].teacher_payroll_amount,0);
});

test('Excel display sorting preserves original persisted student sets in restoration data', () => {
  const { buildFullDataBuffer, verifyFullData } = require('../src/excel/full_backup');
  const { parseWorkbook } = require('../src/excel/xlsx_codec');
  const db = new DatabaseSync(databasePath);
  try {
    const result = buildFullDataBuffer(db);
    const verified = verifyFullData(result.buffer);
    assert.equal(verified.data.lessons.find(row => row.id === 9001).student_names, '张三、李四');
    const workbook = parseWorkbook(result.buffer);
    assert.ok(workbook.sheets.some(sheet => sheet.rows.some(row => row.includes('李四、张三'))));
    assert.equal(db.prepare('SELECT student_names FROM lessons WHERE id=9001').get().student_names, '张三、李四');
  } finally { db.close(); }
});

test('Chromium sorting, workflow counts, metric cards, 1–7 previews and responsive overflow', async () => {
  const chrome=await launchChrome(path.join(tempRoot,'ui'));const browser=chrome.session;
  try {
    await browser.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await browser.login('boss','123456');
    assert.equal(await browser.evaluate("StudentDisplay.text('张三、李四')"),'李四、张三');
    await browser.evaluate("setActiveView('teacherDetail');load({refreshGlobal:false})");await browser.waitFor("Boolean(document.querySelector('.teacher-class-summary-table'))");
    assert.equal(await browser.evaluate("document.querySelectorAll('[data-salary-class]').length"),0);
    await browser.evaluate("selectedTeacherDetail='合成教师';SalaryUI.applyRange('teacher-detail-salary','2026-09-01','2026-10-31')");
    await browser.waitFor("document.querySelectorAll('[data-salary-class]').length===1");
    const text=await browser.evaluate("document.querySelector('.teacher-class-summary-table').textContent");
    assert.match(text,/起始日期/);assert.match(text,/结束日期/);assert.match(text,/真实表名09/);
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.lesson-summary-grid .metric-value')].map(e=>e.textContent)"),['2','1','¥200.00','¥240.00']);
    for(const width of [1920,1440,1280,1024,390]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      assert.ok(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`page overflow ${width}`);
    }
    await browser.click('[data-salary-class]');await browser.waitFor("document.querySelectorAll('.teacher-class-lessons tbody tr').length===2");await browser.click('[data-salary-action=close]');
    await browser.click('[data-salary-action=tables]');await browser.waitFor("Boolean(document.querySelector('[data-salary-action=new]'))");await browser.click('[data-salary-action=new]');
    assert.equal(await browser.evaluate("document.querySelectorAll('[data-salary-preview]').length"),42);
    await browser.evaluate(`(()=>{const e=document.querySelector('.salary-formula-input[data-grade="高一"][data-type="小班课"]');e.value='60+30(n-1)+40K';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const previews=await browser.evaluate("[...document.querySelectorAll('[data-salary-preview=高一]')].map(e=>e.textContent)");
    assert.equal(previews.length,7);assert.ok(previews[0].includes('60')&&previews[0].includes('K'));assert.ok(previews[6].includes('240'));
    await browser.click('[data-salary-action=close]');
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await browser.evaluate("lessonFilter.start_date='2026-09-01';lessonFilter.end_date='2026-10-31';setActiveView('lessons');load({refreshGlobal:false})");await browser.waitFor("Boolean(document.querySelector('.batch-edit-lessons'))");
    assert.equal(await browser.evaluate("document.querySelector('.batch-edit-lessons').disabled"),true);
    await browser.click('.lesson-select-row[data-id="9001"]');await browser.click('.batch-edit-lessons');
    assert.equal(await browser.evaluate("document.querySelectorAll('.batch-lesson-edit-form input[type=checkbox]:checked').length"),0);
    await browser.click('[data-enable=classroom]');
    assert.equal(await browser.evaluate("document.querySelector('select[name=classroom]').nextElementSibling.querySelector('button').disabled"),false);
    await browser.click('[data-enable=classroom]');await browser.click('[data-enable=notes]');
    await browser.evaluate("document.querySelector('.batch-lesson-edit-form textarea').value='浏览器批量修改';window.confirm=()=>true;document.querySelector('.batch-lesson-edit-form').requestSubmit()");
    await browser.waitFor("!document.querySelector('.batch-lesson-edit-form')");
    const db=new DatabaseSync(databasePath);try {assert.equal(db.prepare('SELECT notes FROM lessons WHERE id=9001').get().notes,'浏览器批量修改');assert.equal(db.prepare('SELECT notes FROM lessons WHERE id=9002').get().notes,'跨月');}finally{db.close();}
    await browser.click('.user-menu-trigger');
    assert.equal(await browser.evaluate("document.querySelectorAll('.user-menu .appearance-settings-link').length"),0);
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.user-menu [role=menuitem]')].map(e=>e.textContent)"),['修改密码','退出系统']);
    assert.deepEqual(browser.exceptions,[]);
  }finally {await browser.close();chrome.child.kill('SIGTERM');}
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
