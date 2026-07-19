"use strict";

const { ERROR_CODES, P2Error } = require("./errors");

const BACKUP_TYPES = Object.freeze(["daily", "monthly", "manual", "pre_upgrade", "pre_restore"]);
const TRIGGERS = Object.freeze(["manual", "scheduled", "catch_up", "retry", "upgrade", "restore"]);
const BACKUP_STATUSES = Object.freeze(["pending", "creating", "available", "verification_failed", "failed", "missing", "quarantined", "deleted"]);
const VERIFICATION_STATUSES = Object.freeze(["not_verified", "verifying", "passed", "failed"]);
const STORAGE_TYPES = Object.freeze(["local", "baidu_netdisk"]);
const COPY_STATUSES = Object.freeze(["pending", "available", "verifying", "failed", "missing", "deleted"]);
const JOB_TYPES = Object.freeze(["backup_create", "backup_verify", "retention", "restore_test", "remote_upload"]);
const JOB_STATUSES = Object.freeze(["queued", "running", "success", "failed", "cancelled", "skipped"]);

const BACKUP_TRANSITIONS = Object.freeze({
  pending: ["creating", "failed", "deleted"],
  creating: ["available", "failed", "quarantined"],
  available: ["verification_failed", "missing", "quarantined", "deleted"],
  verification_failed: ["available", "missing", "quarantined", "deleted"],
  failed: ["deleted"],
  missing: ["available", "quarantined", "deleted"],
  quarantined: ["available", "deleted"],
  deleted: [],
});

const VERIFICATION_TRANSITIONS = Object.freeze({
  not_verified: ["verifying"],
  verifying: ["passed", "failed"],
  passed: ["verifying"],
  failed: ["verifying"],
});

const COPY_TRANSITIONS = Object.freeze({
  pending: ["available", "failed", "deleted"],
  available: ["verifying", "failed", "missing", "deleted"],
  verifying: ["available", "failed", "missing"],
  failed: ["pending", "deleted"],
  missing: ["available", "deleted"],
  deleted: [],
});

const JOB_TRANSITIONS = Object.freeze({
  queued: ["running", "cancelled", "skipped"],
  running: ["success", "failed", "cancelled"],
  success: [],
  failed: [],
  cancelled: [],
  skipped: [],
});

const WINDOWS_FORBIDDEN = /[<>:"\\|?*\u0000-\u001f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function assertChoice(value, choices, label) {
  if (!choices.includes(value)) throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, `${label} is invalid`);
  return value;
}

function assertTransition(current, next, transitions, label) {
  if (current === next || !transitions[current]?.includes(next)) {
    throw new P2Error(ERROR_CODES.INVALID_STATE_TRANSITION, `${label} transition is not allowed`);
  }
}

function stringValue(value, label, options = {}) {
  const text = String(value ?? "").trim();
  const min = options.min ?? 0;
  const max = options.max ?? 255;
  if (text.length < min || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, `${label} is invalid`);
  }
  return text;
}

function identifier(value, label) {
  const text = stringValue(value, label, { min: 8, max: 128 });
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(text)) throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, `${label} is invalid`);
  return text;
}

function optionalTimestamp(value, label) {
  if (value == null || value === "") return null;
  const text = String(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(text)) throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, `${label} must include a timezone`);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, `${label} is invalid`);
  return parsed.toISOString();
}

function nowUtc(clock) {
  const value = clock ? clock() : new Date();
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, "Clock returned an invalid time");
  return parsed.toISOString();
}

function nonNegativeInteger(value, label, options = {}) {
  if (value == null && options.nullable) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, `${label} is invalid`);
  return number;
}

function sha256(value, label, options = {}) {
  if ((value == null || value === "") && options.nullable) return null;
  const text = String(value || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, `${label} is invalid`);
  return text;
}

function validateWindowsSegment(segment, label) {
  if (!segment || segment === "." || segment === ".." || WINDOWS_FORBIDDEN.test(segment)
    || WINDOWS_RESERVED.test(segment) || segment.endsWith(".") || segment.endsWith(" ")) {
    throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, `${label} is not a safe cross-platform name`);
  }
}

function packageFilename(value) {
  const text = stringValue(value, "package filename", { min: 1, max: 255 });
  if (text.includes("/") || text.includes("\\")) throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, "package filename must not contain a path");
  validateWindowsSegment(text, "package filename");
  return text;
}

function managedRelativePath(value) {
  const text = stringValue(value, "managed relative path", { min: 1, max: 1024 });
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text) || text.includes("\\") || text.includes("//")) {
    throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, "managed path must be a normalized relative path");
  }
  const segments = text.split("/");
  for (const segment of segments) validateWindowsSegment(segment, "managed relative path");
  return segments.join("/");
}

function hasSensitiveMaterial(value) {
  const text = String(value || "");
  return /\b(password|passwd|token|cookie|session|secret|authorization)\b\s*(?:[:=]|\bis\b|\bwas\b)/i.test(text)
    || /\bbearer\s+[A-Za-z0-9._~+\/-]+/i.test(text)
    || /(?:^|\s)[A-Za-z]:[\\/][^\s]*/.test(text)
    || /(?:^|[\s=:])\/(?!\/)[^\s]*/.test(text);
}

function note(value) {
  const text = String(value ?? "").trim();
  if (text.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, "backup note is too long or contains control characters");
  }
  if (hasSensitiveMaterial(text)) throw new P2Error(ERROR_CODES.SENSITIVE_VALUE_REJECTED, "backup note contains sensitive material or an absolute host path");
  return text;
}

function safeErrorMessage(value) {
  let text = String(value ?? "").replace(/[\r\n\t]+/g, " ");
  text = text.replace(/\b(password|passwd|token|cookie|session|secret|authorization)\b\s*(?:[:=]|\bis\b|\bwas\b)\s*[^\s,;]+/gi, "$1=[redacted]");
  text = text.replace(/\bbearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]");
  text = text.replace(/\b[A-Za-z]:[\\/][^\s,;]*/g, "[path]");
  text = text.replace(/(^|[\s=:])\/(?!\/)[^\s,;]*/g, "$1[path]");
  return text.trim().slice(0, 500);
}

function errorCode(value) {
  const text = String(value ?? "").trim();
  if (text && !/^[A-Z0-9_]{1,128}$/.test(text)) throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, "error code is invalid");
  return text;
}

function safeOptionalText(value, label, max = 255) {
  if (value == null || value === "") return null;
  const text = stringValue(value, label, { min: 1, max });
  if (hasSensitiveMaterial(text)) throw new P2Error(ERROR_CODES.SENSITIVE_VALUE_REJECTED, `${label} contains sensitive material`);
  return text;
}

module.exports = {
  BACKUP_STATUSES,
  BACKUP_TRANSITIONS,
  BACKUP_TYPES,
  COPY_STATUSES,
  COPY_TRANSITIONS,
  JOB_STATUSES,
  JOB_TRANSITIONS,
  JOB_TYPES,
  STORAGE_TYPES,
  TRIGGERS,
  VERIFICATION_STATUSES,
  VERIFICATION_TRANSITIONS,
  assertChoice,
  assertTransition,
  errorCode,
  hasSensitiveMaterial,
  identifier,
  managedRelativePath,
  nonNegativeInteger,
  note,
  nowUtc,
  optionalTimestamp,
  packageFilename,
  safeErrorMessage,
  safeOptionalText,
  sha256,
  stringValue,
};
