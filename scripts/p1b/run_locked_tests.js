"use strict";

const fs = require("node:fs");
const path = require("node:path");
const baseline = require("../p1a/runtime-baseline.json");
const { assertRuntime } = require("../p1a/sqlite_snapshot");
const {
  ChildSupervisor,
  installSignalCleanup,
  signalChild,
  spawnTestProcess,
  waitForExit,
} = require("../p1a/child_process_safety");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function boundedTimeout(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(30000, Math.min(120000, number)) : fallback;
}

async function main() {
  try {
    assertRuntime({ node: baseline.node, sqlite: baseline.sqlite, platform: "linux", arch: "x64" });
  } catch (error) {
    fail(error?.message || "Locked P1B runtime capability check failed");
  }
  if (!fs.existsSync("/etc/alpine-release")) fail("Locked P1B tests require Alpine Linux");
  const alpine = fs.readFileSync("/etc/alpine-release", "utf8").trim();
  if (alpine !== baseline.alpine) fail(`Alpine version mismatch: expected ${baseline.alpine}, received ${alpine}`);

  const profile = ["safe", "full", "fault"].includes(process.env.P1B_TEST_PROFILE)
    ? process.env.P1B_TEST_PROFILE
    : "safe";
  const suiteTimeoutMs = boundedTimeout(process.env.P1B_LOCKED_SUITE_TIMEOUT_MS, 90000);
  process.stdout.write(
    `P1B locked runtime verified: Node ${baseline.node}, SQLite ${baseline.sqlite}, Alpine ${baseline.alpine}, linux/amd64, profile=${profile}, deadline=${suiteTimeoutMs}ms\n`,
  );

  const testFile = path.resolve(__dirname, "../../tests/p1b/backup_package.test.js");
  const supervisor = new ChildSupervisor({ label: "P1B locked test suite" });
  const child = supervisor.track(spawnTestProcess(process.execPath, [
    "--test",
    "--test-concurrency=1",
    "--test-timeout=30000",
    testFile,
  ], {
    stdio: "inherit",
    env: { ...process.env, P1B_LOCKED_RUNTIME: "1", P1B_READ_ONLY_DIR: "/p1b-readonly", P1B_TEST_PROFILE: profile },
  }), { label: "P1B locked test suite", maxRuntimeMs: suiteTimeoutMs, processGroup: true });
  const removeSignalCleanup = installSignalCleanup(supervisor);
  let result;
  try {
    result = await waitForExit(child, suiteTimeoutMs + 5000, "P1B locked test suite");
  } finally {
    removeSignalCleanup();
    await supervisor.terminateAll({ requestStop: true, processGroup: true }).catch(() => {});
    if (process.platform !== "win32") {
      try { signalChild(child, "SIGKILL", { processGroup: true }); } catch { /* group is already empty */ }
    }
  }
  if (supervisor.didTimeOut(child)) {
    process.stderr.write(`P1B locked test suite exceeded ${suiteTimeoutMs}ms and its process group was terminated\n`);
    process.exit(124);
  }
  process.exit(result.code == null ? 2 : result.code);
}

main().catch((error) => fail(error?.message || "P1B locked test runner failed"));
