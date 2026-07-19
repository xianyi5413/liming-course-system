const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createWorkbook, parseWorkbook } = require("./xlsx_codec");
const {
  DEFAULT_COURSE_STATUSES, FULL_TABLE_DEFINITIONS, WORKBOOK_SEQUENCE,
  EXCLUDED_TABLES, UNIQUE_KEYS_BY_TABLE,
} = require("./field_definitions");

const FILE_TYPE = "liming_full_data_excel";
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
function text(value) { return String(value ?? "").trim(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function splitStudents(value) { return text(value).split(/[、,，;；\n\r]/).map((name) => name.trim()).filter(Boolean); }
function normalizedStudents(value) { return [...new Set(splitStudents(value).map((name) => name.replace(/\s+/g, "")))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).join("、"); }
function weekdayCn(value) { if (!value) return ""; const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? "" : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()]; }
function safeTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
}
function fullDataFilename(date = new Date()) { return `黎明教育_全量数据_${safeTimestamp(date)}.xlsx`; }
function tableExists(db, table) { return !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table); }
function tableColumns(db, table) { return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((row) => row.name); }

function restoreDefinitions() { return FULL_TABLE_DEFINITIONS.filter((definition) => definition.restore_source && definition.key !== "user_auth"); }
function customStatuses(db) {
  try { const parsed = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='custom_course_statuses'").get()?.value || "[]"); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}
function deriveStatus(row, allowed) {
  const current = text(row.status);
  if (allowed.has(current)) return current;
  if (row.lesson_status === "试课") return "试课";
  if (row.lesson_status === "考试") return "考试";
  if (row.lesson_status === "上课（未缴费）") return "未缴费";
  if (row.lesson_status === "请假" || row.course_status === "请假") return "请假";
  if (row.course_status === "已上") return "已上";
  return "待上";
}
function priceBucket(grade, count) { if (!count) return 1; if (String(grade).startsWith("高")) return count >= 4 ? 4 : count; if (String(grade).startsWith("初")) return count >= 3 ? 4 : Math.min(count, 2); return count >= 4 ? 4 : count; }
function timeHours(value) {
  const match = text(value).match(/(\d{1,2}):(\d{2})\s*[-~～—至]\s*(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  const minutes = Number(match[3]) * 60 + Number(match[4]) - Number(match[1]) * 60 - Number(match[2]);
  return minutes > 0 ? Math.round((minutes / 60) * 100) / 100 : 0;
}
function compareRows(fields) {
  return (left, right) => {
    for (const fieldName of fields) {
      const a = left[fieldName]; const b = right[fieldName];
      const result = typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "").localeCompare(String(b ?? ""), "zh-Hans-CN", { numeric: true });
      if (result) return result;
    }
    return 0;
  };
}

function ensureSchemaCompatible(db) {
  const byTable = new Map();
  for (const definition of FULL_TABLE_DEFINITIONS) {
    if (!tableExists(db, definition.source_table)) throw new FullExcelError("FULL_EXCEL_SCHEMA_MISSING", `缺少数据表：${definition.source_table}`);
    if (!definition.restore_source) continue;
    if (!byTable.has(definition.source_table)) byTable.set(definition.source_table, new Set(tableColumns(db, definition.source_table)));
    for (const column of definition.columns) if (column.source_field && !byTable.get(definition.source_table).has(column.source_field)) throw new FullExcelError("FULL_EXCEL_SCHEMA_COLUMN_MISSING", `数据表字段不兼容：${definition.source_table}.${column.source_field}`);
  }
}

function feeDetailRows(db, lessons, allowedStatuses) {
  const overrides = new Map(db.prepare("SELECT lesson_id, student_name, unit_price FROM fee_overrides").all().map((row) => [`${Number(row.lesson_id)}\u0001${text(row.student_name)}`, row]));
  const studentRules = db.prepare("SELECT * FROM student_pricing WHERE custom_price > 0 ORDER BY id DESC").all();
  const standards = new Map(db.prepare("SELECT grade, student_count, unit_price FROM pricing_standards").all().map((row) => [`${text(row.grade)}\u0001${Number(row.student_count)}`, row]));
  const rows = [];
  for (const lesson of lessons) {
    const names = splitStudents(lesson.student_names); const status = deriveStatus(lesson, allowedStatuses); const studentKey = normalizedStudents(lesson.student_names);
    for (const studentName of names) {
      const override = overrides.get(`${Number(lesson.id)}\u0001${studentName}`);
      const rule = studentRules.find((item) => text(item.student_name) === studentName && text(item.grade) === text(lesson.grade) && text(item.subject) === text(lesson.subject) && normalizedStudents(item.student_names) === studentKey);
      const standard = standards.get(`${text(lesson.grade)}\u0001${priceBucket(lesson.grade, names.length)}`);
      const billable = status === "已上";
      const unitPrice = billable ? number(override?.unit_price ?? rule?.custom_price ?? standard?.unit_price) : 0;
      rows.push({ lesson_id: lesson.id, student_name: studentName, teacher_name: lesson.teacher_name, date: lesson.date, weekday: weekdayCn(lesson.date), time_slot: lesson.time_slot, classroom: lesson.classroom, status, grade: lesson.grade, subject: lesson.subject, student_names: lesson.student_names, notes: lesson.notes, price_source: override ? "单节覆盖" : rule ? "学生单价规则" : standard ? "费用标准" : "无匹配规则", pricing_rule_id: rule?.id ?? null, override_amount: override?.unit_price ?? null, unit_price: unitPrice, restore_source_flag: 0 });
    }
  }
  return rows;
}

function rowsForDefinition(db, definition, context = {}) {
  const lessons = context.lessons || [];
  let rows;
  if (definition.key === "student_fee_details") rows = feeDetailRows(db, lessons, context.allowedStatuses);
  else if (definition.key === "lesson_hour_details") rows = lessons.map((row) => ({ lesson_id: row.id, teacher_name: row.teacher_name, date: row.date, time_slot: row.time_slot, status: deriveStatus(row, context.allowedStatuses), grade: row.grade, subject: row.subject, student_names: row.student_names, lesson_hours: timeHours(row.time_slot), restore_source_flag: 0 }));
  else rows = db.prepare(`SELECT * FROM ${definition.source_table}`).all();
  if (definition.key === "settings") rows = rows.filter((row) => !SECRET_SETTING_PATTERN.test(String(row.key || "")));
  if (definition.key === "user_auth") rows = rows.map((row) => ({ id: row.id, password_hash: row.password_hash }));
  if (definition.key === "lessons") rows = rows.map((row) => ({ ...row, weekday: weekdayCn(row.date), status: deriveStatus(row, context.allowedStatuses), status_raw: row.status }));
  if (["staff_salary_monthly", "staff_attendance"].includes(definition.key)) {
    const names = context.staffNames; rows = rows.map((row) => ({ ...row, staff_name: names.get(row.staff_id) || "" }));
  }
  return [...rows].sort(compareRows(definition.sort_fields));
}

function dataSheet(definition, rows) {
  return { name: definition.sheet_name, hiddenColumns: definition.columns.map((column, index) => column.user_visible ? -1 : index).filter((index) => index >= 0), rows: [definition.columns.map((column) => column.display_name), ...rows.map((row) => definition.columns.map((column) => encodeValue(Object.hasOwn(row, column.field_key) ? row[column.field_key] : row[column.source_field])))] };
}
function fieldCatalogSheet() {
  const headers = ["工作表", "source_table", "field_key", "display_name", "column_order", "data_type", "nullable", "restore_required", "restore_source", "primary_key", "relation_field", "sensitive", "enum_values", "date_format", "amount_unit"];
  return { name: "字段定义", rows: [headers, ...FULL_TABLE_DEFINITIONS.flatMap((definition) => definition.columns.map((column) => [definition.sheet_name, column.source_table, column.field_key, column.display_name, column.column_order, column.data_type, Number(column.nullable), Number(column.restore_required), Number(column.restore_source), Number(column.primary_key), Number(column.relation_field), Number(column.sensitive), column.enum_values.join("|"), column.date_format, column.amount_unit]))] };
}
function infoSheet({ appVersion, createdAt, counts, schemaVersion, excludedSettings }) {
  return { name: "导出说明", rows: [["字段", "值"], ["file_type", FILE_TYPE], ["format_version", FORMAT_VERSION], ["导出时间（UTC）", createdAt.toISOString()], ["导出时间（Asia/Shanghai）", `${safeTimestamp(createdAt).replace(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3T$4:$5:$6")}+08:00`], ["应用版本", appVersion || "unknown"], ["schema_version_source", "pragma_user_version"], ["schema_version", schemaVersion], ["恢复模式", "空系统初始化或完整覆盖恢复"], ["空值编码", NULL_MARKER], ["敏感数据", "账号认证数据含密码哈希；文件必须按高度敏感数据保管"], ["参考明细", "所有学生费用明细、所有课时明细 restore_source=0，恢复不依赖"], ["排除设置数量", excludedSettings], [], ["工作表", "source_table", "记录数", "restore_source"], ...FULL_TABLE_DEFINITIONS.map((definition) => [definition.sheet_name, definition.source_table, counts[definition.key], Number(definition.restore_source)]), [], ["未导出表", "分类", "原因"], ...EXCLUDED_TABLES.map((item) => [item.table, item.classification, item.reason])] };
}
function expectedSheetNames() { return WORKBOOK_SEQUENCE.map((item) => typeof item === "string" ? item : item.sheet_name); }

function buildFullDataBuffer(db, options = {}) {
  ensureSchemaCompatible(db);
  const integrity = db.prepare("PRAGMA integrity_check").all().map((row) => Object.values(row)[0]);
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (integrity.length !== 1 || integrity[0] !== "ok") throw new FullExcelError("FULL_EXCEL_SOURCE_INTEGRITY_FAILED", "源数据库完整性检查失败");
  if (foreignKeys.length) throw new FullExcelError("FULL_EXCEL_SOURCE_FOREIGN_KEY_FAILED", "源数据库存在外键错误");
  const createdAt = options.createdAt || new Date();
  const context = { lessons: db.prepare("SELECT * FROM lessons").all(), staffNames: new Map(db.prepare("SELECT id,name FROM staff").all().map((row) => [row.id, row.name])), allowedStatuses: new Set([...DEFAULT_COURSE_STATUSES, ...customStatuses(db)]) };
  const definitionsAndRows = FULL_TABLE_DEFINITIONS.map((definition) => ({ definition, rows: rowsForDefinition(db, definition, context) }));
  const byKey = new Map(definitionsAndRows.map((item) => [item.definition.key, item]));
  const counts = Object.fromEntries(definitionsAndRows.map(({ definition, rows }) => [definition.key, rows.length]));
  const schemaVersion = Number(db.prepare("PRAGMA user_version").get().user_version || 0);
  const excludedSettings = Number(db.prepare("SELECT COUNT(*) AS count FROM settings").get().count) - counts.settings;
  const info = infoSheet({ appVersion: options.appVersion, createdAt, counts, schemaVersion, excludedSettings }); const catalog = fieldCatalogSheet();
  const sheets = WORKBOOK_SEQUENCE.map((item) => item === "导出说明" ? info : item === "字段定义" ? catalog : dataSheet(item, byKey.get(item.key).rows));
  return { buffer: createWorkbook(sheets), counts, createdAt, schemaVersion, sheets: sheets.map((sheet) => sheet.name) };
}

function exportFullData({ dbPath, outputPath, appVersion = "unknown", createdAt = new Date() }) {
  if (!dbPath || !outputPath) throw new FullExcelError("FULL_EXCEL_ARGUMENT_REQUIRED", "必须提供数据库和输出路径");
  const source = path.resolve(dbPath); const target = path.resolve(outputPath);
  if (!fs.existsSync(source)) throw new FullExcelError("FULL_EXCEL_SOURCE_NOT_FOUND", "源数据库不存在");
  if (fs.existsSync(target)) throw new FullExcelError("FULL_EXCEL_TARGET_EXISTS", "目标文件已存在");
  fs.mkdirSync(path.dirname(target), { recursive: true }); const temporary = `${target}.partial-${process.pid}`; const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec("BEGIN"); let result;
    try { result = buildFullDataBuffer(db, { appVersion, createdAt }); db.exec("COMMIT"); } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
    fs.writeFileSync(temporary, result.buffer, { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, target);
    return { ...result, outputPath: target, filename: path.basename(target) };
  } catch (error) { try { if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true }); } catch {} throw error; } finally { db.close(); }
}

function rowsAsObjects(sheet, definition) {
  const [headers = [], ...dataRows] = sheet.rows; const expected = definition.columns.map((column) => column.display_name);
  if (JSON.stringify(headers) !== JSON.stringify(expected)) throw new FullExcelError("FULL_EXCEL_COLUMNS_INVALID", `工作表列不匹配：${definition.sheet_name}`);
  return dataRows.filter((row) => row.some((value) => value !== "")).map((row, rowIndex) => {
    const result = {};
    definition.columns.forEach((column, index) => {
      let value = decodeValue(row[index] ?? "");
      if (value !== null && ["integer", "number", "amount", "boolean"].includes(column.data_type)) { if (value === "" || !Number.isFinite(Number(value))) throw new FullExcelError("FULL_EXCEL_VALUE_INVALID", `${definition.sheet_name} 第${rowIndex + 2}行字段${column.display_name}不是数字`); value = Number(value); }
      if (value === null && !column.nullable) throw new FullExcelError("FULL_EXCEL_REQUIRED_VALUE_MISSING", `${definition.sheet_name} 第${rowIndex + 2}行缺少${column.display_name}`);
      result[column.field_key] = value;
    }); return result;
  });
}
function validateRelations(data) {
  const ids = (key, field = "id") => new Set((data[key] || []).map((row) => row[field]));
  const requireRef = (rows, field, valid, label, nullable = false) => rows.forEach((row) => { if ((row[field] === null || row[field] === "") && nullable) return; if (!valid.has(row[field])) throw new FullExcelError("FULL_EXCEL_RELATION_INVALID", `${label}关联不存在`); });
  requireRef(data.fee_overrides || [], "lesson_id", ids("lessons"), "单节费用覆盖课程"); requireRef([...(data.staff_salary_monthly || []), ...(data.staff_attendance || [])], "staff_id", ids("staff"), "员工");
  requireRef([...(data.user_teacher_bindings || []), ...(data.user_page_permissions || []), ...(data.user_filter_presets || [])], "user_id", ids("users"), "用户"); requireRef(data.user_auth || [], "id", ids("users"), "账号认证用户"); requireRef(data.users || [], "role", ids("roles", "code"), "账号角色"); requireRef(data.lessons || [], "teacher_salary_rule_id", ids("teacher_salary_rules"), "课程薪资规则", true);
}

function verifyFullData(input) {
  const workbook = parseWorkbook(Buffer.isBuffer(input) ? input : fs.readFileSync(path.resolve(input)));
  if (JSON.stringify(workbook.sheets.map((sheet) => sheet.name)) !== JSON.stringify(expectedSheetNames())) throw new FullExcelError("FULL_EXCEL_SHEET_ORDER_INVALID", "工作表名称或顺序不符合格式版本");
  const info = workbook.sheetMap.get("导出说明"); const infoValues = new Map(info.rows.slice(1).filter((row) => row[0] && row[1] !== undefined).map((row) => [row[0], row[1]]));
  if (infoValues.get("file_type") !== FILE_TYPE || Number(infoValues.get("format_version")) !== FORMAT_VERSION) throw new FullExcelError("FULL_EXCEL_FORMAT_INVALID", "文件类型或版本不支持");
  const data = {};
  for (const definition of FULL_TABLE_DEFINITIONS) {
    const sheet = workbook.sheetMap.get(definition.sheet_name); if (!sheet) throw new FullExcelError("FULL_EXCEL_SHEET_MISSING", `缺少工作表：${definition.sheet_name}`);
    data[definition.key] = rowsAsObjects(sheet, definition);
    const primaryFields = definition.columns.filter((column) => column.primary_key).map((column) => column.field_key); const seen = new Set();
    for (const row of data[definition.key]) { const key = JSON.stringify(primaryFields.map((fieldName) => row[fieldName])); if (primaryFields.length && seen.has(key)) throw new FullExcelError("FULL_EXCEL_PRIMARY_KEY_DUPLICATE", `${definition.sheet_name}存在重复主键`); seen.add(key); }
  }
  if (JSON.stringify(workbook.sheetMap.get("字段定义").rows) !== JSON.stringify(fieldCatalogSheet().rows)) throw new FullExcelError("FULL_EXCEL_FIELD_CATALOG_INVALID", "字段定义与格式版本不匹配");
  const countRows = new Map(info.rows.filter((row) => FULL_TABLE_DEFINITIONS.some((definition) => definition.sheet_name === row[0])).map((row) => [row[0], Number(row[2])]));
  for (const definition of FULL_TABLE_DEFINITIONS) if (countRows.get(definition.sheet_name) !== data[definition.key].length) throw new FullExcelError("FULL_EXCEL_COUNT_MISMATCH", `${definition.sheet_name}记录数与说明不一致`);
  const authIds = new Set(data.user_auth.map((row) => row.id)); if (data.users.some((row) => !authIds.has(row.id))) throw new FullExcelError("FULL_EXCEL_AUTH_MISSING", "存在缺少认证数据的账号");
  let custom = []; try { const value = data.settings.find((row) => row.key === "custom_course_statuses")?.value; const parsed = JSON.parse(value || "[]"); if (Array.isArray(parsed)) custom = parsed.map(String); } catch {}
  for (const definition of FULL_TABLE_DEFINITIONS) for (const column of definition.columns.filter((item) => item.enum_values.length)) { const allowed = new Set(column.field_key === "status" && ["lessons", "student_fee_details", "lesson_hour_details"].includes(definition.key) ? [...column.enum_values, ...custom] : column.enum_values); for (const row of data[definition.key]) if (row[column.field_key] !== null && row[column.field_key] !== "" && !allowed.has(row[column.field_key])) throw new FullExcelError("FULL_EXCEL_ENUM_INVALID", `${definition.sheet_name}字段${column.display_name}包含无效枚举值`); }
  for (const [table, keyGroups] of Object.entries(UNIQUE_KEYS_BY_TABLE)) { const definition = FULL_TABLE_DEFINITIONS.find((item) => item.source_table === table && item.restore_source && item.key !== "user_auth"); if (!definition) continue; for (const fields of keyGroups) { const seen = new Set(); for (const row of data[definition.key]) { const key = JSON.stringify(fields.map((fieldName) => row[fieldName])); if (seen.has(key)) throw new FullExcelError("FULL_EXCEL_UNIQUE_KEY_DUPLICATE", `${definition.sheet_name}存在重复唯一键`); seen.add(key); } } }
  validateRelations(data);
  return { ok: true, file_type: FILE_TYPE, format: FILE_TYPE, version: FORMAT_VERSION, data, counts: Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])), workbook };
}

function sourceRows(verified, definition) {
  if (definition.key === "users") { const auth = new Map(verified.data.user_auth.map((row) => [row.id, row.password_hash])); return verified.data.users.map((row) => ({ ...row, password_hash: auth.get(row.id) })); }
  return verified.data[definition.key].map((row) => Object.fromEntries(definition.columns.filter((column) => column.source_field).map((column) => [column.source_field, row[column.field_key]])));
}
function restoreFullData({ dbPath, inputPath }) {
  const verified = verifyFullData(inputPath); const target = path.resolve(dbPath); if (!fs.existsSync(target)) throw new FullExcelError("FULL_EXCEL_TARGET_DB_NOT_FOUND", "目标数据库不存在，请先初始化数据库结构"); const db = new DatabaseSync(target);
  try {
    ensureSchemaCompatible(db); db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
    try {
      const definitions = restoreDefinitions(); const uniqueTables = [...new Set(definitions.map((definition) => definition.source_table))]; for (const table of [...uniqueTables].reverse()) db.exec(`DELETE FROM ${table}`);
      for (const definition of [...definitions].sort((a, b) => a.restore_order - b.restore_order)) {
        const rows = sourceRows(verified, definition); const available = new Set(tableColumns(db, definition.source_table)); let fields = [...new Set(definition.columns.map((column) => column.source_field).filter((name) => name && available.has(name)))]; if (definition.key === "users") fields.push("password_hash"); fields = [...new Set(fields)];
        const statement = db.prepare(`INSERT INTO ${definition.source_table}(${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`); for (const row of rows) statement.run(...fields.map((fieldName) => row[fieldName]));
      }
      if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new FullExcelError("FULL_EXCEL_INTEGRITY_FAILED", "恢复后数据库完整性检查失败"); if (db.prepare("PRAGMA foreign_key_check").all().length) throw new FullExcelError("FULL_EXCEL_FOREIGN_KEY_FAILED", "恢复后存在外键错误"); db.exec("COMMIT"); return { ok: true, counts: verified.counts, integrity_check: "ok", foreign_key_violation_count: 0 };
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  } finally { db.close(); }
}

module.exports = { FILE_TYPE, BACKUP_FORMAT: FILE_TYPE, FORMAT_VERSION, NULL_MARKER, FullExcelError, fullDataFilename, fullBackupFilename: fullDataFilename, expectedSheetNames, dataSheet, fieldCatalogSheet, infoSheet, buildFullDataBuffer, buildFullBackupBuffer: buildFullDataBuffer, exportFullData, exportFullBackup: exportFullData, verifyFullData, verifyFullBackup: verifyFullData, restoreFullData, restoreFullBackup: restoreFullData };
