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
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'liming-ui-consistency-'));
  dbPath = path.join(temp, 'synthetic.sqlite');
  environment = { ...process.env, DATA_DIR: temp, DB_PATH: dbPath, SESSION_COOKIE_SECURE: 'false', BAIDU_APP_KEY: '', BAIDU_APP_SECRET: '', BAIDU_REDIRECT_URI: '' };
  init(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec(`INSERT INTO teachers(name,status) VALUES ('合成老师','在职'),('合成老师乙','在职');
    INSERT INTO students(name,grade,status) VALUES ('合成学生','高一','在读');
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
  for (let index=0;index<5;index++) {
    const result=await api('/api/lessons','POST',{teacher_name:'合成老师',date:`2026-07-0${index+1}`,month_key:'2026-07-01',time_slot:'08:00-10:00',classroom:'A1',grade:index?'高一':'',subject:index?['数学','英语','物理','化学'][index-1]:'',student_names:index?'合成学生':'',status:'已上'});
    assert.equal(result.status,201);
  }
  const db=new DatabaseSync(dbPath);
  db.prepare("UPDATE teachers SET phone='13900000000',notes=? WHERE name='合成老师乙'").run('这是一段需要自然换行的合成教师备注。'.repeat(20));
  db.exec("INSERT INTO recharge_records(student_name,grade,cur_recharge,cur_gift,recharge_date,month_key,notes) VALUES ('合成学生','高一',500,0,'2026-07-01','2026-07-01','合成充值'),('合成学生','高一',-100,0,'2026-07-02','2026-07-01','合成退款')");
  db.close();
}
async function show(browser, page) {
  await browser.evaluate(`(async()=>{setActiveView(${JSON.stringify(page)});activeMonth='2026-07-01';selectedStudent='合成学生';studentQueryRange={mode:'range',start:'2026-07-01',end:'2026-07-31'};await load({refreshGlobal:false});})()`);
  if(page==='teacherSalaryRules') await browser.waitFor('teacherSalaryRuleCandidateSync.requested && !teacherSalaryRuleCandidateSync.busy');
}
test('empty course fields and actual badge geometry agree in both modes; matrix tabs and three sticky grids fit four widths', async()=>browserRun(async browser=>{
  await browser.evaluate(`lessonFilter={...defaultLessonFilter(),start_date:'2026-07-01',end_date:'2026-07-31',date_preset_initialized:true};`);
  await show(browser,'lessons');
  for(const editing of [true,false]) {
    const result=await browser.evaluate(`(()=>{scheduleMode=${editing};lessonFilter={...defaultLessonFilter(),start_date:'2026-07-01',end_date:'2026-07-31',date_preset_initialized:true};render();const row=[...document.querySelectorAll('.lesson-table tbody tr[data-row-id]')].find(row=>row.textContent.includes('未填科目'));return ['grade','subject','students'].map(field=>{const td=row.querySelector('.col-'+field),cell=field==='students'?td.querySelector('.lesson-student-badges'):td;return {text:cell.textContent.trim(),badges:cell.querySelectorAll('.entity-badge').length};});})()`);
    assert.deepEqual(result,[{text:'未填年级',badges:0},{text:'未填科目',badges:0},{text:'未填学生',badges:0}]);
  }
  const alignment=await browser.evaluate(`(()=>{const cell=[...document.querySelectorAll('.lesson-table td.col-students')].find(cell=>cell.querySelector('.student-badge'));const badge=cell.querySelector('.student-badge'),style=getComputedStyle(cell);return {offset:badge.getBoundingClientRect().left-cell.getBoundingClientRect().left,padding:parseFloat(style.paddingLeft),head:getComputedStyle(document.querySelector('.lesson-table th.col-students')).textAlign};})()`);
  assert.ok(Math.abs(alignment.offset-alignment.padding)<3,JSON.stringify(alignment));assert.equal(alignment.head,'center');
  await browser.evaluate(`matrixRange={start:'2026-07-01',end:'2026-07-07'};`);await show(browser,'weekMatrix');
  for(const width of [1440,1280,1024,390]) {
    await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    for(const mode of ['time','teacher','classroom']) {
      const result=await browser.evaluate(`(async()=>{switchMatrixViewOnly(${JSON.stringify(mode)});const bar=document.querySelector('.matrix-date-filter'),tabs=bar.querySelector('.matrix-tabs-region'),wrap=document.querySelector('.matrix-view-region .week-grid-scroll'),table=wrap.querySelector('table'),heads=[...table.querySelectorAll('thead th')];for(let i=0;i<40;i++){const tr=table.tBodies[0].insertRow();for(const h of heads)tr.insertCell().textContent='合成';}wrap.scrollTop=180;wrap.scrollLeft=100;await new Promise(requestAnimationFrame);return {tabs:!!tabs,afterDate:!!tabs.previousElementSibling?.matches('.date-range-picker'),active:tabs.querySelector('.active')?.dataset.matrixView,sticky:heads.every(h=>getComputedStyle(h).position==='sticky'),scroll:wrap.scrollTop,offset:Math.abs(heads[0].getBoundingClientRect().top-wrap.getBoundingClientRect().top),aligned:heads.slice(1).every((h,i)=>Math.abs(h.getBoundingClientRect().left-table.tBodies[0].rows[table.tBodies[0].rows.length-1].cells[i+1].getBoundingClientRect().left)<2),overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...tabs.querySelectorAll('button')].map(b=>Math.round(b.getBoundingClientRect().width))};})()`);
      assert.ok(result.tabs);assert.equal(result.afterDate,true);assert.equal(result.active,mode);assert.ok(result.sticky);assert.equal(result.aligned,true);assert.ok(result.scroll>0);assert.ok(result.offset<3,JSON.stringify({width,mode,result}));assert.equal(result.overflow,false);assert.equal(new Set(result.buttons).size,1);
    }
  }
  assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));
test('parent and teacher task cards copy exactly the detailed screenshot and require both successful actions in either order',async()=>browserRun(async browser=>{
  const result=await browser.evaluate(`(async()=>{
    const lesson={id:999,teacher_name:'合成老师',date:'2026-07-02',time_slot:'08:00-10:00',classroom:'A1',status:'已上',grade:'高一',subject:'数学',student_names:'合成学生'};
    const original=request,originalCanvas=courseNoticeCanvas,originalRender=render,originalTeacherUpdate=updateTeacherCourseNoticeModeOnly;const completed=[],copies=[],texts=[];
    request=async(url,options)=>{if(url.endsWith('/complete')){completed.push(options.body.send_object_key);return {};}if(url.includes('client-operation'))return {};return original(url,options);};
    Object.defineProperty(window,'ClipboardItem',{configurable:true,value:class{constructor(items){this.items=items;}}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async()=>{},writeText:async text=>texts.push(text)}});
    courseNoticeCanvas=(...args)=>{const canvas=originalCanvas(...args);copies.push({model:JSON.parse(canvas.dataset.noticeModel),png:canvas.toDataURL()});return canvas;};
    const checks=[];
    for(const mode of ['parent','teacher'])for(const order of [['image','message'],['message','image']]){
      const key=mode+'-'+order[0],item={send_object_key:key,send_object_name:mode==='teacher'?'合成老师':'合成学生个人课程',send_object_type:'个人发送',teachers:['合成老师'],students:['合成学生'],grades:['高一'],subjects:['数学'],lesson_count:2,lessons:[lesson,{...lesson,id:1000,date:'2026-07-03',time_slot:'15:40-17:40',subject:'英语'}]};
      const store=mode==='teacher'?teacherCourseNoticeSimpleActions:courseNoticeSimpleActions;delete store[key];
      if(mode==='teacher')teacherCourseNoticeState.data={send_objects:[item]};else courseNoticeState.data={send_objects:[item]};
      const paint=()=>{contentEl.innerHTML=mode==='teacher'?renderTeacherCourseNoticeSimpleMode([item]):renderCourseNoticeSimpleMode([item]);bindNoticeTaskEvents(contentEl,mode);};
      render=paint;updateTeacherCourseNoticeModeOnly=paint;paint();
      const initial=contentEl.querySelector('.notice-simple-state').textContent,markup=contentEl.innerHTML;
      const title=mode==='teacher'?'本周课程安排':'课程通知';const detailed=originalCanvas(item,mode,title,{layoutMode:'preview'}),model=buildCourseNoticeScreenshotModel(item,mode,title);
      await contentEl.querySelector('[data-action="'+order[0]+'"]').click();
      for(let i=0;i<100&&noticeSimpleAction(item,store).busy;i++)await new Promise(r=>setTimeout(r,10));await new Promise(r=>setTimeout(r,0));
      const first={completed:!!item.completed,state:contentEl.querySelector('.notice-simple-state').textContent,green:contentEl.querySelector('.notice-simple-tile').classList.contains('done')};
      contentEl.querySelector('[data-action="'+order[1]+'"]').click();
      for(let i=0;i<100&&noticeSimpleAction(item,store).busy;i++)await new Promise(r=>setTimeout(r,10));await new Promise(r=>setTimeout(r,0));
      checks.push({mode,initial,first,final:contentEl.querySelector('.notice-simple-state').textContent,green:contentEl.querySelector('.notice-simple-tile').classList.contains('done'),noPreview:!/<img|<table|notice-shot-preview/.test(markup),noStudents:mode!=='teacher'||!markup.includes('合成学生'),same:copies.at(-1).png===detailed.toDataURL(),modelSame:JSON.stringify(copies.at(-1).model)===JSON.stringify(model),cells:model.cells,count:model.lessonCount,title:model.title});
    }
    const failed={send_object_key:'failed-copy',send_object_name:'合成失败',lessons:[lesson]};
    navigator.clipboard.write=async()=>{throw new Error('synthetic clipboard failure');};
    let rejected=false;try{await performNoticeTask(failed,'parent','image');}catch{rejected=true;}
    const failureSafe=rejected && !noticeSimpleAction(failed,courseNoticeSimpleActions).image && !failed.completed;
    request=original;courseNoticeCanvas=originalCanvas;render=originalRender;updateTeacherCourseNoticeModeOnly=originalTeacherUpdate;
    return {checks,completed:completed.length,texts:texts.length,failureSafe};
  })()`);
  assert.equal(result.failureSafe,true);assert.equal(result.completed,4,JSON.stringify(result));assert.equal(result.texts,4,JSON.stringify(result));
  for(const check of result.checks){assert.equal(check.initial,'未完成');assert.equal(check.first.completed,false);assert.equal(check.first.green,false);assert.match(check.first.state,/图片已复制|文案已复制/);assert.equal(check.final,'已完成');assert.equal(check.green,true);assert.equal(check.noPreview,true);assert.equal(check.noStudents,true);assert.equal(check.same,true);assert.equal(check.modelSame,true);assert.equal(check.count,2);assert.equal(check.title,check.mode==='teacher'?'本周课程安排':'课程通知');assert.deepEqual(check.cells[0],['合成老师','2026-07-02','周四','08:00-10:00','A1','已上','高一','数学','合成学生']);assert.equal(check.cells[1][3],'15:40-17:40');}
  assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));
test('gift visibility, dynamic count alignment, shared adaptive tables, compact teacher notes and class picker stay consistent',async()=>browserRun(async browser=>{
  const gifts=await browser.evaluate(`(()=>{const summaries=[{}, {opening_gift_balance:1},{cur_gift:2},{closing_gift_balance:3}];return summaries.map(summary=>{const report={summary,month_rows:[{month_key:'2026-07-01',lesson_count:4,subject_counts:{数学:1,英语:1,物理:1,化学:1}}],details:[]};const original=drawShotTable,headings=[];drawShotTable=(ctx,colors,columns,...args)=>{headings.push(columns.map(c=>c.label));return original(ctx,colors,columns,...args);};studentStatementCanvas(report);drawShotTable=original;return {cards:studentStatementMetricCards(summary,{parent:true}).map(c=>c.label),columns:headings[0],admin:studentQueryMonthColumns(report).map(c=>c.label)};});})()`);
  assert.equal(gifts[0].cards.some(c=>c.includes('赠送')),false);assert.equal(gifts[0].columns.includes('赠送充值'),false);assert.equal(gifts[0].admin.includes('赠送充值'),true);
  for(const gift of gifts.slice(1)){assert.ok(gift.cards.some(c=>c.includes('赠送')));assert.ok(gift.columns.includes('赠送充值'));}
  await show(browser,'studentQuery');
  const counts=await browser.evaluate(`(()=>{const table=document.querySelector('.student-history-table');return [...table.rows[0].cells].flatMap((th,i)=>['有效课次','数学','英语','物理','化学'].includes(th.textContent.trim())?[{label:th.textContent.trim(),head:getComputedStyle(th).textAlign,align:getComputedStyle(table.tBodies[0].rows[0].cells[i]).textAlign,vertical:getComputedStyle(table.tBodies[0].rows[0].cells[i]).verticalAlign}]:[]);})()`);
  assert.equal(counts.length,5);for(const cell of counts){assert.equal(cell.head,'center');assert.equal(cell.align,'center');assert.equal(cell.vertical,'middle');}
  for(const width of [1440,1280,1024,390]){
    await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    for(const [page,selector] of [['feeDetails','.fee-detail-table'],['recharges','.recharge-table'],['classGroups','.class-group-table'],['teacherSalaryRules','.teacher-salary-rule-table'],['teacherProfiles','.teacher-profile-table']]){
      await show(browser,page);
      const result=await browser.evaluate(`(async()=>{await new Promise(requestAnimationFrame);const table=document.querySelector(${JSON.stringify(selector)});applyAdaptiveTableColumns({table});return {columns:table.querySelectorAll('col').length,heads:table.querySelectorAll('thead th').length,adaptive:table.classList.contains('adaptive-table'),reads:table.dataset.adaptiveLayoutReads,sticky:[...table.querySelectorAll('thead th')].every(th=>getComputedStyle(th).position==='sticky'),overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      assert.equal(result.columns,result.heads,`${page}/${width}`);assert.ok(result.adaptive);assert.equal(result.reads,'0');assert.ok(result.sticky);assert.equal(result.overflow,false,`${page}/${width}`);
    }
  }
  const heights=await browser.evaluate(`(()=>{return [...document.querySelectorAll('.teacher-profile-table tbody tr')].map(row=>({note:row.querySelector('[data-field="notes"]').value,height:row.getBoundingClientRect().height}));})()`);
  assert.ok(heights.find(row=>!row.note).height<=55,JSON.stringify(heights));assert.ok(heights.find(row=>row.note).height>heights.find(row=>!row.note).height);
  await show(browser,'classGroups');
  const picker=await browser.evaluate(`(()=>{const cell=document.querySelector('.class-group-type-cell');cell.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));return {hidden:!!cell.querySelector('.schedule-inline-picker-anchor'),portal:activeScheduleInlinePicker.menu.parentElement===document.body};})()`);assert.deepEqual(picker,{hidden:true,portal:true});
  await browser.evaluate(`(async()=>{const select=activeScheduleInlinePicker.select;select.value='1V2';select.dispatchEvent(new Event('change'));})()`);
  await browser.waitFor(`!activeScheduleInlinePicker && document.querySelector('.class-group-type-cell').textContent.trim()==='1V2'`);
  await show(browser,'teacherSalaryRules');
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('.teacher-salary-rule-table th')].some(th=>th.textContent.trim()==='启用')`),false);
  assert.equal(await browser.evaluate(`!!document.querySelector('.rule-status-cell .teacher-salary-rule-active')`),true);
  const rule=await browser.evaluate(`(()=>{const row=document.querySelector('.teacher-salary-rule-row');return {id:Number(row.dataset.ruleId),notes:row.querySelector('[data-field="notes"]').value};})()`);
  await browser.evaluate(`(()=>{const input=document.querySelector('.rule-status-cell .teacher-salary-rule-active');input.checked=false;input.dispatchEvent(new Event('change'));})()`);
  await browser.waitFor(`!!document.querySelector('.rule-status-cell .teacher-salary-rule-active') && !document.querySelector('.rule-status-cell .teacher-salary-rule-active').checked`);
  for(let i=0;i<100;i++){const db=new DatabaseSync(dbPath);const saved=db.prepare('SELECT is_active FROM teacher_salary_rules WHERE id=?').get(rule.id);db.close();if(saved?.is_active===-1)break;await new Promise(resolve=>setTimeout(resolve,20));}
  const rulesDb=new DatabaseSync(dbPath);const savedRule=rulesDb.prepare('SELECT is_active,notes FROM teacher_salary_rules WHERE id=?').get(rule.id);rulesDb.close();assert.equal(savedRule.is_active,-1);assert.equal(savedRule.notes,rule.notes);

  await show(browser,'recharges');assert.equal(await browser.evaluate(`document.querySelectorAll('.recharge-analysis-card.metric').length`),6);
  assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));
