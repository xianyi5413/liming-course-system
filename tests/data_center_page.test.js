const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");

const root = path.resolve(__dirname, "..");

async function waitForServer(processHandle, port, stderr) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode != null) throw new Error(`server exited: ${stderr()}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not start: ${stderr()}`);
}

async function withBrowserScenario({ legacyRecord = false, prepareDatabase, prepareFilesystem, environment = {} } = {}, action) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-data-center-page-"));
  const database = path.join(tempRoot, "data.sqlite");
  const baseEnv = { ...process.env, DATA_DIR: tempRoot, DB_PATH: database, SESSION_COOKIE_SECURE: "false", BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "", BACKUP_ENCRYPTION_KEY: "", ...environment };
  const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], { cwd: root, env: baseEnv, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(database);
  if (legacyRecord) {
    db.exec(`DROP TABLE backup_records; CREATE TABLE backup_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, backup_time TEXT DEFAULT CURRENT_TIMESTAMP,
      backup_type TEXT NOT NULL DEFAULT 'manual', included_months INTEGER DEFAULT 0,
      filename TEXT DEFAULT '', file_path TEXT DEFAULT '', file_size INTEGER DEFAULT 0,
      status TEXT DEFAULT 'success', message TEXT DEFAULT '', scheduled_date TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.prepare("INSERT INTO backup_records(backup_type,included_months,filename,file_path,file_size,status) VALUES ('manual',12,'legacy-core.zip','backups/legacy-core.zip',1234,'success')").run();
  }
  if (prepareDatabase) prepareDatabase(db);
  db.close();
  if (prepareFilesystem) prepareFilesystem({ tempRoot, database });

  const port = await freePort();
  let stdout = "";
  let stderr = "";
  const server = spawn(process.execPath, [path.join(root, "src/server.js")], { cwd: root, env: { ...baseEnv, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout.on("data", (chunk) => { stdout += String(chunk); });
  server.stderr.on("data", (chunk) => { stderr += String(chunk); });
  let chrome;
  try {
    await waitForServer(server, port, () => stderr);
    chrome = await launchChrome(path.join(tempRoot, "chrome-profile"));
    await chrome.session.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await action({ browser: chrome.session, database, port, serverLogs: () => ({ stdout, stderr }) });
  } finally {
    if (chrome) {
      await chrome.session.close();
      if (chrome.child.exitCode == null) chrome.child.kill("SIGTERM");
    }
    if (server.exitCode == null) server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

async function assertThreeRegions(browser) {
  await browser.waitFor("document.querySelector('#topbar')?.textContent.includes('数据中心') && document.querySelectorAll('.data-center-section').length === 3");
  assert.equal(await browser.evaluate("document.querySelector('[data-region=\"import-export\"]')?.textContent.includes('数据导入导出')"), true);
  assert.equal(await browser.evaluate("document.querySelector('[data-region=\"backup-settings\"]')?.textContent.includes('备份设置')"), true);
  assert.equal(await browser.evaluate("document.querySelector('[data-region=\"backup-records\"]')?.textContent.includes('备份记录')"), true);
}

test("owner opens the real data-center page with an upgraded legacy backup record", async () => {
  await withBrowserScenario({ legacyRecord: true }, async ({ browser, database, serverLogs }) => {
    await browser.login("boss", "123456");
    await browser.openDataCenter();
    await assertThreeRegions(browser);
    assert.deepEqual(browser.dataCenterResponses().map((response) => response.status), [200]);
    assert.equal(await browser.evaluate("document.querySelector('[data-region=\"backup-records\"]')?.textContent.includes('旧版业务归档')"), true);
    assert.equal(await browser.evaluate("document.querySelector('[data-region=\"backup-settings\"]')?.textContent.includes('百度网盘：未配置')"), true);
    assert.equal(await browser.evaluate("document.querySelector('[data-region=\"backup-settings\"]')?.textContent.includes('备份加密密钥：未配置')"), true);
    const db = new DatabaseSync(database, { readOnly: true });
    const columns = new Set(db.prepare("PRAGMA table_info(backup_records)").all().map((column) => column.name));
    const count = db.prepare("SELECT COUNT(*) AS count FROM backup_records").get().count;
    db.close();
    for (const column of ["backup_format", "managed_relative_path", "remote_status", "deleted_at"]) assert.equal(columns.has(column), true, column);
    assert.equal(count, 1);
    assert.deepEqual(browser.exceptions, []);
    assert.deepEqual(browser.consoleErrors, []);
    assert.equal(serverLogs().stderr, "", `server stderr: ${serverLogs().stderr}`);
  });
});

test("fresh database opens with no backup directory, optional secrets or records", async () => {
  await withBrowserScenario({}, async ({ browser }) => {
    await browser.login("boss", "123456");
    await browser.openDataCenter();
    await assertThreeRegions(browser);
    const settingsText = await browser.evaluate("document.querySelector('[data-region=\"backup-settings\"]')?.textContent");
    assert.match(settingsText, /自动备份：未启用/);
    assert.match(settingsText, /百度网盘：未配置/);
    assert.match(settingsText, /备份加密密钥：未配置/);
    assert.match(settingsText, /尚未创建/);
    assert.equal(await browser.evaluate("document.querySelector('[data-region=\"backup-records\"]')?.textContent.includes('暂无备份记录')"), true);
    assert.equal(await browser.evaluate("document.querySelector('.baidu-connect')?.disabled"), true);
    assert.equal(await browser.evaluate("document.querySelector('.baidu-test')?.disabled"), true);
    assert.equal(await browser.evaluate("document.querySelector('.data-backup-remote-enabled')?.disabled"), true);
    assert.equal(await browser.evaluate("document.querySelector('.baidu-disconnect')?.disabled"), true);
    assert.deepEqual(browser.exceptions, []);
    assert.deepEqual(browser.consoleErrors, []);
  });
});

test("Baidu configuration guide opens without exposing secret values", async () => {
  await withBrowserScenario({ environment: { BAIDU_APP_KEY: "PAGE-APP-KEY-SECRET", BAIDU_APP_SECRET: "PAGE-APP-SECRET", BAIDU_REDIRECT_URI: "http://127.0.0.1:5177/api/data-center/baidu/callback", BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } }, async ({ browser }) => {
    await browser.login("boss", "123456");
    await browser.openDataCenter();
    await assertThreeRegions(browser);
    assert.equal(await browser.evaluate("document.querySelector('.baidu-connect')?.disabled"), false);
    assert.equal(await browser.evaluate("document.querySelector('.baidu-test')?.disabled"), true);
    assert.equal(await browser.evaluate("document.querySelector('.data-backup-remote-enabled')?.disabled"), true);
    const pageText = await browser.evaluate("document.body.textContent");
    assert.doesNotMatch(pageText, /PAGE-APP-KEY-SECRET|PAGE-APP-SECRET/);
    assert.equal(await browser.evaluate("document.querySelector('.baidu-backup-card input[readonly]')?.value"), "http://127.0.0.1:5177/api/data-center/baidu/callback");
    await browser.click(".baidu-guide-open");
    await browser.waitFor("Boolean(document.querySelector('.baidu-guide-modal'))");
    const guide = await browser.evaluate("document.querySelector('.baidu-guide-modal')?.textContent");
    for (const step of ["第1步", "第2步", "第3步", "第4步", "第5步", "npm run backup:key:generate"]) assert.match(guide, new RegExp(step));
    assert.doesNotMatch(guide, /PAGE-APP-KEY-SECRET|PAGE-APP-SECRET/);
    assert.deepEqual(browser.exceptions, []);
    assert.deepEqual(browser.consoleErrors, []);
  });
});

test("authorized Baidu state enables test, disconnect and remote-backup controls", async () => {
  const environment = { BAIDU_APP_KEY: "K", BAIDU_APP_SECRET: "S", BAIDU_REDIRECT_URI: "http://127.0.0.1:5177/api/data-center/baidu/callback", BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64") };
  const prepareFilesystem = ({ tempRoot }) => {
    const directory = path.join(tempRoot, "backups", "full-excel", ".secrets");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "baidu-token.json"), JSON.stringify({ access_token: "SYNTHETIC-TOKEN", refresh_token: "SYNTHETIC-REFRESH", expires_at: Date.now() + 3600000 }));
  };
  await withBrowserScenario({ environment, prepareFilesystem }, async ({ browser }) => {
    await browser.login("boss", "123456");
    await browser.openDataCenter();
    await assertThreeRegions(browser);
    assert.equal(await browser.evaluate("document.querySelector('.baidu-test')?.disabled"), false);
    assert.equal(await browser.evaluate("document.querySelector('.baidu-disconnect')?.disabled"), false);
    assert.equal(await browser.evaluate("document.querySelector('.data-backup-remote-enabled')?.disabled"), false);
    assert.doesNotMatch(await browser.evaluate("document.body.textContent"), /SYNTHETIC-TOKEN|SYNTHETIC-REFRESH/);
    assert.deepEqual(browser.exceptions, []);
  });
});

test("manual backup shows an actionable missing-month issue and succeeds after explicit repair", async () => {
  const prepareDatabase = (db) => db.prepare("INSERT INTO student_opening_balances(id,month_key,student_name,grade,opening_actual_balance,opening_gift_balance,notes) VALUES (8801,'','浏览器缺月学生','初一',1000,200,'从源Excel 2026年2月.xlsx 迁移')").run();
  await withBrowserScenario({ prepareDatabase }, async ({ browser, database }) => {
    await browser.login("boss", "123456");
    await browser.openDataCenter();
    await assertThreeRegions(browser);
    await browser.click(".backup-run-now");
    await browser.waitFor("Boolean(document.querySelector('.data-preflight-panel.danger')) && document.body.textContent.includes('浏览器缺月学生')");
    assert.equal(await browser.evaluate("document.querySelector('.data-preflight-panel')?.textContent.includes('请先补充记录所属月份')"), true);
    await browser.click(".data-preflight-view");
    await browser.waitFor("document.querySelector('#topbar')?.textContent.includes('期初余额') && document.body.textContent.includes('浏览器缺月学生')");
    await browser.evaluate("document.querySelector('.opening-balance-month-repair').value='2026-02'");
    await browser.evaluate("window.confirm=()=>true");
    await browser.click(".opening-balance-month-repair-confirm");
    await browser.waitFor("document.querySelector('.opening-balance-field[data-field=\"month_key\"]')?.value === '2026-02'");
    const db = new DatabaseSync(database, { readOnly: true });
    assert.equal(db.prepare("SELECT month_key FROM student_opening_balances WHERE id=8801").get().month_key, "2026-02-01");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM operation_logs WHERE operation_type='补充期初余额月份' AND target_id='8801'").get().count, 1);
    db.close();
    await browser.openDataCenter();
    await assertThreeRegions(browser);
    await browser.click(".backup-run-now");
    await browser.waitFor("document.querySelector('[data-region=\"backup-records\"]')?.textContent.includes('成功')");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.data-preflight-panel.danger'))"), false);
    assert.deepEqual(browser.exceptions, []);
    assert.equal(browser.consoleErrors.every((message) => /422 \(Unprocessable Entity\)/.test(message)), true, JSON.stringify(browser.consoleErrors));
  });
});

test("temporary data-center API failure renders an error region and reloads", async () => {
  await withBrowserScenario({}, async ({ browser }) => {
    await browser.login("boss", "123456");
    browser.failDataCenterOnce = true;
    await browser.openDataCenter();
    await assertThreeRegions(browser);
    assert.equal(await browser.evaluate("document.querySelector('.data-center-load-error')?.textContent.includes('数据中心加载失败')"), true);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.data-center-reload'))"), true);
    assert.deepEqual(browser.dataCenterResponses().map((response) => response.status), [503]);
    assert.deepEqual(browser.exceptions, []);
    await browser.click(".data-center-reload");
    await browser.waitFor("!document.querySelector('.data-center-load-error')");
    assert.deepEqual(browser.dataCenterResponses().map((response) => response.status), [503, 200]);
    assert.deepEqual(browser.exceptions, []);
  });
});

test("an unavailable managed backup path is reported without blocking the page", async () => {
  const prepareFilesystem = ({ tempRoot }) => {
    const parent = path.join(tempRoot, "backups");
    fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(path.join(parent, "full-excel"), "synthetic path conflict");
  };
  await withBrowserScenario({ prepareFilesystem }, async ({ browser }) => {
    await browser.login("boss", "123456");
    await browser.openDataCenter();
    await assertThreeRegions(browser);
    assert.equal(await browser.evaluate("document.querySelector('[data-region=\"backup-settings\"]')?.textContent.includes('路径无效')"), true);
    assert.deepEqual(browser.exceptions, []);
  });
});

test("explicit audit permission opens the page while an ordinary account has no entry", async () => {
  const prepareDatabase = (db) => {
    db.exec(`INSERT INTO users(username,display_name,role,password_hash,status,permission_override_enabled)
      SELECT 'audit-user','Audit User','teacher',password_hash,'active',1 FROM users WHERE username='boss';
      INSERT INTO user_page_permissions(user_id,permission_key,enabled)
      SELECT id,'audit',1 FROM users WHERE username='audit-user'`);
  };
  await withBrowserScenario({ prepareDatabase }, async ({ browser }) => {
    await browser.login("audit-user", "123456");
    await browser.openDataCenter();
    await assertThreeRegions(browser);
    assert.deepEqual(browser.exceptions, []);
  });
  await withBrowserScenario({}, async ({ browser }) => {
    await browser.login("teacher", "123456");
    await browser.click('.nav-btn[data-nav-group="settings"]');
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.nav-sub-btn[data-view=\"audit\"]'))"), false);
    assert.equal(browser.dataCenterResponses().length, 0);
    assert.deepEqual(browser.exceptions, []);
  });
});
