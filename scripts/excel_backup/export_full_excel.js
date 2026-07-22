const path = require("node:path");
const { exportFullData, fullDataFilename } = require("../../src/excel/full_backup");

function args(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) if (argv[index].startsWith("--")) values[argv[index].slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  return values;
}

try {
  const options = args(process.argv.slice(2));
  if (!options.db) throw Object.assign(new Error("必须提供 --db"), { code: "FULL_EXCEL_ARGUMENT_REQUIRED" });
  const output = options.output ? path.resolve(options.output) : path.resolve(process.cwd(), fullDataFilename());
  const result = exportFullData({ dbPath: options.db, outputPath: output, appVersion: options["app-version"] || process.env.APP_VERSION || "unknown" });
  console.log(JSON.stringify({ ok: true, filename: result.filename, counts: result.counts, schema_version: result.schemaVersion }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code || "FULL_EXCEL_EXPORT_FAILED", message: error.message || "完整Excel导出失败" }));
  process.exitCode = 1;
}
