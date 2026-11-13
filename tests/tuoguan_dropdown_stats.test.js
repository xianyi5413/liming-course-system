const { before, after, test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process"),
  { DatabaseSync } = require("node:sqlite");
const { launchBrowser, freePort } = require("./helpers/chrome_cdp"),
  TG = require("../src/domain/tuoguan");
const root = path.resolve(__dirname, "..");
let dir, env, port, server;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-dropdown-stats-"));
  port = await freePort();
  env = {
    ...process.env,
    DATA_DIR: dir,
    DB_PATH: path.join(dir, "fixture.sqlite"),
    PORT: String(port),
    SESSION_COOKIE_SECURE: "false",
  };
  const init = spawnSync(process.execPath, ["src/server.js", "--init-db"], {
    cwd: root,
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(init.status, 0, init.stderr);
  const db = new DatabaseSync(env.DB_PATH),
    store = TG.createStore(db),
    write = (a, b) =>
      store.mutate(a, { request_id: crypto.randomUUID(), ...b }, "合成");
  for (const [name, grade] of [
    ["合成甲", "初一"],
    ["合成无签到", "初二"],
    ["合成乙", "初二"],
    ["合成甲", "初一"],
  ])
    write("student", { name, grade, start_date: "2026-09-01" });
  write("rule", {
    effective_date: "2026-09-01",
    present: 5000,
    leave_fee: 2500,
    absent: 5000,
  });
  for (const [id, actual, gift] of [
    [1, 10000, 3000],
    [2, 20000, 1000],
  ])
    write("money", {
      student_id: id,
      date: "2026-09-01",
      kind: "充值",
      actual_amount: actual,
      gift_amount: gift,
      notes: "合成充值",
    });
  write("add-dates", {
    month: "2026-09",
    dates: [{ date: "2026-09-05", version: 0 }],
  });
  for (const [date, status] of [
    ["2026-09-02", "出勤"],
    ["2026-09-03", "请假"],
    ["2026-09-04", "放假"],
    ["2026-09-05", "不适用"],
    ["2028-02-29", "不适用"],
  ])
    write("attendance", {
      date,
      rows: [{ student_id: 1, status, version: 0 }],
    });
  write("attendance", {
    date: "2026-09-02",
    rows: [
      { student_id: 3, status: "放假", version: 0 },
      { student_id: 4, status: "不适用", version: 0 },
    ],
  });
  write("student", { id: 1, name: "合成甲", grade: "初三", version: 1 });
  db.exec(
    "INSERT INTO tg_attendance(student_id,date,status,grade,rule_json,fee,pending,raw_status,source_cell) VALUES(1,'2026-09-06','未登记','初一','{}',0,1,'26','E13');INSERT INTO users(username,display_name,role,password_hash,readonly_override,permission_override_enabled) SELECT 'finance-readonly','合成只读','academic',password_hash,1,1 FROM users WHERE username='boss';INSERT INTO user_page_permissions(user_id,permission_key) SELECT id,'tgFinance' FROM users WHERE username='finance-readonly';INSERT INTO user_page_permissions(user_id,permission_key) SELECT id,'tgAttendance' FROM users WHERE username='finance-readonly'",
  );
  for (const [id, status] of [
    [2, "暂停"],
    [3, "已流出"],
    [4, "已毕业"],
  ]) {
    const p = db.prepare("SELECT * FROM tg_students WHERE id=?").get(id);
    write("student", { ...p, status });
  }
  write("student", { name: "合成新生", grade: "初一", notes: "甲来源" });
  write("student", { name: "合成新生", grade: "初一", notes: "乙来源" });
  db.close();
  server = spawn(process.execPath, ["src/server.js"], {
    cwd: root,
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
});
after(async () => {
  if (server?.exitCode == null) {
    const ended = new Promise((r) => server.once("exit", r));
    server.kill();
    await ended;
  }
});

const orphanCount =
  '[...document.querySelectorAll(`.custom-select-menu[data-select-portal="1"]`)].filter(m=>!m._customSelectOwner?.isConnected).length';
async function page(c, view, month = "2026-09") {
  await c.evaluate(`setActiveView('${view}');load({refreshGlobal:false})`);
  await c.waitFor('Boolean(document.querySelector("#tg-body"))');
  await c.evaluate(
    `document.querySelector('#tg-month').value='${month}';document.querySelector('#tg-month').dispatchEvent(new Event('change'))`,
  );
  await c.waitFor(
    `document.querySelector('[data-loaded-month]')?.dataset.loadedMonth==='${month}'`,
  );
}
test("Edge shared dialog closes its payment portal immediately and permits reopen", async () => {
  const b = await launchBrowser(path.join(dir, "edge-portal"), {
      browser: "edge",
    }),
    c = b.session;
  try {
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await page(c, "tgLedger");
    await c.click(".tg-ledger-row td:nth-child(3)");
    await c.click(
      ".tg-form [name=channel] + .custom-select .custom-select-button",
    );
    await c.waitFor(
      'Boolean(document.querySelector(".custom-select-menu.open"))',
    );
    const opened = await c.evaluate(
      '(()=>{const m=document.querySelector(".custom-select-menu.open");return {body:m.parentElement===document.body,ownerInDialog:!!m._customSelectOwner.closest(".shared-course-dialog")}})()',
    );
    assert.deepEqual(opened, { body: true, ownerInDialog: true });
    await c.click(".shared-course-dialog .dialog-close");
    const result = await c.evaluate(
      `({orphans:${orphanCount},visible:document.querySelectorAll('.custom-select-menu.open').length,dialogs:document.querySelectorAll('.shared-course-dialog').length})`,
    );
    console.log("portal close evidence", result);
    assert.equal(result.orphans, 0);
    assert.equal(result.visible, 0);
  } finally {
    await b.close();
  }
});
test("Edge scoped portal lifecycle covers cancel Escape save failure repeated dialogs and other owners", async () => {
  const b = await launchBrowser(path.join(dir, "edge-lifecycle"), {
      browser: "edge",
    }),
    c = b.session;
  const open = async () => {
    await c.click(".tg-ledger-row td:nth-child(3)");
    await c.click(
      ".tg-form [name=channel] + .custom-select .custom-select-button",
    );
    await c.waitFor(
      'Boolean(document.querySelector(".custom-select-menu.open"))',
    );
  };
  const clear = async () => {
    assert.equal(await c.evaluate(orphanCount), 0);
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".custom-select-menu.open").length',
      ),
      0,
    );
  };
  try {
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await page(c, "tgLedger");
    for (const theme of ["light", "dark"]) {
      await c.evaluate(`document.documentElement.dataset.theme='${theme}'`);
      await open();
      await c.click(".tg-form [data-cancel]");
      await clear();
      await open();
      await c.waitFor(
        'document.activeElement.classList.contains("custom-select-search-input")',
      );
      await c.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await c.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
      });
      assert.equal(
        await c.evaluate(
          'document.querySelectorAll(".custom-select-menu.open").length',
        ),
        0,
      );
      await c.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await c.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
      });
      assert.equal(
        await c.evaluate('document.querySelectorAll(".tg-form").length'),
        0,
      );
      await clear();
    }
    await open();
    await c.evaluate(
      "const i=document.querySelector('.custom-select-menu.open .custom-select-search-input');i.value='其他';i.dispatchEvent(new Event('input',{bubbles:true}))",
    );
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".custom-select-menu.open .custom-select-option:not([hidden])").length',
      ),
      1,
    );
    await c.click(".custom-select-menu.open [data-value=other]");
    await c.evaluate(
      "document.querySelector('.tg-form [name=channel_other]').value='合成其他';document.querySelector('.tg-form [name=notes]').value='合成浮层保存';window.originalFetch=fetch;window.fetch=(...args)=>String(args[0]).endsWith('/money-edit')?Promise.reject(Error('合成失败')):originalFetch(...args)",
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      'document.querySelector(".tg-form [role=alert]").textContent.includes("合成失败")',
    );
    assert.equal(await c.evaluate(orphanCount), 0);
    await c.click(
      ".tg-form [name=channel] + .custom-select .custom-select-button",
    );
    await c.evaluate("window.fetch=originalFetch");
    await c.click(".tg-form [type=submit]");
    await c.waitFor('!document.querySelector(".tg-form")');
    await clear();
    // The scope must not close a connected menu owned by another dialog or the page.
    await c.evaluate(
      `window.outside=CourseDetails.dialog('合成外层','<select id="outside-select"><option>甲</option><option>乙</option></select>');window.inside=CourseDetails.dialog('合成内层','<select id="inside-select"><option>丙</option></select>');enhanceCustomSelects();window.outsideWrapper=document.querySelector('#outside-select').nextElementSibling;openCustomSelect(outsideWrapper);window.outsideMenu=customSelectMenu(outsideWrapper);inside.close();`,
    );
    assert.equal(
      await c.evaluate(
        'outsideMenu.isConnected&&outsideMenu.classList.contains("open")',
      ),
      true,
    );
    assert.equal(await c.evaluate(orphanCount), 0);
    await c.evaluate(
      "outside.close();outside.close();openCustomSelect(outsideWrapper)",
    );
    await clear();
    await open();
    await c.evaluate("setActiveView('tgStudents');load({refreshGlobal:false})");
    await c.waitFor('Boolean(document.querySelector(".tg-profile-status"))');
    await clear();
    await c.click(".shared-course-dialog .dialog-close");
    await clear();
    await c.click(".tg-profile-status + .custom-select .custom-select-button");
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".custom-select-menu.open").length',
      ),
      1,
    );
    await c.evaluate("closeCustomSelects()");
    await clear();
    assert.deepEqual(c.exceptions, []);
    assert.deepEqual(c.consoleErrors, []);
  } finally {
    await b.close();
  }
});
const cardValues = (c) =>
  c.evaluate(
    '[...document.querySelectorAll("#tg-recharge-analysis .recharge-analysis-grid .metric-value")].map(e=>Number(e.textContent.replace(/[^0-9.-]/g,"")))',
  );
test("Edge statistics share filtered rows, historical grades, real IDs and effective funds across edits and deletes", async () => {
  const db = new DatabaseSync(env.DB_PATH),
    store = TG.createStore(db),
    write = (a, b) =>
      store.mutate(a, { request_id: crypto.randomUUID(), ...b }, "合成统计");
  // Student 1 is currently grade 3, but these historical transactions belong to grades 1 then 2.
  const p = db.prepare("SELECT * FROM tg_periods WHERE student_id=1").get();
  write("period", { ...p, end_date: "2031-09-30" });
  write("period", {
    student_id: 1,
    start_date: "2031-10-01",
    grade: "初二",
    status: "在托",
  });
  for (const [student_id, date, actual_amount, gift_amount, method] of [
    [1, "2031-09-01", 10000, 1000, "微信"],
    [1, "2031-09-02", 2000, 0, "现金"],
    [4, "2031-09-01", 3000, 500, ""],
    [5, "2031-09-01", 1000, 0, "支付宝"],
    [1, "2031-10-01", 5000, 1000, "其他：合成转账"],
  ])
    write("money", {
      student_id,
      date,
      kind: "充值",
      actual_amount,
      gift_amount,
      method,
    });
  write("money", {
    student_id: 1,
    date: "2031-09-03",
    kind: "退款",
    actual_amount: 3000,
    gift_amount: 200,
    method: "现金",
  });
  write("money", {
    student_id: 1,
    date: "2031-09-01",
    kind: "充值",
    actual_amount: 9900,
    gift_amount: 0,
    method: "微信",
  });
  const wrong = db
    .prepare("SELECT * FROM tg_ledger ORDER BY id DESC LIMIT 1")
    .get();
  write("money-delete", {
    records: [{ id: wrong.id, version: wrong.version }],
  });
  write("attendance", {
    date: "2031-09-01",
    rows: [{ student_id: 1, status: "出勤", version: 0 }],
  });
  const evidence = JSON.stringify(
    db.prepare("SELECT * FROM tg_attendance ORDER BY id").all(),
  );
  const b = await launchBrowser(path.join(dir, "edge-stats"), {
      browser: "edge",
    }),
    c = b.session;
  try {
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await page(c, "tgLedger", "2031-09");
    assert.deepEqual(await cardValues(c), [160, 15, 143, 4, 3, 32]);
    assert.equal(
      await c.evaluate('document.querySelectorAll(".tg-ledger-row").length'),
      5,
    );
    const splits = () =>
      c.evaluate(
        '[...document.querySelectorAll("#tg-recharge-analysis .recharge-analysis-split")].map(e=>({title:e.querySelector(".recharge-analysis-split-title").textContent,rows:[...e.querySelectorAll(".recharge-analysis-chip")].map(r=>[r.querySelector("b").textContent,Number(r.querySelector("span").textContent.replace(/[^0-9.-]/g,"")),r.querySelector("em").textContent])}))',
      );
    let groups = await splits();
    assert.deepEqual(
      groups[0].rows.map((r) => r.slice(0, 2)),
      [
        ["初一", 133],
        ["未记录", 10],
      ],
    );
    assert.deepEqual(
      groups[1].rows.map((r) => r.slice(0, 2)),
      [
        ["微信", 100],
        ["现金", 20],
        ["支付宝", 10],
        ["未记录", 30],
      ],
    );
    await c.evaluate(
      "window.statsRequests=0;window.statsFetch=fetch;window.fetch=(...args)=>{if(String(args[0]).includes('/api/tuoguan/'))statsRequests++;return statsFetch(...args)};document.querySelector('#tg-kind').value='退款';document.querySelector('#tg-kind').dispatchEvent(new Event('change'))",
    );
    assert.deepEqual(await cardValues(c), [0, 0, -32, 0, 0, 32]);
    assert.equal(await c.evaluate("statsRequests"), 0);
    await c.click("#tg-reset");
    await c.evaluate(
      "document.querySelector('#tg-grade').value='初一';document.querySelector('#tg-grade').dispatchEvent(new Event('change'))",
    );
    assert.deepEqual(await cardValues(c), [150, 15, 133, 3, 2, 32]);
    await c.click("#tg-reset");
    await c.evaluate(
      "document.querySelector('#tg-query').value='合成新生';document.querySelector('#tg-query').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))",
    );
    assert.deepEqual(await cardValues(c), [10, 0, 10, 1, 1, 0]);
    await c.click("#tg-reset");
    await c.evaluate("TuoguanUI.applyRange('2031-09-01','2031-10-31')");
    await c.waitFor('document.querySelectorAll(".tg-ledger-row").length===6');
    assert.deepEqual(await cardValues(c), [210, 25, 203, 5, 3, 32]);
    groups = await splits();
    assert.deepEqual(
      groups[0].rows.map((r) => r.slice(0, 2)),
      [
        ["初一", 133],
        ["初二", 60],
        ["未记录", 10],
      ],
    );
    // Edit the October transaction: changing amount/channel uses the same refresh for cards and table.
    await c.click(".tg-ledger-row td:nth-child(3)");
    await c.evaluate(
      "document.querySelector('.tg-form [name=actual_amount]').value='70';document.querySelector('.tg-form [name=channel]').value='alipay';document.querySelector('.tg-form [name=channel]').dispatchEvent(new Event('change'))",
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      '!document.querySelector(".tg-form")&&document.querySelector("#tg-msg").textContent==="已保存"',
    );
    assert.deepEqual(await cardValues(c), [230, 25, 223, 5, 3, 32]);
    groups = await splits();
    assert.equal(groups[1].rows.find((r) => r[0] === "支付宝")[1], 80);
    // Failed requests and a real stale-version conflict keep the last confirmed statistics.
    const confirmed = await cardValues(c);
    await c.click(".tg-ledger-row td:nth-child(3)");
    await c.evaluate(
      "document.querySelector('.tg-form [name=actual_amount]').value='999';window.failureFetch=fetch;window.fetch=(...args)=>String(args[0]).endsWith('/money-edit')?Promise.reject(Error('合成统计失败')):failureFetch(...args)",
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      'document.querySelector(".tg-form [role=alert]").textContent.includes("合成统计失败")',
    );
    assert.deepEqual(await cardValues(c), confirmed);
    await c.evaluate("window.fetch=failureFetch");
    const conflictId = await c.evaluate(
      'Number(document.querySelector(".tg-ledger-row").dataset.ledger)',
    );
    const conflictRow = db
      .prepare("SELECT * FROM tg_ledger WHERE id=?")
      .get(conflictId);
    write("money-edit", { ...conflictRow, notes: "合成并发备注" });
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      'document.querySelector(".tg-form [role=alert]").textContent.length>0&&!document.querySelector(".tg-form [type=submit]").disabled',
    );
    assert.match(
      await c.evaluate(
        'document.querySelector(".tg-form [role=alert]").textContent',
      ),
      /刷新|更改|修改/,
    );
    assert.deepEqual(await cardValues(c), confirmed);
    assert.equal(
      db
        .prepare("SELECT actual_amount FROM tg_ledger WHERE id=?")
        .get(conflictId).actual_amount,
      7000,
    );
    await c.click(".tg-form [data-cancel]");
    await c.evaluate("TuoguanUI.applyRange('2031-09-01','2031-10-31')");
    await c.waitFor(
      'document.querySelector(".tg-ledger-row").textContent.includes("合成并发备注")',
    );
    const stable = await cardValues(c);
    await c.click(".tg-ledger-row td:nth-child(3)");
    await c.click(".tg-form [data-cancel]");
    assert.deepEqual(await cardValues(c), stable);
    await c.click(".tg-ledger-row td:nth-child(3)");
    await c.evaluate(
      "document.querySelector('.tg-form [name=date]').value='2032-01-01'",
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      '!document.querySelector(".tg-form")&&document.querySelectorAll(".tg-ledger-row").length===5',
    );
    assert.deepEqual(await cardValues(c), [160, 15, 143, 4, 3, 32]);
    // New funding refreshes the same filtered rows; use another student with the same name.
    await c.click("#tg-money");
    await c.evaluate(
      "for(const [key,value]of Object.entries({student_id:'6',date:'2031-09-04',actual_amount:'5',gift_amount:'1',channel:'wechat'})){const el=document.querySelector('.tg-form [name='+key+']');el.value=value;el.dispatchEvent(new Event('change'))}",
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      '!document.querySelector(".tg-form")&&document.querySelectorAll(".tg-ledger-row").length===6',
    );
    assert.deepEqual(await cardValues(c), [165, 16, 149, 5, 4, 32]);
    await c.click(".tg-ledger-row:nth-child(2) td:nth-child(3)");
    await c.click(
      ".tg-form [name=channel] + .custom-select .custom-select-button",
    );
    await c.click(".dialog-close");
    assert.equal(await c.evaluate(orphanCount), 0);
    // Capture populated groups at both widths and themes, with the sidebar collapsed.
    await c.evaluate(
      'if(!document.querySelector(".sidebar-toggle").getAttribute("aria-pressed").includes("true"))document.querySelector(".sidebar-toggle").click()',
    );
    for (const width of [1440, 390])
      for (const theme of ["light", "dark"]) {
        await c.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: width === 390,
        });
        await c.evaluate(`document.documentElement.dataset.theme='${theme}'`);
        await c.evaluate("new Promise(requestAnimationFrame)");
        assert.equal(
          await c.evaluate(
            'document.querySelector("#tg-recharge-analysis").scrollWidth<=document.querySelector("#tg-recharge-analysis").clientWidth+1',
          ),
          true,
        );
        fs.writeFileSync(
          path.join(dir, `stats-${width}-${theme}.png`),
          Buffer.from(
            (await c.send("Page.captureScreenshot", { format: "png" })).data,
            "base64",
          ),
        );
      }
    await c.send("Emulation.clearDeviceMetricsOverride");
    await c.click(".tg-ledger-all");
    await c.click("#tg-money-delete");
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      '!document.querySelector(".tg-form")&&document.querySelectorAll(".tg-ledger-row").length===0',
    );
    assert.deepEqual(await cardValues(c), [0, 0, 0, 0, 0, 0]);
    assert.equal(
      JSON.stringify(
        db.prepare("SELECT * FROM tg_attendance ORDER BY id").all(),
      ),
      evidence,
    );
    assert.deepEqual(c.exceptions, []);
    // A deliberately rejected stale write produces exactly one expected HTTP 409 browser log.
    assert.deepEqual(c.consoleErrors, [
      "Failed to load resource: the server responded with a status of 409 (Conflict)",
    ]);
  } finally {
    db.close();
    await b.close();
  }
});
