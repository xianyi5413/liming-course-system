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
const table = formula => ({ effective_start: '2026-09-01', effective_end: '2026-09-30', rules: [{ grade: '高一', course_type: '小班课', formula }] });
const workflowPath = '/api/teacher-detail/workflow?start=2026-09-01&end=2026-09-30&teacher=' + encodeURIComponent('合成教师');
async function summary() {
  const result = await api('/api/bootstrap?month=2026-09-01');
  assert.equal(result.response.status, 200);
  return result.payload.derived.teacher_summary.find(row => row.teacher_name === '合成教师');
}

test('templates validate formulas, persist separately without dates and enforce permission', async () => {
  const result = await api('/api/salary-templates', { method:'POST', body:{name:'合成模板',effective_start:'2027-01-01',rules:table('60+30(n-1)+40K').rules} });
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(Object.hasOwn(result.payload.template,'effective_start'),false);
  assert.equal(Object.hasOwn(result.payload.template,'effective_end'),false);
  assert.equal((await api('/api/salary-tables')).payload.tables.length,0);
  assert.equal((await api('/api/salary-templates')).payload.templates[0].name,'合成模板');
  assert.equal((await api('/api/salary-templates',{method:'POST',body:{name:'坏公式',rules:table('eval(1)').rules}})).response.status,400);
  assert.equal((await api('/api/salary-templates',{cookie:teacherCookie})).response.status,403);
  assert.equal((await api('/api/salary-templates',{cookie:academicCookie,method:'POST',body:{name:'越权',rules:[]}})).response.status,403);
  assert.equal((await api('/api/salary-templates/'+result.payload.template.id+'/use',{method:'POST',body:{}})).response.status,200);
  const db=new DatabaseSync(databasePath);
  const logs=db.prepare("SELECT operation_content FROM operation_logs WHERE target_type='salary_table_templates'").all();
  assert.ok(logs.some(row=>row.operation_content.includes('新增薪资模板：“合成模板”')));
  assert.ok(logs.some(row=>row.operation_content.includes('在薪资表中使用模板：“合成模板”')));
  db.close();
});

test('class IDs batch update, single course update, regrouping and manual priority',async()=>{
  let group=(await api('/api/class-groups')).payload.class_groups.find(row=>row.teacher==='合成教师');
  assert.equal(group.course_count,10);const first=group.lesson_ids[0];
  assert.equal((await api('/api/class-groups/course-type',{cookie:teacherCookie,method:'PATCH',body:{mode:'class',group_key:group.group_key,lesson_ids:group.lesson_ids,course_type:'1V2'}})).response.status,403);
  for(const body of [{course_type:'1V2'},{course_type_source:'auto'}]) assert.equal((await api('/api/lessons/'+first,{method:'PATCH',body})).response.status,400);
  const change=(g,ids,type,mode='class')=>api('/api/class-groups/course-type',{method:'PATCH',body:{group_key:g.group_key,lesson_ids:ids,course_type:type,mode}});
  assert.equal((await change(group,group.lesson_ids.slice(0,9),'1V2')).response.status,409);
  assert.equal((await change(group,[...group.lesson_ids,999999],'1V2')).response.status,409);
  let result=await change(group,group.lesson_ids,'1V2');assert.equal(result.response.status,200,JSON.stringify(result.payload));
  group=result.payload.class_groups.find(row=>row.teacher==='合成教师'&&row.course_type==='1V2');assert.equal(group.course_count,10);
  result=await change(group,[first],'小班课','lesson');assert.equal(result.response.status,200);
  assert.deepEqual(result.payload.class_groups.filter(row=>row.teacher==='合成教师').map(row=>row.course_count).sort((a,b)=>a-b),[1,9]);
  assert.equal((await api('/api/class-groups/courses?'+new URLSearchParams({key:group.group_key}))).payload.lessons.length,9);
  const one=result.payload.class_groups.find(row=>row.lesson_ids.includes(first));
  result=await change(one,[first],'1V2','lesson');assert.equal(result.payload.class_groups.filter(row=>row.teacher==='合成教师').length,1);
  assert.equal((await api('/api/lessons/'+first,{method:'PATCH',body:{student_names:'甲、乙'}})).payload.course_type,'1V2');
  const db=new DatabaseSync(databasePath), persisted=db.prepare('SELECT * FROM lessons WHERE id=?').get(first);
  assert.equal(persisted.course_type_source,'manual');db.close();
  const copied=await api('/api/lessons/copy',{method:'POST',body:{source_lesson_ids:[first],target_dates:['2026-10-01'],reset_status:false}});
  assert.equal(copied.response.status,201,JSON.stringify(copied.payload));assert.equal(copied.payload.lessons[0].course_type_source,'manual');
});

test('automatic types track grade and counts; junior manual 1V3 is rejected',async()=>{
  for(const [grade,count,type] of [['初一',1,'1V1'],['初一',2,'1V2'],['初一',3,'小班课'],['高一',1,'1V1'],['高一',2,'1V2'],['高一',3,'1V3'],['高一',4,'小班课']]){
    const row=await api('/api/lessons',{method:'POST',body:{teacher_name:'其他教师',grade,subject:'推断'+grade+count,student_names:Array.from({length:count},(_,i)=>'测试'+i).join('、'),date:'2026-09-20',month_key:'2026-09-01',time_slot:'13:00-15:00',allow_conflicts:true}});
    assert.equal(row.response.status,201,JSON.stringify(row.payload));assert.equal(row.payload.course_type,type);assert.equal(row.payload.course_type_source,'auto');
    const updated=await api('/api/lessons/'+row.payload.id,{method:'PATCH',body:{student_names:'推断甲、推断乙',allow_conflicts:true}});
    assert.equal(updated.response.status,200,JSON.stringify(updated.payload));assert.equal(updated.payload.course_type,'1V2');
    const scoped=(await api('/api/class-groups',{cookie:academicCookie})).payload.class_groups;
    assert.ok(scoped.every(group=>group.teacher==='合成教师'));
    if(grade==='初一'){
      const group=(await api('/api/class-groups')).payload.class_groups.find(g=>g.lesson_ids.includes(row.payload.id));
      assert.equal((await api('/api/class-groups/course-type',{method:'PATCH',body:{group_key:group.group_key,lesson_ids:group.lesson_ids,course_type:'1V3',mode:'class'}})).response.status,400);
    }
  }
});

test('custom course types cannot inject attributes into grouped row identifiers',async()=>{
  const type='特别"<课程类型>';
  assert.equal((await api('/api/settings',{method:'POST',body:{custom_course_types_senior:JSON.stringify([type])}})).response.status,200);
  const group=(await api('/api/class-groups')).payload.class_groups.find(row=>row.teacher==='其他教师'&&row.grade==='高一');
  const result=await api('/api/class-groups/course-type',{method:'PATCH',body:{group_key:group.group_key,lesson_ids:group.lesson_ids,mode:'class',course_type:type}});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  const updated=result.payload.class_groups.find(row=>row.course_type===type);assert.ok(updated);
  assert.doesNotMatch(updated.id,/["<>]/);assert.ok(updated.id.includes(encodeURIComponent(type)));
  assert.equal((await api('/api/class-groups/course-type',{cookie:academicCookie,method:'PATCH',body:{group_key:updated.group_key,lesson_ids:updated.lesson_ids,mode:'class',course_type:'1V1'}})).response.status,409);
});

test('complete Excel preserves templates and manual course type sources',()=>{
  const {exportFullData,verifyFullData,restoreFullData}=require('../src/excel/full_backup');
  const file=path.join(tempRoot,'templates.xlsx');exportFullData({dbPath:databasePath,outputPath:file});
  const verified=verifyFullData(file);assert.equal(verified.version,6);assert.equal(verified.data.salary_table_templates.length,1);
  assert.ok(verified.data.lessons.some(row=>row.course_type_source==='manual'));
  const target=path.join(tempRoot,'restored.sqlite');
  const init=spawnSync(process.execPath,[path.join(root,'src/server.js'),'--init-db'],{env:{...process.env,DATA_DIR:tempRoot,DB_PATH:target},encoding:'utf8',windowsHide:true});assert.equal(init.status,0,init.stderr);
  restoreFullData({dbPath:target,inputPath:file});const db=new DatabaseSync(target);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM salary_table_templates').get().n,1);
  assert.equal(db.prepare('SELECT formula FROM salary_table_template_rules').get().formula,'60+30*(n-1)+40*K');
  assert.ok(db.prepare("SELECT COUNT(*) n FROM lessons WHERE course_type_source='manual'").get().n>0);db.close();
});

test('previous v5 restores without template tables and preserves historical type provenance',()=>{
  const {exportFullData,verifyFullData,restoreFullData,buildFullDataBufferFromSourceData}=require('../src/excel/full_backup');
  const {parseWorkbook,createWorkbook}=require('../src/excel/xlsx_codec');
  const crypto=require('node:crypto'),file=path.join(tempRoot,'previous.xlsx');
  exportFullData({dbPath:databasePath,outputPath:file});
  const clean=verifyFullData(file).data;clean.salary_table_templates=[];clean.salary_table_template_rules=[];
  for(const row of clean.lessons)delete row.course_type_source;
  const workbook=parseWorkbook(buildFullDataBufferFromSourceData(clean).buffer);
  const sheets=workbook.sheets.map(sheet=>({name:sheet.name,state:sheet.state,rows:sheet.rows.map(row=>[...row])}));
  const info=sheets.find(sheet=>sheet.name==='导出说明'),meta=sheets.find(sheet=>sheet.name==='__恢复元数据');
  info.rows.find(row=>row[0]==='格式版本')[1]=5;meta.rows.find(row=>row[1]==='format_version')[2]=5;
  meta.rows.find(row=>row[0]==='工作表'&&row[1]==='导出说明')[3]=crypto.createHash('sha256').update(JSON.stringify(info.rows)).digest('hex');
  fs.writeFileSync(file,createWorkbook(sheets));assert.equal(verifyFullData(file).version,5);
  const target=path.join(tempRoot,'previous.sqlite');
  const init=spawnSync(process.execPath,[path.join(root,'src/server.js'),'--init-db'],{env:{...process.env,DATA_DIR:tempRoot,DB_PATH:target},encoding:'utf8',windowsHide:true});assert.equal(init.status,0,init.stderr);
  let db=new DatabaseSync(target);db.exec('DROP TABLE salary_table_template_rules; DROP TABLE salary_table_templates; ALTER TABLE lessons DROP COLUMN course_type_source');db.close();
  restoreFullData({dbPath:target,inputPath:file});db=new DatabaseSync(target);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM salary_table_templates').get().n,0);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM lessons WHERE course_type_source='legacy'").get().n>0);db.close();
});

test('Chromium template draft, readonly types, adaptive detail and coefficient interaction',async()=>{
  const seedDb=new DatabaseSync(databasePath);
  const insert=seedDb.prepare("INSERT INTO lessons(teacher_name,date,month_key,time_slot,grade,subject,course_type,student_names,status,notes) VALUES('合成教师','2026-09-22','2026-09-01','16:00-18:00','高二',?,'小班课',?,'待上',?)");
  for(const count of [1,2,3,6,10]) insert.run('布局'+count,Array.from({length:count},(_,i)=>'完整姓名学生'+i).join('、'),'完整备注用于验证内容换行且不省略。'.repeat(6));
  seedDb.close();
  const chrome=await launchChrome(path.join(tempRoot,'refine-chrome')),browser=chrome.session;
  try{
    await browser.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});await browser.login('boss','123456');
    await browser.evaluate("setActiveView('teacherDetail');load({refreshGlobal:false})");await browser.waitFor("!!document.querySelector('[data-salary-action=tables]')");
    await browser.click('[data-salary-action=tables]');await browser.waitFor("!!document.querySelector('[data-salary-action=new]')");await browser.click('[data-salary-action=new]');
    await browser.evaluate("document.querySelector('#salary-table-name').value='未保存名称';applyDateRangePickerValue(document.querySelector('[data-range-scope=salary-table-editor]'),'2027-01-01','2027-01-31')");
    for(const width of [1440,1280,1024,390]){
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      const layout=await browser.evaluate("(()=>{const children=[...document.querySelector('.salary-editor-controls').children].map(x=>x.getBoundingClientRect().bottom);return {children,overflow:document.documentElement.scrollWidth>innerWidth}})()");
      assert.equal(layout.overflow,false,JSON.stringify({width,layout}));if(width>=1280)assert.ok(Math.max(...layout.children)-Math.min(...layout.children)<3,JSON.stringify(layout));
    }
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await browser.click('[data-salary-action=template-use]');await browser.waitFor("!!document.querySelector('[data-template-id]')");await browser.click('[data-template-id]');
    await browser.waitFor("document.querySelector('.salary-formula-input[data-grade=高一][data-type=小班课]').value.includes('40')");
    assert.equal(await browser.evaluate("document.querySelector('#salary-table-name').value"),'未保存名称');
    assert.equal(await browser.evaluate("document.querySelector('[data-range-scope=salary-table-editor]').dataset.start"),'2027-01-01');
    assert.equal((await api('/api/salary-tables')).payload.tables.length,0);
    await browser.evaluate("window.templateConfirm=[];window.confirm=message=>{templateConfirm.push(message);return false;}");
    await browser.click('[data-salary-action=template-use]');await browser.waitFor("!!document.querySelector('[data-template-id]')");await browser.click('[data-template-id]');
    assert.match((await browser.evaluate('templateConfirm'))[0],/覆盖当前已填写/);await browser.click('.salary-template-dialog .dialog-close');
    await browser.click('[data-salary-action=template-add]');await browser.waitFor("!!document.querySelector('.salary-template-form')");
    await browser.evaluate("document.querySelector('.salary-template-form [name=name]').value='浏览器模板';document.querySelector('.salary-template-form').requestSubmit()");await browser.waitFor("!document.querySelector('.salary-template-form')");
    assert.equal((await api('/api/salary-templates')).payload.templates.length,2);
    // A response belonging to a closed child dialog must not affect its replacement.
    for(const action of ['template-add','template-use']) {
      await browser.evaluate("window.originalTemplateRequest=request;window.templateResponseReady=false;window.templateResponseReleased=false;window.confirm=()=>true;request=async function(path,options){const result=await originalTemplateRequest(path,options);if(path.startsWith('/api/salary-templates')&&options?.method==='POST'){window.templateResponseReady=true;await new Promise(resolve=>window.releaseTemplateResponse=resolve);window.templateResponseReleased=true;}return result;}");
      await browser.click('[data-salary-action='+action+']');
      if(action==='template-add') {
        await browser.waitFor("!!document.querySelector('.salary-template-form')");
        await browser.evaluate("document.querySelector('.salary-template-form [name=name]').value='延迟响应模板';document.querySelector('.salary-template-form').requestSubmit()");
      } else {
        await browser.waitFor("!!document.querySelector('[data-template-id]')");await browser.click('[data-template-id]');
      }
      await browser.waitFor('window.templateResponseReady');
      await browser.click('.salary-template-dialog .dialog-close');await browser.click('[data-salary-action=template-add]');
      await browser.waitFor("!!document.querySelector('.salary-template-form')");
      await browser.evaluate("window.replacementTemplateDialog=document.querySelector('.salary-template-dialog');releaseTemplateResponse()");
      await browser.waitFor('window.templateResponseReleased');await browser.evaluate('new Promise(requestAnimationFrame)');
      assert.equal(await browser.evaluate("replacementTemplateDialog.isConnected && document.querySelector('.salary-template-dialog')===replacementTemplateDialog"),true);
      await browser.evaluate('request=originalTemplateRequest');await browser.click('.salary-template-dialog .dialog-close');
    }
    await browser.click('[data-salary-action=close]');
    await browser.evaluate("activeMonth='2026-09-01';setActiveView('teacherSalary');load({refreshGlobal:true})");await browser.waitFor("!!document.querySelector('.salary-coefficient-input')");
    assert.equal(await browser.evaluate("document.querySelector('.salary-coefficient-input').placeholder"),'-');
    for(const value of ['0','0.3','1']){
      await browser.evaluate("(()=>{const x=document.querySelector('.salary-coefficient-input');x.value='"+value+"';x.dispatchEvent(new Event('change',{bubbles:true}));})()");
      await browser.waitFor("document.querySelector('.salary-coefficient-input').value==='"+Number(value).toFixed(2)+"'");
    }
    const wheel=await browser.evaluate("(()=>{const x=document.querySelector('.salary-coefficient-input');x.focus();const value=x.value;const e=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:100});x.dispatchEvent(e);return {same:x.value===value,prevented:e.defaultPrevented,blurred:document.activeElement!==x}})()");
    assert.deepEqual(wheel,{same:true,prevented:false,blurred:true});
    // A text decimal control has no native number step behavior. The wheel contract
    // above asserts no cancellation; verify that its enclosing page can scroll.
    const scrolling=await browser.evaluate("(()=>{const space=document.createElement('div');space.style.height='2000px';contentEl.appendChild(space);const input=document.querySelector('.salary-coefficient-input');const value=input.value;contentEl.scrollTop=160;const result={type:input.type,scroll:contentEl.scrollTop,same:input.value===value};space.remove();contentEl.scrollTop=0;return result})()");
    assert.equal(scrolling.type,'text');assert.ok(scrolling.scroll>0);assert.equal(scrolling.same,true);
    await browser.evaluate("setActiveView('teacherDetail');load({refreshGlobal:false})");await browser.waitFor("!!document.querySelector('input.teacher-detail-teacher-select')");
    await browser.evaluate("(()=>{const input=document.querySelector('input.teacher-detail-teacher-select');input.value='合成教师';input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await browser.waitFor("document.querySelectorAll('[data-salary-class]').length>=5");
    for(const width of [1440,1280,1024,390]){
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      const students=await browser.evaluate("(()=>{const t=document.querySelector('.teacher-class-summary-table');applyAdaptiveTableColumns({table:t});return [...t.querySelectorAll('tbody tr')].filter(row=>row.cells[3]?.textContent.startsWith('布局')).map(row=>{const cell=row.cells[5],badges=[...cell.querySelectorAll('.student-badge')];return {count:badges.length,tops:badges.map(x=>x.getBoundingClientRect().top),clipped:cell.scrollWidth>cell.clientWidth+1,nowrap:getComputedStyle(cell).whiteSpace,overflow:document.documentElement.scrollWidth>innerWidth}});})()")
      assert.deepEqual(students.map(row=>row.count).sort((a,b)=>a-b),[1,2,3,6,10]);
      for(const row of students){assert.equal(new Set(row.tops).size,1);assert.equal(row.clipped,false,JSON.stringify({width,row}));assert.equal(row.nowrap,'nowrap');assert.equal(row.overflow,false);}
    }
    await browser.click('[data-salary-class]');await browser.waitFor("!!document.querySelector('.teacher-class-lessons')");
    const salaries=await browser.evaluate("(()=>{const t=document.querySelector('.teacher-class-lessons');applyAdaptiveTableColumns({table:t});return [...t.querySelector('tbody tr').cells].map(x=>getComputedStyle(x).textAlign)})()");
    assert.deepEqual(salaries,Array(11).fill('center').concat('left','right','right'));await browser.click('[data-salary-action=close]');
    await browser.evaluate("setActiveView('lessons');scheduleMode=true;load({refreshGlobal:false})");await browser.waitFor("!!document.querySelector('.lesson-table')");
    assert.equal(await browser.evaluate("!!document.querySelector('[data-field=course_type][data-lesson-edit-trigger]')"),false);
    await browser.evaluate('scheduleMode=false;render()');assert.equal(await browser.evaluate("!!document.querySelector('[data-field=course_type][data-lesson-edit-trigger]')"),false);
    const classRequests=browser.responses.length;
    await browser.evaluate("setActiveView('classGroups');load({refreshGlobal:false})");await browser.waitFor("!!document.querySelector('.class-group-row')");
    assert.equal(browser.responses.slice(classRequests).filter(row=>row.url.includes('/api/class-groups/courses')).length,0);
    await browser.click('.class-group-row td:nth-child(2)');await browser.waitFor("!!document.querySelector('.class-course-details')");
    assert.equal(browser.responses.slice(classRequests).filter(row=>row.url.includes('/api/class-groups/courses')).length,1);
    for(const width of [1440,1280,1024,390]){
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      const layout=await browser.evaluate("(()=>{const t=document.querySelector('.class-course-details');applyAdaptiveTableColumns({table:t});return {overflow:document.documentElement.scrollWidth>innerWidth,headers:[...t.querySelectorAll('th')].every(x=>getComputedStyle(x).textAlign==='center'),sticky:getComputedStyle(t.querySelector('th')).position,align:[...t.querySelector('tbody tr').cells].map(x=>getComputedStyle(x).textAlign)}})()");
      assert.equal(layout.overflow,false);assert.equal(layout.headers,true);assert.equal(layout.sticky,'sticky');assert.deepEqual(layout.align,Array(11).fill('center').concat('left'));
    }
    const beforeSingle=await browser.evaluate("(()=>{window.confirm=()=>true;const cell=document.querySelector('.class-course-type');const id=Number(cell.dataset.id);cell.click();const picker=activeScheduleInlinePicker.select;const value=picker.value==='1V1'?'小班课':'1V1';picker.value=value;picker.dispatchEvent(new Event('change'));return {id,value}})()");
    await browser.waitFor("!document.querySelector('.class-course-type[data-id=\""+beforeSingle.id+"\"]')");
    const savedDb=new DatabaseSync(databasePath);assert.equal(savedDb.prepare('SELECT course_type FROM lessons WHERE id=?').get(beforeSingle.id).course_type,beforeSingle.value);savedDb.close();
    if(await browser.evaluate("document.querySelectorAll('.class-course-type').length===1")){
      await browser.evaluate("(()=>{document.querySelector('.class-course-type').click();const input=activeScheduleInlinePicker.select;input.value=input.value==='1V1'?'小班课':'1V1';input.dispatchEvent(new Event('change'));})()");
      await browser.waitFor("!document.querySelector('.class-course-details')");
    }
    assert.equal(await browser.evaluate("state.class_groups.some(row=>!row.course_count)"),false);
    assert.deepEqual(browser.exceptions,[]);
  }finally{await browser.close();chrome.child.kill('SIGTERM');}
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
    INSERT INTO teachers(id,name,status) VALUES(9001,'合成教师','在职'),(9002,'其他教师','在职'),(9003,'离职教师','离职');
    INSERT INTO teacher_adjustments_monthly(teacher_name,month_key,week1_transport) VALUES('合成教师','2026-09-01',300);`);
  const insert = db.prepare("INSERT INTO lessons(teacher_name,date,month_key,time_slot,grade,subject,course_type,student_names,status,teacher_salary,teacher_salary_source) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
  for(let i=1;i<=10;i++) insert.run('合成教师',`2026-09-${String(i).padStart(2,'0')}`,'2026-09-01','09:00-11:00','高一','数学','小班课',i%2?'甲、乙、丙、丁、戊、己':'己、戊、丁、丙、乙、甲','已上',99,'auto');
  const account=db.prepare("INSERT INTO users(username,display_name,role,teacher_name,password_hash,status) VALUES(?,?,?,?,?,'active')");
  account.run('salary-readonly','只读教师','teacher','合成教师',hash);
  account.run('salary-academic','范围教务','academic','',hash);
  db.exec(`INSERT INTO role_filter_presets(role_code,view_key,filter_key,filter_value_json) VALUES('academic','teacherDetail','teacher_names','["合成教师"]'),('academic','classGroups','teacher_names','["合成教师"]');`);
}
before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-template-course-"));
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
