"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function createSyntheticDatabase(databasePath, options = {}) {
  const target = path.resolve(databasePath);
  const rows = Math.max(1, Number(options.rows) || 100);
  const payloadBytes = Math.max(32, Number(options.payloadBytes) || 256);
  if (fs.existsSync(target)) throw new Error("Synthetic database target already exists");

  let db;
  try {
    db = new DatabaseSync(target);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE synthetic_parent (
        id INTEGER PRIMARY KEY,
        sequence_no INTEGER NOT NULL UNIQUE,
        payload BLOB NOT NULL
      );
      CREATE TABLE synthetic_child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL UNIQUE,
        marker TEXT NOT NULL,
        FOREIGN KEY (parent_id) REFERENCES synthetic_parent(id)
      );
    `);
    const insertParent = db.prepare(
      "INSERT INTO synthetic_parent(sequence_no, payload) VALUES (?, ?)",
    );
    const insertChild = db.prepare(
      "INSERT INTO synthetic_child(parent_id, marker) VALUES (?, ?)",
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      for (let index = 1; index <= rows; index += 1) {
        const parent = insertParent.run(index, Buffer.alloc(payloadBytes, index % 251));
        insertChild.run(parent.lastInsertRowid, `synthetic-${index}`);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return {
      databasePath: target,
      journalMode: String(db.prepare("PRAGMA journal_mode").get().journal_mode),
      rows,
      payloadBytes,
    };
  } finally {
    db?.close();
  }
}

function syntheticCounts(databasePath) {
  let db;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    return {
      parents: Number(db.prepare("SELECT COUNT(*) AS count FROM synthetic_parent").get().count),
      children: Number(db.prepare("SELECT COUNT(*) AS count FROM synthetic_child").get().count),
      minSequence: Number(db.prepare("SELECT MIN(sequence_no) AS value FROM synthetic_parent").get().value),
      maxSequence: Number(db.prepare("SELECT MAX(sequence_no) AS value FROM synthetic_parent").get().value),
    };
  } finally {
    db?.close();
  }
}

module.exports = {
  createSyntheticDatabase,
  syntheticCounts,
};
