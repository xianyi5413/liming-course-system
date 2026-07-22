const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const { verifyFullData } = require("../src/excel/full_backup");

const root = path.resolve(__dirname, ".."); let tempRoot; let databasePath; let port; let server; let serverEnvironment; let ownerCookie; let teacherCookie; let backupRecord;
async function freePort() { return await new Promise((resolve) => { const socket = net.createServer(); socket.listen(0, "127.0.0.1", () => { const value = socket.address().port; socket.close(() => resolve(value)); }); }); }
async function waitForServer() { for (let index = 0; index < 50; index += 1) { try { const response = await fetch(`http://127.0.0.1:${port}/api/version`); if (response.ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error("server did not start"); }
async function login(username) { const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "123456" }) }); assert.equal(response.status, 200); return response.headers.get("set-cookie").split(";")[0]; }
async function restartServer() {
  if (server && server.exitCode == null) {
    const exited = new Promise((resolve) => server.once("exit", resolve)); server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  server = spawn(process.execPath, [path.join(root, "src/server.js")], { cwd: root, env: serverEnvironment, stdio: "ignore" });
  await waitForServer(); ownerCookie = await login("boss"); teacherCookie = await login("teacher");
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-data-api-")); port = await freePort(); databasePath = path.join(tempRoot, "api.sqlite"); const cleanEnv = { ...process.env, DATA_DIR: tempRoot, DB_PATH: databasePath, BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "" }; const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], { cwd: root, env: cleanEnv, encoding: "utf8" }); assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(databasePath); const passwordHash = db.prepare("SELECT password_hash FROM users WHERE username='boss'").get().password_hash; const addUser = db.prepare("INSERT INTO users(username,display_name,role,password_hash,status,permission_override_enabled) VALUES (?,?,?,?, 'active',?)"); addUser.run("audit-user", "Audit User", "teacher", passwordHash, 1); const auditUser = db.prepare("SELECT id FROM users WHERE username='audit-user'").get(); db.prepare("INSERT INTO user_page_permissions(user_id,permission_key,enabled) VALUES (?,'audit',1)").run(auditUser.id); db.close();
  serverEnvironment = { ...cleanEnv, PORT: String(port), SESSION_COOKIE_SECURE: "false" };
  await restartServer();
});
after(async () => {
  if (server && server.exitCode == null) {
    const exited = new Promise((resolve) => server.once("exit", resolve)); server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("anonymous requests cannot access the data center", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center`); assert.equal(response.status, 401); });
test("cross-site OAuth callback converts invalid state to a safe one-time result marker", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/callback?code=synthetic&state=invalid`, { redirect: "manual" }); assert.equal(response.status, 302); assert.equal(response.headers.get("location"), "/?baidu=failed"); assert.notEqual(response.status, 401); });
test("ordinary teacher cannot access full-data management", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center`, { headers: { cookie: teacherCookie } }); assert.equal(response.status, 403); });
test("owner can read the neutral initial data-center state", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center`, { headers: { cookie: ownerCookie } }); const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.settings.remote_status, "not_configured"); assert.equal(data.settings.remote_plaintext_acknowledged, false); assert.equal(data.settings.local_storage_status, "not_created"); assert.equal(data.settings.enabled, false); });
test("all historical owner role values can read the data center and preflight details", async () => { const db = new DatabaseSync(databasePath); try { for (const role of ["owner", "boss", "admin", "老板", "管理员"]) { db.prepare("UPDATE users SET role=? WHERE username='boss'").run(role); const cookie = await login("boss"); const response = await fetch(`http://127.0.0.1:${port}/api/data-center`, { headers: { cookie } }); assert.equal(response.status, 200, role); const details = await fetch(`http://127.0.0.1:${port}/api/data-center/preflight/details`, { headers: { cookie } }); assert.equal(details.status, 200, role); } } finally { db.prepare("UPDATE users SET role='owner' WHERE username='boss'").run(); db.close(); } });
test("an account with explicit audit permission can read the data center", async () => { const cookie = await login("audit-user"); const response = await fetch(`http://127.0.0.1:${port}/api/data-center`, { headers: { cookie } }); assert.equal(response.status, 200); });
test("preflight detail and CSV expose safe role diagnostics only to data-center managers", async () => {
  const db = new DatabaseSync(databasePath); const passwordHash = db.prepare("SELECT password_hash FROM users WHERE username='boss'").get().password_hash;
  const inserted = db.prepare("INSERT INTO users(username,display_name,role,password_hash,status) VALUES ('broken-role','角色异常账号','老板',?,'active')").run(passwordHash); db.close();
  const detailsResponse = await fetch(`http://127.0.0.1:${port}/api/data-center/preflight/details`, { headers: { cookie: ownerCookie } }); const details = await detailsResponse.json();
  assert.equal(detailsResponse.status, 200); const issue = details.issues.find((item) => item.code === "ACCOUNT_ROLE_INVALID"); const record = issue.records.find((item) => Number(item.record_id) === Number(inserted.lastInsertRowid));
  assert.deepEqual({ username: record.username, display_name: record.display_name, current_role_code: record.current_role_code, invalid_reason: record.invalid_reason, target_view: record.target_view }, { username: "broken-role", display_name: "角色异常账号", current_role_code: "老板", invalid_reason: "账号保存了错误的角色名称", target_view: "userAdmin" });
  assert.match(record.suggestion, /账号权限/); assert.doesNotMatch(JSON.stringify(details), /password_hash|access_token|refresh_token|app_secret|cookie|session/i);
  const single = await fetch(`http://127.0.0.1:${port}/api/data-center/preflight/issues/ACCOUNT_ROLE_INVALID/records/${inserted.lastInsertRowid}`, { headers: { cookie: ownerCookie } }); assert.equal(single.status, 200);
  const missing = await fetch(`http://127.0.0.1:${port}/api/data-center/preflight/issues/ACCOUNT_ROLE_INVALID/records/999999`, { headers: { cookie: ownerCookie } }); assert.equal(missing.status, 404);
  const teacher = await fetch(`http://127.0.0.1:${port}/api/data-center/preflight/details`, { headers: { cookie: teacherCookie } }); assert.equal(teacher.status, 403);
  const auditCookie = await login("audit-user"); const audit = await fetch(`http://127.0.0.1:${port}/api/data-center/preflight/details`, { headers: { cookie: auditCookie } }); assert.equal(audit.status, 200);
  const csvResponse = await fetch(`http://127.0.0.1:${port}/api/data-center/preflight.csv`, { headers: { cookie: ownerCookie } }); const csv = await csvResponse.text(); assert.equal(csvResponse.status, 200);
  for (const value of ["账号", "姓名", "当前角色", "错误原因", "处理建议", "broken-role", "账号保存了错误的角色名称"]) assert.match(csv, new RegExp(value)); assert.doesNotMatch(csv, /password_hash|access_token|app_secret/i);
  const repaired = new DatabaseSync(databasePath); repaired.prepare("UPDATE users SET role='owner' WHERE id=?").run(inserted.lastInsertRowid); repaired.close();
  const rechecked = await fetch(`http://127.0.0.1:${port}/api/data-center/preflight`, { headers: { cookie: ownerCookie } }); const result = await rechecked.json(); assert.equal(rechecked.status, 200); assert.equal(result.ok, true);
});
test("owner creates and verifies a managed full Excel backup", async () => { const created = await fetch(`http://127.0.0.1:${port}/api/data-center/backups`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: "{}" }); const data = await created.json(); assert.equal(created.status, 201); backupRecord = data.record; assert.equal(backupRecord.backup_format, "full_data_excel"); assert.equal(backupRecord.status, "success"); const verified = await fetch(`http://127.0.0.1:${port}/api/data-center/backups/${backupRecord.id}/verify`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: "{}" }); assert.equal(verified.status, 200); });
test("managed backup download is private, no-store and parseable", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center/backups/${backupRecord.id}/download`, { headers: { cookie: ownerCookie } }); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/); assert.match(response.headers.get("content-disposition"), /attachment/); const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.subarray(0, 2).toString(), "PK"); });
test("legacy list endpoint remains available to authorized data-center users", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/backups`, { headers: { cookie: ownerCookie } }); const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.records.some((row) => row.id === backupRecord.id), true); });
test("Baidu status endpoint returns configuration booleans without secrets or tokens", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/status`, { headers: { cookie: ownerCookie } });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(data.missing_items, ["BAIDU_APP_KEY", "BAIDU_APP_SECRET", "BAIDU_REDIRECT_URI"]);
  assert.equal(data.callback_route, "/api/data-center/baidu/callback");
  assert.equal(data.token_status, "not_configured");
  assert.doesNotMatch(JSON.stringify(data), /access_token|refresh_token|password_hash/i);
});
test("manual full export defaults to logs and supports a request-only exclusion", async () => {
  const included = await fetch(`http://127.0.0.1:${port}/api/data-center/export.xlsx`, { headers: { cookie: ownerCookie } }); const includedWorkbook = verifyFullData(Buffer.from(await included.arrayBuffer()));
  const excluded = await fetch(`http://127.0.0.1:${port}/api/data-center/export.xlsx?include_operation_logs=0`, { headers: { cookie: ownerCookie } }); const excludedWorkbook = verifyFullData(Buffer.from(await excluded.arrayBuffer()));
  assert.equal(included.status, 200); assert.equal(includedWorkbook.operation_logs_included, true); assert.ok(includedWorkbook.data.operation_logs.length > 0); assert.equal(excluded.status, 200); assert.equal(excludedWorkbook.operation_logs_included, false); assert.equal(excludedWorkbook.data.operation_logs.length, 0);
});
test("local and remote operation-log settings have independent defaults and validation", async () => {
  const initial = await (await fetch(`http://127.0.0.1:${port}/api/data-center`, { headers: { cookie: ownerCookie } })).json(); assert.equal(initial.settings.local_include_operation_logs, false); assert.equal(initial.settings.remote_include_operation_logs, true); assert.equal(initial.settings.remote_frequency, "weekly");
  const local = await fetch(`http://127.0.0.1:${port}/api/data-center/settings`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ local_include_operation_logs: true, remote_include_operation_logs: false }) }); assert.equal(local.status, 200);
  const afterLocal = await local.json(); assert.equal(afterLocal.settings.remote_include_operation_logs, true);
  const remote = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/settings`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ remote_include_operation_logs: false, remote_frequency: "monthly", remote_monthday: 28, remote_directory: "/apps/liming-course-system", local_include_operation_logs: false }) }); assert.equal(remote.status, 200);
  const saved = await remote.json(); assert.equal(saved.settings.local_include_operation_logs, true); assert.equal(saved.settings.remote_include_operation_logs, false); assert.equal(saved.settings.remote_frequency, "monthly");
  const invalid = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/settings`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ remote_monthday: 29, remote_directory: "/outside" }) }); assert.equal(invalid.status, 400);
});
test("remote backup cannot be enabled until the three application settings are configured", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/settings`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ remote_enabled: true }) });
  const data = await response.json();
  assert.equal(response.status, 400);
  assert.equal(data.code, "BAIDU_CONFIGURATION_INCOMPLETE");
  assert.equal(data.baidu.app_secret_configured, false);
});
test("explicit data-center manager reaches Baidu configuration validation while ordinary teacher is forbidden", async () => {
  const auditCookie = await login("audit-user"); const manager = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/config`, { method: "PUT", headers: { cookie: auditCookie, "content-type": "application/json" }, body: JSON.stringify({ app_key: "", app_secret: "" }) }); const managerResult = await manager.json(); assert.equal(manager.status, 400, JSON.stringify(managerResult)); assert.equal(managerResult.code, "BAIDU_CONFIGURATION_INVALID");
  const ordinary = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/config`, { method: "PUT", headers: { cookie: teacherCookie, "content-type": "application/json" }, body: JSON.stringify({ app_key: "K", app_secret: "S" }) }); assert.equal(ordinary.status, 403);
});
test("global opening balance passes preflight and the persisted table has no month column", async () => {
  const db = new DatabaseSync(databasePath);
  db.prepare("INSERT INTO student_opening_balances(id,student_name,grade,opening_actual_balance,opening_gift_balance,notes) VALUES (9901,'接口全局学生','初一',100,20,'全局期初')").run();
  db.close();

  const response = await fetch(`http://127.0.0.1:${port}/api/data-center/preflight`, { headers: { cookie: ownerCookie } });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.issues.some((item) => /OPENING_BALANCE/.test(item.code)), false);
  const checked = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(checked.prepare("PRAGMA table_info(student_opening_balances)").all().some((column) => column.name === "month_key"), false);
  checked.close();
});
test("opening-balance API creates without month, ignores legacy month and rejects duplicate students", async () => {
  const createdWithoutMonth = await fetch(`http://127.0.0.1:${port}/api/opening-balances`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ student_name: "新期初学生", grade: "初一", opening_actual_balance: 10, opening_gift_balance: 0 }) });
  const first = await createdWithoutMonth.json();
  assert.equal(createdWithoutMonth.status, 201);
  assert.equal(Object.prototype.hasOwnProperty.call(first.row, "month_key"), false);
  const created = await fetch(`http://127.0.0.1:${port}/api/opening-balances`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ month_key: "2026-06", student_name: "新期初学生", grade: "初一", opening_actual_balance: 10, opening_gift_balance: 0 }) });
  const result = await created.json();
  assert.equal(created.status, 409);
  assert.equal(result.error, "该学生已存在期初余额，请直接编辑原记录。");
  const legacy = await fetch(`http://127.0.0.1:${port}/api/opening-balances`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ month_key: "2026-06", student_name: "兼容旧请求学生", grade: "初一", opening_actual_balance: 20, opening_gift_balance: 0 }) });
  const legacyResult = await legacy.json();
  assert.equal(legacy.status, 201);
  assert.deepEqual(legacyResult.deprecated_fields, ["month_key"]);
  assert.equal(Object.prototype.hasOwnProperty.call(legacyResult.row, "month_key"), false);
  const queried = await fetch(`http://127.0.0.1:${port}/api/opening-balances?month_key=2027-01-01`, { headers: { cookie: ownerCookie } });
  const queriedResult = await queried.json();
  assert.equal(queried.status, 200);
  assert.deepEqual(queriedResult.deprecated_fields, ["month_key"]);
  assert.equal(queriedResult.opening_balances.some((row) => row.student_name === "新期初学生"), true);
});

test("global opening balance remains the single base for cumulative February March and June balances", async () => {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    INSERT INTO students(id,name,grade,status) VALUES (9951,'余额回归学生','初一','在读');
    INSERT INTO teachers(id,name,status) VALUES (9951,'余额回归老师','在职');
    INSERT INTO student_opening_balances(id,student_name,grade,opening_actual_balance,opening_gift_balance,notes) VALUES (9951,'余额回归学生','初一',1000,100,'全局起点');
    INSERT INTO recharge_records(id,student_name,grade,cur_recharge,cur_gift,recharge_date,notes,source,month_key) VALUES
      (9951,'余额回归学生','初一',500,50,'2026-02-10','二月现金与赠送','manual','2026-02-01'),
      (9952,'余额回归学生','初一',200,0,'2026-03-10','跨月充值','manual','2026-03-01');
    INSERT INTO lessons(id,teacher_name,date,lesson_status,time_slot,classroom,grade,subject,student_names,notes,course_status,status,teacher_salary,teacher_salary_source,month_key,sort_order) VALUES
      (9951,'余额回归老师','2026-02-08','上课','09:00-11:00','A1','初一','数学','余额回归学生','单节覆盖','已上','已上',200,'manual','2026-02-01',1),
      (9952,'余额回归老师','2026-03-08','请假','09:00-11:00','A1','初一','数学','余额回归学生','请假不收费','请假','请假',0,'auto','2026-03-01',1),
      (9953,'余额回归老师','2026-06-08','试听','09:00-11:00','A1','初一','数学','余额回归学生','试听不收费','试听','试听',0,'auto','2026-06-01',1);
    INSERT INTO student_pricing(id,student_name,grade,subject,student_names,custom_price,notes) VALUES (9951,'余额回归学生','初一','数学','余额回归学生',120,'学生单价规则');
    INSERT INTO fee_overrides(lesson_id,student_name,unit_price) VALUES (9951,'余额回归学生',100);
  `);
  db.close();
  const summary = async (month) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap?month=${month}`, { headers: { cookie: ownerCookie } });
    const data = await response.json(); assert.equal(response.status, 200);
    const row = data.derived.student_summary_to_date.find((item) => item.student_name === "余额回归学生");
    assert.ok(row, month); return row;
  };
  const february = await summary("2026-02-01");
  const march = await summary("2026-03-01");
  const june = await summary("2026-06-01");
  assert.deepEqual([february.actual_balance, february.gift_balance], [1400, 150]);
  assert.deepEqual([march.actual_balance, march.gift_balance], [1600, 150]);
  assert.deepEqual([june.actual_balance, june.gift_balance], [1600, 150]);
});

test("data-center manager can save one-time Baidu configuration without secondary password and it remains private and clearable", async () => {
  const secret = "NEVER-REFLECT-APP-SECRET";
  const ordinary = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/config`, { method: "PUT", headers: { cookie: teacherCookie, "content-type": "application/json" }, body: JSON.stringify({ app_key: "APP", app_secret: secret }) });
  assert.equal(ordinary.status, 403);
  const saved = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/config`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ app_key: "APP", app_secret: secret }) });
  const result = await saved.json(); assert.equal(saved.status, 200); assert.equal(result.status.oauth_configured, true); assert.equal(result.status.redirect_uri, `http://127.0.0.1:${port}/api/data-center/baidu/callback`);
  assert.equal(JSON.stringify(result).includes("NEVER-REFLECT"), false);
  const filename = path.join(tempRoot, "backups", "full-excel", ".secrets", "baidu-config.json"); assert.equal(fs.existsSync(filename), true); if (process.platform !== "win32") assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  const beforeAuthorization = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/settings`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ remote_enabled: true }) }); const beforeAuthorizationResult = await beforeAuthorization.json(); assert.equal(beforeAuthorization.status, 400); assert.equal(beforeAuthorizationResult.code, "BAIDU_AUTHORIZATION_REQUIRED");
  fs.writeFileSync(path.join(path.dirname(filename), "baidu-token.json"), JSON.stringify({ access_token: "SYNTHETIC-ONLY", refresh_token: "SYNTHETIC-ONLY", expires_at: Date.now() + 3600000 }), { mode: 0o600 });
  const beforeTest = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/settings`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ remote_enabled: true }) }); const beforeTestResult = await beforeTest.json(); assert.equal(beforeTest.status, 400); assert.equal(beforeTestResult.code, "BAIDU_CONNECTION_TEST_REQUIRED");
  const storedConfig = JSON.parse(fs.readFileSync(filename, "utf8")); storedConfig.last_test_at = new Date().toISOString(); storedConfig.last_test_result = "success"; fs.writeFileSync(filename, JSON.stringify(storedConfig), { mode: 0o600 });
  await restartServer();
  const withoutRiskAcknowledgment = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/settings`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ remote_enabled: true }) }); const riskResult = await withoutRiskAcknowledgment.json(); assert.equal(withoutRiskAcknowledgment.status, 400); assert.equal(riskResult.code, "BAIDU_PLAINTEXT_RISK_ACK_REQUIRED");
  const enabled = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/settings`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ remote_enabled: true, remote_plaintext_acknowledged: true }) }); const enabledResult = await enabled.json(); assert.equal(enabled.status, 200); assert.equal(enabledResult.settings.remote_enabled, true); assert.equal(enabledResult.settings.remote_plaintext_acknowledged, true);
  const db = new DatabaseSync(databasePath, { readOnly: true }); const logs = JSON.stringify(db.prepare("SELECT operation_content,extra_json FROM operation_logs WHERE operation_type='保存百度网盘配置'").all()); db.close(); assert.equal(logs.includes("NEVER-REFLECT"), false);
  const obsoleteGuide = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/key-custody.txt`, { headers: { cookie: ownerCookie } }); assert.equal(obsoleteGuide.status, 404);
  const badClear = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/config`, { method: "DELETE", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ password: "123456", confirmation: "wrong" }) }); assert.equal(badClear.status, 400);
  const cleared = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/config`, { method: "DELETE", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ password: "123456", confirmation: "清除百度配置" }) }); const clearedResult = await cleared.json(); assert.equal(cleared.status, 200); assert.equal(clearedResult.status.oauth_configured, false); assert.equal(fs.existsSync(filename), false);
});
