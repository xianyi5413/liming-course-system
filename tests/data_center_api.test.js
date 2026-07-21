const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");

const root = path.resolve(__dirname, ".."); let tempRoot; let databasePath; let port; let server; let ownerCookie; let teacherCookie; let backupRecord;
async function freePort() { return await new Promise((resolve) => { const socket = net.createServer(); socket.listen(0, "127.0.0.1", () => { const value = socket.address().port; socket.close(() => resolve(value)); }); }); }
async function waitForServer() { for (let index = 0; index < 50; index += 1) { try { const response = await fetch(`http://127.0.0.1:${port}/api/version`); if (response.ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error("server did not start"); }
async function login(username) { const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "123456" }) }); assert.equal(response.status, 200); return response.headers.get("set-cookie").split(";")[0]; }

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-data-api-")); port = await freePort(); databasePath = path.join(tempRoot, "api.sqlite"); const cleanEnv = { ...process.env, DATA_DIR: tempRoot, DB_PATH: databasePath, BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "", BACKUP_ENCRYPTION_KEY: "" }; const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], { cwd: root, env: cleanEnv, encoding: "utf8" }); assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(databasePath); const passwordHash = db.prepare("SELECT password_hash FROM users WHERE username='boss'").get().password_hash; const addUser = db.prepare("INSERT INTO users(username,display_name,role,password_hash,status,permission_override_enabled) VALUES (?,?,?,?, 'active',?)"); addUser.run("audit-user", "Audit User", "teacher", passwordHash, 1); const auditUser = db.prepare("SELECT id FROM users WHERE username='audit-user'").get(); db.prepare("INSERT INTO user_page_permissions(user_id,permission_key,enabled) VALUES (?,'audit',1)").run(auditUser.id); db.close();
  server = spawn(process.execPath, [path.join(root, "src/server.js")], { cwd: root, env: { ...cleanEnv, PORT: String(port), SESSION_COOKIE_SECURE: "false" }, stdio: "ignore" }); await waitForServer(); ownerCookie = await login("boss"); teacherCookie = await login("teacher");
});
after(async () => {
  if (server && server.exitCode == null) {
    const exited = new Promise((resolve) => server.once("exit", resolve)); server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("anonymous requests cannot access the data center", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center`); assert.equal(response.status, 401); });
test("cross-site OAuth callback reaches one-time state validation without a session cookie", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/callback?code=synthetic&state=invalid`, { redirect: "manual" }); const result = await response.json(); assert.equal(response.status, 400); assert.match(result.error, /state/); assert.notEqual(response.status, 401); });
test("ordinary teacher cannot access full-data management", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center`, { headers: { cookie: teacherCookie } }); assert.equal(response.status, 403); });
test("owner can read the neutral initial data-center state", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center`, { headers: { cookie: ownerCookie } }); const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.settings.remote_status, "not_configured"); assert.equal(data.settings.encryption_status, "not_configured"); assert.equal(data.settings.local_storage_status, "not_created"); assert.equal(data.settings.enabled, false); });
test("all historical owner role values can read the data center", async () => { const db = new DatabaseSync(databasePath); try { for (const role of ["owner", "boss", "admin", "老板", "管理员"]) { db.prepare("UPDATE users SET role=? WHERE username='boss'").run(role); const cookie = await login("boss"); const response = await fetch(`http://127.0.0.1:${port}/api/data-center`, { headers: { cookie } }); assert.equal(response.status, 200, role); } } finally { db.prepare("UPDATE users SET role='owner' WHERE username='boss'").run(); db.close(); } });
test("an account with explicit audit permission can read the data center", async () => { const cookie = await login("audit-user"); const response = await fetch(`http://127.0.0.1:${port}/api/data-center`, { headers: { cookie } }); assert.equal(response.status, 200); });
test("owner creates and verifies a managed full Excel backup", async () => { const created = await fetch(`http://127.0.0.1:${port}/api/data-center/backups`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: "{}" }); const data = await created.json(); assert.equal(created.status, 201); backupRecord = data.record; assert.equal(backupRecord.backup_format, "full_data_excel"); assert.equal(backupRecord.status, "success"); const verified = await fetch(`http://127.0.0.1:${port}/api/data-center/backups/${backupRecord.id}/verify`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: "{}" }); assert.equal(verified.status, 200); });
test("managed backup download is private, no-store and parseable", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center/backups/${backupRecord.id}/download`, { headers: { cookie: ownerCookie } }); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/); assert.match(response.headers.get("content-disposition"), /attachment/); const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.subarray(0, 2).toString(), "PK"); });
test("legacy list endpoint remains available to authorized data-center users", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/backups`, { headers: { cookie: ownerCookie } }); const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.records.some((row) => row.id === backupRecord.id), true); });
test("Baidu status endpoint returns configuration booleans without secrets or tokens", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/status`, { headers: { cookie: ownerCookie } });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(data.missing_items, ["BAIDU_APP_KEY", "BAIDU_APP_SECRET", "BAIDU_REDIRECT_URI", "BACKUP_ENCRYPTION_KEY"]);
  assert.equal(data.callback_route, "/api/data-center/baidu/callback");
  assert.equal(data.token_status, "not_configured");
  assert.doesNotMatch(JSON.stringify(data), /access_token|refresh_token|password_hash/i);
});
test("remote backup cannot be enabled until all four server secrets are configured", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/data-center/settings`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ remote_enabled: true }) });
  const data = await response.json();
  assert.equal(response.status, 400);
  assert.equal(data.code, "BAIDU_CONFIGURATION_INCOMPLETE");
  assert.equal(data.baidu.app_secret_configured, false);
});
test("blank legacy opening-balance month passes preflight without inference or mutation", async () => {
  const db = new DatabaseSync(databasePath);
  db.prepare("INSERT INTO student_opening_balances(id,month_key,student_name,grade,opening_actual_balance,opening_gift_balance,notes) VALUES (9901,'','接口缺月学生','初一',100,20,'来源 2026年2月.xlsx')").run();
  db.close();

  const response = await fetch(`http://127.0.0.1:${port}/api/data-center/preflight`, { headers: { cookie: ownerCookie } });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.issues.some((item) => /OPENING_BALANCE_MONTH/.test(item.code)), false);
  const checked = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(checked.prepare("SELECT month_key FROM student_opening_balances WHERE id=9901").get().month_key, "");
  checked.close();
});
test("new opening balances require an explicit month and normalize only user-entered YYYY-MM", async () => {
  const missing = await fetch(`http://127.0.0.1:${port}/api/opening-balances`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ student_name: "新期初学生", grade: "初一", opening_actual_balance: 10, opening_gift_balance: 0 }) });
  assert.equal(missing.status, 400);
  const created = await fetch(`http://127.0.0.1:${port}/api/opening-balances`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ month_key: "2026-06", student_name: "新期初学生", grade: "初一", opening_actual_balance: 10, opening_gift_balance: 0 }) });
  const result = await created.json();
  assert.equal(created.status, 201);
  assert.equal(result.row.month_key, "2026-06-01");
});

test("owner-only one-time Baidu configuration is reauthenticated, private and clearable", async () => {
  const secret = "NEVER-REFLECT-APP-SECRET"; const encryptionKey = Buffer.alloc(32, 9).toString("base64");
  const ordinary = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/config`, { method: "PUT", headers: { cookie: teacherCookie, "content-type": "application/json" }, body: JSON.stringify({ app_key: "APP", app_secret: secret, encryption_key: encryptionKey, password: "123456", confirmation: "保存百度配置" }) });
  assert.equal(ordinary.status, 403);
  const wrongPassword = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/config`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ app_key: "APP", app_secret: secret, encryption_key: encryptionKey, password: "wrong", confirmation: "保存百度配置" }) });
  assert.equal(wrongPassword.status, 401);
  const saved = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/config`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ app_key: "APP", app_secret: secret, encryption_key: encryptionKey, password: "123456", confirmation: "保存百度配置" }) });
  const result = await saved.json(); assert.equal(saved.status, 200); assert.equal(result.status.oauth_configured, true); assert.equal(result.status.encryption_configured, true); assert.equal(result.status.redirect_uri, `http://127.0.0.1:${port}/api/data-center/baidu/callback`);
  assert.equal(JSON.stringify(result).includes("NEVER-REFLECT"), false); assert.equal(JSON.stringify(result).includes(encryptionKey), false);
  const filename = path.join(tempRoot, "backups", "full-excel", ".secrets", "baidu-config.json"); assert.equal(fs.existsSync(filename), true); if (process.platform !== "win32") assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  const beforeAuthorization = await fetch(`http://127.0.0.1:${port}/api/data-center/settings`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ remote_enabled: true }) }); const beforeAuthorizationResult = await beforeAuthorization.json(); assert.equal(beforeAuthorization.status, 400); assert.equal(beforeAuthorizationResult.code, "BAIDU_AUTHORIZATION_REQUIRED");
  fs.writeFileSync(path.join(path.dirname(filename), "baidu-token.json"), JSON.stringify({ access_token: "SYNTHETIC-ONLY", refresh_token: "SYNTHETIC-ONLY", expires_at: Date.now() + 3600000 }), { mode: 0o600 });
  const beforeTest = await fetch(`http://127.0.0.1:${port}/api/data-center/settings`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ remote_enabled: true }) }); const beforeTestResult = await beforeTest.json(); assert.equal(beforeTest.status, 400); assert.equal(beforeTestResult.code, "BAIDU_CONNECTION_TEST_REQUIRED");
  const db = new DatabaseSync(databasePath, { readOnly: true }); const logs = JSON.stringify(db.prepare("SELECT operation_content,extra_json FROM operation_logs WHERE operation_type='保存百度网盘配置'").all()); db.close(); assert.equal(logs.includes("NEVER-REFLECT"), false); assert.equal(logs.includes(encryptionKey), false);
  const guide = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/key-custody.txt`, { headers: { cookie: ownerCookie } }); const guideText = await guide.text(); assert.equal(guide.status, 200); assert.equal(guideText.includes("NEVER-REFLECT"), false); assert.equal(guideText.includes(encryptionKey), false);
  const badClear = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/config`, { method: "DELETE", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ password: "123456", confirmation: "wrong" }) }); assert.equal(badClear.status, 400);
  const cleared = await fetch(`http://127.0.0.1:${port}/api/data-center/baidu/config`, { method: "DELETE", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ password: "123456", confirmation: "清除百度配置" }) }); const clearedResult = await cleared.json(); assert.equal(cleared.status, 200); assert.equal(clearedResult.status.oauth_configured, false); assert.equal(fs.existsSync(filename), false);
});
