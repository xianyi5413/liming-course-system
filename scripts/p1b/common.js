"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "P1B_INVALID_ARGUMENT",
  SOURCE_NOT_FOUND: "P1B_SOURCE_NOT_FOUND",
  PATH_OUTSIDE_ROOT: "P1B_PATH_OUTSIDE_ROOT",
  PATH_TRAVERSAL: "P1B_PATH_TRAVERSAL",
  SYMLINK_REJECTED: "P1B_SYMLINK_REJECTED",
  WINDOWS_PATH_INVALID: "P1B_WINDOWS_PATH_INVALID",
  TARGET_EXISTS: "P1B_TARGET_EXISTS",
  SPACE_INSUFFICIENT: "P1B_SPACE_INSUFFICIENT",
  IO_PERMISSION_DENIED: "P1B_IO_PERMISSION_DENIED",
  SNAPSHOT_FAILED: "P1B_SNAPSHOT_FAILED",
  SOURCE_CHANGED: "P1B_SOURCE_CHANGED",
  ZIP_CREATE_FAILED: "P1B_ZIP_CREATE_FAILED",
  ZIP_INVALID: "P1B_ZIP_INVALID",
  ZIP64_UNSUPPORTED: "P1B_ZIP64_UNSUPPORTED",
  MANIFEST_INVALID: "P1B_MANIFEST_INVALID",
  HASH_MISMATCH: "P1B_HASH_MISMATCH",
  DATABASE_INVALID: "P1B_DATABASE_INVALID",
  PUBLISH_FAILED: "P1B_PUBLISH_FAILED",
  CLEANUP_FAILED: "P1B_CLEANUP_FAILED",
  VERIFY_FAILED: "P1B_VERIFY_FAILED",
  INTERRUPTED: "P1B_INTERRUPTED",
  UNKNOWN: "P1B_UNKNOWN",
});

const STAGING_PREFIX = ".p1b-staging-";
const MANAGED_NAMESPACE = "system-v1";
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_FORBIDDEN = /[<>:"\\|?*\u0000-\u001f]/;

class P1BError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "P1BError";
    this.code = code;
    this.stage = options.stage || "";
  }
}

function classifyError(error, fallbackCode = ERROR_CODES.UNKNOWN, stage = "") {
  if (error instanceof P1BError) return error;
  if (["EACCES", "EPERM", "EROFS"].includes(error?.code)) {
    return new P1BError(ERROR_CODES.IO_PERMISSION_DENIED, "Backup output is not writable", {
      cause: error,
      stage,
    });
  }
  if (error?.code === "ENOSPC") {
    return new P1BError(ERROR_CODES.SPACE_INSUFFICIENT, "Insufficient space for backup package", {
      cause: error,
      stage,
    });
  }
  return new P1BError(fallbackCode, "Backup package operation failed", { cause: error, stage });
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertWindowsSegment(segment) {
  if (!segment || segment === "." || segment === "..") {
    throw new P1BError(ERROR_CODES.PATH_TRAVERSAL, "Archive path contains an invalid segment");
  }
  if (
    WINDOWS_FORBIDDEN.test(segment)
    || WINDOWS_RESERVED.test(segment)
    || segment.endsWith(".")
    || segment.endsWith(" ")
  ) {
    throw new P1BError(ERROR_CODES.WINDOWS_PATH_INVALID, "Archive path is not Windows compatible");
  }
}

function normalizeArchivePath(value, options = {}) {
  const raw = String(value || "").replaceAll("\\", "/");
  const directory = Boolean(options.directory);
  if (!raw || raw.startsWith("/") || /^[a-zA-Z]:/.test(raw) || raw.includes("\0")) {
    throw new P1BError(ERROR_CODES.PATH_TRAVERSAL, "Archive path must be relative");
  }
  const parts = raw.split("/").filter((part, index, all) => {
    if (directory && index === all.length - 1 && part === "") return false;
    return true;
  });
  for (const part of parts) assertWindowsSegment(part);
  const normalized = parts.join("/");
  if (!normalized || normalized !== raw.replace(/\/$/, "")) {
    throw new P1BError(ERROR_CODES.PATH_TRAVERSAL, "Archive path normalization changed the path");
  }
  return directory ? `${normalized}/` : normalized;
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertWithin(root, candidate) {
  if (!isWithin(root, candidate)) {
    throw new P1BError(ERROR_CODES.PATH_OUTSIDE_ROOT, "Path is outside the allowed root");
  }
}

function assertExistingPathNoSymlink(inputPath, expectedType) {
  const resolved = path.resolve(inputPath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new P1BError(ERROR_CODES.SOURCE_NOT_FOUND, "Required backup source does not exist", { cause: error });
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new P1BError(ERROR_CODES.SYMLINK_REJECTED, "Symbolic links are not allowed in backup paths");
    }
  }
  const finalStat = fs.statSync(resolved);
  if (expectedType === "file" && !finalStat.isFile()) {
    throw new P1BError(ERROR_CODES.INVALID_ARGUMENT, "Expected a regular file");
  }
  if (expectedType === "directory" && !finalStat.isDirectory()) {
    throw new P1BError(ERROR_CODES.INVALID_ARGUMENT, "Expected a directory");
  }
  return { path: resolved, stat: finalStat };
}

function ensurePrivateDirectory(directory) {
  const resolved = path.resolve(directory);
  if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { mode: 0o700 });
  const checked = assertExistingPathNoSymlink(resolved, "directory");
  if (process.platform !== "win32" && (checked.stat.mode & 0o077) !== 0) {
    throw new P1BError(ERROR_CODES.IO_PERMISSION_DENIED, "Managed backup directory permissions must be 0700");
  }
  return resolved;
}

function safeRemoveStaging(stagingPath, managedRoot) {
  const resolvedRoot = path.resolve(managedRoot);
  const resolvedStaging = path.resolve(stagingPath);
  assertWithin(resolvedRoot, resolvedStaging);
  if (path.dirname(resolvedStaging) !== resolvedRoot || !path.basename(resolvedStaging).startsWith(STAGING_PREFIX)) {
    throw new P1BError(ERROR_CODES.CLEANUP_FAILED, "Refusing to remove a path outside the staging namespace");
  }
  if (fs.existsSync(resolvedStaging)) fs.rmSync(resolvedStaging, { recursive: true, force: true });
}

function cleanupStaleStaging(managedRoot, options = {}) {
  const root = assertExistingPathNoSymlink(managedRoot, "directory").path;
  const olderThanMs = Math.max(0, Number(options.olderThanMs) || 0);
  const now = Number(options.now) || Date.now();
  const removed = [];
  const skipped = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.name.startsWith(STAGING_PREFIX)) continue;
    const candidate = path.join(root, entry.name);
    const stat = fs.lstatSync(candidate);
    if (!entry.isDirectory() || stat.isSymbolicLink() || (olderThanMs > 0 && now - stat.mtimeMs < olderThanMs)) {
      skipped.push(entry.name);
      continue;
    }
    safeRemoveStaging(candidate, root);
    removed.push(entry.name);
  }
  return { removed, skipped };
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  let maxChunkBytes = 0;
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    hash.update(chunk);
    bytes += chunk.length;
    maxChunkBytes = Math.max(maxChunkBytes, chunk.length);
  }
  return { sha256: hash.digest("hex"), bytes, maxChunkBytes };
}

function formatShanghai(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

function formatFilenameTime(date) {
  return formatShanghai(date).replaceAll("-", "").replaceAll(":", "").replace("+08:00", "+0800");
}

function normalizeScheduledFor(value) {
  if (value == null || value === "") return null;
  const text = String(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new P1BError(ERROR_CODES.INVALID_ARGUMENT, "scheduled-for must include an explicit timezone");
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new P1BError(ERROR_CODES.INVALID_ARGUMENT, "scheduled-for is invalid");
  }
  return parsed.toISOString();
}

function safeVersion(value, fallback) {
  const text = String(value || "");
  return /^[A-Za-z0-9._+-]{1,64}$/.test(text) ? text : fallback;
}

function safeGitCommit(value) {
  const text = String(value || "");
  return /^[0-9a-f]{7,64}$/i.test(text) ? text : "unavailable";
}

function readAvailableBytes(directory) {
  const stat = fs.statfsSync(directory, { bigint: true });
  return stat.bavail * stat.bsize;
}

function sanitizeCliError(error) {
  const classified = classifyError(error);
  return { ok: false, error_code: classified.code, message: classified.message };
}

module.exports = {
  ERROR_CODES,
  MANAGED_NAMESPACE,
  P1BError,
  STAGING_PREFIX,
  assertExistingPathNoSymlink,
  assertWithin,
  classifyError,
  cleanupStaleStaging,
  compareText,
  ensurePrivateDirectory,
  formatFilenameTime,
  formatShanghai,
  isWithin,
  normalizeArchivePath,
  normalizeScheduledFor,
  readAvailableBytes,
  safeGitCommit,
  safeRemoveStaging,
  safeVersion,
  sanitizeCliError,
  sha256Buffer,
  sha256File,
};
