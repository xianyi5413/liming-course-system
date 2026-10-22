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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-fee-local-"));
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






const scope=new URLSearchParams({student:'张三',start:'2026-09-01',end:'2026-09-30'}).toString();
const endpoint='/api/fee-overrides/restore-rule?'+scope;
const preview=(ids,extra={})=>api(endpoint,{method:'POST',body:{action:'preview',mode:'set_actual',lesson_ids:ids,student_name:'张三',unit_price:9999,...extra}});
const apply=token=>api(endpoint,{method:'POST',body:{action:'apply',token,unit_price:9999}});
let ruleId;
test('explicit rule snapshots allow old and new modes with individual amounts, zero, limits and exact student isolation',async()=>{
 const db=new DatabaseSync(databasePath);
 db.exec(`UPDATE pricing_standards SET unit_price=200 WHERE grade='高一' AND student_count=2;
 INSERT INTO lessons(id,teacher_name,date,month_key,time_slot,grade,subject,student_names,status,student_fee_mode) VALUES
 (9010,'合成教师','2026-09-10','2026-09-01','09:00-11:00','高二','英语','张三','已上','standard'),
 (9011,'合成教师','2026-09-11','2026-09-01','09:00-11:00','高一','数学','张三、李四','已上','rule'),
 (9012,'合成教师','2026-09-12','2026-09-01','09:00-11:00','高一','数学','张三、李四','待上','standard'),
 (9013,'合成教师','2026-09-13','2026-09-01','09:00-11:00','高一','数学','张三、李四','已上','standard');
 INSERT OR REPLACE INTO fee_overrides(lesson_id,student_name,unit_price) VALUES(9002,'张三',150),(9001,'李四',77),(9011,'张三',130);`);
 const rules=(await api('/api/student-pricing-query?'+scope)).payload.rules;
 ruleId=rules.find(row=>row.grade==='高一').id;const second=rules.find(row=>row.grade==='高二').id;
 await api('/api/student-pricing/'+ruleId+'?'+scope,{method:'PATCH',body:{custom_price:1200}});
 await api('/api/student-pricing/'+second+'?'+scope,{method:'PATCH',body:{custom_price:180}});
 const lessonsBefore=db.prepare('SELECT * FROM lessons ORDER BY id').all(),other=db.prepare("SELECT * FROM fee_overrides WHERE student_name='李四'").all();
 let p=await preview([9001,9002,9010,9011,9012]);assert.equal(p.response.status,200);
 assert.deepEqual(p.payload.items.map(row=>[row.lesson_id,row.target,row.action]),[[9001,1200,'set'],[9002,1200,'set'],[9010,180,'set'],[9011,1200,'set'],[9012,null,'skip']]);
 let saved=await apply(p.payload.token);assert.equal(saved.payload.updated,4);assert.deepEqual(saved.payload.rows.map(row=>row.unit_price),[1200,1200,180,1200]);
 assert.deepEqual(db.prepare('SELECT * FROM lessons ORDER BY id').all(),lessonsBefore);
 assert.deepEqual(db.prepare("SELECT * FROM fee_overrides WHERE student_name='李四'").all(),other);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM fee_overrides WHERE lesson_id=9013').get().n,0);
 assert.equal((await apply(p.payload.token)).response.status,409);
 p=await preview([9001,9002]);assert.ok(p.payload.items.every(row=>row.action==='unchanged'));const before=db.prepare('SELECT * FROM fee_overrides ORDER BY lesson_id,student_name').all();await apply(p.payload.token);assert.deepEqual(db.prepare('SELECT * FROM fee_overrides ORDER BY lesson_id,student_name').all(),before);
 // A later rule change must never turn explicit snapshots into auto-following prices.
 await api('/api/student-pricing/'+ruleId+'?'+scope,{method:'PATCH',body:{custom_price:1300}});
 const detail=(await api('/api/student-pricing-query?'+scope+'&include_courses=flat')).payload.lessons;
 assert.ok(detail.filter(row=>[9001,9002,9011].includes(row.id)).every(row=>row.unit_price===1200&&row.rule_fee===1300));
 assert.equal(detail.find(row=>row.id===9013).unit_price,200);
 await api('/api/student-pricing/'+ruleId+'?'+scope,{method:'PATCH',body:{custom_price:0}});
 db.exec("UPDATE pricing_standards SET unit_price=0 WHERE grade='高一' AND student_count=2");
 p=await preview([9001]);assert.equal(p.payload.items[0].target,0);assert.equal((await apply(p.payload.token)).payload.updated,1);assert.equal(db.prepare("SELECT unit_price FROM fee_overrides WHERE lesson_id=9001 AND student_name='张三'").get().unit_price,0);
 db.exec("DELETE FROM pricing_standards WHERE grade='高一' AND student_count=2");p=await preview([9001]);assert.equal(p.payload.items[0].target,null);assert.equal(p.payload.items[0].action,'skip');
 await api('/api/student-pricing/'+ruleId+'?'+scope,{method:'PATCH',body:{custom_price:10001}});p=await preview([9001]);assert.equal(p.payload.items[0].action,'skip');assert.match(p.payload.items[0].reason,/10000/);
 db.exec("INSERT INTO pricing_standards(grade,student_count,unit_price) VALUES('高一',2,200)");await api('/api/student-pricing/'+ruleId+'?'+scope,{method:'PATCH',body:{custom_price:1200}});db.close();
});
test('explicit batch checks permissions, duplicate identities, stale rules/courses, transaction rollback and complete audits',async()=>{
 const db=new DatabaseSync(databasePath);
 for(const cookie of [teacherCookie,academicCookie])assert.equal((await api(endpoint,{cookie,method:'POST',body:{action:'preview',mode:'set_actual',lesson_ids:[9001],student_name:'张三'}})).response.status,403);
 assert.equal((await preview([9001,9001])).response.status,400);assert.equal((await preview([9003])).response.status,403);assert.equal((await preview([999999])).response.status,409);
 let p=await preview([9001]);await api('/api/student-pricing/'+ruleId+'?'+scope,{method:'PATCH',body:{custom_price:1201}});assert.equal((await apply(p.payload.token)).response.status,409);
 p=await preview([9001]);db.exec("UPDATE lessons SET notes='changed after preview' WHERE id=9001");assert.equal((await apply(p.payload.token)).response.status,409);
 db.exec("INSERT INTO lessons(id,teacher_name,date,month_key,grade,subject,student_names,status) VALUES(9050,'合成教师','2026-09-10','2026-09-01','高一','数学','张三、李四','已上')");p=await preview([9050]);db.exec('DELETE FROM lessons WHERE id=9050');assert.equal((await apply(p.payload.token)).response.status,409);
 p=await preview([9001,9002]);const snapshot=db.prepare('SELECT * FROM fee_overrides ORDER BY lesson_id,student_name').all();const logs=db.prepare('SELECT COUNT(*) n FROM operation_logs').get().n;
 db.exec("CREATE TRIGGER reject_set BEFORE UPDATE ON fee_overrides WHEN OLD.lesson_id=9002 BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END");assert.equal((await apply(p.payload.token)).response.status,500);assert.deepEqual(db.prepare('SELECT * FROM fee_overrides ORDER BY lesson_id,student_name').all(),snapshot);assert.equal(db.prepare('SELECT COUNT(*) n FROM operation_logs').get().n,logs);db.exec('DROP TRIGGER reject_set');
 assert.equal((await apply(p.payload.token)).payload.updated,2);
 const audit=db.prepare("SELECT operation_content FROM operation_logs WHERE operation_type='批量设置学生实际费用' ORDER BY id DESC LIMIT 2").all();assert.ok(audit.every(row=>row.operation_content.includes('→ 1201')&&row.operation_content.includes('收费来源不变')));
 db.close();
});
test('explicit overrides, source modes, student balances and visible/hidden Excel values survive full restoration',async()=>{
 const db=new DatabaseSync(databasePath),before=(await api('/api/student/张三/statement?'+scope)).payload;
 const {buildFullDataBuffer,verifyFullData,restoreFullData}=require('../src/excel/full_backup');const buffer=buildFullDataBuffer(db).buffer,verified=verifyFullData(buffer);
 assert.equal(verified.data.fee_overrides.find(row=>row.lesson_id===9001&&row.student_name==='张三').unit_price,1201);
 assert.equal(verified.data.lessons.find(row=>row.id===9001).student_fee_mode,'standard');assert.equal(verified.data.lessons.find(row=>row.id===9011).student_fee_mode,'rule');
 assert.ok(verified.workbook.sheetMap.get('所有学生费用明细').rows.some(row=>row[0]==='张三'&&row[10]===1201));
 const file=path.join(tempRoot,'fees.xlsx'),target=path.join(tempRoot,'fees.sqlite');fs.writeFileSync(file,buffer);db.exec('PRAGMA wal_checkpoint(FULL)');fs.copyFileSync(databasePath,target);restoreFullData({dbPath:target,inputPath:file});
 const restored=new DatabaseSync(target);for(const table of ['lessons','fee_overrides','recharge_records','student_opening_balances'])assert.deepEqual(restored.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());restored.close();db.close();
 const detail=before.details.filter(row=>[9001,9002].includes(row.lesson_id));assert.equal(detail.length,2);assert.ok(detail.every(row=>row.unit_price===1201));assert.ok(before.summary.total_fee>=2402);
});
test('rule edits compare expected prices and reject stale single/batch values without partial writes',async()=>{
 const rules=(await api('/api/student-pricing-query?'+scope)).payload.rules;
 const single=await api('/api/student-pricing/'+ruleId+'?'+scope,{method:'PATCH',body:{custom_price:500,expected_price:1}});assert.equal(single.response.status,409);
 const batch=await api('/api/student-pricing/batch?'+scope,{method:'PATCH',body:{ids:rules.map(row=>row.id),price:500,expected_prices:rules.map(row=>({id:row.id,custom_price:1}))}});assert.equal(batch.response.status,409);
 assert.deepEqual((await api('/api/student-pricing-query?'+scope)).payload.rules.map(row=>row.custom_price),rules.map(row=>row.custom_price));
});

async function openQuery(b,name='张三') {
 await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await b.login('boss','123456');
 await b.evaluate(`(async()=>{setActiveView('studentQuery');studentQueryRange={mode:'range',start:'2026-09-01',end:'2026-09-30'};await applyStudentQuerySelection(${JSON.stringify(name)})})()`);
 await b.waitFor("document.querySelector('.student-pricing-rule-row')");
}
const installObserver=`(()=>{window.tables=[...document.querySelectorAll('.student-query-results table')];window.rows=[...document.querySelectorAll('.student-pricing-rule-row')];window.removedTables=0;window.removedNodes=[];window.observer?.disconnect();window.observer=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node.nodeType===1&&(node.matches('table,tbody,tr')||node.querySelector('table'))){removedTables++;removedNodes.push(node.outerHTML.slice(0,350))}});observer.observe(document.querySelector('.student-query-results'),{childList:true,subtree:true});})()`;
test('Chromium single/batch rules preserve original nodes, selection, scroll and five-width compact themed dialogs',async()=>{
 const chrome=await launchChrome(path.join(tempRoot,'stable-rules')),b=chrome.session;
 try{
  await openQuery(b);await b.evaluate('window.confirm=()=>true;window.alert=()=>{}');await b.click('.query-rule-select');
  await b.evaluate(installObserver);
  for(const width of [1920,1440,1280,1024,390]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
   for(const mode of ['light','dark']){
    await b.evaluate(`themeMode='${mode}';paletteMode='black-white';applyTheme();applyPalette()`);
    await b.click('.query-rule-batch');
    const metrics=await b.evaluate(`(()=>{const input=document.querySelector('.query-batch-price'),panel=input.closest('.modal-panel'),a=input.getBoundingClientRect(),p=panel.getBoundingClientRect();return {width:a.width,panel:p.width,right:a.right,limit:p.right,align:getComputedStyle(input).textAlign,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
    assert.ok(metrics.width>=160&&metrics.width<=220,JSON.stringify(metrics));assert.ok(metrics.panel<=480);assert.equal(metrics.align,'right');assert.ok(metrics.right<=metrics.limit);assert.equal(metrics.overflow,false);
    await b.click('.query-batch-cancel');
   }
  }
  await b.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await b.evaluate(`document.querySelector('#student-pricing-table-wrap').scrollLeft=80;window.savedScroll=document.querySelector('#student-pricing-table-wrap').scrollLeft;window.savedWindow=scrollY`);
  await b.evaluate(`(async()=>{const input=document.querySelector('.student-pricing-field[data-field="custom_price"]');input.value='1250';await saveStudentPricingField(input)})()`);
  assert.equal(await b.evaluate("removedTables===0&&tables.every(table=>table.isConnected)&&rows.every(row=>row.isConnected)"),true);
  assert.equal(await b.evaluate("document.querySelector('#student-pricing-table-wrap').scrollLeft===savedScroll&&scrollY===savedWindow"),true);
  assert.equal(await b.evaluate("document.querySelector('.query-rule-select').checked"),true);
  await b.click('.query-rule-batch');await b.evaluate("document.querySelector('.query-batch-price').value='-1'");await b.click('.query-batch-confirm');assert.equal(await b.evaluate("Boolean(document.querySelector('.query-batch-confirm'))"),true);
  await b.evaluate("document.querySelector('.query-batch-price').value='1260'");await b.click('.query-batch-confirm');await b.waitFor("!document.querySelector('.query-batch-confirm')&&studentQueryRules.some(row=>row.rule_fee===1260)");
  await b.waitFor("!document.querySelector('.student-pricing-field[data-saving=\"1\"]')");
  assert.equal(await b.evaluate("removedTables===0&&rows.every(row=>row.isConnected)&&document.querySelector('.query-rule-select').checked"),true);
  assert.equal(await b.evaluate("selectedStudent==='张三'&&studentQueryRange.start==='2026-09-01'&&!queryRulesExpanded"),true);
  await b.evaluate(`document.querySelector('.student-pricing-field[data-field="custom_price"]').focus();document.querySelector('.student-pricing-field[data-field="custom_price"]').select()`);
  await b.send('Input.insertText',{text:'1270'});
  await b.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await b.waitFor("studentQueryRules[0].rule_fee===1270&&queryRuleSavingIds.size===0");
  assert.equal(await b.evaluate('removedTables===0&&tables.every(table=>table.isConnected)'),true);
  // Rule update failures preserve data and table nodes.
  await b.evaluate(`window.originalRequest=request;request=async(path,options)=>{if(path.startsWith('/api/student-pricing/')&&options?.method==='PATCH')throw new Error('synthetic save failure');return originalRequest(path,options)}`);
  await b.evaluate(`(async()=>{const input=document.querySelector('.student-pricing-field[data-field="custom_price"]');input.value='999';await saveStudentPricingField(input)})()`);
  assert.equal(await b.evaluate("studentQueryRules[0].rule_fee===1270&&Number(document.querySelector('.student-pricing-field[data-field=\"custom_price\"]').value)===1270&&removedTables===0"),true);
  await b.evaluate('request=originalRequest');assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
 }finally{await b.close();chrome.child.kill();}
});

test('Chromium explicit fee confirmation and refresh keep full course table, differences, totals and asynchronous view boundaries',async()=>{
 const chrome=await launchChrome(path.join(tempRoot,'stable-courses')),b=chrome.session;
 try{
  await openQuery(b);await b.click('.query-rule-expand');await b.waitFor("document.querySelector('.query-course-view[data-render-complete=true]')");
  await b.evaluate(installObserver);await b.click('.query-course-select-all');await b.click('.query-course-batch');await b.waitFor("document.querySelector('.query-fee-confirm')");
  assert.equal(await b.evaluate("document.querySelector('.shared-course-dialog details').open"),false);
  assert.equal(await b.evaluate("document.querySelectorAll('.fee-change-totals dd').length"),3);
  const before=await b.evaluate('state.student_statement.summary.total_fee');await b.click('.query-fee-confirm');await b.waitFor("!document.querySelector('.query-fee-confirm')&&[...document.querySelectorAll('.pricing-course-fee')].filter(cell=>cell.querySelector('button')).every(cell=>!cell.classList.contains('negative'))");
  await b.waitFor(`state.student_statement.summary.total_fee>${before}`);
  assert.equal(await b.evaluate('removedTables===0&&tables.every(table=>table.isConnected)&&queryRulesExpanded'),true);
  // Older completed reads must not overwrite a later mutation/refetch.
  await b.evaluate(`window.originalRequest=request;window.releaseOld=null;request=async(path,options)=>{const result=await originalRequest(path,options);if(path.startsWith('/api/student-pricing-query?')&&!window.delayedOnce){window.delayedOnce=true;await new Promise(resolve=>window.releaseOld=resolve)}return result};window.oldRefresh=refreshStudentQueryMoney();void 0`);
  await b.waitFor("typeof releaseOld==='function'");
  await b.evaluate(`(async()=>{await request('/api/fee-overrides',{method:'POST',body:{lesson_id:9001,student_name:'张三',unit_price:333}});await refreshStudentQueryMoney()})()`);
  await b.evaluate('(async()=>{releaseOld();await oldRefresh;request=originalRequest})()');assert.equal(await b.evaluate("document.querySelector('.pricing-course-fee[data-lesson-id=\"9001\"] button').textContent.includes('333.00')"),true);
  // Saving a rule for the old student while switching must not refill the new view.
  await b.evaluate(`window.delayedOnce=false;request=async(path,options)=>{const result=await originalRequest(path,options);if(path.startsWith('/api/student-pricing-query?')&&!delayedOnce){delayedOnce=true;await new Promise(resolve=>window.releaseOld=resolve)}return result};window.oldRefresh=refreshStudentQueryMoney();void 0`);await b.waitFor('delayedOnce');
  await b.evaluate("applyStudentQuerySelection('李四')");await b.waitFor("state.student_statement.student_name==='李四'&&document.querySelector('.query-course-view[data-render-complete=true]')");
  await b.evaluate('(async()=>{releaseOld();await oldRefresh;request=originalRequest})()');assert.equal(await b.evaluate("state.student_statement.student_name==='李四'&&[...queryFeeEditors].every(editor=>editor.student==='李四')"),true);
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
 }finally{await b.close();chrome.child.kill();}
});

test('10/100/500/1000 synthetic course amount refreshes use bounded requests, preserve nodes and do not accumulate editors',async()=>{
 const db=new DatabaseSync(databasePath),insert=db.prepare("INSERT INTO lessons(teacher_name,date,month_key,time_slot,grade,subject,student_names,status,student_fee_mode,notes) VALUES('合成教师','2026-09-10','2026-09-01','09:00-11:00','高一','数学',?,'已上','rule',?)");
 for(const count of [10,100,500,1000]){const name='费用规模'+count;db.prepare("INSERT INTO students(name,grade,status) VALUES(?,'高一','在读')").run(name);db.exec('BEGIN');for(let i=0;i<count;i++)insert.run(name,'完整长备注'.repeat(20));db.exec('COMMIT');}db.close();
 // Direct fixture seeding happens outside API invalidation; publish it through an existing write.
 await api('/api/student-pricing/'+ruleId+'?'+scope,{method:'PATCH',body:{custom_price:1260}});
 const chrome=await launchChrome(path.join(tempRoot,'money-performance')),b=chrome.session,measurements=[];
 try{
  await openQuery(b,'费用规模10');
  for(const count of [10,100,500,1000]){
   await b.evaluate(`(async()=>{queryRulesExpanded=false;await applyStudentQuerySelection('费用规模${count}')})()`);await b.click('.query-rule-expand');await b.waitFor(`document.querySelectorAll('.query-course-view [data-course-detail-id]').length===${count}&&document.querySelector('.query-course-view[data-render-complete=true]')`,20000);
   await b.evaluate(installObserver);
   const result=await b.evaluate(`(async()=>{const original=request;let requests=0;request=(...args)=>{requests++;return original(...args)};const start=performance.now();await request('/api/student-pricing/'+studentQueryRules[0].id,{method:'PATCH',body:{custom_price:321}});await refreshStudentQueryMoney();request=original;return {count:${count},elapsed_ms:performance.now()-start,requests,removed_tables:removedTables,removed_nodes:removedNodes,preserved:tables.every(table=>table.isConnected),editors:queryFeeEditors.size,all_updated:[...document.querySelectorAll('.pricing-course-fee button')].every(button=>button.textContent.includes('321.00'))}})()`);
   assert.equal(result.requests,3);assert.equal(result.removed_tables,0,JSON.stringify(result));assert.equal(result.preserved,true);assert.equal(result.editors,1);assert.equal(result.all_updated,true);assert.ok(result.elapsed_ms<5000,JSON.stringify(result));measurements.push(result);
   assert.equal(await b.evaluate(`(async()=>{clearStudentQueryCache();return (await fetchStudentStatement(selectedStudent,false)).summary.total_fee})()`),321*count);
  }
  console.log('[fee-local-performance]',JSON.stringify(measurements));if(process.env.FEE_LOCAL_PERFORMANCE_OUTPUT)fs.writeFileSync(process.env.FEE_LOCAL_PERFORMANCE_OUTPUT,JSON.stringify(measurements,null,2)+'\n');
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
 }finally{await b.close();chrome.child.kill();}
});
