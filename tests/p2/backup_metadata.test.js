"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");

const { createSyntheticDatabase } = require("../../scripts/p1a/synthetic_database");
const { MANAGED_NAMESPACE } = require("../../scripts/p1b/common");
const { createBackupPackage } = require("../../scripts/p1b/backup_package");
const { ERROR_CODES, P2Error } = require("../../scripts/p2/errors");
const { applyMigrations, loadMigrations, tableExists } = require("../../scripts/p2/migrations");
const { BackupMetadataRepository } = require("../../scripts/p2/repository");
const { UnifiedBackupReader, scanLegacySqliteSnapshots } = require("../../scripts/p2/unified_backup_reader");
const { createBackupPackageWithMetadata } = require("../../scripts/p2/p1b_metadata_adapter");

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
let sequence = 0;

function uniqueId(prefix) {
  sequence += 1;
  return `${prefix}-${String(sequence).padStart(8, "0")}`;
}

function migratedDatabase(options = {}) {
  const database = new DatabaseSync(":memory:");
  if (options.legacy) createLegacyTable(database);
  applyMigrations(database);
  return database;
}

function createLegacyTable(database) {
  database.exec(`
    CREATE TABLE backup_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      backup_time TEXT DEFAULT CURRENT_TIMESTAMP,
      backup_type TEXT NOT NULL DEFAULT 'manual',
      included_months INTEGER DEFAULT 0,
      filename TEXT DEFAULT '',
      file_path TEXT DEFAULT '',
      file_size INTEGER DEFAULT 0,
      status TEXT DEFAULT 'success',
      message TEXT DEFAULT '',
      scheduled_date TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function repositoryFixture(options = {}) {
  const database = migratedDatabase(options);
  const clockValues = options.clockValues || ["2026-07-19T01:00:00.000Z"];
  let clockIndex = 0;
  const repository = new BackupMetadataRepository(database, {
    clock: () => new Date(clockValues[Math.min(clockIndex++, clockValues.length - 1)]),
  });
  return { database, repository };
}

function createPending(repository, overrides = {}) {
  return repository.createBackupSet({
    backupId: overrides.backupId || uniqueId("backup"),
    backupType: overrides.backupType || "manual",
    trigger: overrides.trigger || "manual",
    scheduledFor: overrides.scheduledFor,
    createdByUserId: overrides.createdByUserId,
  });
}

function publish(repository, backupId, overrides = {}) {
  repository.updateBackupStatus(backupId, "creating");
  return repository.updateBackupStatus(backupId, "available", {
    completedAt: "2026-07-19T02:00:00+00:00",
    snapshotStrategy: overrides.snapshotStrategy || "online",
    packageFilename: overrides.packageFilename || `${backupId}.zip`,
    packageSize: overrides.packageSize ?? 4096,
    packageSha256: overrides.packageSha256 || HASH_A,
    manifestVersion: 1,
    schemaVersion: 0,
  });
}

function verify(repository, backupId) {
  repository.updateVerificationStatus(backupId, "verifying");
  return repository.updateVerificationStatus(backupId, "passed");
}

function safeRemoveTemp(root, prefix) {
  const resolved = path.resolve(root);
  const relative = path.relative(path.resolve(os.tmpdir()), resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !path.basename(resolved).startsWith(prefix)) {
    throw new Error("Refusing to remove a directory outside the P2 test namespace");
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function withPackageFixture(label, callback) {
  const prefix = `liming-p2-${label}-`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dataDirectory = path.join(root, "synthetic data");
  const backupRoot = path.join(root, "synthetic backups");
  fs.mkdirSync(dataDirectory, { mode: 0o700 });
  fs.mkdirSync(backupRoot, { mode: 0o700 });
  const sourceDatabase = path.join(dataDirectory, "synthetic.sqlite");
  createSyntheticDatabase(sourceDatabase, { rows: 12, payloadBytes: 64 });
  fs.mkdirSync(path.join(dataDirectory, "source-workbooks"), { mode: 0o700 });
  fs.mkdirSync(path.join(dataDirectory, "templates"), { mode: 0o700 });
  fs.writeFileSync(path.join(dataDirectory, "source-workbooks", "synthetic.txt"), "synthetic only", "utf8");
  fs.writeFileSync(path.join(dataDirectory, "templates", "template.txt"), "synthetic template", "utf8");
  const backupOptions = {
    sourceDatabase,
    dataDirectory,
    backupRoot,
    snapshotStrategy: "online",
    trigger: "manual",
    now: new Date("2026-07-19T08:30:00.000Z"),
    backupId: crypto.randomUUID(),
    appVersion: "0.1.0-test",
    appGitCommit: "abcdef1",
    safetyMarginBytes: 0,
    spaceProbe: async () => 1024n * 1024n * 1024n,
  };
  try {
    return await callback({ root, dataDirectory, backupRoot, sourceDatabase, backupOptions });
  } finally {
    safeRemoveTemp(root, prefix.slice(0, -1));
  }
}

test("empty database applies both P2 migrations", () => {
  const database = new DatabaseSync(":memory:");
  try {
    const result = applyMigrations(database);
    assert.deepEqual(result.applied, [2026071901, 2026071902]);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 2);
    assert.equal(database.prepare("PRAGMA user_version").get().user_version, 2026071902);
  } finally { database.close(); }
});

test("migration preserves an existing business table and its synthetic row", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE synthetic_business(id INTEGER PRIMARY KEY, label TEXT NOT NULL); INSERT INTO synthetic_business VALUES (1, 'synthetic')");
    applyMigrations(database);
    assert.deepEqual({ ...database.prepare("SELECT * FROM synthetic_business").get() }, { id: 1, label: "synthetic" });
  } finally { database.close(); }
});

test("migration leaves the legacy backup_records schema and rows unchanged", () => {
  const database = new DatabaseSync(":memory:");
  try {
    createLegacyTable(database);
    database.prepare("INSERT INTO backup_records(filename, file_path, file_size) VALUES (?, ?, ?)").run("archive.zip", "/synthetic/legacy/archive.zip", 123);
    const before = database.prepare("PRAGMA table_info(backup_records)").all().map((row) => row.name);
    applyMigrations(database);
    assert.deepEqual(database.prepare("PRAGMA table_info(backup_records)").all().map((row) => row.name), before);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM backup_records").get().count, 1);
  } finally { database.close(); }
});

test("repeated migration is idempotent", () => {
  const database = migratedDatabase();
  try {
    const second = applyMigrations(database);
    assert.deepEqual(second.applied, []);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 2);
  } finally { database.close(); }
});

test("migration definitions must be strictly ordered", () => {
  const database = new DatabaseSync(":memory:");
  try {
    const migrations = loadMigrations().reverse();
    assert.throws(() => applyMigrations(database, { migrations }), (error) => error.code === ERROR_CODES.MIGRATION_ORDER_INVALID);
  } finally { database.close(); }
});

test("applied migration checksum changes are rejected", () => {
  const database = migratedDatabase();
  try {
    const migrations = loadMigrations();
    migrations[1] = { ...migrations[1], sql: `${migrations[1].sql}\n-- changed`, checksum: undefined };
    assert.throws(() => applyMigrations(database, { migrations }), (error) => error.code === ERROR_CODES.MIGRATION_CHECKSUM_MISMATCH);
  } finally { database.close(); }
});

test("failed migration rolls back its schema and registry row", () => {
  const database = migratedDatabase();
  try {
    const migrations = [...loadMigrations(), {
      version: 2026071903,
      name: "synthetic_failure",
      sql: "CREATE TABLE rollback_probe(id INTEGER); INSERT INTO missing_table VALUES (1);",
    }];
    assert.throws(() => applyMigrations(database, { migrations }), (error) => error.code === ERROR_CODES.MIGRATION_FAILED);
    assert.equal(tableExists(database, "rollback_probe"), false);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 2026071903").get().count, 0);
  } finally { database.close(); }
});

test("an applied migration version gap is rejected before execution", () => {
  const database = new DatabaseSync(":memory:");
  try {
    const migrations = loadMigrations();
    database.exec(migrations[0].sql);
    database.prepare("INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)")
      .run(migrations[1].version, migrations[1].name, migrations[1].checksum, new Date().toISOString());
    assert.throws(() => applyMigrations(database), (error) => error.code === ERROR_CODES.MIGRATION_ORDER_INVALID);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 1);
  } finally { database.close(); }
});

test("unknown future migration versions are rejected", () => {
  const database = migratedDatabase();
  try {
    database.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?, ?)").run(2026071999, "future", "f".repeat(64), new Date().toISOString());
    assert.throws(() => applyMigrations(database), (error) => error.code === ERROR_CODES.MIGRATION_DATABASE_AHEAD);
  } finally { database.close(); }
});

test("foreign keys are enabled after migration", () => {
  const database = migratedDatabase();
  try { assert.equal(database.prepare("PRAGMA foreign_keys").get().foreign_keys, 1); } finally { database.close(); }
});

test("migration creates the three metadata tables and required indexes", () => {
  const database = migratedDatabase();
  try {
    for (const table of ["backup_sets", "backup_copies", "job_runs"]) assert.equal(tableExists(database, table), true);
    const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name);
    assert.ok(indexes.includes("idx_backup_sets_status_created"));
    assert.ok(indexes.includes("idx_backup_copies_storage_status"));
    assert.ok(indexes.includes("idx_job_runs_idempotency"));
  } finally { database.close(); }
});

test("backup_sets contains every P2 contract field", () => {
  const database = migratedDatabase();
  try {
    const actual = new Set(database.prepare("PRAGMA table_info(backup_sets)").all().map((row) => row.name));
    for (const field of [
      "id", "backup_id", "backup_type", "trigger", "scheduled_for", "started_at", "completed_at", "status",
      "verification_status", "snapshot_strategy", "app_version", "app_git_commit", "schema_version", "manifest_version",
      "package_filename", "package_size", "package_sha256", "pinned", "note", "warning_count", "error_code",
      "error_message_safe", "created_by_user_id", "created_at", "updated_at",
    ]) assert.equal(actual.has(field), true, field);
  } finally { database.close(); }
});

test("backup set creation uses pending and not_verified defaults", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository, { createdByUserId: 9 });
    assert.equal(row.status, "pending");
    assert.equal(row.verification_status, "not_verified");
    assert.equal(row.created_by_user_id, 9);
  } finally { database.close(); }
});

test("backup_id is unique", () => {
  const { database, repository } = repositoryFixture();
  try {
    const backupId = uniqueId("duplicate-backup");
    createPending(repository, { backupId });
    assert.throws(() => createPending(repository, { backupId }), (error) => error.code === ERROR_CODES.DUPLICATE);
  } finally { database.close(); }
});

test("backup status follows the legal pending creating available path", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    assert.equal(repository.updateBackupStatus(row.backup_id, "creating").status, "creating");
    assert.equal(repository.updateBackupStatus(row.backup_id, "available", {
      packageFilename: "safe.zip", packageSize: 12, packageSha256: HASH_A,
    }).status, "available");
  } finally { database.close(); }
});

test("backup status rejects arbitrary jumps", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    assert.throws(() => repository.updateBackupStatus(row.backup_id, "available"), (error) => error.code === ERROR_CODES.INVALID_STATE_TRANSITION);
  } finally { database.close(); }
});

test("available backup requires package identity fields", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    repository.updateBackupStatus(row.backup_id, "creating");
    assert.throws(() => repository.updateBackupStatus(row.backup_id, "available"), (error) => error.code === ERROR_CODES.INVALID_ARGUMENT);
    assert.equal(repository.getBackupById(row.backup_id).status, "creating");
  } finally { database.close(); }
});

test("verification status follows not_verified verifying passed", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    publish(repository, row.backup_id);
    assert.equal(repository.updateVerificationStatus(row.backup_id, "verifying").verification_status, "verifying");
    const passed = repository.updateVerificationStatus(row.backup_id, "passed");
    assert.equal(passed.verification_status, "passed");
    assert.equal(passed.status, "available");
  } finally { database.close(); }
});

test("failed verification drives the logical backup to verification_failed", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    publish(repository, row.backup_id);
    repository.updateVerificationStatus(row.backup_id, "verifying");
    const failed = repository.updateVerificationStatus(row.backup_id, "failed", { errorCode: "P2_TEST_FAILURE", errorMessage: "synthetic mismatch" });
    assert.equal(failed.status, "verification_failed");
    assert.equal(failed.verification_status, "failed");
  } finally { database.close(); }
});

test("verification cannot skip the verifying state", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    publish(repository, row.backup_id);
    assert.throws(() => repository.updateVerificationStatus(row.backup_id, "passed"), (error) => error.code === ERROR_CODES.INVALID_STATE_TRANSITION);
  } finally { database.close(); }
});

test("backup notes and pinned state are editable", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    assert.equal(repository.editNote(row.backup_id, "pre-upgrade checkpoint").note, "pre-upgrade checkpoint");
    assert.equal(repository.setPinned(row.backup_id, true).pinned, 1);
    assert.equal(repository.setPinned(row.backup_id, false).pinned, 0);
  } finally { database.close(); }
});

test("backup note length and sensitive material are rejected", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    assert.throws(() => repository.editNote(row.backup_id, "x".repeat(1001)), (error) => error.code === ERROR_CODES.INVALID_ARGUMENT);
    assert.throws(() => repository.editNote(row.backup_id, "token=do-not-store"), (error) => error.code === ERROR_CODES.SENSITIVE_VALUE_REJECTED);
  } finally { database.close(); }
});

test("local backup copy registration stores only a managed relative path", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    publish(repository, row.backup_id);
    const copy = repository.registerLocalCopy(row.backup_id, { managedRelativePath: "package-id/package.zip", size: 4096, sha256: HASH_A });
    assert.equal(copy.storage_type, "local");
    assert.equal(copy.managed_relative_path, "package-id/package.zip");
  } finally { database.close(); }
});

test("duplicate backup copies are rejected", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    const copy = { managedRelativePath: "package-id/package.zip", size: 1, sha256: HASH_A };
    repository.registerLocalCopy(row.backup_id, copy);
    assert.throws(() => repository.registerLocalCopy(row.backup_id, copy), (error) => error.code === ERROR_CODES.DUPLICATE);
  } finally { database.close(); }
});

test("backup_copies foreign key rejects an unknown backup set", () => {
  const database = migratedDatabase();
  try {
    assert.throws(() => database.prepare(`
      INSERT INTO backup_copies(backup_set_id, storage_type, copy_status, managed_relative_path, created_at, updated_at)
      VALUES (999, 'local', 'pending', 'safe/file.zip', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `).run(), /FOREIGN KEY constraint failed/);
  } finally { database.close(); }
});

test("absolute managed paths are rejected", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    for (const unsafe of ["/root/backups/file.zip", "C:\\backups\\file.zip"]) {
      assert.throws(() => repository.registerLocalCopy(row.backup_id, { managedRelativePath: unsafe, size: 1, sha256: HASH_A }), (error) => error.code === ERROR_CODES.INVALID_ARGUMENT);
    }
  } finally { database.close(); }
});

test("path traversal and Windows-unsafe segments are rejected", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    for (const unsafe of ["safe/../escape.zip", "safe/CON", "safe/bad?.zip", "safe//file.zip"]) {
      assert.throws(() => repository.registerLocalCopy(row.backup_id, { managedRelativePath: unsafe, size: 1, sha256: HASH_A }), (error) => error.code === ERROR_CODES.INVALID_ARGUMENT);
    }
  } finally { database.close(); }
});

test("copy state transitions are validated", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    const copy = repository.registerLocalCopy(row.backup_id, { managedRelativePath: "safe/file.zip", size: 1, sha256: HASH_A });
    assert.equal(repository.updateCopyStatus(copy.id, "verifying").copy_status, "verifying");
    assert.equal(repository.updateCopyStatus(copy.id, "available", { verifiedAt: "2026-07-19T03:00:00Z" }).copy_status, "available");
    assert.throws(() => repository.updateCopyStatus(copy.id, "pending"), (error) => error.code === ERROR_CODES.INVALID_STATE_TRANSITION);
  } finally { database.close(); }
});

test("baidu_netdisk remains a neutral pending data-model value", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    const copy = repository.registerCopy(row.backup_id, {
      storageType: "baidu_netdisk", copyStatus: "pending", managedRelativePath: "future/remote.zip", size: null, sha256: null,
    });
    assert.equal(copy.storage_type, "baidu_netdisk");
    assert.equal(copy.copy_status, "pending");
    assert.equal(repository.getBackupById(row.backup_id).status, "pending");
  } finally { database.close(); }
});

test("a failed remote copy does not overwrite an available local copy state", () => {
  const { database, repository } = repositoryFixture();
  try {
    const backupId = uniqueId("local-remote");
    repository.recordPublishedPackage({
      backupId, backupType: "daily", trigger: "scheduled", snapshotStrategy: "online", schemaVersion: 0, manifestVersion: 1,
      packageFilename: "local.zip", packageSize: 8, packageSha256: HASH_A, managedRelativePath: "local/local.zip",
    });
    const remote = repository.registerCopy(backupId, {
      storageType: "baidu_netdisk", copyStatus: "pending", managedRelativePath: "future/local.zip", size: 8, sha256: HASH_A,
    });
    repository.updateCopyStatus(remote.id, "failed", { errorCode: "P2_REMOTE_FAIL", errorMessage: "synthetic remote failure" });
    const backup = repository.getBackupById(backupId);
    assert.equal(backup.status, "available");
    assert.deepEqual(backup.copies.map((copy) => [copy.storage_type, copy.copy_status]), [
      ["local", "available"], ["baidu_netdisk", "failed"],
    ]);
  } finally { database.close(); }
});

test("job run creation reserves queued status and attempt metadata", () => {
  const { database, repository } = repositoryFixture();
  try {
    const backup = createPending(repository);
    const job = repository.createJobRun({ runId: uniqueId("run"), jobType: "backup_create", trigger: "manual", backupId: backup.backup_id, maxAttempts: 4 });
    assert.equal(job.status, "queued");
    assert.equal(job.attempt, 1);
    assert.equal(job.max_attempts, 4);
  } finally { database.close(); }
});

test("run_id and job idempotency keys are unique", () => {
  const { database, repository } = repositoryFixture();
  try {
    const runId = uniqueId("duplicate-run");
    repository.createJobRun({ runId, jobType: "backup_create", trigger: "manual", idempotencyKey: "same-date" });
    assert.throws(() => repository.createJobRun({ runId, jobType: "backup_create", trigger: "manual" }), (error) => error.code === ERROR_CODES.DUPLICATE);
    assert.throws(() => repository.createJobRun({ runId: uniqueId("run"), jobType: "backup_create", trigger: "manual", idempotencyKey: "same-date" }), (error) => error.code === ERROR_CODES.DUPLICATE);
  } finally { database.close(); }
});

test("job status follows queued running success", () => {
  const { database, repository } = repositoryFixture();
  try {
    const job = repository.createJobRun({ runId: uniqueId("run"), jobType: "backup_verify", trigger: "manual" });
    assert.equal(repository.updateJobStatus(job.run_id, "running").status, "running");
    const complete = repository.updateJobStatus(job.run_id, "success");
    assert.equal(complete.status, "success");
    assert.ok(complete.finished_at);
    assert.ok(complete.duration_ms >= 0);
  } finally { database.close(); }
});

test("terminal jobs reject further status changes", () => {
  const { database, repository } = repositoryFixture();
  try {
    const job = repository.createJobRun({ runId: uniqueId("run"), jobType: "backup_create", trigger: "manual" });
    repository.updateJobStatus(job.run_id, "skipped");
    assert.throws(() => repository.updateJobStatus(job.run_id, "running"), (error) => error.code === ERROR_CODES.INVALID_STATE_TRANSITION);
  } finally { database.close(); }
});

test("stored backup errors are redacted and do not retain host paths", () => {
  const { database, repository } = repositoryFixture();
  try {
    const row = createPending(repository);
    const failed = repository.updateBackupStatus(row.backup_id, "failed", {
      errorCode: "P2_SYNTHETIC_FAILURE",
      errorMessage: "password=hunter2 token=abc file=/root/private/database.sqlite mirror=/mnt/private/file C:\\Users\\private\\secret.txt",
    });
    assert.equal(failed.error_code, "P2_SYNTHETIC_FAILURE");
    assert.equal(/hunter2|token=abc|\/root\/|\/mnt\/|C:\\Users/i.test(failed.error_message_safe), false);
  } finally { database.close(); }
});

test("stored job and copy errors use the same redaction policy", () => {
  const { database, repository } = repositoryFixture();
  try {
    const backup = createPending(repository);
    const copy = repository.registerLocalCopy(backup.backup_id, { managedRelativePath: "safe/file.zip", size: 1, sha256: HASH_A });
    repository.updateCopyStatus(copy.id, "failed", { errorCode: "P2_COPY_FAIL", errorMessage: "Cookie=abc /var/private/file" });
    const job = repository.createJobRun({ runId: uniqueId("run"), jobType: "backup_create", trigger: "manual" });
    repository.updateJobStatus(job.run_id, "running");
    const failedJob = repository.updateJobStatus(job.run_id, "failed", { errorCode: "P2_JOB_FAIL", errorMessage: "Bearer abc.def /home/private/file" });
    const savedCopy = repository.getBackupById(backup.backup_id).copies[0];
    assert.equal(/abc|\/var\//.test(savedCopy.last_error_message_safe), false);
    assert.equal(/abc\.def|\/home\//.test(failedJob.error_message_safe), false);
  } finally { database.close(); }
});

test("backup pagination is deterministic", () => {
  const { database, repository } = repositoryFixture();
  try {
    for (let index = 0; index < 5; index += 1) createPending(repository);
    const first = repository.listBackupSets({ page: 1, pageSize: 2 });
    const second = repository.listBackupSets({ page: 2, pageSize: 2 });
    assert.equal(first.total, 5);
    assert.equal(first.items.length, 2);
    assert.equal(second.items.length, 2);
    assert.equal(first.items.some((row) => second.items.some((other) => other.id === row.id)), false);
  } finally { database.close(); }
});

test("job pagination is deterministic", () => {
  const { database, repository } = repositoryFixture();
  try {
    for (let index = 0; index < 4; index += 1) repository.createJobRun({ runId: uniqueId("run"), jobType: "backup_create", trigger: "manual" });
    const result = repository.listJobRuns({ page: 2, pageSize: 3 });
    assert.equal(result.total, 4);
    assert.equal(result.items.length, 1);
  } finally { database.close(); }
});

test("latestAvailableVerified ignores newer unverified backups", () => {
  const { database, repository } = repositoryFixture({
    clockValues: ["2026-07-19T01:00:00Z", "2026-07-19T02:00:00Z", "2026-07-19T03:00:00Z", "2026-07-19T04:00:00Z", "2026-07-19T05:00:00Z"],
  });
  try {
    const verifiedBackup = createPending(repository);
    publish(repository, verifiedBackup.backup_id);
    verify(repository, verifiedBackup.backup_id);
    const newer = createPending(repository);
    publish(repository, newer.backup_id, { packageSha256: HASH_B });
    assert.equal(repository.latestAvailableVerified().backup_id, verifiedBackup.backup_id);
  } finally { database.close(); }
});

test("legacy backup_records are exposed as business archives without file_path", () => {
  const database = migratedDatabase({ legacy: true });
  try {
    database.prepare(`
      INSERT INTO backup_records(backup_time, backup_type, included_months, filename, file_path, file_size, status, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("2026-07-18 02:00:00", "manual", 12, "C:\\private\\legacy.zip", "/root/private/legacy.zip", 321, "success", "");
    const result = new UnifiedBackupReader(database).list();
    const item = result.items.find((entry) => entry.kind === "legacy_business_archive");
    assert.equal(item.backup_type, "legacy_business_archive");
    assert.equal(item.filename, "legacy.zip");
    assert.equal(Object.hasOwn(item, "file_path"), false);
    assert.equal(JSON.stringify(item).includes("/root/private"), false);
  } finally { database.close(); }
});

test("legacy SQLite snapshots are summarized by count and size only", () => {
  const prefix = "liming-p2-legacy-summary-";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    fs.writeFileSync(path.join(root, "one.sqlite"), Buffer.alloc(10));
    fs.writeFileSync(path.join(root, "two.sqlite"), Buffer.alloc(20));
    fs.writeFileSync(path.join(root, "two.sqlite.json"), "{}");
    fs.writeFileSync(path.join(root, "archive.zip"), Buffer.alloc(30));
    const summary = scanLegacySqliteSnapshots(root);
    assert.equal(summary.count, 2);
    assert.equal(summary.size, 30);
    assert.equal(Object.hasOwn(summary, "files"), false);
  } finally { safeRemoveTemp(root, prefix.slice(0, -1)); }
});

test("unified backup list clearly distinguishes all three record kinds", () => {
  const prefix = "liming-p2-unified-";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const database = migratedDatabase({ legacy: true });
  try {
    const repository = new BackupMetadataRepository(database);
    createPending(repository);
    database.prepare("INSERT INTO backup_records(filename, file_path, file_size) VALUES (?, ?, ?)").run("legacy.zip", path.join(root, "legacy.zip"), 7);
    fs.writeFileSync(path.join(root, "snapshot.sqlite"), Buffer.alloc(9));
    const before = Number(database.prepare("SELECT total_changes() AS count").get().count);
    const result = new UnifiedBackupReader(database, { legacyBackupDirectory: root }).list({ page: 1, pageSize: 20 });
    const after = Number(database.prepare("SELECT total_changes() AS count").get().count);
    assert.deepEqual(new Set(result.items.map((item) => item.kind)), new Set(["system_full", "legacy_business_archive", "legacy_sqlite_snapshot_summary"]));
    assert.equal(result.counts.legacy_sqlite_snapshot_summary, 1);
    assert.equal(before, after);
    assert.equal(JSON.stringify(result).includes(path.resolve(root)), false);
  } finally {
    database.close();
    safeRemoveTemp(root, prefix.slice(0, -1));
  }
});

test("recordPublishedPackage writes backup set and local copy atomically", () => {
  const { database, repository } = repositoryFixture();
  try {
    const backupId = uniqueId("published");
    const row = repository.recordPublishedPackage({
      backupId, backupType: "daily", trigger: "scheduled", scheduledFor: "2026-07-20T02:30:00+08:00",
      snapshotStrategy: "online", appVersion: "0.1.0", appGitCommit: "abcdef1", schemaVersion: 0, manifestVersion: 1,
      packageFilename: "published.zip", packageSize: 1024, packageSha256: HASH_A, warningCount: 0,
      managedRelativePath: "published/published.zip",
    });
    assert.equal(row.status, "available");
    assert.equal(row.verification_status, "not_verified");
    assert.equal(row.copies.length, 1);
    assert.equal(row.copies[0].verified_at, null);
  } finally { database.close(); }
});

test("recordPublishedPackage rolls back the backup set when copy registration fails", () => {
  const { database, repository } = repositoryFixture();
  try {
    const backupId = uniqueId("published-fail");
    assert.throws(() => repository.recordPublishedPackage({
      backupId, backupType: "manual", trigger: "manual", snapshotStrategy: "online", schemaVersion: 0, manifestVersion: 1,
      packageFilename: "published.zip", packageSize: 1024, packageSha256: HASH_A, managedRelativePath: "../escape.zip",
    }), (error) => error instanceof P2Error);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM backup_sets WHERE backup_id = ?").get(backupId).count, 0);
  } finally { database.close(); }
});

test("P1B pure file mode remains independent of P2 metadata", async () => {
  await withPackageFixture("pure-file", async ({ backupOptions }) => {
    const result = await createBackupPackage(backupOptions);
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(result.zipPath), true);
    assert.equal(Object.hasOwn(result, "metadata"), false);
  });
});

test("optional P1B adapter works without a repository", async () => {
  await withPackageFixture("optional-adapter", async ({ backupOptions }) => {
    const result = await createBackupPackageWithMetadata(backupOptions);
    assert.deepEqual(result.metadata, { recorded: false, reason: "not_configured" });
    assert.equal(fs.existsSync(result.zipPath), true);
  });
});

test("P1B adapter registers a published package in a synthetic metadata database", async () => {
  await withPackageFixture("adapter-success", async ({ backupOptions }) => {
    const { database, repository } = repositoryFixture();
    try {
      const result = await createBackupPackageWithMetadata(backupOptions, { repository, backupType: "manual" });
      assert.equal(result.metadata.recorded, true);
      const row = repository.getBackupById(result.backupId);
      assert.equal(row.package_sha256, result.packageSha256);
      assert.equal(row.copies[0].managed_relative_path.includes("system-v1"), false);
      assert.equal(row.copies[0].managed_relative_path, `${result.baseName}/${path.basename(result.zipPath)}`);
    } finally { database.close(); }
  });
});

test("P1B adapter reports metadata failure after publication without hiding the package", async () => {
  await withPackageFixture("adapter-failure", async ({ backupOptions, backupRoot }) => {
    let caught;
    try {
      await createBackupPackageWithMetadata(backupOptions, {
        repository: { recordPublishedPackage() { throw new Error("synthetic metadata failure"); } },
      });
    } catch (error) { caught = error; }
    assert.equal(caught.code, ERROR_CODES.METADATA_REGISTRATION_FAILED);
    assert.equal(caught.packagePublished, true);
    assert.equal(caught.backupId, backupOptions.backupId);
    const managedEntries = fs.readdirSync(path.join(backupRoot, MANAGED_NAMESPACE));
    assert.equal(managedEntries.length, 1);
    assert.equal(fs.readdirSync(path.join(backupRoot, MANAGED_NAMESPACE, managedEntries[0])).some((name) => name.endsWith(".zip")), true);
  });
});
