const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { DatabaseSync, backup } = require('node:sqlite');
const { freePort, launchBrowser } = require('./helpers/chrome_cdp');
const TG = require('../src/domain/tuoguan'), Excel = require('../src/excel/full_backup');
const root = path.resolve(__dirname, '..');
let dir, env, port, server, cookie;
const artifacts = process.env.TEST_ARTIFACT_DIR;
async function api(route, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(`http://127.0.0.1:${port}/api/${route}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
}
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-metrics-'));
  port = await freePort();
  env = { ...process.env, DATA_DIR: dir, DB_PATH: path.join(dir, 'fixture.sqlite'), PORT: String(port), HOST: '127.0.0.1', SESSION_COOKIE_SECURE: 'false' };
  const init = spawnSync(process.execPath, ['src/server.js', '--init-db'], { cwd: root, env, encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr);
  const db = new DatabaseSync(env.DB_PATH);
  db.exec(`UPDATE settings SET value='2026-09-01' WHERE key='month_key';
    INSERT OR REPLACE INTO settings(key,value) VALUES('custom_course_statuses','["未缴费","调课"]');
    INSERT INTO students(name,grade,status) VALUES('合成财务甲','初一','在读'),('合成财务乙','初二','在读');
    INSERT INTO teachers(name,status) VALUES('合成教师','在职');
    INSERT INTO lessons(id,teacher_name,date,month_key,time_slot,grade,subject,student_names,status,lesson_status,course_status,teacher_salary,teacher_salary_source) VALUES
      (1,'合成教师','2026-09-01','2026-09-01','08:00-10:00','初一','数学','合成财务甲','未缴费','上课（未缴费）','已上',77,'auto'),
      (2,'合成教师','2026-09-02','2026-09-01','08:00-10:00','初一','数学','合成财务甲','已上','上课','已上',88,'manual'),
      (3,'合成教师','2026-09-03','2026-09-01','08:00-10:00','初二','数学','合成财务乙','待上','上课','未上',0,'empty');
    INSERT INTO fee_overrides(lesson_id,student_name,unit_price) VALUES(1,'合成财务甲',120),(2,'合成财务甲',150);
    INSERT INTO recharge_records(student_name,grade,cur_recharge,cur_gift,recharge_date,source,channel,month_key) VALUES
      ('合成财务甲','初一',100,20,'2026-09-01','manual','wechat','2026-09-01'),
      ('合成财务乙','初二',200,0,'2026-09-02','manual','alipay','2026-09-01'),
      ('合成财务甲','初一',-10,-2,'2026-09-03','manual','cash','2026-09-01');`);
  const store = TG.createStore(db);
  const mutate = (action, body) => store.mutate(action, { ...body, request_id: require('node:crypto').randomUUID() }, '合成');
  for (const [name, grade] of [['合成托管甲', '初一'], ['合成托管乙', '初二']]) mutate('student', { name, grade, start_date: '2026-09-01' });
  mutate('money', { student_id: 1, date: '2026-09-01', kind: '充值', actual_amount: 10000, gift_amount: 2000, method: '微信' });
  mutate('money', { student_id: 2, date: '2026-09-02', kind: '充值', actual_amount: 20000, gift_amount: 0, method: '支付宝' });
  mutate('money', { student_id: 1, date: '2026-09-03', kind: '退款', actual_amount: 1000, gift_amount: 200, method: '现金' });
  db.close();
  server = spawn(process.execPath, ['src/server.js'], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'boss', password: '123456' }) });
  assert.equal(r.status, 200); cookie = r.headers.get('set-cookie').split(';')[0];
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
});
after(async () => { if (server?.exitCode == null) { const done = new Promise(r => server.once('exit', r)); server.kill(); await done; } });
const statement = () => api('student/' + encodeURIComponent('合成财务甲') + '/statement?start=2026-09-01&end=2026-09-30');
const finance = () => api('finance-summary?start=2026-09-01&end=2026-09-30');

test('reserved candidates and write paths preserve historical receivables, balances and salary', async () => {
  const boot = await api('bootstrap?month=2026-09-01');
  assert.deepEqual(boot.data.lookups.status, ['待上', '已上', '请假', '试课', '考试', '调课']);
  assert.equal(boot.data.used_lesson_lookups.statuses.includes('未缴费'), false);
  const db = new DatabaseSync(env.DB_PATH, { readOnly: true });
  const original = db.prepare('SELECT * FROM lessons WHERE id=1').get();
  const moneyBefore = (await statement()).data;
  const financeBefore = (await finance()).data;
  // Existing billing charges only 已上; preserve the legacy marker and its existing zero-price rule.
  assert.equal(financeBefore.balance_sheet.unpaid_lesson_receivable, 0);
  assert.equal(moneyBefore.summary.total_fee, 150);
  for (const body of [{ status: '未缴费' }, { status: '上课（未缴费）' }, { lesson_status: '上课（未缴费）' }]) {
    assert.equal((await api('lessons', { teacher_name: '合成教师', date: '2026-09-04', ...body })).status, 400);
    assert.equal((await api('lessons/3', body, 'PATCH')).status, 400);
  }
  assert.equal((await api('lessons/1', { status: '已上', date: original.date, notes: '仅改备注', allow_conflicts: true }, 'PATCH')).status, 200);
  const after = db.prepare('SELECT * FROM lessons WHERE id=1').get();
  for (const key of ['status', 'lesson_status', 'course_status', 'teacher_salary', 'teacher_salary_source']) assert.equal(after[key], original[key], key);
  assert.deepEqual((await statement()).data.summary, moneyBefore.summary);
  assert.deepEqual((await finance()).data.balance_sheet, financeBefore.balance_sheet);
  assert.deepEqual((await finance()).data.overview.teacher_cost, financeBefore.overview.teacher_cost);
  assert.equal(db.prepare('SELECT count(*) n FROM lessons').get().n, 3);
  assert.equal((await api('settings', { custom_course_statuses: '["未缴费","上课（未缴费）","调课"]' })).status, 400);
  assert.equal((await api('settings', { custom_course_statuses: '["未缴费","调课","复习"]' })).status, 200);
  assert.ok((await api('bootstrap')).data.lookups.status.includes('复习'));
  if (artifacts) { await backup(db, path.join(artifacts, 'synthetic-current.sqlite')); fs.writeFileSync(path.join(artifacts, 'financial-result.json'), JSON.stringify({ summary: moneyBefore.summary, balance_sheet: financeBefore.balance_sheet, teacher_cost: financeBefore.overview.teacher_cost }, null, 2)); }
  db.close();
});

test('Excel v14 preserves legacy raw status, money, custom config and permissions without duplicate custody charges', async () => {
  const file = path.join(dir, 'roundtrip.xlsx'), target = path.join(dir, 'restored.sqlite');
  Excel.exportFullData({ dbPath: env.DB_PATH, outputPath: file });
  assert.equal(Excel.verifyFullData(file).version, 14);
  const source = new DatabaseSync(env.DB_PATH); await backup(source, target);
  Excel.restoreFullData({ dbPath: target, inputPath: file });
  const restored = new DatabaseSync(target);
  for (const table of ['lessons', 'fee_overrides', 'students', 'recharge_records', 'student_opening_balances', 'tg_students', 'tg_attendance', 'tg_ledger', 'roles', 'role_permissions', 'users', 'user_page_permissions']) assert.deepEqual(restored.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all(), source.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all(), table);
  assert.deepEqual(restored.prepare("SELECT value FROM settings WHERE key='custom_course_statuses'").get(), source.prepare("SELECT value FROM settings WHERE key='custom_course_statuses'").get());
  const store = TG.createStore(restored), before = JSON.stringify(store.snapshot('2026-09', true)); TG.migrate(restored);
  assert.equal(JSON.stringify(store.snapshot('2026-09', true)), before);
  source.close(); restored.close();
});

async function page(t) {
  const browser = await launchBrowser(path.join(dir, 'edge-' + Date.now()), { browser: 'edge' }); t.after(() => browser.close());
  const c = browser.session, pos = cookie.indexOf('=');
  await c.send('Network.setCookie', { name: cookie.slice(0, pos), value: cookie.slice(pos + 1), url: `http://127.0.0.1:${port}/` });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await c.waitFor('Boolean(auth.user) && Boolean(state)'); return c;
}
async function screenshot(c, name) {
  if (!artifacts) return;
  await c.evaluate(`if(innerWidth<700)document.querySelector('.student-statement-metrics,.recharge-analysis-panel')?.scrollIntoView({block:'start'})`);
  fs.writeFileSync(path.join(artifacts, name + '.png'), Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
}

test('Edge both recharge panels share compact responsive styles and retain filtered statistics', async t => {
  const c = await page(t), results = [];
  const oldCss = execFileSync('git', ['show', '0a83c4917207b17a891fe04afee4facf4fa4a672:public/styles.css'], { cwd: root, encoding: 'utf8', maxBuffer: 4e6 });
  const geometry = () => c.evaluate(`(()=>{const p=document.querySelector('.recharge-analysis-panel'),cards=[...p.querySelectorAll('.recharge-analysis-grid .metric')];return {height:p.offsetHeight,heights:cards.map(e=>e.offsetHeight),styles:cards.map(e=>{const s=getComputedStyle(e);return [s.padding,s.minHeight,s.gap,getComputedStyle(e.querySelector('strong')).fontSize]}),values:cards.map(e=>e.querySelector('strong').textContent),overflow:[p,...p.querySelectorAll('.metric')].some(e=>e.scrollWidth>e.clientWidth+1)}})()`);
  for (const view of ['recharges', 'tgLedger']) {
    await c.evaluate(`(async()=>{setActiveView('${view}');await load({refreshGlobal:false})})()`);
    await c.waitFor('Boolean(document.querySelector(".recharge-analysis-panel"))');
    if (view === 'tgLedger') { await c.evaluate(`document.querySelector('#tg-month').value='2026-09';document.querySelector('#tg-month').dispatchEvent(new Event('change'))`); await c.waitFor(`document.querySelector('[data-loaded-month]')?.dataset.loadedMonth==='2026-09'`); }
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await c.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
      await c.evaluate(`document.documentElement.dataset.theme='${theme}'`);
      const g = await geometry();
      assert.equal(g.values.length, 6); assert.equal(g.overflow, false, JSON.stringify(g));
      assert.ok(Math.max(...g.heights) <= 78, JSON.stringify(g));
      if (width === 1440 && theme === 'light') {
        await c.evaluate(`(()=>{const s=document.createElement('style');s.id='previous-css';s.textContent=${JSON.stringify(oldCss)};document.head.append(s);document.querySelector('link[href^="/styles.css"]').disabled=true})()`);
        const old = await geometry();
        await c.evaluate(`document.querySelector('#previous-css').remove();document.querySelector('link[href^="/styles.css"]').disabled=false`);
        assert.ok(g.height < old.height * .8, JSON.stringify({ g, old })); results.push({ view, oldHeight: old.height, ...g });
      }
      await screenshot(c, `${view}-${width}-${theme}`);
    }
    if (view === 'recharges') {
      assert.deepEqual((await geometry()).values, ['¥290.00', '¥18.00', '¥308.00', '3', '2', '-¥12.00']);
      await c.evaluate(`rechargeGradeFilter='初一';renderRecharges();wireEvents()`);
      assert.deepEqual((await geometry()).values, ['¥90.00', '¥18.00', '¥108.00', '2', '1', '-¥12.00']);
    } else assert.deepEqual((await geometry()).values, ['¥300.00', '¥20.00', '¥308.00', '2', '2', '¥12.00']);
  }
  assert.deepEqual(results[0].styles, results[1].styles);
  if (artifacts) fs.writeFileSync(path.join(artifacts, 'recharge-layout.json'), JSON.stringify(results, null, 2));
  assert.deepEqual(c.exceptions, []); assert.deepEqual(c.consoleErrors, []);
});

test('Edge five query cards, partial refresh, negative pairs and parent PNG retain values and privacy', async t => {
  const c = await page(t);
  await c.evaluate(`(async()=>{setActiveView('studentQuery');await load({refreshGlobal:false});studentQueryRange={mode:'range',start:'2026-09-01',end:'2026-09-30'};await applyStudentQuerySelection('合成财务甲')})()`);
  await c.waitFor('document.querySelectorAll("[data-student-statement-metric]").length===5');
  const check = async () => assert.equal(await c.evaluate(`(()=>{const report=studentStatementReport(),cards=studentStatementMetricCards(report.summary);return cards.length===5&&[...document.querySelectorAll('[data-student-statement-metric]')].every((e,i)=>e.querySelector('.metric-label').textContent===cards[i].label&&e.querySelector('.metric-value').textContent===cards[i].value)})()`), true);
  await check();
  await c.evaluate(`window.metricNodes=[...document.querySelectorAll('[data-student-statement-metric]')];updateStudentQueryResultsOnly(studentStatementReport())`);
  assert.equal(await c.evaluate('metricNodes.every(e=>e.isConnected)'), true);
  await c.evaluate(`(async()=>{await request('/api/fee-overrides',{method:'POST',body:{lesson_id:2,student_name:'合成财务甲',unit_price:160}});await refreshStudentQueryMoney()})()`);
  await check();
  assert.equal(await c.evaluate('studentStatementReport().summary.total_fee'), 160);
  assert.equal(await c.evaluate('metricNodes.every(e=>e.isConnected)'), true);
  await c.evaluate(`(async()=>{await request('/api/fee-overrides',{method:'POST',body:{lesson_id:2,student_name:'合成财务甲',unit_price:150}});await refreshStudentQueryMoney()})()`);
  await c.evaluate(`(async()=>{studentQueryRange={mode:'range',start:'2026-09-02',end:'2026-09-30'};await applyStudentQuerySelection('合成财务乙')})()`); await check();
  await c.evaluate(`(async()=>{await applyStudentQuerySelection('合成财务甲')})()`); await check();
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await c.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    await c.evaluate(`document.documentElement.dataset.theme='${theme}';updateStudentQueryResultsOnly({...studentStatementReport(),summary:{...studentStatementReport().summary,opening_actual_balance:-123456789.12,opening_gift_balance:9876543.21,cur_gift:0}})`);
    assert.equal(await c.evaluate(`[...document.querySelectorAll('.student-statement-metrics .metric,.student-statement-metrics .metric-value')].some(e=>e.scrollWidth>e.clientWidth+1)`), false);
    assert.equal(await c.evaluate(`document.querySelectorAll('[data-student-statement-metric="2"] .negative-text').length`), 1);
    await screenshot(c, `student-query-${width}-${theme}`);
  }
  const result = await c.evaluate(`(()=>{const samples=[{}, {opening_actual_balance:-123456789.12,opening_gift_balance:9876543.21,cur_recharge:500,cur_gift:0}],results=[];for(const summary of samples){const texts=[],rects=[],original=CanvasRenderingContext2D.prototype.fillText,round=shotRoundRect;CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){texts.push({text,x,y,right:x+this.measureText(text).width,color:this.fillStyle});return original.call(this,text,x,y,...args)};shotRoundRect=(ctx,x,y,w,h,...args)=>{if(y===142)rects.push({x,y,w,h});return round(ctx,x,y,w,h,...args)};let canvas;try{canvas=studentStatementCanvas({student_name:'合成财务甲',summary,month_rows:[],details:[]})}finally{CanvasRenderingContext2D.prototype.fillText=original;shotRoundRect=round}results.push({cards:studentStatementMetricCards(summary,{parent:true}),texts,rects,height:canvas.height,png:canvas.toDataURL()})}return results})()`);
  for (const r of result) {
    assert.equal(r.cards.length, 5); assert.equal(r.rects.length, 5);
    assert.equal(r.texts.find(x => x.text === '月份汇总').y, 246);
    for (const rect of r.rects) for (const text of r.texts.filter(x => [168, 189, 198, 209].includes(x.y) && x.x >= rect.x && x.x < rect.x + rect.w)) assert.ok(text.right <= rect.x + rect.w + .1, JSON.stringify(text));
  }
  assert.equal(result[0].cards.some(c => c.label.includes('赠送') || c.value.includes('/')), false);
  assert.equal(result[1].cards[2].value, '-¥123,456,789.12/¥9,876,543.21');
  assert.ok(result[1].texts.some(x => x.text.startsWith('-¥123,456,789.12') && x.color === '#b42318'));
  if (artifacts) for (const [i, r] of result.entries()) fs.writeFileSync(path.join(artifacts, `statement-${i}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
  assert.equal(await c.evaluate(`rowStatus({status:'未缴费'})==='已上'&&isReceivable({status:'未缴费'})&&!isCompletedLesson({status:'未缴费'})&&!getStatusOptions('未缴费').includes('未缴费')`), true);
  await c.evaluate(`(async()=>{setActiveView('lessons');lessonFilter={...defaultLessonFilter(),start_date:'2026-09-01',end_date:'2026-09-30',date_preset_initialized:true};scheduleMode=false;await load({refreshGlobal:false})})()`);
  assert.equal(await c.evaluate(`document.querySelector('.lesson-table tr[data-row-id="1"] .col-status').textContent.trim()`), '已上');
  assert.equal(await c.evaluate(`CourseDetails.table(state.lessons).includes('未缴费')`), false);
  assert.deepEqual(c.exceptions, []); assert.deepEqual(c.consoleErrors, []);
});
