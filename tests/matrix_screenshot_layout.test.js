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

test("detailed screenshots remove duplicate identity summaries while simple identities, tables and PNG actions stay intact", async () => withBrowser(async (browser) => {
  await browser.login("boss", "123456");
  await openView(browser, "schedule", "courseNotice");
  await browser.waitFor("Boolean(courseNoticeState.data?.send_objects?.length)");
  const result = await browser.evaluate(`(() => {
    const lesson={teacher_name:'矩阵老师',date:'2026-07-27',weekday:'星期一',time_slot:'09:00-11:00',classroom:'A1',status:'已上',grade:'初一',subject:'数学',student_names:'张小明,李小红,王小强'};
    const personal={send_object_key:'PERSONAL_ALL|张小明',send_object_type:'个人发送',send_object_name:'张小明',students:['张小明'],grades:['初一'],subjects:['数学'],teachers:['矩阵老师'],lessons:[lesson]};
    const klass={send_object_type:'班级',send_object_name:'数学班',students:['张小明','李小红','张小明','王小强'],grades:['初一'],subjects:['数学'],teachers:['矩阵老师'],lessons:[lesson]};
    const merged={send_object_type:'班级合并发送',send_object_name:'合并班',students:['张小明','李小红','王小强','李小红'],grades:['初二','初一','初二'],subjects:['物理','数学','物理'],teachers:['矩阵老师'],lessons:[lesson]};
    const teacher={send_object_type:'老师',send_object_name:'矩阵老师',teachers:['矩阵老师'],grades:['初一'],subjects:['数学'],lessons:[lesson]};
    const inspect=(item,mode)=>{
      const simpleRows=courseNoticeIdentityRows(item,mode,{includeRecipientSummary:true});
      const detailedRows=courseNoticeIdentityRows(item,mode,{includeRecipientSummary:false});
      const simpleCanvas=courseNoticeCanvas(item,mode,mode==='teacher'?'本周课程安排':'课程通知',{layoutMode:'simple'});
      const detailedCanvas=courseNoticeCanvas(item,mode,mode==='teacher'?'本周课程安排':'课程通知',{layoutMode:'preview'});
      return {
        simpleRows,
        detailedRows,
        simpleHtml:courseNoticeIdentityMarkup(item,mode,{includeRecipientSummary:true}),
        detailedHtml:courseNoticeIdentityMarkup(item,mode,{includeRecipientSummary:false}),
        simpleCanvasRows:JSON.parse(simpleCanvas.dataset.noticeIdentity),
        detailedCanvasRows:JSON.parse(detailedCanvas.dataset.noticeIdentity),
        simplePng:simpleCanvas.toDataURL('image/png').startsWith('data:image/png;base64,'),
        detailedPng:detailedCanvas.toDataURL('image/png').startsWith('data:image/png;base64,'),
        simpleSize:[simpleCanvas.width,simpleCanvas.height],
        detailedSize:[detailedCanvas.width,detailedCanvas.height],
      };
    };
    return {personal:inspect(personal,'parent'),klass:inspect(klass,'parent'),merged:inspect(merged,'parent'),teacher:inspect(teacher,'teacher')};
  })()`);
  assert.deepEqual(result.personal.simpleRows.map((row) => row.badges.map((badge) => badge.label)), [["张小明", "初一", "数学"]]);
  assert.doesNotMatch(result.personal.simpleHtml, /李小红|王小强/);
  assert.deepEqual(result.klass.simpleRows.map((row) => row.badges.map((badge) => badge.label)), [["张小明", "李小红", "王小强"], ["初一", "数学"]]);
  assert.deepEqual(result.merged.simpleRows.map((row) => row.badges.map((badge) => badge.label)), [["张小明", "李小红", "王小强"], ["初一", "初二", "数学", "物理"]]);
  assert.deepEqual(result.teacher.simpleRows.map((row) => row.badges.map((badge) => badge.label)), [["矩阵老师"], ["张小明", "李小红", "王小强"], ["初一", "数学"]]);
  assert.deepEqual(result.personal.detailedRows, []);
  assert.deepEqual(result.klass.detailedRows, []);
  assert.deepEqual(result.merged.detailedRows, []);
  assert.deepEqual(result.teacher.detailedRows, []);
  assert.equal(result.personal.detailedHtml, "");
  assert.equal(result.teacher.detailedHtml, "");
  assert.doesNotMatch(result.teacher.detailedHtml, /张小明|李小红|王小强|初一|数学/);
  for (const item of Object.values(result)) {
    assert.deepEqual(item.simpleCanvasRows, item.simpleRows);
    assert.deepEqual(item.detailedCanvasRows, item.detailedRows);
    assert.equal(item.simplePng, true);
    assert.equal(item.detailedPng, true);
    assert.equal(item.simpleSize.every((value) => value > 0), true);
    assert.equal(item.detailedSize.every((value) => value > 0), true);
    assert.equal(item.detailedSize[1] < item.simpleSize[1], true);
  }
  assert.equal(result.personal.simpleSize[1] - result.personal.detailedSize[1], 46);
  assert.equal(result.klass.simpleSize[1] - result.klass.detailedSize[1], 80);
  assert.equal(result.merged.simpleSize[1] - result.merged.detailedSize[1], 80);
  assert.equal(result.teacher.simpleSize[1] - result.teacher.detailedSize[1], 114);

  const parentCounts = await browser.evaluate(`courseNoticeState.data.send_objects.map((item)=>({
    key:item.send_object_key,
    type:item.send_object_type,
    lessons:item.lessons.length,
    columns:courseNoticeColumns('parent').map(([key])=>key),
  }))`);
  const parentDetailed = await browser.evaluate(`(() => {
    const previews=[...document.querySelectorAll('.notice-shot-preview')];
    return previews.map((preview)=>{
      const shell=preview.querySelector('.notice-shot-shell');
      const head=shell.querySelector('.notice-shot-head');
      const table=shell.querySelector('.notice-shot-table');
      return {
        title:shell.querySelector('.notice-shot-title')?.textContent.trim(),
        identityCount:shell.querySelectorAll(':scope > .notice-card-identity').length,
        order:[...shell.children].map((node)=>node.className),
        gap:Math.round((table.getBoundingClientRect().top-head.getBoundingClientRect().bottom)*100)/100,
        headers:[...table.querySelectorAll('th')].map((node)=>node.textContent.trim()),
        rowCount:table.querySelectorAll('tbody tr').length,
      };
    });
  })()`);
  assert.equal(parentDetailed.length, parentCounts.length);
  for (let index = 0; index < parentDetailed.length; index += 1) {
    assert.equal(parentDetailed[index].title, "课程通知");
    assert.equal(parentDetailed[index].identityCount, 0);
    assert.deepEqual(parentDetailed[index].order, ["notice-shot-head", "notice-shot-table"]);
    assert.equal(Math.abs(parentDetailed[index].gap) <= 1, true);
    assert.deepEqual(parentDetailed[index].headers, ["授课老师", "日期", "星期", "时间", "教室", "状态", "年级", "科目", "学生"]);
    assert.equal(parentDetailed[index].rowCount, parentCounts[index].lessons);
  }

  await browser.click('.course-notice-layout-toggle[data-layout="simple"]');
  await browser.waitFor("Boolean(document.querySelector('.notice-simple-mode .notice-card-identity-row'))");
  assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.notice-simple-mode .notice-card-identity-personal')).flexWrap"), "nowrap");
  assert.deepEqual(await browser.evaluate("courseNoticeState.data.send_objects.map((item)=>({key:item.send_object_key,type:item.send_object_type,lessons:item.lessons.length,columns:courseNoticeColumns('parent').map(([key])=>key)}))"), parentCounts);
  for (const width of [1440, 1280, 1024, 390]) {
    await viewport(browser, width);
    for (const layout of ["preview", "simple"]) {
      await browser.click(`.course-notice-layout-toggle[data-layout="${layout}"]`);
      await browser.waitFor(`courseNoticeLayoutMode==="${layout}"`);
      const dimensions = await browser.evaluate(`(() => {
        const previews=[...document.querySelectorAll('.notice-shot-preview')];
        const badges=[...document.querySelectorAll('.notice-preview-mode .entity-badge,.notice-simple-mode .entity-badge')];
        return {
          pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
          previewClipped:previews.some((node)=>node.scrollWidth<node.querySelector('.notice-shot-shell').scrollWidth),
          invalidBadges:badges.some((node)=>node.getBoundingClientRect().width<=0||node.getBoundingClientRect().height<=0),
        };
      })()`);
      assert.deepEqual(dimensions, { pageOverflow: false, previewClipped: false, invalidBadges: false });
    }
  }
  await browser.click('.course-notice-layout-toggle[data-layout="preview"]');
  await browser.waitFor("Boolean(document.querySelector('.notice-shot-preview .notice-shot-table'))");
  assert.equal(await browser.evaluate("document.querySelectorAll('.notice-shot-preview > .notice-shot-shell > .notice-card-identity').length"), 0);

  await openView(browser, "schedule", "teacherCourseNotice");
  await browser.waitFor("Boolean(teacherCourseNoticeState.data?.send_objects?.length)&&Boolean(document.querySelector('.teacher-course-notice-layout-toggle'))");
  const teacherCounts = await browser.evaluate("teacherCourseNoticeState.data.send_objects.map((item)=>({key:item.send_object_key,lessons:item.lessons.length}))");
  const teacherDetailed = await browser.evaluate(`(() => {
    const previews=[...document.querySelectorAll('.notice-shot-preview')];
    return previews.map((preview)=>{
      const shell=preview.querySelector('.notice-shot-shell');
      const identity=shell.querySelector('.notice-card-identity');
      const rows=identity?[...identity.querySelectorAll('.notice-card-identity-row')]:[];
      const table=shell.querySelector('.notice-shot-table');
      return {
        title:shell.querySelector('.notice-shot-title')?.textContent.trim(),
        order:[...shell.children].map((node)=>node.className),
        identityRows:rows.map((row)=>({key:row.className,text:row.textContent.trim()})),
        headers:[...table.querySelectorAll('th')].map((node)=>node.textContent.trim()),
        rowCount:table.querySelectorAll('tbody tr').length,
      };
    });
  })()`);
  assert.equal(teacherDetailed.length, teacherCounts.length);
  for (let index = 0; index < teacherDetailed.length; index += 1) {
    assert.equal(teacherDetailed[index].title, "本周课程安排");
    assert.deepEqual(teacherDetailed[index].order, ["notice-shot-head", "notice-shot-table"]);
    assert.equal(teacherDetailed[index].identityRows.length, 0);
    assert.deepEqual(teacherDetailed[index].headers, ["授课老师", "日期", "星期", "时间", "教室", "状态", "年级", "科目", "学生"]);
    assert.equal(teacherDetailed[index].rowCount, teacherCounts[index].lessons);
  }
  await browser.click('.teacher-course-notice-layout-toggle[data-layout="simple"]');
  await browser.waitFor("Boolean(document.querySelector('.teacher-notice-simple-tile .notice-card-identity-row'))");
  assert.equal(await browser.evaluate("document.querySelector('.teacher-notice-simple-tile .notice-card-identity-row')?.textContent.includes('矩阵老师')"), true);
  assert.equal(await browser.evaluate("document.querySelector('.teacher-notice-simple-tile')?.textContent.includes('张小明')"), true);
  assert.equal(await browser.evaluate("document.querySelector('.teacher-notice-simple-tile')?.textContent.includes('初一')"), true);
  assert.equal(await browser.evaluate("document.querySelector('.teacher-notice-simple-tile')?.textContent.includes('数学')"), true);
  assert.deepEqual(await browser.evaluate("teacherCourseNoticeState.data.send_objects.map((item)=>({key:item.send_object_key,lessons:item.lessons.length}))"), teacherCounts);
  await browser.click('.teacher-course-notice-layout-toggle[data-layout="preview"]');
  await browser.waitFor("Boolean(document.querySelector('.notice-shot-preview .notice-shot-table'))");
  assert.equal(await browser.evaluate("document.querySelectorAll('.notice-shot-preview .notice-card-identity-row').length"), 0);

  for (const width of [1440, 1280, 1024, 390]) {
    await viewport(browser, width);
    for (const layout of ["preview", "simple"]) {
      await browser.click(`.teacher-course-notice-layout-toggle[data-layout="${layout}"]`);
      await browser.waitFor(`teacherCourseNoticeLayoutMode==="${layout}"`);
      const dimensions = await browser.evaluate(`(() => {
        const root=document.querySelector('.teacher-course-notice-content');
        const previews=[...root.querySelectorAll('.notice-shot-preview')];
        const badges=[...root.querySelectorAll('.entity-badge')];
        return {
          pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
          previewClipped:previews.some((node)=>node.scrollWidth<node.querySelector('.notice-shot-shell').scrollWidth),
          invalidBadges:badges.some((node)=>node.getBoundingClientRect().width<=0||node.getBoundingClientRect().height<=0),
        };
      })()`);
      assert.deepEqual(dimensions, { pageOverflow: false, previewClipped: false, invalidBadges: false });
    }
  }

  await openView(browser, "schedule", "courseNotice");
  await browser.waitFor("Boolean(courseNoticeState.data?.send_objects?.length)");
  await browser.click('.course-notice-layout-toggle[data-layout="preview"]');
  await browser.evaluate(`(() => {
    window.__noticePngActions={downloads:[],copies:[]};
    const originalToDataURL=HTMLCanvasElement.prototype.toDataURL;
    const originalToBlob=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toDataURL=function(...args){
      const value=originalToDataURL.apply(this,args);
      window.__noticePngActions.downloads.push({layout:this.dataset.noticeLayout,identity:JSON.parse(this.dataset.noticeIdentity||'[]'),width:this.width,height:this.height,prefix:value.slice(0,22),bytes:value.length});
      return value;
    };
    HTMLCanvasElement.prototype.toBlob=function(callback,...args){
      return originalToBlob.call(this,(blob)=>{
        window.__noticePngActions.copies.push({layout:this.dataset.noticeLayout,identity:JSON.parse(this.dataset.noticeIdentity||'[]'),width:this.width,height:this.height,type:blob?.type||'',bytes:blob?.size||0});
        callback(blob);
      },...args);
    };
    HTMLAnchorElement.prototype.click=function(){window.__noticeDownload={name:this.download,prefix:this.href.slice(0,22),bytes:this.href.length};};
    Object.defineProperty(window,'ClipboardItem',{configurable:true,value:class{constructor(items){this.items=items;}}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async(items)=>{window.__noticeClipboardItems=items.length;},writeText:async()=>{}}});
  })()`);
  await browser.click(".notice-download-image");
  await browser.waitFor("window.__noticePngActions.downloads.length===1");
  await browser.click(".notice-copy-image");
  await browser.waitFor("window.__noticePngActions.copies.length===1");
  const parentActions = await browser.evaluate("({actions:window.__noticePngActions,download:window.__noticeDownload,clipboardItems:window.__noticeClipboardItems})");
  assert.equal(parentActions.actions.downloads[0].layout, "preview");
  assert.deepEqual(parentActions.actions.downloads[0].identity, []);
  assert.equal(parentActions.actions.downloads[0].prefix, "data:image/png;base64,");
  assert.equal(parentActions.actions.downloads[0].bytes > 100, true);
  assert.equal(parentActions.actions.copies[0].layout, "preview");
  assert.deepEqual(parentActions.actions.copies[0].identity, []);
  assert.equal(parentActions.actions.copies[0].type, "image/png");
  assert.equal(parentActions.actions.copies[0].bytes > 0, true);
  assert.equal(parentActions.download.name.endsWith(".png"), true);
  assert.equal(parentActions.clipboardItems, 1);

  await openView(browser, "schedule", "teacherCourseNotice");
  await browser.waitFor("Boolean(teacherCourseNoticeState.data?.send_objects?.length)&&Boolean(document.querySelector('.teacher-course-notice-layout-toggle'))");
  await browser.click('.teacher-course-notice-layout-toggle[data-layout="preview"]');
  await browser.waitFor("teacherCourseNoticeLayoutMode==='preview'");
  await browser.click(".teacher-notice-download-image");
  await browser.waitFor("window.__noticePngActions.downloads.length===2");
  await browser.click(".teacher-notice-copy-image");
  await browser.waitFor("window.__noticePngActions.copies.length===2");
  const teacherActions = await browser.evaluate("window.__noticePngActions");
  assert.deepEqual(teacherActions.downloads[1].identity, []);
  assert.deepEqual(teacherActions.copies[1].identity, []);
  assert.equal(teacherActions.downloads[1].bytes > 100, true);
  assert.equal(teacherActions.copies[1].bytes > 0, true);
  assert.deepEqual(browser.exceptions, []);
  assert.deepEqual(browser.consoleErrors, []);
}));
