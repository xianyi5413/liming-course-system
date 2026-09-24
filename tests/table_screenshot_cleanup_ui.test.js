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
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'liming-table-ui-'));
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
test('inline picker immediately paints grade/subject independently, types share keyboard portal, time filters compose and reset', async () => {
  await api('/api/settings','POST',{custom_course_types_junior:'["初中特训"]',custom_course_types_senior:'["高中特训"]'});
  for(const [date,time,grade,subject,students] of [['2026-07-01','08:00-10:00','','',''],['2026-07-02','15:40-17:40','高一','数学','合成学生'],['2026-07-03','08:00-10:00','初一','物理','合成学生']]) {
    const result=await api('/api/lessons','POST',{teacher_name:'合成老师',date,time_slot:time,grade,subject,student_names:students,status:'已上',month_key:'2026-07-01'});assert.equal(result.status,201);
  }
  await browserRun(async browser => {
    await browser.evaluate(`(async()=>{setActiveView('lessons');lessonFilter={...defaultLessonFilter(),start_date:'2026-07-01',end_date:'2026-07-31',date_preset_initialized:true};scheduleMode=true;await load({refreshGlobal:false});})()`);
    const immediate=await browser.evaluate(`(async()=>{
      const row=state.lessons.find(row=>!row.grade),trigger=document.querySelector('[data-lesson-id="'+row.id+'"][data-field="grade"]');
      const empty={grade:trigger.textContent.trim(),badge:!!trigger.querySelector('.entity-badge'),subject:document.querySelector('[data-lesson-id="'+row.id+'"][data-field="subject"]').textContent.trim()};
      const original=request; let release; request=(...args)=>new Promise(resolve=>{release=()=>resolve(original(...args));});
      openScheduleInlinePicker(trigger); const select=activeScheduleInlinePicker.select;select.value='初一';const saving=handleLessonFieldChange(select); const shown=trigger.querySelector('.lesson-inline-picker').textContent; release(); await saving;request=original;closeScheduleInlinePicker();
      const subjectTrigger=document.querySelector('[data-lesson-id="'+row.id+'"][data-field="subject"]');openScheduleInlinePicker(subjectTrigger);const subject=activeScheduleInlinePicker.select;subject.value='数学';await handleLessonFieldChange(subject);closeScheduleInlinePicker();
      return {empty,shown,subject:subjectTrigger.textContent.trim(),students:state.lessons.find(item=>item.id===row.id).student_names};
    })()`);
    assert.deepEqual(immediate.empty,{grade:'未填年级',badge:false,subject:'未填科目'});assert.equal(immediate.shown,'初一');assert.equal(immediate.subject,'数学');assert.equal(immediate.students,'');
    const candidate=await browser.evaluate(`(()=>{const trigger=document.querySelector('[data-field="course_type"][data-lesson-edit-trigger]');trigger.focus();trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));const picker=activeScheduleInlinePicker;return {open:!!picker,portal:picker?.menu.parentElement===document.body,cls:picker?.wrapper.className};})()`);
    assert.equal(candidate.open,true);assert.equal(candidate.portal,true);assert.match(candidate.cls,/schedule-inline-picker-anchor/);
    await browser.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('.custom-select.open').length`),0);
    assert.equal(await browser.evaluate(`(()=>{lessonFilter.time_slot='15:40-17:40';return visibleLessonRows().length;})()`),1);
    const filters=await browser.evaluate(`(async()=>{lessonFilter.time_slot='15:40-17:40';lessonFilter.teacher_names=['合成老师'];lessonFilter.student_names=['合成学生'];lessonFilter.grade='高一';await refreshLessonsView({reloadRange:false});const count=visibleLessonRows().length;return {count,time:visibleLessonRows()[0]?.time_slot};})()`);
    assert.deepEqual(filters,{count:1,time:'15:40-17:40'});
    await browser.evaluate(`resetLessonFilter();`);
    assert.equal(await browser.evaluate(`lessonFilter.time_slot`),'');
    await browser.evaluate(`scheduleMode=false;lessonFilter.start_date='2026-07-01';lessonFilter.end_date='2026-07-31';render();`);
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.lesson-student-badges')).justifyContent`),'flex-start');
    await browser.evaluate(`(async()=>{setActiveView('classGroups');await load({refreshGlobal:false});})()`);
    assert.equal(await browser.evaluate(`!!document.querySelector('.class-group-type-cell .lesson-inline-picker')`),true);
    assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
  });
});
test('grade changes preserve valid manual types and reset types outside the new scope', async () => {
  const lesson = await api('/api/lessons', 'POST', {teacher_name:'合成老师',date:'2026-08-10',month_key:'2026-08-01',time_slot:'08:00-10:00',grade:'初一',subject:'英语',student_names:'合成学生',course_type:'初中特训'});
  assert.equal(lesson.status,201);
  const route='/api/lessons/'+lesson.data.id;
  const reset=await api(route,'PATCH',{grade:'高一'}); assert.equal(reset.status,200);assert.equal(reset.data.course_type,'1V1');
  assert.equal((await api(route,'PATCH',{course_type:'1V2'})).status,200);
  assert.equal((await api(route,'PATCH',{grade:'初二'})).data.course_type,'1V2');
  assert.equal((await api(route,'PATCH',{notes:'保留明确选择'})).data.course_type,'1V2');
});

test('all business headers stick in their own scroll containers and stay aligned at four viewports', async () => browserRun(async browser => {
  const pages=[['lessons','.lesson-table'],['feeDetails','.fee-detail-table'],['recharges','.recharge-table'],['openingBalances','.opening-balance-table'],['studentQuery','.student-history-table,.student-query-detail-table'],['studentPricing','.student-pricing-table'],['classGroups','.class-group-table'],['studentProfiles','.student-profile-table'],['teacherSalary','.teacher-salary-table'],['teacherTravelFees','.teacher-travel-table'],['teacherDetail','.teacher-detail-table'],['teacherSalaryRules','.teacher-salary-rule-table'],['teacherProfiles','.teacher-profile-table']];
  for(const width of [1440,1280,1024,390]) {
    await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    for(const [page,selector] of pages){
      await browser.evaluate(`(async()=>{setActiveView(${JSON.stringify(page)});activeMonth='2026-07-01';selectedTeacherDetail='合成老师';selectedStudent='合成学生';studentQueryRange={mode:'range',start:'2026-07-01',end:'2026-07-31'};await load({refreshGlobal:false});})()`);
      // Entry candidate synchronization replaces the table after load() resolves.
      if(page==='teacherSalaryRules') await browser.waitFor('teacherSalaryRuleCandidateSync.requested && !teacherSalaryRuleCandidateSync.busy');
      const result=await browser.evaluate(`(async()=>{await new Promise(requestAnimationFrame);const tables=[...document.querySelectorAll(${JSON.stringify(selector)})];const result=[];for(const table of tables){const wrap=table.closest('.table-wrap'),headers=[...table.querySelectorAll('thead th')],body=table.tBodies[0];for(let i=0;i<60;i++){const row=body.insertRow();for(let j=0;j<headers.length;j++)row.insertCell().textContent='1';}wrap.scrollTop=200;wrap.scrollLeft=100;await new Promise(requestAnimationFrame);result.push({sticky:headers.every(h=>getComputedStyle(h).position==='sticky'),scroll:wrap.scrollTop,offset:Math.abs(headers[0].getBoundingClientRect().top-wrap.getBoundingClientRect().top),aligned:headers.every((h,i)=>Math.abs(h.getBoundingClientRect().left-body.rows[body.rows.length-1].cells[i].getBoundingClientRect().left)<2)});}return {tables:result,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      assert.ok(result.tables.length,`${page}/${width} missing`);assert.equal(result.overflow,false,`${page}/${width} overflow`);
      for(const table of result.tables){assert.equal(table.sticky,true,`${page}/${width} sticky: ${JSON.stringify(table)}`);assert.ok(table.scroll>0,`${page}/${width}`);assert.ok(table.offset<3,JSON.stringify({page,width,...table}));assert.equal(table.aligned,true,`${page}/${width} alignment: ${JSON.stringify(table)}`);}
    }
  }
  assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));
test('task cards omit full previews, both modes export the same PNG, query metrics never stretch', async () => browserRun(async browser => {
  const result=await browser.evaluate(`(()=>{
    const lesson={teacher_name:'合成老师',grade:'高一',subject:'数学',student_names:'学生甲、学生乙',date:'2026-07-01'};
    const small={teachers:['合成老师'],students:['学生甲'],grades:['高一'],subjects:['数学'],lessons:[lesson],lesson_count:1};
    const large={...small,students:Array.from({length:100},(_,i)=>'合成学生'+i),lessons:Array(100).fill(lesson),lesson_count:100};
    const shots=[];for(const mode of ['parent','teacher'])for(const item of [small,large]){
      const canvas=courseNoticeCanvas(item,mode,'',{layoutMode:'simple'}),div=document.createElement('div');div.innerHTML=courseNoticeSimpleDetails(item,mode);shots.push({mode,width:parseFloat(canvas.style.width),height:parseFloat(canvas.style.height),same:!div.querySelector('img,table') && canvas.toDataURL()===courseNoticeCanvas(item,mode,'',{layoutMode:'preview'}).toDataURL(),model:courseNoticeSimpleModel(item,mode)});
    }
    const ctx=document.createElement('canvas').getContext('2d'),widths=[],original=shotRoundRect;shotRoundRect=(ctx,x,y,w,...args)=>{widths.push(w);return original(ctx,x,y,w,...args);};const cards=studentStatementMetricCards({}, {parent:true});drawShotMetricCards(ctx,courseNoticeShotPalette(),cards.slice(0,4),0,0,1000,4);drawShotMetricCards(ctx,courseNoticeShotPalette(),cards.slice(4),0,100,1000,4);shotRoundRect=original;
    return {shots,widths,columns:studentQueryMonthColumns({month_rows:[{subject_counts:{数学:2}}]}).map(c=>({label:c.label,align:c.align}))};
  })()`);
  for(const shot of result.shots){assert.ok(shot.width>0);assert.ok(shot.height>0);assert.equal(shot.same,true);if(shot.mode==='teacher'){assert.doesNotMatch(JSON.stringify(shot.model),/学生|数学/);assert.ok(shot.model.lines.includes('高一'));assert.ok(shot.model.count>0);}}
  assert.equal(result.widths.length,5);assert.ok(result.widths.every(w=>w===result.widths[0]));assert.equal(result.columns.find(c=>c.label==='数学').align,'center');assert.equal(result.columns.find(c=>c.label==='当月课费').align,'right');
  await browser.evaluate(`(async()=>{setActiveView('audit');await load({refreshGlobal:false});})()`);await browser.click('.backup-cleanup-open');await browser.waitFor(`!!document.querySelector('.backup-cleanup-modal') && !backupCleanupDialog.busy`);
  assert.ok(await browser.evaluate(`!!backupCleanupDialog.preview`));assert.equal(await browser.evaluate(`!!backupCleanupDialog.result`),false);await browser.click('.backup-cleanup-close');
  assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
}));
