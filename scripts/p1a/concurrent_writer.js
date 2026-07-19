"use strict";

const { DatabaseSync } = require("node:sqlite");

const databasePath = process.argv[2];
const intervalMs = Math.max(1, Number(process.argv[3]) || 2);
let db;
let timer;
let stopped = false;
let sequence = 0;

function send(message) {
  if (typeof process.send === "function" && process.connected) process.send(message);
}

function closeAndExit(code = 0) {
  if (stopped) return;
  stopped = true;
  if (timer) clearInterval(timer);
  try {
    db?.close();
  } finally {
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
        send({ type: "commit", sequence });
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      send({ type: "error", code: error?.code || "WRITE_FAILED" });
      closeAndExit(2);
    }
  }, intervalMs);

  send({ type: "ready", sequence });
} catch (error) {
  send({ type: "error", code: error?.code || "OPEN_FAILED" });
  closeAndExit(2);
}

process.on("message", (message) => {
  if (message?.type === "stop") closeAndExit(0);
});
process.on("SIGTERM", () => closeAndExit(0));
process.on("SIGINT", () => closeAndExit(0));
