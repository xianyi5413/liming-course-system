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
const pages = [
  ['summary','.student-summary-table',0], ['feeDetails','.fee-detail-table',1],
  ['recharges','.recharge-table',1], ['openingBalances','.opening-balance-table',1],
  ['studentQuery','.student-query-detail-table',0], ['studentPricing','.student-pricing-table',1],
  ['classGroups','.class-group-table',0], ['studentProfiles','.student-profile-table',1],
  ['teacherSalary','.teacher-salary-table',0], ['teacherTravelFees','.teacher-travel-table',0],
  ['teacherDetail','.teacher-detail-table',1], ['teacherSalaryRules','.teacher-salary-rule-table',1],
  ['userAdmin','.user-table:not(.role-table)',0],
];
async function assertIndexes(browser, selector, position) {
  const result=await browser.evaluate(`(()=>{const table=document.querySelector(${JSON.stringify(selector)}),head=[...table.tHead.rows[0].cells],rows=[...table.tBodies[0].rows].filter(row=>!row.querySelector('.empty')&&!row.textContent.includes('合计'));return {heads:head.filter(cell=>cell.textContent==='序号').length,position:head.findIndex(cell=>cell.textContent==='序号'),values:rows.map(row=>Number(row.querySelector('.row-index')?.textContent)),counts:rows.map(row=>row.cells.length),columns:head.length};})()`);
  assert.equal(result.heads,1,selector);assert.equal(result.position,position,selector);
  assert.ok(result.values.length>0,selector);assert.deepEqual(result.values,result.values.map((_,i)=>i+1),selector);
  assert.ok(result.counts.every(n=>n===result.columns),selector);
}

test('thirteen pages use continuous display indexes and keep responsive sticky tables and ID controls',async()=>browserRun(async browser=>{
  for(const width of [1440,1280,1024,390]) {
    await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    for(const [page,selector,position] of pages) {
      await browser.evaluate("selectedTeacherDetail='合成老师';");await show(browser,page);
      if(page==='teacherDetail') await browser.evaluate("selectedTeacherDetail='合成老师';render();");
      if(page==='studentPricing') await browser.waitFor("document.querySelector('.student-pricing-table')?.dataset.renderComplete==='true'");
      await browser.evaluate('new Promise(requestAnimationFrame)');
      await assertIndexes(browser,selector,position);
      const layout=await browser.evaluate(`(()=>{const table=document.querySelector(${JSON.stringify(selector)}),cell=table.querySelector('td.row-index'),style=getComputedStyle(cell);return {width:cell.getBoundingClientRect().width,align:style.textAlign,vertical:style.verticalAlign,wrap:style.whiteSpace,nums:style.fontVariantNumeric,sticky:[...table.querySelectorAll('th')].every(th=>getComputedStyle(th).position==='sticky'),overflow:document.documentElement.scrollWidth>innerWidth,totals:[...table.tBodies[0].rows].filter(row=>row.textContent.includes('合计')).map(row=>row.querySelector('.row-index')?.textContent)};})()`);
      assert.ok(layout.width>=44&&layout.width<=57,JSON.stringify({page,width,layout}));
      assert.equal(layout.align,'center');assert.equal(layout.vertical,'middle');assert.equal(layout.wrap,'nowrap');assert.match(layout.nums,/tabular-nums/);assert.ok(layout.sticky,page);assert.equal(layout.overflow,false,page);assert.ok(layout.totals.every(value=>value===''));
      if(page==='studentQuery') assert.equal(await browser.evaluate("!!document.querySelector('.student-history-table .row-index')"),false);
      if(page==='classGroups') assert.equal(await browser.evaluate("!!document.querySelector('.new-class-group')"),false);
    }
  }
  await show(browser,'recharges');
  const ids=await browser.evaluate("[...document.querySelectorAll('.recharge-select-row')].map(input=>Number(input.dataset.id))");assert.ok(ids.every(id=>id>=701));
  await browser.click('.recharge-select-row');assert.ok(await browser.evaluate('selectedRechargeIds.has(Number(document.querySelector(".recharge-select-row").dataset.id))'));
  await show(browser,'userAdmin');assert.ok(await browser.evaluate("[...document.querySelectorAll('.user-row')].every(row=>row.querySelector('.user-delete').dataset.id===row.dataset.id)"));
  assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));

test('filters, history, teacher changes and real recharge deletion regenerate display order',async()=>browserRun(async browser=>{
  const filters=[
    ['summary','.student-summary-table',0,"summaryFilter={...summaryFilter,grade:'高二'};"],
    ['feeDetails','.fee-detail-table',1,"feeDetailsFilter={...feeDetailsFilter,grade:'高二'};"],
    ['recharges','.recharge-table',1,"rechargeStudentFilter='合成学生乙';"],
    ['openingBalances','.opening-balance-table',1,"openingBalanceFilter={...openingBalanceFilter,student:'合成学生乙'};"],
    ['studentPricing','.student-pricing-table',1,"studentPricingFilter={...studentPricingFilter,student:'合成学生乙'};"],
    ['classGroups','.class-group-table',0,"classGroupFilter={...classGroupFilter,teacher:'合成老师乙'};"],
    ['studentProfiles','.student-profile-table',1,"profileGradeFilter.students='高二';"],
    ['teacherSalaryRules','.teacher-salary-rule-table',1,"teacherSalaryRuleFilter={...teacherSalaryRuleFilter,teacher:'合成老师乙'};"],
  ];
  for(const [page,selector,position,filter] of filters) {
    await show(browser,page);
    const before=await browser.evaluate(`document.querySelectorAll(${JSON.stringify(selector+' tbody tr')}).length`);
    await browser.evaluate(filter+'render();');await browser.evaluate('new Promise(requestAnimationFrame)');
    await assertIndexes(browser,selector,position);
    assert.ok(await browser.evaluate(`document.querySelectorAll(${JSON.stringify(selector+' tbody tr')}).length`)<before,page);
  }
  for(const teacher of ['合成老师','合成老师乙']) {
    await show(browser,'teacherDetail');await browser.evaluate(`(async()=>{selectedTeacherDetail=${JSON.stringify(teacher)};await load({refreshGlobal:false});})()`);await assertIndexes(browser,'.teacher-detail-table',1);
  }
  await browser.evaluate("selectedTeacherDetail='';render();");assert.equal(await browser.evaluate("document.querySelectorAll('.teacher-detail-table td.row-index').length"),0);
  await browser.evaluate("profileGradeFilter.students='';includeInactive=true;");await show(browser,'studentProfiles');await assertIndexes(browser,'.student-profile-table',1);
  assert.ok(await browser.evaluate("[...document.querySelectorAll('.student-name-cell')].some(cell=>cell.textContent.includes('合成历史生'))"));
  await browser.evaluate("includeInactive=false;");await show(browser,'studentProfiles');await assertIndexes(browser,'.student-profile-table',1);
  // The existing profile API returns all profiles; status filtering is independent of this global history toggle.
  assert.ok(await browser.evaluate("[...document.querySelectorAll('.student-name-cell')].some(cell=>cell.textContent.includes('合成历史生'))"));
  await browser.evaluate("rechargeStudentFilter='';");await show(browser,'recharges');
  await browser.evaluate("request('/api/recharges/702',{method:'DELETE'})");await show(browser,'recharges');await assertIndexes(browser,'.recharge-table',1);
  assert.equal(await browser.evaluate(`!!document.querySelector('.recharge-row[data-id="702"]')`),false);
  assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));

test('compact rows grow with notes, salary state stays one line and activation retains matching semantics',async()=>browserRun(async browser=>{
  for(const [page,selector] of [['feeDetails','.fee-detail-table'],['teacherDetail','.teacher-detail-table'],['teacherSalaryRules','.teacher-salary-rule-table']]) {
    await show(browser,page);if(page==='teacherDetail')await browser.evaluate("selectedTeacherDetail='合成老师';render();");
    await browser.evaluate('new Promise(requestAnimationFrame)');
    const heights=await browser.evaluate(`(()=>{const rows=[...document.querySelectorAll(${JSON.stringify(selector+' tbody tr')})];return rows.map(row=>({height:row.getBoundingClientRect().height,note:(row.querySelector('[data-field="notes"]')?.value||row.querySelector('.content-wrap,.teacher-detail-notes')?.textContent||''),scroll:[...row.cells].some(cell=>['auto','scroll'].includes(getComputedStyle(cell).overflowY))}));})()`);
    const short=heights.find(row=>!row.note),long=heights.find(row=>row.note);
    assert.ok(short&&long,JSON.stringify({page,heights}));assert.ok(short.height<=55,JSON.stringify({page,short}));assert.ok(long.height>short.height,JSON.stringify({page,heights}));assert.ok(heights.every(row=>!row.scroll));
  }
  const rule=await browser.evaluate(`(()=>{const row=[...document.querySelectorAll('.teacher-salary-rule-row')].find(row=>!row.querySelector('.teacher-salary-rule-active').checked),cell=row.querySelector('.rule-status-cell'),label=cell.querySelector('.visible-price-status'),input=cell.querySelector('input');return {id:Number(row.dataset.ruleId),text:cell.textContent.trim(),badges:cell.querySelectorAll('.visible-price-status').length,delta:Math.abs((label.getBoundingClientRect().top+label.getBoundingClientRect().height/2)-(input.getBoundingClientRect().top+input.getBoundingClientRect().height/2)),title:cell.querySelector('label').title};})()`);
  assert.equal(rule.badges,1);assert.doesNotMatch(rule.text,/参与匹配|已停用/);assert.ok(rule.delta<2);assert.match(rule.title,/停用/);
  const before=new DatabaseSync(dbPath);assert.equal(before.prepare('SELECT is_active FROM teacher_salary_rules WHERE id=?').get(rule.id).is_active,-1);before.close();
  await browser.evaluate(`document.querySelector('.teacher-salary-rule-row[data-rule-id="${rule.id}"] .teacher-salary-rule-active').click()`);
  await browser.waitFor(`!!document.querySelector('.teacher-salary-rule-row[data-rule-id="${rule.id}"] .teacher-salary-rule-active:checked')`);
  for(let i=0;i<100;i++){const db=new DatabaseSync(dbPath);const active=db.prepare('SELECT is_active FROM teacher_salary_rules WHERE id=?').get(rule.id).is_active;db.close();if(active===1)break;await new Promise(r=>setTimeout(r,20));}
  const db=new DatabaseSync(dbPath);const saved=db.prepare('SELECT is_active,salary_per_unit FROM teacher_salary_rules WHERE id=?').get(rule.id);db.close();assert.equal(saved.is_active,1);assert.equal(saved.salary_per_unit,120);
  assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));


test('account insertion, reordered data and query ranges retain display-only numbering',async()=>browserRun(async browser=>{
  await show(browser,'userAdmin');
  const created=await browser.evaluate(`(async()=>{const user=await request('/api/users',{method:'POST',body:{username:'synthetic-index-account',display_name:'合成序号账号',password:'synthetic-test-password',role:'academic',status:'active'}});patchUserState(user);insertUserAccountRow(user);return user.id;})()`);
  assert.ok(created>0);await assertIndexes(browser,'.user-table:not(.role-table)',0);
  const order=await browser.evaluate(`(()=>{state.users.reverse();render();return [...document.querySelectorAll('.user-row')].map(row=>Number(row.dataset.id));})()`);
  assert.equal(order[0],await browser.evaluate('state.users[0].id'));await assertIndexes(browser,'.user-table:not(.role-table)',0);
  await browser.evaluate(`(async()=>{await request('/api/users/${created}',{method:'DELETE'});await load();})()`);await assertIndexes(browser,'.user-table:not(.role-table)',0);
  await show(browser,'studentQuery');
  const before=await browser.evaluate('studentStatementCanvas(studentStatementReport()).toDataURL()');
  await browser.evaluate("updateStudentQueryResultsOnly();");
  assert.equal(await browser.evaluate('studentStatementCanvas(studentStatementReport()).toDataURL()'),before);
  for(const mode of ['all','range']) {
    await browser.evaluate(`(async()=>{studentQueryRange={mode:${JSON.stringify(mode)},start:'2026-07-03',end:'2026-07-09'};await load({refreshGlobal:false});})()`);
    await assertIndexes(browser,'.student-query-detail-table',0);
    assert.equal(await browser.evaluate("!!document.querySelector('.student-history-table .row-index')"),false);
  }
  assert.deepEqual(await browser.evaluate('[rowIndexValue(0,40),rowIndexValue(1,40)]'),[41,42]);
  assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));
