"use strict";

const { createBackupPackage } = require("./backup_package");

const [sourceDatabase, dataDirectory, backupRoot, stage, strategy = "online"] = process.argv.slice(2);
let zipSignalSent = false;

function send(message) {
  if (typeof process.send === "function" && process.connected) process.send(message);
}

function blockingHold() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
}

async function asyncHold() {
  await new Promise((resolve) => setTimeout(resolve, 60000));
}

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
    process.exit(0);
  },
  (error) => {
    send({ type: "error", code: error?.code || "P1B_WORKER_FAILED" });
    process.exit(2);
  },
);
