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
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'liming-pinyin-layout-'));
  dbPath = path.join(temp, 'synthetic.sqlite');
  environment = { ...process.env, DATA_DIR: temp, DB_PATH: dbPath, SESSION_COOKIE_SECURE: 'false', BAIDU_APP_KEY: '', BAIDU_APP_SECRET: '', BAIDU_REDIRECT_URI: '' };
  init(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec(`INSERT INTO teachers(name,status) VALUES ('合成老师','在职'),('合成老师乙','在职'),('吴昌泽','在职');
    INSERT INTO students(name,grade,status) VALUES ('合成学生','高一','在读'),('合成学生乙','高二','在读'),('合成历史生','初二','已流出'),('蔡文姬','高一','在读');
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

async function pointerClick(browser, selector) {
  const point = await browser.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await browser.send('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',clickCount:1});
  await browser.send('Input.dispatchMouseEvent', {type:'mouseReleased',...point,button:'left',clickCount:1});
}

async function seedUiData() {
  for(let i=0;i<12;i++) {
    const result=await api('/api/lessons','POST',{teacher_name:i%2?'合成老师乙':'合成老师',date:`2026-07-${String(i+1).padStart(2,'0')}`,month_key:'2026-07-01',time_slot:'08:00-10:00',classroom:'A1',grade:i%2?'高二':'高一',subject:i%2?'英语':'数学',student_names:i%2?'合成学生乙':'合成学生',status:i===10?'待上':'已上',notes:i===0?'长备注需要自然换行。'.repeat(40):''});
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
  await browser.evaluate(`(async()=>{setActiveView(${JSON.stringify(page)});activeMonth='2026-07-01';lessonFilter={...lessonFilter,start_date:'2026-07-01',end_date:'2026-07-31',date_preset_initialized:true};if(view==='teacherDetail')selectedTeacherDetail='合成老师';selectedStudent='合成学生';studentQueryRange={mode:'range',start:'2026-07-01',end:'2026-07-31'};await load({refreshGlobal:false});})()`);
  if(page==='teacherSalaryRules') await browser.waitFor('teacherSalaryRuleCandidateSync.requested && !teacherSalaryRuleCandidateSync.busy');
}

test('long business values, compact regions and shared notice toolbars fit four viewports',async()=>browserRun(async browser=>{
 for(const width of [1440,1280,1024,390]) {
  await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
  for(const page of ['lessons','weekMatrix','courseNotice','teacherCourseNotice','recharges','studentQuery','studentPricing','studentProfiles','teacherDetail','teacherSalaryRules','teacherProfiles','userAdmin','appearance']) {
   await show(browser,page);await browser.evaluate('new Promise(requestAnimationFrame)');
   assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false,`${page} ${width}`);
   if(page==='lessons') {
    const note=await browser.evaluate("(()=>{const e=[...document.querySelectorAll('.lesson-table td.col-note .lesson-cell-text')].find(e=>e.textContent.length>50);return {white:getComputedStyle(e).whiteSpace,overflow:getComputedStyle(e).textOverflow,client:e.clientWidth,scroll:e.scrollWidth};})()");
    assert.equal(note.white,'nowrap');assert.notEqual(note.overflow,'ellipsis');assert.ok(note.scroll<=note.client+1,JSON.stringify({width,note}));
   }
   if(page==='weekMatrix') {assert.equal(await browser.evaluate("[...document.querySelectorAll('.matrix-unified-filter button')].filter(e=>e.textContent==='重置').length"),1);for(const mode of ['time','teacher','classroom'])await browser.evaluate(`switchMatrixViewOnly('${mode}')`);}
   if(['courseNotice','teacherCourseNotice'].includes(page)) {
    const collisions=await browser.evaluate("(()=>{const es=[...document.querySelectorAll('.notice-primary-controls > *,.notice-filter-primary-row > .filter-summary,.notice-tail-row')];return es.flatMap((e,i)=>es.slice(i+1).filter(f=>{const a=e.getBoundingClientRect(),b=f.getBoundingClientRect();return Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2;}).map(f=>[e.className,f.className]));})()");
    assert.deepEqual(collisions,[],JSON.stringify({page,width,collisions}));
   }
   if(page==='recharges')assert.ok(await browser.evaluate("(()=>{const e=[...document.querySelectorAll('.recharge-analysis-split')].map(e=>e.getBoundingClientRect());return e.length===2&&e[1].top>=e[0].bottom;})()"));
   if(page==='studentQuery') {
    assert.equal(await browser.evaluate("document.querySelectorAll('.student-query-detail-slot .section-head').length"),1);
    const note=await browser.evaluate("(()=>{const e=document.querySelector('.student-query-detail-table tbody tr td:nth-child(11)');return {white:getComputedStyle(e).whiteSpace,overflow:getComputedStyle(e).textOverflow};})()");assert.notEqual(note.white,'nowrap');assert.notEqual(note.overflow,'ellipsis');
    if(width===1440)assert.equal(await browser.evaluate("new Set([...document.querySelectorAll('.student-statement-metrics .metric')].map(e=>Math.round(e.getBoundingClientRect().top))).size"),1);
   }
   if(page==='studentPricing') {assert.equal(await browser.evaluate("document.querySelectorAll('.finance-notice-list').length"),0);assert.ok(await browser.evaluate("!!document.querySelector('.pricing-batch-actions .pricing-unset-summary')"));}
   if(page==='studentProfiles') {assert.equal(await browser.evaluate("document.querySelectorAll('.student-stage-conflict-banner').length"),0);assert.ok(await browser.evaluate("document.querySelector('.new-profile').nextElementSibling.matches('.student-stage-conflict-check')"));}
   if(page==='teacherDetail') {
    await browser.click('[data-salary-class]');
    await browser.waitFor("Boolean(document.querySelector('.teacher-class-lessons'))");
    assert.ok(await browser.evaluate("[...document.querySelectorAll('.teacher-class-lessons tbody tr')].some(e=>e.textContent.includes('待上')&&!e.classList.contains('abnormal'))"));
    await browser.click('[data-salary-action=close]');
    assert.ok(await browser.evaluate("[...document.querySelectorAll('.teacher-detail-table td.adaptive-full')].every(e=>getComputedStyle(e).textOverflow!=='ellipsis'&&e.scrollWidth<=e.clientWidth+1)"));
    assert.equal(await browser.evaluate("teacherSalaryRuleCellMarkup({rule_match_status:'matched',rule_salary:0})"),'¥0.00');assert.equal(await browser.evaluate("teacherSalaryRuleCellMarkup({rule_match_status:'not_matched',rule_salary:null})"),'无规则');
   }
   if(page==='teacherSalaryRules')assert.equal(await browser.evaluate("document.querySelectorAll('.open-teacher-salary-rule-modal').length"),0);
   if(page==='appearance'&&width===1440)assert.ok(await browser.evaluate("document.querySelector('.appearance-settings').getBoundingClientRect().width<document.querySelector('#content').getBoundingClientRect().width"));
  }
 }
 assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));

test('actual role clicks stay open, save locally and teacher binding retains searchable multi-selection',async()=>browserRun(async browser=>{
 const created=await api('/api/users','POST',{username:'pinyin-role',display_name:'权限合成',password:'synthetic-password',role:'academic',status:'active'});assert.equal(created.status,201);const id=created.data.id;
 await show(browser,'userAdmin');
 const cell=`.user-row[data-id="${id}"] .user-role-cell`;
 await browser.evaluate(`document.querySelector('${cell}').scrollIntoView({block:'center'})`);
 await pointerClick(browser,cell);await browser.waitFor("!!document.querySelector('.custom-select-menu.open .custom-select-option[data-value=teacher]')");
 await pointerClick(browser,'.custom-select-menu.open .custom-select-option[data-value="teacher"]');
 await browser.waitFor(`document.querySelector('${cell}').textContent==='老师'`);
 await browser.click(`.user-row[data-id="${id}"] .multi-select-toggle.user-row-teachers`);
 await browser.waitFor("!!document.querySelector('.floating-multi-select-menu')");
 await browser.evaluate("var search=document.querySelector('.floating-multi-select-menu .multi-select-search');search.value='wcz';search.dispatchEvent(new Event('input',{bubbles:true}));");
 assert.ok(await browser.evaluate("[...document.querySelectorAll('.floating-multi-select-menu .multi-select-option')].filter(e=>!e.hidden).some(e=>e.dataset.value==='吴昌泽')"));
 await browser.click('.floating-multi-select-menu .multi-select-option[data-value="吴昌泽"]');
 await browser.waitFor(`state.users.find(u=>u.id===${id}).bound_teacher_names.includes('吴昌泽')`);
 await browser.evaluate("var search=document.querySelector('.floating-multi-select-menu .multi-select-search');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));");
 await browser.click('.floating-multi-select-menu .multi-select-option[data-value="合成老师"]');
 await browser.waitFor(`state.users.find(u=>u.id===${id}).bound_teacher_names.length===2`);
 assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.user-row[data-id="${id}"] .multi-select-caret')).display`),'none');
 await browser.evaluate("closeOpenMultiSelectMenus();window.originalRequest=request;request=async (path,options)=>{if(path==='/api/users/"+id+"'&&options?.method==='PATCH')throw new Error('合成保存失败');return originalRequest(path,options);};");
 await pointerClick(browser,cell);await browser.click('.custom-select-menu.open .custom-select-option[data-value="academic"]');
 await browser.waitFor("!activeScheduleInlinePicker");assert.equal(await browser.evaluate(`document.querySelector('${cell}').textContent`),'老师');
 await browser.click(`.user-row[data-id="${id}"] .multi-select-toggle.user-row-teachers`);
 await browser.click('.floating-multi-select-menu .multi-select-option[data-value="合成老师乙"]');
 await browser.waitFor(`document.querySelector('.user-row[data-id="${id}"] .multi-select-value').dataset.saving==='0'`);
 assert.equal(await browser.evaluate(`state.users.find(u=>u.id===${id}).bound_teacher_names.length`),2);
 assert.equal(await browser.evaluate(`normalizeNameList(document.querySelector('.user-row[data-id="${id}"] .multi-select-value').value).length`),2);
 await browser.evaluate('request=window.originalRequest');
 await browser.evaluate("window.originalRequest=request;request=async(path,options)=>{if(options?.method==='PATCH')await new Promise(r=>setTimeout(r,120));return originalRequest(path,options);};");
 await browser.click('.floating-multi-select-menu .multi-select-option[data-value="合成老师乙"]');
 await browser.click('.floating-multi-select-menu .multi-select-option[data-value="合成老师"]');
 await browser.waitFor(`document.querySelector('.user-row[data-id="${id}"] .multi-select-value').dataset.saving==='0'`);
 assert.deepEqual(await browser.evaluate(`state.users.find(u=>u.id===${id}).bound_teacher_names.slice().sort()`),['吴昌泽','合成老师乙'].sort());
 await browser.evaluate('request=window.originalRequest;closeOpenMultiSelectMenus()');
 await pointerClick(browser,cell);
 await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await browser.waitFor('!activeScheduleInlinePicker');
 await pointerClick(browser,cell);
 await pointerClick(browser,'#topbar');
 await browser.waitFor('!activeScheduleInlinePicker');
 assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));

test('new lesson logs use semantic changes while historical text remains unchanged',async()=>{
 const db=new DatabaseSync(dbPath);const historical=db.prepare('SELECT id,operation_content,extra_json FROM operation_logs ORDER BY id LIMIT 1').get();const id=db.prepare('SELECT id FROM lessons ORDER BY id LIMIT 1').get().id;db.close();
 const result=await api('/api/lessons/'+id,'PATCH',{student_names:'合成学生、蔡文姬',notes:'业务备注',course_type:'1V2',allow_conflicts:true});assert.equal(result.status,200);
 const inspect=new DatabaseSync(dbPath);const log=inspect.prepare("SELECT operation_content,extra_json FROM operation_logs WHERE target_type='lessons' AND target_id=? ORDER BY id DESC LIMIT 1").get(String(id));assert.deepEqual(inspect.prepare('SELECT id,operation_content,extra_json FROM operation_logs WHERE id=?').get(historical.id),historical);inspect.close();
 assert.match(log.operation_content,/加入“蔡文姬”/);assert.match(log.operation_content,/备注更新为“业务备注”/);assert.match(log.operation_content,/课程类型/);assert.doesNotMatch(log.operation_content,/student_names|course_type|notes/);assert.equal(JSON.parse(log.extra_json).semantic_version,1);
 const response=await api('/api/operation-logs?page_size=50');assert.equal(response.status,200);
});


test('student query and shared business filters match pinyin without repeated conversion',async()=>browserRun(async browser=>{
 await show(browser,'studentQuery');
 const count=await browser.evaluate('SearchTools.stats().conversions');
 for(const query of ['caiwenji','CWJ',' CAI WEN JI ']) {
  await browser.evaluate(`(()=>{const e=document.querySelector('.student-query-name');e.focus();e.value=${JSON.stringify(query)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.ok(await browser.evaluate("[...document.querySelectorAll('.student-query-name')][0].closest('.filter-combo').querySelector('.filter-combo-option[data-value=\"蔡文姬\"]')?.hidden===false"));
 }
 assert.equal(await browser.evaluate('SearchTools.stats().conversions'),count);
 await browser.click('.filter-combo-option[data-value="蔡文姬"]');
 await browser.waitFor("selectedStudent==='蔡文姬'");
 for(const query of ['caiwenji','cwj']) {
  const checks=await browser.evaluate(`(()=>{const q=${JSON.stringify(query)};studentPricingFilter={student:q,student_names:q};return [classGroupMatchesFilter({teacher:'吴昌泽',students_display:'蔡文姬'},{teacher:'wcz',student:q}),teacherSalaryRuleMatchesFilter({teacher_name:'吴昌泽',student_names:'蔡文姬'},{teacher:'wcz',student:q}),studentPricingMatchesFilter({student_name:'蔡文姬',student_names:'蔡文姬'}),teacherDetailMatchesFilter({student_names:'蔡文姬'},{student:q}),lessonMatchesFilter({student_names:'蔡文姬'},{query:q})];})()`);
  assert.deepEqual(checks,[true,true,true,true,true]);
 }
 assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));

test('teacher account cannot use user-management APIs after inline role changes',async()=>{
 const response=await fetch(`http://127.0.0.1:${port}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'pinyin-role',password:'synthetic-password'})});
 assert.equal(response.status,200);
 const teacherCookie=response.headers.get('set-cookie').split(';')[0];
 const db=new DatabaseSync(dbPath);const user=db.prepare("SELECT id,role FROM users WHERE username='pinyin-role'").get();db.close();
 assert.equal(user.role,'teacher');
 assert.equal((await api('/api/users','GET',undefined,teacherCookie)).status,403);
 assert.equal((await api('/api/users/'+user.id,'PATCH',{role:'boss'},teacherCookie)).status,403);
 const inspect=new DatabaseSync(dbPath);assert.equal(inspect.prepare('SELECT role FROM users WHERE id=?').get(user.id).role,'teacher');inspect.close();
});
