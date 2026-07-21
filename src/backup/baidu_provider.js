const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { encryptFile } = require("./encryption");

const DEFAULT_ENDPOINTS = Object.freeze({
  authorize: "https://openapi.baidu.com/oauth/2.0/authorize",
  token: "https://openapi.baidu.com/oauth/2.0/token",
  xpan: "https://pan.baidu.com/rest/2.0/xpan",
  upload: "https://d.pcs.baidu.com/rest/2.0/pcs/superfile2",
});
const BLOCK_SIZE = 4 * 1024 * 1024;
class BaiduError extends Error { constructor(code, message, details = {}) { super(message); this.name = "BaiduError"; this.code = code; this.details = details; } }
function safeRemotePath(value) { const normalized = path.posix.normalize(`/${String(value || "").replaceAll("\\", "/")}`).replace(/\0/g, ""); if (!normalized.startsWith("/apps/") || normalized.includes("..")) throw new BaiduError("BAIDU_REMOTE_PATH_INVALID", "百度网盘目录必须位于/apps/下"); return normalized; }
function fileBlocks(filename) { const fd = fs.openSync(filename, "r"); const hashes = []; const buffer = Buffer.allocUnsafe(BLOCK_SIZE); try { let length; while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hashes.push(crypto.createHash("md5").update(buffer.subarray(0, length)).digest("hex")); } finally { fs.closeSync(fd); } return hashes; }
function formBody(values) { const body = new URLSearchParams(); for (const [key, value] of Object.entries(values)) body.set(key, typeof value === "string" ? value : JSON.stringify(value)); return body; }

class TokenStore {
  constructor(filename) { this.filename = path.resolve(filename); }
  read() { try { const value = JSON.parse(fs.readFileSync(this.filename, "utf8")); return value?.access_token ? value : null; } catch { return null; } }
  write(token) { const directory = path.dirname(this.filename); fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); try { fs.chmodSync(directory, 0o700); } catch {} const temporary = `${this.filename}.tmp-${process.pid}-${crypto.randomUUID()}`; fs.writeFileSync(temporary, JSON.stringify(token), { flag: "wx", mode: 0o600 }); fs.chmodSync(temporary, 0o600); fs.renameSync(temporary, this.filename); }
  clear() { try { fs.rmSync(this.filename, { force: true }); } catch {} }
  status() { const token = this.read(); if (!token) return "not_authorized"; return Number(token.expires_at || 0) > Date.now() + 60_000 ? "authorized" : token.refresh_token ? "refresh_required" : "authorization_expired"; }
  tokenStatus() { const token = this.read(); if (!token) return "not_found"; return Number(token.expires_at || 0) > Date.now() + 60_000 ? "valid" : token.refresh_token ? "refresh_required" : "expired"; }
}

class BaiduClient {
  constructor({ appKey, appSecret, redirectUri, tokenStore, fetchImpl = fetch, endpoints = DEFAULT_ENDPOINTS }) { this.appKey = appKey; this.appSecret = appSecret; this.redirectUri = redirectUri; this.tokenStore = tokenStore; this.fetch = fetchImpl; this.endpoints = { ...DEFAULT_ENDPOINTS, ...endpoints }; }
  assertConfigured() { if (!this.appKey || !this.appSecret || !this.redirectUri) throw new BaiduError("BAIDU_NOT_CONFIGURED", "百度网盘应用尚未配置"); }
  authorizationUrl(state) { this.assertConfigured(); const url = new URL(this.endpoints.authorize); url.search = new URLSearchParams({ response_type: "code", client_id: this.appKey, redirect_uri: this.redirectUri, state, scope: "basic,netdisk" }); return url.toString(); }
  async tokenRequest(parameters) { this.assertConfigured(); const url = new URL(this.endpoints.token); url.search = new URLSearchParams({ ...parameters, client_id: this.appKey, client_secret: this.appSecret }); const response = await this.fetch(url, { method: "GET", cache: "no-store" }); const data = await response.json().catch(() => ({})); if (!response.ok || data.error) throw new BaiduError("BAIDU_OAUTH_FAILED", "百度网盘授权失败", { provider_code: String(data.error || response.status) }); const token = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + Number(data.expires_in || 0) * 1000, scope: data.scope || "" }; this.tokenStore.write(token); return token; }
  exchangeCode(code) { return this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: this.redirectUri }); }
  refresh(refreshToken) { return this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }); }
  async accessToken() { let token = this.tokenStore.read(); if (!token) throw new BaiduError("BAIDU_AUTHORIZATION_REQUIRED", "百度网盘需要授权"); if (Number(token.expires_at || 0) <= Date.now() + 60_000) { if (!token.refresh_token) throw new BaiduError("BAIDU_AUTHORIZATION_EXPIRED", "百度网盘授权已过期"); token = await this.refresh(token.refresh_token); } return token.access_token; }
  async apiJson(url, options = {}) { const response = await this.fetch(url, options); const data = await response.json().catch(() => ({})); if (!response.ok || Number(data.errno || 0) !== 0) throw new BaiduError("BAIDU_API_FAILED", "百度网盘接口调用失败", { provider_code: String(data.errno ?? response.status) }); return data; }
  async testConnection() { const accessToken = await this.accessToken(); const url = new URL(`${this.endpoints.xpan}/nas`); url.search = new URLSearchParams({ method: "uinfo", access_token: accessToken }); await this.apiJson(url); return { ok: true }; }
  async uploadFile(localPath, remotePath) {
    const accessToken = await this.accessToken(); const target = safeRemotePath(remotePath); const size = fs.statSync(localPath).size; const blocks = fileBlocks(localPath);
    const preUrl = new URL(`${this.endpoints.xpan}/file`); preUrl.search = new URLSearchParams({ method: "precreate", access_token: accessToken });
    const pre = await this.apiJson(preUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: formBody({ path: target, size, isdir: 0, autoinit: 1, rtype: 3, block_list: blocks }) });
    const uploadId = pre.uploadid; if (!uploadId) throw new BaiduError("BAIDU_UPLOAD_PRECREATE_FAILED", "百度网盘上传预创建失败");
    const fd = fs.openSync(localPath, "r"); const buffer = Buffer.allocUnsafe(BLOCK_SIZE);
    try { for (let index = 0; index < blocks.length; index += 1) { const length = fs.readSync(fd, buffer, 0, buffer.length, index * BLOCK_SIZE); const form = new FormData(); form.append("file", new Blob([buffer.subarray(0, length)]), path.posix.basename(target)); const uploadUrl = new URL(this.endpoints.upload); uploadUrl.search = new URLSearchParams({ method: "upload", access_token: accessToken, type: "tmpfile", path: target, uploadid: uploadId, partseq: String(index) }); await this.apiJson(uploadUrl, { method: "POST", body: form }); } }
    finally { fs.closeSync(fd); }
    const createUrl = new URL(`${this.endpoints.xpan}/file`); createUrl.search = new URLSearchParams({ method: "create", access_token: accessToken }); const result = await this.apiJson(createUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: formBody({ path: target, size, isdir: 0, rtype: 3, uploadid: uploadId, block_list: blocks }) });
    return { file_id: String(result.fs_id || ""), path: target };
  }
  async deleteFile(remotePath) { const accessToken = await this.accessToken(); const target = safeRemotePath(remotePath); const url = new URL(`${this.endpoints.xpan}/file`); url.search = new URLSearchParams({ method: "filemanager", opera: "delete", async: "0", access_token: accessToken }); await this.apiJson(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: formBody({ filelist: [target] }) }); return { ok: true }; }
}

class BaiduBackupManager {
  constructor({ dataDir, appKey = process.env.BAIDU_APP_KEY, appSecret = process.env.BAIDU_APP_SECRET, redirectUri = process.env.BAIDU_REDIRECT_URI, encryptionKey = process.env.BACKUP_ENCRYPTION_KEY, fetchImpl, endpoints } = {}) {
    this.dataDir = path.resolve(dataDir); this.encryptionKey = encryptionKey; this.states = new Map(); this.lastTestAt = ""; this.lastTestResult = "not_tested"; this.tokenStore = new TokenStore(path.join(this.dataDir, "backups", "full-excel", ".secrets", "baidu-token.json")); this.client = new BaiduClient({ appKey, appSecret, redirectUri, tokenStore: this.tokenStore, fetchImpl, endpoints });
  }
  configurationStatus() {
    const fields = {
      BAIDU_APP_KEY: Boolean(this.client.appKey),
      BAIDU_APP_SECRET: Boolean(this.client.appSecret),
      BAIDU_REDIRECT_URI: Boolean(this.client.redirectUri),
      BACKUP_ENCRYPTION_KEY: Boolean(this.encryptionKey),
    };
    const missingItems = Object.entries(fields).filter(([, configured]) => !configured).map(([name]) => name);
    const oauthConfigured = fields.BAIDU_APP_KEY && fields.BAIDU_APP_SECRET && fields.BAIDU_REDIRECT_URI;
    const tokenStatus = oauthConfigured ? this.tokenStore.tokenStatus() : "not_configured";
    const authorizationStatus = tokenStatus === "valid" || tokenStatus === "refresh_required" ? "authorized" : tokenStatus === "expired" ? "expired" : "not_authorized";
    const status = missingItems.length ? "not_configured" : this.tokenStore.status();
    return {
      app_key_configured: fields.BAIDU_APP_KEY,
      app_secret_configured: fields.BAIDU_APP_SECRET,
      redirect_uri_configured: fields.BAIDU_REDIRECT_URI,
      encryption_key_configured: fields.BACKUP_ENCRYPTION_KEY,
      oauth_configured: oauthConfigured,
      encryption_configured: fields.BACKUP_ENCRYPTION_KEY,
      authorized: authorizationStatus === "authorized",
      authorization_status: authorizationStatus,
      token_status: tokenStatus,
      redirect_uri: fields.BAIDU_REDIRECT_URI ? String(this.client.redirectUri) : "",
      callback_route: "/api/data-center/baidu/callback",
      missing_items: missingItems,
      last_test_at: this.lastTestAt,
      last_test_result: this.lastTestResult,
      status,
    };
  }
  configured() { const status = this.configurationStatus(); return status.oauth_configured && status.encryption_configured; }
  status() { return this.configurationStatus().status; }
  beginAuthorization() { if (!this.configured()) throw new BaiduError("BAIDU_CONFIGURATION_INCOMPLETE", "请先完成百度应用、回调地址和备份加密密钥配置"); const state = crypto.randomBytes(32).toString("hex"); this.states.set(state, Date.now() + 10 * 60_000); return { authorization_url: this.client.authorizationUrl(state), state_expires_in: 600 }; }
  async finishAuthorization(code, state) { const expiry = this.states.get(String(state)); this.states.delete(String(state)); if (!expiry || expiry < Date.now()) throw new BaiduError("BAIDU_OAUTH_STATE_INVALID", "百度授权state无效或已过期"); await this.client.exchangeCode(String(code)); return { ok: true, status: this.status() }; }
  disconnect() { this.tokenStore.clear(); return { ok: true, status: this.status() }; }
  async testConnection() {
    if (!this.configured()) throw new BaiduError("BAIDU_CONFIGURATION_INCOMPLETE", "请先完成百度应用、回调地址和备份加密密钥配置");
    this.lastTestAt = new Date().toISOString();
    try { const result = await this.client.testConnection(); this.lastTestResult = "success"; return result; }
    catch (error) { this.lastTestResult = String(error?.code || "failed").replace(/[^A-Z0-9_-]/gi, "_").slice(0, 100); throw error; }
  }
  async upload({ record, localPath, remoteDirectory }) { if (!this.configured()) throw new BaiduError("BAIDU_NOT_CONFIGURED", "百度网盘或加密密钥尚未配置"); const temporary = path.join(path.dirname(localPath), `.remote-${record.id}-${crypto.randomUUID()}.xlsx.enc`); try { await encryptFile({ inputPath: localPath, outputPath: temporary, key: this.encryptionKey }); const remotePath = `${safeRemotePath(remoteDirectory)}/${path.basename(localPath)}.enc`; return await this.client.uploadFile(temporary, remotePath); } finally { try { fs.rmSync(temporary, { force: true }); } catch {} } }
}

module.exports = { DEFAULT_ENDPOINTS, BLOCK_SIZE, BaiduError, TokenStore, BaiduClient, BaiduBackupManager, safeRemotePath, fileBlocks };
