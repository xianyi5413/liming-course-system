const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, before, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { BaiduBackupManager, BaiduClient, BaiduError, TokenStore, safeRemotePath, remoteFileId, parseProviderJson, verifyPayloadPair } = require("../src/backup/baidu_provider");
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
  const files = new Map(); const ids = new Map(); const metadataRequests = []; const downloads = []; const uploads = []; const deletes = [];
  manager.client.testConnection = async () => ({ ok: true });
  manager.client.createDirectory = async () => ({ ok: true });
  manager.client.uploadFile = async (filename, remotePath) => {
    uploads.push(remotePath);
    if (options.failUpload?.(remotePath)) throw new BaiduError("BAIDU_API_FAILED", "合成上传失败");
    const bytes = fs.readFileSync(filename); files.set(remotePath, bytes);
    if (options.throwAfterUpload?.(remotePath)) throw new BaiduError("BAIDU_API_FAILED", "合成上传响应丢失");
    const fileId = String(9007199254740993000n + BigInt(uploads.length)); ids.set(fileId, remotePath);
    return { file_id: fileId, path: remotePath };
  };
  manager.client.metadataByFileId = async (fileId, { errorCode = "BAIDU_FILE_METADATA_FAILED", allowMissing = false } = {}) => {
    metadataRequests.push({ fileId, errorCode }); const remotePath = ids.get(fileId);
    if (options.failMetadata?.(remotePath, errorCode)) throw new BaiduError(errorCode, "合成元信息失败", { provider_code: "2", http_status: 200 });
    if (!remotePath) { if (allowMissing) return null; throw new BaiduError(errorCode, "合成元信息为空", { provider_code: "EMPTY_LIST", http_status: 200 }); }
    return { fs_id: fileId, dlink: `https://download.example.test/${fileId}`, remotePath };
  };
  manager.client.downloadFromMetadata = async (metadata, { remotePath, errorCode = "BAIDU_FILE_DOWNLOAD_FAILED" }) => {
    downloads.push({ fileId: metadata.fs_id, remotePath, errorCode });
    if (options.missingDownload?.(remotePath) || !files.has(remotePath)) throw new BaiduError(errorCode, "合成下载失败");
    return files.get(remotePath);
  };
  manager.client.downloadFile = async ({ fileId, remotePath, metadataErrorCode, downloadErrorCode }) => {
    const metadata = await manager.client.metadataByFileId(fileId, { errorCode: metadataErrorCode });
    return manager.client.downloadFromMetadata(metadata, { remotePath, errorCode: downloadErrorCode });
  };
  manager.client.deleteFile = async (remotePath, fileId = "") => {
    deletes.push({ remotePath, fileId });
    if (options.failDelete?.(remotePath)) throw new BaiduError("BAIDU_API_FAILED", "合成删除失败");
    files.delete(remotePath); if (fileId) ids.delete(fileId); return { ok: true };
  };
  return { files, ids, metadataRequests, downloads, uploads, deletes };
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
  assert.deepEqual(result.steps, { authorization: true, connection: true, test_directory: true, file_upload: true, checksum_upload: true, file_metadata: true, checksum_metadata: true, file_download: true, checksum_download: true, integrity_check: true, test_delete_file: true, test_delete_checksum: true });
  assert.equal(memory.uploads.length, 2); assert.equal(memory.uploads.some((name) => name.endsWith(".sha256")), true); assert.equal(memory.uploads.some((name) => name.endsWith(".enc")), false); assert.equal(memory.metadataRequests.length, 2); assert.equal(memory.deletes.length, 2); assert.equal(memory.files.size, 0);
  assert.deepEqual(fs.readdirSync(path.join(tempRoot, "connection-test", "backups", "full-excel", ".secrets")).filter((name) => name.startsWith(".connection-") || name.startsWith("plaintext-test-")), []);
});

test("failed connection test removes every remote test file that was created", async () => {
  const manager = configuredManager(path.join(tempRoot, "connection-cleanup")); const memory = memoryClient(manager, { missingDownload: () => true });
  await assert.rejects(() => manager.testConnection("/apps/liming-course-system"), (error) => error.code === "BAIDU_FILE_DOWNLOAD_FAILED");
  assert.equal(memory.uploads.length, 2); assert.equal(memory.deletes.length, 2); assert.equal(memory.files.size, 0);
});

test("connection test attempts cleanup when an upload completed remotely but its response failed", async () => {
  const manager = configuredManager(path.join(tempRoot, "connection-upload-response-failure")); const memory = memoryClient(manager, { throwAfterUpload: () => true });
  await assert.rejects(() => manager.testConnection("/apps/liming-course-system"), (error) => {
    assert.equal(error.code, "BAIDU_API_FAILED"); assert.equal(error.details.stage, "file_upload"); assert.equal(error.details.steps.file_upload, false); assert.equal(error.details.steps.test_delete_file, true); assert.equal(error.details.cleanup.complete, true); return true;
  });
  assert.equal(memory.uploads.length, 1); assert.equal(memory.deletes.length, 1); assert.equal(memory.files.size, 0);
});

test("connection diagnostics identify download failures and expose no credentials", async () => {
  const manager = configuredManager(path.join(tempRoot, "connection-stage")); const memory = memoryClient(manager, { missingDownload: (name) => name.endsWith(".sha256") });
  await assert.rejects(() => manager.testConnection("/apps/liming-course-system"), (error) => {
    assert.equal(error.code, "BAIDU_CHECKSUM_DOWNLOAD_FAILED"); assert.equal(error.details.stage, "checksum_download"); assert.equal(error.details.steps.file_download, true); assert.equal(error.details.steps.checksum_download, false); assert.equal(error.details.cleanup.complete, true);
    assert.doesNotMatch(JSON.stringify(error.details), /APP-SECRET|MOCK-R|access_token/i); return true;
  });
  assert.equal(memory.files.size, 0);
});

test("cleanup failure never replaces the core download failure", async () => {
  const manager = configuredManager(path.join(tempRoot, "core-and-cleanup-failure")); memoryClient(manager, { missingDownload: (name) => !name.endsWith(".sha256"), failDelete: (name) => name.endsWith(".sha256") });
  await assert.rejects(() => manager.testConnection("/apps/liming"), (error) => {
    assert.equal(error.code, "BAIDU_FILE_DOWNLOAD_FAILED"); assert.equal(error.details.stage, "file_download"); assert.equal(error.details.cleanup.complete, false); assert.equal(error.details.cleanup.checksum, "failed"); return true;
  });
});

test("core connection success remains successful when cleanup is partial", async () => {
  const manager = configuredManager(path.join(tempRoot, "connection-cleanup-partial")); const memory = memoryClient(manager, { failDelete: (name) => name.endsWith(".sha256") });
  const result = await manager.testConnection("/apps/liming-course-system");
  assert.equal(result.ok, true); assert.equal(result.core_ok, true); assert.equal(result.cleanup_ok, false); assert.equal(result.warning_code, "BAIDU_TEST_CLEANUP_PARTIAL"); assert.equal(result.steps.integrity_check, true); assert.equal(result.steps.test_delete_checksum, false); assert.equal(result.cleanup.remaining_paths.length, 1); assert.equal(memory.files.size, 1);
});

test("delete accepts task responses and verifies ambiguous successful responses by fs_id", async () => {
  const tokenStore = new TokenStore(path.join(tempRoot, "delete-token.json")); tokenStore.write({ access_token: "MOCK", refresh_token: "MOCK-R", expires_at: Date.now() + 3600000 });
  let mode = "task"; const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get("method") === "filemanager") return mode === "task" ? Response.json({ taskid: 123 }) : new Response("", { status: 200 });
    if (url.searchParams.get("method") === "filemetas") { assert.equal(url.searchParams.get("fsids"), "[12345678901234567890]"); assert.equal(url.searchParams.has("path_list"), false); return Response.json({ errno: 0, list: [] }); }
    throw new Error("unexpected endpoint");
  };
  const client = new BaiduClient({ appKey: "K", appSecret: "S", redirectUri: "https://example.test/cb", tokenStore, fetchImpl, endpoints: { xpan: "https://xpan.example.test" } });
  assert.equal((await client.deleteFile("/apps/liming/test.txt", "12345678901234567890")).ok, true); mode = "ambiguous"; assert.equal((await client.deleteFile("/apps/liming/test.txt", "12345678901234567890")).verified_absent, true);
});

test("download rejects a provider JSON error body instead of treating it as file bytes", async () => {
  const tokenStore = new TokenStore(path.join(tempRoot, "download-token.json")); tokenStore.write({ access_token: "MOCK", refresh_token: "MOCK-R", expires_at: Date.now() + 3600000 });
  const fetchImpl = async (input, options = {}) => { const url = new URL(String(input)); if (url.searchParams.get("method") === "filemetas") { assert.equal(url.searchParams.get("fsids"), "[12345678901234567890]"); return Response.json({ errno: 0, list: [{ fs_id: "12345678901234567890", dlink: "https://download.example.test/file" }] }); } assert.equal(options.redirect, "follow"); assert.equal(options.headers["User-Agent"], "pan.baidu.com"); assert.match(options.headers.Accept, /application\/octet-stream/); return Response.json({ errno: 31326 }, { status: 200 }); };
  const client = new BaiduClient({ appKey: "K", appSecret: "S", redirectUri: "https://example.test/cb", tokenStore, fetchImpl, endpoints: { xpan: "https://xpan.example.test" } });
  await assert.rejects(() => client.downloadFile({ fileId: "12345678901234567890", remotePath: "/apps/liming/test.txt" }), (error) => error.code === "BAIDU_FILE_DOWNLOAD_FAILED" && error.details.provider_code === "31326" && error.details.http_status === 200);
});

test("download reports a non-JSON HTTP 403 without leaking its dlink", async () => {
  const tokenStore = new TokenStore(path.join(tempRoot, "download-403-token.json")); tokenStore.write({ access_token: "MOCK", expires_at: Date.now() + 3600000 });
  const secretDlink = "https://download.example.test/private?sign=DO-NOT-LEAK";
  const client = new BaiduClient({ appKey: "K", appSecret: "S", redirectUri: "https://example.test/cb", tokenStore, endpoints: { xpan: "https://xpan.example.test" }, fetchImpl: async (input) => {
    const url = new URL(String(input)); return url.searchParams.get("method") === "filemetas" ? Response.json({ errno: 0, list: [{ fs_id: "123", dlink: secretDlink }] }) : new Response("forbidden", { status: 403, headers: { "content-type": "text/plain" } });
  } });
  await assert.rejects(() => client.downloadFile({ fileId: "123", remotePath: "/apps/liming/a.xlsx" }), (error) => {
    assert.equal(error.code, "BAIDU_FILE_DOWNLOAD_FAILED"); assert.equal(error.details.http_status, 403); assert.equal(error.details.provider_code, "403"); assert.doesNotMatch(JSON.stringify(error), /DO-NOT-LEAK|access_token/); return true;
  });
});

test("successful dlink download follows redirects and sends the required User-Agent", async () => {
  const tokenStore = new TokenStore(path.join(tempRoot, "download-success-token.json")); tokenStore.write({ access_token: "MOCK", expires_at: Date.now() + 3600000 });
  let downloadOptions;
  const client = new BaiduClient({ appKey: "K", appSecret: "S", redirectUri: "https://example.test/cb", tokenStore, endpoints: { xpan: "https://xpan.example.test" }, fetchImpl: async (input, options = {}) => {
    const url = new URL(String(input)); if (url.searchParams.get("method") === "filemetas") return Response.json({ errno: 0, list: [{ fs_id: "123", dlink: "https://download.example.test/redirect" }] });
    downloadOptions = options; return new Response("synthetic-download", { status: 200, headers: { "content-type": "application/octet-stream" } });
  } });
  const bytes = await client.downloadFile({ fileId: "123", remotePath: "/apps/liming/a.xlsx" });
  assert.equal(bytes.toString(), "synthetic-download"); assert.equal(downloadOptions.redirect, "follow"); assert.match(downloadOptions.headers["User-Agent"], /pan\.baidu\.com/); assert.match(downloadOptions.headers.Accept, /application\/octet-stream/);
});

test("filemetas uses fsids and dlink without path_list", async () => {
  const tokenStore = new TokenStore(path.join(tempRoot, "metadata-token.json")); tokenStore.write({ access_token: "MOCK", expires_at: Date.now() + 3600000 });
  const calls = [];
  const client = new BaiduClient({ appKey: "K", appSecret: "S", redirectUri: "https://example.test/cb", tokenStore, endpoints: { xpan: "https://xpan.example.test" }, fetchImpl: async (input) => {
    const url = new URL(String(input)); calls.push(url); return new Response('{"errno":0,"list":[{"fs_id":98765432109876543210,"dlink":"https://download.example.test/a"}]}', { headers: { "content-type": "application/json" } });
  } });
  const metadata = await client.metadataByFileId("98765432109876543210");
  assert.equal(metadata.fs_id, "98765432109876543210"); assert.equal(calls[0].searchParams.get("fsids"), "[98765432109876543210]"); assert.equal(calls[0].searchParams.get("dlink"), "1"); assert.equal(calls[0].searchParams.has("path_list"), false);
});

test("upload preserves an fs_id beyond Number.MAX_SAFE_INTEGER as a decimal string", async () => {
  const source = path.join(tempRoot, "large-id-upload.txt"); fs.writeFileSync(source, "large id");
  const tokenStore = new TokenStore(path.join(tempRoot, "large-id-token.json")); tokenStore.write({ access_token: "MOCK", expires_at: Date.now() + 3600000 });
  const fetchImpl = async (input) => {
    const url = new URL(String(input)); if (url.host === "upload.example.test") return Response.json({ errno: 0 });
    if (url.searchParams.get("method") === "precreate") return Response.json({ errno: 0, uploadid: "U" });
    return new Response('{"errno":0,"fs_id":98765432109876543210}', { headers: { "content-type": "application/json" } });
  };
  const client = new BaiduClient({ appKey: "K", appSecret: "S", redirectUri: "https://example.test/cb", tokenStore, fetchImpl, endpoints: { xpan: "https://xpan.example.test", upload: "https://upload.example.test" }, sleepImpl: async () => {} });
  assert.equal((await client.uploadFile(source, "/apps/liming/large-id.txt")).file_id, "98765432109876543210");
  assert.equal(parseProviderJson('{"fs_id":98765432109876543210}').fs_id, "98765432109876543210");
  assert.equal(remoteFileId("98765432109876543210"), "98765432109876543210"); assert.throws(() => remoteFileId(98765432109876540000), (error) => error.code === "BAIDU_REMOTE_FILE_ID_MISSING"); assert.throws(() => remoteFileId("12x34"), (error) => error.code === "BAIDU_REMOTE_FILE_ID_MISSING");
});

test("provider code 2 is standardized as file and checksum metadata failures", async () => {
  const tokenStore = new TokenStore(path.join(tempRoot, "metadata-error-token.json")); tokenStore.write({ access_token: "MOCK", expires_at: Date.now() + 3600000 });
  const client = new BaiduClient({ appKey: "K", appSecret: "S", redirectUri: "https://example.test/cb", tokenStore, endpoints: { xpan: "https://xpan.example.test" }, fetchImpl: async () => Response.json({ errno: 2 }) });
  await assert.rejects(() => client.metadataByFileId("123"), (error) => error.code === "BAIDU_FILE_METADATA_FAILED" && error.details.provider_code === "2" && /百度参数错误/.test(error.message));
  await assert.rejects(() => client.metadataByFileId("456", { errorCode: "BAIDU_CHECKSUM_METADATA_FAILED" }), (error) => error.code === "BAIDU_CHECKSUM_METADATA_FAILED" && error.details.provider_code === "2" && /校验文件/.test(error.message));
});

test("empty metadata and missing dlink fail with stable codes", async () => {
  const tokenStore = new TokenStore(path.join(tempRoot, "empty-metadata-token.json")); tokenStore.write({ access_token: "MOCK", expires_at: Date.now() + 3600000 });
  let empty = true;
  const client = new BaiduClient({ appKey: "K", appSecret: "S", redirectUri: "https://example.test/cb", tokenStore, endpoints: { xpan: "https://xpan.example.test" }, fetchImpl: async () => empty ? Response.json({ errno: 0, list: [] }) : Response.json({ errno: 0, list: [{ fs_id: "123" }] }) });
  await assert.rejects(() => client.metadataByFileId("123"), (error) => error.code === "BAIDU_FILE_METADATA_FAILED" && error.details.provider_code === "EMPTY_LIST");
  empty = false; await assert.rejects(() => client.downloadFile({ fileId: "123", remotePath: "/apps/liming/a.xlsx" }), (error) => error.code === "BAIDU_DOWNLOAD_LINK_MISSING");
});

test("connection metadata failure remains distinct and cleanup still runs", async () => {
  const manager = configuredManager(path.join(tempRoot, "metadata-cleanup")); const memory = memoryClient(manager, { failMetadata: (name) => name?.endsWith(".sha256") });
  await assert.rejects(() => manager.testConnection("/apps/liming"), (error) => {
    assert.equal(error.code, "BAIDU_CHECKSUM_METADATA_FAILED"); assert.equal(error.details.stage, "checksum_metadata"); assert.equal(error.details.steps.file_metadata, true); assert.equal(error.details.steps.checksum_metadata, false); assert.equal(error.details.cleanup.complete, true); return true;
  });
  assert.equal(memory.deletes.length, 2); assert.equal(memory.files.size, 0);
});

test("managed backup uploads the original Excel bytes and matching SHA-256 sidecar", async () => {
  const manager = configuredManager(); const memory = memoryClient(manager); const remote = await manager.upload({ record: { id: 99 }, localPath: plain, remoteDirectory: "/apps/liming-course-system" });
  assert.equal(remote.path.endsWith(".xlsx"), true); assert.equal(remote.path.endsWith([".xlsx", ".enc"].join("")), false); assert.equal(remote.checksum_path.endsWith(".xlsx.sha256"), true);
  assert.deepEqual(memory.files.get(remote.path), plainBytes); assert.equal(memory.files.get(remote.checksum_path).toString("utf8"), `${digest}  ${path.basename(plain)}\n`);
  assert.deepEqual({ file: remote.file_status, checksum: remote.checksum_status, integrity: remote.integrity_status }, { file: "success", checksum: "success", integrity: "verified" });
  assert.notEqual(remote.file_id, remote.checksum_file_id); assert.deepEqual(memory.metadataRequests.map((item) => item.fileId), [remote.file_id, remote.checksum_file_id]);
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
  const record = { remote_file_id: uploaded.file_id, remote_path: uploaded.path, remote_checksum_file_id: uploaded.checksum_file_id, remote_checksum_path: uploaded.checksum_path };
  const downloaded = await manager.downloadVerified(record); assert.deepEqual(downloaded.excel, plainBytes);
  memory.files.set(uploaded.path, Buffer.from(plainBytes)); memory.files.get(uploaded.path)[100] ^= 1;
  await assert.rejects(() => manager.downloadVerified(record), (error) => error.code === "BAIDU_REMOTE_SHA256_MISMATCH");
  await assert.rejects(() => manager.downloadVerified({ remote_path: uploaded.path, remote_checksum_path: "" }), (error) => error.code === "BAIDU_CHECKSUM_MISSING");
  await assert.rejects(() => manager.downloadVerified({ remote_path: `${uploaded.path}.enc`, remote_checksum_path: "" }), (error) => error.code === "BAIDU_LEGACY_ENCRYPTED_BACKUP");
});

test("formal remote download refuses path-only legacy records before any provider request", async () => {
  const manager = configuredManager(path.join(tempRoot, "missing-remote-id")); const memory = memoryClient(manager);
  await assert.rejects(() => manager.downloadVerified({ remote_path: "/apps/liming/a.xlsx", remote_checksum_path: "/apps/liming/a.xlsx.sha256" }), (error) => error.code === "BAIDU_REMOTE_FILE_ID_MISSING");
  assert.equal(memory.metadataRequests.length, 0); assert.equal(memory.downloads.length, 0);
});

test("pair deletion attempts both files and preserves a partial failure result", async () => {
  const manager = configuredManager(); const memory = memoryClient(manager, { failDelete: (name) => name.endsWith(".sha256") });
  const result = await manager.delete({ remote_file_id: "123", remote_path: "/apps/liming/backup.xlsx", remote_checksum_file_id: "456", remote_checksum_path: "/apps/liming/backup.xlsx.sha256" });
  assert.deepEqual(result, { excel: "deleted", checksum: "delete_failed" }); assert.deepEqual(memory.deletes, [{ remotePath: "/apps/liming/backup.xlsx", fileId: "123" }, { remotePath: "/apps/liming/backup.xlsx.sha256", fileId: "456" }]);
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
