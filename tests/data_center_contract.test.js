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

test("the browser uses one-time App Secret input without embedding values", () => {
  assert.doesNotMatch(app, /password_hash|access_token|refresh_token/);
  assert.match(app, /baidu-config-app-secret[^>]*type="password"/);
  assert.doesNotMatch(app, /BAIDU_APP_KEY=\\nBAIDU_APP_SECRET=/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*app_secret/i);
  assert.match(app, /百度网盘将保存未加密的完整 Excel 备份/);
  assert.match(app, /data-backup-remote-plaintext-ack/);
});

test("Compose persists app data while nginx cannot mount the data volume", () => {
  assert.match(compose, /liming_data:\/app\/data/); const nginxBlock = compose.split(/\n\s*nginx:/)[1].split(/\nvolumes:/)[0]; assert.doesNotMatch(nginxBlock, /liming_data/);
});

test("environment example names required secrets but contains no values", () => {
  for (const key of ["BAIDU_APP_KEY", "BAIDU_APP_SECRET", "BAIDU_REDIRECT_URI"]) assert.match(envExample, new RegExp(`^${key}=$`, "m"));
  assert.equal(envExample.match(/^BAIDU_/gm)?.length, 3);
});

test("server-side permission mapping protects every data center route", () => {
  assert.match(server, /p\.startsWith\("\/api\/data-center"\).*coreExport/);
  assert.match(server, /function canManageDataCenter\(user\)[\s\S]*isSuperRole\(user\.role\)[\s\S]*userHasAnyPermission\(user, \["audit"\]\)/);
  assert.match(server, /function canViewDataPreflight\(user\)[\s\S]*canManageDataCenter\(user\)/);
  assert.match(server, /url\.pathname\.startsWith\("\/api\/data-center\/preflight"\).*canViewDataPreflight\(user\)/);
  assert.match(server, /url\.pathname\.startsWith\("\/api\/data-center"\).*canManageDataCenter\(user\)/);
});

test("backup deletion needs no credentials while overwrite restore keeps password and confirmation", () => {
  const deleteBlock = server.match(/if \(req\.method === "DELETE" && dataBackupDelete\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.doesNotMatch(deleteBlock, /verifyPassword|body\.password|body\.confirmation/);
  const restoreBlock = server.match(/if \(req\.method === "POST" && url\.pathname === "\/api\/data-center\/import\/execute"\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(restoreBlock, /verifyPassword\(body\.password/); assert.match(restoreBlock, /body\.confirmation.*expected/); assert.match(restoreBlock, /mode === "overwrite"/);
});

test("overwrite import holds the shared backup lock and always removes the upload", () => {
  assert.match(server, /importLock = service\.acquireLock\(\)/); assert.match(server, /releaseLock\(importLock\)/); assert.match(server, /fs\.rmSync\(pending\.path/);
});

test("README documents the current format, restore, scheduling, Baidu fs_id download and rollback", () => {
  for (const value of ["format_version=4", "完整覆盖恢复", "schedule_key", "明文 Excel", ".xlsx.sha256", "backup_records", "回滚代码", "fsids=[fs_id]", "User-Agent: pan.baidu.com"]) assert.equal(readme.includes(value), true, value);
});

test("remote download is owner-only and verifies the paired checksum before delivery", () => {
  assert.match(server, /remote-download/);
  assert.match(server, /downloadVerified/);
  assert.match(server, /只有老板可以下载远端完整备份/);
  assert.match(server, /BAIDU_PLAINTEXT_RISK_ACK_REQUIRED/);
});

test("legacy backup compatibility remains read-only and outside new retention", () => {
  assert.match(server, /req\.method === "GET" && url\.pathname === "\/api\/backups"/); assert.match(server, /backupRecordForDownload/); assert.match(readme, /旧业务归档记录仍保留，不自动迁移、登记或清理/);
});

test("Baidu diagnostics and operation logs use only safe error fields", () => {
  assert.match(server, /function safeBaiduTestFailure/);
  assert.match(server, /details: \{ code: safe\.code, stage: safe\.stage, provider_code: safe\.provider_code, http_status: safe\.http_status, cleanup_complete:/);
  assert.doesNotMatch(server, /operation_content:.*(?:access_token|refresh_token|dlink|app_secret)/i);
});
