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
const LONG_STUDENT = "拥有较长姓名的学生甲";
const LONG_NOTE = "从Excel迁移的完整期初余额备注，需保持单行并由内容决定列宽";

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
    UPDATE settings SET value='${MONTH}' WHERE key='month_key';
    INSERT INTO teachers(id,name,status) VALUES (9701,'自适应老师','在职'),(9702,'名字较长的自适应老师','在职');
    INSERT INTO students(id,name,grade,status) VALUES
      (9711,'短名','初一','在读'),(9712,'${LONG_STUDENT}','高三','在读'),
      (9713,'学生乙','高三','在读'),(9714,'学生丙','高三','在读'),(9715,'学生丁','高三','在读');
    INSERT INTO recharge_records(id,student_name,grade,cur_recharge,cur_gift,recharge_date,notes,source,channel,channel_other,month_key) VALUES
      (9721,'短名','初一',0,-12.34,'2026-07-01','短备注','manual','cash','','${MONTH}'),
      (9722,'${LONG_STUDENT}','高三',1234567.89,9876.54,'2026-07-31','${LONG_NOTE}','manual','other','跨行转账及线下收款说明','${MONTH}');
    INSERT INTO student_opening_balances(id,student_name,grade,opening_actual_balance,opening_gift_balance,notes) VALUES
      (9731,'短名','初一',0,-1.25,'短备注'),
      (9732,'${LONG_STUDENT}','高三',1234567.89,8888.88,'${LONG_NOTE}');
    INSERT INTO student_pricing(id,student_name,grade,subject,student_names,custom_price,notes) VALUES
      (9741,'短名','初一','数学','短名',0,'短'),
      (9742,'${LONG_STUDENT}','高三','物理','["${LONG_STUDENT}","学生乙","学生丙","学生丁","学生乙"]',12345.67,'较长的学生单价备注');
    INSERT INTO class_groups(id,teacher,grade,subject,students_key,students_display,class_name) VALUES
      (9751,'自适应老师','初一','数学','短名','短名','一班'),
      (9752,'名字较长的自适应老师','高三','物理','长集合','${LONG_STUDENT}，学生乙；学生丙
学生丁','高三物理自适应测试班');
    INSERT INTO teacher_salary_rules(id,teacher_name,grade,subject,student_names,salary_per_unit,unit_hours,is_active,notes) VALUES
      (9761,'自适应老师','初一','数学','短名',0,2,1,'短'),
      (9762,'名字较长的自适应老师','高三','物理','${LONG_STUDENT}、学生乙，学生丙；学生丁',23456.78,2,1,'较长的薪资规则备注');
  `);
}

async function withBrowser(action) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-adaptive-table-"));
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

async function openView(browser, group, view, tableSelector) {
  if (!await browser.evaluate(`Boolean(document.querySelector('.nav-sub-btn[data-view="${view}"]'))`)) {
    await browser.click(`.nav-btn[data-nav-group="${group}"]`);
  }
  await browser.waitFor(`Boolean(document.querySelector('.nav-sub-btn[data-view="${view}"]'))`);
  await browser.click(`.nav-sub-btn[data-view="${view}"]`);
  await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(`${tableSelector}[data-adaptive-widths]`)}))`);
}

async function viewport(browser, width) {
  await browser.send("Emulation.setDeviceMetricsOverride", {
    width,
    height: width === 390 ? 844 : 900,
    deviceScaleFactor: 1,
    mobile: width === 390,
  });
  await browser.evaluate("window.dispatchEvent(new Event('resize'))");
  await new Promise((resolve) => setTimeout(resolve, 180));
}

async function inspectTable(browser, selector) {
  return browser.evaluate(`(() => {
    const table=document.querySelector(${JSON.stringify(selector)});
    const wrapper=table.closest('.table-wrap');
    const headers=[...table.tHead.rows[0].cells];
    const rows=[...table.tBodies[0].rows].filter((row)=>!row.querySelector('.empty'));
    const cells=rows.flatMap((row)=>[...row.cells]);
    const widths=(table.dataset.adaptiveWidths||'').split(',').map(Number);
    const config=JSON.parse(table.dataset.adaptiveColumnConfig||'[]');
    const canvas=document.createElement('canvas');
    const context=canvas.getContext('2d');
    const headerFits=headers.every((cell)=>{
      const style=getComputedStyle(cell);
      context.font=style.font;
      const padding=(parseFloat(style.paddingLeft)||0)+(parseFloat(style.paddingRight)||0);
      if (cell.classList.contains('adaptive-wrap')) return cell.scrollWidth<=cell.clientWidth+1;
      return cell.getBoundingClientRect().width+1>=context.measureText(cell.textContent.trim()).width+padding;
    });
    const cellFitsDetails=cells.map((cell)=>{
      const input=cell.querySelector(':scope > .cell-input');
      const set=cell.querySelector('.student-set-badges');
      if (set) return set.getBoundingClientRect().right<=cell.getBoundingClientRect().right+1;
      if (input) {
        if (cell.classList.contains('adaptive-wrap')) return input.scrollWidth<=input.clientWidth+1&&input.clientWidth<=cell.clientWidth+1;
        const style=getComputedStyle(input);
        context.font=style.font;
        const padding=(parseFloat(style.paddingLeft)||0)+(parseFloat(style.paddingRight)||0);
        const affordance=input.type==='date'?28:0;
        return context.measureText(input.value||input.placeholder||'').width+padding+affordance<=cell.clientWidth+1;
      }
      return cell.scrollWidth<=cell.clientWidth+1;
    });
    const cellFits=cellFitsDetails.every(Boolean);
    return {
      widths,
      config,
      tableWidth:table.getBoundingClientRect().width,
      wrapperWidth:wrapper.clientWidth,
      headerFits,
      cellFits,
      cellFailures:cellFitsDetails.map((ok,index)=>ok?null:{index,html:cells[index].outerHTML.slice(0,240),cell:[cells[index].clientWidth,cells[index].scrollWidth],input:cells[index].querySelector(':scope > .cell-input')?[cells[index].querySelector(':scope > .cell-input').clientWidth,cells[index].querySelector(':scope > .cell-input').scrollWidth]:null}).filter(Boolean),
      headers:headers.map((cell)=>{const style=getComputedStyle(cell);return {textAlign:style.textAlign,verticalAlign:style.verticalAlign,whiteSpace:style.whiteSpace};}),
      cells:rows[0]?[...rows[0].cells].map((cell)=>{const style=getComputedStyle(cell);return {textAlign:style.textAlign,whiteSpace:style.whiteSpace,overflowX:style.overflowX,textOverflow:style.textOverflow,resize:style.resize};}):[],
      badges:table.querySelectorAll('.student-set-badges .student-badge').length,
      badgeRows:[...table.querySelectorAll('.student-set-badges')].map((set)=>({
        whiteSpace:getComputedStyle(set).whiteSpace,
        flexWrap:getComputedStyle(set).flexWrap,
        complete:set.scrollWidth<=set.getBoundingClientRect().width+1,
      })),
      outerScrollable:table.scrollWidth>wrapper.clientWidth,
      outerOverflow:getComputedStyle(wrapper).overflowX,
      pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
      overflowSources:[...document.querySelectorAll('body *')].map((node)=>({node,rect:node.getBoundingClientRect()})).filter((item)=>item.rect.right>document.documentElement.clientWidth+1).sort((a,b)=>b.rect.right-a.rect.right).slice(0,8).map((item)=>({tag:item.node.tagName,className:item.node.className,right:item.rect.right,width:item.rect.width,scrollWidth:item.node.scrollWidth,clientWidth:item.node.clientWidth})),
    };
  })()`);
}

test("semantic columns cover data-entry, teacher-profile and account tables at every target viewport", async () => withBrowser(async (browser) => {
  await browser.login("boss", "123456");
  const pages = [
    ["students", "recharges", ".recharge-table:not(.opening-balance-table)", ["center", "center", "center", "right", "right", "center", "center", "left"]],
    ["students", "openingBalances", ".opening-balance-table", ["center", "center", "center", "right", "right", "left"]],
    ["students", "studentPricing", ".student-pricing-table", ["center", "center", "center", "center", "left", "right", "center", "left"]],
    ["students", "classGroups", ".class-group-table", ["center", "center", "center", "left", "left"]],
    ["teachers", "teacherSalaryRules", ".teacher-salary-rule-table", ["center", "center", "center", "center", "left", "right", "center", "center", "left"]],
    ["teachers", "teacherProfiles", ".teacher-profile-table", ["center", "center", "center", "center", "center", "center", "left"]],
    ["settings", "userAdmin", ".user-table:not(.role-table)", ["center", "center", "center", "left", "center", "center", "center"]],
  ];
  const results = {};
  for (const [group, view, selector, alignments] of pages) {
    await openView(browser, group, view, selector);
    results[view] = {};
    for (const width of [1440, 1280, 1024, 390]) {
      await viewport(browser, width);
      const layout = await inspectTable(browser, selector);
      results[view][width] = layout.widths;
      assert.equal(layout.widths.length, alignments.length, `${view}/${width}: colgroup`);
      assert.equal(layout.config.length, alignments.length, `${view}/${width}: semantic config`);
      assert.equal(layout.widths.every((value, index) => value >= layout.config[index].minWidth && value <= layout.config[index].maxWidth + 1), true, `${view}/${width}: semantic bounds`);
      assert.equal(layout.headerFits, true, `${view}/${width}: header fit`);
      assert.equal(layout.cellFits, true, `${view}/${width}: cell fit ${JSON.stringify(layout.cellFailures)}`);
      assert.equal(layout.headers.every((item, index) => item.textAlign === "center" && item.verticalAlign === "middle" && item.whiteSpace === (layout.config[index].wrap ? "normal" : "nowrap")), true, `${view}/${width}: headers ${JSON.stringify(layout.headers)}`);
      assert.deepEqual(layout.cells.map((item) => item.textAlign), alignments, `${view}/${width}: body alignment`);
      assert.equal(layout.cells.every((item, index) => item.whiteSpace === (layout.config[index].wrap ? "normal" : "nowrap") && !/auto|scroll/.test(item.overflowX) && item.textOverflow !== "ellipsis" && item.resize === "none"), true, `${view}/${width}: cell overflow`);
      assert.equal(layout.badgeRows.every((item) => item.whiteSpace === "normal" && item.flexWrap === "wrap" && item.complete), true, `${view}/${width}: badge rows`);
      assert.equal(layout.pageOverflow, false, `${view}/${width}: body overflow ${JSON.stringify(layout.overflowSources)}`);
      if (width === 390) {
        assert.equal(layout.outerScrollable, true, `${view}: outer scroll`);
        assert.match(layout.outerOverflow, /auto|scroll/, `${view}: wrapper overflow`);
      }
    }
  }

  assert.ok(results.recharges[1440][6] > results.recharges[1440][2], "long custom channel must drive its column");
  assert.ok(results.openingBalances[1440][5] > results.openingBalances[1440][2], "long opening note must drive its column");
  assert.ok(results.studentPricing[1440][4] > results.studentPricing[1440][2], "student badges must drive the set column");
  assert.ok(results.classGroups[1440][3] > results.classGroups[1440][2], "class badges must drive the set column");
  assert.ok(results.teacherSalaryRules[1440][4] > results.teacherSalaryRules[1440][2], "salary badges must drive the set column");
  assert.ok(results.teacherProfiles[1440][6] > results.teacherProfiles[1440][2], "teacher notes must be the bounded flexible column");
  assert.ok(results.userAdmin[1440][3] > results.userAdmin[1440][2], "bound teachers must be the bounded flexible column");

  await browser.click('.user-admin-tab[data-tab="roles"]');
  await browser.waitFor("Boolean(document.querySelector('.role-table[data-adaptive-widths]'))");
  const roleLayout = await inspectTable(browser, ".role-table");
  assert.deepEqual(roleLayout.config.map((column) => column.type), ["name", "status", "action", "action"]);

  await openView(browser, "students", "recharges", ".recharge-table:not(.opening-balance-table)");
  await viewport(browser, 390);
  await browser.evaluate("document.querySelector(\".recharge-row[data-channel='other'] .recharge-channel-cell\").scrollIntoView({block:'center',inline:'center'})");
  await browser.click(".recharge-row[data-channel='other'] .recharge-channel-cell");
  const overlay = await browser.evaluate(`(() => {
    const cell=document.querySelector('.recharge-channel-cell.is-open').getBoundingClientRect();
    const menu=document.querySelector('.recharge-channel-overlay').getBoundingClientRect();
    return { body:document.querySelector('.recharge-channel-overlay').parentElement===document.body, within:menu.left>=0&&menu.top>=0&&menu.right<=innerWidth&&menu.bottom<=innerHeight, anchored:Math.abs(menu.left-cell.left)<cell.width+12 };
  })()`);
  assert.deepEqual(overlay, { body: true, within: true, anchored: true });
  await browser.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  assert.equal(await browser.evaluate("Boolean(document.querySelector('.recharge-channel-overlay'))"), false);

  assert.deepEqual(browser.exceptions, []);
  assert.deepEqual(browser.consoleErrors, []);
}));

test("semantic caps remain stable across filtering and 1100-row measurement stays linear and responsive", async () => withBrowser(async (browser) => {
  await browser.login("boss", "123456");
  await openView(browser, "students", "studentPricing", ".student-pricing-table");
  await viewport(browser, 1280);
  const fullWidths = await browser.evaluate("document.querySelector('.student-pricing-table').dataset.adaptiveWidths");
  await browser.evaluate(`(() => { studentPricingFilter={ student:'短名', grade:'', subject:'', student_names:'', price:'', usage:'' }; render(); })()`);
  await browser.waitFor("document.querySelectorAll('.student-pricing-rule-row').length===1 && Boolean(document.querySelector('.student-pricing-table[data-adaptive-widths]'))");
  const filteredWidths = await browser.evaluate("document.querySelector('.student-pricing-table').dataset.adaptiveWidths");
  const full = fullWidths.split(",").map(Number);
  const filtered = filteredWidths.split(",").map(Number);
  const config = await browser.evaluate("JSON.parse(document.querySelector('.student-pricing-table').dataset.adaptiveColumnConfig)");
  assert.equal(filtered[1] >= config[1].minWidth && filtered[1] <= config[1].maxWidth, true);
  assert.equal(filtered[4] >= config[4].minWidth && filtered[4] <= config[4].maxWidth, true);
  assert.equal(full[4] <= config[4].maxWidth, true, "student set column is capped instead of following the longest row");
  await browser.evaluate("(() => { studentPricingFilter={ student:'', grade:'', subject:'', student_names:'', price:'', usage:'' }; render(); })()");
  await browser.waitFor(`document.querySelector('.student-pricing-table')?.dataset.adaptiveWidths===${JSON.stringify(fullWidths)}`);

  const performanceResult = await browser.evaluate(`(() => {
    const wrap=document.createElement('div');
    wrap.className='table-wrap';
    wrap.style.cssText='position:absolute;left:-10000px;top:0;width:1000px;visibility:hidden';
    const table=document.createElement('table');
    table.className='uniform-table nowrap-table adaptive-table';
    table.dataset.adaptiveTable='true';
    table.dataset.adaptiveFlexColumn='7';
    table.innerHTML='<colgroup>'+('<col>'.repeat(8))+'</colgroup><thead><tr>'+['选择','学生','年级','科目','学生集合','单价','价格状态','备注'].map((v,i)=>'<th class="'+(i===0?'select-col':'')+'">'+v+'</th>').join('')+'</tr></thead><tbody>'+Array.from({length:1100},(_,index)=>'<tr><td class="select-col"><input type="checkbox"></td><td>学生'+index+'</td><td>高三</td><td>数学</td><td>学生'+index+'、学生乙、学生丙</td><td>'+index.toLocaleString('zh-CN')+'.00</td><td>已设置</td><td>性能备注'+index+'</td></tr>').join('')+'</tbody>';
    wrap.append(table);
    document.body.append(wrap);
    const started=performance.now();
    const widths=applyAdaptiveTableColumns({table});
    const elapsed=performance.now()-started;
    const rows=table.tBodies[0].rows.length;
    wrap.remove();
    return {elapsed,rows,widths,cache:adaptiveTableTextWidthCache.size};
  })()`);
  assert.equal(performanceResult.rows, 1100);
  assert.equal(performanceResult.widths.length, 8);
  assert.ok(performanceResult.elapsed < 2000, `measurement took ${performanceResult.elapsed.toFixed(1)}ms`);
  assert.ok(performanceResult.cache < performanceResult.rows * 8, "repeated text widths should be cached");
  assert.deepEqual(browser.exceptions, []);
  assert.deepEqual(browser.consoleErrors, []);
}));
