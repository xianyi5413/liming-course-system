"use strict";

const ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "P2_INVALID_ARGUMENT",
  MIGRATION_CHECKSUM_MISMATCH: "P2_MIGRATION_CHECKSUM_MISMATCH",
  MIGRATION_ORDER_INVALID: "P2_MIGRATION_ORDER_INVALID",
  MIGRATION_DATABASE_AHEAD: "P2_MIGRATION_DATABASE_AHEAD",
  MIGRATION_FAILED: "P2_MIGRATION_FAILED",
  NOT_FOUND: "P2_NOT_FOUND",
  DUPLICATE: "P2_DUPLICATE",
  FOREIGN_KEY: "P2_FOREIGN_KEY_VIOLATION",
  CONSTRAINT: "P2_CONSTRAINT_VIOLATION",
  INVALID_STATE_TRANSITION: "P2_INVALID_STATE_TRANSITION",
  SENSITIVE_VALUE_REJECTED: "P2_SENSITIVE_VALUE_REJECTED",
  LEGACY_READ_FAILED: "P2_LEGACY_READ_FAILED",
  METADATA_REGISTRATION_FAILED: "P2_METADATA_REGISTRATION_FAILED",
});

class P2Error extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "P2Error";
    this.code = code;
    if (options.stage) this.stage = options.stage;
    if (options.packagePublished === true) this.packagePublished = true;
    if (options.backupId) this.backupId = options.backupId;
  }
}

function mapSqliteError(error, fallbackMessage = "Backup metadata operation failed") {
  if (error instanceof P2Error) return error;
  const message = String(error?.message || "");
  if (/UNIQUE constraint failed/i.test(message)) {
    return new P2Error(ERROR_CODES.DUPLICATE, "Backup metadata already exists", { cause: error });
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return new P2Error(ERROR_CODES.FOREIGN_KEY, "Referenced backup metadata does not exist", { cause: error });
  }
  if (/CHECK constraint failed|NOT NULL constraint failed/i.test(message)) {
    return new P2Error(ERROR_CODES.CONSTRAINT, "Backup metadata violates a database constraint", { cause: error });
  }
  return new P2Error(ERROR_CODES.CONSTRAINT, fallbackMessage, { cause: error });
}

module.exports = { ERROR_CODES, P2Error, mapSqliteError };
