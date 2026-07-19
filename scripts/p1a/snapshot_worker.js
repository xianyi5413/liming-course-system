"use strict";

const { createSnapshot } = require("./sqlite_snapshot");

const maxRuntimeMs = Math.max(100, Math.min(60000, Number(process.env.P1A_WORKER_MAX_MS) || 15000));
let stopped = false;
const deadline = setTimeout(() => shutdown(124, "hard-timeout"), maxRuntimeMs);

function send(message) {
  if (typeof process.send === "function" && process.connected) {
    try { process.send(message); } catch { /* parent may already be gone */ }
  }
}

function shutdown(code, reason) {
  if (stopped) return;
  stopped = true;
  clearTimeout(deadline);
  send({ type: "stopping", reason });
  process.exit(code);
}

async function main() {
  const sourcePath = process.argv[2];
  const targetPath = process.argv[3];
  const strategy = process.argv[4] || "online";
  const rate = Math.max(1, Number(process.env.P1A_BACKUP_RATE) || 1);
  const holdAfterSnapshotMs = Math.max(0, Number(process.env.P1A_HOLD_AFTER_SNAPSHOT_MS) || 0);
  const testBlockMs = process.env.P1A_ALLOW_TEST_BLOCK === "1"
    ? Math.max(0, Math.min(5000, Number(process.env.P1A_TEST_BLOCK_MS) || 0))
    : 0;

  if (testBlockMs) {
    send({ type: "blocking", milliseconds: testBlockMs });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, testBlockMs);
  }

  const result = await createSnapshot({
    sourcePath,
    targetPath,
    strategy,
    rate,
    holdAfterSnapshotMs,
    onProgress(progress) {
      send({ type: "progress", ...progress });
    },
    onSnapshotReady({ stagingPath }) {
      send({ type: "snapshot-ready", stagingFile: require("node:path").basename(stagingPath) });
    },
  });
  send({ type: "complete", strategy: result.strategy, bytes: result.bytes });
}

process.on("message", (message) => {
  if (message?.type === "stop") shutdown(0, "ipc-stop");
});
process.on("disconnect", () => shutdown(0, "disconnect"));
process.on("SIGINT", () => shutdown(130, "SIGINT"));
process.on("SIGTERM", () => shutdown(143, "SIGTERM"));
process.on("SIGHUP", () => shutdown(129, "SIGHUP"));
process.on("uncaughtException", (error) => {
  send({ type: "error", code: error?.code || "UNCAUGHT_EXCEPTION" });
  shutdown(2, "uncaught-exception");
});
process.on("unhandledRejection", (error) => {
  send({ type: "error", code: error?.code || "UNHANDLED_REJECTION" });
  shutdown(2, "unhandled-rejection");
});

main().then(
  () => shutdown(0, "complete"),
  (error) => {
    send({ type: "error", code: error?.code || "P1A_WORKER_FAILED" });
    shutdown(2, "worker-error");
  },
);
