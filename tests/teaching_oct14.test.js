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


const Score = require('../public/performance-score');
const W = require('../src/domain/salary_workflow');
test('score boundaries, browser parity, invalid input and idempotent old-K migration', () => {
  const vm = require('node:vm'), context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'public/performance-score.js'), 'utf8'), context);
  for (const [score, k] of [[0,0],[59,0],[60,.5],[79,.5],[80,.8],[95,.95],[100,1],[null,null]]) {
    assert.equal(Score.coefficient(score), k); assert.equal(context.PerformanceScore.coefficient(score), k);
  }
  for (const bad of [-1,101,59.5,'95x','1e2',' 95 ',true,undefined,{},[]]) assert.throws(() => Score.coefficient(bad));
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE teacher_monthly_performance(teacher_name TEXT,month_key TEXT,coefficient REAL,created_at TEXT,updated_at TEXT,PRIMARY KEY(teacher_name,month_key)); INSERT INTO teacher_monthly_performance VALUES('旧教师','2025-01-01',0.73,'旧时间','旧时间');");
    W.migrateSalaryWorkflow(db); W.migrateSalaryWorkflow(db);
    const row=db.prepare('SELECT * FROM teacher_monthly_performance').get();
    assert.equal(row.coefficient,.73); assert.equal(row.performance_score,null); assert.equal(row.updated_at,'旧时间');
  } finally {db.close();}
});

test('batch complete conflict graph, stale confirmation, local selected drafts, explicit force, permissions and rollback', async () => {
  const body={ids:[9001,9002],changes:{date:'2026-09-03'}};
  const edit=value=>api('/api/lessons/batch',{method:'PATCH',body:value});
  let result=await edit(body); assert.equal(result.response.status,409,JSON.stringify(result.payload));
  const firstToken=result.payload.conflict_token, report=result.payload.schedule_conflicts;
  assert.ok(report.counts.teacher>0 && report.counts.classroom>0 && report.counts.student>0);
  assert.ok(report.issues.some(issue=>issue.lesson_details.some(row=>row.id===9003&&!row.selected)));
  assert.ok(report.issues.some(issue=>issue.lesson_details.every(row=>row.selected)));
  assert.ok(report.issues.every(issue=>issue.lesson_details.every(row=>row.date&&row.time_slot&&row.teacher_name&&row.student_names)));
  const db=new DatabaseSync(databasePath);
  try {
    assert.equal(db.prepare('SELECT date FROM lessons WHERE id=9001').get().date,'2026-09-01');
    db.prepare('UPDATE lessons SET notes=? WHERE id=9003').run('并发修改');
    result=await edit({...body,allow_conflicts:true,conflict_token:firstToken});
    assert.equal(result.response.status,409); assert.notEqual(result.payload.conflict_token,firstToken);
    const forced={...body,allow_conflicts:true,conflict_token:result.payload.conflict_token};
    for(const changes of [{teacher_salary:'1'},{date:'非法'},{time_slot:'25:00-26:00'}]) assert.equal((await edit({...forced,changes})).response.status,400);
    assert.equal((await edit({...forced,lesson_changes:[{id:9003,changes:{notes:'越界'}}]})).response.status,400);
    assert.equal((await api('/api/lessons/batch',{method:'PATCH',cookie:teacherCookie,body:forced})).response.status,403);
    assert.equal((await api('/api/lessons/batch',{method:'PATCH',cookie:academicCookie,body:{...forced,lesson_changes:[{id:9001,changes:{teacher_name:'其他教师'}}]}})).response.status,403);
    assert.equal(db.prepare('SELECT date FROM lessons WHERE id=9001').get().date,'2026-09-01');
    assert.equal((await edit(forced)).response.status,200);
    assert.equal(db.prepare('SELECT date FROM lessons WHERE id=9001').get().date,'2026-09-03');
    assert.equal(db.prepare('SELECT notes FROM lessons WHERE id=9003').get().notes,'并发修改');
    const log=db.prepare("SELECT * FROM operation_logs WHERE operation_type='批量修改课程' ORDER BY id DESC LIMIT 1").get();
    assert.match(JSON.stringify(log),/conflict_confirmed/);assert.match(JSON.stringify(log),/true/);
    // Local changes override only selected rows, and are applied atomically.
    result=await edit({ids:[9001,9002],changes:{date:'2026-09-01'},lesson_changes:[{id:9002,changes:{date:'2026-09-02'}}]});
    assert.equal(result.response.status,200,JSON.stringify(result.payload));
    assert.equal(db.prepare('SELECT date FROM lessons WHERE id=9002').get().date,'2026-09-02');
  } finally {db.close();}
});

test('student pricing exact full-history completed matches, stored mixed types, empty rules and actual fees', async () => {
  const db=new DatabaseSync(databasePath);
  try {
    db.exec("INSERT INTO student_pricing(id,student_name,grade,subject,student_names,custom_price) VALUES(9101,'张三','高一','数学','李四、张三',120),(9102,'张三','高二','数学','张三',150); UPDATE lessons SET course_type='小班课',course_type_source='manual' WHERE id=9002; INSERT INTO fee_overrides(lesson_id,student_name,unit_price) VALUES(9002,'张三',135);");
    // Invalidate caches using a normal authorized write.
    await api('/api/student-pricing/9101',{method:'PATCH',body:{notes:''}});
    const page=(await api('/api/student-pricing-page?month=2026-10-01')).payload;
    const rule=page.rules.find(row=>row.id===9101), empty=page.rules.find(row=>row.id===9102);
    assert.equal(rule.total_lessons,2);assert.equal(rule.current_month_lessons,0);
    assert.equal(rule.start_date,'2026-09-01');assert.equal(rule.end_date,'2026-09-02');
    assert.deepEqual(rule.course_types,['1V2','小班课']);assert.equal(empty,undefined);assert.equal(db.prepare('SELECT custom_price FROM student_pricing WHERE id=9102').get().custom_price,150);
    const detail=await api('/api/student-pricing/9101/courses');assert.equal(detail.response.status,200);
    assert.deepEqual(detail.payload.lessons.map(row=>row.id),[9001,9002]);
    assert.deepEqual(detail.payload.lessons.map(row=>row.unit_price),[350,135]);
    assert.equal((await api('/api/student-pricing/9102/courses')).payload.lessons.length,0);
    assert.equal((await api('/api/student-pricing/999999/courses')).response.status,404);
    assert.equal((await api('/api/student-pricing/9101/courses',{cookie:teacherCookie})).response.status,403);
    assert.doesNotMatch(JSON.stringify(detail.payload),/teacher_salary|phone|guardian/);
  }finally{db.close();}
});

test('monthly score persists, clears without changing K, manual K clears score and summary matches cross-month allocations',async()=>{
  for(const month of ['09','10']) assert.equal((await api('/api/salary-tables',{method:'POST',body:{teacher_id:9001,name:'评分合成'+month,effective_start:`2026-${month}-01`,effective_end:`2026-${month}-${month==='09'?'30':'31'}`,rules:[{grade:'高一',course_type:'1V2',formula:'200+40K'},{grade:'高一',course_type:'小班课',formula:'200+40K'}]}})).response.status,200);
  const save=fields=>api('/api/teacher-monthly-performance',{method:'PUT',body:{teacher_name:'合成教师',month_key:'2026-09-01',...fields}});
  await save({coefficient:.73});let row=await summary();assert.equal(row.performance_score,null);assert.equal(row.performance_coefficient,.73);
  for(const [score,k] of [[0,0],[59,0],[60,.5],[79,.5],[80,.8],[95,.95],[100,1]]) {
    assert.equal((await save({performance_score:score})).response.status,200);row=await summary();
    assert.equal(row.performance_score,score);assert.equal(row.performance_coefficient,k);assert.equal(row.total_salary,400+80*k);
    const detail=(await api(workflowPath)).payload;assert.equal(detail.lessons.reduce((sum,row)=>sum+row.teacher_payroll_amount,0),row.total_salary);
  }
  for(const score of [-1,101,1.5,'x',true]) assert.equal((await save({performance_score:score})).response.status,400);
  assert.equal((await save({coefficient:.5,performance_score:95})).response.status,400);
  await save({performance_score:95});await save({performance_score:null});row=await summary();assert.equal(row.performance_score,null);assert.equal(row.performance_coefficient,.95);
  await save({performance_score:80});await save({coefficient:.73});row=await summary();assert.equal(row.performance_score,null);assert.equal(row.performance_coefficient,.73);
  await save({performance_score:95});
});

test('v7 Excel restores score, legacy K, actual salary sources and amounts; old optional-field backups remain compatible',()=>{
  const {buildFullDataBuffer,buildFullDataBufferFromSourceData,verifyFullData,restoreFullData}=require('../src/excel/full_backup');
  const db=new DatabaseSync(databasePath);
  try {
    db.exec("INSERT INTO teacher_monthly_performance(teacher_name,month_key,coefficient) VALUES('其他教师','2025-01-01',0.73); UPDATE lessons SET teacher_salary=137.25,teacher_salary_source='import' WHERE id=9003;");
    const before=db.prepare('SELECT id,teacher_salary,teacher_salary_source,teacher_base_salary_override,teacher_base_salary_source FROM lessons ORDER BY id').all();
    const backup=buildFullDataBuffer(db),verified=verifyFullData(backup.buffer);
    assert.equal(verified.version,7);assert.equal(verified.data.teacher_monthly_performance.find(row=>row.teacher_name==='合成教师').performance_score,95);
    const file=path.join(tempRoot,'scored.xlsx'),target=path.join(tempRoot,'roundtrip.sqlite');fs.writeFileSync(file,backup.buffer);
    fs.copyFileSync(databasePath,target);restoreFullData({dbPath:target,inputPath:file});
    const restored=new DatabaseSync(target);try {
      assert.deepEqual(restored.prepare('SELECT id,teacher_salary,teacher_salary_source,teacher_base_salary_override,teacher_base_salary_source FROM lessons ORDER BY id').all(),before);
      assert.equal(restored.prepare("SELECT performance_score FROM teacher_monthly_performance WHERE teacher_name='合成教师'").get().performance_score,95);
      assert.equal(restored.prepare("SELECT coefficient FROM teacher_monthly_performance WHERE teacher_name='其他教师'").get().coefficient,.73);
    }finally{restored.close();}
    const legacy=structuredClone(verified.data);for(const row of legacy.teacher_monthly_performance)delete row.performance_score;
    const old=buildFullDataBufferFromSourceData(legacy);assert.ok(verifyFullData(old.buffer).data.teacher_monthly_performance.every(row=>row.performance_score==null));
    const oldFile=path.join(tempRoot,'old-v7.xlsx');fs.writeFileSync(oldFile,old.buffer);restoreFullData({dbPath:target,inputPath:oldFile});
    const oldRestored=new DatabaseSync(target);try{const row=oldRestored.prepare("SELECT performance_score,coefficient FROM teacher_monthly_performance WHERE teacher_name='合成教师'").get();assert.equal(row.performance_score,null);assert.equal(row.coefficient,.95);}finally{oldRestored.close();}
    const broken=structuredClone(verified.data);broken.teacher_monthly_performance.find(row=>row.teacher_name==='合成教师').coefficient=.5;
    assert.throws(()=>verifyFullData(buildFullDataBufferFromSourceData(broken).buffer),/绩效分数与系数不一致/);
  }finally{db.close();}
});


test('Chromium five-width natural tables, empty editable fields, pricing details, score updates and local conflict/force/cancel flows',async()=>{
  const db=new DatabaseSync(databasePath);
  db.exec("INSERT INTO recharge_records(id,student_name,grade,cur_recharge,cur_gift,recharge_date,month_key,channel,channel_other) VALUES(9201,'张三','高一',1900,0,'2026-09-01','2026-09-01','other','1000微信+900现金');"); db.close();
  const chrome=await launchChrome(path.join(tempRoot,'oct14-ui')),browser=chrome.session;
  try {
    await browser.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await browser.login('boss','123456');
    const show=async page=>{await browser.evaluate(`(async()=>{setActiveView('${page}');activeMonth='2026-09-01';await load({refreshGlobal:true});})()`);await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');};
    for(const width of [1920,1440,1280,1024,390]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      for(const page of ['recharges','studentPricing','studentProfiles','teacherProfiles','teacherDetail']) {
        await show(page);
        if(page==='teacherDetail') {await browser.evaluate("selectedTeacherDetail='合成教师';SalaryUI.applyRange('teacher-detail-salary','2026-09-01','2026-09-30')");await browser.waitFor("document.querySelectorAll('[data-salary-class]').length===1");}
        await browser.waitFor("[...document.querySelectorAll('#content table[data-adaptive-table]')].every(table=>table.dataset.adaptiveWidths)");
        const layout=await browser.evaluate(`({page:document.documentElement.scrollWidth,width:innerWidth,tables:[...document.querySelectorAll('#content table[data-adaptive-table]')].map(table=>({natural:table.dataset.adaptiveNatural,cols:table.querySelectorAll('col').length,headers:table.querySelectorAll('thead tr:first-child th').length,widths:table.dataset.adaptiveWidths,scroll:table.closest('.table-wrap')?.scrollWidth}))})`);
        assert.ok(layout.page<=layout.width+1,`${page}/${width} page overflow: ${JSON.stringify(layout)}`);
        assert.ok(layout.tables.length);for(const table of layout.tables){assert.equal(table.natural,'true');assert.equal(table.cols,table.headers);assert.ok(table.widths);}
        if(page==='recharges') {
          assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.recharge-analysis-split-title')].map(e=>e.textContent)"),['按年级','按来源']);
          assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.recharge-analysis-breakdowns')).display"),'flex');
          const channel=await browser.evaluate("(()=>{const e=document.querySelector('.recharge-channel-cell');return {text:e.textContent.trim(),white:getComputedStyle(e).whiteSpace,client:e.clientWidth,scroll:e.scrollWidth}})()");
          assert.match(channel.text,/1000微信\+900现金/);assert.equal(channel.white,'nowrap');assert.ok(channel.scroll<=channel.client+1,JSON.stringify(channel));
        }
        if(page==='studentProfiles'||page==='teacherProfiles') assert.equal(await browser.evaluate("[...document.querySelectorAll('.profile-row [data-field=notes]')].every(e=>e.value===''&&e.placeholder==='-')"),true);
      }
    }
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await show('studentPricing');
    const headers=await browser.evaluate("[...document.querySelectorAll('.student-pricing-table th')].map(e=>e.textContent.trim())");assert.deepEqual(headers.slice(1),['序号','学生','年级','科目','类型','学生集合','起始日期','结束日期','节数','规则费用','备注']);
    await browser.click('.student-pricing-rule-row[data-rule-id="9101"] .student-pricing-select-row');assert.equal(await browser.evaluate("document.querySelectorAll('.shared-course-dialog').length"),0);
    await browser.click('.student-pricing-rule-row[data-rule-id="9101"] td:nth-child(3)');await browser.waitFor("document.querySelectorAll('.course-details-table tbody tr').length===2");
    assert.match(await browser.evaluate("document.querySelector('.shared-course-dialog').textContent"),/实际费用.*规则费用/);await browser.click('.dialog-close');
    await show('studentProfiles');
    assert.equal(await browser.evaluate("[...document.querySelectorAll('[data-field=guardian]')].every(e=>e.value===''&&e.placeholder==='-')"),true);
    await browser.evaluate("(()=>{const e=document.querySelector('.student-profile-main-row [data-field=guardian]');e.value='合成家长';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await browser.waitFor("document.querySelector('.student-profile-main-row [data-field=guardian]')?.value==='合成家长'");
    await show('teacherSalary');
    await browser.evaluate("(()=>{const e=document.querySelector('.salary-score-input[data-teacher=合成教师]');e.value='80';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await browser.waitFor("document.querySelector('.salary-coefficient-input[data-teacher=合成教师]')?.value==='0.80'");
    assert.equal(await browser.evaluate("document.querySelector('.salary-coefficient-input[data-teacher=合成教师]').readOnly"),true);
    await browser.evaluate("(()=>{const e=document.querySelector('.salary-score-input[data-teacher=合成教师]');e.value='101';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await browser.waitFor("document.querySelector('.salary-score-input[data-teacher=合成教师]')?.value==='80'");
    assert.equal(await browser.evaluate("document.querySelector('.salary-coefficient-input[data-teacher=合成教师]').value"),'0.80');
    await show('teacherDetail');await browser.evaluate("selectedTeacherDetail='合成教师';SalaryUI.applyRange('teacher-detail-salary','2026-09-01','2026-09-30')");await browser.waitFor("document.querySelectorAll('[data-salary-class]').length===1");
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.lesson-summary-grid .metric-value')].map(e=>e.textContent)"),['2 / 2 节','¥400.00','¥80.00','¥464.00']);
    assert.equal(await browser.evaluate("document.querySelectorAll('[data-salary-action=legacy],[data-salary-action=legacy-detail]').length"),0);
    await show('lessons');
    await browser.evaluate("selectedLessonIds=new Set([9001,9002]);openBatchLessonEdit();window.confirm=()=>true");
    await browser.click('[data-enable=date]');
    await browser.evaluate("document.querySelector('.batch-lesson-edit-form [name=date]').value='2026-09-03';document.querySelector('.batch-lesson-edit-form').requestSubmit()");
    await browser.waitFor("Boolean(document.querySelector('.batch-ignore-conflicts'))");
    assert.match(await browser.evaluate("document.querySelector('.batch-conflict-details').textContent"),/原有未选中/);
    await browser.evaluate("window.confirm=()=>false;document.querySelector('.batch-ignore-conflicts').click()");
    assert.ok(await browser.evaluate("Boolean(document.querySelector('.batch-lesson-edit-form'))"));
    const check=new DatabaseSync(databasePath);assert.equal(check.prepare('SELECT date FROM lessons WHERE id=9001').get().date,'2026-09-01');check.close();
    await browser.click('.batch-conflict-edit[data-id="9001"]');
    await browser.evaluate("document.querySelector('.batch-conflict-editor [name=date]').value='2026-09-04';window.confirm=()=>true;document.querySelector('.batch-conflict-editor').requestSubmit()");
    await browser.waitFor("document.querySelector('.batch-conflict-details')?.textContent.includes('仍有 1 项冲突')");
    await browser.click('.batch-ignore-conflicts');await browser.waitFor("!document.querySelector('.batch-lesson-edit-form')");
    const saved=new DatabaseSync(databasePath);try{assert.equal(saved.prepare('SELECT date FROM lessons WHERE id=9001').get().date,'2026-09-04');assert.equal(saved.prepare('SELECT date FROM lessons WHERE id=9002').get().date,'2026-09-03');assert.equal(saved.prepare('SELECT notes FROM lessons WHERE id=9003').get().notes,'并发修改');}finally{saved.close();}
    assert.deepEqual(browser.exceptions,[]);
  }finally{await browser.close();chrome.child.kill('SIGTERM');}
});


test('pricing scope and exact boundaries reject unrelated grade, subject, student and incomplete courses',async()=>{
  const db=new DatabaseSync(databasePath);
  try {
    db.exec(`INSERT INTO lessons(id,teacher_name,date,month_key,time_slot,classroom,grade,subject,course_type,student_names,status) VALUES
      (9301,'合成教师','2025-08-15','2025-08-01','11:00-13:00','A1','高一','数学','1V1','李四、张三','已上'),
      (9302,'合成教师','2024-01-01','2024-01-01','11:00-13:00','A1','高一','数学','1V2','李四、张三','待上'),
      (9303,'合成教师','2024-01-02','2024-01-01','11:00-13:00','A1','高二','数学','1V2','李四、张三','已上'),
      (9304,'合成教师','2024-01-03','2024-01-01','11:00-13:00','A1','高一','英语','1V2','李四、张三','已上'),
      (9305,'合成教师','2024-01-04','2024-01-01','11:00-13:00','A1','高一','数学','1V2','李四、张三丰','已上'),
      (9306,'其他教师','2025-08-16','2025-08-01','11:00-13:00','A1','高一','数学','1V3','张三、李四','已上');
      UPDATE users SET permission_override_enabled=1 WHERE username='salary-readonly';
      INSERT INTO user_page_permissions(user_id,permission_key,enabled) SELECT id,'studentPricing',1 FROM users WHERE username='salary-readonly';`);
    await api('/api/student-pricing/9101',{method:'PATCH',body:{notes:''}});
    const scopedCookie=await login('salary-readonly');
    const ownerPage=(await api('/api/student-pricing-page?month=2025-08-01')).payload;
    const rule=ownerPage.rules.find(row=>row.id===9101);assert.equal(rule.total_lessons,4);assert.equal(rule.current_month_lessons,2);assert.equal(rule.start_date,'2025-08-15');assert.deepEqual(rule.course_types,['1V1','1V2','1V3','小班课']);
    const ownerDetails=(await api('/api/student-pricing/9101/courses')).payload.lessons;assert.equal(ownerDetails.length,rule.total_lessons);
    const scopedPage=await api('/api/student-pricing-page?month=2025-08-01',{cookie:scopedCookie});assert.equal(scopedPage.response.status,200);
    const scopedRule=scopedPage.payload.rules.find(row=>row.id===9101);assert.equal(scopedRule.total_lessons,3);
    const scopedDetail=await api('/api/student-pricing/9101/courses',{cookie:scopedCookie});assert.equal(scopedDetail.response.status,200);assert.equal(scopedDetail.payload.lessons.length,scopedRule.total_lessons);assert.ok(scopedDetail.payload.lessons.every(row=>row.teacher_name==='合成教师'));
    assert.equal((await api('/api/student-pricing/9102/courses',{cookie:scopedCookie})).response.status,404);
    const denied=await api('/api/teacher-monthly-performance',{cookie:scopedCookie,method:'PUT',body:{teacher_name:'合成教师',month_key:'2026-09-01',performance_score:0}});assert.equal(denied.response.status,403);
  }finally{db.close();}
});

test('scored months and legacy unscored months allocate independently with salary and finance cache refresh',async()=>{
  const post=(month,fields)=>api('/api/teacher-monthly-performance',{method:'PUT',body:{teacher_name:'合成教师',month_key:month,...fields}});
  await post('2026-09-01',{performance_score:95});await post('2026-10-01',{performance_score:60});
  assert.equal((await api('/api/lessons/batch',{method:'PATCH',body:{ids:[9002],changes:{date:'2026-10-02'}}})).response.status,200);
  let details=(await api('/api/teacher-detail/workflow?'+new URLSearchParams({teacher:'合成教师',start:'2026-09-01',end:'2026-10-31'}))).payload;
  assert.deepEqual(details.lessons.map(row=>row.teacher_payroll_amount),[238,220]);
  let september=await summary();assert.equal(september.total_salary,238);
  const finance=()=>api('/api/finance-summary?start=2026-09-01&end=2026-09-30');
  assert.equal((await finance()).payload.overview.teacher_cost.current,238);
  const exported=await fetch(`http://127.0.0.1:${port}/api/export/teacher-salary.xlsx?month=2026-09-01`,{headers:{cookie:ownerCookie}});
  assert.equal(exported.status,200);
  const workbook=require('../src/excel/xlsx_codec').parseWorkbook(Buffer.from(await exported.arrayBuffer()));
  const salaryRow=workbook.sheets[0].rows.find(row=>row[1]==='合成教师');
  assert.equal(salaryRow[5],95);assert.equal(String(salaryRow[6]),'0.95');assert.equal(salaryRow[8],238);
  await post('2026-09-01',{performance_score:59});september=await summary();assert.equal(september.total_salary,200);
  assert.equal((await finance()).payload.overview.teacher_cost.current,200);
  details=(await api('/api/teacher-detail/workflow?'+new URLSearchParams({teacher:'合成教师',start:'2026-09-01',end:'2026-10-31'}))).payload;
  assert.deepEqual(details.lessons.map(row=>row.teacher_payroll_amount),[200,220]);
  await post('2026-10-01',{coefficient:.73});
  const october=(await api('/api/bootstrap?month=2026-10-01')).payload.derived.teacher_summary.find(row=>row.teacher_name==='合成教师');assert.equal(october.performance_score,null);assert.equal(october.total_salary,229.2);
});


test('fee entry migration validates exact identities, cents, scopes and preserves rule/other-student amounts', async () => {
  const details = (await api('/api/student-pricing/9101/courses')).payload;
  assert.equal(details.student_name,'张三'); assert.equal(details.can_edit_fee,true);
  const month=details.lessons[0].date.slice(0,7)+'-01';
  const id=details.lessons[0].id, db=new DatabaseSync(databasePath);
  const rule=db.prepare('SELECT * FROM student_pricing WHERE id=9101').get();
  const otherBefore=db.prepare('SELECT * FROM fee_overrides WHERE lesson_id=? AND student_name=?').get(id,'李四');
  const write=(value,student='张三',cookie=ownerCookie)=>api('/api/fee-overrides',{method:'POST',cookie,body:{lesson_id:id,student_name:student,unit_price:value}});
  try {
    for(const value of [0,220.25,10000]) { const saved=await write(value);assert.equal(saved.response.status,200,JSON.stringify(saved.payload));assert.equal(saved.payload.unit_price,value);assert.equal((await api('/api/student-pricing/9101/courses')).payload.lessons.find(row=>row.id===id).unit_price,value); }
    for(const value of [-1,10000.01,'NaN','abc',0.001,true,' ']) assert.equal((await write(value)).response.status,400,String(value));
    assert.equal((await write(220,'张')).response.status,404);
    assert.equal((await write(220,'张三',teacherCookie)).response.status,403);
    assert.deepEqual(db.prepare('SELECT * FROM student_pricing WHERE id=9101').get(),rule);
    assert.deepEqual(db.prepare('SELECT * FROM fee_overrides WHERE lesson_id=? AND student_name=?').get(id,'李四'),otherBefore);
    assert.equal((await api('/api/student-pricing/9101/courses',{cookie:teacherCookie})).payload.can_edit_fee,false);
    const beforeSummary=(await api('/api/bootstrap?month='+month)).payload.derived.student_summary.find(row=>row.student_name==='张三');
    await write(220);
    const fee=(await api('/api/bootstrap?month='+month)).payload.derived.fee_details.find(row=>row.lesson_id===id&&row.student_name==='张三');
    assert.equal(fee.unit_price,220);
    const boot=(await api('/api/bootstrap?month='+month)).payload;
    assert.equal(boot.derived.fee_details.find(row=>row.lesson_id===id&&row.student_name==='张三').unit_price,220);
    const afterSummary=boot.derived.student_summary.find(row=>row.student_name==='张三');
    assert.equal(beforeSummary.total_fee-afterSummary.total_fee,9780);
    assert.equal(afterSummary.actual_balance+afterSummary.gift_balance-beforeSummary.actual_balance-beforeSummary.gift_balance,9780);
    const {buildFullDataBuffer,restoreFullData}=require('../src/excel/full_backup');
    const file=path.join(tempRoot,'fee-migration.xlsx'),target=path.join(tempRoot,'fee-migration-restore.sqlite');
    fs.writeFileSync(file,buildFullDataBuffer(db).buffer);fs.copyFileSync(databasePath,target);restoreFullData({dbPath:target,inputPath:file});
    const restored=new DatabaseSync(target);try {assert.deepEqual(restored.prepare('SELECT lesson_id,student_name,unit_price FROM fee_overrides ORDER BY lesson_id,student_name').all(),db.prepare('SELECT lesson_id,student_name,unit_price FROM fee_overrides ORDER BY lesson_id,student_name').all());}finally{restored.close();}
  }finally {db.close();}
});

test('Chromium fee modal saves locally, cancels and rolls back errors at five widths; details stay readonly', async()=>{
  const chrome=await launchChrome(path.join(tempRoot,'fee-migration-chrome')), browser=chrome.session;
  try {
    await browser.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await browser.login('boss','123456');
    await browser.evaluate("setActiveView('studentPricing');load({refreshGlobal:false})");
    await browser.waitFor("!!document.querySelector('.student-pricing-rule-row[data-rule-id=\"9101\"]')");
    await browser.click('.student-pricing-rule-row[data-rule-id="9101"] td.row-index');
    await browser.waitFor("!!document.querySelector('.pricing-course-fee-edit')");
    for(const width of [1920,1440,1280,1024,390]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
      assert.ok(await browser.evaluate("(()=>{const p=document.querySelector('.shared-course-dialog .modal-panel').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&Math.abs((p.left+p.right)/2-innerWidth/2)<2;})()"));
    }
    await browser.click('.pricing-course-fee-edit');
    assert.ok(await browser.evaluate("(()=>{const cell=document.querySelector('.pricing-course-fee-input').closest('td');return cell.scrollWidth<=cell.clientWidth+1;})()"),'fee editor must fit its cell');
    await browser.evaluate("document.querySelector('.pricing-course-fee-input').value='0'");
    await browser.click('.pricing-course-fee-save');
    await browser.waitFor("!!document.querySelector('.pricing-course-fee-edit')&&!document.querySelector('.pricing-course-fee-input')");
    assert.match(await browser.evaluate("document.querySelector('.pricing-course-fee-edit').textContent"),/0.00/);
    await browser.click('.pricing-course-fee-edit');await browser.evaluate("document.querySelector('.pricing-course-fee-input').value='99'");await browser.click('.pricing-course-fee-cancel');
    assert.match(await browser.evaluate("document.querySelector('.pricing-course-fee-edit').textContent"),/0.00/);
    await browser.evaluate("window.realFeeRequest=request;request=(path,options)=>path==='/api/fee-overrides'?Promise.reject(new Error('合成保存失败')):realFeeRequest(path,options)");
    await browser.click('.pricing-course-fee-edit');await browser.evaluate("document.querySelector('.pricing-course-fee-input').value='99'");await browser.click('.pricing-course-fee-save');
    await browser.waitFor("!!document.querySelector('.pricing-course-fee-edit')&&!document.querySelector('.pricing-course-fee-input')");
    assert.match(await browser.evaluate("document.querySelector('.pricing-course-fee-edit').textContent"),/0.00/);
    await browser.evaluate("request=realFeeRequest");await browser.click('.shared-course-dialog .dialog-close');
    await browser.evaluate("setActiveView('feeDetails');load({refreshGlobal:false})");await browser.waitFor("!!document.querySelector('.student-summary-table')");
    assert.equal(await browser.evaluate("document.querySelectorAll('.fee-override,.fee-detail-select-row,.fee-detail-select-all,.apply-selected-student-pricing-rules').length"),0);
    assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
  } finally {await browser.close();if(chrome.child.exitCode==null)chrome.child.kill();}
});
