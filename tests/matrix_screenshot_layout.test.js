const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");

const root = path.resolve(__dirname, "..");
const DAY = "2026-07-27";

async function waitForServer(server, port, stderr) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) throw new Error(`server exited: ${stderr()}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not start: ${stderr()}`);
}

function seed(db) {
  db.exec(`
    UPDATE settings SET value='2026-07-01' WHERE key='month_key';
    INSERT INTO teachers(id,name,status) VALUES (97101,'矩阵老师','在职');
    INSERT INTO students(id,name,grade,status) VALUES
      (97201,'张小明','初一','在读'),
      (97202,'李小红','初一','在读'),
      (97203,'王小强','初一','在读');
    INSERT INTO class_groups(id,teacher,grade,subject,students_key,students_display,class_name) VALUES
      (97301,'矩阵老师','初一','数学','张小明|李小红|王小强','张小明,李小红,王小强','数学班'),
      (97302,'矩阵老师','初一','物理','张小明|李小红|王小强','张小明,李小红,王小强','物理班');
    INSERT INTO lessons(id,teacher_name,date,lesson_status,time_slot,classroom,grade,subject,student_names,notes,course_status,status,month_key,sort_order) VALUES
      (97401,'矩阵老师','${DAY}','上课','09:00-11:00','A1','初一','数学','张小明,李小红,王小强','三位学生与较长备注用于验证卡片高度自然增长','已上','已上','2026-07-01',1),
      (97402,'矩阵老师','${DAY}','上课','13:00-15:00','A1','初一','物理','张小明,李小红,王小强','','已上','已上','2026-07-01',2);
  `);
}

async function withBrowser(action) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-matrix-shot-"));
  const database = path.join(tempRoot, "data.sqlite");
  const environment = { ...process.env, DATA_DIR: tempRoot, DB_PATH: database, SESSION_COOKIE_SECURE: "false", BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "" };
  const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], { cwd: root, env: environment, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(database); seed(db); db.close();
  const port = await freePort();
  let stderr = "";
  const server = spawn(process.execPath, [path.join(root, "src/server.js")], { cwd: root, env: { ...environment, PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  server.stderr.on("data", (chunk) => { stderr += String(chunk); });
  let chrome;
  try {
    await waitForServer(server, port, () => stderr);
    chrome = await launchChrome(path.join(tempRoot, "chrome-profile"));
    await chrome.session.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await action(chrome.session);
  } finally {
    if (chrome) { await chrome.session.close(); if (chrome.child.exitCode == null) chrome.child.kill("SIGTERM"); }
    if (server.exitCode == null) server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
    try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {}
  }
}

async function openView(browser, group, view) {
  if (!await browser.evaluate(`Boolean(document.querySelector('.nav-sub-btn[data-view="${view}"]'))`)) await browser.click(`.nav-btn[data-nav-group="${group}"]`);
  await browser.waitFor(`Boolean(document.querySelector('.nav-sub-btn[data-view="${view}"]'))`);
  await browser.click(`.nav-sub-btn[data-view="${view}"]`);
}

async function viewport(browser, width) {
  await browser.send("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: width === 390 });
  await browser.evaluate("window.dispatchEvent(new Event('resize'))");
  await new Promise((resolve) => setTimeout(resolve, 80));
}

test("matrix cards share one measured width and keep metadata, height and overflow contracts", async () => withBrowser(async (browser) => {
  await browser.login("boss", "123456");
  await openView(browser, "schedule", "weekMatrix");
  await browser.waitFor("document.querySelectorAll('.matrix-lesson-card').length >= 2");
  const widths = {};
  for (const mode of ["time", "teacher", "classroom"]) {
    await browser.click(`.matrix-view-tab[data-matrix-view="${mode}"]`);
    await browser.waitFor(`document.querySelector('.matrix-view-tab[data-matrix-view="${mode}"]').classList.contains('active') && document.querySelectorAll('.matrix-lesson-card').length >= 2`);
    widths[mode] = await browser.evaluate(`(() => {
      const cards=[...document.querySelectorAll('.matrix-lesson-card')];
      const first=cards[0], last=cards.at(-1), cell=first.closest('td,.week-grid-sparse-cell');
      const rect=first.getBoundingClientRect(), cellRect=cell.getBoundingClientRect();
      const wrap=document.querySelector('.week-grid-scroll');
      const metadata=document.querySelector('.matrix-lesson-card-badges');
      const badges=metadata?[...metadata.children].map((node)=>node.getBoundingClientRect()):[];
      return {
        width:rect.width,
        variable:getComputedStyle(first).getPropertyValue('--matrix-lesson-card-width').trim(),
        heights:cards.map((card)=>card.getBoundingClientRect().height),
        contained:rect.left>=cellRect.left-1 && rect.right<=cellRect.right+1,
        metadata:metadata?{display:getComputedStyle(metadata).display,flexWrap:getComputedStyle(metadata).flexWrap,count:badges.length,sameLine:badges.every((box)=>Math.abs(box.top-badges[0].top)<1)}:null,
        text:first.textContent,
        cardGap:cards.length>1 ? last.getBoundingClientRect().top-first.getBoundingClientRect().bottom : 0,
        outerOverflow:wrap?getComputedStyle(wrap).overflowX:'',
      };
    })()`);
    assert.equal(widths[mode].width, 196);
    assert.equal(widths[mode].variable, "196px");
    assert.equal(widths[mode].contained, true);
    assert.match(widths[mode].text, /初一/);
    assert.match(widths[mode].text, /数学/);
    assert.match(widths[mode].text, /已上/);
    assert.match(widths[mode].text, /张小明/);
    assert.match(widths[mode].text, /矩阵老师|A1/);
    assert.equal(Math.max(...widths[mode].heights) > Math.min(...widths[mode].heights), true);
    assert.match(widths[mode].outerOverflow, /auto|scroll/);
    if (mode !== "time") {
      assert.equal(["flex", "inline-flex"].includes(widths[mode].metadata.display), true);
      assert.deepEqual({ flexWrap: widths[mode].metadata.flexWrap, count: widths[mode].metadata.count, sameLine: widths[mode].metadata.sameLine }, { flexWrap: "nowrap", count: 3, sameLine: true });
    }
  }
  assert.equal(Math.max(widths.time.width, widths.teacher.width, widths.classroom.width) - Math.min(widths.time.width, widths.teacher.width, widths.classroom.width), 0);

  for (const width of [1440, 1280, 1024, 390]) {
    await viewport(browser, width);
    for (const mode of ["time", "teacher", "classroom"]) {
      await browser.click(`.matrix-view-tab[data-matrix-view="${mode}"]`);
      const result = await browser.evaluate(`(() => {
        const card=document.querySelector('.matrix-lesson-card'), cell=card.closest('td,.week-grid-sparse-cell'), wrap=document.querySelector('.week-grid-scroll');
        const r=card.getBoundingClientRect(), c=cell.getBoundingClientRect();
        return {width:r.width,contained:r.left>=c.left-1&&r.right<=c.right+1,outerScrollable:wrap.scrollWidth>wrap.clientWidth,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
      })()`);
      assert.equal(result.width, 196);
      assert.equal(result.contained, true);
      if (width === 390) assert.equal(result.outerScrollable, true);
      assert.equal(result.pageOverflow, false);
    }
  }
  assert.deepEqual(browser.exceptions, []);
  assert.deepEqual(browser.consoleErrors, []);
}));

test("parent and teacher preview, copy identity and PNG share one stable identity-row model", async () => withBrowser(async (browser) => {
  await browser.login("boss", "123456");
  await openView(browser, "schedule", "courseNotice");
  await browser.waitFor("Boolean(courseNoticeState.data?.send_objects?.length)");
  const result = await browser.evaluate(`(() => {
    const lesson={teacher_name:'矩阵老师',grade:'初一',subject:'数学',student_names:'张小明,李小红,王小强'};
    const personal={send_object_key:'PERSONAL_ALL|张小明',send_object_type:'个人发送',send_object_name:'张小明',students:['张小明'],grades:['初一'],subjects:['数学'],teachers:['矩阵老师'],lessons:[lesson]};
    const klass={send_object_type:'班级',send_object_name:'数学班',students:['张小明','李小红','张小明','王小强'],grades:['初一'],subjects:['数学'],teachers:['矩阵老师'],lessons:[lesson]};
    const merged={send_object_type:'班级合并发送',send_object_name:'合并班',students:['张小明','李小红','王小强','李小红'],grades:['初二','初一','初二'],subjects:['物理','数学','物理'],teachers:['矩阵老师'],lessons:[lesson]};
    const teacher={send_object_type:'老师',send_object_name:'矩阵老师',teachers:['矩阵老师'],grades:['初一'],subjects:['数学'],lessons:[lesson]};
    const inspect=(item,mode)=>{const rows=courseNoticeIdentityRows(item,mode);const canvas=courseNoticeCanvas(item,mode);return {rows,html:courseNoticeIdentityMarkup(item,mode),canvasRows:JSON.parse(canvas.dataset.noticeIdentity),png:canvas.toDataURL('image/png').startsWith('data:image/png;base64,'),size:[canvas.width,canvas.height]};};
    return {personal:inspect(personal,'parent'),klass:inspect(klass,'parent'),merged:inspect(merged,'parent'),teacher:inspect(teacher,'teacher')};
  })()`);
  assert.deepEqual(result.personal.rows.map((row) => row.badges.map((badge) => badge.label)), [["张小明", "初一", "数学"]]);
  assert.doesNotMatch(result.personal.html, /李小红|王小强/);
  assert.deepEqual(result.klass.rows.map((row) => row.badges.map((badge) => badge.label)), [["张小明", "李小红", "王小强"], ["初一", "数学"]]);
  assert.deepEqual(result.merged.rows.map((row) => row.badges.map((badge) => badge.label)), [["张小明", "李小红", "王小强"], ["初一", "初二", "数学", "物理"]]);
  assert.deepEqual(result.teacher.rows[0].badges.map((badge) => badge.label), ["矩阵老师"]);
  for (const item of Object.values(result)) {
    assert.deepEqual(item.canvasRows, item.rows);
    assert.equal(item.png, true);
    assert.equal(item.size.every((value) => value > 0), true);
  }

  await browser.click('.course-notice-layout-toggle[data-layout="simple"]');
  await browser.waitFor("Boolean(document.querySelector('.notice-simple-mode .notice-card-identity-row'))");
  assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.notice-simple-mode .notice-card-identity-personal')).flexWrap"), "nowrap");
  await browser.click('.course-notice-layout-toggle[data-layout="preview"]');
  await browser.waitFor("Boolean(document.querySelector('.notice-shot-preview .notice-card-identity'))");

  await openView(browser, "schedule", "teacherCourseNotice");
  await browser.waitFor("Boolean(teacherCourseNoticeState.data?.send_objects?.length)");
  await browser.click('.teacher-course-notice-layout-toggle[data-layout="simple"]');
  await browser.waitFor("Boolean(document.querySelector('.teacher-notice-simple-tile .notice-card-identity-row'))");
  assert.equal(await browser.evaluate("document.querySelector('.teacher-notice-simple-tile .notice-card-identity-row')?.textContent.includes('矩阵老师')"), true);
  await browser.click('.teacher-course-notice-layout-toggle[data-layout="preview"]');
  await browser.waitFor("Boolean(document.querySelector('.notice-shot-preview .notice-card-identity'))");
  assert.equal(await browser.evaluate("document.querySelector('.notice-shot-preview .notice-card-identity-row')?.textContent.includes('矩阵老师')"), true);
  assert.deepEqual(browser.exceptions, []);
  assert.deepEqual(browser.consoleErrors, []);
}));
