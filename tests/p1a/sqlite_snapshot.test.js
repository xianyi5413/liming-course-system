"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const {
  ERROR_CODES,
  STRATEGIES,
  SnapshotError,
  assertRuntime,
  cleanupStaleArtifacts,
  createSnapshot,
  isStagingName,
  runtimeInfo,
  validateSnapshot,
} = require("../../scripts/p1a/sqlite_snapshot");
const {
  createSyntheticDatabase,
  syntheticCounts,
} = require("../../scripts/p1a/synthetic_database");

const writerScript = path.resolve(__dirname, "../../scripts/p1a/concurrent_writer.js");
const workerScript = path.resolve(__dirname, "../../scripts/p1a/snapshot_worker.js");

async function inTempDirectory(label, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `liming-p1a-${label}-`));
  try {
    return await callback(directory);
  } finally {
    const relativeToTemp = path.relative(path.resolve(os.tmpdir()), path.resolve(directory));
    if (
      !relativeToTemp
      || relativeToTemp.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeToTemp)
      || !path.basename(directory).startsWith(`liming-p1a-${label}-`)
    ) {
      throw new Error("Refusing to clean a directory outside the P1A temporary namespace");
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function stagingFiles(directory) {
  return fs.readdirSync(directory).filter(isStagingName);
}

async function waitForStagingCreation(directory, child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = stagingFiles(directory);
    if (files.length) return files[0];
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Snapshot worker exited before a staging artifact was observed");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for a staging artifact");
}

function waitForMessage(child, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("Timed out waiting for child process message")), timeoutMs);
    const onMessage = (message) => {
      if (message?.type === "error") {
        finish(new Error(`Child process failed with ${message.code}`));
      } else if (predicate(message)) {
        finish(null, message);
      }
    };
    const onError = (error) => finish(error);
    const onExit = (code, signal) => finish(new Error(`Child exited before expected message: code=${code} signal=${signal}`));
    function finish(error, message) {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(message);
    }
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function waitForExit(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for child exit")), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.connected) child.send({ type: "stop" });
  try {
    await waitForExit(child, 5000);
  } catch {
    child.kill("SIGKILL");
    await waitForExit(child, 5000);
  }
}

test("runtime capability detection reports node:sqlite backup support", () => {
  const actual = assertRuntime();
  assert.equal(actual.onlineBackupAvailable, true);
  assert.equal(actual.node, process.versions.node);
  assert.equal(actual.sqlite, process.versions.sqlite);
  assert.throws(
    () => assertRuntime({ node: "0.0.0-impossible" }),
    (error) => error instanceof SnapshotError && error.code === ERROR_CODES.RUNTIME_UNSUPPORTED,
  );
});

test("Online Backup creates and validates a synthetic WAL database snapshot", async () => {
  await inTempDirectory("online", async (directory) => {
    const source = path.join(directory, "source.sqlite");
    const target = path.join(directory, "online.sqlite");
    const fixture = createSyntheticDatabase(source, { rows: 120, payloadBytes: 512 });
    assert.equal(fixture.journalMode, "wal");

    const result = await createSnapshot({ sourcePath: source, targetPath: target, strategy: STRATEGIES.ONLINE });
    assert.equal(result.ok, true);
    assert.equal(result.strategy, STRATEGIES.ONLINE);
    assert.deepEqual(result.validation, { integrityCheck: "ok", foreignKeyViolations: 0 });
    assert.deepEqual(syntheticCounts(target), syntheticCounts(source));
    if (process.platform !== "win32") assert.equal(fs.statSync(target).mode & 0o777, 0o600);
    assert.equal(stagingFiles(directory).length, 0);
  });
});

test("VACUUM INTO fallback uses the same validation and result contract", async () => {
  await inTempDirectory("vacuum", async (directory) => {
    const source = path.join(directory, "source.sqlite");
    const target = path.join(directory, "vacuum.sqlite");
    createSyntheticDatabase(source, { rows: 90, payloadBytes: 384 });

    const result = await createSnapshot({
      sourcePath: source,
      targetPath: target,
      strategy: STRATEGIES.VACUUM_INTO,
    });
    assert.equal(result.ok, true);
    assert.equal(result.strategy, STRATEGIES.VACUUM_INTO);
    assert.deepEqual(result.validation, { integrityCheck: "ok", foreignKeyViolations: 0 });
    assert.deepEqual(syntheticCounts(target), syntheticCounts(source));
    assert.equal(stagingFiles(directory).length, 0);
  });
});

test("existing target is rejected without changing its contents", async () => {
  await inTempDirectory("exists", async (directory) => {
    const source = path.join(directory, "source.sqlite");
    const target = path.join(directory, "existing.sqlite");
    createSyntheticDatabase(source);
    fs.writeFileSync(target, "do-not-overwrite", "utf8");

    await assert.rejects(
      createSnapshot({ sourcePath: source, targetPath: target }),
      (error) => error.code === ERROR_CODES.TARGET_EXISTS,
    );
    assert.equal(fs.readFileSync(target, "utf8"), "do-not-overwrite");
    assert.equal(stagingFiles(directory).length, 0);
  });
});

test("Online Backup remains consistent while another WAL connection commits", async () => {
  await inTempDirectory("concurrent", async (directory) => {
    const source = path.join(directory, "source.sqlite");
    const target = path.join(directory, "concurrent.sqlite");
    createSyntheticDatabase(source, { rows: 300, payloadBytes: 2048 });

    const writer = fork(writerScript, [source, "1"], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    let commitsDuringSnapshot = 0;
    const countCommit = (message) => {
      if (message?.type === "commit") commitsDuringSnapshot += 1;
    };
    try {
      const ready = await waitForMessage(writer, (message) => message?.type === "ready");
      assert.ok(ready.sequence >= 300);
      writer.on("message", countCommit);
      const result = await createSnapshot({
        sourcePath: source,
        targetPath: target,
        strategy: STRATEGIES.ONLINE,
        rate: 1,
      });
      writer.off("message", countCommit);
      assert.ok(commitsDuringSnapshot > 0);
      assert.equal(result.validation.integrityCheck, "ok");
      const snapshot = syntheticCounts(target);
      assert.equal(snapshot.parents, snapshot.children);
      assert.equal(snapshot.minSequence, 1);
      assert.equal(snapshot.maxSequence, snapshot.parents);
    } finally {
      writer.off("message", countCommit);
      await stopChild(writer);
    }
  });
});

test("post-snapshot failure removes staging and never publishes target", async () => {
  await inTempDirectory("failure-cleanup", async (directory) => {
    const source = path.join(directory, "source.sqlite");
    const target = path.join(directory, "must-not-exist.sqlite");
    createSyntheticDatabase(source);

    await assert.rejects(
      createSnapshot({
        sourcePath: source,
        targetPath: target,
        afterValidation() {
          throw new SnapshotError(ERROR_CODES.INTEGRITY_FAILED, "Synthetic post-validation failure");
        },
      }),
      (error) => error.code === ERROR_CODES.INTEGRITY_FAILED,
    );
    assert.equal(fs.existsSync(target), false);
    assert.equal(stagingFiles(directory).length, 0);
  });
});

test("a target created during publication is preserved and never overwritten", async () => {
  await inTempDirectory("publish-race", async (directory) => {
    const source = path.join(directory, "source.sqlite");
    const target = path.join(directory, "raced-target.sqlite");
    createSyntheticDatabase(source);

    await assert.rejects(
      createSnapshot({
        sourcePath: source,
        targetPath: target,
        afterValidation() {
          fs.writeFileSync(target, "racing-writer-wins", "utf8");
        },
      }),
      (error) => error.code === ERROR_CODES.TARGET_EXISTS,
    );
    assert.equal(fs.readFileSync(target, "utf8"), "racing-writer-wins");
    assert.equal(stagingFiles(directory).length, 0);
  });
});

test("corrupt staging output has a stable integrity error and is not published", async () => {
  await inTempDirectory("corrupt", async (directory) => {
    const source = path.join(directory, "source.sqlite");
    const target = path.join(directory, "must-not-exist.sqlite");
    createSyntheticDatabase(source);

    await assert.rejects(
      createSnapshot({
        sourcePath: source,
        targetPath: target,
        onSnapshotReady({ stagingPath }) {
          fs.writeFileSync(stagingPath, "not-a-sqlite-database", "utf8");
        },
      }),
      (error) => error.code === ERROR_CODES.INTEGRITY_FAILED,
    );
    assert.equal(fs.existsSync(target), false);
    assert.equal(stagingFiles(directory).length, 0);
  });
});

test("foreign-key violations have a stable error and are not published", async () => {
  await inTempDirectory("foreign-key", async (directory) => {
    const source = path.join(directory, "source.sqlite");
    const target = path.join(directory, "must-not-exist.sqlite");
    createSyntheticDatabase(source);
    const sourceDb = new DatabaseSync(source);
    try {
      sourceDb.exec("PRAGMA foreign_keys = OFF");
      sourceDb.prepare("INSERT INTO synthetic_child(parent_id, marker) VALUES (?, ?)").run(999999, "synthetic-orphan");
    } finally {
      sourceDb.close();
    }

    await assert.rejects(
      createSnapshot({
        sourcePath: source,
        targetPath: target,
      }),
      (error) => error.code === ERROR_CODES.FOREIGN_KEY_FAILED,
    );
    assert.equal(fs.existsSync(target), false);
    assert.equal(stagingFiles(directory).length, 0);
  });
});

test("recognized interrupted artifacts are cleaned without touching unrelated files", async () => {
  await inTempDirectory("stale", async (directory) => {
    const stale = path.join(directory, ".p1a-snapshot-123-test.partial.sqlite");
    const unrelated = path.join(directory, "keep-me.sqlite");
    fs.writeFileSync(stale, "partial", "utf8");
    fs.writeFileSync(unrelated, "keep", "utf8");

    const result = cleanupStaleArtifacts(directory);
    assert.equal(result.removed.length, 1);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.readFileSync(unrelated, "utf8"), "keep");
  });
});

test("Windows-compatible Unicode and spaced paths close every database handle", async () => {
  await inTempDirectory("paths", async (directory) => {
    const nested = path.join(directory, "路径 with spaces");
    fs.mkdirSync(nested);
    for (const strategy of [STRATEGIES.ONLINE, STRATEGIES.VACUUM_INTO]) {
      const source = path.join(nested, `合成 ${strategy} source.sqlite`);
      const target = path.join(nested, `快照 ${strategy} target.sqlite`);
      createSyntheticDatabase(source, { rows: 30 });
      await createSnapshot({ sourcePath: source, targetPath: target, strategy });
      validateSnapshot(target);

      const movedSource = path.join(nested, `moved-${strategy}-source.sqlite`);
      const movedTarget = path.join(nested, `moved-${strategy}-target.sqlite`);
      fs.renameSync(source, movedSource);
      fs.renameSync(target, movedTarget);
      assert.equal(fs.existsSync(movedSource), true);
      assert.equal(fs.existsSync(movedTarget), true);
    }
  });
});

test("non-root locked container rejects a read-only output directory", {
  skip: !process.env.P1A_READ_ONLY_DIR,
}, async () => {
  await inTempDirectory("permissions", async (directory) => {
    const source = path.join(directory, "source.sqlite");
    createSyntheticDatabase(source);
    for (const strategy of [STRATEGIES.ONLINE, STRATEGIES.VACUUM_INTO]) {
      const target = path.join(process.env.P1A_READ_ONLY_DIR, `denied-${strategy}-${process.pid}.sqlite`);
      await assert.rejects(
        createSnapshot({ sourcePath: source, targetPath: target, strategy }),
        (error) => error.code === ERROR_CODES.IO_PERMISSION_DENIED,
      );
      assert.equal(fs.existsSync(target), false);
    }
  });
});

test("killing Online Backup leaves no final target and cleanup recognizes residue", async () => {
  await inTempDirectory("interrupt-online", async (directory) => {
    const source = path.join(directory, "large-source.sqlite");
    const target = path.join(directory, "online-final.sqlite");
    createSyntheticDatabase(source, { rows: 2500, payloadBytes: 8192 });
    const worker = fork(workerScript, [source, target, STRATEGIES.ONLINE], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, P1A_BACKUP_RATE: "1" },
    });
    await waitForMessage(worker, (message) => message?.type === "progress" && message.remainingPages > 0, 20000);
    worker.kill("SIGKILL");
    await waitForExit(worker, 10000);

    assert.equal(fs.existsSync(target), false);
    assert.ok(stagingFiles(directory).length >= 1);
    const cleanup = cleanupStaleArtifacts(directory);
    assert.ok(cleanup.removed.length >= 1);
    assert.equal(stagingFiles(directory).length, 0);
  });
});

test("killing VACUUM INTO pipeline before publication leaves only recognized residue", async () => {
  await inTempDirectory("interrupt-vacuum", async (directory) => {
    const source = path.join(directory, "source.sqlite");
    const target = path.join(directory, "vacuum-final.sqlite");
    createSyntheticDatabase(source, { rows: 500, payloadBytes: 2048 });
    const worker = fork(workerScript, [source, target, STRATEGIES.VACUUM_INTO], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, P1A_HOLD_AFTER_SNAPSHOT_MS: "10000" },
    });
    await waitForMessage(worker, (message) => message?.type === "snapshot-ready", 20000);
    worker.kill("SIGKILL");
    await waitForExit(worker, 10000);

    assert.equal(fs.existsSync(target), false);
    assert.ok(stagingFiles(directory).length >= 1);
    const cleanup = cleanupStaleArtifacts(directory);
    assert.ok(cleanup.removed.length >= 1);
    assert.equal(stagingFiles(directory).length, 0);
  });
});

test("killing VACUUM INTO while its staging file is being written never publishes target", async () => {
  await inTempDirectory("interrupt-vacuum-write", async (directory) => {
    const source = path.join(directory, "large-source.sqlite");
    const target = path.join(directory, "vacuum-final.sqlite");
    createSyntheticDatabase(source, { rows: 10000, payloadBytes: 4096 });
    const worker = fork(workerScript, [source, target, STRATEGIES.VACUUM_INTO], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, P1A_HOLD_AFTER_SNAPSHOT_MS: "0" },
    });

    const stagingName = await waitForStagingCreation(directory, worker, 20000);
    worker.kill("SIGKILL");
    await waitForExit(worker, 10000);

    assert.equal(fs.existsSync(target), false);
    assert.equal(isStagingName(stagingName), true);
    const cleanup = cleanupStaleArtifacts(directory);
    assert.ok(cleanup.removed.includes(stagingName));
    assert.equal(stagingFiles(directory).length, 0);
  });
});

test("locked runtime marker is only asserted inside the isolated image", () => {
  const actual = runtimeInfo();
  if (process.env.P1A_LOCKED_RUNTIME === "1") {
    assert.equal(actual.node, "24.18.0");
    assert.equal(actual.sqlite, "3.53.1");
    assert.equal(actual.platform, "linux");
    assert.equal(actual.arch, "x64");
  }
});
