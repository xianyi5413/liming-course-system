const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { test, before, after } = require('node:test');
const { defaultCourseType, courseTypeOptions, migrateCourseTypes } = require('../src/domain/course_type');
const { exportFullData, restoreFullData, verifyFullData } = require('../src/excel/full_backup');
const { BackupService } = require('../src/backup/backup_service');
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
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'liming-20260922-'));
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

test('default course types use strict grades, unique students and separate dictionaries', () => {
  for (const grade of ['初一','初二','初三','高一','高二','高三']) {
    for (let count = 1; count <= 5; count++) assert.equal(defaultCourseType(grade, Array.from({ length: count }, (_, i) => `学生${i}`)), count <= (grade.startsWith('初') ? 2 : 3) ? `1V${count}` : '小班课');
  }
  assert.equal(defaultCourseType('新高一', '甲、乙'), '');
  assert.equal(defaultCourseType('高一', '[]'), '');
  assert.equal(defaultCourseType('初一', '["甲","甲","乙"]'), '1V2');
  const settings = { custom_course_types_junior: '["初中自定义"]', custom_course_types_senior: '["高中自定义"]' };
  assert.deepEqual(courseTypeOptions('初三', settings), ['1V1','1V2','小班课','初中自定义']);
  assert.deepEqual(courseTypeOptions('高三', settings), ['1V1','1V2','1V3','小班课','高中自定义']);
});

test('legacy schema migration is blank-only, transactional and idempotent', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE lessons(id INTEGER PRIMARY KEY, grade TEXT,student_names TEXT,teacher_salary REAL); CREATE TABLE class_groups(id INTEGER PRIMARY KEY,grade TEXT,students_key TEXT); INSERT INTO lessons VALUES(1,'初一','甲、乙、丙',123.45); INSERT INTO class_groups VALUES(1,'高一','甲、乙、丙');");
  assert.deepEqual(migrateCourseTypes(db), { lessons: 1, class_groups: 1 });
  assert.equal(db.prepare('SELECT course_type FROM lessons').get().course_type, '小班课');
  assert.equal(db.prepare('SELECT course_type FROM class_groups').get().course_type, '1V3');
  db.exec("UPDATE lessons SET course_type='历史明确类型'");
  assert.deepEqual(migrateCourseTypes(db), { lessons: 0, class_groups: 0 });
  assert.equal(db.prepare('SELECT teacher_salary FROM lessons').get().teacher_salary, 123.45);
  assert.equal(db.prepare('SELECT course_type FROM lessons').get().course_type, '历史明确类型');
  db.close();
});

test('API stores dictionaries, class defaults, explicit edits, lessons and copies without type loss', async () => {
  assert.equal((await api('/api/settings', 'POST', { custom_course_types_junior: '["初中特训"]', custom_course_types_senior: '["高中特训"]' })).status, 200);
  const boot = await api('/api/bootstrap?lite=1&month=2026-07-01');
  assert.ok(boot.data.lookups.course_types.junior.includes('初中特训'));
  assert.ok(!boot.data.lookups.course_types.junior.includes('高中特训'));
  let group = await api('/api/class-groups', 'PUT', { teacher: '合成老师', grade: '高一', subject: '数学', student_names: '合成学生', class_name: '合成班' });
  assert.equal(group.status, 200); assert.equal(group.data.row.course_type, '1V1');
  const id = group.data.row.id;
  group = await api(`/api/class-groups/${id}`, 'PATCH', { course_type: '高中特训' });
  assert.equal(group.data.row.class_name, '合成班');
  group = await api(`/api/class-groups/${id}`, 'PATCH', { class_name: '合成班改名' });
  assert.equal(group.data.row.course_type, '高中特训');
  const lesson = await api('/api/lessons', 'POST', { teacher_name: '合成老师', grade: '高一', subject: '数学', student_names: '合成学生', date: '2026-07-03', month_key: '2026-07-01', time_slot: '09:00-11:00', classroom: '合成教室', status: '已上' });
  assert.equal(lesson.status, 201); assert.equal(lesson.data.course_type, '高中特训');
  assert.equal((await api(`/api/lessons/${lesson.data.id}`, 'PATCH', { notes: '保留类型' })).data.course_type, '高中特训');
  assert.equal((await api(`/api/lessons/${lesson.data.id}`, 'PATCH', { course_type: '初中特训' })).status, 400);
  const copied = await api('/api/lessons/copy', 'POST', { source_lesson_ids: [lesson.data.id], target_dates: ['2026-07-10'], reset_status: false });
  assert.equal(copied.status, 201); assert.equal(copied.data.lessons[0].course_type, '高中特训');
  const denied = await api('/api/lessons', 'POST', { course_type: '高中特训' }, ''); assert.equal(denied.status, 401);
  for (const [date, subject, status] of [['2026-07-11','物理','已上'],['2026-07-12','英语','请假'],['2026-07-13','化学','未缴费'],['2026-08-03','物理','已上']]) {
    assert.equal((await api('/api/lessons', 'POST', { teacher_name: '合成老师', grade: '高一', subject, student_names: '合成学生', date, month_key: date.slice(0, 7) + '-01', time_slot: '09:00-11:00', classroom: '合成教室', status })).status, 201);
  }
});

test('statement subject counts reuse billable effective details and refresh derived caches', async () => {
  const url = `/api/student/${encodeURIComponent('合成学生')}/statement?start=2026-07-01&end=2026-08-31`;
  const result = await api(url);
  assert.equal(result.status, 200);
  const [july, august] = result.data.month_rows;
  assert.deepEqual(july.subject_counts, { 数学: 2, 英语: 0, 物理: 1, 化学: 0 });
  assert.equal(july.lesson_count, 3);
  assert.equal(august.subject_counts.数学, 0);
  const db = new DatabaseSync(dbPath); db.exec("UPDATE lessons SET status='请假' WHERE date='2026-07-11'"); db.close();
  const refreshed = await api(url + '&refresh=1');
  assert.equal(refreshed.data.month_rows[0].subject_counts.物理, 0);
  assert.equal(refreshed.data.month_rows[0].lesson_count, 2);
});

test('v4 hidden mapping retains types and dictionaries through restore and re-export', () => {
  const first = path.join(temp, 'first.xlsx'); const second = path.join(temp, 'second.xlsx'); const target = path.join(temp, 'restore.sqlite');
  exportFullData({ dbPath, outputPath: first }); init(target);
  restoreFullData({ dbPath: target, inputPath: first }); exportFullData({ dbPath: target, outputPath: second });
  const a = verifyFullData(first); const b = verifyFullData(second);
  assert.equal(a.version, 4); assert.equal(a.workbook.sheets.length, 26);
  assert.ok(a.workbook.sheetMap.get('__关系映射').rows.some(row => row.includes('course_type')));
  for (const table of ['lessons','class_groups']) assert.deepEqual(b.data[table].map(row => [row.id,row.course_type]), a.data[table].map(row => [row.id,row.course_type]));
  assert.equal(b.data.settings.find(row => row.key === 'custom_course_types_senior').value, '["高中特训"]');
});

test('batch copy preserves a retired explicit type and old v4 missing fields receive defaults', async () => {
  const db = new DatabaseSync(dbPath);
  const source = db.prepare("SELECT * FROM lessons ORDER BY id LIMIT 1").get();
  db.prepare("UPDATE lessons SET course_type='历史类型' WHERE id=?").run(source.id); db.close();
  const result = await api('/api/lessons/batch-create', 'POST', { lessons: [{ ...source, source_id: source.id, course_type: '历史类型', date: '2026-09-01', month_key: '2026-09-01' }] });
  assert.equal(result.status, 201); assert.equal(result.data.lessons[0].course_type, '历史类型');
  const old = path.join(temp, 'old.sqlite'); init(old);
  const legacy = new DatabaseSync(old);
  legacy.exec("ALTER TABLE lessons DROP COLUMN course_type; ALTER TABLE class_groups DROP COLUMN course_type; INSERT INTO lessons(teacher_name,date,grade,subject,student_names,month_key) VALUES('合成老师','2026-07-01','高一','数学','甲、乙、丙','2026-07-01')"); legacy.close();
  const workbook = path.join(temp, 'old.xlsx'); exportFullData({ dbPath: old, outputPath: workbook });
  const target = path.join(temp, 'old-restored.sqlite'); init(target); restoreFullData({ dbPath: target, inputPath: workbook });
  const restored = new DatabaseSync(target); assert.equal(restored.prepare('SELECT course_type FROM lessons').get().course_type, '1V3'); restored.close();
});

test('local retention removes excess files and rows, respects locks, missing files and protected backups', async () => {
  const folder = path.join(temp, 'retention'); fs.mkdirSync(folder); const database = path.join(folder, 'test.sqlite'); init(database);
  const service = new BackupService({ dbPath: database, dataDir: folder });
  const records = [];
  for (let i = 0; i < 5; i++) records.push((await service.create({ trigger: 'manual', retentionClass: 'manual', createdAt: new Date(Date.UTC(2026, 6, i + 1)) })).record);
  service.updateMetadata(records[0].id, { pinned: true });
  fs.rmSync(path.join(folder, records[1].managed_relative_path));
  const lock = service.acquireLock(); assert.throws(() => service.applyRetention({ manual: 1 }), e => e.code === 'BACKUP_ALREADY_RUNNING'); service.releaseLock(lock);
  const result = service.applyRetention({ manual: 1 });
  assert.equal(result.removed.length, 3);
  assert.ok(service.list().some(row => row.id === records[0].id));
  assert.ok(service.list().some(row => row.id === records[4].id));
  assert.equal(service.list().length, 2);
  assert.equal(service.applyRetention({ manual: 1 }).removed.length, 0);
});

test('manual backup API applies saved retention immediately after success', async () => {
  assert.equal((await api('/api/data-center/settings', 'PUT', { manual_retention: 1 })).status, 200);
  const first = await api('/api/data-center/backups', 'POST', {}); assert.equal(first.status, 201);
  await new Promise(r => setTimeout(r, 1100));
  const second = await api('/api/data-center/backups', 'POST', {}); assert.equal(second.status, 201);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM backup_records WHERE retention_class='manual' AND status='success'").get().n, 1);
  db.close();
});

test('Chromium: logo, sidebar, teacher serials, query model, refresh and sticky headers at four viewports', async () => {
  const { session: browser, child } = await launchChrome(path.join(temp, 'chrome'));
  try {
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}` }); await browser.login();
    await browser.waitFor("Boolean(state?.settings)");
    assert.equal(await browser.evaluate("document.querySelector('.brand-mark img').naturalWidth > 0"), true);
    assert.equal(await browser.evaluate("document.querySelector('link[rel=icon]').getAttribute('href')"), '/assets/logo.png?v=20260922');
    for (const width of [1440,1280,1024,390]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
      await browser.evaluate("(async () => { sidebarCollapsed=false; applySidebarState(); setActiveView('teacherProfiles'); await load({refreshGlobal:false}); })()");
      await browser.waitFor("Boolean(document.querySelector('.teacher-profile-table[data-adaptive-widths]'))");
      const layout = await browser.evaluate(`(() => ({ serials:[...document.querySelectorAll('.teacher-profile-serial')].map(x=>x.textContent), overflow:document.documentElement.scrollWidth>innerWidth, sidebar:document.querySelector('.sidebar').getBoundingClientRect().width, wrap:[...document.querySelectorAll('.nav-label')].some(x=>x.scrollWidth>x.clientWidth+1) }))()`);
      assert.deepEqual(layout.serials, ['1','2']); assert.equal(layout.overflow, false, JSON.stringify({width,...layout})); assert.equal(layout.wrap, false);
      await browser.click('.sidebar-toggle');
      assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.sidebar-toggle')).display"), 'none');
      await browser.click('.brand-mark'); assert.equal(await browser.evaluate('sidebarCollapsed'), false);
    }
    const filteredSerials = await browser.evaluate(`(() => { profileNameFilter.teachers='合成老师乙'; renderProfileDirectory('teachers'); const serials=[...document.querySelectorAll('.teacher-profile-serial')].map(x=>x.textContent); profileNameFilter.teachers=''; return serials; })()`);
    assert.deepEqual(filteredSerials, ['1']);
    await browser.evaluate("(async () => { activeMonth='2026-07-01'; scheduleMode=true; setActiveView('lessons'); lessonFilter.start_date='2026-07-01'; lessonFilter.end_date='2026-07-31'; await load({refreshGlobal:false}); })()");
    await browser.waitFor("Boolean(document.querySelector('[data-lesson-edit-trigger][data-field=course_type]'))");
    const requestStart = browser.responses.length;
    const changed = await browser.evaluate(`(async () => { const trigger=document.querySelector('[data-lesson-edit-trigger][data-field=course_type]'); openScheduleInlinePicker(trigger); const select=activeScheduleInlinePicker.select; select.value='1V2'; await handleLessonFieldChange(select); const result={id:select.dataset.id,value:state.lessons.find(row=>String(row.id)===select.dataset.id).course_type}; closeScheduleInlinePicker(); return result; })()`);
    assert.equal(changed.value, '1V2');
    assert.equal(browser.responses.slice(requestStart).some(row => row.url.includes('/api/bootstrap')), false);
    const saved = new DatabaseSync(dbPath); assert.equal(saved.prepare('SELECT course_type FROM lessons WHERE id=?').get(Number(changed.id)).course_type, '1V2'); saved.close();
    await browser.evaluate("(async () => { setActiveView('classGroups'); await load({refreshGlobal:false}); })()");
    await browser.click('.new-class-group');
    assert.equal(await browser.evaluate(`(() => { const grade=document.querySelector('.class-group-create-form [name=grade]'); grade.value='初一'; grade.dispatchEvent(new Event('change',{bubbles:true})); const values=[...grade.form.elements.course_type.options].map(x=>x.value); return values.includes('初中特训')&&!values.includes('高中特训'); })()`), true);
    await browser.click('.close-class-group-create');
    await browser.evaluate("(async () => { setActiveView('studentQuery'); selectedStudent='合成学生'; studentQueryRange={mode:'range',start:'2026-07-01',end:'2026-08-31'}; await load({refreshGlobal:false}); })()");
    await browser.waitFor("Boolean(document.querySelector('.refresh-student-query'))");
    const model = await browser.evaluate(`(() => { const report=studentStatementReport(); return { columns:studentQueryMonthColumns(report).map(x=>x.label), parent:studentQueryMonthColumns(report,{parent:true}).map(x=>x.label), zero:studentStatementMetricCards({}, {parent:true}).map(x=>x.label), gift:studentStatementMetricCards({cur_gift:1},{parent:true}).length, image:studentStatementCanvas(report).toDataURL().length }; })()`);
    assert.deepEqual(model.columns, ['月份','有效课次','数学','物理','当月课费','现金充值','赠送充值']); assert.ok(!model.parent.includes('赠送充值')); assert.equal(model.zero.length, 5); assert.ok(model.zero.every(x=>!x.includes('赠送'))); assert.equal(model.gift, 8); assert.ok(model.image > 1000);
    const beforeFilter = await browser.evaluate('JSON.stringify({selectedStudent,studentQueryRange})'); const n = browser.responses.length;
    await browser.click('.refresh-student-query'); await browser.waitFor("!document.querySelector('.refresh-student-query').disabled");
    assert.equal(await browser.evaluate('JSON.stringify({selectedStudent,studentQueryRange})'), beforeFilter); assert.ok(browser.responses.slice(n).some(row=>row.url.includes('refresh=1')));
    await browser.evaluate("(async () => { setActiveView('summary'); await load({refreshGlobal:false}); })()");
    assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.student-summary-table th')).position"), 'sticky');
    const sticky = await browser.evaluate(`(async () => { const wrap=document.querySelector('.student-summary-scroll'),table=wrap.querySelector('table'),body=table.tBodies[0],row=body.rows[0]; for(let i=0;i<50;i++) body.append(row.cloneNode(true)); wrap.scrollTop=180; wrap.scrollLeft=100; await new Promise(requestAnimationFrame); const head=table.querySelector('th').getBoundingClientRect(),cell=body.rows[0].cells[0].getBoundingClientRect(),box=wrap.getBoundingClientRect(); return {scroll:wrap.scrollTop,offset:Math.abs(head.top-box.top),aligned:Math.abs(head.left-cell.left)<1}; })()`);
    assert.ok(sticky.scroll>0); assert.ok(sticky.offset<3); assert.equal(sticky.aligned,true);
    assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  } finally { await browser.close(); if (child.exitCode == null) { const exited = new Promise(resolve => child.once("exit", resolve)); child.kill(); await exited; } }
});
