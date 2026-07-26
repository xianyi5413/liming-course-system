const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");

const root = path.resolve(__dirname, "..");
let tempRoot;
let databasePath;
let port;
let server;
let ownerCookie;
let readonlyCookie;

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("recharge channel test server did not start");
}

async function login(username) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "123456" }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

async function api(pathname, { cookie = ownerCookie, method = "GET", body } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-recharge-channel-"));
  databasePath = path.join(tempRoot, "synthetic.sqlite");
  const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], {
    cwd: root,
    env: { ...process.env, DATA_DIR: tempRoot, DB_PATH: databasePath },
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(databasePath);
  const passwordHash = db.prepare("SELECT password_hash FROM users WHERE username='boss'").get().password_hash;
  db.exec(`
    UPDATE settings SET value='2026-07-01' WHERE key='month_key';
    INSERT INTO students(id,name,grade,status) VALUES
      (9701,'渠道学生甲','初一','在读'),
      (9702,'渠道学生乙','初二','在读'),
      (9703,'渠道学生丙','初三','在读');
    INSERT INTO recharge_records(id,student_name,grade,cur_recharge,cur_gift,recharge_date,notes,source,channel,channel_other,month_key) VALUES
      (9711,'渠道学生甲','初一',1000,100,'2026-07-03','不得被渠道请求修改','manual','','','2026-07-01'),
      (9712,'渠道学生乙','初二',800,50,'2026-07-04','已有其他渠道','import','other','银行转账','2026-07-01'),
      (9713,'渠道学生丙','初三',600,0,'2026-07-05','普通渠道','manual','alipay','','2026-07-01');
  `);
  const readonlyId = Number(db.prepare(`
    INSERT INTO users(username,display_name,role,password_hash,permission_override_enabled,status)
    VALUES ('channel-readonly','渠道只读','helper',?,1,'active')
  `).run(passwordHash).lastInsertRowid);
  db.prepare("INSERT INTO user_page_permissions(user_id,permission_key,enabled) VALUES (?,'recharges',1)").run(readonlyId);
  db.close();
  port = await freePort();
  server = spawn(process.execPath, [path.join(root, "src/server.js")], {
    cwd: root,
    env: {
      ...process.env,
      DATA_DIR: tempRoot,
      DB_PATH: databasePath,
      PORT: String(port),
      SESSION_COOKIE_SECURE: "false",
      BAIDU_APP_KEY: "",
      BAIDU_APP_SECRET: "",
      BAIDU_REDIRECT_URI: "",
    },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  await waitForServer();
  ownerCookie = await login("boss");
  readonlyCookie = await login("channel-readonly");
});

after(async () => {
  if (server?.exitCode == null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {}
});

test("channel endpoint patches only channel fields, validates other, rechecks permissions and logs a safe delta", async () => {
  const rejectedExtra = await api("/api/recharges/9711/channel", {
    method: "PATCH",
    body: { channel: "cash", channel_other: "", notes: "越权覆盖" },
  });
  assert.equal(rejectedExtra.response.status, 400);
  assert.match(rejectedExtra.payload.error, /只允许提交/);

  const cash = await api("/api/recharges/9711/channel", {
    method: "PATCH",
    body: { channel: "cash", channel_other: "应被清空" },
  });
  assert.equal(cash.response.status, 200);
  assert.equal(cash.payload.row.channel, "cash");
  assert.equal(cash.payload.row.channel_other, "");
  assert.equal(cash.payload.row.student_name, "渠道学生甲");
  assert.equal(cash.payload.row.cur_recharge, 1000);
  assert.equal(cash.payload.row.notes, "不得被渠道请求修改");
  assert.equal(cash.payload.row.source, "manual");

  const other = await api("/api/recharges/9711/channel", {
    method: "PATCH",
    body: { channel: "other", channel_other: "  对公转账  " },
  });
  assert.equal(other.response.status, 200);
  assert.equal(other.payload.row.channel, "other");
  assert.equal(other.payload.row.channel_other, "对公转账");

  for (const channelOther of ["   ", "超".repeat(101)]) {
    const invalid = await api("/api/recharges/9711/channel", {
      method: "PATCH",
      body: { channel: "other", channel_other: channelOther },
    });
    assert.equal(invalid.response.status, 400);
  }

  const forbidden = await api("/api/recharges/9711/channel", {
    cookie: readonlyCookie,
    method: "PATCH",
    body: { channel: "wechat", channel_other: "" },
  });
  assert.equal(forbidden.response.status, 403);

  const db = new DatabaseSync(databasePath);
  const row = db.prepare("SELECT * FROM recharge_records WHERE id=9711").get();
  const log = db.prepare("SELECT operation_type,operation_content,extra_json FROM operation_logs WHERE target_type='recharge_records' AND target_id='9711' ORDER BY id DESC LIMIT 1").get();
  assert.deepEqual(
    { student_name: row.student_name, grade: row.grade, cur_recharge: row.cur_recharge, cur_gift: row.cur_gift, recharge_date: row.recharge_date, notes: row.notes, source: row.source },
    { student_name: "渠道学生甲", grade: "初一", cur_recharge: 1000, cur_gift: 100, recharge_date: "2026-07-03", notes: "不得被渠道请求修改", source: "manual" },
  );
  assert.equal(log.operation_type, "修改充值渠道");
  assert.doesNotMatch(log.extra_json || "", /cur_recharge|recharge_date|不得被渠道请求修改|password|cookie|session/i);
  db.prepare("UPDATE recharge_records SET channel='',channel_other='' WHERE id=9711").run();
  db.close();
});

test("inline channel overlay is body-mounted, keyboard accessible, local-only and preserves table state", async () => {
  const chrome = await launchChrome(path.join(tempRoot, "chrome-profile"));
  const browser = chrome.session;
  try {
    await browser.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await browser.login("boss", "123456");
    if (!await browser.evaluate("Boolean(document.querySelector('.nav-sub-btn[data-view=\"recharges\"]'))")) await browser.click('.nav-btn[data-nav-group="students"]');
    await browser.click('.nav-sub-btn[data-view="recharges"]');
    await browser.waitFor("document.querySelectorAll('.recharge-row').length===3");

    for (const width of [1440, 1280, 1024, 390]) {
      await browser.send("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: width === 390 });
      await browser.evaluate("window.dispatchEvent(new Event('resize'))");
      await browser.evaluate("document.querySelector('.recharge-row[data-id=\"9711\"] .recharge-channel-cell').scrollIntoView({block:'center',inline:'center'})");
      await browser.click('.recharge-row[data-id="9711"] .recharge-channel-cell');
      await browser.waitFor("Boolean(document.querySelector('.recharge-channel-overlay'))");
      const geometry = await browser.evaluate(`(() => {
        const menu=document.querySelector('.recharge-channel-overlay');
        const rect=menu.getBoundingClientRect();
        return {
          bodyMounted:menu.parentElement===document.body,
          count:document.querySelectorAll('.recharge-channel-overlay').length,
          inViewport:rect.left>=0&&rect.top>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1,
          rect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height,innerWidth,innerHeight,scrollY,styleTop:menu.style.top,position:getComputedStyle(menu).position},
          optionCount:menu.querySelectorAll('.recharge-channel-option').length,
          nativeSelects:menu.querySelectorAll('select').length,
        };
      })()`);
      assert.deepEqual({ bodyMounted: geometry.bodyMounted, count: geometry.count, inViewport: geometry.inViewport, optionCount: geometry.optionCount, nativeSelects: geometry.nativeSelects }, { bodyMounted: true, count: 1, inViewport: true, optionCount: 4, nativeSelects: 0 }, JSON.stringify({ width, rect: geometry.rect }));
      await browser.click('.recharge-row[data-id="9711"] .recharge-channel-cell');
      await browser.waitFor("!document.querySelector('.recharge-channel-overlay')");
    }

    await browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate("window.dispatchEvent(new Event('resize'))");
    await browser.evaluate(`(() => {
      const cell=document.querySelector('.recharge-row[data-id="9711"] .recharge-channel-cell');
      cell.focus();
      cell.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    })()`);
    await browser.waitFor("Boolean(document.querySelector('.recharge-channel-overlay'))");
    await browser.evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await browser.waitFor("!document.querySelector('.recharge-channel-overlay')");

    await browser.evaluate(`(() => {
      const cell=document.querySelector('.recharge-row[data-id="9711"] .recharge-channel-cell');
      cell.focus();
      cell.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));
    })()`);
    await browser.waitFor("Boolean(document.querySelector('.recharge-channel-overlay'))");
    await browser.click(".recharge-action-row");
    await browser.waitFor("!document.querySelector('.recharge-channel-overlay')");

    await browser.evaluate(`(() => {
      const input=document.querySelector('input.recharge-student-filter');
      input.value='渠道学生甲';
      input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await browser.waitFor("document.querySelectorAll('.recharge-row').length===1 && document.querySelector('input.recharge-student-filter')?.value==='渠道学生甲'");
    await browser.click('.recharge-row[data-id="9711"] .recharge-select-row');
    await browser.evaluate("document.querySelector('.recharge-table').closest('.table-wrap').scrollLeft=40");
    const scrollBefore = await browser.evaluate("document.querySelector('.recharge-table').closest('.table-wrap').scrollLeft");
    const bootstrapBefore = browser.responses.filter((item) => /\/api\/bootstrap(?:\?|$)/.test(item.url)).length;
    await browser.click('.recharge-row[data-id="9711"] .recharge-channel-cell');
    await browser.click('.recharge-channel-option[data-channel="wechat"]');
    await browser.waitFor("document.querySelector('.recharge-row[data-id=\"9711\"] .recharge-channel-value')?.textContent.trim()==='微信' && !document.querySelector('.recharge-channel-overlay')");
    assert.equal(await browser.evaluate("document.querySelector('.recharge-row[data-id=\"9711\"] .recharge-select-row').checked"), true);
    assert.equal(await browser.evaluate("document.querySelector('.recharge-row[data-id=\"9711\"] .recharge-channel-saving').hidden"), true);
    assert.equal(await browser.evaluate("document.querySelector('input.recharge-student-filter').value"), "渠道学生甲");
    assert.equal(await browser.evaluate("document.querySelector('.recharge-table').closest('.table-wrap').scrollLeft"), scrollBefore);
    assert.equal(browser.responses.filter((item) => /\/api\/bootstrap(?:\?|$)/.test(item.url)).length, bootstrapBefore);
    assert.equal(browser.responses.filter((item) => /\/api\/recharges\/9711\/channel$/.test(item.url) && item.status === 200).length >= 1, true);

    await browser.click(".reset-recharge-filter");
    await browser.waitFor("document.querySelectorAll('.recharge-row').length===3");
    await browser.click('.recharge-row[data-id="9712"] .recharge-channel-cell');
    await browser.waitFor("Boolean(document.querySelector('.recharge-channel-other-editor:not([hidden])'))");
    assert.equal(await browser.evaluate("document.querySelector('.recharge-channel-other-input').value"), "银行转账");
    await browser.evaluate(`(() => {
      const input=document.querySelector('.recharge-channel-other-input');
      input.value='   ';
      document.querySelector('.recharge-channel-save-other').click();
    })()`);
    assert.match(await browser.evaluate("document.querySelector('.recharge-channel-error').textContent"), /请填写/);
    assert.equal(await browser.evaluate("document.querySelector('.recharge-row[data-id=\"9712\"] .recharge-channel-value').textContent.trim()"), "其他：银行转账");
    await browser.evaluate("document.querySelector('.recharge-channel-other-input').value='  银联商务  '");
    await browser.click(".recharge-channel-save-other");
    await browser.waitFor("document.querySelector('.recharge-row[data-id=\"9712\"] .recharge-channel-value')?.textContent.trim()==='其他：银联商务' && !document.querySelector('.recharge-channel-overlay')");

    await browser.click('.recharge-row[data-id="9712"] .recharge-channel-cell');
    await browser.click(".recharge-channel-cancel");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.recharge-channel-overlay'))"), false);
    assert.equal(await browser.evaluate("document.querySelector('.recharge-row[data-id=\"9712\"] .recharge-channel-value').textContent.trim()"), "其他：银联商务");

    await browser.click('.recharge-row[data-id="9712"] .recharge-channel-cell');
    await browser.click('.recharge-channel-option[data-channel="cash"]');
    await browser.waitFor("document.querySelector('.recharge-row[data-id=\"9712\"] .recharge-channel-value')?.textContent.trim()==='现金'");
    const persisted = await api("/api/recharges?month=2026-07-01");
    const changed = persisted.payload.recharges.find((row) => Number(row.id) === 9712);
    assert.deepEqual({ channel: changed.channel, channel_other: changed.channel_other }, { channel: "cash", channel_other: "" });

    await browser.click('.recharge-row[data-id="9711"] .recharge-channel-cell');
    await browser.click('.recharge-row[data-id="9712"] .recharge-channel-cell');
    assert.equal(await browser.evaluate("document.querySelectorAll('.recharge-channel-overlay').length"), 1);
    await browser.click('.nav-sub-btn[data-view="openingBalances"]');
    await browser.waitFor("Boolean(document.querySelector('.opening-balance-page'))");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.recharge-channel-overlay'))"), false);

    await browser.evaluate("fetch('/api/auth/logout',{method:'POST'}).then(()=>location.reload())");
    await browser.waitFor("Boolean(document.querySelector('.login-panel'))");
    await browser.evaluate(`(() => {
      document.querySelector('.login-username').value='channel-readonly';
      document.querySelector('.login-password').value='123456';
      document.querySelector('.login-submit').click();
    })()`);
    await browser.waitFor("Boolean(document.querySelector('.nav-btn[data-nav-group=\"students\"]'))");
    if (!await browser.evaluate("Boolean(document.querySelector('.nav-sub-btn[data-view=\"recharges\"]'))")) await browser.click('.nav-btn[data-nav-group="students"]');
    await browser.click('.nav-sub-btn[data-view="recharges"]');
    await browser.waitFor("document.querySelectorAll('.recharge-row').length===3");
    assert.deepEqual(await browser.evaluate(`(() => { const cell=document.querySelector('.recharge-channel-cell'); cell.click(); return { editable:cell.dataset.channelEditable||'', role:cell.getAttribute('role'), overlay:Boolean(document.querySelector('.recharge-channel-overlay')) }; })()`), { editable: "", role: null, overlay: false });

    assert.deepEqual(browser.exceptions, []);
    assert.deepEqual(browser.consoleErrors, []);
  } finally {
    await browser.close();
    if (chrome.child.exitCode == null) chrome.child.kill("SIGTERM");
  }
});
