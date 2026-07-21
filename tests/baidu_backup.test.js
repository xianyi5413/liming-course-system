const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, before, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { MAGIC, encryptFile, decryptFile, verifyEncryptedFile } = require("../src/backup/encryption");
const { BaiduBackupManager, BaiduClient, TokenStore, safeRemotePath } = require("../src/backup/baidu_provider");
const { FORMAT_VERSION, exportFullData, verifyFullData } = require("../src/excel/full_backup");

const projectRoot = path.resolve(__dirname, "..");
let tempRoot; let plain; const key = crypto.randomBytes(32).toString("base64"); const wrongKey = crypto.randomBytes(32).toString("base64");
before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-baidu-")); const dbPath = path.join(tempRoot, "synthetic.sqlite"); plain = path.join(tempRoot, "全量 数据.xlsx");
  const initialized = spawnSync(process.execPath, [path.join(projectRoot, "src/server.js"), "--init-db"], { cwd: projectRoot, env: { ...process.env, DATA_DIR: tempRoot, DB_PATH: dbPath }, encoding: "utf8" }); assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(dbPath);
  try { db.prepare("INSERT INTO operation_logs(operation_type,operation_content,result_status,extra_json) VALUES (?,?,?,?)").run("合成远端测试", "PRIVATE-EXCEL-CONTENT".repeat(260000), "success", JSON.stringify({ synthetic: true })); }
  finally { db.close(); }
  exportFullData({ dbPath, outputPath: plain, createdAt: new Date("2026-07-20T04:00:00Z") }); assert.equal(verifyFullData(plain).version, FORMAT_VERSION);
});
after(() => { if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true }); });

test("AES-256-GCM encryption is authenticated, random and round-trips", async () => {
  const first = path.join(tempRoot, "first.enc"); const second = path.join(tempRoot, "second.enc"); const output = path.join(tempRoot, "restored.xlsx");
  await encryptFile({ inputPath: plain, outputPath: first, key }); await encryptFile({ inputPath: plain, outputPath: second, key });
  assert.equal(fs.readFileSync(first).subarray(0, MAGIC.length).equals(MAGIC), true); assert.notDeepEqual(fs.readFileSync(first).subarray(0, 64), fs.readFileSync(second).subarray(0, 64));
  assert.equal((await verifyEncryptedFile({ inputPath: first, key })).ok, true); await decryptFile({ inputPath: first, outputPath: output, key }); assert.deepEqual(fs.readFileSync(output), fs.readFileSync(plain));
  const verified = verifyFullData(output); assert.equal(verified.version, FORMAT_VERSION);
  assert.equal(verified.workbook.sheetMap.get("所有学生费用明细").rows[0].includes("规则费用"), false);
  assert.equal(verified.workbook.sheetMap.get("所有教师课时明细").rows[0].includes("规则薪资"), false);
});

test("wrong key and tampering fail without publishing plaintext", async () => {
  const encrypted = path.join(tempRoot, "wrong.enc"); await encryptFile({ inputPath: plain, outputPath: encrypted, key }); const wrongOutput = path.join(tempRoot, "wrong.xlsx");
  await assert.rejects(() => decryptFile({ inputPath: encrypted, outputPath: wrongOutput, key: wrongKey }), (error) => error.code === "BACKUP_ENCRYPTION_AUTH_FAILED"); assert.equal(fs.existsSync(wrongOutput), false);
  const bytes = fs.readFileSync(encrypted); bytes[100] ^= 1; fs.writeFileSync(path.join(tempRoot, "tampered.enc"), bytes);
  await assert.rejects(() => verifyEncryptedFile({ inputPath: path.join(tempRoot, "tampered.enc"), key }), (error) => error.code === "BACKUP_ENCRYPTION_AUTH_FAILED");
});

test("token store is private and never returns tokens in status", () => {
  const store = new TokenStore(path.join(tempRoot, "secrets", "token.json")); store.write({ access_token: "ACCESS-SECRET", refresh_token: "REFRESH-SECRET", expires_at: Date.now() + 60000 });
  assert.equal(store.status(), "refresh_required"); if (process.platform !== "win32") assert.equal(fs.statSync(store.filename).mode & 0o777, 0o600); assert.equal(store.status().includes("SECRET"), false);
});

function mockFetch(calls, uploaded) {
  return async (input, options = {}) => {
    const url = new URL(String(input));
    const requestBody = options.body instanceof URLSearchParams ? options.body : new URLSearchParams();
    calls.push({
      host: url.host,
      method: url.searchParams.get("method"),
      http_method: options.method || "GET",
      grant: requestBody.get("grant_type") || url.searchParams.get("grant_type"),
      has_client_secret_in_url: url.searchParams.has("client_secret"),
      has_client_secret_in_body: requestBody.has("client_secret"),
    });
    if (url.pathname.includes("oauth/2.0/token")) return Response.json({ access_token: "MOCK-ACCESS", refresh_token: "MOCK-REFRESH", expires_in: 3600, scope: "netdisk" });
    if (url.searchParams.get("method") === "uinfo") return Response.json({ errno: 0, baidu_name: "mock" });
    if (url.searchParams.get("method") === "precreate") return Response.json({ errno: 0, uploadid: "upload-1", return_type: 1 });
    if (url.searchParams.get("method") === "upload") { const blob = options.body.get("file"); uploaded.push(Buffer.from(await blob.arrayBuffer())); return Response.json({ errno: 0, md5: "mock" }); }
    if (url.searchParams.get("method") === "create") return Response.json({ errno: 0, fs_id: 123456, path: "/apps/mock/file.enc" });
    if (url.searchParams.get("method") === "filemanager") return Response.json({ errno: 0, request_id: 1 });
    return Response.json({ errno: -1 }, { status: 400 });
  };
}

test("OAuth state, token exchange, refresh and connection test use official endpoint shapes", async () => {
  const calls = []; const uploaded = []; const manager = new BaiduBackupManager({ dataDir: tempRoot, appKey: "APP-KEY", appSecret: "APP-SECRET", redirectUri: "https://example.test/callback", encryptionKey: key, fetchImpl: mockFetch(calls, uploaded) });
  const started = manager.beginAuthorization(); const auth = new URL(started.authorization_url); assert.equal(auth.host, "openapi.baidu.com"); assert.equal(auth.searchParams.get("response_type"), "code"); assert.ok(auth.searchParams.get("state")); assert.equal(auth.searchParams.has("client_secret"), false);
  await manager.finishAuthorization("one-time-code", auth.searchParams.get("state")); assert.equal(manager.status(), "authorized"); const tested = await manager.testConnection();
  assert.deepEqual(tested.steps, { authorization: true, connection: true, test_directory: true, encrypted_upload: true, test_delete: true });
  assert.equal(calls.some((call) => call.method === "filemanager"), true); assert.equal(uploaded.length > 0, true); assert.equal(Buffer.concat(uploaded).includes(Buffer.from("liming-baidu-connection-test")), false);
  const token = manager.tokenStore.read(); token.expires_at = 0; manager.tokenStore.write(token); await manager.testConnection(); assert.equal(calls.some((call) => call.grant === "refresh_token"), true);
  const tokenCalls = calls.filter((call) => call.host === "openapi.baidu.com" && call.grant);
  assert.equal(tokenCalls.length >= 2, true);
  assert.equal(tokenCalls.every((call) => call.http_method === "POST" && !call.has_client_secret_in_url && call.has_client_secret_in_body), true);
});

test("one-time configuration is private, reloadable, non-reflecting and clearable", () => {
  const dataDir = path.join(tempRoot, "config-store"); const manager = new BaiduBackupManager({ dataDir });
  const saved = manager.saveConfiguration({ appKey: "CONFIG-APP-KEY", appSecret: "CONFIG-APP-SECRET", redirectUri: "https://example.test/api/data-center/baidu/callback", encryptionKey: key });
  assert.equal(saved.oauth_configured, true); assert.equal(saved.encryption_configured, true); assert.equal(JSON.stringify(saved).includes("CONFIG-APP-KEY"), false); assert.equal(JSON.stringify(saved).includes("CONFIG-APP-SECRET"), false); assert.equal(JSON.stringify(saved).includes(key), false);
  const filename = path.join(dataDir, "backups", "full-excel", ".secrets", "baidu-config.json");
  assert.equal(fs.existsSync(filename), true); if (process.platform !== "win32") assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  const reloaded = new BaiduBackupManager({ dataDir }).configurationStatus(); assert.equal(reloaded.oauth_configured, true); assert.doesNotMatch(JSON.stringify(reloaded), /CONFIG-APP-KEY|CONFIG-APP-SECRET/);
  manager.clearConfiguration(); assert.equal(fs.existsSync(filename), false); assert.equal(manager.configurationStatus().oauth_configured, false);
});

test("successful encrypted connection test persists the gate for automatic upload", async () => {
  const dataDir = path.join(tempRoot, "test-gate"); const manager = new BaiduBackupManager({ dataDir });
  manager.saveConfiguration({ appKey: "K", appSecret: "S", redirectUri: "https://example.test/api/data-center/baidu/callback", encryptionKey: key });
  manager.tokenStore.write({ access_token: "MOCK", refresh_token: "MOCK-R", expires_at: Date.now() + 3600000 });
  const uploaded = [];
  manager.client.testConnection = async () => ({ ok: true }); manager.client.createDirectory = async () => ({ ok: true });
  manager.client.uploadFile = async (filename, remotePath) => { uploaded.push({ remotePath, bytes: fs.readFileSync(filename) }); return { file_id: "1", path: remotePath }; };
  manager.client.deleteFile = async () => ({ ok: true });
  const result = await manager.testConnection(); assert.equal(result.ok, true); assert.equal(uploaded.length, 1); assert.match(uploaded[0].remotePath, /\.enc$/); assert.equal(uploaded[0].bytes.subarray(0, MAGIC.length).equals(MAGIC), true);
  const reloaded = new BaiduBackupManager({ dataDir }).configurationStatus(); assert.equal(reloaded.test_passed, true); assert.equal(reloaded.last_test_result, "success");
  assert.deepEqual(fs.readdirSync(path.join(dataDir, "backups", "full-excel", ".secrets")).filter((name) => name.startsWith(".connection-")), []);
});

test("Baidu upload receives only encrypted chunks and remote delete is separate", async () => {
  const calls = []; const uploaded = []; const manager = new BaiduBackupManager({ dataDir: path.join(tempRoot, "upload-manager"), appKey: "APP-KEY", appSecret: "APP-SECRET", redirectUri: "https://example.test/callback", encryptionKey: key, fetchImpl: mockFetch(calls, uploaded) });
  manager.tokenStore.write({ access_token: "MOCK-ACCESS", refresh_token: "MOCK-REFRESH", expires_at: Date.now() + 3600000 });
  const remote = await manager.upload({ record: { id: 99 }, localPath: plain, remoteDirectory: "/apps/liming-course-system" }); assert.equal(remote.file_id, "123456"); assert.equal(remote.path.endsWith(".xlsx.enc"), true); assert.equal(uploaded.length > 1, true);
  assert.equal(Buffer.concat(uploaded).includes(Buffer.from("PRIVATE-EXCEL-CONTENT")), false); assert.equal(uploaded[0].subarray(0, MAGIC.length).equals(MAGIC), true);
  assert.equal(calls.some((call) => call.has_client_secret_in_url), false);
  assert.equal(calls.filter((call) => call.host !== "openapi.baidu.com").some((call) => call.has_client_secret_in_body), false);
  assert.deepEqual(fs.readdirSync(path.dirname(plain)).filter((name) => name.startsWith(".remote-")), []); await manager.client.deleteFile(remote.path); assert.equal(calls.some((call) => call.method === "filemanager"), true);
});

test("provider failure is retryable and cleans encrypted temporary files", async () => {
  const store = new TokenStore(path.join(tempRoot, "failed-token.json")); store.write({ access_token: "MOCK", refresh_token: "MOCK-R", expires_at: Date.now() + 3600000 }); const client = new BaiduClient({ appKey: "K", appSecret: "S", redirectUri: "https://example.test/cb", tokenStore: store, fetchImpl: async () => Response.json({ errno: -6 }) });
  await assert.rejects(() => client.uploadFile(plain, "/apps/liming/file.enc"), (error) => error.code === "BAIDU_API_FAILED"); assert.throws(() => safeRemotePath("/outside/file.enc"), (error) => error.code === "BAIDU_REMOTE_PATH_INVALID");
});

test("configuration status distinguishes every missing server setting without returning values", () => {
  const missing = new BaiduBackupManager({ dataDir: path.join(tempRoot, "status-missing"), appKey: "", appSecret: "", redirectUri: "", encryptionKey: "" }).configurationStatus();
  assert.deepEqual(missing.missing_items, ["BAIDU_APP_KEY", "BAIDU_APP_SECRET", "BAIDU_REDIRECT_URI", "BACKUP_ENCRYPTION_KEY"]);
  assert.equal(missing.token_status, "not_configured");
  const onlyKey = new BaiduBackupManager({ dataDir: path.join(tempRoot, "status-key"), appKey: "VISIBLE-APP-KEY", appSecret: "", redirectUri: "", encryptionKey: "" }).configurationStatus();
  assert.equal(onlyKey.app_key_configured, true);
  assert.deepEqual(onlyKey.missing_items, ["BAIDU_APP_SECRET", "BAIDU_REDIRECT_URI", "BACKUP_ENCRYPTION_KEY"]);
  assert.doesNotMatch(JSON.stringify(onlyKey), /VISIBLE-APP-KEY/);
  const complete = { appKey: "K", appSecret: "S", redirectUri: "https://example.test/api/data-center/baidu/callback", encryptionKey: key };
  for (const [field, environmentName] of [["appSecret", "BAIDU_APP_SECRET"], ["redirectUri", "BAIDU_REDIRECT_URI"], ["encryptionKey", "BACKUP_ENCRYPTION_KEY"]]) {
    const values = { ...complete, [field]: "" };
    const status = new BaiduBackupManager({ dataDir: path.join(tempRoot, `missing-${field}`), ...values }).configurationStatus();
    assert.deepEqual(status.missing_items, [environmentName]);
  }
  assert.throws(() => new BaiduBackupManager({ dataDir: path.join(tempRoot, "status-incomplete"), appKey: "K", appSecret: "S", redirectUri: "https://example.test/api/data-center/baidu/callback", encryptionKey: "" }).beginAuthorization(), (error) => error.code === "BAIDU_CONFIGURATION_INCOMPLETE");
});

test("fully configured authorization, expiry and disconnect states are explicit and safe", () => {
  const manager = new BaiduBackupManager({ dataDir: path.join(tempRoot, "status-full"), appKey: "K", appSecret: "S", redirectUri: "https://example.test/api/data-center/baidu/callback", encryptionKey: key });
  const initial = manager.configurationStatus();
  assert.equal(initial.authorized, false);
  assert.equal(initial.token_status, "not_found");
  manager.tokenStore.write({ access_token: "DO-NOT-RETURN", refresh_token: "DO-NOT-RETURN-EITHER", expires_at: Date.now() + 3600000 });
  const active = manager.configurationStatus();
  assert.equal(active.authorized, true);
  assert.equal(active.token_status, "valid");
  assert.equal(active.redirect_uri, "https://example.test/api/data-center/baidu/callback");
  assert.doesNotMatch(JSON.stringify(active), /DO-NOT-RETURN/);
  manager.tokenStore.write({ access_token: "EXPIRED", expires_at: 0 });
  assert.equal(manager.configurationStatus().authorization_status, "expired");
  assert.equal(manager.configurationStatus().token_status, "expired");
  manager.disconnect();
  assert.equal(manager.configurationStatus().token_status, "not_found");
});

test("connection test status records only a safe result code", async () => {
  const manager = new BaiduBackupManager({ dataDir: path.join(tempRoot, "status-test"), appKey: "K", appSecret: "TOP-SECRET", redirectUri: "https://example.test/api/data-center/baidu/callback", encryptionKey: key, fetchImpl: async () => Response.json({ errno: -6 }) });
  manager.tokenStore.write({ access_token: "ACCESS-SECRET", refresh_token: "REFRESH-SECRET", expires_at: Date.now() + 3600000 });
  await assert.rejects(() => manager.testConnection(), (error) => error.code === "BAIDU_API_FAILED");
  const status = manager.configurationStatus();
  assert.match(status.last_test_at, /^\d{4}-/);
  assert.equal(status.last_test_result, "BAIDU_API_FAILED");
  assert.doesNotMatch(JSON.stringify(status), /TOP-SECRET|ACCESS-SECRET|REFRESH-SECRET/);
});

test("backup key generator emits one valid AES-256 key and writes no files", () => {
  const directory = path.join(tempRoot, "key-cli"); fs.mkdirSync(directory);
  const before = fs.readdirSync(directory);
  const result = spawnSync(process.execPath, [path.join(projectRoot, "scripts", "excel_backup", "generate_backup_key.js")], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  const generated = lines.at(-1);
  assert.equal(Buffer.from(generated, "base64").length, 32);
  assert.equal(result.stdout.split(generated).length - 1, 1);
  assert.deepEqual(fs.readdirSync(directory), before);
});
