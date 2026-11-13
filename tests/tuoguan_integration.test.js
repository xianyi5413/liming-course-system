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
const Transfer = require("../src/domain/tuoguan_transfer");
test("v10 full backup preserves portable identities and v9 without identity tables remains restorable", () => {
  const original = new DatabaseSync(env.DB_PATH),
    bundle = Transfer.exportData(original);
  original.close();
  const file = path.join(dir, "portable-v10.xlsx");
  exportFullData({ dbPath: env.DB_PATH, outputPath: file });
  const data = verifyFullData(file).data;
  for (const version of [10, 9]) {
    const copy = structuredClone(data);
    if (version === 9) {
      delete copy.tg_transfer_meta;
      delete copy.tg_transfer_keys;
    }
    const sheets = parseWorkbook(
      buildFullDataBufferFromSourceData(copy).buffer,
    ).sheets.map((s) => ({
      name: s.name,
      state: s.state,
      rows: s.rows.map((r) => [...r]),
    }));
    const info = sheets.find((s) => s.name === "导出说明"),
      meta = sheets.find((s) => s.name === "__恢复元数据");
    info.rows.find((r) => r[0] === "格式版本")[1] = version;
    meta.rows.find((r) => r[1] === "format_version")[2] = version;
    meta.rows.find((r) => r[0] === "工作表" && r[1] === "导出说明")[3] = crypto
      .createHash("sha256")
      .update(JSON.stringify(info.rows))
      .digest("hex");
    const input = path.join(dir, `portable-${version}.xlsx`),
      target = path.join(dir, `portable-${version}.sqlite`);
    fs.writeFileSync(input, createWorkbook(sheets));
    const init = spawnSync(process.execPath, ["src/server.js", "--init-db"], {
      cwd: root,
      env: { ...env, DB_PATH: target },
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(init.status, 0, init.stderr);
    restoreFullData({ dbPath: target, inputPath: input });
    const restored = new DatabaseSync(target);
    if (version === 10) {
      assert.equal(Transfer.exportData(restored).source, bundle.source);
      assert.deepEqual(Transfer.exportData(restored).records, bundle.records);
    } else {
      assert.equal(
        restored.prepare("SELECT count(*) n FROM tg_transfer_keys").get().n,
        0,
      );
      assert.equal(
        restored.prepare("SELECT count(*) n FROM tg_students").get().n,
        data.tg_students.length,
      );
    }
    assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
    restored.close();
  }
});

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
  for (const table of ["tg_students", "tg_periods"])
    assert.deepEqual(
      restored
        .prepare("SELECT * FROM " + table + " ORDER BY id")
        .all()
        .map((r) => ({ ...r })),
      data[table].map(({ class_name, ...r }) => r),
    );
  const original = data.tg_attendance.find((r) => r.id === 99001),
    actual = restored
      .prepare("SELECT * FROM tg_attendance WHERE id=99001")
      .get();
  assert.equal(actual.fee, 5000);
  assert.equal(actual.pending, 0);
  for (const field of [
    "id",
    "date",
    "status",
    "notes",
    "grade",
    "raw_status",
    "source_key",
    "source_cell",
    "reference_fee",
  ])
    assert.equal(actual[field], original[field]);
  assert.equal(
    restored
      .prepare(
        "SELECT SUM(amount) amount FROM tg_ledger WHERE attendance_id=99001",
      )
      .get().amount,
    -5000,
  );
  const signature = require("../src/domain/tuoguan_transfer").signature(
    restored,
  );
  require("../src/domain/tuoguan").migrate(restored);
  assert.equal(
    require("../src/domain/tuoguan_transfer").signature(restored),
    signature,
  );
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
  assert.equal(result.version, 12);
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
      'Boolean(document.querySelector(".tg-profile-link[data-id=\\"' +
        student.id +
        '\\"]"))',
    );
    await c.click('.tg-profile-link[data-id="' + student.id + '"]');
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
    assert.equal(row.pending, 0);
    assert.equal(row.raw_status, "26");
    assert.equal(row.fee, 2500);
    assert.equal(history.ledger.length, saved.ledger.length + 1);
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
    await c.evaluate('setActiveView("tgStudents");load({refreshGlobal:false})');
    await c.waitFor('Boolean(document.querySelector("#tg-new"))');
    await c.click("#tg-new");
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
    await matrixMonth(c);
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
      await c.evaluate('Boolean(document.querySelector("#tg-manage-students"))'),
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
      'window.fetch=normalMatrixFetch;document.querySelector("#tg-query").value="无匹配";document.querySelector("#tg-query").dispatchEvent(new Event("input"))',
    );
    await toggleMember(c, returning.id);
    await c.click("#tg-reset");
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

test("transfer HTTP preview is read-only, confirmation is scoped and stale-safe, audit is concise and idempotent", async () => {
  const source = new DatabaseSync(path.join(dir, "portable.sqlite"));
  source.exec("CREATE TABLE teachers(id INTEGER PRIMARY KEY);");
  const TG = require("../src/domain/tuoguan");
  TG.migrate(source);
  const store = TG.createStore(source);
  const write = (a, b) =>
    store.mutate(a, { request_id: key(), ...b }, "合成来源");
  const student = write("student", {
    name: "合成迁移专用",
    grade: "初二",
    start_date: "2027-01-01",
  });
  write("money", {
    student_id: student.id,
    date: "2027-01-01",
    kind: "充值",
    amount: 12345,
    notes: "合成资金隐私备注",
  });
  const text = JSON.stringify(Transfer.exportData(source));
  source.close();
  const db = new DatabaseSync(env.DB_PATH);
  try {
    const outside = JSON.stringify(db.prepare("SELECT * FROM students").all()),
      initial = Transfer.signature(db);
    const teacher = await login("tg-teacher");
    for (const action of [
      "transfer-export",
      "transfer-preview",
      "transfer-confirm",
      "remove-dates",
    ])
      assert.equal((await api(action, { text }, teacher)).status, 403);
    assert.equal((await api("transfer-preview", { text }, "")).status, 401);
    const wire = Buffer.from(JSON.stringify({ text })),
      cut = wire.indexOf(Buffer.from("合成迁移")) + 1;
    assert.ok(cut > 1);
    const streamed = await new Promise((resolve, reject) => {
      const request = require("node:http").request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/tuoguan/transfer-preview",
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        },
      );
      request.on("error", reject);
      request.write(wire.subarray(0, cut));
      setTimeout(() => request.end(wire.subarray(cut)), 10);
    });
    assert.equal(
      streamed,
      200,
      "UTF-8 characters spanning body chunks must retain their checksum",
    );
    const preview = await api("transfer-preview", { text });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.allowed, true);
    assert.equal(Transfer.signature(db), initial);
    assert.equal(
      (
        await api("transfer-confirm", {
          token: preview.data.token,
          confirm: false,
        })
      ).status,
      409,
    );
    const body = { name: "合成并发档案", grade: "初三", request_id: key() };
    assert.equal((await api("student", body)).status, 200);
    const logs = db
      .prepare(
        "SELECT count(*) n FROM operation_logs WHERE target_type='tuoguan'",
      )
      .get().n;
    assert.equal((await api("student", body)).status, 200);
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM operation_logs WHERE target_type='tuoguan'",
        )
        .get().n,
      logs,
    );
    assert.equal(
      (
        await api("transfer-confirm", {
          token: preview.data.token,
          confirm: true,
        })
      ).status,
      409,
    );
    const fresh = await api("transfer-preview", { text }),
      result = await api("transfer-confirm", {
        token: fresh.data.token,
        confirm: true,
      });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.ok(result.data.created > 0);
    assert.ok(
      fs
        .readdirSync(path.join(dir, "backups"))
        .some((n) => n.startsWith("custody-transfer-")),
    );
    const ledger = db.prepare("SELECT * FROM tg_ledger").all();
    const again = await api("transfer-preview", { text });
    assert.equal(again.data.summary.created, 0);
    assert.equal(
      (
        await api("transfer-confirm", {
          token: again.data.token,
          confirm: true,
        })
      ).status,
      200,
    );
    assert.deepEqual(db.prepare("SELECT * FROM tg_ledger").all(), ledger);
    assert.equal(
      JSON.stringify(db.prepare("SELECT * FROM students").all()),
      outside,
    );
    const imported = db
      .prepare("SELECT id FROM tg_students WHERE name='合成迁移专用'")
      .get();
    assert.notEqual(imported.id, student.id);
    assert.equal(
      (await api("snapshot?month=2027-01")).data.summary.find(
        (s) => s.id === imported.id,
      ).balance,
      12345,
    );
    const log = db
      .prepare("SELECT * FROM operation_logs WHERE target_type='tuoguan'")
      .all();
    assert.equal(
      log.filter((l) => l.operation_type === "导入托管信息").length,
      1,
    );
    assert.ok(log.some((l) => l.result_status === "failure"));
    assert.doesNotMatch(
      JSON.stringify(log),
      /合成资金隐私备注|合成迁移专用|"records"/,
    );
    db.exec(
      "INSERT INTO users(username,display_name,role,password_hash,readonly_override,permission_override_enabled) SELECT 'ux-readonly','合成只读','academic',password_hash,1,1 FROM users WHERE username='boss'; INSERT INTO user_page_permissions(user_id,permission_key) SELECT id,'tgFinance' FROM users WHERE username='ux-readonly'",
    );
    const readonly = await login("ux-readonly");
    for (const action of [
      "transfer-export",
      "transfer-preview",
      "transfer-confirm",
      "add-dates",
    ])
      assert.equal((await api(action, { text }, readonly)).status, 403);
  } finally {
    db.close();
  }
});

test("Edge streamlined UI, default dates, persisted removals, automatic filters, three sticky columns and transfer dialogs", async () => {
  const browser = await launchChrome(path.join(dir, "ux-transfer")),
    c = browser.session;
  const go = async (view) => {
    await c.evaluate(
      `setActiveView(${JSON.stringify(view)});load({refreshGlobal:false})`,
    );
    await c.waitFor('Boolean(document.querySelector("#tg-body"))');
  };
  try {
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await go("tgAttendance");
    await c.evaluate(
      'document.querySelector("#tg-month").value="2026-12";document.querySelector("#tg-month").dispatchEvent(new Event("change"))',
    );
    await c.waitFor(
      'document.querySelector("[data-loaded-month]")?.dataset.loadedMonth==="2026-12"',
    );
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-matrix thead th").length',
      ),
      30,
    );
    assert.equal(
      await c.evaluate('Boolean(document.querySelector("#tg-search"))'),
      false,
    );
    await c.evaluate(
      'window.uxFetch=window.fetch;window.uxRequests=0;window.fetch=(...args)=>{if(String(args[0]).includes("/api/tuoguan/snapshot"))window.uxRequests++;return window.uxFetch(...args)};document.querySelector("#tg-query").value="无匹配";document.querySelector("#tg-query").dispatchEvent(new Event("input"))',
    );
    await c.waitFor('!document.querySelector(".tg-cell-button")');
    assert.equal(await c.evaluate("window.uxRequests"), 0);
    await c.click("#tg-reset");
    await c.waitFor('Boolean(document.querySelector(".tg-cell-button"))');
    await c.click('[data-tg-month-step="1"]');
    await c.waitFor(
      'document.querySelector("[data-loaded-month]")?.dataset.loadedMonth==="2027-01"',
    );
    await c.click('[data-tg-month-step="-1"]');
    await c.waitFor(
      'document.querySelector("[data-loaded-month]")?.dataset.loadedMonth==="2026-12"',
    );
    // Keep the newer February result when the held January request finishes late.
    await c.evaluate(
      'window.fetch=async(...args)=>{const response=await window.uxFetch(...args);if(String(args[0]).includes("/api/tuoguan/snapshot?month=2027-01"))await new Promise(r=>window.releaseJanuary=r);return response};',
    );
    await c.click('[data-tg-month-step="1"]');
    await c.waitFor('typeof window.releaseJanuary==="function"');
    await c.click('[data-tg-month-step="1"]');
    await c.waitFor(
      'document.querySelector("[data-loaded-month]")?.dataset.loadedMonth==="2027-02"',
    );
    await c.evaluate("window.releaseJanuary();window.fetch=window.uxFetch");
    await c.evaluate("new Promise(requestAnimationFrame)");
    assert.equal(
      await c.evaluate('document.querySelector("#tg-month").value'),
      "2027-02",
    );
    await c.evaluate(
      'document.querySelector("#tg-month").value="2026-12";document.querySelector("#tg-month").dispatchEvent(new Event("change"))',
    );
    await c.waitFor(
      'document.querySelector("[data-loaded-month]")?.dataset.loadedMonth==="2026-12"',
    );
    const button = '.tg-cell-button[data-student="1"][data-date="2026-12-01"]';
    const green = await c.evaluate(
      `document.querySelector('${button} .status-badge').getAttribute('style')`,
    );
    await c.evaluate(
      'window.fetch=async(...args)=>{const response=await window.uxFetch(...args);if(String(args[0]).includes("/api/tuoguan/attendance"))await new Promise(r=>window.releaseAttendance=r);return response};',
    );
    await c.click(button);
    await c.click('.custom-select-menu.open [data-value="不适用"]');
    await c.waitFor('typeof window.releaseAttendance==="function"');
    await c.evaluate(
      'document.querySelector("#tg-query").value="无匹配";document.querySelector("#tg-query").dispatchEvent(new Event("input"))',
    );
    await c.evaluate("new Promise(r=>setTimeout(r,220))");
    assert.ok(
      await c.evaluate(
        'Boolean(document.querySelector(".tg-cell-button[aria-busy=true]"))',
      ),
    );
    await c.evaluate("window.releaseAttendance();window.fetch=window.uxFetch");
    await c.waitFor('!document.querySelector(".tg-cell-button")');
    await c.click("#tg-reset");
    await c.waitFor('Boolean(document.querySelector(".tg-cell-button"))');
    const yellow = await c.evaluate(
      `document.querySelector('${button} .status-badge').getAttribute('style')`,
    );
    assert.notEqual(green, yellow);
    assert.equal(
      (await api("snapshot?month=2026-12")).data.attendance.find(
        (a) => a.student_id === 1 && a.date === "2026-12-01",
      ).status,
      "不适用",
    );
    await c.click("#tg-manage-dates");
    await c.waitFor(
      '!document.querySelector(`[data-manage-date="2026-12-05"]`).disabled',
    );
    await c.click('[data-manage-date="2026-12-05"]');
    await c.waitFor(
      'document.querySelector(`[data-manage-date="2026-12-05"]`).dataset.enabled==="true"&&!document.querySelector(`[data-manage-date="2026-12-05"]`).disabled',
    );
    await c.click(".shared-course-dialog .dialog-close");
    await c.waitFor(
      'Boolean(document.querySelector(`.tg-cell-button[data-date="2026-12-05"]`))',
    );
    await c.click("#tg-manage-dates");
    await c.waitFor(
      '!document.querySelector(`[data-manage-date="2026-12-05"]`).disabled',
    );
    await c.click('[data-manage-date="2026-12-05"]');
    await c.waitFor(
      'document.querySelector(`[data-manage-date="2026-12-05"]`).dataset.enabled==="false"',
    );
    await c.click(".shared-course-dialog .dialog-close");
    await c.waitFor(
      '!document.querySelector(`.tg-cell-button[data-date="2026-12-05"]`)',
    );
    assert.equal(
      (await api("snapshot?month=2026-12")).data.calendar.find(
        (d) => d.date === "2026-12-05",
      ).enabled,
      0,
    );
    const student = await api("student", {
      name: "合成移除矩阵行",
      grade: "初三",
      start_date: "2026-12-01",
    });
    await go("tgAttendance");
    await toggleMember(c, student.data.id);
    assert.ok(
      (await api("snapshot?month=2026-12")).data.students.some(
        (s) => s.id === student.data.id,
      ),
    );
    assert.equal(
      await c.evaluate(
        `Boolean(document.querySelector('.tg-cell-button[data-student="${student.data.id}"]'))`,
      ),
      false,
    );
    await toggleMember(c, student.data.id);
    assert.equal(
      (await api("snapshot?month=2026-12")).data.periods.find(
        (p) =>
          p.student_id === student.data.id && p.start_date === "2026-12-01",
      ).end_date,
      "2026-12-31",
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
          `document.documentElement.dataset.theme='${theme}';scheduleAdaptiveTableColumns();`,
        );
        await c.evaluate(
          "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
        );
        await c.evaluate(
          'document.querySelector(".tg-scroll").scrollLeft=999999',
        );
        const geometry = await c.evaluate(
          `(()=>{const w=document.querySelector('.tg-scroll'),t=document.querySelector('.tg-matrix'),a=t.querySelector('tbody td'),b=a.nextElementSibling;return {first:a.getBoundingClientRect().left-w.getBoundingClientRect().left,second:b.getBoundingClientRect().left-a.getBoundingClientRect().right,opaque:getComputedStyle(b).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth+1,badges:b.querySelectorAll('.student-badge').length,grade:b.nextElementSibling.querySelectorAll('.grade-badge').length};})()`,
        );
        assert.ok(
          Math.abs(geometry.first) < 3 && Math.abs(geometry.second) < 3,
          JSON.stringify(geometry),
        );
        assert.equal(geometry.overflow, false);
        assert.notEqual(geometry.opaque, "rgba(0, 0, 0, 0)");
        assert.equal(geometry.badges, 1);
        assert.equal(geometry.grade, 1);
        if (width === 390)
          await c.evaluate(
            'document.querySelector(".tg-actions").scrollIntoView({block:"start"})',
          );
        fs.writeFileSync(
          path.join(dir, `ux-${width}-${theme}.png`),
          Buffer.from(
            (await c.send("Page.captureScreenshot", { format: "png" })).data,
            "base64",
          ),
        );
      }
    await go("tgStudents");
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-table th")].map(e=>e.textContent)',
      ),
      ["序号", "学生", "年级", "状态", "托管首日", "上次在托"],
    );
    assert.equal(
      await c.evaluate(
        'Boolean(document.querySelector("#tg-month,.tg-profile,.tg-period,#tg-enroll"))',
      ),
      false,
    );
    await go("tgLedger");
    assert.doesNotMatch(
      await c.evaluate('document.querySelector("#tg-body").textContent'),
      /最近操作/,
    );
    await go("tgSettings");
    assert.doesNotMatch(
      await c.evaluate('document.querySelector("#tg-body").textContent'),
      /值班|历史导入|核对历史/,
    );
    await c.click("#tg-copy");
    await c.waitFor(
      'Boolean(document.querySelector("textarea.transfer-text"))',
    );
    const bundle = await c.evaluate(
      'document.querySelector("textarea.transfer-text").value',
    );
    assert.equal(JSON.parse(bundle).type, "liming_custody");
    await c.evaluate(
      'Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async()=>{throw Error("synthetic clipboard unavailable")}}})',
    );
    await c.click("[data-transfer-submit]");
    await c.waitFor(
      'document.querySelector(".salary-template-form [role=alert]").textContent.includes("请复制")',
    );
    await c.click(".shared-course-dialog .dialog-close");
    await c.click("#tg-paste");
    await c.evaluate(
      `document.querySelector('textarea.transfer-text').value=${JSON.stringify(bundle)}`,
    );
    await c.click("[data-transfer-submit]");
    await c.waitFor(
      'document.querySelector("[data-transfer-submit]")?.textContent==="确认导入"',
    );
    assert.match(
      await c.evaluate(
        'document.querySelector(".tg-transfer-preview").textContent',
      ),
      /新增 0/,
    );
    await c.click("[data-transfer-submit]");
    await c.waitFor('!document.querySelector("textarea.transfer-text")');
    assert.deepEqual(c.exceptions, []);
  } finally {
    await browser.close();
  }
});

async function toggleMember(c,id){
  await c.click('#tg-manage-students');
  await c.waitFor(`Boolean(document.querySelector('[data-member="${id}"]:not(:disabled)'))`);
  await c.click(`[data-member="${id}"]`);
  await c.waitFor(`!document.querySelector('[data-member="${id}"]').disabled`);
  await c.click('.shared-course-dialog .dialog-close');
}
