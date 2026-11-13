const { before, after, test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process"),
  { DatabaseSync, backup } = require("node:sqlite");
const { launchBrowser, freePort } = require("./helpers/chrome_cdp"),
  TG = require("../src/domain/tuoguan"),
  T = require("../src/domain/tuoguan_transfer");
const Excel = require("../src/excel/full_backup"),
  Codec = require("../src/excel/xlsx_codec");
const root = path.resolve(__dirname, "..");
let dir, env, port, server, admin;
async function api(cookie, url, body) {
  const r = await fetch(`http://127.0.0.1:${port}/api/${url}`, {
    method: body ? "POST" : "GET",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
async function login(username) {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123456" }),
  });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-stage-ui-"));
  port = await freePort();
  env = {
    ...process.env,
    DATA_DIR: dir,
    DB_PATH: path.join(dir, "fixture.sqlite"),
    PORT: String(port),
    SESSION_COOKIE_SECURE: "false",
  };
  const result = spawnSync(process.execPath, ["src/server.js", "--init-db"], {
    cwd: root,
    env,
    windowsHide: true,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const db = new DatabaseSync(env.DB_PATH),
    store = TG.createStore(db),
    write = (a, b) =>
      store.mutate(a, { ...b, request_id: crypto.randomUUID() }, "合成");
  for (const grade of ["三年级", "初三"])
    write("student", { name: "合成同名", grade, start_date: "2026-09-01" });
  for (const [student_id, date, actual_amount, gift_amount] of [
    [1, "2026-08-31", 20000, 1000],
    [1, "2026-09-01", 10000, 2000],
    [2, "2026-09-01", 99000, 0],
  ])
    write("money", {
      student_id,
      date,
      kind: "充值",
      actual_amount,
      gift_amount,
    });
  write("attendance", {
    date: "2026-09-01",
    rows: [1, 2].map((student_id) => ({
      student_id,
      status: "出勤",
      version: 0,
    })),
  });
  for (const key of [
    "tgAttendance",
    "tgStudents",
    "tgLedger",
    "tgSummary",
    "tgSettings",
    "tgFinance",
    "none",
    "readonly",
  ]) {
    db.prepare(
      "INSERT INTO users(username,display_name,role,password_hash,readonly_override,permission_override_enabled) SELECT ?,?,'helper',password_hash,?,1 FROM users WHERE username='boss'",
    ).run(key, key, key === "readonly" ? 1 : 0);
    const id = db.prepare("SELECT id FROM users WHERE username=?").get(key).id;
    db.prepare(
      "INSERT INTO user_page_permissions(user_id,permission_key,enabled) VALUES(?,?,1)",
    ).run(
      id,
      key === "readonly" ? "tgSettings" : key === "none" ? "dashboard" : key,
    );
  }
  db.close();
  server = spawn(process.execPath, ["src/server.js"], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: "ignore",
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) {
        admin = await login("boss");
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("server unavailable");
});
after(async () => {
  if (server?.exitCode == null) {
    const end = new Promise((r) => server.once("exit", r));
    server.kill();
    await end;
  }
});
test("five permissions enforce each read/write API, legacy equivalent migration, readonly and no finance leaks", async () => {
  const pages = [
    "tgAttendance",
    "tgStudents",
    "tgLedger",
    "tgSummary",
    "tgSettings",
  ];
  for (const key of pages) {
    const cookie = await login(key);
    for (const view of pages) {
      const r = await api(
        cookie,
        `tuoguan/snapshot?month=2026-09&view=${view}`,
      );
      assert.equal(r.status, key === view ? 200 : 403, `${key} -> ${view}`);
      if (key === view && ["tgStudents", "tgAttendance"].includes(key)) {
        assert.equal(r.data.summary, undefined);
        assert.equal(r.data.ledger, undefined);
        assert.ok(r.data.attendance.every((a) => a.fee === undefined));
      }
    }
    assert.equal(
      (await api(cookie, "tuoguan/student-history?student_id=1")).status,
      ["tgSummary", "tgLedger"].includes(key) ? 200 : 403,
    );
    for (const [action, permission] of [
      ["student", "tgStudents"],
      ["attendance", "tgAttendance"],
      ["money", "tgLedger"],
      ["rule", "tgSettings"],
      ["add-dates", "tgAttendance"],
    ]) {
      const r = await api(cookie, "tuoguan/" + action, {
        request_id: crypto.randomUUID(),
      });
      assert.equal(r.status === 403, key !== permission, `${key}:${action}`);
    }
    assert.equal(
      (await api(cookie, "tuoguan/transfer-export", {})).status,
      403,
    );
  }
  const defaultSummary = await api(
    await login("tgSummary"),
    "tuoguan/snapshot?month=2026-09",
  );
  assert.equal(defaultSummary.data.rules, undefined);
  assert.equal(defaultSummary.data.ledger, undefined);
  const legacy = await login("tgFinance");
  for (const page of pages)
    assert.equal(
      (await api(legacy, `tuoguan/snapshot?month=2026-09&view=${page}`)).status,
      page === "tgAttendance" ? 403 : 200,
    );
  assert.equal(
    (
      await api(await login("readonly"), "tuoguan/rule", {
        stage: "小学",
        effective_date: "2026-11-01",
        present: 1,
        leave_fee: 1,
        absent: 0,
        request_id: crypto.randomUUID(),
      })
    ).status,
    403,
  );
  assert.equal(
    (await api(await login("none"), "tuoguan/snapshot?month=2026-09")).status,
    403,
  );
  const db = new DatabaseSync(env.DB_PATH, { readOnly: true });
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM user_page_permissions WHERE permission_key='tgFinance'",
      )
      .get().n,
    0,
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM role_permissions WHERE role_code='teacher' AND permission_key LIKE 'tg%'",
      )
      .get().n,
    0,
  );
  db.close();
});
test("committed attendance logs include truth, detail API, replay/no-op and rollback behavior", async () => {
  const body = {
    date: "2026-09-02",
    request_id: crypto.randomUUID(),
    rows: [{ student_id: 1, status: "请假", version: 0 }],
  };
  assert.equal((await api(admin, "tuoguan/attendance", body)).status, 200);
  const logs = () => api(admin, "operation-logs?page_size=100");
  let rows = (await logs()).data.items.filter(
    (r) => r.operation_type === "修改托管考勤",
  );
  const first = rows.length;
  assert.match(
    rows[0].operation_content,
    /合成同名（三年级）2026-09-02考勤：未保存默认出勤 → 请假/,
  );
  const details = await api(
    admin,
    `operation-logs/${rows[0].id}/custody-details`,
  );
  assert.equal(details.data.changes.length, 1);
  assert.equal(
    (
      await api(
        await login("tgAttendance"),
        `operation-logs/${rows[0].id}/custody-details`,
      )
    ).status,
    403,
  );
  await api(admin, "tuoguan/attendance", body);
  await api(admin, "tuoguan/attendance", {
    ...body,
    request_id: crypto.randomUUID(),
    rows: [{ student_id: 1, status: "请假", version: 1 }],
  });
  assert.equal(
    (await logs()).data.items.filter((r) => r.operation_type === "修改托管考勤")
      .length,
    first,
  );
  const bad = await api(admin, "tuoguan/batch-attendance", {
    request_id: crypto.randomUUID(),
    month: "2026-09",
    status: "出勤",
    cells: [
      { student_id: 1, date: "2026-09-02", version: 1 },
      { student_id: 2, date: "2026-09-02", version: 99 },
    ],
  });
  assert.equal(bad.status, 409);
  const db = new DatabaseSync(env.DB_PATH, { readOnly: true });
  assert.equal(
    db
      .prepare(
        "SELECT status FROM tg_attendance WHERE student_id=1 AND date='2026-09-02'",
      )
      .get().status,
    "请假",
  );
  db.close();
});
test("large batch exposes every committed cell through lazy audit details without truncation", async () => {
  const ids = [];
  for (let i = 0; i < 8; i++) {
    const r = await api(admin, "tuoguan/student", {
      name: "合成批量审计" + i,
      grade: "初二",
      month: "2026-11",
      request_id: crypto.randomUUID(),
    });
    assert.equal(r.status, 200);
    ids.push(r.data.student.id);
  }
  const dates = [
    "02",
    "03",
    "04",
    "05",
    "06",
    "09",
    "10",
    "11",
    "12",
    "13",
  ].map((d) => "2026-11-" + d);
  const cells = ids.flatMap((student_id) =>
    dates.map((date) => ({ student_id, date, version: 0 })),
  );
  assert.equal(
    (
      await api(admin, "tuoguan/batch-attendance", {
        request_id: crypto.randomUUID(),
        month: "2026-11",
        status: "请假",
        cells,
      })
    ).status,
    200,
  );
  const rows = (await api(admin, "operation-logs?page_size=100")).data.items,
    log = rows.find((r) => r.operation_type === "批量修改托管考勤");
  assert.match(log.operation_content, /8名学生、10个日期，共80格/);
  assert.ok(log.extra_json.length < 4000);
  const detail = await api(admin, `operation-logs/${log.id}/custody-details`);
  assert.equal(detail.data.changes.length, 80);
  assert.ok(JSON.stringify(detail.data).length > 4000);
});
test("v14 visible custody sheets and exact restore; authentic v13 sheet layout and legacy permission migration", async () => {
  const file = path.join(dir, "new.xlsx");
  Excel.exportFullData({ dbPath: env.DB_PATH, outputPath: file });
  const verified = Excel.verifyFullData(file);
  assert.equal(verified.version, 14);
  for (const name of [
    "托管学生",
    "托管每日签到",
    "托管充值流水",
    "托管收费规则",
  ])
    assert.ok(verified.workbook.sheetMap.has(name));
  assert.equal(verified.workbook.sheetMap.get("托管充值流水").rows.length, 4);
  const source = new DatabaseSync(env.DB_PATH),
    target = path.join(dir, "restored.sqlite");
  await backup(source, target);
  source.close();
  Excel.restoreFullData({ dbPath: target, inputPath: file });
  const restored = new DatabaseSync(target, { readOnly: true });
  for (const table of [
    "tg_students",
    "tg_attendance",
    "tg_ledger",
    "tg_rules",
    "role_permissions",
    "user_page_permissions",
    "tg_transfer_keys",
    "tg_transfer_baselines",
  ])
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          restored.prepare("SELECT * FROM " + table + " ORDER BY rowid").all(),
        ),
      ),
      verified.data[table],
      table,
    );
  restored.close();
  const old = structuredClone(verified.data);
  for (const r of old.tg_rules) delete r.stage;
  for (const r of old.tg_audit) delete r.origin_json;
  old.tg_transfer_baselines = [];
  const id = old.users.find((u) => u.username === "tgFinance").id;
  old.user_page_permissions = old.user_page_permissions.filter(
    (r) => r.user_id !== id,
  );
  old.user_page_permissions.push({
    user_id: id,
    permission_key: "tgFinance",
    enabled: 1,
    updated_at: "2026-09-01 00:00:00",
  });
  const built = Excel.buildFullDataBufferFromSourceData(old),
    names = new Set([
      "托管学生",
      "托管每日签到",
      "托管充值流水",
      "托管收费规则",
    ]);
  const sheets = Codec.parseWorkbook(built.buffer)
    .sheets.filter((s) => !names.has(s.name))
    .map((s) => ({
      name: s.name,
      state: s.state,
      rows: s.rows.map((r) => [...r]),
    }));
  const info = sheets.find((s) => s.name === "导出说明"),
    meta = sheets.find((s) => s.name === "__恢复元数据");
  info.rows.find((r) => r[0] === "格式版本")[1] = 13;
  meta.rows = meta.rows.filter((r) => !names.has(r[1]));
  meta.rows.find((r) => r[1] === "format_version")[2] = 13;
  meta.rows.find((r) => r[0] === "工作表" && r[1] === "导出说明")[3] = crypto
    .createHash("sha256")
    .update(JSON.stringify(info.rows))
    .digest("hex");
  const oldFile = path.join(dir, "v13.xlsx");
  fs.writeFileSync(oldFile, Codec.createWorkbook(sheets));
  assert.equal(Excel.verifyFullData(oldFile).version, 13);
  const Import = require("../src/excel/import_service");
  assert.equal(Import.previewImport(oldFile).format_version, 13);
  Import.importFullExcel({
    dbPath: target,
    inputPath: oldFile,
    mode: "overwrite",
    preBackupSatisfied: true,
  });
  const db = new DatabaseSync(target);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM user_page_permissions WHERE permission_key='tgFinance'",
      )
      .get().n,
    0,
  );
  assert.deepEqual(
    db
      .prepare("SELECT * FROM tg_ledger ORDER BY id")
      .all()
      .map((r) => ({ ...r })),
    verified.data.tg_ledger,
  );
  assert.deepEqual(
    db
      .prepare("SELECT * FROM tg_attendance ORDER BY id")
      .all()
      .map((r) => ({ ...r })),
    verified.data.tg_attendance,
  );
  db.close();
});
async function open(c, view) {
  await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await c.waitFor(
    'Boolean(document.querySelector(".login-panel"))||Boolean(auth.user)',
  );
  if (await c.evaluate('Boolean(document.querySelector(".login-panel"))'))
    await c.login();
  await c.evaluate(`setActiveView('${view}');load({refreshGlobal:false})`);
  await c.waitFor('Boolean(document.querySelector("#tg-body"))');
  if (view !== "tgSettings") {
    await c.evaluate(
      "document.querySelector('#tg-month').value='2026-09';document.querySelector('#tg-month').dispatchEvent(new Event('change'))",
    );
    await c.waitFor(
      "document.querySelector('[data-loaded-month]')?.dataset.loadedMonth==='2026-09'",
    );
  }
}
test("Edge both-axis all selection, last-date uncheck, filters, silent cell save, pricing form and primary selectors", async () => {
  const browser = await launchBrowser(path.join(dir, "edge-stage-matrix"), {
      browser: "edge",
    }),
    c = browser.session;
  try {
    await open(c, "tgAttendance");
    await c.click(".tg-select-all");
    assert.equal(
      await c.evaluate(
        "[...document.querySelectorAll('.tg-select-student:not(:disabled),.tg-select-date:not(:disabled)')].every(x=>x.checked)",
      ),
      true,
    );
    await c.evaluate(
      "document.querySelectorAll('.tg-select-date:checked').forEach(x=>x.click())",
    );
    assert.equal(
      await c.evaluate(
        "document.querySelector('#tg-batch-attendance').disabled",
      ),
      true,
    );
    assert.equal(
      await c.evaluate(
        "document.querySelector('.tg-select-all').indeterminate",
      ),
      true,
    );
    await c.click(".tg-select-all");
    await c.click(".tg-select-all");
    assert.equal(
      await c.evaluate(
        "document.querySelectorAll('.tg-select-student:checked,.tg-select-date:checked').length",
      ),
      0,
    );
    await c.evaluate(
      "document.querySelector('#tg-grade').value='三年级';document.querySelector('#tg-grade').dispatchEvent(new Event('change'))",
    );
    await c.click(".tg-select-all");
    assert.equal(
      await c.evaluate(
        "document.querySelectorAll('.tg-select-student:checked').length",
      ),
      1,
    );
    await c.click('.tg-cell-button[data-student="1"][data-date="2026-09-03"]');
    await c.waitFor(
      'Boolean(document.querySelector(".custom-select-menu.open"))',
    );
    await c.evaluate(
      "[...document.querySelectorAll('.custom-select-menu.open button')].find(x=>x.dataset.value==='请假').click()",
    );
    await c.waitFor(
      "document.querySelector('.tg-cell-button[data-student=\"1\"][data-date=\"2026-09-03\"]').textContent.includes('请假')&&!document.querySelector('.custom-select-menu.open')",
    );
    assert.equal(
      await c.evaluate("document.querySelector('#tg-msg').textContent"),
      "",
    );
    await open(c, "tgSettings");
    assert.match(
      await c.evaluate("document.querySelector('#tg-body').textContent"),
      /小学收费规则/,
    );
    await c.click('.tg-rule[data-stage="小学"]');
    await c.evaluate(
      "document.querySelector('[name=present]').value='33';document.querySelector('[name=leave_fee]').value='21';document.querySelector('[name=effective_date]').value='2026-11-01';document.querySelector('.modal-panel form').requestSubmit()",
    );
    await c.waitFor(
      "!document.querySelector('.modal-backdrop')&&document.querySelector('#tg-body').textContent.includes('33')",
    );
  } finally {
    await browser.close();
  }
});
test("Edge detail loads all-history once, month switches retain shell, and ledger delete uses one expiring Toast", async () => {
  const browser = await launchBrowser(path.join(dir, "edge-stage-history"), {
      browser: "edge",
    }),
    c = browser.session;
  try {
    await open(c, "tgSummary");
    await c.evaluate(
      "window.historyReads=0;window.rawFetch=window.fetch;window.fetch=(...a)=>{if(String(a[0]).includes('student-history'))historyReads++;return rawFetch(...a)}",
    );
    await c.click('tr[data-student="1"]');
    await c.waitFor(
      "document.querySelector('.tg-history-body')?.textContent.includes('2026-08-31')",
    );
    assert.equal(
      await c.evaluate(
        "document.querySelectorAll('.tg-history-body tbody tr').length",
      ),
      2,
    );
    assert.equal(
      await c.evaluate(
        "document.querySelector('.tg-history-body').textContent.includes('990')",
      ),
      false,
    );
    await c.evaluate(
      "window.shell=document.querySelector('.tg-student-detail-panel');window.hist=document.querySelector('.tg-history-body');document.querySelector('[data-detail-step=\"1\"]').click()",
    );
    await c.waitFor(
      "document.querySelector('.tg-detail-content')?.dataset.month==='2026-10'",
    );
    assert.equal(
      await c.evaluate(
        "shell===document.querySelector('.tg-student-detail-panel')&&hist===document.querySelector('.tg-history-body')&&historyReads===1",
      ),
      true,
    );
    await open(c, "tgLedger");
    await c.click(".tg-ledger-select");
    await c.click("#tg-money-delete");
    await c.waitFor("Boolean(document.querySelector('.modal-panel form'))");
    await c.evaluate(
      "document.querySelector('.modal-panel form').requestSubmit()",
    );
    await c.waitFor(
      "document.querySelector('.toast')?.textContent.includes('已删除1条记录')",
    );
    assert.equal(
      await c.evaluate("document.querySelector('#tg-msg').textContent"),
      "",
    );
    await c.waitFor("!document.querySelector('.toast')");
  } finally {
    await browser.close();
  }
});
