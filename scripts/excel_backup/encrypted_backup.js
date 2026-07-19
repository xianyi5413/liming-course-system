#!/usr/bin/env node
const { encryptFile, decryptFile, verifyEncryptedFile } = require("../../src/backup/encryption");
function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ""; }
async function main() {
  const command = process.argv[2]; const inputPath = option("--input"); const outputPath = option("--output");
  if (!inputPath || !["encrypt", "decrypt", "verify"].includes(command) || (command !== "verify" && !outputPath)) throw Object.assign(new Error("用法：encrypted_backup.js encrypt|decrypt|verify --input 文件 [--output 文件]"), { code: "BACKUP_ENCRYPTION_ARGUMENT_INVALID" });
  const result = command === "encrypt" ? await encryptFile({ inputPath, outputPath }) : command === "decrypt" ? await decryptFile({ inputPath, outputPath }) : await verifyEncryptedFile({ inputPath });
  process.stdout.write(`${JSON.stringify({ ok: true, command, ...result })}\n`);
}
main().catch((error) => { process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "BACKUP_ENCRYPTION_FAILED", error: error.message })}\n`); process.exitCode = 1; });
