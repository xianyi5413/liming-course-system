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
const table = formula => ({ effective_start: '2026-09-01', effective_end: '2026-09-30', rules: [{ grade: '高一', course_type: '小班课', formula }] });
const workflowPath = '/api/teacher-detail/workflow?start=2026-09-01&end=2026-09-30&teacher=' + encodeURIComponent('合成教师');
const W = require('../src/domain/salary_workflow');
const Transfer = require('../src/domain/salary_transfer');
const { createSalaryStore } = require('../src/domain/salary_store');

test('canonical class identity excludes type but retains teacher, grade, subject and complete student set', () => {
  const a = { teacher_name:'甲', grade:'高一', subject:'数学', student_names:'甲生、乙生', course_type:'小班课' };
  assert.equal(W.classKey(a), W.classKey({ ...a, student_names:'乙生、甲生、甲生', course_type:'1V2' }));
  for (const [key,value] of [['teacher_name','乙'],['grade','高二'],['subject','物理'],['student_names','甲生、丙生']]) assert.notEqual(W.classKey(a),W.classKey({ ...a,[key]:value }));
  assert.deepEqual(W.courseTypes([null,undefined,'',{course_type:null}]),[]);
  assert.deepEqual(W.courseTypes(['小班课','1V3','1V1','1V2','小班课','自定义']),['1V1','1V2','1V3','小班课','自定义']);
});

test('both APIs keep mixed types in one class; single and whole-class edits preserve exact IDs and salaries', async () => {
  let group=(await api('/api/class-groups')).payload.class_groups.find(row=>row.teacher==='合成教师');
  assert.equal(group.course_count,10); assert.deepEqual(group.course_types,['小班课']);
  const ids=[...group.lesson_ids], key=group.group_key;
  const change=(lesson_ids,course_type,mode)=>api('/api/class-groups/course-type',{method:'PATCH',body:{group_key:key,lesson_ids,course_type,mode}});
  let result=await change([ids[0]],'1V2','lesson'); assert.equal(result.response.status,200);
  const groups=result.payload.class_groups.filter(row=>row.teacher==='合成教师');assert.equal(groups.length,1);
  assert.deepEqual(groups[0].course_types,['1V2','小班课']); assert.equal(groups[0].group_key,key);assert.deepEqual(groups[0].lesson_ids,ids);
  const created=await api('/api/salary-tables',{method:'POST',body:{teacher_id:9001,...table('60+30(n-1)+40K'),rules:[...table('60+30(n-1)+40K').rules,{grade:'高一',course_type:'1V2',formula:'300+50K'}]}});
  assert.equal(created.response.status,200,JSON.stringify(created.payload));
  let data=(await api(workflowPath)).payload;assert.equal(data.classes.length,1);assert.deepEqual(data.classes[0].course_types,['1V2','小班课']);
  assert.match(data.classes[0].rules[created.payload.id],/1V2：300\+50K；小班课：210\+40K/);
  assert.equal(data.lessons.find(row=>row.id===ids[0]).teacher_base_salary,300);
  assert.equal(data.lessons.find(row=>row.id===ids[1]).performance_base,40);
  assert.equal(data.classes[0].rules.legacy,'-');
  result=await change(ids,'小班课','class');assert.equal(result.response.status,200);assert.equal(result.payload.updated,10);
  assert.deepEqual(result.payload.class_groups.find(row=>row.group_key===key).course_types,['小班课']);
  assert.ok((await api('/api/class-groups/courses?'+new URLSearchParams({key}))).payload.lessons.every(row=>row.course_type==='小班课'&&row.course_type_source==='manual'));
});

test('history indicator uses actual legacy match including disabled and ambiguous rules, never new table presence', async () => {
  assert.equal((await api(workflowPath)).payload.classes[0].rules.legacy,'-');
  const db=new DatabaseSync(databasePath);
  db.prepare("INSERT INTO teacher_salary_rules(teacher_name,grade,subject,student_names,salary_per_unit,is_active) VALUES('合成教师','高一','数学','己、戊、丁、丙、乙、甲',150,-1)").run(); db.close();
  let data=(await api(workflowPath)).payload;assert.equal(data.classes[0].rules.legacy,'历史规则');assert.equal(data.classes[0].has_legacy_rule,true);
  const database=new DatabaseSync(databasePath);database.exec("UPDATE teacher_salary_rules SET is_active=1; INSERT INTO teacher_salary_rules(teacher_name,grade,subject,student_names,salary_per_unit,is_active) SELECT teacher_name,grade,subject,'甲、乙、丙、丁、戊、己',200,1 FROM teacher_salary_rules"); database.close();
  data=(await api(workflowPath)).payload;assert.equal(data.classes[0].rules.legacy,'历史规则');
});

test('template text exports one/many/all without teacher or dates, supports roundtrip skip/conflict and scoped tokens', async () => {
  const make=async name=>(await api('/api/salary-templates',{method:'POST',body:{name,rules:table('60+30(n-1)+40K').rules}})).payload.template;
  const a=await make('模板甲'), b=await make('模板乙');
  for(const ids of [[a.id],[a.id,b.id],null]){
    const result=await api('/api/salary-templates/export'+(ids?'?ids='+ids.join(','):''));assert.equal(result.response.status,200);
    const bundle=JSON.parse(result.payload.text);assert.equal(bundle.templates.length,ids?.length||2);
    assert.equal(bundle.type,'liming_salary_templates');assert.equal(bundle.version,1);assert.match(bundle.exported_at,/\+08:00$/);
    assert.doesNotMatch(result.payload.text,/teacher_id|effective_|created_by|template_id|password|token|secret/);
  }
  const preview=text=>api('/api/salary-templates/import-preview',{method:'POST',body:{text:typeof text==='string'?text:JSON.stringify(text)}});
  const original=JSON.parse((await api('/api/salary-templates/export')).payload.text);
  const same=await preview(original);assert.ok(same.payload.templates.every(row=>row.status==='skip'));
  let confirmed=await api('/api/salary-templates/import-confirm',{method:'POST',body:{token:same.payload.token,confirm:true}});assert.deepEqual([confirmed.payload.count,confirmed.payload.skipped],[0,2]);
  for(const value of ['bad JSON',{...original,type:'liming_salary_tables'},{...original,version:2},{...original,templates:[{name:'',rules:[]}]},{...original,templates:[{name:'正常',rules:[]},{name:'非法',rules:table('K*K').rules}]}]) assert.equal((await preview(value)).response.status,400);
  assert.equal((await api('/api/salary-templates')).payload.templates.length,2);
  const conflict=await preview({...original,templates:[{name:'暂不导入',rules:[]},{name:'模板甲',rules:table('200').rules}]});assert.equal(conflict.payload.allowed,false);assert.equal(conflict.payload.token,null);assert.equal(conflict.payload.templates[1].status,'conflict');
  const batch=await preview({...original,templates:original.templates.map(row=>({...row,name:row.name+'迁移'}))});
  assert.equal((await api('/api/salary-tables/import-confirm',{method:'POST',body:{token:batch.payload.token,confirm:true}})).response.status,400);
  confirmed=await api('/api/salary-templates/import-confirm',{method:'POST',body:{token:batch.payload.token,confirm:true}});assert.equal(confirmed.payload.count,2);
  assert.equal((await api('/api/salary-templates/export',{cookie:teacherCookie})).response.status,403);
  assert.equal((await api('/api/salary-templates/import-preview',{cookie:academicCookie,method:'POST',body:{text:JSON.stringify(original)}})).response.status,403);
  const raced=await preview({...original,templates:[{name:'事务甲',rules:[]},{name:'事务乙',rules:[]}]});await make('事务乙');
  assert.equal((await api('/api/salary-templates/import-confirm',{method:'POST',body:{token:raced.payload.token,confirm:true}})).response.status,400);
  assert.ok(!(await api('/api/salary-templates')).payload.templates.some(row=>row.name==='事务甲'));
});

test('template domain imports are atomic on storage failure and Beijing export crosses UTC midnight correctly', () => {
  const db=new DatabaseSync(':memory:');W.migrateSalaryWorkflow(db);const store=createSalaryStore(db,{});
  store.saveTemplate({name:'现有',rules:[]});
  assert.equal(Transfer.exportTemplates(store,null,new Date('2026-09-28T16:30:00Z')).exported_at,'2026-09-29T00:30:00+08:00');
  const preview=Transfer.previewTemplates(store,{type:Transfer.TEMPLATE_TYPE,version:1,templates:[{name:'成功一半',rules:[]},{name:'注入失败',rules:[]}]});
  db.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON salary_table_templates WHEN NEW.name='注入失败' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  assert.throws(()=>Transfer.importTemplates(store,preview),/synthetic failure/);assert.deepEqual(store.templates().map(row=>row.name),['现有']);db.close();
});

test('local total setting accepts only positive integers and keeps owner/write boundaries',async()=>{
  for(const value of [0,-1,1.5,'1e2','',true,null,Number.MAX_SAFE_INTEGER+1]) assert.equal((await api('/api/data-center/settings',{method:'PUT',body:{total_retention:value}})).response.status,400,String(value));
  assert.equal((await api('/api/data-center/settings',{cookie:teacherCookie,method:'PUT',body:{total_retention:2}})).response.status,403);
  const result=await api('/api/data-center/settings',{method:'PUT',body:{total_retention:50}});assert.equal(result.response.status,200,JSON.stringify(result.payload));assert.equal(result.payload.settings.total_retention,50);
});

test('Chromium shared dialogs center at five widths, preserve full content and template text copy/import', async () => {
  const group=(await api('/api/class-groups')).payload.class_groups.find(row=>row.teacher==='合成教师');
  for(const [index,type] of ['1V1','1V2','1V3'].entries()) assert.equal((await api('/api/class-groups/course-type',{method:'PATCH',body:{group_key:group.group_key,lesson_ids:[group.lesson_ids[index]],course_type:type,mode:'lesson'}})).response.status,200);
  const chrome=await launchChrome(path.join(tempRoot,'round29-chrome')),browser=chrome.session;
  try {
    await browser.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});await browser.login('boss','123456');
    await browser.evaluate("setActiveView('teacherDetail');load({refreshGlobal:false})");await browser.waitFor("!!document.querySelector('[data-salary-action=tables]')");
    await browser.evaluate("selectedTeacherDetail='合成教师';load({refreshGlobal:false})");await browser.waitFor("!!document.querySelector('[data-salary-class]')");
    for(const page of ['teacherDetail','classGroups']) {
      await browser.evaluate("setActiveView('"+page+"');load({refreshGlobal:false})");await browser.waitFor(page==='teacherDetail'?"!!document.querySelector('[data-salary-class]')":"!!document.querySelector('.class-group-row')");
      const types=await browser.evaluate("(()=>{const table=document.querySelector('.teacher-class-summary-table,.class-group-table');applyAdaptiveTableColumns({table});const cell=table.querySelector('tbody tr').cells[4];return {types:[...cell.querySelectorAll('.status-badge')].map(x=>x.textContent),clipped:cell.scrollWidth>cell.clientWidth+1}})()");assert.deepEqual(types.types,['1V1','1V2','1V3','小班课']);assert.equal(types.clipped,false,JSON.stringify(types));
      await browser.click(page==='teacherDetail'?'[data-salary-class]':'.class-group-row td:nth-child(2)');await browser.waitFor("!!document.querySelector('.course-details-table')");
      for(const width of [1920,1440,1280,1024,390]) {
        await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        const layout=await browser.evaluate("(()=>{const t=document.querySelector('.course-details-table');applyAdaptiveTableColumns({table:t});const p=t.closest('.modal-panel'),b=p.getBoundingClientRect(),c=p.querySelector('.modal-head button').getBoundingClientRect(),w=t.closest('.table-wrap');return {center:(b.left+b.right)/2,viewport:innerWidth,left:b.left,right:b.right,close:c.right,body:document.documentElement.scrollWidth,scroll:w.scrollWidth>w.clientWidth,headers:[...t.querySelectorAll('th')].map(x=>x.textContent)}})()");
        assert.ok(Math.abs(layout.center-width/2)<2,JSON.stringify(layout));assert.ok(layout.left>=15&&layout.right<=width-15,JSON.stringify(layout));assert.ok(layout.close<=width-15);assert.ok(layout.body<=width);
        if(width===390)assert.ok(layout.scroll);if(page==='teacherDetail'){assert.ok(layout.headers.includes('绩效基数'));assert.ok(!layout.headers.includes('月度绩效'));}
      }
      await browser.click(page==='teacherDetail'?'[data-salary-action=close]':'.dialog-close');
    }
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1920,height:900,deviceScaleFactor:1,mobile:false});
    const short=await browser.evaluate("(()=>{window.shortDialog=CourseDetails.dialog('短内容','<p>一条提示</p>');const b=shortDialog.element.querySelector('.modal-panel').getBoundingClientRect();return {width:b.width,center:(b.left+b.right)/2}})()");assert.ok(short.width<600);assert.ok(Math.abs(short.center-960)<2);await browser.evaluate('shortDialog.close()');
    await browser.evaluate("setActiveView('teacherDetail');load({refreshGlobal:false})");await browser.waitFor("!!document.querySelector('[data-salary-action=template-export]')");
    await browser.click('[data-salary-action=template-export]');await browser.waitFor("!!document.querySelector('.template-export-choice')");
    await browser.evaluate("document.querySelector('.template-select-all').click();document.querySelector('.template-export-choice').click()");await browser.click('.template-export-confirm');await browser.waitFor("!!document.querySelector('.transfer-text')");
    const copied=await browser.evaluate("document.querySelector('.transfer-text').value");assert.equal(JSON.parse(copied).templates.length,1);
    await browser.evaluate("Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async value=>{window.copiedTemplate=value}})");await browser.click('.transfer-submit');await browser.waitFor('!!window.copiedTemplate');assert.equal(await browser.evaluate('copiedTemplate'),copied);
    await browser.click('.dialog-close');await browser.click('[data-salary-action=template-import]');await browser.waitFor("!!document.querySelector('.transfer-text')");
    await browser.evaluate("document.querySelector('.transfer-text').value="+JSON.stringify(copied));await browser.click('.transfer-submit');await browser.waitFor("document.querySelector('.transfer-preview').textContent.includes('已存在，可跳过')");await browser.click('.transfer-submit');await browser.waitFor("!document.querySelector('.transfer-text')");
    await browser.evaluate("setActiveView('audit');load({refreshGlobal:false})");await browser.waitFor("!!document.querySelector('.data-backup-total')");
    const input=await browser.evaluate("(()=>{const x=document.querySelector('.data-backup-total');x.focus();const before=x.value;x.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:100}));return {type:x.type,before,after:x.value,blurred:document.activeElement!==x}})()");assert.equal(input.type,'text');assert.equal(input.before,input.after);assert.equal(input.blurred,true);
    assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
  } finally { await browser.close();chrome.child.kill('SIGTERM'); }
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
