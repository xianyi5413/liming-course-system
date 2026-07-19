"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const databasePath = process.argv[2];
const intervalMs = Math.max(10, Math.min(1000, Number(process.argv[3]) || 20));
const maxRuntimeMs = Math.max(100, Math.min(60000, Number(process.env.P1A_WRITER_MAX_MS) || 10000));
const maxCommits = Math.max(1, Math.min(10000, Number(process.env.P1A_WRITER_MAX_COMMITS) || 200));
const exitMarker = process.env.P1A_WRITER_EXIT_MARKER || "";
let db;
let timer;
let deadline;
let stopped = false;
let sequence = 0;
let commits = 0;

function send(message) {
  if (typeof process.send === "function" && process.connected) process.send(message);
}

function writeExitMarker(reason) {
  if (!exitMarker) return;
  const resolved = path.resolve(exitMarker);
  const relative = path.relative(path.resolve(os.tmpdir()), resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !path.basename(resolved).startsWith(".p1a-writer-exit-")) return;
  try {
    fs.writeFileSync(resolved, `${reason}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // The marker is test-only evidence; shutdown must not be blocked by it.
  }
}

function closeAndExit(code = 0, reason = "stop") {
  if (stopped) return;
  stopped = true;
  if (timer) clearInterval(timer);
  if (deadline) clearTimeout(deadline);
  try {
    try { db?.exec("ROLLBACK"); } catch { /* no active transaction */ }
    db?.close();
  } finally {
    writeExitMarker(reason);
    process.exit(code);
  }
}

try {
  db = new DatabaseSync(databasePath, { timeout: 5000 });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  sequence = Number(db.prepare("SELECT COALESCE(MAX(sequence_no), 0) AS value FROM synthetic_parent").get().value);
  const insertParent = db.prepare("INSERT INTO synthetic_parent(sequence_no, payload) VALUES (?, ?)");
  const insertChild = db.prepare("INSERT INTO synthetic_child(parent_id, marker) VALUES (?, ?)");

  timer = setInterval(() => {
    try {
      sequence += 1;
      db.exec("BEGIN IMMEDIATE");
      try {
        const parent = insertParent.run(sequence, Buffer.alloc(512, sequence % 251));
        insertChild.run(parent.lastInsertRowid, `concurrent-${sequence}`);
        db.exec("COMMIT");
        commits += 1;
        send({ type: "commit", sequence, commits });
        if (commits >= maxCommits) closeAndExit(0, "max-commits");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      send({ type: "error", code: error?.code || "WRITE_FAILED" });
      closeAndExit(2, "write-error");
    }
  }, intervalMs);

  deadline = setTimeout(() => closeAndExit(0, "max-runtime"), maxRuntimeMs);
  send({ type: "ready", sequence, intervalMs, maxRuntimeMs, maxCommits });
} catch (error) {
  send({ type: "error", code: error?.code || "OPEN_FAILED" });
  closeAndExit(2, "open-error");
}

process.on("message", (message) => {
  if (message?.type === "stop") closeAndExit(0, "ipc-stop");
});
process.on("disconnect", () => closeAndExit(0, "disconnect"));
process.on("SIGTERM", () => closeAndExit(0, "SIGTERM"));
process.on("SIGINT", () => closeAndExit(0, "SIGINT"));
process.on("SIGHUP", () => closeAndExit(0, "SIGHUP"));
process.on("uncaughtException", (error) => {
  send({ type: "error", code: error?.code || "UNCAUGHT_EXCEPTION" });
  closeAndExit(2, "uncaught-exception");
});
process.on("unhandledRejection", (error) => {
  send({ type: "error", code: error?.code || "UNHANDLED_REJECTION" });
  closeAndExit(2, "unhandled-rejection");
});
