const fs = require("node:fs");
const path = require("node:path");
const { TEMPLATE_FILENAME, createTemplateBuffer } = require("../../src/excel/import_service");
const index = process.argv.indexOf("--output");
const output = path.resolve(index >= 0 ? process.argv[index + 1] : TEMPLATE_FILENAME);
try { if (fs.existsSync(output)) throw Object.assign(new Error("目标文件已存在"), { code: "FULL_EXCEL_TARGET_EXISTS" }); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, createTemplateBuffer(), { flag: "wx", mode: 0o600 }); console.log(JSON.stringify({ ok: true, filename: path.basename(output) })); }
catch (error) { console.error(JSON.stringify({ ok: false, code: error.code || "FULL_EXCEL_TEMPLATE_FAILED", message: error.message || "模板生成失败" })); process.exitCode = 1; }
