const { importFullExcel } = require("../../src/excel/import_service");
function value(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ""; }
try { const result = importFullExcel({ dbPath: value("--db"), inputPath: value("--input"), mode: value("--mode"), preBackupDir: value("--pre-backup-dir"), appVersion: process.env.APP_VERSION || "unknown" }); console.log(JSON.stringify({ ...result, pre_backup: result.pre_backup ? { filename: result.pre_backup.filename } : null })); }
catch (error) { console.error(JSON.stringify({ ok: false, code: error.code || "FULL_EXCEL_IMPORT_FAILED", message: error.message || "导入失败" })); process.exitCode = 1; }
