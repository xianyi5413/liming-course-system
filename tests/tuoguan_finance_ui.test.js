const { before, after, test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process"),
  { DatabaseSync } = require("node:sqlite");
const { launchBrowser, freePort } = require("./helpers/chrome_cdp"),
  TG = require("../src/domain/tuoguan"),
  T = require("../src/domain/tuoguan_transfer");
const {
    exportFullData,
    verifyFullData,
    restoreFullData,
    buildFullDataBufferFromSourceData,
  } = require("../src/excel/full_backup"),
  { parseWorkbook, createWorkbook } = require("../src/excel/xlsx_codec");
const root = path.resolve(__dirname, "..");
let dir, env, port, server, cookie;
async function call(action, body, auth = cookie) {
  const r = await fetch(`http://127.0.0.1:${port}/api/tuoguan/${action}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", cookie: auth || "" },
    body: body
      ? JSON.stringify({ request_id: crypto.randomUUID(), ...body })
      : undefined,
  });
  return { status: r.status, data: await r.json() };
}
async function login(username) {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "123456" }),
  });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-finance-ui-"));
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
  cookie = await login("boss");
});
after(async () => {
  if (server?.exitCode == null) {
    const ended = new Promise((r) => server.once("exit", r));
    server.kill();
    await ended;
  }
});
test("HTTP split funds, saved membership, historical grade, privacy and readonly protection", async () => {
  const data = (await call("snapshot?month=2026-09")).data;
  assert.equal(data.summary.filter((s) => s.has_attendance).length, 3);
  assert.equal(data.summary.find((s) => s.id === 1).grade, "初一");
  assert.ok(data.ledger.some((r) => r.student_id === 2));
  const readonly = await login("finance-readonly");
  assert.equal(
    (
      await call(
        "money",
        {
          student_id: 1,
          date: "2026-09-01",
          kind: "充值",
          actual_amount: 100,
          gift_amount: 100,
          notes: "合成",
        },
        readonly,
      )
    ).status,
    403,
  );
  const db = new DatabaseSync(env.DB_PATH),
    before = T.signature(db);
  assert.equal(
    (
      await call("remove-dates", {
        month: "2026-09",
        dates: [{ date: "2026-09-02", version: 1 }],
      })
    ).status,
    400,
  );
  assert.equal(T.signature(db), before);
  db.close();
  assert.equal(
    (
      await call("money", {
        student_id: 1,
        date: "2026-09-30",
        kind: "退款",
        actual_amount: 999999,
        gift_amount: 0,
        notes: "合成",
      })
    ).status,
    400,
  );
});
test("Edge indices, three frozen columns, calendar date management, colored options, filtered fees and independent calendar", async () => {
  const b = await launchBrowser(path.join(dir, "edge"), { browser: "edge" }),
    c = b.session;
  const go = async (view) => {
    await c.evaluate(`setActiveView('${view}');load({refreshGlobal:false})`);
    await c.waitFor('Boolean(document.querySelector("#tg-body"))');
  };
  const month = async (value) => {
    await c.evaluate(
      `document.querySelector('#tg-month').value='${value}';document.querySelector('#tg-month').dispatchEvent(new Event('change'))`,
    );
    await c.waitFor(
      `document.querySelector('[data-loaded-month]')?.dataset.loadedMonth==='${value}'`,
    );
  };
  const indices = () =>
    c.evaluate(
      '[...document.querySelectorAll("#tg-body .tg-table tbody .row-index")].map(e=>Number(e.textContent))',
    );
  try {
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await go("tgAttendance");
    await month("2026-09");
    assert.deepEqual(await indices(), [1, 2, 3, 4]);
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-date-header,[data-remove-date],#tg-add-date,#tg-remove-dates").length',
      ),
      0,
    );
    await c.click("#tg-manage-dates");
    await c.waitFor(
      '!document.querySelector(`[data-manage-date="2026-09-08"]`).disabled',
    );
    await c.click('[data-manage-date="2026-09-08"]');
    await c.waitFor(
      'document.querySelector(`[data-manage-date="2026-09-08"]`).dataset.enabled==="false"',
    );
    await c.click('[data-manage-date="2026-09-02"]');
    assert.equal(
      await c.evaluate(
        'document.querySelector(".shared-course-dialog [role=alert]").textContent',
      ),
      "该日期已有考勤或费用记录，无法直接删除。",
    );
    await c.click(".shared-course-dialog .dialog-close");
    await c.waitFor(
      '!document.querySelector(`.tg-cell-button[data-date="2026-09-08"]`)',
    );
    assert.deepEqual(c.consoleErrors.splice(0), []);
    const cell = '.tg-cell-button[data-student="1"][data-date="2026-09-02"]';
    await c.click(cell);
    const tones = await c.evaluate(
      'Object.fromEntries([...document.querySelectorAll(".custom-select-menu.open .custom-select-option")].map(e=>[e.dataset.value,e.querySelector(".status-badge")?.getAttribute("style")]))',
    );
    assert.ok(Object.values(tones).every(Boolean));
    assert.notEqual(tones["出勤"], tones["不适用"]);
    await c.click('.custom-select-menu.open [data-value="出勤"]');
    await c.waitFor(
      '!document.querySelector(".tg-cell-button[aria-busy=true]")',
    );
    for (const width of [1440, 390])
      for (const theme of ["light", "dark"]) {
        await c.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: width === 390,
        });
        await c.evaluate(
          `document.documentElement.dataset.theme='${theme}';if(${width}===390&&!sidebarCollapsed)document.querySelector('.sidebar-toggle').click();scheduleAdaptiveTableColumns()`,
        );
        await c.evaluate(
          "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
        );
        await c.evaluate(
          "document.querySelector('.tg-scroll').scrollIntoView({block:'center'});document.querySelector('.tg-scroll').scrollLeft=999999",
        );
        const geometry = await c.evaluate(
          `(()=>{const w=document.querySelector('.tg-scroll'),cells=[...document.querySelector('.tg-matrix tbody tr').cells];return {offsets:cells.slice(0,3).map((c,i)=>c.getBoundingClientRect().left-(i?cells[i-1].getBoundingClientRect().right:w.getBoundingClientRect().left)),opaque:cells.slice(0,3).every(c=>getComputedStyle(c).backgroundColor!=='rgba(0, 0, 0, 0)'),overflow:document.documentElement.scrollWidth>innerWidth+1};})()`,
        );
        assert.ok(
          geometry.offsets.every((n) => Math.abs(n) < 3),
          JSON.stringify(geometry),
        );
        assert.equal(geometry.opaque, true);
        assert.equal(geometry.overflow, false);
        fs.writeFileSync(
          path.join(dir, `matrix-${width}-${theme}.png`),
          Buffer.from(
            (await c.send("Page.captureScreenshot", { format: "png" })).data,
            "base64",
          ),
        );
      }
    await go("tgStudents");
    assert.deepEqual(await indices(), [1, 2, 3, 4]);
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-table th")].map(e=>e.textContent)',
      ),
      ["序号", "学生", "年级", "状态", "托管首日", "上次在托"],
    );
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelector(".tg-profile-link[data-id=\\"1\\"]").closest("tr").cells].slice(4).map(e=>e.textContent)',
      ),
      ["2026-09-02", "2026-09-02"],
    );
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelector(".tg-profile-link[data-id=\\"2\\"]").closest("tr").cells].slice(4).map(e=>e.textContent)',
      ),
      ["—", "—"],
    );
    assert.doesNotMatch(
      await c.evaluate('document.querySelector("#tg-body").textContent'),
      /明细|操作/,
    );
    await c.click('.tg-profile-link[data-id="2"]');
    await c.waitFor('Boolean(document.querySelector(".tg-form [name=name]"))');
    await c.click(".tg-form [data-cancel]");
    await go("tgLedger");
    await c.click("#tg-money");
    await c.evaluate(
      'document.querySelector(".tg-form [name=student_id]").value="2";document.querySelector(".tg-form [name=date]").value="2026-09-10";document.querySelector(".tg-form [name=actual_amount]").value="12.34";document.querySelector(".tg-form [name=gift_amount]").value="5.67";document.querySelector(".tg-form [name=notes]").value="合成双资金表单"',
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor('!document.querySelector(".tg-form")');
    const posted = (await call("snapshot?month=2026-09")).data.ledger.find(
      (r) => r.notes === "合成双资金表单",
    );
    assert.equal(posted.actual_amount, 1234);
    assert.equal(posted.gift_amount, 567);
    assert.ok((await indices()).length >= 2);
    assert.match(
      await c.evaluate('document.querySelector(".tg-table").textContent'),
      /合成无签到/,
    );
    await go("tgSummary");
    await month("2026-09");
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-table th")].map(e=>e.textContent)',
      ),
      [
        "序号",
        "学生",
        "年级",
        "本月托管消费",
        "本月实际消费",
        "本月赠送消费",
        "上月实际结转",
        "上月赠送结转",
        "本月实际充值",
        "本月赠送充值",
        "月末实际余额",
        "月末赠送余额",
      ],
    );
    assert.equal(
      await c.evaluate('Boolean(document.querySelector("#tg-export"))'),
      false,
    );
    assert.deepEqual(await indices(), [1, 2, 3]);
    assert.doesNotMatch(
      await c.evaluate('document.querySelector("#tg-body").textContent'),
      /合成无签到|未入账参考费|退款/,
    );
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-fee-row .grade-badge")].map(e=>e.textContent)',
      ),
      ["初一", "初一", "初二"],
    );
    await c.evaluate(
      'document.querySelector("#tg-grade").value="初二";document.querySelector("#tg-grade").dispatchEvent(new Event("change"))',
    );
    await c.waitFor('document.querySelectorAll(".tg-fee-row").length===1');
    assert.deepEqual(await indices(), [1]);
    assert.match(
      await c.evaluate('document.querySelector(".tg-metrics").textContent'),
      /¥0.00/,
    );
    await c.click("#tg-reset");
    await c.evaluate(
      "document.querySelector('.tg-scroll').scrollLeft=90;window.outerScroll=document.querySelector('.tg-scroll').scrollLeft;document.querySelector('.tg-fee-row[data-student=\"1\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))",
    );
    await c.waitFor('Boolean(document.querySelector(".tg-detail-calendar"))');
    assert.deepEqual(
      await c.evaluate(
        `(()=>{const x=document.querySelector('.tg-detail-content');return {cards:x.querySelectorAll('.metric').length,tables:x.querySelectorAll('table').length,order:[...x.children].filter(e=>e.matches('.tg-actions,.tg-metrics,.tg-detail-month,.tg-detail-calendar,.tg-calendar-legend')).map(e=>e.className)}})()`,
      ),
      {
        cards: 7,
        tables: 0,
        order: [
          "tg-actions",
          "summary-grid tg-metrics",
          "tg-detail-month",
          "tg-detail-calendar",
          "tg-calendar-legend",
        ],
      },
    );
    const expected = (await call("snapshot?month=2026-09")).data.summary.find(
      (s) => s.id === 1,
    );
    for (const [label, key] of [
      ["本月托管消费", "fee"],
      ["本月实际消费", "actual_consumption"],
      ["本月赠送消费", "gift_consumption"],
      ["本月实际充值", "actual_recharge"],
      ["本月赠送充值", "gift_recharge"],
      ["月末实际余额", "actual_balance"],
      ["月末赠送余额", "gift_balance"],
    ]) {
      const card = await c.evaluate(
        `(()=>{const elements=[...document.querySelectorAll('.tg-detail-content .metric')];return elements.find(e=>e.textContent.includes('${label}'))?.textContent})()`,
      );
      assert.ok(
        card?.includes((expected[key] / 100).toFixed(2)),
        label + " " + card,
      );
    }
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
        const layout = await c.evaluate(
          `(()=>{const panel=document.querySelector('.tg-student-detail-panel'),calendar=document.querySelector('.tg-detail-calendar');return{width:panel.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth+1,columns:getComputedStyle(calendar).gridTemplateColumns.split(' ').length,scroll:getComputedStyle(panel).overflowY}})()`,
        );
        assert.ok(layout.width <= width);
        if (width === 1440)
          assert.ok(layout.width >= 900 && layout.width <= 1100);
        assert.equal(layout.overflow, false);
        assert.equal(layout.columns, 7);
        assert.equal(layout.scroll, "auto");
        assert.equal(
          await c.evaluate(
            '[...document.querySelectorAll(".tg-calendar-status")].every(e=>e.scrollWidth<=e.clientWidth+1)',
          ),
          true,
        );
        fs.writeFileSync(
          path.join(dir, `auto-detail-${width}-${theme}.png`),
          Buffer.from(
            (await c.send("Page.captureScreenshot", { format: "png" })).data,
            "base64",
          ),
        );
      }
    await c.evaluate(
      "window.outerScroll=document.querySelector('.tg-scroll').scrollLeft",
    );
    assert.equal(
      await c.evaluate('document.querySelectorAll(".tg-calendar-day").length'),
      30,
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-detail-calendar").children[2].dataset.date',
      ),
      "2026-09-01",
    );
    for (const [date, status] of [
      ["02", "出勤"],
      ["03", "请假"],
      ["04", "放假"],
      ["05", "不适用"],
    ])
      assert.equal(
        await c.evaluate(
          `document.querySelector('.tg-calendar-day[data-date="2026-09-${date}"]').getAttribute('style')`,
        ),
        tones[status],
      );
    assert.match(
      await c.evaluate(
        'document.querySelector(".tg-calendar-day[data-date=\\"2026-09-06\\"]").title',
      ),
      /26/,
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-calendar-day[data-date=\\"2026-09-01\\"]").dataset.status',
      ),
      "",
    );
    await c.evaluate(
      'window.normalDetailFetch=window.fetch;window.fetch=async(...args)=>{const r=await normalDetailFetch(...args);if(String(args[0]).includes("snapshot?month=2026-10"))await new Promise(resolve=>window.releaseDetail=resolve);return r}',
    );
    await c.click('[data-detail-step="1"]');
    await c.waitFor('typeof window.releaseDetail==="function"');
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-detail-content .metric,.tg-detail-content .tg-calendar-day").length',
      ),
      37,
    );

    await c.click('[data-detail-step="1"]');
    await c.waitFor(
      'document.querySelector(".tg-detail-content")?.dataset.month==="2026-11"&&document.querySelector(".tg-detail-content")?.dataset.loading==="false"',
    );
    await c.evaluate("releaseDetail();window.fetch=normalDetailFetch");
    await c.evaluate("new Promise(requestAnimationFrame)");
    assert.equal(
      await c.evaluate('document.querySelector("#tg-month").value'),
      "2026-09",
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-detail-content").dataset.month',
      ),
      "2026-11",
    );
    assert.equal(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-calendar-day")].every(e=>!e.dataset.status)',
      ),
      true,
    );
    assert.match(
      await c.evaluate(
        'document.querySelector(".tg-detail-content .tg-metrics").textContent',
      ),
      /¥2500?\.00|¥25\.00/,
    );
    fs.writeFileSync(
      path.join(dir, "detail-mobile-dark.png"),
      Buffer.from(
        (await c.send("Page.captureScreenshot", { format: "png" })).data,
        "base64",
      ),
    );
    await c.click(".shared-course-dialog .dialog-close");
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-scroll").scrollLeft===window.outerScroll',
      ),
      true,
    );
    await month("2028-02");
    await c.click(".tg-fee-row");
    await c.waitFor('Boolean(document.querySelector(".tg-detail-calendar"))');
    assert.equal(
      await c.evaluate('document.querySelectorAll(".tg-calendar-day").length'),
      29,
    );
    await c.click('[data-detail-step="-1"]');
    await c.waitFor(
      'document.querySelector(".tg-detail-content")?.dataset.month==="2028-01"&&document.querySelector(".tg-detail-content")?.dataset.loading==="false"',
    );
    await c.click('[data-detail-step="-1"]');
    await c.waitFor(
      'document.querySelector(".tg-detail-content")?.dataset.month==="2027-12"&&document.querySelector(".tg-detail-content")?.dataset.loading==="false"',
    );
    assert.equal(
      await c.evaluate('document.querySelector("#tg-month").value'),
      "2028-02",
    );
    assert.deepEqual(c.exceptions, []);
    assert.deepEqual(c.consoleErrors, []);
  } finally {
    await b.close();
  }
});
test("full v12 split balances round trip and v10 ledger converts without changing original amounts", () => {
  const file = path.join(dir, "v11.xlsx");
  exportFullData({ dbPath: env.DB_PATH, outputPath: file });
  const verified = verifyFullData(file);
  assert.equal(verified.version, 12);
  const data = verified.data;
  for (const version of [12, 11, 10]) {
    const target = path.join(dir, `restored-${version}.sqlite`),
      input = path.join(dir, `version-${version}.xlsx`),
      copy = structuredClone(data);
    if (version === 10)
      for (const r of copy.tg_ledger) {
        delete r.actual_amount;
        delete r.gift_amount;
      }
    const sheets = parseWorkbook(
        buildFullDataBufferFromSourceData(copy).buffer,
      ).sheets.map((s) => ({
        name: s.name,
        state: s.state,
        rows: s.rows.map((r) => [...r]),
      })),
      info = sheets.find((s) => s.name === "导出说明"),
      meta = sheets.find((s) => s.name === "__恢复元数据");
    info.rows.find((r) => r[0] === "格式版本")[1] = version;
    meta.rows.find((r) => r[1] === "format_version")[2] = version;
    meta.rows.find((r) => r[0] === "工作表" && r[1] === "导出说明")[3] = crypto
      .createHash("sha256")
      .update(JSON.stringify(info.rows))
      .digest("hex");
    fs.writeFileSync(input, createWorkbook(sheets));
    const init = spawnSync(process.execPath, ["src/server.js", "--init-db"], {
      cwd: root,
      env: { ...env, DB_PATH: target },
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(init.status, 0, init.stderr);
    restoreFullData({ dbPath: target, inputPath: input });
    const db = new DatabaseSync(target),
      source = new DatabaseSync(env.DB_PATH);
    assert.deepEqual(
      db.prepare("SELECT id,amount FROM tg_ledger ORDER BY id").all(),
      source.prepare("SELECT id,amount FROM tg_ledger ORDER BY id").all(),
    );
    if (version >= 11)
      assert.deepEqual(
        TG.createStore(db).snapshot("2026-09", true).summary,
        TG.createStore(source).snapshot("2026-09", true).summary,
      );
    else
      assert.ok(
        db
          .prepare("SELECT * FROM tg_ledger")
          .all()
          .every((r) => r.actual_amount === null && r.gift_amount === null),
      );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    source.close();
    db.close();
  }
});
test("failed old backup settlement rolls back the entire restore including existing pending target data", () => {
  const source = path.join(dir, "rollback-source.xlsx");
  exportFullData({ dbPath: env.DB_PATH, outputPath: source });
  const data = verifyFullData(source).data,
    record = data.tg_attendance.find((a) => a.status === "出勤");
  record.pending = 1;
  record.fee = 0;
  record.rule_json = "{}";
  data.tg_ledger = data.tg_ledger.filter((l) => l.attendance_id !== record.id);
  const removedKeys = new Set(
    data.tg_transfer_keys
      .filter(
        (k) =>
          k.table_name === "tg_ledger" &&
          !data.tg_ledger.some((l) => String(l.id) === k.row_key),
      )
      .map((k) => k.id),
  );
  data.tg_transfer_keys = data.tg_transfer_keys.filter(
    (k) => !removedKeys.has(k.id),
  );
  fs.writeFileSync(source, buildFullDataBufferFromSourceData(data).buffer);
  const target = path.join(dir, "rollback-target.sqlite"),
    init = spawnSync(process.execPath, ["src/server.js", "--init-db"], {
      cwd: root,
      env: { ...env, DB_PATH: target },
      encoding: "utf8",
      windowsHide: true,
    });
  assert.equal(init.status, 0, init.stderr);
  const db = new DatabaseSync(target);
  db.exec(
    "INSERT INTO tg_students(id,name,grade) VALUES(1,'合成原目标','初一');INSERT INTO tg_attendance(student_id,date,status,grade,rule_json,fee,pending) VALUES(1,'2026-08-01','出勤','初一','{}',0,1);CREATE TRIGGER reject_auto_restore BEFORE INSERT ON tg_ledger WHEN NEW.kind='考勤扣费' BEGIN SELECT RAISE(ABORT,'synthetic restore settlement failure');END",
  );
  const before = T.signature(db);
  assert.throws(
    () => restoreFullData({ dbPath: target, inputPath: source }),
    /synthetic restore settlement failure/,
  );
  assert.equal(T.signature(db), before);
  db.close();
});

test("calendar metadata protects saved zero-fee, unknown and money-only dates; rejects readonly and stale writes without changing funds", async () => {
  const db = new DatabaseSync(env.DB_PATH);
  const unchanged = () =>
    JSON.stringify(
      [
        "tg_students",
        "tg_periods",
        "tg_attendance",
        "tg_ledger",
        "lessons",
      ].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()),
    );
  const baseline = unchanged();
  try {
    const snap = await call("snapshot?month=2026-09&calendar_only=1");
    assert.equal(snap.status, 200);
    assert.deepEqual(Object.keys(snap.data).sort(), [
      "calendar",
      "protected_dates",
    ]);
    for (const date of ["01", "02", "04", "05", "06"]) {
      const full = "2026-09-" + date;
      assert.ok(snap.data.protected_dates.includes(full));
      assert.equal(
        (
          await call("remove-dates", {
            month: "2026-09",
            dates: [
              {
                date: full,
                version:
                  snap.data.calendar.find((c) => c.date === full)?.version || 0,
              },
            ],
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (await call("snapshot?month=2026-13&calendar_only=1")).status,
      400,
    );
    const readonly = await login("finance-readonly");
    for (const action of ["add-dates", "remove-dates"])
      assert.equal(
        (
          await call(
            action,
            { month: "2027-02", dates: [{ date: "2027-02-06", version: 0 }] },
            readonly,
          )
        ).status,
        403,
      );
    const add = await call("add-dates", {
      month: "2027-02",
      dates: [{ date: "2027-02-06", version: 0 }],
    });
    assert.equal(add.status, 200);
    assert.equal(
      add.data.calendar.find((c) => c.date === "2027-02-06").enabled,
      1,
    );
    assert.equal(
      (
        await call("remove-dates", {
          month: "2027-02",
          dates: [{ date: "2027-02-06", version: 0 }],
        })
      ).status,
      409,
    );
    assert.equal(unchanged(), baseline);
  } finally {
    db.close();
  }
});

test("Edge calendar queue, conflicts, errors, close synchronization, stale responses, geometry and readonly", async () => {
  const b = await launchBrowser(path.join(dir, "edge-calendar"), {
      browser: "edge",
    }),
    c = b.session;
  const db = new DatabaseSync(env.DB_PATH, { readOnly: true });
  const unchanged = () =>
    JSON.stringify(
      [
        "tg_students",
        "tg_periods",
        "tg_attendance",
        "tg_ledger",
        "lessons",
      ].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()),
    );
  const baseline = unchanged();
  const month = async (value) => {
    await c.evaluate(
      `document.querySelector('#tg-month').value='${value}';document.querySelector('#tg-month').dispatchEvent(new Event('change'))`,
    );
    await c.waitFor(
      `document.querySelector('[data-loaded-month]')?.dataset.loadedMonth==='${value}'`,
    );
  };
  const open = async () => {
    await c.click("#tg-manage-dates");
    await c.waitFor(
      'Boolean(document.querySelector("[data-manage-date]:not(:disabled)"))',
    );
  };
  const day = (date) => `[data-manage-date="${date}"]`;
  const settled = (date) =>
    c.waitFor(`!document.querySelector('${day(date)}').disabled`);
  try {
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await c.evaluate(
      "if(!sidebarCollapsed)document.querySelector('.sidebar-toggle').click()",
    );
    await c.evaluate(
      "setActiveView('tgAttendance');load({refreshGlobal:false})",
    );
    await c.waitFor('Boolean(document.querySelector("#tg-month"))');
    await month("2026-11");
    await c.evaluate(
      `document.querySelector('#tg-query').value='合成甲';document.querySelector('#tg-query').dispatchEvent(new Event('input'));document.querySelector('#tg-grade').value='初一';document.querySelector('#tg-grade').dispatchEvent(new Event('change'))`,
    );
    await c.waitFor(
      'document.querySelectorAll(".tg-matrix tbody tr[data-student]").length===2',
    );
    await c.evaluate(
      `window.oldRow=document.querySelector('.tg-matrix tbody tr');window.redraws=0;window.obs=new MutationObserver(()=>window.redraws++);obs.observe(document.querySelector('#tg-body'),{childList:true});window.baseFetch=fetch;window.dateRequests=[];window.fetch=async(...args)=>{if(/tuoguan\\/(add|remove)-dates$/.test(String(args[0]))){dateRequests.push(JSON.parse(args[1].body));const r=await baseFetch(...args);if(dateRequests.length===1)await new Promise(resolve=>window.releaseDate=resolve);return r;}return baseFetch(...args);}`,
    );
    await open();
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll("[data-manage-date]").length',
      ),
      30,
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-detail-calendar").firstElementChild.dataset.manageDate',
      ),
      "2026-11-01",
    );
    assert.equal(
      await c.evaluate(
        `document.querySelector('${day("2026-11-07")}').dataset.enabled`,
      ),
      "false",
    );
    await c.evaluate(
      `document.querySelector('${day("2026-11-07")}').click();document.querySelector('${day("2026-11-07")}').click();document.querySelector('${day("2026-11-08")}').click();document.querySelector('${day("2026-11-09")}').click()`,
    );
    await c.waitFor('typeof releaseDate==="function"');
    assert.equal(await c.evaluate("dateRequests.length"), 1);
    assert.equal(
      await c.evaluate(
        'oldRow===document.querySelector(".tg-matrix tbody tr")&&redraws===0',
      ),
      true,
    );
    await c.evaluate("releaseDate()");
    await settled("2026-11-09");
    assert.equal(await c.evaluate("dateRequests.length"), 3);
    for (const [date, enabled] of [
      ["07", "true"],
      ["08", "false"],
      ["09", "false"],
    ])
      assert.equal(
        await c.evaluate(
          `document.querySelector('${day("2026-11-" + date)}').dataset.enabled`,
        ),
        enabled,
      );
    assert.equal(await c.evaluate("redraws"), 0);
    for (const width of [1440, 390])
      for (const theme of ["light", "dark"]) {
        await c.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: width === 390,
        });
        await c.evaluate(`document.documentElement.dataset.theme='${theme}'`);
        const geometry = await c.evaluate(
          `(()=>{const grid=document.querySelector('.tg-detail-calendar'),panel=document.querySelector('.shared-course-dialog .modal-panel'),button=grid.querySelector('button');return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,width:panel.getBoundingClientRect().width,overflow:panel.scrollWidth>panel.clientWidth+1,height:button.getBoundingClientRect().height,colors:[...grid.querySelectorAll('button')].slice(5,8).map(e=>getComputedStyle(e).backgroundColor)}})()`,
        );
        assert.equal(geometry.columns, 7);
        assert.ok(geometry.width <= width);
        assert.equal(geometry.overflow, false);
        assert.ok(geometry.height >= 44);
        assert.ok(new Set(geometry.colors).size > 1);
        fs.writeFileSync(
          path.join(dir, `calendar-${width}-${theme}.png`),
          Buffer.from(
            (await c.send("Page.captureScreenshot", { format: "png" })).data,
            "base64",
          ),
        );
      }
    await c.click(".shared-course-dialog .dialog-close");
    await c.waitFor("redraws===1");
    assert.equal(
      await c.evaluate('document.querySelector("#tg-query").value'),
      "合成甲",
    );
    assert.equal(
      await c.evaluate('document.querySelector("#tg-grade").value'),
      "初一",
    );
    assert.equal(
      await c.evaluate('document.querySelector("#tg-month").value'),
      "2026-11",
    );
    const columns = await c.evaluate(
      '[...document.querySelectorAll(".tg-matrix th")].slice(3).map(e=>e.textContent)',
    );
    assert.ok(columns.includes("11-07"));
    assert.ok(!columns.includes("11-08"));
    assert.deepEqual(columns, [...columns].sort());
    await c.evaluate("obs.disconnect();window.fetch=baseFetch");
    await open();
    assert.equal(
      await c.evaluate(
        `document.querySelector('${day("2026-11-08")}').dataset.enabled`,
      ),
      "false",
    );
    // A concurrent operator changes this date after our modal opened.
    assert.equal(
      (
        await call("remove-dates", {
          month: "2026-11",
          dates: [{ date: "2026-11-10", version: 0 }],
        })
      ).status,
      200,
    );
    await c.click(day("2026-11-10"));
    await settled("2026-11-10");
    assert.equal(
      await c.evaluate(
        `document.querySelector('${day("2026-11-10")}').dataset.enabled`,
      ),
      "false",
    );
    assert.match(
      await c.evaluate(
        'document.querySelector(".tg-date-management [role=alert]").textContent',
      ),
      /变化/,
    );
    // Network failure keeps the server's state and leaves the next date usable.
    await c.evaluate(
      `window.fetch=async(...args)=>{if(String(args[0]).endsWith('add-dates'))throw Error('合成网络失败');return baseFetch(...args)}`,
    );
    await c.click(day("2026-11-14"));
    await settled("2026-11-14");
    assert.equal(
      await c.evaluate(
        `document.querySelector('${day("2026-11-14")}').dataset.enabled`,
      ),
      "false",
    );
    assert.match(
      await c.evaluate(
        'document.querySelector(".tg-date-management [role=alert]").textContent',
      ),
      /合成网络失败/,
    );
    await c.evaluate("window.fetch=baseFetch");
    // Native Enter activates a focused date button.
    await c.evaluate(`document.querySelector('${day("2026-11-14")}').focus()`);
    await c.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      text: "\r",
    });
    await c.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await c.waitFor(
      `document.querySelector('${day("2026-11-14")}').dataset.enabled==='true'`,
    );
    // Closing during a save waits, then refreshes the matrix exactly once.
    await c.evaluate(
      `window.releaseDate=null;window.fetch=async(...args)=>{const r=await baseFetch(...args);if(String(args[0]).endsWith('add-dates'))await new Promise(resolve=>window.releaseDate=resolve);return r;}`,
    );
    await c.click(day("2026-11-21"));
    await c.waitFor('typeof releaseDate==="function"');
    await c.click(".shared-course-dialog .dialog-close");
    await c.evaluate("releaseDate();window.fetch=baseFetch");
    await c.waitFor(
      'Boolean(document.querySelector(`.tg-cell-button[data-date="2026-11-21"]`))',
    );
    // A late response must not repaint a newly selected month.
    await open();
    await c.evaluate(
      `window.releaseDate=null;window.fetch=async(...args)=>{const r=await baseFetch(...args);if(String(args[0]).endsWith('add-dates'))await new Promise(resolve=>window.releaseDate=resolve);return r;}`,
    );
    await c.click(day("2026-11-28"));
    await c.waitFor('typeof releaseDate==="function"');
    await c.click(".shared-course-dialog .dialog-close");
    await month("2026-12");
    await c.evaluate("releaseDate();window.fetch=baseFetch");
    await c.evaluate("new Promise(requestAnimationFrame)");
    assert.equal(
      await c.evaluate('document.querySelector("#tg-month").value'),
      "2026-12",
    );
    assert.equal(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-matrix th")].slice(3).every(e=>e.textContent.startsWith("12-"))',
      ),
      true,
    );
    for (const [value, count, first] of [
      ["2027-02", 28, 1],
      ["2028-02", 29, 2],
      ["2026-12", 31, 2],
    ]) {
      await month(value);
      await open();
      assert.equal(
        await c.evaluate(
          'document.querySelectorAll("[data-manage-date]").length',
        ),
        count,
      );
      assert.equal(
        await c.evaluate(
          `document.querySelector('.tg-detail-calendar').children[${first}].dataset.manageDate`,
        ),
        value + "-01",
      );
      await c.click(".shared-course-dialog .dialog-close");
    }
    await month("2026-09");
    await open();
    for (const date of ["01", "04", "06"]) {
      assert.equal(
        await c.evaluate(
          `document.querySelector('${day("2026-09-" + date)}').dataset.protected`,
        ),
        "true",
      );
      await c.click(day("2026-09-" + date));
      assert.equal(
        await c.evaluate(
          'document.querySelector(".tg-date-management [role=alert]").textContent',
        ),
        "该日期已有考勤或费用记录，无法直接删除。",
      );
    }
    await c.click(".shared-course-dialog .dialog-close");
    assert.equal(unchanged(), baseline);
    await c.send("Network.clearBrowserCookies");
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.waitFor('Boolean(document.querySelector(".login-panel"))');
    await c.evaluate(
      'document.querySelector(".login-username").value="finance-readonly";document.querySelector(".login-password").value="123456";document.querySelector(".login-submit").click()',
    );
    await c.waitFor('!document.querySelector(".login-panel")');
    await c.evaluate(
      "setActiveView('tgAttendance');load({refreshGlobal:false})",
    );
    await c.waitFor('Boolean(document.querySelector("#tg-manage-dates"))');
    assert.equal(
      await c.evaluate('document.querySelector("#tg-manage-dates").disabled'),
      true,
    );
    assert.deepEqual(c.exceptions, []);
    assert.ok(c.consoleErrors.every((e) => e.includes("409")));
  } finally {
    db.close();
    await b.close();
  }
});

test("Edge manual ledger excludes settlement, preserves filters, supports one split recharge and idempotent save", async () => {
  const kinds = ["充值", "退款"];
  for (const [kind, actual, gift] of [
    ["充值", 100000, 10000],
    ["退款", 2000, 300],
    ["优惠", 0, 200],
    ["调整", -500, 500],
    ["期初核定", 1000, 100],
  ]) {
    const result = await call("money", {
      student_id: 3,
      date: "2027-03-01",
      kind,
      actual_amount: actual,
      gift_amount: gift,
      notes: "合成流水" + kind,
    });
    assert.equal(result.status, 200);
  }
  for (const [status, version] of [
    ["出勤", 0],
    ["请假", 1],
    ["出勤", 2],
  ])
    assert.equal(
      (
        await call("attendance", {
          date: "2027-03-02",
          rows: [{ student_id: 3, status, version }],
        })
      ).status,
      200,
    );
  const before = (await call("snapshot?month=2027-03")).data;
  assert.ok(before.ledger.some((r) => r.kind === "考勤冲正"));
  assert.ok(before.ledger.some((r) => r.kind === "考勤扣费"));
  const db = new DatabaseSync(env.DB_PATH, { readOnly: true }),
    history = () =>
      JSON.stringify(
        db.prepare("SELECT * FROM tg_attendance ORDER BY id").all(),
      ),
    savedHistory = history();
  const b = await launchBrowser(path.join(dir, "edge-manual-ledger"), {
      browser: "edge",
    }),
    c = b.session;
  const month = async (v) => {
    await c.evaluate(
      `document.querySelector('#tg-month').value='${v}';document.querySelector('#tg-month').dispatchEvent(new Event('change'))`,
    );
    await c.waitFor(
      `document.querySelector('[data-loaded-month]')?.dataset.loadedMonth==='${v}'`,
    );
  };
  const rows = () =>
    c.evaluate(
      '[...document.querySelectorAll(".tg-table tbody tr")].filter(r=>r.cells.length===8).map(r=>[...r.cells].map(c=>c.textContent))',
    );
  const filter = async (id, value) => {
    await c.evaluate(
      `document.querySelector('#${id}').value=${JSON.stringify(value)};document.querySelector('#${id}').dispatchEvent(new Event('change'))`,
    );
  };
  try {
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await c.evaluate("setActiveView('tgLedger');load({refreshGlobal:false})");
    await c.waitFor('Boolean(document.querySelector("#tg-month"))');
    await month("2027-03");
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll("#tg-kind option")].map(e=>e.value)',
      ),
      ["", ...kinds],
    );
    const all = await rows();
    assert.equal(all.length, 2);
    assert.deepEqual(
      all.map((r) => Number(r[0])),
      [1, 2],
    );
    assert.deepEqual(
      [...new Set(all.map((r) => r[3]))].sort(),
      [...kinds].sort(),
    );
    assert.doesNotMatch(all.flat().join(" "), /考勤扣费|考勤冲正/);
    assert.equal(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-table tbody tr")].every(r=>[4,5].every(i=>getComputedStyle(r.cells[i]).textAlign==="right"))',
      ),
      true,
    );
    for (const kind of kinds) {
      await filter("tg-kind", kind);
      assert.equal((await rows()).length, 1);
      assert.equal((await rows())[0][0], "1");
      assert.equal((await rows())[0][3], kind);
    }
    await filter("tg-kind", "");
    await filter("tg-grade", "初一");
    assert.match(
      await c.evaluate('document.querySelector(".tg-table tbody").textContent'),
      /暂无充值记录/,
    );
    await filter("tg-grade", "初二");
    assert.equal((await rows()).length, 2);
    await c.evaluate(
      `document.querySelector('#tg-query').value='合成乙';document.querySelector('#tg-query').dispatchEvent(new Event('input'));document.querySelector('#tg-query').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
    );
    assert.equal((await rows()).length, 2);
    await c.evaluate("TuoguanUI.applyRange('2027-03-02','2027-03-31')");
    assert.equal((await rows()).length, 0);
    await c.click("#tg-reset");
    await month("2027-04");
    assert.equal(
      await c.evaluate('document.querySelector(".tg-table tbody").textContent'),
      "暂无充值记录",
    );
    await month("2027-03");
    assert.deepEqual((await call("snapshot?month=2027-03")).data, before);
    await c.click("#tg-money");
    await c.evaluate(
      `document.querySelector('.tg-form [name=student_id]').value='3';document.querySelector('.tg-form [name=date]').value='2027-03-15';document.querySelector('.tg-form [name=actual_amount]').value='1000';document.querySelector('.tg-form [name=gift_amount]').value='100';document.querySelector('.tg-form [name=notes]').value='合成一次双资金';window.moneyFetch=fetch;window.moneyRequests=[];window.fetch=async(...args)=>{if(String(args[0]).endsWith('/money')){moneyRequests.push(JSON.parse(args[1].body));const r=await moneyFetch(...args);await new Promise(resolve=>window.releaseMoney=resolve);return r;}return moneyFetch(...args)}`,
    );
    await c.evaluate(
      `document.querySelector('.tg-form [type=submit]').click();document.querySelector('.tg-form [type=submit]').click()`,
    );
    await c.waitFor('typeof releaseMoney==="function"');
    assert.equal(await c.evaluate("moneyRequests.length"), 1);
    const payload = await c.evaluate("moneyRequests[0]");
    await c.evaluate("releaseMoney();window.fetch=moneyFetch");
    await c.waitFor('!document.querySelector(".tg-form")');
    await c.waitFor(
      'document.querySelector(".tg-table tbody").textContent.includes("合成一次双资金")',
    );
    const recharge = (await rows()).filter((r) => r[7] === "合成一次双资金");
    assert.equal(recharge.length, 1);
    assert.ok(recharge[0][4].replaceAll(",", "").includes("1000.00"));
    assert.ok(recharge[0][5].includes("100.00"));
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${port}/api/tuoguan/money`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify(payload),
        })
      ).status,
      200,
    );
    const after = (await call("snapshot?month=2027-03")).data;
    assert.equal(after.ledger.length, before.ledger.length + 1);
    assert.equal(
      after.ledger.filter((r) => r.notes === "合成一次双资金").length,
      1,
    );
    const a = after.summary.find((s) => s.id === 3),
      old = before.summary.find((s) => s.id === 3);
    assert.equal(a.actual_balance - old.actual_balance, 100000);
    assert.equal(a.gift_balance - old.gift_balance, 10000);
    for (const key of ["fee", "actual_consumption", "gift_consumption"])
      assert.equal(a[key], old[key]);
    assert.equal(history(), savedHistory);
    const priorIds = new Set(before.ledger.map((r) => r.id));
    assert.deepEqual(
      after.ledger.filter((r) => priorIds.has(r.id)),
      before.ledger,
    );
    assert.ok(
      db
        .prepare(
          "SELECT count(*) n FROM operation_logs WHERE target_type='tuoguan' AND operation_type='托管充值'",
        )
        .get().n > 0,
    );
    assert.deepEqual(c.exceptions, []);
    assert.deepEqual(c.consoleErrors, []);
  } finally {
    db.close();
    await b.close();
  }
});

test("Edge stable detail retains nodes, height and scroll during delayed month loads, races, errors and close", async () => {
  const b = await launchBrowser(path.join(dir, "edge-stable-detail"), {
      browser: "edge",
    }),
    c = b.session;
  const show = async () => {
    await c.click('.tg-fee-row[data-student="1"]');
    await c.waitFor(
      'document.querySelector(".tg-detail-content")?.dataset.month==="2026-09"',
    );
  };
  const settled = (m) =>
    c.waitFor(
      `document.querySelector('.tg-detail-content')?.dataset.month==='${m}'&&document.querySelector('.tg-detail-content').dataset.loading==='false'`,
    );
  const capture = () =>
    c.evaluate(
      `(()=>{const x=document.querySelector('.tg-detail-content'),p=x.closest('.modal-panel');return {month:x.dataset.month,amounts:[...x.querySelectorAll('.metric-value')].map(e=>e.textContent),dates:[...x.querySelectorAll('.tg-calendar-day')].map(e=>e.dataset.date),height:p.getBoundingClientRect().height,width:p.getBoundingClientRect().width,grid:x.querySelector('.tg-detail-calendar').getBoundingClientRect().height,top:p.scrollTop}})()`,
    );
  const stable = () =>
    c.evaluate(
      'stableNodes.every(e=>e.isConnected)&&stableNodes[0]===document.querySelector(".tg-detail-content")&&shellMutations===0',
    );
  try {
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await c.evaluate(
      "if(!sidebarCollapsed)document.querySelector('.sidebar-toggle').click();setActiveView('tgSummary');load({refreshGlobal:false})",
    );
    await c.waitFor('Boolean(document.querySelector("#tg-month"))');
    await c.evaluate(
      "document.querySelector('#tg-month').value='2026-09';document.querySelector('#tg-month').dispatchEvent(new Event('change'))",
    );
    await c.waitFor(
      'document.querySelector("[data-loaded-month]")?.dataset.loadedMonth==="2026-09"',
    );
    await c.evaluate(
      `document.querySelector('#tg-query').value='合成甲';document.querySelector('#tg-query').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));document.querySelector('#tg-grade').value='初一';document.querySelector('#tg-grade').dispatchEvent(new Event('change'))`,
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
        await show();
        await c.evaluate(
          `window.stableNodes=[document.querySelector('.tg-detail-content'),...document.querySelectorAll('.tg-detail-content .tg-actions,.tg-detail-content .metric,.tg-detail-content .metric-value,.tg-detail-month,.tg-detail-month button,.tg-detail-calendar,.tg-calendar-legend')];window.shellMutations=0;window.observer=new MutationObserver(()=>shellMutations++);observer.observe(stableNodes[0],{childList:true});document.querySelector('.tg-student-detail-panel').scrollTop=100;window.detailFetch=fetch;window.releaseDetail=null;window.fetch=async(...args)=>{const r=await detailFetch(...args);if(String(args[0]).includes('snapshot?month='))await new Promise(resolve=>window.releaseDetail=resolve);return r;}`,
        );
        const before = await capture();
        await c.click('[data-detail-step="1"]');
        await c.waitFor('typeof releaseDetail==="function"');
        await c.evaluate("new Promise(r=>setTimeout(r,180))");
        assert.deepEqual(await capture(), before);
        assert.equal(await stable(), true);
        fs.writeFileSync(
          path.join(dir, `stable-loading-${width}-${theme}.png`),
          Buffer.from(
            (await c.send("Page.captureScreenshot", { format: "png" })).data,
            "base64",
          ),
        );
        await c.evaluate("releaseDetail();window.fetch=detailFetch");
        await settled("2026-10");
        const next = await capture();
        for (const key of ["height", "width", "grid", "top"])
          assert.ok(
            Math.abs(next[key] - before[key]) <= 1,
            `${key}: ${next[key]} vs ${before[key]}`,
          );
        assert.equal(next.dates.length, 31);
        assert.ok(next.dates.every((d) => d.startsWith("2026-10")));
        assert.equal(await stable(), true);
        const expected = (
          await call("snapshot?month=2026-10")
        ).data.summary.find((s) => s.id === 1);
        assert.deepEqual(
          next.amounts.map((x) =>
            Math.round(Number(x.replace(/[^0-9.-]/g, "")) * 100),
          ),
          [
            "fee",
            "actual_consumption",
            "gift_consumption",
            "actual_recharge",
            "gift_recharge",
            "actual_balance",
            "gift_balance",
          ].map((k) => expected[k]),
        );
        await c.click('[data-detail-step="-1"]');
        await settled("2026-09");
        assert.deepEqual(await capture(), before);
        assert.equal(await stable(), true);
        await c.evaluate("observer.disconnect()");
        await c.click(".dialog-close");
      }
    await show();
    await c.evaluate(
      `window.detailFetch=fetch;window.releaseDetail=null;window.fetch=async(...args)=>{const r=await detailFetch(...args);if(String(args[0]).includes('snapshot?month=2026-10'))await new Promise(resolve=>window.releaseDetail=resolve);return r}`,
    );
    await c.click('[data-detail-step="1"]');
    await c.waitFor('typeof releaseDetail==="function"');
    await c.click('[data-detail-step="1"]');
    await settled("2026-11");
    const november = await capture();
    await c.evaluate("releaseDetail();window.fetch=detailFetch");
    await c.evaluate("new Promise(requestAnimationFrame)");
    assert.deepEqual(await capture(), november);
    await c.evaluate(`window.fetch=async()=>{throw Error('合成请求失败')}`);
    await c.click('[data-detail-step="1"]');
    await c.waitFor(
      'document.querySelector(".tg-detail-error").textContent.includes("合成请求失败")',
    );
    assert.deepEqual(await capture(), november);
    await c.evaluate("window.fetch=detailFetch");
    await c.click('[data-detail-step="1"]');
    await settled("2026-12");
    await c.click('[data-detail-step="1"]');
    await settled("2027-01");
    // Closing and opening another student must isolate a pending response.
    await c.evaluate(
      `window.releaseDetail=null;window.fetch=async(...args)=>{const r=await detailFetch(...args);await new Promise(resolve=>window.releaseDetail=resolve);return r}`,
    );
    await c.click('[data-detail-step="1"]');
    await c.waitFor('typeof releaseDetail==="function"');
    await c.click(".dialog-close");
    await c.evaluate("window.fetch=detailFetch");
    await c.click('.tg-fee-row[data-student="4"]');
    const other = await capture();
    await c.evaluate("releaseDetail()");
    await c.evaluate("new Promise(requestAnimationFrame)");
    assert.deepEqual(await capture(), other);
    await c.click(".dialog-close");
    assert.equal(
      await c.evaluate('document.querySelector("#tg-month").value'),
      "2026-09",
    );
    assert.equal(
      await c.evaluate('document.querySelector("#tg-query").value'),
      "合成甲",
    );
    assert.equal(
      await c.evaluate('document.querySelector("#tg-grade").value'),
      "初一",
    );
    assert.deepEqual(c.exceptions, []);
    assert.deepEqual(c.consoleErrors, []);
  } finally {
    await b.close();
  }
});
