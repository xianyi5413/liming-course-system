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
let tableId;
let staleImportToken;

const salary = (teacher_id, formula, start = '2026-09-01', end = '2026-09-30') => ({ teacher_id, name: '独立规则' + teacher_id, effective_start: start, effective_end: end, rules: [{ grade: '高一', course_type: '1V1', formula }] });
const workflow = name => '/api/teacher-detail/workflow?' + new URLSearchParams({ teacher: name, start: '2026-09-01', end: '2026-09-30' });
const list = id => api('/api/salary-tables?teacher_id=' + id);

test('teacher rules isolate identical dates, API IDs, caches, totals and default K without writes', async () => {
  assert.equal((await api('/api/salary-tables')).response.status, 400);
  const a = await api('/api/salary-tables', { method: 'POST', body: salary(9001, '200+40K') });
  const b = await api('/api/salary-tables', { method: 'POST', body: salary(9002, '300+50K') });
  assert.equal(a.response.status, 200, JSON.stringify(a.payload)); assert.equal(b.response.status, 200);
  tableId = a.payload.id;
  for (let i = 0; i < 3; i++) {
    assert.equal((await list(9001)).payload.tables[0].id, a.payload.id);
    assert.equal((await list(9002)).payload.tables[0].id, b.payload.id);
    for (const [name, base, performance] of [['合成教师', 200, 40], ['其他教师', 300, 50]]) {
      const row = (await api(workflow(name))).payload.lessons[0];
      assert.equal(row.teacher_base_salary, base); assert.equal(row.performance_base, performance);
    }
  }
  assert.equal((await api('/api/salary-tables/' + b.payload.id, { cookie: academicCookie })).response.status, 403);
  assert.equal((await api('/api/salary-tables/' + a.payload.id, { method: 'PUT', body: salary(9002, '999') })).response.status, 400);
  const getSummary = async () => (await api('/api/bootstrap?month=2026-09-01')).payload.derived.teacher_summary.find(row => row.teacher_name === '合成教师');
  assert.equal((await getSummary()).performance_coefficient, 1); assert.equal((await getSummary()).total_salary, 240);
  let db = new DatabaseSync(databasePath); assert.equal(db.prepare('SELECT COUNT(*) n FROM teacher_monthly_performance').get().n, 0); db.close();
  await api('/api/teacher-monthly-performance', { method: 'PUT', body: { teacher_name: '合成教师', month_key: '2026-09-01', coefficient: 0 } });
  assert.equal((await getSummary()).performance_coefficient, 0); assert.equal((await getSummary()).total_salary, 200);
  await api('/api/teacher-monthly-performance', { method: 'PUT', body: { teacher_name: '合成教师', month_key: '2026-09-01', coefficient: null } });
  assert.equal((await getSummary()).total_salary, 240);
});

test('only completed lessons contribute; status changes preserve overrides and the rule expression', async () => {
  for (const status of ['待上', '试听', '请假', '考试', '已上']) {
    assert.equal((await api('/api/lessons/401', { method: 'PATCH', body: { status } })).response.status, 200);
    const row = (await api(workflow('合成教师'))).payload.lessons[0];
    assert.equal(row.teacher_base_salary, status === '已上' ? 200 : 0);
    assert.equal(row.performance_base, status === '已上' ? 40 : 0);
    assert.equal(row.salary_rule_expression, '200+40K');
  }
  await api('/api/teacher-detail/salary/401', { method: 'PATCH', body: { source: 'manual', amount: 230 } });
  await api('/api/lessons/401', { method: 'PATCH', body: { status: '请假' } });
  let row = (await api(workflow('合成教师'))).payload.lessons[0]; assert.equal(row.teacher_base_salary, 0); assert.equal(row.teacher_base_salary_source, 'manual');
  const db = new DatabaseSync(databasePath); assert.equal(db.prepare('SELECT teacher_base_salary_override FROM lessons WHERE id=401').get().teacher_base_salary_override, 230); db.close();
  await api('/api/lessons/401', { method: 'PATCH', body: { status: '已上' } });
  row = (await api(workflow('合成教师'))).payload.lessons[0]; assert.equal(row.teacher_base_salary, 230); assert.equal(row.performance_base, 40);
  await api('/api/teacher-detail/salary/401', { method: 'PATCH', body: { source: 'auto' } });
});

test('text transfer validates all tables, resolves cross-installation identity, previews and imports atomically', async () => {
  const exported = (await api('/api/salary-tables/export?teacher_id=9001')).payload.text;
  const original = JSON.parse(exported);
  assert.equal(original.tables.length, 1); assert.equal(original.teacher.teacher_name, '合成教师');
  assert.doesNotMatch(exported, /password|token|secret|salary_table_id|created_at|updated_at/i);
  const bundle = { ...original, teacher: { teacher_id: 123456, teacher_name: '合成教师' }, tables: [salary(9001, '220+40K', '2026-10-01', '2026-10-31'), salary(9001, '240+50K', '2026-11-01', '2026-11-30')] };
  const preview = async value => api('/api/salary-tables/import-preview', { method: 'POST', body: { text: typeof value === 'string' ? value : JSON.stringify(value) } });
  for (const value of ['not JSON', { ...bundle, version: 99 }, { ...bundle, teacher: { teacher_id: 123456, teacher_name: '不存在' } }, { ...bundle, tables: [bundle.tables[0], { ...bundle.tables[1], rules: [{ grade: '高一', course_type: '1V1', formula: 'K*K' }] }] }, original]) assert.equal((await preview(value)).response.status, 400);
  assert.equal((await list(9001)).payload.tables.length, 1);
  const checked = await preview(bundle); assert.equal(checked.response.status, 200, JSON.stringify(checked.payload)); assert.equal(checked.payload.teacher.id, 9001); assert.equal(checked.payload.matched_by, 'name');
  assert.equal((await api('/api/salary-tables/import-confirm', { method: 'POST', body: { token: checked.payload.token, confirm: true } })).payload.count, 2);
  const roundtrip = JSON.parse((await api('/api/salary-tables/export?teacher_id=9001')).payload.text);
  assert.equal(roundtrip.tables.length, 3); assert.equal(roundtrip.tables[1].name, bundle.tables[0].name); assert.equal(roundtrip.tables[2].effective_end, '2026-11-30');
  assert.equal(roundtrip.tables[1].rules[0].formula, '220+40*K');
  const conflictBundle = { ...bundle, tables: [salary(9001, '10', '2027-01-01', '2027-01-31'), salary(9001, '20', '2027-02-01', '2027-02-28')] };
  const race = await preview(conflictBundle);
  await api('/api/salary-tables', { method: 'POST', body: conflictBundle.tables[1] });
  assert.equal((await api('/api/salary-tables/import-confirm', { method: 'POST', body: { token: race.payload.token, confirm: true } })).response.status, 400);
  assert.ok(!(await list(9001)).payload.tables.some(row => row.effective_start === '2027-01-01'), 'first insert rolled back, including cached context');
  const collision = await preview({ ...bundle, teacher: { teacher_id: 9002, teacher_name: '合成教师' }, tables: [salary(9001, '20', '2027-03-01', '2027-03-31')] });
  assert.equal(collision.payload.teacher.id, 9001, 'numeric ID collision cannot assign another teacher');
  staleImportToken = collision.payload.token;
});

test('old global migration remains unassigned and never becomes a fallback rule', () => {
  const W = require('../src/domain/salary_workflow');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO teachers VALUES(1,'旧教师'); CREATE TABLE salary_tables(id INTEGER PRIMARY KEY,name TEXT,effective_start TEXT,effective_end TEXT,created_at TEXT,updated_at TEXT); INSERT INTO salary_tables VALUES(1,'旧全局','2026-01-01','2026-12-31','','');");
    W.migrateSalaryWorkflow(db); W.migrateSalaryWorkflow(db);
    const rows = db.prepare('SELECT * FROM salary_tables').all(); assert.equal(rows.length, 1); assert.equal(rows[0].teacher_id, null);
    assert.equal(W.matchTable(W.tableContext(rows, [], [{ id: 1, name: '旧教师' }]), '2026-09-12', 1), null);
    assert.ok(db.prepare('PRAGMA index_list(salary_tables)').all().some(row => row.name === 'idx_salary_tables_teacher_dates'));
  } finally { db.close(); }
});

test('Shanghai formatting preserves date-only values and crosses UTC midnight independent of host timezone', () => {
  const modulePath = path.join(root, 'public/business-time.js');
  for (const TZ of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
    const child = spawnSync(process.execPath, ['-e', `const t=require(${JSON.stringify(modulePath)});console.log(JSON.stringify([t.formatTimestamp('2026-09-28 16:30:00'),t.formatTimestamp('2026-09-28T16:30:00Z'),t.formatTimestamp('2026-09-28'),t.formatTimestamp('10:00-12:00')]));`], { env: { ...process.env, TZ }, encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, 0); assert.deepEqual(JSON.parse(child.stdout), ['2026-09-29 00:30:00', '2026-09-29 00:30:00', '2026-09-28', '10:00-12:00']);
  }
});

test('ambiguous teacher names require explicit selection and templates use natural name ordering', async () => {
  const { previewTables } = require('../src/domain/salary_transfer');
  const bundle = { type: 'liming_salary_tables', version: 1, teacher: { teacher_id: 9999, teacher_name: '同名' }, tables: [salary(1, '200')] };
  const teachers = [{ id: 1, name: '同名' }, { id: 2, name: '同名' }], store = { list: () => [] };
  assert.throws(() => previewTables(store, teachers, bundle), error => error.candidates.length === 2);
  assert.equal(previewTables(store, teachers, bundle, 2).teacher.id, 2);
  for (const name of ['秋季10', '春季', '秋季2']) assert.equal((await api('/api/salary-templates', { method: 'POST', body: { name, rules: salary(1, '100').rules } })).response.status, 200);
  const templates = (await api('/api/salary-templates')).payload.templates;
  assert.deepEqual(templates.map(row => row.name), ['秋季10', '春季', '秋季2'].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true })));
});

async function poll(job) {
  const deadline = Date.now() + 30000, states = [job];
  while (['pending', 'running'].includes(job.status) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
    const response = await fetch(`http://127.0.0.1:${port}/api/data-center/jobs/${job.job_id}`, { headers: { cookie: ownerCookie, 'X-Task-Receipt': job.receipt } });
    assert.equal(response.status, 200); job = await response.json(); states.push(job);
  }
  assert.ok(!['pending', 'running'].includes(job.status), 'job finished');
  assert.ok(states.every((row, i) => !i || row.progress >= states[i - 1].progress));
  return { job, states };
}

test('data export jobs deduplicate, remain responsive, return real progress and download a restorable workbook', async () => {
  const started = await api('/api/data-center/jobs/export', { method: 'POST', body: {} });
  assert.equal(started.response.status, 202); assert.equal(started.payload.progress, 0);
  const repeated = await api('/api/data-center/jobs/export', { method: 'POST', body: {} }); assert.equal(repeated.payload.job_id, started.payload.job_id);
  const beginning = performance.now(); assert.equal((await api('/api/teachers')).response.status, 200); assert.ok(performance.now() - beginning < 1000);
  assert.equal((await api('/api/data-center/jobs/' + started.payload.job_id, { cookie: teacherCookie })).response.status, 403);
  const { job } = await poll(started.payload); assert.equal(job.status, 'success', JSON.stringify(job)); assert.equal(job.progress, 100);
  const response = await fetch(`http://127.0.0.1:${port}/api/data-center/jobs/${job.job_id}/download`, { headers: { cookie: ownerCookie } }); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  const file = path.join(tempRoot, 'teacher-job.xlsx'); fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  const { verifyFullData, restoreFullData } = require('../src/excel/full_backup');
  const verified = verifyFullData(file); assert.equal(verified.version, 7); assert.ok(verified.data.salary_tables.some(row => row.teacher_id === 9002));
  const target = path.join(tempRoot, 'teacher-restore.sqlite');
  const init = spawnSync(process.execPath, [path.join(root, 'src/server.js'), '--init-db'], { env: { ...process.env, DATA_DIR: tempRoot, DB_PATH: target }, encoding: 'utf8', windowsHide: true }); assert.equal(init.status, 0, init.stderr);
  const restoreStages = [];
  restoreFullData({ dbPath: target, inputPath: file, onProgress: (stage, percent) => restoreStages.push([stage, percent]) }); const db = new DatabaseSync(target);
  const b = db.prepare('SELECT r.formula FROM salary_table_rules r JOIN salary_tables t ON t.id=r.salary_table_id WHERE t.teacher_id=9002').get(); assert.equal(b.formula, '300+50*K'); db.close();
  const stages = []; const source = new DatabaseSync(databasePath, { readOnly: true });
  require('../src/excel/full_backup').buildFullDataBuffer(source, { onProgress: (stage, percent) => stages.push([stage, percent]) }); source.close();
  for (const stage of ['preflight', 'read', 'sheets', 'workbook', 'verify_file']) assert.ok(stages.some(row => row[0] === stage), stage);
  for (const stage of ['read_workbook', 'structure', 'parse', 'validate', 'write', 'integrity']) assert.ok(restoreStages.some(row => row[0] === stage), stage);
});

test('export preflight failure reports its cause and the next task can run', async () => {
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys=OFF; UPDATE users SET role='synthetic-invalid-role' WHERE username='salary-readonly'"); db.close();
  try {
    const failed = await poll((await api('/api/data-center/jobs/export', { method: 'POST', body: {} })).payload);
    assert.equal(failed.job.status, 'failed'); assert.equal(failed.job.error.code, 'BACKUP_DATA_PREFLIGHT_FAILED'); assert.ok(failed.job.error.message.length > 10);
  } finally {
    const db = new DatabaseSync(databasePath); db.exec("UPDATE users SET role='teacher' WHERE username='salary-readonly'"); db.close();
  }
  const started = (await api('/api/data-center/jobs/export', { method: 'POST', body: {} })).payload;
  // No polling/connection is kept alive while the worker continues.
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal((await poll(started)).job.status, 'success');
});

test('upload preview failures finish clearly; validated restore runs in a worker and clears sessions', async () => {
  const upload = async buffer => {
    const form = new FormData(); form.append('file', new Blob([buffer]), 'synthetic.xlsx');
    const response = await fetch(`http://127.0.0.1:${port}/api/data-center/jobs/preview`, { method: 'POST', headers: { cookie: ownerCookie }, body: form }); assert.equal(response.status, 202); return response.json();
  };
  const invalid = await poll(await upload(Buffer.from('invalid workbook'))); assert.equal(invalid.job.status, 'failed'); assert.ok(invalid.job.error.message);
  const preflight = await poll((await api('/api/data-center/jobs/preflight', { method: 'POST', body: {} })).payload); assert.equal(preflight.job.status, 'success');
  const preview = await poll(await upload(fs.readFileSync(path.join(tempRoot, 'teacher-job.xlsx')))); assert.equal(preview.job.status, 'success', JSON.stringify(preview.job));
  const body = { upload_id: preview.job.result.upload_id, mode: 'overwrite', password: '123456', confirmation: '覆盖导入' };
  assert.equal((await api('/api/data-center/jobs/restore', { method: 'POST', body: { ...body, password: 'bad' } })).response.status, 401);
  const started = await api('/api/data-center/jobs/restore', { method: 'POST', body }); assert.equal(started.response.status, 202, JSON.stringify(started.payload));
  assert.equal((await api('/api/lessons/401', { method: 'PATCH', body: { notes: 'must not write' } })).response.status, 409);
  const restored = await poll(started.payload); assert.equal(restored.job.status, 'success', JSON.stringify(restored.job)); assert.equal(restored.job.progress, 100);
  assert.equal((await api('/api/teachers')).response.status, 401);
  ownerCookie = await login('boss'); assert.equal((await list(9002)).payload.tables[0].rules[0].formula, '300+50*K');
  assert.equal((await api('/api/salary-tables/import-confirm', { method: 'POST', body: { token: staleImportToken, confirm: true } })).response.status, 400, 'restoration invalidates earlier teacher/import previews');
});

test('Chromium in Tokyo verifies teacher switching, copy text, previews, compact salary columns and live task UI', async () => {
  await api('/api/lessons/401', { method: 'PATCH', body: { notes: '完整备注不可省略'.repeat(30) } });
  await api('/api/teacher-detail/salary/401', { method: 'PATCH', body: { source: 'manual', amount: 230 } });
  const chrome = await launchChrome(path.join(tempRoot, 'teacher-jobs-browser')), browser = chrome.session;
  try {
    await browser.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' });
    await browser.send('Browser.grantPermissions', { origin: 'http://127.0.0.1:' + port, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    await browser.send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/' }); await browser.login('boss', '123456');
    assert.equal(await browser.evaluate("formatBeijingTime('2026-09-28T16:30:00Z')"), '2026-09-29 00:30:00');
    await browser.evaluate("selectedTeacherDetail='';setActiveView('teacherDetail');load({refreshGlobal:false})");
    await browser.waitFor("!!document.querySelector('[data-salary-action=tables]')");
    await browser.click('[data-salary-action=tables]');
    assert.equal(await browser.evaluate("!!document.querySelector('.salary-workflow-modal')"), false);
    assert.match(await browser.evaluate('document.body.innerText'), /请先选择教师/);
    for (const [name, id] of [['合成教师', 9001], ['其他教师', 9002]]) {
      await browser.evaluate(`selectedTeacherDetail=${JSON.stringify(name)};load({refreshGlobal:false})`);
      await browser.waitFor("document.querySelector('[data-salary-class]')?.textContent.includes(" + JSON.stringify(name) + ")");
      await browser.click('[data-salary-action=tables]'); await browser.waitFor("!!document.querySelector('[data-salary-action=new]')");
      assert.match(await browser.evaluate("document.querySelector('.salary-workflow-modal').innerText"), new RegExp(name + ' · 薪资表'));
      await browser.click('[data-salary-action=text-export]'); await browser.waitFor("!!document.querySelector('.transfer-text')");
      const raw = await browser.evaluate("document.querySelector('.transfer-text').value"); assert.equal(JSON.parse(raw).teacher.teacher_id, id);
      await browser.send('Page.bringToFront');
      await browser.click('.transfer-submit'); await browser.waitFor("document.body.innerText.includes('薪资表文本已复制')");
      assert.equal((await browser.evaluate('navigator.clipboard.readText()')).replace(/\r\n/g, '\n'), raw);
      await browser.click('.dialog-close'); await browser.click('[data-salary-action=close]');
    }
    await browser.evaluate("selectedTeacherDetail='合成教师';load({refreshGlobal:false})"); await browser.waitFor("document.querySelector('[data-salary-class]')?.textContent.includes('合成教师')");
    await browser.click('[data-salary-class]'); await browser.waitFor("!!document.querySelector('.teacher-class-lessons')");
    assert.match(await browser.evaluate("document.querySelector('.modal-title').textContent"), /共1节课/);
    for (const width of [1440, 1024, 390]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      const layout = await browser.evaluate("(()=>{const t=document.querySelector('.teacher-class-lessons');applyAdaptiveTableColumns({table:t});const cells=[...t.querySelector('tbody tr').cells];return {n:cells.length,nowrap:cells.every(c=>getComputedStyle(c).whiteSpace==='nowrap'),complete:cells.every(c=>c.scrollWidth<=c.clientWidth+1),body:document.documentElement.scrollWidth<=innerWidth,headers:[...t.querySelectorAll('th')].every(c=>getComputedStyle(c).textAlign==='center'),base:cells[12].innerText,rule:cells[14].innerText,badge:document.querySelector('.salary-source-badge').getBoundingClientRect().width}})()");
      assert.equal(layout.n, 15); assert.equal(layout.nowrap, true); assert.equal(layout.complete, true, JSON.stringify(layout)); assert.equal(layout.body, true); assert.equal(layout.headers, true);
      assert.match(layout.base, /恢复自动/); assert.equal(layout.rule, '200+40K'); assert.ok(layout.badge < 32);
    }
    await browser.click('[data-salary-action=close]'); await browser.click('[data-salary-action=tables]'); await browser.waitFor("!!document.querySelector('[data-salary-action=text-import]')");
    await browser.click('[data-salary-action=text-import]'); await browser.waitFor("!!document.querySelector('.transfer-text')");
    const bundle = { type: 'liming_salary_tables', version: 1, teacher: { teacher_id: 9001, teacher_name: '合成教师' }, tables: [salary(9001, '99', '2028-01-01', '2028-01-31')] };
    await browser.evaluate(`document.querySelector('.transfer-text').value=${JSON.stringify(JSON.stringify(bundle))}`);
    await browser.click('.transfer-submit'); await browser.waitFor("document.querySelector('.transfer-submit')?.textContent==='确认导入'");
    assert.match(await browser.evaluate("document.querySelector('.transfer-preview').innerText"), /将导入至：合成教师/);
    assert.equal((await list(9001)).payload.tables.some(row => row.effective_start === '2028-01-01'), false);
    await browser.click('.dialog-close'); await browser.click('[data-salary-action=close]');
    await browser.evaluate("setActiveView('teacherSalary');load({refreshGlobal:true})"); await browser.waitFor("!!document.querySelector('.salary-coefficient-input')");
    assert.equal(await browser.evaluate("document.querySelector('.salary-coefficient-input').value"), '1.00');
    await browser.evaluate("setActiveView('audit');load({refreshGlobal:false})"); await browser.waitFor("!!document.querySelector('.data-full-export')");
    await browser.evaluate("window.downloadedJob=null;downloadBlob=async url=>{const response=await fetch(url);if(!response.ok)throw Error('download failed');window.downloadedJob={url,bytes:(await response.arrayBuffer()).byteLength};};document.querySelector('.data-full-export').click();window.immediateProgress={visible:!!document.querySelector('.task-progress progress'),disabled:document.querySelector('.data-full-export').disabled};");
    assert.deepEqual(await browser.evaluate('immediateProgress'), { visible: true, disabled: true });
    await browser.waitFor('!!window.downloadedJob'); assert.ok((await browser.evaluate('downloadedJob')).bytes > 1000);
    assert.equal(await browser.evaluate("document.querySelector('.task-progress progress').value"), 100);
    await browser.evaluate("backupState.importFile=new File(['invalid'],'invalid.xlsx');document.querySelector('.data-import-preview-button').click()");
    await browser.waitFor("backupState.task?.status==='failed' && !backupState.busy");
    assert.ok(await browser.evaluate("backupState.task.message.length>0 && !document.querySelector('.data-import-preview-button').disabled"));
    assert.deepEqual(browser.exceptions, []);
  } finally { await browser.close(); chrome.child.kill('SIGTERM'); }
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
    INSERT INTO teachers(id,name,status) VALUES(9001,'合成教师','在职'),(9002,'其他教师','在职');
    INSERT INTO lessons(id,teacher_name,date,month_key,time_slot,grade,subject,course_type,student_names,status,teacher_salary,teacher_salary_source) VALUES
    (401,'合成教师','2026-09-12','2026-09-01','09:00-11:00','高一','数学','1V1','甲','已上',0,'auto'),
    (402,'其他教师','2026-09-12','2026-09-01','09:00-11:00','高一','数学','1V1','乙','已上',0,'auto');`);
  const account=db.prepare("INSERT INTO users(username,display_name,role,teacher_name,password_hash,status) VALUES(?,?,?,?,?,'active')");
  account.run('salary-readonly','只读教师','teacher','合成教师',hash);
  account.run('salary-academic','范围教务','academic','',hash);
  db.exec(`INSERT INTO role_filter_presets(role_code,view_key,filter_key,filter_value_json) VALUES('academic','teacherDetail','teacher_names','["合成教师"]');`);
}
before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-teacher-data-jobs-"));
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
