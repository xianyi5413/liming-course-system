const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync, backup } = require('node:sqlite');
const { freePort, launchBrowser } = require('./helpers/chrome_cdp');
const TG = require('../src/domain/tuoguan'), Excel = require('../src/excel/full_backup');
const root = path.resolve(__dirname, '..');
let dir, env, port, server, admin;
async function api(cookie, route, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(`http://127.0.0.1:${port}/api/${route}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
}
async function login(username) {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: '123456' }) });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}
const write = (cookie, action, body) => api(cookie, 'tuoguan/' + action, { ...body, request_id: crypto.randomUUID() });
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-detail-permission-'));
  port = await freePort();
  env = { ...process.env, DATA_DIR: dir, DB_PATH: path.join(dir, 'fixture.sqlite'), PORT: String(port), HOST: '127.0.0.1', SESSION_COOKIE_SECURE: 'false' };
  const init = spawnSync(process.execPath, ['src/server.js', '--init-db'], { cwd: root, env, encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr);
  const db = new DatabaseSync(env.DB_PATH), store = TG.createStore(db);
  const mutate = (a, b) => store.mutate(a, { ...b, request_id: crypto.randomUUID() }, '合成验收');
  for (const grade of ['初一', '初二']) mutate('student', { name: '合成同名', grade, start_date: '2026-09-01' });
  mutate('student', { name: '合成待加入', grade: '初三' });
  for (const id of [1, 2]) mutate('money', { student_id: id, date: '2026-09-01', kind: '充值', actual_amount: id * 100000, gift_amount: id * 1000, method: '微信', notes: '合成充值' });
  mutate('money', { student_id: 1, date: '2026-09-02', kind: '退款', actual_amount: 100, gift_amount: 100, method: '现金', notes: '合成退款' });
  mutate('money', { student_id: 1, date: '2026-09-03', kind: '充值', actual_amount: 111, gift_amount: 0 });
  const voided = store.get('SELECT * FROM tg_ledger ORDER BY id DESC LIMIT 1');
  mutate('money-delete', { records: [{ id: voided.id, version: voided.version }] });
  mutate('attendance', { date: '2026-09-01', rows: [{ student_id: 1, status: '出勤', version: 0 }, { student_id: 2, status: '请假', version: 0 }] });
  for (const [username, page, readonly] of [['A', 'tgAttendance', 0], ['B', 'tgStudents', 0], ['C', 'tgAttendance', 1], ['D', 'dashboard', 0], ['BR', 'tgStudents', 1]]) {
    db.prepare('INSERT INTO roles(code,name,readonly) VALUES(?,?,?)').run('fixture_' + username, '合成' + username, readonly);
    db.prepare('INSERT INTO role_permissions(role_code,permission_key,enabled) VALUES(?,?,1)').run('fixture_' + username, page);
    db.prepare("INSERT INTO users(username,display_name,role,password_hash) SELECT ?,?,?,password_hash FROM users WHERE username='boss'").run(username, '合成' + username, 'fixture_' + username);
  }
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('custom_course_statuses',?)").run(JSON.stringify(['自定义状态']));
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('month_key','2026-11-01')").run();
  // No pending lessons: reproduce the used-status-only candidate source.
  for (const [id, status] of [[1, '已上'], [2, '历史自定义']]) db.prepare("INSERT INTO lessons(id,date,month_key,status,lesson_status,course_status,teacher_name,grade,subject,student_names,time_slot) VALUES(?, '2026-11-02','2026-11-01',?,'上课','已上','合成老师','初一','数学','合成课程学生','08:00-10:00')").run(id, status);
  db.prepare("UPDATE lessons SET date='2026-11-03' WHERE id=2").run();
  db.close();
  server = spawn(process.execPath, ['src/server.js'], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) { admin = await login('boss'); return; } } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw Error('isolated server unavailable');
});
after(async () => {
  if (server && server.exitCode == null) { const end = new Promise(r => server.once('exit', r)); server.kill(); await end; }
});

test('attendance-only role can manage month membership without profile or finance authority', async () => {
  const a = await login('A');
  assert.equal((await api(a, 'tuoguan/participants?month=2026-11')).status, 200);
  const created = await write(a, 'create-member', { month: '2026-11', name: '合成签到新建', grade: '初一' });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const joined = await write(a, 'join-month', { month: '2026-11', student_id: 3, student_version: 1 });
  assert.equal(joined.status, 200, JSON.stringify(joined.data));
  const period = joined.data.periods.find(p => p.student_id === 3);
  assert.equal((await write(a, 'remove-students', { month: '2026-11', students: [{ id: 3, versions: [[period.id, period.version]] }] })).status, 200);
  assert.equal((await write(a, 'attendance', { date: '2026-11-02', rows: [{ student_id: created.data.student.id, status: '放假', version: 0 }] })).status, 200);
  assert.equal((await write(a, 'batch-attendance', { month: '2026-11', status: '不适用', cells: [{ student_id: created.data.student.id, date: '2026-11-03', version: 0 }] })).status, 200);
  assert.equal((await write(a, 'add-dates', { month: '2026-11', dates: [{ date: '2026-11-07', version: 0 }] })).status, 200);
  assert.equal((await write(a, 'remove-dates', { month: '2026-11', dates: [{ date: '2026-11-07', version: 1 }] })).status, 200);
});

test('course candidates include defaults and custom values when no pending lessons exist', async () => {
  const r = await api(admin, 'bootstrap?month=2026-11-01');
  assert.equal(r.status, 200);
  for (const value of ['待上', '已上', '请假', '试课', '考试', '自定义状态', '历史自定义']) assert.ok(r.data.lookups.status.includes(value), value);
  assert.equal(r.data.lookups.status.includes('未缴费'), false);
});

test('scoped student detail separates duplicate names and exposes only permitted read data', async () => {
  const b = await login('B');
  for (const id of [1, 2]) {
    const detail = await api(b, `tuoguan/student-detail?student_id=${id}&month=2026-09`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.student.id, id);
    assert.equal(detail.data.summary, undefined);
    assert.equal(detail.data.attendance.length, 1);
    assert.equal(detail.data.attendance[0].status, id === 1 ? '出勤' : '请假');
    assert.equal(detail.data.attendance[0].fee, undefined);
    const history = await api(b, `tuoguan/student-history?student_id=${id}`);
    assert.equal(history.status, 200);
    assert.equal(history.data.records.length, id === 1 ? 2 : 1);
    assert.ok(history.data.records.every(r => r.student_id === id && r.actor === undefined && r.voucher === undefined));
    assert.equal(history.data.records.at(-1).actual_amount, id * 100000);
    if (id === 1) { assert.equal(history.data.records[0].kind, '退款'); assert.equal(history.data.records[0].gift_amount, -100); }
  }
  assert.equal((await api(b, 'tuoguan/student-detail?student_id=1&month=2026-09&summary=1')).status, 403);
  assert.equal((await api(b, 'tuoguan/student-detail?student_id=999&month=2026-09')).status, 404);
  assert.equal((await api(b, 'tuoguan/student-detail?student_id=1&month=2026-13')).status, 400);
  const full = await api(admin, 'tuoguan/student-detail?student_id=1&month=2026-09&summary=1');
  const snapshot = await api(admin, 'tuoguan/snapshot?month=2026-09&view=tgSummary');
  for (const k of ['fee', 'actual_consumption', 'gift_consumption', 'actual_recharge', 'gift_recharge', 'actual_balance', 'gift_balance']) assert.equal(full.data.summary[k], snapshot.data.summary.find(s => s.id === 1)[k], k);
});

test('role page boundaries, readonly and forged sources cannot grant unrelated writes', async () => {
  const pages = ['tgAttendance', 'tgStudents', 'tgLedger', 'tgSummary', 'tgSettings'];
  for (const [name, own] of [['A', 'tgAttendance'], ['B', 'tgStudents'], ['C', 'tgAttendance'], ['D', 'dashboard'], ['BR', 'tgStudents']]) {
    const cookie = await login(name);
    for (const view of pages) assert.equal((await api(cookie, `tuoguan/snapshot?month=2026-09&view=${view}`)).status, view === own ? 200 : 403, name + ':' + view);
    for (const action of ['money', 'money-edit', 'money-delete', 'rule', 'calendar', 'transfer-export']) assert.equal((await write(cookie, action, { page: 'tgAttendance' })).status, 403, name + ':' + action);
    if (['C', 'D', 'BR'].includes(name)) for (const action of ['create-member', 'join-month', 'remove-students', 'student', 'period', 'attendance', 'batch-attendance', 'add-dates', 'remove-dates']) assert.equal((await write(cookie, action, { month: '2026-11' })).status, 403, name + ':' + action);
    if (['A', 'C', 'D'].includes(name)) assert.equal((await api(cookie, 'tuoguan/student-history?student_id=1')).status, 403);
  }
  const a = await login('A');
  for (const action of ['student', 'period']) assert.equal((await write(a, action, { page: 'tgAttendance', month: '2026-11' })).status, 403);
  for (const extra of [{ id: 1 }, { status: '已流出' }, { start_date: '2020-01-01' }, { actual_amount: 100 }, { page: 'tgStudents' }]) assert.equal((await write(a, 'create-member', { month: '2026-11', name: '不应创建', grade: '初一', ...extra })).status, 400);
  assert.equal((await write(a, 'join-month', { month: '2026-11', student_id: 3, student_version: 1, grade: '初一' })).status, 400);
  const b = await login('B');
  assert.equal((await write(b, 'student', { id: 3, version: 1, name: '合成待加入', grade: '初三', notes: '仅学生页面可编辑档案' })).status, 200);
  assert.equal((await write(b, 'create-member', { month: '2026-11', name: '越权', grade: '初一' })).status, 403);
});

test('course status saves exact values and rejects explicit empty without touching historical rows', async () => {
  const db = new DatabaseSync(env.DB_PATH, { readOnly: true });
  const old = db.prepare('SELECT * FROM lessons WHERE id=2').get();
  for (const status of ['待上', '已上', '请假', '试课', '考试', '自定义状态', '新手填状态']) {
    const r = await api(admin, 'lessons/1', { status, allow_conflicts: true }, 'PATCH');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(db.prepare('SELECT status FROM lessons WHERE id=1').get().status, status);
  }
  for (const status of ['', ' ', null, '未缴费', '上课（未缴费）']) assert.equal((await api(admin, 'lessons/1', { status }, 'PATCH')).status, 400);
  assert.equal(db.prepare('SELECT status FROM lessons WHERE id=1').get().status, '新手填状态');
  assert.deepEqual(db.prepare('SELECT * FROM lessons WHERE id=2').get(), old);
  assert.equal(db.prepare('SELECT count(*) n FROM lessons').get().n, 2);
  db.close();
});

test('v14 round trip preserves roles, real statuses, custom settings and ledger without repeat settlement', async () => {
  const file = path.join(dir, 'roundtrip.xlsx'), target = path.join(dir, 'restored.sqlite');
  Excel.exportFullData({ dbPath: env.DB_PATH, outputPath: file });
  const verified = Excel.verifyFullData(file);
  assert.equal(verified.version, 14);
  const source = new DatabaseSync(env.DB_PATH);
  await backup(source, target); source.close();
  Excel.restoreFullData({ dbPath: target, inputPath: file });
  const restored = new DatabaseSync(target);
  for (const table of ['tg_students', 'tg_periods', 'tg_attendance', 'tg_ledger', 'roles', 'role_permissions', 'users', 'user_page_permissions', 'lessons']) assert.deepEqual(JSON.parse(JSON.stringify(restored.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all())), verified.data[table], table);
  assert.equal(restored.prepare("SELECT value FROM settings WHERE key='custom_course_statuses'").get().value, '["自定义状态"]');
  const store = TG.createStore(restored), before = JSON.stringify(store.snapshot('2026-09', true));
  const ledger = restored.prepare('SELECT * FROM tg_ledger ORDER BY id').all();
  TG.migrate(restored); TG.migrate(restored);
  assert.equal(JSON.stringify(store.snapshot('2026-09', true)), before);
  assert.deepEqual(restored.prepare('SELECT * FROM tg_ledger ORDER BY id').all(), ledger);
  assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(), []);
  restored.close();
});

async function browserPage(t, username, view) {
  const browser = await launchBrowser(path.join(dir, 'edge-' + username), { browser: 'edge' });
  t.after(() => browser.close());
  const c = browser.session, cookie = await login(username), pos = cookie.indexOf('=');
  await c.send('Network.setCookie', { name: cookie.slice(0, pos), value: cookie.slice(pos + 1), url: `http://127.0.0.1:${port}/` });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await c.waitFor('Boolean(auth.user) && Boolean(state)');
  await c.evaluate(`(async()=>{setActiveView(${JSON.stringify(view)});await load({refreshGlobal:false})})()`);
  await c.waitFor(view.startsWith('tg') ? 'Boolean(document.querySelector("#tg-body"))' : 'Boolean(document.querySelector(".lesson-table"))');
  return c;
}
async function setMonth(c, month) {
  await c.evaluate(`document.querySelector('#tg-month').value='${month}';document.querySelector('#tg-month').dispatchEvent(new Event('change'))`);
  await c.waitFor(`document.querySelector('[data-loaded-month]')?.dataset.loadedMonth==='${month}'`);
}

test('Edge attendance-only controls perform new membership, dates, single and batch attendance', async (t) => {
  const c = await browserPage(t, 'A', 'tgAttendance');
  assert.equal(await c.evaluate('canView("tgStudents")'), false);
  await setMonth(c, '2027-02');
  await c.click('#tg-manage-students');
  await c.waitFor('document.querySelector("[data-new-member]")?.disabled===false');
  await c.click('[data-new-member]');
  await c.evaluate('document.querySelector(".tg-form [name=name]").value="合成Edge签到新建";document.querySelector(".tg-form").requestSubmit()');
  await c.waitFor('!document.querySelector(".tg-form") && document.querySelector(".tg-student-groups").textContent.includes("合成Edge签到新建")');
  await c.click('.dialog-close');
  await c.waitFor('Boolean(document.querySelector(".tg-cell-button"))');
  await c.click('#tg-manage-dates');
  await c.waitFor(`document.querySelector('[data-manage-date="2027-02-06"]')?.disabled===false`);
  await c.click('[data-manage-date="2027-02-06"]');
  await c.waitFor(`document.querySelector('[data-manage-date="2027-02-06"]')?.dataset.enabled==="true"`);
  await c.click('.dialog-close');
  await c.click('.tg-cell-button[data-date="2027-02-01"]');
  await c.click('.custom-select-menu.open [data-value="请假"]');
  await c.waitFor('!document.querySelector(".tg-cell-button[aria-busy=true]")');
  await c.click('.tg-select-student');
  await c.click('#tg-batch-attendance');
  await c.waitFor('Boolean(document.querySelector("[data-batch-preview]"))');
  await c.evaluate(`(()=>{const s=document.querySelector('[data-batch-preview]').closest('.modal-panel').querySelector('select');s.value='放假';s.dispatchEvent(new Event('change'))})()`);
  await c.click('.modal-backdrop:has([data-batch-preview]) button[type="submit"]');
  await c.waitFor('!document.querySelector("[data-batch-preview]")');
  const snap = await api(await login('A'), 'tuoguan/snapshot?view=tgAttendance&month=2027-02');
  assert.ok(snap.data.attendance.length > 20);
  assert.ok(snap.data.attendance.every(a => a.status === '放假'));
  assert.deepEqual(c.exceptions, []);
  assert.deepEqual(c.consoleErrors, []);
});

test('course copies preserve custom values and resolve legacy empty status only in new rows', async () => {
  const db = new DatabaseSync(env.DB_PATH);
  db.prepare("INSERT INTO lessons(id,date,month_key,status,lesson_status,course_status,teacher_name,grade,subject,student_names,time_slot) SELECT 900,'2026-12-01','2026-12-01','','上课','已上',teacher_name,grade,subject,student_names,time_slot FROM lessons WHERE id=2").run();
  const old = db.prepare('SELECT * FROM lessons WHERE id IN (2,900) ORDER BY id').all();
  for (const [id, target, status] of [[900, '2026-12-02', '已上'], [2, '2026-12-04', '历史自定义']]) {
    const r = await api(admin, 'lessons/copy', { source_lesson_ids: [id], target_dates: [target], reset_status: false });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.lessons[0].status, status);
    assert.equal(db.prepare('SELECT status FROM lessons WHERE id=?').get(r.data.lessons[0].id).status, status);
  }
  const fields = { teacher_name: '合成老师', grade: '初一', subject: '数学', student_names: '合成课程学生', time_slot: '08:00-10:00', status: '手填新课程' };
  const created = await api(admin, 'lessons', { ...fields, date: '2026-12-03' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.status, fields.status);
  const batch = await api(admin, 'lessons/batch-create', { lessons: [{ ...fields, source_id: 2, date: '2026-12-05', status: '历史自定义' }] });
  assert.equal(batch.status, 201, JSON.stringify(batch.data));
  assert.equal(batch.data.lessons[0].status, '历史自定义');
  assert.deepEqual(db.prepare('SELECT * FROM lessons WHERE id IN (2,900) ORDER BY id').all(), old);
  db.close();
});

test('Edge student details reuse compact calendar, preserve filters and isolate edit controls', async (t) => {
  const c = await browserPage(t, 'B', 'tgStudents');
  await c.evaluate('document.querySelector("#tg-query").value="合成同名";document.querySelector("#tg-query").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');
  await c.click('.tg-student-row[data-student="1"] td:nth-child(2)');
  await c.waitFor('document.querySelector(".tg-history-body")?.textContent.includes("合成退款")');
  assert.equal(await c.evaluate('document.querySelectorAll(".tg-student-detail-panel .metric").length'), 0);
  await c.click('.dialog-close');
  await c.evaluate(`document.querySelector('.tg-student-row[data-student="2"]').dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))`);
  await c.waitFor('document.querySelector(".tg-history-body")?.textContent.includes("合成充值")');
  assert.equal(await c.evaluate('document.querySelector(".tg-history-body").textContent.includes("合成退款")'), false);
  await c.click('.dialog-close');
  assert.equal(await c.evaluate('document.querySelector("#tg-query").value'), '合成同名');
  await c.click('.tg-profile-grade[data-id="1"]');
  assert.equal(await c.evaluate('Boolean(document.querySelector(".tg-form [name=grade]"))&&!document.querySelector(".tg-student-detail-panel")'), true);
  await c.click('[data-cancel]');
  await c.click('.tg-edit-profile[data-id="1"]');
  await c.evaluate('document.querySelector(".tg-form [name=notes]").value="合成编辑备注";document.querySelector(".tg-form").requestSubmit()');
  await c.waitFor('!document.querySelector(".tg-form")');
  await c.evaluate(`(()=>{const s=document.querySelector('.tg-profile-status[data-student="1"]');s.value="暂停";s.dispatchEvent(new Event("change"))})()`);
  await c.waitFor(`document.querySelector('.tg-profile-status[data-student="1"]')?.disabled===false`);
  assert.equal(await c.evaluate('Boolean(document.querySelector(".tg-student-detail-panel"))'), false);
  assert.equal((await api(await login('B'), 'tuoguan/snapshot?view=tgStudents&month=2026-09')).data.students.find(s => s.id === 1).notes, '合成编辑备注');
  assert.deepEqual(c.exceptions, []);
  assert.deepEqual(c.consoleErrors, []);
});

test('Edge readonly attendance and student detail respect independent global readonly', async (t) => {
  const c = await browserPage(t, 'C', 'tgAttendance');
  assert.equal(await c.evaluate('Boolean(document.querySelector("#tg-manage-students,#tg-manage-dates,#tg-batch-attendance,.tg-cell-button:not(:disabled)"))'), false);
  const b = await browserPage(t, 'BR', 'tgStudents');
  await b.click('.tg-student-row[data-student="1"]');
  await b.waitFor('document.querySelector(".tg-history-body")?.textContent.includes("合成退款")');
  assert.equal(await b.evaluate('Boolean(document.querySelector(".tg-student-detail-panel input,.tg-student-detail-panel select"))'), false);
  await b.click('.dialog-close');
  assert.equal(await b.evaluate('[...document.querySelectorAll(".tg-profile-link,.tg-profile-status,#tg-new")].every(e=>e.disabled)'), true);
  assert.deepEqual([...c.exceptions, ...b.exceptions], []);
});

test('Edge compact fee dialog fits desktop/mobile themes with 4/5/6 calendar rows and one history request', async (t) => {
  const c = await browserPage(t, 'boss', 'tgSummary');
  await setMonth(c, '2026-09');
  const geometry = () => c.evaluate(`(()=>{const p=document.querySelector('.tg-student-detail-panel'),g=p.querySelector('.tg-detail-calendar');return {width:p.offsetWidth,height:p.offsetHeight,scroll:p.scrollHeight,client:p.clientHeight,overflow:p.scrollWidth>p.clientWidth+1,rows:getComputedStyle(g).gridTemplateRows.split(' ').length,calendar:g.offsetHeight,amounts:[...p.querySelectorAll('.metric-value')].map(e=>({text:e.textContent,overflow:e.scrollWidth>e.clientWidth+1})),days:g.querySelectorAll('[data-date]').length}})()`);
  const results = [];
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await c.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    await c.evaluate(`document.documentElement.dataset.theme='${theme}';window.historyReads=0;window.baseFetch=window.fetch;window.fetch=(...args)=>{if(String(args[0]).includes('student-history'))historyReads++;return baseFetch(...args)}`);
    await c.click('.tg-fee-row[data-student="1"]');
    await c.waitFor('document.querySelector(".tg-history-body")?.textContent.includes("合成退款")');
    const g = await geometry();
    assert.equal(g.rows, 5);
    assert.equal(g.days, 30);
    assert.equal(g.overflow, false);
    assert.equal(g.amounts.length, 4);
    const s = (await api(admin, 'tuoguan/student-detail?student_id=1&month=2026-09&summary=1')).data.summary;
    const money = n => '¥' + (Number(n || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    assert.deepEqual(g.amounts.map(a => a.text), [money(s.fee), money(s.actual_consumption) + '/' + money(s.gift_consumption), money(s.actual_recharge) + '/' + money(s.gift_recharge), money(s.actual_balance) + '/' + money(s.gift_balance)]);
    assert.ok(g.amounts.every(a => !a.overflow && a.text !== '—'));
    assert.ok(g.calendar <= 300);
    assert.ok(g.width <= Math.min(760, width - 32));
    const out = process.env.TEST_ARTIFACT_DIR || dir;
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `detail-${width}-${theme}.png`), Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await c.click('[data-detail-step="-1"]');
    await c.waitFor('document.querySelector(".tg-detail-content")?.dataset.month==="2026-08"');
    assert.equal((await geometry()).rows, 6);
    for (let i = 0; i < 6; i++) await c.click('[data-detail-step="-1"]');
    await c.waitFor('document.querySelector(".tg-detail-content")?.dataset.month==="2026-02"');
    assert.equal((await geometry()).rows, 4);
    assert.equal(await c.evaluate('historyReads'), 1);
    results.push({ viewport: width, theme, ...g });
    await c.click('.dialog-close');
    await c.evaluate('window.fetch=baseFetch');
  }
  fs.writeFileSync(path.join(process.env.TEST_ARTIFACT_DIR || dir, 'detail-layout.json'), JSON.stringify(results, null, 2));
  assert.deepEqual(c.exceptions, []);
  assert.deepEqual(c.consoleErrors, []);
});

test('Edge course status candidates, exact save, legacy display and shared picker lifecycle', async (t) => {
  const c = await browserPage(t, 'boss', 'lessons');
  await c.evaluate(`(async()=>{lessonFilter={...defaultLessonFilter(),start_date:'2026-11-01',end_date:'2026-11-30',date_preset_initialized:true};await load({refreshGlobal:false});render()})()`);
  assert.equal(await c.evaluate('rowStatus({status:"历史自定义",course_status:"已上"})'), '历史自定义');
  assert.equal(await c.evaluate('rowStatus({status:"",course_status:"已上"})'), '已上');
  assert.equal(await c.evaluate('rowStatus({status:"",course_status:"未上"})'), '待上');
  for (const theme of ['light', 'dark']) {
    await c.evaluate(`document.documentElement.dataset.theme='${theme}'`);
    if (!await c.evaluate('scheduleMode')) await c.click('.schedule-mode-toggle');
    for (const status of ['待上', '已上', '请假', '试课', '考试', '自定义状态']) {
      await c.click('[data-lesson-id="1"][data-field="status"]');
      const options = await c.evaluate('[...document.querySelectorAll(".custom-select-menu.open [data-value]")].map(e=>({value:e.dataset.value,text:e.textContent.trim()}))');
      assert.ok(options.some(o => o.value === '待上' && o.text.includes('待上')));
      assert.equal(options.some(o => o.value === ''), false);
      assert.equal(options.some(o => o.value === '未缴费'), false);
      await c.click(`.custom-select-menu.open [data-value="${status}"]`);
      await c.waitFor(`!activeScheduleInlinePicker && state.lessons.find(r=>r.id===1)?.status===${JSON.stringify(status)}`);
      const db = new DatabaseSync(env.DB_PATH, { readOnly: true });
      assert.equal(db.prepare('SELECT status FROM lessons WHERE id=1').get().status, status);
      db.close();
    }
    await c.click('.schedule-mode-toggle');
    assert.equal(await c.evaluate(`document.querySelector('.lesson-table tr[data-row-id="1"] .col-status').textContent.trim()`), '自定义状态');
  }
  const shared = await c.evaluate(`(()=>{const d=CourseDetails.dialog('合成共享下拉','<button id="fixture-picker">状态</button>');window.fixtureDialog=d;openInlineCustomPicker(document.querySelector('#fixture-picker'),{id:1,field:'status',choices:scheduleInlinePickerOptions({status:'自定义状态'},'status'),onChange:()=>{}});const visible=Boolean(document.querySelector('.custom-select-menu.open'));d.close();return {visible,orphan:!!document.querySelector('.custom-select-menu.open')}})()`);
  assert.deepEqual(shared, { visible: true, orphan: false });
  await c.send('Page.reload');
  await c.waitFor('Boolean(state?.lessons?.find(r=>r.id===1))');
  assert.equal(await c.evaluate('state.lessons.find(r=>r.id===1).status'), '自定义状态');
  assert.ok(await c.evaluate('CourseDetails.table(state.lessons).includes("历史自定义")'));
  const screenshots = await c.evaluate(`(()=>{const lessons=state.lessons,item={lessons,lesson_count:lessons.length,teachers:['合成老师'],students:['合成课程学生'],grades:['初一'],subjects:['数学']};return ['parent','teacher'].map(mode=>{const canvas=courseNoticeCanvas(item,mode,'',{layoutMode:'simple'});return canvas.width>0&&canvas.height>0&&canvas.toDataURL().startsWith('data:image/png;base64,')})})()`);
  assert.deepEqual(screenshots, [true, true]);
  await c.evaluate(`(async()=>{setActiveView('classGroups');await load({refreshGlobal:false})})()`);
  assert.ok(await c.evaluate('state.class_groups.some(g=>g.lesson_ids.includes(1)&&g.lesson_ids.includes(2))'));
  assert.deepEqual(c.exceptions, []);
  assert.deepEqual(c.consoleErrors, []);
});
