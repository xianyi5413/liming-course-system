"use strict";

const path = require("node:path");

const { ERROR_CODES, P1BError, sanitizeCliError } = require("./common");
const { createBackupPackage } = require("./backup_package");

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { help: true };
    if (!argument.startsWith("--") || index + 1 >= argv.length) throw new P1BError(ERROR_CODES.INVALID_ARGUMENT, "Invalid CLI arguments");
    values[argument.slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/p1b/backup_cli.js --source-db <sqlite> --data-dir <data> --backup-root <root>",
    "    [--strategy online|vacuum-into] [--trigger manual|scheduled] [--scheduled-for <ISO-8601-with-timezone>]",
    "",
    "P1B creates a package under <backup-root>/system-v1 and never restores a database.",
  ].join("\n");
}

function exitCode(errorCode) {
  if (errorCode === ERROR_CODES.INVALID_ARGUMENT) return 2;
  if ([ERROR_CODES.IO_PERMISSION_DENIED, ERROR_CODES.SPACE_INSUFFICIENT].includes(errorCode)) return 3;
  return 4;
}

async function main() {
  let args;
  try {
    args = parseArguments(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const result = await createBackupPackage({
      sourceDatabase: args["source-db"],
      dataDirectory: args["data-dir"],
      backupRoot: args["backup-root"],
      snapshotStrategy: args.strategy,
      trigger: args.trigger,
      scheduledFor: args["scheduled-for"],
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      task_id: result.taskId,
      backup_id: result.backupId,
      package_directory: path.basename(result.finalDirectory),
      zip_file: path.basename(result.zipPath),
      sha256_file: path.basename(result.sha256Path),
      package_sha256: result.packageSha256,
      snapshot_strategy: result.snapshotStrategy,
    })}\n`);
  } catch (error) {
    const output = sanitizeCliError(error);
    process.stderr.write(`${JSON.stringify(output)}\n`);
    process.exitCode = exitCode(output.error_code);
  }
}

if (require.main === module) main();

module.exports = { main, parseArguments, usage };
