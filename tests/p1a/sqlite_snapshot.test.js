"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");
const { after, test } = require("node:test");
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
const {
  ChildSupervisor,
  installSignalCleanup,
  isChildRunning,
  waitForExit,
  waitForMessage: waitForManagedMessage,
} = require("../../scripts/p1a/child_process_safety");

const writerScript = path.resolve(__dirname, "../../scripts/p1a/concurrent_writer.js");
const workerScript = path.resolve(__dirname, "../../scripts/p1a/snapshot_worker.js");
const lifecycleHarnessScript = path.resolve(__dirname, "../../scripts/p1a/lifecycle_harness.js");
const TEST_PROFILE = process.env.P1A_TEST_PROFILE || "full";
const faultTest = TEST_PROFILE === "safe" ? test.skip : test;
const childSupervisor = new ChildSupervisor({ label: "P1A test child" });
const removeSignalCleanup = installSignalCleanup(childSupervisor);

after(async () => {
  removeSignalCleanup();
  await childSupervisor.terminateAll({ requestStop: true });
  assert.equal(childSupervisor.runningCount(), 0);
});

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

async function waitForStagingCreation(directory, child, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = stagingFiles(directory);
    if (files.length) return files[0];
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Snapshot worker exited before a staging artifact was observed");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await childSupervisor.terminate(child, { requestStop: true });
  throw new Error("Timed out waiting for a staging artifact");
}

function waitForMessage(child, predicate, timeoutMs = 5000, label = "P1A child") {
  return waitForManagedMessage(child, predicate, { timeoutMs, label, requestStop: true });
}

async function stopChild(child) {
  await childSupervisor.terminate(child, { requestStop: true });
}

function trackFork(script, args, options, label, maxRuntimeMs = 8000) {
  return childSupervisor.track(fork(script, args, options), { label, maxRuntimeMs });
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForCondition(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for a bounded test condition");
}

function writerMarker(directory) {
  return path.join(directory, `.p1a-writer-exit-${crypto.randomUUID()}.txt`);
}

function forceKillPid(pid) {
  if (!pid || !processIsAlive(pid)) return;
  try { process.kill(pid, "SIGKILL"); } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function startLifecycleHarness(directory, mode) {
  const source = path.join(directory, `${mode}-source.sqlite`);
  const marker = writerMarker(directory);
  createSyntheticDatabase(source, { rows: 20, payloadBytes: 64 });
  const harness = trackFork(lifecycleHarnessScript, [mode, source, marker], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  }, `lifecycle harness ${mode}`, 7000);
  const ready = await waitForMessage(harness, (message) => message?.type === "writer-ready", 3000, `lifecycle harness ${mode}`);
  return { harness, marker, writerPid: ready.writerPid };
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
    const marker = writerMarker(directory);
    createSyntheticDatabase(source, { rows: 800, payloadBytes: 2048 });

    const writer = trackFork(writerScript, [source, "10"], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: {
        ...process.env,
        P1A_WRITER_MAX_MS: "5000",
        P1A_WRITER_MAX_COMMITS: "100",
        P1A_WRITER_EXIT_MARKER: marker,
      },
    }, "bounded concurrent writer", 7000);
    let commitsDuringSnapshot = 0;
    const countCommit = (message) => {
      if (message?.type === "commit") commitsDuringSnapshot += 1;
    };
    try {
      const ready = await waitForMessage(writer, (message) => message?.type === "ready");
      assert.ok(ready.sequence >= 300);
      assert.equal(ready.intervalMs, 10);
      assert.equal(ready.maxRuntimeMs, 5000);
      assert.equal(ready.maxCommits, 100);
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
      await waitForCondition(() => fs.existsSync(marker));
      assert.equal(processIsAlive(writer.pid), false);
    }
    assert.equal(childSupervisor.runningCount(), 0);
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

faultTest("killing Online Backup leaves no final target and cleanup recognizes residue", async () => {
  await inTempDirectory("interrupt-online", async (directory) => {
    const source = path.join(directory, "large-source.sqlite");
    const target = path.join(directory, "online-final.sqlite");
    createSyntheticDatabase(source, { rows: 800, payloadBytes: 1024 });
    const worker = trackFork(workerScript, [source, target, STRATEGIES.ONLINE], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, P1A_BACKUP_RATE: "1", P1A_WORKER_MAX_MS: "8000" },
    }, "Online Backup interrupt worker", 9000);
    try {
      await waitForMessage(worker, (message) => message?.type === "progress" && message.remainingPages > 0, 5000);
      worker.kill("SIGKILL");
      await waitForExit(worker, 3000, "Online Backup interrupt worker");
    } finally {
      await stopChild(worker);
    }

    assert.equal(fs.existsSync(target), false);
    assert.ok(stagingFiles(directory).length >= 1);
    const cleanup = cleanupStaleArtifacts(directory);
    assert.ok(cleanup.removed.length >= 1);
    assert.equal(stagingFiles(directory).length, 0);
  });
});

faultTest("killing VACUUM INTO pipeline before publication leaves only recognized residue", async () => {
  await inTempDirectory("interrupt-vacuum", async (directory) => {
    const source = path.join(directory, "source.sqlite");
    const target = path.join(directory, "vacuum-final.sqlite");
    createSyntheticDatabase(source, { rows: 120, payloadBytes: 512 });
    const worker = trackFork(workerScript, [source, target, STRATEGIES.VACUUM_INTO], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, P1A_HOLD_AFTER_SNAPSHOT_MS: "2000", P1A_WORKER_MAX_MS: "6000" },
    }, "VACUUM post-snapshot interrupt worker", 7000);
    try {
      await waitForMessage(worker, (message) => message?.type === "snapshot-ready", 3000);
      worker.kill("SIGKILL");
      await waitForExit(worker, 3000, "VACUUM post-snapshot interrupt worker");
    } finally {
      await stopChild(worker);
    }

    assert.equal(fs.existsSync(target), false);
    assert.ok(stagingFiles(directory).length >= 1);
    const cleanup = cleanupStaleArtifacts(directory);
    assert.ok(cleanup.removed.length >= 1);
    assert.equal(stagingFiles(directory).length, 0);
  });
});

faultTest("killing VACUUM INTO while its staging file is being written never publishes target", async () => {
  await inTempDirectory("interrupt-vacuum-write", async (directory) => {
    const source = path.join(directory, "large-source.sqlite");
    const target = path.join(directory, "vacuum-final.sqlite");
    createSyntheticDatabase(source, { rows: 2000, payloadBytes: 1024 });
    const worker = trackFork(workerScript, [source, target, STRATEGIES.VACUUM_INTO], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, P1A_HOLD_AFTER_SNAPSHOT_MS: "0", P1A_WORKER_MAX_MS: "8000" },
    }, "VACUUM write interrupt worker", 9000);

    let stagingName;
    try {
      stagingName = await waitForStagingCreation(directory, worker, 5000);
      worker.kill("SIGKILL");
      await waitForExit(worker, 3000, "VACUUM write interrupt worker");
    } finally {
      await stopChild(worker);
    }

    assert.equal(fs.existsSync(target), false);
    assert.equal(isStagingName(stagingName), true);
    const cleanup = cleanupStaleArtifacts(directory);
    assert.ok(cleanup.removed.includes(stagingName));
    assert.equal(stagingFiles(directory).length, 0);
  });
});

faultTest("bounded writer exits after a normal parent stop without a residual process", async () => {
  await inTempDirectory("writer-normal-exit", async (directory) => {
    const { harness, marker, writerPid } = await startLifecycleHarness(directory, "normal");
    try {
      await waitForExit(harness, 3000, "normal lifecycle harness");
      await waitForCondition(() => fs.existsSync(marker) && !processIsAlive(writerPid));
      assert.match(fs.readFileSync(marker, "utf8"), /ipc-stop|max-runtime|max-commits/);
    } finally {
      await stopChild(harness);
      forceKillPid(writerPid);
    }
  });
});

faultTest("writer exits when its parent is killed and the IPC channel disconnects", async () => {
  await inTempDirectory("writer-parent-killed", async (directory) => {
    const { harness, marker, writerPid } = await startLifecycleHarness(directory, "hold");
    try {
      harness.kill("SIGKILL");
      await waitForExit(harness, 3000, "killed lifecycle harness");
      await waitForCondition(() => !processIsAlive(writerPid), 4000);
      if (fs.existsSync(marker)) assert.match(fs.readFileSync(marker, "utf8"), /disconnect|max-runtime/);
    } finally {
      await stopChild(harness);
      forceKillPid(writerPid);
    }
  });
});

faultTest("writer exits when its IPC channel is explicitly disconnected", async () => {
  await inTempDirectory("writer-ipc-disconnect", async (directory) => {
    const { harness, marker, writerPid } = await startLifecycleHarness(directory, "ipc-disconnect");
    try {
      await waitForExit(harness, 3000, "IPC lifecycle harness");
      await waitForCondition(() => fs.existsSync(marker) && !processIsAlive(writerPid));
      assert.equal(fs.readFileSync(marker, "utf8").trim(), "disconnect");
    } finally {
      await stopChild(harness);
      forceKillPid(writerPid);
    }
  });
});

faultTest("SIGINT cleanup leaves no writer process", async () => {
  await inTempDirectory("writer-sigint", async (directory) => {
    const { harness, marker, writerPid } = await startLifecycleHarness(directory, "hold");
    try {
      harness.kill("SIGINT");
      await waitForExit(harness, 4000, "SIGINT lifecycle harness");
      await waitForCondition(() => !processIsAlive(writerPid), 4000);
      if (fs.existsSync(marker)) assert.match(fs.readFileSync(marker, "utf8"), /ipc-stop|SIGTERM|disconnect|max-runtime/);
    } finally {
      await stopChild(harness);
      forceKillPid(writerPid);
    }
  });
});

faultTest("snapshot worker hard timeout leaves only controlled staging residue", async () => {
  await inTempDirectory("worker-timeout", async (directory) => {
    const source = path.join(directory, "source.sqlite");
    const target = path.join(directory, "must-not-exist.sqlite");
    const unrelated = path.join(directory, "keep-me.txt");
    createSyntheticDatabase(source, { rows: 60, payloadBytes: 128 });
    fs.writeFileSync(unrelated, "keep", "utf8");
    const worker = trackFork(workerScript, [source, target, STRATEGIES.VACUUM_INTO], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, P1A_WORKER_MAX_MS: "500", P1A_HOLD_AFTER_SNAPSHOT_MS: "5000" },
    }, "hard-timeout snapshot worker", 2500);
    try {
      await waitForMessage(worker, (message) => message?.type === "snapshot-ready", 1500, "hard-timeout snapshot worker");
      const result = await waitForExit(worker, 2000, "hard-timeout snapshot worker");
      assert.equal(result.code, 124);
    } finally {
      await stopChild(worker);
    }
    assert.equal(fs.existsSync(target), false);
    assert.ok(stagingFiles(directory).length >= 1);
    cleanupStaleArtifacts(directory);
    assert.equal(stagingFiles(directory).length, 0);
    assert.equal(fs.readFileSync(unrelated, "utf8"), "keep");
  });
});

faultTest("parent hard deadline escalates a blocked worker and confirms exit", async () => {
  await inTempDirectory("worker-parent-deadline", async (directory) => {
    const source = path.join(directory, "source.sqlite");
    const target = path.join(directory, "must-not-exist.sqlite");
    createSyntheticDatabase(source, { rows: 20, payloadBytes: 64 });
    const worker = trackFork(workerScript, [source, target, STRATEGIES.VACUUM_INTO], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: {
        ...process.env,
        P1A_ALLOW_TEST_BLOCK: "1",
        P1A_TEST_BLOCK_MS: "3000",
        P1A_WORKER_MAX_MS: "5000",
      },
    }, "blocked snapshot worker", 500);
    await waitForMessage(worker, (message) => message?.type === "blocking", 1000, "blocked snapshot worker");
    const result = await waitForExit(worker, 3000, "blocked snapshot worker");
    assert.equal(childSupervisor.didTimeOut(worker), true);
    assert.equal(result.signal === "SIGKILL" || result.code !== 0, true);
    assert.equal(isChildRunning(worker), false);
    assert.equal(worker.listenerCount("message"), 0);
    assert.equal(worker.listenerCount("exit"), 0);
    assert.equal(worker.listenerCount("error"), 0);
    assert.equal(fs.existsSync(target), false);
    assert.equal(stagingFiles(directory).length, 0);
  });
});

faultTest("message deadline terminates the worker and removes all wait listeners", async () => {
  await inTempDirectory("worker-message-deadline", async (directory) => {
    const source = path.join(directory, "source.sqlite");
    const target = path.join(directory, "must-not-exist.sqlite");
    createSyntheticDatabase(source, { rows: 20, payloadBytes: 64 });
    const worker = trackFork(workerScript, [source, target, STRATEGIES.VACUUM_INTO], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: {
        ...process.env,
        P1A_ALLOW_TEST_BLOCK: "1",
        P1A_TEST_BLOCK_MS: "3000",
        P1A_WORKER_MAX_MS: "5000",
      },
    }, "message-timeout snapshot worker", 5000);
    await assert.rejects(
      waitForMessage(worker, () => false, 200, "message-timeout snapshot worker"),
      (error) => error.code === "P1A_CHILD_TIMEOUT",
    );
    assert.equal(isChildRunning(worker), false);
    assert.equal(worker.listenerCount("message"), 0);
    assert.equal(worker.listenerCount("exit"), 0);
    assert.equal(worker.listenerCount("error"), 0);
    assert.equal(fs.existsSync(target), false);
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
