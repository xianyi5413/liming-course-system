const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");

const root = path.resolve(__dirname, "..");
const MONTH = "2026-07-01";
const MIGRATION_NOTE = "从源Excel 2026年6月.xlsx 充值记录上月结转迁移";
const STUDENTS = ["陈曦", "强皓然", "陶雨馨", "许诺扬", "于辰皓", "周以文"];

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
  const studentList = STUDENTS.map((name, index) => `(${9100 + index},'${name}','初一','在读')`).join(",");
  db.exec(`
    UPDATE settings SET value='${MONTH}' WHERE key='month_key';
    INSERT INTO teachers(id,name,status) VALUES (9001,'布局老师','在职');
    INSERT INTO students(id,name,grade,status) VALUES ${studentList};
    INSERT INTO lessons(id,teacher_name,date,lesson_status,time_slot,classroom,grade,subject,student_names,notes,course_status,status,month_key,sort_order) VALUES
      (9201,'布局老师','2026-07-01','上课','08:00-10:00','A1','初一','数学','陈曦','短备注','已上','已上','${MONTH}',1),
      (9202,'布局老师','2026-07-02','上课','10:10-12:10','A1','初一','数学','陈曦','短备注','已上','已上','${MONTH}',2),
      (9203,'布局老师','2026-07-03','上课','21:00-23:00','A1','初一','数学','陈曦','短备注','已上','已上','${MONTH}',3),
      (9204,'布局老师','2026-07-04','上课','23:30-00:30','A1','初一','数学','陈曦','短备注','已上','已上','${MONTH}',4);
    INSERT INTO student_pricing(id,student_name,grade,subject,student_names,custom_price,notes) VALUES
      (9301,'陈曦','初一','数学','["陈曦","强皓然","陈曦","陶雨馨","许诺扬","于辰皓","周以文"]',188,'多人规则'),
      (9302,'强皓然','初一','数学','强皓然',199,'单人规则'),
      (9303,'陶雨馨','初一','数学','',200,'空集合规则');
    INSERT INTO teacher_salary_rules(id,teacher_name,grade,subject,student_names,salary_per_unit,unit_hours,is_active,notes) VALUES
      (9401,'布局老师','初一','数学','陈曦，强皓然；陈曦
陶雨馨、许诺扬,于辰皓;周以文',320,2,1,'多人薪资规则'),
      (9402,'布局老师','初一','数学','陈曦',300,2,1,'单人薪资规则');
    INSERT INTO student_opening_balances(id,student_name,grade,opening_actual_balance,opening_gift_balance,notes)
      VALUES (9501,'陈曦','初一',500,50,'${MIGRATION_NOTE}');
    INSERT INTO recharge_records(id,student_name,grade,cur_recharge,cur_gift,recharge_date,notes,source,channel,channel_other,month_key)
      VALUES (9601,'陈曦','初一',1000,100,'2026-07-03','布局充值','manual','wechat','','${MONTH}');
  `);
}

async function withBrowser(action) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-table-cell-layout-"));
  const database = path.join(tempRoot, "synthetic.sqlite");
  const environment = {
    ...process.env,
    DATA_DIR: tempRoot,
    DB_PATH: database,
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
  const db = new DatabaseSync(database);
  seed(db);
  db.close();
  const port = await freePort();
  let stderr = "";
  const server = spawn(process.execPath, [path.join(root, "src/server.js")], {
    cwd: root,
    env: { ...environment, PORT: String(port) },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  server.stderr.on("data", (chunk) => { stderr += String(chunk); });
  let chrome;
  try {
    await waitForServer(server, port, () => stderr);
    chrome = await launchChrome(path.join(tempRoot, "chrome-profile"));
    await chrome.session.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await action(chrome.session);
  } finally {
    if (chrome) {
      await chrome.session.close();
      if (chrome.child.exitCode == null) chrome.child.kill("SIGTERM");
    }
    if (server.exitCode == null) server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
    try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {}
  }
}

async function openView(browser, group, view, rowSelector) {
  if (!await browser.evaluate(`Boolean(document.querySelector('.nav-sub-btn[data-view="${view}"]'))`)) {
    await browser.click(`.nav-btn[data-nav-group="${group}"]`);
  }
  await browser.waitFor(`Boolean(document.querySelector('.nav-sub-btn[data-view="${view}"]'))`);
  await browser.click(`.nav-sub-btn[data-view="${view}"]`);
  if (rowSelector) await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(rowSelector)}))`);
}

async function viewport(browser, width) {
  await browser.send("Emulation.setDeviceMetricsOverride", {
    width,
    height: width === 390 ? 844 : 900,
    deviceScaleFactor: 1,
    mobile: width === 390,
  });
  await browser.evaluate("window.dispatchEvent(new Event('resize'))");
  await new Promise((resolve) => setTimeout(resolve, 80));
}

test("target tables keep short fields complete, wrap bounded long fields and delegate narrow overflow to the outer wrapper", async () => withBrowser(async (browser) => {
  await browser.login("boss", "123456");

  await openView(browser, "students", "feeDetails", ".fee-detail-table tbody tr");
  for (const width of [1440, 1280, 1024, 390]) {
    await viewport(browser, width);
    const layout = await browser.evaluate(`(() => {
      const cells=[...document.querySelectorAll('.fee-detail-table tbody tr td:nth-child(6)')];
      const wrap=document.querySelector('.fee-detail-scroll');
      const table=document.querySelector('.fee-detail-table');
      return {
        values:cells.map((cell)=>cell.textContent.trim()),
        widths:cells.map((cell)=>cell.getBoundingClientRect().width),
        complete:cells.every((cell)=>cell.scrollWidth<=cell.clientWidth+1),
        styles:cells.map((cell)=>{const style=getComputedStyle(cell);return {whiteSpace:style.whiteSpace,textOverflow:style.textOverflow,overflowX:style.overflowX,textAlign:style.textAlign,verticalAlign:style.verticalAlign,fontSize:style.fontSize};}),
        outerScrollable:table.scrollWidth>wrap.clientWidth,
        outerOverflow:getComputedStyle(wrap).overflowX,
        pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
      };
    })()`);
    assert.deepEqual(layout.values, ["08:00-10:00", "10:10-12:10", "21:00-23:00", "23:30-00:30"]);
    assert.equal(layout.widths.every((value) => value >= 127.5), true);
    assert.equal(layout.complete, true);
    assert.equal(layout.styles.every((style) => style.whiteSpace === "nowrap" && style.textOverflow !== "ellipsis" && style.overflowX !== "auto" && style.textAlign === "center" && style.verticalAlign === "middle"), true);
    assert.equal(new Set(layout.styles.map((style) => style.fontSize)).size, 1);
    if (width === 390) {
      assert.equal(layout.outerScrollable, true);
      assert.match(layout.outerOverflow, /auto|scroll/);
    }
    assert.equal(layout.pageOverflow, false);
  }

  await openView(browser, "students", "recharges", ".recharge-row");
  assert.deepEqual(
    await browser.evaluate("[...document.querySelectorAll('.recharge-table thead th')].map((cell)=>cell.textContent.trim()||'选择')"),
    ["选择", "学生姓名", "年级", "本月实际充值", "本月赠送充值", "充值日期", "来源/渠道", "备注"],
  );
  assert.equal(await browser.evaluate("document.querySelector('.recharge-row').children.length"), 8);
  assert.equal(await browser.evaluate("Boolean(document.querySelector('.edit-recharge-record'))"), false);
  assert.equal(await browser.evaluate("document.querySelector('.recharge-channel-cell')?.getAttribute('role')"), "button");

  await openView(browser, "students", "openingBalances", ".opening-balance-row");
  for (const width of [1440, 1280, 1024, 390]) {
    await viewport(browser, width);
    const layout = await browser.evaluate(`(() => {
      const table=document.querySelector('.opening-balance-table');
      const wrap=table.closest('.table-wrap');
      const cell=document.querySelector('.opening-balance-notes-cell');
      const input=document.querySelector('.opening-balance-notes-input');
      const style=getComputedStyle(cell);
      const inputStyle=getComputedStyle(input);
      const canvas=document.createElement('canvas');
      const context=canvas.getContext('2d');
      context.font=inputStyle.font;
      const textWidth=context.measureText(input.value).width;
      return {
        value:input.value,
        cellWidth:cell.getBoundingClientRect().width,
        textFits:textWidth+20<=input.clientWidth+1,
        wrappedComplete:input.scrollWidth<=input.clientWidth+1,
        whiteSpace:inputStyle.whiteSpace,
        textOverflow:style.textOverflow,
        cellOverflow:style.overflowX,
        rowHeight:cell.closest('tr').getBoundingClientRect().height,
        outerScrollable:table.scrollWidth>wrap.clientWidth,
        outerOverflow:getComputedStyle(wrap).overflowX,
        fillsWidth:table.getBoundingClientRect().width+1>=wrap.clientWidth,
        pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
      };
    })()`);
    assert.equal(layout.value, MIGRATION_NOTE);
    assert.equal(layout.textFits, false);
    assert.equal(layout.wrappedComplete, true);
    assert.equal(layout.whiteSpace, "pre-wrap");
    assert.notEqual(layout.textOverflow, "ellipsis");
    assert.doesNotMatch(layout.cellOverflow, /auto|scroll/);
    assert.ok(layout.rowHeight >= 36);
    if (width === 390) {
      assert.equal(layout.outerScrollable, true);
      assert.match(layout.outerOverflow, /auto|scroll/);
    }
    assert.equal(layout.pageOverflow, false);
  }

  await viewport(browser, 1440);
  await openView(browser, "students", "studentPricing", ".student-pricing-rule-row");
  const pricing = await browser.evaluate(`(() => {
    const rows=[...document.querySelectorAll('.student-pricing-rule-row')];
    const byNote=(value)=>rows.find((row)=>row.querySelector('[data-field="notes"]')?.value===value);
    const multi=byNote('多人规则');
    const single=byNote('单人规则');
    if (!multi||!single) return { missing:rows.map((row)=>({id:row.dataset.ruleId,note:row.querySelector('[data-field="notes"]')?.value||'',text:row.textContent})) };
    const cell=multi.querySelector('.student-set-cell');
    const value=cell.querySelector('.student-set-badges');
    const style=getComputedStyle(value);
    return {
      text:value.textContent,
      empty:studentSetInlineText([]),
      normalizedCases:[
        studentSetInlineText(['甲',' 乙 ','甲']),
        studentSetInlineText('["甲","乙","甲"]'),
        studentSetInlineText('甲，乙；甲\\n丙'),
      ],
      badges:cell.querySelectorAll('.student-badge').length,
      whiteSpace:style.whiteSpace,
      flexWrap:style.flexWrap,
      overflowX:style.overflowX,
      textOverflow:style.textOverflow,
      complete:value.scrollWidth<=value.getBoundingClientRect().width+1,
      heightDelta:Math.abs(multi.getBoundingClientRect().height-single.getBoundingClientRect().height),
    };
  })()`);
  assert.equal(pricing.missing, undefined, JSON.stringify(pricing.missing || []));
  assert.equal(pricing.text, STUDENTS.join(""));
  assert.equal(pricing.empty, "—");
  assert.deepEqual(pricing.normalizedCases, ["甲、乙", "甲、乙", "甲、乙、丙"]);
  assert.deepEqual({ badges: pricing.badges, whiteSpace: pricing.whiteSpace, flexWrap: pricing.flexWrap, overflowX: pricing.overflowX, complete: pricing.complete }, { badges: STUDENTS.length, whiteSpace: "normal", flexWrap: "wrap", overflowX: "hidden", complete: true });
  assert.notEqual(pricing.textOverflow, "ellipsis");
  await browser.click(".student-pricing-select-row");
  assert.equal(await browser.evaluate("document.querySelector('.open-student-pricing-batch-modal').disabled"), false);
  await viewport(browser, 390);
  assert.deepEqual(await browser.evaluate(`(() => { const table=document.querySelector('.student-pricing-table'); const wrap=table.closest('.table-wrap'); return { outer:table.scrollWidth>wrap.clientWidth, overflow:getComputedStyle(wrap).overflowX, page:document.documentElement.scrollWidth>document.documentElement.clientWidth }; })()`), { outer: true, overflow: "auto", page: false });

  await viewport(browser, 1440);
  await openView(browser, "teachers", "teacherSalaryRules", ".teacher-salary-rule-row");
  const salary = await browser.evaluate(`(() => {
    const rows=[...document.querySelectorAll('.teacher-salary-rule-row')];
    const byNote=(value)=>rows.find((row)=>row.querySelector('[data-field="notes"]')?.value===value);
    const multi=byNote('多人薪资规则');
    const single=byNote('单人薪资规则');
    if (!multi||!single) return { missing:rows.map((row)=>({id:row.dataset.ruleId,note:row.querySelector('[data-field="notes"]')?.value||'',text:row.textContent})) };
    const cell=multi.querySelector('.student-set-cell');
    const value=cell.querySelector('.student-set-badges');
    const style=getComputedStyle(value);
    return {
      text:value.textContent,
      badges:cell.querySelectorAll('.student-badge').length,
      whiteSpace:style.whiteSpace,
      flexWrap:style.flexWrap,
      overflowX:style.overflowX,
      textOverflow:style.textOverflow,
      complete:value.scrollWidth<=value.getBoundingClientRect().width+1,
      heightDelta:Math.abs(multi.getBoundingClientRect().height-single.getBoundingClientRect().height),
    };
  })()`);
  assert.equal(salary.missing, undefined, JSON.stringify(salary.missing || []));
  assert.equal(salary.text, STUDENTS.join(""));
  assert.deepEqual({ badges: salary.badges, whiteSpace: salary.whiteSpace, flexWrap: salary.flexWrap, overflowX: salary.overflowX, complete: salary.complete }, { badges: STUDENTS.length, whiteSpace: "normal", flexWrap: "wrap", overflowX: "hidden", complete: true });
  assert.notEqual(salary.textOverflow, "ellipsis");
  await browser.click(".teacher-salary-rule-select-row");
  assert.equal(await browser.evaluate("document.querySelector('.open-teacher-salary-rule-batch-modal').disabled"), false);
  await viewport(browser, 390);
  assert.deepEqual(await browser.evaluate(`(() => { const table=document.querySelector('.teacher-salary-rule-table'); const wrap=table.closest('.table-wrap'); return { outer:table.scrollWidth>wrap.clientWidth, overflow:getComputedStyle(wrap).overflowX, page:document.documentElement.scrollWidth>document.documentElement.clientWidth }; })()`), { outer: true, overflow: "auto", page: false });

  assert.deepEqual(browser.exceptions, []);
  assert.deepEqual(browser.consoleErrors, []);
}));
