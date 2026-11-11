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
test("custody mobile batch control remains readable and operable", async () => {
  const chrome = await launchChrome(path.join(dir, "chrome-mobile")),
    c = chrome.session;
  try {
    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await c.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
    await c.login();
    await c.evaluate(
      '(async()=>{setActiveView("tgAttendance");await load({refreshGlobal:false});})()',
    );
    await c.waitFor('Boolean(document.querySelector("#tg-day"))');
    await c.evaluate(
      'document.querySelector("#tg-day").value="2026-11-11";document.querySelector("#tg-day").dispatchEvent(new Event("change"))',
    );
    await c.waitFor('Boolean(document.querySelector(".tg-one"))');
    await c.click(".sidebar-toggle");
    assert.equal(
      await c.evaluate(
        'document.querySelector("#tg-batch + .custom-select").getBoundingClientRect().width >= 105',
      ),
      true,
    );
    await c.click("#tg-batch + .custom-select .custom-select-button");
    await c.click('.custom-select-menu.open [data-value="出勤"]');
    assert.equal(
      await c.evaluate('document.querySelector("#tg-batch").value'),
      "出勤",
    );
    assert.equal(
      await c.evaluate("document.documentElement.scrollWidth <= innerWidth+1"),
      true,
    );
    for (const theme of ["light", "dark"]) {
      await c.evaluate(
        "document.documentElement.dataset.theme=" + JSON.stringify(theme),
      );
      fs.writeFileSync(
        path.join(dir, "mobile-final-" + theme + ".png"),
        Buffer.from(
          (await c.send("Page.captureScreenshot", { format: "png" })).data,
          "base64",
        ),
      );
    }
    assert.deepEqual(c.exceptions, []);
    console.log("Mobile screenshots:", dir);
  } finally {
    await c.close();
    if (chrome.child.exitCode == null) {
      const exited = new Promise((r) => chrome.child.once("exit", r));
      chrome.child.kill();
      await exited;
    }
  }
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
  db.exec(
    "INSERT INTO tg_students(name,grade,class_name) VALUES ('合成验收学生','初一','A班')",
  );
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
  assert.equal(result.version, 8);
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

test("custody UI: five routes, drafts, filtering, batch, shared controls, themes and permissions", async () => {
  const chrome = await launchChrome(path.join(dir, "chrome"));
  const c = chrome.session;
  const shot = async (name) =>
    fs.writeFileSync(
      path.join(dir, name + ".png"),
      Buffer.from(
        (await c.send("Page.captureScreenshot", { format: "png" })).data,
        "base64",
      ),
    );
  const goto = async (key, selector) => {
    await c.click('[data-view="' + key + '"]');
    await c.waitFor(
      "Boolean(document.querySelector(" + JSON.stringify(selector) + "))",
    );
  };
  try {
    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await c.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
    await c.login();
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".nav-btn")].map(e=>e.dataset.navGroup)',
      ),
      [
        "home",
        "tuoguan",
        "schedule",
        "students",
        "teachers",
        "operations",
        "finance",
        "settings",
      ],
    );
    await c.click('[data-nav-group="tuoguan"]');
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".nav-sub-btn[data-view^=tg]")].map(e=>e.dataset.view)',
      ),
      ["tgAttendance", "tgStudents", "tgLedger", "tgSummary", "tgSettings"],
    );
    await c.click('[data-nav-group="tuoguan"]');
    assert.equal(
      await c.evaluate(
        '!!document.querySelector(".nav-sub-btn[data-view=tgAttendance]")',
      ),
      false,
    );
    await c.click('[data-nav-group="tuoguan"]');
    await goto("tgStudents", "#tg-add");
    assert.equal(
      await c.evaluate('document.querySelector(".page-title").textContent'),
      "托管学生",
    );
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-panel h2, #tg-day, #tg-month").length',
      ),
      0,
    );
    await c.click("#tg-add");
    await c.waitFor('Boolean(document.querySelector(".tg-form"))');
    assert.equal(
      await c.evaluate(
        '!!document.querySelector(".tg-form .custom-select-button")',
      ),
      true,
    );
    await shot("student-dialog");
    await c.click("[data-cancel]");
    await c.click(".tg-detail");
    await c.waitFor('Boolean(document.querySelector(".tg-detail-content"))');
    await c.click(".dialog-close");
    await goto("tgAttendance", "#tg-day");
    await c.evaluate(
      'document.querySelector("#tg-day").value="2026-11-11";document.querySelector("#tg-day").dispatchEvent(new Event("change"))',
    );
    await c.waitFor('Boolean(document.querySelector(".tg-one"))');
    assert.equal(
      await c.evaluate('document.querySelector("#tg-day").dataset.customDate'),
      "1",
    );
    await c.evaluate(
      'document.querySelector(".tg-state").value="请假";document.querySelector(".tg-state").dispatchEvent(new Event("change"));document.querySelector(".tg-note").value="合成未保存备注";document.querySelector(".tg-note").dispatchEvent(new Event("input"))',
    );
    assert.match(
      await c.evaluate('document.querySelector("#tg-dirty").textContent'),
      /1 条未保存/,
    );
    await goto("tgLedger", "#tg-money");
    await goto("tgAttendance", ".tg-one");
    assert.equal(
      await c.evaluate('document.querySelector(".tg-note").value'),
      "合成未保存备注",
    );
    await c.click(".tg-one");
    await c.waitFor(
      'document.querySelector("#tg-msg")?.textContent==="已保存"',
    );
    assert.equal(
      (await api("snapshot?month=2026-11")).data.summary.find((s) => s.id === 1)
        .fee,
      2500,
    );
    await c.evaluate(
      'document.querySelector("#tg-query").value="不存在的合成姓名"',
    );
    await c.click("#tg-search");
    assert.match(
      await c.evaluate('document.querySelector("#tg-body").textContent'),
      /当前筛选没有结果/,
    );
    await c.click("#tg-reset");
    await c.click("#tg-all");
    await c.evaluate('document.querySelector("#tg-batch").value="出勤"');
    await c.click("#tg-save");
    await c.waitFor(
      'document.querySelector("#tg-msg")?.textContent==="已保存"',
    );
    assert.equal(
      (await api("snapshot?month=2026-11")).data.summary.find((s) => s.id === 1)
        .fee,
      5000,
    );
    await shot("attendance-desktop");
    await c.click("#tg-matrix");
    assert.equal(
      await c.evaluate('document.querySelectorAll("#tg-day").length'),
      0,
    );
    assert.equal(
      await c.evaluate('document.querySelectorAll("#tg-month").length'),
      1,
    );
    await shot("matrix");
    await goto("tgSummary", "#tg-export");
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-metrics .metric").length',
      ),
      4,
    );
    await shot("summary-desktop");
    await goto("tgSettings", "#tg-rule");
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-settings-section").length',
      ),
      2,
    );
    await c.click("#tg-rule");
    await c.waitFor('Boolean(document.querySelector(".tg-form"))');
    await c.click("[data-cancel]");
    await c.click('[data-tab="导入核对"]');
    await c.waitFor('Boolean(document.querySelector("#tg-file"))');
    await c.click('[data-tab="设置"]');
    await shot("settings");
    await c.evaluate('document.documentElement.dataset.theme="dark"');
    await shot("settings-dark");
    assert.equal(
      await c.evaluate(
        'getComputedStyle(document.querySelector(".tg-table td")).backgroundColor==="rgb(255, 255, 255)"',
      ),
      false,
    );
    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await goto("tgAttendance", "#tg-matrix");
    await c.click("#tg-matrix");
    await c.waitFor('Boolean(document.querySelector(".tg-one"))');
    await c.click(".sidebar-toggle");
    await shot("attendance-mobile-dark");
    assert.equal(
      await c.evaluate(
        "document.documentElement.scrollWidth <= window.innerWidth+1",
      ),
      true,
    );
    await c.evaluate('document.documentElement.dataset.theme="light"');
    await shot("attendance-mobile");
    // Existing routes still render through the normal dispatcher.
    for (const key of ["lessons", "studentProfiles", "summary"])
      await c.evaluate(
        "(async()=>{setActiveView(" +
          JSON.stringify(key) +
          ");await load({refreshGlobal:false});})()",
      );
    assert.deepEqual(c.exceptions, []);
    // Reload with a teacher session; financial routes must not leak into the menu.
    await c.evaluate(
      '(async()=>{await fetch("/api/auth/logout",{method:"POST"});location.reload();})()',
    );
    await c.waitFor('Boolean(document.querySelector(".login-panel"))');
    await c.evaluate(
      'document.querySelector(".login-username").value="tg-teacher";document.querySelector(".login-password").value="123456";document.querySelector(".login-submit").click()',
    );
    await c.waitFor(
      'Boolean(document.querySelector(".nav-btn[data-nav-group=tuoguan]"))',
    );
    assert.equal(await c.evaluate('canView("tgStudents")'), false);
    assert.equal(await c.evaluate('canView("tgAttendance")'), true);
    console.log("Synthetic UI screenshots:", dir);
  } finally {
    await c.close();
    if (chrome.child.exitCode == null) {
      const ended = new Promise((r) => chrome.child.once("exit", r));
      chrome.child.kill();
      await ended;
    }
  }
});

test("custody save completion cannot overwrite another page", async () => {
  const chrome = await launchChrome(path.join(dir, "chrome-save")),
    c = chrome.session;
  const route = async (key, selector) => {
    await c.evaluate(
      "(async()=>{setActiveView(" +
        JSON.stringify(key) +
        ");await load({refreshGlobal:false});})()",
    );
    await c.waitFor(
      "Boolean(document.querySelector(" + JSON.stringify(selector) + "))",
    );
  };
  try {
    await c.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
    await c.login();
    await route("tgAttendance", "#tg-day");
    await c.evaluate(
      'document.querySelector("#tg-day").value="2026-11-11";document.querySelector("#tg-day").dispatchEvent(new Event("change"))',
    );
    await c.waitFor('Boolean(document.querySelector(".tg-one"))');
    await c.evaluate(
      'document.querySelector(".tg-note").value="合成延迟保存";document.querySelector(".tg-note").dispatchEvent(new Event("input"));const originalFetch=window.fetch;window.fetch=async(...args)=>{const response=await originalFetch(...args);if(String(args[0]).endsWith("/attendance")){window.__tgWaiting=true;await new Promise(resolve=>window.__tgRelease=resolve);}return response;}',
    );
    await c.click(".tg-one");
    await c.waitFor("window.__tgWaiting===true");
    await route("tgStudents", "#tg-add");
    await c.evaluate("window.__tgRelease()");
    await c.waitFor('!document.querySelector("#tg-msg")?.textContent');
    await route("tgAttendance", ".tg-one");
    assert.equal(
      await c.evaluate('document.querySelector("#tg-dirty").textContent'),
      "",
    );
    assert.equal(
      await c.evaluate('document.querySelector(".tg-note").value'),
      "合成延迟保存",
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

test("custody UI edge cases: stale drafts, empty dates, retry and readonly", async () => {
  const chrome = await launchChrome(path.join(dir, "chrome-edges")),
    c = chrome.session;
  const route = async (key, selector) => {
    await c.evaluate(
      "(async()=>{setActiveView(" +
        JSON.stringify(key) +
        ");await load({refreshGlobal:false});})()",
    );
    await c.waitFor(
      "Boolean(document.querySelector(" + JSON.stringify(selector) + "))",
    );
  };
  try {
    await c.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
    await c.login();
    await route("tgAttendance", "#tg-day");
    await c.evaluate(
      'document.querySelector("#tg-day").value="2026-11-11";document.querySelector("#tg-day").dispatchEvent(new Event("change"))',
    );
    await c.waitFor('Boolean(document.querySelector(".tg-one"))');
    await c.click(".tg-state + .custom-select .custom-select-button");
    await c.waitFor(
      'Boolean(document.querySelector(".custom-select-menu.open"))',
    );
    await c.click('.custom-select-menu.open [data-value="请假"]');
    await c.evaluate(
      'document.querySelector(".tg-note").value="合成并发草稿";document.querySelector(".tg-note").dispatchEvent(new Event("input"))',
    );
    const old = (await api("snapshot?month=2026-11")).data.attendance.find(
      (r) => r.student_id === 1,
    );
    assert.equal(
      (
        await api("attendance", {
          date: "2026-11-11",
          rows: [
            {
              student_id: 1,
              status: "停课",
              notes: "合成其他操作员更正",
              version: old?.version || 0,
            },
          ],
        })
      ).status,
      200,
    );
    await route("tgStudents", "#tg-add");
    await route("tgAttendance", ".tg-one");
    await c.click(".tg-one");
    await c.waitFor(
      'document.querySelector("#tg-msg")?.textContent.includes("他人修改")',
    );
    assert.equal(
      (await api("snapshot?month=2026-11")).data.attendance[0].status,
      "停课",
    );
    await c.click("#tg-discard");
    await c.waitFor('document.querySelector(".tg-state")?.value==="停课"');
    assert.equal(
      await c.evaluate('document.querySelector("#tg-dirty").textContent'),
      "",
    );
    await c.evaluate(
      'document.querySelector("#tg-day").value="2026-10-01";document.querySelector("#tg-day").dispatchEvent(new Event("change"))',
    );
    await c.waitFor(
      'document.querySelector("#tg-body")?.textContent.includes("当前日期没有在托学生")',
    );
    await c.send("Network.setBlockedURLs", {
      urls: ["*api/tuoguan/snapshot*"],
    });
    await c.evaluate(
      'document.querySelector("#tg-day").value="2026-11-11";document.querySelector("#tg-day").dispatchEvent(new Event("change"))',
    );
    await c.waitFor('Boolean(document.querySelector("#tg-retry"))');
    assert.equal(
      await c.evaluate('document.querySelectorAll(".tg-one").length'),
      0,
    );
    await c.send("Network.setBlockedURLs", { urls: [] });
    await c.click("#tg-retry");
    await c.waitFor('Boolean(document.querySelector(".tg-one"))');
    await route("tgSummary", "#tg-export");
    await c.evaluate(
      'document.querySelector("#tg-query").value="无匹配的合成学生"',
    );
    await c.click("#tg-search");
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".metric-value")].map(e=>e.textContent)',
      ),
      ["¥0.00", "¥0.00", "¥0.00", "¥0.00"],
    );
    // Change only the synthetic teacher account, then check the visible readonly controls.
    const db = new DatabaseSync(env.DB_PATH);
    db.exec("UPDATE users SET readonly_override=1 WHERE username='tg-teacher'");
    db.close();
    await c.evaluate(
      '(async()=>{await fetch("/api/auth/logout",{method:"POST"});location.reload();})()',
    );
    await c.waitFor('Boolean(document.querySelector(".login-panel"))');
    await c.evaluate(
      'document.querySelector(".login-username").value="tg-teacher";document.querySelector(".login-password").value="123456";document.querySelector(".login-submit").click()',
    );
    await c.waitFor('Boolean(document.querySelector("#tg-day"))');
    await c.evaluate(
      'document.querySelector("#tg-day").value="2026-11-11";document.querySelector("#tg-day").dispatchEvent(new Event("change"))',
    );
    await c.waitFor('Boolean(document.querySelector(".tg-one"))');
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-one").disabled && document.querySelector(".tg-state + .custom-select .custom-select-button").disabled',
      ),
      true,
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
