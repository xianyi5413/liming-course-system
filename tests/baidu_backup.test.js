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
  assert.equal((await verifyEncryptedFile({ inputPath: first, key })).ok, true); await decryptFile({ inputPath: first, outputPath: output, key }); assert.deepEqual(fs.readFileSync(output), fs.readFileSync(plain)); assert.equal(verifyFullData(output).version, FORMAT_VERSION);
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
    const url = new URL(String(input)); calls.push({ host: url.host, method: url.searchParams.get("method"), grant: url.searchParams.get("grant_type") });
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
  const calls = []; const manager = new BaiduBackupManager({ dataDir: tempRoot, appKey: "APP-KEY", appSecret: "APP-SECRET", redirectUri: "https://example.test/callback", encryptionKey: key, fetchImpl: mockFetch(calls, []) });
  const started = manager.beginAuthorization(); const auth = new URL(started.authorization_url); assert.equal(auth.host, "openapi.baidu.com"); assert.equal(auth.searchParams.get("response_type"), "code"); assert.ok(auth.searchParams.get("state"));
  await manager.finishAuthorization("one-time-code", auth.searchParams.get("state")); assert.equal(manager.status(), "authorized"); await manager.testConnection();
  const token = manager.tokenStore.read(); token.expires_at = 0; manager.tokenStore.write(token); await manager.testConnection(); assert.equal(calls.some((call) => call.grant === "refresh_token"), true);
});

test("Baidu upload receives only encrypted chunks and remote delete is separate", async () => {
  const calls = []; const uploaded = []; const manager = new BaiduBackupManager({ dataDir: path.join(tempRoot, "upload-manager"), appKey: "APP-KEY", appSecret: "APP-SECRET", redirectUri: "https://example.test/callback", encryptionKey: key, fetchImpl: mockFetch(calls, uploaded) });
  manager.tokenStore.write({ access_token: "MOCK-ACCESS", refresh_token: "MOCK-REFRESH", expires_at: Date.now() + 3600000 });
  const remote = await manager.upload({ record: { id: 99 }, localPath: plain, remoteDirectory: "/apps/liming-course-system" }); assert.equal(remote.file_id, "123456"); assert.equal(remote.path.endsWith(".xlsx.enc"), true); assert.equal(uploaded.length > 1, true);
  assert.equal(Buffer.concat(uploaded).includes(Buffer.from("PRIVATE-EXCEL-CONTENT")), false); assert.equal(uploaded[0].subarray(0, MAGIC.length).equals(MAGIC), true);
  assert.deepEqual(fs.readdirSync(path.dirname(plain)).filter((name) => name.startsWith(".remote-")), []); await manager.client.deleteFile(remote.path); assert.equal(calls.some((call) => call.method === "filemanager"), true);
});

test("provider failure is retryable and cleans encrypted temporary files", async () => {
  const store = new TokenStore(path.join(tempRoot, "failed-token.json")); store.write({ access_token: "MOCK", refresh_token: "MOCK-R", expires_at: Date.now() + 3600000 }); const client = new BaiduClient({ appKey: "K", appSecret: "S", redirectUri: "https://example.test/cb", tokenStore: store, fetchImpl: async () => Response.json({ errno: -6 }) });
  await assert.rejects(() => client.uploadFile(plain, "/apps/liming/file.enc"), (error) => error.code === "BAIDU_API_FAILED"); assert.throws(() => safeRemotePath("/outside/file.enc"), (error) => error.code === "BAIDU_REMOTE_PATH_INVALID");
});
