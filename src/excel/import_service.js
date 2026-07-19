const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createWorkbook, parseWorkbook } = require("./xlsx_codec");
const { FULL_TABLE_DEFINITIONS, WORKBOOK_SEQUENCE } = require("./field_definitions");
const {
  FILE_TYPE, FORMAT_VERSION, NULL_MARKER, FullExcelError, expectedSheetNames, dataSheet,
  fieldCatalogSheet, infoSheet, exportFullData, verifyFullData, restoreFullData,
} = require("./full_backup");

const TEMPLATE_FILE_TYPE = "liming_full_data_template";
const TEMPLATE_FILENAME = "黎明教育_全量数据导入模板_v1.xlsx";
const TEMPLATE_GUIDE_SHEET = "填写说明";
const AUTH_SHEET = "账号认证数据";

function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const raw = String(password || "");
  if (raw.length < 6) throw new FullExcelError("FULL_EXCEL_INITIAL_PASSWORD_INVALID", "初始密码至少6位");
  return `pbkdf2$${salt}$${crypto.pbkdf2Sync(raw, salt, 120000, 32, "sha256").toString("hex")}`;
}
function templateSheet(definition) {
  const headers = definition.columns.map((column) => definition.key === "user_auth" && column.field_key === "password_hash" ? "初始密码" : column.display_name);
  return { name: definition.sheet_name, rows: [headers] };
}
function templateInfoSheet() {
  return { name: "导出说明", rows: [["字段", "值"], ["file_type", TEMPLATE_FILE_TYPE], ["format_version", FORMAT_VERSION], ["用途", "空系统初始化导入；填写后不得作为公开文件传播"], ["账号密码", "账号认证数据填写初始密码；导入时立即哈希，不保存明文"], ["ID规则", "ID及关联ID必须为整数且关系必须存在；不按姓名猜测、不自动改ID"], ["空值规则", "可空字段留空；必填字段不得留空"]] };
}
function guideSheet() {
  return { name: TEMPLATE_GUIDE_SHEET, rows: [
    ["主题", "说明", "合成示例"],
    ["填写范围", "只填写真实需要导入的行；不要保留不需要的示例", "示例学生"],
    ["日期", "日期使用YYYY-MM-DD，月份使用YYYY-MM-01", "2026-01-01"],
    ["金额", "人民币元，填写数值，不带¥或逗号", "128.50"],
    ["状态", "严格使用字段定义工作表列出的枚举值", "在读"],
    ["ID", "主键ID不可重复；外键ID必须指向同一文件中的记录", "1001"],
    ["账号", "用户账号填写账号信息；账号认证数据填写相同用户ID和初始密码", "demo_user / DemoPass123"],
    ["安全", "示例均为虚构信息；禁止填写Token、Cookie、Secret或真实云端密钥", "不适用"],
  ] };
}
function createTemplateBuffer() {
  const definitionSheets = new Map(FULL_TABLE_DEFINITIONS.map((definition) => [definition.key, templateSheet(definition)]));
  const sheets = WORKBOOK_SEQUENCE.map((item) => item === "导出说明" ? templateInfoSheet() : item === "字段定义" ? fieldCatalogSheet() : definitionSheets.get(item.key));
  sheets.push(guideSheet());
  return createWorkbook(sheets);
}

function templateRows(sheet, definition) {
  const expected = definition.columns.map((column) => definition.key === "user_auth" && column.field_key === "password_hash" ? "初始密码" : column.display_name);
  const [headers = [], ...rows] = sheet.rows;
  if (JSON.stringify(headers) !== JSON.stringify(expected)) throw new FullExcelError("FULL_EXCEL_COLUMNS_INVALID", `工作表列不匹配：${definition.sheet_name}`);
  return rows.filter((row) => row.some((value) => value !== "")).map((row, rowIndex) => Object.fromEntries(definition.columns.map((column, index) => {
    let value = row[index] ?? "";
    if (value === NULL_MARKER) value = null;
    if (value === "" && column.nullable) value = null;
    if (value === "" && !column.nullable && !(definition.key === "settings" && column.field_key === "value")) throw new FullExcelError("FULL_EXCEL_REQUIRED_VALUE_MISSING", `${definition.sheet_name} 第${rowIndex + 2}行缺少${expected[index]}`);
    if (value !== null && ["integer", "number", "amount", "boolean"].includes(column.data_type)) {
      if (!Number.isFinite(Number(value))) throw new FullExcelError("FULL_EXCEL_VALUE_INVALID", `${definition.sheet_name} 第${rowIndex + 2}行字段${expected[index]}不是数字`);
      value = Number(value);
    }
    if (definition.key === "user_auth" && column.field_key === "password_hash") value = passwordHash(value);
    return [column.field_key, value];
  })));
}

function templateToFullBuffer(input, options = {}) {
  const workbook = parseWorkbook(Buffer.isBuffer(input) ? input : fs.readFileSync(path.resolve(input)));
  const expected = [...expectedSheetNames(), TEMPLATE_GUIDE_SHEET];
  if (JSON.stringify(workbook.sheets.map((sheet) => sheet.name)) !== JSON.stringify(expected)) throw new FullExcelError("FULL_EXCEL_TEMPLATE_SHEET_ORDER_INVALID", "模板工作表名称或顺序不正确");
  const infoValues = new Map(workbook.sheetMap.get("导出说明").rows.slice(1).map((row) => [row[0], row[1]]));
  if (infoValues.get("file_type") !== TEMPLATE_FILE_TYPE || Number(infoValues.get("format_version")) !== FORMAT_VERSION) throw new FullExcelError("FULL_EXCEL_FORMAT_INVALID", "模板类型或版本不支持");
  const data = Object.fromEntries(FULL_TABLE_DEFINITIONS.map((definition) => [definition.key, templateRows(workbook.sheetMap.get(definition.sheet_name), definition)]));
  const counts = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length]));
  const createdAt = options.createdAt || new Date();
  const info = infoSheet({ appVersion: options.appVersion || "template-import", createdAt, counts, schemaVersion: 0, excludedSettings: 0 });
  const sheetsByKey = new Map(FULL_TABLE_DEFINITIONS.map((definition) => [definition.key, dataSheet(definition, data[definition.key])]));
  const sheets = WORKBOOK_SEQUENCE.map((item) => item === "导出说明" ? info : item === "字段定义" ? fieldCatalogSheet() : sheetsByKey.get(item.key));
  return { buffer: createWorkbook(sheets), data };
}

function normalizeImport(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(path.resolve(input));
  const workbook = parseWorkbook(buffer); const info = workbook.sheetMap.get("导出说明");
  if (!info) throw new FullExcelError("FULL_EXCEL_INFO_MISSING", "缺少导出说明");
  const values = new Map(info.rows.slice(1).map((row) => [row[0], row[1]]));
  if (values.get("file_type") === TEMPLATE_FILE_TYPE) return { kind: "template", ...templateToFullBuffer(buffer, options) };
  if (values.get("file_type") === FILE_TYPE) return { kind: "full_data", buffer };
  throw new FullExcelError("FULL_EXCEL_FORMAT_INVALID", "文件类型不支持");
}
function previewImport(input, options = {}) {
  const normalized = normalizeImport(input, options); const verified = verifyFullData(normalized.buffer);
  return { ok: true, kind: normalized.kind, file_type: FILE_TYPE, format_version: FORMAT_VERSION, counts: verified.counts };
}

const BUSINESS_TABLES = FULL_TABLE_DEFINITIONS.filter((definition) => definition.restore_source && !["settings", "pricing_standards", "roles", "role_permissions", "users", "user_auth", "user_page_permissions", "user_teacher_bindings", "role_filter_presets", "user_filter_presets"].includes(definition.key)).map((definition) => definition.source_table);
function assertBusinessEmpty(dbPath) {
  const db = new DatabaseSync(path.resolve(dbPath), { readOnly: true });
  try { const occupied = [...new Set(BUSINESS_TABLES)].filter((table) => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count) > 0); if (occupied.length) throw new FullExcelError("FULL_EXCEL_INITIALIZE_TARGET_NOT_EMPTY", "空系统初始化要求业务表为空", { table_count: occupied.length }); } finally { db.close(); }
}
function importFullExcel({ dbPath, inputPath, mode, preBackupDir = "", preBackupSatisfied = false, appVersion = "unknown" }) {
  if (!dbPath || !inputPath || !["initialize", "overwrite"].includes(mode)) throw new FullExcelError("FULL_EXCEL_IMPORT_ARGUMENT_INVALID", "必须提供数据库、Excel和initialize/overwrite模式");
  const normalized = normalizeImport(inputPath, { appVersion }); const verified = verifyFullData(normalized.buffer);
  let preBackup = null;
  if (mode === "initialize") assertBusinessEmpty(dbPath);
  if (mode === "overwrite") {
    if (!preBackupSatisfied) {
      if (!preBackupDir) throw new FullExcelError("FULL_EXCEL_PRE_BACKUP_REQUIRED", "覆盖恢复必须先生成导入前备份");
      fs.mkdirSync(path.resolve(preBackupDir), { recursive: true });
      const outputPath = path.join(path.resolve(preBackupDir), `导入前_${Date.now()}.xlsx`);
      preBackup = exportFullData({ dbPath, outputPath, appVersion }); verifyFullData(outputPath);
    }
  }
  const temporary = path.join(path.dirname(path.resolve(inputPath)), `.normalized-${process.pid}-${Date.now()}.xlsx`);
  try { fs.writeFileSync(temporary, normalized.buffer, { flag: "wx", mode: 0o600 }); const result = restoreFullData({ dbPath, inputPath: temporary }); return { ...result, mode, input_kind: normalized.kind, preview_counts: verified.counts, pre_backup: preBackup ? { filename: preBackup.filename, output_path: preBackup.outputPath } : null }; }
  finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
}

module.exports = { TEMPLATE_FILE_TYPE, TEMPLATE_FILENAME, TEMPLATE_GUIDE_SHEET, createTemplateBuffer, templateToFullBuffer, normalizeImport, previewImport, assertBusinessEmpty, importFullExcel, passwordHash };
