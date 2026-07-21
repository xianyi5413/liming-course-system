const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, before, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { BaiduBackupManager, BaiduClient, BaiduError, TokenStore, safeRemotePath, verifyPayloadPair } = require("../src/backup/baidu_provider");
const { FORMAT_VERSION, exportFullData, verifyFullData } = require("../src/excel/full_backup");

const projectRoot = path.resolve(__dirname, "..");
let tempRoot; let plain; let sidecar; let plainBytes; let digest;

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-baidu-plaintext-"));
  const managed = path.join(tempRoot, "backups", "full-excel"); fs.mkdirSync(managed, { recursive: true });
  const dbPath = path.join(tempRoot, "synthetic.sqlite"); plain = path.join(managed, "黎明教育_全量数据_20260722_023000.xlsx"); sidecar = `${plain}.sha256`;
  const initialized = spawnSync(process.execPath, [path.join(projectRoot, "src/server.js"), "--init-db"], { cwd: projectRoot, env: { ...process.env, DATA_DIR: tempRoot, DB_PATH: dbPath }, encoding: "utf8" }); assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(dbPath); db.prepare("INSERT INTO operation_logs(operation_type,operation_content,result_status) VALUES (?,?,?)").run("合成测试", "仅合成业务数据", "success"); db.close();
  exportFullData({ dbPath, outputPath: plain, createdAt: new Date("2026-07-22T02:30:00+08:00") }); assert.equal(verifyFullData(plain).version, FORMAT_VERSION);
  plainBytes = fs.readFileSync(plain); digest = crypto.createHash("sha256").update(plainBytes).digest("hex"); fs.writeFileSync(sidecar, `${digest}  ${path.basename(plain)}\n`);
});
after(() => { if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true }); });

function configuredManager(directory = tempRoot) {
  const manager = new BaiduBackupManager({ dataDir: directory, appKey: "APP-KEY", appSecret: "APP-SECRET", redirectUri: "https://example.test/callback" });
  manager.tokenStore.write({ access_token: "MOCK", refresh_token: "MOCK-R", expires_at: Date.now() + 3600000 });
  return manager;
}

function memoryClient(manager, options = {}) {
  const files = new Map(); const uploads = []; const deletes = [];
  manager.client.testConnection = async () => ({ ok: true });
  manager.client.createDirectory = async () => ({ ok: true });
  manager.client.uploadFile = async (filename, remotePath) => {
    uploads.push(remotePath);
    if (options.failUpload?.(remotePath)) throw new BaiduError("BAIDU_API_FAILED", "合成上传失败");
    const bytes = fs.readFileSync(filename); files.set(remotePath, bytes); return { file_id: `id-${uploads.length}`, path: remotePath };
  };
  manager.client.downloadFile = async (remotePath) => {
    if (options.missingDownload?.(remotePath) || !files.has(remotePath)) throw new BaiduError("BAIDU_DOWNLOAD_FAILED", "合成下载失败");
    return files.get(remotePath);
  };
  manager.client.deleteFile = async (remotePath) => {
    deletes.push(remotePath);
    if (options.failDelete?.(remotePath)) throw new BaiduError("BAIDU_API_FAILED", "合成删除失败");
    files.delete(remotePath); return { ok: true };
  };
  return { files, uploads, deletes };
}

test("configuration needs only App Key, App Secret and redirect URI and never reflects secrets", () => {
  const dataDir = path.join(tempRoot, "config-store"); const manager = new BaiduBackupManager({ dataDir });
  const retiredField = ["encryption", "key"].join("_"); const retiredStatus = ["encryption", "configured"].join("_");
  manager.configStore.write({ app_key: "OLD", app_secret: "OLD", redirect_uri: "https://old.example.test/callback", [retiredField]: "ignored-old-value" });
  const saved = manager.saveConfiguration({ appKey: "CONFIG-APP-KEY", appSecret: "CONFIG-APP-SECRET", redirectUri: "https://example.test/api/data-center/baidu/callback" });
  assert.equal(saved.oauth_configured, true); assert.deepEqual(saved.missing_items, []); assert.equal(retiredStatus in saved, false); assert.doesNotMatch(JSON.stringify(saved), /CONFIG-APP-KEY|CONFIG-APP-SECRET|ignored-old-value/);
  const filename = path.join(dataDir, "backups", "full-excel", ".secrets", "baidu-config.json"); const stored = JSON.parse(fs.readFileSync(filename, "utf8")); assert.deepEqual(Object.keys(stored).sort(), ["app_key", "app_secret", "last_test_at", "last_test_result", "redirect_uri"]); assert.equal(retiredField in stored, false);
  if (process.platform !== "win32") assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
});

test("loading a legacy private configuration removes its retired field", () => {
  const dataDir = path.join(tempRoot, "legacy-config"); const directory = path.join(dataDir, "backups", "full-excel", ".secrets"); fs.mkdirSync(directory, { recursive: true });
  const retiredField = ["encryption", "key"].join("_"); const filename = path.join(directory, "baidu-config.json");
  fs.writeFileSync(filename, JSON.stringify({ app_key: "K", app_secret: "S", redirect_uri: "https://example.test/cb", [retiredField]: "retired" }));
  const manager = new BaiduBackupManager({ dataDir }); assert.equal(manager.configured(), true);
  const stored = JSON.parse(fs.readFileSync(filename, "utf8")); assert.equal(retiredField in stored, false); assert.deepEqual(Object.keys(stored).sort(), ["app_key", "app_secret", "last_test_at", "last_test_result", "redirect_uri"]);
});

test("missing configuration list contains exactly the three Baidu application variables", () => {
  const missing = new BaiduBackupManager({ dataDir: path.join(tempRoot, "missing"), appKey: "", appSecret: "", redirectUri: "" }).configurationStatus();
  assert.deepEqual(missing.missing_items, ["BAIDU_APP_KEY", "BAIDU_APP_SECRET", "BAIDU_REDIRECT_URI"]);
  const configured = new BaiduBackupManager({ dataDir: path.join(tempRoot, "configured"), appKey: "K", appSecret: "S", redirectUri: "https://example.test/cb" });
  assert.equal(configured.configured(), true);
});

test("OAuth uses POST for secrets, refreshes tokens and never places App Secret in a URL", async () => {
  const calls = [];
  const fetchImpl = async (input, options = {}) => { const url = new URL(String(input)); const body = options.body instanceof URLSearchParams ? options.body : new URLSearchParams(); calls.push({ host: url.host, method: options.method || "GET", secretInUrl: url.searchParams.has("client_secret"), secretInBody: body.has("client_secret"), grant: body.get("grant_type") }); return Response.json({ access_token: "ACCESS", refresh_token: "REFRESH", expires_in: 3600, scope: "netdisk" }); };
  const manager = new BaiduBackupManager({ dataDir: path.join(tempRoot, "oauth"), appKey: "K", appSecret: "TOP-SECRET", redirectUri: "https://example.test/cb", fetchImpl });
  const started = manager.beginAuthorization(); const url = new URL(started.authorization_url); assert.equal(url.searchParams.has("client_secret"), false);
  await manager.finishAuthorization("code", url.searchParams.get("state")); const token = manager.tokenStore.read(); token.expires_at = 0; manager.tokenStore.write(token); await manager.client.accessToken();
  assert.equal(calls.every((call) => call.method === "POST" && !call.secretInUrl && call.secretInBody), true); assert.deepEqual(calls.map((call) => call.grant), ["authorization_code", "refresh_token"]);
});

test("chunk upload retries a transient provider failure without changing the remote path", async () => {
  const uploadSource = path.join(tempRoot, "upload-retry.txt"); fs.writeFileSync(uploadSource, "synthetic upload retry");
  const tokenStore = new TokenStore(path.join(tempRoot, "upload-retry-token.json")); tokenStore.write({ access_token: "MOCK", refresh_token: "MOCK-R", expires_at: Date.now() + 3600000 });
  let partAttempts = 0; const waits = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input)); const method = url.searchParams.get("method");
    if (url.host === "upload.example.test") { partAttempts += 1; return partAttempts === 1 ? Response.json({ errno: 500 }, { status: 500 }) : Response.json({ errno: 0 }); }
    if (method === "precreate") return Response.json({ errno: 0, uploadid: "SYNTHETIC-UPLOAD" });
    if (method === "create") return Response.json({ errno: 0, fs_id: 123 });
    throw new Error("unexpected synthetic endpoint");
  };
  const client = new BaiduClient({ appKey: "K", appSecret: "S", redirectUri: "https://example.test/cb", tokenStore, fetchImpl, endpoints: { xpan: "https://xpan.example.test", upload: "https://upload.example.test" }, sleepImpl: async (milliseconds) => waits.push(milliseconds) });
  const result = await client.uploadFile(uploadSource, "/apps/liming-course-system/upload-retry.txt");
  assert.deepEqual(result, { file_id: "123", path: "/apps/liming-course-system/upload-retry.txt" }); assert.equal(partAttempts, 2); assert.deepEqual(waits, [250]);
});

test("connection test uploads, downloads, verifies and deletes a synthetic plaintext pair", async () => {
  const manager = configuredManager(path.join(tempRoot, "connection-test")); const memory = memoryClient(manager);
  const result = await manager.testConnection("/apps/liming-course-system");
  assert.deepEqual(result.steps, { authorization: true, connection: true, test_directory: true, file_upload: true, checksum_upload: true, download: true, integrity_check: true, test_delete_file: true, test_delete_checksum: true });
  assert.equal(memory.uploads.length, 2); assert.equal(memory.uploads.some((name) => name.endsWith(".sha256")), true); assert.equal(memory.uploads.some((name) => name.endsWith(".enc")), false); assert.equal(memory.deletes.length, 2); assert.equal(memory.files.size, 0);
  assert.deepEqual(fs.readdirSync(path.join(tempRoot, "connection-test", "backups", "full-excel", ".secrets")).filter((name) => name.startsWith(".connection-") || name.startsWith("plaintext-test-")), []);
});

test("failed connection test removes every remote test file that was created", async () => {
  const manager = configuredManager(path.join(tempRoot, "connection-cleanup")); const memory = memoryClient(manager, { missingDownload: () => true });
  await assert.rejects(() => manager.testConnection("/apps/liming-course-system"), (error) => error.code === "BAIDU_DOWNLOAD_FAILED");
  assert.equal(memory.uploads.length, 2); assert.equal(memory.deletes.length, 2); assert.equal(memory.files.size, 0);
});

test("managed backup uploads the original Excel bytes and matching SHA-256 sidecar", async () => {
  const manager = configuredManager(); const memory = memoryClient(manager); const remote = await manager.upload({ record: { id: 99 }, localPath: plain, remoteDirectory: "/apps/liming-course-system" });
  assert.equal(remote.path.endsWith(".xlsx"), true); assert.equal(remote.path.endsWith([".xlsx", ".enc"].join("")), false); assert.equal(remote.checksum_path.endsWith(".xlsx.sha256"), true);
  assert.deepEqual(memory.files.get(remote.path), plainBytes); assert.equal(memory.files.get(remote.checksum_path).toString("utf8"), `${digest}  ${path.basename(plain)}\n`);
  assert.deepEqual({ file: remote.file_status, checksum: remote.checksum_status, integrity: remote.integrity_status }, { file: "success", checksum: "success", integrity: "verified" });
});

test("local upload refuses a missing or mismatched sidecar before contacting Baidu", async () => {
  const manager = configuredManager(); const memory = memoryClient(manager); const original = fs.readFileSync(sidecar);
  fs.rmSync(sidecar); await assert.rejects(() => manager.upload({ record: { id: 1 }, localPath: plain, remoteDirectory: "/apps/liming" }), (error) => error.code === "BAIDU_CHECKSUM_MISSING"); assert.equal(memory.uploads.length, 0);
  fs.writeFileSync(sidecar, `${"0".repeat(64)}  ${path.basename(plain)}\n`); await assert.rejects(() => manager.upload({ record: { id: 1 }, localPath: plain, remoteDirectory: "/apps/liming" }), (error) => error.code === "BAIDU_LOCAL_SHA256_MISMATCH"); assert.equal(memory.uploads.length, 0);
  fs.writeFileSync(sidecar, original);
});

test("sidecar upload failure preserves local backup and reports the two remote parts separately", async () => {
  const manager = configuredManager(); memoryClient(manager, { failUpload: (name) => name.endsWith(".sha256") });
  await assert.rejects(() => manager.upload({ record: { id: 2 }, localPath: plain, remoteDirectory: "/apps/liming" }), (error) => error.code === "BAIDU_API_FAILED" && error.details.remote.file_status === "success" && error.details.remote.checksum_status === "failed");
  assert.equal(fs.existsSync(plain), true); assert.equal(fs.existsSync(sidecar), true);
});

test("verified remote download rejects mismatch, missing sidecar and legacy encrypted records", async () => {
  const manager = configuredManager(); const memory = memoryClient(manager); const uploaded = await manager.upload({ record: { id: 3 }, localPath: plain, remoteDirectory: "/apps/liming" });
  const downloaded = await manager.downloadVerified({ remote_path: uploaded.path, remote_checksum_path: uploaded.checksum_path }); assert.deepEqual(downloaded.excel, plainBytes);
  memory.files.set(uploaded.path, Buffer.from(plainBytes)); memory.files.get(uploaded.path)[100] ^= 1;
  await assert.rejects(() => manager.downloadVerified({ remote_path: uploaded.path, remote_checksum_path: uploaded.checksum_path }), (error) => error.code === "BAIDU_REMOTE_SHA256_MISMATCH");
  await assert.rejects(() => manager.downloadVerified({ remote_path: uploaded.path, remote_checksum_path: "" }), (error) => error.code === "BAIDU_CHECKSUM_MISSING");
  await assert.rejects(() => manager.downloadVerified({ remote_path: `${uploaded.path}.enc`, remote_checksum_path: "" }), (error) => error.code === "BAIDU_LEGACY_ENCRYPTED_BACKUP");
});

test("pair deletion attempts both files and preserves a partial failure result", async () => {
  const manager = configuredManager(); const memory = memoryClient(manager, { failDelete: (name) => name.endsWith(".sha256") });
  const result = await manager.delete({ remote_path: "/apps/liming/backup.xlsx", remote_checksum_path: "/apps/liming/backup.xlsx.sha256" });
  assert.deepEqual(result, { excel: "deleted", checksum: "delete_failed" }); assert.deepEqual(memory.deletes, ["/apps/liming/backup.xlsx", "/apps/liming/backup.xlsx.sha256"]);
});

test("token status and errors never expose tokens or App Secret", async () => {
  const manager = new BaiduBackupManager({ dataDir: path.join(tempRoot, "safe-errors"), appKey: "K", appSecret: "TOP-SECRET", redirectUri: "https://example.test/cb" });
  manager.tokenStore.write({ access_token: "ACCESS-SECRET", refresh_token: "REFRESH-SECRET", expires_at: Date.now() + 3600000 });
  manager.client.testConnection = async () => { throw new BaiduError("BAIDU_API_FAILED", "safe"); };
  await assert.rejects(() => manager.testConnection(), (error) => error.code === "BAIDU_API_FAILED"); const status = manager.configurationStatus();
  assert.doesNotMatch(JSON.stringify(status), /TOP-SECRET|ACCESS-SECRET|REFRESH-SECRET/); assert.equal(status.last_test_result, "BAIDU_API_FAILED");
});

test("remote paths stay under apps and payload verification requires a valid workbook", () => {
  assert.equal(safeRemotePath("/apps/liming/file.xlsx"), "/apps/liming/file.xlsx"); assert.throws(() => safeRemotePath("/outside/file.xlsx"), (error) => error.code === "BAIDU_REMOTE_PATH_INVALID");
  assert.throws(() => verifyPayloadPair(Buffer.from("not-xlsx"), Buffer.from(`${crypto.createHash("sha256").update("not-xlsx").digest("hex")}  file.xlsx\n`), "file.xlsx"));
});

test("the retired file-protection module and CLIs no longer exist", () => {
  for (const filename of ["src/backup/encryption.js", "scripts/excel_backup/encrypted_backup.js", "scripts/excel_backup/generate_backup_key.js"]) assert.equal(fs.existsSync(path.join(projectRoot, filename)), false, filename);
});
