"use strict";

const path = require("node:path");

const { createBackupPackage } = require("../p1b/backup_package");
const { MANAGED_NAMESPACE } = require("../p1b/common");
const { ERROR_CODES, P2Error } = require("./errors");

function defaultBackupType(trigger) {
  return trigger === "scheduled" || trigger === "catch_up" || trigger === "retry" ? "daily" : "manual";
}

function relativePackagePath(result, backupRoot) {
  const managedRoot = path.join(path.resolve(backupRoot), MANAGED_NAMESPACE);
  const relative = path.relative(managedRoot, path.resolve(result.zipPath)).replaceAll(path.sep, "/");
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new P2Error(ERROR_CODES.INVALID_ARGUMENT, "Published package is outside the managed backup namespace");
  }
  return relative;
}

async function createBackupPackageWithMetadata(backupOptions, metadataOptions = {}) {
  const result = await createBackupPackage(backupOptions);
  const repository = metadataOptions.repository;
  if (!repository) return { ...result, metadata: { recorded: false, reason: "not_configured" } };
  try {
    const record = repository.recordPublishedPackage({
      backupId: result.backupId,
      backupType: metadataOptions.backupType || defaultBackupType(result.manifest.trigger),
      trigger: result.manifest.trigger,
      scheduledFor: result.manifest.scheduled_for,
      startedAt: result.manifest.created_at_utc,
      completedAt: metadataOptions.completedAt || new Date().toISOString(),
      snapshotStrategy: result.snapshotStrategy,
      appVersion: result.manifest.app_version,
      appGitCommit: result.manifest.app_git_commit,
      schemaVersion: result.manifest.schema_version,
      manifestVersion: result.manifest.manifest_version,
      packageFilename: path.basename(result.zipPath),
      packageSize: result.packageBytes,
      packageSha256: result.packageSha256,
      warningCount: result.manifest.warnings.length,
      createdByUserId: metadataOptions.createdByUserId,
      managedRelativePath: relativePackagePath(result, backupOptions.backupRoot),
    });
    return { ...result, metadata: { recorded: true, backup_set_id: record.id } };
  } catch (error) {
    throw new P2Error(ERROR_CODES.METADATA_REGISTRATION_FAILED, "Backup package was published but metadata registration failed", {
      cause: error,
      stage: "metadata-registration",
      packagePublished: true,
      backupId: result.backupId,
    });
  }
}

module.exports = { createBackupPackageWithMetadata, defaultBackupType, relativePackagePath };
