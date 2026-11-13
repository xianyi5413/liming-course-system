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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-student-management-"));
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
  cookie = await login("boss");
});
after(async () => {
  if (server?.exitCode == null) {
    const ended = new Promise((r) => server.once("exit", r));
    server.kill();
    await ended;
  }
});

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT)",
  );
  TG.migrate(db);
  t.after(() => db.close());
  const store = TG.createStore(db),
    write = (action, b) =>
      store.mutate(action, { request_id: crypto.randomUUID(), ...b }, "合成");
  for (const name of ["合成资金甲", "合成资金乙"])
    write("student", { name, grade: "初一", start_date: "2026-09-01" });
  const recharge = (
    student_id,
    actual_amount = 100000,
    gift_amount = 10000,
    date = "2026-09-01",
  ) => {
    write("money", {
      student_id,
      date,
      kind: "充值",
      actual_amount,
      gift_amount,
      method: "微信",
    });
    return db.prepare("SELECT * FROM tg_ledger ORDER BY id DESC LIMIT 1").get();
  };
  const attendance = (student_id, date, status = "出勤") =>
    write("attendance", { date, rows: [{ student_id, status, version: 0 }] });
  const totals = (id, month) =>
    store.snapshot(month, true).summary.find((s) => s.id === id);
  const edit = (row, changes = {}) =>
    write("money-edit", {
      ...row,
      actual_amount: Math.abs(row.actual_amount),
      gift_amount: Math.abs(row.gift_amount),
      ...changes,
    });
  return { db, store, write, recharge, attendance, totals, edit };
}
test("manual corrections preserve original evidence and replay cash gift debt and cross-month allocations", (t) => {
  const { db, write, recharge, attendance, totals, edit } = fixture(t);
  const row = recharge(1);
  attendance(1, "2026-09-02");
  attendance(1, "2026-10-01");
  const oldAttendance = JSON.stringify(
      db.prepare("SELECT * FROM tg_attendance").all(),
    ),
    automatic = JSON.stringify(
      db
        .prepare("SELECT * FROM tg_ledger WHERE attendance_id IS NOT NULL")
        .all(),
    );
  const metadata = edit(row, {
    method: "其他：合成转账",
    notes: "合成备注",
  }).record;
  assert.equal(metadata.id, row.id);
  assert.equal(metadata.version, 2);
  assert.equal(metadata.amount, row.amount);
  assert.equal(db.prepare("SELECT count(*) n FROM tg_ledger").get().n, 3);
  assert.throws(() => edit(row, { notes: "过期" }), /已被修改/);
  const replacement = edit(metadata, {
    actual_amount: 0,
    gift_amount: 12000,
  }).record;
  assert.notEqual(replacement.id, row.id);
  assert.equal(replacement.replaces_id, row.id);
  const old = db.prepare("SELECT * FROM tg_ledger WHERE id=?").get(row.id);
  assert.equal(old.amount, 110000);
  assert.ok(old.voided_at);
  assert.equal(old.voided_by, "合成");
  assert.equal(totals(1, "2026-09").gift_consumption, 5000);
  assert.equal(totals(1, "2026-10").gift_balance, 2000);
  const body = {
    records: [{ id: replacement.id, version: replacement.version }],
    request_id: crypto.randomUUID(),
  };
  write("money-delete", body);
  write("money-delete", body);
  assert.equal(totals(1, "2026-10").actual_balance, -10000);
  assert.equal(totals(1, "2026-10").gift_balance, 0);
  assert.equal(totals(1, "2026-10").opening_actual, -5000);
  assert.equal(
    JSON.stringify(db.prepare("SELECT * FROM tg_attendance").all()),
    oldAttendance,
  );
  assert.equal(
    JSON.stringify(
      db
        .prepare("SELECT * FROM tg_ledger WHERE attendance_id IS NOT NULL")
        .all(),
    ),
    automatic,
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM tg_audit WHERE action='money-delete' AND payload LIKE '%before%'",
      )
      .get().n,
    1,
  );
  assert.throws(
    () => write("money-delete", { records: body.records }),
    /已被修改/,
  );
  recharge(1, 0, 12000, "2026-11-01");
  assert.equal(totals(1, "2026-11").actual_balance, 0);
  assert.equal(totals(1, "2026-11").gift_balance, 2000);
});
test("money changes move student date kind and validate later refunds with all-or-nothing rollback", (t) => {
  const { db, write, recharge, totals, edit, attendance } = fixture(t);
  let a = recharge(1),
    b = recharge(2);
  attendance(1, "2026-09-02");
  a = edit(a, {
    student_id: 2,
    date: "2026-10-01",
    actual_amount: 20000,
    gift_amount: 2000,
  }).record;
  assert.equal(totals(1, "2026-10").actual_balance, -5000);
  assert.equal(totals(2, "2026-10").opening_actual, 100000);
  a = edit(a, { kind: "退款", actual_amount: 1000, gift_amount: 100 }).record;
  assert.equal(a.amount, -1100);
  assert.equal(totals(2, "2026-10").refund, 1100);
  a = edit(a, { kind: "充值", actual_amount: 1000, gift_amount: 100 }).record;
  assert.equal(a.amount, 1100);
  write("money", {
    student_id: 2,
    date: "2026-11-01",
    kind: "退款",
    actual_amount: 90000,
    gift_amount: 0,
  });
  const state = () =>
    JSON.stringify(
      ["tg_ledger", "tg_requests", "tg_audit"].map((t) =>
        db.prepare("SELECT * FROM " + t).all(),
      ),
    );
  let before = state();
  assert.throws(
    () =>
      write("money-delete", {
        records: [
          { id: b.id, version: b.version },
          { id: a.id, version: a.version },
        ],
      }),
    /退款超过/,
  );
  assert.equal(state(), before);
  assert.throws(
    () => edit(b, { actual_amount: 500, gift_amount: 0 }),
    /退款超过/,
  );
  assert.equal(state(), before);
  const automatic = db
    .prepare("SELECT * FROM tg_ledger WHERE attendance_id IS NOT NULL")
    .get();
  assert.throws(
    () =>
      write("money-delete", {
        records: [
          { id: a.id, version: a.version },
          { id: automatic.id, version: automatic.version },
        ],
      }),
    /不是可修改/,
  );
  assert.equal(state(), before);
  assert.throws(() => edit(a, { date: "2026-02-31" }), /日期无效/);
  assert.equal(state(), before);
  const refund = db
    .prepare("SELECT * FROM tg_ledger WHERE kind='退款' AND voided_at IS NULL")
    .get();
  write("money-delete", {
    records: [
      { id: refund.id, version: refund.version },
      { id: b.id, version: b.version },
    ],
  });
  assert.equal(totals(2, "2026-11").actual_balance, 1000);
  assert.equal(totals(2, "2026-11").gift_balance, 100);
});
test("atomic new member uses persistent monthly defaults without writing attendance or charging; saved evidence wins", (t) => {
  const { db, store, write, attendance } = fixture(t);
  const result = write("student", {
      name: "合成新成员",
      grade: "初二",
      month: "2026-11",
    }),
    id = result.student.id;
  assert.equal(result.student.status, "在托");
  assert.equal(
    result.periods.find((p) => p.student_id === id).default_status,
    "不适用",
  );
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM tg_attendance WHERE student_id=?")
      .get(id).n,
    0,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM tg_ledger WHERE student_id=?").get(id).n,
    0,
  );
  let p = result.periods.find((p) => p.student_id === id);
  write("remove-students", {
    month: "2026-11",
    students: [{ id, versions: [[p.id, p.version]] }],
  });
  write("period", { month: "2026-11", student_id: id, student_version: 1 });
  attendance(id, "2026-11-01");
  attendance(id, "2026-11-02", "请假");
  assert.equal(
    store.snapshot("2026-11", true).summary.find((s) => s.id === id).fee,
    7500,
  );
  assert.throws(
    () =>
      write("remove-students", {
        month: "2026-11",
        students: [{ id, versions: [] }],
      }),
    /已有考勤/,
  );
  assert.equal(
    store.snapshot("2026-11", true).students.find((s) => s.id === id)
      .first_attendance_date,
    "2026-11-01",
  );
  const count = db.prepare("SELECT count(*) n FROM tg_students").get().n;
  assert.throws(() =>
    write("student", { name: "合成失败", grade: "初一", month: "2026-13" }),
  );
  assert.equal(db.prepare("SELECT count(*) n FROM tg_students").get().n, count);
  assert.throws(
    () =>
      write("student", { name: "合成新成员", grade: "初三", month: "2026-11" }),
    /同名/,
  );
  const duplicate = write("student", {
    name: "合成新成员",
    grade: "初三",
    notes: "不同家庭",
    confirm_same_name: true,
    month: "2026-11",
  });
  assert.notEqual(duplicate.student.id, id);
  assert.equal(
    duplicate.periods.find((p) => p.student_id === duplicate.student.id)
      .default_status,
    "不适用",
  );
  assert.equal(
    db.prepare("SELECT default_status FROM tg_periods WHERE student_id=1").get()
      .default_status,
    "出勤",
  );
  // Real attendance can survive a missing historical period; rejoining never overwrites it.
  db.prepare("DELETE FROM tg_periods WHERE student_id=?").run(id);
  write("period", { month: "2026-11", student_id: id, student_version: 1 });
  assert.equal(
    db
      .prepare("SELECT status FROM tg_attendance WHERE student_id=? AND date=?")
      .get(id, "2026-11-01").status,
    "出勤",
  );
});
test("money corrections and defaults survive v5 text and v13 Excel; legacy v4/v12 fills safe fields", async () => {
  const source = new DatabaseSync(env.DB_PATH),
    store = TG.createStore(source),
    write = (a, b) =>
      store.mutate(a, { request_id: crypto.randomUUID(), ...b }, "合成");
  const old = source
    .prepare("SELECT * FROM tg_ledger WHERE kind='充值' AND student_id=2")
    .get();
  write("money-edit", { ...old, actual_amount: 18000, gift_amount: 1000 });
  write("student", { name: "合成迁移学生", grade: "初三", month: "2027-03" });
  const bundle = T.exportData(source);
  assert.equal(bundle.version, 5);
  const dest = new DatabaseSync(path.join(dir, "edit-transfer.sqlite"));
  dest.exec("CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT)");
  TG.migrate(dest);
  await T.confirm(
    dest,
    JSON.stringify(bundle),
    T.signature(dest),
    path.join(dir, "edit-transfer-backup"),
    "合成",
  );
  const clean = (v) =>
    JSON.stringify(v, (_, x) =>
      x && typeof x === "object" && !Array.isArray(x)
        ? Object.fromEntries(
            Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
          )
        : x,
    );
  for (const table of [
    "tg_students",
    "tg_periods",
    "tg_attendance",
    "tg_ledger",
  ])
    assert.equal(
      clean(dest.prepare("SELECT * FROM " + table + " ORDER BY id").all()),
      clean(source.prepare("SELECT * FROM " + table + " ORDER BY id").all()),
    );
  const exported = path.join(dir, "edit-v13.xlsx");
  exportFullData({ dbPath: env.DB_PATH, outputPath: exported });
  const verified = verifyFullData(exported);
  assert.equal(verified.version, 13);
  const target = path.join(dir, "edit-restore.sqlite");
  assert.equal(
    spawnSync(process.execPath, ["src/server.js", "--init-db"], {
      cwd: root,
      env: { ...env, DB_PATH: target },
      windowsHide: true,
    }).status,
    0,
  );
  restoreFullData({ dbPath: target, inputPath: exported });
  const restored = new DatabaseSync(target);
  for (const table of ["tg_periods", "tg_attendance", "tg_ledger"])
    assert.equal(
      clean(restored.prepare("SELECT * FROM " + table + " ORDER BY id").all()),
      clean(source.prepare("SELECT * FROM " + table + " ORDER BY id").all()),
    );
  const bad = structuredClone(bundle);
  bad.records.tg_ledger.find((r) => r.record.attendance_id).record.voided_at =
    new Date().toISOString();
  bad.records.tg_ledger.find((r) => r.record.attendance_id).record.voided_by =
    "合成";
  const { checksum, ...content } = bad;
  bad.checksum = T.hash(content);
  assert.throws(() => T.parse(dest, JSON.stringify(bad)), /作废证据/);
  dest.close();
  restored.close();
  source.close();
});
test("HTTP edit/delete permissions, versions, idempotency and operation logs", async () => {
  assert.equal(
    (
      await call("money", {
        student_id: 6,
        date: "2027-04-01",
        kind: "充值",
        actual_amount: 50000,
        gift_amount: 5000,
        channel: "wechat",
      })
    ).status,
    200,
  );
  let row = (
    await call("snapshot?month=2027-04&ledger_only=1")
  ).data.ledger.find((r) => r.student_id === 6);
  const body = {
    ...row,
    actual_amount: 40000,
    gift_amount: 5000,
    channel: "other",
    channel_other: "合成转账",
    request_id: crypto.randomUUID(),
  };
  const readonly = await login("finance-readonly");
  assert.equal((await call("money-edit", body, readonly)).status, 403);
  assert.equal(
    (
      await call(
        "money-delete",
        { records: [{ id: row.id, version: row.version }] },
        readonly,
      )
    ).status,
    403,
  );
  const result = await call("money-edit", body);
  assert.equal(result.status, 200);
  assert.equal(
    (await call("money-edit", body)).data.record.id,
    result.data.record.id,
  );
  assert.equal(
    (await call("money-edit", { ...body, request_id: crypto.randomUUID() }))
      .status,
    409,
  );
  row = result.data.record;
  assert.equal(
    (
      await call("money-edit", {
        ...row,
        actual_amount: 40000,
        gift_amount: 5000,
        channel: "other",
        channel_other: "",
      })
    ).status,
    400,
  );
  const del = {
    records: [{ id: row.id, version: row.version }],
    request_id: crypto.randomUUID(),
  };
  assert.equal((await call("money-delete", del)).status, 200);
  assert.equal((await call("money-delete", del)).status, 200);
  assert.equal(
    (await call("snapshot?month=2027-04&ledger_only=1")).data.ledger.length,
    0,
  );
  const db = new DatabaseSync(env.DB_PATH, { readOnly: true });
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM operation_logs WHERE operation_type='编辑托管资金'",
      )
      .get().n,
    1,
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM operation_logs WHERE operation_type='删除托管资金'",
      )
      .get().n,
    1,
  );
  db.close();
});
async function browserPage(c, view, month) {
  await c.evaluate(`setActiveView('${view}');load({refreshGlobal:false})`);
  await c.waitFor('Boolean(document.querySelector("#tg-body"))');
  if (month) {
    await c.evaluate(
      `document.querySelector('#tg-month').value='${month}';document.querySelector('#tg-month').dispatchEvent(new Event('change'))`,
    );
    await c.waitFor(
      `document.querySelector('[data-loaded-month]')?.dataset.loadedMonth==='${month}'`,
    );
  }
}
test("Edge ledger row editing, selection isolation, rollback draft, filtering and confirmed bulk deletion", async () => {
  for (const date of ["2027-05-01", "2027-05-02"])
    assert.equal(
      (
        await call("money", {
          student_id: 5,
          date,
          kind: "充值",
          actual_amount: 10000,
          gift_amount: 1000,
          channel: "wechat",
          notes: "合成窗口",
        })
      ).status,
      200,
    );
  const b = await launchBrowser(path.join(dir, "edge-ledger-edit"), {
      browser: "edge",
    }),
    c = b.session;
  try {
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await browserPage(c, "tgLedger", "2027-05");
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-table th")].map(e=>e.textContent)',
      ),
      [
        "",
        "序号",
        "日期",
        "学生",
        "类型",
        "实际金额",
        "赠送金额",
        "支付方式",
        "备注",
      ],
    );
    assert.equal(
      await c.evaluate('document.querySelector("#tg-money-delete").disabled'),
      true,
    );
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-ledger-row")].map(r=>[r.cells.length,Number(r.cells[1].textContent)])',
      ),
      [
        [9, 1],
        [9, 2],
      ],
    );
    await c.click(".tg-ledger-select");
    assert.equal(
      await c.evaluate('document.querySelectorAll(".tg-form").length'),
      0,
    );
    assert.match(
      await c.evaluate(
        'document.querySelector("#tg-money-delete").textContent',
      ),
      /1/,
    );
    await c.click(".tg-ledger-row td:nth-child(3)");
    await c.waitFor('Boolean(document.querySelector(".tg-form"))');
    assert.equal(
      await c.evaluate('document.querySelector(".tg-form [name=date]").value'),
      "2027-05-02",
    );
    await c.evaluate(
      "document.querySelector('.tg-form [name=notes]').value='合成修改备注';document.querySelector('.tg-form [name=channel]').value='cash';document.querySelector('.tg-form [name=channel]').dispatchEvent(new Event('change'))",
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      '!document.querySelector(".tg-form")&&document.querySelector(".tg-table").textContent.includes("合成修改备注")',
    );
    assert.match(
      await c.evaluate('document.querySelector(".tg-table").textContent'),
      /现金/,
    );
    // Keyboard opens the same form. A simulated failure retains edited values.
    await c.evaluate(
      "const row=document.querySelector('.tg-ledger-row');row.focus();row.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))",
    );
    await c.waitFor('Boolean(document.querySelector(".tg-form"))');
    await c.evaluate(
      "document.querySelector('.tg-form [name=actual_amount]').value='250';window.fundFetch=fetch;window.fetch=(...args)=>String(args[0]).endsWith('/money-edit')?Promise.reject(Error('合成网络失败')):fundFetch(...args)",
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      'document.querySelector(".tg-form [role=alert]").textContent.includes("合成网络失败")',
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-form [name=actual_amount]").value',
      ),
      "250",
    );
    await c.evaluate("window.fetch=fundFetch");
    await c.click(".tg-form [type=submit]");
    await c.waitFor('!document.querySelector(".tg-form")');
    await c.click(".tg-ledger-all");
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-ledger-select:checked").length',
      ),
      2,
    );
    await c.click("#tg-money-delete");
    assert.match(
      await c.evaluate('document.querySelector(".tg-form").textContent'),
      /2条/,
    );
    await c.click(".tg-form [data-cancel]");
    assert.equal(
      await c.evaluate('document.querySelectorAll(".tg-ledger-row").length'),
      2,
    );
    await c.evaluate(
      "document.querySelector('#tg-query').value='不存在';document.querySelector('#tg-query').dispatchEvent(new Event('input'))",
    );
    await c.waitFor('document.querySelectorAll(".tg-ledger-row").length===0');
    assert.equal(
      await c.evaluate('document.querySelector("#tg-money-delete").disabled'),
      true,
    );
    await c.click("#tg-reset");
    await c.waitFor('document.querySelectorAll(".tg-ledger-row").length===2');
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-ledger-select:checked").length',
      ),
      0,
    );
    // Changing the date removes the edited row from the active month without moving the filter.
    await c.click(".tg-ledger-row td:nth-child(3)");
    await c.evaluate(
      "document.querySelector('.tg-form [name=date]').value='2027-06-01'",
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      '!document.querySelector(".tg-form")&&document.querySelectorAll(".tg-ledger-row").length===1',
    );
    assert.equal(
      await c.evaluate('document.querySelector("#tg-month").value'),
      "2027-05",
    );
    await c.click(".tg-ledger-all");
    await c.click("#tg-money-delete");
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      '!document.querySelector(".tg-form")&&document.querySelectorAll(".tg-ledger-row").length===0',
    );
    assert.equal(
      await c.evaluate('document.querySelector(".tg-table tbody").textContent'),
      "暂无充值记录",
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
        await c.click("#tg-money");
        assert.equal(
          await c.evaluate(
            'document.querySelector(".modal-panel").getBoundingClientRect().width<=innerWidth',
          ),
          true,
        );
        await c.click(".tg-form [data-cancel]");
      }
    assert.deepEqual(c.exceptions, []);
    assert.deepEqual(c.consoleErrors, []);
  } finally {
    await b.close();
  }
});
test("Edge manager creates and selects independent students with persistent yellow defaults and no charges", async () => {
  const b = await launchBrowser(path.join(dir, "edge-new-default"), {
      browser: "edge",
    }),
    c = b.session;
  try {
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await browserPage(c, "tgAttendance", "2027-07");
    await c.click("#tg-manage-students");
    await c.waitFor('!document.querySelector("[data-new-member]").disabled');
    await c.click("[data-new-member]");
    await c.evaluate(
      "document.querySelector('.tg-form [name=name]').value='合成窗口新生';document.querySelector('.tg-form [name=grade]').value='初三'",
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      '!document.querySelector(".tg-form")&&document.querySelector(".tg-student-management").textContent.includes("合成窗口新生")',
    );
    const snap = (await call("snapshot?month=2027-07")).data,
      s = snap.students.find((s) => s.name === "合成窗口新生");
    assert.equal(s.status, "在托");
    assert.equal(s.first_attendance_date, null);
    assert.equal(
      snap.attendance.some((a) => a.student_id === s.id),
      false,
    );
    assert.equal(
      snap.ledger.some((a) => a.student_id === s.id),
      false,
    );
    assert.equal(
      await c.evaluate(
        `document.querySelector('[data-member="${s.id}"]').dataset.selected`,
      ),
      "true",
    );
    await c.click(".dialog-close");
    await c.waitFor(
      `Boolean(document.querySelector('.tg-matrix tr[data-student="${s.id}"]'))`,
    );
    assert.ok(
      await c.evaluate(
        `[...document.querySelectorAll('.tg-matrix tr[data-student="${s.id}"] .tg-cell-button')].every(e=>e.textContent.includes('不适用'))`,
      ),
    );
    await browserPage(c, "tgStudents");
    const info = await c.evaluate(
      `[...document.querySelectorAll('.tg-table tbody tr')].find(r=>r.textContent.includes('合成窗口新生')).textContent`,
    );
    assert.match(info, /初三.*在托/);
    assert.ok(info.endsWith("——"));
    await browserPage(c, "tgAttendance", "2027-07");
    assert.ok(
      await c.evaluate(
        `[...document.querySelectorAll('.tg-matrix tr[data-student="${s.id}"] .tg-cell-button')].every(e=>e.textContent.includes('不适用'))`,
      ),
    );
    await c.click("#tg-manage-students");
    await c.waitFor(
      `!document.querySelector('[data-member="${s.id}"]').disabled`,
    );
    await c.click(`[data-member="${s.id}"]`);
    await c.waitFor(
      `document.querySelector('[data-member="${s.id}"]').dataset.selected==='false'`,
    );
    await c.click(`[data-member="${s.id}"]`);
    await c.waitFor(
      `document.querySelector('[data-member="${s.id}"]').dataset.selected==='true'`,
    );
    await c.click("[data-new-member]");
    await c.evaluate(
      "document.querySelector('.tg-form [name=name]').value='合成窗口新生';document.querySelector('.tg-form [name=name]').dispatchEvent(new Event('input'))",
    );
    assert.equal(
      await c.evaluate('document.querySelector("[data-name-hint]").hidden'),
      false,
    );
    await c.evaluate(
      "document.querySelector('.tg-form [name=notes]').value='同名不同学生';document.querySelector('.tg-form [name=confirm_same_name]').checked=true",
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor('!document.querySelector(".tg-form")');
    for (const width of [1440, 390])
      for (const theme of ["light", "dark"]) {
        await c.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: width === 390,
        });
        await c.evaluate(`document.documentElement.dataset.theme='${theme}'`);
        assert.equal(
          await c.evaluate(
            'document.querySelector(".tg-manage-students-panel").scrollWidth<=document.querySelector(".tg-manage-students-panel").clientWidth+1',
          ),
          true,
        );
        fs.writeFileSync(
          path.join(dir, `defaults-${width}-${theme}.png`),
          Buffer.from(
            (await c.send("Page.captureScreenshot", { format: "png" })).data,
            "base64",
          ),
        );
      }
    await c.click(".dialog-close");
    await c.send("Network.clearBrowserCookies");
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.waitFor('Boolean(document.querySelector(".login-panel"))');
    await c.evaluate(
      'document.querySelector(".login-username").value="finance-readonly";document.querySelector(".login-password").value="123456";document.querySelector(".login-submit").click()',
    );
    await c.waitFor('!document.querySelector(".login-panel")');
    await browserPage(c, "tgLedger", "2026-09");
    assert.equal(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-ledger-select")].every(e=>e.disabled)',
      ),
      true,
    );
    await c.click(".tg-ledger-row td:nth-child(3)");
    assert.equal(
      await c.evaluate('document.querySelectorAll(".tg-form").length'),
      0,
    );
    assert.deepEqual(c.exceptions, []);
    assert.deepEqual(c.consoleErrors, []);
  } finally {
    await b.close();
  }
});
test("replacement preserves same-day FIFO order and protects subsequent refunds", (t) => {
  const { db, recharge, attendance, totals, edit, write } = fixture(t);
  const first = recharge(1, 10000, 0);
  recharge(1, 0, 10000);
  attendance(1, "2026-09-02");
  assert.equal(totals(1, "2026-09").actual_consumption, 5000);
  const replacement = edit(first, {
    actual_amount: 12000,
    gift_amount: 0,
  }).record;
  assert.equal(totals(1, "2026-09").actual_consumption, 5000);
  assert.equal(totals(1, "2026-09").gift_consumption, 0);
  edit(replacement, { actual_amount: 14000, gift_amount: 0 });
  assert.equal(totals(1, "2026-09").actual_consumption, 5000);
});
test("native migration and legacy v4 text/v12 Excel keep original defaults and balances", async () => {
  const file = path.join(dir, "legacy-edit.sqlite");
  assert.equal(
    spawnSync(process.execPath, ["src/server.js", "--init-db"], {
      cwd: root,
      env: { ...env, DB_PATH: file },
      windowsHide: true,
    }).status,
    0,
  );
  const db = new DatabaseSync(file),
    store = TG.createStore(db),
    write = (a, b) =>
      store.mutate(a, { request_id: crypto.randomUUID(), ...b }, "合成");
  write("student", {
    name: "合成旧档案",
    grade: "初一",
    start_date: "2026-09-01",
  });
  write("money", {
    student_id: 1,
    date: "2026-09-01",
    kind: "充值",
    actual_amount: 10000,
    gift_amount: 1000,
  });
  const fields = ["version", "voided_at", "voided_by", "replaces_id"],
    bundle = T.exportData(db);
  bundle.version = 4;
  for (const i of bundle.records.tg_periods) delete i.record.default_status;
  for (const i of bundle.records.tg_ledger)
    for (const k of fields) delete i.record[k];
  const { checksum, ...content } = bundle;
  bundle.checksum = T.hash(content);
  const target = new DatabaseSync(path.join(dir, "old-transfer.sqlite"));
  target.exec("CREATE TABLE teachers(id INTEGER PRIMARY KEY)");
  TG.migrate(target);
  await T.confirm(
    target,
    JSON.stringify(bundle),
    T.signature(target),
    path.join(dir, "old-transfer-backups"),
    "合成",
  );
  assert.equal(
    target.prepare("SELECT default_status FROM tg_periods").get()
      .default_status,
    "出勤",
  );
  assert.equal(
    target.prepare("SELECT version FROM tg_ledger").get().version,
    1,
  );
  const xlsx = path.join(dir, "legacy-v12.xlsx");
  exportFullData({ dbPath: file, outputPath: xlsx });
  const data = verifyFullData(xlsx).data;
  for (const r of data.tg_periods) delete r.default_status;
  for (const r of data.tg_ledger) for (const k of fields) delete r[k];
  const sheets = parseWorkbook(
    buildFullDataBufferFromSourceData(data).buffer,
  ).sheets.map((s) => ({
    name: s.name,
    state: s.state,
    rows: s.rows.map((r) => [...r]),
  }));
  const info = sheets.find((s) => s.name === "导出说明"),
    meta = sheets.find((s) => s.name === "__恢复元数据");
  info.rows.find((r) => r[0] === "格式版本")[1] = 12;
  meta.rows.find((r) => r[1] === "format_version")[2] = 12;
  meta.rows.find((r) => r[0] === "工作表" && r[1] === "导出说明")[3] = crypto
    .createHash("sha256")
    .update(JSON.stringify(info.rows))
    .digest("hex");
  fs.writeFileSync(xlsx, createWorkbook(sheets));
  assert.equal(verifyFullData(xlsx).version, 12);
  db.exec("ALTER TABLE tg_periods DROP COLUMN default_status");
  for (const k of fields) db.exec("ALTER TABLE tg_ledger DROP COLUMN " + k);
  const before = db.prepare("SELECT * FROM tg_ledger").all();
  const m = TG.migrate(db);
  assert.ok(fs.existsSync(m.backup));
  assert.equal(TG.migrate(db).backup, null);
  assert.deepEqual(
    db
      .prepare("SELECT * FROM tg_ledger")
      .all()
      .map((r) =>
        Object.fromEntries(
          Object.entries(r).filter(([k]) => !fields.includes(k)),
        ),
      ),
    before.map((r) => ({ ...r })),
  );
  db.close();
  restoreFullData({ dbPath: file, inputPath: xlsx });
  const restored = new DatabaseSync(file);
  assert.equal(
    restored.prepare("SELECT default_status FROM tg_periods").get()
      .default_status,
    "出勤",
  );
  assert.equal(
    restored.prepare("SELECT amount FROM tg_ledger").get().amount,
    11000,
  );
  restored.close();
  target.close();
});
test("multi-student deletion validates all versions and rolls back late SQL errors including evidence", (t) => {
  const { db, write, recharge, totals } = fixture(t),
    a = recharge(1),
    b = recharge(2),
    records = [a, b].map((r) => ({ id: r.id, version: r.version }));
  const snapshot = () =>
    JSON.stringify(
      ["tg_ledger", "tg_requests", "tg_audit"].map((t) =>
        db.prepare("SELECT * FROM " + t).all(),
      ),
    );
  const before = snapshot();
  assert.throws(
    () =>
      write("money-delete", {
        records: [records[0], { ...records[1], version: 99 }],
      }),
    /已被修改/,
  );
  assert.equal(snapshot(), before);
  db.exec(
    "CREATE TRIGGER synthetic_void_failure BEFORE UPDATE ON tg_ledger WHEN OLD.student_id=2 BEGIN SELECT RAISE(ABORT,'synthetic transaction failure'); END",
  );
  assert.throws(
    () => write("money-delete", { records }),
    /synthetic transaction failure/,
  );
  assert.equal(snapshot(), before);
  db.exec("DROP TRIGGER synthetic_void_failure");
  write("money-delete", { records });
  assert.equal(totals(1, "2026-10").balance, 0);
  assert.equal(totals(2, "2026-10").balance, 0);
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM tg_ledger WHERE voided_at IS NOT NULL")
      .get().n,
    2,
  );
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM tg_audit WHERE action='money-delete'")
      .get().n,
    1,
  );
});
