const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const server = fs.readFileSync(path.join(root, "src/server.js"), "utf8");
const nginx = fs.readFileSync(path.join(root, "deploy/nginx.conf"), "utf8");
const compose = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

test("data center renders exactly three functional regions", () => {
  assert.deepEqual([...app.matchAll(/data-region="([^"]+)"/g)].map((match) => match[1]), ["import-export", "backup-settings", "backup-records"]);
});

test("navigation preserves audit permission key but displays data center", () => {
  assert.match(app, /\["audit", "数据中心"\]/); assert.match(server, /key: "audit", label: "数据中心"/);
});

test("obsolete monthly export routes and UI controls are absent", () => {
  for (const value of ["/api/export/core-workbook.xlsx", "/api/export/core-workbooks-all.zip", "export-core-workbook", "export-all-core-workbooks", "coreWorkbookSheets", "createCoreBackup", "maybeRunAutomaticBackup"]) assert.equal(app.includes(value) || server.includes(value), false, value);
});

test("new data center API surface is present without a public static backup route", () => {
  for (const value of ["/api/data-center/export.xlsx", "/api/data-center/template.xlsx", "/api/data-center/import/preview", "/api/data-center/import/execute", "/api/data-center/backups", "/api/data-center/baidu/authorize"]) assert.equal(server.includes(value), true, value);
  assert.doesNotMatch(nginx, /alias\s+.*backups|root\s+.*backups/i);
});

test("full backup downloads explicitly disable browser caching", () => {
  assert.match(server, /cache-control": "no-store, no-cache, must-revalidate, private"/); assert.match(server, /"pragma": "no-cache"/);
});

test("the browser uses one-time secret inputs without embedding values or legacy environment templates", () => {
  assert.doesNotMatch(app, /password_hash|access_token|refresh_token/);
  assert.match(app, /baidu-config-app-secret[^>]*type="password"/);
  assert.match(app, /baidu-config-encryption-key[^>]*type="password"/);
  assert.doesNotMatch(app, /BAIDU_APP_KEY=\\nBAIDU_APP_SECRET=/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*(app_secret|encryption_key)/i);
});

test("Compose persists app data while nginx cannot mount the data volume", () => {
  assert.match(compose, /liming_data:\/app\/data/); const nginxBlock = compose.split(/\n\s*nginx:/)[1].split(/\nvolumes:/)[0]; assert.doesNotMatch(nginxBlock, /liming_data/);
});

test("environment example names required secrets but contains no values", () => {
  for (const key of ["BAIDU_APP_KEY", "BAIDU_APP_SECRET", "BAIDU_REDIRECT_URI", "BACKUP_ENCRYPTION_KEY"]) assert.match(envExample, new RegExp(`^${key}=$`, "m"));
});

test("server-side permission mapping protects every data center route", () => {
  assert.match(server, /p\.startsWith\("\/api\/data-center"\).*coreExport/); assert.match(server, /url\.pathname\.startsWith\("\/api\/data-center"\).*\["audit"\]/); assert.match(server, /startsWith\("\/api\/data-center"\).*userHasAnyPermission\(user, \["audit"\]\)/);
});

test("delete and overwrite operations require password and confirmation text", () => {
  assert.match(server, /verifyPassword\(body\.password/); assert.match(server, /body\.confirmation.*删除备份/); assert.match(server, /body\.confirmation.*expected/);
});

test("overwrite import holds the shared backup lock and always removes the upload", () => {
  assert.match(server, /importLock = service\.acquireLock\(\)/); assert.match(server, /releaseLock\(importLock\)/); assert.match(server, /fs\.rmSync\(pending\.path/);
});

test("README documents the sensitive format, restore, scheduling, Baidu encryption and rollback", () => {
  for (const value of ["liming_full_data_excel", "完整覆盖恢复", "schedule_key", "AES-256-GCM", "密钥遗失", "backup_records", "回滚代码", "当前正式服务器没有因本分支发生任何变化"]) assert.equal(readme.includes(value), true, value);
});

test("legacy backup compatibility remains read-only and outside new retention", () => {
  assert.match(server, /req\.method === "GET" && url\.pathname === "\/api\/backups"/); assert.match(server, /backupRecordForDownload/); assert.match(readme, /旧备份永不参与/);
});
