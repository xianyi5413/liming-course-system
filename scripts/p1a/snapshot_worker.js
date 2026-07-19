"use strict";

const { createSnapshot } = require("./sqlite_snapshot");

function send(message) {
  if (typeof process.send === "function" && process.connected) process.send(message);
}

async function main() {
  const sourcePath = process.argv[2];
  const targetPath = process.argv[3];
  const strategy = process.argv[4] || "online";
  const rate = Math.max(1, Number(process.env.P1A_BACKUP_RATE) || 1);
  const holdAfterSnapshotMs = Math.max(0, Number(process.env.P1A_HOLD_AFTER_SNAPSHOT_MS) || 0);

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

main().then(
  () => process.exit(0),
  (error) => {
    send({ type: "error", code: error?.code || "P1A_WORKER_FAILED" });
    process.exit(2);
  },
);
