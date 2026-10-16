const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");
const root = path.resolve(__dirname, "..");

test('immediate fee editor deduplicates Enter/blur, cancels closing drafts and isolates delayed row responses',async()=>{
  const chrome=await launchChrome(path.join(tempRoot,'immediate-fee-chrome')),b=chrome.session;
  try {
    await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
    await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await b.login('boss','123456');
    await b.evaluate(`window.originalRequest=request;window.feeCalls=[];window.feePending=[];
      request=(path,options)=>path==='/api/fee-overrides'?new Promise((resolve,reject)=>{feeCalls.push(options.body);feePending.push({resolve,reject})}):originalRequest(path,options);
      window.openSyntheticFees=()=>showStudentPricingCourses({student_name:'合成学生',grade:'高一',subject:'数学'},{student_name:'合成学生',can_edit_fee:true,lessons:[{id:1,unit_price:100,rule_fee:100},{id:2,unit_price:200,rule_fee:200}]});openSyntheticFees();`);
    const open=id=>b.click(`.pricing-course-fee[data-lesson-id="${id}"] .pricing-course-fee-edit`);
    const key=key=>b.evaluate(`document.querySelector('.pricing-course-fee-input').dispatchEvent(new KeyboardEvent('keydown',{key:'${key}',bubbles:true}))`);
    await open(1);assert.equal(await b.evaluate("document.querySelectorAll('.pricing-course-fee-save,.pricing-course-fee-cancel').length"),0);
    await key('Enter');assert.equal(await b.evaluate('feeCalls.length'),0);
    await open(1);await b.evaluate("document.querySelector('.pricing-course-fee-input').value='99'");await key('Escape');assert.equal(await b.evaluate('feeCalls.length'),0);
    await open(1);await b.evaluate("document.querySelector('.pricing-course-fee-input').value='10000.01';document.querySelector('.pricing-course-fee-input').blur()");
    await b.waitFor("!document.querySelector('.pricing-course-fee-input')");assert.equal(await b.evaluate('feeCalls.length'),0);
    await open(1);await b.evaluate("document.querySelector('.pricing-course-fee-input').value='0';const input=document.querySelector('.pricing-course-fee-input');input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));input.blur()");
    assert.equal(await b.evaluate('feeCalls.length'),1);
    await open(2);await b.evaluate("document.querySelector('.pricing-course-fee-input').value='180';document.querySelector('.pricing-course-fee-input').blur()");
    await b.waitFor('feeCalls.length===2');assert.deepEqual(await b.evaluate('feeCalls.map(x=>[x.lesson_id,x.student_name,x.unit_price])'),[[1,'合成学生','0'],[2,'合成学生','180']]);
    await b.evaluate('feePending[1].resolve({unit_price:180})');await b.waitFor("document.querySelector('[data-lesson-id=\"2\"] button')?.disabled===false");
    await b.evaluate('feePending[0].reject(new Error("合成网络失败"))');await b.waitFor("document.querySelector('[data-lesson-id=\"1\"] button')?.disabled===false");
    assert.equal(await b.evaluate("document.querySelector('[data-lesson-id=\"1\"]').textContent"),'¥100.00');
    assert.equal(await b.evaluate("document.querySelector('[data-lesson-id=\"2\"]').textContent"),'¥180.00');
    await open(2);await b.evaluate("document.querySelector('.pricing-course-fee-input').value='199'");
    // Native pointer sequence verifies cancellation happens before the close button steals focus.
    const point=await b.evaluate("(()=>{const r=document.querySelector('.shared-course-dialog .dialog-close').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await b.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    await b.waitFor("!document.querySelector('.shared-course-dialog')");assert.equal(await b.evaluate('feeCalls.length'),2);
    await b.evaluate('openSyntheticFees()');await open(1);await b.evaluate("document.querySelector('.pricing-course-fee-input').value='50'");await key('Enter');
    await b.click('.dialog-close');await b.evaluate('openSyntheticFees();feePending[2].resolve({unit_price:50})');
    await b.waitFor("document.querySelector('[data-lesson-id=\"1\"] button')?.disabled===false");
    assert.equal(await b.evaluate("document.querySelector('[data-lesson-id=\"1\"]').textContent"),'¥100.00');
    await b.evaluate('request=originalRequest;closeStudentPricingCourses()');
    assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
  }finally{await b.close();chrome.child.kill();}
});
let tempRoot;
let databasePath;
let port;
let server;
let ownerCookie;
let teacherCookie;
let academicCookie;
async function summary() {
  const result = await api('/api/bootstrap?month=2026-09-01');
  assert.equal(result.response.status, 200);
  return result.payload.derived.teacher_summary.find(row => row.teacher_name === '合成教师');
}

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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-fee-reconciliation-"));
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
const detail = async () => (await api(`/api/student-pricing/${ruleId}/courses`)).payload;
const save = (amount, cookie = ownerCookie) => api('/api/fee-overrides', {method:'POST',cookie,body:{lesson_id:9001,student_name:'张三',unit_price:amount}});

test('reconciliation uses custom comparison targets without applying them to actual fees, zero and unmatched standards', async () => {
  const db=new DatabaseSync(databasePath);
  try {
    standardId=db.prepare("SELECT id FROM pricing_standards WHERE grade='高一' AND student_count=2").get().id;
  }finally{db.close();}
  assert.equal((await api('/api/pricing-standards/'+standardId,{method:'PATCH',body:{unit_price:160}})).response.status,200);
  const rules=(await api('/api/student-pricing-page?month=2026-10-01')).payload.rules;
  ruleId=rules.find(row=>row.student_name==='张三').id;
  assert.equal((await api('/api/student-pricing/'+ruleId,{method:'PATCH',body:{custom_price:240}})).payload.total_lessons,2);
  const beforeOther=(await api('/api/bootstrap?month=2026-09-01')).payload.derived.fee_details.find(row=>row.lesson_id===9001&&row.student_name==='李四').unit_price;
  for(const amount of [160,150,180,0,160.01]) {
    assert.equal((await save(amount)).response.status,200);
    const row=(await detail()).lessons.find(row=>row.id===9001);
    assert.equal(row.unit_price,amount);assert.equal(row.rule_fee,240);
  }
  assert.equal((await save(20,teacherCookie)).response.status,403);
  assert.equal((await api('/api/student-pricing/'+ruleId+'/courses',{cookie:teacherCookie})).payload.can_edit_fee,false);
  assert.equal((await save(20,academicCookie)).response.status,403);
  await api('/api/student-pricing/'+ruleId,{method:'PATCH',body:{custom_price:0}});
  await api('/api/pricing-standards/'+standardId,{method:'PATCH',body:{unit_price:0}});await save(0);
  assert.equal((await detail()).lessons[0].rule_fee,0);
  const editing=new DatabaseSync(databasePath);
  const standard=editing.prepare('SELECT * FROM pricing_standards WHERE id=?').get(standardId);
  try {
    editing.prepare('DELETE FROM pricing_standards WHERE id=?').run(standardId);
    const missing=(await detail()).lessons[0];assert.equal(missing.rule_fee,null);assert.equal(missing.unit_price,0);
  }finally{
    editing.prepare('INSERT INTO pricing_standards(id,grade,student_count,unit_price,description) VALUES(?,?,?,?,?)').run(standard.id,standard.grade,standard.student_count,160,standard.description);editing.close();
  }
  await api('/api/student-pricing/'+ruleId,{method:'PATCH',body:{custom_price:240}});
  const boot=(await api('/api/bootstrap?month=2026-09-01')).payload;
  assert.equal(boot.derived.fee_details.find(row=>row.lesson_id===9001&&row.student_name==='李四').unit_price,beforeOther);
  assert.equal((await api('/api/student-pricing-page?month=2026-10-01')).payload.rules.find(row=>row.id===ruleId).custom_price,240);
});

test('zero completed courses never enter selectors or batch writes, while old rules reactivate unchanged', async()=>{
  const page=async()=> (await api('/api/student-pricing-page?month=2026-10-01')).payload;
  for(const id of [9001,9002]) await api('/api/lessons/'+id,{method:'PATCH',body:{status:id===9001?'待上':'请假'}});
  assert.equal((await page()).rules.length,0);
  assert.deepEqual((await page()).filters.students,[]);
  const rejected=await api('/api/student-pricing/batch',{method:'PATCH',body:{ids:[ruleId],price:999}});
  assert.equal(rejected.response.status,409);assert.equal(rejected.payload.success,0);
  await api('/api/lessons/9001',{method:'PATCH',body:{status:'已上'}});
  const restored=(await page()).rules.find(row=>row.id===ruleId);
  assert.equal(restored.total_lessons,1);assert.equal(restored.current_month_lessons,0);assert.equal(restored.custom_price,240);
  await api('/api/lessons/9002',{method:'PATCH',body:{status:'已上'}});
});

test('retired fee endpoint and permission tree expose no page, but shared charges and financial restoration remain',async()=>{
  assert.equal((await api('/api/fee-details-page')).response.status,404);
  const auth=(await api('/api/auth/me')).payload;
  assert.equal(JSON.stringify(auth.permission_tree).includes('feeDetails'),false);
  const db=new DatabaseSync(databasePath);
  try {
    const {buildFullDataBuffer,restoreFullData}=require('../src/excel/full_backup');
    const file=path.join(tempRoot,'finance.xlsx'),target=path.join(tempRoot,'restored.sqlite');
    fs.writeFileSync(file,buildFullDataBuffer(db).buffer);fs.copyFileSync(databasePath,target);
    restoreFullData({dbPath:target,inputPath:file});
    const restored=new DatabaseSync(target);
    try {for(const table of ['fee_overrides','student_pricing','recharge_records','student_opening_balances']) assert.deepEqual(restored.prepare(`SELECT * FROM ${table}`).all(),db.prepare(`SELECT * FROM ${table}`).all());}finally{restored.close();}
  }finally{db.close();}
});

test('Chromium five widths compares amounts, saves locally, rolls back and redirects the retired page',async()=>{
  await save(160);
  const chrome=await launchChrome(path.join(tempRoot,'reconciliation-chrome')),browser=chrome.session;
  try {
    await browser.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await browser.login('boss','123456');
    await browser.evaluate("setActiveView('studentPricing');load({refreshGlobal:false})");
    await browser.waitFor("!!document.querySelector('.student-pricing-rule-row')");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.student-pricing-table th')].some(node=>node.textContent==='价格状态')"),false);
    assert.equal(await browser.evaluate("document.querySelectorAll('[data-view=feeDetails]').length"),0);
    await browser.evaluate(`document.querySelector('.student-pricing-rule-row[data-rule-id="${ruleId}"]').click()`);
    await browser.waitFor("!!document.querySelector('.pricing-course-fee')");
    const cell='.pricing-course-fee[data-lesson-id="9001"]';
    for(const width of [1920,1440,1280,1024,390]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
      await browser.evaluate('scheduleAdaptiveTableColumns()');
      for(const amount of [150,180,0,240,160.01]) {
        await browser.click(cell+' .pricing-course-fee-edit');
        await browser.evaluate(`document.querySelector('.pricing-course-fee-input').value='${amount}'`);
        await browser.evaluate("document.querySelector('.pricing-course-fee-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
        await browser.waitFor(`document.querySelector('${cell} .pricing-course-fee-edit')?.disabled===false&&document.querySelector('${cell} .pricing-course-fee-edit')?.textContent.includes('${amount.toFixed(2)}')`);
        assert.equal(await browser.evaluate(`document.querySelector('${cell}').classList.contains('negative')`),amount!==240);
        assert.equal(await browser.evaluate(`document.querySelector('${cell}').nextElementSibling.textContent`),'¥240.00');
      }
      assert.ok(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.course-details-table .student-set-badges')].every(node=>getComputedStyle(node).flexWrap==='nowrap')"));
      assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.course-details-table').closest('.table-wrap')).overflowX"),'auto');
      const style=await browser.evaluate(`(()=>{const node=document.querySelector('${cell}');return {align:getComputedStyle(node).textAlign,padding:parseFloat(getComputedStyle(node).paddingRight),color:getComputedStyle(node).color,button:getComputedStyle(node.querySelector('button')).color};})()`);
      assert.equal(style.align,'right');assert.ok(style.padding>=12);assert.equal(style.color,style.button);
    }
    const themeColors=[];
    for(const theme of ['light','dark']) {
      themeColors.push(await browser.evaluate(`(()=>{document.documentElement.dataset.theme='${theme}';const actual=document.querySelector('${cell}');return {actual:getComputedStyle(actual).color,rule:getComputedStyle(actual.nextElementSibling).color,button:getComputedStyle(actual.querySelector('button')).color};})()`));
    }
    assert.ok(themeColors.every(colors=>colors.actual!==colors.rule&&colors.actual===colors.button));
    assert.notEqual(themeColors[0].actual,themeColors[1].actual);
    await browser.evaluate("document.documentElement.dataset.theme='light'");
    await browser.evaluate("window.realRequest=request;request=(path,options)=>path==='/api/fee-overrides'?Promise.reject(new Error('合成保存失败')):realRequest(path,options)");
    await browser.click(cell+' .pricing-course-fee-edit');await browser.evaluate("document.querySelector('.pricing-course-fee-input').value='160'");await browser.evaluate("document.querySelector('.pricing-course-fee-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    await browser.waitFor(`!!document.querySelector('${cell} .pricing-course-fee-edit')`);
    assert.equal(await browser.evaluate(`document.querySelector('${cell}').classList.contains('negative')&&document.querySelector('${cell}').textContent.includes('160.01')`),true);
    await browser.evaluate('request=realRequest');await browser.click('.shared-course-dialog .dialog-close');
    for(const [actual,baseline,display] of [[0,0,'¥0.00'],[0,null,'—'],[0.1+0.2,0.3,'¥0.30']]) {
      await browser.evaluate(`showStudentPricingCourses({student_name:'精度学生',grade:'初一',subject:'数学'},{student_name:'精度学生',can_edit_fee:false,lessons:[{id:1,unit_price:${actual},rule_fee:${baseline},student_names:'精度学生'}]})`);
      assert.equal(await browser.evaluate("document.querySelector('.pricing-course-fee').classList.contains('negative')"),false);
      assert.equal(await browser.evaluate("document.querySelector('.pricing-course-rule-fee').textContent"),display);
      assert.equal(await browser.evaluate("document.querySelectorAll('.pricing-course-fee-edit').length"),0);
      await browser.click('.shared-course-dialog .dialog-close');
    }
    await browser.evaluate("setActiveView('feeDetails');load({refreshGlobal:false})");await browser.waitFor("!!document.querySelector('.student-summary-table')");
    await browser.evaluate("localStorage.setItem('liming:view','feeDetails')");
    await browser.send('Page.reload');await browser.waitFor("!!document.querySelector('.student-summary-table')");
    await browser.evaluate("dashboardGoTo('studentPricing',{price:'unset'})");
    await browser.waitFor("document.querySelectorAll('.student-pricing-rule-row').length===1");
    assert.equal(await browser.evaluate("studentPricingFilter.price==='unset'&&studentPricingVisibleRows.every(row=>row.custom_price===0&&row.total_lessons>0)"),true);
    await browser.evaluate("dashboardGoTo('feeDetails',{source:'pending'})");await browser.waitFor("!!document.querySelector('.student-summary-table')");
    assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.consoleErrors,[]);
  }finally{await browser.close();if(chrome.child.exitCode==null)chrome.child.kill();}
});
