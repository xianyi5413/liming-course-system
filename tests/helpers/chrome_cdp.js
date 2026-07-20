const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error("DATA_CENTER_BROWSER_NOT_FOUND: set CHROME_PATH to Chrome or Chromium");
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
    socket.addEventListener("message", (event) => this.onMessage(event));
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
      if (this.failDataCenterOnce && /\/api\/data-center(?:\?.*)?$/.test(request.url || "")) {
        this.failDataCenterOnce = false;
        const body = Buffer.from(JSON.stringify({ error: "DATA_CENTER_TEMPORARY_FAILURE" })).toString("base64");
        this.send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 503, responseHeaders: [{ name: "content-type", value: "application/json" }], body }).catch(() => {});
      } else {
        this.send("Fetch.continueRequest", { requestId: message.params.requestId }).catch(() => {});
      }
    }
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
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

async function launchChrome(profileDirectory) {
  const port = await freePort();
  const child = spawn(chromeExecutable(), [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let startupError = "";
  child.stderr.on("data", (chunk) => { startupError += String(chunk); });
  let target;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Chrome exited during startup: ${startupError.slice(0, 500)}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (target) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!target) { child.kill("SIGTERM"); throw new Error("Chrome DevTools endpoint did not become ready"); }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const session = new CdpSession(socket);
  await Promise.all([
    session.send("Page.enable"),
    session.send("Runtime.enable"),
    session.send("Log.enable"),
    session.send("Network.enable"),
    session.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }),
  ]);
  await session.send("Network.setBlockedURLs", { urls: ["https://cdn.jsdelivr.net/*"] });
  return { child, session };
}

module.exports = { freePort, launchChrome };
