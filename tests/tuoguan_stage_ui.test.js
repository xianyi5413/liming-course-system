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
  if (!["tgSettings", "tgStudents"].includes(view)) {
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

test("Edge grade shortcut shares save, keeps history and notes, rejects occupied dates and enforces permissions", async () => {
  const b = await launchBrowser(path.join(dir, "edge-grade-shortcut"), {
      browser: "edge",
    }),
    c = b.session;
  try {
    await open(c, "tgStudents");
    await c.click('.tg-profile-grade[data-id="1"]');
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelector(".tg-form [name=grade]").options].map(x=>x.value)',
      ),
      ["三年级", "初一", "初二", "初三"],
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector("[name=grade_effective_date]").value',
      ),
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
        new Date(),
      ),
    );
    await c.click(".tg-form .custom-select-button");
    await c.click('.custom-select-menu.open [data-value="初一"]');
    await c.evaluate(
      'document.querySelector("[name=grade_effective_date]").value="2026-09-01";document.querySelector(".tg-form").requestSubmit()',
    );
    await c.waitFor(
      'document.querySelector(".tg-form [role=alert]")?.textContent.includes("已有考勤或资金")',
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-profile-grade[data-id=\\"1\\"]").textContent',
      ),
      "三年级",
    );
    await c.evaluate(
      'window.rawFetch=fetch;window.gradePosts=0;window.fetch=async(...a)=>{if(String(a[0]).endsWith("/student")){gradePosts++;await new Promise(r=>setTimeout(r,400))}return rawFetch(...a)};document.querySelector("[name=grade_effective_date]").value="2026-10-01";document.querySelector(".tg-form").requestSubmit()',
    );
    await c.waitFor(
      'document.querySelector(".tg-form [type=submit]")?.disabled',
    );
    await c.waitFor(
      '!document.querySelector(".tg-form")&&document.querySelector(".tg-profile-grade[data-id=\\"1\\"]")?.textContent==="初一"',
    );
    assert.equal(await c.evaluate("gradePosts"), 1);
    const snapshot = (
      await api(admin, "tuoguan/snapshot?month=2026-09&view=tgStudents")
    ).data;
    assert.equal(snapshot.students.find((s) => s.id === 1).grade, "初一");
    assert.equal(
      snapshot.attendance.find((a) => a.student_id === 1).grade,
      "三年级",
    );
    const logs = (await api(admin, "operation-logs?page_size=100")).data.items;
    assert.ok(
      logs.some((l) =>
        /年级.*三年级.*初一.*2026-10-01/.test(l.operation_content),
      ),
    );
    for (const username of ["tgAttendance", "tgSummary", "readonly"])
      assert.equal(
        (
          await api(await login(username), "tuoguan/student", {
            ...snapshot.students.find((s) => s.id === 1),
            grade: "初二",
            grade_effective_date: "2026-11-01",
            request_id: crypto.randomUUID(),
          })
        ).status,
        403,
      );
    const db = new DatabaseSync(env.DB_PATH);
    const uid = db
      .prepare("SELECT id FROM users WHERE username='readonly'")
      .get().id;
    db.prepare(
      "INSERT OR IGNORE INTO user_page_permissions(user_id,permission_key,enabled) VALUES(?,'tgStudents',1)",
    ).run(uid);
    db.close();
    await c.evaluate(
      'fetch("/api/auth/logout",{method:"POST"}).then(()=>location.reload())',
    );
    await c.waitFor('Boolean(document.querySelector(".login-panel"))');
    await c.evaluate(
      'document.querySelector(".login-username").value="readonly";document.querySelector(".login-password").value="123456";document.querySelector(".login-submit").click()',
    );
    await c.waitFor("Boolean(auth.user)");
    await open(c, "tgStudents");
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-profile-grade:not(:disabled)").length',
      ),
      0,
    );
    assert.deepEqual(c.exceptions, []);
  } finally {
    await b.close();
  }
});

test("Edge sorted ledger keeps IDs, historical grades, filters, date edits and batch delete", async () => {
  const db = new DatabaseSync(env.DB_PATH),
    store = TG.createStore(db),
    write = (a, v) =>
      store.mutate(a, { ...v, request_id: crypto.randomUUID() }, "合成排序");
  const ids = [];
  for (const [name, grade] of [
    ["合成排序10", "三年级"],
    ["合成排序2", "三年级"],
    ["合成排序2", "三年级"],
    ["合成排序1", "初二"],
    ["合成排序1", "初一"],
  ]) {
    const s = write("student", { name, grade, start_date: "2026-09-01" });
    ids.push(s.id);
    for (const date of ["2026-09-08", "2026-09-03", "2026-09-03"])
      write("money", {
        student_id: s.id,
        date,
        kind: "充值",
        actual_amount: 1000,
        gift_amount: 200,
      });
  }
  const expected = store
    .all(
      "SELECT * FROM tg_ledger WHERE student_id IN (" +
        ids.join(",") +
        ") ORDER BY CASE student_id WHEN " +
        ids[1] +
        " THEN 1 WHEN " +
        ids[2] +
        " THEN 2 WHEN " +
        ids[0] +
        " THEN 3 WHEN " +
        ids[4] +
        " THEN 4 ELSE 5 END,date,id",
    )
    .map((r) => r.id);
  db.close();
  const b = await launchBrowser(path.join(dir, "edge-ledger-sort"), {
      browser: "edge",
    }),
    c = b.session;
  try {
    await open(c, "tgLedger");
    await c.evaluate(
      'document.querySelector("#tg-query").value="合成排序";document.querySelector("#tg-query").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter"}))',
    );
    const getIds = () =>
      c.evaluate(
        '[...document.querySelectorAll(".tg-ledger-row")].map(r=>Number(r.dataset.ledger))',
      );
    assert.deepEqual(await getIds(), expected);
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-ledger-row")].map(r=>r.cells[1].textContent.trim())',
      ),
      expected.map((_, i) => String(i + 1)),
    );
    const metrics = await c.evaluate(
      '[...document.querySelectorAll("#tg-recharge-analysis .recharge-analysis-grid .metric-value")].map(x=>Number(x.textContent.replace(/[^0-9.-]/g,"")))',
    );
    assert.deepEqual(metrics.slice(0, 5), [150, 30, 180, 15, 5]);
    await c.evaluate(
      'document.querySelector("#tg-grade").value="三年级";document.querySelector("#tg-grade").dispatchEvent(new Event("change"))',
    );
    assert.deepEqual(await getIds(), expected.slice(0, 9));
    await c.click(".tg-ledger-all");
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-ledger-select:checked").length',
      ),
      9,
    );
    await c.click(".tg-ledger-all");
    await c.click('.tg-ledger-row[data-ledger="' + expected[0] + '"]');
    await c.evaluate(
      'document.querySelector(".tg-form [name=date]").value="2026-09-09";document.querySelector(".tg-form").requestSubmit()',
    );
    await c.waitFor('!document.querySelector(".tg-form")');
    const edited = await getIds();
    assert.equal(edited[0], expected[1]);
    assert.equal(edited[1], expected[2]);
    assert.ok(!edited.includes(expected[0]));
    for (const id of edited.slice(0, 2))
      await c.click('.tg-ledger-select[data-id="' + id + '"]');
    await c.click("#tg-money-delete");
    await c.evaluate('document.querySelector(".tg-form").requestSubmit()');
    await c.waitFor(
      '!document.querySelector(".tg-form")&&document.querySelectorAll(".tg-ledger-row").length===7',
    );
    const rows = await getIds();
    assert.ok(edited.slice(0, 2).every((id) => !rows.includes(id)));
    await c.evaluate('TuoguanUI.applyRange("2026-09-09","2026-09-09")');
    await c.waitFor('document.querySelectorAll(".tg-ledger-row").length===1');
    assert.ok((await getIds()).every((id) => rows.includes(id)));
    assert.deepEqual(c.exceptions, []);
  } finally {
    await b.close();
  }
});

test("Edge fee scope and cards share participation, activity, carry and separate offset balances", async () => {
  const db = new DatabaseSync(env.DB_PATH),
    store = TG.createStore(db),
    write = (a, v) =>
      store.mutate(a, { ...v, request_id: crypto.randomUUID() }, "合成费用");
  for (const [name, actual, gift] of [
    ["合成结转实际", 10000, 0],
    ["合成结转赠送", 0, 5000],
    ["合成结转负数", -10000, 0],
    ["合成结转零", 0, 0],
  ]) {
    const s = write("student", { name, grade: "初一", status: "已毕业" });
    if (actual || gift)
      write("money", {
        student_id: s.id,
        date: "2026-12-01",
        kind: actual < 0 ? "调整" : "充值",
        actual_amount: actual,
        gift_amount: gift,
        notes: "合成核对依据",
      });
  }
  const pending = write("student", {
    name: "合成未保存",
    grade: "初二",
    month: "2027-01",
  }).student;
  const current = write("student", { name: "合成仅资金", grade: "初三" });
  write("money", {
    student_id: current.id,
    date: "2027-01-04",
    kind: "充值",
    actual_amount: 2000,
    gift_amount: 0,
  });
  const rows = store
    .snapshot("2027-01", true)
    .summary.filter(
      (s) =>
        s.has_month_business || s.opening_actual !== 0 || s.opening_gift !== 0,
    );
  db.close();
  const b = await launchBrowser(path.join(dir, "edge-fee-scope"), {
      browser: "edge",
    }),
    c = b.session;
  try {
    await open(c, "tgSummary");
    await c.evaluate(
      'document.querySelector("#tg-month").value="2027-01";document.querySelector("#tg-month").dispatchEvent(new Event("change"))',
    );
    await c.waitFor(
      'document.querySelector("[data-loaded-month]")?.dataset.loadedMonth==="2027-01"',
    );
    assert.deepEqual(
      (
        await c.evaluate(
          '[...document.querySelectorAll(".tg-fee-row")].map(r=>Number(r.dataset.student))',
        )
      ).sort((a, b) => a - b),
      rows.map((r) => r.id).sort((a, b) => a - b),
    );
    assert.ok(
      await c.evaluate(
        'document.querySelector(".tg-fee-row[data-student=\\"' +
          pending.id +
          '\\"]")!==null',
      ),
    );
    const cards = await c.evaluate(
      '[...document.querySelectorAll("#tg-body .metric-value")].map(x=>Number(x.textContent.replace(/[^0-9.-]/g,"")))',
    );
    assert.deepEqual(
      cards,
      ["fee", "actual_recharge", "gift_recharge", "balance"].map(
        (k) => rows.reduce((sum, r) => sum + r[k], 0) / 100,
      ),
    );
    // Account replay normally offsets gift against debt. Exercise the display contract
    // for a zero-total, non-zero split response without changing financial algorithms.
    await c.evaluate(
      'window.rawFetch=fetch;window.fetch=async(...a)=>{const r=await rawFetch(...a);if(String(a[0]).includes("tuoguan/snapshot")){const d=await r.json();if(d.summary){const s=d.summary.find(s=>s.name==="合成结转零");s.opening_actual=-5000;s.opening_gift=5000;}return new Response(JSON.stringify(d),{status:r.status,headers:r.headers})}return r};load({refreshGlobal:false})',
    );
    await c.waitFor(
      'document.querySelector("#tg-body")?.textContent.includes("合成结转零")',
    );
    assert.deepEqual(c.exceptions, []);
  } finally {
    await b.close();
  }
});

test("Edge matrix locator uses real pointer, both sticky headers, scroll, themes, focus and bounded DOM updates", async (t) => {
  const db = new DatabaseSync(env.DB_PATH),
    store = TG.createStore(db);
  for (let n = 0; n < 35; n++)
    store.mutate(
      "student",
      {
        request_id: crypto.randomUUID(),
        name: "合成定位" + n,
        grade: "初一",
        start_date: "2026-09-01",
      },
      "合成",
    );
  db.close();
  const b = await launchBrowser(path.join(dir, "edge-matrix-locate"), {
      browser: "edge",
    }),
    c = b.session;
  const move = async (selector) => {
    const p = await c.evaluate(
      "(()=>{const e=document.querySelector(" +
        JSON.stringify(selector) +
        ');e.scrollIntoView({block:"nearest",inline:"nearest"});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
    );
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
    return p;
  };
  try {
    await open(c, "tgAttendance");
    await c.evaluate(
      'document.querySelector(".tg-scroll").style.maxHeight="320px"',
    );
    const selector =
      '.tg-cell-button[data-student="1"][data-date="2026-09-03"]';
    const before = await c.evaluate(
      "(()=>{const e=document.querySelector(" +
        JSON.stringify(selector) +
        '),r=e.getBoundingClientRect(),s=getComputedStyle(e.querySelector(".status-badge"));return [r.width,r.height,s.backgroundColor,s.color]})()',
    );
    for (const theme of ["light", "dark"]) {
      await c.evaluate(
        "document.documentElement.dataset.theme=" + JSON.stringify(theme),
      );
      await move(".tg-matrix tbody tr:first-child td:nth-child(3)");
      assert.equal(
        await c.evaluate('document.querySelectorAll(".tg-locate-row").length'),
        1,
      );
      assert.equal(
        await c.evaluate('document.querySelectorAll(".tg-locate-col").length'),
        0,
      );
      await move(selector);
      const state = await c.evaluate(
        "(()=>{const e=document.querySelector(" +
          JSON.stringify(selector) +
          '),td=e.closest("td"),r=td.parentElement;return {cross:td.classList.contains("tg-locate-cell"),frozen:[...r.cells].slice(0,4).map(c=>getComputedStyle(c).backgroundColor),row:getComputedStyle(r.cells[5]).backgroundColor,headers:[...document.querySelector(".tg-matrix").tHead.rows].map(r=>r.cells[td.cellIndex].classList.contains("tg-locate-col"))}})()',
      );
      assert.equal(state.cross, true);
      assert.ok(state.frozen.every((x) => x === state.row));
      assert.deepEqual(state.headers, [true, true]);
      if (process.env.TEST_EVIDENCE_DIR) {
        fs.mkdirSync(process.env.TEST_EVIDENCE_DIR, { recursive: true });
        const shot = await c.send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(
          path.join(process.env.TEST_EVIDENCE_DIR, "matrix-" + theme + ".png"),
          Buffer.from(shot.data, "base64"),
        );
      }
      const after = await c.evaluate(
        "(()=>{const e=document.querySelector(" +
          JSON.stringify(selector) +
          '),r=e.getBoundingClientRect(),s=getComputedStyle(e.querySelector(".status-badge"));return [r.width,r.height,s.backgroundColor,s.color]})()',
      );
      assert.deepEqual(after.slice(0, 2), before.slice(0, 2));
      const col = await c.evaluate(
        "document.querySelector(" +
          JSON.stringify(selector) +
          ').closest("td").cellIndex',
      );
      await move(
        ".tg-matrix thead tr:nth-child(2) th:nth-child(" + (col + 1) + ")",
      );
      assert.equal(
        await c.evaluate('document.querySelectorAll(".tg-locate-row").length'),
        0,
      );
      assert.equal(
        await c.evaluate(
          'document.querySelectorAll("thead .tg-locate-col").length',
        ),
        2,
      );
    }
    await c.evaluate(
      'document.querySelector(".tg-scroll").scrollLeft=900;document.querySelector(".tg-scroll").scrollTop=500',
    );
    await move(
      ".tg-matrix tbody tr:nth-child(22) td:nth-child(23) .tg-cell-button",
    );
    assert.equal(
      await c.evaluate('document.querySelector(".tg-locate-cell").cellIndex'),
      22,
    );
    await c.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 1,
      y: 1,
    });
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-locate-row,.tg-locate-col,.tg-locate-cell").length',
      ),
      0,
    );
    await move(selector);
    await c.evaluate(
      'window.mutations=0;window.mo=new MutationObserver(ms=>mutations+=ms.length);mo.observe(document.querySelector(".tg-matrix"),{subtree:true,attributes:true,childList:true})',
    );
    const p = await move(selector);
    const started = performance.now();
    for (let n = 0; n < 20; n++)
      await c.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: p.x + (n % 2),
        y: p.y,
      });
    assert.equal(await c.evaluate("mutations"), 0);
    t.diagnostic(
      "20 in-cell pointer moves: " +
        Math.round(performance.now() - started) +
        " ms including CDP; zero DOM mutations",
    );
    await c.evaluate("mo.disconnect()");
    await c.evaluate(
      "document.querySelector(" +
        JSON.stringify(selector) +
        ').dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerType:"touch"}))',
    );
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-locate-row,.tg-locate-col,.tg-locate-cell").length',
      ),
      0,
    );
    await c.evaluate(
      "const e=document.querySelector(" +
        JSON.stringify(selector) +
        ');e.focus();e.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))',
    );
    assert.equal(
      await c.evaluate('document.querySelectorAll(".tg-locate-cell").length'),
      1,
    );
    await c.click(selector);
    await c.waitFor(
      'Boolean(document.querySelector(".custom-select-menu.open"))',
    );
    await c.click('.custom-select-menu.open [data-value="请假"]');
    await c.waitFor(
      "document.querySelector(" +
        JSON.stringify(selector) +
        ').textContent==="请假"&&!document.querySelector(".custom-select-menu.open")',
    );
    await c.click(".tg-select-all");
    assert.ok(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-select-student,.tg-select-date")].every(x=>x.checked||x.disabled)',
      ),
    );
    await c.click(".tg-select-all");
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-select-student:checked,.tg-select-date:checked").length',
      ),
      0,
    );
    assert.deepEqual(c.exceptions, []);
  } finally {
    await b.close();
  }
});

test("v14 grade split restore retains historical fees, permissions, audit and v6 identities", async () => {
  const live = new DatabaseSync(env.DB_PATH),
    source = path.join(dir, "grade-backup-source.sqlite"),
    target = path.join(dir, "grade-backup-target.sqlite");
  await backup(live, source);
  await backup(live, target);
  live.close();
  const db = new DatabaseSync(source),
    store = TG.createStore(db),
    student = store.get("SELECT * FROM tg_students WHERE id=1");
  if (student.grade === "三年级")
    store.mutate(
      "student",
      {
        ...student,
        grade: "初一",
        grade_effective_date: "2026-10-01",
        request_id: crypto.randomUUID(),
      },
      "合成",
    );
  const bundle = JSON.stringify(T.exportData(db));
  await T.confirm(db, bundle, T.signature(db), dir, "合成重复同步");
  const sums = store.snapshot("2026-09", true).summary;
  db.close();
  const file = path.join(dir, "grade-v14.xlsx");
  Excel.exportFullData({
    dbPath: source,
    outputPath: file,
    includeOperationLogs: true,
  });
  const verified = Excel.verifyFullData(file);
  assert.equal(verified.version, 14);
  const studentSheet = verified.workbook.sheetMap.get("托管学生").rows,
    attendanceSheet = verified.workbook.sheetMap.get("托管每日签到").rows;
  assert.ok(studentSheet.some((row) => row.includes("初一")));
  assert.ok(attendanceSheet.some((row) => row.includes("三年级")));
  Excel.restoreFullData({ dbPath: target, inputPath: file });
  const restored = new DatabaseSync(target);
  for (const table of [
    ...TG.TABLES,
    "roles",
    "role_permissions",
    "user_page_permissions",
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
  assert.deepEqual(
    TG.createStore(restored).snapshot("2026-09", true).summary,
    sums,
  );
  assert.equal(
    restored.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
  restored.close();
});
