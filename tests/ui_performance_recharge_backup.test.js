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

test('shared filters, matrix container and settings fit four viewport widths',async()=>browserRun(async browser=>{
 for(const width of [1440,1280,1024,390]){
  await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
  for(const page of ['lessons','weekMatrix','feeDetails','recharges','studentQuery','studentPricing','classGroups','studentProfiles','teacherDetail','teacherSalaryRules','teacherProfiles','audit','userAdmin','baseData']){
   await show(browser,page);await browser.evaluate('new Promise(requestAnimationFrame)');
   const result=await browser.evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,controls:[...document.querySelectorAll('.filter-bar .filter-field')].map(e=>e.getBoundingClientRect().width)})`);
   assert.equal(result.overflow,false,JSON.stringify({width,page,result}));
   assert.ok(result.controls.every(value=>value<=300),JSON.stringify({width,page,result}));
   if(page==='weekMatrix')assert.equal(await browser.evaluate("document.querySelectorAll('.matrix-unified-filter .matrix-view-tab').length"),3);
   if(page==='baseData')assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.base-data-grid')).gridTemplateColumns.split(' ').length"),1);
   if(page==='audit'){const over=await browser.evaluate("[...document.querySelectorAll('.data-backup-subcard input,.data-backup-subcard .custom-select')].filter(e=>e.getBoundingClientRect().right>e.closest('.data-backup-subcard').getBoundingClientRect().right+1).map(e=>({class:e.className,width:e.getBoundingClientRect().width}))");assert.deepEqual(over,[],JSON.stringify({width,over}));}
  }
 }
 assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));
test('empty values, single-line lesson rows, wrapping tasks and screenshot-only omission',async()=>browserRun(async browser=>{
 await show(browser,'lessons');
 assert.ok(await browser.evaluate(`(()=>{const row={id:1,status:'待上',teacher_name:'',date:'',time_slot:'',classroom:'',course_type:'',grade:'',subject:'',student_names:'',notes:''};return !/未填/.test(lessonReadonlyCells(row,1,1)+lessonEditCells(row,1,1))&&renderEmptyValue().includes('>-<');})()`));
 assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.lesson-table .col-note')).whiteSpace"),'nowrap');
 assert.ok(await browser.evaluate("[...document.querySelectorAll('.lesson-table td.col-note .lesson-cell-text')].every(e=>getComputedStyle(e).whiteSpace==='nowrap')"));
 await show(browser,'teacherDetail');
 assert.ok(await browser.evaluate("[...document.querySelectorAll('.teacher-detail-table tbody td')].every(e=>getComputedStyle(e).whiteSpace==='nowrap')"));
 const teacherLabels=await browser.evaluate(`(()=>{const texts=[],original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){texts.push(text);return original.call(this,text,...args);};try{teacherDetailCanvas('合成老师');}finally{CanvasRenderingContext2D.prototype.fillText=original;}return texts;})()`);assert.ok(teacherLabels.includes('备注'));
 await show(browser,'studentQuery');
 assert.ok(await browser.evaluate("document.querySelector('.student-query-detail-slot').textContent.includes('明细课时表')&&document.querySelector('.student-query-detail-table thead').textContent.includes('备注')"));
 const labels=await browser.evaluate(`(()=>{const texts=[],original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){texts.push(text);return original.call(this,text,...args);};try{studentStatementCanvas(studentStatementReport());}finally{CanvasRenderingContext2D.prototype.fillText=original;}return texts;})()`);assert.ok(!labels.includes('备注'));assert.ok(labels.includes('明细课时表'));
 await show(browser,'teacherProfiles');assert.equal(await browser.evaluate("document.querySelector('.teacher-profile-table [data-field=phone]').placeholder"),'-');
 await show(browser,'pricing');assert.ok(await browser.evaluate("[...document.querySelectorAll('.pricing-table td.row-index')].every((cell,index)=>Number(cell.textContent)===index+1)"));
 await show(browser,'recharges');assert.ok(await browser.evaluate("!!document.querySelector('.recharge-analysis-chip.recharge-analysis-card')"));
 const money=await browser.evaluate(`(()=>{const input=document.querySelector('.currency-input');input.focus();const r=input.getBoundingClientRect();return {value:input.value,x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 await browser.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:money.x,y:money.y,deltaX:0,deltaY:-100});assert.equal(await browser.evaluate("document.querySelector('.currency-input').value"),money.value);
 await browser.evaluate("rechargeModalOpen=true;rechargeModalDraft={recharge_date:'',cur_recharge:100,cur_gift:0};render();document.querySelector('#new-recharge-student').value='合成学生';document.querySelector('#new-recharge-date').value='';window.rechargeAlert='';window.alert=text=>window.rechargeAlert=text;document.querySelector('.add-recharge-record').click();");assert.match(await browser.evaluate('window.rechargeAlert'),/充值日期/);
 assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));
test('salary status and account role reuse keyboard inline popup without permanent boxes',async()=>browserRun(async browser=>{
 await show(browser,'teacherSalaryRules');assert.equal(await browser.evaluate("document.querySelectorAll('.rule-status-cell input').length"),0);
 const id=await browser.evaluate("Number(document.querySelector('.rule-activation').dataset.ruleId)");
 await browser.evaluate("document.querySelector('.rule-activation').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));");
 assert.ok(await browser.evaluate('!!activeScheduleInlinePicker'));
 await browser.evaluate("var select=activeScheduleInlinePicker.select;select.value='-1';select.dispatchEvent(new Event('change',{bubbles:true}));");
 await browser.waitFor(`document.querySelector('.rule-activation[data-rule-id="${id}"]')?.textContent.includes('已停用')`);
 const db=new DatabaseSync(dbPath);assert.equal(db.prepare('SELECT is_active FROM teacher_salary_rules WHERE id=?').get(id).is_active,-1);db.close();
 const created=await api('/api/users','POST',{username:'synthetic-role',display_name:'合成角色',password:'synthetic-password',role:'academic',status:'active'});assert.equal(created.status,201);
 await show(browser,'userAdmin');assert.equal(await browser.evaluate("document.querySelectorAll('.user-role-cell select').length"),0);
 await browser.evaluate(`document.querySelector('.user-row[data-id="${created.data.id}"] .user-role-cell').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));`);
 await browser.evaluate("var select=activeScheduleInlinePicker.select;select.value='teacher';select.dispatchEvent(new Event('change',{bubbles:true}));");
 await browser.waitFor(`document.querySelector('.user-row[data-id="${created.data.id}"] .user-role-cell').textContent.includes('老师')`);
 assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));
test('backup records use server pagination and global display numbers',async()=>browserRun(async browser=>{
 const db=new DatabaseSync(dbPath);const insert=db.prepare("INSERT INTO backup_records(filename,status,created_at,backup_format,format_version,managed_relative_path) VALUES (?,'failed',?,'full_data_excel',4,?)");for(let i=0;i<23;i++)insert.run('synthetic-'+i+'.xlsx',`2026-09-${String(i+1).padStart(2,'0')} 00:00:00`,'backups/full-excel/synthetic-'+i+'.xlsx');db.close();
 const first=await api('/api/data-center?page=1&page_size=10');assert.equal(first.data.records.length,10);assert.equal(first.data.pagination.total,23);
 await show(browser,'audit');assert.equal(await browser.evaluate("document.querySelectorAll('.data-center-backup-table td.row-index').length"),10);
 await browser.click('.backup-page[data-page="2"]');await browser.waitFor("document.querySelector('.data-center-backup-table td.row-index')?.textContent==='11'");
 const last=await api('/api/data-center?page=99&page_size=10');assert.equal(last.data.pagination.page,3);assert.equal(last.data.records.length,3);
 await browser.click('.backup-page[data-page="3"]');await browser.waitFor("document.querySelector('.data-center-backup-table td.row-index')?.textContent==='21'");
 for(const record of last.data.records){const removed=await api('/api/data-center/backups/'+record.id,'DELETE',{});assert.equal(removed.status,200,JSON.stringify(removed.data));}
 await browser.click('.backup-refresh');await browser.waitFor("document.querySelector('.data-center-backup-table td.row-index')?.textContent==='11' && document.querySelectorAll('.data-center-backup-table td.row-index').length===10");
 const clamped=await api('/api/data-center?page=3&page_size=10');assert.equal(clamped.data.pagination.page,2);assert.equal(clamped.data.pagination.total,20);
 assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));
