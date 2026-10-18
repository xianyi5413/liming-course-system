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
async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("student query integration test server did not start");
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
      connection: "close",
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
  db.exec("UPDATE users SET permission_override_enabled=1 WHERE username='salary-readonly'; INSERT INTO user_page_permissions(user_id,permission_key,enabled) SELECT id,'studentPricing',1 FROM users WHERE username='salary-readonly';");
  db.prepare('INSERT INTO role_filter_presets(role_code,view_key,filter_key,filter_value_json) VALUES(?,?,?,?)').run('academic','feeDetails','teacher_names',JSON.stringify(['其他教师']));
  db.exec(`INSERT INTO role_filter_presets(role_code,view_key,filter_key,filter_value_json) VALUES('academic','lessons','teacher_names','["合成教师"]');`);
}
before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-query-expansion-"));
  databasePath = path.join(tempRoot, "fee-reconciliation.sqlite");
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





const scope = new URLSearchParams({student:'张三',start:'2026-09-01',end:'2026-09-30'}).toString();
const endpoint='/api/fee-overrides/restore-rule?'+scope;
const preview = (ids=[9001,9002],cookie=ownerCookie) => api(endpoint,{method:'POST',cookie,body:{action:'preview',lesson_ids:ids,student_name:'张三'}});
const apply = token => api(endpoint,{method:'POST',body:{action:'apply',token}});
let ruleId;
test('effective counts, complete scoped details, identities and batch rule prices stay independent of settlement',async()=>{
 const db=new DatabaseSync(databasePath);
 db.exec(`INSERT INTO lessons(id,teacher_name,date,month_key,time_slot,grade,subject,student_names,status) VALUES
 (9004,'合成教师','2026-09-04','2026-09-01','09:00-11:00','高一','数学','李四、张三','待上'),
 (9005,'合成教师','2026-09-05','2026-09-01','09:00-11:00','高一','数学','张三、李四','请假'),
 (9006,'合成教师','2026-10-01','2026-10-01','09:00-11:00','高一','数学','张三、李四','已上'),
 (9007,'合成教师','2026-09-04','2026-09-01','09:00-11:00','高二','数学','张三','待上');`);db.close();
 const result=await api('/api/student-pricing-query?'+scope+'&include_courses=1');assert.equal(result.response.status,200);
 assert.equal(result.payload.rules.length,1);const rule=result.payload.rules[0];ruleId=rule.id;
 assert.equal(rule.effective_lessons,2);assert.equal(rule.all_lessons,4);
 const details=result.payload.courses[rule.id];assert.deepEqual(details.map(row=>row.id),[9001,9002,9004,9005]);
 assert.ok(details.slice(2).every(row=>row.unit_price===null&&row.rule_fee===null&&!row.can_edit_fee));
 assert.deepEqual((await api('/api/student-pricing/'+rule.id+'/courses?'+scope)).payload.lessons,details);
 const before=(await api('/api/student/张三/statement?'+scope)).payload.summary;
 for(const price of [180,0,100000]){const updated=await api('/api/student-pricing/batch?'+scope,{method:'PATCH',body:{ids:[ruleId],price}});assert.equal(updated.response.status,200);assert.deepEqual((await api('/api/student/张三/statement?'+scope)).payload.summary,before);}
 for(const price of [-1,100001,1.001,null,true,"", " "])assert.equal((await api('/api/student-pricing/batch?'+scope,{method:'PATCH',body:{ids:[ruleId],price}})).response.status,400);
 assert.equal((await api('/api/student-pricing/batch?'+scope,{cookie:teacherCookie,method:'PATCH',body:{ids:[ruleId],price:180}})).response.status,403);
 await api('/api/student-pricing/batch?'+scope,{method:'PATCH',body:{ids:[ruleId],price:0}});
});

test('restoration preview rejects stale data and rolls back every row on failure, preserves other students and records audits',async()=>{
 const db=new DatabaseSync(databasePath);
 db.exec(`UPDATE pricing_standards SET unit_price=160 WHERE grade='高一' AND student_count=2;
 INSERT OR REPLACE INTO fee_overrides(lesson_id,student_name,unit_price) VALUES(9001,'张三',136),(9002,'张三',150),(9001,'李四',77);`);
 let p=await preview();assert.equal(p.response.status,200);assert.deepEqual(p.payload.items.map(row=>[row.actual,row.target,row.action]),[[136,160,'restore'],[150,160,'restore']]);
 db.exec("UPDATE fee_overrides SET unit_price=135 WHERE lesson_id=9001 AND student_name='张三'");assert.equal((await apply(p.payload.token)).response.status,409);
 p=await preview();
 db.exec("CREATE TRIGGER reject_restore BEFORE DELETE ON fee_overrides WHEN OLD.lesson_id=9002 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 assert.equal((await apply(p.payload.token)).response.status,500);assert.equal(db.prepare("SELECT COUNT(*) n FROM fee_overrides WHERE student_name='张三'").get().n,2);
 db.exec('DROP TRIGGER reject_restore');
 assert.equal((await apply(p.payload.token)).payload.updated,2);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM fee_overrides WHERE student_name='张三'").get().n,0);
 assert.equal(db.prepare("SELECT unit_price FROM fee_overrides WHERE student_name='李四'").get().unit_price,77);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM operation_logs WHERE operation_type='批量恢复学生规则收费'").get().n,2);
 const {buildFullDataBuffer,restoreFullData}=require('../src/excel/full_backup');
 const file=path.join(tempRoot,'restored-fees.xlsx'),target=path.join(tempRoot,'restored-fees.sqlite');
 fs.writeFileSync(file,buildFullDataBuffer(db).buffer);fs.copyFileSync(databasePath,target);restoreFullData({dbPath:target,inputPath:file});
 const restored=new DatabaseSync(target);
 assert.deepEqual(restored.prepare('SELECT lesson_id,student_name,unit_price FROM fee_overrides ORDER BY lesson_id,student_name').all(),db.prepare('SELECT lesson_id,student_name,unit_price FROM fee_overrides ORDER BY lesson_id,student_name').all());restored.close();
 assert.equal((await apply(p.payload.token)).response.status,409);
 assert.equal((await preview([9001],teacherCookie)).response.status,403);assert.equal((await preview([9001],academicCookie)).response.status,403);
 assert.equal((await preview([9003])).response.status,403);
 assert.deepEqual((await preview()).payload.items.map(row=>row.action),['unchanged','unchanged']);
 const report=(await api('/api/student/张三/statement?'+scope)).payload;assert.ok(report.details.filter(row=>[9001,9002].includes(row.lesson_id||row.id)).every(row=>row.unit_price===160));
 db.close();
});

test('custom target mismatch is explicitly blocked; zero institution standard and nonbillable or missing targets remain distinct',async()=>{
 const db=new DatabaseSync(databasePath);
 db.exec(`UPDATE student_pricing SET custom_price=180 WHERE id=${ruleId}; INSERT OR REPLACE INTO fee_overrides(lesson_id,student_name,unit_price) VALUES(9001,'张三',136)`);
 let p=await preview([9001]);assert.equal(p.payload.items[0].action,'skip');assert.match(p.payload.items[0].reason,/个性规则/);
 assert.equal((await apply(p.payload.token)).payload.updated,0);assert.equal(db.prepare("SELECT unit_price FROM fee_overrides WHERE lesson_id=9001 AND student_name='张三'").get().unit_price,136);
 db.exec(`UPDATE student_pricing SET custom_price=0 WHERE id=${ruleId}; UPDATE pricing_standards SET unit_price=0 WHERE grade='高一' AND student_count=2`);
 p=await preview([9001,9004]);assert.deepEqual(p.payload.items.map(row=>row.action),['restore','skip']);assert.equal(p.payload.items[0].target,0);
 assert.equal((await apply(p.payload.token)).payload.updated,1);
 db.exec("DELETE FROM pricing_standards WHERE grade='高一' AND student_count=2");p=await preview([9001]);assert.equal(p.payload.items[0].target,null);assert.equal(p.payload.items[0].action,'skip');
 db.exec("INSERT INTO pricing_standards(grade,student_count,unit_price) VALUES('高一',2,160)");db.close();
});

test('Chromium five widths: scoped selections, expand/collapse, both fee batches, read-only courses and stale rendering',async()=>{
 const chrome=await launchChrome(path.join(tempRoot,'expand-chrome'));const b=chrome.session;
 try{
  await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await b.login('boss','123456');
  await b.evaluate("(async()=>{setActiveView('studentQuery');studentQueryRange={mode:'range',start:'2026-09-01',end:'2026-09-30'};await applyStudentQuerySelection('张三')})()");
  await b.waitFor("document.querySelector('.query-rule-select')");
  await b.evaluate("themeMode='light';paletteMode='black-white';applyTheme();applyPalette()");
  for(const width of [1920,1440,1280,1024,390]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
   assert.equal(await b.evaluate("document.querySelector('.query-rule-batch').disabled"),true);
   await b.click('.query-rule-select');assert.equal(await b.evaluate("document.querySelector('.query-rule-select-all').checked"),true);assert.equal(await b.evaluate("document.querySelectorAll('.shared-course-dialog').length"),0);
   await b.click('.query-rule-expand');await b.waitFor("document.querySelectorAll('.query-course-view [data-course-detail-id]').length===5&&!document.querySelector('.query-course-progress')");
   assert.equal(await b.evaluate("document.querySelectorAll('.query-course-view .query-course-select:disabled').length"),3);
   assert.equal(await b.evaluate("document.documentElement.scrollWidth>innerWidth"),false);
   assert.equal(await b.evaluate("document.querySelectorAll('.student-pricing-table,.query-rule-details,.query-course-view table table').length"),0);
   assert.equal(await b.evaluate("document.querySelectorAll('.query-course-view table thead tr').length"),1);
   assert.equal(await b.evaluate("document.querySelectorAll('.query-course-batch').length"),1);
   const extent=await b.evaluate("(()=>{const outer=document.querySelector('.query-course-view .table-wrap'),last=document.querySelector('.query-course-view tbody tr').lastElementChild;outer.scrollLeft=outer.scrollWidth;return {right:last.getBoundingClientRect().right,visibleRight:outer.getBoundingClientRect().left+outer.clientLeft+outer.clientWidth}})()");
   assert.ok(extent.right<=extent.visibleRight+2,JSON.stringify(extent));
   await b.evaluate("document.querySelector('.query-course-view .table-wrap').scrollLeft=0");
   if(process.env.QUERY_EXPANSION_SCREENSHOTS && [1440,390].includes(width)){
    fs.mkdirSync(process.env.QUERY_EXPANSION_SCREENSHOTS,{recursive:true});
    await b.evaluate("document.querySelector('.query-rule-heading').scrollIntoView({block:'start'})");
    const shot=await b.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.QUERY_EXPANSION_SCREENSHOTS,`expanded-${width}.png`),Buffer.from(shot.data,'base64'));
   }
   await b.click('.query-rule-expand');assert.equal(await b.evaluate("document.querySelectorAll('.query-rule-details').length"),0);assert.equal(await b.evaluate("document.querySelector('.query-rule-select').checked"),true);
   await b.click('.query-rule-select');
  }
  await b.click('.query-rule-select');
  await b.evaluate("(async()=>{studentQueryRange={mode:'range',start:'2026-09-01',end:'2026-09-01'};await refreshStudentQueryOnly()})()");
  assert.equal(await b.evaluate("document.querySelector('.query-rule-select').checked"),true);
  await b.evaluate("(async()=>{studentQueryRange={mode:'range',start:'2026-08-01',end:'2026-08-31'};await refreshStudentQueryOnly()})()");
  assert.equal(await b.evaluate('queryRuleSelection.size'),0);
  await b.evaluate("(async()=>{studentQueryRange={mode:'range',start:'2026-09-01',end:'2026-09-30'};await refreshStudentQueryOnly()})()");
  await b.click('.query-rule-select');await b.click('.query-rule-batch');
  assert.match(await b.evaluate("document.querySelector('.shared-course-dialog').textContent"),/跨月份/);
  await b.evaluate("document.querySelector('.query-batch-price').value='180'");await b.click('.query-batch-confirm');await b.waitFor("!document.querySelector('.query-batch-confirm')&&studentQueryRules[0].rule_fee===180");
  await b.click('.student-pricing-rule-row td:nth-child(3)');await b.waitFor("document.querySelector('.query-course-select')");
  await b.click('.query-course-select-all');await b.click('.query-course-batch');await b.waitFor("document.querySelector('.query-fee-confirm')");
  assert.equal(await b.evaluate("document.querySelector('.query-fee-confirm').disabled"),true);assert.match(await b.evaluate("[...document.querySelectorAll('.shared-course-dialog')].at(-1).textContent"),/现有收费机制不能安全恢复/);
  await b.click('.query-fee-cancel');await b.click('.dialog-close');
  await api('/api/student-pricing/batch?'+scope,{method:'PATCH',body:{ids:[ruleId],price:0}});
  await api('/api/fee-overrides',{method:'POST',body:{lesson_id:9001,student_name:'张三',unit_price:130}});
  await b.evaluate('refreshStudentQueryOnly({force:true})');await b.click('.student-pricing-rule-row td:nth-child(3)');await b.waitFor("document.querySelector('.query-course-select')");
  await b.click('.query-course-select-all');await b.click('.query-course-batch');await b.waitFor("document.querySelector('.query-fee-confirm:not(:disabled)')");
  await b.click('.query-fee-confirm');await b.waitFor("!document.querySelector('.query-fee-confirm')&&document.querySelector('.pricing-course-fee[data-lesson-id=\"9001\"]').textContent.includes('160.00')");
  assert.equal(await b.evaluate("document.querySelectorAll('.shared-course-dialog').length"),1);
  await b.evaluate("window.originalFeeRequest=request;request=async(...args)=>{const response=await originalFeeRequest(...args);if(args[0]==='/api/fee-overrides')await new Promise(resolve=>{window.releaseFeeResponse=resolve});return response}");
  await b.click('.pricing-course-fee-edit');
  await b.evaluate("const input=document.querySelector('.pricing-course-fee-input');input.value='130';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
  await b.waitFor("typeof window.releaseFeeResponse==='function'");
  await b.click('.query-course-select-all');await b.click('.query-course-batch');
  assert.equal(await b.evaluate("document.querySelectorAll('.query-fee-confirm').length"),0);
  await b.evaluate("releaseFeeResponse();request=originalFeeRequest");
  await b.waitFor("document.querySelector('.pricing-course-fee').textContent.includes('130.00')");
  await b.click('.dialog-close');
  await b.evaluate("(async()=>{document.querySelector('.query-rule-expand').click();await applyStudentQuerySelection('李四')})()");
  await b.waitFor("selectedStudent==='李四'&&studentQueryRules.every(row=>row.student_name==='李四')");
  assert.equal(await b.evaluate("queryRuleSelection.size"),0);assert.equal(await b.evaluate("document.querySelectorAll('.query-rule-details').length"),0);
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
 }finally{await b.close();chrome.child.kill();}
});


test('10/100/500 scoped courses render completely in batches; 1000 rule identities remain available without default detail preload',async()=>{
 const db=new DatabaseSync(databasePath);
 const insert=db.prepare("INSERT INTO lessons(teacher_name,date,month_key,time_slot,grade,subject,student_names,status) VALUES('合成教师','2026-09-10','2026-09-01','09:00-11:00','高一',?,?,'已上')");
 db.exec('BEGIN');
 for(const count of [10,100,500,1000]){
  const name='规模'+count;db.prepare("INSERT INTO students(name,grade,status) VALUES(?,'高一','在读')").run(name);
  for(let i=0;i<count;i++)insert.run(count===1000?'合成科目'+i:'数学',name);
 }
 db.exec('COMMIT');db.close();
 const chrome=await launchChrome(path.join(tempRoot,'performance-chrome')),b=chrome.session,measurements=[];
 try{
  await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await b.login('boss','123456');
  await b.evaluate("setActiveView('studentQuery');studentQueryRange={mode:'range',start:'2026-09-01',end:'2026-09-30'};render()");
  for(const count of [10,100,500,1000]){
   const ms=await b.evaluate(`(async()=>{const start=performance.now();await applyStudentQuerySelection('规模${count}');return performance.now()-start})()`);
   assert.equal(await b.evaluate("document.querySelectorAll('.query-rule-details').length"),0);
   assert.equal(await b.evaluate("studentQueryRules.length"),count===1000?1000:1);
   assert.ok(ms<5000,'collapsed first load remains responsive');
   let expansion=null;
   {
    await b.evaluate("window.expansionStart=performance.now();document.querySelector('.query-rule-expand').click()");
    await b.waitFor(`document.querySelectorAll('.query-course-view [data-course-detail-id]').length===${count}&&!document.querySelector('.query-course-progress')`,count===1000?30000:15000);
    expansion=await b.evaluate("performance.now()-expansionStart");assert.ok(expansion<(count===1000?30000:10000));
    assert.equal(await b.evaluate("new Set([...document.querySelectorAll('.query-course-view [data-course-detail-id]')].map(row=>row.dataset.courseDetailId)).size"),count);
    const nodes=await b.evaluate("document.querySelectorAll('.student-query-detail-slot *').length");
    assert.equal(await b.evaluate("document.querySelectorAll('.query-course-view table').length"),1);
    assert.equal(await b.evaluate("document.querySelectorAll('.query-course-view thead tr').length"),1);
    measurements.push({count,collapsed_ms:ms,expanded_ms:expansion,dom_nodes:nodes});
    await b.click('.query-rule-expand');
   }
  }
  console.log('[query-expansion-performance]',JSON.stringify(measurements));
  if(process.env.QUERY_EXPANSION_PERFORMANCE_OUTPUT)fs.writeFileSync(process.env.QUERY_EXPANSION_PERFORMANCE_OUTPUT,JSON.stringify(measurements,null,2)+'\n');
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
 }finally{await b.close();chrome.child.kill();}
});


test('one transaction restores different per-course rule amounts without changing other students or rules',async()=>{
 const db=new DatabaseSync(databasePath);
 db.exec(`UPDATE student_pricing SET custom_price=0 WHERE student_name='张三';
 UPDATE pricing_standards SET unit_price=160 WHERE grade='高一' AND student_count=2;
 UPDATE pricing_standards SET unit_price=180 WHERE grade='高二' AND student_count=1;
 INSERT INTO lessons(id,teacher_name,date,month_key,time_slot,grade,subject,student_names,status) VALUES(9000008,'合成教师','2026-09-15','2026-09-01','09:00-11:00','高二','数学','张三','已上');
 INSERT OR REPLACE INTO fee_overrides(lesson_id,student_name,unit_price) VALUES(9001,'张三',130),(9000008,'张三',170);`);
 const rulesBefore=db.prepare('SELECT * FROM student_pricing ORDER BY id').all();
 const otherBefore=db.prepare("SELECT * FROM fee_overrides WHERE student_name!='张三' ORDER BY lesson_id,student_name").all();
 const p=await preview([9001,9000008]);assert.deepEqual(p.payload.items.map(row=>row.target),[160,180]);
 assert.equal((await apply(p.payload.token)).payload.updated,2);
 assert.deepEqual(db.prepare('SELECT * FROM student_pricing ORDER BY id').all(),rulesBefore);
 assert.deepEqual(db.prepare("SELECT * FROM fee_overrides WHERE student_name!='张三' ORDER BY lesson_id,student_name").all(),otherBefore);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM fee_overrides WHERE student_name='张三' AND lesson_id IN (9001,9000008)").get().n,0);db.close();
});


test('new courses follow current rules when completed, old courses stay standard and both modes survive Excel restoration',async()=>{
 const db=new DatabaseSync(databasePath);
 db.exec(`UPDATE student_pricing SET custom_price=180 WHERE id=${ruleId}; UPDATE pricing_standards SET unit_price=160 WHERE grade='高一' AND student_count=2`);
 const oldPrice=(await api('/api/student-pricing/'+ruleId+'/courses?'+scope)).payload.lessons.find(row=>row.id===9001).unit_price;
 assert.equal(oldPrice,160);
 const created=await api('/api/lessons',{method:'POST',body:{teacher_name:'合成教师',date:'2026-11-12',time_slot:'09:00-11:00',classroom:'B1',grade:'高一',subject:'数学',student_names:'张三、李四',status:'待上'}});
 assert.equal(created.response.status,201);const id=created.payload.id;
 assert.equal(db.prepare('SELECT student_fee_mode FROM lessons WHERE id=?').get(id).student_fee_mode,'rule');
 const november=new URLSearchParams({student:'张三',start:'2026-11-01',end:'2026-11-30'}).toString();
 assert.equal((await api('/api/student-pricing/'+ruleId+'/courses?'+november)).payload.lessons[0].unit_price,null);
 assert.equal((await api('/api/lessons/'+id,{method:'PATCH',body:{status:'已上'}})).response.status,200);
 let details=(await api('/api/student-pricing/'+ruleId+'/courses?'+november)).payload.lessons;assert.equal(details[0].unit_price,180);assert.equal(details[0].rule_fee,180);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM fee_overrides WHERE lesson_id=?').get(id).n,0);
 await api('/api/student-pricing/'+ruleId+'?'+scope,{method:'PATCH',body:{custom_price:190}});
 assert.equal((await api('/api/student-pricing/'+ruleId+'/courses?'+november)).payload.lessons[0].unit_price,190);
 assert.equal((await api('/api/student-pricing/'+ruleId+'/courses?'+scope)).payload.lessons.find(row=>row.id===9001).unit_price,oldPrice);
 await api('/api/fee-overrides',{method:'POST',body:{lesson_id:id,student_name:'张三',unit_price:135}});
 const p=await api('/api/fee-overrides/restore-rule?'+november,{method:'POST',body:{action:'preview',lesson_ids:[id],student_name:'张三'}});
 assert.equal(p.payload.items[0].action,'restore');assert.equal(p.payload.items[0].target,190);
 assert.equal((await apply(p.payload.token)).payload.updated,1);
 const completed=await api('/api/lessons',{method:'POST',body:{teacher_name:'合成教师',date:'2026-11-13',time_slot:'09:00-11:00',classroom:'B1',grade:'高一',subject:'数学',student_names:'张三、李四',status:'已上',student_fee_mode:'standard'}});
 assert.equal(completed.response.status,201);assert.equal(completed.payload.student_fee_mode,'rule');
 assert.equal((await api('/api/student-pricing/'+ruleId+'/courses?'+november)).payload.lessons.find(row=>row.id===completed.payload.id).unit_price,190);
 assert.equal((await api('/api/fee-overrides',{method:'POST',body:{lesson_id:completed.payload.id,student_name:'张三',unit_price:0}})).response.status,200);
 assert.equal((await api('/api/student-pricing/'+ruleId+'/courses?'+november)).payload.lessons.find(row=>row.id===completed.payload.id).unit_price,0);
 const {buildFullDataBuffer,verifyFullData,restoreFullData}=require('../src/excel/full_backup');
 const buffer=buildFullDataBuffer(db).buffer,verified=verifyFullData(buffer);
 const visibleFees=verified.workbook.sheetMap.get('所有学生费用明细').rows;
 assert.equal(visibleFees.filter(row=>row[0]==='张三'&&row[10]===190).length,1);
 assert.ok(visibleFees.some(row=>row[0]==='张三'&&row[10]===0));
 assert.equal(verified.data.lessons.find(row=>row.id===id).student_fee_mode,'rule');assert.equal(verified.data.lessons.find(row=>row.id===9001).student_fee_mode,'standard');
 const file=path.join(tempRoot,'new-course-fees.xlsx'),target=path.join(tempRoot,'new-course-fees.sqlite');fs.writeFileSync(file,buffer);fs.copyFileSync(databasePath,target);restoreFullData({dbPath:target,inputPath:file});
 const restored=new DatabaseSync(target);assert.equal(restored.prepare('SELECT student_fee_mode FROM lessons WHERE id=?').get(id).student_fee_mode,'rule');assert.equal(restored.prepare('SELECT COUNT(*) n FROM fee_overrides WHERE lesson_id=?').get(id).n,0);restored.close();
 const {migrateStudentFeeMode}=require('../src/domain/fee_restore');
 const legacy=new DatabaseSync(':memory:');legacy.exec('CREATE TABLE lessons(id INTEGER, notes TEXT);INSERT INTO lessons VALUES(1,\'untouched\')');migrateStudentFeeMode(legacy);migrateStudentFeeMode(legacy);assert.deepEqual({...legacy.prepare('SELECT * FROM lessons').get()},{id:1,notes:'untouched',student_fee_mode:'standard'});legacy.close();db.close();
});


test('flat view includes pending-only rules, exact identities and scopes; single and bulk fees preserve the table',async()=>{
 const db=new DatabaseSync(databasePath);
 db.exec("UPDATE pricing_standards SET unit_price=160 WHERE grade='高一' AND student_count=2");
 db.exec(`INSERT INTO students(name,grade,status) VALUES('统一明细','高一','在读'),('仅待上','高一','在读');
 INSERT INTO lessons(id,teacher_name,date,month_key,time_slot,grade,subject,student_names,status) VALUES
 (9500001,'合成教师','2026-09-03','2026-09-01','09:00-11:00','高一','数学','统一明细、李四','已上'),
 (9500002,'合成教师','2026-09-01','2026-09-01','13:00-15:00','高一','英语','李四、统一明细','已上'),
 (9500003,'合成教师','2026-09-01','2026-09-01','09:00-11:00','高一','化学','统一明细','待上'),
 (9500004,'合成教师','2026-09-04','2026-09-01','09:00-11:00','高一','物理','统一明细','请假'),
 (9500005,'其他教师','2026-10-01','2026-10-01','09:00-11:00','高一','数学','统一明细','待上'),
 (9500006,'合成教师','2026-09-01','2026-09-01','09:00-11:00','高一','数学','仅待上','待上');
 INSERT INTO fee_overrides(lesson_id,student_name,unit_price) VALUES(9500001,'统一明细',135),(9500001,'李四',77);`);
 const params=new URLSearchParams({student:'统一明细',start:'2026-09-01',end:'2026-09-30'});
 const flat=(await api('/api/student-pricing-query?'+params+'&include_courses=flat')).payload;
 assert.deepEqual(flat.lessons.map(row=>row.id),[9500003,9500002,9500001,9500004]);
 assert.equal(new Set(flat.lessons.map(row=>row.id)).size,4);
 assert.equal(flat.lessons[0].unit_price,null);assert.equal(flat.lessons[0].can_edit_fee,false);
 assert.equal(flat.lessons[2].unit_price,135);assert.equal(flat.lessons[2].rule_fee,160);
 const original=(await api('/api/student/'+encodeURIComponent('统一明细')+'/statement?'+params)).payload;
 assert.deepEqual(new Set(original.details.map(row=>row.lesson_id)),new Set(flat.lessons.map(row=>row.id)));
 assert.equal((await api('/api/student-pricing-query?'+params+'&include_courses=flat',{cookie:teacherCookie})).payload.lessons.every(row=>row.teacher_name==='合成教师'&&!row.can_edit_fee),true);
 params.set('end','2026-10-31');assert.equal((await api('/api/student-pricing-query?'+params+'&include_courses=flat')).payload.lessons.length,5);
 params.set('student','统一');assert.equal((await api('/api/student-pricing-query?'+params+'&include_courses=flat')).payload.lessons.length,0);
 const chrome=await launchChrome(path.join(tempRoot,'flat-view-chrome')),b=chrome.session;
 try{
  await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await b.login('boss','123456');
  await b.evaluate("setActiveView('studentQuery');studentQueryRange={mode:'range',start:'2026-09-01',end:'2026-09-30'};applyStudentQuerySelection('统一明细')");
  await b.waitFor("document.querySelectorAll('.student-pricing-rule-row').length===2");
  await b.click('.query-rule-select');await b.click('.query-rule-expand');await b.waitFor("document.querySelector('.query-course-view[data-render-complete=true]')");
  assert.equal(await b.evaluate("document.querySelectorAll('.student-pricing-table,.query-rule-details,.query-rule-batch').length"),0);
  assert.equal(await b.evaluate("document.querySelectorAll('.query-course-batch').length"),1);
  await b.evaluate("window.originalFlatTable=document.querySelector('.query-course-view table')");
  await b.click('.pricing-course-fee[data-lesson-id="9500001"] button');
  await b.evaluate("const input=document.querySelector('.pricing-course-fee-input');input.value='140';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
  await b.waitFor("document.querySelector('.pricing-course-fee[data-lesson-id=\"9500001\"] button')?.textContent.includes('140.00')");
  assert.equal(await b.evaluate("originalFlatTable===document.querySelector('.query-course-view table')"),true);
  assert.equal(await b.evaluate("document.querySelector('.pricing-course-fee[data-lesson-id=\"9500001\"]').classList.contains('negative')"),true);
  await b.click('.query-course-select-all');await b.click('.query-course-batch');await b.waitFor("document.querySelector('.query-fee-confirm:not(:disabled)')");await b.click('.query-fee-confirm');
  await b.waitFor("document.querySelector('.pricing-course-fee[data-lesson-id=\"9500001\"] button')?.textContent.includes('160.00')");
  assert.equal(await b.evaluate("originalFlatTable===document.querySelector('.query-course-view table')"),true);
  assert.equal(db.prepare("SELECT unit_price FROM fee_overrides WHERE lesson_id=9500001 AND student_name='李四'").get().unit_price,77);
  await b.click('.query-rule-expand');assert.equal(await b.evaluate("document.querySelectorAll('.query-course-view').length"),0);assert.equal(await b.evaluate("document.querySelectorAll('.query-rule-select:checked').length"),1);
  await b.click('.query-rule-expand');await b.evaluate("applyStudentQuerySelection('仅待上')");await b.waitFor("document.querySelector('.query-course-view[data-render-complete=true]')&&document.querySelectorAll('.query-course-view [data-course-detail-id]').length===1");
  assert.equal(await b.evaluate('queryRulesExpanded'),true);assert.equal(await b.evaluate('studentQueryRules.length'),0);
  await b.click('.query-rule-expand');assert.equal(await b.evaluate("document.querySelector('.query-rule-expand').disabled"),false);
  await b.evaluate("setActiveView('home');setActiveView('studentQuery')");assert.equal(await b.evaluate('queryRulesExpanded'),false);
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
 }finally{await b.close();chrome.child.kill();db.close();}
});

test('1000 courses in one rule use one complete ordered table and one batch control',async()=>{
 const db=new DatabaseSync(databasePath);db.prepare("INSERT INTO students(name,grade,status) VALUES('千节同组','高一','在读')").run();
 const insert=db.prepare("INSERT INTO lessons(teacher_name,date,month_key,time_slot,grade,subject,student_names,status) VALUES('合成教师','2026-09-10','2026-09-01','09:00-11:00','高一','数学','千节同组','已上')");db.exec('BEGIN');for(let i=0;i<1000;i++)insert.run();db.exec('COMMIT');db.close();
 const chrome=await launchChrome(path.join(tempRoot,'flat-thousand-chrome')),b=chrome.session;
 try{
  await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await b.login('boss','123456');await b.evaluate("setActiveView('studentQuery');studentQueryRange={mode:'range',start:'2026-09-01',end:'2026-09-30'};applyStudentQuerySelection('千节同组')");
  await b.waitFor("studentQueryRules.length===1&&selectedStudent==='千节同组'");
  await b.evaluate("window.flatStart=performance.now();document.querySelector('.query-rule-expand').click()");await b.waitFor("document.querySelector('.query-course-view[data-render-complete=true]')",10000);
  const measurement=await b.evaluate("({elapsed_ms:performance.now()-flatStart,dom_nodes:document.querySelectorAll('.student-query-detail-slot *').length})");console.log('[flat-thousand-single-rule]',JSON.stringify(measurement));assert.ok(measurement.elapsed_ms<10000);
  assert.equal(await b.evaluate("document.querySelectorAll('.query-course-view tbody tr').length"),1000);assert.equal(await b.evaluate("document.querySelectorAll('.query-course-view thead,.query-course-batch').length"),2);
  const ids=await b.evaluate("[...document.querySelectorAll('.query-course-view [data-course-detail-id]')].map(row=>Number(row.dataset.courseDetailId))");assert.deepEqual(ids,[...ids].sort((a,b)=>a-b));assert.equal(new Set(ids).size,1000);
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
 }finally{await b.close();chrome.child.kill();}
});
