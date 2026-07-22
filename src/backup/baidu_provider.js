const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { verifyFullData } = require("../excel/full_backup");

const DEFAULT_ENDPOINTS = Object.freeze({
  authorize: "https://openapi.baidu.com/oauth/2.0/authorize",
  token: "https://openapi.baidu.com/oauth/2.0/token",
  xpan: "https://pan.baidu.com/rest/2.0/xpan",
  upload: "https://d.pcs.baidu.com/rest/2.0/pcs/superfile2",
});
const BLOCK_SIZE = 4 * 1024 * 1024;

class BaiduError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = "BaiduError"; this.code = code; this.details = details; }
}

function safeProviderDetails(response, data = {}) {
  return {
    provider_code: String(data.errno ?? data.error_code ?? data.error ?? response?.status ?? "unknown").slice(0, 80),
    http_status: Number(response?.status || 0),
  };
}

function safeRemotePath(value) {
  const raw = String(value || "").replaceAll("\\", "/").replace(/\0/g, "");
  if (raw.split("/").includes("..")) throw new BaiduError("BAIDU_REMOTE_PATH_INVALID", "百度网盘目录必须位于 /apps/ 下");
  const normalized = path.posix.normalize(`/${raw}`);
  if (!normalized.startsWith("/apps/") || normalized.includes("..")) throw new BaiduError("BAIDU_REMOTE_PATH_INVALID", "百度网盘目录必须位于 /apps/ 下");
  return normalized;
}
function fileBlocks(filename) {
  const fd = fs.openSync(filename, "r"); const hashes = []; const buffer = Buffer.allocUnsafe(BLOCK_SIZE);
  try { let length; while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hashes.push(crypto.createHash("md5").update(buffer.subarray(0, length)).digest("hex")); }
  finally { fs.closeSync(fd); }
  return hashes;
}
function sha256File(filename) {
  const hash = crypto.createHash("sha256"); const fd = fs.openSync(filename, "r"); const buffer = Buffer.allocUnsafe(1024 * 1024);
  try { let length; while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length)); return hash.digest("hex"); }
  finally { fs.closeSync(fd); }
}
function formBody(values) { const body = new URLSearchParams(); for (const [key, value] of Object.entries(values)) body.set(key, typeof value === "string" ? value : JSON.stringify(value)); return body; }
function inside(root, target) { const relative = path.relative(root, target); return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative); }
function checksumText(digest, filename) { return `${digest}  ${path.basename(filename)}\n`; }
function parseChecksum(value, expectedFilename = "") {
  const match = String(value || "").trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
  if (!match) throw new BaiduError("BAIDU_CHECKSUM_INVALID", "SHA-256 校验文件格式无效");
  if (expectedFilename && path.basename(match[2].trim()) !== path.basename(expectedFilename)) throw new BaiduError("BAIDU_CHECKSUM_FILENAME_MISMATCH", "SHA-256 校验文件中的文件名不匹配");
  return match[1].toLowerCase();
}
function verifyPayloadPair(excelBytes, checksumBytes, filename) {
  if (!checksumBytes?.length) throw new BaiduError("BAIDU_CHECKSUM_MISSING", "远端 SHA-256 校验文件缺失");
  const expected = parseChecksum(checksumBytes.toString("utf8"), filename);
  const actual = crypto.createHash("sha256").update(excelBytes).digest("hex");
  if (actual !== expected) throw new BaiduError("BAIDU_REMOTE_SHA256_MISMATCH", "远端 Excel 与 SHA-256 校验文件不匹配");
  verifyFullData(excelBytes);
  return { ok: true, sha256: actual };
}

class TokenStore {
  constructor(filename) { this.filename = path.resolve(filename); }
  read() { try { const value = JSON.parse(fs.readFileSync(this.filename, "utf8")); return value?.access_token ? value : null; } catch { return null; } }
  write(token) { const directory = path.dirname(this.filename); fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); try { fs.chmodSync(directory, 0o700); } catch {} const temporary = `${this.filename}.tmp-${process.pid}-${crypto.randomUUID()}`; fs.writeFileSync(temporary, JSON.stringify(token), { flag: "wx", mode: 0o600 }); try { fs.chmodSync(temporary, 0o600); } catch {} fs.renameSync(temporary, this.filename); }
  clear() { try { fs.rmSync(this.filename, { force: true }); } catch {} }
  status() { const token = this.read(); if (!token) return "not_authorized"; return Number(token.expires_at || 0) > Date.now() + 60_000 ? "authorized" : token.refresh_token ? "refresh_required" : "authorization_expired"; }
  tokenStatus() { const token = this.read(); if (!token) return "not_found"; return Number(token.expires_at || 0) > Date.now() + 60_000 ? "valid" : token.refresh_token ? "refresh_required" : "expired"; }
}

class BaiduConfigStore {
  constructor(filename) { this.filename = path.resolve(filename); }
  read() { try { const value = JSON.parse(fs.readFileSync(this.filename, "utf8")); return value && typeof value === "object" ? value : {}; } catch { return {}; } }
  write(config) { const directory = path.dirname(this.filename); fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); try { fs.chmodSync(directory, 0o700); } catch {} const temporary = `${this.filename}.tmp-${process.pid}-${crypto.randomUUID()}`; fs.writeFileSync(temporary, JSON.stringify(config), { flag: "wx", mode: 0o600 }); try { fs.chmodSync(temporary, 0o600); } catch {} fs.renameSync(temporary, this.filename); try { fs.chmodSync(this.filename, 0o600); } catch {} }
  clear() { try { fs.rmSync(this.filename, { force: true }); } catch {} }
}

class BaiduClient {
  constructor({ appKey, appSecret, redirectUri, tokenStore, fetchImpl = fetch, endpoints = DEFAULT_ENDPOINTS, sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) }) { this.appKey = appKey; this.appSecret = appSecret; this.redirectUri = redirectUri; this.tokenStore = tokenStore; this.fetch = fetchImpl; this.endpoints = { ...DEFAULT_ENDPOINTS, ...endpoints }; this.sleep = sleepImpl; }
  assertConfigured() { if (!this.appKey || !this.appSecret || !this.redirectUri) throw new BaiduError("BAIDU_NOT_CONFIGURED", "百度网盘应用尚未配置"); }
  authorizationUrl(state) { this.assertConfigured(); const url = new URL(this.endpoints.authorize); url.search = new URLSearchParams({ response_type: "code", client_id: this.appKey, redirect_uri: this.redirectUri, state, scope: "basic,netdisk" }); return url.toString(); }
  async tokenRequest(parameters) { this.assertConfigured(); const url = new URL(this.endpoints.token); const body = formBody({ ...parameters, client_id: this.appKey, client_secret: this.appSecret }); const response = await this.fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store" }); const data = await response.json().catch(() => ({})); if (!response.ok || data.error) throw new BaiduError("BAIDU_OAUTH_FAILED", "百度网盘授权失败", { provider_code: String(data.error || response.status) }); const token = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + Number(data.expires_in || 0) * 1000, scope: data.scope || "" }; this.tokenStore.write(token); return token; }
  exchangeCode(code) { return this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: this.redirectUri }); }
  refresh(refreshToken) { return this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }); }
  async accessToken() { let token = this.tokenStore.read(); if (!token) throw new BaiduError("BAIDU_AUTHORIZATION_REQUIRED", "百度网盘需要授权"); if (Number(token.expires_at || 0) <= Date.now() + 60_000) { if (!token.refresh_token) throw new BaiduError("BAIDU_AUTHORIZATION_EXPIRED", "百度网盘授权已过期"); token = await this.refresh(token.refresh_token); } return token.access_token; }
  async apiJson(url, options = {}) { const response = await this.fetch(url, options); const data = await response.json().catch(() => ({})); if (!response.ok || (data.errno !== undefined && Number(data.errno) !== 0)) throw new BaiduError("BAIDU_API_FAILED", "百度网盘接口调用失败", safeProviderDetails(response, data)); return data; }
  async uploadRequest(operation) { let lastError; for (let attempt = 1; attempt <= 3; attempt += 1) { try { return await operation(); } catch (error) { lastError = error; if (attempt === 3) throw error; await this.sleep(attempt * 250); } } throw lastError; }
  async testConnection() { const accessToken = await this.accessToken(); const url = new URL(`${this.endpoints.xpan}/nas`); url.search = new URLSearchParams({ method: "uinfo", access_token: accessToken }); await this.apiJson(url); return { ok: true }; }
  async createDirectory(remotePath) { const accessToken = await this.accessToken(); const target = safeRemotePath(remotePath); const url = new URL(`${this.endpoints.xpan}/file`); url.search = new URLSearchParams({ method: "create", access_token: accessToken }); await this.apiJson(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: formBody({ path: target, size: 0, isdir: 1, rtype: 3, block_list: [] }) }); return { ok: true, path: target }; }
  async uploadFile(localPath, remotePath) { const accessToken = await this.accessToken(); const target = safeRemotePath(remotePath); const size = fs.statSync(localPath).size; const blocks = fileBlocks(localPath); const preUrl = new URL(`${this.endpoints.xpan}/file`); preUrl.search = new URLSearchParams({ method: "precreate", access_token: accessToken }); const pre = await this.uploadRequest(() => this.apiJson(preUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: formBody({ path: target, size, isdir: 0, autoinit: 1, rtype: 3, block_list: blocks }) })); const uploadId = pre.uploadid; if (!uploadId) throw new BaiduError("BAIDU_UPLOAD_PRECREATE_FAILED", "百度网盘上传预创建失败"); const fd = fs.openSync(localPath, "r"); const buffer = Buffer.allocUnsafe(BLOCK_SIZE); try { for (let index = 0; index < blocks.length; index += 1) { const length = fs.readSync(fd, buffer, 0, buffer.length, index * BLOCK_SIZE); const form = new FormData(); form.append("file", new Blob([buffer.subarray(0, length)]), path.posix.basename(target)); const uploadUrl = new URL(this.endpoints.upload); uploadUrl.search = new URLSearchParams({ method: "upload", access_token: accessToken, type: "tmpfile", path: target, uploadid: uploadId, partseq: String(index) }); await this.uploadRequest(() => this.apiJson(uploadUrl, { method: "POST", body: form })); } } finally { fs.closeSync(fd); } const createUrl = new URL(`${this.endpoints.xpan}/file`); createUrl.search = new URLSearchParams({ method: "create", access_token: accessToken }); const result = await this.uploadRequest(() => this.apiJson(createUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: formBody({ path: target, size, isdir: 0, rtype: 3, uploadid: uploadId, block_list: blocks }) })); return { file_id: String(result.fs_id || ""), path: target }; }
  async metadata(remotePath) { const accessToken = await this.accessToken(); const target = safeRemotePath(remotePath); const url = new URL(`${this.endpoints.xpan}/multimedia`); url.search = new URLSearchParams({ method: "filemetas", access_token: accessToken, path_list: JSON.stringify([target]), dlink: "1" }); const data = await this.apiJson(url); return data.list?.[0] || null; }
  async downloadFile(remotePath) {
    const accessToken = await this.accessToken(); const target = safeRemotePath(remotePath); const metadata = await this.metadata(target); const dlink = metadata?.dlink;
    if (!dlink) throw new BaiduError("BAIDU_DOWNLOAD_LINK_MISSING", "百度网盘未返回下载地址", { provider_code: "DLINK_MISSING", http_status: 200 });
    const downloadUrl = new URL(dlink); downloadUrl.searchParams.set("access_token", accessToken);
    const response = await this.fetch(downloadUrl, { cache: "no-store", redirect: "follow", headers: { accept: "application/octet-stream,*/*" } });
    const bytes = Buffer.from(await response.arrayBuffer()); const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
    let providerError = null;
    if (contentType.includes("json") || (bytes.length < 64 * 1024 && /^\s*\{/.test(bytes.toString("utf8", 0, Math.min(bytes.length, 64))))) {
      try { const parsed = JSON.parse(bytes.toString("utf8")); if (parsed.errno !== undefined || parsed.error_code !== undefined || parsed.error) providerError = parsed; } catch {}
    }
    if (!response.ok || providerError) throw new BaiduError("BAIDU_DOWNLOAD_FAILED", "百度网盘文件下载失败", safeProviderDetails(response, providerError || {}));
    return bytes;
  }
  async fileExists(remotePath) {
    try { return Boolean(await this.metadata(remotePath)); }
    catch (error) { if (["-9", "31066", "12"].includes(String(error?.details?.provider_code || ""))) return false; throw error; }
  }
  async deleteFile(remotePath) {
    const accessToken = await this.accessToken(); const target = safeRemotePath(remotePath); const url = new URL(`${this.endpoints.xpan}/file`); url.search = new URLSearchParams({ method: "filemanager", opera: "delete", async: "0", access_token: accessToken });
    const response = await this.fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: formBody({ filelist: [target] }), cache: "no-store" });
    const data = await response.json().catch(() => ({})); const explicitSuccess = response.ok && (Number(data.errno) === 0 || (data.errno === undefined && (data.taskid !== undefined || data.task_id !== undefined || data.info !== undefined)));
    if (explicitSuccess) return { ok: true, task_id: String(data.taskid ?? data.task_id ?? "") };
    // Some delete variants return an unusual/empty body after completing the operation.
    if (response.ok) {
      try { if (!(await this.fileExists(target))) return { ok: true, verified_absent: true }; } catch {}
    }
    throw new BaiduError("BAIDU_DELETE_FAILED", "百度网盘测试文件删除失败", safeProviderDetails(response, data));
  }
}

class BaiduBackupManager {
  constructor({ dataDir, appKey, appSecret, redirectUri, fetchImpl, endpoints } = {}) { this.dataDir = path.resolve(dataDir); this.managedRoot = path.resolve(this.dataDir, "backups", "full-excel"); this.states = new Map(); this.fetchImpl = fetchImpl; this.endpoints = endpoints; const secretDirectory = path.join(this.managedRoot, ".secrets"); this.configStore = new BaiduConfigStore(path.join(secretDirectory, "baidu-config.json")); this.tokenStore = new TokenStore(path.join(secretDirectory, "baidu-token.json")); this.explicitConfig = [appKey, appSecret, redirectUri].some((value) => value !== undefined) ? { app_key: appKey || "", app_secret: appSecret || "", redirect_uri: redirectUri || "", last_test_at: "", last_test_result: "not_tested" } : null; this.reload(); }
  reload() { const stored = this.explicitConfig || this.configStore.read(); const retiredField = ["encryption", "key"].join("_"); if (!this.explicitConfig && Object.hasOwn(stored, retiredField)) { const sanitized = { app_key: stored.app_key || "", app_secret: stored.app_secret || "", redirect_uri: stored.redirect_uri || "", last_test_at: stored.last_test_at || "", last_test_result: stored.last_test_result || "not_tested" }; this.configStore.write(sanitized); Object.assign(stored, sanitized); delete stored[retiredField]; } const config = { app_key: stored.app_key || process.env.BAIDU_APP_KEY || "", app_secret: stored.app_secret || process.env.BAIDU_APP_SECRET || "", redirect_uri: stored.redirect_uri || process.env.BAIDU_REDIRECT_URI || "", last_test_at: stored.last_test_at || "", last_test_result: stored.last_test_result || "not_tested" }; this.lastTestAt = config.last_test_at; this.lastTestResult = config.last_test_result; this.client = new BaiduClient({ appKey: config.app_key, appSecret: config.app_secret, redirectUri: config.redirect_uri, tokenStore: this.tokenStore, fetchImpl: this.fetchImpl, endpoints: this.endpoints }); return config; }
  saveConfiguration({ appKey, appSecret, redirectUri }) { const clean = { app_key: String(appKey || "").trim(), app_secret: String(appSecret || "").trim(), redirect_uri: String(redirectUri || "").trim(), last_test_at: "", last_test_result: "not_tested" }; if (!clean.app_key || !clean.app_secret || !/^https?:\/\//i.test(clean.redirect_uri)) throw new BaiduError("BAIDU_CONFIGURATION_INVALID", "App Key、App Secret 或回调地址不完整"); this.explicitConfig = null; this.configStore.write(clean); this.tokenStore.clear(); this.reload(); return this.configurationStatus(); }
  clearConfiguration() { this.explicitConfig = null; this.tokenStore.clear(); this.configStore.clear(); this.reload(); return this.configurationStatus(); }
  persistTestStatus(result) { if (this.explicitConfig) return; const stored = this.configStore.read(); if (!stored.app_key) return; const clean = { app_key: stored.app_key || "", app_secret: stored.app_secret || "", redirect_uri: stored.redirect_uri || "", last_test_at: this.lastTestAt, last_test_result: result }; this.configStore.write(clean); }
  configurationStatus() { const fields = { BAIDU_APP_KEY: Boolean(this.client.appKey), BAIDU_APP_SECRET: Boolean(this.client.appSecret), BAIDU_REDIRECT_URI: Boolean(this.client.redirectUri) }; const missingItems = Object.entries(fields).filter(([, configured]) => !configured).map(([name]) => name); const oauthConfigured = missingItems.length === 0; const tokenStatus = oauthConfigured ? this.tokenStore.tokenStatus() : "not_configured"; const authorizationStatus = tokenStatus === "valid" || tokenStatus === "refresh_required" ? "authorized" : tokenStatus === "expired" ? "expired" : "not_authorized"; return { app_key_configured: fields.BAIDU_APP_KEY, app_secret_configured: fields.BAIDU_APP_SECRET, redirect_uri_configured: fields.BAIDU_REDIRECT_URI, oauth_configured: oauthConfigured, authorized: authorizationStatus === "authorized", authorization_status: authorizationStatus, token_status: tokenStatus, redirect_uri: fields.BAIDU_REDIRECT_URI ? String(this.client.redirectUri) : "", callback_route: "/api/data-center/baidu/callback", missing_items: missingItems, last_test_at: this.lastTestAt, last_test_result: this.lastTestResult, test_passed: String(this.lastTestResult).startsWith("success"), status: missingItems.length ? "not_configured" : this.tokenStore.status() }; }
  configured() { return this.configurationStatus().oauth_configured; }
  status() { return this.configurationStatus().status; }
  beginAuthorization() { if (!this.configured()) throw new BaiduError("BAIDU_CONFIGURATION_INCOMPLETE", "请先完成百度应用和回调地址配置"); const state = crypto.randomBytes(32).toString("hex"); this.states.set(state, Date.now() + 10 * 60_000); return { authorization_url: this.client.authorizationUrl(state), state_expires_in: 600 }; }
  async finishAuthorization(code, state) { const expiry = this.states.get(String(state)); this.states.delete(String(state)); if (!expiry || expiry < Date.now()) throw new BaiduError("BAIDU_OAUTH_STATE_INVALID", "百度授权 state 无效或已过期"); await this.client.exchangeCode(String(code)); return { ok: true, status: this.status() }; }
  disconnect() { this.tokenStore.clear(); return { ok: true, status: this.status() }; }
  assertManagedBackup(localPath) { const resolved = path.resolve(localPath); if (!inside(this.managedRoot, resolved) || !/\.xlsx$/i.test(resolved) || !fs.existsSync(resolved)) throw new BaiduError("BAIDU_LOCAL_BACKUP_INVALID", "只能上传受管目录中的 Excel 备份"); if (fs.lstatSync(resolved).isSymbolicLink() || !inside(this.managedRoot, fs.realpathSync(resolved))) throw new BaiduError("BAIDU_LOCAL_BACKUP_INVALID", "受管 Excel 备份路径无效"); verifyFullData(resolved); const sidecar = `${resolved}.sha256`; if (!fs.existsSync(sidecar)) throw new BaiduError("BAIDU_CHECKSUM_MISSING", "本地 SHA-256 校验文件缺失"); const expected = parseChecksum(fs.readFileSync(sidecar, "utf8"), path.basename(resolved)); const actual = sha256File(resolved); if (actual !== expected) throw new BaiduError("BAIDU_LOCAL_SHA256_MISMATCH", "本地 Excel 与 SHA-256 校验文件不匹配"); return { localPath: resolved, sidecarPath: sidecar, digest: actual }; }
  async testConnection(remoteDirectory = "/apps/liming-course-system") {
    if (!this.configured()) throw new BaiduError("BAIDU_CONFIGURATION_INCOMPLETE", "请先完成百度应用和回调地址配置");
    this.lastTestAt = new Date().toISOString();
    const safeDirectory = `${safeRemotePath(remoteDirectory)}/.liming-connection-test`;
    const basename = `plaintext-test-${crypto.randomUUID()}.txt`;
    const localFile = path.join(path.dirname(this.configStore.filename), basename); const localChecksum = `${localFile}.sha256`;
    const remoteFile = `${safeDirectory}/${basename}`; const remoteChecksum = `${remoteFile}.sha256`;
    const steps = { authorization: false, connection: false, test_directory: false, file_upload: false, checksum_upload: false, file_download: false, checksum_download: false, integrity_check: false, test_delete_file: false, test_delete_checksum: false };
    const cleanup = { complete: false, file: "not_uploaded", checksum: "not_uploaded", remaining_paths: [] };
    let stage = "authorization"; let corePassed = false; let coreError = null;
    try {
      await this.client.accessToken(); steps.authorization = true; stage = "connection";
      await this.client.testConnection(); steps.connection = true;
      stage = "test_directory";
      await this.client.createDirectory(safeDirectory); steps.test_directory = true;
      fs.mkdirSync(path.dirname(localFile), { recursive: true, mode: 0o700 });
      const content = Buffer.from(`liming-baidu-connection-test ${this.lastTestAt}\n`, "utf8");
      fs.writeFileSync(localFile, content, { flag: "wx", mode: 0o600 });
      const digest = sha256File(localFile); fs.writeFileSync(localChecksum, checksumText(digest, basename), { flag: "wx", mode: 0o600 });
      stage = "file_upload"; cleanup.file = "pending"; await this.client.uploadFile(localFile, remoteFile); steps.file_upload = true;
      stage = "checksum_upload"; cleanup.checksum = "pending"; await this.client.uploadFile(localChecksum, remoteChecksum); steps.checksum_upload = true;
      stage = "file_download"; const downloaded = await this.client.downloadFile(remoteFile); steps.file_download = true;
      stage = "checksum_download"; const downloadedChecksum = await this.client.downloadFile(remoteChecksum); steps.checksum_download = true;
      stage = "integrity_check";
      const remoteDigest = parseChecksum(downloadedChecksum.toString("utf8"), basename);
      if (crypto.createHash("sha256").update(downloaded).digest("hex") !== remoteDigest || !downloaded.equals(content)) throw new BaiduError("BAIDU_REMOTE_SHA256_MISMATCH", "连接测试的远端文件校验失败");
      steps.integrity_check = true; corePassed = true;
    } catch (error) {
      coreError = error;
    } finally {
      if (cleanup.file === "pending") try { await this.client.deleteFile(remoteFile); steps.test_delete_file = true; cleanup.file = "deleted"; } catch { cleanup.file = "failed"; cleanup.remaining_paths.push(remoteFile); }
      if (cleanup.checksum === "pending") try { await this.client.deleteFile(remoteChecksum); steps.test_delete_checksum = true; cleanup.checksum = "deleted"; } catch { cleanup.checksum = "failed"; cleanup.remaining_paths.push(remoteChecksum); }
      cleanup.complete = cleanup.remaining_paths.length === 0;
      try { fs.rmSync(localFile, { force: true }); } catch {}
      try { fs.rmSync(localChecksum, { force: true }); } catch {}
    }
    if (coreError) {
      this.lastTestResult = String(coreError?.code || "failed").replace(/[^A-Z0-9_-]/gi, "_").slice(0, 100); this.persistTestStatus(this.lastTestResult);
      throw new BaiduError(coreError?.code || "BAIDU_CONNECTION_TEST_FAILED", coreError?.message || "百度连接测试失败", {
        stage, provider_code: String(coreError?.details?.provider_code || ""), http_status: Number(coreError?.details?.http_status || 0), cleanup, steps,
      });
    }
    if (corePassed) {
      this.lastTestResult = cleanup.complete ? "success" : "success_cleanup_warning"; this.persistTestStatus(this.lastTestResult);
      return { ok: true, core_ok: true, cleanup_ok: cleanup.complete, cleanup, steps, warning_code: cleanup.complete ? "" : "BAIDU_TEST_CLEANUP_PARTIAL" };
    }
  }
  async upload({ record, localPath, remoteDirectory }) { if (!this.configured()) throw new BaiduError("BAIDU_NOT_CONFIGURED", "百度网盘尚未配置"); const local = this.assertManagedBackup(localPath); const remoteBase = `${safeRemotePath(remoteDirectory)}/${path.basename(local.localPath)}`; const result = { file_id: "", path: remoteBase, checksum_file_id: "", checksum_path: `${remoteBase}.sha256`, file_status: "pending", checksum_status: "pending", integrity_status: "not_verified" }; try { const excel = await this.client.uploadFile(local.localPath, result.path); result.file_id = excel.file_id || ""; result.path = excel.path || result.path; result.file_status = "success"; const checksum = await this.client.uploadFile(local.sidecarPath, result.checksum_path); result.checksum_file_id = checksum.file_id || ""; result.checksum_path = checksum.path || result.checksum_path; result.checksum_status = "success"; const downloaded = await this.client.downloadFile(result.path); const downloadedChecksum = await this.client.downloadFile(result.checksum_path); verifyPayloadPair(downloaded, downloadedChecksum, path.basename(local.localPath)); result.integrity_status = "verified"; return result; } catch (error) { if (result.file_status === "pending") result.file_status = "failed"; else if (result.checksum_status === "pending") result.checksum_status = "failed"; if (result.file_status === "success" && result.checksum_status === "success") result.integrity_status = "failed"; throw new BaiduError(error.code || "BAIDU_PAIR_UPLOAD_FAILED", error.message || "百度网盘成对上传失败", { remote: result, cause_code: error.code || "BAIDU_PAIR_UPLOAD_FAILED" }); } }
  async downloadVerified(record) { if (/\.enc$/i.test(record.remote_path || "")) throw new BaiduError("BAIDU_LEGACY_ENCRYPTED_BACKUP", "旧版加密远端备份不能作为普通 Excel 下载"); if (!record.remote_path) throw new BaiduError("BAIDU_REMOTE_EXCEL_MISSING", "远端 Excel 路径缺失"); if (!record.remote_checksum_path) throw new BaiduError("BAIDU_CHECKSUM_MISSING", "远端 SHA-256 校验文件路径缺失"); const excel = await this.client.downloadFile(record.remote_path); const checksum = await this.client.downloadFile(record.remote_checksum_path); const verification = verifyPayloadPair(excel, checksum, path.basename(record.remote_path)); return { excel, verification }; }
  async delete(record) { const result = { excel: record.remote_path ? "pending" : "not_present", checksum: record.remote_checksum_path ? "pending" : "not_present" }; if (record.remote_path) { try { await this.client.deleteFile(record.remote_path); result.excel = "deleted"; } catch { result.excel = "delete_failed"; } } if (record.remote_checksum_path) { try { await this.client.deleteFile(record.remote_checksum_path); result.checksum = "deleted"; } catch { result.checksum = "delete_failed"; } } return result; }
}

module.exports = { DEFAULT_ENDPOINTS, BLOCK_SIZE, BaiduError, BaiduConfigStore, TokenStore, BaiduClient, BaiduBackupManager, safeRemotePath, fileBlocks, sha256File, parseChecksum, verifyPayloadPair };
