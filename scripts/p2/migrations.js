"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { ERROR_CODES, P2Error } = require("./errors");

const MIGRATION_DEFINITIONS = Object.freeze([
  { version: 2026071901, name: "create_schema_migrations", file: "001_schema_migrations.sql" },
  { version: 2026071902, name: "create_backup_metadata", file: "002_backup_metadata.sql" },
]);

function normalizeSql(sql) {
  return String(sql).replaceAll("\r\n", "\n").trimEnd() + "\n";
}

function migrationChecksum({ version, name, sql }) {
  return crypto.createHash("sha256").update(`${version}\n${name}\n${normalizeSql(sql)}`, "utf8").digest("hex");
}

function loadMigrations(directory = path.join(__dirname, "migrations")) {
  return MIGRATION_DEFINITIONS.map((definition) => {
    const sql = normalizeSql(fs.readFileSync(path.join(directory, definition.file), "utf8"));
    return { ...definition, sql, checksum: migrationChecksum({ ...definition, sql }) };
  });
}

function validateMigrationList(migrations) {
  let previous = -1;
  const versions = new Set();
  const names = new Set();
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version <= previous || versions.has(migration.version) || names.has(migration.name)) {
      throw new P2Error(ERROR_CODES.MIGRATION_ORDER_INVALID, "Migration versions and names must be unique and strictly increasing");
    }
    const expected = migrationChecksum(migration);
    if (migration.checksum && migration.checksum !== expected) {
      throw new P2Error(ERROR_CODES.MIGRATION_CHECKSUM_MISMATCH, "Migration definition checksum is invalid");
    }
    migration.checksum = expected;
    versions.add(migration.version);
    names.add(migration.name);
    previous = migration.version;
  }
}

function tableExists(database, tableName) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function rollbackQuietly(database) {
  try {
    database.exec("ROLLBACK");
  } catch {
    // There is nothing left to roll back when SQLite already aborted the transaction.
  }
}

function applyMigrations(database, options = {}) {
  const migrations = (options.migrations || loadMigrations()).map((migration) => ({ ...migration }));
  validateMigrationList(migrations);
  database.exec("PRAGMA foreign_keys = ON");

  const knownVersions = new Set(migrations.map((migration) => migration.version));
  let appliedRows = [];
  if (tableExists(database, "schema_migrations")) {
    appliedRows = database.prepare("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version").all();
    for (const row of appliedRows) {
      if (!knownVersions.has(Number(row.version))) {
        throw new P2Error(ERROR_CODES.MIGRATION_DATABASE_AHEAD, "Database contains an unknown migration version");
      }
    }
  }

  const appliedByVersion = new Map(appliedRows.map((row) => [Number(row.version), row]));
  let missingAppliedVersion = false;
  for (const migration of migrations) {
    if (!appliedByVersion.has(migration.version)) missingAppliedVersion = true;
    else if (missingAppliedVersion) {
      throw new P2Error(ERROR_CODES.MIGRATION_ORDER_INVALID, "Applied migrations contain a version gap");
    }
  }
  let sawPending = false;
  const newlyApplied = [];
  for (const migration of migrations) {
    const existing = appliedByVersion.get(migration.version);
    if (existing) {
      if (sawPending) {
        throw new P2Error(ERROR_CODES.MIGRATION_ORDER_INVALID, "Applied migrations contain a version gap");
      }
      if (existing.name !== migration.name || existing.checksum !== migration.checksum) {
        throw new P2Error(ERROR_CODES.MIGRATION_CHECKSUM_MISMATCH, "Applied migration checksum does not match the current definition");
      }
      continue;
    }
    sawPending = true;
    const appliedAt = new Date(options.now ? options.now() : Date.now()).toISOString();
    try {
      database.exec("BEGIN IMMEDIATE");
      database.exec(migration.sql);
      if (!tableExists(database, "schema_migrations")) {
        throw new P2Error(ERROR_CODES.MIGRATION_FAILED, "Migration registry was not created");
      }
      database.prepare("INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)")
        .run(migration.version, migration.name, migration.checksum, appliedAt);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
      newlyApplied.push(migration.version);
    } catch (error) {
      rollbackQuietly(database);
      if (error instanceof P2Error) throw error;
      throw new P2Error(ERROR_CODES.MIGRATION_FAILED, `Migration ${migration.version} failed and was rolled back`, {
        cause: error,
        stage: String(migration.version),
      });
    }
  }

  database.exec("PRAGMA foreign_keys = ON");
  return {
    applied: newlyApplied,
    currentVersion: migrations.at(-1)?.version || 0,
    total: migrations.length,
  };
}

module.exports = {
  MIGRATION_DEFINITIONS,
  applyMigrations,
  loadMigrations,
  migrationChecksum,
  normalizeSql,
  tableExists,
  validateMigrationList,
};
