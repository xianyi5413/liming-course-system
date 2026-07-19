"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const baseline = require("./runtime-baseline.json");
const { assertRuntime } = require("./sqlite_snapshot");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

try {
  assertRuntime({
    node: baseline.node,
    sqlite: baseline.sqlite,
    platform: "linux",
    arch: "x64",
  });
} catch (error) {
  fail(error?.message || "Locked P1A runtime capability check failed");
}

const alpineReleasePath = "/etc/alpine-release";
if (!fs.existsSync(alpineReleasePath)) fail("Locked P1A tests require Alpine Linux");
const alpineVersion = fs.readFileSync(alpineReleasePath, "utf8").trim();
if (alpineVersion !== baseline.alpine) {
  fail(`Alpine version mismatch: expected ${baseline.alpine}, received ${alpineVersion}`);
}

process.stdout.write(`P1A locked runtime verified: Node ${baseline.node}, SQLite ${baseline.sqlite}, Alpine ${baseline.alpine}, linux/amd64\n`);
const testFile = path.resolve(__dirname, "../../tests/p1a/sqlite_snapshot.test.js");
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", testFile], {
  stdio: "inherit",
  env: {
    ...process.env,
    P1A_LOCKED_RUNTIME: "1",
  },
});
process.exit(result.status == null ? 2 : result.status);
