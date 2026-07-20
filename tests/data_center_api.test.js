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
test("ordinary teacher cannot access full-data management", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center`, { headers: { cookie: teacherCookie } }); assert.equal(response.status, 403); });
test("owner can read the neutral initial data-center state", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center`, { headers: { cookie: ownerCookie } }); const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.settings.remote_status, "not_configured"); assert.equal(data.settings.encryption_status, "not_configured"); assert.equal(data.settings.local_storage_status, "not_created"); assert.equal(data.settings.enabled, false); });
test("all historical owner role values can read the data center", async () => { const db = new DatabaseSync(databasePath); try { for (const role of ["owner", "boss", "admin", "老板", "管理员"]) { db.prepare("UPDATE users SET role=? WHERE username='boss'").run(role); const cookie = await login("boss"); const response = await fetch(`http://127.0.0.1:${port}/api/data-center`, { headers: { cookie } }); assert.equal(response.status, 200, role); } } finally { db.prepare("UPDATE users SET role='owner' WHERE username='boss'").run(); db.close(); } });
test("an account with explicit audit permission can read the data center", async () => { const cookie = await login("audit-user"); const response = await fetch(`http://127.0.0.1:${port}/api/data-center`, { headers: { cookie } }); assert.equal(response.status, 200); });
test("owner creates and verifies a managed full Excel backup", async () => { const created = await fetch(`http://127.0.0.1:${port}/api/data-center/backups`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: "{}" }); const data = await created.json(); assert.equal(created.status, 201); backupRecord = data.record; assert.equal(backupRecord.backup_format, "full_data_excel"); assert.equal(backupRecord.status, "success"); const verified = await fetch(`http://127.0.0.1:${port}/api/data-center/backups/${backupRecord.id}/verify`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: "{}" }); assert.equal(verified.status, 200); });
test("managed backup download is private, no-store and parseable", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center/backups/${backupRecord.id}/download`, { headers: { cookie: ownerCookie } }); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/); assert.match(response.headers.get("content-disposition"), /attachment/); const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.subarray(0, 2).toString(), "PK"); });
test("legacy list endpoint remains available to authorized data-center users", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/backups`, { headers: { cookie: ownerCookie } }); const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.records.some((row) => row.id === backupRecord.id), true); });
