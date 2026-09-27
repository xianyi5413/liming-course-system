const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { test, before, after } = require('node:test');
const { freePort, launchChrome } = require('./helpers/chrome_cdp');
const root = path.resolve(__dirname, '..');
let temp, dbPath, server, port, cookie, environment;
function init(filename) {
  const result = spawnSync(process.execPath, [path.join(root, 'src/server.js'), '--init-db'], { env: { ...environment, DATA_DIR: path.dirname(filename), DB_PATH: filename }, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}
async function api(url, method = 'GET', body, auth = cookie) {
  const response = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { cookie: auth || '', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
before(async () => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'liming-table-index-'));
  dbPath = path.join(temp, 'synthetic.sqlite');
  environment = { ...process.env, DATA_DIR: temp, DB_PATH: dbPath, SESSION_COOKIE_SECURE: 'false', BAIDU_APP_KEY: '', BAIDU_APP_SECRET: '', BAIDU_REDIRECT_URI: '' };
  init(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec(`INSERT INTO teachers(name,status) VALUES ('合成老师','在职'),('合成老师乙','在职');
    INSERT INTO students(name,grade,status) VALUES ('合成学生','高一','在读'),('合成学生乙','高二','在读'),('合成历史生','初二','已流出');
    UPDATE settings SET value='2026-07-01' WHERE key='month_key';`);
  db.close();
  port = await freePort();
  server = spawn(process.execPath, [path.join(root, 'src/server.js')], { env: { ...environment, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 50)); }
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'boss', password: '123456' }) });
  assert.equal(response.status, 200);
  cookie = response.headers.get('set-cookie').split(';')[0];
  await seedUiData();
});
after(async () => {
  if (server?.exitCode == null) { const done = new Promise(r => server.once('exit', r)); server.kill(); await done; }
  if (temp) await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
});


async function browserRun(action) {
  const chrome = await launchChrome(path.join(temp, 'chrome-' + Date.now()));
  try { await chrome.session.send('Page.navigate', {url:`http://127.0.0.1:${port}/`}); await chrome.session.login('boss','123456'); await action(chrome.session); }
  finally { await chrome.session.close(); if(chrome.child.exitCode==null){const exited=new Promise(r=>chrome.child.once('exit',r));chrome.child.kill();await exited;} }
}

async function seedUiData() {
  for(let i=0;i<12;i++) {
    const result=await api('/api/lessons','POST',{teacher_name:i%2?'合成老师乙':'合成老师',date:`2026-07-${String(i+1).padStart(2,'0')}`,month_key:'2026-07-01',time_slot:'08:00-10:00',classroom:'A1',grade:i%2?'高二':'高一',subject:i%2?'英语':'数学',student_names:i%2?'合成学生乙':'合成学生',status:'已上',notes:i===0?'长备注需要自然换行。'.repeat(40):''});
    assert.equal(result.status,201);
  }
  await api('/api/teacher-salary-rules/sync-candidates','POST',{});
  const db=new DatabaseSync(dbPath);
  db.exec("INSERT INTO recharge_records(id,student_name,grade,cur_recharge,cur_gift,recharge_date,month_key) VALUES (701,'合成学生','高一',500,0,'2026-07-01','2026-07-01'),(702,'合成学生乙','高二',700,0,'2026-07-02','2026-07-01'),(703,'合成学生','高一',100,0,'2026-07-03','2026-07-01')");
  db.exec("INSERT INTO student_opening_balances(id,student_name,opening_actual_balance,opening_gift_balance,notes) VALUES (801,'合成学生',100,0,''),(802,'合成学生乙',200,0,'')");
  db.exec("UPDATE teacher_salary_rules SET salary_per_unit=120,is_active=1; UPDATE teacher_salary_rules SET is_active=-1 WHERE teacher_name='合成老师乙'");
  db.prepare("UPDATE teacher_salary_rules SET notes=? WHERE teacher_name='合成老师'").run('薪资备注自然换行。'.repeat(40));
  db.close();
}
async function show(browser, page) {
  await browser.evaluate(`(async()=>{setActiveView(${JSON.stringify(page)});activeMonth='2026-07-01';if(view==='teacherDetail')selectedTeacherDetail='合成老师';selectedStudent='合成学生';studentQueryRange={mode:'range',start:'2026-07-01',end:'2026-07-31'};await load({refreshGlobal:false});})()`);
  if(page==='teacherSalaryRules') await browser.waitFor('teacherSalaryRuleCandidateSync.requested && !teacherSalaryRuleCandidateSync.busy');
}

const { validRechargeDate, migrateRechargeDates } = require('../src/domain/recharge_date');
test('recharge calendar migration is idempotent, preserves dates and reports ambiguous records',()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE recharge_records(id INTEGER PRIMARY KEY,recharge_date TEXT,month_key TEXT,source TEXT,cur_recharge REAL,cur_gift REAL)");
 assert.deepEqual(migrateRechargeDates(db),{filled:0,realigned:0,unresolved:0,carry_over_preserved:0});
 const insert=db.prepare('INSERT INTO recharge_records VALUES (?,?,?,?,?,?)');
 insert.run(1,'','2026-02-01','manual',100,0);insert.run(2,'2026-03-05','2026-02-01','manual',100,10);insert.run(3,'','','manual',50,0);insert.run(4,'','2026-02-01','carry_over',0,0);insert.run(5,'2026-02-30','2026-02-01','manual',10,0);
 assert.deepEqual(migrateRechargeDates(db),{filled:1,realigned:1,unresolved:2,carry_over_preserved:1});
 assert.equal(db.prepare('SELECT recharge_date FROM recharge_records WHERE id=1').get().recharge_date,'2026-02-01');
 assert.equal(db.prepare('SELECT recharge_date FROM recharge_records WHERE id=2').get().recharge_date,'2026-03-05');
 assert.deepEqual(migrateRechargeDates(db),{filled:0,realigned:0,unresolved:2,carry_over_preserved:1});
 assert.ok(validRechargeDate('2024-02-29'));assert.equal(validRechargeDate('2026-02-29'),false);assert.equal(validRechargeDate('2026-03-01T00:00:00Z'),false);db.close();
});
test('recharge dates override UI months and cross-month changes refresh summaries and balances',async()=>{
 const name='合成跨月学生';
 const create=async(date,month,actual=100,gift=10)=>api('/api/recharges','POST',{student_name:name,grade:'高一',recharge_date:date,month_key:month,cur_recharge:actual,cur_gift:gift});
 for(const date of ['',undefined,'2026-02-30']){const result=await create(date,'2026-02-01');assert.equal(result.status,400);}
 assert.equal((await create('','2026-02-01',-100,0)).status,400);
 const feb=await create('2026-02-10','2026-02-01');assert.equal(feb.status,201);assert.equal(feb.data.row.month_key,'2026-02-01');
 for(const month of ['2026-02-01','2026-07-01']) {const result=await create('2026-03-01',month);assert.equal(result.status,201);assert.equal(result.data.row.month_key,'2026-03-01');}
 const summary=async month=>(await api('/api/bootstrap?month='+month)).data.derived.student_summary.find(r=>r.student_name===name);
 assert.equal((await summary('2026-02-01')).cur_recharge,100);assert.equal((await summary('2026-03-01')).cur_recharge,200);
 const moved=await api('/api/recharges/'+feb.data.row.id,'PATCH',{recharge_date:'2026-03-05',month_key:'2026-02-01'});assert.equal(moved.status,200);assert.equal(moved.data.row.month_key,'2026-03-01');
 assert.equal((await api('/api/recharges?month=2026-02-01')).data.recharges.filter(r=>r.student_name===name).length,0);
 assert.equal((await summary('2026-02-01'))?.cur_recharge||0,0);
 const march=await summary('2026-03-01');assert.equal(march.cur_recharge,300);assert.equal(march.cur_gift,30);assert.equal(march.actual_balance,300);assert.equal(march.gift_balance,30);
 assert.equal((await create('2026-03-06','2026-02-01',-25,0)).status,201);
 assert.equal((await summary('2026-03-01')).actual_balance,275);
 assert.equal((await create('2026-03-01','2026-03-01',0,0)).status,400);
});
test('full Excel v4 restore fills historical dates inside the restore transaction',()=>{
 const { exportFullData, restoreFullData }=require('../src/excel/full_backup');
 const source=path.join(temp,'old-source','source.sqlite');fs.mkdirSync(path.dirname(source));init(source);
 const db=new DatabaseSync(source);db.exec("INSERT INTO students(name,grade,status) VALUES ('兼容学生','高一','在读'); INSERT INTO recharge_records(student_name,grade,cur_recharge,recharge_date,month_key) VALUES ('兼容学生','高一',100,'','2026-02-01')");db.close();
 const target=path.join(temp,'restored','target.sqlite');fs.mkdirSync(path.dirname(target));init(target);
 const file=path.join(temp,'synthetic.xlsx');exportFullData({dbPath:source,outputPath:file});
 const restored=restoreFullData({dbPath:target,inputPath:file});assert.equal(restored.recharge_migration.filled,1);
 const output=new DatabaseSync(target);assert.equal(output.prepare('SELECT recharge_date FROM recharge_records').get().recharge_date,'2026-02-01');assert.equal(migrateRechargeDates(output).filled,0);output.close();
});

test('existing databases upgrade on startup once and preserve recharge dates on repeated startup',()=>{
 const file=path.join(temp,'startup-history.sqlite');init(file);
 const db=new DatabaseSync(file);
 db.exec("INSERT INTO recharge_records(student_name,grade,cur_recharge,recharge_date,month_key) VALUES ('历史补全','高一',100,'','2026-02-01'),('历史对齐','高一',200,'2026-03-08','2026-02-01')");db.close();
 init(file);
 const read=()=>{const db=new DatabaseSync(file);try{return db.prepare('SELECT student_name,recharge_date,month_key,cur_recharge FROM recharge_records ORDER BY id').all();}finally{db.close();}};
 const once=read();assert.equal(once[0].recharge_date,'2026-02-01');assert.equal(once[1].recharge_date,'2026-03-08');assert.equal(once[1].month_key,'2026-03-01');
 init(file);assert.deepEqual(read(),once);
});
