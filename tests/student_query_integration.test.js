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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-query-integration-"));
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




let ruleId, standardId;
const save = (amount, cookie = ownerCookie) => api('/api/fee-overrides', {method:'POST',cookie,body:{lesson_id:9001,student_name:'张三',unit_price:amount}});


const { readZip } = require('../src/excel/xlsx_codec');
const crypto = require('node:crypto');
const baselinePath = path.join(__dirname, 'fixtures/student-query-export-baseline.json');
test('student statement Excel XML, filename, canvas text geometry and pixels match the pre-integration baseline', async()=>{
 const chrome=await launchChrome(path.join(tempRoot,'export-chrome'));
 try {
  const browser=chrome.session;
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${port}/`}); await browser.login('boss','123456');
  const results=[];
  for(const range of [{start:'2026-01-01',end:'2026-12-31'},{start:'2026-09-01',end:'2026-09-01'}]) {
   const params=new URLSearchParams({...range,student:'张三'});
   const response=await fetch(`http://127.0.0.1:${port}/api/export/student-statement.xlsx?${params}`,{headers:{cookie:ownerCookie}});
   assert.equal(response.status,200);
   const buffer=Buffer.from(await response.arrayBuffer());
   const xml=Object.fromEntries([...readZip(buffer)].filter(([key])=>key.startsWith('xl/')).map(([key,value])=>[key,value.toString()]));
   const canvas=await browser.evaluate(`(async()=>{ const report=await request('/api/student/'+encodeURIComponent('张三')+'/statement?'+new URLSearchParams(${JSON.stringify(range)}),{cache:false}); const calls=[],old=CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText=function(...args){args[0]=String(args[0]).replace(new RegExp('生成：[0-9 :~-]+ / 费用概览'),"生成：2026-10-16 10:24:43 / 费用概览");calls.push(args);return old.apply(this,args)};try {const c=studentStatementCanvas(report);return {calls,width:c.width,height:c.height,png:c.toDataURL(),filename:studentStatementFilename(report)}}finally{CanvasRenderingContext2D.prototype.fillText=old}})()`);
   const png=Buffer.from(canvas.png.split(',')[1],'base64'); delete canvas.png;
   results.push({range,xml,disposition:response.headers.get('content-disposition'),canvas:{...canvas,sha256:crypto.createHash('sha256').update(png).digest('hex')}});
   if(process.env.CAPTURE_QUERY_BASELINE==='1') {fs.mkdirSync(path.join(tempRoot,'baseline'),{recursive:true});fs.writeFileSync(path.join(tempRoot,'baseline',`${results.length}.xlsx`),buffer);fs.writeFileSync(path.join(tempRoot,'baseline',`${results.length}.png`),png);}
  }
  if(process.env.CAPTURE_QUERY_BASELINE==='1'){fs.mkdirSync(path.dirname(baselinePath),{recursive:true});fs.writeFileSync(baselinePath,JSON.stringify(results,null,2)+'\n');console.log('Saved synthetic export baseline');}
  else assert.deepEqual(results,JSON.parse(fs.readFileSync(baselinePath,'utf8')));
  assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
 }finally{await chrome.session.close();chrome.child.kill();}
});

const scope = (student='张三',start='2026-09-01',end='2026-09-30') => new URLSearchParams({student,start,end}).toString();
test('scoped grouping, custom targets and writes preserve actual settlement and exact student identity',async()=>{
 const page=await api('/api/student-pricing-query?'+scope());
 assert.equal(page.response.status,200);assert.equal(page.payload.rules.length,1);
 const rule=page.payload.rules[0];ruleId=rule.id;
 assert.equal(rule.total_lessons,2);assert.equal(rule.start_date,'2026-09-01');assert.equal(rule.end_date,'2026-09-02');
 const db=new DatabaseSync(databasePath);standardId=db.prepare("SELECT id FROM pricing_standards WHERE grade='高一' AND student_count=2").get().id;db.close();
 await api('/api/pricing-standards/'+standardId,{method:'PATCH',body:{unit_price:160}});
 const reportBefore=(await api('/api/student/张三/statement?'+scope())).payload;
 assert.equal((await api('/api/student-pricing/'+ruleId+'?'+scope(),{method:'PATCH',body:{custom_price:136,notes:'长规则备注'.repeat(80)}})).response.status,200);
 let detail=(await api('/api/student-pricing/'+ruleId+'/courses?'+scope())).payload;
 assert.deepEqual(detail.lessons.map(row=>row.rule_fee),[136,136]);assert.deepEqual(detail.lessons.map(row=>row.unit_price),[160,160]);
 const afterRule=(await api('/api/student/张三/statement?'+scope())).payload;
 assert.deepEqual(afterRule.summary,reportBefore.summary);assert.deepEqual(afterRule.month_rows,reportBefore.month_rows);assert.deepEqual(afterRule.recharges,reportBefore.recharges);assert.deepEqual(afterRule.details.map(({rule_price,pricing_rule_id,price_source,can_apply_pricing_rule,...row})=>row),reportBefore.details.map(({rule_price,pricing_rule_id,price_source,can_apply_pricing_rule,...row})=>row));
 const scoped=(await api('/api/student-pricing-query?'+scope('张三','2026-09-01','2026-09-01'))).payload.rules;
 assert.equal(scoped[0].rule_fee,136);assert.equal(scoped[0].total_lessons,1);assert.equal(scoped[0].end_date,'2026-09-01');
 detail=(await api('/api/student-pricing/'+ruleId+'/courses?'+scope('张三','2026-09-01','2026-09-01'))).payload;assert.equal(detail.lessons.length,1);
 const other=(await api('/api/student-pricing-query?'+scope('李四'))).payload.rules[0];assert.notEqual(other.id,ruleId);assert.equal(other.rule_fee,160);
 assert.equal((await api('/api/student-pricing/batch?'+scope(),{method:'PATCH',body:{ids:[ruleId,other.id],price:200}})).response.status,403);
 assert.equal((await api('/api/student-pricing/'+ruleId+'?'+scope('张三','2026-08-01','2026-08-31'),{method:'PATCH',body:{custom_price:200}})).response.status,403);
 assert.equal((await api('/api/student-pricing/'+ruleId+'/courses?'+scope('李四'))).response.status,400);
 assert.deepEqual((await api('/api/student-pricing-query?'+scope('张'))).payload.rules,[]);
 assert.deepEqual((await api('/api/student-pricing-query?'+scope('张三','2026-08-01','2026-08-31'))).payload.rules,[]);
 for(const amount of [136,160,180,0,136.01]) {assert.equal((await save(amount)).response.status,200);const row=(await detailApi()).lessons[0];assert.equal(row.rule_fee,136);assert.equal(row.unit_price,amount);}
 assert.equal((await api('/api/student-pricing/'+ruleId+'?'+scope(),{cookie:teacherCookie,method:'PATCH',body:{custom_price:200}})).response.status,403);
 assert.equal((await api('/api/student-pricing-query?'+scope(),{cookie:teacherCookie})).payload.can_edit_rule,false);
 const noCustom=await api('/api/student-pricing/'+ruleId+'?'+scope(),{method:'PATCH',body:{custom_price:0}});assert.equal(noCustom.payload.rule_fee,160);
 await api('/api/pricing-standards/'+standardId,{method:'PATCH',body:{unit_price:0}});assert.equal((await detailApi()).lessons[0].rule_fee,0);
 await api('/api/pricing-standards/'+standardId,{method:'PATCH',body:{unit_price:160}});
 await api('/api/student-pricing/'+ruleId,{method:'PATCH',body:{custom_price:136}});await save(136);
});
const detailApi=async()=> (await api('/api/student-pricing/'+ruleId+'/courses?'+scope())).payload;
test('Chromium integrated first layout, scoped dialog, editing, export isolation and stale request cancellation',async()=>{
 const chrome=await launchChrome(path.join(tempRoot,'integration-chrome')),b=chrome.session;
 try {
  await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await b.login('boss','123456');
  await b.evaluate("setActiveView('studentQuery');selectedStudent='';load({refreshGlobal:false})");
  assert.equal(await b.evaluate("document.querySelectorAll('.student-query-detail-slot .student-pricing-rule-row').length"),0);
  for(const width of [1920,1440,1280,1024,390]) {
   await b.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
   await b.evaluate("studentQueryRange={mode:'range',start:'2026-09-01',end:'2026-09-01'};applyStudentQuerySelection('张三')");
   await b.evaluate('new Promise(requestAnimationFrame)');
   const result=await b.evaluate(`(()=>{const t=document.querySelector('.student-query-detail-slot table');return {rows:t.tBodies[0].rows.length,notes:t.querySelector('colgroup').lastElementChild.style.width,overflow:document.documentElement.scrollWidth>innerWidth,count:studentPricingVisibleRows[0].total_lessons,widths:t.dataset.adaptiveWidths}})()`);
   assert.equal(result.rows,1);assert.equal(result.count,1);assert.equal(parseFloat(result.notes),480);assert.equal(result.overflow,false);assert.ok(result.widths);
   await b.click('.student-query-detail-slot .student-pricing-rule-row td.row-index');await b.waitFor("!!document.querySelector('.course-details-table')");
   assert.equal(await b.evaluate("document.querySelectorAll('.course-details-table tbody tr').length"),1);
   const feeStyle=await b.evaluate(`(()=>{const c=document.querySelector('.pricing-course-fee'),b=c.querySelector('button'),r=c.nextElementSibling;return {border:getComputedStyle(b).borderWidth,bg:getComputedStyle(b).backgroundColor,color:getComputedStyle(c).color,rule:getComputedStyle(r).color,note:c.previousElementSibling.textContent}})()`);
   assert.equal(feeStyle.border,'0px');assert.equal(feeStyle.bg,'rgba(0, 0, 0, 0)');assert.equal(feeStyle.color,feeStyle.rule);assert.equal(feeStyle.note,'-');
   await b.click('.pricing-course-fee-edit');assert.equal(await b.evaluate("document.querySelectorAll('.pricing-course-fee-input').length"),1);
   await b.evaluate("document.querySelector('.pricing-course-fee-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
   assert.equal(await b.evaluate("document.querySelectorAll('.pricing-course-fee-input').length"),0);
   await b.click('.pricing-course-fee-edit');await b.click('.course-details-table th');assert.equal(await b.evaluate("document.querySelectorAll('.pricing-course-fee-input').length"),0);
   await b.click('.dialog-close');
  }
  await b.evaluate("window.acceptedConfirm='';window.confirm=text=>{acceptedConfirm=text;return true};const input=document.querySelector('.student-pricing-field[data-field=custom_price]');input.value='140';saveStudentPricingField(input)");
  assert.match(await b.evaluate('acceptedConfirm'),/跨月份/);assert.equal(await b.evaluate('studentQueryRules[0].rule_fee'),140);
  await b.click('.student-query-detail-slot tbody .row-index');await b.waitFor("!!document.querySelector('.pricing-course-fee-edit')");assert.equal(await b.evaluate("document.querySelector('.pricing-course-rule-fee').textContent"),'¥140.00');
  await b.click('.pricing-course-fee-edit');await b.evaluate("document.querySelector('.pricing-course-fee-input').value='140'");await b.evaluate("document.querySelector('.pricing-course-fee-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");await b.waitFor("!!document.querySelector('.pricing-course-fee-edit:not(:disabled)')");
  assert.equal(await b.evaluate("document.querySelector('.pricing-course-fee').classList.contains('negative')"),false);assert.equal(await b.evaluate('state.student_statement.summary.total_fee'),140);
  await b.evaluate("applyStudentQuerySelection('李四')");assert.equal(await b.evaluate("document.querySelectorAll('.shared-course-dialog').length"),0);assert.equal(await b.evaluate('studentQueryRules[0].student_name'),'李四');
  await b.evaluate(`(async()=>{window.origRequest=request;request=async(p,o)=>{if(p.includes('student-pricing-query')&&p.includes(encodeURIComponent('张三')))await new Promise(r=>setTimeout(r,150));return origRequest(p,o)};await Promise.all([applyStudentQuerySelection('张三'),applyStudentQuerySelection('李四')]);request=origRequest})()`);
  assert.equal(await b.evaluate('studentQueryRules[0].student_name'),'李四');
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
 }finally{await b.close();chrome.child.kill();}
});

test('query-only page permission does not grant rule writes; batch scope and stale dialogs remain isolated',async()=>{
 const db=new DatabaseSync(databasePath);
 const hash=db.prepare("SELECT password_hash FROM users WHERE username='boss'").get().password_hash;
 db.prepare("INSERT INTO users(username,display_name,role,teacher_name,password_hash,status,permission_override_enabled) VALUES('query-only','只查学生','academic','',?,'active',1)").run(hash);
 db.exec("INSERT INTO user_page_permissions(user_id,permission_key,enabled) SELECT id,'studentQuery',1 FROM users WHERE username='query-only'");db.close();
 const cookie=await login('query-only');
 const query=await api('/api/student-pricing-query?'+scope(),{cookie});assert.equal(query.response.status,200);assert.equal(query.payload.can_edit_rule,false);
 assert.equal((await api('/api/student-pricing/'+ruleId+'?'+scope(),{cookie,method:'PATCH',body:{custom_price:999}})).response.status,403);
 assert.equal((await api('/api/student-pricing/batch?'+scope(),{cookie,method:'PATCH',body:{ids:[ruleId],price:999}})).response.status,403);
 const actual=(await detailApi()).lessons.map(row=>row.unit_price);
 const result=await api('/api/student-pricing/batch?'+scope(),{method:'PATCH',body:{ids:[ruleId],price:141}});assert.equal(result.response.status,200);assert.equal(result.payload.success,1);
 assert.deepEqual((await detailApi()).lessons.map(row=>row.unit_price),actual);assert.equal((await detailApi()).lessons[0].rule_fee,141);
 const chrome=await launchChrome(path.join(tempRoot,'query-permission-chrome')),b=chrome.session;
 try {
  await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await b.waitFor("!!document.querySelector('.login-panel')");await b.evaluate("document.querySelector('.login-username').value='query-only';document.querySelector('.login-password').value='123456';document.querySelector('.login-submit').click()");await b.waitFor("auth.user?.username==='query-only' && !document.querySelector('.login-panel')");
  await b.evaluate("setActiveView('studentQuery');selectedStudent='张三';studentQueryRange={mode:'range',start:'2026-09-01',end:'2026-09-02'};load({refreshGlobal:false})");
  assert.ok(await b.evaluate("[...document.querySelectorAll('.student-pricing-field')].every(n=>n.disabled)"));
  assert.equal(await b.evaluate("document.querySelectorAll('.open-student-pricing-batch-modal').length"),0);
  await b.evaluate(`(async()=>{window.origRequest=request;request=async(p,o)=>{if(p.includes('/courses'))await new Promise(r=>setTimeout(r,150));return origRequest(p,o)};document.querySelector('.student-pricing-rule-row .row-index').click();await applyStudentQuerySelection('李四');await new Promise(r=>setTimeout(r,250));request=origRequest})()`);
  assert.equal(await b.evaluate("document.querySelectorAll('.shared-course-dialog').length"),0);
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
 }finally{await b.close();chrome.child.kill();}
});


test('retired pricing entry redirects without granting query access; query rules have no bulk controls', async()=>{
 assert.equal((await api('/api/student-pricing-page')).response.status,410);
 const cookie=await login('salary-readonly');
 assert.equal((await api('/api/student-statement?student='+encodeURIComponent('张三'),{cookie})).response.status,403);
 const chrome=await launchChrome(path.join(tempRoot,'retired-pricing-chrome')),b=chrome.session;
 try {
  await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await b.login('boss','123456');
  await b.evaluate("setActiveView('studentPricing');studentQueryRange={mode:'range',start:'2026-09-01',end:'2026-09-30'};selectedStudent='张三';load({refreshGlobal:false})");
  assert.equal(await b.evaluate('view'),'studentQuery');
  assert.equal(await b.evaluate("document.querySelectorAll('[data-view=studentPricing],.student-query-price-filter,.student-pricing-select-row,.student-pricing-select-all,.open-student-pricing-batch-modal').length"),0);
  assert.equal(await b.evaluate("typeof renderStudentPricing"),'undefined');
  const layout=await b.evaluate("(()=>{const td=document.querySelector('.student-set-cell'),t=td.closest('table');return {align:getComputedStyle(td).textAlign,head:getComputedStyle(t.tHead.rows[0].cells[td.cellIndex]).textAlign,wrap:getComputedStyle(td.firstElementChild).flexWrap,justify:getComputedStyle(td.firstElementChild).justifyContent,cols:t.tHead.rows[0].cells.length}})()");
  assert.deepEqual(layout,{align:'left',head:'center',wrap:'nowrap',justify:'flex-start',cols:11});
  assert.equal(b.responses.some(r=>r.url.includes('/api/student-pricing-page')),false);
  const legacy=(await api('/api/auth/me',{cookie})).payload;
  assert.notEqual(legacy.user?.first_accessible_view,'studentPricing');
  assert.deepEqual(b.exceptions,[]);
 }finally{await b.close();chrome.child.kill();}
});

test('monochrome palette preserves semantic colors and screenshot preference across five viewports',async()=>{
 const chrome=await launchChrome(path.join(tempRoot,'monochrome-chrome')),b=chrome.session;
 try {
  await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await b.login('boss','123456');
  await b.evaluate("themeMode='light';paletteMode='black-white';applyTheme();applyPalette();shotFollowPalette=false;applyShotPalettePreference()");
  const fixed=await b.evaluate('courseNoticeShotPalette()');
  if(process.env.QUERY_THEME_SCREENSHOTS) {
   const output=path.resolve(process.env.QUERY_THEME_SCREENSHOTS);fs.mkdirSync(output,{recursive:true});
   await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
   await b.evaluate("setActiveView('studentQuery');studentQueryRange={mode:'range',start:'2026-09-01',end:'2026-09-30'};selectedStudent='张三';load({refreshGlobal:false})");
   await b.evaluate('new Promise(requestAnimationFrame)');
   fs.writeFileSync(path.join(output,'query-theme-after.png'),Buffer.from((await b.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
   const baseline=spawnSync('git',['show','b3fb535:public/styles.css'],{cwd:root,encoding:'utf8',maxBuffer:2e6});assert.equal(baseline.status,0);
   await b.evaluate(`(()=>{window.originalStyle=document.querySelector('link[rel=stylesheet]');originalStyle.disabled=true;window.baselineStyle=document.createElement('style');baselineStyle.textContent=${JSON.stringify(baseline.stdout)};document.head.append(baselineStyle)})()`);
   await b.evaluate('new Promise(requestAnimationFrame)');
   fs.writeFileSync(path.join(output,'query-theme-before.png'),Buffer.from((await b.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
   await b.evaluate('baselineStyle.remove();originalStyle.disabled=false');
  }

  for(const width of [1920,1440,1280,1024,390]) {
   await b.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
   for(const page of ['dashboard','lessons','studentQuery','summary','recharges','teacherSalary','teacherDetail','audit','appearance']) {
    await b.evaluate(`setActiveView('${page}');load({refreshGlobal:false})`);
    const colors=await b.evaluate("(()=>{const s=getComputedStyle(document.documentElement);return {bg:s.getPropertyValue('--bg').trim(),ink:s.getPropertyValue('--ink').trim(),success:s.getPropertyValue('--success').trim(),warning:s.getPropertyValue('--warning').trim(),danger:s.getPropertyValue('--danger').trim(),overflow:document.documentElement.scrollWidth>innerWidth}})()");
    assert.equal(colors.bg,'#ffffff');assert.equal(colors.ink,'#000000');assert.notEqual(colors.success,colors.warning);assert.notEqual(colors.warning,colors.danger);assert.equal(colors.overflow,false,`${page} ${width}`);
   }
  }
  const themePerformance=await b.evaluate("(async()=>{const node=contentEl.firstElementChild,start=performance.now();paletteMode='liming-blue';applyPalette();paletteMode='black-white';applyPalette();await new Promise(requestAnimationFrame);return {switch_ms:performance.now()-start,sameContent:node===contentEl.firstElementChild}})()");
  assert.equal(themePerformance.sameContent,true);assert.ok(themePerformance.switch_ms<500);
  const contrast=await b.evaluate("(()=>{const rgb=hex=>hex.replace('#','').match(/../g).map(c=>parseInt(c,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);const l=hex=>rgb(hex).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);const s=getComputedStyle(document.documentElement),ratio=(a,b)=>(Math.max(l(a),l(b))+.05)/(Math.min(l(a),l(b))+.05);return {body:ratio(s.getPropertyValue('--ink').trim(),s.getPropertyValue('--bg').trim()),secondary:ratio(s.getPropertyValue('--muted').trim(),s.getPropertyValue('--panel').trim()),button:ratio(s.getPropertyValue('--brand').trim(),s.getPropertyValue('--primary-ink').trim())}})()");
  assert.ok(Object.values(contrast).every(value=>value>=4.5),JSON.stringify(contrast));
  console.log('[query-monochrome-browser]',JSON.stringify({themePerformance,contrast,viewports:[1920,1440,1280,1024,390]}));
  await b.send('Page.reload');await b.waitFor("!!document.querySelector('.nav-btn')");
  assert.equal(await b.evaluate('paletteMode'),'black-white');assert.equal(await b.evaluate('themeMode'),'light');
  await b.evaluate("paletteMode='liming-blue';applyPalette()");assert.deepEqual(await b.evaluate('courseNoticeShotPalette()'),fixed);
  await b.evaluate("paletteMode='black-white';applyPalette();shotFollowPalette=true;applyShotPalettePreference()");assert.notDeepEqual(await b.evaluate('courseNoticeShotPalette()'),fixed);
  await b.evaluate("themeMode='dark';applyTheme()");assert.equal(await b.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()"),'#000000');
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
 }finally{await b.close();chrome.child.kill();}
});


test('pricing-only historical login gets a safe no-access page and keeps original write restrictions',async()=>{
 const chrome=await launchChrome(path.join(tempRoot,'legacy-entry-chrome')),b=chrome.session;
 try {
  await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});
  await b.waitFor("!!document.querySelector('.login-panel')");
  await b.evaluate("localStorage.setItem('liming:view','studentPricing');document.querySelector('.login-username').value='salary-readonly';document.querySelector('.login-password').value='123456';document.querySelector('.login-submit').click()");
  await b.waitFor("document.body.textContent.includes('暂无可访问页面')");
  assert.equal(await b.evaluate("canView('studentQuery')"),false);
  assert.equal(await b.evaluate("document.querySelectorAll('.student-pricing-table,[data-view=studentPricing]').length"),0);
  await b.evaluate("setActiveView('studentPricing');render()");
  assert.equal(await b.evaluate("document.body.textContent.includes('暂无可访问页面')"),true);
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
 }finally{await b.close();chrome.child.kill();}
});
