"use strict";

const path = require("node:path");
const { fork } = require("node:child_process");

const {
  ChildSupervisor,
  installSignalCleanup,
  waitForExit,
  waitForMessage,
} = require("./child_process_safety");

const [mode, databasePath, exitMarker] = process.argv.slice(2);
const writerScript = path.join(__dirname, "concurrent_writer.js");
const supervisor = new ChildSupervisor({ label: "lifecycle writer" });
const removeSignalCleanup = installSignalCleanup(supervisor, { handleDisconnect: true });
let finished = false;

function send(message) {
  if (typeof process.send === "function" && process.connected) {
    try { process.send(message); } catch { /* parent may have exited */ }
  }
}

async function finish(code, reason) {
  if (finished) return;
  finished = true;
  clearTimeout(harnessDeadline);
  removeSignalCleanup();
  try { await supervisor.terminateAll({ requestStop: true }); } catch { code = 2; }
  send({ type: "harness-complete", reason, runningChildren: supervisor.runningCount() });
  process.exit(code);
}

const harnessDeadline = setTimeout(() => finish(124, "harness-timeout"), 8000);

async function main() {
  if (!databasePath || !exitMarker || !["normal", "ipc-disconnect", "hold"].includes(mode)) {
    throw new Error("Invalid lifecycle harness arguments");
  }
  const writer = supervisor.track(fork(writerScript, [databasePath, "20"], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: {
      ...process.env,
      P1A_WRITER_MAX_MS: "2000",
      P1A_WRITER_MAX_COMMITS: "1000",
      P1A_WRITER_EXIT_MARKER: exitMarker,
    },
  }), { label: "lifecycle writer", maxRuntimeMs: 3000 });
  await waitForMessage(writer, (message) => message?.type === "ready", {
    timeoutMs: 3000,
    label: "lifecycle writer",
  });
  send({ type: "writer-ready", writerPid: writer.pid });

  if (mode === "normal") {
    await supervisor.terminate(writer, { requestStop: true });
    await finish(0, "normal");
    return;
  }
  if (mode === "ipc-disconnect") {
    writer.disconnect();
    await waitForExit(writer, 3000, "disconnected lifecycle writer");
    await finish(0, "ipc-disconnect");
    return;
  }
  await new Promise(() => {});
}

process.on("uncaughtException", () => finish(2, "uncaught-exception"));
process.on("unhandledRejection", () => finish(2, "unhandled-rejection"));

main().catch(() => finish(2, "harness-error"));
