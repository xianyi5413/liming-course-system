const DEFAULT_COURSE_STATUSES = ["待上", "已上", "请假", "试课", "考试", "未缴费"];
const ATTENDANCE_STATUSES = ["上班", "休息", "请假", "病假", "事假", "半天", "加班", "调休", "旷工"];
const { STUDENT_PRICE_STATUS_VALUES, TEACHER_PRICE_STATUS_VALUES } = require("../domain/price_status");

const STUDENT_GRADE_STAGE_COLUMNS = Object.freeze([
  ["junior_one_start", "初一起始日期", "初一", "start_date"],
  ["junior_one_end", "初一截止日期", "初一", "end_date"],
  ["junior_two_start", "初二起始日期", "初二", "start_date"],
  ["junior_two_end", "初二截止日期", "初二", "end_date"],
  ["junior_three_start", "初三起始日期", "初三", "start_date"],
  ["junior_three_end", "初三截止日期", "初三", "end_date"],
  ["senior_one_start", "高一起始日期", "高一", "start_date"],
  ["senior_one_end", "高一截止日期", "高一", "end_date"],
  ["senior_two_start", "高二起始日期", "高二", "start_date"],
  ["senior_two_end", "高二截止日期", "高二", "end_date"],
  ["senior_three_start", "高三起始日期", "高三", "start_date"],
  ["senior_three_end", "高三截止日期", "高三", "end_date"],
  ["graduated_at", "已毕业日期", "已毕业", "start_date"],
]);

const T = { data_type: "text" };
const I = { data_type: "integer" };
const N = { data_type: "number" };
const B = { data_type: "boolean" };
const D = { data_type: "date" };
const M = { data_type: "amount" };

function column(fieldKey, displayName, options = {}) {
  return Object.freeze({
    field_key: fieldKey,
    source_field: options.source_field === undefined ? fieldKey : options.source_field,
    display_name: displayName,
    data_type: options.data_type || "text",
    nullable: options.nullable !== false,
    enum_values: Object.freeze([...(options.enum_values || [])]),
  });
}

function sheet(key, sheetName, sourceTable, specs, options = {}) {
  return Object.freeze({
    key,
    sheet_name: sheetName,
    source_table: sourceTable || "",
    restore_source: options.restore_source !== false,
    reference_only: options.restore_source === false,
    sort_fields: Object.freeze([...(options.sort_fields || [])]),
    columns: Object.freeze(specs.map((spec) => column(spec[0], spec[1], spec[2] || {}))),
  });
}

// The order is a user-facing contract. Technical restore data is deliberately not
// mixed into these definitions; it is written to veryHidden worksheets instead.
const VISIBLE_SHEET_DEFINITIONS = Object.freeze([
  sheet("lessons", "所有课程数据", "lessons", [
    ["teacher_name", "授课老师", T], ["date", "日期", D], ["weekday", "星期", { ...T, source_field: null }],
    ["time_slot", "时间", T], ["classroom", "教室", T], ["display_status", "状态", { ...T, source_field: null, enum_values: DEFAULT_COURSE_STATUSES }],
    ["grade", "年级", T], ["subject", "科目", T], ["student_names", "学生", T], ["notes", "备注", T],
  ], { sort_fields: ["date", "sort_order", "time_slot", "teacher_name", "id"] }),
  sheet("student_fee_details", "所有学生费用明细", "", [
    ["student_name", "学生姓名", T], ["teacher_name", "授课老师", T], ["date", "日期", D],
    ["weekday", "星期", T], ["time_slot", "时间", T], ["classroom", "教室", T],
    ["display_status", "状态", { ...T, enum_values: DEFAULT_COURSE_STATUSES }], ["grade", "年级", T], ["subject", "科目", T],
    ["notes", "备注", T], ["unit_price", "单人费用", M],
  ], { restore_source: false, sort_fields: ["date", "teacher_name", "student_name"] }),
  sheet("recharge_records", "所有充值记录", "recharge_records", [
    ["month_label", "月份", { ...T, source_field: null, nullable: false }], ["student_name", "学生姓名", { ...T, nullable: false }], ["grade", "年级", T],
    ["cur_recharge", "本月实际充值", M], ["cur_gift", "本月赠送充值", M], ["recharge_date", "充值日期", D],
    ["channel", "来源/渠道", { ...T, enum_values: ["", "wechat", "cash", "alipay", "other"] }], ["channel_other", "其他渠道说明", T], ["notes", "备注", T],
  ], { sort_fields: ["month_key", "recharge_date", "id"] }),
  sheet("student_opening_balances", "期初余额", "student_opening_balances", [
    ["student_name", "学生姓名", { ...T, nullable: false }], ["grade", "年级", T],
    ["opening_actual_balance", "期初实际余额", M], ["opening_gift_balance", "期初赠送余额", M], ["notes", "备注", T],
  ], { sort_fields: ["student_name", "id"] }),
  sheet("student_pricing", "所有学生单价", "student_pricing", [
    ["student_name", "学生", { ...T, nullable: false }], ["grade", "年级", T], ["subject", "科目", { ...T, nullable: false }],
    ["student_names", "学生集合", T], ["custom_price", "单价", { ...M, nullable: false }],
    ["price_status", "价格状态", { ...T, source_field: null, enum_values: STUDENT_PRICE_STATUS_VALUES }], ["notes", "备注", T],
  ], { sort_fields: ["student_name", "grade", "subject", "id"] }),
  sheet("class_groups", "所有班级管理", "class_groups", [
    ["teacher", "老师", { ...T, nullable: false }], ["grade", "年级", { ...T, nullable: false }], ["subject", "科目", { ...T, nullable: false }],
    ["students_display", "学生集合", T], ["class_name", "班级名", T],
  ], { sort_fields: ["teacher", "grade", "subject", "id"] }),
  sheet("students", "学生档案", "students", [
    ["name", "姓名", { ...T, nullable: false }], ["grade", "当前年级", T],
    ...STUDENT_GRADE_STAGE_COLUMNS.map(([fieldKey, displayName]) => [fieldKey, displayName, { ...D, source_field: null }]),
    ["guardian", "监护人", T], ["phone", "电话", T], ["status", "状态", { ...T, enum_values: ["在读", "暂停", "已毕业", "已流出"] }],
    ["joined_at", "入学日期", D], ["left_at", "离校日期", D], ["notes", "备注", T],
  ], { sort_fields: ["name", "id"] }),
  sheet("teacher_travel_fees", "所有教师车费明细", "teacher_travel_fees", [
    ["month_key", "月份", { ...D, nullable: false }], ["teacher_name", "教师", { ...T, nullable: false }], ["week_index", "周次", { ...I, nullable: false }],
    ["week_start", "开始日期", D], ["week_end", "结束日期", D], ["amount", "金额", M], ["notes", "备注", T],
  ], { sort_fields: ["month_key", "week_start", "teacher_name", "id"] }),
  sheet("lesson_hour_details", "所有教师课时明细", "", [
    ["teacher_name", "授课老师", T], ["date", "日期", D], ["weekday", "星期", T], ["time_slot", "时间", T],
    ["classroom", "教室", T], ["display_status", "状态", { ...T, enum_values: DEFAULT_COURSE_STATUSES }], ["grade", "年级", T],
    ["subject", "科目", T], ["student_names", "学生", T], ["notes", "备注", T], ["teacher_salary", "教师薪资", M],
  ], { restore_source: false, sort_fields: ["date", "teacher_name", "time_slot"] }),
  sheet("teacher_salary_rules", "所有教师薪资规则", "teacher_salary_rules", [
    ["teacher_name", "老师", { ...T, nullable: false }], ["grade", "年级", { ...T, nullable: false }], ["subject", "科目", { ...T, nullable: false }],
    ["student_names", "学生集合", { ...T, nullable: false }], ["salary_per_unit", "每2小时薪资", { ...M, nullable: false }],
    ["price_status", "价格状态", { ...T, source_field: null, enum_values: TEACHER_PRICE_STATUS_VALUES }], ["notes", "备注", T],
  ], { sort_fields: ["teacher_name", "is_active", "id"] }),
  sheet("teachers", "教师档案", "teachers", [
    ["name", "姓名", { ...T, nullable: false }], ["phone", "电话", T], ["status", "状态", { ...T, enum_values: ["在职", "暂停", "离职"] }],
    ["joined_at", "入职日期", D], ["left_at", "离职日期", D], ["notes", "备注", T],
  ], { sort_fields: ["name", "id"] }),
  sheet("staff", "员工", "staff", [
    ["name", "姓名", { ...T, nullable: false }], ["role", "角色", { ...T, nullable: false }], ["pay_type", "计薪", { ...T, enum_values: ["月薪", "日薪"] }],
    ["base_salary", "基础工资", M], ["daily_rate", "日薪", M], ["standard_work_days", "标准天数", N], ["phone", "手机", T],
    ["status", "状态", { ...T, enum_values: ["在职", "暂停", "离职"] }], ["joined_at", "入职", D], ["left_at", "离职", D], ["notes", "备注", T],
  ], { sort_fields: ["name", "id"] }),
  sheet("staff_salary_monthly", "所有员工薪资", "staff_salary_monthly", [
    ["month_key", "月份", { ...D, nullable: false }], ["staff_name", "员工姓名", { ...T, source_field: null, nullable: false }],
    ["salary_actual", "实际工资", M], ["bonus", "奖金", M], ["deduction", "扣款", M], ["notes", "备注", T],
  ], { sort_fields: ["month_key", "staff_id", "id"] }),
  sheet("staff_attendance", "所有员工考勤", "staff_attendance", [
    ["staff_name", "员工姓名", { ...T, source_field: null, nullable: false }], ["attendance_date", "考勤日期", { ...D, nullable: false }],
    ["status", "状态", { ...T, nullable: false, enum_values: ATTENDANCE_STATUSES }], ["pay_units", "计薪单位", N], ["hours", "工时", N],
    ["reason", "原因", T], ["notes", "备注", T],
  ], { sort_fields: ["attendance_date", "staff_id", "id"] }),
  sheet("operating_expenses", "所有日常开销", "operating_expenses", [
    ["expense_date", "日期", { ...D, nullable: false }], ["category", "类别", { ...T, nullable: false }], ["amount", "金额", { ...M, nullable: false }],
    ["vendor", "商家", T], ["notes", "备注", T],
  ], { sort_fields: ["expense_date", "id"] }),
  sheet("settings", "系统设置", "settings", [["setting_label", "设置项", { ...T, source_field: null, nullable: false }], ["value", "设置值", T]], { sort_fields: ["key"] }),
  sheet("base_data", "基础数据", "", [["category", "类别", T], ["name", "名称", T], ["status", "状态", T], ["sort_order", "排序", I]], { restore_source: false, sort_fields: ["category", "sort_order", "name"] }),
  sheet("pricing_standards", "费用标准", "pricing_standards", [
    ["grade", "年级", { ...T, nullable: false }], ["student_count", "人数", { ...I, nullable: false }], ["unit_price", "单人费用", { ...M, nullable: false }],
    ["lookup_key", "查找键", { ...T, source_field: null }], ["description", "说明", T],
  ], { sort_fields: ["grade", "student_count", "id"] }),
  sheet("operation_logs", "操作日志", "operation_logs", [
    ["operator_name", "操作人", T], ["operator_account", "操作账号", T], ["operation_type", "操作类型", { ...T, nullable: false }],
    ["operation_content", "操作内容", T], ["result_label", "结果", { ...T, source_field: null, enum_values: ["成功", "失败"] }],
    ["created_at", "操作时间", T],
  ], { sort_fields: ["created_at", "id"] }),
  sheet("roles", "角色管理", "roles", [
    ["name", "角色名称", { ...T, nullable: false }], ["description", "角色说明", T], ["page_permissions", "页面权限", { ...T, source_field: null }],
    ["action_permissions", "操作权限", { ...T, source_field: null }], ["role_status", "状态", { ...T, source_field: null }],
  ], { sort_fields: ["id"] }),
  sheet("users", "账号管理", "users", [
    ["username", "账号", { ...T, nullable: false }], ["display_name", "姓名", { ...T, nullable: false }], ["role_name", "角色", { ...T, source_field: null, nullable: false }],
    ["bound_teachers", "绑定教师", { ...T, source_field: null }], ["page_permissions", "页面权限", { ...T, source_field: null }],
    ["status_label", "账号状态", { ...T, source_field: null, enum_values: ["启用", "停用", "已删除"] }],
  ], { sort_fields: ["id"] }),
]);

const VISIBLE_SHEET_NAMES = Object.freeze(["导出说明", ...VISIBLE_SHEET_DEFINITIONS.map((item) => item.sheet_name)]);
const HIDDEN_SHEET_NAMES = Object.freeze(["__恢复元数据", "__关系映射", "__账号认证数据", "__长文本分片"]);
const WORKBOOK_SEQUENCE = Object.freeze([...VISIBLE_SHEET_NAMES, ...HIDDEN_SHEET_NAMES]);

// Source tables included in a full restore. Diagnostic/audit history and external
// backup indexes are intentionally outside this contract.
const SOURCE_TABLE_DEFINITIONS = Object.freeze([
  ["settings", 10, ["key"]], ["teachers", 20, ["id"]], ["students", 30, ["id"]], ["student_grade_stages", 40, ["id"]],
  ["pricing_standards", 50, ["id"]], ["student_pricing", 60, ["id"]], ["teacher_salary_rules", 70, ["id"]], ["class_groups", 80, ["id"]],
  ["lessons", 90, ["id"]], ["fee_overrides", 100, ["lesson_id", "student_name"]], ["recharge_records", 110, ["id"]],
  ["student_opening_balances", 120, ["id"]], ["teacher_adjustments", 130, ["teacher_name"]],
  ["teacher_adjustments_monthly", 140, ["teacher_name", "month_key"]], ["teacher_travel_fees", 150, ["id"]],
  ["staff", 160, ["id"]], ["staff_salary_monthly", 170, ["id"]], ["staff_attendance", 180, ["id"]], ["operating_expenses", 190, ["id"]],
  ["roles", 200, ["id"]], ["role_permissions", 210, ["role_code", "permission_key"]], ["role_filter_presets", 220, ["id"]],
  ["users", 230, ["id"]], ["user_teacher_bindings", 240, ["id"]], ["user_page_permissions", 250, ["user_id", "permission_key"]],
  ["user_filter_presets", 260, ["user_id", "view_key", "filter_key"]], ["operation_logs", 270, ["id"]],
].map(([sourceTable, restoreOrder, keyFields]) => Object.freeze({ source_table: sourceTable, restore_order: restoreOrder, key_fields: Object.freeze(keyFields) })));

const FULL_TABLE_DEFINITIONS = SOURCE_TABLE_DEFINITIONS;
const EXCLUDED_TABLES = Object.freeze([
  { table: "backup_records", classification: "外部备份索引", reason: "外部文件路径不能随Excel恢复。" },
  { table: "audit_events", classification: "技术审计历史", reason: "包含原始请求前后快照，非核心业务恢复源。" },
  { table: "audit_logs", classification: "数据检查历史", reason: "可以重新执行数据检查生成。" },
  { table: "audit_ignores", classification: "数据检查状态", reason: "不影响核心业务恢复。" },
  { table: "parent_message_greetings", classification: "可重建运行历史", reason: "不属于核心教务数据。" },
  { table: "course_notice_completion_records", classification: "可重建运行历史", reason: "不属于核心教务数据。" },
]);

module.exports = {
  DEFAULT_COURSE_STATUSES,
  ATTENDANCE_STATUSES,
  STUDENT_GRADE_STAGE_COLUMNS,
  VISIBLE_SHEET_DEFINITIONS,
  VISIBLE_SHEET_NAMES,
  HIDDEN_SHEET_NAMES,
  SOURCE_TABLE_DEFINITIONS,
  FULL_TABLE_DEFINITIONS,
  WORKBOOK_SEQUENCE,
  EXCLUDED_TABLES,
};
