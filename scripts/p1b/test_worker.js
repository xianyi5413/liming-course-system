"use strict";

const { createBackupPackage } = require("./backup_package");

const [sourceDatabase, dataDirectory, backupRoot, stage, strategy = "online"] = process.argv.slice(2);
let zipSignalSent = false;
let stopped = false;
const maxRuntimeMs = Math.max(1000, Math.min(60000, Number(process.env.P1B_WORKER_MAX_MS) || 20000));
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

function blockingHold() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
}

async function asyncHold() {
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

process.on("message", (message) => {
  if (message?.type === "stop") shutdown(0, "ipc-stop");
});
process.on("disconnect", () => shutdown(0, "disconnect"));
process.on("SIGINT", () => shutdown(130, "SIGINT"));
process.on("SIGTERM", () => shutdown(143, "SIGTERM"));
process.on("SIGHUP", () => shutdown(129, "SIGHUP"));
process.on("uncaughtException", () => shutdown(2, "uncaught-exception"));
process.on("unhandledRejection", () => shutdown(2, "unhandled-rejection"));

createBackupPackage({
  sourceDatabase,
  dataDirectory,
  backupRoot,
  snapshotStrategy: strategy,
  trigger: "manual",
  safetyMarginBytes: 0,
  hooks: {
    async onStagingReady() {
      if (stage === "staging") {
        send({ type: "stage", stage });
        await asyncHold();
      }
    },
    onZipProgress(progress) {
      if (stage === "zip" && !zipSignalSent && progress.bytesWritten > 1024) {
        zipSignalSent = true;
        send({ type: "stage", stage });
        blockingHold();
      }
    },
    async beforePublish() {
      if (stage === "publish") {
        send({ type: "stage", stage });
        await asyncHold();
      }
    },
  },
}).then(
  (result) => {
    send({ type: "complete", backupId: result.backupId });
    shutdown(0, "complete");
  },
  (error) => {
    send({ type: "error", code: error?.code || "P1B_WORKER_FAILED" });
    shutdown(2, "worker-error");
  },
);
