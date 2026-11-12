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
test("Edge indices, three frozen columns, safe header deletion, colored options, filtered fees and independent calendar", async () => {
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
    await c.click('[data-remove-date="2026-09-08"]');
    assert.match(
      await c.evaluate(
        'document.querySelector(".shared-course-dialog").textContent',
      ),
      /2026年9月8日/,
    );
    await c.click("[data-date-cancel]");
    assert.ok(
      await c.evaluate(
        'Boolean(document.querySelector("[data-remove-date=\\"2026-09-08\\"]"))',
      ),
    );
    await c.click('[data-remove-date="2026-09-08"]');
    await c.click("[data-date-confirm]");
    await c.waitFor(
      '!document.querySelector("[data-remove-date=\\"2026-09-08\\"]")',
    );
    await c.click('[data-remove-date="2026-09-02"]');
    await c.click("[data-date-confirm]");
    await c.waitFor(
      'document.querySelector(".shared-course-dialog [role=alert]")?.textContent.includes("已有")',
    );
    await c.click("[data-date-cancel]");
    assert.deepEqual(c.consoleErrors.splice(0), [
      "Failed to load resource: the server responded with a status of 400 (Bad Request)",
    ]);
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
      ["序号", "学生", "年级", "托管首日", "最近托管"],
    );
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelector(".tg-profile-link[data-id=\\"1\\"]").closest("tr").cells].slice(3).map(e=>e.textContent)',
      ),
      ["2026-09-02", "2026-09-02"],
    );
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelector(".tg-profile-link[data-id=\\"2\\"]").closest("tr").cells].slice(3).map(e=>e.textContent)',
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
    const expected = (await call("snapshot?month=2026-09")).data.summary.find(
      (s) => s.id === 1,
    );
    for (const [label, key] of [
      ["本月托管消费", "fee"],
      ["本月实际消费", "actual_consumption"],
      ["本月赠送消费", "gift_consumption"],
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
test("full v11 split balances round trip and v10 ledger converts without changing original amounts", () => {
  const file = path.join(dir, "v11.xlsx");
  exportFullData({ dbPath: env.DB_PATH, outputPath: file });
  const verified = verifyFullData(file);
  assert.equal(verified.version, 11);
  const data = verified.data;
  for (const version of [11, 10]) {
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
    if (version === 11)
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
