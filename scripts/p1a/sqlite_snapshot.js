"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync, backup } = require("node:sqlite");

const STRATEGIES = Object.freeze({
  ONLINE: "online",
  VACUUM_INTO: "vacuum-into",
});

const ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "P1A_INVALID_ARGUMENT",
  RUNTIME_UNSUPPORTED: "P1A_RUNTIME_UNSUPPORTED",
  SOURCE_NOT_FOUND: "P1A_SOURCE_NOT_FOUND",
  TARGET_EXISTS: "P1A_TARGET_EXISTS",
  TARGET_PARENT_MISSING: "P1A_TARGET_PARENT_MISSING",
  SOURCE_TARGET_CONFLICT: "P1A_SOURCE_TARGET_CONFLICT",
  ONLINE_BACKUP_FAILED: "P1A_ONLINE_BACKUP_FAILED",
  VACUUM_INTO_FAILED: "P1A_VACUUM_INTO_FAILED",
  INTEGRITY_FAILED: "P1A_INTEGRITY_FAILED",
  FOREIGN_KEY_FAILED: "P1A_FOREIGN_KEY_FAILED",
  PUBLISH_FAILED: "P1A_PUBLISH_FAILED",
  IO_PERMISSION_DENIED: "P1A_IO_PERMISSION_DENIED",
  CLEANUP_FAILED: "P1A_CLEANUP_FAILED",
  UNKNOWN: "P1A_UNKNOWN",
});

const STAGING_PREFIX = ".p1a-snapshot-";
const STAGING_SUFFIX = ".partial.sqlite";

class SnapshotError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "SnapshotError";
    this.code = code;
    this.strategy = options.strategy || "";
  }
}

function runtimeInfo() {
  return {
    node: process.versions.node,
    sqlite: process.versions.sqlite || "",
    platform: process.platform,
    arch: process.arch,
    onlineBackupAvailable: typeof backup === "function",
  };
}

function assertRuntime(expected = {}) {
  const actual = runtimeInfo();
  const mismatches = [];

  if (!actual.onlineBackupAvailable) mismatches.push("node:sqlite.backup unavailable");
  if (expected.node && actual.node !== expected.node) mismatches.push("Node version mismatch");
  if (expected.sqlite && actual.sqlite !== expected.sqlite) mismatches.push("SQLite version mismatch");
  if (expected.platform && actual.platform !== expected.platform) mismatches.push("platform mismatch");
  if (expected.arch && actual.arch !== expected.arch) mismatches.push("architecture mismatch");

  if (mismatches.length) {
    throw new SnapshotError(
      ERROR_CODES.RUNTIME_UNSUPPORTED,
      `SQLite snapshot runtime check failed: ${mismatches.join(", ")}`,
    );
  }
  return actual;
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function isStagingName(name) {
  return name.startsWith(STAGING_PREFIX) && name.endsWith(STAGING_SUFFIX);
}

function makeStagingPath(targetPath) {
  return path.join(
    path.dirname(targetPath),
    `${STAGING_PREFIX}${process.pid}-${crypto.randomUUID()}${STAGING_SUFFIX}`,
  );
}

function safeUnlink(file) {
  try {
    fs.unlinkSync(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function cleanupStaleArtifacts(directory, options = {}) {
  const root = path.resolve(directory);
  const olderThanMs = Math.max(0, Number(options.olderThanMs) || 0);
  const now = Number(options.now) || Date.now();
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new SnapshotError(ERROR_CODES.TARGET_PARENT_MISSING, "Snapshot staging directory does not exist");
  }

  const removed = [];
  const skipped = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!isStagingName(entry.name)) continue;
    const candidate = path.join(root, entry.name);
    const stat = fs.lstatSync(candidate);
    if (!entry.isFile() || stat.isSymbolicLink()) {
      skipped.push(entry.name);
      continue;
    }
    if (olderThanMs > 0 && now - stat.mtimeMs < olderThanMs) {
      skipped.push(entry.name);
      continue;
    }
    try {
      fs.unlinkSync(candidate);
      removed.push(entry.name);
    } catch (error) {
      throw new SnapshotError(ERROR_CODES.CLEANUP_FAILED, "Failed to remove a recognized staging artifact", {
        cause: error,
      });
    }
  }
  return { removed, skipped };
}

function validateSnapshot(snapshotPath) {
  let db;
  try {
    db = new DatabaseSync(snapshotPath, { readOnly: true });
    const integrityRows = db.prepare("PRAGMA integrity_check").all();
    const integrityMessages = integrityRows.map((row) => String(Object.values(row)[0] || ""));
    if (integrityMessages.length !== 1 || integrityMessages[0].toLowerCase() !== "ok") {
      throw new SnapshotError(ERROR_CODES.INTEGRITY_FAILED, "SQLite integrity_check did not return ok");
    }

    const foreignKeyRows = db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyRows.length) {
      throw new SnapshotError(
        ERROR_CODES.FOREIGN_KEY_FAILED,
        `SQLite foreign_key_check found ${foreignKeyRows.length} violation(s)`,
      );
    }
    return {
      integrityCheck: "ok",
      foreignKeyViolations: 0,
    };
  } catch (error) {
    if (error instanceof SnapshotError) throw error;
    throw new SnapshotError(
      ERROR_CODES.INTEGRITY_FAILED,
      "SQLite integrity validation could not be completed",
      { cause: error },
    );
  } finally {
    db?.close();
  }
}

function classifyFailure(error, strategy) {
  if (error instanceof SnapshotError) return error;
  if (["EACCES", "EPERM", "EROFS"].includes(error?.code)) {
    return new SnapshotError(ERROR_CODES.IO_PERMISSION_DENIED, "Snapshot output is not writable", {
      cause: error,
      strategy,
    });
  }
  const text = String(error?.message || "").toLowerCase();
  if (text.includes("readonly") || text.includes("permission denied") || text.includes("unable to open database file")) {
    return new SnapshotError(ERROR_CODES.IO_PERMISSION_DENIED, "Snapshot output is not writable", {
      cause: error,
      strategy,
    });
  }
  return new SnapshotError(
    strategy === STRATEGIES.VACUUM_INTO
      ? ERROR_CODES.VACUUM_INTO_FAILED
      : strategy === STRATEGIES.ONLINE
        ? ERROR_CODES.ONLINE_BACKUP_FAILED
        : ERROR_CODES.UNKNOWN,
    "SQLite snapshot strategy failed",
    { cause: error, strategy },
  );
}

async function runOnlineBackup(sourcePath, stagingPath, options) {
  assertRuntime(options.expectedRuntime || {});
  let sourceDb;
  try {
    sourceDb = new DatabaseSync(sourcePath, {
      readOnly: true,
      timeout: Math.max(0, Number(options.timeoutMs) || 5000),
    });
    const pages = await backup(sourceDb, stagingPath, {
      rate: Math.max(1, Number(options.rate) || 100),
      progress(progress) {
        options.onProgress?.({
          totalPages: Number(progress.totalPages),
          remainingPages: Number(progress.remainingPages),
        });
      },
    });
    return { pages: Number(pages) };
  } finally {
    sourceDb?.close();
  }
}

function runVacuumInto(sourcePath, stagingPath, options) {
  let sourceDb;
  try {
    sourceDb = new DatabaseSync(sourcePath, {
      readOnly: true,
      timeout: Math.max(0, Number(options.timeoutMs) || 5000),
    });
    sourceDb.exec(`VACUUM INTO ${sqlQuote(stagingPath)}`);
    return { pages: null };
  } finally {
    sourceDb?.close();
  }
}

function publishWithoutOverwrite(stagingPath, targetPath) {
  try {
    // A same-directory hard link publishes the already closed and validated inode
    // atomically while preserving no-overwrite semantics on Windows and Linux.
    fs.linkSync(stagingPath, targetPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new SnapshotError(ERROR_CODES.TARGET_EXISTS, "Snapshot target already exists", { cause: error });
    }
    throw new SnapshotError(ERROR_CODES.PUBLISH_FAILED, "Unable to atomically publish snapshot", { cause: error });
  }
  try {
    safeUnlink(stagingPath);
    return { stagingArtifactRemoved: true };
  } catch {
    // The target already points at the complete validated inode. A leftover
    // marker is safe for the constrained cleanup routine to remove later.
    return { stagingArtifactRemoved: false };
  }
}

async function createSnapshot(options = {}) {
  const sourcePath = path.resolve(String(options.sourcePath || ""));
  const targetPath = path.resolve(String(options.targetPath || ""));
  const strategy = options.strategy || STRATEGIES.ONLINE;
  const startedAt = Date.now();

  if (!options.sourcePath || !options.targetPath) {
    throw new SnapshotError(ERROR_CODES.INVALID_ARGUMENT, "sourcePath and targetPath are required");
  }
  if (!Object.values(STRATEGIES).includes(strategy)) {
    throw new SnapshotError(ERROR_CODES.INVALID_ARGUMENT, "Unknown SQLite snapshot strategy");
  }
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new SnapshotError(ERROR_CODES.SOURCE_NOT_FOUND, "SQLite snapshot source does not exist");
  }
  if (sourcePath === targetPath) {
    throw new SnapshotError(ERROR_CODES.SOURCE_TARGET_CONFLICT, "Snapshot source and target must differ");
  }
  if (fs.existsSync(targetPath)) {
    throw new SnapshotError(ERROR_CODES.TARGET_EXISTS, "Snapshot target already exists");
  }
  const targetDirectory = path.dirname(targetPath);
  if (!fs.existsSync(targetDirectory) || !fs.statSync(targetDirectory).isDirectory()) {
    throw new SnapshotError(ERROR_CODES.TARGET_PARENT_MISSING, "Snapshot target directory does not exist");
  }

  const stagingPath = makeStagingPath(targetPath);
  let strategyResult;
  let published = false;
  try {
    strategyResult = strategy === STRATEGIES.ONLINE
      ? await runOnlineBackup(sourcePath, stagingPath, options)
      : runVacuumInto(sourcePath, stagingPath, options);

    if (!fs.existsSync(stagingPath)) {
      throw new SnapshotError(ERROR_CODES.UNKNOWN, "Snapshot strategy produced no staging file", { strategy });
    }
    fs.chmodSync(stagingPath, 0o600);
    options.onSnapshotReady?.({ stagingPath, strategy });
    if (Number(options.holdAfterSnapshotMs) > 0) {
      await new Promise((resolve) => setTimeout(resolve, Number(options.holdAfterSnapshotMs)));
    }

    const validation = validateSnapshot(stagingPath);
    options.afterValidation?.({ stagingPath, strategy, validation });
    const publication = publishWithoutOverwrite(stagingPath, targetPath);
    published = true;

    return {
      ok: true,
      strategy,
      sourcePath,
      targetPath,
      bytes: fs.statSync(targetPath).size,
      pages: strategyResult.pages,
      validation,
      publication,
      runtime: runtimeInfo(),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    throw classifyFailure(error, strategy);
  } finally {
    if (!published && fs.existsSync(stagingPath)) {
      try {
        safeUnlink(stagingPath);
      } catch {
        // A killed process can leave this recognized marker for the next cleanup pass.
      }
    }
  }
}

module.exports = {
  ERROR_CODES,
  STAGING_PREFIX,
  STAGING_SUFFIX,
  STRATEGIES,
  SnapshotError,
  assertRuntime,
  cleanupStaleArtifacts,
  createSnapshot,
  isStagingName,
  runtimeInfo,
  validateSnapshot,
};
