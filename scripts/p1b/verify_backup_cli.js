"use strict";

const { ERROR_CODES, P1BError, sanitizeCliError } = require("./common");
const { verifyBackupPackage } = require("./verify_backup");

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
    "  node scripts/p1b/verify_backup_cli.js --zip <package.zip> [--sha256 <package.zip.sha256>]",
    "",
    "Verification reads the package and uses only a controlled temporary SQLite copy.",
  ].join("\n");
}

async function main() {
  try {
    const args = parseArguments(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const result = await verifyBackupPackage({ zipPath: args.zip, sidecarPath: args.sha256 });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      backup_id: result.backupId,
      package_sha256: result.packageSha256,
      manifest_version: result.manifestVersion,
      component_count: result.componentCount,
      database_integrity_check: result.databaseIntegrityCheck,
      database_foreign_key_violation_count: result.databaseForeignKeyViolationCount,
    })}\n`);
  } catch (error) {
    const output = sanitizeCliError(error);
    process.stderr.write(`${JSON.stringify(output)}\n`);
    process.exitCode = output.error_code === ERROR_CODES.INVALID_ARGUMENT ? 2 : 4;
  }
}

if (require.main === module) main();

module.exports = { main, parseArguments, usage };
