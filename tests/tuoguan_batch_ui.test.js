const { before, after, test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process"),
  { DatabaseSync, backup } = require("node:sqlite");
const { launchBrowser, freePort } = require("./helpers/chrome_cdp"),
  TG = require("../src/domain/tuoguan");
const root = path.resolve(__dirname, "..");
let dir, env, port, server;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-batch-ui-"));
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
  for (const [name, grade, start_date] of [
    ["合成甲", "初一", "2026-09-01"],
    ["合成乙", "初二", "2026-09-03"],
    ["合成甲", "初二", undefined],
    ["合成备用", "初一", undefined],
  ])
    write("student", { name, grade, start_date });
  write("money", {
    student_id: 1,
    date: "2026-08-31",
    kind: "充值",
    actual_amount: 10000,
    gift_amount: 3000,
  });
  write("money", {
    student_id: 3,
    date: "2026-09-01",
    kind: "充值",
    actual_amount: 20000,
    gift_amount: 1000,
  });
  write("attendance", {
    date: "2026-09-01",
    rows: [{ student_id: 1, status: "不适用", version: 0, notes: "保留备注" }],
  });
  write("money", {
    student_id: 1,
    date: "2026-09-02",
    kind: "充值",
    actual_amount: 1000,
    gift_amount: 0,
  });
  write("student", { id: 1, name: "合成甲", grade: "初三", version: 1 });
  for (const [username, readonly, override, permission] of [
    ["batch-role", null, 0, null],
    ["batch-readonly", 1, 1, "tgAttendance"],
    ["batch-none", 0, 1, "dashboard"],
    ["batch-finance", 0, 1, "tgFinance"],
  ]) {
    db.prepare(
      "INSERT INTO users(username,display_name,role,password_hash,readonly_override,permission_override_enabled) SELECT ?,?,'helper',password_hash,?,? FROM users WHERE username='boss'",
    ).run(username, username, readonly, override);
    if (permission)
      db.prepare(
        "INSERT INTO user_page_permissions(user_id,permission_key) SELECT id,? FROM users WHERE username=?",
      ).run(permission, username);
  }
  db.close();
  server = spawn(process.execPath, ["src/server.js"], {
    cwd: root,
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("server unavailable");
});
after(async () => {
  if (server && server.exitCode == null) {
    const ended = new Promise((r) => server.once("exit", r));
    server.kill();
    await ended;
  }
});
async function open(c, view = "tgAttendance", month = "2026-09") {
  await c.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await c.waitFor(
    'Boolean(document.querySelector(".login-panel"))||Boolean(auth.user)',
  );
  if (await c.evaluate('Boolean(document.querySelector(".login-panel"))'))
    await c.login();
  await c.evaluate(`setActiveView('${view}');load({refreshGlobal:false})`);
  await c.waitFor('Boolean(document.querySelector("#tg-body"))');
  await c.evaluate(
    `document.querySelector('#tg-month').value='${month}';document.querySelector('#tg-month').dispatchEvent(new Event('change'))`,
  );
  await c.waitFor(
    `document.querySelector('[data-loaded-month]')?.dataset.loadedMonth==='${month}'`,
  );
}
test("Edge management updates only changed cards and keeps modal bounds stable", async () => {
  const b = await launchBrowser(path.join(dir, "edge-cards"), {
      browser: "edge",
    }),
    c = b.session;
  try {
    await open(c);
    await c.click("#tg-manage-students");
    await c.waitFor(
      'Boolean(document.querySelector("[data-member]:not(:disabled)"))',
    );
    await c.evaluate(
      `window.panel=document.querySelector('.tg-manage-students-panel');window.group=document.querySelector('.tg-student-groups');window.cards=[...group.querySelectorAll('[data-member]')];window.height=panel.getBoundingClientRect().height;window.heights=[];window.frame=()=>{heights.push(panel.getBoundingClientRect().height);if(heights.length<120)requestAnimationFrame(frame)};requestAnimationFrame(frame);window.changedCards=new Set();window.observer=new MutationObserver(ms=>ms.forEach(m=>{const card=m.target.closest?.('[data-member]');if(card)changedCards.add(card.dataset.member)}));observer.observe(group,{subtree:true,attributes:true,childList:true});window.originalFetch=fetch;window.fetch=async(...args)=>{if(String(args[0]).endsWith('/period'))await new Promise(r=>setTimeout(r,500));return originalFetch(...args)}`,
    );
    await c.click('[data-member="3"]');
    const during = await c.evaluate(
      `({before:height,after:panel.getBoundingClientRect().height,othersDisabled:cards.filter(x=>x.dataset.member!=='3'&&x.disabled).length})`,
    );
    await c.waitFor(
      `document.querySelector('[data-member="3"]').dataset.selected==='true'&&!document.querySelector('[data-member="3"]').disabled`,
    );
    const result = await c.evaluate(
      `({same:cards.every(x=>x.isConnected),changed:[...changedCards],height:panel.getBoundingClientRect().height,heights:[...new Set(heights)]})`,
    );
    console.log("card layout evidence", JSON.stringify({ during, result }));
    assert.equal(during.after, during.before);
    assert.equal(during.othersDisabled, 0);
    assert.equal(result.same, true);
    assert.deepEqual(result.changed, ["3"]);
    assert.equal(result.height, during.before);
    await c.evaluate(
      `window.fetch=originalFetch;changedCards.clear();document.querySelector('[data-member="4"]').click();document.querySelector('[data-member="3"]').click()`,
    );
    await c.waitFor(
      `document.querySelector('[data-member="4"]').dataset.selected==='true'&&document.querySelector('[data-member="3"]').dataset.selected==='false'&&![...document.querySelectorAll('[data-member]')].some(x=>x.disabled)`,
    );
    assert.deepEqual((await c.evaluate("[...changedCards]")).sort(), [
      "3",
      "4",
    ]);
    await c.evaluate(
      `window.fetch=(...a)=>String(a[0]).includes('/remove-students')?Promise.reject(Error('合成保存失败')):originalFetch(...a)`,
    );
    await c.click('[data-member="4"]');
    await c.waitFor(
      `document.querySelector('.tg-student-management [role=alert]').textContent.includes('合成保存失败')&&!document.querySelector('[data-member="4"]').disabled`,
    );
    assert.equal(
      await c.evaluate(
        `document.querySelector('[data-member="4"]').dataset.selected`,
      ),
      "true",
    );
    await c.evaluate("window.fetch=originalFetch");
    await c.click('[data-member="4"]');
    await c.waitFor(
      `document.querySelector('[data-member="4"]').dataset.selected==='false'&&!document.querySelector('[data-member="4"]').disabled`,
    );
    assert.equal(
      await c.evaluate('document.querySelectorAll(".tg-student-group").length'),
      4,
    );
    await c.click("[data-new-member]");
    await c.evaluate(
      `document.querySelector('.tg-form [name=name]').value='合成新档案'`,
    );
    await c.click(".tg-form [type=submit]");
    await c.waitFor(
      `!document.querySelector('.tg-form')&&document.querySelector('[data-member="5"]')?.dataset.selected==='true'`,
    );
    await c.click('[data-member="5"]');
    await c.waitFor(
      `document.querySelector('[data-member="5"]').dataset.selected==='false'&&!document.querySelector('[data-member="5"]').disabled`,
    );
    assert.deepEqual(c.exceptions, []);
  } finally {
    await b.close();
  }
});
test("Edge matrix row/column intersection, preview, atomic save, unchanged DOM/scroll and filter resets", async () => {
  const b = await launchBrowser(path.join(dir, "edge-matrix"), {
      browser: "edge",
    }),
    c = b.session;
  try {
    await open(c);
    assert.equal(
      await c.evaluate('document.querySelectorAll(".tg-unsaved-dot").length'),
      0,
    );
    for (const width of [1440, 390]) {
      await c.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      await c.evaluate(
        "scheduleAdaptiveTableColumns();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
      );
      const layout = await c.evaluate(
        `(()=>{const t=document.querySelector('.tg-matrix'),a=t.tHead.rows[0].cells,b=t.tHead.rows[1].cells;return {height:a[3].getBoundingClientRect().height,align:[...a].every((h,i)=>Math.abs(h.getBoundingClientRect().left-b[i].getBoundingClientRect().left)<1),frozen:[...t.tBodies[0].rows[0].cells].slice(0,4).every(c=>getComputedStyle(c).position==='sticky'),last:getComputedStyle(t.tBodies[0].rows[0].lastElementChild).position}})()`,
      );
      assert.equal(layout.align, true);
      assert.equal(layout.height, 30);
      assert.equal(layout.frozen, true);
      assert.notEqual(layout.last, "sticky");
      fs.writeFileSync(
        path.join(dir, "batch-matrix-" + width + ".png"),
        Buffer.from(
          (await c.send("Page.captureScreenshot", { format: "png" })).data,
          "base64",
        ),
      );
    }
    await c.send("Emulation.clearDeviceMetricsOverride");
    const db = new DatabaseSync(env.DB_PATH, { readOnly: true });
    const count = () =>
        db.prepare("SELECT count(*) n FROM tg_attendance").get().n,
      before = count();
    const eligible = await c.evaluate(
      '[...document.querySelectorAll(".tg-cell-button")].map(x=>({id:x.dataset.student,date:x.dataset.date}))',
    );
    const row1 = eligible.filter((x) => x.id === "1").length;
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-matrix thead tr").length',
      ),
      2,
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-matrix thead tr:last-child th:first-child").textContent',
      ),
      "选择",
    );
    const n = () =>
      c.evaluate(
        'Number(document.querySelector("#tg-batch-attendance").textContent.match(/[0-9]+/)?.[0]||0)',
      );
    await c.click('.tg-select-student[data-id="1"]');
    assert.equal(await n(), row1);
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-select-all").indeterminate',
      ),
      true,
    );
    await c.click('.tg-select-date[data-date="2026-09-01"]');
    await c.click('.tg-select-date[data-date="2026-09-03"]');
    assert.equal(await n(), 2);
    await c.click('.tg-select-student[data-id="2"]');
    assert.equal(await n(), 3);
    assert.equal(count(), before);
    db.close();
    await c.click("#tg-batch-attendance");
    assert.match(
      await c.evaluate('document.querySelector(".tg-form").textContent'),
      /2名学生、2个日期、3个考勤单元格/,
    );
    assert.match(
      await c.evaluate(
        'document.querySelector("[data-batch-preview]").textContent',
      ),
      /首次保存 2 格.*已排除不可编辑 1 格/,
    );
    await c.click(".tg-form [data-cancel]");
    await c.click(".tg-select-all");
    assert.equal(await n(), eligible.length);
    await c.click(".tg-select-all");
    assert.equal(await n(), 0);
    await c.click('.tg-select-date[data-date="2026-09-03"]');
    assert.equal(await n(), 2);
    await c.click('.tg-select-date[data-date="2026-09-03"]');
    await c.evaluate(
      `document.querySelector('#tg-grade').value='初一';document.querySelector('#tg-grade').dispatchEvent(new Event('change'))`,
    );
    assert.equal(await n(), 0);
    await c.click('.tg-select-date[data-date="2026-09-03"]');
    assert.equal(await n(), 1);
    await c.evaluate(
      `document.querySelector('.tg-scroll').scrollLeft=250;window.savedTable=document.querySelector('.tg-matrix');window.savedScroll=document.querySelector('.tg-scroll').scrollLeft;window.posts=[];window.originalFetch=fetch;window.fetch=(...args)=>{if(String(args[0]).includes('/batch-attendance'))posts.push(JSON.parse(args[1].body));return originalFetch(...args)}`,
    );
    for (const status of ["出勤", "请假", "放假", "不适用"]) {
      if ((await n()) === 0)
        await c.click('.tg-select-date[data-date="2026-09-03"]');
      await c.click("#tg-batch-attendance");
      if (status !== "出勤") {
        await c.click(".tg-form .custom-select-button");
        await c.click('.custom-select-menu.open [data-value="' + status + '"]');
      }
      await c.click(".tg-form [type=submit]");
      await c.waitFor('!document.querySelector(".tg-form")');
      assert.equal(
        await c.evaluate(
          `document.querySelector('.tg-cell-button[data-student="1"][data-date="2026-09-03"]').textContent`,
        ),
        status,
      );
      assert.equal(
        await c.evaluate('savedTable===document.querySelector(".tg-matrix")'),
        true,
      );
      assert.equal(
        await c.evaluate('document.querySelector(".tg-scroll").scrollLeft'),
        await c.evaluate("savedScroll"),
      );
      assert.equal(await n(), 0);
      assert.equal(
        await c.evaluate(
          `(()=>{const el=document.querySelector('.tg-cell-button[data-student="1"][data-date="2026-09-03"]'),a=el.closest('td').getBoundingClientRect(),b=el.querySelector('.status-badge').getBoundingClientRect();return Math.abs(a.x+a.width/2-b.x-b.width/2)<1.1&&Math.abs(a.y+a.height/2-b.y-b.height/2)<1.1})()`,
        ),
        true,
      );
    }
    assert.equal(await c.evaluate("posts.length"), 4);
    assert.equal(
      await c.evaluate(
        "posts.every(p=>p.cells.length===1&&p.cells[0].student_id===1)",
      ),
      true,
    );
    assert.equal(
      await c.evaluate('document.querySelector("#tg-grade").value'),
      "初一",
    );
    await c.click('.tg-select-student[data-id="1"]');
    await c.evaluate(
      `document.querySelector('#tg-month').value='2026-10';document.querySelector('#tg-month').dispatchEvent(new Event('change'))`,
    );
    await c.waitFor(
      `document.querySelector('[data-loaded-month]')?.dataset.loadedMonth==='2026-10'`,
    );
    assert.equal(await n(), 0);
    await open(c);
    assert.equal(
      await c.evaluate(
        `document.querySelector('.tg-cell-button[data-student="1"][data-date="2026-09-03"]').textContent`,
      ),
      "不适用",
    );
    assert.deepEqual(c.exceptions, []);
    assert.deepEqual(c.consoleErrors, []);
  } finally {
    await b.close();
  }
});
async function loginApi(username) {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123456" }),
  });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
async function call(cookie, url, body, method = "POST") {
  const r = await fetch(`http://127.0.0.1:${port}/api/${url}`, {
    method: body ? method : "GET",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
test("Edge role tree saves tgAttendance; permissions apply immediately to ordinary and batch APIs without finance", async () => {
  const b = await launchBrowser(path.join(dir, "edge-roles"), {
      browser: "edge",
    }),
    c = b.session;
  let role, admin;
  const payload = () => ({
    month: "2026-09",
    status: "出勤",
    cells: [{ student_id: 1, date: "2026-09-04", version: 0 }],
    request_id: crypto.randomUUID(),
  });
  try {
    role = await loginApi("batch-role");
    admin = await loginApi("boss");
    await open(c);
    await c.evaluate(`setActiveView('userAdmin');load({refreshGlobal:false})`);
    await c.waitFor('Boolean(document.querySelector(".user-admin-tab"))');
    await c.click('.user-admin-tab[data-tab="roles"]');
    await c.click('.role-edit[data-code="helper"]');
    assert.match(
      await c.evaluate(
        'document.querySelector(".role-permission-modal").textContent',
      ),
      /托管[\s\S]*每日签到[\s\S]*托管学生[\s\S]*充值流水[\s\S]*托管费用[\s\S]*托管设置/,
    );
    await c.evaluate(
      `for(const input of document.querySelectorAll('.role-permission-modal .permission-child'))input.checked=input.value==='tgAttendance';document.querySelector('.role-readonly-field').checked=false`,
    );
    await c.click(".role-permission-save");
    await c.waitFor('!document.querySelector(".role-permission-modal")');
    const roles = await call(admin, "roles");
    assert.deepEqual(
      roles.data.roles.find((x) => x.code === "helper").permissions,
      ["tgAttendance"],
    );
    const result = await call(role, "tuoguan/batch-attendance", payload());
    assert.equal(result.status, 200);
    assert.equal(result.data.rows.length, 1);
    assert.equal("fee" in result.data.rows[0], false);
    assert.equal(
      (
        await call(role, "tuoguan/attendance", {
          date: "2026-09-04",
          rows: [
            {
              student_id: 1,
              status: "请假",
              version: result.data.rows[0].version,
            },
          ],
          request_id: crypto.randomUUID(),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call(role, "tuoguan/money", {
          ...payload(),
          student_id: 1,
          kind: "充值",
          date: "2026-09-01",
          actual_amount: 1000,
          gift_amount: 0,
        })
      ).status,
      403,
    );
    for (const name of ["batch-none", "batch-readonly", "batch-finance"]) {
      const cookie = await loginApi(name);
      assert.equal(
        (await call(cookie, "tuoguan/batch-attendance", payload())).status,
        403,
      );
      assert.equal(
        (
          await call(cookie, "tuoguan/attendance", {
            date: "2026-09-04",
            rows: [],
            request_id: crypto.randomUUID(),
          })
        ).status,
        403,
      );
    }
    await call(
      admin,
      "roles/helper",
      { permissions: ["dashboard"], readonly: 0 },
      "PATCH",
    );
    assert.equal(
      (await call(role, "tuoguan/batch-attendance", payload())).status,
      403,
    );
    await call(
      admin,
      "roles/helper",
      { permissions: ["tgAttendance"], readonly: 1 },
      "PATCH",
    );
    assert.equal(
      (await call(role, "tuoguan/batch-attendance", payload())).status,
      403,
    );
    const snap = await call(role, "tuoguan/snapshot?month=2026-09");
    assert.equal(snap.status, 200);
    assert.equal(snap.data.ledger, undefined);
    await c.evaluate(
      `fetch('/api/auth/logout',{method:'POST'}).then(()=>location.reload())`,
    );
    await c.waitFor('Boolean(document.querySelector(".login-panel"))');
    await c.evaluate(
      `document.querySelector('.login-username').value='batch-readonly';document.querySelector('.login-password').value='123456';document.querySelector('.login-submit').click()`,
    );
    await c.waitFor("Boolean(auth.user)");
    await c.evaluate(
      `setActiveView('tgAttendance');load({refreshGlobal:false})`,
    );
    await c.waitFor('Boolean(document.querySelector(".tg-matrix"))');
    assert.equal(
      await c.evaluate('document.querySelector("#tg-batch-attendance")'),
      null,
    );
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-matrix input:not(:disabled),.tg-cell-button:not(:disabled)").length',
      ),
      0,
    );
  } finally {
    await b.close();
  }
});
test("Edge ledger uses period grade then profile ID fallback consistently for badges, filtering and totals", async () => {
  const b = await launchBrowser(path.join(dir, "edge-grades"), {
      browser: "edge",
    }),
    c = b.session;
  try {
    await open(c, "tgLedger");
    const rows = await c.evaluate(
      '[...document.querySelectorAll(".tg-ledger-row")].map(r=>({id:r.dataset.id,text:r.textContent,grade:r.querySelector(".grade-badge").textContent,name:r.querySelector(".student-badge").textContent}))',
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.grade).sort(), ["初一", "初二"]);
    assert.ok(rows.every((r) => r.name === "合成甲"));
    for (const [grade, amount] of [
      ["初一", 10],
      ["初二", 210],
    ]) {
      await c.evaluate(
        `document.querySelector('#tg-grade').value='${grade}';document.querySelector('#tg-grade').dispatchEvent(new Event('change'))`,
      );
      assert.equal(
        await c.evaluate('document.querySelectorAll(".tg-ledger-row").length'),
        1,
      );
      assert.equal(
        await c.evaluate(
          'document.querySelector(".tg-ledger-row .grade-badge").textContent',
        ),
        grade,
      );
      const metrics = await c.evaluate(
        '[...document.querySelectorAll("#tg-recharge-analysis .recharge-analysis-grid .metric-value")].map(x=>Number(x.textContent.replace(/[^0-9.-]/g,"")))',
      );
      assert.equal(metrics[2], amount);
    }
    await c.click("#tg-reset");
    await c.evaluate(
      `document.querySelector('#tg-month').value='2026-08';document.querySelector('#tg-month').dispatchEvent(new Event('change'))`,
    );
    await c.waitFor(
      `document.querySelector('[data-loaded-month]')?.dataset.loadedMonth==='2026-08'`,
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-ledger-row .grade-badge").textContent',
      ),
      "初三",
    );
    assert.deepEqual(c.exceptions, []);
  } finally {
    await b.close();
  }
});
test("v14 Excel restores batch attendance, money reversal chains, v6 identities and exact restricted permissions without charging again", async () => {
  const X = require("../src/excel/full_backup"),
    T = require("../src/domain/tuoguan_transfer"),
    source = path.join(dir, "backup-source.sqlite"),
    target = path.join(dir, "backup-target.sqlite"),
    xlsx = path.join(dir, "batch.xlsx");
  const live = new DatabaseSync(env.DB_PATH);
  await backup(live, source);
  await backup(live, target);
  live.close();
  const d = new DatabaseSync(source),
    store = TG.createStore(d),
    write = (a, b) =>
      store.mutate(a, { request_id: crypto.randomUUID(), ...b }, "合成备份");
  const cells = () =>
    [1, 2].flatMap((student_id) =>
      ["2026-09-07", "2026-09-08"].map((date) => ({
        student_id,
        date,
        version:
          store.get(
            "SELECT version FROM tg_attendance WHERE student_id=? AND date=?",
            student_id,
            date,
          )?.version || 0,
      })),
    );
  write("batch-attendance", {
    month: "2026-09",
    status: "出勤",
    cells: cells(),
  });
  write("batch-attendance", {
    month: "2026-09",
    status: "请假",
    cells: cells(),
  });
  write("batch-attendance", {
    month: "2026-09",
    status: "不适用",
    cells: [cells()[0]],
  });
  write("batch-attendance", {
    month: "2026-10",
    status: "出勤",
    cells: [{ student_id: 1, date: "2026-10-01", version: 0 }],
  });
  const recharge = store.get(
    "SELECT * FROM tg_ledger WHERE kind='充值' AND student_id=1 AND voided_at IS NULL ORDER BY id LIMIT 1",
  );
  write("money-edit", {
    ...recharge,
    actual_amount: recharge.actual_amount + 1000,
  });
  const profile = store.get("SELECT * FROM tg_students WHERE id=2");
  write("student", { ...profile, status: "暂停" });
  write("remove-dates", {
    month: "2026-09",
    dates: [{ date: "2026-09-09", version: 0 }],
  });
  d.exec(
    "UPDATE roles SET readonly=1 WHERE code='helper';DELETE FROM role_permissions WHERE role_code='helper';INSERT INTO role_permissions(role_code,permission_key,enabled) VALUES('helper','tgAttendance',1)",
  );
  const transfer = T.exportData(d);
  assert.equal(transfer.version, 6);
  const tables = [
    ...TG.TABLES,
    "roles",
    "role_permissions",
    "users",
    "user_page_permissions",
  ];
  const records = Object.fromEntries(
    tables.map((n) => [n, d.prepare("SELECT * FROM " + n).all()]),
  );
  const summaries = Object.fromEntries(
    ["2026-09", "2026-10"].map((m) => [m, store.snapshot(m, true).summary]),
  );
  d.close();
  assert.equal(X.FORMAT_VERSION, 14);
  X.exportFullData({ dbPath: source, outputPath: xlsx });
  const result = X.restoreFullData({ dbPath: target, inputPath: xlsx });
  assert.equal(result.custody_settlement.updated, 0);
  const restored = new DatabaseSync(target),
    rs = TG.createStore(restored);
  for (const table of tables)
    assert.deepEqual(
      restored.prepare("SELECT * FROM " + table).all(),
      records[table],
      table,
    );
  for (const month of Object.keys(summaries))
    assert.deepEqual(rs.snapshot(month, true).summary, summaries[month]);
  assert.deepEqual(T.exportData(restored).records, transfer.records);
  assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(
    restored.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  assert.deepEqual(
    rs
      .all(
        "SELECT permission_key FROM role_permissions WHERE role_code='helper' AND enabled=1",
      )
      .map((r) => r.permission_key),
    ["tgAttendance"],
  );
  assert.equal(
    rs.get("SELECT readonly FROM roles WHERE code='helper'").readonly,
    1,
  );
  restored.close();
});
test("Edge custody checklist icon is distinct, bounded and consistent in themes and collapsed navigation", async () => {
  const b = await launchBrowser(path.join(dir, "edge-layout-icons"), {
      browser: "edge",
    }),
    c = b.session;
  try {
    await open(c);
    assert.equal(
      await c.evaluate(
        "new Set([NAV_ICONS.home,NAV_ICONS.tuoguan,NAV_ICONS.schedule,NAV_ICONS.students]).size",
      ),
      4,
    );
    assert.equal(
      await c.evaluate('NAV_ICONS.home.includes("M4 10.5 12 4l8 6.5")'),
      true,
    );
    for (const theme of ["light", "dark"])
      for (const collapsed of [false, true]) {
        await c.evaluate(
          `document.documentElement.dataset.theme='${theme}';if(sidebarCollapsed!==${collapsed})document.querySelector('.sidebar-toggle').click()`,
        );
        await c.evaluate(
          "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
        );
        const icons = await c.evaluate(
          `['home','tuoguan','schedule','students'].map(key=>{const svg=document.querySelector('.nav-btn[data-nav-group="'+key+'"] svg'),s=getComputedStyle(svg),box=svg.getBBox();return {key,viewBox:svg.getAttribute('viewBox'),width:s.width,height:s.height,stroke:s.stroke,fill:s.fill,line:s.strokeWidth,color:s.color,bounded:box.x>=1&&box.y>=1&&box.x+box.width<=23&&box.y+box.height<=23}})`,
        );
        for (const icon of icons) {
          assert.equal(icon.viewBox, "0 0 24 24");
          assert.equal(icon.width, "18px");
          assert.equal(icon.height, "18px");
          assert.equal(icon.line, "1.8px");
          assert.equal(icon.fill, "none");
          assert.equal(icon.stroke, icon.color);
          assert.equal(icon.bounded, true);
        }
        fs.writeFileSync(
          path.join(dir, `icons-${theme}-${collapsed}.png`),
          Buffer.from(
            (await c.send("Page.captureScreenshot", { format: "png" })).data,
            "base64",
          ),
        );
      }
    assert.deepEqual(c.exceptions, []);
  } finally {
    await b.close();
  }
});
test("Edge matrix four frozen columns and actual content centers survive resize, scroll, picker success/failure and empty data", async () => {
  const b = await launchBrowser(path.join(dir, "edge-layout-centers"), {
      browser: "edge",
    }),
    c = b.session;
  try {
    const admin = await loginApi("boss");
    for (const [i, status] of ["出勤", "请假", "放假", "不适用"].entries()) {
      const date = ["2026-09-10", "2026-09-11", "2026-09-14", "2026-09-15"][i];
      assert.equal(
        (
          await call(admin, "tuoguan/attendance", {
            date,
            rows: [{ student_id: 1, status, version: 0 }],
            request_id: crypto.randomUUID(),
          })
        ).status,
        200,
      );
    }
    await open(c);
    const measure = () =>
      c.evaluate(
        `(()=>{const t=document.querySelector('.tg-matrix'),rows=[...t.rows],rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}},center=(a,b)=>Math.max(Math.abs(a.left+a.width/2-b.left-b.width/2),Math.abs(a.top+a.height/2-b.top-b.height/2));return {columns:rows.map(r=>r.cells.length),headers:[...t.tHead.rows[1].cells].slice(0,4).map(c=>c.textContent.trim()),centers:rows.flatMap(r=>[...r.cells].map(cell=>{const child=cell.querySelector('input[type=checkbox],.entity-badge');const style=getComputedStyle(cell);return {text:cell.textContent,align:style.textAlign,vertical:style.verticalAlign,error:child?center(rect(child),rect(cell)):0}})),positions:rows.map(r=>[...r.cells].slice(0,4).map(rect)),dates:[...t.tHead.rows[1].cells].slice(4).map(rect),width:rect(t.tHead.rows[1].cells[0]).width,leftSelect:[...t.tBodies[0].rows].every(r=>r.cells[0].querySelectorAll('.tg-select-student').length===1&&!r.lastElementChild.querySelector('input')),indexes:[...t.tBodies[0].rows].map(r=>r.cells[1].textContent.trim())}})()`,
      );
    for (const width of [1440, 390, 1024])
      for (const theme of ["light", "dark"]) {
        await c.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: width === 390,
        });
        await c.evaluate(
          `document.documentElement.dataset.theme='${theme}';if(sidebarCollapsed!==${width===390})document.querySelector('.sidebar-toggle').click();document.querySelector('.tg-scroll').scrollLeft=0;scheduleAdaptiveTableColumns();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
        );
        const before = await measure();
        assert.deepEqual(before.headers, ["选择", "序号", "学生", "年级"]);
        assert.equal(new Set(before.columns).size, 1);
        assert.equal(before.leftSelect, true);
        assert.ok(before.width <= 46);
        assert.deepEqual(before.indexes, ["1", "2"]);
        assert.ok(
          before.centers.every(
            (x) =>
              x.align === "center" && x.vertical === "middle" && x.error <= 1.1,
          ),
          JSON.stringify(before.centers.filter((x) => x.error > 1.1)),
        );
        await c.evaluate("document.querySelector('.tg-scroll').scrollLeft=320");
        const after = await measure();
        for (let r = 0; r < before.positions.length; r++)
          for (let i = 0; i < 4; i++) {
            assert.equal(
              after.positions[r][i].left,
              before.positions[r][i].left,
            );
            if (i)
              assert.ok(
                Math.abs(
                  after.positions[r][i].left -
                    after.positions[r][i - 1].left -
                    after.positions[r][i - 1].width,
                ) < 1,
              );
            assert.ok(
              Math.abs(
                after.positions[r][i].left - after.positions[0][i].left,
              ) < 1,
            );
          }
        assert.ok(after.dates[0].left < before.dates[0].left);
        await c.evaluate("document.querySelector('.tg-scroll').scrollLeft=0");
        fs.writeFileSync(
          path.join(dir, `matrix-centered-${width}-${theme}.png`),
          Buffer.from(
            (await c.send("Page.captureScreenshot", { format: "png" })).data,
            "base64",
          ),
        );
      }
    await c.send("Emulation.clearDeviceMetricsOverride");
    await c.evaluate(
      "document.querySelector('.tg-scroll').style.maxHeight='150px';document.querySelector('.tg-scroll').style.overflowY='auto';document.querySelector('.tg-scroll').scrollTop=20",
    );
    const pinned = await c.evaluate(
      `(()=>{const t=document.querySelector('.tg-matrix'),wrap=document.querySelector('.tg-scroll');return {scrolled:wrap.scrollTop,top:t.tHead.rows[0].getBoundingClientRect().top,cellTop:t.tHead.rows[0].cells[0].getBoundingClientRect().top,wrapTop:wrap.getBoundingClientRect().top,second:t.tHead.rows[1].cells[0].getBoundingClientRect().top}})()`,
    );
    assert.ok(pinned.scrolled > 0);
    assert.ok(Math.abs(pinned.cellTop - pinned.wrapTop) < 2);
    assert.equal(pinned.second - pinned.cellTop, 30);
    await c.evaluate(
      "document.querySelector('.tg-scroll').style.maxHeight='';document.querySelector('.tg-scroll').scrollTop=0",
    );
    const target = '.tg-cell-button[data-student="1"][data-date="2026-09-10"]';
    const cell = () =>
      c.evaluate(
        `(()=>{const el=document.querySelector('${target}'),r=el.closest('td').getBoundingClientRect(),b=el.querySelector('.status-badge').getBoundingClientRect();return {height:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2,bx:b.x+b.width/2,by:b.y+b.height/2}})()`,
      );
    const original = await cell();
    await c.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: original.cx,
      y: original.cy,
    });
    assert.deepEqual(await cell(), original);
    await c.click(target);
    assert.deepEqual(await cell(), original);
    await c.click('.custom-select-menu.open [data-value="请假"]');
    await c.waitFor(
      `document.querySelector('${target}').textContent==='请假'&&!document.querySelector('.custom-select-menu.open')`,
    );
    const saved = await cell();
    // The existing success message may move the whole table; the cell itself must stay stable.
    assert.equal(saved.height, original.height);
    assert.ok(
      Math.abs(saved.cx - saved.bx) < 1.1 &&
        Math.abs(saved.cy - saved.by) < 1.1,
    );
    await c.evaluate(
      `window.savedFetch=fetch;window.fetch=(url,...a)=>String(url).endsWith('/attendance')?Promise.reject(Error('合成保存失败')):savedFetch(url,...a)`,
    );
    await c.click(target);
    await c.click('.custom-select-menu.open [data-value="放假"]');
    await c.waitFor(
      `!document.querySelector('.custom-select-menu.open')&&document.querySelector('#tg-msg').textContent.includes('合成保存失败')`,
    );
    const failed = await cell();
    assert.equal(failed.height, original.height);
    assert.ok(
      Math.abs(failed.cx - failed.bx) < 1.1 &&
        Math.abs(failed.cy - failed.by) < 1.1,
    );
    await c.evaluate("window.fetch=savedFetch");
    await c.evaluate(
      `document.querySelector('#tg-query').value='无匹配合成学生';document.querySelector('#tg-query').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector(".tg-matrix tbody .empty").colSpan===document.querySelector(".tg-matrix").tHead.rows[1].cells.length',
      ),
      true,
    );
    assert.equal(
      await c.evaluate('document.querySelector(".tg-select-all").disabled'),
      true,
    );
    const snap = await call(admin, "tuoguan/snapshot?month=2033-02");
    assert.equal(
      (
        await call(admin, "tuoguan/remove-dates", {
          month: "2033-02",
          dates: snap.data.calendar
            .filter((d) => d.enabled)
            .map(({ date, version }) => ({ date, version })),
          request_id: crypto.randomUUID(),
        })
      ).status,
      200,
    );
    await c.click("#tg-reset");
    await c.evaluate(
      `document.querySelector('#tg-month').value='2033-02';document.querySelector('#tg-month').dispatchEvent(new Event('change'))`,
    );
    await c.waitFor(
      `document.querySelector('[data-loaded-month]')?.dataset.loadedMonth==='2033-02'`,
    );
    assert.equal(
      await c.evaluate(
        '[...document.querySelectorAll(".tg-matrix tr")].every(r=>r.cells.length===4)',
      ),
      true,
    );
    assert.equal(
      await c.evaluate(
        'document.querySelectorAll(".tg-select-date,.tg-select-student:not(:disabled)").length',
      ),
      0,
    );
    assert.equal(
      await c.evaluate('document.querySelector(".tg-select-all").disabled'),
      true,
    );
    assert.deepEqual(c.exceptions, []);
  } finally {
    await b.close();
  }
});
