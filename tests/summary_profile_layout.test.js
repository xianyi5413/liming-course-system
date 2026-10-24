const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");
const root = path.resolve(__dirname, "..");
const vm = require('node:vm');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const totalsCode = appSource.slice(appSource.indexOf('function summaryCardTotals('), appSource.indexOf('function renderSummaryCards('));
const totals = vm.runInNewContext(totalsCode + ';summaryCardTotals', { numberValue: value => Number(value || 0) });

test('summary totals preserve cents, negatives, separate gifts, empty results and large populations', () => {
  const rows = Array.from({length: 10000}, () => ({total_fee: 0.1, prev_actual: -0.2, prev_gift: 0.3, cur_recharge: -1.01, cur_gift: 2.02, actual_balance: 999999.99, gift_balance: -0.01}));
  assert.deepEqual({...totals(rows)}, {total_fee:1000,prev_actual:-2000,prev_gift:3000,cur_recharge:-10100,cur_gift:20200,actual_balance:9999999900,gift_balance:-100});
  assert.ok(Object.values(totals([])).every(value => value === 0));
  assert.deepEqual(totals(rows.toReversed()), totals(rows));
});
let tempRoot;
let databasePath;
let port;
let server;
let ownerCookie;
test('teacher course existence is live across months/statuses and preserves identity and historical records', async () => {
  const created = await api('/api/teachers', {method:'POST',body:{name:'无课合成教师',phone:'123',status:'在职'}});
  assert.equal(created.response.status,201);
  const list = async () => (await api('/api/teachers')).payload.teachers;
  const teacher = (await list()).find(row => row.name === '无课合成教师');
  assert.equal(teacher.has_courses,0);
  const historyDb = new DatabaseSync(databasePath);
  const salaryId = historyDb.prepare("INSERT INTO salary_tables(name,teacher_id,effective_start,effective_end) VALUES('历史薪资',?,'2020-01-01','2020-12-31')").run(teacher.id).lastInsertRowid;
  historyDb.prepare("INSERT INTO salary_table_rules(salary_table_id,grade,course_type,formula) VALUES(?,'高一','1V1','100')").run(salaryId);
  historyDb.prepare("INSERT INTO teacher_monthly_performance(teacher_name,month_key,coefficient) VALUES(?,'2020-01-01',0.8)").run(teacher.name);
  historyDb.prepare("INSERT INTO users(username,display_name,role,teacher_name,password_hash,status) SELECT 'history-teacher','历史教师','teacher',?,password_hash,'active' FROM users WHERE username='boss'").run(teacher.name);
  const history = db => Object.fromEntries(['salary_tables','salary_table_rules','teacher_monthly_performance','users'].map(table => [table,db.prepare(`SELECT * FROM ${table}`).all()]));
  const savedHistory = history(historyDb);
  historyDb.close();
  const make = async (date,status) => {
    const result = await api('/api/lessons',{method:'POST',body:{teacher_name:teacher.name,date,time_slot:'15:00-17:00',classroom:'测试',grade:'高一',subject:'数学',student_names:'合成学生',status}});
    assert.equal(result.response.status,201,JSON.stringify(result.payload));return result.payload.id;
  };
  const one = await make('2031-01-01','待上'), two = await make('2031-01-02','请假');
  assert.equal((await list()).find(row => row.id === teacher.id).has_courses,1);
  await api('/api/lessons/'+one,{method:'DELETE'});
  assert.equal((await list()).find(row => row.id === teacher.id).has_courses,1);
  await api('/api/lessons/batch-delete',{method:'POST',body:{ids:[two]}});
  assert.equal((await list()).find(row => row.id === teacher.id).has_courses,0);
  assert.equal((await list()).find(row => row.id === teacher.id).phone,'123');
  const three = await make('2031-01-03','待上');
  await api('/api/lessons/'+three,{method:'PATCH',body:{teacher_name:'其他教师'}});
  assert.equal((await list()).find(row => row.id === teacher.id).has_courses,0);
  assert.equal((await list()).find(row => row.name === '其他教师').has_courses,1);
  const db = new DatabaseSync(databasePath);
  assert.deepEqual(history(db),savedHistory);
  assert.throws(() => db.prepare('INSERT INTO teachers(name) VALUES(?)').run(teacher.name),/UNIQUE/);
  const before = db.prepare('SELECT * FROM teachers ORDER BY id').all();
  const {buildFullDataBuffer,restoreFullData}=require('../src/excel/full_backup');
  const file=path.join(tempRoot,'teachers.xlsx'), target=path.join(tempRoot,'teachers.sqlite');
  fs.writeFileSync(file,buildFullDataBuffer(db).buffer); fs.copyFileSync(databasePath,target);
  restoreFullData({dbPath:target,inputPath:file});
  const restored=new DatabaseSync(target);
  assert.deepEqual(restored.prepare('SELECT * FROM teachers ORDER BY id').all(),before);
  assert.deepEqual(history(restored),savedHistory);
  restored.close();db.close();
  assert.ok(await login('history-teacher'));
});

test('Chromium summary filters, card precision, themes and shared matrix date layout at five widths', async () => {
  const chrome=await launchChrome(path.join(tempRoot,'layout-chrome')), b=chrome.session;
  try {
    await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await b.login('boss','123456');
    const lifecycle=await b.evaluate(`(async()=>{const name='浏览器教师';await request('/api/teachers',{method:'POST',body:{name,status:'在职'}});setActiveView('teacherProfiles');await load({refreshGlobal:false});const absent=!profileRows('teachers').some(row=>row.name===name);const candidate=state.profile_teachers.find(row=>row.name===name);const lesson=await request('/api/lessons',{method:'POST',body:{teacher_name:name,date:'2032-01-01',time_slot:'09:00-11:00',classroom:'测试',grade:'高一',subject:'数学',student_names:'合成学生',status:'待上'}});await load({refreshGlobal:false});const present=profileRows('teachers').some(row=>row.id===candidate.id);await request('/api/lessons/'+lesson.id,{method:'DELETE'});await load({refreshGlobal:false});return {absent,present,hidden:!profileRows('teachers').some(row=>row.id===candidate.id),retained:state.profile_teachers.some(row=>row.id===candidate.id)}})()`);
    assert.deepEqual(lifecycle,{absent:true,present:true,hidden:true,retained:true});
    await b.evaluate(`(async()=>{setActiveView('summary');activeMonth='2026-09-01';await load({refreshGlobal:false});window.originalLayoutRequest=request;request=async(...args)=>{const result=await originalLayoutRequest(...args);if(args[0].startsWith('/api/bootstrap')&&args[0].includes('2026-08'))await new Promise(resolve=>window.releaseOldMonth=resolve);return result};activeMonth='2026-08-01';window.oldMonthLoad=load({refreshGlobal:false,refreshBootstrap:true})})()`);
    await b.waitFor("typeof releaseOldMonth==='function'");
    const race=await b.evaluate(`(async()=>{activeMonth='2026-09-01';await load({refreshGlobal:false,refreshBootstrap:true});const before=JSON.stringify(state.derived.student_summary);releaseOldMonth();await oldMonthLoad;request=originalLayoutRequest;return before===JSON.stringify(state.derived.student_summary)&&state.active_month_key==='2026-09-01'})()`);
    assert.equal(race,true);
    await b.evaluate(`window.summaryFixture=[{student_name:'甲',grade:'高一',total_fee:0.1,prev_actual:-12.34,prev_gift:2.01,cur_recharge:-3.01,cur_gift:4.02,actual_balance:-5.03,gift_balance:6.04},{student_name:'乙',grade:'高二',total_fee:0.2,prev_actual:1,prev_gift:3,cur_recharge:4,cur_gift:5,actual_balance:0,gift_balance:0}];setActiveView('summary');state.derived.student_summary=summaryFixture;summaryFilter={};renderSummary()`);
    for(const filter of [{},{student:'甲'},{grade:'高二'},{balance:'actual'},{balance:'gift'},{balance:'zero'},{grade:'高一',balance:'actual'},{student:'不存在'},{}]) {
      const result=await b.evaluate(`(()=>{summaryFilter=${JSON.stringify(filter)};renderSummary();const rows=summaryRows().filter(row=>summaryMatchesFilter(row));return {cards:document.querySelectorAll('.student-summary-metrics .metric').length,valid:[...document.querySelectorAll('[data-summary-amount]')].every(el=>el.textContent===formatMoney(rows.reduce((sum,row)=>sum+Math.round(numberValue(row[el.dataset.summaryAmount])*100),0)/100)),count:document.querySelectorAll('.summary-master-row').length,expected:rows.length}})()`);
      assert.equal(result.cards,4);assert.equal(result.valid,true);assert.equal(result.count,result.expected);
    }
    for(const width of [1920,1440,1280,1024,390]) {
      await b.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
      for(const theme of ['light','dark']) {
        await b.evaluate(`themeMode='${theme}';applyTheme();renderSummary()`);
        assert.equal(await b.evaluate("[...document.querySelectorAll('.student-summary-metrics .metric')].every(el=>el.scrollWidth<=el.clientWidth+1)"),true);
      }
      for(const mode of ['time','teacher','classroom']) {
        await b.evaluate(`setActiveView('weekMatrix');matrixView='${mode}';renderWeekMatrix()`);
        const box=await b.evaluate("(()=>{const field=document.querySelector('.matrix-range-field'),label=field.firstElementChild,picker=field.lastElementChild;return {gap:picker.getBoundingClientRect().top-label.getBoundingClientRect().bottom,overflow:field.scrollWidth>field.clientWidth+1,fw:field.clientWidth,sw:field.scrollWidth,pw:picker.getBoundingClientRect().width}})()");
        assert.ok(box.gap>=0&&box.gap<15,JSON.stringify(box));assert.equal(box.overflow,false,JSON.stringify({width,mode,...box}));
      }
      await b.evaluate("setActiveView('summary');state.derived.student_summary=summaryFixture;renderSummary()");
    }
    await b.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    for (const mode of ['time','teacher','classroom']) {
      await b.evaluate(`setActiveView('weekMatrix');matrixView='${mode}';renderWeekMatrix();bindDateRangePickerControls();document.body.style.zoom='1.25'`);
      assert.equal(await b.evaluate("(()=>{const field=document.querySelector('.matrix-range-field');return field.scrollWidth<=field.clientWidth+1&&field.lastElementChild.getBoundingClientRect().top-field.firstElementChild.getBoundingClientRect().bottom<20})()"),true);
      await b.click('[data-range-scope="matrix"] .date-range-trigger');
      await b.waitFor("document.querySelector('.date-range-picker-panel:not([hidden])')");
      await b.click('[data-range-preset="today"]');
      await b.waitFor("matrixRange.start===todayDate()&&matrixRange.end===todayDate()&&!activeDateRangePicker");
      await b.evaluate("clearDateRangePickerValue(document.querySelector('[data-range-scope=matrix]'))");
      assert.equal(await b.evaluate("matrixRange.start===currentMatrixRange(state.settings.month_key||activeMonth).start"),true);
    }
    await b.evaluate("document.body.style.zoom=''");
    assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
  } finally {await b.close();chrome.child.kill();}
});
async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("summary/profile test server did not start");
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
  db.exec(`INSERT INTO role_filter_presets(role_code,view_key,filter_key,filter_value_json) VALUES('academic','lessons','teacher_names','["合成教师"]');`);
}
before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-summary-profile-"));
  databasePath = path.join(tempRoot, "summary-profile.sqlite");
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
