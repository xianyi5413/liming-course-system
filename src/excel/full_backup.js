const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createWorkbook, parseWorkbook } = require("./xlsx_codec");
const { FULL_TABLE_DEFINITIONS, EXCLUDED_TABLES, UNIQUE_KEYS_BY_TABLE } = require("./field_definitions");

const BACKUP_FORMAT = "liming_system_full_excel";
const FORMAT_VERSION = 1;
const NULL_MARKER = "__LIMING_NULL_V1__";
const ESCAPE_MARKER = "__LIMING_TEXT_V1__";
const SECRET_SETTING_PATTERN = /(password|passwd|secret|token|cookie|session|credential|oauth|private[_-]?key|baidu.*key)/i;

class FullExcelError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = "FullExcelError"; this.code = code; this.details = details; }
}

function encodeValue(value) {
  if (value === null || value === undefined) return NULL_MARKER;
  if (typeof value === "string" && (value === NULL_MARKER || value.startsWith(ESCAPE_MARKER))) return `${ESCAPE_MARKER}${value}`;
  return value;
}

function decodeValue(value) {
  if (value === NULL_MARKER) return null;
  if (typeof value === "string" && value.startsWith(ESCAPE_MARKER)) return value.slice(ESCAPE_MARKER.length);
  return value;
}

function weekdayCn(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
}

function safeTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
}

function fullBackupFilename(date = new Date()) { return `黎明教育_系统完整数据备份_${safeTimestamp(date)}.xlsx`; }
function tableExists(db, table) { return !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table); }
function tableColumns(db, table) { return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((row) => row.name); }

function ensureSchemaCompatible(db) {
  const byTable = new Map();
  for (const definition of FULL_TABLE_DEFINITIONS) {
    if (!tableExists(db, definition.source_table)) throw new FullExcelError("FULL_EXCEL_SCHEMA_MISSING", `缺少数据表：${definition.source_table}`);
    if (!byTable.has(definition.source_table)) byTable.set(definition.source_table, new Set(tableColumns(db, definition.source_table)));
    const actual = byTable.get(definition.source_table);
    for (const column of definition.columns) {
      if (column.source_field && !actual.has(column.source_field)) throw new FullExcelError("FULL_EXCEL_SCHEMA_COLUMN_MISSING", `数据表字段不兼容：${definition.source_table}.${column.source_field}`);
    }
  }
}

function rowsForDefinition(db, definition) {
  let rows = db.prepare(`SELECT * FROM ${definition.source_table}`).all();
  if (definition.key === "settings") rows = rows.filter((row) => !SECRET_SETTING_PATTERN.test(String(row.key || "")));
  if (definition.key === "user_auth") rows = rows.map((row) => ({ id: row.id, password_hash: row.password_hash }));
  if (definition.key === "lessons") rows = rows.map((row) => ({ ...row, weekday: weekdayCn(row.date) }));
  return rows;
}

function dataSheet(definition, rows) {
  const headers = definition.columns.map((column) => column.display_name);
  return {
    name: definition.sheet_name,
    hiddenColumns: definition.columns.map((column, index) => column.is_user_visible ? -1 : index).filter((index) => index >= 0),
    rows: [headers, ...rows.map((row) => definition.columns.map((column) => encodeValue(column.source_field ? row[column.source_field] : row[column.field_key])))],
  };
}

function fieldCatalogSheet() {
  const headers = ["工作表", "source_table", "field_key", "display_name", "column_order", "data_type", "nullable", "required_for_restore", "is_primary_key", "is_relation_field", "is_sensitive", "is_user_visible", "enum_values", "date_format", "amount_unit"];
  const rows = FULL_TABLE_DEFINITIONS.flatMap((definition) => definition.columns.map((column) => [
    definition.sheet_name, column.source_table, column.field_key, column.display_name, column.column_order,
    column.data_type, Number(column.nullable), Number(column.required_for_restore), Number(column.is_primary_key),
    Number(column.is_relation_field), Number(column.is_sensitive), Number(column.is_user_visible),
    column.enum_values.join("|"), column.date_format, column.amount_unit,
  ]));
  return { name: "字段定义", rows: [headers, ...rows] };
}

function infoSheet({ appVersion, createdAt, counts, schemaVersion, excludedSettings }) {
  const rows = [
    ["字段", "值"],
    ["backup_format", BACKUP_FORMAT], ["format_version", FORMAT_VERSION],
    ["导出时间（UTC）", createdAt.toISOString()],
    ["导出时间（Asia/Shanghai）", `${safeTimestamp(createdAt).replace(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3T$4:$5:$6")}+08:00`],
    ["应用版本", appVersion || "unknown"], ["schema_version_source", "pragma_user_version"], ["schema_version", schemaVersion],
    ["恢复模式", "完整覆盖恢复"], ["空值编码", NULL_MARKER],
    ["敏感数据", "账号认证数据含密码哈希；禁止普通预览、公开分享或写入日志"],
    ["会话数据", "Session、Cookie、Token不导出；恢复后必须重新登录"],
    ["排除设置数量", excludedSettings],
    [], ["工作表", "source_table", "记录数", "恢复级别"],
    ...FULL_TABLE_DEFINITIONS.map((definition) => [definition.sheet_name, definition.source_table, counts[definition.key], definition.restore_policy]),
    [], ["未导出表", "分类", "原因"], ...EXCLUDED_TABLES.map((item) => [item.table, item.classification, item.reason]),
  ];
  return { name: "完整备份说明", rows };
}

function buildFullBackupBuffer(db, options = {}) {
  ensureSchemaCompatible(db);
  const integrity = db.prepare("PRAGMA integrity_check").all().map((row) => Object.values(row)[0]);
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (integrity.length !== 1 || integrity[0] !== "ok") throw new FullExcelError("FULL_EXCEL_SOURCE_INTEGRITY_FAILED", "源数据库完整性检查失败");
  if (foreignKeys.length) throw new FullExcelError("FULL_EXCEL_SOURCE_FOREIGN_KEY_FAILED", "源数据库存在外键错误");
  const createdAt = options.createdAt || new Date();
  const definitionsAndRows = FULL_TABLE_DEFINITIONS.map((definition) => ({ definition, rows: rowsForDefinition(db, definition) }));
  const counts = Object.fromEntries(definitionsAndRows.map(({ definition, rows }) => [definition.key, rows.length]));
  const allSettingsCount = Number(db.prepare("SELECT COUNT(*) AS count FROM settings").get().count);
  const schemaVersion = Number(db.prepare("PRAGMA user_version").get().user_version || 0);
  const sheets = [
    infoSheet({ appVersion: options.appVersion, createdAt, counts, schemaVersion, excludedSettings: allSettingsCount - counts.settings }),
    fieldCatalogSheet(),
    ...definitionsAndRows.map(({ definition, rows }) => dataSheet(definition, rows)),
  ];
  return { buffer: createWorkbook(sheets), counts, createdAt, schemaVersion, sheets: sheets.map((sheet) => sheet.name) };
}

function exportFullBackup({ dbPath, outputPath, appVersion = "unknown", createdAt = new Date() }) {
  if (!dbPath || !outputPath) throw new FullExcelError("FULL_EXCEL_ARGUMENT_REQUIRED", "必须提供数据库和输出路径");
  const source = path.resolve(dbPath); const target = path.resolve(outputPath);
  if (!fs.existsSync(source)) throw new FullExcelError("FULL_EXCEL_SOURCE_NOT_FOUND", "源数据库不存在");
  if (fs.existsSync(target)) throw new FullExcelError("FULL_EXCEL_TARGET_EXISTS", "目标文件已存在");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.partial-${process.pid}`;
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec("BEGIN");
    let result;
    try { result = buildFullBackupBuffer(db, { appVersion, createdAt }); db.exec("COMMIT"); }
    catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
    fs.writeFileSync(temporary, result.buffer, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, target);
    return { ...result, outputPath: target, filename: path.basename(target) };
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  } finally { db.close(); }
}

function rowsAsObjects(sheet, definition) {
  const [headers = [], ...dataRows] = sheet.rows;
  const expected = definition.columns.map((column) => column.display_name);
  if (JSON.stringify(headers) !== JSON.stringify(expected)) throw new FullExcelError("FULL_EXCEL_COLUMNS_INVALID", `工作表列不匹配：${definition.sheet_name}`);
  return dataRows.filter((row) => row.some((value) => value !== "")).map((row, rowIndex) => {
    const result = {};
    definition.columns.forEach((column, index) => {
      let value = decodeValue(row[index] ?? "");
      if (value !== null && ["integer", "number", "amount", "boolean"].includes(column.data_type)) {
        if (value === "" || !Number.isFinite(Number(value))) throw new FullExcelError("FULL_EXCEL_VALUE_INVALID", `${definition.sheet_name} 第${rowIndex + 2}行字段${column.display_name}不是数字`);
        value = Number(value);
      }
      if (value === null && !column.nullable) throw new FullExcelError("FULL_EXCEL_REQUIRED_VALUE_MISSING", `${definition.sheet_name} 第${rowIndex + 2}行缺少${column.display_name}`);
      result[column.field_key] = value;
    });
    return result;
  });
}

function validateRelations(data) {
  const ids = (key, field = "id") => new Set((data[key] || []).map((row) => row[field]));
  const lessonIds = ids("lessons"); const staffIds = ids("staff"); const userIds = ids("users"); const roleCodes = ids("roles", "code"); const ruleIds = ids("teacher_salary_rules");
  const requireRef = (rows, field, valid, label, nullable = false) => rows.forEach((row) => { if ((row[field] === null || row[field] === "") && nullable) return; if (!valid.has(row[field])) throw new FullExcelError("FULL_EXCEL_RELATION_INVALID", `${label}关联不存在`); });
  requireRef(data.fee_overrides || [], "lesson_id", lessonIds, "单节费用覆盖课程");
  requireRef([...(data.staff_salary_monthly || []), ...(data.staff_attendance || [])], "staff_id", staffIds, "员工");
  requireRef([...(data.user_teacher_bindings || []), ...(data.user_page_permissions || []), ...(data.user_filter_presets || [])], "user_id", userIds, "用户");
  requireRef(data.user_auth || [], "id", userIds, "账号认证用户");
  requireRef(data.users || [], "role", roleCodes, "账号角色");
  requireRef(data.lessons || [], "teacher_salary_rule_id", ruleIds, "课程薪资规则", true);
}

function verifyFullBackup(input) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(path.resolve(input));
  const workbook = parseWorkbook(buffer);
  const info = workbook.sheetMap.get("完整备份说明");
  if (!info) throw new FullExcelError("FULL_EXCEL_INFO_MISSING", "缺少完整备份说明");
  const infoValues = new Map(info.rows.slice(1).filter((row) => row[0] && row[1] !== undefined).map((row) => [row[0], row[1]]));
  if (infoValues.get("backup_format") !== BACKUP_FORMAT || Number(infoValues.get("format_version")) !== FORMAT_VERSION) throw new FullExcelError("FULL_EXCEL_FORMAT_INVALID", "备份格式或版本不支持");
  const data = {};
  for (const definition of FULL_TABLE_DEFINITIONS) {
    const sheet = workbook.sheetMap.get(definition.sheet_name);
    if (!sheet) throw new FullExcelError("FULL_EXCEL_SHEET_MISSING", `缺少工作表：${definition.sheet_name}`);
    data[definition.key] = rowsAsObjects(sheet, definition);
    const primaryFields = definition.columns.filter((column) => column.is_primary_key).map((column) => column.field_key);
    if (primaryFields.length) {
      const seen = new Set();
      for (const row of data[definition.key]) {
        const key = JSON.stringify(primaryFields.map((fieldName) => row[fieldName]));
        if (seen.has(key)) throw new FullExcelError("FULL_EXCEL_PRIMARY_KEY_DUPLICATE", `${definition.sheet_name}存在重复主键`);
        seen.add(key);
      }
    }
  }
  const catalog = workbook.sheetMap.get("字段定义");
  if (!catalog) throw new FullExcelError("FULL_EXCEL_FIELD_CATALOG_MISSING", "缺少字段定义工作表");
  const expectedCatalog = fieldCatalogSheet().rows;
  if (JSON.stringify(catalog.rows) !== JSON.stringify(expectedCatalog)) throw new FullExcelError("FULL_EXCEL_FIELD_CATALOG_INVALID", "字段定义与格式版本不匹配");
  const countRows = new Map(info.rows.filter((row) => FULL_TABLE_DEFINITIONS.some((definition) => definition.sheet_name === row[0])).map((row) => [row[0], Number(row[2])]));
  for (const definition of FULL_TABLE_DEFINITIONS) if (countRows.get(definition.sheet_name) !== data[definition.key].length) throw new FullExcelError("FULL_EXCEL_COUNT_MISMATCH", `${definition.sheet_name}记录数与说明不一致`);
  const authIds = new Set(data.user_auth.map((row) => row.id));
  if (data.users.some((row) => !authIds.has(row.id))) throw new FullExcelError("FULL_EXCEL_AUTH_MISSING", "存在缺少认证数据的账号");
  const customStatuses = (() => {
    try { const value = data.settings.find((row) => row.key === "custom_course_statuses")?.value; const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
  })();
  for (const definition of FULL_TABLE_DEFINITIONS) {
    for (const column of definition.columns.filter((item) => item.enum_values.length)) {
      const allowed = new Set(column.field_key === "status" && definition.key === "lessons" ? [...column.enum_values, ...customStatuses] : column.enum_values);
      for (const row of data[definition.key]) if (row[column.field_key] !== null && row[column.field_key] !== "" && !allowed.has(row[column.field_key])) throw new FullExcelError("FULL_EXCEL_ENUM_INVALID", `${definition.sheet_name}字段${column.display_name}包含无效枚举值`);
    }
  }
  for (const [table, keyGroups] of Object.entries(UNIQUE_KEYS_BY_TABLE)) {
    const definition = FULL_TABLE_DEFINITIONS.find((item) => item.source_table === table && item.key !== "user_auth");
    if (!definition) continue;
    for (const fields of keyGroups) {
      const seen = new Set();
      for (const row of data[definition.key]) { const key = JSON.stringify(fields.map((fieldName) => row[fieldName])); if (seen.has(key)) throw new FullExcelError("FULL_EXCEL_UNIQUE_KEY_DUPLICATE", `${definition.sheet_name}存在重复唯一键`); seen.add(key); }
    }
  }
  const activeSalaryKeys = new Set();
  for (const row of data.teacher_salary_rules.filter((item) => Number(item.is_active) === 1)) { const key = JSON.stringify([row.teacher_name, row.grade, row.subject, row.student_names]); if (activeSalaryKeys.has(key)) throw new FullExcelError("FULL_EXCEL_UNIQUE_KEY_DUPLICATE", "教师薪资规则存在重复启用规则"); activeSalaryKeys.add(key); }
  validateRelations(data);
  return { ok: true, format: BACKUP_FORMAT, version: FORMAT_VERSION, data, counts: Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])), workbook };
}

function directRestoreRows(verified, definition) {
  if (definition.key === "users") {
    const auth = new Map(verified.data.user_auth.map((row) => [row.id, row.password_hash]));
    return verified.data.users.map((row) => ({ ...row, password_hash: auth.get(row.id) }));
  }
  return verified.data[definition.key];
}

function restoreFullBackup({ dbPath, inputPath }) {
  const verified = verifyFullBackup(inputPath);
  const target = path.resolve(dbPath);
  if (!fs.existsSync(target)) throw new FullExcelError("FULL_EXCEL_TARGET_DB_NOT_FOUND", "目标数据库不存在，请先初始化数据库结构");
  const db = new DatabaseSync(target);
  try {
    ensureSchemaCompatible(db);
    db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
    try {
      const directDefinitions = FULL_TABLE_DEFINITIONS.filter((definition) => definition.key !== "user_auth");
      const uniqueTables = [...new Set(directDefinitions.map((definition) => definition.source_table))];
      for (const table of [...uniqueTables].reverse()) db.exec(`DELETE FROM ${table}`);
      for (const definition of [...directDefinitions].sort((a, b) => a.restore_order - b.restore_order)) {
        const rows = directRestoreRows(verified, definition);
        const available = new Set(tableColumns(db, definition.source_table));
        const sourceFields = definition.key === "users"
          ? [...definition.columns.map((column) => column.source_field).filter(Boolean), "password_hash"]
          : definition.columns.map((column) => column.source_field).filter((fieldName) => fieldName && available.has(fieldName));
        const fields = [...new Set(sourceFields)];
        const statement = db.prepare(`INSERT INTO ${definition.source_table}(${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`);
        for (const row of rows) statement.run(...fields.map((fieldName) => row[fieldName]));
      }
      const integrity = db.prepare("PRAGMA integrity_check").all().map((row) => Object.values(row)[0]);
      const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
      if (integrity.length !== 1 || integrity[0] !== "ok") throw new FullExcelError("FULL_EXCEL_INTEGRITY_FAILED", "恢复后数据库完整性检查失败");
      if (foreignKeys.length) throw new FullExcelError("FULL_EXCEL_FOREIGN_KEY_FAILED", "恢复后存在外键错误");
      db.exec("COMMIT");
      return { ok: true, counts: verified.counts, integrity_check: "ok", foreign_key_violation_count: 0 };
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  } finally { db.close(); }
}

module.exports = {
  BACKUP_FORMAT, FORMAT_VERSION, NULL_MARKER, FullExcelError, fullBackupFilename,
  buildFullBackupBuffer, exportFullBackup, verifyFullBackup, restoreFullBackup,
};
