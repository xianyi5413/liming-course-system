const { restoreFullBackup } = require("../../src/excel/full_backup");

function value(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ""; }
try {
  const dbPath = value("--db"); const inputPath = value("--input"); const confirmation = value("--confirm");
  if (!dbPath || !inputPath) throw Object.assign(new Error("必须提供 --db 和 --input"), { code: "FULL_EXCEL_ARGUMENT_REQUIRED" });
  if (confirmation !== "OVERWRITE") throw Object.assign(new Error("覆盖恢复必须提供 --confirm OVERWRITE"), { code: "FULL_EXCEL_CONFIRMATION_REQUIRED" });
  const result = restoreFullBackup({ dbPath, inputPath });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code || "FULL_EXCEL_RESTORE_FAILED", message: error.message || "完整Excel恢复失败" }));
  process.exitCode = 1;
}
