"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, fork, spawnSync } = require("node:child_process");
const { promisify } = require("node:util");
const { after, test } = require("node:test");

const { STRATEGIES } = require("../../scripts/p1a/sqlite_snapshot");
const { createSyntheticDatabase } = require("../../scripts/p1a/synthetic_database");
const {
  ERROR_CODES,
  MANAGED_NAMESPACE,
  classifyError,
  cleanupStaleStaging,
  normalizeArchivePath,
  sha256File,
} = require("../../scripts/p1b/common");
const {
  createBackupPackage,
  createPackagePaths,
} = require("../../scripts/p1b/backup_package");
const { readZipIndex } = require("../../scripts/p1b/zip_store");
const { verifyBackupPackage } = require("../../scripts/p1b/verify_backup");
const {
  ChildSupervisor,
  installSignalCleanup,
  waitForExit,
  waitForMessage: waitForManagedMessage,
} = require("../../scripts/p1a/child_process_safety");

const execFileAsync = promisify(execFile);
const workerScript = path.resolve(__dirname, "../../scripts/p1b/test_worker.js");
const backupCli = path.resolve(__dirname, "../../scripts/p1b/backup_cli.js");
const verifyCli = path.resolve(__dirname, "../../scripts/p1b/verify_backup_cli.js");
const FIXED_NOW = new Date("2026-07-19T08:30:00.000Z");
const TEST_PROFILE = process.env.P1B_TEST_PROFILE || "full";
const faultTest = TEST_PROFILE === "safe" ? test.skip : test;
const childSupervisor = new ChildSupervisor({ label: "P1B test child" });
const removeSignalCleanup = installSignalCleanup(childSupervisor);

after(async () => {
  removeSignalCleanup();
  await childSupervisor.terminateAll({ requestStop: true });
  assert.equal(childSupervisor.runningCount(), 0);
});

function safeRemoveTestDirectory(directory, label) {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(directory));
  if (
    !relative
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
    || !path.basename(directory).startsWith(`liming-p1b-${label}-`)
  ) {
    throw new Error("Refusing to clean a directory outside the P1B test namespace");
  }
  fs.rmSync(directory, { recursive: true, force: true });
}

async function withFixture(label, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `liming-p1b-${label}-`));
  const dataDirectory = path.join(root, "data with spaces");
  const backupRoot = path.join(root, "backup root");
  fs.mkdirSync(dataDirectory, { mode: 0o700 });
  fs.mkdirSync(backupRoot, { mode: 0o700 });
  const sourceDatabase = path.join(dataDirectory, "synthetic.sqlite");
  createSyntheticDatabase(sourceDatabase, { rows: options.rows || 40, payloadBytes: options.payloadBytes || 256 });

  const configureDirectory = (name, state) => {
    if (state === "absent") return;
    const directory = path.join(dataDirectory, name);
    fs.mkdirSync(directory, { mode: 0o700 });
    if (state === "empty") return;
    const nested = path.join(directory, "Unicode 子目录");
    fs.mkdirSync(nested, { mode: 0o700 });
    fs.writeFileSync(path.join(directory, `${name} sample.txt`), `synthetic-${name}`, "utf8");
    fs.writeFileSync(path.join(nested, "文件 with spaces.bin"), Buffer.from([0, 1, 2, 3, 4]));
  };
  configureDirectory("source-workbooks", options.sourceState || "present");
  configureDirectory("templates", options.templateState || "present");

  const fixture = {
    root,
    dataDirectory,
    backupRoot,
    sourceDatabase,
    async create(extra = {}) {
      return createBackupPackage({
        sourceDatabase,
        dataDirectory,
        backupRoot,
        snapshotStrategy: STRATEGIES.ONLINE,
        trigger: "manual",
        scheduledFor: "2026-07-20T02:30:00+08:00",
        now: FIXED_NOW,
        backupId: crypto.randomUUID(),
        appVersion: "0.1.0-test",
        appGitCommit: "abcdef1",
        safetyMarginBytes: 0,
        ...extra,
      });
    },
  };
  try {
    return await callback(fixture);
  } finally {
    safeRemoveTestDirectory(root, label);
  }
}

function waitForMessage(child, predicate, timeoutMs = 10000) {
  return waitForManagedMessage(child, predicate, { timeoutMs, label: "P1B worker", requestStop: true });
}

function trackFork(script, args, options, label, maxRuntimeMs = 20000) {
  return childSupervisor.track(fork(script, args, options), { label, maxRuntimeMs });
}

async function rewriteSidecar(result) {
  const hash = await sha256File(result.zipPath);
  fs.writeFileSync(result.sha256Path, `${hash.sha256}  ${path.basename(result.zipPath)}\n`, "utf8");
}

async function flipEntryByte(zipPath, entryName) {
  const index = await readZipIndex(zipPath);
  const entry = index.entries.find((candidate) => candidate.name === entryName);
  assert.ok(entry && entry.size > 0);
  const handle = fs.openSync(zipPath, "r+");
  try {
    const byte = Buffer.alloc(1);
    fs.readSync(handle, byte, 0, 1, entry.dataOffset + Math.min(128, entry.size - 1));
    byte[0] ^= 0xff;
    fs.writeSync(handle, byte, 0, 1, entry.dataOffset + Math.min(128, entry.size - 1));
  } finally {
    fs.closeSync(handle);
  }
}

async function createLargeFile(filePath, bytes) {
  const handle = await fs.promises.open(filePath, "wx");
  try {
    const chunk = Buffer.alloc(64 * 1024, 0x5a);
    let written = 0;
    while (written < bytes) {
      const length = Math.min(chunk.length, bytes - written);
      await handle.write(chunk, 0, length, written);
      written += length;
    }
  } finally {
    await handle.close();
  }
}

test("Online Backup creates the complete ZIP, manifest, hashes and read-only verification result", async () => {
  await withFixture("online-full", async (fixture) => {
    for (const excluded of ["uploads", "backups", "debug"]) {
      fs.mkdirSync(path.join(fixture.dataDirectory, excluded));
      fs.writeFileSync(path.join(fixture.dataDirectory, excluded, "ignored.txt"), "secret-looking-test-data");
    }
    fs.writeFileSync(path.join(fixture.dataDirectory, ".env"), "TOKEN=must-not-appear");
    fs.writeFileSync(path.join(fixture.dataDirectory, "unrelated.sqlite-wal"), "excluded-wal-placeholder");
    fs.writeFileSync(path.join(fixture.dataDirectory, "unrelated.sqlite-shm"), "excluded-shm-placeholder");

    const result = await fixture.create();
    assert.equal(result.ok, true);
    assert.equal(result.snapshotStrategy, STRATEGIES.ONLINE);
    assert.equal(fs.existsSync(result.zipPath), true);
    assert.equal(fs.existsSync(result.sha256Path), true);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(result.finalDirectory).mode & 0o777, 0o700);
      assert.equal(fs.statSync(result.zipPath).mode & 0o777, 0o600);
      assert.equal(fs.statSync(result.sha256Path).mode & 0o777, 0o600);
    }

    const index = await readZipIndex(result.zipPath);
    const names = index.entries.map((entry) => entry.name);
    for (const expected of [
      "manifest.json",
      "database/liming-local.sqlite",
      "files/source-workbooks/",
      "files/templates/",
      "metadata/restore-notes.txt",
    ]) assert.ok(names.includes(expected));
    for (const forbidden of ["uploads", "backups", "debug", ".env", "-wal", "-shm", ".git", "node_modules"]) {
      assert.equal(names.some((name) => name.includes(forbidden)), false);
    }

    const manifestText = JSON.stringify(result.manifest);
    assert.equal(manifestText.includes(fixture.root), false);
    assert.equal(manifestText.includes("must-not-appear"), false);
    assert.equal(result.manifest.manifest_version, "1.0");
    assert.match(result.manifest.task_id, /^[0-9a-f-]{36}$/);
    assert.notEqual(result.manifest.task_id, result.manifest.backup_id);
    assert.equal(result.manifest.created_at_utc, "2026-07-19T08:30:00.000Z");
    assert.equal(result.manifest.created_at_asia_shanghai, "2026-07-19T16:30:00+08:00");
    assert.equal(result.manifest.scheduled_for, "2026-07-19T18:30:00.000Z");
    assert.equal(result.manifest.scheduled_for_asia_shanghai, "2026-07-20T02:30:00+08:00");
    assert.equal(result.manifest.schema_version_source, "pragma_user_version");
    assert.equal(result.manifest.schema_version, 0);
    assert.equal(result.manifest.database_integrity_check, "ok");
    assert.equal(result.manifest.database_foreign_key_violation_count, 0);
    assert.ok(names.includes("metadata/restore-notes.txt"));

    const packageHash = await sha256File(result.zipPath);
    assert.equal(packageHash.sha256, result.packageSha256);
    assert.equal(fs.readFileSync(result.sha256Path, "utf8"), `${packageHash.sha256}  ${path.basename(result.zipPath)}\n`);
    const before = { zip: fs.statSync(result.zipPath).mtimeMs, sha: fs.statSync(result.sha256Path).mtimeMs };
    const verified = await verifyBackupPackage({ zipPath: result.zipPath });
    assert.equal(verified.ok, true);
    assert.equal(verified.databaseIntegrityCheck, "ok");
    assert.equal(verified.databaseForeignKeyViolationCount, 0);
    assert.deepEqual(before, { zip: fs.statSync(result.zipPath).mtimeMs, sha: fs.statSync(result.sha256Path).mtimeMs });

    const movedZip = `${result.zipPath}.moved`;
    const movedSha = `${result.sha256Path}.moved`;
    fs.renameSync(result.zipPath, movedZip);
    fs.renameSync(result.sha256Path, movedSha);
    fs.renameSync(movedZip, result.zipPath);
    fs.renameSync(movedSha, result.sha256Path);
  });
});

test("VACUUM INTO fallback uses the same package and verification pipeline", async () => {
  await withFixture("fallback", async (fixture) => {
    const result = await fixture.create({ snapshotStrategy: STRATEGIES.VACUUM_INTO });
    assert.equal(result.snapshotStrategy, STRATEGIES.VACUUM_INTO);
    assert.equal(result.manifest.snapshot_strategy, STRATEGIES.VACUUM_INTO);
    assert.equal((await verifyBackupPackage({ zipPath: result.zipPath })).ok, true);
  });
});

test("the platform standard ZIP reader accepts the generated archive", async () => {
  await withFixture("zip-standard", async (fixture) => {
    const result = await fixture.create();
    let execution;
    if (process.platform === "win32") {
      const command = [
        "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
        "$archive=[System.IO.Compression.ZipFile]::OpenRead($env:P1B_ZIP_INTEROP);",
        "try { if ($archive.Entries.Count -lt 5) { exit 3 } } finally { $archive.Dispose() }",
      ].join(" ");
      execution = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
        encoding: "utf8",
        env: { ...process.env, P1B_ZIP_INTEROP: result.zipPath },
        timeout: 10000,
      });
    } else {
      execution = spawnSync("busybox", ["unzip", "-l", result.zipPath], { encoding: "utf8", timeout: 10000 });
    }
    assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  });
});

test("verification CLI recomputes package, component and SQLite checks", async () => {
  await withFixture("verify-cli", async (fixture) => {
    const result = await fixture.create();
    const execution = await execFileAsync(process.execPath, [verifyCli, "--zip", result.zipPath], { encoding: "utf8", timeout: 15000 });
    const output = JSON.parse(execution.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.package_sha256, result.packageSha256);
    assert.equal(output.database_integrity_check, "ok");
    assert.equal(output.database_foreign_key_violation_count, 0);
  });
});

test("package-level tampering is rejected", async () => {
  await withFixture("tamper-zip", async (fixture) => {
    const result = await fixture.create();
    const handle = fs.openSync(result.zipPath, "r+");
    try {
      const byte = Buffer.alloc(1);
      fs.readSync(handle, byte, 0, 1, 10);
      byte[0] ^= 1;
      fs.writeSync(handle, byte, 0, 1, 10);
    } finally {
      fs.closeSync(handle);
    }
    await assert.rejects(verifyBackupPackage({ zipPath: result.zipPath }), (error) => error.code === ERROR_CODES.HASH_MISMATCH);
  });
});

test("database entry tampering is rejected by the file-level hash after sidecar refresh", async () => {
  await withFixture("tamper-db", async (fixture) => {
    const result = await fixture.create();
    await flipEntryByte(result.zipPath, "database/liming-local.sqlite");
    await rewriteSidecar(result);
    await assert.rejects(verifyBackupPackage({ zipPath: result.zipPath }), (error) => error.code === ERROR_CODES.HASH_MISMATCH);
  });
});

test("manifest entry tampering is rejected", async () => {
  await withFixture("tamper-manifest", async (fixture) => {
    const result = await fixture.create();
    await flipEntryByte(result.zipPath, "manifest.json");
    await assert.rejects(verifyBackupPackage({ zipPath: result.zipPath }), (error) => error.code === ERROR_CODES.HASH_MISMATCH);
  });
});

for (const [label, sourceState, templateState, componentPath, expectedState] of [
  ["source-absent", "absent", "present", "files/source-workbooks/", "absent"],
  ["source-empty", "empty", "present", "files/source-workbooks/", "empty"],
  ["template-absent", "present", "absent", "files/templates/", "absent"],
  ["template-empty", "present", "empty", "files/templates/", "empty"],
]) {
  test(`${label} is represented without failing the package`, async () => {
    await withFixture(label, { sourceState, templateState }, async (fixture) => {
      const result = await fixture.create();
      const component = result.manifest.components.find((item) => item.path === componentPath);
      assert.equal(component.state, expectedState);
      assert.equal(component.exists, expectedState !== "absent");
      assert.ok(result.manifest.warnings.includes(`${componentPath.split("/")[1]}:${expectedState}`));
      assert.equal((await verifyBackupPackage({ zipPath: result.zipPath })).ok, true);
    });
  });
}

test("Unicode names and spaces survive packaging and verification", async () => {
  await withFixture("unicode", async (fixture) => {
    const result = await fixture.create();
    const names = (await readZipIndex(result.zipPath)).entries.map((entry) => entry.name);
    assert.ok(names.some((name) => name.includes("Unicode 子目录")));
    assert.ok(names.some((name) => name.includes("文件 with spaces.bin")));
    assert.equal((await verifyBackupPackage({ zipPath: result.zipPath })).ok, true);
  });
});

for (const targetType of ["zip", "sha256"]) {
  test(`an existing final ${targetType} target is rejected without overwrite`, async () => {
    await withFixture(`target-${targetType}`, async (fixture) => {
      const backupId = crypto.randomUUID();
      const paths = createPackagePaths(fixture.backupRoot, FIXED_NOW, backupId);
      fs.mkdirSync(paths.managedRoot, { mode: 0o700 });
      fs.mkdirSync(paths.finalDirectory, { mode: 0o700 });
      const target = path.join(paths.finalDirectory, targetType === "zip" ? paths.zipName : paths.shaName);
      fs.writeFileSync(target, "do-not-overwrite");
      await assert.rejects(fixture.create({ backupId }), (error) => error.code === ERROR_CODES.TARGET_EXISTS);
      assert.equal(fs.readFileSync(target, "utf8"), "do-not-overwrite");
    });
  });
}

test("non-root locked container rejects an unwritable backup root", { skip: !process.env.P1B_READ_ONLY_DIR }, async () => {
  await withFixture("permission", async (fixture) => {
    const before = fs.readdirSync(process.env.P1B_READ_ONLY_DIR).sort();
    let coreError;
    await assert.rejects(
      fixture.create({ backupRoot: process.env.P1B_READ_ONLY_DIR, spaceProbe: () => 1024n ** 4n }),
      (error) => {
        coreError = error;
        assert.equal(error.code, ERROR_CODES.IO_PERMISSION_DENIED);
        assert.ok(["EROFS", "EACCES", "EPERM"].includes(error.cause?.code));
        assert.equal(error.message, "Backup output is not writable");
        assert.equal(error.message.includes(process.env.P1B_READ_ONLY_DIR), false);
        return true;
      },
    );
    assert.ok(coreError);
    assert.deepEqual(fs.readdirSync(process.env.P1B_READ_ONLY_DIR).sort(), before);
    assert.equal(fs.existsSync(path.join(process.env.P1B_READ_ONLY_DIR, MANAGED_NAMESPACE)), false);

    const cli = spawnSync(process.execPath, [
      backupCli,
      "--source-db", fixture.sourceDatabase,
      "--data-dir", fixture.dataDirectory,
      "--backup-root", process.env.P1B_READ_ONLY_DIR,
      "--strategy", STRATEGIES.ONLINE,
      "--trigger", "manual",
    ], { encoding: "utf8", timeout: 15000 });
    assert.equal(cli.status, 3);
    const cliError = JSON.parse(cli.stderr);
    assert.equal(cliError.error_code, ERROR_CODES.IO_PERMISSION_DENIED);
    assert.equal(cli.stderr.includes(process.env.P1B_READ_ONLY_DIR), false);
    assert.equal(cli.stderr.includes(" at "), false);
    assert.deepEqual(fs.readdirSync(process.env.P1B_READ_ONLY_DIR).sort(), before);
    assert.equal(fs.existsSync(path.join(process.env.P1B_READ_ONLY_DIR, MANAGED_NAMESPACE)), false);
  });
});

test("disk-space preflight fails before managed or formal output is created", async () => {
  await withFixture("space", async (fixture) => {
    await assert.rejects(fixture.create({ spaceProbe: () => 0n }), (error) => error.code === ERROR_CODES.SPACE_INSUFFICIENT);
    assert.equal(fs.existsSync(path.join(fixture.backupRoot, MANAGED_NAMESPACE)), false);
  });
});

test("ordinary staging failure leaves no formal files or controlled residue", async () => {
  await withFixture("failure", async (fixture) => {
    await assert.rejects(fixture.create({ hooks: { onStagingReady() { throw new Error("synthetic failure"); } } }));
    const managed = path.join(fixture.backupRoot, MANAGED_NAMESPACE);
    assert.deepEqual(fs.readdirSync(managed), []);
  });
});

test("ZIP generation failure removes partial ZIP, sidecar and staging", async () => {
  await withFixture("zip-failure", async (fixture) => {
    await assert.rejects(fixture.create({
      hooks: {
        onZipProgress(progress) {
          if (progress.bytesWritten > 1024) throw new Error("synthetic ZIP failure");
        },
      },
    }));
    const managed = path.join(fixture.backupRoot, MANAGED_NAMESPACE);
    assert.deepEqual(fs.readdirSync(managed), []);
  });
});

test("a target appearing immediately before publication is preserved and staging is removed", async () => {
  await withFixture("publish-race", async (fixture) => {
    const backupId = crypto.randomUUID();
    const paths = createPackagePaths(fixture.backupRoot, FIXED_NOW, backupId);
    await assert.rejects(fixture.create({
      backupId,
      hooks: {
        beforePublish() {
          fs.mkdirSync(paths.finalDirectory, { mode: 0o700 });
          fs.writeFileSync(path.join(paths.finalDirectory, "racing-owner.txt"), "keep");
        },
      },
    }), (error) => error.code === ERROR_CODES.TARGET_EXISTS);
    assert.equal(fs.readFileSync(path.join(paths.finalDirectory, "racing-owner.txt"), "utf8"), "keep");
    assert.equal(fs.readdirSync(paths.managedRoot).some((name) => name.startsWith(".p1b-staging-")), false);
  });
});

for (const stage of ["staging", "zip", "publish"]) {
  faultTest(`process interruption at ${stage} leaves no formal package and controlled cleanup succeeds`, async () => {
    await withFixture(`interrupt-${stage}`, async (fixture) => {
      if (stage === "zip") {
        await createLargeFile(path.join(fixture.dataDirectory, "source-workbooks", "large.bin"), 2 * 1024 * 1024);
      }
      const worker = trackFork(workerScript, [fixture.sourceDatabase, fixture.dataDirectory, fixture.backupRoot, stage, STRATEGIES.ONLINE], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { ...process.env, P1B_WORKER_MAX_MS: "15000" },
      }, `P1B ${stage} interrupt worker`, 18000);
      try {
        await waitForMessage(worker, (message) => message?.type === "stage" && message.stage === stage, 10000);
        worker.kill("SIGKILL");
        await waitForExit(worker, 3000, `P1B ${stage} interrupt worker`);
      } finally {
        await childSupervisor.terminate(worker, { requestStop: true });
      }

      const managed = path.join(fixture.backupRoot, MANAGED_NAMESPACE);
      const entries = fs.readdirSync(managed);
      const stagingName = entries.find((name) => name.startsWith(".p1b-staging-"));
      assert.ok(stagingName);
      if (process.platform !== "win32") assert.equal(fs.statSync(path.join(managed, stagingName)).mode & 0o777, 0o700);
      assert.equal(entries.some((name) => name.startsWith("liming-system-full-")), false);
      fs.mkdirSync(path.join(managed, "unrelated-directory"));
      fs.writeFileSync(path.join(managed, "unrelated-file.txt"), "keep");
      const cleanup = cleanupStaleStaging(managed, { olderThanMs: 0 });
      assert.ok(cleanup.removed.length >= 1);
      assert.equal(fs.existsSync(path.join(managed, "unrelated-directory")), true);
      assert.equal(fs.readFileSync(path.join(managed, "unrelated-file.txt"), "utf8"), "keep");
    });
  });
}

test("path traversal and timezone-ambiguous scheduled dates are rejected", async () => {
  assert.throws(() => normalizeArchivePath("../escape.txt"), (error) => error.code === ERROR_CODES.PATH_TRAVERSAL);
  assert.throws(() => normalizeArchivePath("C:/escape.txt"), (error) => error.code === ERROR_CODES.PATH_TRAVERSAL);
  await withFixture("path", async (fixture) => {
    await assert.rejects(fixture.create({ scheduledFor: "2026-07-20T02:30:00" }), (error) => error.code === ERROR_CODES.INVALID_ARGUMENT);
    const nestedBackup = path.join(fixture.dataDirectory, "nested-backup");
    fs.mkdirSync(nestedBackup);
    await assert.rejects(
      fixture.create({ backupRoot: nestedBackup }),
      (error) => error.code === ERROR_CODES.PATH_OUTSIDE_ROOT,
    );
  });
});

test("a traversal entry introduced into the ZIP is rejected even with a refreshed sidecar", async () => {
  await withFixture("zip-traversal", async (fixture) => {
    const result = await fixture.create();
    const original = Buffer.from("manifest.json", "utf8");
    const malicious = Buffer.from("../evil12.txt", "utf8");
    assert.equal(original.length, malicious.length);
    const archive = fs.readFileSync(result.zipPath);
    let replacements = 0;
    for (let offset = archive.indexOf(original); offset >= 0; offset = archive.indexOf(original, offset + malicious.length)) {
      malicious.copy(archive, offset);
      replacements += 1;
    }
    assert.equal(replacements, 2);
    fs.writeFileSync(result.zipPath, archive);
    await rewriteSidecar(result);
    await assert.rejects(verifyBackupPackage({ zipPath: result.zipPath }), (error) => error.code === ERROR_CODES.PATH_TRAVERSAL);
  });
});

test("symbolic-link escape in an included directory is rejected", async () => {
  await withFixture("symlink", async (fixture) => {
    const outside = path.join(fixture.root, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "escape.txt"), "must-not-package");
    const link = path.join(fixture.dataDirectory, "source-workbooks", "escape-link");
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(fixture.create(), (error) => error.code === ERROR_CODES.SYMLINK_REJECTED);
  });
});

faultTest("large files are streamed with bounded chunks during creation and verification", async () => {
  await withFixture("large", async (fixture) => {
    await createLargeFile(path.join(fixture.dataDirectory, "source-workbooks", "large synthetic.bin"), 24 * 1024 * 1024);
    const result = await fixture.create();
    const verified = await verifyBackupPackage({ zipPath: result.zipPath });
    assert.ok(result.metrics.zipMaxChunkBytes <= 1024 * 1024);
    assert.ok(result.metrics.hashMaxChunkBytes <= 64 * 1024);
    assert.ok(verified.maxChunkBytes <= 64 * 1024);
  });
});

test("creation CLI accepts required parameters and does not log secret-looking path values", async () => {
  await withFixture("cli-TokenSecretCookie", async (fixture) => {
    const execution = await execFileAsync(process.execPath, [
      backupCli,
      "--source-db", fixture.sourceDatabase,
      "--data-dir", fixture.dataDirectory,
      "--backup-root", fixture.backupRoot,
      "--strategy", STRATEGIES.ONLINE,
      "--trigger", "scheduled",
      "--scheduled-for", "2026-07-20T02:30:00+08:00",
    ], { encoding: "utf8", timeout: 15000 });
    const output = JSON.parse(execution.stdout);
    assert.equal(output.ok, true);
    assert.equal(execution.stdout.includes("TokenSecretCookie"), false);
    assert.equal(execution.stderr.includes("TokenSecretCookie"), false);
    assert.equal(execution.stdout.includes(fixture.sourceDatabase), false);
    const cliZip = path.join(fixture.backupRoot, MANAGED_NAMESPACE, output.package_directory, output.zip_file);
    const cliVerified = await verifyBackupPackage({ zipPath: cliZip });
    assert.equal(cliVerified.manifest.trigger, "scheduled");
    assert.equal(cliVerified.manifest.scheduled_for_asia_shanghai, "2026-07-20T02:30:00+08:00");

    let failed;
    try {
      await execFileAsync(process.execPath, [
        backupCli,
        "--source-db", path.join(fixture.root, "TokenSecretCookie-missing.sqlite"),
        "--data-dir", fixture.dataDirectory,
        "--backup-root", fixture.backupRoot,
      ], { encoding: "utf8", timeout: 15000 });
    } catch (error) {
      failed = error;
    }
    assert.ok(failed);
    assert.equal(String(failed.stderr).includes("TokenSecretCookie"), false);
    assert.equal(String(failed.stderr).includes(fixture.root), false);
  });
});

test("CLI argument failures use a stable error code without a stack trace", () => {
  const execution = spawnSync(process.execPath, [backupCli, "--source-db"], { encoding: "utf8", timeout: 10000 });
  assert.equal(execution.status, 2);
  const output = JSON.parse(execution.stderr);
  assert.equal(output.error_code, ERROR_CODES.INVALID_ARGUMENT);
  assert.equal(execution.stderr.includes(" at "), false);
  for (const systemCode of ["EROFS", "EACCES", "EPERM"]) {
    const original = Object.assign(new Error("sensitive path /must/not/appear"), { code: systemCode });
    const classified = classifyError(original, ERROR_CODES.UNKNOWN, "test");
    assert.equal(classified.code, ERROR_CODES.IO_PERMISSION_DENIED);
    assert.equal(classified.cause, original);
    assert.equal(classified.cause.code, systemCode);
    assert.equal(classified.message, "Backup output is not writable");
    assert.equal(classified.message.includes("/must/not/appear"), false);
  }
});

test("generated filenames are Windows legal and all handles close", async () => {
  await withFixture("windows", async (fixture) => {
    const result = await fixture.create();
    assert.equal(/[<>:"\\|?*]/.test(path.basename(result.zipPath)), false);
    await verifyBackupPackage({ zipPath: result.zipPath });
    const moved = `${result.finalDirectory}-moved`;
    fs.renameSync(result.finalDirectory, moved);
    fs.renameSync(moved, result.finalDirectory);
  });
});

test("locked runtime marker validates exact Linux, Node and SQLite versions", () => {
  if (process.env.P1B_LOCKED_RUNTIME === "1") {
    assert.equal(process.platform, "linux");
    assert.equal(process.arch, "x64");
    assert.equal(process.versions.node, "24.18.0");
    assert.equal(process.versions.sqlite, "3.53.1");
  }
});
