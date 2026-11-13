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

test("profile status migration defaults safely and preserves native backup, identities and all evidence", () => {
  const file = path.join(dir, "old-profile.sqlite");
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE teachers(id INTEGER PRIMARY KEY);CREATE TABLE students(id INTEGER PRIMARY KEY,name TEXT);INSERT INTO students VALUES(1,'合成补课')",
  );
  TG.migrate(db);
  const store = TG.createStore(db);
  store.mutate(
    "student",
    {
      request_id: crypto.randomUUID(),
      name: "合成旧档案",
      grade: "初一",
      start_date: "2026-09-01",
    },
    "合成",
  );
  db.exec(
    "UPDATE tg_periods SET status='退托',end_date='2026-09-30';ALTER TABLE tg_students DROP COLUMN status",
  );
  const original = db.prepare("SELECT * FROM tg_students").all(),
    periods = db.prepare("SELECT * FROM tg_periods").all();
  const result = TG.migrate(db);
  assert.ok(fs.existsSync(result.backup));
  assert.equal(
    db.prepare("SELECT status FROM tg_students").get().status,
    "在托",
  );
  assert.deepEqual(
    db
      .prepare("SELECT * FROM tg_students")
      .all()
      .map(({ status, ...r }) => r),
    original.map((r) => ({ ...r })),
  );
  assert.deepEqual(db.prepare("SELECT * FROM tg_periods").all(), periods);
  const copy = new DatabaseSync(result.backup);
  assert.equal(
    copy
      .prepare("PRAGMA table_info(tg_students)")
      .all()
      .some((c) => c.name === "status"),
    false,
  );
  copy.close();
  assert.equal(TG.migrate(db).backup, null);
  assert.throws(() => db.exec("UPDATE tg_students SET status='退托'"));
  assert.equal(db.prepare("SELECT name FROM students").get().name, "合成补课");
  db.close();
});

test("status and monthly membership enforce versions, month isolation, protection, idempotency and readonly", async () => {
  const db = new DatabaseSync(env.DB_PATH, { readOnly: true });
  const evidence = () =>
    JSON.stringify(
      [
        "tg_attendance",
        "tg_ledger",
        "students",
        "lessons",
        "teacher_monthly_performance",
      ].map((t) => db.prepare("SELECT * FROM " + t + " ORDER BY rowid").all()),
    );
  const before = evidence();
  let s = (await call("snapshot?month=2026-09")).data.students.find(
    (s) => s.id === 5,
  );
  for (const status of ["暂停", "已流出", "已毕业", "在托"]) {
    const r = await call("student", { ...s, status });
    assert.equal(r.status, 200);
    s = r.data;
    assert.equal(s.status, status);
  }
  const savedStatuses = db
    .prepare(
      "SELECT payload FROM tg_audit WHERE action='student' ORDER BY id DESC LIMIT 4",
    )
    .all()
    .map((r) => JSON.parse(r.payload).status);
  assert.deepEqual(savedStatuses, ["在托", "已毕业", "已流出", "暂停"]);
  assert.ok(
    db
      .prepare(
        "SELECT count(*) n FROM operation_logs WHERE operation_type='维护托管学生'",
      )
      .get().n >= 4,
  );
  assert.equal((await call("student", { ...s, status: "退托" })).status, 400);
  assert.equal(
    (await call("student", { ...s, version: s.version - 1, status: "暂停" }))
      .status,
    409,
  );
  const payload = {
    month: "2026-11",
    student_id: 5,
    student_version: s.version,
    request_id: crypto.randomUUID(),
  };
  assert.equal((await call("period", payload)).status, 200);
  assert.equal((await call("period", payload)).status, 200);
  let snap = (await call("snapshot?month=2026-11&students_only=1")).data,
    p = snap.periods.filter((p) => p.student_id === 5);
  assert.equal(p.length, 1);
  assert.equal(p[0].start_date, "2026-11-01");
  assert.equal(p[0].end_date, "2026-11-30");
  assert.equal(
    (await call("period", { ...payload, request_id: crypto.randomUUID() }))
      .status,
    409,
  );
  assert.equal(
    (
      await call("remove-students", {
        month: "2026-11",
        students: [{ id: 5, versions: [[p[0].id, p[0].version - 1]] }],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("remove-students", {
        month: "2026-11",
        students: [{ id: 5, versions: [[p[0].id, p[0].version]] }],
      })
    ).status,
    200,
  );
  for (const id of [1, 2, 3, 4])
    assert.equal(
      (
        await call("remove-students", {
          month: "2026-09",
          students: [{ id, versions: [] }],
        })
      ).status,
      400,
    );
  const inactive = (await call("snapshot?month=2026-09")).data.students.find(
    (s) => s.id === 3,
  );
  assert.equal(
    (
      await call("period", {
        month: "2026-12",
        student_id: 3,
        student_version: inactive.version,
      })
    ).status,
    400,
  );
  const readonly = await login("finance-readonly");
  assert.equal(
    (await call("student", { ...s, status: "暂停" }, readonly)).status,
    403,
  );
  assert.equal((await call("period", payload, readonly)).status, 403);
  assert.equal(evidence(), before);
  db.close();
});

test("v5 custody transfer and v13 full backup preserve status; older formats default without changing periods or ledger", async () => {
  const source = new DatabaseSync(env.DB_PATH),
    bundle = T.exportData(source);
  assert.equal(bundle.version, 5);
  const file = path.join(dir, "status-v12.xlsx");
  exportFullData({ dbPath: env.DB_PATH, outputPath: file });
  assert.equal(verifyFullData(file).version, 13);
  for (const old of [false, true]) {
    const target = path.join(dir, "restore-" + old + ".sqlite");
    assert.equal(
      spawnSync(process.execPath, ["src/server.js", "--init-db"], {
        cwd: root,
        env: { ...env, DB_PATH: target },
        windowsHide: true,
      }).status,
      0,
    );
    let input = file;
    if (old) {
      const data = structuredClone(verifyFullData(file).data);
      data.tg_students.forEach((s) => delete s.status);
      const sheets = parseWorkbook(
        buildFullDataBufferFromSourceData(data).buffer,
      ).sheets.map((s) => ({
        name: s.name,
        state: s.state,
        rows: s.rows.map((r) => [...r]),
      }));
      const info = sheets.find((s) => s.name === "导出说明"),
        meta = sheets.find((s) => s.name === "__恢复元数据");
      info.rows.find((r) => r[0] === "格式版本")[1] = 11;
      meta.rows.find((r) => r[1] === "format_version")[2] = 11;
      meta.rows.find((r) => r[0] === "工作表" && r[1] === "导出说明")[3] =
        crypto
          .createHash("sha256")
          .update(JSON.stringify(info.rows))
          .digest("hex");
      input = path.join(dir, "old-v11.xlsx");
      fs.writeFileSync(input, createWorkbook(sheets));
    }
    restoreFullData({ dbPath: target, inputPath: input });
    const db = new DatabaseSync(target);
    assert.deepEqual(
      db
        .prepare("SELECT status FROM tg_students ORDER BY id")
        .all()
        .map((r) => r.status),
      old
        ? Array(6).fill("在托")
        : source
            .prepare("SELECT status FROM tg_students ORDER BY id")
            .all()
            .map((r) => r.status),
    );
    for (const table of ["tg_periods", "tg_attendance", "tg_ledger"])
      assert.deepEqual(
        db.prepare("SELECT * FROM " + table + " ORDER BY id").all(),
        source.prepare("SELECT * FROM " + table + " ORDER BY id").all(),
      );
    db.close();
  }
  for (const version of [1, 2, 3, 4, 5]) {
    const db = new DatabaseSync(
      path.join(dir, "transfer-" + version + ".sqlite"),
    );
    db.exec("CREATE TABLE teachers(id INTEGER PRIMARY KEY)");
    TG.migrate(db);
    const copy = structuredClone(bundle);
    copy.version = version;
    if (version < 4)
      copy.records.tg_students.forEach((i) => delete i.record.status);
    if (version === 1)
      copy.records.tg_ledger.forEach((i) => {
        delete i.record.actual_amount;
        delete i.record.gift_amount;
      });
    const { checksum, ...content } = copy;
    copy.checksum = T.hash(content);
    const text = JSON.stringify(copy);
    T.parse(db, text);
    await T.confirm(
      db,
      text,
      T.signature(db),
      path.join(dir, "transfer-backups"),
      "合成",
    );
    assert.deepEqual(
      db
        .prepare("SELECT status FROM tg_students ORDER BY id")
        .all()
        .map((r) => r.status),
      version < 4
        ? Array(6).fill("在托")
        : source
            .prepare("SELECT status FROM tg_students ORDER BY id")
            .all()
            .map((r) => r.status),
    );
    const n = db.prepare("SELECT count(*) n FROM tg_ledger").get().n;
    await T.confirm(
      db,
      text,
      T.signature(db),
      path.join(dir, "transfer-backups"),
      "合成",
    );
    assert.equal(db.prepare("SELECT count(*) n FROM tg_ledger").get().n, n);
    db.close();
  }
  source.close();
});

test("funds allow optional notes, validate shared channels and refunds, query real cross-month daily ledger", async () => {
  for (const [i, channel] of ["wechat", "cash", "alipay", "other"].entries())
    assert.equal(
      (
        await call("money", {
          student_id: 5,
          date: i % 2 ? "2026-11-01" : "2026-09-01",
          kind: "充值",
          actual_amount: 10000,
          gift_amount: 1000,
          channel,
          channel_other: channel === "other" ? "银行转账" : "",
          notes: "",
        })
      ).status,
      200,
    );
  assert.equal(
    (
      await call("money", {
        student_id: 5,
        date: "2026-11-01",
        kind: "充值",
        actual_amount: 1,
        gift_amount: 0,
        channel: "任意",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("money", {
        student_id: 5,
        date: "2026-11-01",
        kind: "充值",
        actual_amount: 1,
        gift_amount: 0,
        channel: "other",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("money", {
        student_id: 5,
        date: "2026-11-01",
        kind: "退款",
        actual_amount: 999999,
        gift_amount: 0,
        channel: "cash",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("money", {
        student_id: 5,
        date: "2026-11-01",
        kind: "充值",
        actual_amount: 0,
        gift_amount: 0,
        channel: "cash",
      })
    ).status,
    400,
  );
  const refund = {
    student_id: 5,
    date: "2026-11-02",
    kind: "退款",
    actual_amount: 100,
    gift_amount: 0,
    channel: "cash",
    request_id: crypto.randomUUID(),
  };
  assert.equal((await call("money", refund)).status, 200);
  assert.equal((await call("money", refund)).status, 200);
  const old = {
    student_id: 5,
    date: "2026-09-01",
    kind: "调整",
    actual_amount: 100,
    gift_amount: 0,
    notes: "合成历史核查",
  };
  assert.equal((await call("money", old)).status, 200);
  const data = (
    await call(
      "snapshot?month=2026-11&ledger_only=1&start=2026-09-01&end=2026-11-30",
    )
  ).data;
  assert.equal(data.ledger.filter((r) => r.student_id === 5).length, 5);
  const refunds = data.ledger.filter(
    (r) => r.student_id === 5 && r.kind === "退款",
  );
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].actual_amount, -100);
  assert.equal(refunds[0].notes, "");
  assert.deepEqual(
    new Set(data.ledger.filter((r) => r.student_id === 5).map((r) => r.method)),
    new Set(["微信", "现金", "支付宝", "其他：银行转账"]),
  );
  assert.ok(data.ledger.every((r) => ["充值", "退款"].includes(r.kind)));
  assert.ok(
    (await call("snapshot?month=2026-09")).data.ledger.some(
      (r) => r.kind === "调整",
    ),
  );
  assert.equal(
    (
      await call(
        "snapshot?month=2026-11&ledger_only=1&start=2026-11-30&end=2026-09-01",
      )
    ).status,
    400,
  );
});

test("Edge profile status sorting, four-group membership, queues, conflicts, protection and readonly", async () => {
  const b = await launchBrowser(path.join(dir, "edge-status"), {
      browser: "edge",
    }),
    c = b.session;
  const go = async (v) => {
    await c.evaluate(`setActiveView('${v}');load({refreshGlobal:false})`);
    await c.waitFor('Boolean(document.querySelector("#tg-body"))');
  };
  const month = async (v) => {
    await c.evaluate(
      `document.querySelector('#tg-month').value='${v}';document.querySelector('#tg-month').dispatchEvent(new Event('change'))`,
    );
    await c.waitFor(
      `document.querySelector('[data-loaded-month]')?.dataset.loadedMonth==='${v}'`,
    );
  };
  const state = async (id, value) => {
    await c.evaluate(
      `document.querySelector('.tg-profile-status[data-student="${id}"]').value='${value}';document.querySelector('.tg-profile-status[data-student="${id}"]').dispatchEvent(new Event('change'))`,
    );
    await c.waitFor(
      `document.querySelector('.tg-profile-status[data-student="${id}"]')?.value==='${value}'&&!document.querySelector('.tg-profile-status[data-student="${id}"]').disabled`,
    );
  };
  const member = (id) => `[data-member="${id}"]`,
    settled = (id) =>
      c.waitFor(`!document.querySelector('${member(id)}').disabled`);
  try {
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await c.evaluate(
      "if(!sidebarCollapsed)document.querySelector('.sidebar-toggle').click()",
    );
    await go("tgStudents");
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-table th")].map(e=>e.textContent)',
      ),
      ["序号", "学生", "年级", "状态", "托管首日", "上次在托"],
    );
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-profile-status")].map(e=>e.value)',
      ),
      ["在托", "在托", "在托", "暂停", "已流出", "已毕业"],
    );
    assert.ok(
      await c.evaluate(
        'Boolean(document.querySelector(".tg-profile-status + .custom-select.custom-select-inline-status"))',
      ),
    );
    for (const value of ["暂停", "已流出", "已毕业", "在托"])
      await state(6, value);
    await go("tgStudents");
    assert.equal(
      await c.evaluate(
        'document.querySelector(`.tg-profile-status[data-student="6"]`).value',
      ),
      "在托",
    );
    await c.evaluate(
      `window.nativeStatusFetch=fetch;window.fetch=async(...args)=>{if(String(args[0]).endsWith('/student'))throw Error('合成状态失败');return nativeStatusFetch(...args)};const x=document.querySelector('.tg-profile-status[data-student="6"]');x.value='暂停';x.dispatchEvent(new Event('change'))`,
    );
    await c.waitFor(
      'document.querySelector("#tg-msg").textContent.includes("合成状态失败")',
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(`.tg-profile-status[data-student="6"]`).value',
      ),
      "在托",
    );
    await c.evaluate("window.fetch=nativeStatusFetch");
    const newStudent = (
      await call("student", { name: "合成卡片", grade: "初二" })
    ).data;
    await go("tgAttendance");
    await month("2027-01");
    await c.evaluate(
      "document.querySelector('#tg-query').value='无匹配';document.querySelector('#tg-query').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))",
    );
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-matrix-actions button")].map(e=>e.textContent)',
      ),
      ["管理学生", "管理日期"],
    );
    await c.click("#tg-manage-students");
    await c.waitFor('document.querySelectorAll("[data-member]").length===7');
    assert.equal(
      await c.evaluate('document.querySelectorAll(".tg-student-group").length'),
      4,
    );
    assert.doesNotMatch(
      await c.evaluate(
        'document.querySelector(".tg-student-management").textContent',
      ),
      /#\d/,
    );
    await c.evaluate(
      `window.matrixRow=document.querySelector('.tg-matrix tbody');window.memberCalls=0;window.releaseMember=null;window.fetch=async(...args)=>{if(String(args[0]).endsWith('/period')){memberCalls++;const r=await nativeStatusFetch(...args);if(memberCalls===1)await new Promise(resolve=>window.releaseMember=resolve);return r;}return nativeStatusFetch(...args)}`,
    );
    await c.evaluate(
      `document.querySelector('${member(6)}').click();document.querySelector('${member(6)}').click();document.querySelector('${member(newStudent.id)}').click()`,
    );
    await c.waitFor('typeof releaseMember==="function"');
    assert.equal(await c.evaluate("memberCalls"), 1);
    assert.equal(
      await c.evaluate(
        'matrixRow===document.querySelector(".tg-matrix tbody")',
      ),
      true,
    );
    await c.evaluate("releaseMember();window.fetch=nativeStatusFetch");
    await settled(newStudent.id);
    assert.equal(
      await c.evaluate(
        `document.querySelector('${member(6)}').dataset.selected`,
      ),
      "true",
    );
    await c.click(member(6));
    await settled(6);
    assert.equal(
      await c.evaluate(
        `document.querySelector('${member(6)}').dataset.selected`,
      ),
      "false",
    );
    // Remove a period for an inactive profile, then require an explicit profile-status change before rejoining.
    await c.click(member(3));
    await settled(3);
    await c.click(member(3));
    assert.match(
      await c.evaluate(
        'document.querySelector(".tg-student-management [role=alert]").textContent',
      ),
      /先在托管学生/,
    );
    // An external insertion makes the modal version stale; reload only membership state.
    const external = (
      await call("snapshot?month=2027-01&students_only=1")
    ).data.students.find((s) => s.id === 6);
    assert.equal(
      (
        await call("period", {
          month: "2027-01",
          student_id: 6,
          student_version: external.version,
        })
      ).status,
      200,
    );
    await c.click(member(6));
    await settled(6);
    assert.equal(
      await c.evaluate(
        `document.querySelector('${member(6)}').dataset.selected`,
      ),
      "true",
    );
    // A concurrent profile edit is reflected in the correct group after conflict recovery.
    const profile5 = (
      await call("snapshot?month=2027-01&students_only=1")
    ).data.students.find((s) => s.id === 5);
    assert.equal(
      (await call("student", { ...profile5, status: "暂停" })).status,
      200,
    );
    await c.click(member(5));
    await settled(5);
    assert.equal(
      await c.evaluate(
        `document.querySelector('${member(5)}').closest('.tg-student-group').querySelector('h3').textContent`,
      ),
      "暂停",
    );
    assert.equal(
      await c.evaluate(
        `document.querySelector('${member(5)}').dataset.selected`,
      ),
      "false",
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
        assert.equal(
          await c.evaluate(
            'document.querySelector(".tg-manage-students-panel").scrollWidth<=document.querySelector(".tg-manage-students-panel").clientWidth+1',
          ),
          true,
        );
        fs.writeFileSync(
          path.join(dir, `student-manager-${width}-${theme}.png`),
          Buffer.from(
            (await c.send("Page.captureScreenshot", { format: "png" })).data,
            "base64",
          ),
        );
      }
    await c.click(".dialog-close");
    assert.equal(
      await c.evaluate('document.querySelector("#tg-query").value'),
      "无匹配",
    );
    assert.equal(
      await c.evaluate('document.querySelector("#tg-month").value'),
      "2027-01",
    );
    await c.click("#tg-reset");
    await c.waitFor(
      `Boolean(document.querySelector('.tg-matrix tr[data-student="${newStudent.id}"]'))`,
    );
    await month("2026-09");
    await c.click("#tg-manage-students");
    await c.waitFor(
      'Boolean(document.querySelector("[data-member]:not(:disabled)"))',
    );
    await c.click(member(1));
    assert.match(
      await c.evaluate(
        'document.querySelector(".tg-student-management [role=alert]").textContent',
      ),
      /已有考勤或资金/,
    );
    await c.click(".dialog-close");
    assert.equal(
      (await call("snapshot?month=2027-01")).data.attendance.length,
      0,
    );
    await c.send("Network.clearBrowserCookies");
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.waitFor('Boolean(document.querySelector(".login-panel"))');
    await c.evaluate(
      'document.querySelector(".login-username").value="finance-readonly";document.querySelector(".login-password").value="123456";document.querySelector(".login-submit").click()',
    );
    await c.waitFor('!document.querySelector(".login-panel")');
    await go("tgStudents");
    assert.equal(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-profile-status")].every(e=>e.disabled)',
      ),
      true,
    );
    await go("tgAttendance");
    assert.equal(
      await c.evaluate(
        'document.querySelector("#tg-manage-students").disabled',
      ),
      true,
    );
    assert.deepEqual(c.exceptions, []);
    assert.ok(c.consoleErrors.every((e) => e.includes("409")));
  } finally {
    await b.close();
  }
});

test("Edge simplified recharge uses shared channel options, Beijing today, optional notes and real range picker", async () => {
  const b = await launchBrowser(path.join(dir, "edge-recharge-simple"), {
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
  try {
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await c.evaluate(
      "if(!sidebarCollapsed)document.querySelector('.sidebar-toggle').click();setActiveView('tgLedger');load({refreshGlobal:false})",
    );
    await c.waitFor('Boolean(document.querySelector("#tg-body"))');
    await month("2026-09");
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
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll("#tg-kind option")].map(e=>e.value)',
      ),
      ["", "充值", "退款"],
    );
    assert.equal(
      await c.evaluate('document.querySelectorAll("#tg-start,#tg-end").length'),
      0,
    );
    await c.click("#tg-money");
    assert.equal(
      await c.evaluate('document.querySelector(".tg-form [name=date]").value'),
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
        new Date(),
      ),
    );
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-form [name=voucher],.tg-form [name=method]").length',
      ),
      0,
    );
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-form [name=channel] option")].map(e=>[e.value,e.textContent])',
      ),
      [
        ["wechat", "微信"],
        ["cash", "现金"],
        ["alipay", "支付宝"],
        ["other", "其他"],
      ],
    );
    await c.evaluate(
      "document.querySelector('.tg-form [name=channel]').value='other';document.querySelector('.tg-form [name=channel]').dispatchEvent(new Event('change'))",
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-form [name=channel_other]").closest("label").hidden',
      ),
      false,
    );
    await c.evaluate(
      "document.querySelector('.tg-form [name=student_id]').value='6';document.querySelector('.tg-form [name=date]').value='2027-02-01';document.querySelector('.tg-form [name=actual_amount]').value='1000';document.querySelector('.tg-form [name=gift_amount]').value='100';document.querySelector('.tg-form [name=channel_other]').value='银行转账'",
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      'document.querySelector("#tg-msg")?.textContent.includes("不在当前筛选范围")',
    );
    const wrapper = '.date-range-picker[data-range-scope="tuoguan-ledger"]';
    await c.click(wrapper + " .date-range-trigger");
    await c.waitFor(
      '!document.querySelector(".date-range-picker-panel").hidden',
    );
    assert.ok(
      await c.evaluate(
        'document.querySelectorAll("[data-range-preset]").length>0',
      ),
    );
    await c.evaluate(
      `applyDateRangePickerValue(document.querySelector('${wrapper}'),'2026-09-01','2027-02-28')`,
    );
    await c.waitFor(
      'document.querySelector(".tg-table tbody").textContent.includes("银行转账")',
    );
    assert.ok(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-table tbody tr")].filter(r=>r.cells.length===9).some(r=>r.cells[2].textContent==="2026-09-01")',
      ),
    );
    const rows = await c.evaluate(
      '[...document.querySelectorAll(".tg-table tbody tr")].filter(r=>r.cells.length===9).map(r=>Number(r.cells[1].textContent))',
    );
    assert.deepEqual(
      rows,
      rows.map((_, i) => i + 1),
    );
    // Delay an earlier range response; the latest range must win.
    await c.evaluate(
      `window.rangeFetch=fetch;window.releaseRange=null;window.fetch=async(...args)=>{const r=await rangeFetch(...args);if(String(args[0]).includes('start=2026-09-01'))await new Promise(resolve=>window.releaseRange=resolve);return r};void TuoguanUI.applyRange('2026-09-01','2026-09-30')`,
    );
    await c.waitFor('typeof releaseRange==="function"');
    await c.evaluate("TuoguanUI.applyRange('2027-02-01','2027-02-28')");
    await c.waitFor(
      'document.querySelector(".tg-table tbody").textContent.includes("银行转账")',
    );
    await c.evaluate("releaseRange();window.fetch=rangeFetch");
    await c.evaluate("new Promise(requestAnimationFrame)");
    assert.ok(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-table tbody tr")].filter(r=>r.cells.length===9).every(r=>r.cells[2].textContent.startsWith("2027-02"))',
      ),
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
        await c.click(wrapper + " .date-range-trigger");
        await c.evaluate("new Promise(requestAnimationFrame)");
        assert.equal(
          await c.evaluate(
            'document.querySelector(".date-range-picker-panel").getBoundingClientRect().width<=innerWidth',
          ),
          true,
        );
        await c.evaluate("closeDateRangePicker()");
      }
    await c.click(wrapper + " .date-range-clear");
    await c.waitFor(
      'document.querySelector(`.date-range-picker[data-range-scope="tuoguan-ledger"]`).dataset.start===""',
    );
    assert.equal(
      await c.evaluate('document.querySelector("#tg-month").value'),
      "2026-09",
    );
    await c.waitFor(
      '!document.querySelector(".tg-table tbody").textContent.includes("银行转账")',
    );
    assert.doesNotMatch(
      await c.evaluate('document.querySelector(".tg-table tbody").textContent'),
      /银行转账/,
    );
    assert.deepEqual(c.exceptions, []);
    assert.deepEqual(c.consoleErrors, []);
  } finally {
    await b.close();
  }
});
