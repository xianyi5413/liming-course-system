const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync, backup } = require("node:sqlite");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");
const { exportFullData, restoreFullData } = require("../src/excel/full_backup");
const {
  buildFullDataBufferFromSourceData,
  verifyFullData,
} = require("../src/excel/full_backup");
const { parseWorkbook, createWorkbook } = require("../src/excel/xlsx_codec");
const root = path.resolve(__dirname, "..");
const matrixMonth = async (c) => {
  await c.evaluate(
    '(async()=>{setActiveView("tgAttendance");await load({refreshGlobal:false});})()',
  );
  await c.waitFor('Boolean(document.querySelector("#tg-month"))');
  await c.evaluate(
    'document.querySelector("#tg-month").value="2026-11";document.querySelector("#tg-month").dispatchEvent(new Event("change"))',
  );
  await c.waitFor('Boolean(document.querySelector(".tg-matrix"))');
};
const changeCell = async (c, date, status) => {
  await c.click('.tg-cell-button[data-student="1"][data-date="' + date + '"]');
  await c.click('.custom-select-menu.open [data-value="' + status + '"]');
  await c.waitFor('!document.querySelector(".tg-cell-button[aria-busy=true]")');
};

test("v8 backup ignores obsolete custody classes while preserving IDs and financial evidence", () => {
  const source = path.join(dir, "v8-source.xlsx");
  exportFullData({ dbPath: env.DB_PATH, outputPath: source });
  const data = verifyFullData(source).data;
  data.tg_attendance.push({
    id: 99001,
    student_id: 1,
    date: "2026-11-11",
    status: "出勤",
    notes: "合成来源",
    grade: "初一",
    rule_json: '{"present":5000,"leave_fee":2500}',
    fee: 0,
    version: 1,
    pending: 1,
    reference_fee: 5000,
    source_import_id: null,
    source_key: "合成来源行",
    source_cell: "E13",
    raw_status: "出勤",
  });
  for (const table of ["tg_students", "tg_periods", "tg_attendance"])
    for (const row of data[table]) row.class_name = "合成旧班级";
  const sheets = parseWorkbook(
    buildFullDataBufferFromSourceData(data).buffer,
  ).sheets.map((s) => ({
    name: s.name,
    state: s.state,
    rows: s.rows.map((r) => [...r]),
  }));
  const info = sheets.find((s) => s.name === "导出说明"),
    meta = sheets.find((s) => s.name === "__恢复元数据");
  info.rows.find((r) => r[0] === "格式版本")[1] = 8;
  meta.rows.find((r) => r[1] === "format_version")[2] = 8;
  meta.rows.find((r) => r[0] === "工作表" && r[1] === "导出说明")[3] = crypto
    .createHash("sha256")
    .update(JSON.stringify(info.rows))
    .digest("hex");
  const file = path.join(dir, "legacy-v8.xlsx"),
    target = path.join(dir, "legacy-v8.sqlite");
  fs.writeFileSync(file, createWorkbook(sheets));
  const init = spawnSync(process.execPath, ["src/server.js", "--init-db"], {
    cwd: root,
    env: { ...env, DB_PATH: target },
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(init.status, 0, init.stderr);
  restoreFullData({ dbPath: target, inputPath: file });
  const restored = new DatabaseSync(target);
  for (const table of [
    "tg_students",
    "tg_periods",
    "tg_attendance",
    "tg_ledger",
  ]) {
    assert.deepEqual(
      restored
        .prepare("SELECT * FROM " + table + " ORDER BY id")
        .all()
        .map((r) => ({ ...r })),
      data[table].map(({ class_name, ...r }) => r),
    );
    assert.equal(
      restored
        .prepare("PRAGMA table_info(" + table + ")")
        .all()
        .some((c) => c.name === "class_name"),
      false,
    );
  }
  assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
  restored.close();
});
let dir, env, server, port, cookie;
const key = () => crypto.randomUUID();
async function api(action, body, auth = cookie) {
  const r = await fetch(`http://127.0.0.1:${port}/api/tuoguan/${action}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", cookie: auth || "" },
    body: body
      ? JSON.stringify({ ...body, request_id: body.request_id || key() })
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-test-"));
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
  const db = new DatabaseSync(env.DB_PATH);
  db.exec("INSERT INTO tg_students(name,grade) VALUES ('合成验收学生','初一')");
  db.exec(
    "INSERT INTO students(name,grade) VALUES ('合成验收学生','初一');INSERT INTO users(username,display_name,role,password_hash,readonly_override,permission_override_enabled) SELECT 'tg-teacher','合成老师','teacher',password_hash,0,1 FROM users WHERE username='boss'; INSERT INTO user_page_permissions(user_id,permission_key) SELECT id,'tgAttendance' FROM users WHERE username='tg-teacher';",
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
  for (const [action, b] of [
    [
      "period",
      {
        student_id: 1,
        grade: "初一",
        class_name: "A班",
        start_date: "2026-11-01",
        status: "在托",
      },
    ],
    [
      "rule",
      {
        effective_date: "2026-11-01",
        present: 5000,
        leave_fee: 2500,
        absent: 5000,
      },
    ],
    ["calendar", { date: "2026-11-11", enabled: 1, version: 0 }],
    [
      "money",
      {
        student_id: 1,
        date: "2026-11-01",
        kind: "充值",
        amount: 100000,
        notes: "合成充值",
      },
    ],
  ])
    assert.equal((await api(action, b)).status, 200);
});
after(async () => {
  if (server?.exitCode == null) {
    const p = new Promise((r) => server.once("exit", r));
    server.kill();
    await p;
  } // Synthetic files kept under OS temp for screenshot review.
});
test("HTTP permission isolation and transactional optimistic conflict", async () => {
  assert.equal((await api("snapshot?month=2026-11", null, "")).status, 401);
  const teacher = await login("tg-teacher");
  assert.equal(
    (
      await api(
        "money",
        {
          student_id: 1,
          date: "2026-11-11",
          kind: "充值",
          amount: 100,
          notes: "测试",
        },
        teacher,
      )
    ).status,
    403,
  );
  const data = (await api("snapshot?month=2026-11", null, teacher)).data;
  assert.equal(data.finance, false);
  assert.equal(data.ledger, undefined);
  const b = {
    date: "2026-11-11",
    rows: [{ student_id: 1, status: "出勤", version: 0 }],
  };
  const results = await Promise.all([
    api("attendance", b, teacher),
    api("attendance", b, teacher),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await api("snapshot?month=2026-11")).data.summary[0].balance,
    95000,
  );
});
test("full Excel backup restores all custody data and financial audit", () => {
  const backup = path.join(dir, "full.xlsx"),
    target = path.join(dir, "restored.sqlite");
  exportFullData({ dbPath: env.DB_PATH, outputPath: backup });
  const init = spawnSync(process.execPath, ["src/server.js", "--init-db"], {
    cwd: root,
    env: { ...env, DB_PATH: target },
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(init.status, 0, init.stderr);
  restoreFullData({ dbPath: target, inputPath: backup });
  const a = new DatabaseSync(env.DB_PATH),
    b = new DatabaseSync(target);
  for (const t of require("../src/domain/tuoguan").TABLES)
    assert.deepEqual(
      b.prepare(`SELECT * FROM ${t}`).all(),
      a.prepare(`SELECT * FROM ${t}`).all(),
    );
  a.close();
  b.close();
});

test("legacy v7 custody backup restores into independent identities", () => {
  const source = path.join(dir, "legacy-source.xlsx");
  exportFullData({ dbPath: env.DB_PATH, outputPath: source });
  const data = verifyFullData(source).data;
  // A v7 file contains custody foreign IDs but no independent identity table.
  delete data.tg_students;
  delete data.tg_legacy_student_map;
  delete data.tg_import_sources;
  const sheets = parseWorkbook(
    buildFullDataBufferFromSourceData(data).buffer,
  ).sheets.map((s) => ({
    name: s.name,
    state: s.state,
    rows: s.rows.map((r) => [...r]),
  }));
  const info = sheets.find((s) => s.name === "导出说明"),
    meta = sheets.find((s) => s.name === "__恢复元数据");
  info.rows.find((r) => r[0] === "格式版本")[1] = 7;
  meta.rows.find((r) => r[1] === "format_version")[2] = 7;
  meta.rows.find((r) => r[0] === "工作表" && r[1] === "导出说明")[3] = crypto
    .createHash("sha256")
    .update(JSON.stringify(info.rows))
    .digest("hex");
  const file = path.join(dir, "legacy-v7.xlsx"),
    target = path.join(dir, "legacy-v7.sqlite");
  fs.writeFileSync(file, createWorkbook(sheets));
  const init = spawnSync(process.execPath, ["src/server.js", "--init-db"], {
    cwd: root,
    env: { ...env, DB_PATH: target },
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(init.status, 0, init.stderr);
  restoreFullData({ dbPath: target, inputPath: file });
  const db = new DatabaseSync(target);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tg_students").get().n, 1);
  assert.equal(db.prepare("SELECT id FROM tg_students").get().id, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM tg_ledger").get().n,
    data.tg_ledger.length,
  );
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  db.close();
});

test("legacy SQLite export upgrades custody identities in memory without modifying its source", async () => {
  const target = path.join(dir, "legacy-sqlite.sqlite"),
    file = path.join(dir, "legacy-sqlite-v8.xlsx");
  const source = new DatabaseSync(env.DB_PATH, { readOnly: true });
  await backup(source, target);
  source.close();
  const db = new DatabaseSync(target);
  db.exec("PRAGMA foreign_keys=OFF");
  const tables = ["tg_periods", "tg_rules", "tg_attendance", "tg_ledger"];
  for (const t of tables) {
    const sql = db
      .prepare("SELECT sql FROM sqlite_schema WHERE name=?")
      .get(t).sql;
    db.exec(
      sql
        .replace(/^CREATE TABLE[^\(]+\(/i, "CREATE TABLE " + t + "_legacy(")
        .replaceAll("REFERENCES tg_students(", "REFERENCES students("),
    );
    db.exec(`INSERT INTO ${t}_legacy SELECT * FROM ${t}`);
  }
  for (const t of [...tables].reverse()) db.exec(`DROP TABLE ${t}`);
  for (const t of tables) db.exec(`ALTER TABLE ${t}_legacy RENAME TO ${t}`);
  db.exec(
    "DROP TABLE tg_import_sources;DROP TABLE tg_legacy_student_map;DROP TABLE tg_students;PRAGMA foreign_keys=ON",
  );
  const before = JSON.stringify(db.prepare("SELECT * FROM students").all());
  db.close();
  exportFullData({ dbPath: target, outputPath: file });
  const result = verifyFullData(file);
  assert.equal(result.version, 9);
  assert.equal(result.data.tg_students.length, 1);
  assert.equal(result.data.tg_students[0].id, 1);
  const check = new DatabaseSync(target, { readOnly: true });
  assert.equal(
    check
      .prepare("SELECT name FROM sqlite_schema WHERE name='tg_students'")
      .get(),
    undefined,
  );
  assert.equal(
    JSON.stringify(check.prepare("SELECT * FROM students").all()),
    before,
  );
  check.close();
});

test("custody UI creates and edits its own profile without changing tutoring candidates", async () => {
  const chrome = await launchChrome(path.join(dir, "chrome-profile")),
    c = chrome.session;
  try {
    const db = new DatabaseSync(env.DB_PATH),
      before = JSON.stringify(db.prepare("SELECT * FROM students").all());
    db.close();
    await c.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
    await c.login();
    await c.evaluate(
      '(async()=>{setActiveView("tgStudents");await load({refreshGlobal:false});})()',
    );
    await c.waitFor('Boolean(document.querySelector("#tg-new"))');
    await c.click("#tg-new");
    await c.evaluate(
      'document.querySelector(".tg-form [name=name]").value="合成独立新生";document.querySelector(".tg-form [name=start_date]").value="2027-01-01"',
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor('!document.querySelector(".tg-form")');
    const student = (await api("snapshot?month=2027-01")).data.students.find(
      (s) => s.name === "合成独立新生",
    );
    assert.ok(student);
    await c.waitFor(
      'Boolean(document.querySelector(".tg-profile[data-id=\\"' +
        student.id +
        '\\"]"))',
    );
    await c.click('.tg-profile[data-id="' + student.id + '"]');
    await c.evaluate(
      'document.querySelector(".tg-form [name=notes]").value="合成独立档案备注"',
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor('!document.querySelector(".tg-form")');
    assert.equal(
      (await api("snapshot?month=2027-01")).data.students.find(
        (s) => s.id === student.id,
      ).notes,
      "合成独立档案备注",
    );
    const after = new DatabaseSync(env.DB_PATH);
    assert.equal(
      JSON.stringify(after.prepare("SELECT * FROM students").all()),
      before,
    );
    after.close();
    assert.equal(
      await c.evaluate('state.students.some(s=>s.name==="合成独立新生")'),
      false,
    );
    assert.deepEqual(c.exceptions, []);
  } finally {
    await c.close();
    if (chrome.child.exitCode == null) {
      const exited = new Promise((r) => chrome.child.once("exit", r));
      chrome.child.kill();
      await exited;
    }
  }
});

test("monthly matrix edits one cell, retains historical evidence, groups grades and preserves table/scroll", async () => {
  const db = new DatabaseSync(env.DB_PATH);
  for (let day = 1; day <= 30; day++)
    db.prepare(
      "INSERT OR IGNORE INTO tg_calendar(date,enabled) VALUES(?,1)",
    ).run("2026-11-" + String(day).padStart(2, "0"));
  db.exec(
    `INSERT INTO tg_attendance(student_id,date,status,grade,rule_json,fee,pending,raw_status,source_cell) VALUES(1,'2026-11-05','未登记','初一','{"present":5000,"leave_fee":2500}',0,1,'26','E13')`,
  );
  db.close();
  const added = await api("student", {
    name: "合成三年级",
    grade: "初三",
    start_date: "2026-11-15",
  });
  assert.equal(added.status, 200);
  const p = (await api("snapshot?month=2026-11")).data.periods.find(
    (p) => p.student_id === added.data.id,
  );
  assert.equal(
    (await api("period", { ...p, end_date: "2026-11-20", status: "退托" }))
      .status,
    200,
  );
  const browser = await launchChrome(path.join(dir, "matrix")),
    c = browser.session;
  try {
    await c.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
    await c.login();
    const before = (await api("snapshot?month=2026-11")).data;
    await matrixMonth(c);
    assert.equal(
      await c.evaluate(
        'Boolean(document.querySelector("#tg-day,#tg-matrix,#tg-class"))',
      ),
      false,
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-matrix").textContent.includes("待核对")',
      ),
      false,
    );
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-matrix tbody tr").length',
      ),
      2,
    );
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-matrix tbody tr:last-child .tg-cell-button").length',
      ),
      6,
    );
    assert.equal(
      (await api("snapshot?month=2026-11")).data.attendance.length,
      before.attendance.length,
    );
    await c.evaluate('window.matrixNode=document.querySelector(".tg-matrix")');
    await changeCell(c, "2026-11-02", "出勤");
    assert.equal(
      await c.evaluate(
        'window.matrixNode===document.querySelector(".tg-matrix")',
      ),
      true,
    );
    const saved = (await api("snapshot?month=2026-11")).data;
    assert.equal(saved.ledger.length, before.ledger.length + 1);
    await changeCell(c, "2026-11-02", "出勤");
    assert.equal(
      (await api("snapshot?month=2026-11")).data.ledger.length,
      saved.ledger.length,
    );
    await changeCell(c, "2026-11-05", "请假");
    const history = (await api("snapshot?month=2026-11")).data;
    const row = history.attendance.find((a) => a.date === "2026-11-05");
    assert.equal(row.pending, 1);
    assert.equal(row.raw_status, "26");
    assert.equal(row.fee, 0);
    assert.equal(history.ledger.length, saved.ledger.length);
    for (const width of [1440, 390])
      for (const theme of ["light", "dark"]) {
        await c.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: width === 390,
        });
        await c.evaluate(
          `document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('.tg-scroll').scrollLeft=999999;document.querySelector('.tg-scroll').scrollTop=999999`,
        );
        const geometry = await c.evaluate(
          `(()=>{const wrap=document.querySelector('.tg-scroll'),table=document.querySelector('.tg-matrix'),first=table.querySelector('tbody td'),last=table.querySelector('thead th:last-child'),r=wrap.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth+1,fixed:Math.abs(first.getBoundingClientRect().left-r.left)<3,lastVisible:last.getBoundingClientRect().right<=r.right+1,gutter:getComputedStyle(wrap).scrollbarGutter,background:getComputedStyle(first).backgroundColor};})()`,
        );
        assert.equal(geometry.overflow, false, JSON.stringify(geometry));
        assert.equal(geometry.fixed, true, JSON.stringify(geometry));
        assert.equal(geometry.lastVisible, true, JSON.stringify(geometry));
        assert.equal(geometry.gutter, "auto");
        assert.notEqual(geometry.background, "rgba(0, 0, 0, 0)");
        fs.writeFileSync(
          path.join(dir, `matrix-${width}-${theme}.png`),
          Buffer.from(
            (await c.send("Page.captureScreenshot", { format: "png" })).data,
            "base64",
          ),
        );
      }
    assert.deepEqual(c.exceptions, []);
  } finally {
    await browser.close();
  }
});

test("matrix adds a new identity, rejects duplicate periods and enforces readonly", async () => {
  const browser = await launchChrome(path.join(dir, "matrix-add")),
    c = browser.session;
  try {
    await c.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
    await c.login();
    await matrixMonth(c);
    await c.click("#tg-add-student");
    await c.evaluate(
      `document.querySelector('.tg-form [name=name]').value='合成矩阵新生';document.querySelector('.tg-form [name=start_date]').value='2026-11-16'`,
    );
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-form [name=grade] option").length',
      ),
      3,
    );
    assert.equal(
      await c.evaluate(
        'Boolean(document.querySelector(".tg-form [name=class_name]"))',
      ),
      false,
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor('!document.querySelector(".tg-form")');
    assert.match(
      await c.evaluate('document.querySelector(".tg-matrix").textContent'),
      /合成矩阵新生/,
    );
    let data = (await api("snapshot?month=2026-11")).data;
    const student = data.students.find((s) => s.name === "合成矩阵新生");
    assert.ok(student);
    assert.equal(
      data.attendance.filter((a) => a.student_id === student.id).length,
      0,
    );
    assert.equal(
      (
        await api("period", {
          student_id: student.id,
          grade: "初一",
          start_date: "2026-11-17",
          status: "在托",
        })
      ).status,
      400,
    );
    const readonly = new DatabaseSync(env.DB_PATH);
    readonly.exec(
      "UPDATE users SET readonly_override=1 WHERE username='tg-teacher'",
    );
    readonly.close();
    await c.evaluate(
      '(async()=>{await fetch("/api/auth/logout",{method:"POST"});location.reload()})()',
    );
    await c.waitFor('Boolean(document.querySelector(".login-panel"))');
    await c.evaluate(
      `document.querySelector('.login-username').value='tg-teacher';document.querySelector('.login-password').value='123456';document.querySelector('.login-submit').click()`,
    );
    await c.waitFor(
      'Boolean(document.querySelector(".nav-btn[data-nav-group=tuoguan]"))',
    );
    await matrixMonth(c);
    assert.equal(
      await c.evaluate('Boolean(document.querySelector("#tg-add-student"))'),
      false,
    );
    assert.equal(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-cell-button")].every(b=>b.disabled)',
      ),
      true,
    );
    const teacher = await login("tg-teacher");
    assert.equal(
      (
        await api(
          "attendance",
          {
            date: "2026-11-02",
            rows: [{ student_id: 1, status: "请假", version: 1 }],
          },
          teacher,
        )
      ).status,
      403,
    );
    assert.deepEqual(c.exceptions, []);
  } finally {
    await browser.close();
  }
});

test("matrix keyboard, failed/conflicting writes, returning identity and delayed page switch", async () => {
  const calendar = (await api("snapshot?month=2026-11")).data.calendar.find(
    (c) => c.date === "2026-11-27",
  );
  assert.equal(
    (
      await api("calendar", {
        date: "2026-11-27",
        enabled: 1,
        version: calendar?.version || 0,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api("attendance", {
        date: "2026-11-27",
        rows: [{ student_id: 1, status: "出勤", version: 0 }],
      })
    ).status,
    200,
  );
  const returning = (
    await api("student", {
      name: "合成返回学生",
      grade: "初二",
      start_date: "2026-10-01",
    })
  ).data;
  const oldPeriod = (await api("snapshot?month=2026-10")).data.periods.find(
    (p) => p.student_id === returning.id,
  );
  assert.equal(
    (
      await api("period", {
        ...oldPeriod,
        end_date: "2026-10-31",
        status: "退托",
      })
    ).status,
    200,
  );
  const browser = await launchChrome(path.join(dir, "matrix-conflict")),
    c = browser.session;
  const selector = '.tg-cell-button[data-student="1"][data-date="2026-11-27"]';
  try {
    await c.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
    await c.login();
    await matrixMonth(c);
    // Another operator updates the same cell after this page loaded.
    assert.equal(
      (
        await api("attendance", {
          date: "2026-11-27",
          rows: [{ student_id: 1, status: "请假", version: 1 }],
        })
      ).status,
      200,
    );
    await changeCell(c, "2026-11-27", "放假");
    await c.waitFor(
      "document.querySelector(" +
        JSON.stringify(selector) +
        ').textContent.includes("请假")',
    );
    assert.match(
      await c.evaluate('document.querySelector("#tg-msg").textContent'),
      /变更|冲突|他人修改/,
    );
    await c.evaluate(
      `window.normalMatrixFetch=window.fetch;window.fetch=async function(url,opts){if(url==='/api/tuoguan/attendance')throw Error('合成保存失败');return normalMatrixFetch(url,opts)};document.querySelector(${JSON.stringify(selector)}).focus()`,
    );
    await c.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await c.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await c.waitFor(
      'Boolean(document.querySelector(".custom-select-menu.open"))',
    );
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".custom-select-menu.open [data-value]")].map(x=>x.dataset.value)',
      ),
      ["出勤", "请假", "放假", "不适用"],
    );
    await c.click('.custom-select-menu.open [data-value="放假"]');
    await c.waitFor(
      'document.querySelector("#tg-msg").textContent.includes("合成保存失败")',
    );
    assert.match(
      await c.evaluate(
        "document.querySelector(" + JSON.stringify(selector) + ").textContent",
      ),
      /请假/,
    );
    await c.evaluate(
      'window.fetch=normalMatrixFetch;document.querySelector("#tg-query").value="无匹配";document.querySelector("#tg-search").click()',
    );
    await c.click("#tg-add-student");
    await c.evaluate(
      `const pick=document.querySelector('.tg-form [name=student_id]');pick.value='${returning.id}';pick.dispatchEvent(new Event('change'));document.querySelector('.tg-form [name=start_date]').value='2026-11-12'`,
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor('!document.querySelector(".tg-form")');
    await c.waitFor(
      'document.querySelector(".tg-matrix").textContent.includes("合成返回学生")',
    );
    const data = (await api("snapshot?month=2026-11")).data;
    assert.equal(
      data.students.filter((s) => s.name === "合成返回学生").length,
      1,
    );
    assert.equal(
      data.periods.filter((p) => p.student_id === returning.id).length,
      2,
    );
    assert.equal(
      data.attendance.filter((a) => a.student_id === returning.id).length,
      0,
    );
    await c.evaluate(
      `window.matrixResponseHeld=false;window.fetch=async function(url,opts){const result=await normalMatrixFetch(url,opts);if(url==='/api/tuoguan/attendance'){window.matrixResponseHeld=true;await new Promise(r=>window.releaseMatrixSave=r);}return result;}`,
    );
    await c.click(selector);
    await c.click('.custom-select-menu.open [data-value="不适用"]');
    await c.waitFor("matrixResponseHeld");
    await c.evaluate('setActiveView("tgStudents");load({refreshGlobal:false})');
    await c.waitFor('Boolean(document.querySelector("#tg-new"))');
    await c.evaluate(
      'window.pageBeforeRelease=document.querySelector("#tg-body");releaseMatrixSave();window.fetch=normalMatrixFetch',
    );
    await c.evaluate("new Promise(requestAnimationFrame)");
    assert.equal(
      await c.evaluate(
        'view==="tgStudents"&&pageBeforeRelease===document.querySelector("#tg-body")',
      ),
      true,
    );
    assert.equal(
      (await api("snapshot?month=2026-11")).data.attendance.find(
        (a) => a.student_id === 1 && a.date === "2026-11-27",
      ).status,
      "不适用",
    );
    assert.deepEqual(c.exceptions, []);
  } finally {
    await browser.close();
  }
});
