const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");
const { exportFullData, restoreFullData } = require("../src/excel/full_backup");
const root = path.resolve(__dirname, "..");
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
test("browser navigation, modal, attendance correction, matrix and mobile", async () => {
  const chrome = await launchChrome(path.join(dir, "chrome"));
  const c = chrome.session;
  try {
    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await c.click('[data-nav-group="tuoguan"]');
    await c.click('[data-view="tgFinance"]');
    await c.waitFor("Boolean(document.querySelector('#tg-add'))");
    await c.evaluate(
      `window.tgPreviousAdd=document.querySelector('#tg-add');document.querySelector('#tg-day').value='2026-11-11';document.querySelector('#tg-day').dispatchEvent(new Event('change'))`,
    );
    await c.waitFor(
      "Boolean(document.querySelector('#tg-add')) && document.querySelector('#tg-add')!==window.tgPreviousAdd",
    );
    await c.click("#tg-add");
    await c.waitFor("Boolean(document.querySelector('dialog[open]'))");
    await c.click("[data-cancel]");
    await c.click('[data-tab="签到"]');
    await c.waitFor("Boolean(document.querySelector('.tg-one'))");
    await c.evaluate("document.querySelector('.tg-state').value='请假'");
    await c.click(".tg-one");
    await c.waitFor(
      "document.querySelector('#tg-msg')?.textContent==='已保存'",
    );
    assert.equal(
      (await api("snapshot?month=2026-11")).data.summary[0].fee,
      2500,
    );
    await c.click("#tg-matrix");
    await c.waitFor(
      "document.querySelector('#tg-body')?.textContent.includes('11-11')",
    );
    await c.click('[data-tab="汇总"]');
    await c.waitFor("Boolean(document.querySelector('#tg-export'))");
    const shot = await c.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(dir, "desktop.png"),
      Buffer.from(shot.data, "base64"),
    );
    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await c.click('[data-tab="签到"]');
    await c.click("#tg-matrix");
    await c.waitFor("Boolean(document.querySelector('.tg-one'))");
    await c.click(".sidebar-toggle");
    await c.evaluate('document.querySelector("#tg-body").scrollIntoView()');
    fs.writeFileSync(
      path.join(dir, "mobile.png"),
      Buffer.from(
        (await c.send("Page.captureScreenshot", { format: "png" })).data,
        "base64",
      ),
    );
    assert.deepEqual(c.exceptions, []);
    console.log("Synthetic screenshots:", dir);
  } finally {
    await c.close();
    if (chrome.child.exitCode == null) {
      const p = new Promise((r) => chrome.child.once("exit", r));
      chrome.child.kill();
      await p;
    }
  }
});
