const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createWorkbook, validateWorkbookStructure } = require("./xlsx_codec");
const { STUDENT_GRADE_STAGE_COLUMNS, VISIBLE_SHEET_DEFINITIONS, VISIBLE_SHEET_NAMES, SOURCE_TABLE_DEFINITIONS } = require("./field_definitions");
const { PRICE_STATUS, teacherActiveFromPriceStatus } = require("../domain/price_status");
const {
  FILE_TYPE, FORMAT_VERSION, FullExcelError, buildFullDataBufferFromSourceData,
  verifyFullData, restoreFullData, exportFullData, SETTING_LABELS,
} = require("./full_backup");

const TEMPLATE_FILE_TYPE = "liming_full_data_template";
const TEMPLATE_FILENAME = "黎明教育_全量数据导入模板_v4.xlsx";
const TEMPLATE_GUIDE_SHEET = "填写说明";

function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const raw = String(password || "");
  if (raw.length < 6) throw new FullExcelError("FULL_EXCEL_INITIAL_PASSWORD_INVALID", "初始密码至少6位");
  return `pbkdf2$${salt}$${crypto.pbkdf2Sync(raw, salt, 120000, 32, "sha256").toString("hex")}`;
}
function templateHeaders(definition) { return [...definition.columns.map((column) => column.display_name), ...(definition.key === "users" ? ["初始密码"] : [])]; }
function templateSheet(definition) { return { name: definition.sheet_name, rows: [templateHeaders(definition)], columnWidths: templateHeaders(definition).map(() => 18), numberFormatColumns: definition.columns.map((column, index) => column.data_type === "amount" ? index : -1).filter((index) => index >= 0) }; }
function templateInfoSheet() { return { name: "导出说明", autoFilter: false, columnWidths: [24, 88], rows: [
  ["项目", "内容"], ["文件类型", TEMPLATE_FILE_TYPE], ["格式版本", FORMAT_VERSION], ["用途", "用于空系统初始化；填写后不得作为公开文件传播"],
  ["工作表", "本模板包含22张用户可见工作表和填写说明，不含隐藏恢复表、内部ID或密码哈希"], ["账号密码", "账号管理最后一列填写初始密码；导入时立即哈希"],
  ["年级时间界定", "学生档案已展开13个日期字段；初一至高三均填写起始/截止日期，已毕业只填写已毕业日期"],
  ["权限列表", "使用中文分号；分隔，例如：课程总表；学生档案；数据中心"], ["安全", "禁止填写Token、Cookie、Session、Secret、服务器路径或真实云端密钥"],
] }; }
function guideSheet() { return { name: TEMPLATE_GUIDE_SHEET, autoFilter: false, columnWidths: [22, 80, 36], rows: [
  ["主题", "填写说明", "合成示例"], ["日期", "日期使用YYYY-MM-DD；充值月份使用中文YYYY年M月", "2026-01-01 / 2026年4月"],
  ["金额", "人民币元，填写数值，不带¥或千位逗号", "128.50"], ["课程状态", "使用系统实际状态，例如待上、已上、请假、试课、考试、未缴费", "已上"],
  ["年级阶段", "初一至高三的起始/截止日期必须成对填写，所有阶段不得重叠；已毕业日期单独填写", "初一起始日期 2026-01-01，初一截止日期 2026-06-30"],
  ["权限", "页面权限使用中文分号；分隔；账号填“跟随角色”时不启用个人覆盖", "课程总表；学生档案"],
  ["账号", "初始密码至少6位；导入后只保存PBKDF2哈希", "demo / DemoPass123"],
  ["空值", "可选字段留空；不要填写NULL、undefined或技术标记", ""], ["安全", "示例均为虚构信息；不要填写任何Token、Cookie、Session或Secret", "不适用"],
] }; }
function createTemplateBuffer() { return createWorkbook([templateInfoSheet(), ...VISIBLE_SHEET_DEFINITIONS.map(templateSheet), guideSheet()]); }

function splitList(value) { return String(value || "").split(/[、,，;；\n\r]/).map((item) => item.trim()).filter(Boolean); }
function monthKey(value) { const match = String(value || "").match(/^(\d{4})-(\d{2})/); return match ? `${match[1]}-${match[2]}-01` : ""; }
function monthKeyFromLabel(value) { const match = String(value || "").trim().match(/^(\d{4})年(1[0-2]|0?[1-9])月$/); return match ? `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-01` : ""; }
function normalizeStudents(value) { return [...new Set(splitList(value).map((item) => item.replace(/\s+/g, "")))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).join("、"); }
function parseStudentStages(row) {
  const result = [];
  for (let index = 0; index < STUDENT_GRADE_STAGE_COLUMNS.length; index += 2) {
    const [startKey, , stage] = STUDENT_GRADE_STAGE_COLUMNS[index];
    const endKey = stage === "已毕业" ? "" : STUDENT_GRADE_STAGE_COLUMNS[index + 1]?.[0];
    const start = String(row[startKey] || "").trim(); const end = endKey ? String(row[endKey] || "").trim() : "";
    if (!start && !end) continue;
    if (!start && end) throw new FullExcelError("FULL_EXCEL_GRADE_STAGE_INCOMPLETE", `${row.name}的${stage}缺少起始日期`);
    if (end && end < start) throw new FullExcelError("FULL_EXCEL_GRADE_TIMELINE_INVALID", `${row.name}的${stage}截止日期早于起始日期`);
    result.push({ student_name: row.name, stage, start_date: start, end_date: end });
  }
  const ordered = [...result].sort((a, b) => a.start_date.localeCompare(b.start_date));
  for (let index = 1; index < ordered.length; index += 1) if (ordered[index].start_date <= (ordered[index - 1].end_date || "9999-12-31")) throw new FullExcelError("FULL_EXCEL_GRADE_TIMELINE_OVERLAP", `${row.name}年级阶段日期重叠`);
  if (row.grade && ["初一", "初二", "初三", "高一", "高二", "高三", "已毕业"].includes(row.grade) && result.length && !result.some((item) => item.stage === row.grade)) throw new FullExcelError("FULL_EXCEL_CURRENT_GRADE_STAGE_MISSING", `${row.name}当前年级缺少对应时间字段`);
  return result;
}
function parseTemplateRows(sheet, definition) {
  const headers = templateHeaders(definition); if (JSON.stringify(sheet.rows[0] || []) !== JSON.stringify(headers)) throw new FullExcelError("FULL_EXCEL_COLUMNS_INVALID", `工作表列不匹配：${definition.sheet_name}`);
  return sheet.rows.slice(1).filter((row) => row.some((value) => value !== "")).map((row, rowIndex) => {
    const result = {};
    definition.columns.forEach((column, index) => {
      let value = row[index] ?? ""; if (["integer", "number", "amount", "boolean"].includes(column.data_type) && value !== "") { if (!Number.isFinite(Number(value))) throw new FullExcelError("FULL_EXCEL_VALUE_INVALID", `${definition.sheet_name} 第${rowIndex + 2}行字段${column.display_name}不是数字`); value = Number(value); }
      if (!column.nullable && value === "") throw new FullExcelError("FULL_EXCEL_REQUIRED_VALUE_MISSING", `${definition.sheet_name} 第${rowIndex + 2}行缺少${column.display_name}`); if (column.data_type === "date" && value !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new FullExcelError("FULL_EXCEL_DATE_INVALID", `${definition.sheet_name} 第${rowIndex + 2}行日期格式无效`); result[column.field_key] = value;
      if (value !== "" && column.enum_values.length && !column.enum_values.includes(String(value))) throw new FullExcelError("FULL_EXCEL_ENUM_INVALID", `${definition.sheet_name} 第${rowIndex + 2}行字段${column.display_name}取值不支持`);
    });
    if (definition.key === "users") result.initial_password = row[definition.columns.length] ?? "";
    return result;
  });
}
function roleCode(name, index) { const known = { 老板: "owner", 管理员: "owner", owner: "owner", boss: "owner", admin: "owner", 教务: "academic", academic: "academic", 老师: "teacher", teacher: "teacher", 员工: "staff", staff: "staff" }; return known[String(name || "").trim()] || `template_role_${index + 1}`; }
function settingUpsert(rows, key, value) { const existing = rows.find((row) => row.key === key); if (existing) existing.value = value; else rows.push({ key, value }); }

function templateSourceData(parsed) {
  const data = Object.fromEntries(SOURCE_TABLE_DEFINITIONS.map((definition) => [definition.source_table, []])); const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  data.teachers = parsed.teachers.map((row, index) => ({ id: index + 1, name: row.name, phone: row.phone, notes: row.notes, status: row.status || "在职", joined_at: row.joined_at, left_at: row.left_at }));
  data.students = parsed.students.map((row, index) => ({ id: index + 1, name: row.name, grade: row.grade, phone: row.phone, guardian: row.guardian, notes: row.notes, status: row.status || "在读", joined_at: row.joined_at, left_at: row.left_at }));
  let stageId = 1; for (const row of parsed.students) for (const stage of parseStudentStages(row)) data.student_grade_stages.push({ id: stageId++, ...stage, created_at: now, updated_at: now });
  data.pricing_standards = parsed.pricing_standards.map((row, index) => ({ id: index + 1, grade: row.grade, student_count: row.student_count, unit_price: row.unit_price, description: row.description }));
  data.student_pricing = parsed.student_pricing.map((row, index) => ({ id: index + 1, student_name: row.student_name, grade: row.grade, subject: row.subject, student_names: row.student_names, custom_price: row.custom_price, notes: row.notes }));
  data.teacher_salary_rules = parsed.teacher_salary_rules.map((row, index) => ({ id: index + 1, teacher_name: row.teacher_name, grade: row.grade, subject: row.subject, student_names: row.student_names, salary_per_unit: row.salary_per_unit, unit_hours: 2, is_active: teacherActiveFromPriceStatus(row.price_status || (Number(row.salary_per_unit) > 0 ? PRICE_STATUS.SET : PRICE_STATUS.UNSET)), notes: row.notes, created_at: now, updated_at: now }));
  data.class_groups = parsed.class_groups.map((row, index) => ({ id: index + 1, teacher: row.teacher, grade: row.grade, subject: row.subject, students_key: normalizeStudents(row.students_display), students_display: row.students_display, class_name: row.class_name, created_at: now, updated_at: now }));
  data.lessons = parsed.lessons.map((row, index) => ({ id: index + 1, teacher_name: row.teacher_name, date: row.date, lesson_status: ["试课", "考试"].includes(row.display_status) ? row.display_status : "上课", time_slot: row.time_slot, classroom: row.classroom, grade: row.grade, subject: row.subject, student_names: row.student_names, notes: row.notes, course_status: row.display_status === "已上" ? "已上" : row.display_status === "请假" ? "请假" : "未上", status: row.display_status || "待上", teacher_salary: 0, teacher_salary_source: "", teacher_salary_rule_id: null, month_key: monthKey(row.date), sort_order: index + 1, created_at: now, updated_at: now }));
  data.recharge_records = parsed.recharge_records.map((row, index) => {
    const businessMonth = monthKeyFromLabel(row.month_label);
    if (!businessMonth) throw new FullExcelError("FULL_EXCEL_RECHARGE_MONTH_INVALID", `所有充值记录 第${index + 2}行月份格式无效`);
    const channel = String(row.channel || "");
    const channelOther = channel === "other" ? String(row.channel_other || "").trim() : "";
    if (channel === "other" && !channelOther) throw new FullExcelError("FULL_EXCEL_RECHARGE_CHANNEL_OTHER_REQUIRED", `所有充值记录 第${index + 2}行选择其他渠道时必须填写说明`);
    return { id: index + 1, student_name: row.student_name, grade: row.grade, prev_actual: 0, prev_gift: 0, cur_recharge: row.cur_recharge, cur_gift: row.cur_gift, recharge_date: row.recharge_date, channel, channel_other: channelOther, notes: row.notes, source: "manual", month_key: businessMonth };
  });
  data.student_opening_balances = parsed.student_opening_balances.map((row, index) => ({ id: index + 1, student_name: row.student_name, grade: row.grade, opening_actual_balance: row.opening_actual_balance, opening_gift_balance: row.opening_gift_balance, notes: row.notes, created_at: now, updated_at: now }));
  data.teacher_travel_fees = parsed.teacher_travel_fees.map((row, index) => ({ id: index + 1, month_key: row.month_key, teacher_name: row.teacher_name, week_index: row.week_index, week_start: row.week_start, week_end: row.week_end, amount: row.amount, notes: row.notes, created_at: now, updated_at: now }));
  data.staff = parsed.staff.map((row, index) => ({ id: index + 1, name: row.name, role: row.role, base_salary: row.base_salary, pay_type: row.pay_type || "月薪", daily_rate: row.daily_rate, standard_work_days: row.standard_work_days, phone: row.phone, status: row.status || "在职", joined_at: row.joined_at, left_at: row.left_at, notes: row.notes }));
  const staffIds = new Map(data.staff.map((row) => [row.name, row.id]));
  data.staff_salary_monthly = parsed.staff_salary_monthly.map((row, index) => { const staffId = staffIds.get(row.staff_name); if (!staffId) throw new FullExcelError("FULL_EXCEL_RELATION_INVALID", `员工薪资关联员工不存在：${row.staff_name}`); return { id: index + 1, staff_id: staffId, month_key: row.month_key, salary_actual: row.salary_actual, bonus: row.bonus, deduction: row.deduction, notes: row.notes }; });
  data.staff_attendance = parsed.staff_attendance.map((row, index) => { const staffId = staffIds.get(row.staff_name); if (!staffId) throw new FullExcelError("FULL_EXCEL_RELATION_INVALID", `员工考勤关联员工不存在：${row.staff_name}`); return { id: index + 1, staff_id: staffId, attendance_date: row.attendance_date, month_key: monthKey(row.attendance_date), status: row.status, pay_units: row.pay_units, hours: row.hours, reason: row.reason, notes: row.notes, updated_at: now }; });
  data.operating_expenses = parsed.operating_expenses.map((row, index) => ({ id: index + 1, category: row.category, expense_date: row.expense_date, amount: row.amount, vendor: row.vendor, notes: row.notes, month_key: monthKey(row.expense_date) }));
  const labelToSetting = new Map(Object.entries(SETTING_LABELS).map(([key, label]) => [label, key])); data.settings = parsed.settings.map((row) => { const key = labelToSetting.get(row.setting_label); if (!key) throw new FullExcelError("FULL_EXCEL_SETTING_UNKNOWN", `不支持的系统设置：${row.setting_label}`); return { key, value: String(row.value ?? "") }; });
  const categoryKeys = { 教室: "custom_classrooms", 科目: "custom_subjects", 时间: "custom_time_slots", 课程状态: "custom_course_statuses" }; for (const [category, key] of Object.entries(categoryKeys)) { const values = parsed.base_data.filter((row) => row.category === category && row.name).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).map((row) => row.name); if (values.length) settingUpsert(data.settings, key, JSON.stringify(values)); }
  data.operation_logs = parsed.operation_logs.map((row, index) => ({ id: index + 1, campus_name: "黎明教育", operator_name: row.operator_name, operator_account: row.operator_account, operation_type: row.operation_type, operation_content: row.operation_content, target_type: "", target_id: "", result_status: row.result_label === "失败" ? "failure" : "success", client_ip: "", user_agent: "", created_at: row.created_at || now, extra_json: "" }));
  data.roles = parsed.roles.map((row, index) => ({ id: index + 1, code: roleCode(row.name, index), name: row.name, description: row.description, is_system: row.role_status === "系统角色" ? 1 : 0, readonly: row.action_permissions === "只读" ? 1 : 0, created_at: now, updated_at: now }));
  const roleByName = new Map(data.roles.map((row) => [row.name, row.code])); for (const [index, row] of parsed.roles.entries()) for (const permission of splitList(row.page_permissions)) data.role_permissions.push({ role_code: data.roles[index].code, permission_key: permission, enabled: 1, created_at: now, updated_at: now });
  data.users = parsed.users.map((row, index) => { const role = roleByName.get(row.role_name) || roleCode(row.role_name, index); if (!data.roles.some((item) => item.code === role)) throw new FullExcelError("FULL_EXCEL_RELATION_INVALID", `账号角色不存在：${row.role_name}`); return { id: index + 1, username: row.username, display_name: row.display_name, role, teacher_name: splitList(row.bound_teachers)[0] || "", readonly_override: null, permission_override_enabled: row.page_permissions && row.page_permissions !== "跟随角色" ? 1 : 0, password_hash: passwordHash(row.initial_password), status: row.status_label === "停用" ? "disabled" : row.status_label === "已删除" ? "deleted" : "active", created_at: now, updated_at: now }; });
  let bindingId = 1; for (const [index, row] of parsed.users.entries()) { const userId = data.users[index].id; for (const teacher of splitList(row.bound_teachers)) data.user_teacher_bindings.push({ id: bindingId++, user_id: userId, teacher_name: teacher, created_at: now }); if (row.page_permissions && row.page_permissions !== "跟随角色") for (const permission of splitList(row.page_permissions)) data.user_page_permissions.push({ user_id: userId, permission_key: permission, enabled: 1, created_at: now, updated_at: now }); }
  return data;
}

function parseTemplate(input) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(path.resolve(input)); const workbook = validateWorkbookStructure(buffer).workbook; const expected = [...VISIBLE_SHEET_NAMES, TEMPLATE_GUIDE_SHEET];
  if (JSON.stringify(workbook.sheets.map((sheet) => sheet.name)) !== JSON.stringify(expected)) throw new FullExcelError("FULL_EXCEL_TEMPLATE_SHEET_ORDER_INVALID", "模板工作表名称或顺序不正确");
  if (workbook.sheets.some((sheet) => sheet.state !== "visible")) throw new FullExcelError("FULL_EXCEL_TEMPLATE_HIDDEN_SHEET_FORBIDDEN", "空白模板不得包含隐藏恢复表");
  const info = new Map(workbook.sheetMap.get("导出说明").rows.slice(1).map((row) => [row[0], row[1]])); if (info.get("文件类型") !== TEMPLATE_FILE_TYPE || Number(info.get("格式版本")) !== FORMAT_VERSION) throw new FullExcelError("FULL_EXCEL_FORMAT_INVALID", "文件版本不兼容，请重新下载 v4 模板");
  return { workbook, parsed: Object.fromEntries(VISIBLE_SHEET_DEFINITIONS.map((definition) => [definition.key, parseTemplateRows(workbook.sheetMap.get(definition.sheet_name), definition)])) };
}
function templateToFullBuffer(input, options = {}) { const { parsed } = parseTemplate(input); const data = templateSourceData(parsed); return { ...buildFullDataBufferFromSourceData(data, { appVersion: options.appVersion || "template-import", createdAt: options.createdAt || new Date(), schemaVersion: 0 }), data }; }
function normalizeImport(input, options = {}) { const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(path.resolve(input)); const workbook = validateWorkbookStructure(buffer).workbook; const info = workbook.sheetMap.get("导出说明"); const values = new Map((info?.rows || []).slice(1).map((row) => [row[0], row[1]])); if (Number(values.get("格式版本")) !== FORMAT_VERSION) throw new FullExcelError("FULL_EXCEL_FORMAT_INVALID", "文件版本不兼容，请重新导出或下载 v4 文件"); if (workbook.sheetMap.has("__恢复元数据")) return { kind: "full_data", buffer }; if (values.get("文件类型") === TEMPLATE_FILE_TYPE) return { kind: "template", ...templateToFullBuffer(buffer, options) }; throw new FullExcelError("FULL_EXCEL_FORMAT_INVALID", "文件类型不支持"); }
function previewImport(input, options = {}) { const normalized = normalizeImport(input, options); const verified = verifyFullData(normalized.buffer); return { ok: true, kind: normalized.kind, file_type: FILE_TYPE, format_version: FORMAT_VERSION, counts: verified.counts, preview_counts: verified.visible_counts }; }

const BUSINESS_TABLES = SOURCE_TABLE_DEFINITIONS.filter((definition) => !["settings", "pricing_standards", "roles", "role_permissions", "role_filter_presets", "users", "user_teacher_bindings", "user_page_permissions", "user_filter_presets"].includes(definition.source_table)).map((definition) => definition.source_table);
function assertBusinessEmpty(dbPath) { const db = new DatabaseSync(path.resolve(dbPath), { readOnly: true }); try { const occupied = [...new Set(BUSINESS_TABLES)].filter((table) => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count) > 0); if (occupied.length) throw new FullExcelError("FULL_EXCEL_INITIALIZE_TARGET_NOT_EMPTY", "空系统初始化要求业务表为空", { table_count: occupied.length }); } finally { db.close(); } }
function importFullExcel({ dbPath, inputPath, mode, preBackupDir = "", preBackupSatisfied = false, appVersion = "unknown" }) {
  if (!dbPath || !inputPath || !["initialize", "overwrite"].includes(mode)) throw new FullExcelError("FULL_EXCEL_IMPORT_ARGUMENT_INVALID", "必须提供数据库、Excel和initialize/overwrite模式");
  const normalized = normalizeImport(inputPath, { appVersion }); const verified = verifyFullData(normalized.buffer); let preBackup = null;
  if (mode === "initialize") assertBusinessEmpty(dbPath);
  if (mode === "overwrite" && !preBackupSatisfied) { if (!preBackupDir) throw new FullExcelError("FULL_EXCEL_PRE_BACKUP_REQUIRED", "覆盖恢复必须先生成导入前备份"); fs.mkdirSync(path.resolve(preBackupDir), { recursive: true }); const outputPath = path.join(path.resolve(preBackupDir), `导入前_${Date.now()}.xlsx`); preBackup = exportFullData({ dbPath, outputPath, appVersion }); verifyFullData(outputPath); }
  const temporary = path.join(path.dirname(path.resolve(inputPath)), `.normalized-${process.pid}-${Date.now()}.xlsx`);
  try { fs.writeFileSync(temporary, normalized.buffer, { flag: "wx", mode: 0o600 }); const result = restoreFullData({ dbPath, inputPath: temporary }); return { ...result, mode, input_kind: normalized.kind, preview_counts: verified.visible_counts, pre_backup: preBackup ? { filename: preBackup.filename, output_path: preBackup.outputPath } : null }; }
  finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
}

module.exports = { TEMPLATE_FILE_TYPE, TEMPLATE_FILENAME, TEMPLATE_GUIDE_SHEET, createTemplateBuffer, templateToFullBuffer, normalizeImport, previewImport, assertBusinessEmpty, importFullExcel, passwordHash };
