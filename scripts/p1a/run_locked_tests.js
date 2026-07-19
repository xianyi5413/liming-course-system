"use strict";

const fs = require("node:fs");
const path = require("node:path");
const baseline = require("./runtime-baseline.json");
const { assertRuntime } = require("./sqlite_snapshot");
const {
  ChildSupervisor,
  installSignalCleanup,
  signalChild,
  spawnTestProcess,
  waitForExit,
} = require("./child_process_safety");

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
    fail(error?.message || "Locked P1A runtime capability check failed");
  }

  const alpineReleasePath = "/etc/alpine-release";
  if (!fs.existsSync(alpineReleasePath)) fail("Locked P1A tests require Alpine Linux");
  const alpineVersion = fs.readFileSync(alpineReleasePath, "utf8").trim();
  if (alpineVersion !== baseline.alpine) fail(`Alpine version mismatch: expected ${baseline.alpine}, received ${alpineVersion}`);

  const profile = ["safe", "full", "fault"].includes(process.env.P1A_TEST_PROFILE)
    ? process.env.P1A_TEST_PROFILE
    : "safe";
  const suiteTimeoutMs = boundedTimeout(process.env.P1A_LOCKED_SUITE_TIMEOUT_MS, 90000);
  process.stdout.write(
    `P1A locked runtime verified: Node ${baseline.node}, SQLite ${baseline.sqlite}, Alpine ${baseline.alpine}, linux/amd64, profile=${profile}, deadline=${suiteTimeoutMs}ms\n`,
  );

  const testFile = path.resolve(__dirname, "../../tests/p1a/sqlite_snapshot.test.js");
  const supervisor = new ChildSupervisor({ label: "P1A locked test suite" });
  const child = supervisor.track(spawnTestProcess(process.execPath, [
    "--test",
    "--test-concurrency=1",
    "--test-timeout=15000",
    testFile,
  ], {
    stdio: "inherit",
    env: {
      ...process.env,
      P1A_LOCKED_RUNTIME: "1",
      P1A_TEST_PROFILE: profile,
    },
  }), { label: "P1A locked test suite", maxRuntimeMs: suiteTimeoutMs, processGroup: true });
  const removeSignalCleanup = installSignalCleanup(supervisor);
  let result;
  try {
    result = await waitForExit(child, suiteTimeoutMs + 5000, "P1A locked test suite");
  } finally {
    removeSignalCleanup();
    await supervisor.terminateAll({ requestStop: true, processGroup: true }).catch(() => {});
    if (process.platform !== "win32") {
      try { signalChild(child, "SIGKILL", { processGroup: true }); } catch { /* group is already empty */ }
    }
  }
  if (supervisor.didTimeOut(child)) {
    process.stderr.write(`P1A locked test suite exceeded ${suiteTimeoutMs}ms and its process group was terminated\n`);
    process.exit(124);
  }
  process.exit(result.code == null ? 2 : result.code);
}

main().catch((error) => fail(error?.message || "P1A locked test runner failed"));
