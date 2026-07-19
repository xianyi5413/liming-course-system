"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const baseline = require("../p1a/runtime-baseline.json");
const { assertRuntime } = require("../p1a/sqlite_snapshot");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

try {
  assertRuntime({ node: baseline.node, sqlite: baseline.sqlite, platform: "linux", arch: "x64" });
} catch (error) {
  fail(error?.message || "Locked P1B runtime capability check failed");
}
if (!fs.existsSync("/etc/alpine-release")) fail("Locked P1B tests require Alpine Linux");
const alpine = fs.readFileSync("/etc/alpine-release", "utf8").trim();
if (alpine !== baseline.alpine) fail(`Alpine version mismatch: expected ${baseline.alpine}, received ${alpine}`);

process.stdout.write(`P1B locked runtime verified: Node ${baseline.node}, SQLite ${baseline.sqlite}, Alpine ${baseline.alpine}, linux/amd64\n`);
const testFile = path.resolve(__dirname, "../../tests/p1b/backup_package.test.js");
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", testFile], {
  stdio: "inherit",
  env: { ...process.env, P1B_LOCKED_RUNTIME: "1", P1B_READ_ONLY_DIR: "/p1b-readonly" },
});
process.exit(result.status == null ? 2 : result.status);
