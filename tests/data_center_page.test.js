const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");
const { createTemplateBuffer } = require("../src/excel/import_service");
const { safeBackupFailure, serializeBackupFailure } = require("../src/backup/backup_failure");

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
  const baseEnv = { ...process.env, DATA_DIR: tempRoot, DB_PATH: database, SESSION_COOKIE_SECURE: "false", BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "", ...environment };
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
    await action({ browser: chrome.session, database, port, tempRoot, serverLogs: () => ({ stdout, stderr }) });
  } finally {
    if (chrome) {
      await chrome.session.close();
      if (chrome.child.exitCode == null) {
        const chromeExited = new Promise((resolve) => chrome.child.once("exit", resolve));
        chrome.child.kill("SIGTERM");
        await Promise.race([chromeExited, new Promise((resolve) => setTimeout(resolve, 3000))]);
      }
    }
    if (server.exitCode == null) {
      const serverExited = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await Promise.race([serverExited, new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
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
    assert.equal(await browser.evaluate("document.querySelector('[data-region=\"backup-settings\"]')?.textContent.includes('① 百度应用未配置')"), true);
    assert.equal(await browser.evaluate("document.querySelector('[data-region=\"backup-settings\"]')?.textContent.includes('② 百度授权未连接')"), true);
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
    assert.match(settingsText, /① 百度应用未配置/);
    assert.match(settingsText, /② 百度授权未连接/);
    assert.match(settingsText, /⑤ 计划状态自动备份未启用/);
    assert.match(settingsText, /百度网盘将保存未加密的完整 Excel 备份/);
    assert.match(settingsText, /尚未创建/);
    assert.equal(await browser.evaluate("document.querySelector('[data-region=\"backup-records\"]')?.textContent.includes('暂无备份记录')"), true);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.baidu-connect'))"), false);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.baidu-test'))"), false);
    assert.equal(await browser.evaluate("document.querySelector('.data-backup-remote-enabled')?.disabled"), false);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.baidu-disconnect'))"), false);
    assert.deepEqual(browser.exceptions, []);
    assert.deepEqual(browser.consoleErrors, []);
  });
});

test("Baidu schedule status shows every readiness and timing state in clear Chinese", async () => {
  await withBrowserScenario({}, async ({ browser, database, tempRoot }) => {
    await browser.login("boss", "123456"); await browser.openDataCenter(); await assertThreeRegions(browser);
    const statusText = () => browser.evaluate("document.querySelector('.baidu-schedule-state')?.textContent");
    const refresh = async (expected) => { await browser.click(".backup-refresh"); await browser.waitFor(`document.querySelector('.baidu-schedule-state')?.textContent === ${JSON.stringify(expected)}`); };
    assert.equal(await statusText(), "自动备份未启用");

    let db = new DatabaseSync(database);
    const put = db.prepare("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    for (const [key, value] of [["full_backup_remote_enabled", "1"], ["full_backup_remote_frequency", "daily"], ["full_backup_remote_time", "00:00"], ["full_backup_remote_plaintext_acknowledged", "0"]]) put.run(key, value);
    db.close();
    await refresh("百度应用尚未配置");

    const configured = await browser.evaluate(`fetch("/api/data-center/baidu/config",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({app_key:"PAGE-STATUS-KEY",app_secret:"PAGE-STATUS-SECRET"})}).then(async response=>({status:response.status,body:await response.json()}))`);
    assert.equal(configured.status, 200, JSON.stringify(configured.body));
    const unauthorizedSchedule = await browser.evaluate(`fetch("/api/data-center/baidu/schedule").then(response=>response.json())`);
    assert.equal(unauthorizedSchedule.state.reason, "not_authorized", JSON.stringify(unauthorizedSchedule));
    await refresh("百度网盘尚未授权");

    const secretDirectory = path.join(tempRoot, "backups", "full-excel", ".secrets");
    fs.writeFileSync(path.join(secretDirectory, "baidu-token.json"), JSON.stringify({ access_token: "STATUS-TOKEN", refresh_token: "STATUS-REFRESH", expires_at: Date.now() + 3600000 }));
    await refresh("尚未确认明文备份风险");

    const shanghaiDay = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", day: "2-digit" }).format(new Date()));
    const differentDay = shanghaiDay >= 1 && shanghaiDay <= 28 ? (shanghaiDay % 28) + 1 : 1;
    db = new DatabaseSync(database);
    const putWaiting = db.prepare("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    for (const [key, value] of [["full_backup_remote_plaintext_acknowledged", "1"], ["full_backup_remote_frequency", "monthly"], ["full_backup_remote_monthday", String(differentDay)]]) putWaiting.run(key, value);
    db.close();
    await refresh("等待计划时间");

    db = new DatabaseSync(database);
    const update = db.prepare("UPDATE settings SET value=? WHERE key=?");
    update.run("daily", "full_backup_remote_frequency"); update.run("00:00", "full_backup_remote_time");
    db.close();
    await refresh("可以执行");
    assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  });
});

test("Baidu configuration guide opens without exposing secret values", async () => {
  await withBrowserScenario({ environment: { BAIDU_APP_KEY: "PAGE-APP-KEY-SECRET", BAIDU_APP_SECRET: "PAGE-APP-SECRET", BAIDU_REDIRECT_URI: "http://127.0.0.1:5177/api/data-center/baidu/callback" } }, async ({ browser }) => {
    await browser.login("boss", "123456");
    await browser.openDataCenter();
    await assertThreeRegions(browser);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.baidu-connect'))"), false);
    assert.equal(await browser.evaluate("document.querySelector('.baidu-test')?.disabled"), true);
    assert.equal(await browser.evaluate("document.querySelector('.data-backup-remote-enabled')?.disabled"), false);
    const pageText = await browser.evaluate("document.body.textContent");
    assert.doesNotMatch(pageText, /PAGE-APP-KEY-SECRET|PAGE-APP-SECRET/);
    await browser.click(".baidu-guide-open");
    await browser.waitFor("Boolean(document.querySelector('.baidu-guide-modal'))");
    assert.equal(await browser.evaluate("document.querySelector('.baidu-guide-modal .baidu-connect')?.disabled"), false);
    const guide = await browser.evaluate("document.querySelector('.baidu-guide-modal')?.textContent");
    for (const step of ["第一步：填写百度应用信息", "第二步：连接百度网盘", "第三步：测试并启用", "SHA-256"]) assert.match(guide, new RegExp(step));
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.baidu-config-app-secret'))"), false);
    await browser.click(".baidu-config-edit");
    assert.equal(await browser.evaluate("document.querySelectorAll('.baidu-secret-form input').length"), 2);
    assert.equal(await browser.evaluate("document.querySelector('.baidu-guide-steps input[readonly]')?.value"), "http://127.0.0.1:5177/api/data-center/baidu/callback");
    assert.doesNotMatch(guide, /PAGE-APP-KEY-SECRET|PAGE-APP-SECRET/);
    assert.deepEqual(browser.exceptions, []);
    assert.deepEqual(browser.consoleErrors, []);
  });
});

test("authorized Baidu state enables testing but keeps automatic upload disabled until testing passes", async () => {
  const environment = { BAIDU_APP_KEY: "K", BAIDU_APP_SECRET: "S", BAIDU_REDIRECT_URI: "http://127.0.0.1:5177/api/data-center/baidu/callback" };
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

test("automatic upload remains disabled until the owner acknowledges plaintext risk", async () => {
  const prepareFilesystem = ({ tempRoot }) => {
    const directory = path.join(tempRoot, "backups", "full-excel", ".secrets");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "baidu-config.json"), JSON.stringify({ app_key: "K", app_secret: "S", redirect_uri: "http://127.0.0.1/callback", last_test_at: new Date().toISOString(), last_test_result: "success" }));
    fs.writeFileSync(path.join(directory, "baidu-token.json"), JSON.stringify({ access_token: "SYNTHETIC-TOKEN", refresh_token: "SYNTHETIC-REFRESH", expires_at: Date.now() + 3600000 }));
  };
  await withBrowserScenario({ prepareFilesystem }, async ({ browser }) => {
    await browser.login("boss", "123456"); await browser.openDataCenter(); await assertThreeRegions(browser);
    assert.equal(await browser.evaluate("document.querySelector('.data-backup-remote-plaintext-ack')?.checked"), false);
    assert.equal(await browser.evaluate("document.querySelector('.data-backup-remote-enabled')?.disabled"), false);
    await browser.click(".data-backup-remote-plaintext-ack");
    assert.equal(await browser.evaluate("document.querySelector('.data-backup-remote-plaintext-ack')?.checked"), true);
    assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  });
});

test("legacy remote records are labeled and cannot be downloaded as ordinary Excel", async () => {
  const prepareDatabase = (db) => db.prepare(`INSERT INTO backup_records(
    backup_type,filename,status,backup_format,format_version,trigger,retention_class,managed_relative_path,sha256,remote_status,remote_path
  ) VALUES ('manual','legacy.xlsx','success','full_data_excel',1,'manual','manual','backups/full-excel/legacy.xlsx','x','success',?)`).run(`/apps/liming-course-system/legacy.xlsx${".enc"}`);
  await withBrowserScenario({ prepareDatabase }, async ({ browser }) => {
    await browser.login("boss", "123456"); await browser.openDataCenter(); await assertThreeRegions(browser);
    assert.equal(await browser.evaluate("document.querySelector('[data-region=\"backup-records\"]')?.textContent.includes('旧版加密远端备份')"), true);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.backup-remote-download'))"), false);
    assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  });
});

test("owner saves one-time Baidu secrets through the wizard without page reflection", async () => {
  await withBrowserScenario({}, async ({ browser, database }) => {
    const appKey = "BROWSER-APP-KEY-NEVER-REFLECT"; const appSecret = "BROWSER-APP-SECRET-NEVER-REFLECT";
    await browser.login("boss", "123456"); await browser.openDataCenter(); await assertThreeRegions(browser); await browser.click(".baidu-guide-open"); await browser.waitFor("Boolean(document.querySelector('.baidu-secret-form'))");
    await browser.evaluate(`(() => { const values=${JSON.stringify({ appKey, appSecret })}; document.querySelector('.baidu-config-app-key').value=values.appKey; document.querySelector('.baidu-config-app-secret').value=values.appSecret; document.querySelector('.baidu-config-save').click(); })()`);
    await browser.waitFor("!document.querySelector('.baidu-guide-modal') && document.querySelector('.baidu-backup-card')?.textContent.includes('① 百度应用已配置') && document.querySelector('.baidu-backup-card')?.textContent.includes('② 百度授权未连接')");
    const body = await browser.evaluate("document.body.textContent"); assert.doesNotMatch(body, /BROWSER-APP-KEY-NEVER-REFLECT|BROWSER-APP-SECRET-NEVER-REFLECT/);
    const configFile = path.join(path.dirname(database), "backups", "full-excel", ".secrets", "baidu-config.json"); assert.equal(fs.existsSync(configFile), true); if (process.platform !== "win32") assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
    assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  });
});

test("manual backup accepts a global opening balance without requiring a month", async () => {
  const prepareDatabase = (db) => db.prepare("INSERT INTO student_opening_balances(id,student_name,grade,opening_actual_balance,opening_gift_balance,notes) VALUES (8801,'浏览器全局期初学生','初一',1000,200,'全局期初余额')").run();
  await withBrowserScenario({ prepareDatabase }, async ({ browser, database }) => {
    await browser.login("boss", "123456");
    await browser.openDataCenter();
    await assertThreeRegions(browser);
    await browser.click(".backup-run-now");
    await browser.waitFor("document.querySelector('[data-region=\"backup-records\"]')?.textContent.includes('成功')");
    const db = new DatabaseSync(database, { readOnly: true });
    const row = { ...db.prepare("SELECT student_name,grade,opening_actual_balance,opening_gift_balance,notes FROM student_opening_balances WHERE id=8801").get() };
    assert.deepEqual(row, { student_name: "浏览器全局期初学生", grade: "初一", opening_actual_balance: 1000, opening_gift_balance: 200, notes: "全局期初余额" });
    db.close();
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.data-preflight-panel.danger'))"), false);
    assert.deepEqual(browser.exceptions, []);
    assert.deepEqual(browser.consoleErrors, []);
  });
});

test("student profiles keep loading, empty and conflict states visible and refresh on re-entry", async () => {
  await withBrowserScenario({}, async ({ browser, database }) => {
    await browser.login("boss", "123456");
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('link[href*=\"styles.css\"],script[src*=\"app.js\"]')].map((item)=>item.getAttribute('href')||item.getAttribute('src'))"), [
      "/styles.css?v=20260724-teacher-rule-salary-display",
      "/app.js?v=20260724-teacher-rule-salary-display",
    ]);
    if (!await browser.evaluate("Boolean(document.querySelector('.nav-sub-btn[data-view=\"studentProfiles\"]'))")) await browser.click('.nav-btn[data-nav-group="students"]');
    await browser.waitFor("Boolean(document.querySelector('.nav-sub-btn[data-view=\"studentProfiles\"]'))");
    browser.stageConflictDelayOnce = 250;
    await browser.click('.nav-sub-btn[data-view="studentProfiles"]');
    await browser.waitFor("document.querySelector('.student-stage-conflict-check')?.dataset.status === 'loading'");
    assert.equal(await browser.evaluate("document.querySelector('.student-stage-conflict-refresh')?.disabled"), true);
    await browser.waitFor("Boolean(document.querySelector('.student-profile-table'))");
    await browser.waitFor("document.querySelector('.student-stage-conflict-check')?.textContent.includes('阶段冲突：未发现冲突')");
    assert.equal(await browser.evaluate("document.querySelector('.student-stage-conflict-refresh')?.textContent.trim()"), "重新检查");
    const firstCheckCount = browser.responses.filter((item) => /\/api\/student-grade-stages\/conflicts(?:\?.*)?$/.test(item.url)).length;
    browser.stageConflictDelayOnce = 150;
    await browser.click(".student-stage-conflict-refresh");
    await browser.waitFor("document.querySelector('.student-stage-conflict-check')?.dataset.status === 'loading'");
    await browser.waitFor("document.querySelector('.student-stage-conflict-check')?.dataset.status === 'success'");
    assert.equal(browser.responses.filter((item) => /\/api\/student-grade-stages\/conflicts(?:\?.*)?$/.test(item.url)).length, firstCheckCount + 1);
    const beforeReentry = browser.responses.filter((item) => /\/api\/student-grade-stages\/conflicts(?:\?.*)?$/.test(item.url)).length;
    await browser.click('.nav-btn[data-nav-group="teachers"]');
    await browser.waitFor("Boolean(document.querySelector('.nav-sub-btn[data-view=\"teacherProfiles\"]'))");
    await browser.click('.nav-sub-btn[data-view="teacherProfiles"]');
    await browser.waitFor("Boolean(document.querySelector('.teacher-profile-table'))");
    if (!await browser.evaluate("Boolean(document.querySelector('.nav-sub-btn[data-view=\"studentProfiles\"]'))")) await browser.click('.nav-btn[data-nav-group="students"]');
    await browser.waitFor("Boolean(document.querySelector('.nav-sub-btn[data-view=\"studentProfiles\"]'))");
    await browser.click('.nav-sub-btn[data-view="studentProfiles"]');
    await browser.waitFor("document.querySelector('.student-stage-conflict-check')?.dataset.status === 'success'");
    assert.equal(browser.responses.filter((item) => /\/api\/student-grade-stages\/conflicts(?:\?.*)?$/.test(item.url)).length, beforeReentry + 1);

    const db = new DatabaseSync(database);
    db.exec(`
      INSERT INTO students(id,name,grade,status) VALUES
        (8691,'合成多冲突学生甲','初三','在读'),
        (8692,'合成多冲突学生乙','高二','在读');
      INSERT INTO student_grade_stages(student_name,stage,start_date,end_date) VALUES
        ('合成多冲突学生甲','初三','2025-09-01','2026-08-31'),
        ('合成多冲突学生甲','高一','2026-08-01','2027-08-31'),
        ('合成多冲突学生乙','高二','2025-09-01','2026-08-31'),
        ('合成多冲突学生乙','高三','2026-08-31','2027-08-31');
    `);
    db.close();

    await browser.send("Page.reload", { ignoreCache: true });
    await browser.waitFor("Boolean(document.querySelector('.nav-btn[data-nav-group=\"students\"]'))");
    if (!await browser.evaluate("Boolean(document.querySelector('.nav-sub-btn[data-view=\"studentProfiles\"]'))")) await browser.click('.nav-btn[data-nav-group="students"]');
    await browser.waitFor("Boolean(document.querySelector('.nav-sub-btn[data-view=\"studentProfiles\"]'))");
    await browser.click('.nav-sub-btn[data-view="studentProfiles"]');
    await browser.waitFor("document.querySelector('.student-stage-conflict-check')?.textContent.includes('发现 2 名学生')");
    await browser.click(".student-stage-conflict-view");
    assert.equal(await browser.evaluate("document.querySelectorAll('.student-stage-conflict-record').length"), 2);
    assert.deepEqual(browser.exceptions, []);
    assert.deepEqual(browser.consoleErrors, []);
  });
});

test("student profile conflict failures are safe and retry recovers", async () => {
  await withBrowserScenario({}, async ({ browser }) => {
    await browser.login("boss", "123456");
    await browser.click('.nav-btn[data-nav-group="students"]');
    await browser.waitFor("Boolean(document.querySelector('.nav-sub-btn[data-view=\"studentProfiles\"]'))");
    browser.stageConflictResult = { status: 500, body: { error: "SQL internal stack token secret" } };
    await browser.click('.nav-sub-btn[data-view="studentProfiles"]');
    await browser.waitFor("document.querySelector('.student-stage-conflict-check')?.textContent.includes('阶段冲突检查失败：服务器处理失败')");
    let text = await browser.evaluate("document.querySelector('.student-stage-conflict-check')?.textContent");
    assert.doesNotMatch(text, /SQL|stack|token|undefined|Error|Session|Cookie/);
    assert.match(browser.consoleErrors.shift() || "", /500/);
    assert.equal(await browser.evaluate("document.querySelector('.student-stage-conflict-refresh')?.textContent.trim()"), "重试");
    await browser.click(".student-stage-conflict-refresh");
    await browser.waitFor("document.querySelector('.student-stage-conflict-check')?.textContent.includes('阶段冲突：未发现冲突')");

    browser.stageConflictResult = { status: 403, body: { error: "permission details must stay private" } };
    await browser.click(".student-stage-conflict-refresh");
    await browser.waitFor("document.querySelector('.student-stage-conflict-check')?.textContent.includes('阶段冲突检查失败：无权限查看')");
    text = await browser.evaluate("document.querySelector('.student-stage-conflict-check')?.textContent");
    assert.doesNotMatch(text, /permission details|undefined|Error/);
    assert.match(browser.consoleErrors.shift() || "", /403/);
    await browser.click(".student-stage-conflict-refresh");
    await browser.waitFor("document.querySelector('.student-stage-conflict-check')?.textContent.includes('阶段冲突：未发现冲突')");
    assert.deepEqual(browser.exceptions, []);
    assert.deepEqual(browser.consoleErrors, []);
  });
});

test("student conflict totals ignore filters and historical students are revealed with centered profile columns", async () => {
  const historicalName = "浏览器历史阶段冲突学生姓名较长用于换行验收";
  const prepareDatabase = (db) => db.exec(`
    INSERT INTO students(id,name,grade,status,left_at,notes) VALUES
      (8711,'${historicalName}','初三','离校','2026-06-30','备注保持左对齐'),
      (8712,'浏览器在读阶段冲突学生','高二','在读',NULL,'当前学生');
    INSERT INTO student_grade_stages(student_name,stage,start_date,end_date) VALUES
      ('${historicalName}','初三','2025-09-01','2026-08-31'),
      ('${historicalName}','高一','2026-08-01','2027-08-31'),
      ('浏览器在读阶段冲突学生','高二','2025-09-01','2026-08-31'),
      ('浏览器在读阶段冲突学生','高三','2026-08-31','2027-08-31');
  `);
  await withBrowserScenario({ prepareDatabase }, async ({ browser }) => {
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.login("boss", "123456");
    await browser.evaluate("localStorage.setItem('liming:include-inactive','0')");
    await browser.click('.nav-btn[data-nav-group="students"]');
    await browser.waitFor("Boolean(document.querySelector('.nav-sub-btn[data-view=\"studentProfiles\"]'))");
    await browser.click('.nav-sub-btn[data-view="studentProfiles"]');
    await browser.waitFor("document.querySelector('.student-stage-conflict-check')?.textContent.includes('发现 2 名学生')");

    await browser.evaluate(`(() => { const input=document.querySelector('input.profile-status-filter'); input.value='在读'; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await browser.waitFor("!document.querySelector('.student-profile-main-row[data-id=\"8711\"]')");
    assert.match(await browser.evaluate("document.querySelector('.student-stage-conflict-check')?.textContent"), /发现 2 名学生/);
    await browser.click(".student-stage-conflict-view");
    await browser.click('.student-stage-conflict-edit[data-student-id="8711"]');
    await browser.waitFor("Boolean(document.querySelector('.student-grade-stage-modal')) && Boolean(document.querySelector('.student-profile-main-row[data-id=\"8711\"]'))");
    await browser.waitFor("document.activeElement?.matches('.student-stage-card-conflict input')");
    assert.equal(await browser.evaluate("document.querySelector('.history-toggle-input')?.checked"), true);
    assert.equal(await browser.evaluate("document.querySelector('input.profile-status-filter')?.value"), "");
    assert.equal(await browser.evaluate("document.querySelector('input.profile-grade-filter')?.value"), "");

    const alignment = await browser.evaluate(`(() => {
      const row=document.querySelector('.student-profile-main-row[data-id="8711"]');
      const cell=row.querySelector('.student-name-cell');
      const wrapper=cell.querySelector('.student-name-with-conflict');
      const badge=wrapper.querySelector('.student-badge');
      const style=(element)=>getComputedStyle(element);
      const rect=(element)=>element.getBoundingClientRect();
      return {
        nameHead: style(document.querySelector('.student-name-head')).textAlign,
        nameCell: style(cell).textAlign,
        wrapperDisplay: style(wrapper).display,
        wrapperJustify: style(wrapper).justifyContent,
        badgeWhiteSpace: style(badge).whiteSpace,
        badgeInside: rect(badge).left >= rect(cell).left - 1 && rect(badge).right <= rect(cell).right + 1,
        grade: style(row.querySelector('.current-grade-cell')).textAlign,
        status: style(row.children[5]).textAlign,
        joined: style(row.children[6]).textAlign,
        left: style(row.children[7]).textAlign,
        notes: style(row.querySelector('.profile-notes-col')).textAlign,
        pageFits: document.body.scrollWidth <= innerWidth && document.querySelector('#app').scrollWidth <= innerWidth,
      };
    })()`);
    assert.deepEqual(alignment, {
      nameHead: "center", nameCell: "center", wrapperDisplay: "flex", wrapperJustify: "center",
      badgeWhiteSpace: "normal", badgeInside: true, grade: "center", status: "center",
      joined: "center", left: "center", notes: "left", pageFits: true,
    });

    await browser.click(".student-grade-stage-cancel");
    await browser.click('.student-profile-main-row[data-id="8711"] .student-name-cell');
    await browser.waitFor("Boolean(document.querySelector('.student-grade-stage-modal'))");
    await browser.click(".student-grade-stage-cancel");
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await browser.waitFor("window.innerWidth === 390");
    assert.equal(await browser.evaluate("document.body.scrollWidth <= window.innerWidth && document.querySelector('#app').scrollWidth <= window.innerWidth"), true);
    assert.deepEqual(browser.exceptions, []);
    assert.deepEqual(browser.consoleErrors, []);
  });
});

test("student profiles show stage conflicts, locate the editor, repair them and fit 390px", async () => {
  const prepareDatabase = (db) => db.exec(`
    INSERT INTO students(id,name,grade,status) VALUES (8701,'浏览器阶段冲突学生姓名较长用于窄屏验收','初三','在读');
    INSERT INTO student_grade_stages(student_name,stage,start_date,end_date) VALUES
      ('浏览器阶段冲突学生姓名较长用于窄屏验收','初三','2025-09-01','2026-08-31'),
      ('浏览器阶段冲突学生姓名较长用于窄屏验收','高一','2026-08-01','2027-08-31');
  `);
  await withBrowserScenario({ prepareDatabase }, async ({ browser }) => {
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.login("boss", "123456");
    await browser.click('.nav-btn[data-nav-group="students"]');
    await browser.waitFor("Boolean(document.querySelector('.nav-sub-btn[data-view=\"studentProfiles\"]'))");
    await browser.click('.nav-sub-btn[data-view="studentProfiles"]');
    await browser.waitFor("document.querySelector('.student-stage-conflict-banner')?.textContent.includes('发现 1 名学生')");
    assert.equal(await browser.evaluate("document.querySelectorAll('.student-stage-conflict-marker').length"), 1);
    await browser.click(".student-stage-conflict-view");
    await browser.waitFor("document.querySelector('.student-stage-conflict-modal')?.textContent.includes('初三') && document.querySelector('.student-stage-conflict-modal')?.textContent.includes('2026-08-01')");
    await browser.click(".student-stage-conflict-close");
    await browser.waitFor("!document.querySelector('.student-stage-conflict-modal') && document.activeElement?.classList.contains('student-stage-conflict-view')");
    await browser.click(".student-stage-conflict-view");
    await browser.click(".student-stage-conflict-edit");
    await browser.waitFor("document.querySelector('.student-grade-stage-modal')?.textContent.includes('浏览器阶段冲突学生姓名较长用于窄屏验收')");
    assert.equal(await browser.evaluate("document.querySelectorAll('.student-stage-card-conflict').length"), 2);
    await browser.evaluate(`(() => { const input=document.querySelector('.student-grade-stage-field[data-stage="高一"][data-field="start_date"]'); input.value='2026-09-01'; input.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('.student-grade-stage-save').click(); })()`);
    await browser.waitFor("!document.querySelector('.student-grade-stage-modal') && document.querySelector('.student-stage-conflict-check')?.textContent.includes('阶段冲突：未发现冲突')");
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await browser.waitFor("window.innerWidth === 390");
    assert.equal(await browser.evaluate("document.body.scrollWidth <= window.innerWidth && document.querySelector('#app').scrollWidth <= window.innerWidth"), true);
    assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  });
});

test("backup failure reason is readable and delete uses a non-password confirmation dialog", async () => {
  const failure = serializeBackupFailure(safeBackupFailure({ code: "BACKUP_DATA_PREFLIGHT_FAILED", details: { preflight: { issue_count: 1, issues: [{ code: "STUDENT_GRADE_STAGE_OVERLAP", label: "学生年级阶段时间冲突", count: 1, records: [{ student_id: 8801, student_name: "合成学生", stage_a: "初三", start_a: "2025-09-01", end_a: "2026-08-31", stage_b: "高一", start_b: "2026-08-01", end_b: "2027-08-31", overlap_start: "2026-08-01", overlap_end: "2026-08-31" }] }] } } }));
  const prepareDatabase = (db) => {
    db.prepare(`INSERT INTO backup_records(backup_type,filename,status,message,backup_format,format_version,trigger,retention_class,managed_relative_path,remote_status,pinned)
      VALUES ('manual','黎明教育_全量数据_合成失败.xlsx','failed',?,'full_data_excel',4,'manual','manual','backups/full-excel/missing.xlsx','not_configured',0)`).run(failure);
  };
  await withBrowserScenario({ prepareDatabase }, async ({ browser, database }) => {
    await browser.login("boss", "123456"); await browser.openDataCenter(); await assertThreeRegions(browser);
    const recordText = await browser.evaluate("document.querySelector('[data-region=\"backup-records\"]')?.textContent");
    assert.match(recordText, /本地备份失败/); assert.match(recordText, /合成学生的初三与高一阶段时间重叠/); assert.doesNotMatch(recordText, /undefined|Error/);
    await browser.click(".backup-delete");
    await browser.waitFor("Boolean(document.querySelector('.backup-delete-modal'))");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.backup-delete-modal input'))"), false);
    assert.match(await browser.evaluate("document.querySelector('.backup-delete-modal')?.textContent"), /确认删除这条备份吗|服务器本地/);
    await browser.click(".backup-delete-cancel");
    await browser.waitFor("!document.querySelector('.backup-delete-modal') && document.activeElement?.classList.contains('backup-delete')");
    let db = new DatabaseSync(database, { readOnly: true }); assert.equal(db.prepare("SELECT status FROM backup_records WHERE filename='黎明教育_全量数据_合成失败.xlsx'").get().status, "failed"); db.close();
    await browser.click(".backup-delete"); await browser.click(".backup-delete-confirm");
    await browser.waitFor("!document.querySelector('.backup-delete-modal')");
    assert.equal(browser.responses.filter((item) => /\/api\/data-center\/backups\/\d+$/.test(item.url) && item.status === 200).length, 1);
    db = new DatabaseSync(database, { readOnly: true });
    assert.equal(db.prepare("SELECT status FROM backup_records WHERE filename='黎明教育_全量数据_合成失败.xlsx'").get().status, "missing");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM operation_logs WHERE operation_type='删除全量数据备份'").get().count, 1); db.close();
    assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
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
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.baidu-guide-open'))"), true);
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

test("Qing login identity and browser form heuristics never populate App Key", async () => {
  await withBrowserScenario({}, async ({ browser }) => {
    await browser.login("boss", "123456"); await browser.openDataCenter(); await assertThreeRegions(browser); await browser.click(".baidu-guide-open"); await browser.waitFor("Boolean(document.querySelector('.baidu-config-app-key'))");
    const result = await browser.evaluate(`(() => { const key=document.querySelector('.baidu-config-app-key'); const secret=document.querySelector('.baidu-config-app-secret'); return { key:key.value, secret:secret.value, autocomplete:key.getAttribute('autocomplete'), name:key.name, type:key.type, login:document.body.textContent.includes('Qing') }; })()`);
    assert.equal(result.login, true); assert.equal(result.key, ""); assert.equal(result.secret, ""); assert.equal(result.autocomplete, "off"); assert.equal(result.type, "search"); assert.notEqual(result.name, "username");
    await browser.click(".baidu-guide-close"); await browser.click(".baidu-guide-open"); assert.equal(await browser.evaluate("document.querySelector('.baidu-config-app-key')?.value"), ""); assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  });
});

test("OAuth result markers are handled once and removed without losing other query or hash", async () => {
  await withBrowserScenario({}, async ({ browser, port }) => {
    await browser.login("boss", "123456");
    await browser.send("Page.navigate", { url: `http://127.0.0.1:${port}/?keep=1&baidu=connected&code=SECRET-CODE&state=SECRET-STATE#backup` });
    await browser.waitFor("document.querySelector('.toast')?.textContent.includes('百度网盘连接成功')");
    const clean = await browser.evaluate("({search:location.search,hash:location.hash,view:document.querySelector('#topbar')?.textContent})"); assert.equal(clean.search, "?keep=1"); assert.equal(clean.hash, "#backup"); assert.match(clean.view, /数据中心/);
    await browser.send("Page.reload"); await browser.waitFor("Boolean(document.querySelector('.nav-btn[data-nav-group=\"settings\"]'))"); assert.equal(await browser.evaluate("Boolean(document.querySelector('.toast'))"), false);
    for (const marker of ["failed", "denied"]) { await browser.send("Page.navigate", { url: `http://127.0.0.1:${port}/?keep=1&baidu=${marker}&code=X&state=Y#backup` }); await browser.waitFor("location.search === '?keep=1'"); assert.equal(await browser.evaluate("location.href.includes('code=') || location.href.includes('state=') || location.href.includes('baidu=')"), false); }
    assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  });
});

test("Baidu test refresh preserves dirty directory risk frequency and log options on success and failure", async () => {
  const prepareFilesystem = ({ tempRoot }) => { const directory = path.join(tempRoot, "backups", "full-excel", ".secrets"); fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, "baidu-config.json"), JSON.stringify({ app_key: "K", app_secret: "S", redirect_uri: "http://127.0.0.1/callback", last_test_at: new Date().toISOString(), last_test_result: "success" })); fs.writeFileSync(path.join(directory, "baidu-token.json"), JSON.stringify({ access_token: "SYNTHETIC", refresh_token: "SYNTHETIC-R", expires_at: Date.now() + 3600000 })); };
  await withBrowserScenario({ prepareFilesystem }, async ({ browser }) => {
    await browser.login("boss", "123456"); await browser.openDataCenter(); await assertThreeRegions(browser);
    await browser.evaluate(`(() => { const frequency=document.querySelector('.data-backup-remote-frequency'); frequency.value='manual'; frequency.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    assert.deepEqual(await browser.evaluate(`({time:document.querySelector('.remote-schedule-time').hidden,weekday:document.querySelector('.remote-weekday').hidden,monthday:document.querySelector('.remote-monthday').hidden})`), { time: true, weekday: true, monthday: true });
    const edit = async (directory) => browser.evaluate(`(() => { const set=(selector,value,checked=false)=>{const element=document.querySelector(selector); if(checked) element.checked=value; else element.value=value; element.dispatchEvent(new Event('input',{bubbles:true}));}; set('.data-backup-remote-directory',${JSON.stringify(directory)}); set('.data-backup-remote-plaintext-ack',true,true); set('.data-backup-remote-logs',false,true); set('.data-backup-remote-frequency','monthly'); set('.data-backup-remote-monthday','17'); return true; })()`);
    const assertDraft = async (directory) => assert.deepEqual(await browser.evaluate(`({directory:document.querySelector('.data-backup-remote-directory').value,ack:document.querySelector('.data-backup-remote-plaintext-ack').checked,logs:document.querySelector('.data-backup-remote-logs').checked,frequency:document.querySelector('.data-backup-remote-frequency').value,monthday:document.querySelector('.data-backup-remote-monthday').value,weekdayHidden:document.querySelector('.remote-weekday').hidden,monthdayHidden:document.querySelector('.remote-monthday').hidden})`), { directory, ack: true, logs: false, frequency: "monthly", monthday: "17", weekdayHidden: true, monthdayHidden: false });
    await edit("/apps/liming/custom-success"); browser.baiduTestResult = { status: 200, body: { ok: true, core_ok: true, cleanup_ok: true, cleanup: { complete: true }, steps: { authorization: true, connection: true, test_directory: true, file_upload: true, checksum_upload: true, file_metadata: true, checksum_metadata: true, file_download: true, checksum_download: true, integrity_check: true, test_delete_file: true, test_delete_checksum: true } } }; await browser.click(".baidu-test"); await browser.waitFor("document.querySelector('.toast')?.textContent.includes('均已通过')"); await assertDraft("/apps/liming/custom-success");
    await edit("/apps/liming/custom-failure"); browser.baiduTestResult = { status: 400, body: { error: "获取文件元信息失败：百度参数错误（错误码2）", code: "BAIDU_FILE_METADATA_FAILED", stage: "file_metadata", provider_code: "2", http_status: 200, cleanup: { complete: true }, steps: { authorization: true, connection: true, file_upload: true, checksum_upload: true } } }; await browser.click(".baidu-test"); await browser.waitFor("document.querySelector('.toast')?.textContent.includes('获取文件元信息失败：百度参数错误（错误码2）')"); await assertDraft("/apps/liming/custom-failure"); browser.consoleErrors = browser.consoleErrors.filter((message) => !/status of 400/.test(message)); assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  });
});

test("desktop sidebar is 208px with untruncated labels and 390px data center has no page overflow", async () => {
  await withBrowserScenario({}, async ({ browser }) => {
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await browser.login("boss", "123456");
    const desktop = await browser.evaluate(`(() => { const sidebar=document.querySelector('.sidebar'); const labels=[...document.querySelectorAll('.nav-label')]; return {width:Math.round(sidebar.getBoundingClientRect().width), clipped:labels.some((item)=>item.scrollWidth>item.clientWidth+1)}; })()`); assert.deepEqual(desktop, { width: 208, clipped: false });
    await browser.click(".sidebar-toggle"); await browser.waitFor("Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 72"); await browser.click(".sidebar-toggle"); await browser.waitFor("Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 208");
    await browser.openDataCenter(); await browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await browser.waitFor("window.innerWidth === 390"); assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true); await browser.send("Emulation.clearDeviceMetricsOverride"); assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  });
});

test("owner can inspect a safe invalid-role record and jump to the matching account", async () => {
  const prepareDatabase = (db) => db.exec(`
    INSERT INTO users(username,display_name,role,password_hash,status,permission_override_enabled)
      SELECT 'role-broken','待修复账号','老板',password_hash,'active',0 FROM users WHERE username='boss';
  `);
  await withBrowserScenario({ prepareDatabase }, async ({ browser }) => {
    await browser.login("boss", "123456"); await browser.openDataCenter(); await assertThreeRegions(browser);
    await browser.waitFor("document.querySelector('.data-preflight-panel')?.textContent.includes('账号角色关系无效')");
    assert.equal(await browser.evaluate("document.querySelector('.backup-run-now')?.disabled"), true);
    await browser.click(".data-preflight-view");
    await browser.waitFor("document.querySelector('.data-preflight-detail-modal')?.textContent.includes('待修复账号')");
    const details = await browser.evaluate("document.querySelector('.data-preflight-detail-modal')?.textContent");
    for (const value of ["账号记录ID", "role-broken", "待修复账号", "当前角色ID", "当前角色名称", "账号保存了错误的角色名称", "建议处理方式", "前往账号权限"]) assert.match(details, new RegExp(value));
    assert.doesNotMatch(details, /password_hash|access_token|refresh_token|PAGE-APP-SECRET|SYNTHETIC-TOKEN/i);
    assert.equal(browser.responses.some((item) => /\/api\/data-center\/preflight\/details$/.test(item.url) && item.status === 200), true);
    await browser.click(".preflight-account-link");
    await browser.waitFor("document.querySelector('#topbar')?.textContent.includes('账号权限') && Boolean(document.querySelector('.user-row.preflight-target[data-username=\"role-broken\"]'))");
    assert.equal(await browser.evaluate("document.activeElement?.closest('.user-row')?.dataset.username"), "role-broken");
    await browser.evaluate("(() => { const select=document.querySelector('.user-row.preflight-target .user-field[data-field=\"role\"]'); select.dataset.pendingTest='1'; select.value='owner'; select.dispatchEvent(new Event('change',{bubbles:true})); })()");
    await browser.waitFor("!document.querySelector('[data-pending-test]') && document.querySelector('.user-row.preflight-target .user-field[data-field=\"role\"]')?.value === 'owner'");
    await browser.openDataCenter(); await assertThreeRegions(browser);
    await browser.waitFor("!document.querySelector('.data-preflight-panel') && document.querySelector('.backup-run-now')?.disabled === false");
    assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  });
});

test("audit permission can inspect details without account-admin access and teacher has no route", async () => {
  const prepareDatabase = (db) => db.exec(`
    INSERT INTO users(username,display_name,role,password_hash,status,permission_override_enabled)
      SELECT 'role-broken','待修复账号','不存在角色',password_hash,'active',0 FROM users WHERE username='boss';
    INSERT INTO users(username,display_name,role,password_hash,status,permission_override_enabled)
      SELECT 'audit-user','Audit User','teacher',password_hash,'active',1 FROM users WHERE username='boss';
    INSERT INTO user_page_permissions(user_id,permission_key,enabled)
      SELECT id,'audit',1 FROM users WHERE username='audit-user';
  `);
  await withBrowserScenario({ prepareDatabase }, async ({ browser }) => {
    await browser.login("audit-user", "123456"); await browser.openDataCenter(); await assertThreeRegions(browser);
    await browser.click(".data-preflight-view");
    await browser.waitFor("document.querySelector('.data-preflight-detail-modal')?.textContent.includes('role-broken')");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.preflight-account-link'))"), false);
    assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  });
  await withBrowserScenario({ prepareDatabase }, async ({ browser }) => {
    await browser.login("teacher", "123456");
    await browser.click('.nav-btn[data-nav-group="settings"]');
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.nav-sub-btn[data-view=\"audit\"]'))"), false);
    assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  });
});

test("preflight detail request failure shows a safe retry state instead of doing nothing", async () => {
  const prepareDatabase = (db) => db.exec(`
    INSERT INTO users(username,display_name,role,password_hash,status)
      SELECT 'role-broken','待修复账号','不存在角色',password_hash,'active' FROM users WHERE username='boss';
  `);
  await withBrowserScenario({ prepareDatabase }, async ({ browser }) => {
    await browser.login("boss", "123456"); await browser.openDataCenter(); await assertThreeRegions(browser);
    browser.failPreflightDetailsOnce = true;
    await browser.click(".data-preflight-view");
    await browser.waitFor("document.querySelector('.data-preflight-detail-error')?.textContent.includes('问题详情加载失败')");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.data-preflight-detail-retry'))"), true);
    assert.equal(browser.consoleErrors.every((message) => /503|Failed to load resource/.test(message)), true);
    browser.consoleErrors.length = 0;
    await browser.click(".data-preflight-detail-retry");
    await browser.waitFor("document.querySelector('.data-preflight-detail-modal')?.textContent.includes('role-broken') && !document.querySelector('.data-preflight-detail-error')");
    assert.deepEqual(browser.exceptions, []);
    assert.deepEqual(browser.consoleErrors, []);
  });
});

test("custom Excel picker supports keyboard activation selection reselection and responsive layout", async () => {
  await withBrowserScenario({}, async ({ browser, tempRoot }) => {
    const firstName = "黎明教育_全量数据_带空格与很长很长很长很长的文件名.xlsx";
    const secondName = "重新选择_合成测试.xlsx";
    const first = path.join(tempRoot, firstName); const second = path.join(tempRoot, secondName);
    fs.writeFileSync(first, createTemplateBuffer()); fs.writeFileSync(second, createTemplateBuffer());
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate("window.dispatchEvent(new Event('resize'))");
    await browser.login("boss", "123456"); await browser.openDataCenter(); await assertThreeRegions(browser);
    assert.equal(await browser.evaluate("document.querySelector('.data-import-file-name')?.textContent.trim()"), "尚未选择文件");
    assert.equal(await browser.evaluate("document.querySelector('.data-import-file')?.getAttribute('accept').includes('.xlsx')"), true);
    await browser.evaluate("(() => { const input=document.querySelector('.data-import-file'); input.addEventListener('click',(event)=>{event.preventDefault();document.body.dataset.fileKeyboard='yes';},{once:true}); document.querySelector('.data-import-file-trigger').focus(); })()");
    await browser.evaluate("document.querySelector('.data-import-file-trigger').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}))");
    await browser.waitFor("document.body.dataset.fileKeyboard === 'yes'");
    await browser.setFileInputFiles("#data-import-file-input", [first]);
    await browser.waitFor(`document.querySelector('.data-import-file-name')?.textContent === ${JSON.stringify(firstName)}`);
    assert.equal(await browser.evaluate("document.querySelector('.data-import-file-trigger')?.textContent.trim()"), "重新选择");
    assert.equal(await browser.evaluate("document.querySelector('.data-import-file-name')?.title"), firstName);
    assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.data-import-file-name')).textOverflow"), "ellipsis");
    await browser.setFileInputFiles("#data-import-file-input", [second]);
    await browser.waitFor(`document.querySelector('.data-import-file-name')?.textContent === ${JSON.stringify(secondName)}`);
    await browser.click(".data-import-preview-button");
    await browser.waitFor("document.querySelector('.data-import-preview')?.textContent.includes('文件校验通过')");
    await browser.evaluate("backupState.error='合成预检失败'; backupState.importPreview=null; render()");
    await browser.waitFor("document.querySelector('[data-region=\"import-export\"]') && document.body.textContent.includes('合成预检失败')");
    assert.equal(await browser.evaluate("document.querySelector('.data-import-file-name')?.textContent"), secondName);

    const desktop = await browser.evaluate(`(() => { const cards=[...document.querySelectorAll('.data-backup-subcard')].map((node)=>node.getBoundingClientRect()); const controls=[...document.querySelectorAll('.local-backup-card .control')].map((node)=>node.getBoundingClientRect().height); return { cardCount:cards.length, topDelta:Math.abs(cards[0].top-cards[1].top), widthDelta:Math.abs(cards[0].width-cards[1].width), heightDelta:Math.max(...controls)-Math.min(...controls), overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth, encryption:Boolean(document.querySelector('[class*=encryption], [name*=encryption]')) }; })()`);
    assert.equal(desktop.cardCount, 2); assert.ok(desktop.topDelta <= 1); assert.ok(desktop.widthDelta <= 1); assert.ok(desktop.heightDelta <= 1); assert.equal(desktop.overflow, false); assert.equal(desktop.encryption, false);
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.evaluate("window.dispatchEvent(new Event('resize'))");
    const mobile = await browser.evaluate(`(() => { const cards=[...document.querySelectorAll('.data-backup-subcard')].map((node)=>node.getBoundingClientRect()); const picker=document.querySelector('.data-file-picker').getBoundingClientRect(); return { stacked:cards[1].top>cards[0].bottom, pickerWidth:picker.width, parentWidth:document.querySelector('.data-import-file-field').getBoundingClientRect().width, overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth }; })()`);
    assert.equal(mobile.stacked, true); assert.ok(mobile.pickerWidth <= mobile.parentWidth + 1); assert.equal(mobile.overflow, false);
    assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
  });
});
