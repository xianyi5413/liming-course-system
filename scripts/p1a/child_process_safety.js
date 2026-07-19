"use strict";

const { spawn, spawnSync } = require("node:child_process");

const DEFAULTS = Object.freeze({
  stopGraceMs: 400,
  termGraceMs: 800,
  killWaitMs: 3000,
});

class ChildProcessTimeoutError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ChildProcessTimeoutError";
    this.code = "P1A_CHILD_TIMEOUT";
    this.label = options.label || "child process";
  }
}

function isChildRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function waitForExit(child, timeoutMs = DEFAULTS.killWaitMs, label = "child process") {
  return new Promise((resolve, reject) => {
    if (!isChildRunning(child)) {
      resolve({ code: child?.exitCode ?? null, signal: child?.signalCode ?? null });
      return;
    }
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off("exit", onExit);
      child.off("error", onError);
      if (error) reject(error);
      else resolve(result);
    };
    const onExit = (code, signal) => finish(null, { code, signal });
    const onError = (error) => finish(error);
    const timeout = setTimeout(() => {
      finish(new ChildProcessTimeoutError(`${label} did not exit within its hard deadline`, { label }));
    }, Math.max(1, Number(timeoutMs) || 1));
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function sendIpcStop(child) {
  if (!isChildRunning(child) || !child.connected) return false;
  try {
    child.send({ type: "stop" });
    return true;
  } catch {
    return false;
  }
}

function signalChild(child, signal, options = {}) {
  if (!child?.pid) return false;
  if (options.processGroup && process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      throw error;
    }
  }
  if (options.processGroup && process.platform === "win32" && signal === "SIGKILL") {
    const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 3000,
    });
    return result.status === 0 || !isChildRunning(child);
  }
  try {
    return child.kill(signal);
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function terminateChild(child, options = {}) {
  const label = options.label || "child process";
  const processGroup = options.processGroup === true;
  if (!isChildRunning(child)) return { code: child?.exitCode ?? null, signal: child?.signalCode ?? null, escalated: false };

  if (options.requestStop !== false) {
    sendIpcStop(child);
    try {
      const result = await waitForExit(child, options.stopGraceMs ?? DEFAULTS.stopGraceMs, label);
      if (processGroup) signalChild(child, "SIGKILL", { processGroup });
      return { ...result, escalated: false };
    } catch (error) {
      if (!(error instanceof ChildProcessTimeoutError)) throw error;
    }
  }

  signalChild(child, "SIGTERM", { processGroup });
  try {
    const result = await waitForExit(child, options.termGraceMs ?? DEFAULTS.termGraceMs, label);
    if (processGroup) signalChild(child, "SIGKILL", { processGroup });
    return { ...result, escalated: false };
  } catch (error) {
    if (!(error instanceof ChildProcessTimeoutError)) throw error;
  }

  signalChild(child, "SIGKILL", { processGroup });
  const result = await waitForExit(child, options.killWaitMs ?? DEFAULTS.killWaitMs, label);
  return { ...result, escalated: true };
}

function waitForMessageRaw(child, predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(message);
    };
    const onMessage = (message) => {
      if (message?.type === "error") finish(new Error(`${label} failed with ${message.code || "UNKNOWN"}`));
      else if (predicate(message)) finish(null, message);
    };
    const onError = (error) => finish(error);
    const onExit = (code, signal) => finish(new Error(`${label} exited before the expected message: code=${code} signal=${signal}`));
    const timeout = setTimeout(() => {
      finish(new ChildProcessTimeoutError(`${label} did not send the expected message within its hard deadline`, { label }));
    }, Math.max(1, Number(timeoutMs) || 1));
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function waitForMessage(child, predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const label = options.label || "child process";
  try {
    return await waitForMessageRaw(child, predicate, timeoutMs, label);
  } catch (error) {
    if (error instanceof ChildProcessTimeoutError && isChildRunning(child)) {
      await terminateChild(child, { ...options, label });
    }
    throw error;
  }
}

class ChildSupervisor {
  constructor(options = {}) {
    this.label = options.label || "test child";
    this.children = new Set();
    this.metadata = new WeakMap();
  }

  track(child, options = {}) {
    const label = options.label || this.label;
    const metadata = { label, timedOut: false, timer: null, processGroup: options.processGroup === true };
    this.children.add(child);
    this.metadata.set(child, metadata);
    const cleanup = () => {
      child.off("exit", cleanup);
      child.off("error", cleanup);
      if (metadata.timer) clearTimeout(metadata.timer);
      metadata.timer = null;
      this.children.delete(child);
    };
    child.once("exit", cleanup);
    child.once("error", cleanup);
    if (Number(options.maxRuntimeMs) > 0) {
      metadata.timer = setTimeout(() => {
        metadata.timedOut = true;
        terminateChild(child, { label, requestStop: true, processGroup: metadata.processGroup }).catch(() => {});
      }, Number(options.maxRuntimeMs));
    }
    return child;
  }

  didTimeOut(child) {
    return Boolean(this.metadata.get(child)?.timedOut);
  }

  async terminate(child, options = {}) {
    const metadata = this.metadata.get(child);
    return terminateChild(child, {
      label: metadata?.label || this.label,
      processGroup: metadata?.processGroup || false,
      ...options,
    });
  }

  async terminateAll(options = {}) {
    const children = [...this.children];
    const results = await Promise.allSettled(children.map((child) => this.terminate(child, options)));
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected) throw rejected.reason;
    return results.map((result) => result.value);
  }

  runningCount() {
    return [...this.children].filter(isChildRunning).length;
  }
}

function installSignalCleanup(supervisor, options = {}) {
  let shuttingDown = false;
  const handlers = new Map();
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) {
    const handler = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      try { await supervisor.terminateAll({ requestStop: true }); } catch { /* exit remains non-zero */ }
      process.exit(options.exitCode?.[signal] || (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 129));
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  if (options.handleDisconnect) {
    const handler = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      try { await supervisor.terminateAll({ requestStop: true }); } catch { /* exit remains non-zero */ }
      process.exit(2);
    };
    handlers.set("disconnect", handler);
    process.on("disconnect", handler);
  }
  return () => {
    for (const [event, handler] of handlers) process.off(event, handler);
  };
}

function spawnTestProcess(command, args, options = {}) {
  return spawn(command, args, {
    ...options,
    detached: options.detached ?? process.platform !== "win32",
  });
}

module.exports = {
  ChildProcessTimeoutError,
  ChildSupervisor,
  DEFAULTS,
  installSignalCleanup,
  isChildRunning,
  signalChild,
  spawnTestProcess,
  terminateChild,
  waitForExit,
  waitForMessage,
};
