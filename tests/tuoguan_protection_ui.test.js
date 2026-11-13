const { before, after, test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process"),
  { DatabaseSync } = require("node:sqlite");
const { launchBrowser, freePort } = require("./helpers/chrome_cdp"),
  TG = require("../src/domain/tuoguan");
const root = path.resolve(__dirname, "..");
let dir, env, port, server;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-protection-ui-"));
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
  write("attendance", {
    date: "2026-11-01",
    rows: [{ student_id: 1, status: "出勤", version: 0 }],
  });
  write("attendance", {
    date: "2026-11-02",
    rows: [{ student_id: 2, status: "不适用", version: 0 }],
  });
  write("attendance", {
    date: "2026-11-04",
    rows: [{ student_id: 3, status: "放假", version: 0 }],
  });
  write("attendance", {
    date: "2026-11-05",
    rows: [{ student_id: 4, status: "请假", version: 0 }],
  });
  db.exec(
    "INSERT INTO tg_attendance(student_id,date,status,grade,rule_json,fee,pending,raw_status,source_cell) VALUES(2,'2026-11-03','未登记','初二','{}',0,1,'26','F13')",
  );
  write("money", {
    student_id: 2,
    date: "2026-11-01",
    kind: "充值",
    actual_amount: 50000,
    gift_amount: 0,
    method: "微信",
  });
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
});
after(async () => {
  if (server?.exitCode == null) {
    const ended = new Promise((r) => server.once("exit", r));
    server.kill();
    await ended;
  }
});

async function page(c, view, month = "2026-09") {
  await c.evaluate(`setActiveView('${view}');load({refreshGlobal:false})`);
  await c.waitFor('Boolean(document.querySelector("#tg-body"))');
  await c.evaluate(
    `document.querySelector('#tg-month').value='${month}';document.querySelector('#tg-month').dispatchEvent(new Event('change'))`,
  );
  await c.waitFor(
    `document.querySelector('[data-loaded-month]')?.dataset.loadedMonth==='${month}'`,
  );
}
const cards = (c) =>
  c.evaluate(
    '[...document.querySelectorAll("#tg-recharge-analysis .recharge-analysis-grid .metric-value")].map(e=>Number(e.textContent.replace(/[^0-9.-]/g,"")))',
  );
test("Edge recharge has separate shared rectangular badges, typed amount alignment, silent new success and live filtered totals", async () => {
  const b = await launchBrowser(path.join(dir, "edge-ledger"), {
      browser: "edge",
    }),
    c = b.session;
  try {
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await page(c, "tgLedger");
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-table th")].map(e=>e.textContent.trim())',
      ),
      [
        "",
        "序号",
        "日期",
        "学生",
        "年级",
        "类型",
        "实际金额",
        "赠送金额",
        "支付方式",
        "备注",
      ],
    );
    await c.waitFor(
      'document.querySelector(".tg-table").classList.contains("adaptive-table")',
    );
    assert.deepEqual(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-ledger-row:first-child td")].map(e=>getComputedStyle(e).textAlign).slice(6,8)',
      ),
      ["right", "right"],
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-ledger-row:first-child td:nth-child(4) .student-badge").textContent',
      ),
      "合成无签到",
    );
    await c.click(".tg-ledger-select");
    assert.equal(await c.evaluate('document.querySelector(".tg-form")'), null);
    await c.click(".tg-ledger-row td:nth-child(4)");
    await c.click(".tg-form [data-cancel]");
    const before = await cards(c);
    await c.click("#tg-money");
    await c.evaluate(
      "for(const [key,value]of Object.entries({student_id:'5',date:'2026-09-10',actual_amount:'12',gift_amount:'3'})){document.querySelector('.tg-form [name='+key+']').value=value}window.saveFetch=fetch;window.fetch=(...a)=>String(a[0]).endsWith('/money')?Promise.reject(Error('合成保存失败')):saveFetch(...a)",
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      'document.querySelector(".tg-form [role=alert]").textContent.includes("合成保存失败")',
    );
    assert.deepEqual(await cards(c), before);
    await c.evaluate("window.fetch=saveFetch");
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      '!document.querySelector(".tg-form")&&document.querySelector(".tg-ledger-row td:nth-child(3)").textContent==="2026-09-10"',
    );
    assert.equal(
      await c.evaluate('document.querySelector("#tg-msg").textContent'),
      "",
    );
    const after = await cards(c);
    assert.deepEqual(after, [
      before[0] + 12,
      before[1] + 3,
      before[2] + 15,
      before[3] + 1,
      before[4] + 1,
      before[5],
    ]);
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-ledger-row td:nth-child(5) .grade-badge").textContent',
      ),
      "初一",
    );
    const appearance = () =>
      c.evaluate(
        `(()=>{const name=document.querySelector('.tg-ledger-row .student-badge'),grade=document.querySelector('.tg-ledger-row .grade-badge'),reference=document.createElement('span');reference.innerHTML=renderStudentBadge({name:'合成',grade:'初一'});document.body.append(reference);const read=e=>{const s=getComputedStyle(e);return {radius:s.borderRadius,height:s.height,font:s.fontSize,padding:s.padding,bg:s.backgroundColor,nowrap:s.whiteSpace}};const result={name:read(name),grade:read(grade),reference:read(reference.firstChild)};reference.remove();return result})()`,
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
        const look = await appearance();
        assert.deepEqual(look.name, look.reference);
        assert.equal(look.name.radius, "6px");
        assert.equal(look.grade.radius, "6px");
        assert.equal(look.grade.nowrap, "nowrap");
        fs.writeFileSync(
          path.join(dir, `ledger-${width}-${theme}.png`),
          Buffer.from(
            (await c.send("Page.captureScreenshot", { format: "png" })).data,
            "base64",
          ),
        );
      }
    await c.send("Emulation.clearDeviceMetricsOverride");
    await c.evaluate(
      "document.querySelector('#tg-grade').value='初一';document.querySelector('#tg-grade').dispatchEvent(new Event('change'))",
    );
    assert.equal(
      await c.evaluate('document.querySelectorAll(".tg-ledger-row").length'),
      2,
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-ledger-row .grade-badge").textContent',
      ),
      "初一",
    );
    assert.equal((await cards(c))[3], 2);
    await c.click("#tg-reset");
    await c.click("#tg-money");
    await c.evaluate(
      "document.querySelector('.tg-form [name=date]').value='2036-01-01';document.querySelector('.tg-form [name=actual_amount]').value='1'",
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      '!document.querySelector(".tg-form")&&document.querySelector("#tg-msg").textContent.includes("不在当前筛选范围")',
    );
    assert.deepEqual(await cards(c), after);
    assert.deepEqual(c.exceptions, []);
    assert.deepEqual(c.consoleErrors, []);
  } finally {
    await b.close();
  }
});
test("Edge correction immediately unlocks safe dates and monthly students; exclusions survive reload and readonly writes reject", async () => {
  const b = await launchBrowser(path.join(dir, "edge-protection"), {
      browser: "edge",
    }),
    c = b.session;
  const close = () => c.click(".shared-course-dialog .dialog-close"),
    dates = async () => {
      await c.click("#tg-manage-dates");
      await c.waitFor('!document.querySelector("[data-manage-date]").disabled');
    },
    members = async () => {
      await c.click("#tg-manage-students");
      await c.waitFor(
        'Boolean(document.querySelector("[data-member]:not(:disabled)"))',
      );
    };
  try {
    await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await c.login();
    await page(c, "tgAttendance", "2026-11");
    assert.equal(
      await c.evaluate(
        'document.querySelector("[data-student=\\"2\\"] [data-date=\\"2026-11-03\\"] .status-badge").textContent',
      ),
      "不适用",
    );
    await dates();
    assert.equal(
      await c.evaluate(
        'document.querySelector("[data-manage-date=\\"2026-11-01\\"]").dataset.protected',
      ),
      "true",
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector("[data-manage-date=\\"2026-11-03\\"]").dataset.protected',
      ),
      "false",
    );
    await close();
    await c.click('.tg-cell-button[data-student="1"][data-date="2026-11-01"]');
    await c.click('.custom-select-menu.open [data-value="不适用"]');
    await c.waitFor(
      'document.querySelector(".tg-cell-button[data-student=\\"1\\"][data-date=\\"2026-11-01\\"]").textContent==="不适用"',
    );
    await dates();
    assert.equal(
      await c.evaluate(
        'document.querySelector("[data-manage-date=\\"2026-11-01\\"]").dataset.protected',
      ),
      "false",
    );
    for (const date of ["2026-11-04", "2026-11-05"])
      assert.equal(
        await c.evaluate(
          `document.querySelector('[data-manage-date="${date}"]').dataset.protected`,
        ),
        "true",
      );
    await c.click('[data-manage-date="2026-11-01"]');
    await c.waitFor(
      'document.querySelector("[data-manage-date=\\"2026-11-01\\"]").dataset.enabled==="false"',
    );
    await close();
    await c.waitFor(
      '![...document.querySelectorAll(".tg-matrix th")].some(e=>e.textContent==="11-01")',
    );
    await page(c, "tgAttendance", "2026-11");
    assert.equal(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-matrix th")].some(e=>e.textContent==="11-01")',
      ),
      false,
    );
    await members();
    for (const id of [1, 2])
      assert.notEqual(
        await c.evaluate(
          `document.querySelector('[data-member="${id}"] .tg-member-mark').textContent`,
        ),
        "🔒",
      );
    for (const id of [3, 4])
      assert.equal(
        await c.evaluate(
          `document.querySelector('[data-member="${id}"] .tg-member-mark').textContent`,
        ),
        "🔒",
      );
    await c.click('[data-member="1"]');
    await c.waitFor(
      'document.querySelector("[data-member=\\"1\\"]").dataset.selected==="false"',
    );
    await close();
    await c.waitFor(
      '!document.querySelector(".tg-matrix tr[data-student=\\"1\\"]")',
    );
    await page(c, "tgAttendance", "2026-11");
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-matrix tr[data-student=\\"1\\"]")',
      ),
      null,
    );
    await members();
    await c.click('[data-member="1"]');
    await c.waitFor(
      'document.querySelector("[data-member=\\"1\\"]").dataset.selected==="true"',
    );
    await close();
    await c.waitFor(
      'Boolean(document.querySelector(".tg-matrix tr[data-student=\\"1\\"]"))',
    );
    assert.ok(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-matrix tr[data-student=\\"1\\"] .tg-cell-button")].every(e=>e.textContent.includes("不适用"))',
      ),
    );
    await dates();
    await c.click('[data-manage-date="2026-11-01"]');
    await c.waitFor(
      'document.querySelector("[data-manage-date=\\"2026-11-01\\"]").dataset.enabled==="true"',
    );
    await close();
    await c.waitFor(
      'Boolean(document.querySelector(".tg-cell-button[data-student=\\"1\\"][data-date=\\"2026-11-01\\"]"))',
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-cell-button[data-student=\\"1\\"][data-date=\\"2026-11-01\\"]").textContent',
      ),
      "不适用",
    );
    const db = new DatabaseSync(env.DB_PATH);
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM tg_periods WHERE student_id=1 AND start_date<='2026-11-30' AND COALESCE(end_date,'9999')>='2026-11-01'",
        )
        .get().n,
      1,
    );
    assert.equal(
      db
        .prepare(
          "SELECT amount FROM tg_ledger WHERE student_id=2 AND date='2026-11-01' AND kind='充值'",
        )
        .get().amount,
      50000,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM tg_ledger WHERE attendance_id=(SELECT id FROM tg_attendance WHERE student_id=1 AND date='2026-11-01')",
        )
        .get().n,
      2,
    );
    db.close();
    assert.deepEqual(c.exceptions, []);
    assert.deepEqual(c.consoleErrors, []);
    const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "finance-readonly",
          password: "123456",
        }),
      }),
      cookie = login.headers.get("set-cookie").split(";")[0];
    for (const action of ["remove-dates", "remove-students"]) {
      const r = await fetch(`http://127.0.0.1:${port}/api/tuoguan/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          month: "2026-11",
          dates: [{ date: "2026-11-03", version: 0 }],
          students: [{ id: 1, versions: [] }],
        }),
      });
      assert.equal(r.status, 403);
    }
  } finally {
    await b.close();
  }
});

test("full Excel restores old placeholders without reviving removed dates or students, preserves funds and exports normalized evidence", async () => {
  const { backup } = require("node:sqlite"),
    X = require("../src/excel/full_backup"),
    source = path.join(dir, "source-full.sqlite"),
    target = path.join(dir, "restored-full.sqlite"),
    oldFile = path.join(dir, "old-full.xlsx");
  const live = new DatabaseSync(env.DB_PATH);
  await backup(live, source);
  await backup(live, target);
  live.close();
  const d = new DatabaseSync(source),
    store = TG.createStore(d);
  d.exec(
    "INSERT INTO tg_attendance(student_id,date,status,grade,rule_json,fee,pending,raw_status,source_cell) VALUES(2,'2038-09-01','未登记','初二','{}',0,1,'26','G13')",
  );
  const write = (action, body) =>
    store.mutate(
      action,
      { request_id: crypto.randomUUID(), ...body },
      "合成恢复",
    );
  write("remove-dates", {
    month: "2038-09",
    dates: [{ date: "2038-09-01", version: 0 }],
  });
  const periods = d
    .prepare(
      "SELECT id,version FROM tg_periods WHERE student_id=2 AND start_date<='2038-09-30' AND COALESCE(end_date,'9999')>='2038-09-01' ORDER BY id",
    )
    .all();
  write("remove-students", {
    month: "2038-09",
    students: [{ id: 2, versions: periods.map((r) => [r.id, r.version]) }],
  });
  const before = d.prepare("SELECT * FROM tg_ledger ORDER BY id").all(),
    old = d
      .prepare("SELECT * FROM tg_attendance WHERE date='2038-09-01'")
      .get();
  d.close();
  X.exportFullData({ dbPath: source, outputPath: oldFile });
  const restored = X.restoreFullData({ dbPath: target, inputPath: oldFile });
  assert.equal(restored.custody_normalization.updated, 1);
  const r = new DatabaseSync(target),
    rs = TG.createStore(r);
  assert.deepEqual(
    r.prepare("SELECT * FROM tg_ledger ORDER BY id").all(),
    before,
  );
  assert.deepEqual(
    { ...r.prepare("SELECT * FROM tg_attendance WHERE id=?").get(old.id) },
    {
      ...old,
      status: "不适用",
      pending: 0,
      fee: 0,
      rule_json: require("../src/domain/tuoguan_settlement").RULE_JSON,
      version: old.version + 1,
    },
  );
  assert.equal(
    rs.calendarSnapshot("2038-09").calendar.find((c) => c.date === "2038-09-01")
      .enabled,
    0,
  );
  assert.equal(
    rs
      .participationSnapshot("2038-09")
      .periods.some(
        (p) =>
          p.student_id === 2 &&
          p.start_date <= "2038-09-30" &&
          (!p.end_date || p.end_date >= "2038-09-01"),
      ),
    false,
  );
  assert.equal(TG.migrate(r).normalization.updated, 0);
  r.close();
  const currentFile = path.join(dir, "current-full.xlsx");
  X.exportFullData({ dbPath: target, outputPath: currentFile });
  assert.equal(
    X.restoreFullData({ dbPath: source, inputPath: currentFile })
      .custody_normalization.updated,
    0,
  );
});
