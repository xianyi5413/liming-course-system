"use strict";

const {
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
} = require("./model");
const { ERROR_CODES, P2Error, mapSqliteError } = require("./errors");

function pageOptions(options = {}) {
  const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(options.pageSize, 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

class BackupMetadataRepository {
  constructor(database, options = {}) {
    this.database = database;
    this.clock = options.clock;
    this.database.exec("PRAGMA foreign_keys = ON");
  }

  _transaction(operation) {
    try {
      this.database.exec("BEGIN IMMEDIATE");
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* no active transaction */ }
      throw mapSqliteError(error);
    }
  }

  _backupRow(backupId) {
    const value = identifier(backupId, "backup id");
    const row = this.database.prepare("SELECT * FROM backup_sets WHERE backup_id = ?").get(value);
    if (!row) throw new P2Error(ERROR_CODES.NOT_FOUND, "Backup metadata was not found");
    return row;
  }

  _jobRow(runId) {
    const value = identifier(runId, "run id");
    const row = this.database.prepare("SELECT * FROM job_runs WHERE run_id = ?").get(value);
    if (!row) throw new P2Error(ERROR_CODES.NOT_FOUND, "Job metadata was not found");
    return row;
  }

  createBackupSet(input = {}) {
    const createdAt = nowUtc(this.clock);
    const values = {
      backupId: identifier(input.backupId, "backup id"),
      backupType: assertChoice(input.backupType, BACKUP_TYPES, "backup type"),
      trigger: assertChoice(input.trigger, TRIGGERS, "backup trigger"),
      scheduledFor: optionalTimestamp(input.scheduledFor, "scheduled for"),
      createdByUserId: input.createdByUserId == null ? null : nonNegativeInteger(input.createdByUserId, "creator user id"),
    };
    try {
      this.database.prepare(`
        INSERT INTO backup_sets(
          backup_id, backup_type, "trigger", scheduled_for, status, verification_status,
          pinned, note, warning_count, error_code, error_message_safe,
          created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', 'not_verified', 0, '', 0, '', '', ?, ?, ?)
      `).run(values.backupId, values.backupType, values.trigger, values.scheduledFor, values.createdByUserId, createdAt, createdAt);
      return this._backupRow(values.backupId);
    } catch (error) {
      throw mapSqliteError(error);
    }
  }

  updateBackupStatus(backupId, nextStatus, patch = {}) {
    assertChoice(nextStatus, BACKUP_STATUSES, "backup status");
    return this._transaction(() => {
      const current = this._backupRow(backupId);
      assertTransition(current.status, nextStatus, BACKUP_TRANSITIONS, "backup status");
      const merged = {
        startedAt: patch.startedAt === undefined ? current.started_at : optionalTimestamp(patch.startedAt, "started at"),
        completedAt: patch.completedAt === undefined ? current.completed_at : optionalTimestamp(patch.completedAt, "completed at"),
        snapshotStrategy: patch.snapshotStrategy === undefined ? current.snapshot_strategy : safeOptionalText(patch.snapshotStrategy, "snapshot strategy", 64),
        appVersion: patch.appVersion === undefined ? current.app_version : safeOptionalText(patch.appVersion, "app version", 64),
        appGitCommit: patch.appGitCommit === undefined ? current.app_git_commit : safeOptionalText(patch.appGitCommit, "app git commit", 64),
        schemaVersion: patch.schemaVersion === undefined ? current.schema_version : nonNegativeInteger(patch.schemaVersion, "schema version", { nullable: true }),
        manifestVersion: patch.manifestVersion === undefined ? current.manifest_version : nonNegativeInteger(patch.manifestVersion, "manifest version", { nullable: true }),
        packageFilename: patch.packageFilename === undefined ? current.package_filename : (patch.packageFilename == null ? null : packageFilename(patch.packageFilename)),
        packageSize: patch.packageSize === undefined ? current.package_size : nonNegativeInteger(patch.packageSize, "package size", { nullable: true }),
        packageSha256: patch.packageSha256 === undefined ? current.package_sha256 : sha256(patch.packageSha256, "package sha256", { nullable: true }),
        warningCount: patch.warningCount === undefined ? Number(current.warning_count) : nonNegativeInteger(patch.warningCount, "warning count"),
        errorCode: patch.errorCode === undefined ? current.error_code : errorCode(patch.errorCode),
        errorMessage: patch.errorMessage === undefined ? current.error_message_safe : safeErrorMessage(patch.errorMessage),
      };
      if (nextStatus === "creating" && !merged.startedAt) merged.startedAt = nowUtc(this.clock);
      if (["available", "failed", "verification_failed", "deleted"].includes(nextStatus) && !merged.completedAt) merged.completedAt = nowUtc(this.clock);
      if (nextStatus === "available" && (!merged.packageFilename || merged.packageSize == null || !merged.packageSha256)) {
        throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, "Available backups require package filename, size and SHA-256");
      }
      const updatedAt = nowUtc(this.clock);
      this.database.prepare(`
        UPDATE backup_sets SET
          status = ?, started_at = ?, completed_at = ?, snapshot_strategy = ?, app_version = ?, app_git_commit = ?,
          schema_version = ?, manifest_version = ?, package_filename = ?, package_size = ?, package_sha256 = ?,
          warning_count = ?, error_code = ?, error_message_safe = ?, updated_at = ?
        WHERE id = ?
      `).run(
        nextStatus, merged.startedAt, merged.completedAt, merged.snapshotStrategy, merged.appVersion, merged.appGitCommit,
        merged.schemaVersion, merged.manifestVersion, merged.packageFilename, merged.packageSize, merged.packageSha256,
        merged.warningCount, merged.errorCode, merged.errorMessage, updatedAt, current.id,
      );
      return this._backupRow(current.backup_id);
    });
  }

  updateVerificationStatus(backupId, nextStatus, details = {}) {
    assertChoice(nextStatus, VERIFICATION_STATUSES, "verification status");
    return this._transaction(() => {
      const current = this._backupRow(backupId);
      assertTransition(current.verification_status, nextStatus, VERIFICATION_TRANSITIONS, "verification status");
      if (!["available", "verification_failed"].includes(current.status)) {
        throw new P2Error(ERROR_CODES.INVALID_STATE_TRANSITION, "Only published backups can be verified");
      }
      let backupStatus = current.status;
      if (nextStatus === "failed") backupStatus = "verification_failed";
      if (nextStatus === "passed") backupStatus = "available";
      const safeCode = details.errorCode === undefined ? current.error_code : errorCode(details.errorCode);
      const safeMessage = details.errorMessage === undefined ? current.error_message_safe : safeErrorMessage(details.errorMessage);
      this.database.prepare(`
        UPDATE backup_sets
        SET verification_status = ?, status = ?, error_code = ?, error_message_safe = ?, updated_at = ?
        WHERE id = ?
      `).run(nextStatus, backupStatus, safeCode, safeMessage, nowUtc(this.clock), current.id);
      return this._backupRow(current.backup_id);
    });
  }

  registerLocalCopy(backupId, input = {}) {
    return this.registerCopy(backupId, { ...input, storageType: "local" });
  }

  registerCopy(backupId, input = {}) {
    const backup = this._backupRow(backupId);
    const createdAt = nowUtc(this.clock);
    const storageType = assertChoice(input.storageType, STORAGE_TYPES, "storage type");
    const copyStatus = assertChoice(input.copyStatus || "available", COPY_STATUSES, "copy status");
    try {
      const result = this.database.prepare(`
        INSERT INTO backup_copies(
          backup_set_id, storage_type, copy_status, managed_relative_path, size, sha256, verified_at,
          last_error_code, last_error_message_safe, remote_file_id, remote_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        backup.id,
        storageType,
        copyStatus,
        managedRelativePath(input.managedRelativePath),
        nonNegativeInteger(input.size, "copy size", { nullable: true }),
        sha256(input.sha256, "copy sha256", { nullable: true }),
        optionalTimestamp(input.verifiedAt, "copy verified at"),
        errorCode(input.lastErrorCode),
        safeErrorMessage(input.lastErrorMessage),
        safeOptionalText(input.remoteFileId, "remote file id", 255),
        safeOptionalText(input.remoteRevision, "remote revision", 255),
        createdAt,
        createdAt,
      );
      return this.database.prepare("SELECT * FROM backup_copies WHERE id = ?").get(Number(result.lastInsertRowid));
    } catch (error) {
      throw mapSqliteError(error);
    }
  }

  updateCopyStatus(copyId, nextStatus, details = {}) {
    assertChoice(nextStatus, COPY_STATUSES, "copy status");
    return this._transaction(() => {
      const row = this.database.prepare("SELECT * FROM backup_copies WHERE id = ?").get(nonNegativeInteger(copyId, "copy id"));
      if (!row) throw new P2Error(ERROR_CODES.NOT_FOUND, "Backup copy metadata was not found");
      assertTransition(row.copy_status, nextStatus, COPY_TRANSITIONS, "copy status");
      const verifiedAt = details.verifiedAt === undefined ? row.verified_at : optionalTimestamp(details.verifiedAt, "copy verified at");
      const safeCode = details.errorCode === undefined ? row.last_error_code : errorCode(details.errorCode);
      const safeMessage = details.errorMessage === undefined ? row.last_error_message_safe : safeErrorMessage(details.errorMessage);
      this.database.prepare(`
        UPDATE backup_copies SET copy_status = ?, verified_at = ?, last_error_code = ?, last_error_message_safe = ?, updated_at = ? WHERE id = ?
      `).run(nextStatus, verifiedAt, safeCode, safeMessage, nowUtc(this.clock), row.id);
      return this.database.prepare("SELECT * FROM backup_copies WHERE id = ?").get(row.id);
    });
  }

  editNote(backupId, value) {
    const backup = this._backupRow(backupId);
    this.database.prepare("UPDATE backup_sets SET note = ?, updated_at = ? WHERE id = ?")
      .run(note(value), nowUtc(this.clock), backup.id);
    return this._backupRow(backup.backup_id);
  }

  setPinned(backupId, pinned) {
    const backup = this._backupRow(backupId);
    if (backup.status === "deleted") throw new P2Error(ERROR_CODES.INVALID_STATE_TRANSITION, "Deleted backup metadata cannot be pinned");
    this.database.prepare("UPDATE backup_sets SET pinned = ?, updated_at = ? WHERE id = ?")
      .run(pinned === true ? 1 : 0, nowUtc(this.clock), backup.id);
    return this._backupRow(backup.backup_id);
  }

  createJobRun(input = {}) {
    const createdAt = nowUtc(this.clock);
    const backup = input.backupId ? this._backupRow(input.backupId) : null;
    const attempt = input.attempt == null ? 1 : nonNegativeInteger(input.attempt, "attempt");
    const maxAttempts = input.maxAttempts == null ? Math.max(1, attempt) : nonNegativeInteger(input.maxAttempts, "max attempts");
    if (attempt < 1 || maxAttempts < attempt) throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, "job attempt values are invalid");
    try {
      this.database.prepare(`
        INSERT INTO job_runs(
          run_id, job_type, "trigger", scheduled_for, status, attempt, max_attempts, backup_set_id,
          idempotency_key, error_code, error_message_safe, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, '', '', ?, ?)
      `).run(
        identifier(input.runId, "run id"),
        assertChoice(input.jobType, JOB_TYPES, "job type"),
        assertChoice(input.trigger, TRIGGERS, "job trigger"),
        optionalTimestamp(input.scheduledFor, "scheduled for"),
        attempt,
        maxAttempts,
        backup?.id || null,
        input.idempotencyKey == null ? null : stringValue(input.idempotencyKey, "idempotency key", { min: 1, max: 255 }),
        createdAt,
        createdAt,
      );
      return this._jobRow(input.runId);
    } catch (error) {
      throw mapSqliteError(error);
    }
  }

  updateJobStatus(runId, nextStatus, details = {}) {
    assertChoice(nextStatus, JOB_STATUSES, "job status");
    return this._transaction(() => {
      const current = this._jobRow(runId);
      assertTransition(current.status, nextStatus, JOB_TRANSITIONS, "job status");
      let startedAt = details.startedAt === undefined ? current.started_at : optionalTimestamp(details.startedAt, "job started at");
      let finishedAt = details.finishedAt === undefined ? current.finished_at : optionalTimestamp(details.finishedAt, "job finished at");
      if (nextStatus === "running" && !startedAt) startedAt = nowUtc(this.clock);
      if (["success", "failed", "cancelled", "skipped"].includes(nextStatus) && !finishedAt) finishedAt = nowUtc(this.clock);
      let duration = details.durationMs === undefined ? current.duration_ms : nonNegativeInteger(details.durationMs, "duration", { nullable: true });
      if (duration == null && startedAt && finishedAt) duration = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
      this.database.prepare(`
        UPDATE job_runs SET status = ?, started_at = ?, finished_at = ?, error_code = ?, error_message_safe = ?, duration_ms = ?, updated_at = ? WHERE id = ?
      `).run(
        nextStatus,
        startedAt,
        finishedAt,
        details.errorCode === undefined ? current.error_code : errorCode(details.errorCode),
        details.errorMessage === undefined ? current.error_message_safe : safeErrorMessage(details.errorMessage),
        duration,
        nowUtc(this.clock),
        current.id,
      );
      return this._jobRow(current.run_id);
    });
  }

  getBackupById(backupId) {
    const backup = this._backupRow(backupId);
    const copies = this.database.prepare("SELECT * FROM backup_copies WHERE backup_set_id = ? ORDER BY id").all(backup.id);
    return { ...backup, copies };
  }

  listBackupSets(options = {}) {
    const { page, pageSize, offset } = pageOptions(options);
    const total = Number(this.database.prepare("SELECT COUNT(*) AS count FROM backup_sets").get().count);
    const items = this.database.prepare("SELECT * FROM backup_sets ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").all(pageSize, offset);
    return { items, total, page, page_size: pageSize };
  }

  listJobRuns(options = {}) {
    const { page, pageSize, offset } = pageOptions(options);
    const total = Number(this.database.prepare("SELECT COUNT(*) AS count FROM job_runs").get().count);
    const items = this.database.prepare("SELECT * FROM job_runs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").all(pageSize, offset);
    return { items, total, page, page_size: pageSize };
  }

  latestAvailableVerified() {
    const row = this.database.prepare(`
      SELECT * FROM backup_sets
      WHERE status = 'available' AND verification_status = 'passed'
      ORDER BY completed_at DESC, created_at DESC, id DESC
      LIMIT 1
    `).get();
    return row ? this.getBackupById(row.backup_id) : null;
  }

  recordPublishedPackage(input = {}) {
    return this._transaction(() => {
      const now = nowUtc(this.clock);
      const backupId = identifier(input.backupId, "backup id");
      const filename = packageFilename(input.packageFilename);
      const packageHash = sha256(input.packageSha256, "package sha256");
      const packageBytes = nonNegativeInteger(input.packageSize, "package size");
      this.database.prepare(`
        INSERT INTO backup_sets(
          backup_id, backup_type, "trigger", scheduled_for, started_at, completed_at, status, verification_status,
          snapshot_strategy, app_version, app_git_commit, schema_version, manifest_version,
          package_filename, package_size, package_sha256, pinned, note, warning_count,
          error_code, error_message_safe, created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'available', 'not_verified', ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, '', '', ?, ?, ?)
      `).run(
        backupId,
        assertChoice(input.backupType, BACKUP_TYPES, "backup type"),
        assertChoice(input.trigger, TRIGGERS, "backup trigger"),
        optionalTimestamp(input.scheduledFor, "scheduled for"),
        optionalTimestamp(input.startedAt, "started at") || now,
        optionalTimestamp(input.completedAt, "completed at") || now,
        safeOptionalText(input.snapshotStrategy, "snapshot strategy", 64),
        safeOptionalText(input.appVersion, "app version", 64),
        safeOptionalText(input.appGitCommit, "app git commit", 64),
        nonNegativeInteger(input.schemaVersion, "schema version", { nullable: true }),
        nonNegativeInteger(input.manifestVersion, "manifest version", { nullable: true }),
        filename,
        packageBytes,
        packageHash,
        nonNegativeInteger(input.warningCount ?? 0, "warning count"),
        input.createdByUserId == null ? null : nonNegativeInteger(input.createdByUserId, "creator user id"),
        now,
        now,
      );
      const backup = this._backupRow(backupId);
      this.database.prepare(`
        INSERT INTO backup_copies(
          backup_set_id, storage_type, copy_status, managed_relative_path, size, sha256, verified_at,
          last_error_code, last_error_message_safe, remote_file_id, remote_revision, created_at, updated_at
        ) VALUES (?, 'local', 'available', ?, ?, ?, NULL, '', '', NULL, NULL, ?, ?)
      `).run(backup.id, managedRelativePath(input.managedRelativePath), packageBytes, packageHash, now, now);
      return this.getBackupById(backupId);
    });
  }
}

module.exports = { BackupMetadataRepository, pageOptions };
