const { verifyFullData } = require("../../src/excel/full_backup");

function value(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ""; }
try {
  const input = value("--input");
  if (!input) throw Object.assign(new Error("必须提供 --input"), { code: "FULL_EXCEL_ARGUMENT_REQUIRED" });
  const result = verifyFullData(input);
  console.log(JSON.stringify({ ok: true, file_type: result.file_type, format_version: result.version, counts: result.counts }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code || "FULL_EXCEL_VERIFY_FAILED", message: error.message || "完整Excel验证失败" }));
  process.exitCode = 1;
}
