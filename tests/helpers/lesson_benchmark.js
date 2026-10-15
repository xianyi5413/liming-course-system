// Synthetic, isolated Chromium benchmark. Never opens the application data directory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { freePort, launchChrome } = require('./chrome_cdp');

async function benchmark({ verify } = {}) {
  const root = process.env.LESSON_BENCHMARK_ROOT || path.resolve(__dirname, '../..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liming-lessons-benchmark-'));
  const env = { ...process.env, DATA_DIR: dir, DB_PATH: path.join(dir, 'synthetic.sqlite'), SESSION_COOKIE_SECURE: 'false' };
  let server, chrome;
  try {
    const init = spawnSync(process.execPath, ['src/server.js', '--init-db'], { cwd: root, env, encoding: 'utf8', windowsHide: true });
    if (init.status !== 0) throw new Error(init.stderr);
    const db = new DatabaseSync(env.DB_PATH);
    db.exec('DELETE FROM lessons');
    const insert = db.prepare(`INSERT INTO lessons(id,teacher_name,date,time_slot,classroom,grade,subject,student_names,notes,status,course_status,lesson_status,month_key,sort_order) VALUES (?,?,?,?,?,?,?,?,?,'已上','已上','上课',?,?)`);
    db.exec('BEGIN');
    for (let i = 0; i < 6000; i++) {
      const date = new Date(Date.UTC(2026, 0, 1 + (i % 365))).toISOString().slice(0, 10);
      insert.run(100000 + i, `测试老师${i % 20}`, date, '09:00-11:00', `教室${i % 30}`, i % 2 ? '初一' : '高一', i % 3 ? '数学' : '英语', Array.from({ length: 6 }, (_, j) => `测试学生${(i + j) % 100}`).join('、'), i % 10 ? '合成备注' : '长备注'.repeat(80), date.slice(0, 7) + '-01', i);
    }
    db.exec('COMMIT');
    const queryPlan = db.prepare('EXPLAIN QUERY PLAN SELECT *, \'\' AS weekday FROM lessons WHERE date >= ? AND date <= ? ORDER BY date, teacher_name, time_slot, classroom, sort_order, id').all('2026-01-01', '2026-12-31');
    db.close();
    const port = await freePort();
    server = spawn(process.execPath, ['src/server.js'], { cwd: root, env: { ...env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 200; i++) {
      try { if ((await fetch(base + '/api/version')).ok) break; } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'boss', password: '123456' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const start = performance.now();
    const response = await fetch(base + '/api/lessons-range?start=2026-01-01&end=2026-12-31', { headers: { cookie } });
    const raw = await response.text();
    const api = { ms: performance.now() - start, bytes: Buffer.byteLength(raw), rows: JSON.parse(raw).lessons.length, queryPlan };
    chrome = await launchChrome(path.join(dir, 'chrome'));
    const c = chrome.session;
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: base });
    await c.login();
    const openStarted = performance.now();
    await c.evaluate(`(async()=>{lessonFilter.start_date='2026-01-01';lessonFilter.end_date='2026-12-31';lessonFilter.date_preset_initialized=true; setActiveView('lessons');await load({refreshGlobal:false});})()`);
    await c.waitFor('!!document.querySelector("#lessons-tbody")', 60000);
    await c.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const firstOpenMs = performance.now() - openStarted;
    await c.evaluate(`window.benchmarkLessons=state.lessons.slice();window.benchmarkLongTasks=[];new PerformanceObserver(list=>benchmarkLongTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:false});`);
    await c.send('Performance.enable');
    if (process.env.LESSON_PROFILE) await c.evaluate(`window.lessonProfile={};for(const name of ['sortLessons','dynamicLessonFilterOptions','lessonMatchesFilter','measureVisibleStudentColumnWidth','measureLessonNoteWidth','lessonRowsHtml','wireEvents','applyReadonlyUi','renderNav','lessonStats']){const original=eval(name);eval(name+'=(...args)=>{const t=performance.now();try{return original(...args)}finally{lessonProfile["'+name+'"]=(lessonProfile["'+name+'"]||0)+performance.now()-t}}')}`);
    const results = [];
    for (const count of [500, 2000, 6000]) {
      const before = await c.send('Performance.getMetrics');
      const initial = await c.evaluate(`(()=>{state.lessons=benchmarkLessons.slice(0,${count});state.schedule_conflicts={issues:[]};scheduleMode=false;lessonFilter.subject='';benchmarkLongTasks.length=0;const t=performance.now();render();return {syncMs:performance.now()-t,initialRows:document.querySelectorAll('#lessons-tbody tr[data-row-id]').length};})()`);
      const t = performance.now();
      await c.waitFor(`document.querySelectorAll('#lessons-tbody tr[data-row-id]').length===Math.min(${count},typeof LESSON_PAGE_SIZE==='undefined'?${count}:LESSON_PAGE_SIZE)`, 120000);
      const finish = performance.now() - t;
      const menus = {};
      for (const field of ['teacher_names', 'student_names']) {
        menus[field] = await c.evaluate(`new Promise(resolve=>{const el=document.querySelector('.lesson-filter-region .multi-select[data-field="${field}"] .multi-select-toggle');const t=performance.now();el.click();requestAnimationFrame(()=>requestAnimationFrame(()=>{resolve(performance.now()-t);el.click();}));})`);
      }
      const details = await c.evaluate(`({nodes:document.querySelectorAll('*').length,longestTask:Math.max(0,...benchmarkLongTasks),rows:document.querySelectorAll('#lessons-tbody tr[data-row-id]').length})`);
      const after = await c.send('Performance.getMetrics');
      const delta = {};
      for (const key of ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration']) delta[key] = after.metrics.find(m=>m.name===key).value - before.metrics.find(m=>m.name===key).value;
      const filtering = await c.evaluate(`new Promise(resolve=>{lessonFilter.subject='数学';const t=performance.now();let filterSyncMs=0;setTimeout(()=>{const toggle=document.querySelector('.lesson-filter-region .multi-select[data-field="teacher_names"] .multi-select-toggle');toggle.click();requestAnimationFrame(()=>requestAnimationFrame(()=>{const value={filterSyncMs,filterAndMenuMs:performance.now()-t,filteredRows:visibleLessonRows().length};toggle.click();resolve(value);}));},0);updateLessonsViewDom();filterSyncMs=performance.now()-t;})`);
      results.push({ count, ...initial, ...filtering, remainingRenderMs: finish, menus, ...details, ...delta });
      console.log('[lesson-benchmark]', JSON.stringify(results.at(-1)));
    }
    if(process.env.LESSON_PROFILE) console.log('profile',await c.evaluate('lessonProfile'));
    if (verify) { await c.evaluate("lessonFilter.subject='';render();"); await verify(c, results); }
    const result = { recordedAt: new Date().toISOString(), api, firstOpenMs, results, exceptions: c.exceptions, consoleErrors: c.consoleErrors };
    if (process.env.LESSON_BENCHMARK_OUTPUT) fs.writeFileSync(process.env.LESSON_BENCHMARK_OUTPUT, JSON.stringify(result, null, 2));
    return result;
  } finally {
    await chrome?.session.close();
    if (server && server.exitCode == null) { const exit = new Promise(r=>server.once('exit',r)); server.kill(); await Promise.race([exit,new Promise(r=>setTimeout(r,3000))]); }
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
  }
}
module.exports = { benchmark };
if (require.main === module) benchmark().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
