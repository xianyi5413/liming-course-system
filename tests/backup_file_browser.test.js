const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const {
  listManagedLocalExcel,
  normalizedManagedRelativePath,
  resolveManagedLocalExcel,
} = require("../src/backup/file_browser");
const { BaiduBackupManager } = require("../src/backup/baidu_provider");

const root = path.resolve(__dirname, "..");
let tempRoot;
let dbPath;
let port;
let server;
let readonlyCookie;

async function freePort() {
  return new Promise((resolve) => {
    const socket = net.createServer();
    socket.listen(0, "127.0.0.1", () => {
      const selected = socket.address().port;
      socket.close(() => resolve(selected));
    });
  });
}

async function waitForServer() {
  for (let index = 0; index < 100; index += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("server did not start");
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-file-browser-"));
  dbPath = path.join(tempRoot, "browser.sqlite");
  port = await freePort();
  const environment = {
    ...process.env,
    DATA_DIR: tempRoot,
    DB_PATH: dbPath,
    PORT: String(port),
    SESSION_COOKIE_SECURE: "false",
    BAIDU_APP_KEY: "",
    BAIDU_APP_SECRET: "",
    BAIDU_REDIRECT_URI: "",
  };
  const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], {
    cwd: root,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const managed = path.join(tempRoot, "backups", "full-excel");
  fs.mkdirSync(managed, { recursive: true });
  fs.writeFileSync(path.join(managed, "recorded.xlsx"), Buffer.from("PK-recorded"));
  fs.writeFileSync(path.join(managed, "recorded.xlsx.sha256"), "digest  recorded.xlsx\n");
  fs.writeFileSync(path.join(managed, "orphan.xlsx"), Buffer.from("PK-orphan"));
  fs.writeFileSync(path.join(managed, ".hidden.xlsx"), "hidden");
  fs.writeFileSync(path.join(managed, "~$temporary.xlsx"), "temporary");
  const db = new DatabaseSync(dbPath);
  const passwordHash = db.prepare("SELECT password_hash FROM users WHERE username='boss'").get().password_hash;
  db.prepare("INSERT INTO users(username,display_name,role,readonly_override,password_hash,status,permission_override_enabled) VALUES ('file-reader','文件只读账号','teacher',1,?,'active',1)").run(passwordHash);
  const userId = db.prepare("SELECT id FROM users WHERE username='file-reader'").get().id;
  db.prepare("INSERT INTO user_page_permissions(user_id,permission_key,enabled) VALUES (?,'audit',1)").run(userId);
  db.prepare(`INSERT INTO backup_records(
    backup_type,filename,status,backup_format,format_version,trigger,retention_class,
    managed_relative_path,remote_status,created_by_user_id
  ) VALUES ('manual','recorded.xlsx','success','full_data_excel',4,'manual','manual','backups/full-excel/recorded.xlsx','not_configured',?)`).run(userId);
  db.close();
  server = spawn(process.execPath, [path.join(root, "src/server.js")], {
    cwd: root,
    env: environment,
    stdio: "ignore",
    windowsHide: true,
  });
  await waitForServer();
  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "file-reader", password: "123456" }),
  });
  assert.equal(login.status, 200);
  readonlyCookie = login.headers.get("set-cookie").split(";")[0];
});

after(async () => {
  if (server?.exitCode == null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("local browser includes recorded and orphan Excel files but excludes hidden and temporary files", async () => {
  const records = [{
    id: 1,
    managed_relative_path: "backups/full-excel/recorded.xlsx",
    status: "success",
    backup_time: "2026-07-28 10:00:00",
    created_by_label: "文件只读账号",
  }];
  const result = await listManagedLocalExcel({ dataDir: tempRoot, records });
  assert.equal(result.root_status, "available");
  assert.deepEqual(result.items.map((item) => item.filename).sort(), ["orphan.xlsx", "recorded.xlsx"]);
  const recorded = result.items.find((item) => item.filename === "recorded.xlsx");
  const orphan = result.items.find((item) => item.filename === "orphan.xlsx");
  assert.equal(recorded.checksum_status, "present");
  assert.equal(recorded.local_file_status, "recorded");
  assert.equal(recorded.backup_record.created_by_label, "文件只读账号");
  assert.equal(orphan.local_file_status, "orphan");
  assert.equal(orphan.backup_record, null);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("local resolver rejects traversal, absolute paths and symlink escapes", async (t) => {
  for (const unsafe of ["../outside.xlsx", "backups/full-excel/../../outside.xlsx", "C:/outside.xlsx", "/outside.xlsx"]) {
    assert.throws(() => normalizedManagedRelativePath(unsafe), { code: "MANAGED_FILE_PATH_INVALID" });
  }
  const resolved = await resolveManagedLocalExcel(tempRoot, "backups/full-excel/orphan.xlsx");
  assert.equal(resolved.filename, "orphan.xlsx");
  const outside = path.join(tempRoot, "outside.xlsx");
  const linked = path.join(tempRoot, "backups", "full-excel", "linked.xlsx");
  fs.writeFileSync(outside, "outside");
  try {
    fs.symlinkSync(outside, linked, "file");
  } catch (error) {
    t.diagnostic(`symlink creation unavailable: ${error.code}`);
    return;
  }
  await assert.rejects(() => resolveManagedLocalExcel(tempRoot, "backups/full-excel/linked.xlsx"), { code: "MANAGED_FILE_NOT_FOUND" });
});

test("read-only audit account can list and download local files, but traversal and deletion stay blocked", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/data-center/files/local-excel`, { headers: { cookie: readonlyCookie } });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.items.some((item) => item.filename === "orphan.xlsx"), true);
  assert.doesNotMatch(JSON.stringify(data), /password_hash|access_token|refresh_token|app_secret|dlink/i);

  const downloaded = await fetch(`http://127.0.0.1:${port}/api/data-center/files/local-excel/download?path=${encodeURIComponent("backups/full-excel/orphan.xlsx")}`, { headers: { cookie: readonlyCookie } });
  assert.equal(downloaded.status, 200);
  assert.equal(Buffer.from(await downloaded.arrayBuffer()).toString(), "PK-orphan");
  const traversal = await fetch(`http://127.0.0.1:${port}/api/data-center/files/local-excel/download?path=${encodeURIComponent("../outside.xlsx")}`, { headers: { cookie: readonlyCookie } });
  assert.equal(traversal.status, 400);
  const deletion = await fetch(`http://127.0.0.1:${port}/api/data-center/files/local-excel`, { method: "DELETE", headers: { cookie: readonlyCookie } });
  assert.equal(deletion.status, 403);
});

test("ordinary account without data-center permission receives 403 from both file browsers", async () => {
  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "teacher", password: "123456" }),
  });
  assert.equal(login.status, 200);
  const teacherCookie = login.headers.get("set-cookie").split(";")[0];
  for (const route of ["/api/data-center/files/local-excel", "/api/data-center/files/baidu-excel"]) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { cookie: teacherCookie } });
    assert.equal(response.status, 403);
  }
});

test("unconfigured Baidu listing returns an explicit safe state", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/data-center/files/baidu-excel`, { headers: { cookie: readonlyCookie } });
  const data = await response.json();
  assert.equal(response.status, 409);
  assert.equal(data.code, "BAIDU_NOT_CONFIGURED");
  assert.doesNotMatch(JSON.stringify(data), /access_token|refresh_token|app_secret|dlink/i);
});

test("Baidu provider listing is paged, scoped to the configured directory and returns safe Excel DTOs", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({
      errno: 0,
      has_more: 1,
      list: [
        { fs_id: "9007199254740993123", path: "/apps/liming-course-system/managed.xlsx", size: 2048, isdir: 0, server_mtime: 1785204000 },
        { fs_id: 2, path: "/apps/liming-course-system/managed.xlsx.sha256", size: 90, isdir: 0, server_mtime: 1785204001 },
        { fs_id: 3, path: "/apps/liming-course-system/readme.txt", size: 10, isdir: 0, server_mtime: 1785204002 },
        { fs_id: 4, path: "/apps/outside/leak.xlsx", size: 10, isdir: 0, server_mtime: 1785204003 },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const managerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-baidu-list-"));
  try {
    const manager = new BaiduBackupManager({
      dataDir: managerRoot,
      appKey: "APP-KEY",
      appSecret: "APP-SECRET",
      redirectUri: "http://127.0.0.1/callback",
      fetchImpl,
    });
    manager.tokenStore.write({ access_token: "TOKEN", refresh_token: "REFRESH", expires_at: Date.now() + 3600_000 });
    const result = await manager.listManagedExcel("/apps/liming-course-system", { cursor: "20", limit: 4 });
    assert.equal(result.items.length, 1);
    assert.deepEqual(result.items[0], {
      filename: "managed.xlsx",
      relative_path: "managed.xlsx",
      size: 2048,
      modified_at: new Date(1785204000 * 1000).toISOString(),
      checksum_status: "present",
      fs_id: "9007199254740993123",
    });
    assert.equal(result.has_more, true);
    assert.equal(result.next_cursor, "24");
    assert.match(requests[0], /method=list/);
    assert.match(requests[0], /dir=%2Fapps%2Fliming-course-system/);
    assert.match(requests[0], /start=20/);
    assert.doesNotMatch(JSON.stringify(result), /TOKEN|REFRESH|APP-SECRET|access_token|dlink|\/apps\//i);
  } finally {
    fs.rmSync(managerRoot, { recursive: true, force: true });
  }
});

test("Baidu listing distinguishes missing authorization, expired tokens and network failures in Chinese", async () => {
  const managerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-baidu-errors-"));
  try {
    const manager = new BaiduBackupManager({
      dataDir: managerRoot,
      appKey: "KEY",
      appSecret: "SECRET",
      redirectUri: "http://127.0.0.1/callback",
      fetchImpl: async () => { throw new Error("offline"); },
    });
    await assert.rejects(() => manager.listManagedExcel("/apps/liming-course-system"), (error) => {
      assert.equal(error.code, "BAIDU_AUTHORIZATION_REQUIRED");
      assert.match(error.message, /尚未授权/);
      return true;
    });
    manager.tokenStore.write({ access_token: "EXPIRED", refresh_token: "", expires_at: Date.now() - 1 });
    await assert.rejects(() => manager.listManagedExcel("/apps/liming-course-system"), (error) => {
      assert.equal(error.code, "BAIDU_AUTHORIZATION_EXPIRED");
      assert.match(error.message, /已过期/);
      return true;
    });
    manager.tokenStore.write({ access_token: "VALID", refresh_token: "REFRESH", expires_at: Date.now() + 3600_000 });
    await assert.rejects(() => manager.listManagedExcel("/apps/liming-course-system"), (error) => {
      assert.equal(error.code, "BAIDU_LIST_NETWORK_FAILED");
      assert.match(error.message, /网络请求失败/);
      return true;
    });
  } finally {
    fs.rmSync(managerRoot, { recursive: true, force: true });
  }
});
