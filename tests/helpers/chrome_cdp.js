const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      // Keep synthetic HTTP servers outside browser/fetch restricted port ranges.
      server.close((error) => error ? reject(error) : resolve(port >= 20000 ? port : freePort()));
    });
  });
}

function browserExecutable(browser = process.env.TEST_BROWSER || "auto", env = process.env) {
  if (!["auto", "edge", "chrome"].includes(browser)) throw new Error("BROWSER_SELECTION_INVALID: use edge, chrome or auto");
  const explicit = browser === "edge" ? env.EDGE_PATH : env.CHROME_PATH;
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`BROWSER_EXECUTABLE_NOT_FOUND: ${explicit}`);
    return explicit;
  }
  const chrome = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const edge = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, "Microsoft/Edge/Application/msedge.exe")] : []),
    "/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  const candidates = browser === "edge" ? edge : browser === "chrome" ? chrome : [...chrome, ...edge];
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error(`BROWSER_NOT_FOUND: ${browser}; set ${browser === "edge" ? "EDGE_PATH" : "CHROME_PATH"}`);
  return executable;
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.consoleErrors = [];
    this.responses = [];
    this.failDataCenterOnce = false;
    this.failPreflightDetailsOnce = false;
    this.baiduTestResult = null;
    this.stageConflictResult = null;
    this.stageConflictDelayOnce = 0;
    socket.addEventListener("message", (event) => this.onMessage(event));
    const rejectPending = () => {
      for (const pending of this.pending.values()) pending.reject(new Error("CDP_CONNECTION_CLOSED"));
      this.pending.clear();
    };
    socket.addEventListener("close", rejectPending);
    socket.addEventListener("error", rejectPending);
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails || {};
      this.exceptions.push(details.exception?.description || details.text || "Uncaught exception");
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      this.consoleErrors.push((message.params.args || []).map((arg) => arg.value || arg.description || "").join(" "));
    }
    if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params?.entry?.level)) {
      this.consoleErrors.push(message.params.entry.text || "Browser log error");
    }
    if (message.method === "Network.responseReceived") {
      const response = message.params?.response || {};
      this.responses.push({ url: response.url || "", status: Number(response.status || 0) });
    }
    if (message.method === "Fetch.requestPaused") {
      const request = message.params?.request || {};
      if ((this.stageConflictResult || this.stageConflictDelayOnce) && /\/api\/student-grade-stages\/conflicts(?:\?.*)?$/.test(request.url || "")) {
        const mocked = this.stageConflictResult || { status: 200, body: { conflicts: [] } };
        this.stageConflictResult = mocked.once === false ? mocked : null;
        const delay = this.stageConflictDelayOnce;
        this.stageConflictDelayOnce = 0;
        const body = Buffer.from(JSON.stringify(mocked.body || {})).toString("base64");
        const fulfill = () => this.send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: mocked.status || 200, responseHeaders: [{ name: "content-type", value: "application/json" }], body }).catch(() => {});
        if (delay > 0) setTimeout(fulfill, delay);
        else fulfill();
      } else if (this.baiduTestResult && /\/api\/data-center\/baidu\/test(?:\?.*)?$/.test(request.url || "")) {
        const mocked = this.baiduTestResult; this.baiduTestResult = mocked.once === false ? mocked : null;
        const body = Buffer.from(JSON.stringify(mocked.body || {})).toString("base64");
        this.send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: mocked.status || 200, responseHeaders: [{ name: "content-type", value: "application/json" }], body }).catch(() => {});
      } else if (this.failPreflightDetailsOnce && /\/api\/data-center\/preflight\/details(?:\?.*)?$/.test(request.url || "")) {
        this.failPreflightDetailsOnce = false;
        const body = Buffer.from(JSON.stringify({ error: "PREFLIGHT_DETAILS_TEMPORARY_FAILURE" })).toString("base64");
        this.send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 503, responseHeaders: [{ name: "content-type", value: "application/json" }], body }).catch(() => {});
      } else if (this.failDataCenterOnce && /\/api\/data-center(?:\?.*)?$/.test(request.url || "")) {
        this.failDataCenterOnce = false;
        const body = Buffer.from(JSON.stringify({ error: "DATA_CENTER_TEMPORARY_FAILURE" })).toString("base64");
        this.send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 503, responseHeaders: [{ name: "content-type", value: "application/json" }], body }).catch(() => {});
      } else {
        this.send("Fetch.continueRequest", { requestId: message.params.requestId }).catch(() => {});
      }
    }
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("CDP_CONNECTION_CLOSED"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        clearTimeout(timer);
        this.pending.delete(id);
        callback(value);
      };
      const timer = setTimeout(() => finish(reject, new Error(`CDP_COMMAND_TIMEOUT: ${method}`)), timeoutMs);
      this.pending.set(id, { resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { finish(reject, error); }
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
    return result.result?.value;
  }

  async waitFor(expression, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      try { if (await this.evaluate(expression)) return; } catch (error) { lastError = error; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`BROWSER_WAIT_TIMEOUT: ${expression}${lastError ? ` (${lastError.message})` : ""}`);
  }

  async click(selector) {
    const value = JSON.stringify(selector);
    const clicked = await this.evaluate(`(() => { const element = document.querySelector(${value}); if (!element) return false; element.click(); return true; })()`);
    if (!clicked) throw new Error(`BROWSER_ELEMENT_NOT_FOUND: ${selector}`);
  }

  async setFileInputFiles(selector, files) {
    const document = await this.send("DOM.getDocument", { depth: 0, pierce: true });
    const result = await this.send("DOM.querySelector", { nodeId: document.root.nodeId, selector });
    if (!result.nodeId) throw new Error(`BROWSER_ELEMENT_NOT_FOUND: ${selector}`);
    await this.send("DOM.setFileInputFiles", { nodeId: result.nodeId, files: files.map((file) => path.resolve(file)) });
  }

  async login(username = "boss", password = "123456") {
    await this.waitFor("Boolean(document.querySelector('.login-panel'))");
    const values = JSON.stringify({ username, password });
    await this.evaluate(`(() => { const values = ${values}; document.querySelector('.login-username').value = values.username; document.querySelector('.login-password').value = values.password; document.querySelector('.login-submit').click(); return true; })()`);
    await this.waitFor("Boolean(document.querySelector('.nav-btn[data-nav-group=\"settings\"]'))");
  }

  async openDataCenter() {
    if (!await this.evaluate("Boolean(document.querySelector('.nav-sub-btn[data-view=\"audit\"]'))")) {
      await this.click('.nav-btn[data-nav-group="settings"]');
      await this.waitFor("Boolean(document.querySelector('.nav-sub-btn[data-view=\"audit\"]'))");
    }
    await this.click('.nav-sub-btn[data-view="audit"]');
  }

  dataCenterResponses() {
    return this.responses.filter((response) => /\/api\/data-center(?:\?.*)?$/.test(response.url));
  }

  async close() {
    try { await this.send("Browser.close"); } catch {}
    try { this.socket.close(); } catch {}
  }
}

async function launchChrome(profileDirectory, options = {}) {
  const browser = options.browser || process.env.TEST_BROWSER || 'auto';
  const executable = browserExecutable(browser);
  let port = 0;
  // Always own a fresh child profile, even when callers supply a directory.
  const parent = path.resolve(profileDirectory || os.tmpdir());
  fs.mkdirSync(parent, { recursive: true });
  const profile = fs.mkdtempSync(path.join(parent, "cdp-"));
  const child = spawn(executable, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let startupError = "";
  let spawnError;
  child.once("error", error => { spawnError = error; });
  child.stderr.on("data", (chunk) => { startupError = (startupError + String(chunk)).slice(-2000); });
  let socket, session;
  const cleanup = async () => {
    if (session) await session.close();
    else if (socket) socket.close();
    if (child.pid && child.exitCode == null && child.signalCode == null) {
      const ended = new Promise(resolve => child.once("exit", resolve));
      child.kill();
      await Promise.race([ended, new Promise(resolve => setTimeout(resolve, 1500))]);
    }
    // Windows may briefly retain Edge child-process handles after the browser exits.
    // A locked temporary profile must not conceal the actual test failure.
    try { await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  };
  try {
  let target;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`BROWSER_START_FAILED: ${spawnError.message}`);
    if (child.exitCode != null) throw new Error(`BROWSER_EXITED: ${startupError.slice(-500)}`);
    try {
      // Browser allocates its own port atomically. The file belongs to our fresh
      // profile, so we cannot accidentally attach to an existing browser.
      port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid DevToolsActivePort');
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      const targets = await response.json();
      target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (target) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!target) throw new Error(`BROWSER_CDP_TIMEOUT: ${executable}; loopback port ${port}; check policy/profile/port conflict; ${startupError.slice(-500)}`);
  const endpoint = new URL(target.webSocketDebuggerUrl);
  if (endpoint.protocol !== "ws:" || endpoint.hostname !== "127.0.0.1" || Number(endpoint.port) !== port) throw new Error("BROWSER_CDP_ENDPOINT_INVALID");
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("BROWSER_WEBSOCKET_TIMEOUT")), 5000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("BROWSER_WEBSOCKET_FAILED")); }, { once: true });
  });
  session = new CdpSession(socket);
  await Promise.all([
    session.send("Page.enable"),
    session.send("Runtime.enable"),
    session.send("Log.enable"),
    session.send("Network.enable"),
    session.send("DOM.enable"),
    session.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }),
  ]);
  await session.send("Network.setBlockedURLs", { urls: ["https://cdn.jsdelivr.net/*"] });
  const version = await session.send("Browser.getVersion");
  if (browser === 'edge' && !version.product.startsWith('Edg/')) throw new Error(`BROWSER_PRODUCT_MISMATCH: expected Edge, got ${version.product}`);
  return { child, session, executable, port, profile, version, close: cleanup };
  } catch (error) {
    await cleanup().catch(() => {});
    throw error;
  }
}

module.exports = { freePort, launchChrome, launchBrowser: launchChrome, browserExecutable, CdpSession };
