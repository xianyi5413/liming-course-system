const DEFAULT_COURSE_STATUSES = ["待上", "已上", "请假", "试课", "考试", "未缴费"];
const ATTENDANCE_STATUSES = ["上班", "休息", "请假", "病假", "事假", "半天", "加班", "调休", "旷工"];

function field(fieldKey, displayName, options = {}) {
  return Object.freeze({
    source_table: options.source_table || "",
    field_key: fieldKey,
    source_field: options.source_field === undefined ? fieldKey : options.source_field,
    display_name: displayName,
    column_order: Number(options.column_order || 0),
    data_type: options.data_type || "text",
    nullable: options.nullable !== false,
    required_for_restore: options.required_for_restore !== false,
    is_primary_key: !!options.is_primary_key,
    is_relation_field: !!options.is_relation_field,
    is_sensitive: !!options.is_sensitive,
    is_user_visible: options.is_user_visible !== false,
    enum_values: options.enum_values || [],
    date_format: options.date_format || "",
    amount_unit: options.amount_unit || "",
  });
}

function columns(sourceTable, specs) {
  return Object.freeze(specs.map((spec, index) => field(spec[0], spec[1], {
    source_table: sourceTable,
    column_order: index + 1,
    ...(spec[2] || {}),
  })));
}

const T = { data_type: "text" };
const I = { data_type: "integer" };
const N = { data_type: "number" };
const B = { data_type: "boolean", enum_values: [0, 1] };
const D = { data_type: "date", date_format: "YYYY-MM-DD" };
const DT = { data_type: "datetime", date_format: "YYYY-MM-DD HH:mm:ss" };
const M = { data_type: "amount", amount_unit: "人民币元" };
const PK = { ...I, is_primary_key: true, nullable: false };
const TECH = { is_user_visible: false };

const LESSON_COLUMNS = columns("lessons", [
  ["teacher_name", "授课老师", { nullable: true }],
  ["date", "日期", D],
  ["weekday", "星期", { ...T, source_field: null, required_for_restore: false }],
  ["time_slot", "时间", T],
  ["classroom", "教室", T],
  ["status", "状态", { ...T, enum_values: DEFAULT_COURSE_STATUSES }],
  ["grade", "年级", T],
  ["subject", "科目", T],
  ["student_names", "学生", T],
  ["notes", "备注", T],
  ["id", "ID", PK],
  ["month_key", "month_key", D],
  ["sort_order", "排序", I],
  ["teacher_salary", "教师薪资", M],
  ["teacher_salary_source", "教师薪资来源", T],
  ["teacher_salary_rule_id", "教师薪资规则ID", { ...I, is_relation_field: true }],
  ["created_at", "创建时间", DT],
  ["updated_at", "更新时间", DT],
  ["lesson_status", "lesson_status（技术兼容字段）", { ...T, ...TECH }],
  ["course_status", "course_status（技术兼容字段）", { ...T, ...TECH }],
]);

const direct = (key, sheetName, sourceTable, specs, options = {}) => Object.freeze({
  key, sheet_name: sheetName, source_table: sourceTable,
  restore_policy: options.restore_policy || "must",
  restore_order: options.restore_order || 0,
  sensitive: !!options.sensitive,
  columns: columns(sourceTable, specs),
});

const FULL_TABLE_DEFINITIONS = Object.freeze([
  direct("settings", "系统设置", "settings", [["key", "设置项", { ...T, is_primary_key: true, nullable: false }], ["value", "设置值", { ...T, nullable: false }]], { restore_order: 10 }),
  direct("teachers", "教师档案", "teachers", [["name", "教师姓名", { ...T, nullable: false }], ["phone", "联系电话", T], ["status", "状态", { ...T, enum_values: ["在职", "暂停", "离职"] }], ["joined_at", "入职日期", D], ["left_at", "离职日期", D], ["notes", "备注", T], ["id", "ID", PK]], { restore_order: 20 }),
  direct("students", "学生档案", "students", [["name", "学生姓名", { ...T, nullable: false }], ["grade", "年级", T], ["guardian", "监护人", T], ["phone", "联系电话", T], ["status", "状态", { ...T, enum_values: ["在读", "暂停", "离校", "已流出", "已毕业"] }], ["joined_at", "入学日期", D], ["left_at", "离校日期", D], ["notes", "备注", T], ["id", "ID", PK]], { restore_order: 30 }),
  direct("student_grade_stages", "学生年级阶段", "student_grade_stages", [["student_name", "学生姓名", { ...T, nullable: false, is_relation_field: true }], ["stage", "年级阶段", { ...T, nullable: false }], ["start_date", "开始日期", D], ["end_date", "结束日期", D], ["id", "ID", PK], ["created_at", "创建时间", DT], ["updated_at", "更新时间", DT]], { restore_order: 40 }),
  direct("pricing_standards", "费用标准", "pricing_standards", [["grade", "年级", { ...T, nullable: false }], ["student_count", "学生人数", { ...I, nullable: false }], ["unit_price", "单价", { ...M, nullable: false }], ["description", "说明", T], ["id", "ID", PK]], { restore_order: 50 }),
  direct("student_pricing", "学生单价规则", "student_pricing", [["student_name", "学生姓名", { ...T, nullable: false, is_relation_field: true }], ["grade", "年级", T], ["subject", "科目", { ...T, nullable: false }], ["student_names", "组合学生", T], ["custom_price", "自定义单价", { ...M, nullable: false }], ["notes", "备注", T], ["id", "ID", PK]], { restore_order: 60 }),
  direct("teacher_salary_rules", "教师薪资规则", "teacher_salary_rules", [["teacher_name", "教师姓名", { ...T, nullable: false, is_relation_field: true }], ["grade", "年级", { ...T, nullable: false }], ["subject", "科目", { ...T, nullable: false }], ["student_names", "学生组合", { ...T, nullable: false }], ["salary_per_unit", "单次薪资", { ...M, nullable: false }], ["unit_hours", "单位课时", { ...N, nullable: false }], ["is_active", "是否启用", { ...B, nullable: false }], ["notes", "备注", T], ["id", "ID", PK], ["created_at", "创建时间", DT], ["updated_at", "更新时间", DT]], { restore_order: 70 }),
  direct("class_groups", "班级", "class_groups", [["class_name", "班级名称", T], ["teacher", "教师", { ...T, nullable: false, is_relation_field: true }], ["grade", "年级", { ...T, nullable: false }], ["subject", "科目", { ...T, nullable: false }], ["students_display", "学生", T], ["id", "ID", PK], ["students_key", "学生键", { ...T, nullable: false }], ["created_at", "创建时间", DT], ["updated_at", "更新时间", DT]], { restore_order: 80 }),
  Object.freeze({ key: "lessons", sheet_name: "课程原始记录", source_table: "lessons", restore_policy: "must", restore_order: 90, sensitive: false, columns: LESSON_COLUMNS }),
  direct("fee_overrides", "单节费用覆盖", "fee_overrides", [["student_name", "学生姓名", { ...T, nullable: false, is_primary_key: true, is_relation_field: true }], ["unit_price", "单节费用", { ...M, nullable: false }], ["lesson_id", "课程ID", { ...I, nullable: false, is_primary_key: true, is_relation_field: true }], ["updated_at", "更新时间", DT]], { restore_order: 100 }),
  direct("recharge_records", "充值原始记录", "recharge_records", [["student_name", "学生姓名", { ...T, nullable: false, is_relation_field: true }], ["grade", "年级", T], ["prev_actual", "上月实际结转", M], ["prev_gift", "上月赠送结转", M], ["cur_recharge", "本月实际充值", M], ["cur_gift", "本月赠送学费", M], ["recharge_date", "充值日期", D], ["notes", "备注", T], ["id", "ID", PK], ["source", "来源", T], ["month_key", "month_key", D]], { restore_order: 110 }),
  direct("student_opening_balances", "期初余额", "student_opening_balances", [["student_name", "学生姓名", { ...T, nullable: false, is_relation_field: true }], ["grade", "年级", T], ["opening_actual_balance", "期初实际余额", M], ["opening_gift_balance", "期初赠送余额", M], ["notes", "备注", T], ["id", "ID", PK], ["month_key", "month_key", { ...D, nullable: false }], ["created_at", "创建时间", DT], ["updated_at", "更新时间", DT]], { restore_order: 120 }),
  direct("teacher_adjustments", "教师调整兼容数据", "teacher_adjustments", [["teacher_name", "教师姓名", { ...T, is_primary_key: true, is_relation_field: true }], ["week1_transport", "第1周车费", M], ["week2_transport", "第2周车费", M], ["week3_transport", "第3周车费", M], ["week4_transport", "第4周车费", M], ["notes", "备注", T]], { restore_order: 130 }),
  direct("teacher_adjustments_monthly", "教师月度调整", "teacher_adjustments_monthly", [["teacher_name", "教师姓名", { ...T, nullable: false, is_primary_key: true, is_relation_field: true }], ["month_key", "month_key", { ...D, nullable: false, is_primary_key: true }], ["week1_transport", "第1周车费", M], ["week2_transport", "第2周车费", M], ["week3_transport", "第3周车费", M], ["week4_transport", "第4周车费", M], ["notes", "备注", T]], { restore_order: 140 }),
  direct("teacher_travel_fees", "教师车费", "teacher_travel_fees", [["teacher_name", "教师姓名", { ...T, nullable: false, is_relation_field: true }], ["week_index", "周序号", { ...I, nullable: false }], ["week_start", "周开始日期", D], ["week_end", "周结束日期", D], ["amount", "金额", M], ["notes", "备注", T], ["id", "ID", PK], ["month_key", "month_key", { ...D, nullable: false }], ["created_at", "创建时间", DT], ["updated_at", "更新时间", DT]], { restore_order: 150 }),
  direct("staff", "员工", "staff", [["name", "员工姓名", { ...T, nullable: false }], ["role", "岗位", { ...T, nullable: false }], ["pay_type", "薪资类型", { ...T, enum_values: ["月薪", "日薪"] }], ["base_salary", "基本工资", M], ["daily_rate", "日薪", M], ["standard_work_days", "标准工作天数", N], ["phone", "联系电话", T], ["status", "状态", { ...T, enum_values: ["在职", "暂停", "离职"] }], ["joined_at", "入职日期", D], ["left_at", "离职日期", D], ["notes", "备注", T], ["id", "ID", PK]], { restore_order: 160 }),
  direct("staff_salary_monthly", "员工薪资", "staff_salary_monthly", [["staff_id", "员工ID", { ...I, nullable: false, is_relation_field: true }], ["month_key", "month_key", { ...D, nullable: false }], ["salary_actual", "实际工资", M], ["bonus", "奖金", M], ["deduction", "扣款", M], ["notes", "备注", T], ["id", "ID", PK]], { restore_order: 170 }),
  direct("staff_attendance", "员工考勤", "staff_attendance", [["staff_id", "员工ID", { ...I, nullable: false, is_relation_field: true }], ["attendance_date", "考勤日期", { ...D, nullable: false }], ["status", "状态", { ...T, nullable: false, enum_values: ATTENDANCE_STATUSES }], ["pay_units", "计薪单位", N], ["hours", "工时", N], ["reason", "原因", T], ["notes", "备注", T], ["id", "ID", PK], ["month_key", "month_key", { ...D, nullable: false }], ["updated_at", "更新时间", DT]], { restore_order: 180 }),
  direct("operating_expenses", "日常开销", "operating_expenses", [["expense_date", "日期", { ...D, nullable: false }], ["category", "类别", { ...T, nullable: false }], ["amount", "金额", { ...M, nullable: false }], ["vendor", "商家", T], ["notes", "备注", T], ["id", "ID", PK], ["month_key", "month_key", D]], { restore_order: 190 }),
  direct("roles", "角色", "roles", [["code", "角色代码", { ...T, nullable: false }], ["name", "角色名称", { ...T, nullable: false }], ["description", "说明", T], ["is_system", "是否系统角色", { ...B, nullable: false }], ["readonly", "是否只读", { ...B, nullable: false }], ["id", "ID", PK], ["created_at", "创建时间", DT], ["updated_at", "更新时间", DT]], { restore_order: 200 }),
  direct("role_permissions", "角色权限", "role_permissions", [["role_code", "角色代码", { ...T, nullable: false, is_primary_key: true, is_relation_field: true }], ["permission_key", "权限代码", { ...T, nullable: false, is_primary_key: true }], ["enabled", "是否启用", { ...B, nullable: false }], ["created_at", "创建时间", DT], ["updated_at", "更新时间", DT]], { restore_order: 210 }),
  direct("role_filter_presets", "角色筛选预设", "role_filter_presets", [["role_code", "角色代码", { ...T, nullable: false, is_relation_field: true }], ["view_key", "页面代码", { ...T, nullable: false }], ["filter_key", "筛选项代码", { ...T, nullable: false }], ["filter_value_json", "筛选值JSON", T], ["id", "ID", PK], ["created_at", "创建时间", DT], ["updated_at", "更新时间", DT]], { restore_order: 220 }),
  direct("users", "用户账号", "users", [["username", "用户名", { ...T, nullable: false }], ["display_name", "显示名称", { ...T, nullable: false }], ["status", "账号状态", { ...T, nullable: false, enum_values: ["active", "disabled", "deleted"] }], ["role", "角色代码", { ...T, nullable: false, is_relation_field: true }], ["teacher_name", "兼容教师姓名", T], ["readonly_override", "只读覆盖", B], ["permission_override_enabled", "个人权限覆盖已启用", { ...B, nullable: false }], ["id", "ID", PK], ["created_at", "创建时间", DT], ["updated_at", "更新时间", DT]], { restore_order: 230 }),
  direct("user_auth", "账号认证数据", "users", [["id", "用户ID", { ...I, nullable: false, is_primary_key: true, is_relation_field: true }], ["password_hash", "密码哈希", { ...T, nullable: false, is_sensitive: true, is_user_visible: false }]], { restore_order: 231, sensitive: true }),
  direct("user_teacher_bindings", "账号教师绑定", "user_teacher_bindings", [["user_id", "用户ID", { ...I, nullable: false, is_relation_field: true }], ["teacher_name", "教师姓名", { ...T, nullable: false, is_relation_field: true }], ["id", "ID", PK], ["created_at", "创建时间", DT]], { restore_order: 240 }),
  direct("user_page_permissions", "账号页面权限", "user_page_permissions", [["user_id", "用户ID", { ...I, nullable: false, is_primary_key: true, is_relation_field: true }], ["permission_key", "权限代码", { ...T, nullable: false, is_primary_key: true }], ["enabled", "是否启用", { ...B, nullable: false }], ["created_at", "创建时间", DT], ["updated_at", "更新时间", DT]], { restore_order: 250 }),
  direct("user_filter_presets", "账号筛选预设", "user_filter_presets", [["user_id", "用户ID", { ...I, nullable: false, is_primary_key: true, is_relation_field: true }], ["view_key", "页面代码", { ...T, nullable: false, is_primary_key: true }], ["filter_key", "筛选项代码", { ...T, nullable: false, is_primary_key: true }], ["filter_value_json", "筛选值JSON", T], ["created_at", "创建时间", DT], ["updated_at", "更新时间", DT]], { restore_order: 260 }),
  direct("parent_message_greetings", "家长群问候记录", "parent_message_greetings", [["send_object_name", "发送对象", T], ["send_object_type", "对象类型", T], ["students", "学生", T], ["greeting", "问候语", T], ["global_tail", "统一尾句", T], ["full_message", "完整消息", T], ["id", "ID", PK], ["send_object_key", "发送对象键", { ...T, nullable: false }], ["updated_at", "更新时间", DT]], { restore_order: 270 }),
  direct("course_notice_completion_records", "课程通知完成记录", "course_notice_completion_records", [["grade", "年级", T], ["subject", "科目", T], ["students", "学生", T], ["teacher", "教师", T], ["date", "日期", D], ["time", "时间", T], ["status", "状态", T], ["classroom", "教室", T], ["send_object_name", "发送对象", T], ["send_object_type", "对象类型", T], ["completed_by", "完成人", T], ["id", "ID", PK], ["unique_key", "唯一键", { ...T, nullable: false }], ["send_object_key", "发送对象键", T], ["completed_at", "完成时间", DT]], { restore_order: 280 }),
  direct("audit_logs", "数据检查记录", "audit_logs", [["source", "来源", T], ["severity", "严重程度", T], ["entity", "对象", T], ["field", "字段", T], ["before_value", "原值", T], ["after_value", "新值", T], ["status", "状态", T], ["notes", "备注", T], ["id", "ID", PK], ["run_at", "检查时间", DT], ["run_id", "检查批次ID", T], ["issue_key", "问题键", T]], { restore_order: 290, restore_policy: "should" }),
  direct("audit_ignores", "数据检查忽略项", "audit_ignores", [["source", "来源", T], ["entity", "对象", T], ["field", "字段", T], ["notes", "备注", T], ["issue_key", "问题键", { ...T, is_primary_key: true }], ["ignored_at", "忽略时间", DT]], { restore_order: 300, restore_policy: "should" }),
  direct("audit_events", "审计事件", "audit_events", [["actor_username", "操作账号", T], ["actor_role", "操作角色", T], ["action", "操作", { ...T, nullable: false }], ["entity_type", "对象类型", { ...T, nullable: false }], ["entity_id", "对象ID", T], ["before_json", "操作前JSON", T], ["after_json", "操作后JSON", T], ["id", "ID", PK], ["actor_user_id", "操作用户ID", { ...I, is_relation_field: true }], ["ip", "IP", T], ["user_agent", "User-Agent", T], ["created_at", "创建时间", DT]], { restore_order: 310, restore_policy: "should" }),
  direct("operation_logs", "操作日志", "operation_logs", [["campus_name", "校区", T], ["operator_name", "操作人", T], ["operator_account", "操作账号", T], ["operation_type", "操作类型", { ...T, nullable: false }], ["operation_content", "操作内容", T], ["target_type", "目标类型", T], ["target_id", "目标ID", T], ["result_status", "结果状态", T], ["id", "ID", PK], ["client_ip", "客户端IP", T], ["user_agent", "User-Agent", T], ["created_at", "创建时间", DT], ["extra_json", "扩展JSON", T]], { restore_order: 320, restore_policy: "should" }),
]);

const FULL_BY_KEY = Object.freeze(Object.fromEntries(FULL_TABLE_DEFINITIONS.map((item) => [item.key, item])));
const MONTHLY_SHEET_KEYS = Object.freeze([
  "lessons", "recharge_records", "student_opening_balances", "students", "student_grade_stages",
  "teachers", "student_pricing", "fee_overrides", "pricing_standards", "teacher_salary_rules",
  "teacher_adjustments_monthly", "teacher_travel_fees", "class_groups", "staff",
  "staff_salary_monthly", "staff_attendance", "operating_expenses",
]);
const MONTHLY_SHEET_DEFINITIONS = Object.freeze(MONTHLY_SHEET_KEYS.map((key) => FULL_BY_KEY[key]));
const EXCLUDED_TABLES = Object.freeze([
  { table: "backup_records", classification: "运行时数据，不需要恢复", reason: "仅索引外部旧备份文件并包含宿主机路径；Excel不包含对应文件，恢复记录会产生失效下载项。删除后不会丢失教务业务数据。" },
]);
const UNIQUE_KEYS_BY_TABLE = Object.freeze({
  teachers: [["name"]], students: [["name"]], student_grade_stages: [["student_name", "stage"]],
  pricing_standards: [["grade", "student_count"]], student_pricing: [["student_name", "grade", "subject", "student_names"]],
  class_groups: [["teacher", "grade", "subject", "students_key"]], fee_overrides: [["lesson_id", "student_name"]],
  student_opening_balances: [["month_key", "student_name"]], teacher_adjustments: [["teacher_name"]],
  teacher_adjustments_monthly: [["teacher_name", "month_key"]], teacher_travel_fees: [["month_key", "teacher_name", "week_index"]],
  staff_salary_monthly: [["staff_id", "month_key"]], staff_attendance: [["staff_id", "attendance_date"]],
  roles: [["code"]], role_permissions: [["role_code", "permission_key"]],
  role_filter_presets: [["role_code", "view_key", "filter_key"]], users: [["username"]],
  user_teacher_bindings: [["user_id", "teacher_name"]], user_page_permissions: [["user_id", "permission_key"]],
  user_filter_presets: [["user_id", "view_key", "filter_key"]], parent_message_greetings: [["send_object_key"]],
  course_notice_completion_records: [["unique_key"]], audit_ignores: [["issue_key"]],
});

module.exports = {
  DEFAULT_COURSE_STATUSES,
  ATTENDANCE_STATUSES,
  LESSON_COLUMNS,
  FULL_TABLE_DEFINITIONS,
  FULL_BY_KEY,
  MONTHLY_SHEET_DEFINITIONS,
  EXCLUDED_TABLES,
  UNIQUE_KEYS_BY_TABLE,
};
