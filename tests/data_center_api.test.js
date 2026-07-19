const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { after, before, test } = require("node:test");

const root = path.resolve(__dirname, ".."); let tempRoot; let port; let server; let ownerCookie; let teacherCookie; let backupRecord;
async function freePort() { return await new Promise((resolve) => { const socket = net.createServer(); socket.listen(0, "127.0.0.1", () => { const value = socket.address().port; socket.close(() => resolve(value)); }); }); }
async function waitForServer() { for (let index = 0; index < 50; index += 1) { try { const response = await fetch(`http://127.0.0.1:${port}/api/version`); if (response.ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error("server did not start"); }
async function login(username) { const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "123456" }) }); assert.equal(response.status, 200); return response.headers.get("set-cookie").split(";")[0]; }

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-data-api-")); port = await freePort(); const database = path.join(tempRoot, "api.sqlite"); const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], { cwd: root, env: { ...process.env, DATA_DIR: tempRoot, DB_PATH: database }, encoding: "utf8" }); assert.equal(initialized.status, 0, initialized.stderr);
  server = spawn(process.execPath, [path.join(root, "src/server.js")], { cwd: root, env: { ...process.env, DATA_DIR: tempRoot, DB_PATH: database, PORT: String(port), SESSION_COOKIE_SECURE: "false" }, stdio: "ignore" }); await waitForServer(); ownerCookie = await login("boss"); teacherCookie = await login("teacher");
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
test("owner can read the neutral initial data-center state", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center`, { headers: { cookie: ownerCookie } }); const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.settings.remote_status, "not_configured"); assert.equal(data.settings.enabled, false); });
test("owner creates and verifies a managed full Excel backup", async () => { const created = await fetch(`http://127.0.0.1:${port}/api/data-center/backups`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: "{}" }); const data = await created.json(); assert.equal(created.status, 201); backupRecord = data.record; assert.equal(backupRecord.backup_format, "full_data_excel"); assert.equal(backupRecord.status, "success"); const verified = await fetch(`http://127.0.0.1:${port}/api/data-center/backups/${backupRecord.id}/verify`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: "{}" }); assert.equal(verified.status, 200); });
test("managed backup download is private, no-store and parseable", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/data-center/backups/${backupRecord.id}/download`, { headers: { cookie: ownerCookie } }); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/); assert.match(response.headers.get("content-disposition"), /attachment/); const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.subarray(0, 2).toString(), "PK"); });
test("legacy list endpoint remains available to authorized data-center users", async () => { const response = await fetch(`http://127.0.0.1:${port}/api/backups`, { headers: { cookie: ownerCookie } }); const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.records.some((row) => row.id === backupRecord.id), true); });
