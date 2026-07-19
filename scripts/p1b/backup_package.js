"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { STRATEGIES, createSnapshot } = require("../p1a/sqlite_snapshot");
const {
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
  sha256Buffer,
  sha256File,
} = require("./common");
const { createStoredZip, scanBuffer, scanFile } = require("./zip_store");

const MANIFEST_VERSION = "1.0";
const DEFAULT_SAFETY_MARGIN = 64n * 1024n * 1024n;
const OPTIONAL_COMPONENTS = Object.freeze([
  { sourceName: "source-workbooks", archiveRoot: "files/source-workbooks" },
  { sourceName: "templates", archiveRoot: "files/templates" },
]);
const EXCLUDED_COMPONENTS = Object.freeze([
  { path: "database/active-database-wal", reason: "online_snapshot_excludes_wal" },
  { path: "database/active-database-shm", reason: "online_snapshot_excludes_shm" },
  { path: "files/uploads/", reason: "temporary_uploads_excluded" },
  { path: "files/backups/", reason: "legacy_backups_excluded" },
  { path: "files/debug/", reason: "debug_output_excluded" },
  { path: ".env", reason: "secret_configuration_excluded" },
  { path: ".git/", reason: "repository_metadata_excluded" },
  { path: "node_modules/", reason: "runtime_dependencies_excluded" },
  { path: "repository-source/", reason: "source_code_excluded" },
  { path: "cookies/", reason: "authentication_material_excluded" },
  { path: "sessions/", reason: "authentication_material_excluded" },
  { path: "tokens/", reason: "authentication_material_excluded" },
  { path: "secrets/", reason: "secret_material_excluded" },
  { path: "password-material/", reason: "secret_material_excluded" },
  { path: "git-credentials/", reason: "credentials_and_keys_excluded" },
  { path: "ssh-keys/", reason: "credentials_and_keys_excluded" },
  { path: "docker-credentials/", reason: "credentials_and_keys_excluded" },
  { path: "test-logs/", reason: "test_logs_excluded" },
]);

function validateTrigger(value) {
  const trigger = String(value || "manual");
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(trigger)) {
    throw new P1BError(ERROR_CODES.INVALID_ARGUMENT, "Backup trigger is invalid");
  }
  return trigger;
}

function validateBackupId(value) {
  const backupId = value == null ? crypto.randomUUID() : String(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(backupId)) {
    throw new P1BError(ERROR_CODES.INVALID_ARGUMENT, "Backup ID must be a UUID v4");
  }
  return backupId.toLowerCase();
}

function createTaskId(value) {
  const taskId = value == null ? crypto.randomUUID() : String(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
    throw new P1BError(ERROR_CODES.INVALID_ARGUMENT, "Task ID must be a UUID v4");
  }
  return taskId.toLowerCase();
}

function assertSafeTreeEntry(entryPath, root) {
  assertWithin(root, entryPath);
  const stat = fs.lstatSync(entryPath);
  if (stat.isSymbolicLink()) {
    throw new P1BError(ERROR_CODES.SYMLINK_REJECTED, "Symbolic links are not included in backup packages");
  }
  if (!stat.isFile() && !stat.isDirectory()) {
    throw new P1BError(ERROR_CODES.INVALID_ARGUMENT, "Only regular files and directories can be packaged");
  }
  return stat;
}

function inspectOptionalDirectory(dataRoot, definition) {
  const sourceRoot = path.resolve(dataRoot, definition.sourceName);
  assertWithin(dataRoot, sourceRoot);
  normalizeArchivePath(definition.archiveRoot, { directory: true });
  if (!fs.existsSync(sourceRoot)) {
    return { ...definition, sourceRoot, state: "absent", exists: false, files: [], directories: [], size: 0 };
  }
  const rootStat = fs.lstatSync(sourceRoot);
  if (rootStat.isSymbolicLink()) {
    throw new P1BError(ERROR_CODES.SYMLINK_REJECTED, "Optional backup component cannot be a symbolic link");
  }
  if (!rootStat.isDirectory()) {
    throw new P1BError(ERROR_CODES.INVALID_ARGUMENT, "Optional backup component must be a directory");
  }

  const files = [];
  const directories = [];
  const visit = (directory) => {
    const children = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name));
    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      const stat = assertSafeTreeEntry(absolutePath, sourceRoot);
      const relative = path.relative(sourceRoot, absolutePath).split(path.sep).join("/");
      const archivePath = normalizeArchivePath(`${definition.archiveRoot}/${relative}`, { directory: stat.isDirectory() });
      if (stat.isDirectory()) {
        directories.push({ absolutePath, archivePath });
        visit(absolutePath);
      } else {
        files.push({ absolutePath, archivePath, size: stat.size });
      }
    }
  };
  visit(sourceRoot);
  return {
    ...definition,
    sourceRoot,
    state: files.length || directories.length ? "present" : "empty",
    exists: true,
    files,
    directories,
    size: files.reduce((sum, file) => sum + file.size, 0),
  };
}

function directoryDigest(files) {
  const material = files
    .slice()
    .sort((left, right) => compareText(left.archivePath, right.archivePath))
    .map((file) => `${file.archivePath}\0${file.scan.size}\0${file.scan.sha256}\n`)
    .join("");
  return sha256Buffer(Buffer.from(material, "utf8"));
}

function readSchemaVersion(databasePath) {
  let db;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    return Number(db.prepare("PRAGMA user_version").get().user_version);
  } finally {
    db?.close();
  }
}

function buildRestoreNotes(context) {
  return Buffer.from([
    "LiMing Course System full backup package",
    "",
    `Task ID: ${context.taskId}`,
    `Backup ID: ${context.backupId}`,
    `Created (UTC): ${context.createdAtUtc}`,
    `Created (Asia/Shanghai): ${context.createdAtShanghai}`,
    `Snapshot strategy: ${context.snapshotStrategy}`,
    "",
    "This package contains a validated SQLite snapshot plus approved source workbooks and templates.",
    "It intentionally excludes WAL/SHM files, uploads, legacy backups, logs, source code and secrets.",
    "Verify the ZIP and sidecar with scripts/p1b/verify_backup_cli.js before any restore exercise.",
    "P1B does not implement restoration or overwrite any database.",
    "",
  ].join("\n"), "utf8");
}

function buildManifest(context) {
  return {
    manifest_version: MANIFEST_VERSION,
    task_id: context.taskId,
    backup_id: context.backupId,
    backup_type: "system_full",
    trigger: context.trigger,
    scheduled_for: context.scheduledFor,
    scheduled_for_asia_shanghai: context.scheduledForShanghai,
    created_at_utc: context.createdAtUtc,
    created_at_asia_shanghai: context.createdAtShanghai,
    app_version: context.appVersion,
    app_git_commit: context.appGitCommit,
    node_version: process.versions.node,
    sqlite_version: process.versions.sqlite,
    platform: process.platform,
    architecture: process.arch,
    snapshot_strategy: context.snapshotStrategy,
    database_integrity_check: context.snapshotValidation.integrityCheck,
    database_foreign_key_violation_count: context.snapshotValidation.foreignKeyViolations,
    schema_version_source: "pragma_user_version",
    schema_version: context.schemaVersion,
    components: context.components,
    excluded_components: EXCLUDED_COMPONENTS,
    warnings: context.warnings,
  };
}

function estimateSpace(sourceDatabaseSize, inventories, safetyMargin = DEFAULT_SAFETY_MARGIN) {
  const filesSize = inventories.reduce((sum, inventory) => sum + BigInt(inventory.size), 0n);
  const databaseSize = BigInt(sourceDatabaseSize);
  const estimatedZip = databaseSize + filesSize + 1024n * 1024n;
  return {
    sourceFilesBytes: filesSize,
    estimatedZipBytes: estimatedZip,
    requiredBytes: databaseSize + estimatedZip + safetyMargin,
  };
}

function createPackagePaths(backupRoot, date, backupId) {
  const baseName = `liming-system-full-${formatFilenameTime(date)}-${backupId}`;
  const managedRoot = path.join(path.resolve(backupRoot), MANAGED_NAMESPACE);
  const finalDirectory = path.join(managedRoot, baseName);
  const zipName = `${baseName}.zip`;
  const shaName = `${zipName}.sha256`;
  return { baseName, managedRoot, finalDirectory, zipName, shaName };
}

async function createBackupPackage(options = {}) {
  const sourceDatabase = path.resolve(String(options.sourceDatabase || ""));
  const dataDirectory = path.resolve(String(options.dataDirectory || ""));
  const backupRoot = path.resolve(String(options.backupRoot || ""));
  if (!options.sourceDatabase || !options.dataDirectory || !options.backupRoot) {
    throw new P1BError(ERROR_CODES.INVALID_ARGUMENT, "source database, data directory and backup root are required");
  }
  const strategy = options.snapshotStrategy || STRATEGIES.ONLINE;
  if (!Object.values(STRATEGIES).includes(strategy)) {
    throw new P1BError(ERROR_CODES.INVALID_ARGUMENT, "Unknown SQLite snapshot strategy");
  }
  const sourceInfo = assertExistingPathNoSymlink(sourceDatabase, "file");
  assertExistingPathNoSymlink(dataDirectory, "directory");
  assertExistingPathNoSymlink(backupRoot, "directory");
  if (isWithin(dataDirectory, backupRoot) || isWithin(backupRoot, dataDirectory)) {
    throw new P1BError(ERROR_CODES.PATH_OUTSIDE_ROOT, "Backup root and data directory must be separate");
  }

  const createdAt = options.now instanceof Date ? new Date(options.now) : new Date();
  if (Number.isNaN(createdAt.getTime())) throw new P1BError(ERROR_CODES.INVALID_ARGUMENT, "Backup creation time is invalid");
  const backupId = validateBackupId(options.backupId);
  const taskId = createTaskId(options.taskId);
  const trigger = validateTrigger(options.trigger);
  const scheduledFor = normalizeScheduledFor(options.scheduledFor);
  const scheduledForShanghai = scheduledFor ? formatShanghai(new Date(scheduledFor)) : null;
  const packagePaths = createPackagePaths(backupRoot, createdAt, backupId);
  const inventories = OPTIONAL_COMPONENTS.map((definition) => inspectOptionalDirectory(dataDirectory, definition));
  const estimate = estimateSpace(sourceInfo.stat.size, inventories, BigInt(options.safetyMarginBytes ?? DEFAULT_SAFETY_MARGIN));
  const availableBytes = options.spaceProbe
    ? BigInt(await options.spaceProbe({ backupRoot, requiredBytes: estimate.requiredBytes }))
    : readAvailableBytes(backupRoot);
  if (availableBytes < estimate.requiredBytes) {
    throw new P1BError(ERROR_CODES.SPACE_INSUFFICIENT, "Insufficient space for backup package");
  }

  const managedRoot = ensurePrivateDirectory(packagePaths.managedRoot);
  if (options.cleanupStale !== false) {
    cleanupStaleStaging(managedRoot, { olderThanMs: Number(options.staleAfterMs ?? 24 * 60 * 60 * 1000) });
  }
  if (fs.existsSync(packagePaths.finalDirectory)) {
    throw new P1BError(ERROR_CODES.TARGET_EXISTS, "Backup package target already exists");
  }

  const stagingPath = path.join(managedRoot, `${STAGING_PREFIX}${taskId}`);
  try {
    fs.mkdirSync(stagingPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new P1BError(ERROR_CODES.TARGET_EXISTS, "Backup staging target already exists", { cause: error });
    throw classifyError(error, ERROR_CODES.UNKNOWN, "staging");
  }

  let published = false;
  try {
    await options.hooks?.onStagingReady?.({ taskId, backupId, stagingName: path.basename(stagingPath) });
    const snapshotPath = path.join(stagingPath, ".database-snapshot.sqlite");
    let snapshot;
    try {
      snapshot = await createSnapshot({
        sourcePath: sourceDatabase,
        targetPath: snapshotPath,
        strategy,
        rate: options.snapshotRate,
      });
    } catch (error) {
      throw new P1BError(ERROR_CODES.SNAPSHOT_FAILED, "SQLite snapshot creation failed", { cause: error, stage: "snapshot" });
    }
    await options.hooks?.afterSnapshot?.({ backupId });

    const databaseScan = await scanFile(snapshotPath);
    for (const inventory of inventories) {
      for (const file of inventory.files) file.scan = await scanFile(file.absolutePath);
    }
    const createdAtUtc = createdAt.toISOString();
    const createdAtShanghai = formatShanghai(createdAt);
    const restoreNotes = buildRestoreNotes({
      backupId,
      taskId,
      createdAtUtc,
      createdAtShanghai,
      snapshotStrategy: strategy,
    });
    const restoreNotesScan = scanBuffer(restoreNotes);
    const components = [
      {
        path: "database/liming-local.sqlite",
        type: "file",
        state: "present",
        exists: true,
        size: databaseScan.size,
        sha256: databaseScan.sha256,
      },
    ];
    const warnings = [];
    for (const inventory of inventories) {
      if (inventory.state !== "present") warnings.push(`${inventory.sourceName}:${inventory.state}`);
      components.push({
        path: normalizeArchivePath(inventory.archiveRoot, { directory: true }),
        type: "directory",
        state: inventory.state,
        exists: inventory.exists,
        size: inventory.files.reduce((sum, file) => sum + file.scan.size, 0),
        sha256: inventory.exists ? directoryDigest(inventory.files) : null,
        file_count: inventory.files.length,
      });
      for (const directory of inventory.directories) {
        const descendantFiles = inventory.files.filter((file) => file.archivePath.startsWith(directory.archivePath));
        const descendantDirectories = inventory.directories.filter(
          (candidate) => candidate.archivePath !== directory.archivePath && candidate.archivePath.startsWith(directory.archivePath),
        );
        components.push({
          path: directory.archivePath,
          type: "directory",
          state: descendantFiles.length || descendantDirectories.length ? "present" : "empty",
          exists: true,
          size: descendantFiles.reduce((sum, file) => sum + file.scan.size, 0),
          sha256: directoryDigest(descendantFiles),
          file_count: descendantFiles.length,
        });
      }
      for (const file of inventory.files) {
        components.push({
          path: file.archivePath,
          type: "file",
          state: "present",
          exists: true,
          size: file.scan.size,
          sha256: file.scan.sha256,
        });
      }
    }
    components.push({
      path: "metadata/restore-notes.txt",
      type: "file",
      state: "present",
      exists: true,
      size: restoreNotesScan.size,
      sha256: restoreNotesScan.sha256,
    });
    components.sort((left, right) => compareText(left.path, right.path));
    const schemaVersion = readSchemaVersion(snapshotPath);
    const manifest = buildManifest({
      taskId,
      backupId,
      trigger,
      scheduledFor,
      scheduledForShanghai,
      createdAtUtc,
      createdAtShanghai,
      appVersion: safeVersion(options.appVersion || process.env.APP_VERSION || "0.1.0", "unavailable"),
      appGitCommit: safeGitCommit(options.appGitCommit || process.env.APP_GIT_COMMIT),
      snapshotStrategy: strategy,
      snapshotValidation: snapshot.validation,
      schemaVersion,
      components,
      warnings,
    });
    const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const manifestScan = scanBuffer(manifestBuffer);

    const zipEntries = [
      { kind: "buffer", archivePath: "manifest.json", buffer: manifestBuffer, expected: manifestScan, date: createdAt },
      { kind: "directory", archivePath: "database/", date: createdAt },
      { kind: "file", archivePath: "database/liming-local.sqlite", sourcePath: snapshotPath, expected: databaseScan, date: createdAt },
      { kind: "directory", archivePath: "files/", date: createdAt },
    ];
    for (const inventory of inventories) {
      zipEntries.push({ kind: "directory", archivePath: `${inventory.archiveRoot}/`, date: createdAt });
      for (const directory of inventory.directories) {
        zipEntries.push({ kind: "directory", archivePath: directory.archivePath, date: createdAt });
      }
      for (const file of inventory.files) {
        zipEntries.push({ kind: "file", archivePath: file.archivePath, sourcePath: file.absolutePath, expected: file.scan, date: createdAt });
      }
    }
    zipEntries.push(
      { kind: "directory", archivePath: "metadata/", date: createdAt },
      { kind: "buffer", archivePath: "metadata/restore-notes.txt", buffer: restoreNotes, expected: restoreNotesScan, date: createdAt },
    );

    const stagedZipPath = path.join(stagingPath, packagePaths.zipName);
    const zipResult = await createStoredZip(stagedZipPath, zipEntries, {
      onProgress(progress) {
        options.hooks?.onZipProgress?.({ backupId, ...progress });
      },
    });
    const packageHash = await sha256File(stagedZipPath);
    const stagedShaPath = path.join(stagingPath, packagePaths.shaName);
    fs.writeFileSync(stagedShaPath, `${packageHash.sha256}  ${packagePaths.zipName}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.chmodSync(stagedZipPath, 0o600);
    fs.chmodSync(stagedShaPath, 0o600);
    fs.unlinkSync(snapshotPath);

    await options.hooks?.beforePublish?.({ backupId, zipName: packagePaths.zipName, shaName: packagePaths.shaName });
    if (fs.existsSync(packagePaths.finalDirectory)) {
      throw new P1BError(ERROR_CODES.TARGET_EXISTS, "Backup package target appeared before publication");
    }
    try {
      fs.renameSync(stagingPath, packagePaths.finalDirectory);
    } catch (error) {
      throw new P1BError(ERROR_CODES.PUBLISH_FAILED, "Atomic backup package publication failed", { cause: error, stage: "publish" });
    }
    published = true;

    return {
      ok: true,
      taskId,
      backupId,
      baseName: packagePaths.baseName,
      finalDirectory: packagePaths.finalDirectory,
      zipPath: path.join(packagePaths.finalDirectory, packagePaths.zipName),
      sha256Path: path.join(packagePaths.finalDirectory, packagePaths.shaName),
      manifest,
      packageSha256: packageHash.sha256,
      packageBytes: packageHash.bytes,
      snapshotStrategy: strategy,
      zipEntries: zipResult.entries,
      metrics: {
        zipMaxChunkBytes: zipResult.maxChunkBytes,
        hashMaxChunkBytes: packageHash.maxChunkBytes,
        requiredBytes: estimate.requiredBytes.toString(),
        availableBytes: availableBytes.toString(),
      },
    };
  } catch (error) {
    throw classifyError(error, ERROR_CODES.UNKNOWN, "package");
  } finally {
    if (!published && fs.existsSync(stagingPath)) {
      try {
        safeRemoveStaging(stagingPath, managedRoot);
      } catch {
        // A killed process or cleanup failure leaves only the controlled staging namespace.
      }
    }
  }
}

module.exports = {
  EXCLUDED_COMPONENTS,
  MANIFEST_VERSION,
  OPTIONAL_COMPONENTS,
  buildManifest,
  cleanupStaleStaging,
  createBackupPackage,
  createPackagePaths,
  estimateSpace,
  inspectOptionalDirectory,
};
