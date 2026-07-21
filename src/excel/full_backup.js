const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { assertDataPreflight } = require("../backup/data_preflight");
const { studentPriceStatus, teacherPriceStatus, teacherActiveFromPriceStatus } = require("../domain/price_status");
const { createWorkbook, parseWorkbook, sanitizeCellText, validateWorkbookStructure, MAX_CELL_TEXT_LENGTH } = require("./xlsx_codec");
const {
  DEFAULT_COURSE_STATUSES, STUDENT_GRADE_STAGE_COLUMNS, VISIBLE_SHEET_DEFINITIONS, VISIBLE_SHEET_NAMES, HIDDEN_SHEET_NAMES,
  SOURCE_TABLE_DEFINITIONS, WORKBOOK_SEQUENCE, EXCLUDED_TABLES,
} = require("./field_definitions");

const FILE_TYPE = "liming_full_data_excel";
const FORMAT_VERSION = 4;
const NULL_MARKER = "__LIMING_NULL_V3__";
const LONG_TEXT_MARKER = "__LIMING_LONG_TEXT_V3__";
const LONG_TEXT_CHUNK_SIZE = 30000;
const VISIBLE_PREVIEW_LIMIT = 1000;
const SECRET_SETTING_PATTERN = /(password|passwd|secret|token|cookie|session|credential|oauth|private[_-]?key|baidu.*key|encryption|redirect_uri|remote_directory|server|docker|ssh|path)/i;
const FORBIDDEN_OPERATION_FIELDS = new Set(["client_ip", "user_agent"]);

const SETTING_LABELS = Object.freeze({
  month_key: "当前月份",
  course_notice_global_tail: "课程通知统一尾句",
  auto_backup_enabled: "旧业务归档自动备份",
  auto_backup_weekday: "旧业务归档备份星期",
  auto_backup_last_date: "旧业务归档上次日期",
  full_backup_auto_enabled: "自动备份",
  full_backup_time: "自动备份时间",
  full_backup_timezone: "自动备份时区",
  full_backup_daily_retention: "每日保留份数",
  full_backup_monthly_retention: "每月保留份数",
  full_backup_manual_retention: "手动保留份数",
  full_backup_retry_count: "失败重试次数",
  full_backup_remote_enabled: "百度网盘备份",
  custom_classrooms: "自定义教室",
  custom_subjects: "自定义科目",
  custom_time_slots: "常用时间",
  custom_course_statuses: "自定义课程状态",
  course_status_colors: "课程状态配色",
  course_subject_colors: "科目配色",
  student_grade_colors: "学生年级配色",
});

class FullExcelError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = "FullExcelError"; this.code = code; this.details = details; }
}

function text(value) { return String(value ?? "").trim(); }
function splitList(value) { return text(value).split(/[、,，;；\n\r]/).map((item) => item.trim()).filter(Boolean); }
function joinList(values) { return [...new Set((values || []).map(text).filter(Boolean))].join("；"); }
function weekdayCn(value) { if (!value) return ""; const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? "" : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()]; }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function safeTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
}
function fullDataFilename(date = new Date()) { return `黎明教育_全量数据_${safeTimestamp(date)}.xlsx`; }
function tableExists(db, table) { return !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table); }
function tableColumns(db, table) { return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((row) => row.name); }
function compareRows(fields) { return (left, right) => { for (const field of fields) { const a = left[field]; const b = right[field]; const result = typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "").localeCompare(String(b ?? ""), "zh-Hans-CN", { numeric: true }); if (result) return result; } return 0; }; }
function sourceDefinition(table) { return SOURCE_TABLE_DEFINITIONS.find((item) => item.source_table === table); }
function recordKey(table, row) { const fields = sourceDefinition(table)?.key_fields || ["id"]; return canonical(fields.map((field) => row[field])); }
function safeSettingRows(rows) { return rows.filter((row) => SETTING_LABELS[row.key] && !SECRET_SETTING_PATTERN.test(row.key)); }

function ensureSchemaCompatible(db) {
  for (const definition of SOURCE_TABLE_DEFINITIONS) if (!tableExists(db, definition.source_table)) throw new FullExcelError("FULL_EXCEL_SCHEMA_MISSING", `缺少数据表：${definition.source_table}`);
}

function customStatuses(sourceData) {
  try { const parsed = JSON.parse(sourceData.settings.find((row) => row.key === "custom_course_statuses")?.value || "[]"); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
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
function parseSettingArray(sourceData, key) { try { const value = JSON.parse(sourceData.settings.find((row) => row.key === key)?.value || "[]"); return Array.isArray(value) ? value.map(String) : []; } catch { return []; } }
function normalizedStudents(value) { return [...new Set(splitList(value).map((item) => item.replace(/\s+/g, "")))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).join("、"); }
function monthLabel(value) { const match = text(value).match(/^(\d{4})-(\d{2})(?:-01)?$/); return match ? `${match[1]}年${Number(match[2])}月` : ""; }
function priceBucket(grade, studentCount) {
  const count = Number(studentCount || 0);
  if (!count) return 1;
  if (text(grade).startsWith("高")) return count >= 4 ? 4 : count;
  if (text(grade).startsWith("初")) return count >= 3 ? 4 : Math.min(count, 2);
  return count >= 4 ? 4 : count;
}
function priceKey(row) { return [text(row.student_name), text(row.grade), text(row.subject), normalizedStudents(row.student_names)].join("\u0001"); }
function teacherRuleKey(row) { return [text(row.teacher_name), text(row.grade), text(row.subject), normalizedStudents(row.student_names)].join("\u0001"); }
function moneyRound(value) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }
function studentRuleSource(rule, lessons, context) {
  const price = Number(rule.custom_price || 0); if (price <= 0) return "pending";
  const matches = lessons.filter((lesson) => splitList(lesson.student_names).includes(text(rule.student_name)) && priceKey({ ...lesson, student_name: rule.student_name }) === priceKey(rule) && deriveStatus(lesson, context.allowedStatuses) === "已上");
  const mismatch = matches.some((lesson) => {
    const override = context.feeOverrides.get(`${lesson.id}\u0001${text(rule.student_name)}`);
    const standard = context.priceStandards.get(`${text(lesson.grade)}\u0001${priceBucket(lesson.grade, splitList(lesson.student_names).length)}`);
    const actual = override == null ? Number(standard || 0) : Number(override);
    return Math.abs(actual - price) >= 0.0001;
  });
  return mismatch ? "manual" : "auto";
}
function studentFeeValues(lesson, studentName, context) {
  if (deriveStatus(lesson, context.allowedStatuses) !== "已上") return { unit_price: 0 };
  const override = context.feeOverrides.get(`${lesson.id}\u0001${studentName}`);
  const standard = context.priceStandards.get(`${text(lesson.grade)}\u0001${priceBucket(lesson.grade, splitList(lesson.student_names).length)}`);
  return { unit_price: moneyRound(override == null ? Number(standard || 0) : Number(override)) };
}
function gradeStageFields(sourceData, studentName) {
  const stages = new Map((sourceData.student_grade_stages || []).filter((row) => text(row.student_name) === text(studentName)).map((row) => [text(row.stage), row]));
  return Object.fromEntries(STUDENT_GRADE_STAGE_COLUMNS.map(([fieldKey, , stage, sourceField]) => [fieldKey, text(stages.get(stage)?.[sourceField])]));
}

function sourceDataFromDb(db) {
  const result = {};
  for (const definition of SOURCE_TABLE_DEFINITIONS) {
    let rows = db.prepare(`SELECT * FROM ${definition.source_table}`).all();
    if (definition.source_table === "settings") rows = safeSettingRows(rows);
    result[definition.source_table] = rows;
  }
  return result;
}

function visibleRecords(definition, sourceData, context) {
  const rows = sourceData[definition.source_table] || [];
  if (definition.key === "student_fee_details") return context.lessons.flatMap((lesson) => splitList(lesson.student_names).map((studentName) => ({ visible: { student_name: studentName, teacher_name: lesson.teacher_name, date: lesson.date, weekday: weekdayCn(lesson.date), time_slot: lesson.time_slot, classroom: lesson.classroom, display_status: deriveStatus(lesson, context.allowedStatuses), grade: lesson.grade, subject: lesson.subject, notes: lesson.notes, ...studentFeeValues(lesson, studentName, context) } }))).sort((a, b) => compareRows(definition.sort_fields)(a.visible, b.visible));
  if (definition.key === "lesson_hour_details") return context.lessons.map((lesson) => ({ visible: { teacher_name: lesson.teacher_name, date: lesson.date, weekday: weekdayCn(lesson.date), time_slot: lesson.time_slot, classroom: lesson.classroom, display_status: deriveStatus(lesson, context.allowedStatuses), grade: lesson.grade, subject: lesson.subject, student_names: lesson.student_names, notes: lesson.notes, teacher_salary: deriveStatus(lesson, context.allowedStatuses) === "已上" ? moneyRound(lesson.teacher_salary) : 0 } })).sort((a, b) => compareRows(definition.sort_fields)(a.visible, b.visible));
  if (definition.key === "base_data") {
    const values = [];
    const add = (category, names, status) => [...new Set(names.map(text).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).forEach((name, index) => values.push({ visible: { category, name, status, sort_order: index + 1 } }));
    add("教室", [...parseSettingArray(sourceData, "custom_classrooms"), ...context.lessons.map((row) => row.classroom)], "有效");
    add("科目", [...parseSettingArray(sourceData, "custom_subjects"), ...context.lessons.map((row) => row.subject)], "有效");
    add("时间", [...parseSettingArray(sourceData, "custom_time_slots"), ...context.lessons.map((row) => row.time_slot)], "有效");
    add("课程状态", [...DEFAULT_COURSE_STATUSES, ...parseSettingArray(sourceData, "custom_course_statuses"), ...context.lessons.map((row) => deriveStatus(row, context.allowedStatuses))], "有效");
    add("老师", sourceData.teachers.map((row) => row.name), "有效");
    add("年级", [...sourceData.students.map((row) => row.grade), ...context.lessons.map((row) => row.grade)], "有效");
    return values;
  }
  const sorted = [...rows].sort(compareRows(definition.sort_fields));
  if (definition.key === "lessons") return sorted.map((source) => ({ source, visible: { ...source, weekday: weekdayCn(source.date), display_status: deriveStatus(source, context.allowedStatuses) } }));
  if (definition.key === "recharge_records") return sorted.map((source) => ({ source, visible: { ...source, month_label: monthLabel(source.month_key) } }));
  if (definition.key === "student_opening_balances") return sorted.map((source) => ({ source, visible: { ...source } }));
  if (definition.key === "student_pricing") return sorted.map((source) => ({ source, visible: { ...source, price_status: studentPriceStatus(studentRuleSource(source, context.lessons, context)) } }));
  if (definition.key === "students") return sorted.map((source) => ({ source, visible: { ...source, ...gradeStageFields(sourceData, source.name) } }));
  if (definition.key === "teacher_salary_rules") return sorted.map((source) => ({ source, visible: { ...source, price_status: teacherPriceStatus(source) } }));
  if (definition.key === "staff_salary_monthly" || definition.key === "staff_attendance") return sorted.map((source) => ({ source, visible: { ...source, staff_name: context.staffNames.get(Number(source.staff_id)) || "" } }));
  if (definition.key === "settings") return sorted.map((source) => ({ source, visible: { value: source.value, setting_label: SETTING_LABELS[source.key] } }));
  if (definition.key === "pricing_standards") return sorted.map((source) => ({ source, visible: { ...source, lookup_key: `${source.grade}-${source.student_count}` } }));
  if (definition.key === "operation_logs") return sorted.map((source) => ({ source, visible: { ...source, result_label: source.result_status === "failure" ? "失败" : "成功" } }));
  if (definition.key === "roles") {
    const permissions = new Map(); for (const row of sourceData.role_permissions || []) if (Number(row.enabled)) { if (!permissions.has(row.role_code)) permissions.set(row.role_code, []); permissions.get(row.role_code).push(row.permission_key); }
    return sorted.map((source) => ({ source, visible: { ...source, page_permissions: joinList(permissions.get(source.code) || []), action_permissions: Number(source.readonly) ? "只读" : "可编辑", role_status: Number(source.is_system) ? "系统角色" : "自定义角色" } }));
  }
  if (definition.key === "users") {
    const roles = new Map(sourceData.roles.map((row) => [row.code, row.name])); const bindings = new Map(); const permissions = new Map();
    for (const row of sourceData.user_teacher_bindings || []) { if (!bindings.has(Number(row.user_id))) bindings.set(Number(row.user_id), []); bindings.get(Number(row.user_id)).push(row.teacher_name); }
    for (const row of sourceData.user_page_permissions || []) if (Number(row.enabled)) { if (!permissions.has(Number(row.user_id))) permissions.set(Number(row.user_id), []); permissions.get(Number(row.user_id)).push(row.permission_key); }
    return sorted.map((source) => ({ source, visible: { ...source, role_name: roles.get(source.role) || source.role, bound_teachers: joinList(bindings.get(Number(source.id)) || splitList(source.teacher_name)), page_permissions: Number(source.permission_override_enabled) ? joinList(permissions.get(Number(source.id)) || []) : "跟随角色", status_label: source.status === "disabled" ? "停用" : source.status === "deleted" ? "已删除" : "启用" } }));
  }
  return sorted.map((source) => ({ source, visible: { ...source } }));
}

function splitUtf16(value, limit = LONG_TEXT_CHUNK_SIZE) {
  const input = sanitizeCellText(value); const chunks = []; let current = "";
  for (const symbol of input) { if (current.length + symbol.length > limit) { chunks.push(current); current = ""; } current += symbol; }
  if (current || !chunks.length) chunks.push(current);
  return chunks;
}
function valueType(value) { if (value === null || value === undefined) return "null"; if (typeof value === "number") return "number"; if (typeof value === "boolean") return "boolean"; return "text"; }
function decodeTyped(value, type) { if (type === "null") return null; if (type === "number") return Number(value); if (type === "boolean") return value === true || value === 1 || String(value) === "1"; return String(value ?? ""); }

function addLongText(chunks, table, key, field, value) {
  const clean = sanitizeCellText(value); const digest = sha256(clean); const parts = splitUtf16(clean);
  parts.forEach((content, index) => chunks.push([table, key, field, index + 1, parts.length, content, digest]));
  return `${LONG_TEXT_MARKER}:${digest}:${parts.length}`;
}
function addMapping(mapping, chunks, sheetName, rowNumber, table, key, field, value) {
  const type = valueType(value); let encoded = type === "null" ? "" : String(value);
  if (encoded.length > LONG_TEXT_CHUNK_SIZE) encoded = addLongText(chunks, table, key, field, encoded);
  mapping.push([sheetName, rowNumber || 0, table, key, field, encoded, type, sha256(canonical(value))]);
}

function visibleCell(value, mappingContext) {
  if (value === null || value === undefined) {
    if (mappingContext) addMapping(mappingContext.mapping, mappingContext.chunks, mappingContext.sheet, mappingContext.rowNumber, mappingContext.table, mappingContext.key, mappingContext.field, null);
    return "";
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const clean = sanitizeCellText(value);
  if (clean.length <= LONG_TEXT_CHUNK_SIZE) return clean;
  if (!mappingContext) throw new FullExcelError("FULL_EXCEL_CELL_TOO_LONG", "参考工作表存在无法关联的超长文本");
  addMapping(mappingContext.mapping, mappingContext.chunks, mappingContext.sheet, mappingContext.rowNumber, mappingContext.table, mappingContext.key, mappingContext.field, clean);
  const suffix = "…（完整内容见内部恢复分片）";
  return `${splitUtf16(clean, VISIBLE_PREVIEW_LIMIT - suffix.length)[0]}${suffix}`;
}

function buildVisibleSheet(definition, records, mapping, chunks, mappedRows) {
  const headers = definition.columns.map((column) => column.display_name); const rows = [headers];
  records.forEach((record, index) => {
    const rowNumber = index + 2; const source = record.source; const key = source ? recordKey(definition.source_table, source) : "";
    rows.push(definition.columns.map((column) => visibleCell(record.visible[column.field_key], source && column.source_field ? { mapping, chunks, sheet: definition.sheet_name, rowNumber, table: definition.source_table, key, field: column.source_field } : null)));
    if (!source) return;
    mappedRows.add(`${definition.source_table}\u0000${key}`);
    const represented = new Set(definition.columns.map((column) => column.source_field).filter(Boolean));
    if (definition.key === "operation_logs") represented.add("result_status");
    if (definition.key === "roles") { represented.add("readonly"); represented.add("is_system"); }
    if (definition.key === "users") represented.add("status");
    for (const [field, value] of Object.entries(source)) {
      if (definition.key === "operation_logs" && FORBIDDEN_OPERATION_FIELDS.has(field)) continue;
      if (definition.key === "users" && field === "password_hash") continue;
      if (!represented.has(field)) addMapping(mapping, chunks, definition.sheet_name, rowNumber, definition.source_table, key, field, value);
    }
  });
  return {
    name: definition.sheet_name,
    rows,
    columnWidths: definition.columns.map((column) => Math.min(38, Math.max(12, column.display_name.length * 2 + 4))),
    numberFormatColumns: definition.columns.map((column, index) => column.data_type === "amount" ? index : -1).filter((index) => index >= 0),
  };
}

function infoSheet({ appVersion, appGitCommit, createdAt, schemaVersion, visibleCounts, excludedSettings }) {
  return { name: "导出说明", autoFilter: false, columnWidths: [24, 90], rows: [
    ["项目", "内容"], ["导出类型", "系统全量数据Excel"], ["格式版本", FORMAT_VERSION], ["导出时间（UTC）", createdAt.toISOString()],
    ["导出时间（北京时间）", `${safeTimestamp(createdAt).replace(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3 $4:$5:$6")} Asia/Shanghai`],
    ["应用版本", appVersion || "unknown"], ["Git提交", String(appGitCommit || "").slice(0, 40) || "unknown"], ["数据库Schema", `PRAGMA user_version=${schemaVersion}`],
    ["用途", "人工查看、空系统初始化和完整覆盖恢复"], ["可见工作表", VISIBLE_SHEET_NAMES.join("；")],
    ["内部恢复表", "4张veryHidden工作表，保存最少技术关系、账号哈希和长文本分片"], ["金额单位", "人民币元"], ["日期格式", "日期YYYY-MM-DD；充值月份YYYY年M月；内部月份YYYY-MM-01"],
    ["空值规则", "空白表示空字符串；精确NULL由内部恢复映射保存"], ["安全说明", "不含Session、Cookie、Token、Secret、服务器路径、Docker/SSH信息、IP或User-Agent"],
    ["期初余额", "每名学生一条全局基础余额；可见表和隐藏恢复映射均不含月份"],
    ["计算结果", "页面可显示规则费用和规则薪资用于核对；Excel只保存单人费用和教师薪资，规则值恢复后由原始规则重新计算"],
    ["排除历史", EXCLUDED_TABLES.map((item) => `${item.table}：${item.reason}`).join("；")], ["排除设置数", excludedSettings],
    ...Object.entries(visibleCounts).map(([name, count]) => [`记录数：${name}`, count]),
  ] };
}
function expectedSheetNames() { return [...WORKBOOK_SEQUENCE]; }
function expectedVisibleSheetNames() { return [...VISIBLE_SHEET_NAMES]; }

function buildFullDataBufferFromSourceData(sourceData, options = {}) {
  for (const definition of SOURCE_TABLE_DEFINITIONS) if (!Array.isArray(sourceData[definition.source_table])) sourceData[definition.source_table] = [];
  const createdAt = options.createdAt || new Date(); const allowedStatuses = new Set([...DEFAULT_COURSE_STATUSES, ...customStatuses(sourceData)]);
  const context = {
    lessons: sourceData.lessons,
    allowedStatuses,
    staffNames: new Map(sourceData.staff.map((row) => [Number(row.id), row.name])),
    feeOverrides: new Map(sourceData.fee_overrides.map((row) => [`${row.lesson_id}\u0001${text(row.student_name)}`, Number(row.unit_price)])),
    priceStandards: new Map(sourceData.pricing_standards.map((row) => [`${text(row.grade)}\u0001${Number(row.student_count)}`, Number(row.unit_price)])),
    studentRules: new Map(sourceData.student_pricing.map((row) => [priceKey(row), row])),
  };
  const mapping = []; const chunks = []; const mappedRows = new Set(); const visibleCounts = {}; const visibleSheets = [];
  for (const definition of VISIBLE_SHEET_DEFINITIONS) {
    const records = visibleRecords(definition, sourceData, context); visibleCounts[definition.sheet_name] = records.length;
    visibleSheets.push(buildVisibleSheet(definition, records, mapping, chunks, mappedRows));
  }
  for (const definition of SOURCE_TABLE_DEFINITIONS) for (const row of sourceData[definition.source_table]) {
    const key = recordKey(definition.source_table, row); if (mappedRows.has(`${definition.source_table}\u0000${key}`)) continue;
    for (const [field, value] of Object.entries(row)) {
      if (definition.source_table === "users" && field === "password_hash") continue;
      if (definition.source_table === "operation_logs" && FORBIDDEN_OPERATION_FIELDS.has(field)) continue;
      addMapping(mapping, chunks, "", 0, definition.source_table, key, field, value);
    }
  }
  const authRows = [["账号", "密码哈希", "SHA-256"], ...sourceData.users.map((row) => [row.username, row.password_hash, sha256(String(row.password_hash || ""))])];
  const mappingSheet = { name: "__关系映射", state: "veryHidden", rows: [["来源工作表", "来源行号", "来源表", "记录标识", "技术字段", "技术值", "数据类型", "SHA-256"], ...mapping] };
  const authSheet = { name: "__账号认证数据", state: "veryHidden", rows: authRows };
  const chunkSheet = { name: "__长文本分片", state: "veryHidden", rows: [["来源表", "来源记录标识", "字段", "分片序号", "总分片数", "文本内容", "SHA-256"], ...chunks] };
  const schemaVersion = Number(options.schemaVersion || 0); const excludedSettings = Number(options.excludedSettings || 0);
  const info = infoSheet({ appVersion: options.appVersion, appGitCommit: options.appGitCommit, createdAt, schemaVersion, visibleCounts, excludedSettings });
  const digestSheets = [info, ...visibleSheets, mappingSheet, authSheet, chunkSheet];
  const metadataRows = [["类型", "名称", "值", "SHA-256"], ["元数据", "file_type", FILE_TYPE, ""], ["元数据", "format_version", FORMAT_VERSION, ""], ["元数据", "created_at_utc", createdAt.toISOString(), ""], ["元数据", "schema_version_source", "pragma_user_version", ""], ["元数据", "schema_version", schemaVersion, ""], ...digestSheets.map((sheet) => ["工作表", sheet.name, sheet.rows.length - 1, sha256(canonical(sheet.rows))])];
  const metadataSheet = { name: "__恢复元数据", state: "veryHidden", rows: metadataRows };
  const sheets = [info, ...visibleSheets, metadataSheet, mappingSheet, authSheet, chunkSheet];
  const buffer = createWorkbook(sheets); const structure = validateWorkbookStructure(buffer);
  return { buffer, counts: Object.fromEntries(SOURCE_TABLE_DEFINITIONS.map((item) => [item.source_table, sourceData[item.source_table].length])), visibleCounts, createdAt, schemaVersion, sheets: sheets.map((sheet) => sheet.name), structure };
}

function buildFullDataBuffer(db, options = {}) {
  ensureSchemaCompatible(db);
  const preflight = assertDataPreflight(db);
  const integrity = db.prepare("PRAGMA integrity_check").all().map((row) => Object.values(row)[0]); const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (integrity.length !== 1 || integrity[0] !== "ok") throw new FullExcelError("FULL_EXCEL_SOURCE_INTEGRITY_FAILED", "源数据库完整性检查失败");
  if (foreignKeys.length) throw new FullExcelError("FULL_EXCEL_SOURCE_FOREIGN_KEY_FAILED", "源数据库存在外键错误");
  const sourceData = sourceDataFromDb(db); const allSettingCount = Number(db.prepare("SELECT COUNT(*) AS count FROM settings").get().count);
  return { ...buildFullDataBufferFromSourceData(sourceData, { ...options, schemaVersion: Number(db.prepare("PRAGMA user_version").get().user_version || 0), excludedSettings: allSettingCount - sourceData.settings.length }), preflight };
}

function exportFullData({ dbPath, outputPath, appVersion = "unknown", appGitCommit = process.env.APP_GIT_COMMIT || "", createdAt = new Date() }) {
  if (!dbPath || !outputPath) throw new FullExcelError("FULL_EXCEL_ARGUMENT_REQUIRED", "必须提供数据库和输出路径");
  const source = path.resolve(dbPath); const target = path.resolve(outputPath);
  if (!fs.existsSync(source)) throw new FullExcelError("FULL_EXCEL_SOURCE_NOT_FOUND", "源数据库不存在");
  if (fs.existsSync(target)) throw new FullExcelError("FULL_EXCEL_TARGET_EXISTS", "目标文件已存在");
  fs.mkdirSync(path.dirname(target), { recursive: true }); const temporary = `${target}.partial-${process.pid}`; const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec("BEGIN"); let result; try { result = buildFullDataBuffer(db, { appVersion, appGitCommit, createdAt }); db.exec("COMMIT"); } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
    fs.writeFileSync(temporary, result.buffer, { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, target); return { ...result, outputPath: target, filename: path.basename(target) };
  } catch (error) { try { fs.rmSync(temporary, { force: true }); } catch {} throw error; } finally { db.close(); }
}

function headersEqual(sheet, definition) { return JSON.stringify(sheet.rows[0] || []) === JSON.stringify(definition.columns.map((column) => column.display_name)); }
function parseVisibleRows(sheet, definition) {
  if (!headersEqual(sheet, definition)) throw new FullExcelError("FULL_EXCEL_COLUMNS_INVALID", `工作表列不匹配：${definition.sheet_name}`);
  return sheet.rows.slice(1).filter((row) => row.some((value) => value !== "")).map((row, rowIndex) => {
    const result = {};
    definition.columns.forEach((column, index) => {
      let value = row[index] ?? "";
      if (["integer", "number", "amount", "boolean"].includes(column.data_type) && value !== "") { if (!Number.isFinite(Number(value))) throw new FullExcelError("FULL_EXCEL_VALUE_INVALID", `${definition.sheet_name} 第${rowIndex + 2}行字段${column.display_name}不是数字`); value = Number(value); }
      if (!column.nullable && value === "") throw new FullExcelError("FULL_EXCEL_REQUIRED_VALUE_MISSING", `${definition.sheet_name} 第${rowIndex + 2}行缺少${column.display_name}`);
      if (column.data_type === "date" && value !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new FullExcelError("FULL_EXCEL_DATE_INVALID", `${definition.sheet_name} 第${rowIndex + 2}行日期格式无效`);
      result[column.field_key] = value;
    });
    return { rowNumber: rowIndex + 2, value: result };
  });
}

function parseLongChunks(sheet) {
  const expected = ["来源表", "来源记录标识", "字段", "分片序号", "总分片数", "文本内容", "SHA-256"];
  if (JSON.stringify(sheet.rows[0] || []) !== JSON.stringify(expected)) throw new FullExcelError("FULL_EXCEL_INTERNAL_COLUMNS_INVALID", "长文本分片结构无效");
  const groups = new Map();
  for (const row of sheet.rows.slice(1)) {
    const key = `${row[0]}\u0000${row[1]}\u0000${row[2]}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push({ index: Number(row[3]), total: Number(row[4]), content: String(row[5] ?? ""), digest: String(row[6] || "") });
  }
  const result = new Map();
  for (const [key, parts] of groups) {
    parts.sort((a, b) => a.index - b.index); const total = parts[0]?.total || 0;
    if (!total || parts.length !== total || parts.some((part, index) => part.index !== index + 1 || part.total !== total || part.digest !== parts[0].digest || part.content.length > LONG_TEXT_CHUNK_SIZE)) throw new FullExcelError("FULL_EXCEL_LONG_TEXT_INVALID", "长文本分片序号或数量无效");
    const value = parts.map((part) => part.content).join(""); if (sha256(value) !== parts[0].digest) throw new FullExcelError("FULL_EXCEL_LONG_TEXT_DIGEST_INVALID", "长文本分片摘要不匹配"); result.set(key, value);
  }
  return result;
}

function parseMappings(sheet, longTexts) {
  const expected = ["来源工作表", "来源行号", "来源表", "记录标识", "技术字段", "技术值", "数据类型", "SHA-256"];
  if (JSON.stringify(sheet.rows[0] || []) !== JSON.stringify(expected)) throw new FullExcelError("FULL_EXCEL_INTERNAL_COLUMNS_INVALID", "关系映射结构无效");
  const result = [];
  for (const row of sheet.rows.slice(1)) {
    const [sourceSheet, sourceRow, table, key, field, encoded, type, digest] = row; let value = encoded;
    if (typeof encoded === "string" && encoded.startsWith(`${LONG_TEXT_MARKER}:`)) {
      value = longTexts.get(`${table}\u0000${key}\u0000${field}`); if (value === undefined) throw new FullExcelError("FULL_EXCEL_LONG_TEXT_MISSING", "关系映射引用的长文本不存在");
    }
    value = decodeTyped(value, type); if (sha256(canonical(value)) !== digest) throw new FullExcelError("FULL_EXCEL_MAPPING_DIGEST_INVALID", "关系映射摘要不匹配");
    result.push({ sourceSheet: String(sourceSheet || ""), sourceRow: Number(sourceRow || 0), table: String(table), key: String(key), field: String(field), value });
  }
  return result;
}

function verifyMetadata(workbook) {
  const sheet = workbook.sheetMap.get("__恢复元数据"); const expected = ["类型", "名称", "值", "SHA-256"];
  if (!sheet || JSON.stringify(sheet.rows[0] || []) !== JSON.stringify(expected)) throw new FullExcelError("FULL_EXCEL_METADATA_INVALID", "恢复元数据结构无效");
  const meta = new Map(sheet.rows.slice(1).filter((row) => row[0] === "元数据").map((row) => [row[1], row[2]]));
  if (meta.get("file_type") !== FILE_TYPE || Number(meta.get("format_version")) !== FORMAT_VERSION) throw new FullExcelError("FULL_EXCEL_FORMAT_INVALID", "文件版本不兼容，请重新导出 v4 文件");
  for (const row of sheet.rows.slice(1).filter((item) => item[0] === "工作表")) { const target = workbook.sheetMap.get(row[1]); if (!target || Number(row[2]) !== target.rows.length - 1 || row[3] !== sha256(canonical(target.rows))) throw new FullExcelError("FULL_EXCEL_SHEET_DIGEST_INVALID", `工作表摘要不匹配：${row[1]}`); }
  return meta;
}

function reconstructData(workbook, parsedVisible, mappings) {
  const data = Object.fromEntries(SOURCE_TABLE_DEFINITIONS.map((item) => [item.source_table, []]));
  const grouped = new Map();
  for (const item of mappings) { const groupKey = `${item.sourceSheet}\u0000${item.sourceRow}\u0000${item.table}\u0000${item.key}`; if (!grouped.has(groupKey)) grouped.set(groupKey, {}); grouped.get(groupKey)[item.field] = item.value; }
  for (const definition of VISIBLE_SHEET_DEFINITIONS.filter((item) => item.restore_source)) {
    for (const item of parsedVisible[definition.key]) {
      const candidates = [...grouped.entries()].filter(([key]) => key.startsWith(`${definition.sheet_name}\u0000${item.rowNumber}\u0000${definition.source_table}\u0000`));
      const technical = candidates.length === 1 ? candidates[0][1] : {};
      const row = {};
      for (const column of definition.columns) {
        if (column.source_field) row[column.source_field] = item.value[column.field_key];
      }
      // Hidden recovery mappings carry exact null values and reassembled long text.
      // They must win over the human-readable preview stored in the visible sheet.
      Object.assign(row, technical);
      if (definition.key === "teacher_salary_rules" && !Object.prototype.hasOwnProperty.call(technical, "is_active")) row.is_active = teacherActiveFromPriceStatus(item.value.price_status);
      if (definition.key === "operation_logs") row.result_status = item.value.result_label === "失败" ? "failure" : "success";
      if (definition.key === "roles") { row.readonly = item.value.action_permissions === "只读" ? 1 : 0; row.is_system = item.value.role_status === "系统角色" ? 1 : 0; }
      if (definition.key === "users") row.status = item.value.status_label === "停用" ? "disabled" : item.value.status_label === "已删除" ? "deleted" : "active";
      data[definition.source_table].push(row);
    }
  }
  for (const [groupKey, row] of grouped) {
    const [sourceSheet, , table] = groupKey.split("\u0000"); if (sourceSheet || !data[table]) continue; data[table].push(row);
  }
  const authSheet = workbook.sheetMap.get("__账号认证数据"); const expectedAuth = ["账号", "密码哈希", "SHA-256"];
  if (!authSheet || JSON.stringify(authSheet.rows[0] || []) !== JSON.stringify(expectedAuth)) throw new FullExcelError("FULL_EXCEL_AUTH_INVALID", "账号认证数据结构无效");
  const auth = new Map(authSheet.rows.slice(1).map((row) => { if (sha256(String(row[1] || "")) !== row[2]) throw new FullExcelError("FULL_EXCEL_AUTH_DIGEST_INVALID", "账号认证摘要不匹配"); return [String(row[0]), String(row[1])]; }));
  for (const user of data.users) { if (!auth.has(String(user.username))) throw new FullExcelError("FULL_EXCEL_AUTH_MISSING", "存在缺少认证数据的账号"); user.password_hash = auth.get(String(user.username)); }
  return data;
}

function validateGradeStages(row) {
  const ranges = [];
  for (let index = 0; index < STUDENT_GRADE_STAGE_COLUMNS.length; index += 2) {
    const [startKey, , stage] = STUDENT_GRADE_STAGE_COLUMNS[index];
    const endKey = stage === "已毕业" ? "" : STUDENT_GRADE_STAGE_COLUMNS[index + 1]?.[0];
    const start = text(row[startKey]); const end = endKey ? text(row[endKey]) : "";
    if (!start && !end) continue;
    if (!start && end) throw new FullExcelError("FULL_EXCEL_GRADE_STAGE_INCOMPLETE", `${row.name}的${stage}缺少起始日期`);
    if (end && end < start) throw new FullExcelError("FULL_EXCEL_GRADE_TIMELINE_INVALID", `${row.name}的${stage}截止日期早于起始日期`);
    ranges.push([start, end || "9999-12-31", stage]);
  }
  ranges.sort((a, b) => a[0].localeCompare(b[0]));
  for (let index = 1; index < ranges.length; index += 1) if (ranges[index][0] <= ranges[index - 1][1]) throw new FullExcelError("FULL_EXCEL_GRADE_TIMELINE_OVERLAP", `${row.name}年级阶段日期重叠`);
}
function validateData(data, parsedVisible) {
  const ids = (table, field = "id") => new Set((data[table] || []).map((row) => row[field])); const requireRef = (rows, field, valid, label, nullable = false) => rows.forEach((row) => { if (nullable && (row[field] === null || row[field] === "" || row[field] === undefined)) return; if (!valid.has(row[field])) throw new FullExcelError("FULL_EXCEL_RELATION_INVALID", `${label}关联不存在`); });
  requireRef(data.fee_overrides, "lesson_id", ids("lessons"), "单节费用课程"); requireRef([...data.staff_salary_monthly, ...data.staff_attendance], "staff_id", ids("staff"), "员工"); requireRef([...data.user_teacher_bindings, ...data.user_page_permissions, ...data.user_filter_presets], "user_id", ids("users"), "账号"); requireRef(data.users, "role", ids("roles", "code"), "账号角色"); requireRef(data.lessons, "teacher_salary_rule_id", ids("teacher_salary_rules"), "课程薪资规则", true);
  const openingStudents = new Set();
  for (const row of data.student_opening_balances || []) { const name = text(row.student_name); if (openingStudents.has(name)) throw new FullExcelError("FULL_EXCEL_OPENING_BALANCE_DUPLICATE", `期初余额存在重复学生：${name}`); openingStudents.add(name); }
  for (const row of parsedVisible.students) validateGradeStages(row.value);
}

function verifyFullData(input) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(path.resolve(input)); const structure = validateWorkbookStructure(buffer); const workbook = structure.workbook;
  const info = workbook.sheetMap.get("导出说明"); const infoMap = new Map((info?.rows || []).slice(1).map((row) => [row[0], row[1]])); if (Number(infoMap.get("格式版本")) !== FORMAT_VERSION) throw new FullExcelError("FULL_EXCEL_FORMAT_INVALID", "文件版本不兼容，请重新导出 v4 文件");
  if (JSON.stringify(workbook.sheets.map((sheet) => sheet.name)) !== JSON.stringify(expectedSheetNames())) throw new FullExcelError("FULL_EXCEL_SHEET_ORDER_INVALID", "工作表名称或顺序不符合格式版本");
  for (const name of HIDDEN_SHEET_NAMES) if (workbook.sheetMap.get(name)?.state !== "veryHidden") throw new FullExcelError("FULL_EXCEL_HIDDEN_SHEET_STATE_INVALID", `内部工作表必须为veryHidden：${name}`);
  const parsedVisible = {}; for (const definition of VISIBLE_SHEET_DEFINITIONS) parsedVisible[definition.key] = parseVisibleRows(workbook.sheetMap.get(definition.sheet_name), definition);
  verifyMetadata(workbook); const longTexts = parseLongChunks(workbook.sheetMap.get("__长文本分片")); const mappings = parseMappings(workbook.sheetMap.get("__关系映射"), longTexts); const data = reconstructData(workbook, parsedVisible, mappings); validateData(data, parsedVisible);
  const counts = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length]));
  return { ok: true, file_type: FILE_TYPE, format: FILE_TYPE, version: FORMAT_VERSION, data, counts, visible_counts: Object.fromEntries(VISIBLE_SHEET_DEFINITIONS.map((definition) => [definition.sheet_name, parsedVisible[definition.key].length])), workbook, structure };
}

function restoreFullData({ dbPath, inputPath }) {
  const verified = verifyFullData(inputPath); const target = path.resolve(dbPath); if (!fs.existsSync(target)) throw new FullExcelError("FULL_EXCEL_TARGET_DB_NOT_FOUND", "目标数据库不存在，请先初始化数据库结构"); const db = new DatabaseSync(target);
  try {
    ensureSchemaCompatible(db); db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
    try {
      for (const definition of [...SOURCE_TABLE_DEFINITIONS].sort((a, b) => b.restore_order - a.restore_order)) db.exec(`DELETE FROM ${definition.source_table}`);
      for (const definition of [...SOURCE_TABLE_DEFINITIONS].sort((a, b) => a.restore_order - b.restore_order)) {
        const available = new Set(tableColumns(db, definition.source_table));
        for (const row of verified.data[definition.source_table]) { const fields = Object.keys(row).filter((field) => available.has(field)); if (!fields.length) continue; db.prepare(`INSERT INTO ${definition.source_table}(${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`).run(...fields.map((field) => row[field])); }
      }
      if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new FullExcelError("FULL_EXCEL_INTEGRITY_FAILED", "恢复后数据库完整性检查失败"); if (db.prepare("PRAGMA foreign_key_check").all().length) throw new FullExcelError("FULL_EXCEL_FOREIGN_KEY_FAILED", "恢复后存在外键错误"); db.exec("COMMIT"); return { ok: true, counts: verified.counts, integrity_check: "ok", foreign_key_violation_count: 0 };
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  } finally { db.close(); }
}

module.exports = {
  FILE_TYPE, BACKUP_FORMAT: FILE_TYPE, FORMAT_VERSION, NULL_MARKER, LONG_TEXT_MARKER, LONG_TEXT_CHUNK_SIZE, MAX_CELL_TEXT_LENGTH,
  FullExcelError, fullDataFilename, fullBackupFilename: fullDataFilename, expectedSheetNames, expectedVisibleSheetNames,
  buildFullDataBuffer, buildFullDataBufferFromSourceData, buildFullBackupBuffer: buildFullDataBuffer, exportFullData, exportFullBackup: exportFullData,
  verifyFullData, verifyFullBackup: verifyFullData, restoreFullData, restoreFullBackup: restoreFullData,
  splitUtf16, validateGradeStages, SETTING_LABELS,
};
