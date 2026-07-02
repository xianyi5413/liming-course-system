const navGroups = [
  { key: "home", label: "首页", views: [["dashboard", "首页"]] },
  { key: "schedule", label: "排课", views: [["lessons", "课程总表"], ["week", "周课表"], ["weekMatrix", "矩阵课表"], ["courseNotice", "家长群课程截图"], ["teacherCourseNotice", "老师课程截图"]] },
  {
    key: "students",
    label: "学生",
    views: [["feeDetails", "费用明细"], ["summary", "费用汇总"], ["recharges", "充值记录"], ["openingBalances", "期初余额"], ["studentQuery", "学生查询"]],
    moreViews: [["studentPricing", "学生单价"], ["studentProfiles", "学生档案"]],
  },
  { key: "teachers", label: "教师", views: [["teacherSalary", "薪资汇总"], ["teacherTravelFees", "车费明细"], ["teacherDetail", "薪资明细"], ["teacherSalaryRules", "课时明细"], ["teacherProfiles", "教师档案"]] },
  { key: "operations", label: "运营", views: [["staffPayroll", "员工薪资"], ["staffAttendance", "员工考勤"], ["expenses", "日常开销"]] },
  { key: "finance", label: "经营概览", views: [["finance", "期间概览"]] },
  { key: "settings", label: "设置", views: [["appearance", "外观设置"], ["baseData", "基础数据"], ["pricing", "费用标准"], ["audit", "数据对账"], ["operationLogs", "操作日志"], ["userAdmin", "账号权限"]] },
];

/**
 * FIELD_TIERS —— 按字段修改影响范围分三档（正交维度，字段可同属多档）：
 *   A: 纯本行展示 → 只更新当前单元格，不触发跨行计算
 *   B: 跨行排课   → 更新当前行 + 冲突涉及行，重跑 GET /api/schedule-conflicts
 *   C: 经营/费用   → 标记 dirty key，下次进入对应页面时重算
 *
 * 字段归档表：
 * | 字段            | A | B | C | dirty keys                              |
 * |-----------------|---|---|---|------------------------------------------|
 * | notes           | ✓ |   |   | -                                        |
 * | teacher_name    |   | ✓ | ✓ | teacherSalary                            |
 * | date            |   | ✓ | ✓ | finance, summary                         |
 * | time_slot       |   | ✓ |   | -                                        |
 * | classroom       |   | ✓ |   | -                                        |
 * | student_names   |   | ✓ | ✓ | finance, studentSummary                  |
 * | status          |   | ✓ | ✓ | finance, teacherSalary, studentSummary   |
 * | grade           | ✓ |   | ✓ | studentSummary, finance                  |
 * | subject         | ✓ |   | ✓ | studentSummary, finance                  |
 * | teacher_salary  | ✓ |   | ✓ | teacherSalary                            |
 */
const FIELD_TIERS = {
  notes:          { tiers: ["A"],       dirtyKeys: [] },
  teacher_name:   { tiers: ["B", "C"],  dirtyKeys: ["teacherSalary"] },
  date:           { tiers: ["B", "C"],  dirtyKeys: ["finance", "summary"] },
  time_slot:      { tiers: ["B"],       dirtyKeys: [] },
  classroom:      { tiers: ["B"],       dirtyKeys: [] },
  student_names:  { tiers: ["B", "C"],  dirtyKeys: ["finance", "studentSummary"] },
  status:         { tiers: ["B", "C"],  dirtyKeys: ["finance", "teacherSalary", "studentSummary"] },
  grade:          { tiers: ["A", "C"],  dirtyKeys: ["studentSummary", "finance"] },
  subject:        { tiers: ["A", "C"],  dirtyKeys: ["studentSummary", "finance"] },
  teacher_salary: { tiers: ["A", "C"],  dirtyKeys: ["teacherSalary"] },
};

const gradeOrder = ["初一", "初二", "初三", "高一", "高二", "高三"];
const gradeSortOrder = [...gradeOrder, "已毕业"];
const studentPromotionMap = { 初一: "初二", 初二: "初三", 初三: "高一", 高一: "高二", 高二: "高三", 高三: "已毕业" };
const studentStatusOptions = ["在读", "离校", "已流出", "暂停", "已毕业"];
const defaultCourseStatuses = ["待上", "已上", "请假", "试课", "考试", "未缴费"];
const LESSON_MANUAL_FIELD_LABELS = {
  teacher_name: "手动添加新老师",
  status: "手动添加新状态",
  time_slot: "手动添加新时间",
  classroom: "手动添加新教室",
  grade: "手动添加新年级",
  subject: "手动添加新科目",
};
const LESSON_MANUAL_FIELD_INPUT_LABELS = {
  teacher_name: "新老师名称",
  status: "新状态",
  time_slot: "新时间",
  classroom: "新教室名称",
  grade: "新年级名称",
  subject: "新科目名称",
};
const gradeTrendColors = {
  "初一": "#10b981",
  "初二": "#06b6d4",
  "初三": "#3b82f6",
  "高一": "#8b5cf6",
  "高二": "#f59e0b",
  "高三": "#f43f5e",
};
const LESSON_FILTER_KEY = "liming:lesson-filter";
const LESSON_CREATE_MANUAL_VALUE = "__manual__";
const SUMMARY_EXPAND_KEY = "liming:summary-expanded";
const RECHARGE_SOURCE_FILTER_KEY = "liming:recharge-source-filter";
const FINANCE_RANGE_KEY = "liming:finance-range";
const MATRIX_RANGE_KEY = "liming:matrix-range";
const MATRIX_VIEW_KEY = "liming:matrix-view";
const MATRIX_RANGE_USER_SET_KEY = "liming:matrix-range:user-set";
const WEEK_USER_SET_KEY = "liming:week:user-set";
const THEME_KEY = "liming:theme";
const PALETTE_KEY = "liming:palette";
const IGNORE_ROOM_ONE_CONFLICT_KEY = "liming:ignore-room-one-conflict";
const STUDENT_QUERY_RANGE_KEY = "liming:student-query-range";
const LOGIN_REMEMBER_KEY = "liming:login-remember";
const SIDEBAR_COLLAPSED_KEY = "liming:sidebar-collapsed";
const SHOT_FOLLOW_PALETTE_KEY = "liming:shot-follow-palette";
const DASHBOARD_METRICS_KEY = "liming:dashboard-metrics";
const DASHBOARD_SHORTCUTS_KEY = "liming:dashboard-shortcuts";
const DASHBOARD_RANGE_KEY = "liming:dashboard-range";
const DASHBOARD_DEFAULT_MIGRATED_KEY = "liming:dashboard-default-migrated";
const PAGE_POSITION_KEYS = ["liming:view", "liming:nav-group", "liming:user-admin-tab", "liming:profile-tab"];
const READONLY_WRITE_MESSAGE = "当前账号为只读，不能修改数据";
const READONLY_SAFE_MUTATION_PATHS = new Set([
  "/api/course-notice/complete",
  "/api/teacher-course-notice/complete",
]);
const TEACHER_ALL_VALUE = "__all_teacher_scope__";
const NAV_ICONS = {
  home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5"></path><path d="M6.5 10v9h11v-9"></path><path d="M10 19v-5h4v5"></path></svg>`,
  schedule: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"></rect><path d="M8 3.5v3M16 3.5v3M4 10h16"></path></svg>`,
  students: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"></circle><path d="M3.5 19c.7-3.4 2.6-5 5.5-5s4.8 1.6 5.5 5"></path><path d="M16 10.5c1.7.2 3 1.5 3.4 3.2M17 19h3.5"></path></svg>`,
  teachers: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="2.5"></circle><path d="M3.8 19c.6-3.2 2-4.8 4.2-4.8 1.6 0 2.7.8 3.5 2.3M12.5 5h7v9h-6M14 8.5h4M13 12l3-2"></path></svg>`,
  operations: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="8" width="17" height="12" rx="2"></rect><path d="M8.5 8V6.5A2.5 2.5 0 0 1 11 4h2a2.5 2.5 0 0 1 2.5 2.5V8M3.5 12.5h17M10 12.5v2h4v-2"></path></svg>`,
  finance: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V5"></path><path d="M5 19h15"></path><rect x="8" y="11" width="2.8" height="5"></rect><rect x="13" y="8" width="2.8" height="8"></rect><rect x="18" y="5" width="2.8" height="11"></rect></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 13.6a7.9 7.9 0 0 0 0-3.2l2-1.2-2-3.4-2.3 1a8.2 8.2 0 0 0-2.8-1.6L14 2.7h-4l-.3 2.5a8.2 8.2 0 0 0-2.8 1.6l-2.3-1-2 3.4 2 1.2a7.9 7.9 0 0 0 0 3.2l-2 1.2 2 3.4 2.3-1a8.2 8.2 0 0 0 2.8 1.6l.3 2.5h4l.3-2.5a8.2 8.2 0 0 0 2.8-1.6l2.3 1 2-3.4-2-1.2Z"></path></svg>`,
};
const ROLE_LABELS = {
  owner: "老板",
  boss: "老板",
  admin: "老板",
  academic: "教务",
  jiaowu: "教务",
  helper: "小助手",
  finance: "小助手",
  assistant: "助教",
  teacher: "老师",
};
const ACCOUNT_ROLE_CODES = ["owner", "academic", "helper", "assistant", "teacher"];
const START_DATE_PRESET_OPTIONS = [
  ["unlimited", "无限制"],
  ["today", "今天"],
  ["yesterday", "昨天"],
  ["tomorrow", "明天"],
  ["this_week_monday", "本周周一"],
  ["last_week_monday", "上周周一"],
  ["next_week_monday", "下周周一"],
  ["this_month_first", "本月 1 号"],
  ["last_month_first", "上月 1 号"],
  ["next_month_first", "下月 1 号"],
  ["this_year_first", "本年 1 月 1 日"],
  ["fixed", "固定日期"],
];
const END_DATE_PRESET_OPTIONS = [
  ["unlimited", "无限制"],
  ["today", "今天"],
  ["yesterday", "昨天"],
  ["tomorrow", "明天"],
  ["this_week_sunday", "本周周日"],
  ["last_week_sunday", "上周周日"],
  ["next_week_sunday", "下周周日"],
  ["this_month_last", "本月最后一天"],
  ["last_month_last", "上月最后一天"],
  ["next_month_last", "下月最后一天"],
  ["this_year_last", "本年 12 月 31 日"],
  ["fixed", "固定日期"],
];
const ACCOUNT_FILTER_PRESET_DEFS = [
  {
    view: "lessons",
    label: "课程总表",
    fields: [
      { key: "teacher_names", label: "预筛选老师", type: "teachers" },
      { key: "student", label: "预筛选学生" },
      { key: "status", label: "预筛选状态" },
      { key: "classroom", label: "预筛选教室" },
      { key: "grade", label: "预筛选年级" },
      { key: "subject", label: "预筛选科目" },
      { key: "query", label: "预筛选搜索" },
      { key: "start_date", label: "开始时间", type: "date-rule", bound: "start" },
      { key: "end_date", label: "结束时间", type: "date-rule", bound: "end" },
    ],
  },
  {
    view: "week",
    label: "周课表",
    fields: [
      { key: "teacher_names", label: "预筛选老师", type: "teachers" },
      { key: "student", label: "预筛选学生" },
      { key: "classroom", label: "预筛选教室" },
      { key: "grade", label: "预筛选年级" },
      { key: "subject", label: "预筛选科目" },
      { key: "start_date", label: "开始时间", type: "date-rule", bound: "start" },
      { key: "end_date", label: "结束时间", type: "date-rule", bound: "end" },
    ],
  },
  {
    view: "weekMatrix",
    label: "矩阵课表",
    fields: [
      { key: "teacher_names", label: "预筛选老师", type: "teachers" },
      { key: "student", label: "预筛选学生" },
      { key: "classroom", label: "预筛选教室" },
      { key: "grade", label: "预筛选年级" },
      { key: "subject", label: "预筛选科目" },
      { key: "start_date", label: "开始时间", type: "date-rule", bound: "start" },
      { key: "end_date", label: "结束时间", type: "date-rule", bound: "end" },
    ],
  },
  {
    view: "summary",
    label: "学生费用汇总",
    fields: [
      { key: "student", label: "预筛选学生" },
      { key: "grade", label: "预筛选年级" },
      { key: "balance", label: "预筛选余额状态" },
    ],
  },
  {
    view: "recharges",
    label: "充值记录",
    fields: [
      { key: "student", label: "预筛选学生" },
      { key: "grade", label: "预筛选年级" },
      { key: "source", label: "预筛选来源" },
    ],
  },
  {
    view: "teacherDetail",
    label: "薪资明细",
    fields: [
      { key: "teacher_names", label: "预筛选老师", type: "teachers" },
      { key: "grade", label: "预筛选年级" },
      { key: "subject", label: "预筛选科目" },
      { key: "student", label: "预筛选学生" },
      { key: "source", label: "预筛选薪资状态" },
      { key: "rule_status", label: "预筛选规则状态" },
    ],
  },
  {
    view: "teacherProfiles",
    label: "教师档案",
    fields: [
      { key: "status", label: "预筛选状态" },
    ],
  },
];
const ROLE_VIEWS = {
  owner: null,
  admin: null,
  boss: null,
  academic: new Set(["dashboard", "lessons", "week", "weekMatrix", "courseNotice", "teacherCourseNotice", "feeDetails", "summary", "recharges", "openingBalances", "studentQuery", "studentPricing", "studentProfiles", "teacherProfiles", "teacherSalary", "teacherTravelFees", "teacherDetail", "teacherSalaryRules", "finance", "appearance", "baseData", "pricing", "operationLogs"]),
  jiaowu: new Set(["dashboard", "lessons", "week", "weekMatrix", "courseNotice", "teacherCourseNotice", "feeDetails", "summary", "recharges", "openingBalances", "studentQuery", "studentPricing", "studentProfiles", "teacherProfiles", "teacherSalary", "teacherTravelFees", "teacherDetail", "teacherSalaryRules", "finance", "appearance", "baseData", "pricing", "operationLogs"]),
  helper: new Set(["dashboard", "lessons", "week", "weekMatrix", "courseNotice", "teacherCourseNotice", "feeDetails", "recharges", "studentQuery", "studentProfiles", "teacherProfiles", "appearance"]),
  finance: new Set(["dashboard", "lessons", "week", "weekMatrix", "courseNotice", "teacherCourseNotice", "feeDetails", "recharges", "studentQuery", "studentProfiles", "teacherProfiles", "appearance"]),
  assistant: new Set(["dashboard", "lessons", "week", "weekMatrix", "courseNotice", "teacherCourseNotice", "studentQuery", "studentProfiles", "teacherProfiles", "appearance"]),
  teacher: new Set(["lessons", "teacherDetail", "teacherProfiles", "appearance"]),
};
const PALETTES = [
  { key: "liming-blue", label: "黎明蓝", colors: ["#002147", "#00172F", "#EAF0F7", "#C8D6E5"] },
  { key: "jade-original", label: "青绿原版", colors: ["#2D9E8F", "#1E7A6E", "#EDF8F6", "#C8E7E2"] },
  { key: "warm-sun", label: "暖日", colors: ["#EAD6B2", "#8F5B18", "#6A471B", "#55340F"] },
  { key: "lavender", label: "薰衣草", colors: ["#D9D0EF", "#7B61B3", "#4C3B77", "#44355F"] },
  { key: "ink", label: "水墨", colors: ["#D9D9D9", "#7A7A7A", "#3D3D3D", "#121212"] },
  { key: "forest", label: "密林", colors: ["#BFE2C4", "#3F764D", "#234C2E", "#1D3422"] },
  { key: "glacier", label: "冰川", colors: ["#C7D8EA", "#2F6DB3", "#27496D", "#22364F"] },
  { key: "coffee", label: "咖啡", colors: ["#E3D1C6", "#8A5A44", "#4B3127", "#42271D"] },
  { key: "spice-earth", label: "香料土", colors: ["#C9AB87", "#8F562E", "#A45D3F", "#623726"] },
  { key: "monet-garden", label: "莫奈花园", colors: ["#ADBBD2", "#A2B068", "#8B607B", "#435F89"] },
  { key: "waterlily-pink", label: "睡莲柔粉", colors: ["#DBC8C3", "#7F96AC", "#8D586F", "#4F756A"] },
  { key: "bauhaus", label: "Bauhaus", colors: ["#F3D74B", "#144F9E", "#C92B2B", "#202020"] },
];
let state = null;
let auth = { user: null, roles: ROLE_LABELS };
let loadGeneration = 0;
const storedInitialView = localStorage.getItem("liming:view");
const shouldMigrateDashboardDefault = localStorage.getItem(DASHBOARD_DEFAULT_MIGRATED_KEY) !== "1" && (!storedInitialView || storedInitialView === "lessons");
let view = shouldMigrateDashboardDefault ? "dashboard" : (storedInitialView || "dashboard");
if (shouldMigrateDashboardDefault) {
  localStorage.setItem("liming:view", "dashboard");
  localStorage.setItem(DASHBOARD_DEFAULT_MIGRATED_KEY, "1");
}
let lastRenderedView = "";
if (view === "staffProfiles") view = "staffPayroll";
let activeWeek = readActiveWeek();
let matrixRange = readMatrixRange();
let matrixView = localStorage.getItem(MATRIX_VIEW_KEY) || "time";
let months = [];
let activeMonth = localStorage.getItem("liming:month") || "";
let includeInactive = localStorage.getItem("liming:include-inactive") === "1";
let themeMode = localStorage.getItem(THEME_KEY) || "system";
let paletteMode = localStorage.getItem(PALETTE_KEY) || "liming-blue";
let ignoreRoomOneConflict = localStorage.getItem(IGNORE_ROOM_ONE_CONFLICT_KEY) === "1";
let sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
let shotFollowPalette = localStorage.getItem(SHOT_FOLLOW_PALETTE_KEY) === "true";
let selectedStudent = "";
let studentQueryNameDraft = "";
let studentQueryRange = readStudentQueryRange();
let studentStatementModalOpen = false;
const COURSE_NOTICE_FILTER_KEY = "liming:course-notice-filter";
const TEACHER_COURSE_NOTICE_FILTER_KEY = "liming:teacher-course-notice-filter";
let courseNoticeFilter = readCourseNoticeFilter();
let courseNoticeState = { data: null, busy: false, error: "", loadedQuery: "" };
let saveCourseNoticeTailDebounced = null;
let teacherCourseNoticeFilter = readTeacherCourseNoticeFilter();
let teacherCourseNoticeState = { data: null, busy: false, error: "", loadedQuery: "" };
let saveTeacherCourseNoticeTailDebounced = null;
let selectedTeacher = "";
let selectedTeacherSalaryLessonIds = new Set();
let teacherSalaryRuleCandidateSync = { requested: false, busy: false, result: null, error: "" };
let teacherDetailFilter = { grade: "", subject: "", student: "", source: "", rule_status: "" };
let teacherSalaryRuleFilter = { teacher: "", grade: "", subject: "", student: "", salary_status: "" };
let teacherSalaryRuleModalOpen = false;
let passwordModalOpen = false;
let userMenuOpen = false;
let userAdminNotice = "";
let userAdminTab = localStorage.getItem("liming:user-admin-tab") || "accounts";
let rolePermissionModal = null;
let userAccessModal = null;
let roleCreateDraft = null;
let lessonFilter = readLessonFilter();
let appliedUserFilterPresetViews = new Set();
let scheduleMode = false;
let selectedLessonIds = new Set();
let lessonBatchDeleting = false;
let lessonConflictModalOpen = false;
let expandedSummaryStudents = readExpandedSummaryStudents();
let activeNavGroup = localStorage.getItem("liming:nav-group") || "";
let rechargeSourceFilter = localStorage.getItem(RECHARGE_SOURCE_FILTER_KEY) || "all";
let rechargeStudentFilter = "";
let rechargeGradeFilter = "";
let rechargeModalOpen = false;
let selectedRechargeIds = new Set();
let openingBalanceFilter = { student: "", grade: "" };
let openingBalanceModalOpen = false;
let selectedOpeningBalanceIds = new Set();
let feeDetailsFilter = { month_key: "", student: "", teacher: "", grade: "", status: "", source: "", start: "", end: "" };
let selectedFeeDetailKeys = new Set();
let summaryFilter = { student: "", grade: "", balance: "" };
let studentPricingFilter = { student: "", grade: "", subject: "", student_names: "", price: "", usage: "" };
let studentPricingModalOpen = false;
let financeRange = readFinanceRange();
let monthDeleteDraft = null;
let profileTab = localStorage.getItem("liming:profile-tab") || "teachers";
if (view === "profiles") view = profileTab === "students" ? "studentProfiles" : "teacherProfiles";
let profileSearch = "";
let profileStatusFilter = (() => {
  try {
    return { teachers: "", students: "", ...JSON.parse(localStorage.getItem("liming:profile-status-filter") || "{}") };
  } catch {
    return { teachers: "", students: "" };
  }
})();
let profileModal = null;
let selectedTeacherProfileIds = new Set();
let staffProfileSearch = "";
let staffStatusFilter = localStorage.getItem("liming:staff-status-filter") || "";
let staffModal = null;
let operationLogFilter = { operator_name: "", operator_account: "", operation_type: "", content: "", start_date: "", end_date: "" };
let operationLogPage = 1;
let operationLogPageSize = 10;
let operationLogData = { items: [], total: 0, page: 1, page_size: 10 };
let staffPayrollSearch = "";
let expenseModal = null;
let pricingAuditModal = null;
let lessonCreateDraft = null;
let lessonBatchCopyDraft = null;
let weekCopyDraft = null;
let focusedLessonIds = [];
let dirtyFlags = {};                /* [C档] 标记派生数据脏键，进入对应页面时消费 */
let lessonWarningsMap = {};         /* [约束5] 缓存 PATCH 返回的 warnings，按 lesson id 索引 */
let lessonFieldDelegatedBound = false; /* [约束2] 事件委托一次性绑定标记 */
let lessonTableDelegatedBound = false;
let expenseFilter = (() => {
  try {
    return { month_key: "", start: "", end: "", category: "", q: "", ...JSON.parse(localStorage.getItem("liming:expense-filter") || "{}") };
  } catch {
    return { month_key: "", start: "", end: "", category: "", q: "" };
  }
})();
let auditState = { xlsxReport: null, internalReport: null, logs: [], events: [], busy: false, notice: "" };
let auditSourceWorkbook = localStorage.getItem("liming:audit-source-workbook") || "";
let dashboardRange = readDashboardRange();
let dashboardMetricModalOpen = false;
let dashboardMetricDraft = null;
let dashboardShortcutModalOpen = false;
let dashboardShortcutDraft = null;
let customSelectEventsBound = false;
let customDateEventsBound = false;
let filterComboEventsBound = false;
let multiSelectEventsBound = false;
let userMenuEventsBound = false;
let customDatePickerEl = null;
let activeCustomDateInput = null;
let activeCustomDateMonth = null;
let dateRangePickerEl = null;
let activeDateRangePicker = null;
let dateRangePickerEventsBound = false;

const navEl = document.querySelector("#nav");
const topbarEl = document.querySelector("#topbar");
const contentEl = document.querySelector("#content");
const appEl = document.querySelector("#app");

function applySidebarState() {
  appEl?.classList.toggle("sidebar-collapsed", sidebarCollapsed);
}

applySidebarState();

function applyTheme() {
  const mode = ["system", "light", "dark"].includes(themeMode) ? themeMode : "system";
  document.documentElement.dataset.theme = mode;
  localStorage.setItem(THEME_KEY, mode);
}

applyTheme();

function applyPalette() {
  const keys = new Set(PALETTES.map((palette) => palette.key));
  const mode = keys.has(paletteMode) ? paletteMode : "liming-blue";
  paletteMode = mode;
  document.documentElement.dataset.palette = mode;
  localStorage.setItem(PALETTE_KEY, mode);
}

applyPalette();

function applyShotPalettePreference() {
  document.documentElement.dataset.shotFollowPalette = shotFollowPalette ? "true" : "false";
}

applyShotPalettePreference();

function isDarkThemeActive() {
  if (themeMode === "dark") return true;
  if (themeMode === "light") return false;
  return Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches);
}

function ensureToastContainer() {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

function showToast(message, type = 'success') {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-hiding');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 3000);
}

async function request(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const readonlySafeMutation = method === "POST" && READONLY_SAFE_MUTATION_PATHS.has(String(path).split("?")[0]);
  if (isReadonlyUser() && method !== "GET" && !readonlySafeMutation && !String(path).startsWith("/api/auth/")) {
    showToast(READONLY_WRITE_MESSAGE, "error");
    const error = new Error(READONLY_WRITE_MESSAGE);
    error.status = 403;
    error.path = path;
    throw error;
  }
  const config = {
    method,
    headers: { "content-type": "application/json" },
    cache: "no-store",
  };
  if (options.body !== undefined) config.body = JSON.stringify(options.body);
  const res = await fetch(path, config);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      auth.user = null;
      renderLogin(data.error || "请先登录");
    }
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.status = res.status;
    error.path = path;
    error.data = data;
    throw error;
  }
  return data;
}

async function requestWithStatus(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const readonlySafeMutation = method === "POST" && READONLY_SAFE_MUTATION_PATHS.has(String(path).split("?")[0]);
  if (isReadonlyUser() && method !== "GET" && !readonlySafeMutation && !String(path).startsWith("/api/auth/")) {
    showToast(READONLY_WRITE_MESSAGE, "error");
    return { ok: false, status: 403, data: { error: READONLY_WRITE_MESSAGE } };
  }
  const config = {
    method,
    headers: { "content-type": "application/json" },
  };
  if (options.body !== undefined) config.body = JSON.stringify(options.body);
  const res = await fetch(path, config);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    auth.user = null;
    renderLogin(data.error || "请先登录");
  }
  return { ok: res.ok, status: res.status, data };
}

function downloadFilenameFromDisposition(header, fallback) {
  if (!header) return fallback;
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return fallback;
    }
  }
  const ascii = header.match(/filename="?([^";]+)"?/i);
  return ascii ? ascii[1] : fallback;
}

async function downloadBlob(path, fallbackFilename) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(async () => ({ error: await res.text().catch(() => "") }));
    if (res.status === 401) {
      auth.user = null;
      renderLogin(data.error || "请先登录");
    }
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const filename = downloadFilenameFromDisposition(res.headers.get("content-disposition"), fallbackFilename);
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function canView(viewKey) {
  if (!auth.user) return false;
  if (Array.isArray(auth.user.permissions)) return auth.user.permissions.includes(viewKey);
  const allowed = ROLE_VIEWS[auth.user.role];
  return !allowed || allowed.has(viewKey);
}

const AREA_VIEW_KEYS = {
  dashboard: ["dashboard"],
  schedule: ["lessons", "week", "weekMatrix", "courseNotice", "teacherCourseNotice"],
  scheduleRead: ["lessons", "week", "weekMatrix", "courseNotice", "teacherCourseNotice"],
  students: ["feeDetails", "summary", "studentQuery", "studentProfiles", "studentPricing", "recharges", "openingBalances"],
  profiles: ["studentProfiles", "teacherProfiles"],
  pricing: ["pricing", "studentPricing"],
  teacherTransport: ["teacherTravelFees"],
  salary: ["teacherSalary", "teacherSalaryRules"],
  finance: ["finance"],
  expenses: ["expenses"],
  recharges: ["recharges"],
  studentBilling: ["feeDetails", "summary", "studentQuery"],
  staff: ["staffPayroll", "staffAttendance"],
  audit: ["audit"],
  operationLogs: ["operationLogs"],
  users: ["userAdmin"],
};

function canArea(area) {
  if (!auth.user) return false;
  if (Array.isArray(auth.user.permissions)) {
    return (AREA_VIEW_KEYS[area] || []).some((key) => auth.user.permissions.includes(key));
  }
  if (["owner", "admin", "boss"].includes(auth.user.role)) return true;
  if (["academic", "jiaowu"].includes(auth.user.role)) return ["schedule", "students", "profiles", "pricing", "teacherTransport", "salary", "finance", "operationLogs"].includes(area);
  if (["helper", "finance"].includes(auth.user.role)) return ["schedule", "students", "profiles", "recharges", "studentBilling"].includes(area);
  if (auth.user.role === "teacher") return ["scheduleRead", "teacherSelf", "profiles"].includes(area);
  if (auth.user.role === "assistant") return ["schedule", "scheduleRead", "students", "profiles"].includes(area);
  if (area === "salary" || area === "finance" || area === "staff" || area === "audit") return false;
  return false;
}

function isReadonlyUser() {
  return Number(auth.user?.readonly || 0) === 1;
}

function canWriteData() {
  return !isReadonlyUser();
}

function clearPagePositionCache() {
  PAGE_POSITION_KEYS.forEach((key) => localStorage.removeItem(key));
}

function loginRemember() {
  try {
    return { username: "", password: "", rememberUsername: false, rememberPassword: false, ...JSON.parse(localStorage.getItem(LOGIN_REMEMBER_KEY) || "{}") };
  } catch {
    return { username: "", password: "", rememberUsername: false, rememberPassword: false };
  }
}

function saveLoginRemember({ username, password, rememberUsername, rememberPassword }) {
  if (!rememberUsername && !rememberPassword) {
    localStorage.removeItem(LOGIN_REMEMBER_KEY);
    return;
  }
  localStorage.setItem(LOGIN_REMEMBER_KEY, JSON.stringify({
    username: rememberUsername || rememberPassword ? username : "",
    password: rememberPassword ? password : "",
    rememberUsername: Boolean(rememberUsername || rememberPassword),
    rememberPassword: Boolean(rememberPassword),
  }));
}

function firstAllowedView() {
  const serverView = auth.user?.first_accessible_view || auth.user?.firstAccessibleView || "";
  if (serverView && canView(serverView)) return serverView;
  const role = auth.user?.role || "";
  const preferred = role === "teacher"
    ? ["lessons", "teacherDetail", "teacherProfiles", "appearance"]
    : (["owner", "boss", "admin", "academic", "jiaowu"].includes(role)
      ? ["dashboard"]
      : (["helper", "finance", "assistant"].includes(role) ? ["lessons", "studentQuery", "dashboard", "appearance"] : []));
  for (const key of preferred) {
    if (canView(key)) return key;
  }
  for (const group of navGroups) {
    for (const [key] of [...group.views, ...(group.moreViews || [])]) {
      if (canView(key)) return key;
    }
  }
  return "";
}

function setActiveView(nextView) {
  view = nextView || "";
  activeNavGroup = view ? groupForView(view).key : "";
  if (view) {
    localStorage.setItem("liming:view", view);
    localStorage.setItem("liming:nav-group", activeNavGroup);
  } else {
    clearPagePositionCache();
  }
}

function ensureAccessibleView() {
  if (!auth.user) return true;
  if (view && canView(view)) return true;
  const nextView = firstAllowedView();
  if (!nextView) {
    clearPagePositionCache();
    state = null;
    renderNoAccessibleViews();
    return false;
  }
  setActiveView(nextView);
  return true;
}

function debugPermissionSelection(context, details = {}) {
  try {
    console.debug("[permissions]", {
      context,
      username: auth.user?.username || "",
      role: auth.user?.role || "",
      role_label: auth.user?.role_label || "",
      permissions: auth.user?.permissions || [],
      firstAccessibleView: firstAllowedView(),
      chosenView: view || "",
      ...details,
    });
  } catch {
    // Ignore debug logging failures in older browsers.
  }
}

function resetPagePositionForCurrentUser() {
  clearPagePositionCache();
  appliedUserFilterPresetViews = new Set();
  localStorage.removeItem(LESSON_FILTER_KEY);
  lessonFilter = defaultLessonFilter();
  selectedTeacher = "";
  teacherDetailFilter = { grade: "", subject: "", student: "", source: "", rule_status: "" };
  setActiveView(firstAllowedView());
  userAdminTab = "accounts";
}

function debounce(fn, delay = 200) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function closeCustomSelects(except = null) {
  document.querySelectorAll(".custom-select.open").forEach((selectBox) => {
    if (selectBox === except) return;
    selectBox.classList.remove("open");
    selectBox.classList.remove("open-up");
    customSelectMenu(selectBox)?.classList.remove("open", "open-up");
    selectBox.querySelector(".custom-select-button")?.setAttribute("aria-expanded", "false");
  });
}

function customSelectMenu(wrapper) {
  return wrapper?._customSelectMenu || wrapper?.querySelector(".custom-select-menu") || null;
}

function customSelectSearchInput(wrapper) {
  return customSelectMenu(wrapper)?.querySelector(".custom-select-search-input") || null;
}

function customSelectVisibleOptions(menu) {
  return [...(menu?.querySelectorAll(".custom-select-option:not(:disabled)") || [])]
    .filter((option) => !option.hidden);
}

function customSelectFilterText(value) {
  return String(value || "").trim().toLowerCase();
}

function filterCustomSelectOptions(wrapper) {
  const menu = customSelectMenu(wrapper);
  if (!menu) return;
  const query = customSelectFilterText(customSelectSearchInput(wrapper)?.value || "");
  let visibleCount = 0;
  menu.querySelectorAll(".custom-select-option").forEach((option) => {
    const haystack = customSelectFilterText(`${option.textContent || ""} ${option.dataset.value || ""}`);
    const matched = !query || haystack.includes(query);
    option.hidden = !matched;
    if (matched && !option.disabled) visibleCount += 1;
  });
  const empty = menu.querySelector(".custom-select-empty");
  if (empty) empty.hidden = visibleCount > 0;
}

function selectDisplayText(select) {
  return select.selectedOptions?.[0]?.textContent?.trim() || select.options?.[select.selectedIndex]?.textContent?.trim() || "请选择";
}

function syncCustomSelect(select, wrapper) {
  wrapper.querySelector(".custom-select-value").textContent = selectDisplayText(select);
  if (select.classList.contains("status-select")) {
    const cls = statusClass(rowStatus({ status: select.value }));
    ["done", "pending", "leave", "trial", "exam", "unpaid"].forEach((name) => {
      wrapper.classList.toggle(name, name === cls);
    });
  }
  customSelectMenu(wrapper)?.querySelectorAll(".custom-select-option").forEach((option) => {
    const selected = option.dataset.value === select.value;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-selected", selected ? "true" : "false");
  });
}

function cleanupCustomSelectPortals() {
  document.querySelectorAll('.custom-select-menu[data-select-portal="1"]').forEach((menu) => {
    if (!menu._customSelectOwner?.isConnected) menu.remove();
  });
}

function positionCustomSelectMenu(wrapper) {
  const button = wrapper.querySelector(".custom-select-button");
  const menu = customSelectMenu(wrapper);
  if (!button || !menu || !wrapper.classList.contains("open")) return;

  const rect = button.getBoundingClientRect();
  menu.style.minWidth = `${rect.width}px`;
  menu.style.maxWidth = `${Math.max(160, window.innerWidth - 16)}px`;
  menu.style.left = "8px";
  menu.style.top = "8px";

  const belowSpace = window.innerHeight - rect.bottom - 8;
  const aboveSpace = rect.top - 8;
  const openUp = belowSpace < 180 && aboveSpace > belowSpace;
  const availableHeight = Math.max(132, openUp ? aboveSpace : belowSpace);
  menu.style.maxHeight = `${Math.min(280, availableHeight)}px`;

  const menuRect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuRect.width - 8));
  const top = openUp
    ? Math.max(8, rect.top - Math.min(menuRect.height, availableHeight) - 6)
    : Math.min(window.innerHeight - 8, rect.bottom + 6);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  wrapper.classList.toggle("open-up", openUp);
  menu.classList.toggle("open-up", openUp);
}

function scrollCustomSelectOptionIntoView(wrapper) {
  const menu = customSelectMenu(wrapper);
  const selected = menu?.querySelector(".custom-select-option.selected");
  if (!menu || !selected) return;
  const top = selected.offsetTop;
  const bottom = top + selected.offsetHeight;
  if (top < menu.scrollTop) {
    menu.scrollTop = top;
  } else if (bottom > menu.scrollTop + menu.clientHeight) {
    menu.scrollTop = bottom - menu.clientHeight;
  }
}

function openCustomSelect(wrapper) {
  closeCustomSelects(wrapper);
  wrapper.classList.add("open");
  customSelectMenu(wrapper)?.classList.add("open");
  wrapper.querySelector(".custom-select-button")?.setAttribute("aria-expanded", "true");
  const searchInput = customSelectSearchInput(wrapper);
  if (searchInput) searchInput.value = "";
  filterCustomSelectOptions(wrapper);
  positionCustomSelectMenu(wrapper);
  scrollCustomSelectOptionIntoView(wrapper);
  positionCustomSelectMenu(wrapper);
  requestAnimationFrame(() => searchInput?.focus({ preventScroll: true }));
}

function enhanceCustomSelects() {
  cleanupCustomSelectPortals();
  document.querySelectorAll("select").forEach((select) => {
    if (select.multiple || select.dataset.customSelect === "1") return;
    select.dataset.customSelect = "1";
    select.classList.add("native-select-hidden");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const wrapper = document.createElement("div");
    wrapper.className = [
      "custom-select",
      select.classList.contains("cell-select") ? "custom-select-cell" : "custom-select-control",
      select.classList.contains("status-select") ? "custom-select-status" : "",
    ].filter(Boolean).join(" ");
    if (select.style.width) wrapper.style.width = select.style.width;
    if (select.style.marginTop) wrapper.style.marginTop = select.style.marginTop;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "custom-select-button";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = `<span class="custom-select-value"></span><span class="custom-select-arrow">⌄</span>`;

    const menu = document.createElement("div");
    menu.className = "custom-select-menu";
    menu.dataset.selectPortal = "1";
    menu.setAttribute("role", "listbox");
    menu._customSelectOwner = wrapper;
    wrapper._customSelectMenu = menu;

    const searchWrap = document.createElement("div");
    searchWrap.className = "custom-select-search";
    const searchInput = document.createElement("input");
    searchInput.className = "custom-select-search-input";
    searchInput.type = "text";
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;
    searchInput.placeholder = "输入搜索";
    searchInput.setAttribute("aria-label", "搜索选项");
    const searchClear = document.createElement("button");
    searchClear.type = "button";
    searchClear.className = "custom-select-search-clear";
    searchClear.setAttribute("aria-label", "清空搜索");
    searchClear.textContent = "×";
    searchWrap.append(searchInput, searchClear);
    const emptyOption = document.createElement("div");
    emptyOption.className = "custom-select-empty";
    emptyOption.hidden = true;
    emptyOption.textContent = "无匹配选项";
    menu.append(searchWrap, emptyOption);

    [...select.options].forEach((nativeOption) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "custom-select-option";
      option.dataset.value = nativeOption.value;
      option.setAttribute("role", "option");
      option.disabled = nativeOption.disabled;
      option.textContent = nativeOption.textContent;
      option.addEventListener("click", () => {
        select.value = nativeOption.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        syncCustomSelect(select, wrapper);
        closeCustomSelects();
      });
      menu.appendChild(option);
    });

    searchInput.addEventListener("input", () => {
      filterCustomSelectOptions(wrapper);
    });
    searchInput.addEventListener("keydown", (event) => {
      const optionsList = customSelectVisibleOptions(menu);
      if (event.key === "Escape") {
        closeCustomSelects();
        button.focus();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        optionsList[0]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        optionsList[optionsList.length - 1]?.focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        (menu.querySelector(".custom-select-option.selected:not([hidden])") || optionsList[0])?.click();
      }
    });
    searchClear.addEventListener("click", () => {
      searchInput.value = "";
      filterCustomSelectOptions(wrapper);
      searchInput.focus({ preventScroll: true });
    });

    button.addEventListener("click", () => {
      const willOpen = !wrapper.classList.contains("open");
      closeCustomSelects(wrapper);
      if (willOpen) openCustomSelect(wrapper);
      else {
        wrapper.classList.remove("open", "open-up");
        customSelectMenu(wrapper)?.classList.remove("open", "open-up");
        button.setAttribute("aria-expanded", "false");
      }
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeCustomSelects();
        button.focus();
      }
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCustomSelect(wrapper);
        customSelectSearchInput(wrapper)?.focus({ preventScroll: true });
      }
    });
    menu.addEventListener("keydown", (event) => {
      if (event.target?.classList?.contains("custom-select-search-input")) return;
      const optionsList = customSelectVisibleOptions(menu);
      const currentIndex = optionsList.indexOf(document.activeElement);
      if (event.key === "Escape") {
        closeCustomSelects();
        button.focus();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        optionsList[Math.min(optionsList.length - 1, currentIndex + 1)]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (currentIndex <= 0) customSelectSearchInput(wrapper)?.focus({ preventScroll: true });
        else optionsList[Math.max(0, currentIndex - 1)]?.focus();
      }
    });

    wrapper.append(button);
    select.insertAdjacentElement("afterend", wrapper);
    document.body.appendChild(menu);
    syncCustomSelect(select, wrapper);
  });

  if (!customSelectEventsBound) {
    customSelectEventsBound = true;
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".custom-select") && !event.target.closest(".custom-select-menu")) closeCustomSelects();
    });
    window.addEventListener("resize", () => closeCustomSelects());
    window.addEventListener("scroll", () => {
      document.querySelectorAll(".custom-select.open").forEach(positionCustomSelectMenu);
    }, true);
  }
}

function parseDateValue(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function customDateMonthFor(input) {
  const current = parseDateValue(input.value);
  if (current) return new Date(current.getFullYear(), current.getMonth(), 1);
  const month = parseDateValue(state?.settings?.month_key || activeMonth);
  const fallback = month || new Date();
  return new Date(fallback.getFullYear(), fallback.getMonth(), 1);
}

function ensureCustomDatePicker() {
  if (customDatePickerEl) return customDatePickerEl;
  customDatePickerEl = document.createElement("div");
  customDatePickerEl.className = "custom-date-picker";
  customDatePickerEl.hidden = true;
  customDatePickerEl.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  customDatePickerEl.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const nav = event.target.closest("[data-month-offset]");
    if (nav && activeCustomDateInput) {
      activeCustomDateMonth.setMonth(activeCustomDateMonth.getMonth() + Number(nav.dataset.monthOffset || 0));
      renderCustomDatePicker();
      activeCustomDateInput.focus({ preventScroll: true });
      return;
    }

    const day = event.target.closest("[data-date]");
    if (day && activeCustomDateInput) {
      const input = activeCustomDateInput;
      input.value = day.dataset.date;
      closeCustomDatePicker();
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  document.body.appendChild(customDatePickerEl);
  return customDatePickerEl;
}

function customDatePickerCells(month, selectedValue) {
  const today = todayDate();
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const value = dateKey(date);
    const classes = [
      "custom-date-day",
      date.getMonth() === month.getMonth() ? "" : "outside",
      value === selectedValue ? "selected" : "",
      value === today ? "today" : "",
    ].filter(Boolean).join(" ");
    return `<button class="${classes}" type="button" data-date="${escapeHtml(value)}">${date.getDate()}</button>`;
  }).join("");
}

function positionCustomDatePicker() {
  if (!activeCustomDateInput || !customDatePickerEl || customDatePickerEl.hidden) return;
  const rect = activeCustomDateInput.getBoundingClientRect();
  const width = Math.min(292, window.innerWidth - 16);
  customDatePickerEl.style.width = `${width}px`;
  customDatePickerEl.style.left = "8px";
  customDatePickerEl.style.top = "8px";
  const pickerRect = customDatePickerEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - pickerRect.width - 8));
  let top = rect.bottom + 8;
  if (top + pickerRect.height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - pickerRect.height - 8);
  }
  customDatePickerEl.style.left = `${left}px`;
  customDatePickerEl.style.top = `${top}px`;
}

function renderCustomDatePicker() {
  if (!activeCustomDateInput || !activeCustomDateMonth) return;
  const picker = ensureCustomDatePicker();
  const title = `${activeCustomDateMonth.getFullYear()}年${activeCustomDateMonth.getMonth() + 1}月`;
  picker.innerHTML = `
    <div class="custom-date-head">
      <button class="custom-date-nav" type="button" data-month-offset="-1" aria-label="上个月">‹</button>
      <div class="custom-date-title">${escapeHtml(title)}</div>
      <button class="custom-date-nav" type="button" data-month-offset="1" aria-label="下个月">›</button>
    </div>
    <div class="custom-date-weekdays" aria-hidden="true">
      <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
    </div>
    <div class="custom-date-grid">
      ${customDatePickerCells(activeCustomDateMonth, activeCustomDateInput.value)}
    </div>
  `;
  picker.hidden = false;
  positionCustomDatePicker();
}

function openCustomDatePicker(input) {
  closeCustomSelects();
  activeCustomDateInput = input;
  activeCustomDateMonth = customDateMonthFor(input);
  renderCustomDatePicker();
  input.setAttribute("aria-expanded", "true");
}

function closeCustomDatePicker() {
  if (activeCustomDateInput) activeCustomDateInput.setAttribute("aria-expanded", "false");
  activeCustomDateInput = null;
  activeCustomDateMonth = null;
  if (customDatePickerEl) customDatePickerEl.hidden = true;
}

function enhanceCustomDateInputs() {
  document.querySelectorAll('input[type="date"]').forEach((input) => {
    if (input.dataset.customDate === "1") return;
    input.dataset.customDate = "1";
    input.type = "text";
    input.readOnly = true;
    input.placeholder = "选择日期";
    input.classList.add("custom-date-input");
    input.setAttribute("aria-haspopup", "dialog");
    input.setAttribute("aria-expanded", "false");
    input.addEventListener("click", () => openCustomDatePicker(input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeCustomDatePicker();
      } else if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        event.preventDefault();
        openCustomDatePicker(input);
      }
    });
  });

  if (!customDateEventsBound) {
    customDateEventsBound = true;
    document.addEventListener("click", (event) => {
      if (event.target.closest(".custom-date-picker") || event.target.closest(".custom-date-input")) return;
      closeCustomDatePicker();
    });
    window.addEventListener("resize", positionCustomDatePicker);
    window.addEventListener("scroll", positionCustomDatePicker, true);
  }
}

function emptyDerivedState(previous = {}) {
  return {
    fee_details: previous.fee_details || [],
    student_summary: previous.student_summary || [],
    student_summary_to_date: previous.student_summary_to_date || [],
    teacher_summary: previous.teacher_summary || [],
    teacher_month_weeks: previous.teacher_month_weeks || [],
  };
}

function normalizeBootstrapState(data = {}, previousState = {}, keepPreviousPageData = false) {
  const previousDerived = previousState.derived || {};
  const next = {
    ...data,
    settings: data.settings || previousState.settings || {},
    lookups: {
      lesson_status: [],
      course_status: [],
      status: [],
      classrooms: [],
      subjects: [],
      times: [],
      grades: [],
      staff_roles: [],
      expense_categories: [],
      attendance_status: [],
      ...(data.lookups || previousState.lookups || {}),
    },
    teachers: data.teachers || previousState.teachers || [],
    students: data.students || previousState.students || [],
    used_lesson_lookups: data.used_lesson_lookups || previousState.used_lesson_lookups || {},
    pricing_standards: data.pricing_standards || previousState.pricing_standards || [],
    student_pricing: data.student_pricing || (keepPreviousPageData ? previousState.student_pricing : []) || [],
    teacher_salary_rules: data.teacher_salary_rules || (keepPreviousPageData ? previousState.teacher_salary_rules : []) || [],
    lessons: data.lessons || (keepPreviousPageData ? previousState.lessons : []) || [],
    recharges: data.recharges || (keepPreviousPageData ? previousState.recharges : []) || [],
    opening_balances: data.opening_balances || (keepPreviousPageData ? previousState.opening_balances : []) || [],
    derived: data.derived || (keepPreviousPageData ? emptyDerivedState(previousDerived) : emptyDerivedState()),
    dashboard: keepPreviousPageData ? previousState.dashboard || null : null,
    finance: keepPreviousPageData ? previousState.finance || null : null,
    profile_teachers: keepPreviousPageData ? previousState.profile_teachers || [] : [],
    profile_students: keepPreviousPageData ? previousState.profile_students || [] : [],
    source_workbooks: keepPreviousPageData ? previousState.source_workbooks || [] : [],
    users: keepPreviousPageData ? previousState.users || [] : [],
    roles: keepPreviousPageData ? previousState.roles || [] : [],
    permission_tree: keepPreviousPageData ? previousState.permission_tree || [] : [],
    staff: keepPreviousPageData ? previousState.staff || [] : [],
    staff_salary: keepPreviousPageData ? previousState.staff_salary || [] : [],
    staff_attendance: keepPreviousPageData ? previousState.staff_attendance || [] : [],
    expenses: keepPreviousPageData ? previousState.expenses || [] : [],
    schedule_conflicts: keepPreviousPageData
      ? previousState.schedule_conflicts || { issues: [], counts: { teacher: 0, student: 0, classroom: 0, invalid_time: 0 } }
      : { issues: [], counts: { teacher: 0, student: 0, classroom: 0, invalid_time: 0 } },
    student_history: keepPreviousPageData ? previousState.student_history || [] : [],
    student_statement: keepPreviousPageData ? previousState.student_statement || null : null,
  };
  return next;
}

function viewNeedsFullBootstrap(viewKey = view) {
  return ["feeDetails", "summary", "teacherSalary", "teacherTravelFees", "studentPricing"].includes(viewKey)
    || (viewKey === "pricing" && Boolean(pricingAuditModal));
}

function viewNeedsProfileTeachers(viewKey = view) {
  return [
    "lessons", "week", "weekMatrix", "courseNotice", "teacherCourseNotice",
    "teacherProfiles", "teacherDetail", "teacherSalary", "teacherTravelFees", "teacherSalaryRules", "userAdmin",
  ].includes(viewKey);
}

function viewNeedsProfileStudents(viewKey = view) {
  return [
    "lessons",
    "recharges", "openingBalances", "studentQuery", "studentProfiles",
    "studentPricing", "teacherSalaryRules",
  ].includes(viewKey);
}

function viewNeedsLessonRange(viewKey = view) {
  return ["lessons", "teacherDetail"].includes(viewKey);
}

function viewNeedsWeekLessons(viewKey = view) {
  return ["week", "weekMatrix"].includes(viewKey);
}

function viewNeedsScheduleConflicts(viewKey = view) {
  return ["lessons", "week", "weekMatrix"].includes(viewKey);
}

function bootstrapQuery(lite = true) {
  const params = new URLSearchParams();
  if (activeMonth) params.set("month", activeMonth);
  if (includeInactive) params.set("include_inactive", "1");
  if (lite) params.set("lite", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function loadActiveViewData({ refreshGlobal = false, fullBootstrap = false, generation = loadGeneration } = {}) {
  const stillCurrent = () => loadGeneration === generation;

  if (viewNeedsProfileTeachers()) {
    state.profile_teachers = ((await request("/api/teachers")).teachers || []);
    if (!stillCurrent()) return false;
  }
  if (viewNeedsProfileStudents() && canArea("students")) {
    state.profile_students = ((await request("/api/students")).students || []);
    if (!stillCurrent()) return false;
  }

  if (viewNeedsLessonRange()) {
    const lessonRange = lessonLoadRange();
    if (lessonRange) {
      const lessonsResult = await request(lessonsRangeUrl(lessonRange, lessonDataViewKey()));
      if (!stillCurrent()) return false;
      state.lessons = lessonsResult.lessons || [];
      state.lesson_loaded_range = lessonRange;
    }
  }

  if (viewNeedsWeekLessons()) {
    const weekSpan = naturalWeekSpan(activeMonth);
    ensureMatrixRange();
    const matrixStart = matrixRange.start && (!weekSpan || matrixRange.start < weekSpan.start) ? matrixRange.start : weekSpan?.start;
    const matrixEnd = matrixRange.end && (!weekSpan || matrixRange.end > weekSpan.end) ? matrixRange.end : weekSpan?.end;
    if (matrixStart && matrixEnd) {
      const weekViewKey = view === "weekMatrix" ? "weekMatrix" : "week";
      const weekLessonsResult = await request(lessonsRangeUrl({ start: matrixStart, end: matrixEnd }, weekViewKey));
      if (!stillCurrent()) return false;
      state.week_lessons = weekLessonsResult.lessons || [];
    }
  } else if (!state.week_lessons?.length) {
    state.week_lessons = state.lessons || [];
  }

  ensureFinanceRangeDates();
  if (view === "dashboard") {
    const dashboardParams = new URLSearchParams();
    dashboardParams.set("month", activeMonth || state.settings.month_key);
    dashboardParams.set("start", dashboardRange.start);
    dashboardParams.set("end", dashboardRange.end);
    state.dashboard = canView("dashboard") ? await request(`/api/dashboard?${dashboardParams.toString()}`) : null;
    if (!stillCurrent()) return false;
  }

  if (view === "finance") {
    state.finance = canArea("finance") ? await request(`/api/finance-summary?${financeRangeQuery()}`) : null;
    if (!stillCurrent()) return false;
  }

  if (view === "recharges") {
    state.recharges = canView("recharges") ? ((await request(`/api/recharges?month=${encodeURIComponent(activeMonth)}`)).recharges || []) : [];
    if (!stillCurrent()) return false;
  }

  if (view === "openingBalances") {
    state.opening_balances = canView("openingBalances") ? ((await request("/api/opening-balances")).opening_balances || []) : [];
    if (!stillCurrent()) return false;
  }

  if (view === "teacherSalaryRules" || (view === "teacherDetail" && canView("teacherSalaryRules"))) {
    state.teacher_salary_rules = canView("teacherSalaryRules") ? ((await request("/api/teacher-salary-rules")).rules || []) : [];
    if (!stillCurrent()) return false;
  }

  if (view === "audit") {
    state.source_workbooks = canArea("audit") ? ((await request("/api/source-workbooks")).workbooks || []) : [];
    if (!stillCurrent()) return false;
    if (canArea("audit")) {
      await refreshAuditEvents();
      if (!stillCurrent()) return false;
    } else {
      auditState.events = [];
    }
    if (!auditSourceWorkbook && state.source_workbooks.length) {
      auditSourceWorkbook = state.source_workbooks.find((item) => item.month_key === activeMonth)?.filename
        || state.source_workbooks[0].filename;
    }
  }

  if (view === "userAdmin") {
    const usersResult = canArea("users") ? await request("/api/users") : { users: [], roles: {} };
    if (!stillCurrent()) return false;
    state.users = usersResult.users || [];
    auth.roles = usersResult.roles || auth.roles || ROLE_LABELS;
    const rolesResult = auth.user?.role === "owner"
      ? await request("/api/roles")
      : { roles: [], permission_tree: auth.permission_tree || state.permission_tree || [] };
    if (!stillCurrent()) return false;
    state.roles = rolesResult.roles || [];
    state.permission_tree = rolesResult.permission_tree || state.permission_tree || [];
  } else if (refreshGlobal && !state.permission_tree?.length) {
    state.permission_tree = auth.permission_tree || [];
  }

  if (view === "staffPayroll" || view === "staffAttendance") {
    state.staff = canArea("staff") ? ((await request("/api/staff")).staff || []) : [];
    if (!stillCurrent()) return false;
    state.staff_salary = canArea("staff") ? ((await request(`/api/staff-salary?month=${encodeURIComponent(activeMonth)}`)).rows || []) : [];
    if (!stillCurrent()) return false;
    state.staff_attendance = canArea("staff") ? ((await request(`/api/staff-attendance?month=${encodeURIComponent(activeMonth)}`)).rows || []) : [];
    if (!stillCurrent()) return false;
  }

  if (view === "expenses") {
    ensureExpenseFilterDates();
    const expenseParams = new URLSearchParams();
    if (expenseFilter.start) expenseParams.set("start", expenseFilter.start);
    if (expenseFilter.end) expenseParams.set("end", expenseFilter.end);
    if (expenseFilter.category) expenseParams.set("category", expenseFilter.category);
    if (expenseFilter.q) expenseParams.set("q", expenseFilter.q);
    state.expenses = canArea("expenses") ? ((await request(`/api/operating-expenses?${expenseParams.toString()}`)).expenses || []) : [];
    if (!stillCurrent()) return false;
  }

  if (viewNeedsScheduleConflicts()) {
    state.schedule_conflicts = await request(`/api/schedule-conflicts?month=${encodeURIComponent(activeMonth)}${ignoreRoomOneConflict ? "&ignore_room_one=1" : ""}`)
      .catch(() => ({ issues: [], counts: { teacher: 0, student: 0, classroom: 0, invalid_time: 0 } }));
    if (!stillCurrent()) return false;
  }

  if (view === "studentQuery") {
    const students = uniqueSorted((state.profile_students || [])
      .map((row) => String(row.name || "").trim())
      .filter(Boolean));
    if (selectedStudent && !students.includes(selectedStudent)) selectedStudent = "";
    studentQueryNameDraft = selectedStudent || studentQueryNameDraft;
    state.student_history = selectedStudent
      ? ((await request(`/api/student/${encodeURIComponent(selectedStudent)}/history`)).history || [])
      : [];
    if (!stillCurrent()) return false;
    await loadStudentStatement();
    if (!stillCurrent()) return false;
  } else if (!fullBootstrap) {
    state.student_history = [];
    state.student_statement = null;
  }

  return true;
}

async function load(options = {}) {
  const previousState = state || {};
  const refreshGlobal = options.refreshGlobal !== false || !auth.user || !previousState.settings;
  let authResult = {};
  dirtyFlags = {};                   /* [C档] 全量 load 重置所有脏标记 */
  lessonWarningsMap = {};            /* [约束5] 全量重绘时清空 warnings 缓存 */
  const thisGeneration = ++loadGeneration;
  if (refreshGlobal) {
    authResult = await request("/api/auth/me");
    if (loadGeneration !== thisGeneration) return;
    auth = { ...auth, ...authResult };
  }
  if (!auth.user) return renderLogin();
  if (!ensureAccessibleView()) return;
  if (refreshGlobal || !months.length) {
    months = await request("/api/months");
    if (loadGeneration !== thisGeneration) return;
  }
  const fullBootstrap = viewNeedsFullBootstrap();
  // 登录首屏通常只需要设置、字典、月份和首页指标；重数据页进入时再拉完整派生数据。
  state = normalizeBootstrapState(
    await request(`/api/bootstrap${bootstrapQuery(!fullBootstrap)}`),
    previousState,
    !fullBootstrap,
  );
  if (loadGeneration !== thisGeneration) return;
  activeMonth = state.active_month_key || state.settings.month_key || activeMonth;
  if (activeMonth && !months.includes(activeMonth)) months = [activeMonth, ...months];
  localStorage.setItem("liming:month", activeMonth);
  applyUserFilterPreset(view);
  ensureActiveWeekDefault();
  ensureLessonFilterDates();
  const loaded = await loadActiveViewData({ refreshGlobal, fullBootstrap, generation: thisGeneration });
  if (!loaded || loadGeneration !== thisGeneration) return;
  const teachers = state.teachers.map((row) => row.name);
  if (auth.user.role === "teacher") {
    selectedTeacher = teachers.length > 1 && (!selectedTeacher || selectedTeacher === TEACHER_ALL_VALUE || !teachers.includes(selectedTeacher))
      ? TEACHER_ALL_VALUE
      : teachers.includes(selectedTeacher)
      ? selectedTeacher
      : (teachers[0] || "");
  } else if (!selectedTeacher || !teachers.includes(selectedTeacher)) {
    selectedTeacher = teachers[0] || "";
  }
  render();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function moneyInput(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function money2(value) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "¥0.00";
  const amount = money2(Math.abs(n));
  return n < 0 ? `-¥${amount}` : `¥${amount}`;
}

const formatCurrency = formatMoney;

function yuan2(value) {
  return formatMoney(value);
}

function todayDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatBeijingTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const source = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(raw) ? `${raw}Z` : raw);
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return raw;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function currentWeekRange() {
  const today = new Date(`${todayDate()}T00:00:00`);
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: dateKey(monday), end: dateKey(sunday) };
}

function readDashboardRange() {
  const fallback = currentWeekRange();
  try {
    const saved = { ...fallback, ...JSON.parse(localStorage.getItem(DASHBOARD_RANGE_KEY) || "{}") };
    if (isDateValue(saved.start) && isDateValue(saved.end) && saved.start <= saved.end) return saved;
  } catch {
    // fall through
  }
  return fallback;
}

function storedActiveWeekValue() {
  if (localStorage.getItem(WEEK_USER_SET_KEY) !== "1") return null;
  const saved = localStorage.getItem("liming:week");
  if (saved === null) return null;
  const value = Number(saved);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function currentWeekIndexForMonth(monthKey = todayDate().slice(0, 7)) {
  const today = todayDate();
  const ranges = naturalWeekRanges(monthKey);
  const index = ranges.findIndex((range) => range.includes(today));
  return index >= 0 ? index : 0;
}

function readActiveWeek() {
  const saved = storedActiveWeekValue();
  if (saved !== null) return saved;
  return currentWeekIndexForMonth(localStorage.getItem("liming:month") || todayDate().slice(0, 7));
}

function ensureActiveWeekDefault() {
  if (storedActiveWeekValue() !== null) return;
  activeWeek = currentWeekIndexForMonth(state?.settings?.month_key || activeMonth || todayDate().slice(0, 7));
  localStorage.setItem("liming:week", String(activeWeek));
}

function readNoticeFilter(storageKey) {
  const fallback = { ...currentWeekRange(), onlyTeaching: true };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const filter = {
      start: isDateValue(saved.start) ? saved.start : fallback.start,
      end: isDateValue(saved.end) ? saved.end : fallback.end,
      onlyTeaching: typeof saved.onlyTeaching === "boolean" ? saved.onlyTeaching : fallback.onlyTeaching,
    };
    if (filter.start > filter.end) filter.end = filter.start;
    return filter;
  } catch {
    return fallback;
  }
}

function offsetDateMonths(value, offset) {
  const source = parseDateValue(value);
  if (!source) return "";
  const date = new Date(source);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return dateKey(date);
}

function dateRangePreset(preset) {
  const today = todayDate();
  const currentMonth = `${today.slice(0, 7)}-01`;
  if (preset === "current-month") return monthBounds(currentMonth);
  if (preset === "current-week") {
    const start = startOfWeek(today);
    return { start, end: addDays(start, 6) };
  }
  if (preset === "prev-month") return monthBounds(offsetMonth(currentMonth, -1));
  if (preset === "prev-week") {
    const start = addDays(startOfWeek(today), -7);
    return { start, end: addDays(start, 6) };
  }
  if (preset === "last-3-months") return { start: offsetDateMonths(today, -3), end: today };
  if (preset === "last-year") return { start: offsetDateMonths(today, -12), end: today };
  if (preset === "prev-year") {
    const year = Number(today.slice(0, 4)) - 1;
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
  if (preset === "current-year") {
    const year = Number(today.slice(0, 4));
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
  return null;
}

function dateRangeText(start, end) {
  if (!start && !end) return "开始日期 → 结束日期";
  return `${start || "开始日期"} → ${end || "结束日期"}`;
}

function dateRangeTextMarkup(start, end) {
  const startText = start || "开始日期";
  const endText = end || "结束日期";
  return `
    <span class="date-range-part date-range-start ${start ? "" : "is-placeholder"}">${escapeHtml(startText)}</span>
    <span class="date-range-separator" aria-hidden="true">→</span>
    <span class="date-range-part date-range-end ${end ? "" : "is-placeholder"}">${escapeHtml(endText)}</span>
  `;
}

function syncDateRangeTriggerText(wrapper, start, end) {
  const text = wrapper?.querySelector(".date-range-text");
  if (!text) return;
  const startEl = text.querySelector(".date-range-start");
  const endEl = text.querySelector(".date-range-end");
  if (!startEl || !endEl) {
    text.innerHTML = dateRangeTextMarkup(start, end);
  } else {
    startEl.textContent = start || "开始日期";
    endEl.textContent = end || "结束日期";
    startEl.classList.toggle("is-placeholder", !start);
    endEl.classList.toggle("is-placeholder", !end);
  }
  text.setAttribute("aria-label", dateRangeText(start, end));
}

function dateRangePickerControl({
  scope,
  start = "",
  end = "",
  placeholder = "选择日期范围",
  startField = "start",
  endField = "end",
  disabled = false,
  className = "",
} = {}) {
  const hasValue = Boolean(start || end);
  return `
    <span class="date-range-picker ${hasValue ? "has-value" : ""} ${disabled ? "disabled" : ""}" data-range-scope="${escapeHtml(scope || "")}" data-start-field="${escapeHtml(startField)}" data-end-field="${escapeHtml(endField)}" data-start="${escapeHtml(start || "")}" data-end="${escapeHtml(end || "")}">
      <button class="control date-range-trigger ${className}" type="button" ${disabled ? "disabled" : ""} aria-haspopup="dialog" aria-expanded="false">
        <span class="date-range-text" aria-label="${escapeHtml(dateRangeText(start, end))}">${dateRangeTextMarkup(start, end)}</span>
        <span class="date-range-icon" aria-hidden="true"></span>
      </button>
      <button class="date-range-clear" type="button" aria-label="清空日期范围" ${hasValue && !disabled ? "" : "hidden"}>×</button>
    </span>
  `;
}

function ensureDateRangePicker() {
  if (dateRangePickerEl) return dateRangePickerEl;
  dateRangePickerEl = document.createElement("div");
  dateRangePickerEl.className = "date-range-picker-panel";
  dateRangePickerEl.hidden = true;
  dateRangePickerEl.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  dateRangePickerEl.addEventListener("click", async (event) => {
    event.stopPropagation();
    const preset = event.target.closest("[data-range-preset]");
    if (preset && activeDateRangePicker) {
      const range = dateRangePreset(preset.dataset.rangePreset);
      if (range) await applyDateRangePickerValue(activeDateRangePicker.wrapper, range.start, range.end);
      return;
    }
    const nav = event.target.closest("[data-range-nav]");
    if (nav && activeDateRangePicker) {
      const offset = Number(nav.dataset.monthOffset || 0) + Number(nav.dataset.yearOffset || 0) * 12;
      activeDateRangePicker.month.setMonth(activeDateRangePicker.month.getMonth() + offset);
      renderDateRangePickerPanel();
      return;
    }
    const day = event.target.closest("[data-range-date]");
    if (!day || day.disabled || !activeDateRangePicker) return;
    event.preventDefault();
    await handleDateRangeDayClick(day.dataset.rangeDate);
  });
  dateRangePickerEl.addEventListener("mouseover", (event) => {
    const day = event.target.closest("[data-range-date]");
    if (!day || day.disabled || !activeDateRangePicker) return;
    activeDateRangePicker.hover = day.dataset.rangeDate || "";
    renderDateRangePickerPanel();
  });
  document.body.appendChild(dateRangePickerEl);
  return dateRangePickerEl;
}

function closeDateRangePicker() {
  if (activeDateRangePicker?.wrapper) {
    activeDateRangePicker.wrapper.classList.remove("open");
    activeDateRangePicker.wrapper.querySelector(".date-range-trigger")?.setAttribute("aria-expanded", "false");
  }
  activeDateRangePicker = null;
  if (dateRangePickerEl) dateRangePickerEl.hidden = true;
}

function dateRangeBaseMonth(start, end) {
  const value = isDateValue(start) ? start : (isDateValue(end) ? end : todayDate());
  const date = parseDateValue(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function openDateRangePicker(wrapper, event = null) {
  closeCustomSelects();
  closeCustomDatePicker();
  closeDateRangePicker();
  const start = wrapper.dataset.start || "";
  const end = wrapper.dataset.end || "";
  const rect = wrapper.getBoundingClientRect();
  const side = event?.clientX && event.clientX > rect.left + rect.width / 2 ? "end" : "start";
  activeDateRangePicker = {
    wrapper,
    month: dateRangeBaseMonth(start, end),
    start,
    end,
    anchor: "",
    pending: side === "end" ? "start" : "end",
    hover: "",
  };
  wrapper.classList.add("open");
  wrapper.querySelector(".date-range-trigger")?.setAttribute("aria-expanded", "true");
  renderDateRangePickerPanel();
}

function dateInRange(value, start, end) {
  return Boolean(isDateValue(value) && isDateValue(start) && isDateValue(end) && start <= value && value <= end);
}

function dateRangePreviewBounds() {
  const state = activeDateRangePicker;
  if (!state?.anchor || !state.hover) return null;
  return state.hover >= state.anchor
    ? { start: state.anchor, end: state.hover }
    : { start: state.hover, end: state.anchor };
}

function isDateRangeDayDisabled(value) {
  return false;
}

function dateRangeCalendarCells(month) {
  const state = activeDateRangePicker || {};
  const today = todayDate();
  const selectedStart = state.start || "";
  const selectedEnd = state.end || "";
  const preview = dateRangePreviewBounds();
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const value = dateKey(date);
    const disabled = isDateRangeDayDisabled(value);
    const selected = dateInRange(value, selectedStart, selectedEnd);
    const inPreview = preview && dateInRange(value, preview.start, preview.end);
    const classes = [
      "date-range-day",
      date.getMonth() === month.getMonth() ? "" : "outside",
      value === today ? "today" : "",
      selected ? "selected" : "",
      value === selectedStart ? "range-start" : "",
      value === selectedEnd ? "range-end" : "",
      inPreview ? "preview" : "",
    ].filter(Boolean).join(" ");
    return `<button class="${classes}" type="button" data-range-date="${escapeHtml(value)}" ${disabled ? "disabled" : ""}>${date.getDate()}</button>`;
  }).join("");
}

function dateRangeCalendarMarkup(month, side) {
  const title = `${month.getFullYear()}年 ${month.getMonth() + 1}月`;
  const prevControls = side === "left" ? `
    <button class="date-range-nav" type="button" data-range-nav="1" data-year-offset="-1" aria-label="上一年">«</button>
    <button class="date-range-nav" type="button" data-range-nav="1" data-month-offset="-1" aria-label="上个月">‹</button>
  ` : `<span></span><span></span>`;
  const nextControls = side === "right" ? `
    <button class="date-range-nav" type="button" data-range-nav="1" data-month-offset="1" aria-label="下个月">›</button>
    <button class="date-range-nav" type="button" data-range-nav="1" data-year-offset="1" aria-label="下一年">»</button>
  ` : `<span></span><span></span>`;
  return `
    <div class="date-range-calendar">
      <div class="date-range-calendar-head">
        ${prevControls}
        <div class="date-range-calendar-title">${escapeHtml(title)}</div>
        ${nextControls}
      </div>
      <div class="date-range-weekdays" aria-hidden="true">
        <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
      </div>
      <div class="date-range-grid">
        ${dateRangeCalendarCells(month)}
      </div>
    </div>
  `;
}

function positionDateRangePickerPanel() {
  if (!activeDateRangePicker?.wrapper || !dateRangePickerEl || dateRangePickerEl.hidden) return;
  const trigger = activeDateRangePicker.wrapper.querySelector(".date-range-trigger");
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(780, window.innerWidth - 16);
  dateRangePickerEl.style.width = `${width}px`;
  dateRangePickerEl.style.left = "8px";
  dateRangePickerEl.style.top = "8px";
  const panelRect = dateRangePickerEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - panelRect.width - 8));
  let top = rect.bottom + 8;
  if (top + panelRect.height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - panelRect.height - 8);
  }
  dateRangePickerEl.style.left = `${left}px`;
  dateRangePickerEl.style.top = `${top}px`;
}

function renderDateRangePickerPanel() {
  const state = activeDateRangePicker;
  if (!state) return;
  const picker = ensureDateRangePicker();
  const rightMonth = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
  const hint = state.anchor
    ? (state.pending === "end" ? "请选择结束日期" : "请选择开始日期")
    : (state.pending === "start" ? "先选择结束日期" : "先选择开始日期");
  const presets = [
    ["current-month", "本月"],
    ["current-week", "本周"],
    ["prev-month", "上月"],
    ["prev-week", "上周"],
    ["last-3-months", "近三个月"],
    ["last-year", "近一年"],
    ["prev-year", "去年"],
    ["current-year", "今年"],
  ];
  picker.innerHTML = `
    <div class="date-range-presets">
      ${presets.map(([key, label]) => `<button class="date-range-preset" type="button" data-range-preset="${key}">${escapeHtml(label)}</button>`).join("")}
    </div>
    <div class="date-range-calendars">
      <div class="date-range-hint">${escapeHtml(hint)}</div>
      <div class="date-range-calendar-grid">
        ${dateRangeCalendarMarkup(state.month, "left")}
        ${dateRangeCalendarMarkup(rightMonth, "right")}
      </div>
    </div>
  `;
  picker.hidden = false;
  requestAnimationFrame(positionDateRangePickerPanel);
}

async function handleDateRangeDayClick(value) {
  const state = activeDateRangePicker;
  if (!state || !isDateValue(value)) return;
  if (!state.anchor) {
    state.anchor = value;
    state.hover = value;
    if (state.pending === "end") state.start = value;
    else state.end = value;
    renderDateRangePickerPanel();
    return;
  }
  const start = value >= state.anchor ? state.anchor : value;
  const end = value >= state.anchor ? value : state.anchor;
  await applyDateRangePickerValue(state.wrapper, start, end);
}

async function applyDateRangePickerValue(wrapper, start, end) {
  if (!wrapper) return;
  wrapper.dataset.start = start || "";
  wrapper.dataset.end = end || "";
  wrapper.classList.toggle("has-value", Boolean(start || end));
  syncDateRangeTriggerText(wrapper, start, end);
  closeDateRangePicker();
  await applyDateRangeToScope(wrapper.dataset.rangeScope || "", start || "", end || "");
}

async function clearDateRangePickerValue(wrapper) {
  if (!wrapper) return;
  closeDateRangePicker();
  await applyDateRangeToScope(wrapper.dataset.rangeScope || "", "", "");
}

async function applyDateRangeToScope(scope, start, end) {
  if (scope === "lesson") {
    focusedLessonIds = [];
    lessonFilter = { ...lessonFilter, start_date: start, end_date: end, date_preset_initialized: true };
    saveLessonFilter();
    if (!lessonRangeLoaded()) await loadLessonRangeOnly();
    render();
    return;
  }
  if (scope === "fee-details") {
    feeDetailsFilter = { ...feeDetailsFilter, start, end };
    render();
    return;
  }
  if (scope === "matrix") {
    const fallback = currentMatrixRange(state?.settings?.month_key || activeMonth);
    matrixRange = {
      month_key: state?.settings?.month_key || activeMonth,
      start: start || fallback.start,
      end: end || fallback.end,
    };
    localStorage.setItem(MATRIX_RANGE_USER_SET_KEY, "1");
    saveMatrixRange();
    await load();
    return;
  }
  if (scope === "course-notice") {
    const fallback = currentWeekRange();
    courseNoticeFilter = { ...courseNoticeFilter, start: start || fallback.start, end: end || fallback.end };
    ensureCourseNoticeFilterDates();
    saveCourseNoticeFilter();
    await loadCourseNoticeData(true);
    return;
  }
  if (scope === "teacher-course-notice") {
    const fallback = currentWeekRange();
    teacherCourseNoticeFilter = { ...teacherCourseNoticeFilter, start: start || fallback.start, end: end || fallback.end };
    ensureTeacherCourseNoticeFilterDates();
    saveTeacherCourseNoticeFilter();
    await loadTeacherCourseNoticeData(true);
    return;
  }
  if (scope === "student-query") {
    studentQueryRange = start && end ? { ...studentQueryRange, mode: "range", start, end } : { ...studentQueryRange, mode: "all", start: "", end: "" };
    saveStudentQueryRange();
    await refreshStudentQueryOnly();
    return;
  }
  if (scope === "finance") {
    if (start && end) financeRange = { ...financeRange, start, end, preset: "custom" };
    else financeRange = monthScopedFinanceRange("month");
    saveFinanceRange();
    state.finance = await request(`/api/finance-summary?${financeRangeQuery()}`);
    render();
    return;
  }
  if (scope === "expenses") {
    expenseFilter = { ...expenseFilter, start, end };
    localStorage.setItem("liming:expense-filter", JSON.stringify(expenseFilter));
    await load();
    return;
  }
  if (scope === "operation-logs") {
    operationLogFilter = { ...operationLogFilter, start_date: start, end_date: end };
    operationLogPage = 1;
    await renderOperationLogs();
    return;
  }
  if (scope === "dashboard") {
    const fallback = currentWeekRange();
    const next = { start: start || fallback.start, end: end || fallback.end };
    if (!isDateValue(next.start) || !isDateValue(next.end) || next.start > next.end) return;
    dashboardRange = next;
    localStorage.setItem(DASHBOARD_RANGE_KEY, JSON.stringify(dashboardRange));
    await load({ refreshGlobal: false });
  }
}

function readCourseNoticeFilter() {
  return readNoticeFilter(COURSE_NOTICE_FILTER_KEY);
}

function readTeacherCourseNoticeFilter() {
  return readNoticeFilter(TEACHER_COURSE_NOTICE_FILTER_KEY);
}

function saveCourseNoticeFilter() {
  localStorage.setItem(COURSE_NOTICE_FILTER_KEY, JSON.stringify(courseNoticeFilter));
}

function courseNoticeQuery() {
  const params = new URLSearchParams();
  params.set("start", courseNoticeFilter.start);
  params.set("end", courseNoticeFilter.end);
  if (courseNoticeFilter.onlyTeaching) params.set("only_teaching", "1");
  return params.toString();
}

function ensureCourseNoticeFilterDates() {
  const fallback = currentWeekRange();
  if (!isDateValue(courseNoticeFilter.start)) courseNoticeFilter.start = fallback.start;
  if (!isDateValue(courseNoticeFilter.end)) courseNoticeFilter.end = fallback.end;
  if (courseNoticeFilter.start > courseNoticeFilter.end) courseNoticeFilter.end = courseNoticeFilter.start;
}

function resetCourseNoticeFilterToThisWeek() {
  const onlyTeaching = courseNoticeFilter.onlyTeaching !== false;
  courseNoticeFilter = { ...currentWeekRange(), onlyTeaching };
  saveCourseNoticeFilter();
  courseNoticeState = { data: null, busy: false, error: "", loadedQuery: "" };
}

async function loadCourseNoticeData(force = false) {
  ensureCourseNoticeFilterDates();
  const query = courseNoticeQuery();
  if (!force && courseNoticeState.loadedQuery === query && courseNoticeState.data) return;
  courseNoticeState = { ...courseNoticeState, busy: true, error: "" };
  render();
  try {
    const data = await request(`/api/course-notice?${query}`);
    courseNoticeState = { data, busy: false, error: "", loadedQuery: query };
  } catch (error) {
    courseNoticeState = { data: null, busy: false, error: error.message, loadedQuery: query };
  }
  render();
}

function saveTeacherCourseNoticeFilter() {
  localStorage.setItem(TEACHER_COURSE_NOTICE_FILTER_KEY, JSON.stringify(teacherCourseNoticeFilter));
}

function teacherCourseNoticeQuery() {
  const params = new URLSearchParams();
  params.set("start", teacherCourseNoticeFilter.start);
  params.set("end", teacherCourseNoticeFilter.end);
  if (teacherCourseNoticeFilter.onlyTeaching) params.set("only_teaching", "1");
  return params.toString();
}

function ensureTeacherCourseNoticeFilterDates() {
  const fallback = currentWeekRange();
  if (!isDateValue(teacherCourseNoticeFilter.start)) teacherCourseNoticeFilter.start = fallback.start;
  if (!isDateValue(teacherCourseNoticeFilter.end)) teacherCourseNoticeFilter.end = fallback.end;
  if (teacherCourseNoticeFilter.start > teacherCourseNoticeFilter.end) teacherCourseNoticeFilter.end = teacherCourseNoticeFilter.start;
}

function resetTeacherCourseNoticeFilterToThisWeek() {
  const onlyTeaching = teacherCourseNoticeFilter.onlyTeaching !== false;
  teacherCourseNoticeFilter = { ...currentWeekRange(), onlyTeaching };
  saveTeacherCourseNoticeFilter();
  teacherCourseNoticeState = { data: null, busy: false, error: "", loadedQuery: "" };
}

async function loadTeacherCourseNoticeData(force = false) {
  ensureTeacherCourseNoticeFilterDates();
  const query = teacherCourseNoticeQuery();
  if (!force && teacherCourseNoticeState.loadedQuery === query && teacherCourseNoticeState.data) return;
  teacherCourseNoticeState = { ...teacherCourseNoticeState, busy: true, error: "" };
  render();
  try {
    const data = await request(`/api/teacher-course-notice?${query}`);
    teacherCourseNoticeState = { data, busy: false, error: "", loadedQuery: query };
  } catch (error) {
    teacherCourseNoticeState = { data: null, busy: false, error: error.message, loadedQuery: query };
  }
  render();
}

function percent(value) {
  return Number(value || 0).toLocaleString("zh-CN", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function momLabel(value) {
  if (value == null) return "无上月";
  const arrow = value >= 0 ? "▲" : "▼";
  const signed = `${arrow}${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
  return signed;
}

function momPointLabel(value) {
  if (value == null) return "无上月";
  const arrow = value >= 0 ? "▲" : "▼";
  return `${arrow}${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}pp`;
}

function momClass(value, reverse = false) {
  if (value == null || value === 0) return "flat";
  const good = reverse ? value < 0 : value > 0;
  return good ? "up" : "down";
}

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function splitStudents(value) {
  return String(value || "")
    .split(/[、,，;；\n\r]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function optionalNumberValue(value) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function currencyInputMarkup(value, { className = "", attrs = "", inputValue = null } = {}) {
  const n = numberValue(value);
  const classes = ["currency-input-wrap", n < 0 ? "negative" : ""].filter(Boolean).join(" ");
  return `
    <span class="${classes}">
      <span class="currency-display">${formatMoney(n)}</span>
      <input class="cell-input number currency-input ${className}" type="number" value="${escapeHtml(inputValue ?? moneyInput(n))}" ${attrs}>
    </span>
  `;
}

function normalizedTeacherSalaryStudentNames(value) {
  return uniqueSorted(splitStudents(value).map((name) => name.replace(/\s+/g, "")).filter(Boolean)).join("、");
}

function teacherSalaryRuleKey(row) {
  return [
    String(row.teacher_name || "").trim(),
    String(row.grade || "").trim(),
    String(row.subject || "").trim(),
    normalizedTeacherSalaryStudentNames(row.student_names),
  ].join("\u0001");
}

function activeTeacherSalaryRuleForLesson(lesson) {
  const key = teacherSalaryRuleKey(lesson);
  if (key.split("\u0001").some((value) => !value)) return null;
  return (state?.teacher_salary_rules || []).find((rule) => teacherSalaryRuleKey(rule) === key) || null;
}

function teacherSalaryTimeTokenMinutes(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function teacherSalaryLessonHours(timeSlot) {
  const raw = String(timeSlot || "")
    .replaceAll("：", ":")
    .replace(/[—–－~～至到]/g, "-")
    .replace(/\s+/g, "");
  const parts = raw.split("-").filter(Boolean);
  if (parts.length < 2) return null;
  const start = teacherSalaryTimeTokenMinutes(parts[0]);
  const end = teacherSalaryTimeTokenMinutes(parts[1]);
  if (start == null || end == null || end <= start) return null;
  return (end - start) / 60;
}

function teacherSalaryRuleCalculation(lesson) {
  if (!isCompletedLesson(lesson)) return null;
  const rule = activeTeacherSalaryRuleForLesson(lesson);
  if (!rule) return null;
  const salaryPerUnit = optionalNumberValue(rule.salary_per_unit);
  if (salaryPerUnit == null || salaryPerUnit <= 0) return null;
  const unitHours = optionalNumberValue(rule.unit_hours);
  const divisor = unitHours != null && unitHours > 0 ? unitHours : 2;
  const lessonHours = teacherSalaryLessonHours(lesson.time_slot);
  const lessonUnits = lessonHours == null ? 1 : lessonHours / divisor;
  return {
    rule,
    salary: Math.round((salaryPerUnit * lessonUnits + Number.EPSILON) * 100) / 100,
    warning: lessonHours == null ? "无法识别时长，按 1 课时计算" : "",
  };
}

function displayTeacherSalaryForLesson(lesson) {
  return isCompletedLesson(lesson) ? numberValue(lesson.teacher_salary) : 0;
}

function displayTeacherRuleSalaryForLesson(lesson) {
  if (!isCompletedLesson(lesson)) return 0;
  const calculated = teacherSalaryRuleCalculation(lesson);
  return calculated ? calculated.salary : 0;
}

function teacherSalarySourceLabel(lesson) {
  if (!isCompletedLesson(lesson)) return "自动";
  const calculated = teacherSalaryRuleCalculation(lesson);
  const ruleSalary = calculated ? calculated.salary : 0;
  const current = displayTeacherSalaryForLesson(lesson);
  if (ruleSalary <= 0) return current === 0 ? "未设置" : "手动";
  return Math.abs(current - ruleSalary) < 0.005 ? "自动" : "手动";
}

function teacherSalarySourceTitle(lesson) {
  if (!isCompletedLesson(lesson)) return "非已上课程教师薪资自动按 0 处理";
  const label = teacherSalarySourceLabel(lesson);
  const amount = formatMoney(displayTeacherSalaryForLesson(lesson));
  const ruleSalary = displayTeacherRuleSalaryForLesson(lesson);
  const rule = `，规则薪资 ${formatMoney(ruleSalary)}`;
  if (label === "未设置") return "已上课程未设置有效课时明细规则";
  if (label === "手动") return `当前薪资 ${amount}${rule}，与规则不一致，视为手动`;
  return `系统自动薪资 ${amount}${rule}`;
}

function teacherSalarySourceBadge(lesson) {
  return sourceStatusBadge(teacherSalarySourceLabel(lesson), teacherSalarySourceTitle(lesson));
}

function teacherSalaryRuleDisableReason(lesson) {
  if (!isCompletedLesson(lesson)) return "非已上课程薪资自动按 0 处理";
  const rule = activeTeacherSalaryRuleForLesson(lesson);
  if (!rule) return "未设置有效课时明细规则";
  return "未设置有效薪资金额";
}

function teacherSalaryRuleStatusForLesson(lesson) {
  if (!isCompletedLesson(lesson)) return "非已上";
  if (teacherSalaryRuleCalculation(lesson)) return "有有效规则";
  return "未设置";
}

function teacherDetailMatchesFilter(row, filter = teacherDetailFilter) {
  if (filter.grade && !textContains(row.grade, filter.grade)) return false;
  if (filter.subject && !textContains(row.subject, filter.subject)) return false;
  if (filter.student) {
    const needle = String(filter.student || "").trim().toLowerCase();
    if (!splitStudents(row.student_names).some((name) => name.toLowerCase().includes(needle))) return false;
  }
  if (filter.source && !textContains(teacherSalarySourceLabel(row), filter.source)) return false;
  if (filter.rule_status && !textContains(teacherSalaryRuleStatusForLesson(row), filter.rule_status)) return false;
  return true;
}

function dynamicTeacherDetailFilterOptions(rows, filter = teacherDetailFilter) {
  return {
    grades: uniqueSorted(rowsForFilterOption(rows, filter, "grade", teacherDetailMatchesFilter).map((row) => row.grade)),
    subjects: uniqueSorted(rowsForFilterOption(rows, filter, "subject", teacherDetailMatchesFilter).map((row) => row.subject)),
    students: uniqueSorted(rowsForFilterOption(rows, filter, "student", teacherDetailMatchesFilter).flatMap((row) => splitStudents(row.student_names))),
    sources: uniqueSorted(rowsForFilterOption(rows, filter, "source", teacherDetailMatchesFilter).map((row) => teacherSalarySourceLabel(row))),
    ruleStatuses: uniqueSorted(rowsForFilterOption(rows, filter, "rule_status", teacherDetailMatchesFilter).map((row) => teacherSalaryRuleStatusForLesson(row))),
  };
}

function teacherSalaryInputValue(value) {
  const n = optionalNumberValue(value);
  return n === null ? "" : n.toFixed(2);
}

function teacherSalaryRuleSalaryStatus(rule) {
  return optionalNumberValue(rule.salary_per_unit) > 0 ? "已设置" : "待设置";
}

function teacherSalaryRuleMatchesFilter(rule, filter = teacherSalaryRuleFilter) {
  if (filter.teacher && !textContains(rule.teacher_name, filter.teacher)) return false;
  if (filter.grade && !textContains(rule.grade, filter.grade)) return false;
  if (filter.subject && !textContains(rule.subject, filter.subject)) return false;
  if (filter.student && !textContains(rule.student_names, filter.student)) return false;
  if (filter.salary_status && teacherSalaryRuleSalaryStatus(rule) !== filter.salary_status) return false;
  return true;
}

function dynamicTeacherSalaryRuleFilterOptions(rules, filter = teacherSalaryRuleFilter) {
  return {
    teachers: uniqueSorted(rowsForFilterOption(rules, filter, "teacher", teacherSalaryRuleMatchesFilter).map((rule) => rule.teacher_name)),
    grades: uniqueSorted(rowsForFilterOption(rules, filter, "grade", teacherSalaryRuleMatchesFilter).map((rule) => rule.grade)),
    subjects: uniqueSorted(rowsForFilterOption(rules, filter, "subject", teacherSalaryRuleMatchesFilter).map((rule) => rule.subject)),
    students: uniqueSorted(rowsForFilterOption(rules, filter, "student", teacherSalaryRuleMatchesFilter).flatMap((rule) => splitStudents(rule.student_names))),
    salaryStatuses: uniqueSorted(rowsForFilterOption(rules, filter, "salary_status", teacherSalaryRuleMatchesFilter).map((rule) => teacherSalaryRuleSalaryStatus(rule))),
  };
}

function sortTeacherSalaryRules(rules) {
  return [...rules].sort((a, b) => (
    String(a.teacher_name || "").localeCompare(String(b.teacher_name || ""), "zh-Hans-CN")
    || compareGradeForSort(a.grade, b.grade)
    || String(a.subject || "").localeCompare(String(b.subject || ""), "zh-Hans-CN")
    || String(a.student_names || "").localeCompare(String(b.student_names || ""), "zh-Hans-CN")
    || Number(a.id || 0) - Number(b.id || 0)
  ));
}

function compareGradeForSort(a, b) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  const leftIndex = gradeSortOrder.indexOf(left);
  const rightIndex = gradeSortOrder.indexOf(right);
  if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex;
  if (leftIndex !== -1) return -1;
  if (rightIndex !== -1) return 1;
  return left.localeCompare(right, "zh-Hans-CN");
}

function compareStudentGradeName(a = {}, b = {}) {
  return compareGradeForSort(a.grade, b.grade)
    || String(a.student_name || a.name || "").localeCompare(String(b.student_name || b.name || ""), "zh-Hans-CN")
    || Number(a.id || 0) - Number(b.id || 0);
}

function compareStudentPricingRule(a = {}, b = {}) {
  return compareGradeForSort(a.grade, b.grade)
    || String(a.student_name || "").localeCompare(String(b.student_name || ""), "zh-Hans-CN")
    || String(a.subject || "").localeCompare(String(b.subject || ""), "zh-Hans-CN")
    || String(a.student_names || "").localeCompare(String(b.student_names || ""), "zh-Hans-CN")
    || Number(a.id || 0) - Number(b.id || 0);
}

function compareTeacherProfile(a = {}, b = {}) {
  const statusRank = (status) => ({ 在职: 0, 离职: 2 }[String(status || "")] ?? 1);
  return statusRank(a.status) - statusRank(b.status)
    || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN")
    || Number(a.id || 0) - Number(b.id || 0);
}

function compareUserRow(a = {}, b = {}) {
  const roleRank = (role) => ({ owner: 0, boss: 0, admin: 1, academic: 2, jiaowu: 2, finance: 3 }[String(role || "")] ?? 4);
  return roleRank(a.role) - roleRank(b.role)
    || String(a.display_name || "").localeCompare(String(b.display_name || ""), "zh-Hans-CN")
    || String(a.username || "").localeCompare(String(b.username || ""), "zh-Hans-CN")
    || Number(a.id || 0) - Number(b.id || 0);
}

function teacherSalaryRuleDisplayNotes(rule) {
  const notes = String(rule.notes || "");
  return notes.startsWith("自动候选：请填写每2小时薪资") ? "" : notes;
}

function resetTeacherSalaryRuleCandidateSync() {
  teacherSalaryRuleCandidateSync = { requested: false, busy: false, result: null, error: "" };
}

async function syncTeacherSalaryRuleCandidatesOnEntry() {
  if (!state || !canArea("salary")) return;
  try {
    const result = await request("/api/teacher-salary-rules/sync-candidates", { method: "POST" });
    const rules = await request("/api/teacher-salary-rules");
    if (state) state.teacher_salary_rules = rules.rules || [];
    teacherSalaryRuleCandidateSync = { requested: true, busy: false, result, error: "" };
  } catch (error) {
    teacherSalaryRuleCandidateSync = { requested: true, busy: false, result: null, error: error.message || "同步课时明细候选失败" };
  }
  if (view === "teacherSalaryRules") render();
}

function queueTeacherSalaryRuleCandidateSync() {
  if (!state || !canArea("salary")) return;
  if (teacherSalaryRuleCandidateSync.requested || teacherSalaryRuleCandidateSync.busy) return;
  teacherSalaryRuleCandidateSync = { requested: true, busy: true, result: null, error: "" };
  setTimeout(() => syncTeacherSalaryRuleCandidatesOnEntry(), 0);
}

function weekdayCn(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
}

function monthLabel() {
  const value = state?.settings?.month_key || "2026-04-01";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "当前月份";
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function monthLabelShort(value = state?.settings?.month_key || activeMonth) {
  const date = new Date(`${value || "2026-04-01"}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "本月";
  return `${date.getMonth() + 1}月`;
}

function formatMonthOption(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value || "未设置";
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function monthOptionShort(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value || "";
  return `${date.getMonth() + 1} 月`;
}

function normalizeMonthInput(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return "";
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function previousMonth(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  const prev = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-01`;
}

function offsetMonth(value, offset) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  const target = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthBounds(monthKey) {
  const date = new Date(`${monthKey || activeMonth || "2026-04-01"}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { start: "", end: "" };
  const year = date.getFullYear();
  const month = date.getMonth();
  const end = new Date(year, month + 1, 0);
  return {
    start: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    end: `${year}-${String(month + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`,
  };
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(value, offset) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + offset);
  return dateKey(date);
}

function startOfWeek(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return dateKey(date);
}

function monthWeeksBySunday(monthKey) {
  const date = new Date(`${monthKey || activeMonth || state?.settings?.month_key || ""}T00:00:00`);
  if (Number.isNaN(date.getTime())) return [];
  const targetMonth = date.getMonth();
  const sunday = new Date(date.getFullYear(), date.getMonth(), 1);
  while (sunday.getDay() !== 0) sunday.setDate(sunday.getDate() + 1);
  const weeks = [];
  while (sunday.getMonth() === targetMonth) {
    const end = dateKey(sunday);
    const start = addDays(end, -6);
    const index = weeks.length + 1;
    weeks.push({
      week_index: index,
      index,
      week_start: start,
      week_end: end,
      start,
      end,
      label: `第${index}周车票(${start}~${end})`,
    });
    sunday.setDate(sunday.getDate() + 7);
  }
  return weeks;
}

function weekDates(start) {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index)).filter(Boolean);
}

function dateRangeDates(start, end) {
  const startDate = parseDateValue(start);
  const endDate = parseDateValue(end);
  if (!startDate || !endDate || start > end) return [];
  const dates = [];
  for (const cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(dateKey(cursor));
  }
  return dates;
}

function naturalWeekRanges(monthKey = activeMonth) {
  const bounds = monthBounds(monthKey);
  const monthStart = parseDateValue(bounds.start);
  const monthEnd = parseDateValue(bounds.end);
  if (!monthStart || !monthEnd) return [];
  const cursor = parseDateValue(startOfWeek(bounds.start));
  const ranges = [];
  while (cursor && cursor <= monthEnd) {
    const start = dateKey(cursor);
    const end = addDays(start, 6);
    const endDate = parseDateValue(end);
    ranges.push({
      start_date: start,
      end_date: end,
      label: `${cursor.getMonth() + 1}.${cursor.getDate()}-${endDate.getMonth() + 1}.${endDate.getDate()}`,
      includes(value) {
        return value >= start && value <= end;
      },
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  return ranges;
}

function naturalWeekSpan(monthKey = activeMonth) {
  const ranges = naturalWeekRanges(monthKey);
  if (!ranges.length) return null;
  return {
    start: ranges[0].start_date,
    end: ranges[ranges.length - 1].end_date,
  };
}

function allDataRange() {
  const sorted = [...months].sort((a, b) => a.localeCompare(b));
  if (!sorted.length) return monthBounds(activeMonth);
  return { start: sorted[0], end: monthBounds(sorted[sorted.length - 1]).end };
}

function currentStudentQueryRange() {
  if (studentQueryRange.mode === "range" && studentQueryRange.start && studentQueryRange.end) {
    return { start: studentQueryRange.start, end: studentQueryRange.end };
  }
  return allDataRange();
}

function studentStatementQueryString() {
  const range = currentStudentQueryRange();
  const params = new URLSearchParams();
  if (range.start) params.set("start", range.start);
  if (range.end) params.set("end", range.end);
  return params.toString();
}

async function loadStudentStatement() {
  state.student_statement = selectedStudent
    ? await request(`/api/student/${encodeURIComponent(selectedStudent)}/statement?${studentStatementQueryString()}`)
    : null;
}

async function refreshStudentQueryOnly() {
  state.student_history = selectedStudent
    ? ((await request(`/api/student/${encodeURIComponent(selectedStudent)}/history`)).history || [])
    : [];
  await loadStudentStatement();
  render();
}

async function applyStudentQuerySelection(value) {
  const next = String(value || "").trim();
  selectedStudent = next;
  studentQueryNameDraft = next;
  studentStatementModalOpen = false;
  await refreshStudentQueryOnly();
}

function readMatrixRange() {
  try {
    if (localStorage.getItem(MATRIX_RANGE_USER_SET_KEY) === "1") {
      const saved = { month_key: "", start: "", end: "", ...JSON.parse(localStorage.getItem(MATRIX_RANGE_KEY) || "{}") };
      if (isDateValue(saved.start) && isDateValue(saved.end) && saved.start <= saved.end) return saved;
    }
  } catch {
  }
  return currentMatrixRange(localStorage.getItem("liming:month") || todayDate().slice(0, 7));
}

function saveMatrixRange() {
  localStorage.setItem(MATRIX_RANGE_KEY, JSON.stringify(matrixRange));
}

function matrixDefaultRange(monthKey = activeMonth) {
  const ranges = naturalWeekRanges(monthKey);
  const index = Math.min(Math.max(activeWeek, 0), Math.max(0, ranges.length - 1));
  const range = ranges[index] || ranges[0];
  const bounds = monthBounds(monthKey);
  return {
    month_key: monthKey,
    start: range?.start_date || bounds.start,
    end: range?.end_date || bounds.end,
  };
}

function currentMatrixRange(monthKey = activeMonth) {
  const week = currentWeekRange();
  return {
    month_key: monthKey,
    start: week.start,
    end: week.end,
  };
}

function ensureMatrixRange() {
  const monthKey = state?.settings?.month_key || activeMonth;
  if (!isDateValue(matrixRange.start) || !isDateValue(matrixRange.end) || matrixRange.start > matrixRange.end) {
    matrixRange = currentMatrixRange(monthKey);
    saveMatrixRange();
    return;
  }
  if (matrixRange.month_key !== monthKey) {
    matrixRange = { ...matrixRange, month_key: monthKey };
    saveMatrixRange();
  }
}

function readFinanceRange() {
  try {
    return { start: "", end: "", preset: "month", ...JSON.parse(localStorage.getItem(FINANCE_RANGE_KEY) || "{}") };
  } catch {
    return { start: "", end: "", preset: "month" };
  }
}

function readStudentQueryRange() {
  try {
    return { mode: "all", start: "", end: "", ...JSON.parse(localStorage.getItem(STUDENT_QUERY_RANGE_KEY) || "{}") };
  } catch {
    return { mode: "all", start: "", end: "" };
  }
}

function saveStudentQueryRange() {
  localStorage.setItem(STUDENT_QUERY_RANGE_KEY, JSON.stringify(studentQueryRange));
}

function isDateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

function saveFinanceRange() {
  localStorage.setItem(FINANCE_RANGE_KEY, JSON.stringify(financeRange));
}

function financeRangeMatches(a, b) {
  return a?.start === b?.start && a?.end === b?.end;
}

function monthScopedFinanceRange(preset = "month") {
  const range = preset === "prev-month"
    ? monthBounds(previousMonth(activeMonth))
    : monthBounds(activeMonth);
  return { ...range, preset, anchor_month: activeMonth };
}

function resetFinanceRangeToActiveMonth() {
  financeRange = monthScopedFinanceRange("month");
  saveFinanceRange();
}

function ensureFinanceRangeDates() {
  const validRange = isDateValue(financeRange.start) && isDateValue(financeRange.end) && financeRange.start <= financeRange.end;
  if ((financeRange.preset === "month" || financeRange.preset === "prev-month") && activeMonth) {
    const expected = monthScopedFinanceRange(financeRange.preset);
    if (
      validRange
      && financeRange.anchor_month === activeMonth
      && financeRangeMatches(financeRange, expected)
    ) {
      return;
    }
    financeRange = expected;
    saveFinanceRange();
    return;
  }
  if (validRange) return;
  financeRange = monthScopedFinanceRange("month");
  saveFinanceRange();
}

function financeRangeQuery() {
  ensureFinanceRangeDates();
  const params = new URLSearchParams();
  params.set("start", financeRange.start);
  params.set("end", financeRange.end);
  return params.toString();
}

function semesterBounds() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month <= 2) return { start: `${year}-01-01`, end: monthBounds(`${year}-02-01`).end };
  if (month <= 6) return { start: `${year}-03-01`, end: monthBounds(`${year}-06-01`).end };
  if (month <= 8) return { start: `${year}-07-01`, end: monthBounds(`${year}-08-01`).end };
  return { start: `${year}-09-01`, end: monthBounds(`${year}-12-01`).end };
}

function financePresetRange(preset) {
  if (preset === "month" || preset === "prev-month") return monthScopedFinanceRange(preset);
  if (preset === "30d") {
    const end = todayDate();
    return { start: addDays(end, -29), end, preset };
  }
  if (preset === "90d") {
    const end = todayDate();
    return { start: addDays(end, -89), end, preset };
  }
  if (preset === "semester") return { ...semesterBounds(), preset };
  if (preset === "all") {
    const available = state?.finance?.available_range || {};
    const start = available.start || (months.length ? months[months.length - 1] : activeMonth);
    const end = available.end || monthBounds(months[0] || activeMonth).end;
    return { start, end, preset };
  }
  return { ...financeRange, preset: "custom" };
}

function defaultLessonFilter() {
  return { month_key: "", teacher: "", teacher_names: [], student: "", start_date: "", end_date: "", status: "", classroom: "", grade: "", subject: "", query: "", date_preset_initialized: false };
}

function readLessonFilter() {
  const defaults = defaultLessonFilter();
  try {
    const parsed = { ...defaults, ...JSON.parse(localStorage.getItem(LESSON_FILTER_KEY) || "{}") };
    parsed.teacher_names = normalizeNameList(parsed.teacher_names || (parsed.teacher ? [parsed.teacher] : []));
    return parsed;
  } catch {
    return defaults;
  }
}

function saveLessonFilter() {
  localStorage.setItem(LESSON_FILTER_KEY, JSON.stringify(lessonFilter));
}

function userFilterPreset(viewKey) {
  const presets = auth.user?.filter_presets || {};
  const preset = presets?.[viewKey];
  return preset && typeof preset === "object" && !Array.isArray(preset) ? preset : null;
}

function rolePrefilterDateRange(viewKey = view) {
  const preset = userFilterPreset(viewKey) || {};
  return {
    start: isDateValue(preset.start_date) ? preset.start_date : "",
    end: isDateValue(preset.end_date) ? preset.end_date : "",
  };
}

function lessonDataViewKey(viewKey = view) {
  return ["lessons", "week", "weekMatrix", "teacherDetail"].includes(viewKey) ? viewKey : "lessons";
}

function lessonsRangeUrl(range, viewKey = lessonDataViewKey()) {
  const params = new URLSearchParams();
  params.set("start", range.start);
  params.set("end", range.end);
  params.set("view", viewKey);
  return `/api/lessons-range?${params.toString()}`;
}

function applyUserFilterPreset(viewKey) {
  appliedUserFilterPresetViews.add(viewKey);
  // 角色预筛选是隐形基础数据池，不再写入用户可见筛选框。
  return false;
}

function readExpandedSummaryStudents() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SUMMARY_EXPAND_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveExpandedSummaryStudents() {
  localStorage.setItem(SUMMARY_EXPAND_KEY, JSON.stringify([...expandedSummaryStudents]));
}

function ensureExpenseFilterDates() {
  const monthKey = state?.settings?.month_key || activeMonth;
  const bounds = monthBounds(monthKey);
  if (expenseFilter.month_key !== monthKey || !expenseFilter.start || !expenseFilter.end) {
    expenseFilter = { ...expenseFilter, month_key: monthKey, start: bounds.start, end: bounds.end };
    localStorage.setItem("liming:expense-filter", JSON.stringify(expenseFilter));
  }
}

function rechargeSource(row) {
  return row.source || state.recharges.find((item) => item.student_name === row.student_name)?.source || "";
}

function rechargeSourceTag(source) {
  if (source === "carry_over") return `<span class="source-tag" title="该行由上月余额自动结转">结转</span>`;
  return "";
}

function isRealRechargeRow(row) {
  return numberValue(row?.cur_recharge) !== 0 || numberValue(row?.cur_gift) !== 0;
}

function studentProfileByName(name) {
  return (state.profile_students || []).find((row) => row.name === name) || null;
}

function rechargeRows() {
  return [...(state.recharges || [])]
    .filter(isRealRechargeRow)
    .map((row) => {
      const profile = studentProfileByName(row.student_name);
      return {
        ...row,
        grade: row.grade || profile?.grade || "",
        status: profile?.status || "在读",
        recharge_notes: row.notes || "",
      };
    })
    .sort((a, b) => compareStudentGradeName(a, b)
      || String(a.recharge_date || "").localeCompare(String(b.recharge_date || ""))
      || Number(a.id || 0) - Number(b.id || 0));
}

function defaultRechargeDate() {
  const monthKey = state?.settings?.month_key || activeMonth;
  const today = todayDate();
  if (today.slice(0, 7) === String(monthKey || "").slice(0, 7)) return today;
  return monthBounds(monthKey).start;
}

function rechargeModalMarkup() {
  if (!rechargeModalOpen) return "";
  const students = uniqueSorted((state.profile_students || []).map((row) => row.name).filter(Boolean));
  const grades = uniqueSorted([...gradeOrder, ...usedLessonLookupValues("grades")]);
  return `
    <div class="modal-backdrop recharge-modal">
      <div class="modal-panel recharge-modal-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">新增充值记录</div>
            <div class="modal-subtitle">${escapeHtml(formatMonthOption(state?.settings?.month_key || activeMonth))}</div>
          </div>
          <button class="btn recharge-modal-cancel" type="button">取消</button>
        </div>
        <div class="lesson-create-form recharge-form-grid">
          <label>学生姓名${filterComboControl({ id: "new-recharge-student", className: "recharge-modal-field", field: "student_name", value: "", values: students, placeholder: "输入或选择学生", emptyLabel: "" })}</label>
          <label>年级${filterComboControl({ id: "new-recharge-grade", className: "recharge-modal-field", field: "grade", value: "", values: grades, placeholder: "输入或选择年级", emptyLabel: "" })}</label>
          <label>充值日期<input id="new-recharge-date" class="control recharge-modal-field" data-field="recharge_date" type="date" value="${escapeHtml(defaultRechargeDate())}"></label>
          <label>现金充值<input id="new-recharge-cur" class="control recharge-modal-field" data-field="cur_recharge" type="number" step="0.01" value="0"></label>
          <label>赠送充值<input id="new-recharge-gift" class="control recharge-modal-field" data-field="cur_gift" type="number" step="0.01" value="0"></label>
          <label>来源 / 渠道<input id="new-recharge-source" class="control recharge-modal-field" data-field="source" placeholder="如现金、微信、支付宝"></label>
          <label class="wide">备注<input id="new-recharge-notes" class="control recharge-modal-field" data-field="notes" placeholder="备注"></label>
        </div>
        <div class="modal-actions">
          <button class="btn recharge-modal-cancel" type="button">取消</button>
          <button class="btn primary add-recharge-record" type="button">保存</button>
        </div>
      </div>
    </div>
  `;
}

function openingBalanceRows() {
  return [...(state.opening_balances || [])]
    .filter((row) => numberValue(row.opening_actual_balance) !== 0 || numberValue(row.opening_gift_balance) !== 0)
    .map((row) => {
      const profile = studentProfileByName(row.student_name);
      return {
        ...row,
        grade: row.grade || profile?.grade || "",
      };
    })
    .sort(compareStudentGradeName);
}

function openingBalanceMatchesFilter(row) {
  if (openingBalanceFilter.student && !row.student_name.toLowerCase().includes(openingBalanceFilter.student.toLowerCase())) return false;
  if (openingBalanceFilter.grade && !textContains(row.grade, openingBalanceFilter.grade)) return false;
  return true;
}

function dynamicOpeningBalanceFilterOptions(rows) {
  const rowsFor = (field) => rowsForFilterOption(rows, openingBalanceFilter, field, (row, filter) => {
    if (field !== "student" && filter.student && !row.student_name.toLowerCase().includes(filter.student.toLowerCase())) return false;
    if (field !== "grade" && filter.grade && !textContains(row.grade, filter.grade)) return false;
    return true;
  });
  return {
    students: uniqueSorted(rowsFor("student").map((row) => row.student_name)),
    grades: uniqueSorted(rowsFor("grade").map((row) => row.grade)),
  };
}

function openingBalanceModalMarkup() {
  if (!openingBalanceModalOpen) return "";
  const students = uniqueSorted((state.profile_students || []).map((row) => row.name).filter(Boolean));
  const grades = uniqueSorted([...gradeOrder, ...usedLessonLookupValues("grades")]);
  return `
    <div class="modal-backdrop opening-balance-modal">
      <div class="modal-panel opening-balance-modal-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">新增期初余额</div>
            <div class="modal-subtitle">全局账户期初余额</div>
          </div>
          <button class="btn opening-balance-modal-cancel" type="button">取消</button>
        </div>
        <div class="lesson-create-form opening-balance-form-grid">
          <label>学生姓名${filterComboControl({ id: "new-opening-student", className: "opening-balance-modal-field", field: "student_name", value: "", values: students, placeholder: "输入或选择学生", emptyLabel: "" })}</label>
          <label>年级${filterComboControl({ id: "new-opening-grade", className: "opening-balance-modal-field", field: "grade", value: "", values: grades, placeholder: "输入或选择年级", emptyLabel: "" })}</label>
          <label>期初实际余额<input id="new-opening-actual" class="control opening-balance-modal-field" data-field="opening_actual_balance" type="number" step="0.01" value="0"></label>
          <label>期初赠送余额<input id="new-opening-gift" class="control opening-balance-modal-field" data-field="opening_gift_balance" type="number" step="0.01" value="0"></label>
          <label class="wide">备注<input id="new-opening-notes" class="control opening-balance-modal-field" data-field="notes" placeholder="如：承接2026年1月底余额"></label>
        </div>
        <div class="modal-actions">
          <button class="btn opening-balance-modal-cancel" type="button">取消</button>
          <button class="btn primary add-opening-balance" type="button">保存</button>
        </div>
      </div>
    </div>
  `;
}

function openingBalanceImportResultMessage(result) {
  const lines = [
    `成功导入 ${result.imported || 0} 条，跳过 ${result.skipped || 0} 条，失败 ${result.failed || 0} 条`,
  ];
  const details = (result.details || []).filter((item) => item.status !== "imported");
  if (details.length) {
    lines.push("", "明细：");
    for (const item of details.slice(0, 30)) {
      const rowLabel = item.row ? `第 ${item.row} 行` : "表头";
      const student = item.student_name ? `（${item.student_name}）` : "";
      lines.push(`${rowLabel}${student}：${item.message || item.status || ""}`);
    }
    if (details.length > 30) lines.push(`……另有 ${details.length - 30} 条明细未显示`);
  }
  return lines.join("\n");
}

function chooseOpeningBalanceImportFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("focus", handleFocus);
      input.remove();
    };
    const finish = (file) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file);
    };
    const handleFocus = () => {
      setTimeout(() => {
        if (!settled && !input.files?.length) finish(null);
      }, 300);
    };
    input.type = "file";
    input.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      finish(input.files?.[0] || null);
    }, { once: true });
    setTimeout(() => window.addEventListener("focus", handleFocus, { once: true }), 0);
    input.click();
  });
}

function monthDeleteModal() {
  if (!monthDeleteDraft) return "";
  const counts = monthDeleteDraft.counts || {};
  const countRows = Object.entries(counts)
    .filter(([, value]) => Number(value || 0) > 0)
    .map(([key, value]) => `<div><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("") || `<div><span>该月份没有业务数据</span><strong>0</strong></div>`;
  return `
    <div class="modal-backdrop month-delete-modal">
      <div class="modal-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">删除 ${escapeHtml(formatMonthOption(monthDeleteDraft.monthKey))}</div>
            <div class="modal-subtitle">删除后会清理该月份的排课、充值和相关月度记录。</div>
          </div>
          <button class="btn month-delete-cancel" type="button">取消</button>
        </div>
        <div class="delete-counts">${countRows}</div>
        <label class="confirm-label">
          输入月份 <strong>${escapeHtml(monthDeleteDraft.monthKey)}</strong> 后确认删除
          <input class="control month-delete-confirm-input" data-month-key="${escapeHtml(monthDeleteDraft.monthKey)}" value="">
        </label>
        <div class="modal-actions">
          <button class="btn danger month-delete-confirm" type="button" data-month-key="${escapeHtml(monthDeleteDraft.monthKey)}" disabled>确认删除</button>
        </div>
      </div>
    </div>
  `;
}

function ensureLessonFilterDates() {
  const monthKey = state?.settings?.month_key || activeMonth;
  const nextFilter = { ...lessonFilter, month_key: monthKey };
  let changed = nextFilter.month_key !== lessonFilter.month_key;
  const teacherNames = normalizeNameList(nextFilter.teacher_names || (nextFilter.teacher ? [nextFilter.teacher] : []));
  if (teacherNames.join("\n") !== normalizeNameList(nextFilter.teacher_names || []).join("\n")) {
    nextFilter.teacher_names = teacherNames;
    nextFilter.teacher = teacherNames.join("、");
    changed = true;
  }
  if (!isDateValue(nextFilter.start_date)) {
    nextFilter.start_date = "";
    changed = true;
  }
  if (!isDateValue(nextFilter.end_date)) {
    nextFilter.end_date = "";
    changed = true;
  }
  if (changed) {
    lessonFilter = nextFilter;
    saveLessonFilter();
  }
}

function lessonLoadRange({ includeActiveMonth = view !== "lessons" } = {}) {
  const bounds = monthBounds(state?.settings?.month_key || activeMonth);
  const prefilterRange = rolePrefilterDateRange(lessonDataViewKey());
  const start = isDateValue(lessonFilter.start_date)
    ? lessonFilter.start_date
    : (prefilterRange.start || (prefilterRange.end && prefilterRange.end < bounds.start ? prefilterRange.end : bounds.start));
  const end = isDateValue(lessonFilter.end_date)
    ? lessonFilter.end_date
    : (prefilterRange.end || (prefilterRange.start && prefilterRange.start > bounds.end ? prefilterRange.start : bounds.end));
  if (!start || !end || start > end) return null;
  // 课程总表的主数据源只由页面内部日期范围决定；顶部全局月份仅用于首次默认值。
  if (!includeActiveMonth) return { start, end };
  return {
    start: start < bounds.start ? start : bounds.start,
    end: end > bounds.end ? end : bounds.end,
  };
}

function lessonRangeLoaded() {
  const desired = lessonLoadRange();
  const loaded = state?.lesson_loaded_range;
  if (!desired || !loaded) return false;
  return loaded.start <= desired.start && loaded.end >= desired.end;
}

async function loadLessonRangeOnly() {
  const range = lessonLoadRange();
  if (!range) return;
  const result = await request(lessonsRangeUrl(range));
  state.lessons = result.lessons || [];
  state.lesson_loaded_range = range;
}

function resetLessonFilter() {
  const monthKey = state?.settings?.month_key || activeMonth;
  lessonFilter = { month_key: monthKey, teacher: "", teacher_names: [], student: "", start_date: "", end_date: "", status: "", classroom: "", grade: "", subject: "", query: "", date_preset_initialized: true };
  saveLessonFilter();
}

function lessonPresetRange(preset) {
  const today = todayDate();
  if (preset === "yesterday" || preset === "today" || preset === "tomorrow") {
    const offset = preset === "yesterday" ? -1 : preset === "tomorrow" ? 1 : 0;
    const date = addDays(today, offset);
    return { start_date: date, end_date: date };
  }
  if (preset === "prev-week" || preset === "next-week") {
    const weekStart = startOfWeek(today);
    const offset = preset === "prev-week" ? -7 : 7;
    const start = addDays(weekStart, offset);
    return { start_date: start, end_date: addDays(start, 6) };
  }
  if (preset === "week") {
    const week = currentWeekRange();
    return { start_date: week.start, end_date: week.end };
  }
  if (preset === "prev-month" || preset === "month" || preset === "next-month") {
    const currentMonth = `${today.slice(0, 7)}-01`;
    const offset = preset === "prev-month" ? -1 : preset === "next-month" ? 1 : 0;
    const bounds = monthBounds(offsetMonth(currentMonth, offset));
    return { start_date: bounds.start, end_date: bounds.end };
  }
  return null;
}

function formatLessonDateRange() {
  const start = lessonFilter.start_date || "";
  const end = lessonFilter.end_date || "";
  if (!start && !end) return "";
  if (start === end) return start;
  return `${start || "未选"} 至 ${end || "未选"}`;
}

function formatShortDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value || "";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function bulkActionText(label, count) {
  return `${label}${count ? `（${count}）` : ""}`;
}

function bulkActionDisabledAttr(count, busy = false) {
  return Number(count) > 0 && !busy ? "" : "disabled";
}

function normalizeNameList(value) {
  const splitValue = (item) => String(item || "").split(/[,，、；;\n\r]+/);
  const raw = Array.isArray(value) ? value.flatMap(splitValue) : splitValue(value);
  return uniqueSorted(raw);
}

function lessonRowsForOption(rows, filter, excludeField, options = {}) {
  const optionFilter = { ...filter, [excludeField]: "" };
  if (excludeField === "teacher") optionFilter.teacher_names = [];
  return rows.filter((row) => lessonMatchesFilter(row, optionFilter, options));
}

function dynamicLessonFilterOptions(rows, filter, options = {}) {
  return {
    teachers: uniqueSorted(lessonRowsForOption(rows, filter, "teacher", options).map((row) => row.teacher_name)),
    students: uniqueSorted(lessonRowsForOption(rows, filter, "student", options).flatMap((row) => splitStudents(row.student_names))),
    statuses: uniqueSorted(lessonRowsForOption(rows, filter, "status", options).map((row) => rowStatus(row))),
    classrooms: uniqueSorted(lessonRowsForOption(rows, filter, "classroom", options).map((row) => row.classroom)),
    grades: uniqueSorted(lessonRowsForOption(rows, filter, "grade", options).map((row) => row.grade)),
    subjects: uniqueSorted(lessonRowsForOption(rows, filter, "subject", options).map((row) => row.subject)),
  };
}

function lessonMatchesFilter(row, filter, options = {}) {
  const { includeDate = true, includeStatus = true, includeQuery = true } = options;
  const teacherNames = normalizeNameList(filter.teacher_names || []);
  if (teacherNames.length && !teacherNames.includes(String(row.teacher_name || "").trim())) return false;
  if (!teacherNames.length && filter.teacher && !textContains(row.teacher_name, filter.teacher)) return false;
  if (filter.student) {
    const needle = filter.student.toLowerCase();
    if (!splitStudents(row.student_names).some((name) => name.toLowerCase().includes(needle))) return false;
  }
  if (filter.classroom && !textContains(row.classroom, filter.classroom)) return false;
  if (filter.grade && !textContains(row.grade, filter.grade)) return false;
  if (filter.subject && !textContains(row.subject, filter.subject)) return false;
  if (includeDate) {
    if (filter.start_date && (!row.date || row.date < filter.start_date)) return false;
    if (filter.end_date && (!row.date || row.date > filter.end_date)) return false;
  }
  if (includeStatus && filter.status && !textContains(rowStatus(row), filter.status)) return false;
  if (includeQuery && filter.query) {
    const needle = filter.query.toLowerCase();
    const haystack = [row.student_names, row.notes, row.classroom, row.subject].join(" ").toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function lessonBelongsToMonth(row, monthKey = state?.settings?.month_key || activeMonth) {
  if (!monthKey) return true;
  if (row.month_key) return row.month_key === monthKey;
  const bounds = monthBounds(monthKey);
  return Boolean(row.date && row.date >= bounds.start && row.date <= bounds.end);
}

function monthLessonRows() {
  const monthKey = state?.settings?.month_key || activeMonth;
  return sortedLessons().filter((row) => lessonBelongsToMonth(row, monthKey));
}

function lessonStats(rows = []) {
  const effectiveRows = rows.filter(isEffective);
  return {
    records: rows.length,
    effective: effectiveRows.length,
    studentTotal: effectiveRows.reduce((sum, row) => sum + splitStudents(row.student_names).length, 0),
    teacherCount: uniqueSorted(effectiveRows.map((row) => row.teacher_name)).length,
  };
}

function filterSelectOptions(values, current, emptyText) {
  const normalized = uniqueSorted(current && !values.includes(current) ? [...values, current] : values);
  return options(normalized, current, emptyText);
}

function filterComboControl({ id = "", className, field, value, values, placeholder = "全部", dataAttr = "filter-field", emptyLabel = "全部" }) {
  const normalized = uniqueSorted(value && !values.includes(value) ? [...values, value] : values);
  const dataName = dataAttr === "field" ? "data-field" : "data-filter-field";
  const hasValueClass = value ? "has-value" : "";
  return `
    <span class="filter-combo ${hasValueClass}">
      <input ${id ? `id="${escapeHtml(id)}"` : ""} class="control filter-combo-input ${className}" ${dataName}="${escapeHtml(field)}" type="text" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value || "")}">
      <button class="filter-combo-clear" type="button" aria-label="清空" ${value ? "" : "hidden"}>×</button>
      <button class="filter-combo-toggle" type="button" aria-label="展开候选">⌄</button>
      <span class="filter-combo-menu">
        ${emptyLabel ? `<button class="filter-combo-option muted" type="button" data-value="">${escapeHtml(emptyLabel)}</button>` : ""}
        ${normalized.map((item) => `<button class="filter-combo-option" type="button" data-value="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}
        <span class="filter-combo-empty" hidden>无匹配选项</span>
      </span>
    </span>
  `;
}

function textFilterControl({ id = "", className = "", field, value = "", placeholder = "", dataAttr = "filter-field" } = {}) {
  const dataName = dataAttr === "field" ? "data-field" : "data-filter-field";
  const normalizedValue = String(value || "");
  return `
    <span class="text-filter ${normalizedValue ? "has-value" : ""}">
      <input ${id ? `id="${escapeHtml(id)}"` : ""} class="control ${className} text-filter-input" ${dataName}="${escapeHtml(field)}" type="text" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(normalizedValue)}">
      <button class="text-filter-clear" type="button" aria-label="清空" ${normalizedValue ? "" : "hidden"}>×</button>
    </span>
  `;
}

function multiSelectControl({ id = "", className = "", field, selected = [], values = [], placeholder = "全部", clearLabel = "全部", dataAttr = "filter-field", includeSelected = true, searchable = false }) {
  const selectedList = normalizeNameList(selected);
  const selectedSet = new Set(selectedList);
  const normalized = uniqueSorted([...(values || []), ...(includeSelected ? selectedList : [])]);
  const dataName = dataAttr === "field" ? "data-field" : "data-filter-field";
  const label = selectedList.length ? selectedList.join("、") : placeholder;
  return `
    <span class="multi-select ${selectedList.length ? "has-value" : ""}" data-field="${escapeHtml(field)}" data-placeholder="${escapeHtml(placeholder)}">
      <button ${id ? `id="${escapeHtml(id)}"` : ""} class="control multi-select-toggle ${className}" type="button" aria-expanded="false">
        <span class="multi-select-label">${escapeHtml(label)}</span>
        <span class="multi-select-caret">⌄</span>
        <span class="multi-select-clear-icon" aria-hidden="true">×</span>
      </button>
      <input class="multi-select-value ${className}" ${dataName}="${escapeHtml(field)}" type="hidden" value="${escapeHtml(selectedList.join("\n"))}">
      <span class="multi-select-menu">
        ${searchable ? `<input class="multi-select-search" type="search" autocomplete="off" spellcheck="false" placeholder="搜索老师">` : ""}
        <button class="multi-select-clear" type="button">${escapeHtml(clearLabel)}</button>
        ${normalized.map((item) => `
          <button class="multi-select-option ${selectedSet.has(item) ? "selected" : ""}" type="button" data-value="${escapeHtml(item)}">
            <span class="multi-select-check">${selectedSet.has(item) ? "✓" : ""}</span>
            <span>${escapeHtml(item)}</span>
          </button>
        `).join("")}
        ${normalized.length ? "" : `<span class="multi-select-empty">暂无选项</span>`}
      </span>
    </span>
  `;
}

const FLOATING_MULTI_SELECT_TOGGLE_SELECTOR = [
  ".user-row-teachers",
  ".new-user-teachers",
  ".user-access-teachers",
].join(",");

function usesFloatingMultiSelectMenu(select) {
  return Boolean(select?.querySelector(FLOATING_MULTI_SELECT_TOGGLE_SELECTOR));
}

function multiSelectMenuFor(select) {
  return select?._floatingMenu || select?.querySelector(".multi-select-menu") || null;
}

function mountFloatingMultiSelectMenu(select) {
  const menu = select?.querySelector(".multi-select-menu");
  if (!menu || !usesFloatingMultiSelectMenu(select)) return menu;
  select._floatingMenu = menu;
  menu._multiSelectOwner = select;
  menu.classList.add("floating-multi-select-menu");
  document.body.appendChild(menu);
  return menu;
}

function closeMultiSelectMenu(select) {
  if (!select) return;
  const menu = multiSelectMenuFor(select);
  select.classList.remove("open", "floating-menu");
  select.querySelector(".multi-select-toggle")?.setAttribute("aria-expanded", "false");
  if (menu?._multiSelectOwner === select) {
    menu.classList.remove("floating-multi-select-menu");
    menu.removeAttribute("style");
    if (select.isConnected) select.appendChild(menu);
    else menu.remove();
    delete menu._multiSelectOwner;
    delete select._floatingMenu;
  }
}

function closeOpenMultiSelectMenus() {
  document.querySelectorAll(".multi-select.open").forEach(closeMultiSelectMenu);
}

function positionFloatingMultiSelectMenu(select) {
  if (!select?.classList.contains("open") || !usesFloatingMultiSelectMenu(select)) return;
  const toggle = select.querySelector(".multi-select-toggle");
  const menu = multiSelectMenuFor(select);
  if (!toggle || !menu) return;
  const rect = toggle.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) {
    closeMultiSelectMenu(select);
    return;
  }

  select.classList.add("floating-menu");
  const viewportGap = 8;
  const menuGap = 6;
  const width = Math.min(Math.max(rect.width, 188), Math.max(188, window.innerWidth - viewportGap * 2));
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - viewportGap - menuGap);
  const spaceAbove = Math.max(0, rect.top - viewportGap - menuGap);
  const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
  const availableHeight = openAbove ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(80, Math.min(260, availableHeight || 260));
  const measuredHeight = Math.min(menu.scrollHeight || maxHeight, maxHeight);
  const left = Math.min(
    Math.max(viewportGap, rect.left),
    Math.max(viewportGap, window.innerWidth - width - viewportGap),
  );
  const top = openAbove
    ? Math.max(viewportGap, rect.top - measuredHeight - menuGap)
    : Math.min(window.innerHeight - measuredHeight - viewportGap, rect.bottom + menuGap);

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(Math.max(viewportGap, top))}px`;
  menu.style.width = `${Math.round(width)}px`;
  menu.style.maxHeight = `${Math.round(maxHeight)}px`;
}

function positionOpenFloatingMultiSelectMenus() {
  document.querySelectorAll(".multi-select.open").forEach(positionFloatingMultiSelectMenu);
}

function rowsForFilterOption(rows, filter, excludeField, matcher) {
  const optionFilter = { ...filter, [excludeField]: "" };
  return rows.filter((row) => matcher(row, optionFilter));
}

function textContains(value, filter) {
  const needle = String(filter || "").trim().toLowerCase();
  if (!needle) return true;
  return String(value || "").toLowerCase().includes(needle);
}

function canonicalFilterValue(entries, value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = entries.find(([key, label]) => raw === key || raw === label);
  return match ? match[0] : raw;
}

function filterLabel(entries, value) {
  return entries.find(([key]) => key === value)?.[1] || value || "";
}

const rechargeSourceOptions = [["all", "全部"], ["manual", "手动/无来源"], ["carry_over", "自动结转"]];
const balanceFilterOptions = [["actual", "有现金余额"], ["gift", "有赠送余额"], ["zero", "全为零"]];
const priceFilterOptions = [["auto", "自动"], ["manual", "手动"], ["pending", "未设置"]];
const usageFilterOptions = [["current", "本月有课"], ["historical", "历史有课"], ["unused", "未使用"]];

function renderLessonFilterBar({ rows, filteredRows, compact = false }) {
  const matchOptions = compact ? { includeDate: false, includeStatus: false, includeQuery: false } : {};
  const opts = dynamicLessonFilterOptions(rows, lessonFilter, matchOptions);
  const teacherSelect = `
    <label class="filter-field">
      <span>老师</span>
      ${multiSelectControl({ className: "lesson-filter-multi", field: "teacher_names", selected: lessonFilter.teacher_names || [], values: opts.teachers, placeholder: "全部老师" })}
    </label>
  `;
  const studentInput = `
    <label class="filter-field">
      <span>学生</span>
      ${filterComboControl({ className: "lesson-filter-input", field: "student", value: lessonFilter.student, values: opts.students, placeholder: "输入或选择学生" })}
    </label>
  `;
  const compactExtraFilters = compact ? `
    <label class="filter-field">
      <span>教室</span>
      ${filterComboControl({ className: "lesson-filter-input", field: "classroom", value: lessonFilter.classroom, values: opts.classrooms, placeholder: "输入或选择教室" })}
    </label>
    <label class="filter-field">
      <span>年级</span>
      ${filterComboControl({ className: "lesson-filter-input", field: "grade", value: lessonFilter.grade, values: opts.grades, placeholder: "输入或选择年级" })}
    </label>
    <label class="filter-field">
      <span>科目</span>
      ${filterComboControl({ className: "lesson-filter-input", field: "subject", value: lessonFilter.subject, values: opts.subjects, placeholder: "输入或选择科目" })}
    </label>
  ` : "";
  const fullFilters = compact ? "" : `
    <label class="filter-field">
      <span>状态</span>
      ${filterComboControl({ className: "lesson-filter-input", field: "status", value: lessonFilter.status, values: opts.statuses, placeholder: "输入或选择状态" })}
    </label>
    <label class="filter-field filter-date-range">
      <span>日期</span>
      ${dateRangePickerControl({ scope: "lesson", startField: "start_date", endField: "end_date", start: lessonFilter.start_date, end: lessonFilter.end_date, placeholder: "选择课程日期范围" })}
    </label>
    <label class="filter-field">
      <span>教室</span>
      ${filterComboControl({ className: "lesson-filter-input", field: "classroom", value: lessonFilter.classroom, values: opts.classrooms, placeholder: "输入或选择教室" })}
    </label>
    <label class="filter-field">
      <span>年级</span>
      ${filterComboControl({ className: "lesson-filter-input", field: "grade", value: lessonFilter.grade, values: opts.grades, placeholder: "输入或选择年级" })}
    </label>
    <label class="filter-field">
      <span>科目</span>
      ${filterComboControl({ className: "lesson-filter-input", field: "subject", value: lessonFilter.subject, values: opts.subjects, placeholder: "输入或选择科目" })}
    </label>
    <label class="filter-field filter-search">
      <span>搜索</span>
      ${textFilterControl({ className: "lesson-filter-input", field: "query", value: lessonFilter.query, placeholder: "学生、备注、教室、科目" })}
    </label>
  `;
  return `
    <div class="filter-bar lesson-filter-bar">
      <div class="lesson-filter-top">
        <div class="filter-controls">
          ${teacherSelect}
          ${studentInput}
          ${compactExtraFilters}
          ${fullFilters}
        </div>
        <div class="filter-summary">
          <span>已筛选 <b>${filteredRows.length}</b> / 共 ${rows.length} 节</span>
          <button class="btn reset-lesson-filter" type="button">重置</button>
        </div>
      </div>
    </div>
  `;
}

function ensureFeeDetailsFilterMonth() {
  const monthKey = state?.settings?.month_key || activeMonth;
  if (feeDetailsFilter.month_key !== monthKey) {
    feeDetailsFilter = { ...feeDetailsFilter, month_key: monthKey, start: "", end: "" };
  }
}

function resetFeeDetailsFilter() {
  feeDetailsFilter = { month_key: state?.settings?.month_key || activeMonth, student: "", teacher: "", grade: "", status: "", source: "", start: "", end: "" };
}

function priceSourceFilterValue(source) {
  if (source === "manual" || source === "override") return "manual";
  if (source === "pending") return "pending";
  return "auto";
}

function feeDetailStatusOptions() {
  return uniqueSorted([...statusValues(), "未上", "暂停", "调课"]);
}

function feeDetailMatchesFilter(row, filter = feeDetailsFilter) {
  if (filter.student && !row.student_name.toLowerCase().includes(filter.student.toLowerCase())) return false;
  if (filter.teacher && !textContains(row.teacher_name, filter.teacher)) return false;
  if (filter.grade && !textContains(row.grade, filter.grade)) return false;
  if (filter.status) {
    const status = rowStatus(row);
    const match = textContains(status, filter.status)
      || (textContains("未上", filter.status) && (status === "待上" || row.course_status === "未上"))
      || (textContains("暂停", filter.status) && String(row.course_status || "").startsWith("暂停"))
      || (textContains("调课", filter.status) && String(row.notes || "").includes("调课"));
    if (!match) return false;
  }
  if (filter.source) {
    const source = priceSourceFilterValue(row.price_source);
    if (!textContains(source, filter.source) && !textContains(priceSourceLabel(source), filter.source)) return false;
  }
  if (filter.start && (!row.date || row.date < filter.start)) return false;
  if (filter.end && (!row.date || row.date > filter.end)) return false;
  return true;
}

function dynamicFeeDetailsFilterOptions(rows, filter = feeDetailsFilter) {
  const rowsFor = (field) => rowsForFilterOption(rows, filter, field, feeDetailMatchesFilter);
  return {
    students: uniqueSorted(rowsFor("student").map((row) => row.student_name)),
    teachers: uniqueSorted(rowsFor("teacher").map((row) => row.teacher_name)),
    grades: uniqueSorted(rowsFor("grade").map((row) => row.grade)),
    statuses: uniqueSorted(rowsFor("status").map((row) => rowStatus(row))),
    sources: uniqueSorted(rowsFor("source").map((row) => priceSourceLabel(priceSourceFilterValue(row.price_source)))),
  };
}

function renderFeeDetailsFilterBar(rows, filteredRows) {
  const opts = dynamicFeeDetailsFilterOptions(rows);
  return `
    <div class="filter-bar">
      <div class="filter-controls">
        <label class="filter-field">
          <span>学生姓名</span>
          ${filterComboControl({ className: "fee-details-filter-input", field: "student", value: feeDetailsFilter.student, values: opts.students, placeholder: "输入或选择学生" })}
        </label>
        <label class="filter-field">
          <span>授课老师</span>
          ${filterComboControl({ className: "fee-details-filter-input", field: "teacher", value: feeDetailsFilter.teacher, values: opts.teachers, placeholder: "输入或选择老师" })}
        </label>
        <label class="filter-field">
          <span>年级</span>
          ${filterComboControl({ className: "fee-details-filter-input", field: "grade", value: feeDetailsFilter.grade, values: opts.grades, placeholder: "输入或选择年级" })}
        </label>
        <label class="filter-field">
          <span>状态</span>
          ${filterComboControl({ className: "fee-details-filter-input", field: "status", value: feeDetailsFilter.status, values: opts.statuses, placeholder: "输入或选择状态" })}
        </label>
        <label class="filter-field">
          <span>价格状态</span>
          ${filterComboControl({ className: "fee-details-filter-input", field: "source", value: feeDetailsFilter.source, values: opts.sources, placeholder: "输入或选择价格状态" })}
        </label>
        <label class="filter-field filter-date-range">
          <span>日期</span>
          ${dateRangePickerControl({ scope: "fee-details", start: feeDetailsFilter.start, end: feeDetailsFilter.end, placeholder: "选择费用日期范围" })}
        </label>
      </div>
      <div class="filter-summary">
        <span>已筛选 <b>${filteredRows.length}</b> / 共 ${rows.length} 条</span>
        <button class="btn reset-fee-details-filter" type="button">清空筛选</button>
      </div>
    </div>
  `;
}

function summaryMatchesFilter(row, filter = summaryFilter) {
  if (filter.student && !row.student_name.toLowerCase().includes(filter.student.toLowerCase())) return false;
  if (filter.grade && !textContains(row.grade, filter.grade)) return false;
  if (filter.balance === "actual" && numberValue(row.actual_balance) === 0) return false;
  if (filter.balance === "gift" && numberValue(row.gift_balance) === 0) return false;
  if (filter.balance === "zero" && (numberValue(row.actual_balance) !== 0 || numberValue(row.gift_balance) !== 0)) return false;
  return true;
}

function summaryRows() {
  const rows = state.derived.student_summary || [];
  return [...rows].sort(compareStudentGradeName);
}

function dynamicSummaryFilterOptions(rows, filter = summaryFilter) {
  const rowsFor = (field) => rowsForFilterOption(rows, filter, field, summaryMatchesFilter);
  return {
    students: uniqueSorted(rowsFor("student").map((row) => row.student_name)),
    grades: uniqueSorted(rowsFor("grade").map((row) => row.grade)),
  };
}

function renderSummaryFilterBar(rows, filteredRows) {
  const opts = dynamicSummaryFilterOptions(rows);
  return `
    <div class="filter-bar compact summary-filter-bar">
      <label>学生姓名</label>
      ${filterComboControl({ className: "summary-filter-input", field: "student", value: summaryFilter.student, values: opts.students, placeholder: "输入或选择学生" })}
      <label>年级</label>
      ${filterComboControl({ className: "summary-filter-input", field: "grade", value: summaryFilter.grade, values: opts.grades, placeholder: "输入或选择年级" })}
      <label>余额状态</label>
      ${filterComboControl({ className: "summary-filter-input", field: "balance", value: filterLabel(balanceFilterOptions, summaryFilter.balance), values: balanceFilterOptions.map((item) => item[1]), placeholder: "输入或选择余额状态" })}
      <div class="filter-summary">
        <span>已筛选 <b>${filteredRows.length}</b> / 共 ${rows.length} 条</span>
        <button class="btn reset-summary-filter" type="button">清空筛选</button>
      </div>
    </div>
  `;
}

function statusValues() {
  return state?.lookups?.status || defaultCourseStatuses;
}

function rowStatus(row = {}) {
  const current = String(row.status || "").trim();
  if (statusValues().includes(current)) return current;
  if (row.lesson_status === "试课") return "试课";
  if (row.lesson_status === "考试") return "考试";
  if (row.lesson_status === "上课（未缴费）") return "未缴费";
  if (row.lesson_status === "请假" || row.course_status === "请假") return "请假";
  if (row.course_status === "已上") return "已上";
  return "待上";
}

function statusClass(value) {
  return {
    "已上": "done",
    "待上": "pending",
    "请假": "leave",
    "试课": "trial",
    "考试": "exam",
    "未缴费": "unpaid",
  }[value] || "pending";
}

function statusBadge(value) {
  const status = rowStatus({ status: value });
  return `<span class="status-badge ${statusClass(status)}">${escapeHtml(status)}</span>`;
}

function statusSelectCell({ id, value, tdClass = "" }) {
  const status = rowStatus({ status: value });
  return `
    <td class="${tdClass}">
      <select class="cell-select lesson-field status-select ${statusClass(status)}" data-id="${id}" data-field="status">
        ${manualSelectOptions(getStatusOptions(status), status, lessonManualLabel("status"), { emptyText: "" })}
      </select>
    </td>
  `;
}

function isEffective(row) {
  if (typeof row.effective === "boolean") return row.effective;
  const status = rowStatus(row);
  return status === "已上" || status === "未缴费";
}

function isCompletedLesson(row) {
  return rowStatus(row) === "已上";
}

function isReceivable(row) {
  return rowStatus(row) === "未缴费";
}

function isAbnormal(row) {
  const status = rowStatus(row);
  return status && status !== "已上";
}

function detailRowClass(row) {
  if (isReceivable(row)) return "receivable";
  if (rowStatus(row) === "考试") return "exam-row";
  return row.effective ? "" : "abnormal";
}

function priceSourceLabel(source) {
  if (source === "manual") return "手动";
  if (source === "pending") return "未设置";
  return "自动";
}

function priceSourceTitle(row) {
  const amount = formatMoney(row.unit_price);
  const rule = row.rule_price == null ? "" : `，规则费用 ${formatMoney(row.rule_price)}`;
  if (row.price_source === "manual") return `当前费用 ${amount}${rule}，与规则不一致，视为手动`;
  if (row.price_source === "pending") return "已上课程未设置有效学生单价规则";
  return `系统自动费用 ${amount}${rule}`;
}

function sourceStatusBadge(label, title) {
  const className = label === "手动" ? "manual" : label === "未设置" ? "waiver" : "custom";
  const shortLabel = label === "手动" ? "手" : label === "未设置" ? "未" : "自";
  return `<span class="price-source-badge ${className}" title="${escapeHtml(title)}">${shortLabel}</span>`;
}

function priceSourceBadge(row) {
  return sourceStatusBadge(priceSourceLabel(row.price_source), priceSourceTitle(row));
}

function editablePriceCell(row) {
  const title = escapeHtml(priceSourceTitle(row));
  const locked = !isCompletedLesson(row);
  const input = currencyInputMarkup(row.unit_price, {
    className: `fee-override ${row.price_source === "manual" ? "manual-price" : ""}`,
    attrs: `data-lesson-id="${row.lesson_id}" data-student-name="${escapeHtml(row.student_name)}" min="0" title="${title}" ${locked ? "disabled" : ""}`,
  });
  return `
    <td class="text-cell right price-cell-wrap" title="${title}">
      <span class="price-inline editable-price-inline">
        ${input}
      ${priceSourceBadge(row)}
      </span>
    </td>
  `;
}

function feeDetailKey(row) {
  return `${row.lesson_id}\u0001${row.student_name}`;
}

function canApplyStudentPricingRule(row) {
  return isCompletedLesson(row) && Boolean(row.can_apply_pricing_rule) && row.rule_price != null && row.price_source !== "pending";
}

function feeDetailSelectTitle(row) {
  if (!isCompletedLesson(row)) return "非已上课程费用自动按 0 处理";
  if (!canApplyStudentPricingRule(row)) return "尚未设置有效学生单价规则";
  return "可按当前学生单价规则更新";
}

function readonlyPriceCell(row) {
  const title = escapeHtml(priceSourceTitle(row));
  return `<td class="text-cell right price-cell-wrap" title="${title}"><span class="price-inline"><span class="price-amount">${formatMoney(row.unit_price)}</span>${priceSourceBadge(row)}</span></td>`;
}

function balanceMiniCard(title, items) {
  return `
    <div class="balance-mini-card">
      <div class="balance-mini-title">${escapeHtml(title)}</div>
      <div class="balance-mini-lines">
        ${items.map((item) => `
          <div class="balance-mini-line">
            <span>${escapeHtml(item.label)}</span>
            <strong class="${numberValue(item.value) < 0 ? "negative" : ""}">${yuan2(item.value)}</strong>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function balanceDetailCards(row) {
  const toDate = row.summary_scope === "to_date";
  return `
    <div class="balance-card-grid">
      ${balanceMiniCard(toDate ? "期初余额" : "月初余额", [
        { label: "现金", value: row.prev_actual },
        { label: "赠送", value: row.prev_gift },
      ])}
      ${balanceMiniCard(toDate ? "累计新充" : "本月新充", [
        { label: "现金", value: row.cur_recharge },
        { label: "赠送", value: row.cur_gift },
      ])}
      ${balanceMiniCard(toDate ? "累计消费" : "本月消费", [
        { label: toDate ? "累计课程费用" : "课程费用", value: row.total_fee },
      ])}
      ${balanceMiniCard(toDate ? "截至结余" : "月末结余", [
        { label: "现金", value: row.actual_balance },
        { label: "赠送", value: row.gift_balance },
      ])}
    </div>
  `;
}

function severityRank(severity) {
  return { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, WARN: 4 }[severity] ?? 9;
}

function issueValue(issue, key) {
  return issue[key] ?? "";
}

function hasApplicablePatch(issue) {
  const patch = issue?.patch || null;
  if (!patch) return false;
  if (patch.type === "lesson" && patch.id) return true;
  if (patch.type === "student" && patch.name) return true;
  if (patch.type === "insert_lesson" && patch.lesson) return true;
  return false;
}

function issueRows(issues, sourceKey) {
  return [...issues].sort((a, b) => severityRank(a.severity) - severityRank(b.severity)).map((issue, index) => `
    <tr>
      <td class="text-cell"><span class="severity-pill ${escapeHtml(issue.severity)}">${escapeHtml(issue.severity)}</span></td>
      <td class="text-cell">${escapeHtml(issue.type || issue.source || "")}</td>
      <td class="text-cell">${escapeHtml(issue.entity || "")}</td>
      <td class="text-cell">${escapeHtml(issue.field || "")}</td>
      <td class="text-cell">${escapeHtml(issue.xlsx_value ?? issue.after_value ?? "")}</td>
      <td class="text-cell">${escapeHtml(issue.db_value ?? issue.before_value ?? "")}</td>
      <td class="text-cell">${escapeHtml(issue.message || issue.notes || "")}</td>
      <td class="text-cell audit-actions">
        ${hasApplicablePatch(issue) ? `<button class="btn audit-apply-one" type="button" data-source="${sourceKey}" data-log-id="${issue.audit_log_id || ""}">${issue.patch?.type === "insert_lesson" ? "从 xlsx 补录" : "以 xlsx 为准"}</button>` : ""}
        ${issue.audit_log_id ? `<button class="btn audit-ignore-one" type="button" data-source="${sourceKey}" data-log-id="${issue.audit_log_id}" data-issue-key="${escapeHtml(issue.issue_key || "")}">忽略此项</button>` : ""}
      </td>
    </tr>
  `).join("");
}

function auditSourceMeta(report) {
  if (!report) return "";
  const fileName = String(report.source_file || "").split(/[\\/]/).pop();
  const reconcile = report.reconcile || {};
  const internalOnly = auditInternalOnlyCount(report);
  return `
    <div class="audit-source-meta">
      <span>月份：${escapeHtml(report.month_key || state?.settings?.month_key || "")}</span>
      <span>工作表：${escapeHtml(report.sheet_name || "-")}</span>
      <span>扫描课程：${Number(report.scanned_lessons || 0)}</span>
      ${report.reconcile ? `<span>导入前课程：${Number(reconcile.dbCourseCountBefore || 0)}</span>` : ""}
      ${report.reconcile ? `<span>导入后课程：${Number(reconcile.dbCourseCountAfter || 0)}</span>` : ""}
      ${report.reconcile ? `<span>系统多余：${Number(reconcile.internalOnly || 0)}</span>` : ""}
      ${report.reconcile ? `<span>源文件新增：${Number(reconcile.sourceOnly || 0)}</span>` : ""}
      ${report.reconcile ? `<span>字段变更：${Number(reconcile.changed || 0)}</span>` : ""}
      ${fileName ? `<span>文件：${escapeHtml(fileName)}</span>` : ""}
      ${internalOnly ? `<span>系统中存在 ${internalOnly} 条源文件不存在的课程记录。</span><button class="btn danger audit-clean-internal-only" type="button">处理系统多余课程</button>` : ""}
    </div>
  `;
}

function groupedIssueTable(report, sourceKey) {
  if (!report) return `<div class="empty audit-empty">尚未运行对账</div>`;
  const issues = report.issues || [];
  if (!issues.length) return `<div class="empty audit-empty">未发现差异</div>`;
  const bySeverity = {};
  for (const issue of issues) {
    if (!bySeverity[issue.severity]) bySeverity[issue.severity] = [];
    bySeverity[issue.severity].push(issue);
  }
  return ["CRITICAL", "HIGH", "MEDIUM", "LOW", "WARN"].filter((severity) => bySeverity[severity]?.length).map((severity) => `
    <details class="audit-group" ${["CRITICAL", "HIGH"].includes(severity) ? "open" : ""}>
      <summary><span class="severity-pill ${severity}">${severity}</span><strong>${bySeverity[severity].length}</strong></summary>
      <div class="table-wrap">
        <table class="audit-table uniform-table nowrap-table">
          <thead><tr><th>级别</th><th>类型</th><th>实体</th><th>字段</th><th>xlsx/建议值</th><th>数据库值</th><th>说明</th><th>操作</th></tr></thead>
          <tbody>${issueRows(bySeverity[severity], sourceKey)}</tbody>
        </table>
      </div>
    </details>
  `).join("");
}

function auditCounts(report) {
  const counts = report?.counts || {};
  return ["CRITICAL", "HIGH", "MEDIUM", "LOW", "WARN"].map((key) => `
    <span class="audit-count"><span class="severity-pill ${key}">${key}</span>${counts[key] || 0}</span>
  `).join("");
}

function combinedAuditCounts() {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, WARN: 0 };
  for (const report of [auditState.xlsxReport, auditState.internalReport]) {
    for (const key of Object.keys(counts)) counts[key] += Number(report?.counts?.[key] || 0);
  }
  return counts;
}

function auditRiskOverview() {
  const counts = combinedAuditCounts();
  const hasReport = !!(auditState.xlsxReport || auditState.internalReport);
  const critical = counts.CRITICAL || 0;
  const high = counts.HIGH || 0;
  const warn = counts.WARN || 0;
  const status = !hasReport
    ? "尚未运行对账"
    : critical
      ? `需要先处理 ${critical} 条 CRITICAL`
      : high
        ? `还有 ${high} 条 HIGH 需要复核`
        : "未发现高风险差异";
  return `
    <div class="audit-risk-overview ${critical ? "has-critical" : ""}">
      <div>
        <div class="audit-risk-kicker">对账优先级</div>
        <div class="audit-risk-title">${escapeHtml(status)}</div>
        <div class="audit-risk-note">先处理影响定价、学生名单、老师、日期和时段的差异；低风险备注类问题可以后置。</div>
      </div>
      <div class="audit-risk-counts">
        ${["CRITICAL", "HIGH", "MEDIUM", "WARN"].map((key) => `
          <div class="audit-risk-card ${key}">
            <span>${key}</span>
            <strong>${counts[key] || 0}</strong>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function auditIssueByLogId(sourceKey, logId) {
  const report = auditState[sourceKey];
  return (report?.issues || []).find((issue) => String(issue.audit_log_id || "") === String(logId || ""));
}

function auditInternalOnlyIssues(report) {
  return (report?.issues || []).filter((issue) => issue.type === "internal-only");
}

function auditInternalOnlyCount(report) {
  return Number(report?.reconcile?.internalOnly || auditInternalOnlyIssues(report).length || 0);
}

function basenameFromPath(value) {
  return String(value || "").split(/[\\/]/).pop();
}

function auditSourceFilename(report) {
  const reportFile = basenameFromPath(report?.source_file);
  const monthKey = report?.month_key || state?.settings?.month_key || activeMonth;
  const workbooks = state.source_workbooks || [];
  const reportWorkbook = workbooks.find((item) => item.filename === reportFile && item.month_key === monthKey);
  if (reportWorkbook) return reportWorkbook.filename;
  const selectedWorkbook = workbooks.find((item) => item.filename === auditSourceWorkbook && item.month_key === monthKey);
  if (selectedWorkbook) return selectedWorkbook.filename;
  const matched = workbooks.find((item) => item.month_key === monthKey);
  return matched?.filename || "";
}

function removeAuditIssueByLogId(sourceKey, logId) {
  const report = auditState[sourceKey];
  if (!report?.issues) return;
  report.issues = report.issues.filter((issue) => String(issue.audit_log_id || "") !== String(logId || ""));
  report.counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, WARN: 0 };
  for (const issue of report.issues) report.counts[issue.severity] = (report.counts[issue.severity] || 0) + 1;
  report.issue_count = report.issues.length;
}

function removeAuditIssueByIdentity(sourceKey, logId, issueKey) {
  const report = auditState[sourceKey];
  if (!report?.issues) return;
  report.issues = report.issues.filter((issue) => {
    const sameLog = logId && String(issue.audit_log_id || "") === String(logId);
    const sameIssue = issueKey && String(issue.issue_key || "") === String(issueKey);
    return !(sameLog || sameIssue);
  });
  report.counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, WARN: 0 };
  for (const issue of report.issues) report.counts[issue.severity] = (report.counts[issue.severity] || 0) + 1;
  report.issue_count = report.issues.length;
}

async function refreshAuditLogs() {
  const data = await request("/api/audit/logs?limit=200");
  auditState.logs = data.logs || [];
}

async function refreshAuditEvents() {
  const data = await request("/api/audit/events?limit=200");
  auditState.events = data.events || [];
}

async function applyAuditIssue(issue) {
  const confirmCritical = issue.severity === "CRITICAL";
  if (confirmCritical && !confirm(`确认以 xlsx/建议值修复 CRITICAL：${issue.entity} ${issue.field}？`)) return;
  const result = await request("/api/audit/apply", {
    method: "POST",
    body: { issues: [issue], confirm_critical: confirmCritical },
  });
  if (issue.audit_log_id) removeAuditIssueByLogId("xlsxReport", issue.audit_log_id);
  if (issue.audit_log_id) removeAuditIssueByLogId("internalReport", issue.audit_log_id);
  await refreshAuditLogs();
  alert(`修复完成：${result.fixed} 条，跳过 ${result.skipped} 条。已备份：${result.backup}`);
  await load();
}

function internalOnlyLessonLine(row) {
  return [
    `#${row.id || row.lessonId || ""}`,
    row.date || "",
    row.student || row.student_names || "",
    row.teacher || row.teacher_name || "",
    row.time_slot || "",
    row.subject || "",
    row.classroom || "",
    `金额:${row.amount ?? row.teacher_salary ?? ""}`,
    `创建:${row.created_at || ""}`,
    `更新:${row.updated_at || ""}`,
  ].filter(Boolean).join(" | ");
}

async function handleInternalOnlyCleanup() {
  const report = auditState.xlsxReport;
  if (!report) return alert("请先运行源头对账");
  const monthKey = report.month_key || state.settings.month_key;
  const filename = auditSourceFilename(report);
  const preview = await request("/api/reconcile/internal-only-lessons/preview", {
    method: "POST",
    body: { month: monthKey, filename },
  });
  if (!preview.canApply || !preview.lessons?.length) {
    auditState.xlsxReport = { ...report, reconcile: { ...(report.reconcile || {}), internalOnly: 0 } };
    render();
    return alert(preview.warning || "当前没有系统多余课程。");
  }
  const shown = preview.lessons.map(internalOnlyLessonLine).join("\n");
  const message = [
    `这些课程存在于系统数据库中，但不在当前月份源文件中。`,
    `确认后将从系统课程记录中删除，仅限当前月份，共 ${preview.internalOnlyCount} 条。此操作不可撤销。是否继续？`,
    "",
    shown,
  ].join("\n");
  if (!confirm(message)) return;
  const result = await request("/api/reconcile/internal-only-lessons/apply", {
    method: "POST",
    body: {
      month: monthKey,
      filename: preview.source_file || filename,
      confirm: true,
      expectedCount: preview.internalOnlyCount,
      lessonIds: preview.lessons.map((row) => row.id || row.lessonId).filter(Boolean),
    },
  });
  auditState.xlsxReport = result.audit || auditState.xlsxReport;
  await refreshAuditLogs();
  await refreshAuditEvents();
  alert(`已清理 ${result.deletedCount || 0} 条系统多余课程。已备份：${result.backup || "已生成"}`);
  await load();
}

function gradeColor(grade) {
  const darkGradeColors = {
    "\u521d\u4e00": "#24281f",
    "\u521d\u4e8c": "#202631",
    "\u521d\u4e09": "#2a251d",
    "\u9ad8\u4e00": "#282230",
    "\u9ad8\u4e8c": "#1f2a2b",
    "\u9ad8\u4e09": "#2b2220",
  };
  if (isDarkThemeActive() && darkGradeColors[grade]) return darkGradeColors[grade];
  const match = state.lookups.grades.find((row) => row.name === grade);
  return match ? match.color : "";
}

function gradeRowStyle(grade) {
  const color = gradeColor(grade);
  return color ? ` style="background:${color}"` : "";
}

function options(values, current, emptyText = "") {
  const normalized = [...values];
  if (current && !normalized.some((value) => String(value) === String(current))) normalized.push(current);
  const empty = emptyText ? `<option value="">${escapeHtml(emptyText)}</option>` : "";
  return empty + normalized.map((value) => {
    const selected = String(value) === String(current) ? "selected" : "";
    return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(value)}</option>`;
  }).join("");
}

function selectCell({ className, id, field, value, values, emptyText = "", tdClass = "", manualLabel = "" }) {
  return `
    <td class="${tdClass}">
      <select class="cell-select ${className}" data-id="${id}" data-field="${field}">
        ${manualLabel ? manualSelectOptions(values, value, manualLabel, { emptyText }) : options(values, value, emptyText)}
      </select>
    </td>
  `;
}

function selectorEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function inputFocusSelector(input) {
  const className = [...input.classList].find((name) => name.endsWith("-filter-input") || name.endsWith("-search") || name.endsWith("-filter"));
  if (!className) return "";
  const field = input.dataset.filterField || input.dataset.field || "";
  return `.${className}${field ? `[data-${input.dataset.filterField ? "filter-field" : "field"}="${selectorEscape(field)}"]` : ""}`;
}

function restoreInputFocus(selector, value) {
  if (!selector) return;
  requestAnimationFrame(() => {
    const next = document.querySelector(selector);
    if (!next || next.tagName === "SELECT") return;
    next.focus({ preventScroll: true });
    const cursor = String(value || "").length;
    try {
      next.setSelectionRange(cursor, cursor);
    } catch {
      // Some input types do not support cursor restoration.
    }
  });
}

function bindSafeTextInput(input, applyValue, renderAction, _delay = 650) {
  let composing = false;
  const selector = inputFocusSelector(input);
  let lastCommittedValue = input.value;
  const commit = async (restoreFocus = false) => {
    const value = input.value;
    applyValue(value);
    if (value === lastCommittedValue) return;
    lastCommittedValue = value;
    await renderAction();
    if (restoreFocus) restoreInputFocus(selector, value);
  };
  const apply = () => {
    applyValue(input.value);
  };
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    apply();
  });
  input.addEventListener("input", () => {
    if (!composing) apply();
  });
  input.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && !composing) {
      event.preventDefault();
      input.blur();
      commit(false);
    }
  });
  input.addEventListener("change", () => {
    if (!composing) commit(false);
  });
  input.addEventListener("blur", () => {
    if (!composing) commit(false);
  });
}

function inputCell({ className, id, field, value, type = "text", extra = "", tdClass = "" }) {
  const inputValue = type === "number" ? moneyInput(value) : (value ?? "");
  return `
    <td class="${tdClass}">
      <input class="cell-input ${className} ${type === "number" ? "number" : ""}" data-id="${id}" data-field="${field}" type="${type}" value="${escapeHtml(inputValue)}" ${extra}>
    </td>
  `;
}

function groupViews(group) {
  return [...(group.views || []), ...(group.moreViews || [])];
}

function groupForView(viewKey) {
  return navGroups.find((group) => groupViews(group).some(([key]) => key === viewKey)) || navGroups[0];
}

function activeGroup() {
  const stored = navGroups.find((group) => group.key === activeNavGroup);
  if (stored && groupViews(stored).some(([key]) => key === view)) return stored;
  const group = groupForView(view);
  activeNavGroup = group.key;
  localStorage.setItem("liming:nav-group", activeNavGroup);
  return group;
}

function renderSecondaryNav(group) {
  const tabs = [...(group.views || []), ...(group.moreViews || [])].filter(([key]) => canView(key)).map(([key, label]) => `
    <button class="nav-sub-btn ${view === key ? "active" : ""}" data-group="${group.key}" data-view="${key}">
      ${escapeHtml(label)}
    </button>
  `).join("");
  if (!tabs) return "";
  return `<div class="nav-subtabs">${tabs}</div>`;
}

function navLabelText(group) {
  return String(group.label || "").replace(/^\S+\s+/, "").trim() || group.label || "";
}

function passwordEyeIcon(visible) {
  return visible
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"></path><path d="M10.6 5.2A9.8 9.8 0 0 1 12 5c5.8 0 9.2 7 9.2 7a15.9 15.9 0 0 1-3 3.7"></path><path d="M14.1 14.1A3 3 0 0 1 9.9 9.9"></path><path d="M6.5 6.8A16.3 16.3 0 0 0 2.8 12s3.4 7 9.2 7a9.6 9.6 0 0 0 4.4-1.1"></path></svg>`;
}

function renderLogin(error = "") {
  const remembered = loginRemember();
  appEl?.classList.add("login-mode");
  appEl?.classList.remove("readonly-mode");
  navEl.innerHTML = "";
  topbarEl.innerHTML = "";
  contentEl.innerHTML = `
    <div class="login-shell">
      <form class="login-panel">
        <div class="login-title">黎明教育课程管理系统</div>
        <div class="login-subtitle">请输入账号和密码</div>
        ${error ? `<div class="login-error">${escapeHtml(error)}</div>` : ""}
        <label class="login-field">
          <span>账号</span>
          <input class="control login-username" autocomplete="username" value="${escapeHtml(remembered.username || "")}" placeholder="请输入手机号或账号">
        </label>
        <label class="login-field">
          <span>密码</span>
          <span class="login-password-wrap">
            <input class="control login-password" type="password" autocomplete="current-password" value="${escapeHtml(remembered.password || "")}" placeholder="请输入密码">
            <button class="login-password-toggle" type="button" aria-label="显示密码" title="显示密码" data-visible="0">${passwordEyeIcon(false)}</button>
          </span>
        </label>
        <div class="login-checks">
          <label><input class="login-remember-username" type="checkbox" ${remembered.rememberUsername ? "checked" : ""}> 记住账号</label>
          <label><input class="login-remember-password" type="checkbox" ${remembered.rememberPassword ? "checked" : ""}> 记住密码</label>
        </div>
        <button class="btn primary login-submit" type="submit">登录</button>
        <div class="login-tip">首次默认账号为自己的手机号，初始密码为手机号后6位。</div>
      </form>
    </div>
  `;
  document.querySelector(".login-password-toggle")?.addEventListener("click", () => {
    const input = document.querySelector(".login-password");
    const button = document.querySelector(".login-password-toggle");
    if (!input || !button) return;
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    button.dataset.visible = visible ? "1" : "0";
    button.setAttribute("aria-label", visible ? "隐藏密码" : "显示密码");
    button.title = visible ? "隐藏密码" : "显示密码";
    button.innerHTML = passwordEyeIcon(visible);
  });
  document.querySelector(".login-panel")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const username = document.querySelector(".login-username")?.value || "";
      const password = document.querySelector(".login-password")?.value || "";
      const result = await request("/api/auth/login", {
        method: "POST",
        body: { username, password },
      });
      saveLoginRemember({
        username,
        password,
        rememberUsername: document.querySelector(".login-remember-username")?.checked,
        rememberPassword: document.querySelector(".login-remember-password")?.checked,
      });
      auth.user = result.user;
      const oldView = localStorage.getItem("liming:view") || "";
      resetPagePositionForCurrentUser();
      debugPermissionSelection("login", {
        oldView,
        clearedOldView: Boolean(oldView),
        chosenView: view,
        app_version: result.app_version || "",
      });
      await load();
    } catch (err) {
      renderLogin(err.message);
      const loginPanel = document.querySelector(".login-panel");
      if (loginPanel) {
        loginPanel.classList.remove('shake');
        // Force reflow
        void loginPanel.offsetWidth;
        loginPanel.classList.add('shake');
      }
    }
  });
}

function passwordModal() {
  if (!passwordModalOpen) return "";
  return `
    <div class="modal-backdrop password-modal">
      <div class="modal-panel password-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">修改密码</div>
            <div class="modal-subtitle">${escapeHtml(auth.user?.display_name || auth.user?.username || "")}</div>
          </div>
          <button class="btn password-modal-close" type="button">取消</button>
        </div>
        <div class="profile-form">
          <label>当前密码<input class="control password-current" type="password" autocomplete="current-password"></label>
          <label>新密码<input class="control password-next" type="password" autocomplete="new-password"></label>
          <label>确认新密码<input class="control password-confirm" type="password" autocomplete="new-password"></label>
        </div>
        <div class="modal-actions">
          <button class="btn password-modal-close" type="button">取消</button>
          <button class="btn primary password-submit" type="button">保存密码</button>
        </div>
      </div>
    </div>
  `;
}

function monthToolbar() {
  const monthOptions = months.map((month) => `
    <option value="${escapeHtml(month)}" ${month === activeMonth ? "selected" : ""}>${escapeHtml(formatMonthOption(month))}</option>
  `).join("");
  return `
    <div class="month-toolbar">
      <label class="month-toolbar-label" for="topbar-month-select">月份</label>
      <select id="topbar-month-select" class="control month-select">
        ${monthOptions}
      </select>
      ${canArea("schedule") ? `<div class="month-toolbar-actions">
        <button class="btn new-month" type="button">新建月份</button>
        <button class="btn icon-btn delete-month" type="button" title="删除当前月份" aria-label="删除当前月份">🗑</button>
      </div>` : ""}
    </div>
  `;
}

function renderPalettePreview() {
  const palette = PALETTES.find((item) => item.key === paletteMode) || PALETTES[0];
  return `
    <div class="palette-preview" aria-hidden="true">
      ${palette.colors.map((color) => `<span class="palette-swatch" style="background:${color}"></span>`).join("")}
    </div>
  `;
}

function userDisplayName() {
  return auth.user?.display_name || auth.user?.username || "用户";
}

function userInitial() {
  return userDisplayName().trim().slice(0, 1).toUpperCase() || "L";
}

function renderUserMenu() {
  const name = userDisplayName();
  const role = auth.user?.role_label || ROLE_LABELS[auth.user?.role] || "";
  return `
    <div class="user-menu ${userMenuOpen ? "open" : ""}">
      <button class="user-menu-trigger" type="button" aria-haspopup="menu" aria-expanded="${userMenuOpen ? "true" : "false"}">
        <span class="user-avatar" aria-hidden="true">${escapeHtml(userInitial())}</span>
        <span class="user-menu-name">${escapeHtml(name)}</span>
        <span class="user-menu-arrow" aria-hidden="true">▾</span>
      </button>
      ${userMenuOpen ? `
        <div class="user-menu-dropdown" role="menu">
          <div class="user-menu-header">
            <strong>${escapeHtml(name)}</strong>
            <span>${escapeHtml(role)}</span>
          </div>
          <div class="user-menu-divider"></div>
          ${canView("appearance") ? '<button class="user-menu-item appearance-settings-link" type="button" role="menuitem">外观设置</button>' : ""}
          <button class="user-menu-item open-password-modal" type="button" role="menuitem">修改密码</button>
          <button class="user-menu-item logout-btn danger" type="button" role="menuitem">退出系统</button>
        </div>
      ` : ""}
    </div>
  `;
}

function renderNav() {
  const currentGroup = activeGroup();
  const visibleGroups = navGroups.map((group) => ({
    ...group,
    views: (group.views || []).filter(([key]) => canView(key)),
    moreViews: (group.moreViews || []).filter(([key]) => canView(key)),
  })).filter((group) => group.views.length || group.moreViews.length);
  navEl.innerHTML = `
    <div class="nav-sections">
      ${visibleGroups.map((group) => `
        <div class="nav-group ${currentGroup.key === group.key ? "open" : ""}">
          <button class="nav-btn ${currentGroup.key === group.key ? "active" : ""}" data-group="${group.key}" data-tooltip="${escapeHtml(navLabelText(group))}" title="${sidebarCollapsed ? escapeHtml(navLabelText(group)) : ""}">
            <span class="nav-icon" aria-hidden="true">${NAV_ICONS[group.key] || ""}</span>
            <span class="nav-label">${escapeHtml(navLabelText(group))}</span>
          </button>
          ${currentGroup.key === group.key ? renderSecondaryNav(group) : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function renderTopbar(title, meta = "", actions = "") {
  topbarEl.innerHTML = `
    <div class="topbar-title-side">
      <button class="sidebar-toggle" type="button" aria-label="${sidebarCollapsed ? "展开侧栏" : "收起侧栏"}" title="${sidebarCollapsed ? "展开侧栏" : "收起侧栏"}" aria-pressed="${sidebarCollapsed ? "true" : "false"}">☰</button>
      <div class="title-block">
        <div class="page-title">${escapeHtml(title)}</div>
        ${meta ? `<div class="page-meta">${escapeHtml(meta)}</div>` : ""}
      </div>
    </div>
    <div class="toolbar">
      ${actions}
      ${monthToolbar()}
      ${renderUserMenu()}
    </div>
    ${monthDeleteModal()}
    ${passwordModal()}
  `;
}

function historyToggleAction() {
  return `
    <label class="history-toggle" title="显示历史老师和学生，包括本月没有课程或充值记录的人员">
      <input class="history-toggle-input" type="checkbox" ${includeInactive ? "checked" : ""}>
      <span>显示历史（含离校）</span>
    </label>
  `;
}

function sortLessons(rows) {
  return [...(rows || [])].sort((a, b) => {
    const av = [
      a.date || "",
      a.teacher_name || "",
      a.time_slot || "",
      String(a.sort_order ?? 0).padStart(8, "0"),
      String(a.id).padStart(8, "0"),
    ].join("|");
    const bv = [
      b.date || "",
      b.teacher_name || "",
      b.time_slot || "",
      String(b.sort_order ?? 0).padStart(8, "0"),
      String(b.id).padStart(8, "0"),
    ].join("|");
    return av.localeCompare(bv, "zh-Hans-CN");
  });
}

function sortedLessons() {
  return sortLessons(state.lessons);
}

function lessonDateRangeRows(rows = sortedLessons()) {
  const start = isDateValue(lessonFilter.start_date) ? lessonFilter.start_date : "";
  const end = isDateValue(lessonFilter.end_date) ? lessonFilter.end_date : "";
  if (!start || !end || start > end) return rows;
  return rows.filter((row) => row.date >= start && row.date <= end);
}

function visibleLessonRows() {
  const allRows = lessonDateRangeRows();
  const focusSet = new Set(focusedLessonIds.map(Number).filter(Boolean));
  return focusSet.size
    ? allRows.filter((row) => focusSet.has(Number(row.id)))
    : allRows.filter((row) => lessonMatchesFilter(row, lessonFilter));
}

function pruneSelectedLessons(rows = visibleLessonRows()) {
  const visibleIds = new Set(rows.map((row) => Number(row.id)).filter(Boolean));
  selectedLessonIds = new Set([...selectedLessonIds].filter((id) => visibleIds.has(Number(id))));
}

/* ── C 档 dirty 标记 ────────────────────────────────────────────── */
function markDirty(key) { dirtyFlags[key] = true; }     /* [约束6] 设置脏标记 */
function consumeDirty(key) { const was = dirtyFlags[key] || false; dirtyFlags[key] = false; return was; } /* [约束6] 消费并清除脏标记 */

/* ── 状态层辅助 ──────────────────────────────────────────────────── */
function patchLessonInState(updatedLesson) {             /* [约束4] 乐观更新 / 回滚 state.lessons */
  const idx = state.lessons.findIndex((row) => String(row.id) === String(updatedLesson.id));
  if (idx !== -1) state.lessons[idx] = { ...state.lessons[idx], ...updatedLesson };
}

function appendLessonToState(lesson) {
  const append = (rows) => {
    const next = Array.isArray(rows) ? [...rows] : [];
    const index = next.findIndex((row) => String(row.id) === String(lesson.id));
    if (index === -1) next.push(lesson);
    else next[index] = { ...next[index], ...lesson };
    return next;
  };
  state.lessons = append(state.lessons);
  state.week_lessons = append(state.week_lessons);
}

function markLessonDerivedDataDirty() {
  for (const key of ["finance", "summary", "studentSummary", "teacherSalary"]) markDirty(key);
}

/* ── scroll 捕获/恢复 ────────────────────────────────────────────── */
function captureLessonScroll() {                         /* [边界5] 捕获 .table-wrap 滚动位置 */
  const wrap = document.querySelector(".table-wrap");
  return wrap ? { top: wrap.scrollTop, left: wrap.scrollLeft } : { top: 0, left: 0 };
}
function restoreLessonScroll(position) {                 /* [边界5] 双 RAF 确保 layout 完成 */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const wrap = document.querySelector(".table-wrap");
      if (!wrap) return;
      wrap.scrollTop = position.top || 0;
      wrap.scrollLeft = position.left || 0;
    });
  });
}

/* ── 草稿捕获/恢复 ────────────────────────────────────────────────── */
function captureLessonDrafts() {                         /* [边界1] 收集所有 .lesson-field 中 DOM 值与 state 不一致的草稿 */
  const drafts = {};
  document.querySelectorAll(".lesson-field").forEach((input) => {
    const id = input.dataset.id;
    const field = input.dataset.field;
    if (!id || !field) return;
    const lesson = state.lessons.find((row) => String(row.id) === String(id));
    if (!lesson) return;
    const stateValue = input.type === "number" ? moneyInput(lesson[field]) : String(lesson[field] ?? "");
    if (input.value !== stateValue) {
      if (!drafts[id]) drafts[id] = {};
      drafts[id][field] = input.value;
    }
  });
  return drafts;
}
function restoreLessonDrafts(drafts) {                   /* [边界1] 渲染后回填未提交草稿 */
  if (!drafts || !Object.keys(drafts).length) return;
  requestAnimationFrame(() => {
    document.querySelectorAll(".lesson-field").forEach((input) => {
      const id = input.dataset.id;
      const field = input.dataset.field;
      const val = drafts[id]?.[field];
      if (val !== undefined) input.value = val;
    });
  });
}

/* ── warnings 展示 ────────────────────────────────────────────────── */
function getLessonWarnings(lessonId) {                   /* [约束5] 从缓存读取 PATCH 返回的 warnings */
  return lessonWarningsMap[String(lessonId)] || [];
}
function applyLessonWarnings(lessonId, warnings) {       /* [约束5] 写入缓存 + 给行打标记 */
  lessonWarningsMap[String(lessonId)] = warnings || [];
}

/* ── 局部 DOM 更新 ────────────────────────────────────────────────── */
function updateLessonSummaryMetrics() {                  /* [B档] 更新概要网格中的行数/有效课程数 */
  const rows = visibleLessonRows();
  pruneSelectedLessons(rows);
  const stats = lessonStats(rows);
  const metricValues = document.querySelectorAll(".summary-grid .metric-value");
  if (metricValues.length >= 4) {
    metricValues[0].textContent = stats.records;
    metricValues[1].textContent = stats.effective;
    metricValues[2].textContent = stats.studentTotal;
    metricValues[3].textContent = stats.teacherCount;
  }
}

function reRenderLessonsTbody() {                        /* [B档] 只重绘 tbody，不动页面其余部分 */
  const tbody = document.querySelector("#lessons-tbody");
  if (!tbody) return;
  const rows = visibleLessonRows();
  pruneSelectedLessons(rows);
  const table = tbody.closest(".lesson-table");
  table?.classList.toggle("is-editing", scheduleMode);
  table?.classList.toggle("is-browsing", !scheduleMode);
  tbody.innerHTML = lessonRowsHtml(rows);
  updateLessonSelectionControls(rows);
  cleanupCustomSelectPortals();
  if (scheduleMode) {
    /* 排课模式才渲染 select/date input，避免浏览态滚动时背着大量控件。 */
    enhanceCustomSelects();
    enhanceCustomDateInputs();
  }
}

/* ── 冲突重刷 ─────────────────────────────────────────────────────── */
async function refreshLessonConflicts() {                /* [B档] 只调 GET /api/schedule-conflicts，不调 bootstrap / lessons-range */
  try {
    state.schedule_conflicts = await request(
      `/api/schedule-conflicts?month=${encodeURIComponent(activeMonth)}${ignoreRoomOneConflict ? "&ignore_room_one=1" : ""}`
    );
  } catch {
    // 冲突接口失败不影响主流程
  }
}

/* ── 主事件处理 ───────────────────────────────────────────────────── */
async function handleLessonFieldChange(input) {          /* [约束2/3/4/5] 事件委托派发入口 */
  const lessonId = input.dataset.id;
  const field = input.dataset.field;
  if (!lessonId || !field) return;

  const previousLesson = state.lessons.find((row) => String(row.id) === String(lessonId));
  if (!previousLesson) return;
  if (!resolveManualSelectValue(input, previousLesson[field] ?? "")) return;

  const tierConfig = FIELD_TIERS[field];
  if (!tierConfig) {                                     /* 未知字段回退旧行为 */
    const value = input.type === "number" ? numberValue(input.value) : input.value;
    refreshAfter(() => request(`/api/lessons/${lessonId}`, { method: "PATCH", body: { [field]: value } }));
    return;
  }

  const { tiers, dirtyKeys } = tierConfig;
  const isB = tiers.includes("B");
  const isC = tiers.includes("C");
  const value = input.type === "number" ? numberValue(input.value) : input.value;

  /* C 档：立即标记 dirty */
  if (isC) {
    for (const key of dirtyKeys) markDirty(key);
  }

  if (isB) {
    /* ── B 档：乐观更新 + 冲突重算 + tbody 局部重绘 ──────────────── */
    const scroll = captureLessonScroll();
    const drafts = captureLessonDrafts();
    const focusedId = String(document.activeElement?.dataset?.id || "");
    const focusedField = document.activeElement?.dataset?.field || "";

    /* [约束4] 乐观更新 state */
    patchLessonInState({ ...previousLesson, [field]: value, id: previousLesson.id });

    try {
      const result = await request(`/api/lessons/${lessonId}`, {
        method: "PATCH",
        body: { [field]: value },
      });

      /* 用服务端返回值修正 state */
      patchLessonInState(result);

      /* [约束1] 重跑冲突检测 */
      await refreshLessonConflicts();

      /* [约束1] tbody 局部重绘 */
      reRenderLessonsTbody();
      updateLessonSummaryMetrics();
      restoreLessonScroll(scroll);
      restoreLessonDrafts(drafts);

      /* [边界2] 按 data-id 恢复焦点 */
      if (focusedId) {
        requestAnimationFrame(() => {
          const el = document.querySelector(`.lesson-field[data-id="${focusedId}"][data-field="${focusedField}"]`);
          if (el) el.focus();
        });
      }

      /* [约束5] 展示 warnings */
      if (result?.warnings?.length) {
        applyLessonWarnings(lessonId, result.warnings);
      }
    } catch (error) {
      /* [约束4] PATCH 失败，回滚 state */
      patchLessonInState(previousLesson);
      reRenderLessonsTbody();
      restoreLessonScroll(scroll);
      restoreLessonDrafts(drafts);
      alert(error.message);
    }
  } else {
    /* ── A 档：只更新当前单元格，不重绘整行/整表 ────────────────── */
    try {
      const result = await request(`/api/lessons/${lessonId}`, {
        method: "PATCH",
        body: { [field]: value },
      });

      /* [A档] 写入 state */
      patchLessonInState(result);

      /* [约束5] 展示 warnings */
      if (result?.warnings?.length) {
        applyLessonWarnings(lessonId, result.warnings);
      }
    } catch (error) {
      /* [A档] 失败回滚 DOM 值 */
      input.value = previousLesson[field] ?? "";
      alert(error.message);
    }
  }
}

function lessonEditorOptions() {
  return {
    teachers: getActiveTeacherOptions(),
    statuses: getStatusOptions(),
    times: getTimeOptions(),
    classrooms: getRoomOptions(),
    grades: getGradeOptions(),
    subjects: getSubjectOptions(),
  };
}

function lessonTextCell(colClass, value, { html = "", title = value } = {}) {
  const shown = html || escapeHtml(value || "");
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<td class="readonly ${colClass}"${titleAttr}><span class="lesson-cell-text">${shown}</span></td>`;
}

function lessonReadonlyCells(row, count, cumulative) {
  return [
    lessonTextCell("col-teacher", row.teacher_name),
    lessonTextCell("col-date", row.date),
    lessonTextCell("col-status", rowStatus(row)),
    lessonTextCell("col-weekday", weekdayCn(row.date)),
    lessonTextCell("col-time", row.time_slot),
    lessonTextCell("col-room", row.classroom),
    lessonTextCell("col-grade", row.grade),
    lessonTextCell("col-subject", row.subject),
    lessonTextCell("col-students", row.student_names),
    lessonTextCell("col-note", row.notes),
    lessonTextCell("col-count narrow", String(count), { title: String(count) }),
    lessonTextCell("col-index narrow", String(cumulative), { title: String(cumulative) }),
  ].join("");
}

function lessonEditCells(row, count, cumulative, editOptions) {
  return `
      ${selectCell({ className: "lesson-field", id: row.id, field: "teacher_name", value: row.teacher_name, values: editOptions.teachers, emptyText: "未选", tdClass: "col-teacher", manualLabel: lessonManualLabel("teacher_name") })}
      ${inputCell({ className: "lesson-field", id: row.id, field: "date", value: row.date, type: "date", tdClass: "col-date" })}
      ${statusSelectCell({ id: row.id, value: rowStatus(row), tdClass: "col-status" })}
      <td class="readonly col-weekday">${escapeHtml(weekdayCn(row.date))}</td>
      ${selectCell({ className: "lesson-field", id: row.id, field: "time_slot", value: row.time_slot, values: editOptions.times, emptyText: "未选", tdClass: "col-time", manualLabel: lessonManualLabel("time_slot") })}
      ${selectCell({ className: "lesson-field", id: row.id, field: "classroom", value: row.classroom, values: editOptions.classrooms, emptyText: "未选", tdClass: "col-room", manualLabel: lessonManualLabel("classroom") })}
      ${selectCell({ className: "lesson-field", id: row.id, field: "grade", value: row.grade, values: editOptions.grades, emptyText: "未选", tdClass: "col-grade", manualLabel: lessonManualLabel("grade") })}
      ${selectCell({ className: "lesson-field", id: row.id, field: "subject", value: row.subject, values: editOptions.subjects, emptyText: "未选", tdClass: "col-subject", manualLabel: lessonManualLabel("subject") })}
      ${inputCell({ className: "lesson-field wide", id: row.id, field: "student_names", value: row.student_names, tdClass: "col-students" })}
      ${inputCell({ className: "lesson-field wide", id: row.id, field: "notes", value: row.notes, tdClass: "col-note" })}
      <td class="readonly col-count narrow">${count}</td>
      <td class="readonly col-index narrow">${cumulative}</td>
  `;
}

function lessonRow(row, cumulative, editOptions = null) {
  const count = splitStudents(row.student_names).length;
  const lessonId = Number(row.id);
  const checked = selectedLessonIds.has(lessonId) ? "checked" : "";
  const rowWarnings = getLessonWarnings(row.id);         /* [约束5] 从缓存读取该行 warnings */
  const warningIcon = rowWarnings.length
    ? `<span class="lesson-warning-icon" title="${escapeHtml(rowWarnings.map((w) => w.message).join("\n"))}">⚠️</span>`
    : "";
  return `
    <tr class="${isAbnormal(row) ? "abnormal" : ""} ${rowWarnings.length ? "has-warnings" : ""}" data-row-id="${row.id}"> <!-- [约束1/边界2] data-row-id 用于行定位与焦点恢复 -->
      <td class="lesson-select-cell col-select"><input class="lesson-select-row" type="checkbox" data-id="${row.id}" aria-label="选择课程" ${checked}>${warningIcon}</td>
      ${scheduleMode ? lessonEditCells(row, count, cumulative, editOptions || lessonEditorOptions()) : lessonReadonlyCells(row, count, cumulative)}
    </tr>
  `;
}

function lessonScheduleAddRow(row) {
  const teacher = row.teacher_name || "未选老师";
  const date = row.date || lessonFilter.start_date || todayDate();
  return `
    <tr class="schedule-add-row" data-schedule-teacher="${escapeHtml(row.teacher_name || "")}" data-schedule-date="${escapeHtml(date)}">
      <td colspan="13">
        <button class="schedule-add-btn" type="button" data-teacher="${escapeHtml(row.teacher_name || "")}" data-date="${escapeHtml(date)}">
          ＋ 给${escapeHtml(teacher)}新增 ${escapeHtml(formatShortDate(date))} 课程
        </button>
      </td>
    </tr>
  `;
}

function lessonRowsHtml(rows) {
  if (!rows.length) return `<tr><td colspan="13" class="empty">暂无课程记录</td></tr>`;
  let cumulative = 0;
  const editOptions = scheduleMode ? lessonEditorOptions() : null;
  return rows.map((row, index) => {
    cumulative += splitStudents(row.student_names).length;
    const currentGroup = `${row.date || ""}|${row.teacher_name || ""}`;
    const next = rows[index + 1];
    const nextGroup = next ? `${next.date || ""}|${next.teacher_name || ""}` : "";
    const addRow = scheduleMode && currentGroup !== nextGroup ? lessonScheduleAddRow(row) : "";
    return `${lessonRow(row, cumulative, editOptions)}${addRow}`;
  }).join("");
}

function lessonToolbarHtml(rows) {
  const selectedCount = selectedLessonIds.size;
  return `
    <div class="lesson-table-toolbar">
      <div class="lesson-table-actions">
        <button class="btn schedule-mode-toggle ${scheduleMode ? "primary" : ""}" type="button">${scheduleMode ? "结束排课" : "开始排课"}</button>
        <button class="btn week-copy-btn" type="button">整周复制</button>
        <button class="btn primary add-lesson" type="button">新增课程</button>
        <button class="btn batch-complete-lessons" type="button" ${selectedCount ? "" : "disabled"}>批量已上${selectedCount ? `（${selectedCount}）` : ""}</button>
        <button class="btn batch-copy-lessons" type="button" ${selectedCount ? "" : "disabled"}>批量复制${selectedCount ? `（${selectedCount}）` : ""}</button>
        <button class="btn danger batch-delete-lessons" type="button" ${selectedCount && !lessonBatchDeleting ? "" : "disabled"}>
          ${lessonBatchDeleting ? "删除中…" : `批量删除${selectedCount ? `（${selectedCount}）` : ""}`}
        </button>
        ${lessonConflictButtonHtml(rows)}
      </div>
      <div class="lesson-selection-summary">
        ${selectedCount ? `已选择 ${selectedCount} / ${rows.length} 节` : ""}
      </div>
    </div>
  `;
}

function updateLessonSelectionControls(rows = visibleLessonRows()) {
  pruneSelectedLessons(rows);
  const selectedCount = selectedLessonIds.size;
  const visibleCount = rows.length;
  document.querySelectorAll(".lesson-select-row").forEach((input) => {
    input.checked = selectedLessonIds.has(Number(input.dataset.id));
  });
  const selectAll = document.querySelector(".lesson-select-all");
  if (selectAll) {
    selectAll.checked = visibleCount > 0 && selectedCount === visibleCount;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < visibleCount;
    selectAll.disabled = visibleCount === 0;
  }
  const batchButton = document.querySelector(".batch-delete-lessons");
  if (batchButton) {
    batchButton.disabled = !selectedCount || lessonBatchDeleting;
    batchButton.textContent = lessonBatchDeleting ? "删除中…" : `批量删除${selectedCount ? `（${selectedCount}）` : ""}`;
  }
  const batchCopyButton = document.querySelector(".batch-copy-lessons");
  if (batchCopyButton) {
    batchCopyButton.disabled = !selectedCount;
    batchCopyButton.textContent = `批量复制${selectedCount ? `（${selectedCount}）` : ""}`;
  }
  const batchCompleteButton = document.querySelector(".batch-complete-lessons");
  if (batchCompleteButton) {
    batchCompleteButton.disabled = !selectedCount;
    batchCompleteButton.textContent = `批量已上${selectedCount ? `（${selectedCount}）` : ""}`;
  }
  const summary = document.querySelector(".lesson-selection-summary");
  if (summary) {
    summary.textContent = selectedCount ? `已选择 ${selectedCount} / ${visibleCount} 节` : "";
  }
  updateLessonConflictButton(rows);
}

async function handleScheduleAddButton(button) {
  const date = isDateValue(button.dataset.date) ? button.dataset.date : (lessonFilter.start_date || todayDate());
  const teacherName = button.dataset.teacher || "";
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "正在新增课程…";
  try {
    const lesson = await request("/api/lessons", {
      method: "POST",
      body: {
        teacher_name: teacherName,
        date,
        month_key: monthKeyFromDateValue(date) || state.settings.month_key,
        status: "待上",
      },
    });
    appendLessonToState(lesson);
    markLessonDerivedDataDirty();
    await refreshLessonConflicts();
    reRenderLessonsTbody();
    updateLessonSummaryMetrics();
    requestAnimationFrame(() => {
      const target = document.querySelector(`.lesson-field[data-id="${lesson.id}"][data-field="time_slot"]`)
        || document.querySelector(`.lesson-field[data-id="${lesson.id}"]`);
      target?.focus();
    });
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;
    alert(`新增课程失败：${error.message}`);
  }
}

function monthKeyFromDateValue(value) {
  return isDateValue(value) ? `${value.slice(0, 7)}-01` : "";
}

function dayDiff(start, end) {
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b - a) / 86400000);
}

function parseDateList(value) {
  return uniqueSorted(String(value || "")
    .split(/[\s,，;；、]+/)
    .map((item) => item.trim())
    .filter(isDateValue))
    .slice(0, 7);
}

function usedLessonLookupValues(key) {
  const base = {
    classrooms: state.lookups?.classrooms || [],
    subjects: state.lookups?.subjects || [],
    times: state.lookups?.times || [],
    grades: (state.lookups?.grades || []).map((g) => g.name),
  }[key] || [];
  return uniqueSorted([...base, ...(state.used_lesson_lookups?.[key] || [])]);
}

function optionValuesWithCurrent(values = [], current = "", includeCurrent = true) {
  const currentList = Array.isArray(current) ? current : [current];
  return uniqueSorted([
    ...(values || []),
    ...(includeCurrent ? currentList : []),
  ]);
}

function teacherCandidateRows() {
  const profileRows = state?.profile_teachers || [];
  return profileRows.length ? profileRows : (state?.teachers || []);
}

function studentCandidateRows() {
  const profileRows = state?.profile_students || [];
  return profileRows.length ? profileRows : (state?.students || []);
}

function isActiveTeacher(row = {}) {
  return String(row.status || "在职").trim() === "在职";
}

function isActiveStudent(row = {}) {
  return String(row.status || "在读").trim() === "在读";
}

function getActiveTeacherOptions(current = "", { includeCurrent = true } = {}) {
  const values = teacherCandidateRows()
    .filter(isActiveTeacher)
    .map((teacher) => teacher.name);
  return optionValuesWithCurrent(values, current, includeCurrent);
}

function getActiveStudentOptions(current = [], { includeCurrent = false } = {}) {
  const values = studentCandidateRows()
    .filter(isActiveStudent)
    .map((student) => student.name);
  return optionValuesWithCurrent(values, current, includeCurrent);
}

function getStatusOptions(current = "", { includeCurrent = true } = {}) {
  return optionValuesWithCurrent(statusValues(), current, includeCurrent);
}

function getRoomOptions(current = "", { includeCurrent = true } = {}) {
  return optionValuesWithCurrent(usedLessonLookupValues("classrooms"), current, includeCurrent);
}

function getGradeOptions(current = "", { includeCurrent = true } = {}) {
  return optionValuesWithCurrent(usedLessonLookupValues("grades"), current, includeCurrent);
}

function getSubjectOptions(current = "", { includeCurrent = true } = {}) {
  return optionValuesWithCurrent(usedLessonLookupValues("subjects"), current, includeCurrent);
}

function getTimeOptions(current = "", { includeCurrent = true } = {}) {
  return optionValuesWithCurrent(usedLessonLookupValues("times"), current, includeCurrent);
}

function lessonFieldOptionValues(field, current = "", options = {}) {
  const optionGetters = {
    teacher_name: getActiveTeacherOptions,
    status: getStatusOptions,
    time_slot: getTimeOptions,
    classroom: getRoomOptions,
    grade: getGradeOptions,
    subject: getSubjectOptions,
  };
  return optionGetters[field]?.(current, options) || optionValuesWithCurrent([], current, options.includeCurrent !== false);
}

function lessonManualLabel(field) {
  return LESSON_MANUAL_FIELD_LABELS[field] || "手动添加新值";
}

function lessonManualInputLabel(field) {
  return LESSON_MANUAL_FIELD_INPUT_LABELS[field] || "新值";
}

function studentGradeOptions() {
  const seen = new Set();
  return [...(state.lookups?.grades || []).map((g) => g.name), "已毕业"].filter((value) => {
    const key = String(value || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function profileDateValue(row) {
  return row?.joined_at || row?.first_lesson_date || "";
}

function lessonStudentOptions() {
  return getActiveStudentOptions();
}

function manualSelectOptions(values, current, manualLabel, { emptyText = "未选", includeCurrent = true } = {}) {
  const normalized = uniqueSorted(values || []);
  const extra = includeCurrent && current && current !== LESSON_CREATE_MANUAL_VALUE && !normalized.includes(current) ? [current] : [];
  return [
    emptyText ? `<option value="">${escapeHtml(emptyText)}</option>` : "",
    `<option value="${LESSON_CREATE_MANUAL_VALUE}" ${current === LESSON_CREATE_MANUAL_VALUE ? "selected" : ""}>＋ ${escapeHtml(manualLabel)}</option>`,
    ...uniqueSorted([...normalized, ...extra]).map((value) => {
      const selected = String(value) === String(current) ? "selected" : "";
      return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(value)}</option>`;
    }),
  ].join("");
}

function enhancedSelectWrapper(select) {
  const wrapper = select?.nextElementSibling;
  return wrapper?.classList?.contains("custom-select") ? wrapper : null;
}

function refreshEnhancedSelect(select) {
  const wrapper = enhancedSelectWrapper(select);
  if (wrapper) syncCustomSelect(select, wrapper);
}

function setSelectValueWithOption(select, value) {
  if (!select) return;
  const normalized = String(value || "").trim();
  if (normalized && ![...select.options].some((option) => option.value === normalized)) {
    select.appendChild(new Option(normalized, normalized));
  }
  select.value = normalized;
  refreshEnhancedSelect(select);
}

function resolveManualSelectValue(select, previousValue = "") {
  if (!select || select.value !== LESSON_CREATE_MANUAL_VALUE) return true;
  const field = select.dataset.field || "";
  const label = lessonManualInputLabel(field);
  const entered = prompt(`请输入${label}`, "");
  const value = String(entered || "").trim();
  if (!value) {
    setSelectValueWithOption(select, previousValue || "");
    return false;
  }
  setSelectValueWithOption(select, value);
  return true;
}

function parseLessonCreateStudents(value) {
  return uniqueSorted(String(value || "")
    .split(/[，,、\n\r]+/)
    .map((name) => name.trim())
    .filter(Boolean));
}

function defaultLessonCreateDraft() {
  const date = isDateValue(lessonFilter.start_date) ? lessonFilter.start_date : todayDate();
  return {
    date,
    time_slot: "",
    teacher_name: "",
    classroom: "",
    grade: "",
    subject: "",
    selected_students: [],
    new_student_names: "",
    notes: "",
    status: "待上",
  };
}

function lessonCreateModal() {
  if (!lessonCreateDraft) return "";
  const draft = { ...defaultLessonCreateDraft(), ...lessonCreateDraft };
  const date = isDateValue(draft.date) ? draft.date : todayDate();
  const students = lessonStudentOptions();
  const selectedStudents = new Set(draft.selected_students || []);
  const status = draft.status || "待上";
  return `
    <div class="modal-backdrop lesson-create-modal">
      <div class="modal-panel lesson-create-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">新增课程</div>
            <div class="modal-subtitle">填写课程信息后确认新增。</div>
          </div>
          <button class="btn lesson-create-cancel" type="button">取消</button>
        </div>
        <div class="copy-form lesson-create-form">
          <label class="filter-field">
            <span>日期</span>
            <input class="control lesson-create-field lesson-create-date" data-field="date" type="date" value="${escapeHtml(date)}">
          </label>
          <label class="filter-field">
            <span>星期</span>
            <input class="control lesson-create-weekday" type="text" value="${escapeHtml(weekdayCn(date))}" readonly>
          </label>
          <label class="filter-field">
            <span>时间</span>
            <select class="control lesson-create-field" data-field="time_slot">
              ${manualSelectOptions(getTimeOptions(draft.time_slot), draft.time_slot, lessonManualLabel("time_slot"))}
            </select>
            <input class="control lesson-create-manual-field hidden" data-manual-field="time_slot" type="text" placeholder="请输入新时间">
          </label>
          <label class="filter-field">
            <span>授课老师</span>
            <select class="control lesson-create-field" data-field="teacher_name">
              ${manualSelectOptions(getActiveTeacherOptions("", { includeCurrent: false }), draft.teacher_name, lessonManualLabel("teacher_name"), { includeCurrent: false })}
            </select>
            <input class="control lesson-create-manual-field hidden" data-manual-field="teacher_name" type="text" placeholder="请输入新老师姓名">
          </label>
          <label class="filter-field">
            <span>教室</span>
            <select class="control lesson-create-field" data-field="classroom">
              ${manualSelectOptions(getRoomOptions(draft.classroom), draft.classroom, lessonManualLabel("classroom"))}
            </select>
            <input class="control lesson-create-manual-field hidden" data-manual-field="classroom" type="text" placeholder="请输入新教室名称">
          </label>
          <label class="filter-field">
            <span>年级</span>
            <select class="control lesson-create-field" data-field="grade">
              ${manualSelectOptions(getGradeOptions(draft.grade), draft.grade, lessonManualLabel("grade"))}
            </select>
            <input class="control lesson-create-manual-field hidden" data-manual-field="grade" type="text" placeholder="请输入新年级名称">
          </label>
          <label class="filter-field">
            <span>科目</span>
            <select class="control lesson-create-field" data-field="subject">
              ${manualSelectOptions(getSubjectOptions(draft.subject), draft.subject, lessonManualLabel("subject"))}
            </select>
            <input class="control lesson-create-manual-field hidden" data-manual-field="subject" type="text" placeholder="请输入新科目名称">
          </label>
          <label class="filter-field">
            <span>课程状态</span>
            <select class="control lesson-create-field" data-field="status">
              ${manualSelectOptions(getStatusOptions(status), status, lessonManualLabel("status"), { emptyText: "" })}
            </select>
            <input class="control lesson-create-manual-field hidden" data-manual-field="status" type="text" placeholder="请输入新状态">
          </label>
          <label class="filter-field lesson-create-students-field">
            <span>学生</span>
            <div class="lesson-create-student-list">
              ${students.map((name) => `
                <label class="lesson-create-student-option">
                  <input class="lesson-create-student-existing" type="checkbox" value="${escapeHtml(name)}" ${selectedStudents.has(name) ? "checked" : ""}>
                  <span>${escapeHtml(name)}</span>
                </label>
              `).join("") || `<span class="muted-tip">暂无学生档案，可在下方手动输入。</span>`}
            </div>
            <textarea class="control lesson-create-new-students" rows="3" placeholder="新增学生，可用逗号、顿号或换行分隔">${escapeHtml(draft.new_student_names || "")}</textarea>
          </label>
          <label class="filter-field">
            <span>备注</span>
            <input class="control lesson-create-field" data-field="notes" type="text" value="${escapeHtml(draft.notes)}">
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn lesson-create-cancel" type="button">取消</button>
          <button class="btn primary lesson-create-confirm" type="button">确认新增</button>
        </div>
      </div>
    </div>
  `;
}

function lessonCreateSelectValue(modal, field, emptyMessage) {
  const select = modal?.querySelector(`.lesson-create-field[data-field="${field}"]`);
  const value = String(select?.value || "").trim();
  if (value !== LESSON_CREATE_MANUAL_VALUE) return value;
  const manual = String(modal?.querySelector(`.lesson-create-manual-field[data-manual-field="${field}"]`)?.value || "").trim();
  if (!manual) throw new Error(emptyMessage);
  return manual;
}

function selectedLessonRowsSorted() {
  const selected = new Set([...selectedLessonIds].map(Number).filter(Boolean));
  return sortLessons(state.lessons || [])
    .filter((row) => selected.has(Number(row.id)));
}

function lessonBatchCopyTargetFromSource(row, offsetDays = 7) {
  const sourceTeacher = row.teacher_name || "";
  const activeTeachers = new Set(getActiveTeacherOptions("", { includeCurrent: false }));
  return {
    source_id: Number(row.id),
    teacher_name: activeTeachers.has(sourceTeacher) ? sourceTeacher : "",
    date: addDays(row.date, offsetDays),
    status: rowStatus(row) || "",
    time_slot: row.time_slot || "",
    classroom: row.classroom || "",
    grade: row.grade || "",
    subject: row.subject || "",
    student_names: row.student_names || "",
    notes: row.notes || "",
    teacher_salary: "",
  };
}

function openLessonBatchCopyDraft() {
  const sourceRows = selectedLessonRowsSorted();
  if (!sourceRows.length) return null;
  const offsetDays = 7;
  return {
    offsetDays,
    sourceRows,
    targetRows: sourceRows.map((row) => lessonBatchCopyTargetFromSource(row, offsetDays)),
  };
}

function resetLessonBatchCopyDates(offsetDays) {
  if (!lessonBatchCopyDraft) return;
  lessonBatchCopyDraft = {
    ...lessonBatchCopyDraft,
    offsetDays,
    targetRows: lessonBatchCopyDraft.sourceRows.map((row, index) => ({
      ...(lessonBatchCopyDraft.targetRows[index] || lessonBatchCopyTargetFromSource(row, offsetDays)),
      date: addDays(row.date, offsetDays),
    })),
  };
}

function batchCopyInputCell(index, field, value, type = "text", extra = "") {
  return `<input class="control batch-copy-field batch-copy-input" data-index="${index}" data-field="${field}" type="${type}" value="${escapeHtml(value || "")}" ${extra}>`;
}

function batchCopySelectCell(index, field, value, { emptyText = "未选" } = {}) {
  return `
    <select class="control batch-copy-field batch-copy-select" data-index="${index}" data-field="${field}">
      ${manualSelectOptions(lessonFieldOptionValues(field, value), value, lessonManualLabel(field), { emptyText })}
    </select>
  `;
}

function lessonBatchCopyModal() {
  if (!lessonBatchCopyDraft) return "";
  const sourceRows = lessonBatchCopyDraft.sourceRows || [];
  const targetRows = lessonBatchCopyDraft.targetRows || [];
  return `
    <div class="modal-backdrop batch-copy-modal">
      <div class="modal-panel batch-copy-panel">
        <div class="modal-head batch-copy-drag-handle">
          <div>
            <div class="modal-title">批量复制课程</div>
            <div class="modal-subtitle">原课程保持不变；目标课程可编辑，教师薪资留空时按当前规则自动匹配。</div>
          </div>
        </div>
        <div class="batch-copy-body">
          <div class="copy-form">
            <label class="filter-field">
              <span>整体平移天数</span>
              <input class="control batch-copy-offset" type="number" step="1" value="${escapeHtml(String(lessonBatchCopyDraft.offsetDays ?? 7))}">
            </label>
          </div>
          <div class="small-title">原课程</div>
          <div class="table-wrap copy-preview-wrap batch-copy-preview">
            <table class="copy-preview-table">
              <thead><tr><th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th>学生</th><th>备注</th></tr></thead>
              <tbody>
                ${sourceRows.map((row) => `
                  <tr>
                    <td class="text-cell">${escapeHtml(row.teacher_name)}</td>
                    <td class="text-cell">${escapeHtml(row.date)}</td>
                    <td class="text-cell">${escapeHtml(rowStatus(row))}</td>
                    <td class="text-cell">${escapeHtml(weekdayCn(row.date))}</td>
                    <td class="text-cell">${escapeHtml(row.time_slot)}</td>
                    <td class="text-cell">${escapeHtml(row.classroom)}</td>
                    <td class="text-cell">${escapeHtml(row.grade)}</td>
                    <td class="text-cell">${escapeHtml(row.subject)}</td>
                    <td class="text-cell">${escapeHtml(row.student_names)}</td>
                    <td class="text-cell">${escapeHtml(row.notes)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <div class="small-title">目标课程</div>
          <div class="table-wrap copy-preview-wrap batch-copy-edit-wrap">
            <table class="copy-preview-table batch-copy-edit-table">
              <thead><tr><th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th>学生</th><th>备注</th></tr></thead>
              <tbody>
                ${targetRows.map((row, index) => `
                  <tr>
                    <td>${batchCopySelectCell(index, "teacher_name", row.teacher_name)}</td>
                    <td>${batchCopyInputCell(index, "date", row.date, "date")}</td>
                    <td>${batchCopySelectCell(index, "status", row.status || "待上", { emptyText: "" })}</td>
                    <td class="readonly">${escapeHtml(weekdayCn(row.date))}</td>
                    <td>${batchCopySelectCell(index, "time_slot", row.time_slot)}</td>
                    <td>${batchCopySelectCell(index, "classroom", row.classroom)}</td>
                    <td>${batchCopySelectCell(index, "grade", row.grade)}</td>
                    <td>${batchCopySelectCell(index, "subject", row.subject)}</td>
                    <td>${batchCopyInputCell(index, "student_names", row.student_names)}</td>
                    <td>${batchCopyInputCell(index, "notes", row.notes)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
        <div class="modal-actions">
          <span class="muted-tip">将新增 ${targetRows.length} 节课程，不修改原课程。</span>
          <button class="btn batch-copy-cancel" type="button">取消</button>
          <button class="btn primary batch-copy-confirm" type="button" ${targetRows.length ? "" : "disabled"}>确认新增</button>
        </div>
      </div>
    </div>
  `;
}

function weekCopySourceRows(sourceStart) {
  const dates = new Set(weekDates(sourceStart));
  return sortLessons(state.week_lessons || state.lessons || [])
    .filter((row) => dates.has(row.date))
    .sort((a, b) => `${a.date} ${a.time_slot} ${String(a.id).padStart(8, "0")}`.localeCompare(`${b.date} ${b.time_slot} ${String(b.id).padStart(8, "0")}`, "zh-Hans-CN"));
}

function weekCopyPairs(sourceStart, targetStart) {
  const offset = dayDiff(sourceStart, targetStart);
  return weekCopySourceRows(sourceStart).map((lesson) => ({
    source_id: Number(lesson.id),
    target_date: addDays(lesson.date, offset),
  }));
}

function weekCopyModal() {
  if (!weekCopyDraft) return "";
  const sourceStart = weekCopyDraft.sourceStart || startOfWeek(todayDate());
  const targetStart = weekCopyDraft.targetStart || addDays(sourceStart, 7);
  const rows = weekCopySourceRows(sourceStart);
  const offset = dayDiff(sourceStart, targetStart);
  return `
    <div class="modal-backdrop week-copy-modal">
      <div class="modal-panel week-copy-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">整周复制</div>
            <div class="modal-subtitle">按周中位置对齐复制，源周一对应目标周一。</div>
          </div>
          <button class="btn week-copy-cancel" type="button">取消</button>
        </div>
        <div class="copy-form week-copy-form">
          <label class="filter-field">
            <span>源周周一</span>
            <input class="control week-copy-source" type="date" value="${escapeHtml(sourceStart)}">
          </label>
          <label class="filter-field">
            <span>目标周周一</span>
            <input class="control week-copy-target" type="date" value="${escapeHtml(targetStart)}">
          </label>
        </div>
        <div class="table-wrap copy-preview-wrap">
          <table class="copy-preview-table">
            <thead><tr><th>源日期</th><th>目标日期</th><th>时间</th><th>老师</th><th>学生</th></tr></thead>
            <tbody>
              ${rows.map((row) => `<tr><td class="text-cell">${escapeHtml(row.date)}</td><td class="text-cell">${escapeHtml(addDays(row.date, offset))}</td><td class="text-cell">${escapeHtml(row.time_slot)}</td><td class="text-cell">${escapeHtml(row.teacher_name)}</td><td class="text-cell">${escapeHtml(row.student_names)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">源周暂无课程</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="modal-actions">
          <span class="muted-tip">将复制 ${rows.length} 节课</span>
          <button class="btn week-copy-cancel" type="button">取消</button>
          <button class="btn primary week-copy-confirm" type="button" ${rows.length ? "" : "disabled"}>确认复制</button>
        </div>
      </div>
    </div>
  `;
}

function renderLessons() {
  ensureLessonFilterDates();
  const allRows = lessonDateRangeRows();
  const focusSet = new Set(focusedLessonIds.map(Number).filter(Boolean));
  const rows = visibleLessonRows();
  pruneSelectedLessons(rows);
  const stats = lessonStats(rows);
  const rangeText = formatLessonDateRange();
  const focusNotice = focusSet.size ? `
    <div class="band focus-lesson-panel">
      <div class="focus-lesson-body">
        <div>
          <strong>正在查看冲突相关课程</strong>
          <span>已定位 ${rows.length} 节课程，可直接在下方修改老师、时间、教室或学生。</span>
        </div>
        <button class="btn clear-focused-lessons" type="button">返回全部课程</button>
      </div>
    </div>
  ` : renderLessonFilterBar({ rows: allRows, filteredRows: rows });
  renderTopbar(
    `课程总表：${rangeText}`,
    "",
  );
  contentEl.innerHTML = `
    <div class="summary-grid">
      <div class="metric"><div class="metric-label">课程记录</div><div class="metric-value">${stats.records}</div></div>
      <div class="metric"><div class="metric-label">有效课程</div><div class="metric-value">${stats.effective}</div></div>
      <div class="metric"><div class="metric-label">学生人次</div><div class="metric-value">${stats.studentTotal}</div></div>
      <div class="metric"><div class="metric-label">教师人数</div><div class="metric-value">${stats.teacherCount}</div></div>
    </div>
    ${focusNotice}
    ${lessonToolbarHtml(rows)}
    <div class="band">
      <div class="table-wrap smooth-table-wrap lesson-table-scroll">
        <table class="course-table lesson-table uniform-table nowrap-table ${scheduleMode ? "is-editing" : "is-browsing"}">
          <thead>
            <tr>
              <th class="lesson-select-head col-select"><input class="lesson-select-all" type="checkbox" aria-label="全选当前可见课程" ${rows.length ? "" : "disabled"}></th><th class="col-teacher">授课老师</th><th class="col-date">日期</th><th class="col-status">状态</th><th class="col-weekday">星期</th><th class="col-time">时间</th><th class="col-room">教室</th><th class="col-grade">年级</th><th class="col-subject">科目</th><th class="col-students">学生</th><th class="col-note">备注</th><th class="col-count">学生人数</th><th class="col-index">累计序号</th>
            </tr>
          </thead>
          <tbody id="lessons-tbody"> <!-- [约束1] 固定 id 用于局部重绘定位 -->
            ${lessonRowsHtml(rows)}
          </tbody>
        </table>
      </div>
    </div>
    ${lessonCreateModal()}
    ${lessonBatchCopyModal()}
    ${weekCopyModal()}
    ${lessonConflictModal(rows)}
  `;
  updateLessonSelectionControls(rows);
}

function weekRanges() {
  return naturalWeekRanges(state.settings.month_key || activeMonth);
}

function weekConflictIssues(range) {
  return (state.schedule_conflicts?.issues || [])
    .filter((issue) => !issue.date || range.includes(issue.date))
    .sort((a, b) => `${a.date || ""} ${a.time_slot || ""} ${a.type || ""}`.localeCompare(`${b.date || ""} ${b.time_slot || ""} ${b.type || ""}`, "zh-Hans-CN"));
}

function conflictTypeLabel(type) {
  return {
    teacher: "老师冲突",
    student: "学生冲突",
    classroom: "教室冲突",
    invalid_time: "时间格式",
  }[type] || type || "冲突";
}

function normalizeRoom(value) {
  return String(value ?? "").trim();
}

function isVirtualRoomOne(value) {
  const room = normalizeRoom(value);
  return room === "1" || room === "1.0";
}

function isIgnoredRoomOneConflict(issue) {
  if (!ignoreRoomOneConflict || issue?.type !== "classroom") return false;
  const details = issue.lesson_details || [];
  if (details.length >= 2) return details.every((lesson) => isVirtualRoomOne(lesson.classroom));
  return isVirtualRoomOne(issue.entity);
}

function visibleConflictIssues(issues = []) {
  let ignoredRoomOneCount = 0;
  const visible = [];
  for (const issue of issues || []) {
    if (isIgnoredRoomOneConflict(issue)) {
      ignoredRoomOneCount += 1;
    } else {
      visible.push(issue);
    }
  }
  return { issues: visible, ignoredRoomOneCount };
}

function parseLessonTimeRange(value) {
  const raw = String(value || "")
    .replaceAll("：", ":")
    .replace(/[—–~～至到]/g, "-")
    .replace(/\s+/g, "");
  if (!raw) return null;
  const toMinutes = (token) => {
    const match = String(token || "").match(/^(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  };
  const parts = raw.split("-").filter(Boolean);
  let start = null;
  let end = null;
  if (parts.length >= 2) {
    start = toMinutes(parts[0]);
    end = toMinutes(parts[1]);
  } else {
    const tokens = [...raw.matchAll(/\d{1,2}:?\d{0,2}/g)].map((item) => item[0]);
    if (tokens.length >= 2) {
      start = toMinutes(tokens[0]);
      end = toMinutes(tokens[1]);
    }
  }
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

function scheduleConflictLessonDetail(row) {
  return {
    id: row.id,
    date: row.date || "",
    weekday: weekdayCn(row.date),
    time_slot: row.time_slot || "",
    teacher_name: row.teacher_name || "",
    classroom: row.classroom || "",
    grade: row.grade || "",
    subject: row.subject || "",
    student_names: row.student_names || "",
    status: rowStatus(row),
    notes: row.notes || "",
  };
}

function localScheduleConflicts(rows) {
  const issues = [];
  const parsed = [];
  const activeRows = rows.filter((row) => (
    rowStatus(row) !== "请假"
    && String(row.lesson_status || "").trim() !== "休息"
    && !String(row.course_status || "").trim().startsWith("暂停")
  ));
  const pushIssue = (issue) => issues.push({
    severity: issue.severity || "HIGH",
    type: issue.type,
    date: issue.date || "",
    time_slot: issue.time_slot || "",
    entity: issue.entity || "",
    lesson_ids: issue.lesson_ids || [],
    message: issue.message || "",
    lesson_details: issue.lesson_details || [],
  });
  for (const row of activeRows) {
    const range = parseLessonTimeRange(row.time_slot);
    if (!row.date || !range) {
      pushIssue({
        severity: "MEDIUM",
        type: "invalid_time",
        date: row.date,
        time_slot: row.time_slot,
        entity: `lesson_${row.id}`,
        lesson_ids: [row.id],
        message: "课程日期或时间段无法识别，无法参与冲突判断",
        lesson_details: [scheduleConflictLessonDetail(row)],
      });
      continue;
    }
    parsed.push({ row, ...range });
  }
  for (let i = 0; i < parsed.length; i += 1) {
    for (let j = i + 1; j < parsed.length; j += 1) {
      const a = parsed[i];
      const b = parsed[j];
      if (a.row.date !== b.row.date) continue;
      if (!(a.start < b.end && b.start < a.end)) continue;
      const sharedStudents = splitStudents(a.row.student_names)
        .filter((name) => splitStudents(b.row.student_names).includes(name));
      const lessonIds = [a.row.id, b.row.id].map(Number).filter(Boolean);
      const lessonDetails = [scheduleConflictLessonDetail(a.row), scheduleConflictLessonDetail(b.row)];
      if (a.row.teacher_name && a.row.teacher_name === b.row.teacher_name) {
        pushIssue({
          type: "teacher",
          date: a.row.date,
          time_slot: `${a.row.time_slot} / ${b.row.time_slot}`,
          entity: a.row.teacher_name,
          lesson_ids: lessonIds,
          message: `${a.row.teacher_name} 在重叠时间段有两节课`,
          lesson_details: lessonDetails,
        });
      }
      const roomA = normalizeRoom(a.row.classroom);
      const roomB = normalizeRoom(b.row.classroom);
      if (roomA && roomA === roomB) {
        pushIssue({
          type: "classroom",
          date: a.row.date,
          time_slot: `${a.row.time_slot} / ${b.row.time_slot}`,
          entity: roomA,
          lesson_ids: lessonIds,
          message: `${roomA} 在重叠时间段被重复占用`,
          lesson_details: lessonDetails,
        });
      }
      if (sharedStudents.length) {
        pushIssue({
          type: "student",
          date: a.row.date,
          time_slot: `${a.row.time_slot} / ${b.row.time_slot}`,
          entity: sharedStudents.join("、"),
          lesson_ids: lessonIds,
          message: `${sharedStudents.join("、")} 在重叠时间段有重复课程`,
          lesson_details: lessonDetails,
        });
      }
    }
  }
  return issues.sort((a, b) => `${a.date || ""} ${a.time_slot || ""} ${a.type || ""}`.localeCompare(`${b.date || ""} ${b.time_slot || ""} ${b.type || ""}`, "zh-Hans-CN"));
}

function conflictMapByLesson(issues) {
  const map = new Map();
  for (const issue of visibleConflictIssues(issues).issues) {
    const label = conflictTypeLabel(issue.type);
    for (const id of issue.lesson_ids || []) {
      const key = Number(id);
      if (!key) continue;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(label);
    }
  }
  return map;
}

function scheduleConflictPanel(issues) {
  const conflictView = visibleConflictIssues(issues);
  issues = conflictView.issues;
  const ignoredRoomOneCount = conflictView.ignoredRoomOneCount;
  const counts = { teacher: 0, student: 0, classroom: 0, invalid_time: 0 };
  for (const issue of issues) counts[issue.type] = (counts[issue.type] || 0) + 1;
  const total = issues.length;
  const preview = issues.slice(0, 12);
  return `
    <div class="band schedule-conflict-panel ${total ? "has-conflict" : "ok"}">
      <div class="section-head">
        <div>
          <div class="section-title">时间冲突检查</div>
          <div class="section-subtitle">${total ? `发现 ${total} 条需要确认的排课问题` : "未发现老师、学生或教室时间冲突"}</div>
        </div>
        <div class="conflict-counts">
          <span>老师 ${counts.teacher || 0}</span>
          <span>学生 ${counts.student || 0}</span>
          <span>教室 ${counts.classroom || 0}</span>
          <span>时间 ${counts.invalid_time || 0}</span>
        </div>
      </div>
      <div class="conflict-options">
        <label class="history-toggle">
          <input class="ignore-room-one-conflict" type="checkbox" ${ignoreRoomOneConflict ? "checked" : ""}>
          <span>忽略教室为 1 的教室冲突</span>
        </label>
        ${ignoredRoomOneCount ? `<span class="muted-tip">已忽略教室为 1 的教室占用冲突 ${ignoredRoomOneCount} 条</span>` : ""}
      </div>
      ${total ? `
        <div class="conflict-list">
          ${preview.map((issue) => {
            const details = issue.lesson_details || [];
            const ids = [...new Set([...(issue.lesson_ids || []), ...details.map((lesson) => lesson.id)].map(Number).filter(Boolean))];
            return `
              <div class="conflict-item">
                <div class="conflict-main">
                  <div class="conflict-heading">
                    <span class="severity-pill ${escapeHtml(issue.severity || "HIGH")}">${escapeHtml(conflictTypeLabel(issue.type))}</span>
                    <strong>${escapeHtml(issue.date || "-")} ${escapeHtml(issue.time_slot || "")}</strong>
                  </div>
                  <div class="conflict-message">${escapeHtml(issue.message || "")}</div>
                </div>
                ${ids.length ? `<button class="btn conflict-focus" type="button" data-lesson-ids="${escapeHtml(ids.join(","))}">查看并修改</button>` : ""}
                ${details.length ? `
                  <div class="conflict-lessons">
                    ${details.map((lesson) => {
                      const title = [lesson.date, lesson.weekday, lesson.time_slot].filter(Boolean).join(" ");
                      const meta = [
                        lesson.teacher_name ? `老师：${lesson.teacher_name}` : "",
                        lesson.classroom ? `教室：${lesson.classroom}` : "",
                        `${lesson.grade || ""}${lesson.subject || ""}` || "",
                        lesson.student_names ? `学生：${lesson.student_names}` : "",
                      ].filter(Boolean).join(" · ");
                      const notes = lesson.notes ? ` · 备注：${lesson.notes}` : "";
                      return `
                        <div class="conflict-lesson-line">
                          <strong>${escapeHtml(title || "未填日期时间")}</strong>
                          <span>${escapeHtml(meta + notes)}</span>
                        </div>
                      `;
                    }).join("")}
                  </div>
                ` : ""}
              </div>
            `;
          }).join("")}
          ${issues.length > preview.length ? `<div class="conflict-more">还有 ${issues.length - preview.length} 条，可切换到课程总表或缩小筛选范围后处理。</div>` : ""}
        </div>
      ` : ""}
    </div>
  `;
}

function lessonConflictState(rows = visibleLessonRows()) {
  return visibleConflictIssues(localScheduleConflicts(rows));
}

function lessonConflictButtonHtml(rows) {
  const total = lessonConflictState(rows).issues.length;
  return `
    <button class="btn lesson-conflict-btn ${total ? "conflict-found" : "conflict-ok"}" type="button" ${total ? "" : "disabled"} aria-label="当前筛选结果冲突数量 ${total}">
      冲突为${total}
    </button>
  `;
}

function updateLessonConflictButton(rows = visibleLessonRows()) {
  const button = document.querySelector(".lesson-conflict-btn");
  if (!button) return;
  const total = lessonConflictState(rows).issues.length;
  button.textContent = `冲突为${total}`;
  button.disabled = total === 0;
  button.classList.toggle("conflict-found", total > 0);
  button.classList.toggle("conflict-ok", total === 0);
  button.setAttribute("aria-label", `当前筛选结果冲突数量 ${total}`);
}

function conflictLessonDetailMarkup(lesson) {
  const items = [
    ["日期", lesson.date || ""],
    ["星期", lesson.weekday || weekdayCn(lesson.date)],
    ["时间", lesson.time_slot || ""],
    ["授课老师", lesson.teacher_name || ""],
    ["教室", lesson.classroom || ""],
    ["年级", lesson.grade || ""],
    ["科目", lesson.subject || ""],
    ["学生", lesson.student_names || ""],
    ["状态", lesson.status || ""],
  ].filter(([, value]) => String(value || "").trim());
  return `
    <div class="conflict-lesson-detail">
      ${items.map(([label, value]) => `
        <span><b>${escapeHtml(label)}</b>${escapeHtml(value)}</span>
      `).join("")}
    </div>
  `;
}

function conflictIssueMarkup(issue) {
  const details = issue.lesson_details || [];
  const ids = [...new Set([...(issue.lesson_ids || []), ...details.map((lesson) => lesson.id)].map(Number).filter(Boolean))];
  return `
    <div class="conflict-item">
      <div class="conflict-main">
        <div class="conflict-heading">
          <span class="severity-pill ${escapeHtml(issue.severity || "HIGH")}">${escapeHtml(conflictTypeLabel(issue.type))}</span>
          <strong>${escapeHtml(issue.date || "-")} ${escapeHtml(issue.time_slot || "")}</strong>
        </div>
        <div class="conflict-message">${escapeHtml(issue.message || "")}</div>
      </div>
      ${ids.length ? `<button class="btn conflict-focus" type="button" data-lesson-ids="${escapeHtml(ids.join(","))}">定位课程</button>` : ""}
      ${details.length ? `<div class="conflict-lessons">${details.map(conflictLessonDetailMarkup).join("")}</div>` : ""}
    </div>
  `;
}

function lessonConflictModal(rows) {
  if (!lessonConflictModalOpen) return "";
  const conflictView = lessonConflictState(rows);
  const issues = conflictView.issues;
  const ignoredRoomOneCount = conflictView.ignoredRoomOneCount;
  const counts = { teacher: 0, student: 0, classroom: 0, invalid_time: 0 };
  for (const issue of issues) counts[issue.type] = (counts[issue.type] || 0) + 1;
  return `
    <div class="modal-backdrop lesson-conflict-modal">
      <div class="modal-panel lesson-conflict-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">时间冲突检查</div>
            <div class="modal-subtitle">当前筛选结果 ${rows.length} 节课程，发现 ${issues.length} 条时间冲突。</div>
          </div>
          <button class="btn lesson-conflict-modal-close" type="button">关闭</button>
        </div>
        <div class="conflict-options">
          <label class="history-toggle">
            <input class="ignore-room-one-conflict" type="checkbox" ${ignoreRoomOneConflict ? "checked" : ""}>
            <span>忽略教室为 1 的教室冲突</span>
          </label>
          ${ignoredRoomOneCount ? `<span class="muted-tip">已忽略教室为 1 的教室占用冲突 ${ignoredRoomOneCount} 条</span>` : ""}
        </div>
        <div class="conflict-counts lesson-conflict-counts">
          <span>老师 ${counts.teacher || 0}</span>
          <span>学生 ${counts.student || 0}</span>
          <span>教室 ${counts.classroom || 0}</span>
          <span>时间 ${counts.invalid_time || 0}</span>
        </div>
        ${issues.length ? `
          <div class="conflict-list lesson-conflict-list">
            ${issues.map(conflictIssueMarkup).join("")}
          </div>
        ` : `<div class="empty">未发现时间冲突</div>`}
      </div>
    </div>
  `;
}

function timeSlotSortValue(value) {
  const match = String(value || "").match(/(\d{1,2})[:：点时]?(\d{2})?/);
  if (!match) return 9999;
  return Number(match[1]) * 60 + Number(match[2] || 0);
}

function weekDayColumns(range, rows = null) {
  const activeDates = rows
    ? new Set(rows.map((row) => row.date).filter(Boolean))
    : null;
  const dates = dateRangeDates(range.start_date, range.end_date)
    .filter((date) => !activeDates || activeDates.has(date));
  return dates.map((date) => ({
    date,
    weekday: weekdayCn(date),
    short: `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`,
    inMonth: monthKeyFromDateValue(date) === (state.settings.month_key || activeMonth),
  }));
}

function weekGrid(rows, range) {
  const days = weekDayColumns(range, rows);
  const timeSlots = uniqueSorted(rows.map((row) => row.time_slot || "未填时间"))
    .sort((a, b) => timeSlotSortValue(a) - timeSlotSortValue(b) || a.localeCompare(b, "zh-Hans-CN"));
  const byCell = new Map();
  for (const row of rows) {
    const key = `${row.time_slot || "未填时间"}|${row.date}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(row);
  }
  return { days, timeSlots, byCell };
}

function weekGridLessonCard(row, conflictMap = new Map()) {
  const course = `${row.grade || ""}${row.subject || ""}` || "课程";
  const meta = [
    row.teacher_name ? `<span>老师：${escapeHtml(row.teacher_name)}</span>` : "",
    row.classroom ? `<span>教室：${escapeHtml(row.classroom)}</span>` : "",
  ].filter(Boolean).join("");
  const students = splitStudents(row.student_names).join("、");
  const notes = row.notes ? `<div class="week-grid-notes">${escapeHtml(row.notes)}</div>` : "";
  const conflictLabels = [...(conflictMap.get(Number(row.id)) || [])];
  const conflictBadges = conflictLabels.length
    ? `<div class="week-grid-conflicts">${conflictLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>`
    : "";
  return `
    <div class="week-grid-card ${isAbnormal(row) ? "abnormal" : ""} ${conflictLabels.length ? "has-conflict" : ""}">
      <div class="week-grid-course">${escapeHtml(course)} ${statusBadge(rowStatus(row))}</div>
      ${conflictBadges}
      <div class="week-grid-meta">${meta}</div>
      <div class="week-grid-students">${escapeHtml(students || "未填学生")}</div>
      ${notes}
    </div>
  `;
}

function renderWeekGrid(rows, range, conflicts = []) {
  const { days, timeSlots, byCell } = weekGrid(rows, range);
  const conflictMap = conflictMapByLesson(conflicts);
  const rangeDays = dateRangeDates(range.start_date, range.end_date);
  const compact = rangeDays.length > 10;
  if (compact) {
    return `
      <div class="band week-grid-panel">
        <div class="section-head">
          <div>
            <div class="section-title">核对课表</div>
            <div class="section-subtitle">按所选日期范围汇总，只显示有课程的日期。</div>
          </div>
        </div>
        <div class="week-grid-sparse">
          ${timeSlots.map((slot) => {
            const activeDays = days.filter((day) => (byCell.get(`${slot}|${day.date}`) || []).length);
            return `
              <div class="week-grid-sparse-row">
                <div class="week-grid-sparse-time">${escapeHtml(slot)}</div>
                <div class="week-grid-sparse-cells">
                  ${activeDays.map((day) => {
                    const lessons = byCell.get(`${slot}|${day.date}`) || [];
                    return `
                      <div class="week-grid-sparse-cell ${day.inMonth ? "" : "outside-month"}">
                        <div class="week-grid-sparse-date">
                          <strong>${escapeHtml(day.weekday)}</strong>
                          <span>${escapeHtml(day.short)}</span>
                        </div>
                        ${lessons.map((lesson) => weekGridLessonCard(lesson, conflictMap)).join("")}
                      </div>
                    `;
                  }).join("") || `<div class="week-grid-sparse-empty">这个时间段暂无课程</div>`}
                </div>
              </div>
            `;
          }).join("") || `<div class="empty">当前日期范围暂无课程</div>`}
        </div>
      </div>
    `;
  }
  return `
    <div class="band week-grid-panel">
      <div class="section-head">
        <div>
          <div class="section-title">核对课表</div>
          <div class="section-subtitle">按所选日期范围汇总，空白日期自动隐藏。</div>
        </div>
      </div>
      <div class="week-grid-scroll">
        <table class="week-grid-table">
          <thead>
            <tr>
              <th class="week-grid-time-head">时间</th>
              ${days.map((day) => `<th class="${day.inMonth ? "" : "outside-month"}"><strong>${escapeHtml(day.weekday)}</strong><span>${escapeHtml(day.short)}</span></th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${timeSlots.map((slot) => `
              <tr>
                <th class="week-grid-time">${escapeHtml(slot)}</th>
                ${days.map((day) => {
                  const lessons = byCell.get(`${slot}|${day.date}`) || [];
                  return `<td class="${day.inMonth ? "" : "outside-month"}">${lessons.map((lesson) => weekGridLessonCard(lesson, conflictMap)).join("") || `<span class="week-grid-empty">-</span>`}</td>`;
                }).join("")}
              </tr>
            `).join("") || `<tr><td colspan="${Math.max(1, days.length + 1)}" class="empty">当前日期范围暂无课程</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderMatrixViewTabs() {
  const tabs = [
    ["time", "时间课表"],
    ["teacher", "老师课表"],
    ["classroom", "教室课表"],
  ];
  if (!tabs.some(([key]) => key === matrixView)) matrixView = "time";
  return `
    <div class="tabs matrix-view-tabs">
      ${tabs.map(([key, label]) => `<button class="tab matrix-view-tab ${matrixView === key ? "active" : ""}" type="button" data-matrix-view="${key}">${escapeHtml(label)}</button>`).join("")}
    </div>
  `;
}

function matrixDimensionEntity(row, type) {
  if (type === "teacher") return String(row.teacher_name || "").trim() || "未填老师";
  return String(row.classroom || "").trim() || "未填教室";
}

function matrixDayHeader(date) {
  const day = Number(String(date || "").slice(8, 10));
  return `${day || ""}日${weekdayCn(date) || ""}`;
}

function matrixDimensionCard(row, type) {
  const course = `${row.grade || ""}${row.subject || ""}` || "课程";
  const meta = type === "teacher"
    ? [row.classroom ? `教室：${row.classroom}` : "", course, splitStudents(row.student_names).join("、") || "未填学生"]
    : [row.teacher_name ? `老师：${row.teacher_name}` : "", course, splitStudents(row.student_names).join("、") || "未填学生"];
  const notes = row.notes ? `<div class="matrix-dimension-note">${escapeHtml(row.notes)}</div>` : "";
  return `
    <div class="matrix-dimension-card ${isAbnormal(row) ? "abnormal" : ""}">
      <div class="matrix-dimension-time">${escapeHtml(row.time_slot || "未填时间")} ${statusBadge(rowStatus(row))}</div>
      <div class="matrix-dimension-meta">${meta.filter(Boolean).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      ${notes}
    </div>
  `;
}

function renderMatrixDimensionGrid(rows, range, type) {
  const days = dateRangeDates(range.start_date, range.end_date).map((date) => ({
    date,
    label: matrixDayHeader(date),
  }));
  const entities = uniqueSorted(rows.map((row) => matrixDimensionEntity(row, type)));
  const byCell = new Map();
  for (const row of rows) {
    const key = `${matrixDimensionEntity(row, type)}|${row.date || ""}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(row);
  }
  byCell.forEach((items) => items.sort((a, b) => timeSlotSortValue(a.time_slot) - timeSlotSortValue(b.time_slot) || String(a.time_slot || "").localeCompare(String(b.time_slot || ""), "zh-Hans-CN")));
  const title = type === "teacher" ? "老师课表" : "教室课表";
  const firstCol = type === "teacher" ? "老师" : "教室";
  return `
    <div class="band matrix-dimension-panel">
      <div class="section-head">
        <div>
          <div class="section-title">${escapeHtml(title)}</div>
          <div class="section-subtitle">${escapeHtml(firstCol)} × 日期展示当前筛选课程，空单元格保持空白。</div>
        </div>
      </div>
      <div class="week-grid-scroll matrix-dimension-scroll">
        <table class="matrix-dimension-table uniform-table">
          <thead>
            <tr>
              <th class="matrix-dimension-entity-head">${escapeHtml(firstCol)}</th>
              ${days.map((day) => `<th>${escapeHtml(day.label)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${entities.map((entity) => `
              <tr>
                <th class="matrix-dimension-entity">${escapeHtml(entity)}</th>
                ${days.map((day) => {
                  const lessons = byCell.get(`${entity}|${day.date}`) || [];
                  return `<td>${lessons.map((lesson) => matrixDimensionCard(lesson, type)).join("")}</td>`;
                }).join("")}
              </tr>
            `).join("") || `<tr><td colspan="${Math.max(1, days.length + 1)}" class="empty">当前筛选下暂无课程</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderMatrixScheduleView(rows, range, conflicts = []) {
  if (matrixView === "teacher") return renderMatrixDimensionGrid(rows, range, "teacher");
  if (matrixView === "classroom") return renderMatrixDimensionGrid(rows, range, "classroom");
  return renderWeekGrid(rows, range, conflicts);
}

function weekViewData({ customRange = false } = {}) {
  ensureLessonFilterDates();
  const ranges = weekRanges();
  if (activeWeek >= ranges.length) activeWeek = Math.max(0, ranges.length - 1);
  ensureMatrixRange();
  const weekRange = ranges[activeWeek] || ranges[0];
  const range = customRange
    ? {
      start_date: matrixRange.start,
      end_date: matrixRange.end,
      label: `${Number(matrixRange.start.slice(5, 7))}.${Number(matrixRange.start.slice(8, 10))}-${Number(matrixRange.end.slice(5, 7))}.${Number(matrixRange.end.slice(8, 10))}`,
      custom: true,
      includes(value) {
        return value >= matrixRange.start && value <= matrixRange.end;
      },
    }
    : weekRange;
  const weekRows = sortLessons(state.week_lessons || state.lessons || [])
    .filter((row) => range.includes(row.date));
  const rows = weekRows
    .filter((row) => lessonMatchesFilter(row, lessonFilter, { includeDate: false, includeStatus: false, includeQuery: false }))
    .sort((a, b) => `${a.date || ""} ${a.teacher_name || ""} ${a.time_slot || ""}`.localeCompare(`${b.date || ""} ${b.teacher_name || ""} ${b.time_slot || ""}`, "zh-Hans-CN"));
  const conflicts = [];
  return { ranges, range, weekRows, rows, conflicts };
}

function renderWeekTabs(ranges) {
  return `
    <div class="tabs">
      ${ranges.map((item, index) => `<button class="tab week-tab ${activeWeek === index ? "active" : ""}" data-week="${index}">${escapeHtml(item.label)}</button>`).join("")}
    </div>
  `;
}

function renderMatrixDateFilter() {
  ensureMatrixRange();
  return `
    <div class="filter-bar compact matrix-date-filter">
      <label>日期范围</label>
      ${dateRangePickerControl({ scope: "matrix", start: matrixRange.start, end: matrixRange.end, placeholder: "选择矩阵课表日期范围" })}
      <button class="btn matrix-range-reset" type="button">恢复当前周</button>
    </div>
  `;
}

function weekDetailGroupKey(row) {
  const teacherName = String(row?.teacher_name ?? "").trim();
  const date = String(row?.date ?? "").trim();
  return `${teacherName}__${date}`;
}

function renderWeek() {
  const { ranges, range, weekRows, rows, conflicts } = weekViewData();
  const showSalary = canArea("salary");
  let groupIndex = -1;
  let lastGroupKey = null;
  const decoratedRows = rows.map((row) => {
    const groupKey = weekDetailGroupKey(row);
    if (groupKey !== lastGroupKey) {
      groupIndex += 1;
      lastGroupKey = groupKey;
    }
    return { row, depthClass: `lesson-row-depth-${groupIndex % 2}` };
  });
  renderTopbar(
    `${monthLabel()} 周课表`,
    `${range.label} · 已筛选 ${rows.length} / 共 ${weekRows.length} 节`,
  );
  contentEl.innerHTML = `
    ${renderWeekTabs(ranges)}
    ${renderLessonFilterBar({ rows: weekRows, filteredRows: rows, compact: true })}
    <div class="band">
      <div class="table-wrap smooth-table-wrap compact-table-scroll week-detail-scroll">
        <table class="course-table week-detail-table uniform-table nowrap-table">
          <thead>
            <tr><th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th class="wide">学生</th><th class="wide">备注</th>${showSalary ? "<th>教师薪资</th>" : ""}<th>学生人数</th></tr>
          </thead>
          <tbody>
            ${decoratedRows.map(({ row, depthClass }) => {
              const rowClass = [isAbnormal(row) ? "abnormal" : "", depthClass].filter(Boolean).join(" ");
              return `
                <tr class="${rowClass}">
                  <td class="text-cell">${escapeHtml(row.teacher_name)}</td>
                  <td class="text-cell">${escapeHtml(row.date)}</td>
                  <td class="text-cell">${statusBadge(rowStatus(row))}</td>
                  <td class="text-cell">${escapeHtml(weekdayCn(row.date))}</td>
                  <td class="text-cell">${escapeHtml(row.time_slot)}</td>
                  <td class="text-cell">${escapeHtml(row.classroom)}</td>
                  <td class="text-cell">${escapeHtml(row.grade)}</td>
                  <td class="text-cell">${escapeHtml(row.subject)}</td>
                  <td class="text-cell">${escapeHtml(row.student_names)}</td>
                  <td class="text-cell">${escapeHtml(row.notes)}</td>
                  ${showSalary ? `<td class="text-cell right">${formatMoney(displayTeacherSalaryForLesson(row))}</td>` : ""}
                  <td class="text-cell">${splitStudents(row.student_names).length}</td>
                </tr>
              `;
            }).join("") || `<tr><td colspan="${showSalary ? 12 : 11}" class="empty">本周暂无课程</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderWeekMatrix() {
  const { ranges, range, weekRows, rows, conflicts } = weekViewData({ customRange: true });
  renderTopbar(
    `${monthLabel()} 矩阵课表`,
    `${range.label} · 已筛选 ${rows.length} / 共 ${weekRows.length} 节`,
  );
  contentEl.innerHTML = `
    ${renderWeekTabs(ranges)}
    ${renderMatrixDateFilter()}
    ${renderMatrixViewTabs()}
    ${renderLessonFilterBar({ rows: weekRows, filteredRows: rows, compact: true })}
    ${renderMatrixScheduleView(rows, range, conflicts)}
  `;
}

function renderFeeDetails() {
  ensureFeeDetailsFilterMonth();
  const rows = state.derived.fee_details;
  const visibleRows = rows.filter((row) => feeDetailMatchesFilter(row));
  const selectableRows = visibleRows.filter(canApplyStudentPricingRule);
  const selectableKeys = new Set(selectableRows.map(feeDetailKey));
  selectedFeeDetailKeys = new Set([...selectedFeeDetailKeys].filter((key) => selectableKeys.has(key)));
  const selectedCount = selectedFeeDetailKeys.size;
  const allSelectableChecked = selectableRows.length > 0 && selectedCount === selectableRows.length;
  const total = visibleRows.filter((row) => row.effective).reduce((sum, row) => sum + numberValue(row.unit_price), 0);
  renderTopbar(`${monthLabel()} 学生费用明细`, `已筛选 ${visibleRows.length} / 共 ${rows.length} 条，有效费用合计 ${formatMoney(total)}`);
  contentEl.innerHTML = `
    <div class="band">
      ${renderFeeDetailsFilterBar(rows, visibleRows)}
      <div class="bulk-action-row fee-detail-bulk-actions">
        <button class="btn primary apply-selected-student-pricing-rules" type="button" ${bulkActionDisabledAttr(selectedCount)}>${bulkActionText("按规则更新所选费用", selectedCount)}</button>
        <span class="muted-tip">仅更新已勾选且命中有效学生单价规则的费用明细。</span>
      </div>
      <div class="table-wrap smooth-table-wrap compact-table-scroll fee-detail-scroll">
        <table class="fee-detail-table uniform-table nowrap-table">
          <thead>
            <tr>
              <th class="select-col"><input class="fee-detail-select-all" type="checkbox" ${allSelectableChecked ? "checked" : ""} ${selectableRows.length ? "" : "disabled"} title="全选当前可按规则更新的费用明细"></th>
              <th>学生姓名</th><th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th class="wide note-head">备注</th><th>单人费用</th><th>规则费用</th>
            </tr>
          </thead>
          <tbody>
            ${visibleRows.map((row) => {
              const canApply = canApplyStudentPricingRule(row);
              const key = feeDetailKey(row);
              return `
              <tr class="${detailRowClass(row)}">
                <td class="select-col"><input class="fee-detail-select-row" type="checkbox" data-lesson-id="${row.lesson_id}" data-student-name="${escapeHtml(row.student_name)}" ${selectedFeeDetailKeys.has(key) ? "checked" : ""} ${canApply ? "" : "disabled"} title="${escapeHtml(feeDetailSelectTitle(row))}"></td>
                <td class="text-cell">${escapeHtml(row.student_name)}</td>
                <td class="text-cell">${escapeHtml(row.teacher_name)}</td>
                <td class="text-cell">${escapeHtml(row.date)}</td>
                <td class="text-cell">${statusBadge(rowStatus(row))}</td>
                <td class="text-cell">${escapeHtml(row.weekday)}</td>
                <td class="text-cell">${escapeHtml(row.time_slot)}</td>
                <td class="text-cell">${escapeHtml(row.classroom)}</td>
                <td class="text-cell">${escapeHtml(row.grade)}</td>
                <td class="text-cell">${escapeHtml(row.subject)}</td>
                <td class="text-cell">${escapeHtml(row.notes)}</td>
                ${editablePriceCell(row)}
                <td class="text-cell right">${row.rule_price == null ? "" : formatMoney(row.rule_price)}</td>
              </tr>
            `;
            }).join("") || `<tr><td colspan="13" class="empty">暂无费用明细</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderSummary() {
  const rows = summaryRows();
  const visibleRows = rows.filter((row) => summaryMatchesFilter(row));
  const totalFee = rows.reduce((sum, row) => sum + numberValue(row.total_fee), 0);
  const totalBalance = rows.reduce((sum, row) => sum + numberValue(row.actual_balance) + numberValue(row.gift_balance), 0);
  renderTopbar(
    `${monthLabel()} 学生费用汇总`,
    `课程费用 ${formatMoney(totalFee)}，余额合计 ${formatMoney(totalBalance)}`,
  );
  contentEl.innerHTML = `
    <div class="band">
      ${renderSummaryFilterBar(rows, visibleRows)}
      <div class="table-wrap smooth-table-wrap">
        <table class="student-summary-table uniform-table nowrap-table">
          <thead>
            <tr><th>学生姓名</th><th>年级</th><th>上课次数</th><th>课程总费用</th><th>上月实际结转</th><th>上月赠送结转</th><th>本月实际充值</th><th>本月赠送充值</th><th>本月实际消费</th><th>本月赠送消费</th><th>本月实际余额</th><th>本月赠送余额</th></tr>
          </thead>
          <tbody>
            ${visibleRows.map((row) => `
                <tr class="summary-master-row"${gradeRowStyle(row.grade)}>
                  <td class="text-cell">${escapeHtml(row.student_name)}</td>
                  <td class="text-cell grade-cell">${escapeHtml(row.grade)}</td>
                  <td class="text-cell">${Math.round(numberValue(row.lesson_count))}</td>
                  <td class="text-cell right">${formatMoney(row.total_fee)}</td>
                  <td class="text-cell right ${numberValue(row.prev_actual) < 0 ? "negative" : ""}">${formatMoney(row.prev_actual)}</td>
                  <td class="text-cell right ${numberValue(row.prev_gift) < 0 ? "negative" : ""}">${formatMoney(row.prev_gift)}</td>
                  <td class="text-cell right ${numberValue(row.cur_recharge) < 0 ? "negative" : ""}">${formatMoney(row.cur_recharge)}</td>
                  <td class="text-cell right ${numberValue(row.cur_gift) < 0 ? "negative" : ""}">${formatMoney(row.cur_gift)}</td>
                  <td class="text-cell right">${formatMoney(row.actual_consumption)}</td>
                  <td class="text-cell right">${formatMoney(row.gift_consumption)}</td>
                  <td class="text-cell right ${numberValue(row.actual_balance) < 0 ? "negative" : ""}">${formatMoney(row.actual_balance)}</td>
                  <td class="text-cell right ${numberValue(row.gift_balance) < 0 ? "negative" : ""}">${formatMoney(row.gift_balance)}</td>
                </tr>
              `).join("") || `<tr><td colspan="12" class="empty">暂无学生费用汇总</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function pctChangeValue(current, previous) {
  if (!previous) return current ? null : 0;
  return (current - previous) / Math.abs(previous);
}

function combinedMetric(...metrics) {
  const current = metrics.reduce((sum, metric) => sum + numberValue(metric?.current), 0);
  const previous = metrics.reduce((sum, metric) => sum + numberValue(metric?.previous), 0);
  return { current, previous, mom_pct: pctChangeValue(current, previous) };
}

function financeMetric(label, metric, options = {}) {
  const { reverse = false, subtitle = "", title = "" } = options;
  const cls = momClass(metric?.mom_pct, reverse);
  const current = numberValue(metric?.current);
  const previous = numberValue(metric?.previous);
  const fullValue = formatMoney(current);
  const displayValue = Math.abs(current) >= 10000000 ? `${current < 0 ? "-" : ""}¥${compactMoney(Math.abs(current))}` : fullValue;
  const delta = metric?.mom_pct == null
    ? `无上期（上期 ${formatMoney(previous)}）`
    : `${metric.mom_pct >= 0 ? "▲" : "▼"}${metric.mom_pct >= 0 ? "+" : ""}${(metric.mom_pct * 100).toFixed(1)}%（上期 ${formatMoney(previous)}）`;
  const cardTitle = [title, displayValue !== fullValue ? fullValue : ""].filter(Boolean).join(" / ");
  return `
    <div class="finance-kpi" ${cardTitle ? `title="${escapeHtml(cardTitle)}"` : ""}>
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="finance-kpi-value">${escapeHtml(displayValue)}</div>
      <div class="mom ${cls}">${escapeHtml(delta)}</div>
      ${subtitle ? `<div class="kpi-subtitle">${escapeHtml(subtitle)}</div>` : ""}
    </div>
  `;
}

function financeQualityNotices(summary) {
  const notices = [];
  const quality = summary.data_quality || {};
  const missingTeacherSalary = numberValue(quality.teacher_salary_missing_lessons);
  const salaryLessons = numberValue(quality.teacher_salary_lessons);
  if (salaryLessons > 0 && missingTeacherSalary > 0) {
    notices.push({
      title: "教师课时费待录入",
      body: `${missingTeacherSalary} / ${salaryLessons} 节有效课还没有课时费，当前毛利和 ROI 是暂估口径。`,
    });
  }
  const debt = numberValue(summary.balance_sheet?.account_debt_receivable);
  if (debt > 0) {
    notices.push({
      title: "存在账户欠款",
      body: `学生现金余额为负的欠款合计 ${formatMoney(debt)}，已并入应收合计。`,
    });
  }
  if (!notices.length) return "";
  return `
    <div class="finance-notice-list">
      ${notices.map((item) => `
        <div class="finance-notice">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.body)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function profitTable(summary) {
  const rows = [
    ["收入", summary.overview.revenue, false, true, "pct"],
    ["赠送消耗", summary.overview.gift_consumption, false, true, "pct"],
    ["课时费", summary.overview.teacher_cost, true, true, "pct"],
    ["交通", summary.overview.transport_cost, true, true, "pct"],
    ["运营成本", summary.overview.operating_cost, true, true, "pct"],
    ["毛利", summary.overview.gross_profit, false, true, "pct"],
    ["毛利率", summary.overview.gross_margin, false, false, "pp"],
  ];
  return rows.map(([label, metric, reverse, isMoney, deltaType]) => {
    const delta = deltaType === "pp" ? metric.mom_pp : metric.mom_pct;
    const deltaLabel = deltaType === "pp" ? momPointLabel(delta) : momLabel(delta);
    return `
    <tr>
      <td class="text-cell">${escapeHtml(label)}</td>
      <td class="text-cell right">${isMoney ? formatMoney(metric.current) : percent(metric.current)}</td>
      <td class="text-cell right">${isMoney ? formatMoney(metric.previous) : percent(metric.previous)}</td>
      <td class="text-cell right mom ${momClass(delta, reverse)}">${escapeHtml(deltaLabel)}</td>
    </tr>
  `;
  }).join("");
}

function stackedBar(title, segments) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, numberValue(segment.value)), 0);
  if (!total) {
    return `
      <div class="stacked-row">
        <div class="stacked-title">${escapeHtml(title)}</div>
        <svg class="stacked-svg" viewBox="0 0 800 40" role="img" aria-label="${escapeHtml(title)}">
          <rect x="0" y="8" width="800" height="24" rx="6" fill="var(--line-soft)"></rect>
          <text x="12" y="26" fill="var(--muted)">暂无数据</text>
        </svg>
      </div>
    `;
  }
  let x = 0;
  const rects = segments.map((segment) => {
    const value = Math.max(0, numberValue(segment.value));
    const width = value / total * 800;
    const pct = value / total;
    const currentX = x;
    x += width;
    const label = `${segment.label} ${formatMoney(value)} (${(pct * 100).toFixed(0)}%)`;
    return `
      <g>
        <title>${escapeHtml(label)}</title>
        <rect x="${currentX.toFixed(2)}" y="8" width="${Math.max(0, width).toFixed(2)}" height="24" rx="6" fill="${segment.color}"></rect>
        ${pct >= 0.04 ? `<text x="${(currentX + 8).toFixed(2)}" y="26" fill="${segment.textColor || "var(--panel)"}">${escapeHtml(label)}</text>` : ""}
      </g>
    `;
  }).join("");
  return `
    <div class="stacked-row">
      <div class="stacked-title">${escapeHtml(title)}</div>
      <svg class="stacked-svg" viewBox="0 0 800 40" role="img" aria-label="${escapeHtml(title)}">${rects}</svg>
    </div>
  `;
}

function compositionDonut(title, segments) {
  const clean = segments
    .map((segment) => ({ ...segment, value: Math.max(0, numberValue(segment.value)) }))
    .filter((segment) => segment.value > 0);
  const total = clean.reduce((sum, segment) => sum + segment.value, 0);
  if (!total) {
    return `
      <div class="composition-card empty">
        <div class="composition-title">${escapeHtml(title)}</div>
        <div class="composition-empty">${"\u6682\u65e0\u6570\u636e"}</div>
      </div>
    `;
  }

  const size = 132;
  const center = size / 2;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs = clean.map((segment) => {
    const pct = segment.value / total;
    const dash = pct * circumference;
    const currentOffset = offset;
    offset += dash;
    const label = `${segment.label} ${formatMoney(segment.value)} (${(pct * 100).toFixed(1)}%)`;
    return `
      <circle class="donut-segment" cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${segment.color}" stroke-width="18" stroke-linecap="${clean.length > 1 ? "round" : "butt"}" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" stroke-dashoffset="${(-currentOffset).toFixed(2)}" transform="rotate(-90 ${center} ${center})">
        <title>${escapeHtml(label)}</title>
      </circle>
    `;
  }).join("");
  const legend = clean.map((segment) => {
    const pct = segment.value / total;
    return `
      <li>
        <span class="donut-key" style="background:${segment.color}"></span>
        <span class="donut-label">${escapeHtml(segment.label)}</span>
        <span class="donut-value">${formatMoney(segment.value)}</span>
        <span class="donut-pct">${(pct * 100).toFixed(1)}%</span>
      </li>
    `;
  }).join("");

  return `
    <div class="composition-card">
      <div class="composition-title">${escapeHtml(title)}</div>
      <div class="composition-body">
        <svg class="donut-svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(title)}">
          <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="var(--line-soft)" stroke-width="18"></circle>
          ${arcs}
          <text class="donut-total-label" x="${center}" y="${center - 6}" text-anchor="middle">${"\u5408\u8ba1"}</text>
          <text class="donut-total-value" x="${center}" y="${center + 16}" text-anchor="middle">${escapeHtml(compactMoney(total))}</text>
        </svg>
        <ul class="donut-legend">${legend}</ul>
      </div>
    </div>
  `;
}

function compactMoney(value) {
  const n = numberValue(value);
  const abs = Math.abs(n);
  if (abs >= 10000) return `${n < 0 ? "-¥" : "¥"}${(abs / 10000).toFixed(1)}万`;
  return formatMoney(n);
}

function chartPointPath(points) {
  return points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

function chartSmoothPath(points) {
  if (!points.length) return "";
  if (points.length < 3) return chartPointPath(points);
  let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const midX = (p1.x + p2.x) / 2;
    path += ` C${midX.toFixed(1)},${p1.y.toFixed(1)} ${midX.toFixed(1)},${p2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return path;
}

function chartAreaPath(points, baselineY) {
  if (!points.length) return "";
  const line = chartSmoothPath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L${last.x.toFixed(1)},${baselineY.toFixed(1)} L${first.x.toFixed(1)},${baselineY.toFixed(1)} Z`;
}

function financeTrendChart(rows) {
  const data = (rows || []).slice(-12);
  if (!data.length) return `<div class="trend-empty">暂无走势数据</div>`;
  const width = 820;
  const height = 380;
  const margin = { left: 60, right: 58, top: 48, bottom: 54 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const profits = data.map((row) => numberValue(row.gross_profit));
  const rates = data.map((row) => numberValue(row.gross_margin));
  const pMax = Math.max(0, ...profits);
  const pMin = Math.min(0, ...profits);
  const pSpan = (pMax - pMin) || 1;
  const rMax = Math.max(0.01, ...rates);
  const rMin = Math.min(0, ...rates);
  const rSpan = (rMax - rMin) || 1;
  const x = (index) => margin.left + (data.length <= 1 ? innerW / 2 : index * innerW / (data.length - 1));
  const yP = (value) => margin.top + (pMax - value) / pSpan * innerH;
  const yR = (value) => margin.top + (rMax - value) / rSpan * innerH;
  const profitPoints = data.map((row, index) => ({ x: x(index), y: yP(numberValue(row.gross_profit)) }));
  const ratePoints = data.map((row, index) => ({ x: x(index), y: yR(numberValue(row.gross_margin)) }));
  const profitLine = chartSmoothPath(profitPoints);
  const profitArea = chartAreaPath(profitPoints, Math.max(margin.top, Math.min(margin.top + innerH, yP(0))));
  const rateLine = chartSmoothPath(ratePoints);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = margin.top + ratio * innerH;
    const profitValue = pMax - ratio * pSpan;
    const rateValue = rMax - ratio * rSpan;
    return `
      <line class="trend-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"></line>
      <text class="trend-tick" x="${margin.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${escapeHtml(compactMoney(profitValue))}</text>
      <text class="trend-tick" x="${width - margin.right + 8}" y="${(y + 4).toFixed(1)}">${escapeHtml(percent(rateValue))}</text>
    `;
  }).join("");
  const peakIndex = profits.indexOf(Math.max(...profits));
  const points = data.map((row, index) => {
    const px = x(index);
    const py = yP(numberValue(row.gross_profit));
    const ry = yR(numberValue(row.gross_margin));
    const month = `${String(row.month || "").slice(5, 7)}月`;
    const showLabel = index === 0 || index === data.length - 1 || index === peakIndex;
    const label = showLabel
      ? `<text class="trend-label" x="${px.toFixed(1)}" y="${(py - 12).toFixed(1)}" text-anchor="middle">${escapeHtml(compactMoney(row.gross_profit))}</text>`
      : "";
    return `
      <g>
        <title>${escapeHtml(`${month}：毛利 ${formatMoney(row.gross_profit)} / 毛利率 ${percent(row.gross_margin)}`)}</title>
        <circle class="trend-profit-point" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.8"></circle>
        <circle class="trend-rate-point" cx="${px.toFixed(1)}" cy="${ry.toFixed(1)}" r="3.4"></circle>
        ${label}
        <text class="trend-month" x="${px.toFixed(1)}" y="${height - margin.bottom + 18}" text-anchor="middle">${escapeHtml(month)}</text>
      </g>
    `;
  }).join("");
  const legend = `
    <g class="trend-legend" transform="translate(${margin.left}, 18)">
      <rect class="trend-legend-profit" x="0" y="-6" width="22" height="10" rx="2"></rect>
      <text x="30" y="4">毛利</text>
      <rect class="trend-legend-rate" x="92" y="-6" width="22" height="10" rx="2"></rect>
      <text x="122" y="4">毛利率</text>
    </g>
  `;
  return `
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="利润走势">
      <defs>
        <linearGradient id="trendArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="var(--brand)" stop-opacity="0.2"></stop>
          <stop offset="58%" stop-color="var(--brand)" stop-opacity="0.08"></stop>
          <stop offset="100%" stop-color="var(--brand)" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      ${ticks}
      <line class="trend-axis" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"></line>
      <path class="trend-profit-area" d="${profitArea}"></path>
      <path class="trend-profit-line" d="${profitLine}"></path>
      <path class="trend-rate-line" d="${rateLine}"></path>
      ${points}
      ${legend}
    </svg>
  `;
}

function gradeTrendSeries(trendData) {
  return gradeOrder.map((grade) => ({
    name: grade,
    type: "line",
    smooth: true,
    showSymbol: true,
    symbolSize: 5,
    lineStyle: {
      width: 2.4,
      shadowBlur: 8,
      shadowColor: `${gradeTrendColors[grade]}2a`,
    },
    itemStyle: { color: gradeTrendColors[grade] },
    emphasis: { focus: "series" },
    areaStyle: {
      opacity: 0.07,
      color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: `${gradeTrendColors[grade]}38` },
        { offset: 0.62, color: `${gradeTrendColors[grade]}12` },
        { offset: 1, color: `${gradeTrendColors[grade]}00` },
      ]),
    },
    data: trendData.map((row) => numberValue(row.grade_revenue?.[grade])),
  }));
}

function renderFinance() {
  const summary = state.finance;
  const balanceSheet = summary.balance_sheet || {};
  const dataQuality = summary.data_quality || {};
  const teacherCostMetric = combinedMetric(summary.overview.teacher_cost, summary.overview.transport_cost);
  const depositMetric = {
    current: numberValue(balanceSheet.total_actual_balance),
    previous: numberValue(summary.prev_balance_sheet?.total_actual_balance),
    mom_pct: pctChangeValue(numberValue(balanceSheet.total_actual_balance), numberValue(summary.prev_balance_sheet?.total_actual_balance)),
  };
  const rangeLabel = `${summary.range?.start || financeRange.start} 至 ${summary.range?.end || financeRange.end}`;
  const netCashFlow = summary.overview.net_cash_flow || {};
  const netCashValue = numberValue(netCashFlow.current);
  renderTopbar(
    "经营概览",
    `期间汇总：${rangeLabel}`,
    `<button class="btn export-finance-csv" type="button">导出</button>`,
  );
  const riskRows = [
    ...(summary.top_lists.account_debts || []).map((row) => ({
      type: "账户欠款",
      name: row.student_name,
      amount: row.amount,
      note: `现金余额 ${formatMoney(row.actual_balance)}`,
      cls: "risk-debt",
    })),
    ...summary.top_lists.low_balance.map((row) => ({
      type: "低余额",
      name: row.student_name,
      amount: row.actual_balance,
      note: `低于平均单次课费 ${formatMoney(row.avg_unit_price)}`,
      cls: "risk-low",
    })),
    ...summary.top_lists.unpaid_lessons.map((row) => ({
      type: "未缴费课时",
      name: row.student,
      amount: row.unit_price,
      note: `${row.date} #${row.lesson_id}`,
      cls: "risk-unpaid",
    })),
  ];
  const op = summary.overview.operating_cost || {};
  const incomeSegments = [
    { label: "现金消费", value: summary.overview.revenue.current, color: "#10b981" },
    { label: "赠送消费", value: summary.overview.gift_consumption.current, color: "#60a5fa" },
  ];
  const costSegments = [
    { label: "课时费", value: summary.overview.teacher_cost.current, color: "#38bdf8" },
    { label: "员工工资", value: op.staff_salary_total, color: "#fbbf24" },
    { label: "日常开销", value: op.operating_expense_total, color: "#fb7185" },
    { label: "交通补贴", value: summary.overview.transport_cost.current, color: "#a78bfa" },
  ];
  const subjectColors = ["#14b8a6", "#38bdf8", "#a78bfa", "#fbbf24", "#fb7185", "#34d399", "#60a5fa", "#f472b6", "#22c55e"];
  const subjectRows = summary.breakdowns?.by_subject || [];
  const subjectSegments = subjectRows.slice(0, 8).map((row, index) => ({
    label: row.name,
    value: Math.max(0, numberValue(row.gross_profit)),
    color: subjectColors[index % subjectColors.length],
  }));
  const otherSubjectProfit = subjectRows.slice(8).reduce((sum, row) => sum + Math.max(0, numberValue(row.gross_profit)), 0);
  if (otherSubjectProfit > 0) subjectSegments.push({ label: "其他", value: otherSubjectProfit, color: "#94a3b8" });
  contentEl.innerHTML = `
    <div class="band finance-range-panel">
      <div class="finance-range-controls">
        <label class="filter-field">
          <span>统计期间</span>
          ${dateRangePickerControl({ scope: "finance", start: financeRange.start, end: financeRange.end, placeholder: "选择经营统计期间" })}
        </label>
      </div>
    </div>

    ${financeQualityNotices(summary)}

    <div class="finance-command-panel">
      <div class="finance-command-main ${netCashValue >= 0 ? "positive" : "negative"}">
        <span>净现金流</span>
        <strong>${formatMoney(netCashValue)}</strong>
        <small class="mom ${momClass(netCashFlow.mom_pct)}">环比 ${momLabel(netCashFlow.mom_pct)}</small>
      </div>
    </div>

    <div class="finance-kpi-grid">
      ${financeMetric("收入", summary.overview.revenue)}
      ${financeMetric("师资成本", teacherCostMetric, { reverse: true })}
      ${financeMetric("运营成本", summary.overview.operating_cost, {
        reverse: true,
        title: `员工工资 ${formatMoney(op.staff_salary_total)} / 日常开销 ${formatMoney(op.operating_expense_total)}`,
      })}
      ${financeMetric("毛利", summary.overview.gross_profit, {
        subtitle: `毛利率 ${percent(summary.overview.gross_margin.current)}${numberValue(dataQuality.teacher_salary_missing_lessons) ? " · 暂估" : ""}`,
      })}
      ${financeMetric("净现金流", summary.overview.net_cash_flow)}
      ${financeMetric("期末沉淀", depositMetric)}
    </div>

    <div class="finance-visual-grid">
      <div class="band finance-chart-panel">
        <div class="section-head">
          <div class="section-title">利润走势</div>
          <div class="section-subtitle">截至 ${escapeHtml(summary.trend_as_of || todayDate())}</div>
        </div>
        <div id="trendChart" class="finance-trend-chart"></div>
      </div>
      <div class="band finance-composition-panel">
        ${compositionDonut("收入构成", incomeSegments)}
        ${compositionDonut("成本构成", costSegments)}
      </div>
    </div>

    <div class="finance-grade-grid">
      <div class="band finance-chart-panel grade-trend-panel">
        <div class="section-head">
          <div class="section-title">各年级消费金额走势</div>
          <div class="section-subtitle">按实际消费收入统计 · ${gradeOrder.join(" / ")}</div>
        </div>
        <div id="gradeTrendChart" class="finance-trend-chart grade-trend-chart"></div>
      </div>
      <div class="band finance-subject-donut-panel">
        ${compositionDonut("各科目利润贡献度", subjectSegments)}
      </div>
    </div>

    <div class="finance-two">
      <div class="band">
        <div class="section-head"><div class="section-title">利润表</div></div>
        <div class="table-wrap">
          <table class="finance-table profit-table">
            <thead><tr><th>项目</th><th>本期</th><th>上期</th><th>环比</th></tr></thead>
            <tbody>${profitTable(summary)}</tbody>
          </table>
        </div>
      </div>
      <div class="band">
        <div class="section-head"><div class="section-title">资金负债表</div></div>
        <div class="table-wrap">
          <table class="finance-table balance-table">
            <thead><tr><th>项目</th><th>期末金额</th></tr></thead>
            <tbody>
              <tr><td class="text-cell">月末沉淀现金</td><td class="text-cell right">${formatMoney(balanceSheet.total_actual_balance)}</td></tr>
              <tr><td class="text-cell">月末赠送余额</td><td class="text-cell right">${formatMoney(balanceSheet.total_gift_balance)}</td></tr>
              <tr><td class="text-cell">未缴费课时</td><td class="text-cell right">${formatMoney(balanceSheet.unpaid_lesson_receivable)}</td></tr>
              <tr><td class="text-cell">账户欠款</td><td class="text-cell right negative">${formatMoney(balanceSheet.account_debt_receivable)}</td></tr>
              <tr><td class="text-cell">应收合计</td><td class="text-cell right">${formatMoney(balanceSheet.accounts_receivable)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="finance-panels finance-panels-two">
      <div class="band finance-panel">
        <div class="section-head"><div class="section-title">老师人效排行</div></div>
        <div class="table-wrap">
          <table class="finance-table teacher-rank-table">
            <thead><tr><th>老师</th><th>贡献</th><th>薪资</th><th>ROI</th></tr></thead>
            <tbody>
              ${summary.breakdowns.by_teacher.map((row) => `<tr><td class="text-cell">${escapeHtml(row.teacher_name)}</td><td class="text-cell right">${formatMoney(row.revenue_contribution)}</td><td class="text-cell right">${formatMoney(row.salary_total)}</td><td class="text-cell right">${row.roi == null ? "" : row.roi.toFixed(2)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">暂无数据</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div class="band finance-panel">
        <div class="section-head"><div class="section-title">风险清单</div></div>
        <div class="table-wrap">
          <table class="finance-table risk-table">
            <thead><tr><th>类型</th><th>对象</th><th>金额</th><th>说明</th></tr></thead>
            <tbody>
              ${riskRows.map((row) => `<tr class="${row.cls}"><td class="text-cell">${escapeHtml(row.type)}</td><td class="text-cell">${escapeHtml(row.name)}</td><td class="text-cell right">${formatMoney(row.amount)}</td><td class="text-cell">${escapeHtml(row.note)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">暂无风险</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Initialize ECharts
  if (window.echarts) {
    const trendData = (summary.trend_6m || []).slice(-12);
    const trendEl = document.getElementById('trendChart');
    if (trendData.length && trendEl) {
      const trendChart = echarts.init(trendEl);
      trendChart.setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
        legend: { data: ['毛利', '毛利率'], bottom: 6 },
        grid: { left: 44, right: 54, bottom: 58, top: 48, containLabel: true },
        xAxis: [{ type: 'category', data: trendData.map(d => `${String(d.month || "").slice(5, 7)}月`), axisPointer: { type: 'shadow' } }],
        yAxis: [
          { type: 'value', name: '毛利 (¥)', alignTicks: true, nameGap: 18 },
          { type: 'value', name: '毛利率', alignTicks: true, nameGap: 18, min: 0, max: 1, axisLabel: { formatter: value => `${(value * 100).toFixed(0)}%` } }
        ],
        series: [
          { name: '毛利', type: 'line', smooth: true, data: trendData.map(d => numberValue(d.gross_profit)), itemStyle: { color: '#2d9e8f' }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(45,158,143,0.3)' }, { offset: 1, color: 'rgba(45,158,143,0)' }]) } },
          { name: '毛利率', type: 'line', yAxisIndex: 1, smooth: true, data: trendData.map(d => numberValue(d.gross_margin)), itemStyle: { color: '#175cd3' } }
        ]
      });
      window.addEventListener('resize', () => trendChart.resize());
    }

    const gradeTrendEl = document.getElementById('gradeTrendChart');
    if (trendData.length && gradeTrendEl) {
      const gradeTrendChart = echarts.init(gradeTrendEl);
      gradeTrendChart.setOption({
        color: gradeOrder.map((grade) => gradeTrendColors[grade]),
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "line" },
          valueFormatter: (value) => formatMoney(value),
        },
        legend: {
          data: [...gradeOrder],
          bottom: 6,
          icon: "circle",
          itemWidth: 10,
          itemHeight: 10,
        },
        grid: { left: 44, right: 24, top: 50, bottom: 62, containLabel: true },
        xAxis: [{
          type: "category",
          boundaryGap: false,
          data: trendData.map((row) => `${String(row.month || "").slice(5, 7)}月`),
          axisPointer: { type: "line" },
        }],
        yAxis: [{
          type: "value",
          name: "消费金额 (¥)",
          nameGap: 18,
          axisLabel: { formatter: (value) => compactMoney(value) },
          splitLine: { lineStyle: { type: "dashed" } },
        }],
        series: gradeTrendSeries(trendData),
      });
      window.addEventListener('resize', () => gradeTrendChart.resize());
    }

  }
}

function currentRechargeFilter() {
  return {
    source: rechargeSourceFilter,
    student: rechargeStudentFilter,
    grade: rechargeGradeFilter,
  };
}

function rechargeMatchesFilter(row, filter = currentRechargeFilter()) {
  const source = rechargeSource(row);
  if (filter.source === "carry_over" && source !== "carry_over") return false;
  if (filter.source === "manual" && source === "carry_over") return false;
  if (filter.student && !row.student_name.toLowerCase().includes(filter.student.toLowerCase())) return false;
  if (filter.grade && !textContains(row.grade, filter.grade)) return false;
  return true;
}

function dynamicRechargeFilterOptions(rows, filter = currentRechargeFilter()) {
  const rowsFor = (field) => rowsForFilterOption(rows, filter, field, rechargeMatchesFilter);
  return {
    students: uniqueSorted(rowsFor("student").map((row) => row.student_name)),
    grades: uniqueSorted(rowsFor("grade").map((row) => row.grade)),
  };
}

function renderRecharges() {
  const rows = rechargeRows();
  const opts = dynamicRechargeFilterOptions(rows);
  const visibleRows = rows.filter((row) => rechargeMatchesFilter(row));
  const visibleIds = new Set(visibleRows.map((row) => Number(row.id)).filter(Boolean));
  selectedRechargeIds = new Set([...selectedRechargeIds].filter((id) => visibleIds.has(Number(id))));
  const selectedVisibleCount = visibleRows.filter((row) => selectedRechargeIds.has(Number(row.id))).length;
  const allVisibleSelected = visibleRows.length > 0 && selectedVisibleCount === visibleRows.length;
  renderTopbar(`${monthLabel()} 充值记录`, `已显示 ${visibleRows.length} / 共 ${rows.length} 条充值记录`);
  contentEl.innerHTML = `
    <div class="band">
      <div class="section-head">
        <div>
          <div class="section-title">充值记录</div>
          <div class="section-subtitle">仅显示当前月份已有充值记录的学生。</div>
        </div>
        <div class="profile-actions">
          <button class="btn danger batch-delete-recharges" type="button" ${bulkActionDisabledAttr(selectedRechargeIds.size)}>${bulkActionText("批量删除", selectedRechargeIds.size)}</button>
          <button class="btn primary open-recharge-modal" type="button">+ 新增充值记录</button>
        </div>
      </div>
      <div class="filter-bar compact">
        <label>来源</label>
        ${filterComboControl({ className: "recharge-source-filter", field: "source", value: filterLabel(rechargeSourceOptions, rechargeSourceFilter), values: rechargeSourceOptions.map((item) => item[1]), placeholder: "输入或选择来源" })}
        <label>学生姓名</label>
        ${filterComboControl({ className: "recharge-student-filter", field: "student", value: rechargeStudentFilter, values: opts.students, placeholder: "输入或选择学生", dataAttr: "field" })}
        <label>年级</label>
        ${filterComboControl({ className: "recharge-grade-filter", field: "grade", value: rechargeGradeFilter, values: opts.grades, placeholder: "输入或选择年级" })}
        <button class="btn reset-recharge-filter" type="button">清空筛选</button>
      </div>
      <div class="table-wrap smooth-table-wrap">
        <table class="recharge-table uniform-table nowrap-table">
          <thead>
            <tr><th class="select-col"><input class="recharge-select-all" type="checkbox" ${allVisibleSelected ? "checked" : ""} ${visibleRows.length ? "" : "disabled"} aria-label="全选当前充值记录"></th><th>学生姓名</th><th>年级</th><th>本月实际充值</th><th>本月赠送充值</th><th>充值日期</th><th class="wide">备注</th></tr>
          </thead>
          <tbody>
            ${visibleRows.map((row) => `
              <tr class="recharge-row" data-id="${escapeHtml(row.id)}" data-student-name="${escapeHtml(row.student_name)}" data-grade="${escapeHtml(row.grade)}" data-source="${escapeHtml(row.source || "")}"${gradeRowStyle(row.grade)}>
                <td class="select-col"><input class="recharge-select-row" type="checkbox" data-id="${escapeHtml(row.id)}" ${selectedRechargeIds.has(Number(row.id)) ? "checked" : ""} aria-label="选择充值记录"></td>
                <td class="text-cell">${escapeHtml(row.student_name)} ${rechargeSourceTag(rechargeSource(row))}</td>
                <td class="text-cell">${escapeHtml(row.grade)}</td>
                <td class="currency-input-cell">${currencyInputMarkup(row.cur_recharge, { className: "recharge-field", attrs: `data-field="cur_recharge"` })}</td>
                <td class="currency-input-cell">${currencyInputMarkup(row.cur_gift, { className: "recharge-field", attrs: `data-field="cur_gift"` })}</td>
                <td><input class="cell-input recharge-field" data-field="recharge_date" type="date" value="${escapeHtml(row.recharge_date)}"></td>
                <td><input class="cell-input recharge-field wide" data-field="notes" value="${escapeHtml(row.recharge_notes)}"></td>
              </tr>
            `).join("") || `<tr><td colspan="7" class="empty">暂无充值记录</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    ${rechargeModalMarkup()}
  `;
}

function renderOpeningBalances() {
  const rows = openingBalanceRows();
  const opts = dynamicOpeningBalanceFilterOptions(rows);
  const visibleRows = rows.filter((row) => openingBalanceMatchesFilter(row));
  const visibleIds = new Set(visibleRows.map((row) => Number(row.id)).filter(Boolean));
  selectedOpeningBalanceIds = new Set([...selectedOpeningBalanceIds].filter((id) => visibleIds.has(Number(id))));
  const selectedVisibleCount = visibleRows.filter((row) => selectedOpeningBalanceIds.has(Number(row.id))).length;
  const allVisibleSelected = visibleRows.length > 0 && selectedVisibleCount === visibleRows.length;
  renderTopbar("期初余额", `已显示 ${visibleRows.length} / 共 ${rows.length} 条期初余额`);
  contentEl.innerHTML = `
    <div class="band">
      <div class="section-head">
        <div>
          <div class="section-title">期初余额</div>
          <div class="section-subtitle">全局账户期初余额，用于系统上线前余额承接，不属于充值流水。</div>
        </div>
        <div class="profile-actions opening-balance-actions">
          <button class="btn danger batch-delete-opening-balances" type="button" ${bulkActionDisabledAttr(selectedOpeningBalanceIds.size)}>${bulkActionText("批量删除", selectedOpeningBalanceIds.size)}</button>
          <button class="btn download-opening-balance-template" type="button">下载模板</button>
          <button class="btn import-opening-balance-excel" type="button">导入 Excel</button>
          <button class="btn export-opening-balance-excel" type="button">导出 Excel</button>
          <button class="btn primary open-opening-balance-modal" type="button">+ 新增期初余额</button>
        </div>
      </div>
      <div class="filter-bar compact">
        <label>学生姓名</label>
        ${filterComboControl({ className: "opening-balance-filter", field: "student", value: openingBalanceFilter.student, values: opts.students, placeholder: "输入或选择学生", dataAttr: "field" })}
        <label>年级</label>
        ${filterComboControl({ className: "opening-balance-filter", field: "grade", value: openingBalanceFilter.grade, values: opts.grades, placeholder: "输入或选择年级" })}
        <button class="btn reset-opening-balance-filter" type="button">清空筛选</button>
      </div>
      <div class="table-wrap smooth-table-wrap">
        <table class="recharge-table opening-balance-table uniform-table nowrap-table">
          <thead>
            <tr><th class="select-col"><input class="opening-balance-select-all" type="checkbox" ${allVisibleSelected ? "checked" : ""} ${visibleRows.length ? "" : "disabled"} aria-label="全选当前期初余额"></th><th>学生姓名</th><th>年级</th><th>期初实际余额</th><th>期初赠送余额</th><th class="wide">备注</th></tr>
          </thead>
          <tbody>
            ${visibleRows.map((row) => `
              <tr class="opening-balance-row" data-id="${row.id}" data-student-name="${escapeHtml(row.student_name)}" data-grade="${escapeHtml(row.grade)}"${gradeRowStyle(row.grade)}>
                <td class="select-col"><input class="opening-balance-select-row" type="checkbox" data-id="${escapeHtml(row.id)}" ${selectedOpeningBalanceIds.has(Number(row.id)) ? "checked" : ""} aria-label="选择期初余额记录"></td>
                <td class="text-cell">${escapeHtml(row.student_name)}</td>
                <td class="text-cell">${escapeHtml(row.grade)}</td>
                <td class="currency-input-cell">${currencyInputMarkup(row.opening_actual_balance, { className: "opening-balance-field", attrs: `data-field="opening_actual_balance"` })}</td>
                <td class="currency-input-cell">${currencyInputMarkup(row.opening_gift_balance, { className: "opening-balance-field", attrs: `data-field="opening_gift_balance"` })}</td>
                <td><input class="cell-input wide opening-balance-field" data-field="notes" value="${escapeHtml(row.notes)}"></td>
              </tr>
            `).join("") || `<tr><td colspan="6" class="empty">暂无期初余额</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    ${openingBalanceModalMarkup()}
  `;
}

function studentHistoryPanel() {
  if (!selectedStudent) return "";
  const history = (state.student_history || []).slice(0, 12);
  return `
    <div class="student-history-block">
      <div class="section-head">
        <div class="section-title">历史对比</div>
      </div>
      <div class="table-wrap smooth-table-wrap">
        <table class="student-history-table uniform-table nowrap-table">
          <thead>
            <tr><th>月份</th><th>上课数</th><th>当月费用</th><th>月末现金</th><th>月末赠送</th><th>净充值</th></tr>
          </thead>
          <tbody>
            ${history.map((row) => `
              <tr class="${row.month_key === state.settings.month_key ? "current-month-row" : ""}">
                <td class="text-cell">${escapeHtml(formatMonthOption(row.month_key))}</td>
                <td class="text-cell">${row.lesson_count}</td>
                <td class="text-cell right">${formatMoney(row.total_fee)}</td>
                <td class="text-cell right ${numberValue(row.actual_balance) < 0 ? "negative" : ""}">${formatMoney(row.actual_balance)}</td>
                <td class="text-cell right">${formatMoney(row.gift_balance)}</td>
                <td class="text-cell right">${formatMoney(row.net_recharge)}</td>
              </tr>
            `).join("") || `<tr><td colspan="6" class="empty">暂无历史记录</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function studentStatementReport() {
  return state.student_statement || { summary: null, details: [], month_rows: [], recharges: [], range: currentStudentQueryRange() };
}

function studentStatementRangeLabel(report = studentStatementReport()) {
  const range = report.range || currentStudentQueryRange();
  return studentQueryRange.mode === "range" ? `${range.start} 至 ${range.end}` : "全部月份";
}

function studentQueryControls(studentNames) {
  const range = currentStudentQueryRange();
  return `
    <div class="band student-query-controls">
      <div class="filter-bar compact">
        <label>学生姓名</label>
        ${filterComboControl({ className: "student-query-name", field: "student", value: studentQueryNameDraft || selectedStudent, values: studentNames, placeholder: "输入或选择学生", dataAttr: "field" })}
        <div class="segmented student-query-mode-toggle">
          <button class="segmented-option student-query-mode ${studentQueryRange.mode !== "range" ? "active" : ""}" type="button" data-mode="all">全部月份</button>
          <button class="segmented-option student-query-mode ${studentQueryRange.mode === "range" ? "active" : ""}" type="button" data-mode="range">日期范围</button>
        </div>
        ${dateRangePickerControl({ scope: "student-query", start: studentQueryRange.mode === "range" ? range.start : "", end: studentQueryRange.mode === "range" ? range.end : "", placeholder: "选择账单日期范围", disabled: studentQueryRange.mode !== "range" })}
      </div>
    </div>
  `;
}

function studentQueryComparisonPanel(report) {
  if (!selectedStudent || !report?.summary) return "";
  return `
    <div class="band student-comparison-panel">
      <div class="section-head">
        <div>
          <div class="section-title">月份汇总</div>
          <div class="section-subtitle">${escapeHtml(studentStatementRangeLabel(report))}</div>
        </div>
      </div>
      <div class="table-wrap smooth-table-wrap">
        <table class="student-history-table uniform-table nowrap-table">
          <thead><tr><th>月份</th><th>有效课次</th><th>当月课费</th><th>现金充值</th><th>赠送充值</th></tr></thead>
          <tbody>
            ${(report.month_rows || []).map((row) => `
              <tr><td class="text-cell">${escapeHtml(formatMonthOption(row.month_key))}</td><td class="text-cell">${row.lesson_count}</td><td class="text-cell right">${formatMoney(row.total_fee)}</td><td class="text-cell right">${formatMoney(row.cur_recharge)}</td><td class="text-cell right">${formatMoney(row.cur_gift)}</td></tr>
            `).join("") || `<tr><td colspan="5" class="empty">暂无期间明细</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function imageFilenamePart(value, fallback = "未命名") {
  const textValue = String(value || "").trim() || fallback;
  return textValue.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
}

function shotText(ctx, value, x, y, maxWidth, options = {}) {
  const textValue = String(value ?? "");
  const ellipsis = "…";
  let output = textValue;
  if (maxWidth && ctx.measureText(output).width > maxWidth) {
    while (output.length > 0 && ctx.measureText(`${output}${ellipsis}`).width > maxWidth) output = output.slice(0, -1);
    output = output ? `${output}${ellipsis}` : ellipsis;
  }
  if (options.align) ctx.textAlign = options.align;
  ctx.fillText(output, x, y);
}

function shotRoundRect(ctx, x, y, width, height, radius = 12) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.closePath();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function setupShotCanvas(width, height, colors) {
  const canvas = document.createElement("canvas");
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.shadowColor = "rgba(16, 32, 51, 0.08)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = colors.panel;
  shotRoundRect(ctx, 24, 24, width - 48, height - 48, 18);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = colors.line;
  shotRoundRect(ctx, 24, 24, width - 48, height - 48, 18);
  ctx.stroke();
  ctx.fillStyle = colors.brand;
  ctx.fillRect(24, 24, width - 48, 6);
  return { canvas, ctx };
}

function drawShotHeader(ctx, colors, title, subtitle, width) {
  ctx.fillStyle = colors.brandPale;
  ctx.fillRect(25, 30, width - 50, 86);
  ctx.fillStyle = colors.brandDark;
  ctx.font = "900 28px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("黎明教育", width / 2, subtitle ? 66 : 70);
  ctx.font = "800 22px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  shotText(ctx, title, width / 2, subtitle ? 96 : 104, width - 96, { align: "center" });
  if (subtitle) {
    ctx.fillStyle = colors.muted;
    ctx.font = "15px Microsoft YaHei, PingFang SC, Arial, sans-serif";
    shotText(ctx, subtitle, width / 2, 118, width - 96, { align: "center" });
  }
}

function drawStudentStatementHeader(ctx, colors, studentName, range, width) {
  ctx.fillStyle = colors.brandPale;
  ctx.fillRect(25, 30, width - 50, 88);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colors.brandDark;
  ctx.font = "900 27px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  ctx.fillText("黎明教育", width / 2, 62);
  ctx.fillStyle = colors.muted;
  ctx.font = "15px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  const generatedAt = formatBeijingTime(new Date().toISOString());
  const summaryLine = `学生：${studentName || "未选择学生"} / 范围：${range.start || ""} ~ ${range.end || ""} / 生成：${generatedAt} / 费用概览`;
  shotText(ctx, summaryLine, width / 2, 96, width - 96, { align: "center" });
}

function studentStatementDateRange(report = studentStatementReport()) {
  const range = report?.range || currentStudentQueryRange();
  return { start: range.start || "", end: range.end || "" };
}

function studentStatementMetricCards(summary = {}) {
  return [
    { label: "有效上课次数", value: String(summary.lesson_count || 0) },
    { label: "课程费用", value: formatMoney(summary.total_fee || 0) },
    { label: "开始日期前剩余现金", value: formatMoney(summary.opening_actual_balance ?? 0), negative: numberValue(summary.opening_actual_balance) < 0 },
    { label: "开始日期前剩余赠送", value: formatMoney(summary.opening_gift_balance ?? 0) },
    { label: "期间充值现金", value: formatMoney(summary.cur_recharge || 0) },
    { label: "期间充值赠送", value: formatMoney(summary.cur_gift || 0) },
    { label: "结束日期后剩余现金", value: formatMoney(summary.closing_actual_balance ?? summary.actual_balance ?? 0), negative: numberValue(summary.closing_actual_balance ?? summary.actual_balance) < 0 },
    { label: "结束日期后剩余赠送", value: formatMoney(summary.closing_gift_balance ?? summary.gift_balance ?? 0) },
  ];
}

function drawShotMetricCards(ctx, colors, cards, x, y, width) {
  const gap = 12;
  const cardWidth = (width - gap * (cards.length - 1)) / cards.length;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  cards.forEach((card, index) => {
    const left = x + index * (cardWidth + gap);
    ctx.fillStyle = colors.card;
    shotRoundRect(ctx, left, y, cardWidth, 78, 12);
    ctx.fill();
    ctx.strokeStyle = colors.line;
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    ctx.font = "14px Microsoft YaHei, PingFang SC, Arial, sans-serif";
    shotText(ctx, card.label, left + 14, y + 26, cardWidth - 28);
    ctx.fillStyle = card.negative ? "#b42318" : colors.brandDark;
    ctx.font = "800 21px Microsoft YaHei, PingFang SC, Arial, sans-serif";
    shotText(ctx, card.value, left + 14, y + 56, cardWidth - 28);
  });
}

function drawShotSectionTitle(ctx, colors, title, x, y, width = 0) {
  ctx.fillStyle = colors.brandDark;
  ctx.font = "800 20px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  ctx.textAlign = width ? "center" : "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(title, width ? x + width / 2 : x, y);
}

function drawShotTable(ctx, colors, columns, rows, x, y, widths, options = {}) {
  const rowHeight = options.rowHeight || 38;
  const headHeight = options.headHeight || 40;
  const tableWidth = widths.reduce((sum, item) => sum + item, 0);
  const bodyRows = rows.length ? rows : [{ _empty: true }];
  ctx.fillStyle = colors.card;
  ctx.strokeStyle = colors.line;
  ctx.fillRect(x, y, tableWidth, headHeight + bodyRows.length * rowHeight);
  ctx.strokeRect(x, y, tableWidth, headHeight + bodyRows.length * rowHeight);
  let cursor = x;
  ctx.font = "800 15px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  columns.forEach((column, index) => {
    ctx.fillStyle = colors.brandSoft;
    ctx.fillRect(cursor, y, widths[index], headHeight);
    ctx.strokeStyle = colors.line;
    ctx.strokeRect(cursor, y, widths[index], headHeight);
    ctx.fillStyle = colors.brandDark;
    shotText(ctx, column.label, cursor + widths[index] / 2, y + headHeight / 2, widths[index] - 12, { align: "center" });
    cursor += widths[index];
  });
  ctx.font = "14px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  bodyRows.forEach((row, rowIndex) => {
    const top = y + headHeight + rowIndex * rowHeight;
    if (row._empty) {
      ctx.fillStyle = colors.card;
      ctx.fillRect(x, top, tableWidth, rowHeight);
      ctx.strokeStyle = colors.line;
      ctx.strokeRect(x, top, tableWidth, rowHeight);
      ctx.fillStyle = colors.muted;
      ctx.textAlign = "center";
      ctx.fillText(options.emptyText || "暂无数据", x + tableWidth / 2, top + rowHeight / 2);
      return;
    }
    cursor = x;
    columns.forEach((column, index) => {
      ctx.fillStyle = rowIndex % 2 ? colors.brandPale : colors.card;
      ctx.fillRect(cursor, top, widths[index], rowHeight);
      ctx.strokeStyle = colors.line;
      ctx.strokeRect(cursor, top, widths[index], rowHeight);
      const align = column.align || "center";
      const value = column.value(row);
      ctx.fillStyle = column.negative?.(row) ? "#b42318" : colors.title;
      ctx.textAlign = align;
      const textX = align === "right" ? cursor + widths[index] - 8 : align === "left" ? cursor + 8 : cursor + widths[index] / 2;
      shotText(ctx, value, textX, top + rowHeight / 2, widths[index] - 16, { align });
      cursor += widths[index];
    });
  });
  return headHeight + bodyRows.length * rowHeight;
}

function studentStatementCanvas(report = studentStatementReport()) {
  const colors = courseNoticeShotPalette();
  const summary = report?.summary || {};
  const details = report?.details || [];
  const monthRows = report?.month_rows || [];
  const dateRange = studentStatementDateRange(report);
  const width = 1160;
  const contentX = 64;
  const contentWidth = width - contentX - 56;
  const monthTableHeight = 40 + Math.max(1, monthRows.length) * 36;
  const detailTableHeight = 42 + Math.max(1, details.length) * 38;
  const height = 48 + 96 + 104 + 96 + 36 + monthTableHeight + 54 + detailTableHeight + 54;
  const { canvas, ctx } = setupShotCanvas(width, height, colors);
  drawStudentStatementHeader(ctx, colors, report?.student_name || selectedStudent || "未选择学生", dateRange, width);
  const metricCards = studentStatementMetricCards(summary);
  drawShotMetricCards(ctx, colors, metricCards.slice(0, 4), contentX, 142, contentWidth);
  drawShotMetricCards(ctx, colors, metricCards.slice(4), contentX, 238, contentWidth);
  let y = 342;
  drawShotSectionTitle(ctx, colors, "月份汇总", contentX, y, contentWidth);
  y += 18;
  y += drawShotTable(ctx, colors, [
    { label: "月份", value: (row) => formatMonthOption(row.month_key), align: "left" },
    { label: "有效课次", value: (row) => row.lesson_count || 0 },
    { label: "课程费用", value: (row) => formatMoney(row.total_fee || 0), align: "right" },
    { label: "现金充值", value: (row) => formatMoney(row.cur_recharge || 0), align: "right" },
    { label: "赠送充值", value: (row) => formatMoney(row.cur_gift || 0), align: "right" },
    { label: "月末现金", value: (row) => formatMoney(row.actual_balance || 0), align: "right", negative: (row) => numberValue(row.actual_balance) < 0 },
    { label: "月末赠送", value: (row) => formatMoney(row.gift_balance || 0), align: "right" },
  ], monthRows, contentX, y, [150, 110, 150, 150, 150, 150, 180], { rowHeight: 36, emptyText: "暂无月份汇总" });
  y += 42;
  drawShotSectionTitle(ctx, colors, "明细课程表", contentX, y, contentWidth);
  y += 18;
  drawShotTable(ctx, colors, [
    { label: "日期", value: (row) => row.date, align: "left" },
    { label: "状态", value: (row) => rowStatus(row) },
    { label: "星期", value: (row) => row.weekday || weekdayCn(row.date) },
    { label: "时间", value: (row) => row.time_slot, align: "left" },
    { label: "老师", value: (row) => row.teacher_name },
    { label: "年级", value: (row) => row.grade },
    { label: "科目", value: (row) => row.subject },
    { label: "备注", value: (row) => row.notes || "", align: "left" },
    { label: "费用", value: (row) => formatMoney(row.unit_price || 0), align: "right" },
  ], details, contentX, y, [112, 68, 62, 116, 86, 72, 80, 346, 98], { rowHeight: 38, headHeight: 42, emptyText: "暂无课程明细" });
  return canvas;
}

async function downloadCanvasPng(canvas, filename) {
  const blob = await canvasBlob(canvas);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function copyOrDownloadCanvasPng(canvas, filename) {
  const blob = await canvasBlob(canvas);
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("图片已复制");
      return { copied: true };
    } catch {
      // Fall through to download for browsers or contexts that block image clipboard writes.
    }
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  alert("浏览器不支持直接复制，已为你下载图片。");
  return { copied: false };
}

function studentStatementFilename(report = studentStatementReport()) {
  const range = report?.range || currentStudentQueryRange();
  const label = studentQueryRange.mode === "range" ? `${range.start}_${range.end}` : "全部月份";
  return `黎明教育_${imageFilenamePart(report?.student_name || selectedStudent || "学生")}_${imageFilenamePart(label)}_课程费用核对.png`;
}

async function downloadStudentStatementPng(report) {
  const canvas = studentStatementCanvas(report || { student_name: selectedStudent, range: currentStudentQueryRange(), summary: null, details: [], month_rows: [] });
  await downloadCanvasPng(canvas, studentStatementFilename(report || { student_name: selectedStudent, range: currentStudentQueryRange() }));
}

async function copyStudentStatementPng(report) {
  const normalizedReport = report || { student_name: selectedStudent, range: currentStudentQueryRange(), summary: null, details: [], month_rows: [] };
  const canvas = studentStatementCanvas(normalizedReport);
  await copyOrDownloadCanvasPng(canvas, studentStatementFilename(normalizedReport));
}

function teacherTravelWeeks() {
  const weeks = state?.derived?.teacher_month_weeks;
  return Array.isArray(weeks) && weeks.length ? weeks : monthWeeksBySunday(state?.settings?.month_key || activeMonth);
}

function teacherTravelField(index) {
  return `week${Number(index)}_transport`;
}

function teacherTravelAmount(row = {}, week) {
  const detail = (row.travel_weeks || []).find((item) => Number(item.week_index) === Number(week.week_index));
  return numberValue(detail ? detail.amount : row[teacherTravelField(week.week_index)]);
}

function teacherTravelTotal(row = {}) {
  return teacherTravelWeeks().reduce((sum, week) => sum + teacherTravelAmount(row, week), 0);
}

function teacherSummaryRowFor(teacherName) {
  return (state.derived.teacher_summary || []).find((row) => String(row.teacher_name || "").trim() === String(teacherName || "").trim()) || {};
}

function teacherTransportDetailRows(summary = {}) {
  const notes = String(summary.notes || "").trim();
  return teacherTravelWeeks().map((week, index) => ({
    item: week.label || `第${week.week_index || index + 1}周车票(${week.start || week.week_start}~${week.end || week.week_end})`,
    amount: teacherTravelAmount(summary, week),
    notes: index === 0 ? notes : "",
  }));
}

function teacherDetailCanvas(teacherName = selectedTeacher) {
  const colors = courseNoticeShotPalette();
  const rows = sortedLessons().filter((row) => row.teacher_name === teacherName);
  const completedRows = rows.filter(isCompletedLesson);
  const summary = teacherSummaryRowFor(teacherName);
  const classSalary = numberValue(summary.salary_total) || completedRows.reduce((sum, row) => sum + displayTeacherSalaryForLesson(row), 0);
  const transportTotal = teacherTravelTotal(summary);
  const salaryTotal = numberValue(summary.total_salary) || classSalary + transportTotal;
  const width = 1240;
  const contentWidth = width - 96;
  const detailTableHeight = 42 + Math.max(1, rows.length) * 38;
  const transportRows = teacherTransportDetailRows(summary);
  const transportTableHeight = 40 + 38;
  const height = 48 + 96 + 104 + detailTableHeight + 52 + transportTableHeight + 54;
  const { canvas, ctx } = setupShotCanvas(width, height, colors);
  drawShotHeader(ctx, colors, `${monthLabel()} ${teacherName || "未选择教师"} 薪资明细`, "", width);
  drawShotMetricCards(ctx, colors, [
    { label: "有效课时", value: String(completedRows.length) },
    { label: "课程记录", value: String(rows.length) },
    { label: "课时薪资", value: formatMoney(classSalary) },
    { label: "车票/交通补贴", value: formatMoney(transportTotal) },
    { label: "薪资统计", value: formatMoney(salaryTotal) },
  ], 48, 142, contentWidth);
  let y = 246;
  drawShotTable(ctx, colors, [
    { label: "日期", value: (row) => row.date, align: "left" },
    { label: "状态", value: (row) => rowStatus(row) },
    { label: "星期", value: (row) => weekdayCn(row.date) },
    { label: "时间", value: (row) => row.time_slot, align: "left" },
    { label: "教室", value: (row) => row.classroom },
    { label: "年级", value: (row) => row.grade },
    { label: "科目", value: (row) => row.subject },
    { label: "学生", value: (row) => row.student_names, align: "left" },
    { label: "备注", value: (row) => row.notes || "", align: "left" },
    { label: "教师薪资", value: (row) => formatMoney(displayTeacherSalaryForLesson(row)), align: "right" },
  ], rows, 48, y, [106, 64, 58, 110, 60, 66, 72, 200, 298, 100], { rowHeight: 38, headHeight: 42, emptyText: "暂无教师课程明细" });
  y += detailTableHeight + 42;
  drawShotSectionTitle(ctx, colors, "车票/交通补贴明细", 48, y, contentWidth);
  y += 18;
  drawShotTable(
    ctx,
    colors,
    transportRows.map((item) => ({
      label: item.item,
      value: () => formatMoney(item.amount || 0),
      align: "center",
    })),
    [{}],
    48,
    y,
    transportRows.map(() => contentWidth / Math.max(transportRows.length, 1)),
    { rowHeight: 38, headHeight: 40, emptyText: "暂无车票/交通补贴" },
  );
  return canvas;
}

async function downloadTeacherDetailPng() {
  if (!selectedTeacher) throw new Error("请先选择教师");
  const canvas = teacherDetailCanvas(selectedTeacher);
  await downloadCanvasPng(canvas, `黎明教育_${imageFilenamePart(monthLabel())}_${imageFilenamePart(selectedTeacher)}_薪资明细.png`);
}

async function copyTeacherDetailPng() {
  if (!selectedTeacher) throw new Error("请先选择教师");
  const filename = `黎明教育_${imageFilenamePart(monthLabel())}_${imageFilenamePart(selectedTeacher)}_薪资明细.png`;
  const canvas = teacherDetailCanvas(selectedTeacher);
  await copyOrDownloadCanvasPng(canvas, filename);
}

function xmlEscape(value) {
  return escapeHtml(value).replaceAll("'", "&apos;");
}

function studentStatementSvg(report) {
  const details = report.details || [];
  const summary = report.summary || {};
  const rowHeight = 36;
  const width = 1120;
  const maxRows = Math.max(details.length, 1);
  const height = 330 + maxRows * rowHeight;
  const rows = details.map((row, index) => {
    const y = 286 + index * rowHeight;
    return `
      <text x="48" y="${y}" class="cell">${xmlEscape(row.date)}</text>
      <text x="152" y="${y}" class="cell">${xmlEscape(row.time_slot)}</text>
      <text x="292" y="${y}" class="cell">${xmlEscape(row.teacher_name)}</text>
      <text x="420" y="${y}" class="cell">${xmlEscape(row.subject)}</text>
      <text x="520" y="${y}" class="cell">${xmlEscape(row.status)}</text>
      <text x="650" y="${y}" class="cell note">${xmlEscape(row.notes || "")}</text>
      <text x="1048" y="${y}" class="cell num">${xmlEscape(formatMoney(row.unit_price))}</text>
    `;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    text{font-family:'Microsoft YaHei UI','Noto Sans SC',Arial,sans-serif;fill:#17212b}
    .muted{fill:#667780;font-size:20px}.title{font-size:34px;font-weight:800}.metric{font-size:28px;font-weight:800}.label{font-size:16px;fill:#667780}.head{font-size:17px;font-weight:800;fill:#24524f}.cell{font-size:17px}.num{text-anchor:end;font-weight:800}.note{font-size:15px;fill:#475467}
  </style>
  <rect width="${width}" height="${height}" fill="#fbfdfc"/>
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="18" fill="#ffffff" stroke="#d4e2e3"/>
  <text x="48" y="72" class="title">${xmlEscape(report.student_name)} 课程核对单</text>
  <text x="48" y="108" class="muted">${xmlEscape(studentStatementRangeLabel(report))}</text>
  <g transform="translate(48 142)">
    <text class="label">有效课次</text><text y="42" class="metric">${summary.lesson_count || 0}</text>
    <text x="190" class="label">课程费用</text><text x="190" y="42" class="metric">${xmlEscape(formatMoney(summary.total_fee || 0))}</text>
    <text x="430" class="label">期间充值</text><text x="430" y="42" class="metric">${xmlEscape(formatMoney(summary.cur_recharge || 0))}</text>
    <text x="670" class="label">最新月末现金</text><text x="670" y="42" class="metric">${xmlEscape(formatMoney(summary.actual_balance || 0))}</text>
    <text x="900" class="label">最新月末赠送</text><text x="900" y="42" class="metric">${xmlEscape(formatMoney(summary.gift_balance || 0))}</text>
  </g>
  <line x1="48" x2="${width - 48}" y1="236" y2="236" stroke="#d4e2e3"/>
  <text x="48" y="264" class="head">日期</text><text x="152" y="264" class="head">时间</text><text x="292" y="264" class="head">老师</text><text x="420" y="264" class="head">科目</text><text x="520" y="264" class="head">状态</text><text x="650" y="264" class="head">备注</text><text x="1048" y="264" class="head num">费用</text>
  ${rows || `<text x="48" y="286" class="cell">暂无课程明细</text>`}
  <text x="48" y="${height - 42}" class="muted">由黎明教育课程管理系统生成，请核对课程日期、状态和费用。</text>
</svg>`;
}

function studentStatementModal(report) {
  if (!studentStatementModalOpen || !report?.summary) return "";
  const svg = studentStatementSvg(report);
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return `
    <div class="modal-backdrop student-statement-modal">
      <div class="modal-panel statement-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">家长核对图片</div>
            <div class="modal-subtitle">${escapeHtml(report.student_name)} · ${escapeHtml(studentStatementRangeLabel(report))}</div>
          </div>
          <button class="btn statement-modal-close" type="button">关闭</button>
        </div>
        <div class="statement-preview"><img src="${src}" alt="学生课程核对单预览"></div>
        <div class="modal-actions">
          <button class="btn primary statement-download-png" type="button">下载 PNG</button>
        </div>
      </div>
    </div>
  `;
}

function studentStatementMetricCardsMarkup(summary = {}) {
  return studentStatementMetricCards(summary).map((card) => `
    <div class="metric">
      <div class="metric-label">${escapeHtml(card.label)}</div>
      <div class="metric-value ${card.negative ? "negative" : ""}">${escapeHtml(card.value)}</div>
    </div>
  `).join("");
}

function renderStudentQuery() {
  const rows = state.derived.student_summary;
  const studentNames = uniqueSorted((state.profile_students || [])
    .map((row) => String(row.name || "").trim())
    .filter(Boolean));
  const report = studentStatementReport();
  const summary = selectedStudent ? report.summary : null;
  const details = selectedStudent ? (report.details || []) : [];
  renderTopbar(
    "学生查询",
    selectedStudent || "未选择学生",
    `<button class="btn export-student-statement" type="button" ${selectedStudent ? "" : "disabled"}>导出 Excel</button>
     <button class="btn student-statement-preview" type="button" ${selectedStudent ? "" : "disabled"}>复制图片</button>`,
  );
  contentEl.innerHTML = `
    ${studentQueryControls(studentNames)}
    <div class="query-head student-statement-metrics">
      ${studentStatementMetricCardsMarkup(summary || {})}
    </div>
    ${studentQueryComparisonPanel(report)}
    <div class="band">
      <div class="table-wrap smooth-table-wrap">
        <table class="fee-detail-table student-query-detail-table uniform-table nowrap-table">
          <thead>
            <tr><th>学生姓名</th><th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th class="wide note-head">备注</th><th>单人费用</th></tr>
          </thead>
          <tbody>
            ${details.map((row) => `
              <tr class="${detailRowClass(row)}">
                <td class="text-cell">${escapeHtml(row.student_name)}</td><td class="text-cell">${escapeHtml(row.teacher_name)}</td><td class="text-cell">${escapeHtml(row.date)}</td><td class="text-cell">${statusBadge(rowStatus(row))}</td><td class="text-cell">${escapeHtml(row.weekday)}</td><td class="text-cell">${escapeHtml(row.time_slot)}</td><td class="text-cell">${escapeHtml(row.classroom)}</td><td class="text-cell">${escapeHtml(row.grade)}</td><td class="text-cell">${escapeHtml(row.subject)}</td><td class="text-cell">${escapeHtml(row.notes)}</td>${readonlyPriceCell(row)}
              </tr>
            `).join("") || `<tr><td colspan="11" class="empty">暂无课程明细</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAudit() {
  const workbookOptions = (state.source_workbooks || []).map((item) => (
    `<option value="${escapeHtml(item.filename)}" ${item.filename === auditSourceWorkbook ? "selected" : ""}>${escapeHtml(item.filename)}${item.month_key ? `（${escapeHtml(item.month_key.slice(0, 7))}）` : ""}</option>`
  )).join("");
  renderTopbar(
    `${monthLabel()} 数据对账`,
    "xlsx 源头比对 + 内部规则校验",
    `<button class="btn audit-refresh-logs" type="button">历史审计</button>`,
  );
  contentEl.innerHTML = `
    ${auditRiskOverview()}
    ${auditState.notice ? `<div class="audit-inline-notice">${escapeHtml(auditState.notice)}</div>` : ""}

    <div class="band audit-panel">
      <div class="section-head">
        <div class="section-title">数据导出</div>
      </div>
      <div class="audit-toolbar">
        <button class="btn primary export-core-workbook" type="button" ${auditState.busy ? "disabled" : ""}>导出核心 Excel</button>
      </div>
    </div>

    <div class="band audit-panel">
      <div class="section-head">
        <div class="section-title">源头对账</div>
      </div>
      <div class="audit-toolbar">
        <input class="control audit-file" type="file" accept=".xlsx">
        <button class="btn primary audit-run-xlsx" type="button" ${auditState.busy ? "disabled" : ""}>上传并对账</button>
        <button class="btn audit-fix-critical" type="button" ${auditState.xlsxReport?.counts?.CRITICAL ? "" : "disabled"}>一键以 xlsx 为准修复所有 CRITICAL</button>
      </div>
      <div class="audit-toolbar audit-source-import">
        <select class="control audit-source-workbook" ${workbookOptions ? "" : "disabled"}>
          ${workbookOptions || `<option value="">未找到 source-workbooks/*.xlsx</option>`}
        </select>
        <button class="btn primary audit-import-source" type="button" ${auditState.busy || !workbookOptions ? "disabled" : ""}>导入源文件并对账</button>
        <span class="audit-toolbar-note">会先备份数据库，再导入课程、充值、学生单价、费用标准和教师交通费。</span>
      </div>
      ${auditSourceMeta(auditState.xlsxReport)}
      <div class="audit-counts">${auditCounts(auditState.xlsxReport)}</div>
      ${groupedIssueTable(auditState.xlsxReport, "xlsxReport")}
    </div>

    <div class="band audit-panel">
      <div class="section-head">
        <div class="section-title">内部规则校验</div>
      </div>
      <div class="audit-toolbar">
        <button class="btn primary audit-run-internal" type="button" ${auditState.busy ? "disabled" : ""}>运行内部校验</button>
      </div>
      <div class="audit-counts">${auditCounts(auditState.internalReport)}</div>
      ${groupedIssueTable(auditState.internalReport, "internalReport")}
    </div>

    <details class="band audit-history" ${auditState.logs.length ? "open" : ""}>
      <summary class="section-head">
        <div class="section-title">历史审计</div>
      </summary>
      <div class="table-wrap smooth-table-wrap">
        <table class="audit-table uniform-table nowrap-table">
          <thead><tr><th>ID</th><th>时间</th><th>来源</th><th>级别</th><th>实体</th><th>字段</th><th>状态</th><th>说明</th></tr></thead>
          <tbody>
            ${auditState.logs.map((log) => `
              <tr>
                <td class="text-cell">${log.id}</td>
                <td class="text-cell">${escapeHtml(log.run_at)}</td>
                <td class="text-cell">${escapeHtml(log.source)}</td>
                <td class="text-cell"><span class="severity-pill ${escapeHtml(log.severity)}">${escapeHtml(log.severity)}</span></td>
                <td class="text-cell">${escapeHtml(log.entity)}</td>
                <td class="text-cell">${escapeHtml(log.field)}</td>
                <td class="text-cell">${escapeHtml(log.status)}</td>
                <td class="text-cell">${escapeHtml(log.notes)}</td>
              </tr>
            `).join("") || `<tr><td colspan="8" class="empty">暂无审计历史</td></tr>`}
          </tbody>
        </table>
      </div>
    </details>
    <details class="band audit-history" ${auditState.events.length ? "open" : ""}>
      <summary class="section-head">
        <div class="section-title">操作审计日志</div>
      </summary>
      <div class="table-wrap smooth-table-wrap">
        <table class="audit-table uniform-table nowrap-table">
          <thead><tr><th>时间</th><th>操作者</th><th>角色</th><th>动作</th><th>对象</th><th>对象 ID</th><th>IP</th></tr></thead>
          <tbody>
            ${auditState.events.map((event) => `
              <tr>
                <td class="text-cell">${escapeHtml(formatBeijingTime(event.created_at))}</td>
                <td class="text-cell">${escapeHtml(event.actor_username)}</td>
                <td class="text-cell">${escapeHtml(ROLE_LABELS[event.actor_role] || event.actor_role)}</td>
                <td class="text-cell">${escapeHtml(event.action)}</td>
                <td class="text-cell">${escapeHtml(event.entity_type)}</td>
                <td class="text-cell">${escapeHtml(event.entity_id)}</td>
                <td class="text-cell">${escapeHtml(event.ip || "")}</td>
              </tr>
            `).join("") || `<tr><td colspan="7" class="empty">暂无操作审计日志</td></tr>`}
          </tbody>
        </table>
      </div>
    </details>
  `;
}

function roleSelectOptions(value) {
  const labels = { ...ROLE_LABELS, ...(auth.roles || {}) };
  const roles = ACCOUNT_ROLE_CODES.filter((role) => Object.prototype.hasOwnProperty.call(auth.roles || labels, role));
  return roles.map((role) => `<option value="${escapeHtml(role)}" ${role === value ? "selected" : ""}>${escapeHtml(labels[role] || role)}</option>`).join("");
}

function isOwnerRoleValue(role) {
  return ["owner", "boss", "admin", "老板", "管理员"].includes(String(role || "").trim());
}

function renderUserAdminTabs() {
  const tabs = [
    ["roles", "角色管理"],
    ["accounts", "账号管理"],
  ];
  return `
    <div class="user-admin-tabs">
      ${tabs.map(([key, label]) => `
        <button class="user-admin-tab ${userAdminTab === key ? "active" : ""}" type="button" data-tab="${key}">${escapeHtml(label)}</button>
      `).join("")}
    </div>
  `;
}

function renderUserAccountsPanel() {
  const users = state.users || [];
  const canImportTeachers = canArea("users");
  const teacherValues = uniqueSorted((state.profile_teachers || []).map((row) => row.name).filter(Boolean));
  return `
    <div class="user-admin-actions">
      <button class="btn download-user-import-template" type="button" ${canImportTeachers ? "" : "disabled"}>下载导入模板</button>
      <button class="btn primary import-teacher-users" type="button" ${canImportTeachers ? "" : "disabled"}>从模板导入账号</button>
      <button class="btn sync-teacher-accounts" type="button" ${canImportTeachers ? "" : "disabled"}>同步老师账号</button>
    </div>
    <div class="band user-admin-panel">
      <div class="section-head">
        <div>
          <div class="section-title">新增账号</div>
          <div class="section-subtitle">老师账号建议使用手机号作为账号，老师姓名必须与课表中的授课老师一致。</div>
        </div>
      </div>
      <div class="user-create-grid">
        <input class="control new-user-field" data-field="username" name="new_account_id" autocomplete="off" placeholder="账号/手机号">
        <input class="control new-user-field" data-field="display_name" name="new_account_display_name" autocomplete="off" placeholder="显示姓名">
        <select class="control new-user-field" data-field="role">${roleSelectOptions(auth.user?.role === "academic" ? "teacher" : "teacher")}</select>
        ${multiSelectControl({ className: "new-user-teachers", field: "teacher_names", selected: [], values: teacherValues, placeholder: "绑定老师", clearLabel: "清空", dataAttr: "field", includeSelected: false, searchable: true })}
        <input class="control new-user-field" data-field="password" name="new_account_secret" type="password" autocomplete="new-password" placeholder="初始密码，至少 6 位">
        <button class="btn primary create-user" type="button">新增账号</button>
      </div>
    </div>
    <div class="band user-admin-panel">
      <div class="table-wrap">
        <table class="user-table uniform-table nowrap-table">
          <thead><tr><th>账号</th><th>显示姓名</th><th>角色</th><th>绑定老师</th><th>状态</th><th>重置密码</th><th>删除</th></tr></thead>
          <tbody>
            ${users.map((user) => {
              const teacherNames = normalizeNameList(user.bound_teacher_names || user.teacher_names || user.teacher_name);
              const ownerAccount = isOwnerRoleValue(user.role);
              const isSelf = Number(auth.user?.id) === Number(user.id);
              const canDelete = auth.user?.role === "owner" && !isSelf && !ownerAccount;
              const deleteTitle = ownerAccount ? "老板账号不可删除" : (isSelf ? "不能删除当前登录账号" : "软删除账号");
              return `
              <tr class="user-row" data-id="${user.id}">
                <td><input class="cell-input user-field" data-field="username" value="${escapeHtml(user.username)}"></td>
                <td><input class="cell-input user-field" data-field="display_name" value="${escapeHtml(user.display_name || "")}"></td>
                <td><select class="cell-select user-field" data-field="role">${roleSelectOptions(user.role)}</select></td>
                <td>${multiSelectControl({ className: "user-row-teachers", field: "teacher_names", selected: teacherNames, values: teacherValues, placeholder: "未绑定", clearLabel: "清空", dataAttr: "field", includeSelected: false, searchable: true })}</td>
                <td><select class="cell-select user-field" data-field="status">${options(["active", "disabled"], user.status || "active")}</select></td>
                <td class="readonly user-actions-cell">
                  <input class="control user-reset-password-value" type="password" autocomplete="new-password" placeholder="新密码">
                  <button class="btn user-reset-password" type="button">重置</button>
                </td>
                <td class="readonly">
                  <button class="btn danger user-delete" type="button" data-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}" ${canDelete ? "" : "disabled"} title="${escapeHtml(deleteTitle)}">删除</button>
                </td>
              </tr>
            `;
            }).join("") || `<tr><td colspan="7" class="empty">暂无账号</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAppearance() {
  renderTopbar("外观设置", "主题与配色方案");
  contentEl.innerHTML = `
    <div class="band appearance-settings">
      <div class="section-head">
        <div>
          <div class="section-title">外观设置</div>
          <div class="section-subtitle">调整系统界面的明暗主题和品牌配色，设置会保存在当前浏览器。</div>
        </div>
      </div>
      <div class="appearance-settings-grid">
        <label class="appearance-field">
          <span>主题</span>
          <select class="control theme-select" title="默认跟随系统">
            <option value="system" ${themeMode === "system" ? "selected" : ""}>跟随系统</option>
            <option value="light" ${themeMode === "light" ? "selected" : ""}>亮色</option>
            <option value="dark" ${themeMode === "dark" ? "selected" : ""}>暗色</option>
          </select>
        </label>
        <label class="appearance-field">
          <span>配色方案</span>
          <select class="control palette-select" title="选择配色方案">
            ${PALETTES.map((palette) => `
              <option value="${palette.key}" ${paletteMode === palette.key ? "selected" : ""}>${escapeHtml(palette.label)}</option>
            `).join("")}
          </select>
        </label>
        <div class="appearance-preview">
          <span>当前配色</span>
          ${renderPalettePreview()}
        </div>
        <label class="appearance-field shot-follow-palette-field">
          <span>课程截图配色</span>
          <label class="history-toggle" style="align-self:start;margin-top:2px;">
            <input class="shot-follow-palette" type="checkbox" ${shotFollowPalette ? "checked" : ""}>
            <span>课程截图跟随当前配色方案</span>
          </label>
          <span style="color:var(--muted);font-size:0.75rem;line-height:1.4;">关闭时，课程截图固定使用黎明蓝，适合发给家长保持统一品牌视觉。</span>
        </label>
      </div>
    </div>
  `;
}

function settingsArray(key) {
  try {
    const parsed = JSON.parse(state?.settings?.[key] || "[]");
    return Array.isArray(parsed) ? uniqueSorted(parsed) : [];
  } catch {
    return [];
  }
}

function selectorEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value || "").replace(/["\\]/g, "\\$&");
}

function baseDataDefinitions() {
  return [
    {
      key: "classrooms",
      title: "教室",
      settingKey: "custom_classrooms",
      placeholder: "例如 C6",
      values: uniqueSorted([...(state.lookups?.classrooms || []), ...(state.used_lesson_lookups?.classrooms || [])]),
    },
    {
      key: "subjects",
      title: "科目",
      settingKey: "custom_subjects",
      placeholder: "例如 政治",
      values: uniqueSorted([...(state.lookups?.subjects || []), ...(state.used_lesson_lookups?.subjects || [])]),
    },
    {
      key: "times",
      title: "常用时间",
      settingKey: "custom_time_slots",
      placeholder: "例如 19:00-21:00",
      values: uniqueSorted([...(state.lookups?.times || []), ...(state.used_lesson_lookups?.times || [])]),
    },
    {
      key: "statuses",
      title: "课程状态",
      settingKey: "custom_course_statuses",
      placeholder: "例如 调课",
      values: uniqueSorted([...(state.lookups?.status || defaultCourseStatuses)]),
    },
  ];
}

function baseDataCard(def) {
  const customValues = settingsArray(def.settingKey);
  return `
    <div class="base-data-card" data-setting-key="${escapeHtml(def.settingKey)}">
      <div class="section-head base-data-card-head">
        <div>
          <div class="section-title">${escapeHtml(def.title)}</div>
          <div class="section-subtitle">新增值会进入新增课程候选；删除只移除基础字典，不删除历史课程。</div>
        </div>
      </div>
      <div class="base-data-add-row">
        <input class="control base-data-new-value" data-setting-key="${escapeHtml(def.settingKey)}" placeholder="${escapeHtml(def.placeholder)}">
        <button class="btn primary base-data-add" type="button" data-setting-key="${escapeHtml(def.settingKey)}">新增</button>
      </div>
      <div class="base-data-list-title">自定义值</div>
      <div class="base-data-custom-list">
        ${customValues.map((value) => `
          <span class="base-data-item">
            <span>${escapeHtml(value)}</span>
            <button class="base-data-delete" type="button" data-setting-key="${escapeHtml(def.settingKey)}" data-value="${escapeHtml(value)}" title="从基础字典删除">×</button>
          </span>
        `).join("") || `<span class="muted-tip">暂无自定义值</span>`}
      </div>
      <div class="base-data-list-title">当前候选（默认 + 自定义 + 历史使用）</div>
      <div class="base-data-chip-list">
        ${def.values.map((value) => `<span class="neutral-chip">${escapeHtml(value)}</span>`).join("") || `<span class="muted-tip">暂无候选</span>`}
      </div>
    </div>
  `;
}

function flattenPermissionTree(nodes = state.permission_tree || []) {
  const keys = [];
  const visit = (node) => {
    if (node.children?.length) node.children.forEach(visit);
    else keys.push(node.key);
  };
  nodes.forEach(visit);
  return keys;
}

function roleCanDelete(role) {
  return !Number(role.is_system) && Number(role.user_count || 0) === 0;
}

function renderRoleManagementPanel() {
  const roles = state.roles || [];
  const canManageRoles = auth.user?.role === "owner";
  if (!canManageRoles) {
    return `<div class="band"><div class="empty">当前账号无权限维护角色。</div></div>`;
  }
  return `
    <div class="band user-admin-panel role-admin-panel">
      <div class="section-head">
        <div>
          <div class="section-title">角色管理</div>
          <div class="section-subtitle">五类内置角色名称固定，可编辑各角色的页面权限。</div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="user-table role-table uniform-table nowrap-table">
          <thead><tr><th>角色名称</th><th>是否只读</th><th>编辑</th><th>删除</th></tr></thead>
          <tbody>
            ${roles.map((role) => `
              <tr class="role-row" data-code="${escapeHtml(role.code)}">
                <td class="text-cell">
                  <strong>${escapeHtml(role.name)}</strong>
                  <span class="role-code">${escapeHtml(role.code)}</span>
                  ${Number(role.is_system) ? `<span class="neutral-chip">系统</span>` : ""}
                  <div class="muted-tip">${escapeHtml(role.description || "")}</div>
                </td>
                <td class="text-cell">${Number(role.readonly) ? "是" : "否"}</td>
                <td><button class="btn role-edit" type="button" data-code="${escapeHtml(role.code)}">编辑</button></td>
                <td><button class="btn danger role-delete" type="button" data-code="${escapeHtml(role.code)}" ${roleCanDelete(role) ? "" : "disabled"} title="${Number(role.is_system) ? "系统内置角色不能删除" : Number(role.user_count || 0) ? "该角色下仍有关联账号，不能删除" : "删除角色"}">删除</button></td>
              </tr>
            `).join("") || `<tr><td colspan="4" class="empty">暂无角色</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    ${rolePermissionModalMarkup()}
  `;
}

function permissionNodeMarkup(node, selectedSet) {
  if (node.children?.length) {
    const childKeys = [];
    const collect = (item) => {
      if (item.children?.length) item.children.forEach(collect);
      else childKeys.push(item.key);
    };
    node.children.forEach(collect);
    const checked = childKeys.every((key) => selectedSet.has(key));
    const partial = !checked && childKeys.some((key) => selectedSet.has(key));
    return `
      <details class="permission-tree-group" open>
        <summary>
          <input class="permission-parent" type="checkbox" data-children="${escapeHtml(childKeys.join(","))}" ${checked ? "checked" : ""} data-partial="${partial ? "1" : "0"}">
          <span>${escapeHtml(node.label)}</span>
        </summary>
        <div class="permission-tree-children">
          ${node.children.map((child) => permissionNodeMarkup(child, selectedSet)).join("")}
        </div>
      </details>
    `;
  }
  return `
    <label class="permission-leaf">
      <input class="permission-child" type="checkbox" value="${escapeHtml(node.key)}" ${selectedSet.has(node.key) ? "checked" : ""}>
      <span>${escapeHtml(node.label)}</span>
    </label>
  `;
}

function rolePermissionModalMarkup() {
  if (!rolePermissionModal) return "";
  const role = rolePermissionModal;
  const selectedSet = new Set(role.permissions || []);
  const isOwner = role.code === "owner" || role.code === "boss";
  const isSystem = Number(role.is_system) === 1;
  const teacherValues = uniqueSorted((state.profile_teachers || []).map((row) => row.name));
  const presets = role.filter_presets || {};
  return `
    <div class="modal-backdrop role-permission-modal">
      <div class="modal-panel role-permission-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">编辑角色权限</div>
            <div class="modal-subtitle">${escapeHtml(role.code)}${isOwner ? " · 老板角色默认拥有全部权限" : ""}</div>
          </div>
          <button class="btn role-permission-cancel" type="button">关闭</button>
        </div>
        <div class="role-modal-tabs">
          <button class="role-modal-tab active" type="button" data-panel="permissions">基本权限</button>
          <button class="role-modal-tab" type="button" data-panel="presets">预筛选</button>
        </div>
        <div class="role-modal-body">
          <section class="role-modal-panel active" data-panel="permissions">
            <div class="role-edit-fields">
              <label>角色名称<input class="control role-modal-field" data-field="name" value="${escapeHtml(role.name || "")}" ${isSystem ? "disabled" : ""}></label>
              <label>说明<input class="control role-modal-field" data-field="description" value="${escapeHtml(role.description || "")}"></label>
              <label class="history-toggle role-readonly-toggle">
                <input class="role-readonly-field" type="checkbox" ${Number(role.readonly) ? "checked" : ""} ${isOwner ? "disabled" : ""}>
                <span>是否只读</span>
              </label>
            </div>
            <div class="permission-tree ${isOwner ? "readonly" : ""}">
              ${(state.permission_tree || []).map((node) => permissionNodeMarkup(node, selectedSet)).join("")}
            </div>
          </section>
          <section class="role-modal-panel" data-panel="presets">
            <div class="role-preset-grid">
              ${ACCOUNT_FILTER_PRESET_DEFS.map((viewDef) => `
                <div class="role-preset-card">
                  <div class="account-preset-title">${escapeHtml(viewDef.label)}</div>
                  <div class="account-preset-fields">
                    ${viewDef.fields.map((fieldDef) => rolePresetFieldMarkup(viewDef, fieldDef, presets, teacherValues)).join("")}
                  </div>
                </div>
              `).join("")}
            </div>
          </section>
        </div>
        <div class="modal-actions">
          <button class="btn role-permission-cancel" type="button">取消</button>
          <button class="btn primary role-permission-save" type="button">保存</button>
        </div>
      </div>
    </div>
  `;
}

function rolePresetFieldMarkup(viewDef, fieldDef, presets, teacherValues) {
  const viewPreset = presets?.[viewDef.view] || {};
  const value = viewPreset[fieldDef.key];
  if (fieldDef.type === "teachers") {
    const dynamicBound = isBoundTeacherPresetValue(value);
    const selectedTeachers = dynamicBound ? [] : normalizeNameList(value || []);
    const mode = dynamicBound ? "bound" : (selectedTeachers.length ? "specific" : "");
    return `
      <label class="account-preset-field-wrap role-preset-field-wrap" data-view="${escapeHtml(viewDef.view)}" data-key="${escapeHtml(fieldDef.key)}" data-type="teachers">
        <span>${escapeHtml(fieldDef.label)}</span>
        <select class="control role-preset-teacher-mode">
          <option value="" ${mode === "" ? "selected" : ""}>不预设</option>
          <option value="bound" ${mode === "bound" ? "selected" : ""}>绑定老师</option>
          <option value="specific" ${mode === "specific" ? "selected" : ""}>指定老师</option>
        </select>
        <span class="role-preset-teachers-wrap" ${mode === "specific" ? "" : "hidden"}>
          ${multiSelectControl({ className: "role-preset-field role-preset-teachers", field: `${viewDef.view}.${fieldDef.key}`, selected: selectedTeachers, values: teacherValues, placeholder: "不预设", clearLabel: "清空" })}
        </span>
      </label>
    `;
  }
  if (fieldDef.type === "date-rule") {
    const config = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const selectedRule = config.type === "fixed" ? "fixed" : (config.value || "unlimited");
    const fixedDate = config.type === "fixed" ? config.value : "";
    const ruleOptions = fieldDef.bound === "end" ? END_DATE_PRESET_OPTIONS : START_DATE_PRESET_OPTIONS;
    return `
      <label class="account-preset-field-wrap role-preset-field-wrap role-preset-date-wrap" data-view="${escapeHtml(viewDef.view)}" data-key="${escapeHtml(fieldDef.key)}" data-type="date-rule">
        <span>${escapeHtml(fieldDef.label)}</span>
        <select class="control role-preset-date-rule">
          ${ruleOptions.map(([rule, label]) => `<option value="${escapeHtml(rule)}" ${selectedRule === rule ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
        </select>
        <input class="control role-preset-fixed-date" type="date" value="${escapeHtml(fixedDate)}" ${selectedRule === "fixed" ? "" : "hidden"}>
      </label>
    `;
  }
  return `
    <label class="account-preset-field-wrap role-preset-field-wrap" data-view="${escapeHtml(viewDef.view)}" data-key="${escapeHtml(fieldDef.key)}">
      <span>${escapeHtml(fieldDef.label)}</span>
      <input class="control role-preset-field" value="${escapeHtml(value || "")}" placeholder="不预设">
    </label>
  `;
}

function isBoundTeacherPresetValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && (value.mode === "bound_teachers" || (value.type === "dynamic" && value.value === "bound_teachers"));
}

function userAccessModalMarkup() {
  if (!userAccessModal) return "";
  const user = userAccessModal;
  const isOverride = Number(user.permission_override_enabled || 0) === 1;
  const selectedSet = new Set(isOverride ? (user.permissions || []) : (user.role_permissions || user.permissions || []));
  const readonlyValue = user.readonly_override === null || user.readonly_override === undefined ? "" : String(Number(user.readonly_override));
  const teacherValues = uniqueSorted([
    ...(state.profile_teachers || []).map((row) => row.name),
    ...normalizeNameList(user.bound_teacher_names || user.teacher_names || user.teacher_name),
  ]);
  return `
    <div class="modal-backdrop user-access-modal">
      <div class="modal-panel user-access-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">账号权限配置</div>
            <div class="modal-subtitle">${escapeHtml(user.display_name || user.username)} · ${escapeHtml(user.username || "")}</div>
          </div>
          <button class="btn user-access-cancel" type="button">关闭</button>
        </div>
        <div class="user-access-grid">
          <section class="user-access-section">
            <div class="section-title compact">只读与绑定</div>
            <div class="user-access-fields">
              <label>
                <span>是否只读</span>
                <select class="control user-access-readonly">
                  <option value="" ${readonlyValue === "" ? "selected" : ""}>跟随角色</option>
                  <option value="0" ${readonlyValue === "0" ? "selected" : ""}>可编辑</option>
                  <option value="1" ${readonlyValue === "1" ? "selected" : ""}>只读</option>
                </select>
              </label>
              <label>
                <span>绑定老师</span>
                ${multiSelectControl({ className: "user-access-teachers", field: "teacher_names", selected: user.bound_teacher_names || user.teacher_names || user.teacher_name, values: teacherValues, placeholder: "未绑定", clearLabel: "清空" })}
              </label>
            </div>
          </section>
          <section class="user-access-section">
            <div class="section-title compact">页面权限</div>
            <label class="history-toggle user-access-override-toggle">
              <input class="user-access-permission-override" type="checkbox" ${isOverride ? "checked" : ""}>
              <span>使用账号级页面权限</span>
            </label>
            <div class="permission-tree user-access-permission-tree">
              ${(state.permission_tree || []).map((node) => permissionNodeMarkup(node, selectedSet)).join("")}
            </div>
          </section>
        </div>
        <div class="modal-actions">
          <button class="btn user-access-cancel" type="button">取消</button>
          <button class="btn primary user-access-save" type="button" data-id="${escapeHtml(user.id)}">保存配置</button>
        </div>
      </div>
    </div>
  `;
}

function collectRoleModalPermissions() {
  if (rolePermissionModal?.code === "owner" || rolePermissionModal?.code === "boss") return flattenPermissionTree();
  return [...document.querySelectorAll(".permission-child:checked")].map((input) => input.value);
}

function collectRoleFilterPresets() {
  const presets = {};
  document.querySelectorAll(".role-preset-field-wrap").forEach((wrap) => {
    const viewKey = wrap.dataset.view || "";
    const key = wrap.dataset.key || "";
    if (!viewKey || !key) return;
    let value = "";
    if (wrap.dataset.type === "teachers") {
      const mode = wrap.querySelector(".role-preset-teacher-mode")?.value || "";
      if (mode === "bound") value = { mode: "bound_teachers" };
      else if (mode === "specific") value = normalizeNameList(wrap.querySelector(".multi-select-value")?.value || "");
    } else if (wrap.dataset.type === "date-rule") {
      const rule = wrap.querySelector(".role-preset-date-rule")?.value || "unlimited";
      if (rule === "fixed") {
        const fixedDate = wrap.querySelector(".role-preset-fixed-date")?.value || "";
        value = fixedDate ? { type: "fixed", value: fixedDate } : "";
      } else if (rule !== "unlimited") {
        value = { type: "relative", value: rule };
      }
    } else {
      value = String(wrap.querySelector(".role-preset-field")?.value || "").trim();
    }
    if (Array.isArray(value) ? !value.length : !value) return;
    if (!presets[viewKey]) presets[viewKey] = {};
    presets[viewKey][key] = value;
  });
  return presets;
}

function collectUserAccessPayload() {
  const modal = document.querySelector(".user-access-modal");
  if (!modal) return {};
  const readonlyValue = modal.querySelector(".user-access-readonly")?.value ?? "";
  const permissions = [...modal.querySelectorAll(".permission-child:checked")].map((input) => input.value);
  const teacherNames = normalizeNameList(modal.querySelector(".multi-select-value.user-access-teachers")?.value || "");
  return {
    readonly_override: readonlyValue === "" ? null : Number(readonlyValue),
    permission_override_enabled: modal.querySelector(".user-access-permission-override")?.checked ? 1 : 0,
    permissions,
    teacher_names: teacherNames,
  };
}

function updatePermissionParentStates() {
  document.querySelectorAll(".permission-parent").forEach((parent) => {
    const children = String(parent.dataset.children || "").split(",").filter(Boolean);
    const childInputs = children.map((key) => document.querySelector(`.permission-child[value="${selectorEscape(key)}"]`)).filter(Boolean);
    const checkedCount = childInputs.filter((input) => input.checked).length;
    parent.checked = childInputs.length > 0 && checkedCount === childInputs.length;
    parent.indeterminate = checkedCount > 0 && checkedCount < childInputs.length;
  });
}

function renderUserAdmin() {
  renderTopbar(
    "账号权限",
    userAdminTab === "roles" ? "维护角色和页面可见权限" : (auth.user?.role === "academic" ? "教务仅可维护老师账号" : "维护账号、角色和绑定老师"),
  );
  contentEl.innerHTML = `
    ${userAdminNotice ? `<div class="audit-inline-notice">${escapeHtml(userAdminNotice)}</div>` : ""}
    ${renderUserAdminTabs()}
    ${userAdminTab === "roles" ? renderRoleManagementPanel() : renderUserAccountsPanel()}
  `;
  document.querySelectorAll(".permission-parent").forEach((input) => {
    input.indeterminate = input.dataset.partial === "1";
  });
}

function renderBaseData() {
  renderTopbar("基础数据", "维护新增课程常用选项；历史课程使用过的值仍会保留在候选项中");
  contentEl.innerHTML = `
    <div class="band base-data-panel">
      <div class="section-head">
        <div>
          <div class="section-title">基础数据 / 数据字典</div>
          <div class="section-subtitle">第一阶段管理教室、科目、常用时间和课程状态。老师、学生仍在档案页维护，年级继续使用固定顺序。</div>
        </div>
      </div>
      <div class="base-data-grid">
        ${baseDataDefinitions().map(baseDataCard).join("")}
      </div>
    </div>
  `;
}

function renderPricing() {
  const rows = [...state.pricing_standards].sort((a, b) => {
    const g = gradeOrder.indexOf(a.grade) - gradeOrder.indexOf(b.grade);
    return g || a.student_count - b.student_count;
  });
  renderTopbar("费用标准设置", "年级与人数分档", historyToggleAction());
  contentEl.innerHTML = `
    <div class="band">
      <div class="table-wrap">
        <table class="pricing-table uniform-table nowrap-table">
          <thead><tr><th>年级</th><th>人数</th><th>单人费用</th><th>查找键</th><th>说明</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td class="text-cell">${escapeHtml(row.grade)}</td>
                <td class="text-cell right">${row.student_count}</td>
                <td class="currency-input-cell">${currencyInputMarkup(row.unit_price, { className: "pricing-field", attrs: `data-id="${row.id}" data-field="unit_price"` })}</td>
                <td class="text-cell">${escapeHtml(`${row.grade}-${row.student_count}`)}</td>
                <td><input class="cell-input pricing-field wide" data-id="${row.id}" data-field="description" value="${escapeHtml(row.description)}"></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function pricingAuditDetails() {
  if (!pricingAuditModal) return [];
  return (state.derived.fee_details || [])
    .filter((row) => row.student_name === pricingAuditModal.student_name && row.subject === pricingAuditModal.subject)
    .filter((row) => !pricingAuditModal.grade || row.grade === pricingAuditModal.grade)
    .filter((row) => !pricingAuditModal.student_names || row.student_names === pricingAuditModal.student_names)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time_slot).localeCompare(String(b.time_slot)));
}

function pricingAuditModalMarkup() {
  if (!pricingAuditModal) return "";
  const pricing = state.student_pricing.find((row) => (
    row.student_name === pricingAuditModal.student_name
    && row.subject === pricingAuditModal.subject
    && String(row.grade || "") === String(pricingAuditModal.grade || "")
    && String(row.student_names || "") === String(pricingAuditModal.student_names || "")
  )) || pricingAuditModal;
  const customPrice = numberValue(pricing.custom_price);
  const details = pricingAuditDetails();
  const manualCount = details.filter((row) => row.price_source === "manual").length;
  return `
    <div class="modal-backdrop pricing-audit-modal">
      <div class="modal-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">${escapeHtml(pricing.student_name)} · ${escapeHtml(pricing.subject)} · ${monthLabel()}影响审计</div>
            <div class="modal-subtitle">当前规则单价 ${formatMoney(customPrice)}，本月命中 ${details.length} 节课，手填覆盖 ${manualCount} 条。</div>
          </div>
          <button class="btn pricing-audit-cancel" type="button">取消</button>
        </div>
        <div class="table-wrap">
          <table class="pricing-audit-table">
            <thead><tr><th>日期</th><th>状态</th><th>当前单价</th><th>来源</th><th>与规则差额</th></tr></thead>
            <tbody>
              ${details.map((row) => {
                const diff = numberValue(row.unit_price) - customPrice;
                return `
                  <tr>
                    <td class="text-cell">${escapeHtml(row.date)}</td>
                    <td class="text-cell">${statusBadge(rowStatus(row))}</td>
                    <td class="text-cell right price-cell-wrap"><span class="price-inline"><span class="price-amount">${formatMoney(row.unit_price)}</span>${priceSourceBadge(row)}</span></td>
                    <td class="text-cell">${priceSourceLabel(row.price_source)}</td>
                    <td class="text-cell right ${diff !== 0 ? "negative" : ""}">${formatMoney(diff)}</td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="5" class="empty">本月没有命中课程</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="modal-actions">
          <button class="btn pricing-audit-cancel" type="button">取消</button>
          <button class="btn primary pricing-recompute" type="button" ${details.length ? "" : "disabled"} data-name="${escapeHtml(pricing.student_name)}" data-subject="${escapeHtml(pricing.subject)}" data-count="${details.length}" data-manual-count="${manualCount}" data-price="${money(customPrice)}">全部重算（按最新规则单价）</button>
        </div>
      </div>
    </div>
  `;
}

function studentPricingMatchesFilter(row) {
  const filter = studentPricingFilter;
  const studentNeedle = filter.student.trim().toLowerCase();
  if (studentNeedle) {
    const haystack = [
      row.student_name,
      row.grade,
      row.student_names,
      row.lookup_key,
      row.notes,
    ].map((value) => String(value || "").toLowerCase()).join(" ");
    if (!haystack.includes(studentNeedle)) return false;
  }
  if (filter.grade && !textContains(row.grade, filter.grade)) return false;
  if (filter.subject && !textContains(row.subject, filter.subject)) return false;
  if (filter.student_names && !textContains(row.student_names, filter.student_names)) return false;
  if (filter.price) {
    const source = priceSourceFilterValue(row.rule_source);
    const sourceLabel = priceSourceLabel(source);
    if (filter.price !== source && !textContains(sourceLabel, filter.price)) return false;
  }
  const currentLessons = numberValue(row.current_month_lessons);
  const totalLessons = numberValue(row.total_lessons);
  if (filter.usage === "current" && currentLessons <= 0) return false;
  if (filter.usage === "historical" && (currentLessons > 0 || totalLessons <= 0)) return false;
  if (filter.usage === "unused" && totalLessons > 0) return false;
  return true;
}

function renderStudentPricingFilterBar(rows, visibleRows) {
  const students = uniqueSorted(rows.map((row) => row.student_name));
  const grades = uniqueSorted(rows.map((row) => row.grade));
  const studentGroups = uniqueSorted(rows.map((row) => row.student_names));
  return `
    <div class="filter-bar compact student-pricing-filter-bar">
      <label>学生/备注</label>
      ${filterComboControl({ className: "student-pricing-filter-input", field: "student", value: studentPricingFilter.student, values: students, placeholder: "输入或选择学生/备注" })}
      <label>年级</label>
      ${filterComboControl({ className: "student-pricing-filter-input", field: "grade", value: studentPricingFilter.grade, values: grades, placeholder: "输入或选择年级" })}
      <label>科目</label>
      ${filterComboControl({ className: "student-pricing-filter-input", field: "subject", value: studentPricingFilter.subject, values: state.lookups.subjects, placeholder: "输入或选择科目" })}
      <label>学生集合</label>
      ${filterComboControl({ className: "student-pricing-filter-input", field: "student_names", value: studentPricingFilter.student_names, values: studentGroups, placeholder: "输入或选择学生集合" })}
      <label>价格状态</label>
      ${filterComboControl({ className: "student-pricing-filter-input", field: "price", value: filterLabel(priceFilterOptions, studentPricingFilter.price), values: priceFilterOptions.map((item) => item[1]), placeholder: "输入或选择价格状态" })}
      <div class="filter-summary">
        <span>已筛选 <b>${visibleRows.length}</b> / 共 ${rows.length} 条</span>
        <button class="btn reset-student-pricing-filter" type="button">清空筛选</button>
      </div>
    </div>
  `;
}

function renderStudentPricing() {
  const rows = [...(state.student_pricing || [])].sort(compareStudentPricingRule);
  const visibleRows = rows.filter(studentPricingMatchesFilter);
  const unsetRows = rows.filter((row) => numberValue(row.custom_price) <= 0);
  renderTopbar("学生单价规则", `已筛选 ${visibleRows.length} / 共 ${rows.length} 条规则`, historyToggleAction());
  contentEl.innerHTML = `
    ${unsetRows.length ? `
      <div class="finance-notice-list">
        <div class="finance-notice">
          <strong>发现 ${unsetRows.length} 条未设置单价规则</strong>
          <span>单价为 0 的规则只作为候选保留，不参与费用规则匹配；填写有效金额后才会用于自动判断。</span>
        </div>
      </div>
    ` : ""}
    <div class="band">
      <div class="section-head">
        <div>
          <div class="section-title">学生收费规则</div>
          <div class="section-subtitle">规则候选由历史课程自动生成；学生、年级、科目和学生集合只读，填写单价后参与费用明细判断。</div>
        </div>
      </div>
      ${renderStudentPricingFilterBar(rows, visibleRows)}
      <div class="table-wrap smooth-table-wrap">
        <table class="student-pricing-table uniform-table nowrap-table">
          <thead><tr><th>学生</th><th>年级</th><th>科目</th><th>学生集合</th><th>单价</th><th>价格状态</th><th class="wide">备注</th></tr></thead>
          <tbody>
            ${visibleRows.map((row) => `
              <tr class="student-pricing-rule-row" data-rule-id="${row.id}"${gradeRowStyle(row.grade)}>
                <td class="text-cell">${escapeHtml(row.student_name)}</td>
                <td class="text-cell">${escapeHtml(row.grade)}</td>
                <td class="text-cell">${escapeHtml(row.subject)}</td>
                <td class="text-cell wide">${escapeHtml(row.student_names || "")}</td>
                <td class="currency-input-cell">${currencyInputMarkup(row.custom_price, { className: `student-pricing-field ${numberValue(row.custom_price) <= 0 ? "warning-cell" : ""}`, attrs: `data-id="${row.id}" data-field="custom_price" min="0" step="0.01"` })}</td>
                <td class="text-cell">${priceSourceLabel(row.rule_source)}</td>
                <td><input class="cell-input wide student-pricing-field" data-id="${row.id}" data-field="notes" value="${escapeHtml(row.notes)}"></td>
              </tr>
            `).join("") || `<tr><td colspan="7" class="empty">暂无学生单价规则</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function profileRows(kind = profileTab) {
  const rows = kind === "teachers" ? state.profile_teachers || [] : state.profile_students || [];
  const scopedRows = rows;
  const statusFilter = profileStatusFilter[kind] || "";
  const statusRows = statusFilter ? scopedRows.filter((row) => textContains(row.status || "", statusFilter)) : scopedRows;
  const query = profileSearch.trim().toLowerCase();
  const searchFields = kind === "students"
    ? (row) => [row.name]
    : (row) => [row.name, row.phone, row.status, row.joined_at, row.left_at, row.notes];
  const filtered = query
    ? statusRows.filter((row) => searchFields(row).some((value) => String(value || "").toLowerCase().includes(query)))
    : statusRows;
  if (kind !== "students") return filtered;
  const profileGradeOrder = [...gradeOrder, "已毕业"];
  return [...filtered].sort((a, b) => {
    const gradeDelta = profileGradeOrder.indexOf(a.grade) - profileGradeOrder.indexOf(b.grade);
    if (profileGradeOrder.includes(a.grade) && profileGradeOrder.includes(b.grade) && gradeDelta) return gradeDelta;
    if (profileGradeOrder.includes(a.grade) !== profileGradeOrder.includes(b.grade)) return profileGradeOrder.includes(a.grade) ? -1 : 1;
    return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN");
  });
}

function studentPromotionPlan() {
  return (state.profile_students || [])
    .map((row) => {
      const grade = String(row.grade || "").trim();
      const status = String(row.status || "").trim();
      const targetGrade = studentPromotionMap[grade];
      if (!targetGrade || grade === "已毕业" || status === "已毕业") return null;
      return {
        id: row.id,
        name: row.name,
        fromGrade: grade,
        toGrade: targetGrade,
        status: targetGrade === "已毕业" ? "已毕业" : (status || "在读"),
      };
    })
    .filter(Boolean);
}

function studentPromotionPreview(plan) {
  const groups = new Map();
  for (const item of plan) {
    if (!groups.has(item.toGrade)) groups.set(item.toGrade, []);
    groups.get(item.toGrade).push(item);
  }
  return [...groups.entries()].map(([grade, items]) => (
    `${grade}：${items.map((item) => `${item.name}（${item.fromGrade}→${item.toGrade}）`).join("、")}`
  )).join("\n");
}

function studentProfileTableRows(rows) {
  return rows.map((row) => `
      <tr class="profile-row" data-kind="students" data-id="${row.id}"${gradeRowStyle(row.grade)}>
        <td><input class="cell-input profile-field" data-field="name" value="${escapeHtml(row.name)}"></td>
        <td><select class="cell-select profile-field" data-field="grade">${options(studentGradeOptions(), row.grade || "", "未选")}</select></td>
        <td><input class="cell-input profile-field" data-field="guardian" value="${escapeHtml(row.guardian || "")}"></td>
        <td><input class="cell-input profile-field" data-field="phone" value="${escapeHtml(row.phone || "")}"></td>
        <td><select class="cell-select profile-field" data-field="status">${options(studentStatusOptions, row.status || "在读")}</select></td>
        <td><input class="cell-input profile-field" data-field="joined_at" type="date" value="${escapeHtml(profileDateValue(row))}"></td>
        <td><input class="cell-input profile-field" data-field="left_at" type="date" value="${escapeHtml(row.left_at || "")}"></td>
        <td class="profile-notes-col"><input class="cell-input wide profile-field" data-field="notes" value="${escapeHtml(row.notes || "")}"></td>
        <td class="readonly"><button class="btn danger delete-profile" data-kind="students" data-id="${row.id}" data-name="${escapeHtml(row.name)}">删除</button></td>
      </tr>
    `).join("");
}

function profileModalMarkup() {
  if (!profileModal) return "";
  const isTeacher = profileModal.kind === "teachers";
  return `
    <div class="modal-backdrop profile-modal">
      <div class="modal-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">新增${isTeacher ? "老师" : "学生"}</div>
            <div class="modal-subtitle">姓名必填，其他信息可后续在表格中补充。</div>
          </div>
          <button class="btn profile-modal-cancel" type="button">取消</button>
        </div>
        <div class="profile-form">
          <label>姓名<input class="control profile-modal-field" data-field="name" placeholder="${isTeacher ? "老师姓名" : "学生姓名"}"></label>
          ${isTeacher ? "" : `<label>年级<select class="control profile-modal-field" data-field="grade">${options(studentGradeOptions(), "", "未选")}</select></label>`}
          ${isTeacher ? "" : `<label>监护人<input class="control profile-modal-field" data-field="guardian" placeholder="家长/监护人"></label>`}
          <label>电话<input class="control profile-modal-field" data-field="phone" placeholder="联系电话"></label>
          <label>状态<select class="control profile-modal-field" data-field="status">${options(isTeacher ? ["在职", "离职", "暂停"] : studentStatusOptions, isTeacher ? "在职" : "在读")}</select></label>
          <label class="profile-form-wide">备注<input class="control profile-modal-field" data-field="notes" placeholder="备注"></label>
        </div>
        <div class="modal-actions">
          <button class="btn primary profile-modal-submit" type="button" data-kind="${profileModal.kind}">保存</button>
        </div>
      </div>
    </div>
  `;
}

function renderProfileDirectory(kind = profileTab) {
  profileTab = kind;
  localStorage.setItem("liming:profile-tab", profileTab);
  const rows = profileRows(kind);
  const isTeacher = kind === "teachers";
  if (isTeacher) {
    const rowIds = new Set(rows.map((row) => Number(row.id)).filter(Boolean));
    selectedTeacherProfileIds = new Set([...selectedTeacherProfileIds].filter((id) => rowIds.has(Number(id))));
  }
  const selectedTeacherVisibleCount = isTeacher
    ? rows.filter((row) => selectedTeacherProfileIds.has(Number(row.id))).length
    : 0;
  const allVisibleTeachersSelected = isTeacher && rows.length > 0 && selectedTeacherVisibleCount === rows.length;
  const statusValues = isTeacher ? ["在职", "离职", "暂停"] : studentStatusOptions;
  renderTopbar(isTeacher ? "老师档案" : "学生档案", `${rows.length} 条`, historyToggleAction());
  const teacherTable = `
    <table class="profile-table teacher-profile-table uniform-table nowrap-table">
      <thead><tr><th class="select-col"><input class="teacher-profile-select-all" type="checkbox" ${allVisibleTeachersSelected ? "checked" : ""} ${rows.length ? "" : "disabled"} aria-label="全选当前老师档案"></th><th>姓名</th><th>电话</th><th>状态</th><th>入职日期</th><th>离职日期</th><th class="wide profile-notes-col">备注</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr class="profile-row" data-kind="teachers" data-id="${row.id}">
            <td class="select-col"><input class="teacher-profile-select-row" type="checkbox" data-id="${escapeHtml(row.id)}" ${selectedTeacherProfileIds.has(Number(row.id)) ? "checked" : ""} aria-label="选择老师档案"></td>
            <td><input class="cell-input profile-field" data-field="name" value="${escapeHtml(row.name)}"></td>
            <td><input class="cell-input profile-field" data-field="phone" value="${escapeHtml(row.phone || "")}"></td>
            <td><select class="cell-select profile-field" data-field="status">${options(["在职", "离职", "暂停"], row.status || "在职")}</select></td>
            <td><input class="cell-input profile-field" data-field="joined_at" type="date" value="${escapeHtml(profileDateValue(row))}"></td>
            <td><input class="cell-input profile-field" data-field="left_at" type="date" value="${escapeHtml(row.left_at || "")}"></td>
            <td class="profile-notes-col"><input class="cell-input wide profile-field" data-field="notes" value="${escapeHtml(row.notes || "")}"></td>
          </tr>
        `).join("") || `<tr><td colspan="7" class="empty">暂无老师档案</td></tr>`}
      </tbody>
    </table>
  `;
  const studentTable = `
    <table class="profile-table student-profile-table uniform-table nowrap-table">
      <thead><tr><th>姓名</th><th>年级</th><th>监护人</th><th>电话</th><th>状态</th><th>入学日期</th><th>离校日期</th><th class="wide profile-notes-col">备注</th><th>操作</th></tr></thead>
      <tbody>
        ${studentProfileTableRows(rows) || `<tr><td colspan="9" class="empty">暂无学生档案</td></tr>`}
      </tbody>
    </table>
  `;
  contentEl.innerHTML = `
    <div class="band profile-panel">
      <div class="section-head profile-head">
        <div>
          <div class="section-title">${isTeacher ? "老师档案" : "学生档案"}</div>
          <div class="section-subtitle">${isTeacher ? "维护老师联系方式、在职状态和入离职日期。" : "档案由课程和充值导入自动补齐，也可以在这里手动维护联系方式与状态。"}</div>
        </div>
        <div class="profile-actions">
          ${filterComboControl({ className: "profile-status-filter", field: "status", value: profileStatusFilter[kind] || "", values: statusValues, placeholder: "输入或选择状态" })}
          ${textFilterControl({ className: "profile-search", field: "q", value: profileSearch, placeholder: isTeacher ? "搜索老师姓名、电话、备注" : "按学生姓名筛选" })}
          ${isTeacher ? "" : `<button class="btn bulk-promote-students" type="button">批量升年级</button>`}
          ${isTeacher ? `<button class="btn danger batch-delete-teacher-profiles" type="button" ${bulkActionDisabledAttr(selectedTeacherProfileIds.size)}>${bulkActionText("批量删除", selectedTeacherProfileIds.size)}</button>` : ""}
          <button class="btn backfill-profile-joined-at" type="button" data-kind="${kind}">${isTeacher ? "补齐入职日期" : "补齐入学日期"}</button>
          <button class="btn primary new-profile" type="button" data-kind="${kind}">+ 新增${isTeacher ? "老师" : "学生"}</button>
        </div>
      </div>
      <div class="table-wrap">
        ${isTeacher ? teacherTable : studentTable}
      </div>
    </div>
    ${profileModalMarkup()}
  `;
}

function filteredStaffRows() {
  const query = staffProfileSearch.trim().toLowerCase();
  return (state.staff || []).filter((row) => {
    if (staffStatusFilter && !textContains(row.status, staffStatusFilter)) return false;
    if (!query) return true;
    return [row.name, row.role, row.phone, row.status, row.notes]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

const attendanceMeta = {
  上班: { label: "上", title: "正常上班" },
  休息: { label: "休", title: "休息" },
  请假: { label: "请", title: "请假" },
  病假: { label: "病", title: "病假" },
  事假: { label: "事", title: "事假" },
  半天: { label: "半", title: "半天" },
  加班: { label: "加", title: "加班" },
  调休: { label: "调", title: "调休" },
  旷工: { label: "旷", title: "旷工" },
};

function attendanceStatusOptions(value) {
  const statuses = state.lookups.attendance_status || Object.keys(attendanceMeta);
  return statuses.map((status) => `<option value="${escapeHtml(status)}" ${status === value ? "selected" : ""}>${escapeHtml(attendanceMeta[status]?.title || status)}</option>`).join("");
}

function attendanceDates(monthKey) {
  const bounds = monthBounds(monthKey);
  const start = parseDateValue(bounds.start);
  const end = parseDateValue(bounds.end);
  if (!start || !end) return [];
  const days = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const value = dateKey(cursor);
    days.push({ value, day: cursor.getDate(), weekday: weekdayCn(value), weekend: [0, 6].includes(cursor.getDay()) });
  }
  return days;
}

function attendanceByStaffDate() {
  const map = new Map();
  for (const row of state.staff_attendance || []) map.set(`${row.staff_id}|${row.attendance_date}`, row);
  return map;
}

function attendanceSummaryFor(staffId) {
  const rows = (state.staff_attendance || []).filter((row) => Number(row.staff_id) === Number(staffId));
  const byStatus = {};
  let payUnits = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    payUnits += numberValue(row.pay_units);
  }
  return { count: rows.length, payUnits, byStatus };
}

function attendanceVisibleStaffRows() {
  return filteredStaffRows().filter((row) => (row.status || "在职") !== "离职" || includeInactive);
}

function attendanceWeekdayOptions(value = "all") {
  const items = [
    ["all", "全部日期"],
    ["1", "周一"],
    ["2", "周二"],
    ["3", "周三"],
    ["4", "周四"],
    ["5", "周五"],
    ["6", "周六"],
    ["0", "周日"],
  ];
  return items.map(([key, label]) => `<option value="${escapeHtml(key)}" ${key === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function attendanceBulkModeOptions(value = "blank") {
  return [
    ["blank", "只填空白"],
    ["overwrite", "覆盖已有"],
  ].map(([key, label]) => `<option value="${escapeHtml(key)}" ${key === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function staffModalMarkup() {
  if (!staffModal) return "";
  return `
    <div class="modal-backdrop staff-modal">
      <div class="modal-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">新增员工</div>
            <div class="modal-subtitle">姓名必填，角色可选预设或手动输入。</div>
          </div>
          <button class="btn staff-modal-cancel" type="button">取消</button>
        </div>
        <div class="profile-form">
          <label>姓名<input class="control staff-modal-field" data-field="name" placeholder="员工姓名"></label>
          <label>角色<input class="control staff-modal-field" data-field="role" list="staff-role-list" placeholder="角色"></label>
          <label>基础工资<input class="control staff-modal-field" data-field="base_salary" type="number" value="0"></label>
          <label>计薪方式<select class="control staff-modal-field" data-field="pay_type">${options(["月薪", "日薪"], "月薪")}</select></label>
          <label>日薪单价<input class="control staff-modal-field" data-field="daily_rate" type="number" value="0"></label>
          <label>标准天数<input class="control staff-modal-field" data-field="standard_work_days" type="number" value="26"></label>
          <label>手机<input class="control staff-modal-field" data-field="phone" placeholder="联系电话"></label>
          <label>状态<select class="control staff-modal-field" data-field="status">${options(["在职", "暂停", "离职"], "在职")}</select></label>
          <label>入职日期<input class="control staff-modal-field" data-field="joined_at" type="date"></label>
          <label class="profile-form-wide">备注<input class="control staff-modal-field" data-field="notes" placeholder="备注"></label>
        </div>
        <datalist id="staff-role-list">${(state.lookups.staff_roles || []).map((role) => `<option value="${escapeHtml(role)}"></option>`).join("")}</datalist>
        <div class="modal-actions">
          <button class="btn primary staff-modal-submit" type="button">保存</button>
        </div>
      </div>
    </div>
  `;
}

function staffProfilesPanelMarkup() {
  const rows = filteredStaffRows();
  return `
    <div class="band profile-panel">
      <div class="section-head profile-head">
        <div>
          <div class="section-title">员工档案</div>
          <div class="section-subtitle">这里维护计薪方式、基础工资、日薪和入离职日期；上方薪资会按这些档案计算。</div>
        </div>
        <div class="profile-actions">
          ${filterComboControl({ className: "staff-status-filter", field: "status", value: staffStatusFilter, values: ["在职", "暂停", "离职"], placeholder: "输入或选择状态" })}
          ${textFilterControl({ className: "staff-profile-search", field: "q", value: staffProfileSearch, placeholder: "搜索姓名、角色、电话、备注" })}
          <button class="btn primary new-staff" type="button">+ 新增员工</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="profile-table staff-profile-table">
          <thead><tr><th>姓名</th><th>角色</th><th>计薪</th><th>基础工资</th><th>日薪</th><th>标准天数</th><th>手机</th><th>状态</th><th>入职</th><th>离职</th><th class="wide">备注</th><th>操作</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="staff-row" data-id="${row.id}">
                <td><input class="cell-input staff-field" data-field="name" value="${escapeHtml(row.name)}"></td>
                <td><input class="cell-input staff-field" data-field="role" list="staff-role-options" value="${escapeHtml(row.role)}"></td>
                <td><select class="cell-select staff-field" data-field="pay_type">${options(["月薪", "日薪"], row.pay_type || "月薪")}</select></td>
                <td class="currency-input-cell">${currencyInputMarkup(row.base_salary, { className: "staff-field", attrs: `data-field="base_salary"` })}</td>
                <td class="currency-input-cell">${currencyInputMarkup(row.daily_rate, { className: "staff-field", attrs: `data-field="daily_rate"` })}</td>
                <td><input class="cell-input number staff-field" data-field="standard_work_days" type="number" value="${moneyInput(row.standard_work_days || 26)}"></td>
                <td><input class="cell-input staff-field" data-field="phone" value="${escapeHtml(row.phone || "")}"></td>
                <td><select class="cell-select staff-field" data-field="status">${options(["在职", "暂停", "离职"], row.status || "在职")}</select></td>
                <td><input class="cell-input staff-field" data-field="joined_at" type="date" value="${escapeHtml(row.joined_at || "")}"></td>
                <td><input class="cell-input staff-field" data-field="left_at" type="date" value="${escapeHtml(row.left_at || "")}"></td>
                <td><input class="cell-input wide staff-field" data-field="notes" value="${escapeHtml(row.notes || "")}"></td>
                <td class="readonly"><button class="btn danger delete-staff" data-id="${row.id}" data-name="${escapeHtml(row.name)}">删除</button></td>
              </tr>
            `).join("") || `<tr><td colspan="12" class="empty">暂无员工</td></tr>`}
          </tbody>
        </table>
        <datalist id="staff-role-options">${(state.lookups.staff_roles || []).map((role) => `<option value="${escapeHtml(role)}"></option>`).join("")}</datalist>
      </div>
    </div>
  `;
}

function renderTeacherProfiles() {
  renderProfileDirectory("teachers");
}

function renderStudentProfiles() {
  renderProfileDirectory("students");
}

function renderStaffAttendance() {
  const monthKey = state.settings.month_key;
  const dates = attendanceDates(monthKey);
  const byDate = attendanceByStaffDate();
  const rows = attendanceVisibleStaffRows();
  const summaries = rows.map((staff) => ({ staff, summary: attendanceSummaryFor(staff.id) }));
  const totalRecords = summaries.reduce((sum, row) => sum + row.summary.count, 0);
  const totalPayUnits = summaries.reduce((sum, row) => sum + row.summary.payUnits, 0);
  const totalLeave = summaries.reduce((sum, row) => sum + (row.summary.byStatus["请假"] || 0) + (row.summary.byStatus["病假"] || 0) + (row.summary.byStatus["事假"] || 0), 0);
  const totalOvertime = summaries.reduce((sum, row) => sum + (row.summary.byStatus["加班"] || 0), 0);
  const expectedCells = rows.length * dates.length;
  const missingCells = Math.max(0, expectedCells - totalRecords);
  renderTopbar(`${monthLabel()} 员工考勤`, `${rows.length} 人，已登记 ${totalRecords} 天`, historyToggleAction());
  contentEl.innerHTML = `
    <div class="summary-grid operations-summary attendance-summary-grid">
      <div class="metric"><div class="metric-label">本月员工</div><div class="metric-value">${rows.length}</div></div>
      <div class="metric"><div class="metric-label">已登记</div><div class="metric-value">${totalRecords}</div></div>
      <div class="metric"><div class="metric-label">计薪天数</div><div class="metric-value">${money(totalPayUnits)}</div></div>
      <div class="metric"><div class="metric-label">请假/加班</div><div class="metric-value">${totalLeave}/${totalOvertime}</div></div>
    </div>
    <div class="attendance-layout">
      <div class="band attendance-panel attendance-main">
        <div class="section-head profile-head attendance-head">
          <div>
            <div class="section-title">考勤登记</div>
            <div class="section-subtitle">按员工横向登记整月状态；特殊原因会保留在日期格提示里。</div>
          </div>
          <div class="profile-actions">
            ${filterComboControl({ className: "staff-status-filter", field: "status", value: staffStatusFilter, values: ["在职", "暂停", "离职"], placeholder: "输入或选择状态" })}
            ${textFilterControl({ className: "staff-profile-search", field: "q", value: staffProfileSearch, placeholder: "搜索员工/角色/电话/备注" })}
          </div>
        </div>
        <div class="attendance-toolbar">
          <div class="attendance-legend">
            ${["上班", "休息", "请假", "半天", "加班", "调休", "旷工"].map((status) => {
              const meta = attendanceMeta[status] || { label: status };
              return `<span class="attendance-legend-item status-${escapeHtml(status)}"><span>${escapeHtml(meta.label)}</span>${escapeHtml(status)}</span>`;
            }).join("")}
          </div>
          <div class="attendance-gap">未登记 ${missingCells} 格</div>
        </div>
        <div class="attendance-quickbar">
          <div class="attendance-quick-title">快捷登记</div>
          <select class="control attendance-bulk-weekday">${attendanceWeekdayOptions()}</select>
          <select class="control attendance-bulk-status">${attendanceStatusOptions("上班")}</select>
          <select class="control attendance-bulk-mode">${attendanceBulkModeOptions()}</select>
          <button class="btn attendance-bulk-apply" type="button">应用到当前员工列表</button>
          <button class="btn ghost attendance-bulk-one" data-action="fill-all-work" type="button">全月上班</button>
          <button class="btn ghost attendance-bulk-one" data-action="fill-weekend-work" type="button">周末上班</button>
          <button class="btn ghost attendance-bulk-one" data-action="clear-visible" type="button">清空当前列表</button>
        </div>
        <div class="table-wrap attendance-wrap">
          <table class="staff-attendance-table">
            <thead>
              <tr>
                <th class="sticky-name">员工</th>
                ${dates.map((date) => `<th class="${date.weekend ? "weekend" : ""}" title="${escapeHtml(date.weekday)}"><span>${date.day}</span><small>${escapeHtml(date.weekday.replace("周", ""))}</small></th>`).join("")}
                <th>出勤</th><th>计薪</th><th>请假</th>
              </tr>
            </thead>
            <tbody>
              ${summaries.map(({ staff, summary }) => `
                  <tr>
                    <td class="text-cell sticky-name">
                      <strong>${escapeHtml(staff.name)}</strong>
                      <span>${escapeHtml(staff.role || "")}</span>
                    </td>
                    ${dates.map((date) => {
                      const item = byDate.get(`${staff.id}|${date.value}`);
                      const status = item?.status || "";
                      const meta = attendanceMeta[status] || { label: "" };
                      const hasNote = Boolean(item?.reason || item?.notes);
                      return `
                        <td class="attendance-cell ${date.weekend ? "weekend" : ""}">
                          <select class="attendance-select status-${escapeHtml(status || "blank")}" data-staff-id="${staff.id}" data-date="${date.value}" title="${escapeHtml(item?.reason || item?.notes || "")}">
                            <option value=""></option>
                            ${attendanceStatusOptions(status)}
                          </select>
                          <span class="attendance-label">${escapeHtml(meta.label)}</span>
                          ${hasNote ? `<span class="attendance-note-dot"></span>` : ""}
                        </td>
                      `;
                    }).join("")}
                    <td class="text-cell right">${summary.count}</td>
                    <td class="text-cell right">${money(summary.payUnits)}</td>
                    <td class="text-cell right">${(summary.byStatus["请假"] || 0) + (summary.byStatus["病假"] || 0) + (summary.byStatus["事假"] || 0)}</td>
                  </tr>
                `).join("") || `<tr><td colspan="${dates.length + 4}" class="empty">暂无员工</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <aside class="band attendance-side">
        <div class="section-title">结算摘要</div>
        <div class="section-subtitle">薪资页会按这里的计薪天数自动更新。</div>
        <div class="attendance-side-list">
          ${summaries.map(({ staff, summary }) => `
            <div class="attendance-side-row">
              <div>
                <strong>${escapeHtml(staff.name)}</strong>
                <span>${escapeHtml(staff.pay_type || "月薪")} · ${escapeHtml(staff.role || "未设置角色")}</span>
              </div>
              <div class="attendance-side-numbers">
                <b>${money(summary.payUnits)}</b>
                <span>${summary.count} 天</span>
              </div>
            </div>
          `).join("") || `<div class="empty">暂无员工</div>`}
        </div>
      </aside>
    </div>
  `;
}

function payrollRows() {
  const query = staffPayrollSearch.trim().toLowerCase();
  const monthKey = state?.settings?.month_key || activeMonth;
  const rows = (state.staff_salary || []).filter((row) => !(row.left_at && row.left_at < monthKey));
  if (!query) return rows;
  return rows.filter((row) => [row.name, row.role, row.notes]
    .some((value) => String(value || "").toLowerCase().includes(query)));
}

function renderStaffPayroll() {
  const rows = payrollRows();
  const profileRows = filteredStaffRows();
  const total = rows.reduce((sum, row) => sum + numberValue(row.salary_actual), 0);
  const totalBonus = rows.reduce((sum, row) => sum + numberValue(row.bonus), 0);
  const totalDeduction = rows.reduce((sum, row) => sum + numberValue(row.deduction), 0);
  renderTopbar(`${monthLabel()} 员工薪资`, `${rows.length} 条薪资，${profileRows.length} 名档案，工资合计 ${yuan2(total)}`);
  contentEl.innerHTML = `
    <div class="summary-grid operations-summary">
      <div class="metric"><div class="metric-label">本月人数</div><div class="metric-value">${rows.length}</div></div>
      <div class="metric"><div class="metric-label">工资合计</div><div class="metric-value">${yuan2(total)}</div></div>
      <div class="metric"><div class="metric-label">奖金合计</div><div class="metric-value">${yuan2(totalBonus)}</div></div>
      <div class="metric"><div class="metric-label">扣款合计</div><div class="metric-value">${yuan2(totalDeduction)}</div></div>
    </div>
    <div class="band">
      <div class="section-head profile-head">
        <div class="section-title">月度薪资</div>
        ${textFilterControl({ className: "staff-payroll-search", field: "q", value: staffPayrollSearch, placeholder: "搜索员工/角色/备注" })}
      </div>
      <div class="table-wrap">
        <table class="staff-payroll-table">
          <thead><tr><th>姓名</th><th>角色</th><th>计薪</th><th>基础/日薪</th><th>计薪天数</th><th>奖金</th><th>扣款</th><th>实发</th><th class="wide">备注</th><th>操作</th></tr></thead>
          <tbody>
            ${rows.map((row) => {
              const mismatch = Math.abs(numberValue(row.salary_actual) - numberValue(row.expected_salary)) > 0.01;
              const inactive = row.status === "离职";
              const disabled = inactive ? "disabled readonly" : "";
              const inactiveTag = inactive ? `<span class="inactive-tag">已离职</span>` : "";
              return `
                <tr class="staff-salary-row ${inactive ? "row-inactive" : ""}" data-id="${row.id}" data-staff-id="${row.staff_id}">
                  <td class="text-cell">${escapeHtml(row.name)} ${inactiveTag}</td>
                  <td class="text-cell">${escapeHtml(row.role)}</td>
                  <td class="text-cell">${escapeHtml(row.pay_type || "月薪")}</td>
                  <td class="text-cell right">${row.pay_type === "日薪" ? formatMoney(row.daily_rate || row.base_salary) : formatMoney(row.base_salary)}</td>
                  <td class="text-cell right" title="${row.attendance_days ? `已登记 ${row.attendance_days} 天考勤` : "未登记考勤，按整月基础工资"}">${row.attendance_days ? money(row.pay_units) : "整月"}</td>
                  <td class="currency-input-cell">${currencyInputMarkup(row.bonus, { className: "staff-salary-field", attrs: `data-field="bonus" ${disabled}` })}</td>
                  <td class="currency-input-cell">${currencyInputMarkup(row.deduction, { className: "staff-salary-field", attrs: `data-field="deduction" ${disabled}` })}</td>
                  <td class="text-cell right ${mismatch ? "warning-cell" : ""}" title="${mismatch ? `按基础+奖金-扣款应为 ${formatMoney(row.expected_salary)}` : ""}">${mismatch ? "⚠ " : ""}${formatMoney(row.salary_actual)}</td>
                  <td><input class="cell-input wide staff-salary-field" data-field="notes" value="${escapeHtml(row.notes === "auto" ? "" : row.notes || "")}" placeholder="${row.notes === "auto" ? "auto" : ""}" ${disabled}></td>
                  <td class="readonly"><button class="btn danger delete-staff-salary" data-id="${row.id}" data-name="${escapeHtml(row.name)}">删除</button></td>
                </tr>
              `;
            }).join("") || `<tr><td colspan="10" class="empty">暂无薪资记录</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    ${staffProfilesPanelMarkup()}
    ${staffModalMarkup()}
  `;
}

function expenseSummary() {
  const byCategory = new Map();
  for (const row of state.expenses || []) {
    byCategory.set(row.category, (byCategory.get(row.category) || 0) + numberValue(row.amount));
  }
  const total = [...byCategory.values()].reduce((sum, value) => sum + value, 0);
  return { total, byCategory };
}

function expenseCategoryBar(summary) {
  const colors = ["#0f766e", "#175cd3", "#b54708", "#7c3aed", "#087443", "#c01048", "#536471", "#334155"];
  if (!summary.total) return `<div class="expense-bar empty-bar"></div>`;
  return `
    <div class="expense-bar">
      ${[...summary.byCategory.entries()].map(([category, amount], index) => {
        const width = Math.max(2, (amount / summary.total) * 100);
        return `<div class="expense-bar-segment" title="${escapeHtml(category)} ${yuan2(amount)}" style="width:${width}%;background:${colors[index % colors.length]}"></div>`;
      }).join("")}
    </div>
  `;
}

function expenseModalMarkup() {
  if (!expenseModal) return "";
  return `
    <div class="modal-backdrop expense-modal">
      <div class="modal-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">新增开销</div>
            <div class="modal-subtitle">金额必填且大于 0，类别可选预设或手动输入。</div>
          </div>
          <button class="btn expense-modal-cancel" type="button">取消</button>
        </div>
        <div class="profile-form">
          <label>日期<input class="control expense-modal-field" data-field="expense_date" type="date" value="${todayDate()}"></label>
          <label>类别<input class="control expense-modal-field" data-field="category" list="expense-category-list" value="其他"></label>
          <label>金额<input class="control expense-modal-field" data-field="amount" type="number" placeholder="0"></label>
          <label>商家<input class="control expense-modal-field" data-field="vendor" placeholder="商家/收款方"></label>
          <label class="profile-form-wide">备注<input class="control expense-modal-field" data-field="notes" placeholder="备注"></label>
        </div>
        <datalist id="expense-category-list">${(state.lookups.expense_categories || []).map((category) => `<option value="${escapeHtml(category)}"></option>`).join("")}</datalist>
        <div class="modal-actions">
          <button class="btn primary expense-modal-submit" type="button">保存</button>
        </div>
      </div>
    </div>
  `;
}

function renderExpenses() {
  const rows = state.expenses || [];
  const summary = expenseSummary();
  renderTopbar("日常开销", `共 ${rows.length} 笔，合计 ${yuan2(summary.total)}`);
  contentEl.innerHTML = `
    <div class="band expenses-panel">
      <div class="section-head expense-head">
        <div>
          <div class="section-title">日常开销</div>
          <div class="expense-total">共 ${rows.length} 笔，合计 ${yuan2(summary.total)}</div>
        </div>
        <button class="btn primary new-expense" type="button">+ 新增开销</button>
      </div>
      <div class="filter-bar compact expense-filter-bar">
        <label>日期范围 ${dateRangePickerControl({ scope: "expenses", start: expenseFilter.start, end: expenseFilter.end, placeholder: "选择开销日期范围" })}</label>
        <label>类别 ${filterComboControl({ className: "expense-filter-input", field: "category", value: expenseFilter.category, values: state.lookups.expense_categories || [], placeholder: "输入或选择类别", dataAttr: "field" })}</label>
        <label>搜索 <input class="control expense-filter-input" data-field="q" type="text" autocomplete="off" spellcheck="false" placeholder="商家/备注" value="${escapeHtml(expenseFilter.q)}"></label>
      </div>
      <div class="expense-bar-wrap">
        ${expenseCategoryBar(summary)}
        <div class="expense-legend">
          ${[...summary.byCategory.entries()].map(([category, amount]) => `<span>${escapeHtml(category)} ${Math.round((amount / summary.total) * 100) || 0}%</span>`).join("")}
        </div>
      </div>
      <div class="table-wrap">
        <table class="expense-table">
          <thead><tr><th>日期</th><th>类别</th><th>金额</th><th>商家</th><th class="wide">备注</th><th>操作</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="expense-row" data-id="${row.id}">
                <td><input class="cell-input expense-field" data-field="expense_date" type="date" value="${escapeHtml(row.expense_date)}"></td>
                <td><input class="cell-input expense-field" data-field="category" list="expense-category-options" value="${escapeHtml(row.category)}"></td>
                <td class="currency-input-cell">${currencyInputMarkup(row.amount, { className: "expense-field", attrs: `data-field="amount"` })}</td>
                <td><input class="cell-input expense-field" data-field="vendor" value="${escapeHtml(row.vendor || "")}"></td>
                <td><input class="cell-input wide expense-field" data-field="notes" value="${escapeHtml(row.notes || "")}"></td>
                <td class="readonly"><button class="btn danger delete-expense" data-id="${row.id}">删除</button></td>
              </tr>
            `).join("") || `<tr><td colspan="6" class="empty">暂无开销</td></tr>`}
          </tbody>
        </table>
        <datalist id="expense-category-options">${(state.lookups.expense_categories || []).map((category) => `<option value="${escapeHtml(category)}"></option>`).join("")}</datalist>
      </div>
    </div>
    ${expenseModalMarkup()}
  `;
}

async function renderOperationLogs() {
  const params = new URLSearchParams();
  if (operationLogFilter.operator_name) params.set("operator", operationLogFilter.operator_name);
  if (operationLogFilter.operator_account) params.set("operator_account", operationLogFilter.operator_account);
  if (operationLogFilter.operation_type) params.set("operation_type", operationLogFilter.operation_type);
  if (operationLogFilter.content) params.set("content", operationLogFilter.content);
  if (operationLogFilter.start_date) params.set("start_date", operationLogFilter.start_date);
  if (operationLogFilter.end_date) params.set("end_date", operationLogFilter.end_date);
  params.set("page", operationLogPage);
  params.set("page_size", operationLogPageSize);

  contentEl.innerHTML = `<div class="loading">加载中...</div>`;

  try {
    operationLogData = await request(`/api/operation-logs?${params.toString()}`);
  } catch (error) {
    renderTopbar("操作日志", "加载失败");
    contentEl.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    wireEvents();
    return;
  }

  const totalPages = Math.max(1, Math.ceil(operationLogData.total / operationLogPageSize));
  renderTopbar("操作日志", `共 ${operationLogData.total} 条记录`);

  const OPERATION_TYPES = ["创建课程", "修改课程", "删除课程", "创建月份", "删除月份", "导入课程", "导出课程", "修改密码", "登录系统", "退出系统", "其他操作"];

  contentEl.innerHTML = `
    <div class="band">
      <div class="filter-bar compact">
        <div class="filter-controls">
          <label class="filter-field">
            <span>操作人</span>
            ${textFilterControl({ className: "operation-log-filter", field: "operator_name", value: operationLogFilter.operator_name, placeholder: "请输入姓名", dataAttr: "field" })}
          </label>
          <label class="filter-field">
            <span>操作账号</span>
            ${textFilterControl({ className: "operation-log-filter", field: "operator_account", value: operationLogFilter.operator_account, placeholder: "请输入账号", dataAttr: "field" })}
          </label>
          <label class="filter-field">
            <span>操作类型</span>
            <select class="control operation-log-filter" data-field="operation_type">
              <option value="">全部类型</option>
              ${OPERATION_TYPES.map((type) => `<option value="${type}" ${operationLogFilter.operation_type === type ? "selected" : ""}>${type}</option>`).join("")}
            </select>
          </label>
          <label class="filter-field">
            <span>操作内容</span>
            ${textFilterControl({ className: "operation-log-filter", field: "content", value: operationLogFilter.content, placeholder: "请输入操作内容", dataAttr: "field" })}
          </label>
          <label class="filter-field filter-date-range">
            <span>操作时间</span>
            ${dateRangePickerControl({ scope: "operation-logs", start: operationLogFilter.start_date, end: operationLogFilter.end_date, placeholder: "选择操作时间范围" })}
          </label>
        </div>
        <div class="filter-summary">
          <button class="btn primary apply-operation-log-filter" type="button">查询</button>
          <button class="btn reset-operation-log-filter" type="button">重置</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="operation-log-table uniform-table nowrap-table">
          <thead>
            <tr>
              <th>操作人</th>
              <th>操作账号</th>
              <th>操作类型</th>
              <th>操作内容</th>
              <th>操作时间</th>
            </tr>
          </thead>
          <tbody>
            ${operationLogData.items.map((log) => `
              <tr>
                <td class="text-cell">${escapeHtml(log.operator_name)}</td>
                <td class="text-cell">${escapeHtml(log.operator_account)}</td>
                <td class="text-cell">${escapeHtml(log.operation_type)}</td>
                <td class="text-cell" title="${escapeHtml(log.operation_content)}">${escapeHtml(log.operation_content)}</td>
                <td class="text-cell">${escapeHtml(formatBeijingTime(log.created_at))}</td>
              </tr>
            `).join("") || `<tr><td colspan="5" class="empty">暂无操作日志</td></tr>`}
          </tbody>
        </table>
      </div>
      ${operationLogData.total > 0 ? `
      <div class="pagination-bar">
        <div class="pagination-info">
          <span>共 <b>${operationLogData.total}</b> 条</span>
          <select class="control pagination-page-size">
            <option value="10" ${operationLogPageSize === 10 ? "selected" : ""}>10 条/页</option>
            <option value="20" ${operationLogPageSize === 20 ? "selected" : ""}>20 条/页</option>
            <option value="50" ${operationLogPageSize === 50 ? "selected" : ""}>50 条/页</option>
          </select>
        </div>
        <div class="pagination-controls">
          <button class="btn ghost pagination-btn" data-page="${operationLogPage - 1}" type="button" ${operationLogPage <= 1 ? "disabled" : ""}>上一页</button>
          ${renderPageButtons(operationLogPage, totalPages)}
          <button class="btn ghost pagination-btn" data-page="${operationLogPage + 1}" type="button" ${operationLogPage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
      </div>
      ` : ""}
    </div>
  `;

  bindDateRangePickerControls();
  bindOperationLogEvents();
}

function renderPageButtons(current, total) {
  if (total <= 1) return "";
  const visible = 7;
  let start = Math.max(1, current - Math.floor(visible / 2));
  let end = Math.min(total, start + visible - 1);
  if (end - start < visible - 1) start = Math.max(1, end - visible + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => {
    const pageNum = start + i;
    return `<button class="btn ${pageNum === current ? "primary" : "ghost"} pagination-btn" data-page="${pageNum}" type="button">${pageNum}</button>`;
  }).join("");
}

function bindOperationLogEvents() {
  document.querySelectorAll(".operation-log-filter").forEach((input) => {
    input.addEventListener("change", () => {
      operationLogFilter = { ...operationLogFilter, [input.dataset.field]: input.value };
    });
  });

  document.querySelectorAll(".operation-log-filter[type='text']").forEach((input) => {
    bindSafeTextInput(input,
      (value) => { operationLogFilter = { ...operationLogFilter, [input.dataset.field]: value }; },
      () => {}, 400,
    );
  });

  document.querySelector(".apply-operation-log-filter")?.addEventListener("click", async () => {
    document.querySelectorAll(".operation-log-filter").forEach((input) => {
      operationLogFilter = { ...operationLogFilter, [input.dataset.field]: input.value };
    });
    operationLogPage = 1;
    await renderOperationLogs();
  });

  document.querySelector(".reset-operation-log-filter")?.addEventListener("click", async () => {
    operationLogFilter = { operator_name: "", operator_account: "", operation_type: "", content: "", start_date: "", end_date: "" };
    operationLogPage = 1;
    await renderOperationLogs();
  });

  document.querySelectorAll(".pagination-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetPage = Number(button.dataset.page);
      if (!targetPage || targetPage < 1) return;
      const totalPages = Math.max(1, Math.ceil(operationLogData.total / operationLogPageSize));
      if (targetPage > totalPages) return;
      operationLogPage = targetPage;
      await renderOperationLogs();
    });
  });

  document.querySelector(".pagination-page-size")?.addEventListener("change", async () => {
    operationLogPageSize = Number(document.querySelector(".pagination-page-size")?.value) || 10;
    operationLogPage = 1;
    await renderOperationLogs();
  });
}

function renderTeacherSalary() {
  const rows = state.derived.teacher_summary;
  const weeks = teacherTravelWeeks();
  const total = rows.reduce((sum, row) => sum + numberValue(row.total_salary), 0);
  const lessonTotal = rows.reduce((sum, row) => sum + numberValue(row.lesson_count), 0);
  const classSalaryTotal = rows.reduce((sum, row) => sum + numberValue(row.salary_total), 0);
  renderTopbar(
    `${monthLabel()} 薪资汇总`,
    `薪资合计 ${formatMoney(total)}`,
    `<button class="btn export-teacher-salary" type="button">导出本月</button>`,
  );
  contentEl.innerHTML = `
    <div class="band">
      <div class="table-wrap">
        <table class="teacher-salary-table uniform-table nowrap-table">
          <thead>
            <tr>
              <th>教师姓名</th>
              <th>上课课时数</th>
              <th>课时合计</th>
              ${weeks.map((week) => `<th>${escapeHtml(week.label || `第${week.week_index}周车票`)}</th>`).join("")}
              <th>薪资合计</th>
              <th class="wide">备注</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td class="text-cell">${escapeHtml(row.teacher_name)}</td>
                <td class="text-cell right">${row.lesson_count}</td>
                <td class="text-cell right">${formatMoney(row.salary_total)}</td>
                ${weeks.map((week) => `<td class="text-cell right">${formatMoney(teacherTravelAmount(row, week))}</td>`).join("")}
                <td class="text-cell right">${formatMoney(row.total_salary)}</td>
                <td class="text-cell wide">${escapeHtml(row.notes || "")}</td>
              </tr>
            `).join("")}
            <tr>
              <td class="text-cell"><b>合计</b></td>
              <td class="text-cell right"><b>${lessonTotal}</b></td>
              <td class="text-cell right"><b>${formatMoney(classSalaryTotal)}</b></td>
              ${weeks.map((week) => `<td class="text-cell right"><b>${formatMoney(rows.reduce((sum, row) => sum + teacherTravelAmount(row, week), 0))}</b></td>`).join("")}
              <td class="text-cell right"><b>${formatMoney(total)}</b></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function teacherTravelFeeRowsForPage() {
  const summaryByName = new Map((state.derived.teacher_summary || []).map((row) => [String(row.teacher_name || "").trim(), row]));
  const names = uniqueSorted([
    ...(state.profile_teachers || []).map((row) => row.name),
    ...(state.derived.teacher_summary || []).map((row) => row.teacher_name),
  ].filter(Boolean));
  return names.map((name) => ({
    teacher_name: name,
    lesson_count: 0,
    salary_total: 0,
    total_salary: 0,
    notes: "",
    ...(summaryByName.get(name) || {}),
  }));
}

function renderTeacherTravelFees() {
  const rows = teacherTravelFeeRowsForPage();
  const weeks = teacherTravelWeeks();
  const total = rows.reduce((sum, row) => sum + teacherTravelTotal(row), 0);
  const disabled = canWriteData() ? "" : "disabled";
  renderTopbar(
    `${monthLabel()} 车费明细`,
    `车费合计 ${formatMoney(total)}`,
  );
  contentEl.innerHTML = `
    <div class="band">
      <div class="table-wrap">
        <table class="teacher-salary-table teacher-travel-table uniform-table nowrap-table">
          <thead>
            <tr>
              <th>教师姓名</th>
              ${weeks.map((week) => `<th>${escapeHtml(week.label || `第${week.week_index}周车票`)}</th>`).join("")}
              <th>合计</th>
              <th class="wide">备注</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="teacher-travel-fee-row" data-teacher-name="${escapeHtml(row.teacher_name)}">
                <td class="text-cell">${escapeHtml(row.teacher_name)}</td>
                ${weeks.map((week) => `
                  <td class="currency-input-cell">
                    ${currencyInputMarkup(teacherTravelAmount(row, week), {
                      className: "teacher-travel-fee-field",
                      attrs: `data-week-index="${escapeHtml(week.week_index)}" data-field="${escapeHtml(teacherTravelField(week.week_index))}" min="0" step="0.01" ${disabled}`,
                    })}
                  </td>
                `).join("")}
                <td class="text-cell right">${formatMoney(teacherTravelTotal(row))}</td>
                <td><input class="cell-input wide teacher-travel-fee-field" data-field="notes" value="${escapeHtml(row.notes || "")}" ${disabled}></td>
              </tr>
            `).join("") || `<tr><td colspan="${weeks.length + 3}" class="empty">暂无老师档案</td></tr>`}
            ${rows.length ? `
              <tr>
                <td class="text-cell"><b>合计</b></td>
                ${weeks.map((week) => `<td class="text-cell right"><b>${formatMoney(rows.reduce((sum, row) => sum + teacherTravelAmount(row, week), 0))}</b></td>`).join("")}
                <td class="text-cell right"><b>${formatMoney(total)}</b></td>
                <td></td>
              </tr>
            ` : ""}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function teacherSalaryRuleDatalists() {
  const teachers = uniqueSorted((state.profile_teachers || []).map((row) => row.name).filter(Boolean));
  const grades = uniqueSorted([...gradeOrder, ...usedLessonLookupValues("grades")]);
  const subjects = uniqueSorted([...(state.lookups.subjects || []), ...usedLessonLookupValues("subjects")]);
  const students = uniqueSorted((state.profile_students || []).map((row) => row.name).filter(Boolean));
  const list = (id, values) => `<datalist id="${id}">${values.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("")}</datalist>`;
  return [
    list("teacher-salary-rule-teachers", teachers),
    list("teacher-salary-rule-grades", grades),
    list("teacher-salary-rule-subjects", subjects),
    list("teacher-salary-rule-students", students),
  ].join("");
}

function renderTeacherSalaryRules() {
  queueTeacherSalaryRuleCandidateSync();
  const rules = state.teacher_salary_rules || [];
  const sortedRules = sortTeacherSalaryRules(rules);
  const opts = dynamicTeacherSalaryRuleFilterOptions(sortedRules);
  const visibleRules = sortedRules.filter((rule) => teacherSalaryRuleMatchesFilter(rule));
  const modalCandidates = {
    teachers: uniqueSorted((state.profile_teachers || []).map((row) => row.name).filter(Boolean)),
    grades: uniqueSorted([...gradeOrder, ...usedLessonLookupValues("grades")]),
    subjects: uniqueSorted([...(state.lookups.subjects || []), ...usedLessonLookupValues("subjects")]),
    students: uniqueSorted((state.profile_students || []).map((row) => row.name).filter(Boolean)),
  };
  const effectiveCount = rules.filter((rule) => optionalNumberValue(rule.salary_per_unit) > 0).length;
  const pendingCount = rules.filter((rule) => optionalNumberValue(rule.salary_per_unit) == null || optionalNumberValue(rule.salary_per_unit) <= 0).length;
  const sync = teacherSalaryRuleCandidateSync;
  const syncNotice = sync.busy
    ? `<div class="section-subtitle">正在根据历史课程自动补齐课时明细候选...</div>`
    : sync.error
      ? `<div class="section-subtitle">课时明细候选同步失败：${escapeHtml(sync.error)}</div>`
      : sync.result
        ? `<div class="section-subtitle">已根据历史课程补齐课时明细候选：新增 ${sync.result.createdCount || 0} 条，已有 ${sync.result.existingCount || 0} 条，跳过 ${sync.result.skippedCount || 0} 条。</div>`
        : "";
  renderTopbar(
    "课时明细",
    `有效 ${effectiveCount} 条 / 待设置 ${pendingCount} 条 / 共 ${rules.length} 条`,
  );
  contentEl.innerHTML = `
    <div class="band">
      <div class="section-head">
        <div>
          <div class="section-title">全局规则</div>
          <div class="section-subtitle">课时薪资按每2小时计算。薪资大于 0 才会被启用；0 元记录仅作为待设置候选，不参与自动匹配。已有课程薪资不会自动覆盖，可在薪资明细中勾选后按规则更新。</div>
          ${syncNotice}
        </div>
        <button class="btn primary open-teacher-salary-rule-modal" type="button">+ 新增课时明细</button>
      </div>
      <div class="filter-bar compact">
        <label class="filter-field">
          <span>老师</span>
          ${filterComboControl({ className: "teacher-salary-rule-filter-input", field: "teacher", value: teacherSalaryRuleFilter.teacher, values: opts.teachers, placeholder: "输入或选择老师" })}
        </label>
        <label class="filter-field">
          <span>年级</span>
          ${filterComboControl({ className: "teacher-salary-rule-filter-input", field: "grade", value: teacherSalaryRuleFilter.grade, values: opts.grades, placeholder: "输入或选择年级" })}
        </label>
        <label class="filter-field">
          <span>科目</span>
          ${filterComboControl({ className: "teacher-salary-rule-filter-input", field: "subject", value: teacherSalaryRuleFilter.subject, values: opts.subjects, placeholder: "输入或选择科目" })}
        </label>
        <label class="filter-field">
          <span>学生</span>
          ${filterComboControl({ className: "teacher-salary-rule-filter-input", field: "student", value: teacherSalaryRuleFilter.student, values: opts.students, placeholder: "输入学生搜索" })}
        </label>
        <label class="filter-field">
          <span>价格状态</span>
          ${filterComboControl({ className: "teacher-salary-rule-filter-input", field: "salary_status", value: teacherSalaryRuleFilter.salary_status, values: opts.salaryStatuses, placeholder: "输入或选择价格状态" })}
        </label>
        <button class="btn reset-teacher-salary-rule-filter" type="button">清空筛选</button>
      </div>
      <div class="table-wrap smooth-table-wrap">
        <table class="teacher-salary-rule-table uniform-table nowrap-table">
          <thead><tr><th>老师</th><th>年级</th><th>科目</th><th class="wide">学生集合</th><th>每2小时薪资</th><th>价格状态</th><th class="wide">备注</th></tr></thead>
          <tbody>
            ${visibleRules.map((rule) => `
              <tr class="teacher-salary-rule-row" data-rule-id="${rule.id}">
                <td class="text-cell">${escapeHtml(rule.teacher_name)}</td>
                <td class="text-cell">${escapeHtml(rule.grade)}</td>
                <td class="text-cell">${escapeHtml(rule.subject)}</td>
                <td class="text-cell wide">${escapeHtml(rule.student_names)}</td>
                <td class="currency-input-cell">${currencyInputMarkup(rule.salary_per_unit, { className: "teacher-salary-rule-field", attrs: `data-field="salary_per_unit" min="0" step="0.01"`, inputValue: teacherSalaryInputValue(rule.salary_per_unit) })}</td>
                <td class="text-cell">${teacherSalaryRuleSalaryStatus(rule)}</td>
                <td><input class="cell-input wide teacher-salary-rule-field" data-field="notes" value="${escapeHtml(teacherSalaryRuleDisplayNotes(rule))}"></td>
              </tr>
            `).join("") || `<tr><td colspan="7" class="empty">暂无符合条件的课时明细</td></tr>`}
          </tbody>
        </table>
      </div>
      ${teacherSalaryRuleDatalists()}
    </div>
    ${teacherSalaryRuleModalOpen ? `
      <div class="modal-backdrop teacher-salary-rule-modal">
        <div class="modal-panel">
          <div class="modal-head">
            <div>
              <div class="modal-title">新增课时明细</div>
              <div class="modal-subtitle">学生集合会自动规范化；薪资大于 0 后才参与匹配。</div>
            </div>
          </div>
          <div class="lesson-create-form">
            <label>老师${filterComboControl({ id: "new-teacher-salary-rule-teacher", className: "modal-combo-input", field: "teacher", value: "", values: modalCandidates.teachers, placeholder: "输入或选择老师", emptyLabel: "" })}</label>
            <label>年级${filterComboControl({ id: "new-teacher-salary-rule-grade", className: "modal-combo-input", field: "grade", value: "", values: modalCandidates.grades, placeholder: "输入或选择年级", emptyLabel: "" })}</label>
            <label>科目${filterComboControl({ id: "new-teacher-salary-rule-subject", className: "modal-combo-input", field: "subject", value: "", values: modalCandidates.subjects, placeholder: "输入或选择科目", emptyLabel: "" })}</label>
            <label class="wide">学生集合${filterComboControl({ id: "new-teacher-salary-rule-students", className: "modal-combo-input", field: "students", value: "", values: modalCandidates.students, placeholder: "多个学生用顿号分隔", emptyLabel: "" })}</label>
            <label>每2小时薪资<input id="new-teacher-salary-rule-salary" class="control" type="number" min="0" step="0.01" placeholder="可先留空为 0"></label>
            <label class="wide">备注<input id="new-teacher-salary-rule-notes" class="control" placeholder="备注"></label>
          </div>
          <div class="modal-actions">
            <button class="btn" type="button" data-action="close-teacher-salary-rule-modal">取消</button>
            <button class="btn primary add-teacher-salary-rule" type="button">保存</button>
          </div>
        </div>
      </div>
    ` : ""}
  `;
}

function renderTeacherDetail() {
  const teachers = state.teachers.map((row) => row.name);
  const teacherAllSelected = auth.user?.role === "teacher" && selectedTeacher === TEACHER_ALL_VALUE;
  const monthKey = state?.settings?.month_key || activeMonth;
  const monthRows = sortedLessons().filter((row) => (row.month_key || monthKeyFromDateValue(row.date)) === monthKey);
  const rows = monthRows.filter((row) => teacherAllSelected ? teachers.includes(row.teacher_name) : row.teacher_name === selectedTeacher);
  const filterOptions = dynamicTeacherDetailFilterOptions(rows);
  const visibleRows = rows.filter((row) => teacherDetailMatchesFilter(row));
  const count = rows.filter(isCompletedLesson).length;
  const showSalary = canArea("salary");
  const salary = rows.reduce((sum, row) => sum + displayTeacherSalaryForLesson(row), 0);
  const eligibleRows = showSalary ? visibleRows.filter((row) => teacherSalaryRuleCalculation(row)) : [];
  const eligibleIds = new Set(eligibleRows.map((row) => Number(row.id)));
  for (const id of [...selectedTeacherSalaryLessonIds]) {
    if (!eligibleIds.has(Number(id))) selectedTeacherSalaryLessonIds.delete(Number(id));
  }
  const selectedCount = selectedTeacherSalaryLessonIds.size;
  const allSelected = eligibleRows.length > 0 && eligibleRows.every((row) => selectedTeacherSalaryLessonIds.has(Number(row.id)));
  renderTopbar(
    `${monthLabel()} 薪资明细`,
    teacherAllSelected ? "全部老师" : (selectedTeacher ? (showSalary ? `${selectedTeacher} · 在这里录入课时薪资` : selectedTeacher) : "未选择教师"),
    `<button class="btn export-teacher-detail-image" type="button" ${selectedTeacher && !teacherAllSelected ? "" : "disabled"}>复制图片</button>`,
  );
  contentEl.innerHTML = `
    <div class="query-head">
      <div class="metric">
        <div class="metric-label">教师姓名</div>
        ${auth.user?.role === "teacher" && teachers.length <= 1 ? `<div class="metric-value small">${escapeHtml(selectedTeacher || "未绑定老师")}</div>` : `<select class="control teacher-select" style="margin-top:8px;width:100%">
          ${auth.user?.role === "teacher" && teachers.length > 1 ? `<option value="${TEACHER_ALL_VALUE}" ${selectedTeacher === TEACHER_ALL_VALUE ? "selected" : ""}>全部老师</option>` : ""}
          ${options(teachers, selectedTeacher, "选择教师")}
        </select>`}
      </div>
      <div class="metric"><div class="metric-label">有效课时</div><div class="metric-value">${count}</div></div>
      ${showSalary ? `<div class="metric"><div class="metric-label">薪资统计</div><div class="metric-value">${formatMoney(salary)}</div></div>` : ""}
      <div class="metric"><div class="metric-label">课程记录</div><div class="metric-value">${rows.length}</div></div>
    </div>
    <div class="band">
      <div class="filter-bar compact">
        <label class="filter-field">
          <span>年级</span>
          ${filterComboControl({ className: "teacher-detail-filter-input", field: "grade", value: teacherDetailFilter.grade, values: filterOptions.grades, placeholder: "输入或选择年级" })}
        </label>
        <label class="filter-field">
          <span>科目</span>
          ${filterComboControl({ className: "teacher-detail-filter-input", field: "subject", value: teacherDetailFilter.subject, values: filterOptions.subjects, placeholder: "输入或选择科目" })}
        </label>
        <label class="filter-field">
          <span>学生</span>
          ${filterComboControl({ className: "teacher-detail-filter-input", field: "student", value: teacherDetailFilter.student, values: filterOptions.students, placeholder: "输入或选择学生" })}
        </label>
        <label class="filter-field">
          <span>薪资状态</span>
          ${filterComboControl({ className: "teacher-detail-filter-input", field: "source", value: teacherDetailFilter.source, values: filterOptions.sources, placeholder: "输入或选择薪资状态" })}
        </label>
        <label class="filter-field">
          <span>规则状态</span>
          ${filterComboControl({ className: "teacher-detail-filter-input", field: "rule_status", value: teacherDetailFilter.rule_status, values: filterOptions.ruleStatuses, placeholder: "输入或选择规则状态" })}
        </label>
        <button class="btn reset-teacher-detail-filter" type="button">清空筛选</button>
      </div>
      ${showSalary ? `
        <div class="teacher-detail-bulkbar">
          <button class="btn primary apply-selected-teacher-salary-rules" type="button" ${bulkActionDisabledAttr(selectedCount)}>${bulkActionText("按规则更新所选薪资", selectedCount)}</button>
          <span class="section-subtitle">勾选课程后，可批量按当前课时明细规则更新教师薪资</span>
        </div>
      ` : ""}
      <div class="table-wrap">
        <table class="course-table teacher-detail-table uniform-table nowrap-table">
          <thead><tr>${showSalary ? `<th class="select-col"><input class="teacher-salary-select-all" type="checkbox" ${allSelected ? "checked" : ""} ${eligibleRows.length ? "" : "disabled"} title="全选当前可见且可匹配规则的课程"></th>` : ""}<th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th class="wide">学生</th><th class="wide">备注</th>${showSalary ? "<th>教师薪资</th><th>规则薪资</th>" : ""}</tr></thead>
          <tbody>
            ${visibleRows.map((row) => {
              const calculated = showSalary ? teacherSalaryRuleCalculation(row) : null;
              const displayedRuleSalary = showSalary ? displayTeacherRuleSalaryForLesson(row) : null;
              const selected = selectedTeacherSalaryLessonIds.has(Number(row.id));
              const sourceLabel = showSalary ? teacherSalarySourceLabel(row) : "";
              const disabledReason = showSalary && !calculated ? teacherSalaryRuleDisableReason(row) : "";
              const ruleTitle = calculated?.warning || (calculated ? `${calculated.rule.salary_per_unit} 元 / ${calculated.rule.unit_hours || 2} 小时` : disabledReason);
              const salaryTitle = showSalary ? teacherSalarySourceTitle(row) : "";
              const displayedTeacherSalary = displayTeacherSalaryForLesson(row);
              return `
                <tr class="${isAbnormal(row) ? "abnormal" : ""}">
                  ${showSalary ? `<td class="teacher-salary-select-cell select-col"><input class="teacher-salary-lesson-select" data-id="${row.id}" type="checkbox" ${selected ? "checked" : ""} ${calculated ? "" : "disabled"} title="${escapeHtml(calculated ? "选择后可按规则覆盖当前薪资" : disabledReason)}"></td>` : ""}
                  <td class="text-cell">${escapeHtml(row.teacher_name)}</td><td class="text-cell">${escapeHtml(row.date)}</td><td class="text-cell">${statusBadge(rowStatus(row))}</td><td class="text-cell">${escapeHtml(weekdayCn(row.date))}</td><td class="text-cell">${escapeHtml(row.time_slot)}</td><td class="text-cell">${escapeHtml(row.classroom)}</td><td class="text-cell">${escapeHtml(row.grade)}</td><td class="text-cell">${escapeHtml(row.subject)}</td><td class="text-cell">${escapeHtml(row.student_names)}</td><td class="text-cell">${escapeHtml(row.notes)}</td>
                  ${showSalary ? `
                    <td class="text-cell right price-cell-wrap teacher-salary-cell" title="${escapeHtml(salaryTitle)}"><span class="price-inline editable-price-inline">${currencyInputMarkup(displayedTeacherSalary, { className: `teacher-detail-salary-field ${sourceLabel === "手动" ? "manual-price" : ""}`, attrs: `data-id="${row.id}" data-field="teacher_salary" step="0.01" placeholder="未填写" title="${escapeHtml(salaryTitle)}" ${isCompletedLesson(row) ? "" : "disabled"}`, inputValue: teacherSalaryInputValue(displayedTeacherSalary) })}${teacherSalarySourceBadge(row)}</span></td>
                    <td class="text-cell right" title="${escapeHtml(ruleTitle)}">${displayedRuleSalary === null ? "" : formatMoney(displayedRuleSalary)}</td>
                  ` : ""}
                </tr>
              `;
            }).join("") || `<tr><td colspan="${showSalary ? 13 : 10}" class="empty">暂无符合条件的教师课程</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function courseNoticeFullMessage(item) {
  return `${item.greeting || ""}\n${courseNoticeState.data?.global_tail || ""}`;
}

function teacherCourseNoticeFullMessage(item) {
  return `${item.greeting || ""}\n${teacherCourseNoticeState.data?.global_tail || ""}`;
}

function courseNoticeStatusText(item) {
  if (item.completed) return "已完成";
  if (item.partial_completed) return `部分完成 ${item.completed_count}/${item.lesson_count}`;
  return "待发送";
}

function courseNoticeColumns(mode = "parent") {
  const columns = [
    ["teacher_name", "授课老师"],
    ["date", "日期"],
    ["lesson_status", "上课情况"],
    ["weekday", "星期"],
    ["time_slot", "时间"],
    ["classroom", "教室"],
    ["grade", "年级"],
    ["subject", "科目"],
    ["student_names", "学生"],
  ];
  return columns;
}

function renderCourseNoticePreview(item, mode = "parent", title = "课程通知") {
  const rows = item.lessons || [];
  const columns = courseNoticeColumns(mode);
  return `
    <div class="notice-shot-preview" data-shot-key="${escapeHtml(item.send_object_key)}">
      <div class="notice-shot-shell">
        <div class="notice-shot-head">
          <div class="notice-shot-title">${escapeHtml(title)}</div>
        </div>
        <table class="notice-shot-table">
          <thead>
            <tr>
              ${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.map((lesson) => `
              <tr>
                ${columns.map(([key]) => `<td>${escapeHtml(lesson[key] || (key === "weekday" ? weekdayCn(lesson.date) : ""))}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderCourseNotice() {
  ensureCourseNoticeFilterDates();
  renderTopbar("课程通知生成", "家长群课程截图");
  topbarEl.querySelector(".page-title")?.insertAdjacentHTML(
    "beforeend",
    `<span class="page-title-note">选择日期自动刷新；可修改称呼和尾句；复制截图后自动打勾；清除只清打勾记录</span>`,
  );
  const data = courseNoticeState.data;
  const shouldLoad = !courseNoticeState.busy && courseNoticeState.loadedQuery !== courseNoticeQuery();
  if (shouldLoad) setTimeout(() => loadCourseNoticeData(), 0);
  const objects = data?.send_objects || [];
  const completedObjects = objects.filter((item) => item.completed).length;
  contentEl.innerHTML = `
    <div class="filter-bar notice-filter-bar">
      <div class="filter-controls">
        <label class="filter-field">
          <span>日期范围</span>
          ${dateRangePickerControl({ scope: "course-notice", start: courseNoticeFilter.start, end: courseNoticeFilter.end, placeholder: "选择课程通知日期范围" })}
        </label>
        <label class="history-toggle">
          <input class="course-notice-only" type="checkbox" ${courseNoticeFilter.onlyTeaching ? "checked" : ""}>
          <span>只选择“上课”</span>
        </label>
        <label class="filter-field notice-tail-field">
          <span>全局后半句</span>
          <input class="control course-notice-tail" value="${escapeHtml(data?.global_tail || "这是我们本周的上课安排哦[玫瑰]")}">
        </label>
        <button class="btn primary course-notice-generate" type="button">生成课程通知</button>
        <button class="btn danger course-notice-clear-completions" type="button">清除所有打勾记录</button>
      </div>
      <div class="filter-summary">
        <span>已完成对象 <b>${completedObjects}/${objects.length}</b></span>
      </div>
    </div>
    ${courseNoticeState.error ? `<div class="empty">${escapeHtml(courseNoticeState.error)}</div>` : ""}
    ${courseNoticeState.busy ? `<div class="empty">正在生成课程通知...</div>` : ""}
    ${!courseNoticeState.busy && data ? `
      <div class="notice-list">
        ${objects.map((item) => `
          <div class="notice-item ${item.completed ? "completed" : ""} ${item.partial_completed ? "partial" : ""}" data-send-key="${escapeHtml(item.send_object_key)}">
            <div class="notice-left">
              ${item.completed ? `<div class="notice-checkmark">✓</div>` : ""}
              <div class="notice-object-head">
                <div>
                  <div class="notice-object-name">${escapeHtml(item.send_object_name)}</div>
                  <div class="notice-object-meta">
                    <span>${escapeHtml(item.send_object_type)}</span>
                    <span>老师：${escapeHtml((item.teachers || []).join("、") || "-")}</span>
                    <span>年级：${escapeHtml((item.grades || []).join("、") || "-")}</span>
                    <span>科目：${escapeHtml((item.subjects || []).join("、") || "-")}</span>
                    <span>${item.lesson_count} 节课</span>
                  </div>
                </div>
                <span class="status-badge ${item.completed ? "done" : item.partial_completed ? "exam" : "pending"}">${escapeHtml(courseNoticeStatusText(item))}</span>
              </div>
              ${renderCourseNoticePreview(item)}
            </div>
            <div class="notice-right">
              <label class="filter-field">
                <span>称呼</span>
                <input class="control notice-greeting" data-send-key="${escapeHtml(item.send_object_key)}" value="${escapeHtml(item.greeting || "")}">
              </label>
              <label class="filter-field">
                <span>自动生成文案</span>
                <textarea class="control notice-message" data-send-key="${escapeHtml(item.send_object_key)}" rows="4" readonly>${escapeHtml(courseNoticeFullMessage(item))}</textarea>
              </label>
              <div class="notice-actions">
                <button class="btn notice-copy-message" type="button" data-send-key="${escapeHtml(item.send_object_key)}">复制文案</button>
                <button class="btn primary notice-copy-image" type="button" data-send-key="${escapeHtml(item.send_object_key)}">${item.completed ? "已复制截图" : "复制课程截图"}</button>
                <button class="btn notice-download-image" type="button" data-send-key="${escapeHtml(item.send_object_key)}">下载课程截图</button>
              </div>
              <div class="notice-state">${item.completed ? "✓ 该发送对象已完成" : item.partial_completed ? "部分课程已有完成记录" : "等待复制截图"}</div>
            </div>
          </div>
        `).join("") || `<div class="empty">当前日期范围暂无可发送课程</div>`}
      </div>
    ` : ""}
  `;
}

function renderTeacherCourseNotice() {
  ensureTeacherCourseNoticeFilterDates();
  renderTopbar("老师课程截图生成", "按老师生成课程安排截图");
  topbarEl.querySelector(".page-title")?.insertAdjacentHTML(
    "beforeend",
    `<span class="page-title-note">选择日期自动刷新；可修改称呼和尾句；复制截图后自动打勾；清除只清老师版打勾记录</span>`,
  );
  const data = teacherCourseNoticeState.data;
  const shouldLoad = !teacherCourseNoticeState.busy && teacherCourseNoticeState.loadedQuery !== teacherCourseNoticeQuery();
  if (shouldLoad) setTimeout(() => loadTeacherCourseNoticeData(), 0);
  const objects = data?.send_objects || [];
  const completedObjects = objects.filter((item) => item.completed).length;
  contentEl.innerHTML = `
    <div class="filter-bar notice-filter-bar">
      <div class="filter-controls">
        <label class="filter-field">
          <span>日期范围</span>
          ${dateRangePickerControl({ scope: "teacher-course-notice", start: teacherCourseNoticeFilter.start, end: teacherCourseNoticeFilter.end, placeholder: "选择老师课程日期范围" })}
        </label>
        <label class="history-toggle">
          <input class="teacher-course-notice-only" type="checkbox" ${teacherCourseNoticeFilter.onlyTeaching ? "checked" : ""}>
          <span>只选择“上课”</span>
        </label>
        <label class="filter-field notice-tail-field">
          <span>全局后半句</span>
          <input class="control teacher-course-notice-tail" value="${escapeHtml(data?.global_tail || "这是我们本周的上课安排哦[玫瑰]")}">
        </label>
        <button class="btn primary teacher-course-notice-generate" type="button">生成课程通知</button>
        <button class="btn danger teacher-course-notice-clear-completions" type="button">清除所有打勾记录</button>
      </div>
      <div class="filter-summary">
        <span>已完成对象 <b>${completedObjects}/${objects.length}</b></span>
      </div>
    </div>
    ${teacherCourseNoticeState.error ? `<div class="empty">${escapeHtml(teacherCourseNoticeState.error)}</div>` : ""}
    ${teacherCourseNoticeState.busy ? `<div class="empty">正在生成老师课程通知...</div>` : ""}
    ${!teacherCourseNoticeState.busy && data ? `
      <div class="notice-list">
        ${objects.map((item) => `
          <div class="notice-item ${item.completed ? "completed" : ""} ${item.partial_completed ? "partial" : ""}" data-send-key="${escapeHtml(item.send_object_key)}">
            <div class="notice-left">
              ${item.completed ? `<div class="notice-checkmark">✓</div>` : ""}
              <div class="notice-object-head">
                <div>
                  <div class="notice-object-name">${escapeHtml(item.send_object_name)}</div>
                  <div class="notice-object-meta">
                    <span>${escapeHtml(item.send_object_type)}</span>
                    <span>年级：${escapeHtml((item.grades || []).join("、") || "-")}</span>
                    <span>科目：${escapeHtml((item.subjects || []).join("、") || "-")}</span>
                    <span>${item.lesson_count} 节课</span>
                  </div>
                </div>
                <span class="status-badge ${item.completed ? "done" : item.partial_completed ? "exam" : "pending"}">${escapeHtml(courseNoticeStatusText(item))}</span>
              </div>
              ${renderCourseNoticePreview(item, "teacher", "本周课程安排")}
            </div>
            <div class="notice-right">
              <label class="filter-field">
                <span>称呼</span>
                <input class="control teacher-notice-greeting" data-send-key="${escapeHtml(item.send_object_key)}" value="${escapeHtml(item.greeting || "")}">
              </label>
              <label class="filter-field">
                <span>自动生成文案</span>
                <textarea class="control teacher-notice-message" data-send-key="${escapeHtml(item.send_object_key)}" rows="4" readonly>${escapeHtml(teacherCourseNoticeFullMessage(item))}</textarea>
              </label>
              <div class="notice-actions">
                <button class="btn teacher-notice-copy-message" type="button" data-send-key="${escapeHtml(item.send_object_key)}">复制文案</button>
                <button class="btn primary teacher-notice-copy-image" type="button" data-send-key="${escapeHtml(item.send_object_key)}">${item.completed ? "已复制截图" : "复制课程截图"}</button>
                <button class="btn teacher-notice-download-image" type="button" data-send-key="${escapeHtml(item.send_object_key)}">下载课程截图</button>
              </div>
              <div class="notice-state">${item.completed ? "✓ 该老师课程通知已完成" : item.partial_completed ? "部分课程已有完成记录" : "等待复制截图"}</div>
            </div>
          </div>
        `).join("") || `<div class="empty">当前日期范围暂无老师课程</div>`}
      </div>
    ` : ""}
  `;
}

function findCourseNoticeObject(key) {
  return (courseNoticeState.data?.send_objects || []).find((item) => item.send_object_key === key);
}

function findTeacherCourseNoticeObject(key) {
  return (teacherCourseNoticeState.data?.send_objects || []).find((item) => item.send_object_key === key);
}

function updateCourseNoticeMessageDom(key) {
  const item = findCourseNoticeObject(key);
  const textarea = document.querySelector(`.notice-message[data-send-key="${CSS.escape(key)}"]`);
  if (item && textarea) textarea.value = courseNoticeFullMessage(item);
}

function updateTeacherCourseNoticeMessageDom(key) {
  const item = findTeacherCourseNoticeObject(key);
  const textarea = document.querySelector(`.teacher-notice-message[data-send-key="${CSS.escape(key)}"]`);
  if (item && textarea) textarea.value = teacherCourseNoticeFullMessage(item);
}

async function saveCourseNoticeGreeting(item) {
  await request("/api/course-notice/greeting", {
    method: "POST",
    body: {
      send_object_key: item.send_object_key,
      send_object_name: item.send_object_name,
      send_object_type: item.send_object_type,
      students: item.students,
      greeting: item.greeting,
      global_tail: courseNoticeState.data?.global_tail || "",
    },
  });
}

async function saveTeacherCourseNoticeGreeting(item) {
  await request("/api/teacher-course-notice/greeting", {
    method: "POST",
    body: {
      send_object_key: item.send_object_key,
      send_object_name: item.send_object_name,
      send_object_type: item.send_object_type,
      students: item.students,
      greeting: item.greeting,
      global_tail: teacherCourseNoticeState.data?.global_tail || "",
    },
  });
}

function cssVar(name, fallback = "") {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function courseNoticeShotPalette() {
  return {
    bg: cssVar("--shot-bg", "#f7f9fc"),
    panel: cssVar("--shot-panel", "#ffffff"),
    card: cssVar("--shot-card", "#ffffff"),
    title: cssVar("--shot-title", "#102033"),
    muted: cssVar("--shot-muted", "#64748b"),
    line: cssVar("--shot-line", "#c8d6e5"),
    brand: cssVar("--shot-brand", "#002147"),
    brandDark: cssVar("--shot-brand-dark", "#00172f"),
    brandSoft: cssVar("--shot-brand-soft", "#eaf0f7"),
    brandPale: cssVar("--shot-brand-pale", "#f5f8fc"),
    tagBg: cssVar("--shot-tag-bg", "#eaf0f7"),
    tagText: cssVar("--shot-tag-text", "#002147"),
    timeBg: cssVar("--shot-time-bg", "#eaf0f7"),
    footerBg: cssVar("--shot-footer-bg", "#eef3f9"),
  };
}

function courseNoticeCanvas(item, mode = "parent", title = "课程通知") {
  const colors = courseNoticeShotPalette();
  const columns = courseNoticeColumns(mode);
  const rows = item.lessons || [];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = "16px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  const headFont = "700 16px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  ctx.font = font;
  const paddingX = 18;
  const rowHeight = 44;
  const outerPadding = 30;
  const titleHeight = 54;
  const colWidths = columns.map(([key, label]) => {
    const maxText = Math.max(
      ctx.measureText(label).width,
      ...rows.map((row) => ctx.measureText(String(row[key] || (key === "weekday" ? weekdayCn(row.date) : ""))).width),
    );
    return Math.ceil(Math.max(82, maxText + paddingX * 2));
  });
  const minimumTableWidth = 760;
  const naturalTableWidth = colWidths.reduce((sum, value) => sum + value, 0);
  if (naturalTableWidth < minimumTableWidth) colWidths[colWidths.length - 1] += minimumTableWidth - naturalTableWidth;
  const tableWidth = colWidths.reduce((sum, value) => sum + value, 0);
  const tableHeight = rowHeight * (rows.length + 1);
  const width = tableWidth + outerPadding * 2;
  const height = titleHeight + tableHeight + outerPadding * 2;
  const tableX = outerPadding;
  const tableY = outerPadding + titleHeight;
  const panelX = outerPadding / 2;
  const panelY = outerPadding / 2;
  const panelWidth = width - outerPadding;
  const panelHeight = height - outerPadding;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(ratio, ratio);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.shadowColor = "rgba(16, 32, 51, 0.08)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = colors.panel;
  ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
  ctx.restore();
  ctx.strokeStyle = colors.line;
  ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);
  ctx.fillStyle = colors.brand;
  ctx.fillRect(panelX, panelY, panelWidth, 5);
  ctx.fillStyle = colors.brandPale;
  ctx.fillRect(panelX + 1, panelY + 5, panelWidth - 2, titleHeight - 6);
  ctx.fillStyle = colors.brandDark;
  ctx.font = "900 24px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, width / 2, panelY + titleHeight / 2 + 3);
  ctx.textAlign = "left";
  ctx.save();
  ctx.shadowColor = "rgba(16, 32, 51, 0.08)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = colors.card;
  ctx.fillRect(tableX, tableY, tableWidth, tableHeight);
  ctx.restore();
  ctx.strokeStyle = colors.line;
  ctx.strokeRect(tableX, tableY, tableWidth, tableHeight);
  let x = tableX;
  ctx.font = headFont;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  columns.forEach(([, label], index) => {
    ctx.fillStyle = colors.brandSoft;
    ctx.fillRect(x, tableY, colWidths[index], rowHeight);
    ctx.strokeStyle = colors.line;
    ctx.strokeRect(x, tableY, colWidths[index], rowHeight);
    ctx.fillStyle = colors.brandDark;
    ctx.fillText(label, x + colWidths[index] / 2, tableY + rowHeight / 2);
    x += colWidths[index];
  });
  ctx.font = font;
  rows.forEach((row, rowIndex) => {
    x = tableX;
    const y = tableY + rowHeight * (rowIndex + 1);
    columns.forEach(([key], index) => {
      ctx.fillStyle = rowIndex % 2 ? colors.brandPale : colors.card;
      ctx.fillRect(x, y, colWidths[index], rowHeight);
      ctx.strokeStyle = colors.line;
      ctx.strokeRect(x, y, colWidths[index], rowHeight);
      ctx.fillStyle = key === "time_slot" || key === "grade" || key === "subject" ? colors.tagText : colors.title;
      const value = String(row[key] || (key === "weekday" ? weekdayCn(row.date) : ""));
      ctx.fillText(value, x + colWidths[index] / 2, y + rowHeight / 2);
      x += colWidths[index];
    });
  });
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  return canvas;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片生成失败")), "image/png");
  });
}

async function downloadCourseNoticeImage(item, mode = "parent", title = "课程通知") {
  const canvas = courseNoticeCanvas(item, mode, title);
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `${item.send_object_name || "课程安排"}.png`;
  link.click();
}

async function completeCourseNoticeItem(item, endpoint = "/api/course-notice/complete") {
  await request(endpoint, {
    method: "POST",
    body: {
      send_object_key: item.send_object_key,
      send_object_name: item.send_object_name,
      send_object_type: item.send_object_type,
      lessons: item.lessons,
    },
  });
  item.completed = true;
  item.partial_completed = false;
  item.completed_count = item.lesson_count;
}

async function copyCourseNoticeImage(item, mode = "parent", title = "课程通知", endpoint = "/api/course-notice/complete") {
  const canvas = courseNoticeCanvas(item, mode, title);
  const blob = await canvasBlob(canvas);
  if (!navigator.clipboard?.write || !window.ClipboardItem) {
    await downloadCourseNoticeImage(item, mode, title);
    throw new Error("当前浏览器不支持直接复制图片，已改为下载图片");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  await completeCourseNoticeItem(item, endpoint);
  showToast(`${item.send_object_name} 已完成`);
  render();
}

function dashboardMetricCatalog() {
  return state?.dashboard?.metrics || [];
}

function storedJsonArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function dashboardDefaultMetricKeys() {
  const available = new Set(dashboardMetricCatalog().map((item) => item.key));
  const preferred = [
    "month_course_fee",
    "month_receivable",
    "today_completed_lessons",
    "today_leave_count",
    "student_debt_amount",
    "month_completed_lessons",
    "today_pending_lessons",
    "month_consumption_hours",
    "active_student_count",
  ];
  return preferred.filter((key) => available.has(key)).slice(0, 5);
}

function dashboardSelectedMetricKeys(source = storedJsonArray(DASHBOARD_METRICS_KEY)) {
  const available = new Set(dashboardMetricCatalog().map((item) => item.key));
  const keys = source.filter((key) => available.has(key));
  return (keys.length ? keys : dashboardDefaultMetricKeys()).slice(0, 5);
}

function dashboardMetricValue(item = {}) {
  if (item.format === "money") return formatMoney(item.value);
  if (item.format === "hours") return `${Number(item.value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 小时`;
  return Number(item.value || 0).toLocaleString("zh-CN");
}

function dashboardShortcutCatalog() {
  return [
    { key: "studentProfiles", label: "学生档案", view: "studentProfiles", group: "学生管理", icon: NAV_ICONS.students },
    { key: "lessons", label: "课程总表", view: "lessons", group: "教务管理", icon: NAV_ICONS.schedule },
    { key: "week", label: "周课表", view: "week", group: "教务管理", icon: NAV_ICONS.schedule },
    { key: "weekMatrix", label: "矩阵课表", view: "weekMatrix", group: "教务管理", icon: NAV_ICONS.schedule },
    { key: "newLesson", label: "新增课程", view: "lessons", group: "常用功能", icon: NAV_ICONS.schedule, action: "newLesson" },
    { key: "teacherProfiles", label: "教师管理", view: "teacherProfiles", group: "教师管理", icon: NAV_ICONS.teachers },
    { key: "recharges", label: "充值记录", view: "recharges", group: "财务管理", icon: NAV_ICONS.students },
    { key: "summary", label: "费用汇总", view: "summary", group: "财务管理", icon: NAV_ICONS.finance },
    { key: "pricing", label: "费用标准", view: "pricing", group: "设置管理", icon: NAV_ICONS.settings },
    { key: "operationLogs", label: "操作日志", view: "operationLogs", group: "设置管理", icon: NAV_ICONS.settings },
    { key: "userAdmin", label: "账号权限", view: "userAdmin", group: "设置管理", icon: NAV_ICONS.settings },
  ].filter((item) => canView(item.view));
}

function dashboardDefaultShortcutKeys() {
  const available = new Set(dashboardShortcutCatalog().map((item) => item.key));
  return ["studentProfiles", "lessons", "week", "teacherProfiles", "recharges", "summary", "newLesson", "weekMatrix"]
    .filter((key) => available.has(key))
    .slice(0, 8);
}

function dashboardSelectedShortcutKeys(source = storedJsonArray(DASHBOARD_SHORTCUTS_KEY)) {
  const available = new Set(dashboardShortcutCatalog().map((item) => item.key));
  const keys = source.filter((key) => available.has(key));
  return keys.length ? keys : dashboardDefaultShortcutKeys();
}

function dashboardGoTo(viewKey, filter = {}) {
  if (!canView(viewKey)) return alert("无权限访问");
  if (viewKey === "lessons") {
    const nextFilter = { ...lessonFilter, month_key: state.settings.month_key, ...filter, date_preset_initialized: true };
    nextFilter.teacher_names = normalizeNameList(nextFilter.teacher_names || (nextFilter.teacher ? [nextFilter.teacher] : []));
    nextFilter.teacher = nextFilter.teacher_names.join("、");
    lessonFilter = nextFilter;
    saveLessonFilter();
  }
  if (viewKey === "summary") summaryFilter = { ...summaryFilter, ...filter };
  if (viewKey === "feeDetails") feeDetailsFilter = { ...feeDetailsFilter, ...filter };
  view = viewKey;
  activeNavGroup = groupForView(viewKey).key;
  localStorage.setItem("liming:view", view);
  localStorage.setItem("liming:nav-group", activeNavGroup);
  load({ refreshGlobal: false });
}

function dashboardTrendSvg(rows = []) {
  const width = 760;
  const height = 238;
  const pad = { left: 42, right: 18, top: 20, bottom: 36 };
  const values = rows.map((row) => Number(row.lesson_count || 0));
  const max = Math.max(1, Math.ceil(Math.max(...values)));
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  if (!rows.length || values.every((value) => value === 0)) {
    return `<div class="dashboard-empty-chart">暂无课程数据</div>`;
  }
  const step = rows.length > 1 ? plotW / (rows.length - 1) : plotW;
  const points = rows.map((row, index) => {
    const x = pad.left + index * step;
    const y = pad.top + plotH - (Number(row.lesson_count || 0) / max) * plotH;
    return { x, y, row };
  });
  const linePath = points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    const previous = points[index - 1];
    const midX = (previous.x + point.x) / 2;
    return `${path} C ${midX.toFixed(1)} ${previous.y.toFixed(1)}, ${midX.toFixed(1)} ${point.y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }, "");
  const baseline = pad.top + plotH;
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${baseline} L ${points[0].x.toFixed(1)} ${baseline} Z`;
  const labelStep = Math.max(1, Math.ceil((rows.length - 1) / 5));
  const labels = points.map((point, index) => {
    if (index !== 0 && index !== rows.length - 1 && index % labelStep !== 0) return "";
    return `<text class="dashboard-chart-label" x="${point.x.toFixed(1)}" y="${height - 12}" text-anchor="middle">${escapeHtml(point.row.date.slice(5))}</text>`;
  }).join("");
  const gridLines = [0, 0.5, 1].map((ratio) => {
    const y = pad.top + plotH * ratio;
    return `<line class="dashboard-chart-grid" x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}"></line>`;
  }).join("");
  return `
    <svg class="dashboard-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="课程趋势图">
      ${gridLines}
      <text class="dashboard-chart-y-label" x="${pad.left - 10}" y="${pad.top + 4}" text-anchor="end">${max}</text>
      <text class="dashboard-chart-y-label" x="${pad.left - 10}" y="${baseline + 4}" text-anchor="end">0</text>
      <path class="dashboard-trend-area" d="${areaPath}"></path>
      <path class="dashboard-trend-line" d="${linePath}"></path>
      ${labels}
    </svg>
  `;
}

function dashboardPieSvg(pie = {}, options = {}) {
  const caption = options.caption || "学员";
  const emptyText = options.emptyText || `暂无${caption}数据`;
  const ariaLabel = options.ariaLabel || `${caption}数量圆环图`;
  const items = (pie.items || []).filter((item) => Number(item.value || 0) > 0);
  const total = Number(pie.total || items.reduce((sum, item) => sum + Number(item.value || 0), 0));
  if (!items.length || !total) return `<div class="dashboard-empty-chart">${escapeHtml(emptyText)}</div>`;
  const colors = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#64748b"];
  let acc = 0;
  const radius = 76;
  const circumference = 2 * Math.PI * radius;
  const segments = items.map((item, index) => {
    const value = Number(item.value || 0);
    const length = (value / total) * circumference;
    const dash = `${length} ${circumference - length}`;
    const offset = -acc;
    acc += length;
    return `<circle class="dashboard-pie-segment" cx="110" cy="110" r="${radius}" fill="none" stroke="${colors[index % colors.length]}" stroke-width="28" stroke-dasharray="${dash}" stroke-dashoffset="${offset}"><title>${escapeHtml(item.name)}：${value}</title></circle>`;
  }).join("");
  return `
    <div class="dashboard-pie-wrap ${items.length === 1 ? "single" : ""}">
      <svg class="dashboard-pie-svg" viewBox="0 0 220 220" role="img" aria-label="${escapeHtml(ariaLabel)}">
        <circle cx="110" cy="110" r="${radius}" fill="none" stroke="var(--line)" stroke-width="28"></circle>
        ${segments}
        <text class="dashboard-pie-total" x="110" y="104" text-anchor="middle">${total}</text>
        <text class="dashboard-pie-caption" x="110" y="130" text-anchor="middle">${escapeHtml(caption)}</text>
      </svg>
      <div class="dashboard-pie-legend">
        ${items.map((item, index) => `
          <div class="dashboard-legend-item">
            <span style="background:${colors[index % colors.length]}"></span>
            <div class="dashboard-legend-copy">
              <b>${escapeHtml(item.name)}</b>
              <em>${Number(item.value || 0)}</em>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function dashboardCurrentLessonsMarkup(rows = []) {
  if (!rows.length) return `<div class="dashboard-current-empty">当前没有正在上的课程</div>`;
  return `
    <div class="dashboard-current-list">
      ${rows.map((row) => `
        <div class="dashboard-current-item">
          <div class="dashboard-current-main">
            <strong>${escapeHtml(row.teacher_name || "未填老师")}</strong>
            <span>${escapeHtml(row.time_slot || "未填时间")}</span>
          </div>
          <div class="dashboard-current-meta">
            <span>${escapeHtml(row.classroom || "未填教室")}</span>
            <span>${escapeHtml(`${row.grade || ""}${row.subject || ""}` || "未填课程")}</span>
            <span>${escapeHtml(row.student_names || "未填学生")}</span>
          </div>
          ${statusBadge(row.status || "待上")}
        </div>
      `).join("")}
    </div>
  `;
}

function dashboardMetricModal() {
  if (!dashboardMetricModalOpen) return "";
  const catalog = dashboardMetricCatalog();
  const selected = dashboardMetricDraft || dashboardSelectedMetricKeys();
  const selectedSet = new Set(selected);
  return `
    <div class="modal-backdrop dashboard-config-modal">
      <div class="modal-panel dashboard-config-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">自定义数据</div>
            <div class="modal-subtitle">最多选择 5 个首页机构数据。</div>
          </div>
          <button class="btn dashboard-metric-cancel" type="button">关闭</button>
        </div>
        <div class="dashboard-config-columns">
          <div class="dashboard-config-column">
            <div class="section-title small">已选数据</div>
            <div class="dashboard-config-list">
              ${selected.map((key) => {
                const item = catalog.find((metric) => metric.key === key);
                if (!item) return "";
                return `<div class="dashboard-config-item"><span>${escapeHtml(item.label)}</span><button class="btn ghost dashboard-metric-remove" type="button" data-key="${escapeHtml(key)}">移除</button></div>`;
              }).join("") || `<div class="empty">暂无已选数据</div>`}
            </div>
          </div>
          <div class="dashboard-config-column">
            <div class="section-title small">可选数据</div>
            <div class="dashboard-config-list">
              ${catalog.filter((item) => !selectedSet.has(item.key)).map((item) => `
                <div class="dashboard-config-item"><span>${escapeHtml(item.label)}</span><button class="btn dashboard-metric-add" type="button" data-key="${escapeHtml(item.key)}" ${selected.length >= 5 ? "disabled" : ""}>添加</button></div>
              `).join("") || `<div class="empty">没有更多可选数据</div>`}
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn dashboard-metric-cancel" type="button">取消</button>
          <button class="btn primary dashboard-metric-save" type="button">确认</button>
        </div>
      </div>
    </div>
  `;
}

function dashboardShortcutModal() {
  if (!dashboardShortcutModalOpen) return "";
  const catalog = dashboardShortcutCatalog();
  const selected = dashboardShortcutDraft || dashboardSelectedShortcutKeys();
  const selectedSet = new Set(selected);
  const grouped = new Map();
  catalog.forEach((item) => {
    if (!grouped.has(item.group)) grouped.set(item.group, []);
    grouped.get(item.group).push(item);
  });
  return `
    <div class="modal-backdrop dashboard-config-modal">
      <div class="modal-panel dashboard-config-panel dashboard-feature-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">自定义常用功能</div>
            <div class="modal-subtitle">仅展示当前账号可访问的功能入口。</div>
          </div>
          <button class="btn dashboard-shortcut-cancel" type="button">关闭</button>
        </div>
        <div class="dashboard-selected-shortcuts">
          ${selected.map((key) => {
            const item = catalog.find((shortcut) => shortcut.key === key);
            if (!item) return "";
            return `<span class="dashboard-selected-chip">${item.icon}<b>${escapeHtml(item.label)}</b><button class="dashboard-shortcut-remove" type="button" data-key="${escapeHtml(key)}">×</button></span>`;
          }).join("") || `<span class="muted-tip">暂无已选功能</span>`}
        </div>
        <div class="dashboard-feature-groups">
          ${[...grouped.entries()].map(([group, items]) => `
            <div class="dashboard-feature-group">
              <div class="section-title small">${escapeHtml(group)}</div>
              <div class="dashboard-feature-options">
                ${items.map((item) => `
                  <button class="dashboard-feature-option ${selectedSet.has(item.key) ? "selected" : ""}" type="button" data-key="${escapeHtml(item.key)}">
                    ${item.icon}
                    <span>${escapeHtml(item.label)}</span>
                  </button>
                `).join("")}
              </div>
            </div>
          `).join("")}
        </div>
        <div class="modal-actions">
          <button class="btn dashboard-shortcut-reset" type="button">重置</button>
          <button class="btn dashboard-shortcut-cancel" type="button">取消</button>
          <button class="btn primary dashboard-shortcut-save" type="button">确认</button>
        </div>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const dashboard = state.dashboard || { metrics: [], todos: [], trend: [], student_pie: { items: [], total: 0 }, teacher_pie: { items: [], total: 0 }, current_lessons: [] };
  const metricMap = new Map(dashboardMetricCatalog().map((item) => [item.key, item]));
  const selectedMetrics = dashboardSelectedMetricKeys().map((key) => metricMap.get(key)).filter(Boolean);
  const shortcuts = dashboardShortcutCatalog();
  const shortcutMap = new Map(shortcuts.map((item) => [item.key, item]));
  const selectedShortcuts = dashboardSelectedShortcutKeys().map((key) => shortcutMap.get(key)).filter(Boolean);
  renderTopbar("首页");
  contentEl.innerHTML = `
    <div class="dashboard-page">
      <section class="band dashboard-metrics-section">
        <div class="section-head">
          <div>
            <div class="section-title">机构数据</div>
            <div class="section-subtitle">基于当前业务数据自动更新。</div>
          </div>
          <button class="btn icon-btn dashboard-open-metric-config" type="button" title="自定义数据" aria-label="自定义数据">${NAV_ICONS.settings}</button>
        </div>
        <div class="dashboard-metric-grid">
          ${selectedMetrics.map((item) => `
            <div class="dashboard-metric-card">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(dashboardMetricValue(item))}</strong>
            </div>
          `).join("") || `<div class="empty">暂无可显示数据</div>`}
        </div>
      </section>

      <section class="band dashboard-shortcuts-section">
        <div class="section-head">
          <div>
            <div class="section-title">常用功能</div>
          </div>
          <button class="btn icon-btn dashboard-open-shortcut-config" type="button" title="自定义常用功能" aria-label="自定义常用功能">${NAV_ICONS.settings}</button>
        </div>
        <div class="dashboard-shortcut-grid">
          ${selectedShortcuts.map((item) => `
            <button class="dashboard-shortcut" type="button" data-key="${escapeHtml(item.key)}">
              ${item.icon}
              <span>${escapeHtml(item.label)}</span>
            </button>
          `).join("") || `<div class="empty">暂无常用功能</div>`}
        </div>
      </section>

      <div class="dashboard-main-grid">
        <section class="band dashboard-todo-section">
          <div class="section-head">
            <div>
              <div class="section-title">待办事项</div>
            </div>
          </div>
          <div class="dashboard-todo-list">
            ${(dashboard.todos || []).map((item) => `
              <button class="dashboard-todo-item" type="button" data-view="${escapeHtml(item.view || "dashboard")}" data-filter="${escapeHtml(JSON.stringify(item.filter || {}))}">
                <span>${escapeHtml(item.label)}</span>
                <strong>${Number(item.count || 0).toLocaleString("zh-CN")}</strong>
              </button>
            `).join("") || `<div class="empty">暂无待办</div>`}
          </div>
        </section>

        <section class="band dashboard-trend-section">
          <div class="section-head">
            <div>
              <div class="section-title">课程趋势</div>
            </div>
            <div class="dashboard-date-controls">
              ${dateRangePickerControl({ scope: "dashboard", start: dashboardRange.start, end: dashboardRange.end, placeholder: "选择趋势日期范围" })}
            </div>
          </div>
          ${dashboardTrendSvg(dashboard.trend || [])}
        </section>

        <section class="band dashboard-current-section">
          <div class="section-head">
            <div>
              <div class="section-title">正在上的课程</div>
            </div>
          </div>
          ${dashboardCurrentLessonsMarkup(dashboard.current_lessons || [])}
        </section>

        <section class="band dashboard-pie-section">
          <div class="section-head">
            <div>
              <div class="section-title">人数统计</div>
            </div>
          </div>
          <div class="dashboard-pie-grid">
            <div class="dashboard-pie-card">
              <div class="dashboard-pie-card-head">
                <strong>学员总数量</strong>
                <span>${escapeHtml(dashboard.student_pie?.dimension || "")}</span>
              </div>
              ${dashboardPieSvg(dashboard.student_pie || {}, { caption: "学员", emptyText: "暂无学员数据", ariaLabel: "学员总数量圆环图" })}
            </div>
            <div class="dashboard-pie-card">
              <div class="dashboard-pie-card-head">
                <strong>老师总数量</strong>
                <span>${escapeHtml(dashboard.teacher_pie?.dimension || "")}</span>
              </div>
              ${dashboardPieSvg(dashboard.teacher_pie || {}, { caption: "老师", emptyText: "暂无老师数据", ariaLabel: "老师总数量圆环图" })}
            </div>
          </div>
        </section>
      </div>
    </div>
    ${dashboardMetricModal()}
    ${dashboardShortcutModal()}
  `;
}

function applyReadonlyUi() {
  if (!isReadonlyUser()) return;
  const selectors = [
    ".new-month", ".delete-month", ".add-lesson", ".lesson-field", ".delete-lesson", ".batch-delete-lessons", ".batch-complete-lessons",
    ".batch-copy-lessons", ".week-copy-btn", ".schedule-add-btn", ".lesson-create-confirm", ".lesson-create-field",
    ".lesson-create-manual-field", ".lesson-create-student-existing", ".lesson-create-new-students",
    ".batch-copy-confirm", ".batch-copy-field", ".profile-field", ".delete-profile", ".profile-modal-save",
    ".create-user", ".new-user-field", ".user-field", ".user-reset-password", ".user-reset-password-value",
    ".user-access-open", ".user-access-save", ".import-teacher-users", ".sync-teacher-accounts", ".role-edit", ".role-delete", ".role-permission-save",
    ".base-data-add", ".base-data-delete", ".staff-field", ".delete-staff", ".staff-modal-save",
    ".delete-staff-salary", ".staff-salary-field", ".staff-attendance-field", ".delete-expense", ".expense-field",
    ".pricing-field", ".recharge-field", ".batch-delete-recharges", ".opening-balance-field", ".batch-delete-opening-balances", ".student-pricing-field",
    ".teacher-detail-salary-field", ".apply-selected-teacher-salary-rules", ".teacher-adjustment-field", ".teacher-travel-fee-field",
    ".batch-delete-teacher-profiles",
    ".course-notice-tail", ".notice-greeting", ".course-notice-clear-completions",
    ".teacher-course-notice-tail", ".teacher-notice-greeting", ".teacher-course-notice-clear-completions",
  ];
  document.querySelectorAll(selectors.join(",")).forEach((element) => {
    element.disabled = true;
    element.title = element.title || READONLY_WRITE_MESSAGE;
  });
}

function renderNoAccessibleViews() {
  closeOpenMultiSelectMenus();
  appEl?.classList.remove("login-mode");
  appEl?.classList.toggle("readonly-mode", isReadonlyUser());
  applySidebarState();
  navEl.innerHTML = "";
  topbarEl.innerHTML = `
    <div class="topbar-title-side">
      <button class="sidebar-toggle" type="button" aria-label="${sidebarCollapsed ? "展开侧栏" : "收起侧栏"}" title="${sidebarCollapsed ? "展开侧栏" : "收起侧栏"}" aria-pressed="${sidebarCollapsed ? "true" : "false"}">☰</button>
      <div class="title-block">
        <div class="page-title">暂无可访问页面</div>
        <div class="page-meta">${escapeHtml(auth.user?.role_label || auth.user?.role || "")}</div>
      </div>
    </div>
    <div class="toolbar">
      ${renderUserMenu()}
    </div>
    ${passwordModal()}
  `;
  contentEl.innerHTML = `
    <section class="band">
      <div class="empty">
        当前账号尚未配置可访问页面，请联系管理员。
      </div>
    </section>
  `;
  applyReadonlyUi();
  wireEvents();
}

function currentViewTitle() {
  const group = groupForView(view);
  return groupViews(group).find(([key]) => key === view)?.[1] || "页面加载失败";
}

function isPermissionError(error) {
  return Number(error?.status || 0) === 403 || String(error?.message || "").includes("无权访问");
}

function renderLoadFailure(error) {
  console.error("[load]", error);
  if (!auth.user) {
    renderLogin(error?.message || "加载失败");
    return;
  }
  if (!ensureAccessibleView()) return;
  closeOpenMultiSelectMenus();
  appEl?.classList.remove("login-mode");
  appEl?.classList.toggle("readonly-mode", isReadonlyUser());
  applySidebarState();
  renderNav();
  const permissionError = isPermissionError(error);
  renderTopbar(currentViewTitle(), permissionError ? "权限配置异常" : "加载失败");
  contentEl.innerHTML = `
    <section class="band">
      <div class="empty">
        ${escapeHtml(permissionError
          ? "当前页面的部分数据接口暂无访问权限，请联系管理员检查账号权限。"
          : (error?.message || "页面加载失败，请稍后重试。"))}
      </div>
    </section>
  `;
  applyReadonlyUi();
  wireEvents();
}

function render() {
  if (auth.user && !ensureAccessibleView()) return;
  closeOpenMultiSelectMenus();
  closeDateRangePicker();
  appEl?.classList.remove("login-mode");
  appEl?.classList.toggle("readonly-mode", isReadonlyUser());
  applySidebarState();
  const previousView = lastRenderedView;
  const viewChanged = previousView && previousView !== view;
  const enteringTeacherSalaryRules = view === "teacherSalaryRules" && previousView !== "teacherSalaryRules";
  if (enteringTeacherSalaryRules) resetTeacherSalaryRuleCandidateSync();
  applyUserFilterPreset(view);
  lastRenderedView = view;
  renderNav();
  const renderers = {
    dashboard: renderDashboard,
    lessons: renderLessons,
    week: renderWeek,
    weekMatrix: renderWeekMatrix,
    courseNotice: renderCourseNotice,
    teacherCourseNotice: renderTeacherCourseNotice,
    feeDetails: renderFeeDetails,
    summary: renderSummary,
    finance: renderFinance,
    recharges: renderRecharges,
    openingBalances: renderOpeningBalances,
    studentQuery: renderStudentQuery,
    appearance: renderAppearance,
    baseData: renderBaseData,
    audit: renderAudit,
    teacherProfiles: renderTeacherProfiles,
    studentProfiles: renderStudentProfiles,
    staffPayroll: renderStaffPayroll,
    staffAttendance: renderStaffAttendance,
    expenses: renderExpenses,
    pricing: renderPricing,
    userAdmin: renderUserAdmin,
    operationLogs: renderOperationLogs,
    studentPricing: renderStudentPricing,
    teacherSalary: renderTeacherSalary,
    teacherTravelFees: renderTeacherTravelFees,
    teacherDetail: renderTeacherDetail,
    teacherSalaryRules: renderTeacherSalaryRules,
  };
  (renderers[view] || renderLessons)();
  applyReadonlyUi();
  wireEvents();
  if (viewChanged) {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0 });
      document.querySelector(".main")?.scrollTo?.({ top: 0, left: 0 });
      contentEl.scrollTo?.({ top: 0, left: 0 });
    });
  }
}

function rerenderContent(renderAction) {
  closeOpenMultiSelectMenus();
  renderAction();
  applyReadonlyUi();
  wireEvents();
}

function upsertById(rows = [], row = {}) {
  if (row == null || row.id == null) return rows;
  const next = [...rows];
  const index = next.findIndex((item) => String(item.id) === String(row.id));
  if (index === -1) next.push(row);
  else next[index] = { ...next[index], ...row };
  return next;
}

function patchProfileState(kind, row) {
  if (!row || row.id == null) return;
  if (kind === "teachers") {
    state.profile_teachers = upsertById(state.profile_teachers || [], row).sort(compareTeacherProfile);
    markDirty("teacherSalary");
    return;
  }
  state.profile_students = upsertById(state.profile_students || [], row);
  for (const key of ["studentSummary", "summary", "finance"]) markDirty(key);
}

function patchUserState(row) {
  if (!row || row.id == null) return;
  state.users = upsertById(state.users || [], row).sort(compareUserRow);
  if (Number(row.id) === Number(auth.user?.id)) auth.user = { ...auth.user, ...row };
}

async function refreshStudentPricingModule() {
  const params = new URLSearchParams();
  if (activeMonth) params.set("month", activeMonth);
  if (includeInactive) params.set("include_inactive", "1");
  const query = params.toString() ? `?${params.toString()}` : "";
  const data = await request(`/api/bootstrap${query}`);
  state.student_pricing = data.student_pricing || [];
  for (const key of ["studentSummary", "summary", "finance"]) markDirty(key);
  rerenderContent(renderStudentPricing);
}

async function refreshAfter(action, after = () => load()) {
  try {
    const result = await action();
    if (result?.warnings?.length) {
      alert(result.warnings.map((warning) => warning.message || warning.type).join("\n"));
    }
    await after(result);
  } catch (error) {
    alert(error.message);
  }
}

function captureAttendanceScroll() {
  const wrap = document.querySelector(".attendance-wrap");
  return wrap ? { left: wrap.scrollLeft, top: wrap.scrollTop } : { left: 0, top: 0 };
}

function restoreAttendanceScroll(position) {
  requestAnimationFrame(() => {
    const wrap = document.querySelector(".attendance-wrap");
    if (!wrap) return;
    wrap.scrollLeft = position?.left || 0;
    wrap.scrollTop = position?.top || 0;
  });
}

async function loadWithAttendanceScroll() {
  const position = captureAttendanceScroll();
  await load();
  restoreAttendanceScroll(position);
}

function collectRowPayload(row, selector) {
  const payload = {};
  row.querySelectorAll(selector).forEach((input) => {
    payload[input.dataset.field] = input.type === "number" ? numberValue(input.value) : input.value;
  });
  return payload;
}

function collectTeacherTravelFeePayload(row) {
  const weeks = teacherTravelWeeks();
  const amountInputs = [...row.querySelectorAll(".teacher-travel-fee-field[data-week-index]")];
  return {
    teacher_name: row.dataset.teacherName || "",
    month_key: state.settings.month_key,
    notes: row.querySelector(".teacher-travel-fee-field[data-field='notes']")?.value || "",
    fees: weeks.map((week) => ({
      week_index: Number(week.week_index),
      week_start: week.start || week.week_start,
      week_end: week.end || week.week_end,
      amount: amountInputs.find((input) => Number(input.dataset.weekIndex) === Number(week.week_index))?.value || "",
    })),
  };
}

async function applyAttendanceBulk({ weekday = "all", status = "上班", mode = "blank", clear = false } = {}) {
  const monthKey = state.settings.month_key;
  const dates = attendanceDates(monthKey).filter((date) => {
    if (weekday === "all") return true;
    const day = parseDateValue(date.value)?.getDay();
    if (weekday === "weekend") return day === 0 || day === 6;
    return String(day) === String(weekday);
  });
  const staffRows = attendanceVisibleStaffRows();
  const existing = attendanceByStaffDate();
  if (!dates.length || !staffRows.length) return alert("当前筛选下没有可处理的考勤。");
  const existingTargets = [];
  const createTargets = [];
  for (const staff of staffRows) {
    for (const date of dates) {
      const key = `${staff.id}|${date.value}`;
      const current = existing.get(key);
      if (clear) {
        if (current) existingTargets.push({ staffId: staff.id, date: date.value });
      } else if (mode === "overwrite" || !current) {
        createTargets.push({ staffId: staff.id, date: date.value });
      }
    }
  }

  if (clear) {
    if (!existingTargets.length) return alert("当前筛选下没有可清空的考勤。");
    if (!confirm(`清空当前员工列表中 ${existingTargets.length} 条考勤记录？`)) return;
    try {
      await request("/api/staff-attendance-batch", {
        method: "POST",
        body: {
          items: existingTargets.map((item) => ({
            staff_id: Number(item.staffId),
            date: item.date,
            _delete: true,
          })),
        },
      });
      await loadWithAttendanceScroll();
    } catch (error) {
      alert(error.message);
    }
    return;
  }

  if (!createTargets.length) return alert("没有需要填充的空白考勤。");
  const modeLabel = mode === "overwrite" ? "覆盖" : "填充空白";
  if (!confirm(`${modeLabel} ${createTargets.length} 个考勤格为“${status}”？`)) return;
  try {
    await request("/api/staff-attendance-batch", {
      method: "POST",
      body: {
        items: createTargets.map((item) => ({
          staff_id: Number(item.staffId),
          attendance_date: item.date,
          status,
        })),
      },
    });
    await loadWithAttendanceScroll();
  } catch (error) {
    alert(error.message);
  }
}

function bindDateRangePickerControls() {
  document.querySelectorAll(".date-range-picker").forEach((picker) => {
    const trigger = picker.querySelector(".date-range-trigger");
    trigger?.addEventListener("click", (event) => {
      event.preventDefault();
      if (picker.classList.contains("disabled")) return;
      if (picker.classList.contains("open")) closeDateRangePicker();
      else openDateRangePicker(picker, event);
    });
    trigger?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDateRangePicker();
        trigger.blur();
      } else if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        event.preventDefault();
        openDateRangePicker(picker, event);
      }
    });
    picker.querySelector(".date-range-clear")?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await clearDateRangePickerValue(picker);
    });
  });

  if (!dateRangePickerEventsBound) {
    dateRangePickerEventsBound = true;
    document.addEventListener("click", (event) => {
      if (event.target.closest(".date-range-picker") || event.target.closest(".date-range-picker-panel")) return;
      closeDateRangePicker();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && activeDateRangePicker) {
        event.preventDefault();
        closeDateRangePicker();
      }
    });
    window.addEventListener("resize", positionDateRangePickerPanel);
    window.addEventListener("scroll", positionDateRangePickerPanel, true);
  }
}

function wireEvents() {
  document.querySelectorAll(".dashboard-open-metric-config").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardMetricDraft = dashboardSelectedMetricKeys();
      dashboardMetricModalOpen = true;
      render();
    });
  });
  document.querySelectorAll(".dashboard-metric-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardMetricModalOpen = false;
      dashboardMetricDraft = null;
      render();
    });
  });
  document.querySelectorAll(".dashboard-metric-add").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardMetricDraft = dashboardMetricDraft || dashboardSelectedMetricKeys();
      if (dashboardMetricDraft.length >= 5) return;
      if (!dashboardMetricDraft.includes(button.dataset.key)) dashboardMetricDraft.push(button.dataset.key);
      render();
    });
  });
  document.querySelectorAll(".dashboard-metric-remove").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardMetricDraft = (dashboardMetricDraft || dashboardSelectedMetricKeys()).filter((key) => key !== button.dataset.key);
      render();
    });
  });
  document.querySelectorAll(".dashboard-metric-save").forEach((button) => {
    button.addEventListener("click", () => {
      localStorage.setItem(DASHBOARD_METRICS_KEY, JSON.stringify(dashboardSelectedMetricKeys(dashboardMetricDraft || [])));
      dashboardMetricModalOpen = false;
      dashboardMetricDraft = null;
      render();
    });
  });
  document.querySelectorAll(".dashboard-open-shortcut-config").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardShortcutDraft = dashboardSelectedShortcutKeys();
      dashboardShortcutModalOpen = true;
      render();
    });
  });
  document.querySelectorAll(".dashboard-shortcut-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardShortcutModalOpen = false;
      dashboardShortcutDraft = null;
      render();
    });
  });
  document.querySelectorAll(".dashboard-feature-option").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardShortcutDraft = dashboardShortcutDraft || dashboardSelectedShortcutKeys();
      if (dashboardShortcutDraft.includes(button.dataset.key)) {
        dashboardShortcutDraft = dashboardShortcutDraft.filter((key) => key !== button.dataset.key);
      } else {
        dashboardShortcutDraft.push(button.dataset.key);
      }
      render();
    });
  });
  document.querySelectorAll(".dashboard-shortcut-remove").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardShortcutDraft = (dashboardShortcutDraft || dashboardSelectedShortcutKeys()).filter((key) => key !== button.dataset.key);
      render();
    });
  });
  document.querySelectorAll(".dashboard-shortcut-reset").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardShortcutDraft = dashboardDefaultShortcutKeys();
      render();
    });
  });
  document.querySelectorAll(".dashboard-shortcut-save").forEach((button) => {
    button.addEventListener("click", () => {
      localStorage.setItem(DASHBOARD_SHORTCUTS_KEY, JSON.stringify(dashboardShortcutDraft || dashboardDefaultShortcutKeys()));
      dashboardShortcutModalOpen = false;
      dashboardShortcutDraft = null;
      render();
    });
  });
  document.querySelectorAll(".dashboard-shortcut").forEach((button) => {
    button.addEventListener("click", () => {
      const item = dashboardShortcutCatalog().find((shortcut) => shortcut.key === button.dataset.key);
      if (!item) return;
      if (item.action === "newLesson") lessonCreateDraft = { date: todayDate() };
      dashboardGoTo(item.view);
    });
  });
  document.querySelectorAll(".dashboard-todo-item").forEach((button) => {
    button.addEventListener("click", () => {
      let filter = {};
      try {
        filter = JSON.parse(button.dataset.filter || "{}");
      } catch {
        filter = {};
      }
      dashboardGoTo(button.dataset.view || "dashboard", filter);
    });
  });
  document.querySelectorAll(".multi-select").forEach((select) => {
    const toggle = select.querySelector(".multi-select-toggle");
    const hidden = select.querySelector(".multi-select-value");
    const label = select.querySelector(".multi-select-label");
    const menu = select.querySelector(".multi-select-menu");
    const searchInput = select.querySelector(".multi-select-search");
    const selectedValues = () => normalizeNameList(hidden?.value || "");
    const syncSearch = () => {
      const keyword = String(searchInput?.value || "").trim().toLowerCase();
      menu?.querySelectorAll(".multi-select-option").forEach((option) => {
        const value = String(option.dataset.value || "").toLowerCase();
        option.hidden = Boolean(keyword) && !value.includes(keyword);
      });
    };
    const syncUi = () => {
      const selected = selectedValues();
      const selectedSet = new Set(selected);
      select.classList.toggle("has-value", selected.length > 0);
      if (label) label.textContent = selected.length ? selected.join("、") : (select.dataset.placeholder || "全部");
      menu?.querySelectorAll(".multi-select-option").forEach((option) => {
        const active = selectedSet.has(option.dataset.value || "");
        option.classList.toggle("selected", active);
        const check = option.querySelector(".multi-select-check");
        if (check) check.textContent = active ? "✓" : "";
      });
      syncSearch();
    };
    const commit = (values) => {
      if (!hidden) return;
      hidden.value = normalizeNameList(values).join("\n");
      syncUi();
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    };
    toggle?.addEventListener("click", (event) => {
      event.preventDefault();
      if (event.target.closest(".multi-select-clear-icon") && selectedValues().length) {
        closeMultiSelectMenu(select);
        if (searchInput) searchInput.value = "";
        commit([]);
        toggle.blur();
        return;
      }
      document.querySelectorAll(".multi-select.open").forEach((item) => {
        if (item !== select) closeMultiSelectMenu(item);
      });
      const isOpen = !select.classList.contains("open");
      if (!isOpen) closeMultiSelectMenu(select);
      else {
        select.classList.add("open");
        mountFloatingMultiSelectMenu(select);
      }
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      if (isOpen) {
        searchInput?.focus({ preventScroll: true });
        positionFloatingMultiSelectMenu(select);
        requestAnimationFrame(() => positionFloatingMultiSelectMenu(select));
      }
    });
    searchInput?.addEventListener("click", (event) => event.stopPropagation());
    searchInput?.addEventListener("input", syncSearch);
    searchInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        closeMultiSelectMenu(select);
        searchInput.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMultiSelectMenu(select);
        toggle?.blur();
      }
    });
    select.querySelector(".multi-select-clear")?.addEventListener("click", () => {
      closeMultiSelectMenu(select);
      if (searchInput) searchInput.value = "";
      commit([]);
    });
    menu?.querySelectorAll(".multi-select-option").forEach((option) => {
      option.addEventListener("click", () => {
        const value = option.dataset.value || "";
        const next = selectedValues();
        const index = next.indexOf(value);
        if (index >= 0) next.splice(index, 1);
        else next.push(value);
        commit(next);
      });
    });
    syncUi();
  });

  if (!multiSelectEventsBound) {
    multiSelectEventsBound = true;
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".multi-select") && !event.target.closest(".floating-multi-select-menu")) {
        closeOpenMultiSelectMenus();
      }
    });
    window.addEventListener("resize", positionOpenFloatingMultiSelectMenus);
    window.addEventListener("scroll", positionOpenFloatingMultiSelectMenus, true);
  }

  document.querySelectorAll(".filter-combo").forEach((combo) => {
    const input = combo.querySelector(".filter-combo-input");
    const menu = combo.querySelector(".filter-combo-menu");
    const clearButton = combo.querySelector(".filter-combo-clear");
    const toggleButton = combo.querySelector(".filter-combo-toggle");
    const close = () => {
      combo.classList.remove("open");
      toggleButton?.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      combo.classList.add("open");
      toggleButton?.setAttribute("aria-expanded", "true");
    };
    const optionsList = () => [...(menu?.querySelectorAll(".filter-combo-option") || [])].filter((option) => !option.hidden);
    const filterOptions = () => {
      const query = customSelectFilterText(input?.value || "");
      let visibleCount = 0;
      menu?.querySelectorAll(".filter-combo-option").forEach((option) => {
        const haystack = customSelectFilterText(`${option.textContent || ""} ${option.dataset.value || ""}`);
        const matched = !query || haystack.includes(query);
        option.hidden = !matched;
        if (matched) visibleCount += 1;
      });
      const empty = menu?.querySelector(".filter-combo-empty");
      if (empty) empty.hidden = visibleCount > 0;
      if (clearButton) clearButton.hidden = !(input?.value || "");
      combo.classList.toggle("has-value", Boolean(input?.value || ""));
    };
    toggleButton?.addEventListener("click", (event) => {
      event.preventDefault();
      document.querySelectorAll(".filter-combo.open").forEach((item) => {
        if (item !== combo) item.classList.remove("open");
      });
      const wasOpen = combo.classList.contains("open");
      if (wasOpen) close();
      else open();
      filterOptions();
      if (!wasOpen) input?.focus({ preventScroll: true });
      else input?.blur();
    });
    clearButton?.addEventListener("click", () => {
      input.value = "";
      filterOptions();
      close();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
    });
    menu?.querySelectorAll(".filter-combo-option").forEach((option) => {
      option.addEventListener("click", () => {
        input.value = option.dataset.value || "";
        filterOptions();
        close();
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.blur();
      });
    });
    input?.addEventListener("input", () => {
      filterOptions();
      open();
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        open();
        filterOptions();
        optionsList()[0]?.focus();
      }
      if (event.key === "Enter") {
        const first = optionsList()[0];
        if (combo.classList.contains("open") && first) {
          event.preventDefault();
          first.click();
        } else {
          event.preventDefault();
          close();
          input.dispatchEvent(new Event("change", { bubbles: true }));
          input.blur();
        }
      }
      if (event.key === "Escape") {
        close();
        input.blur();
      }
    });
    menu?.addEventListener("keydown", (event) => {
      const visibleOptions = optionsList();
      const index = visibleOptions.indexOf(document.activeElement);
      if (event.key === "Escape") {
        close();
        input?.focus();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        visibleOptions[Math.min(visibleOptions.length - 1, index + 1)]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (index <= 0) input?.focus({ preventScroll: true });
        else visibleOptions[Math.max(0, index - 1)]?.focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        document.activeElement?.click?.();
        input?.blur();
      }
    });
    filterOptions();
  });

  document.querySelectorAll(".text-filter").forEach((wrapper) => {
    const input = wrapper.querySelector(".text-filter-input");
    const clearButton = wrapper.querySelector(".text-filter-clear");
    const sync = () => {
      const hasValue = Boolean(input?.value || "");
      wrapper.classList.toggle("has-value", hasValue);
      if (clearButton) clearButton.hidden = !hasValue;
    };
    input?.addEventListener("input", sync);
    clearButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!input) return;
      input.value = "";
      sync();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
    });
    sync();
  });

  if (!filterComboEventsBound) {
    filterComboEventsBound = true;
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".filter-combo")) {
        document.querySelectorAll(".filter-combo.open").forEach((combo) => combo.classList.remove("open"));
      }
    });
  }

  bindDateRangePickerControls();

  if (!userMenuEventsBound) {
    userMenuEventsBound = true;
    document.addEventListener("click", (event) => {
      if (!userMenuOpen || event.target.closest(".user-menu")) return;
      userMenuOpen = false;
      document.querySelectorAll(".user-menu").forEach((menu) => {
        menu.classList.remove("open");
        menu.querySelector(".user-menu-trigger")?.setAttribute("aria-expanded", "false");
        menu.querySelector(".user-menu-dropdown")?.remove();
      });
    });
  }

  document.querySelectorAll(".user-menu-trigger").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      userMenuOpen = !userMenuOpen;
      render();
    });
  });

  document.querySelectorAll(".sidebar-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      sidebarCollapsed = !sidebarCollapsed;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
      render();
    });
  });

  document.querySelectorAll(".appearance-settings-link").forEach((button) => {
    button.addEventListener("click", () => {
      userMenuOpen = false;
      view = "appearance";
      activeNavGroup = "settings";
      localStorage.setItem("liming:view", view);
      localStorage.setItem("liming:nav-group", activeNavGroup);
      render();
    });
  });

  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const group = navGroups.find((item) => item.key === button.dataset.group);
      if (!group) return;
      const previousView = view;
      activeNavGroup = group.key;
      const allowedViews = groupViews(group).filter(([key]) => canView(key));
      if (!allowedViews.some(([key]) => key === view)) {
        view = allowedViews[0]?.[0] || firstAllowedView();
      }
      localStorage.setItem("liming:view", view);
      localStorage.setItem("liming:nav-group", activeNavGroup);
      if (view !== previousView) await load({ refreshGlobal: false });
      else render();
    });
  });

  document.querySelectorAll(".nav-sub-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextView = button.dataset.view;
      view = nextView;
      activeNavGroup = button.dataset.group || groupForView(view).key;
      localStorage.setItem("liming:view", view);
      localStorage.setItem("liming:nav-group", activeNavGroup);
      await load({ refreshGlobal: false });  // 进入页面时只加载当前页面需要的数据
    });
  });

  document.querySelectorAll(".month-select").forEach((select) => {
    select.addEventListener("change", async () => {
      activeMonth = select.value;
      localStorage.setItem("liming:month", activeMonth);
      resetFinanceRangeToActiveMonth();
      await load({ refreshGlobal: false });
    });
  });

  document.querySelectorAll(".new-month").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = prompt("输入月份，例如 2026-05 或 2026-05-01");
      const month = normalizeMonthInput(value);
      if (!month) {
        if (value !== null) alert("月份格式不正确");
        return;
      }
      let result;
      try {
        result = await request("/api/months", { method: "POST", body: { month_key: month } });
      } catch (error) {
        alert(error.message);
        return;
      }
      activeMonth = month;
      localStorage.setItem("liming:month", activeMonth);
      resetFinanceRangeToActiveMonth();
      if (result.created) {
        const from = result.from_month ? `从 ${monthOptionShort(result.from_month)} 结转` : "未找到上一个可结转月份，创建";
        alert(`${from} ${result.carried_students || 0} 位学生，实际余额合计 ${formatMoney(result.carried_actual || 0)}，赠送余额合计 ${formatMoney(result.carried_gift || 0)}`);
      } else if (result.already_exists) {
        alert("月份已存在，已切换到该月份。");
      }
      await load();
    });
  });

  document.querySelectorAll(".theme-select").forEach((select) => {
    select.addEventListener("change", () => {
      themeMode = select.value || "system";
      applyTheme();
      render();
    });
  });

  document.querySelectorAll(".palette-select").forEach((select) => {
    select.addEventListener("change", () => {
      paletteMode = select.value || "liming-blue";
      applyPalette();
      render();
    });
  });

  document.querySelectorAll(".base-data-add").forEach((button) => {
    button.addEventListener("click", async () => {
      const settingKey = button.dataset.settingKey;
      const def = baseDataDefinitions().find((item) => item.settingKey === settingKey);
      const input = document.querySelector(`.base-data-new-value[data-setting-key="${selectorEscape(settingKey)}"]`);
      const value = String(input?.value || "").trim();
      if (!def || !value) return alert("请先填写有效内容");
      if (def.values.some((item) => item === value)) return alert("该值已存在，不能重复新增");
      const nextValues = uniqueSorted([...settingsArray(settingKey), value]);
      try {
        await request("/api/settings", { method: "POST", body: { [settingKey]: JSON.stringify(nextValues) } });
        await load();
      } catch (error) {
        alert(error.message || "保存失败");
      }
    });
  });

  document.querySelectorAll(".base-data-new-value").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      document.querySelector(`.base-data-add[data-setting-key="${selectorEscape(input.dataset.settingKey)}"]`)?.click();
    });
  });

  document.querySelectorAll(".base-data-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      const settingKey = button.dataset.settingKey;
      const value = button.dataset.value;
      if (!settingKey || !value) return;
      if (!confirm(`从基础字典删除“${value}”？历史课程不会被修改。`)) return;
      const nextValues = settingsArray(settingKey).filter((item) => item !== value);
      try {
        await request("/api/settings", { method: "POST", body: { [settingKey]: JSON.stringify(nextValues) } });
        await load();
      } catch (error) {
        alert(error.message || "删除失败");
      }
    });
  });

  document.querySelectorAll(".ignore-room-one-conflict").forEach((input) => {
    input.addEventListener("change", async () => {
      ignoreRoomOneConflict = input.checked;
      localStorage.setItem(IGNORE_ROOM_ONE_CONFLICT_KEY, ignoreRoomOneConflict ? "1" : "0");
      if (view === "lessons" || view === "week" || view === "weekMatrix") render();
      else await load();
    });
  });

  document.querySelectorAll(".shot-follow-palette").forEach((input) => {
    input.addEventListener("change", () => {
      shotFollowPalette = input.checked;
      localStorage.setItem(SHOT_FOLLOW_PALETTE_KEY, shotFollowPalette ? "true" : "false");
      applyShotPalettePreference();
      render();
    });
  });

  document.querySelectorAll(".logout-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      userMenuOpen = false;
      await request("/api/auth/logout", { method: "POST" });
      auth.user = null;
      state = null;
      clearPagePositionCache();
      appliedUserFilterPresetViews = new Set();
      view = "dashboard";
      activeNavGroup = "";
      userAdminTab = "accounts";
      renderLogin();
    });
  });

  document.querySelectorAll(".open-password-modal").forEach((button) => {
    button.addEventListener("click", () => {
      userMenuOpen = false;
      passwordModalOpen = true;
      render();
    });
  });

  document.querySelectorAll(".password-modal-close").forEach((button) => {
    button.addEventListener("click", () => {
      passwordModalOpen = false;
      render();
    });
  });

  document.querySelectorAll(".password-submit").forEach((button) => {
    button.addEventListener("click", async () => {
      const current = document.querySelector(".password-current")?.value || "";
      const next = document.querySelector(".password-next")?.value || "";
      const confirm = document.querySelector(".password-confirm")?.value || "";
      if (next !== confirm) return alert("两次输入的新密码不一致");
      await request("/api/auth/change-password", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      passwordModalOpen = false;
      alert("密码已修改。");
      render();
    });
  });

  document.querySelectorAll(".delete-month").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!activeMonth) return;
      const { ok, status, data } = await requestWithStatus(`/api/months/${encodeURIComponent(activeMonth)}`, { method: "DELETE" });
      if (status === 409) {
        monthDeleteDraft = { monthKey: activeMonth, counts: data.counts || {} };
        render();
        return;
      }
      if (!ok) {
        alert(data.error || `删除失败：HTTP ${status}`);
        return;
      }
      activeMonth = data.next_month || "";
      if (activeMonth) localStorage.setItem("liming:month", activeMonth);
      if (activeMonth) resetFinanceRangeToActiveMonth();
      alert("月份已删除。");
      await load();
    });
  });

  document.querySelectorAll(".month-delete-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      monthDeleteDraft = null;
      render();
    });
  });

  document.querySelectorAll(".month-delete-confirm-input").forEach((input) => {
    input.addEventListener("input", () => {
      const confirmButton = document.querySelector(".month-delete-confirm");
      if (confirmButton) confirmButton.disabled = input.value.trim() !== input.dataset.monthKey;
    });
  });

  document.querySelectorAll(".month-delete-confirm").forEach((button) => {
    button.addEventListener("click", async () => {
      const monthKey = button.dataset.monthKey;
      const input = document.querySelector(".month-delete-confirm-input");
      if (!input || input.value.trim() !== monthKey) return;
      const { ok, status, data } = await requestWithStatus(`/api/months/${encodeURIComponent(monthKey)}?force=1`, { method: "DELETE" });
      if (!ok) {
        alert(data.error || `删除失败：HTTP ${status}`);
        return;
      }
      monthDeleteDraft = null;
      activeMonth = data.next_month || "";
      if (activeMonth) localStorage.setItem("liming:month", activeMonth);
      if (activeMonth) resetFinanceRangeToActiveMonth();
      alert(`已删除 ${formatMonthOption(monthKey)}。${data.backup ? `删除前备份：${data.backup}` : ""}`);
      await load();
    });
  });

  document.querySelectorAll(".history-toggle-input").forEach((input) => {
    input.addEventListener("change", async () => {
      includeInactive = input.checked;
      localStorage.setItem("liming:include-inactive", includeInactive ? "1" : "0");
      await load();
    });
  });

  document.querySelectorAll(".open-recharge-modal").forEach((button) => {
    button.addEventListener("click", () => {
      rechargeModalOpen = true;
      render();
    });
  });

  document.querySelectorAll(".recharge-modal-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      rechargeModalOpen = false;
      render();
    });
  });

  document.querySelectorAll(".recharge-modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target !== modal) return;
      rechargeModalOpen = false;
      render();
    });
  });

  document.querySelectorAll("#new-recharge-student").forEach((input) => {
    const fillGrade = () => {
      const gradeInput = document.querySelector("#new-recharge-grade");
      const profile = studentProfileByName(input.value.trim());
      if (gradeInput && profile?.grade) gradeInput.value = profile.grade;
    };
    input.addEventListener("change", fillGrade);
    input.addEventListener("blur", fillGrade);
  });

  document.querySelectorAll(".open-opening-balance-modal").forEach((button) => {
    button.addEventListener("click", () => {
      openingBalanceModalOpen = true;
      render();
    });
  });

  document.querySelectorAll(".download-opening-balance-template").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await downloadBlob("/api/opening-balances/template.xlsx", "期初余额导入模板.xlsx");
      } catch (error) {
        alert(`下载模板失败：${error.message}`);
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll(".export-opening-balance-excel").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await downloadBlob("/api/opening-balances/export.xlsx", "黎明教育_学生期初余额.xlsx");
      } catch (error) {
        alert(`导出期初余额失败：${error.message}`);
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll(".import-opening-balance-excel").forEach((button) => {
    button.addEventListener("click", async () => {
      const file = await chooseOpeningBalanceImportFile();
      if (!file) return;
      button.disabled = true;
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/opening-balances/import", {
          method: "POST",
          body: form,
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          auth.user = null;
          renderLogin(data.error || "请先登录");
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        await load();
        alert(openingBalanceImportResultMessage(data));
      } catch (error) {
        alert(`导入期初余额失败：${error.message}`);
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll(".opening-balance-modal-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      openingBalanceModalOpen = false;
      render();
    });
  });

  document.querySelectorAll(".opening-balance-modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target !== modal) return;
      openingBalanceModalOpen = false;
      render();
    });
  });

  document.querySelectorAll("#new-opening-student").forEach((input) => {
    const fillGrade = () => {
      const gradeInput = document.querySelector("#new-opening-grade");
      const profile = studentProfileByName(input.value.trim());
      if (gradeInput && profile?.grade) gradeInput.value = profile.grade;
    };
    input.addEventListener("change", fillGrade);
    input.addEventListener("blur", fillGrade);
  });

  document.querySelectorAll(".add-opening-balance").forEach((button) => {
    button.addEventListener("click", async () => {
      const studentName = document.querySelector("#new-opening-student")?.value.trim() || "";
      const grade = document.querySelector("#new-opening-grade")?.value.trim() || "";
      const actual = document.querySelector("#new-opening-actual")?.value || "0";
      const gift = document.querySelector("#new-opening-gift")?.value || "0";
      const notes = document.querySelector("#new-opening-notes")?.value || "";
      if (!studentName) return alert("请填写学生姓名");
      if (optionalNumberValue(actual) === null) return alert("请填写有效的期初实际余额");
      if (optionalNumberValue(gift) === null) return alert("请填写有效的期初赠送余额");
      if (numberValue(actual) === 0 && numberValue(gift) === 0) return alert("期初实际余额和期初赠送余额不能同时为 0");
      button.disabled = true;
      try {
        await request("/api/opening-balances", {
          method: "POST",
          body: {
            student_name: studentName,
            grade,
            opening_actual_balance: optionalNumberValue(actual) || 0,
            opening_gift_balance: optionalNumberValue(gift) || 0,
            notes,
          },
        });
        openingBalanceModalOpen = false;
        await load();
      } catch (error) {
        button.disabled = false;
        alert(`新增期初余额失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll(".add-recharge-record").forEach((button) => {
    button.addEventListener("click", async () => {
      const studentName = document.querySelector("#new-recharge-student")?.value.trim() || "";
      const grade = document.querySelector("#new-recharge-grade")?.value.trim() || "";
      const rechargeDate = document.querySelector("#new-recharge-date")?.value || "";
      const curRecharge = document.querySelector("#new-recharge-cur")?.value || "0";
      const curGift = document.querySelector("#new-recharge-gift")?.value || "0";
      const source = document.querySelector("#new-recharge-source")?.value || "";
      const notes = document.querySelector("#new-recharge-notes")?.value || "";
      if (!studentName) return alert("请填写学生姓名");
      if (optionalNumberValue(curRecharge) === null) return alert("请填写有效的现金充值");
      if (optionalNumberValue(curGift) === null) return alert("请填写有效的赠送充值");
      if (numberValue(curRecharge) === 0 && numberValue(curGift) === 0) return alert("实际充值和赠送充值不能同时为 0");
      button.disabled = true;
      try {
        await request("/api/recharges", {
          method: "POST",
          body: {
            student_name: studentName,
            grade,
            month_key: state.settings.month_key,
            cur_recharge: optionalNumberValue(curRecharge) || 0,
            cur_gift: optionalNumberValue(curGift) || 0,
            recharge_date: rechargeDate,
            source,
            notes,
          },
        });
        rechargeModalOpen = false;
        await load();
      } catch (error) {
        button.disabled = false;
        alert(`新增充值记录失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll(".recharge-source-filter").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      rechargeSourceFilter = canonicalFilterValue(rechargeSourceOptions, value) || "all";
      localStorage.setItem(RECHARGE_SOURCE_FILTER_KEY, rechargeSourceFilter);
    }, () => render());
  });

  document.querySelectorAll(".recharge-student-filter").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      rechargeStudentFilter = value;
    }, () => render());
  });

  document.querySelectorAll(".recharge-grade-filter").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      rechargeGradeFilter = value;
    }, () => render());
  });

  document.querySelectorAll(".reset-recharge-filter").forEach((button) => {
    button.addEventListener("click", () => {
      rechargeSourceFilter = "all";
      rechargeStudentFilter = "";
      rechargeGradeFilter = "";
      localStorage.setItem(RECHARGE_SOURCE_FILTER_KEY, rechargeSourceFilter);
      render();
    });
  });

  document.querySelectorAll(".recharge-select-row").forEach((input) => {
    input.addEventListener("change", () => {
      const id = Number(input.dataset.id);
      if (!id) return;
      if (input.checked) selectedRechargeIds.add(id);
      else selectedRechargeIds.delete(id);
      render();
    });
  });

  document.querySelectorAll(".recharge-select-all").forEach((input) => {
    input.addEventListener("change", () => {
      const rows = rechargeRows().filter((row) => rechargeMatchesFilter(row));
      if (input.checked) rows.forEach((row) => selectedRechargeIds.add(Number(row.id)));
      else rows.forEach((row) => selectedRechargeIds.delete(Number(row.id)));
      render();
    });
  });

  document.querySelectorAll(".batch-delete-recharges").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const ids = [...selectedRechargeIds].map(Number).filter(Boolean);
      if (!ids.length) return;
      if (!confirm(`确认删除已选中的 ${ids.length} 条充值记录？删除后费用汇总会按剩余充值重新计算。`)) return;
      if (!confirm("请再次确认：批量删除充值记录不可撤销，是否继续？")) return;
      button.disabled = true;
      try {
        const result = await request("/api/recharges/batch-delete", { method: "POST", body: { ids } });
        selectedRechargeIds.clear();
        await load({ refreshGlobal: false });
        showToast(`已删除 ${result.deleted || 0} 条充值记录`);
        if (result.missing?.length) alert(`已删除 ${result.deleted || 0} 条充值记录，另有 ${result.missing.length} 条未找到。`);
      } catch (error) {
        button.disabled = false;
        alert(`批量删除充值记录失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll(".opening-balance-filter").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      openingBalanceFilter = { ...openingBalanceFilter, [input.dataset.filterField || input.dataset.field]: value };
    }, () => render());
  });

  document.querySelectorAll(".reset-opening-balance-filter").forEach((button) => {
    button.addEventListener("click", () => {
      openingBalanceFilter = { student: "", grade: "" };
      render();
    });
  });

  document.querySelectorAll(".opening-balance-field").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest(".opening-balance-row");
      const payload = collectRowPayload(row, ".opening-balance-field");
      if (numberValue(payload.opening_actual_balance) === 0 && numberValue(payload.opening_gift_balance) === 0
        && !confirm("期初实际余额和期初赠送余额都为 0，这将删除该期初余额。是否继续？")) {
        load();
        return;
      }
      refreshAfter(() => request(`/api/opening-balances/${encodeURIComponent(row.dataset.id)}`, {
        method: "PUT",
        body: {
          student_name: row.dataset.studentName,
          grade: row.dataset.grade || "",
          ...payload,
        },
      }));
    });
  });

  document.querySelectorAll(".delete-opening-balance").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest(".opening-balance-row");
      if (!confirm(`删除 ${row.dataset.studentName} 的期初余额？`)) return;
      refreshAfter(() => request(`/api/opening-balances/${encodeURIComponent(row.dataset.id)}`, { method: "DELETE" }));
    });
  });

  document.querySelectorAll(".opening-balance-select-row").forEach((input) => {
    input.addEventListener("change", () => {
      const id = Number(input.dataset.id);
      if (!id) return;
      if (input.checked) selectedOpeningBalanceIds.add(id);
      else selectedOpeningBalanceIds.delete(id);
      render();
    });
  });

  document.querySelectorAll(".opening-balance-select-all").forEach((input) => {
    input.addEventListener("change", () => {
      const rows = openingBalanceRows().filter((row) => openingBalanceMatchesFilter(row));
      if (input.checked) rows.forEach((row) => selectedOpeningBalanceIds.add(Number(row.id)));
      else rows.forEach((row) => selectedOpeningBalanceIds.delete(Number(row.id)));
      render();
    });
  });

  document.querySelectorAll(".batch-delete-opening-balances").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const ids = [...selectedOpeningBalanceIds].map(Number).filter(Boolean);
      if (!ids.length) return;
      if (!confirm(`确认删除已选中的 ${ids.length} 条期初余额记录？删除后期初/期末余额会重新计算。`)) return;
      if (!confirm("请再次确认：批量删除期初余额记录不可撤销，是否继续？")) return;
      button.disabled = true;
      try {
        const result = await request("/api/opening-balances/batch-delete", { method: "POST", body: { ids } });
        selectedOpeningBalanceIds.clear();
        await load({ refreshGlobal: false });
        showToast(`已删除 ${result.deleted || 0} 条期初余额记录`);
        if (result.missing?.length) alert(`已删除 ${result.deleted || 0} 条期初余额记录，另有 ${result.missing.length} 条未找到。`);
      } catch (error) {
        button.disabled = false;
        alert(`批量删除期初余额失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll(".profile-search").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      profileSearch = value;
    }, () => render());
  });

  document.querySelectorAll(".profile-status-filter").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      profileStatusFilter = { ...profileStatusFilter, [profileTab]: value };
      localStorage.setItem("liming:profile-status-filter", JSON.stringify(profileStatusFilter));
    }, () => render());
  });

  document.querySelectorAll(".backfill-profile-joined-at").forEach((button) => {
    button.addEventListener("click", async () => {
      const kind = button.dataset.kind || profileTab;
      const isTeacher = kind === "teachers";
      const label = isTeacher ? "入职日期" : "入学日期";
      const peopleLabel = isTeacher ? "老师" : "学生";
      if (!confirm(`将只为${label}为空且能找到第一节课日期的${peopleLabel}补齐${label}，不会覆盖已有${label}。是否继续？`)) return;
      button.disabled = true;
      try {
        const endpoint = isTeacher ? "/api/teachers/backfill-joined-at" : "/api/students/backfill-joined-at";
        const result = await request(endpoint, { method: "POST" });
        await load();
        alert(`已补齐 ${result.updated || 0} 条${label}。${result.skipped_without_lessons ? `无课程保持空 ${result.skipped_without_lessons} 条。` : ""}`);
      } catch (error) {
        button.disabled = false;
        alert(`补齐${label}失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll(".new-profile").forEach((button) => {
    button.addEventListener("click", () => {
      profileModal = { kind: button.dataset.kind || profileTab };
      render();
    });
  });

  document.querySelectorAll(".bulk-promote-students").forEach((button) => {
    button.addEventListener("click", async () => {
      const plan = studentPromotionPlan();
      if (!plan.length) return alert("没有可升年级的学生。已毕业学生会自动排除。");
      if (!confirm(`将按规则批量升年级，共 ${plan.length} 名学生。已毕业学生不会处理。是否继续？`)) return;
      const preview = studentPromotionPreview(plan);
      if (!confirm(`请确认升年级预览：\n\n${preview}\n\n继续执行？`)) return;
      const finalText = prompt("此操作会修改学生档案年级。请输入“确认升年级”继续：");
      if (finalText !== "确认升年级") return;
      button.disabled = true;
      const failures = [];
      try {
        for (const item of plan) {
          try {
            await request(`/api/students/${item.id}`, {
              method: "PATCH",
              body: { grade: item.toGrade, status: item.status },
            });
          } catch (error) {
            failures.push(`${item.name}：${error.message || "更新失败"}`);
          }
        }
        await load();
        if (failures.length) alert(`已处理，失败 ${failures.length} 条：\n${failures.join("\n")}`);
        else alert(`批量升年级完成，共处理 ${plan.length} 名学生。`);
      } catch (error) {
        button.disabled = false;
        alert(`批量升年级失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll(".profile-modal-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      profileModal = null;
      render();
    });
  });

  document.querySelectorAll(".profile-modal-submit").forEach((button) => {
    button.addEventListener("click", async () => {
      const modal = button.closest(".modal-panel");
      const kind = button.dataset.kind;
      const payload = {};
      modal.querySelectorAll(".profile-modal-field").forEach((input) => {
        payload[input.dataset.field] = input.value;
      });
      if (!String(payload.name || "").trim()) return alert("姓名必填");
      try {
        const result = await request(`/api/${kind}`, { method: "POST", body: payload });
        if (result?.warnings?.length) alert(result.warnings.map((warning) => warning.message || warning.type).join("\n"));
        profileModal = null;
        patchProfileState(kind, result);
        rerenderContent(() => renderProfileDirectory(kind));
      } catch (error) {
        alert(error.message);
      }
    });
  });

  document.querySelectorAll(".profile-field").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest(".profile-row");
      const kind = row.dataset.kind;
      const payload = { [input.dataset.field]: input.value };
      refreshAfter(() => request(`/api/${kind}/${row.dataset.id}`, {
        method: "PATCH",
        body: payload,
      }), (result) => {
        patchProfileState(kind, result);
        rerenderContent(() => renderProfileDirectory(kind));
      });
    });
  });

  document.querySelectorAll(".delete-profile").forEach((button) => {
    button.addEventListener("click", () => {
      const label = button.dataset.kind === "students" ? "学生" : "老师";
      if (!confirm(`删除${label}档案：${button.dataset.name}？已有历史记录时会改为离职/离校并保留档案。`)) return;
      refreshAfter(async () => {
        const result = await request(`/api/${button.dataset.kind}/${button.dataset.id}`, { method: "DELETE" });
        if (result.soft_deleted) alert("存在历史记录，已改为离职/离校并保留档案。");
        return result;
      });
    });
  });

  document.querySelectorAll(".teacher-profile-select-row").forEach((input) => {
    input.addEventListener("change", () => {
      const id = Number(input.dataset.id);
      if (!id) return;
      if (input.checked) selectedTeacherProfileIds.add(id);
      else selectedTeacherProfileIds.delete(id);
      render();
    });
  });

  document.querySelectorAll(".teacher-profile-select-all").forEach((input) => {
    input.addEventListener("change", () => {
      const rows = profileRows("teachers");
      if (input.checked) rows.forEach((row) => selectedTeacherProfileIds.add(Number(row.id)));
      else rows.forEach((row) => selectedTeacherProfileIds.delete(Number(row.id)));
      render();
    });
  });

  document.querySelectorAll(".batch-delete-teacher-profiles").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const ids = [...selectedTeacherProfileIds].map(Number).filter(Boolean);
      if (!ids.length) return;
      if (!confirm(`确认删除已选中的 ${ids.length} 条教师档案记录？有历史课程的老师会改为离职并保留档案。`)) return;
      if (!confirm("请再次确认：批量删除教师档案不可撤销，是否继续？")) return;
      button.disabled = true;
      try {
        const result = await request("/api/teachers/batch-delete", { method: "POST", body: { ids } });
        selectedTeacherProfileIds.clear();
        await load({ refreshGlobal: false });
        const message = `已删除 ${result.deleted || 0} 条教师档案，改为离职 ${result.soft_deleted || 0} 条。`;
        showToast(message);
        if (result.missing?.length) alert(`${message}\n另有 ${result.missing.length} 条未找到。`);
      } catch (error) {
        button.disabled = false;
        alert(`批量删除教师档案失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll(".staff-status-filter").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      staffStatusFilter = value;
      localStorage.setItem("liming:staff-status-filter", staffStatusFilter);
    }, () => render());
  });

  document.querySelectorAll(".staff-profile-search").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      staffProfileSearch = value;
    }, () => render());
  });

  document.querySelectorAll(".attendance-select").forEach((select) => {
    select.addEventListener("change", async () => {
      const status = select.value;
      try {
        if (!status) {
          await request(`/api/staff-attendance?staff_id=${encodeURIComponent(select.dataset.staffId)}&date=${encodeURIComponent(select.dataset.date)}`, { method: "DELETE" });
        } else {
          const needsReason = ["请假", "病假", "事假", "旷工", "调休"].includes(status);
          const reason = needsReason ? prompt(`${select.dataset.date} ${status}原因`, "") || "" : "";
          await request("/api/staff-attendance", {
            method: "POST",
            body: {
              staff_id: Number(select.dataset.staffId),
              attendance_date: select.dataset.date,
              status,
              reason,
            },
          });
        }
        await loadWithAttendanceScroll();
      } catch (error) {
        alert(error.message);
      }
    });
  });

  document.querySelectorAll(".attendance-bulk-apply").forEach((button) => {
    button.addEventListener("click", async () => {
      const panel = button.closest(".attendance-panel");
      const weekday = panel.querySelector(".attendance-bulk-weekday")?.value || "all";
      const status = panel.querySelector(".attendance-bulk-status")?.value || "上班";
      const mode = panel.querySelector(".attendance-bulk-mode")?.value || "blank";
      await applyAttendanceBulk({ weekday, status, mode });
    });
  });

  document.querySelectorAll(".attendance-bulk-one").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      if (action === "fill-all-work") {
        await applyAttendanceBulk({ weekday: "all", status: "上班", mode: "overwrite" });
      } else if (action === "fill-weekend-work") {
        await applyAttendanceBulk({ weekday: "weekend", status: "上班", mode: "blank" });
      } else if (action === "clear-visible") {
        await applyAttendanceBulk({ clear: true });
      }
    });
  });

  document.querySelectorAll(".new-staff").forEach((button) => {
    button.addEventListener("click", () => {
      staffModal = {};
      render();
    });
  });

  document.querySelectorAll(".staff-modal-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      staffModal = null;
      render();
    });
  });

  document.querySelectorAll(".staff-modal-submit").forEach((button) => {
    button.addEventListener("click", async () => {
      const payload = {};
      document.querySelectorAll(".staff-modal-field").forEach((input) => {
        payload[input.dataset.field] = input.type === "number" ? numberValue(input.value) : input.value;
      });
      if (!String(payload.name || "").trim()) return alert("姓名必填");
      try {
        await request("/api/staff", { method: "POST", body: payload });
        staffModal = null;
        await load();
      } catch (error) {
        alert(error.message);
      }
    });
  });

  document.querySelectorAll(".staff-field").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest(".staff-row");
      const value = input.type === "number" ? numberValue(input.value) : input.value;
      refreshAfter(() => request(`/api/staff/${row.dataset.id}`, {
        method: "PATCH",
        body: { [input.dataset.field]: value },
      }));
    });
  });

  document.querySelectorAll(".delete-staff").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm(`删除员工档案：${button.dataset.name}？已有非零薪资记录时会改为离职。`)) return;
      refreshAfter(async () => {
        const result = await request(`/api/staff/${button.dataset.id}`, { method: "DELETE" });
        if (result.soft_deleted) alert("存在非零薪资记录，已改为离职并保留档案。");
        return result;
      });
    });
  });

  document.querySelectorAll(".staff-payroll-search").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      staffPayrollSearch = value;
    }, () => render());
  });

  document.querySelectorAll(".staff-salary-field").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest(".staff-salary-row");
      const payload = collectRowPayload(row, ".staff-salary-field");
      refreshAfter(() => request("/api/staff-salary", {
        method: "POST",
        body: {
          staff_id: Number(row.dataset.staffId),
          month_key: state.settings.month_key,
          ...payload,
        },
      }));
    });
  });

  document.querySelectorAll(".delete-staff-salary").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm(`删除 ${button.dataset.name} 本月薪资记录？`)) return;
      refreshAfter(() => request(`/api/staff-salary/${button.dataset.id}`, { method: "DELETE" }));
    });
  });

  document.querySelectorAll(".expense-filter-input").forEach((input) => {
    const applyExpenseFilter = (value) => {
      expenseFilter = { ...expenseFilter, [input.dataset.field]: value };
      localStorage.setItem("liming:expense-filter", JSON.stringify(expenseFilter));
    };
    if (input.tagName === "SELECT" || input.type === "date") {
      input.addEventListener("change", async () => {
        applyExpenseFilter(input.value);
        await load();
      });
      return;
    }
    bindSafeTextInput(input, (value) => {
      applyExpenseFilter(value);
    }, () => load(), 500);
  });

  document.querySelectorAll(".new-expense").forEach((button) => {
    button.addEventListener("click", () => {
      expenseModal = {};
      render();
    });
  });

  document.querySelectorAll(".expense-modal-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      expenseModal = null;
      render();
    });
  });

  document.querySelectorAll(".expense-modal-submit").forEach((button) => {
    button.addEventListener("click", async () => {
      const payload = {};
      document.querySelectorAll(".expense-modal-field").forEach((input) => {
        payload[input.dataset.field] = input.type === "number" ? numberValue(input.value) : input.value;
      });
      if (!numberValue(payload.amount) || numberValue(payload.amount) <= 0) return alert("金额必须大于 0");
      try {
        await request("/api/operating-expenses", { method: "POST", body: payload });
        expenseModal = null;
        await load();
      } catch (error) {
        alert(error.message);
      }
    });
  });

  document.querySelectorAll(".expense-field").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest(".expense-row");
      const value = input.type === "number" ? numberValue(input.value) : input.value;
      refreshAfter(() => request(`/api/operating-expenses/${row.dataset.id}`, {
        method: "PATCH",
        body: { [input.dataset.field]: value },
      }));
    });
  });

  document.querySelectorAll(".delete-expense").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm("删除这笔日常开销？")) return;
      refreshAfter(() => request(`/api/operating-expenses/${button.dataset.id}`, { method: "DELETE" }));
    });
  });

  document.querySelectorAll(".audit-run-xlsx").forEach((button) => {
    button.addEventListener("click", async () => {
      const file = document.querySelector(".audit-file")?.files?.[0];
      if (!file) return alert("请先选择 xlsx 文件");
      auditState.busy = true;
      render();
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/audit/xlsx-diff?month=${encodeURIComponent(state.settings.month_key)}`, {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        auditState.xlsxReport = data;
        await refreshAuditLogs();
      } catch (error) {
        alert(error.message);
      } finally {
        auditState.busy = false;
        render();
      }
    });
  });

  document.querySelectorAll(".audit-source-workbook").forEach((select) => {
    select.addEventListener("change", () => {
      auditSourceWorkbook = select.value;
      localStorage.setItem("liming:audit-source-workbook", auditSourceWorkbook);
    });
  });

  document.querySelectorAll(".audit-import-source").forEach((button) => {
    button.addEventListener("click", async () => {
      const filename = document.querySelector(".audit-source-workbook")?.value || auditSourceWorkbook;
      if (!filename) return alert("请选择 source-workbooks 里的 xlsx 文件");
      const workbook = (state.source_workbooks || []).find((item) => item.filename === filename) || {};
      const monthKey = workbook.month_key || state.settings.month_key;
      if (!confirm(`导入 ${filename} 到 ${monthKey.slice(0, 7)}？系统会先备份数据库。`)) return;
      auditState.busy = true;
      auditState.notice = "";
      render();
      try {
        const result = await request("/api/import/source-workbook", {
          method: "POST",
          body: { filename, month_key: monthKey },
        });
        activeMonth = result.month_key || monthKey;
        localStorage.setItem("liming:month", activeMonth);
        auditState.xlsxReport = result.audit || null;
        auditState.notice = `已导入 ${filename}：课程 ${result.lessons || 0} 条，充值 ${result.recharges || 0} 条，学生单价 ${result.student_prices || 0} 条，费用标准 ${result.pricing_standards || 0} 条，教师交通费 ${result.teacher_adjustments || 0} 条。`;
        await refreshAuditLogs();
        await load();
      } catch (error) {
        alert(error.message);
      } finally {
        auditState.busy = false;
        render();
      }
    });
  });

  document.querySelectorAll(".export-core-workbook").forEach((button) => {
    button.addEventListener("click", async () => {
      const monthKey = state.settings.month_key;
      auditState.busy = true;
      render();
      try {
        await downloadBlob(
          `/api/export/core-workbook.xlsx?month=${encodeURIComponent(monthKey)}`,
          `黎明教育_${monthLabel()}_核心数据.xlsx`,
        );
      } catch (error) {
        alert(error.message || "导出核心 Excel 失败");
      } finally {
        auditState.busy = false;
        render();
      }
    });
  });

  document.querySelectorAll(".audit-run-internal").forEach((button) => {
    button.addEventListener("click", async () => {
      auditState.busy = true;
      render();
      try {
        auditState.internalReport = await request(`/api/audit/internal-checks?month=${encodeURIComponent(state.settings.month_key)}`);
        await refreshAuditLogs();
      } catch (error) {
        alert(error.message);
      } finally {
        auditState.busy = false;
        render();
      }
    });
  });

  document.querySelectorAll(".audit-refresh-logs").forEach((button) => {
    button.addEventListener("click", async () => {
      await refreshAuditLogs();
      await refreshAuditEvents();
      render();
    });
  });

  document.querySelectorAll(".audit-clean-internal-only").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await handleInternalOnlyCleanup();
      } catch (error) {
        alert(error.message || "处理系统多余课程失败");
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll(".audit-apply-one").forEach((button) => {
    button.addEventListener("click", async () => {
      const issue = auditIssueByLogId(button.dataset.source, button.dataset.logId);
      if (!issue) return;
      await applyAuditIssue(issue);
    });
  });

  document.querySelectorAll(".audit-ignore-one").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!button.dataset.logId) return;
      const sourceKey = button.dataset.source;
      const logId = button.dataset.logId;
      const issueKey = button.dataset.issueKey || "";
      const scrollTop = window.scrollY;
      button.disabled = true;
      button.textContent = "忽略中";
      try {
        const result = await request("/api/audit/ignore", {
          method: "POST",
          body: {
            ids: [Number(logId)],
            issue_keys: issueKey ? [issueKey] : [],
          },
        });
        removeAuditIssueByIdentity(sourceKey, logId, issueKey);
        await refreshAuditLogs();
        auditState.notice = `已忽略 ${result.ignored_keys || result.ignored} 类问题，之后相同问题不会再提示。`;
        render();
        requestAnimationFrame(() => window.scrollTo(0, scrollTop));
      } catch (error) {
        button.disabled = false;
        button.textContent = "忽略此项";
        alert(error.message);
      }
    });
  });

  document.querySelectorAll(".audit-fix-critical").forEach((button) => {
    button.addEventListener("click", async () => {
      const issues = (auditState.xlsxReport?.issues || []).filter((issue) => issue.severity === "CRITICAL" && hasApplicablePatch(issue));
      if (!issues.length) return;
      if (!confirm(`确认以 xlsx 为准修复 ${issues.length} 条 CRITICAL？此操作会先备份数据库。`)) return;
      const result = await request("/api/audit/apply", { method: "POST", body: { issues, confirm_critical: true } });
      await refreshAuditLogs();
      alert(`修复完成：${result.fixed} 条，跳过 ${result.skipped} 条。已备份：${result.backup}`);
      await load();
    });
  });

  document.querySelectorAll(".user-admin-tab").forEach((button) => {
    button.addEventListener("click", () => {
      userAdminTab = button.dataset.tab || "accounts";
      localStorage.setItem("liming:user-admin-tab", userAdminTab);
      render();
    });
  });

  document.querySelectorAll(".role-create-open").forEach((button) => {
    button.addEventListener("click", () => {
      roleCreateDraft = { code: "", name: "", description: "" };
      render();
    });
  });
  document.querySelectorAll(".role-create-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      roleCreateDraft = null;
      render();
    });
  });
  document.querySelectorAll(".role-create-submit").forEach((button) => {
    button.addEventListener("click", async () => {
      const payload = {};
      document.querySelectorAll(".role-create-field").forEach((input) => {
        payload[input.dataset.field] = input.value;
      });
      payload.permissions = ["dashboard"];
      try {
        const result = await request("/api/roles", { method: "POST", body: payload });
        roleCreateDraft = null;
        userAdminNotice = `已新增角色 ${result.name}`;
        await load();
      } catch (error) {
        alert(error.message);
      }
    });
  });
  document.querySelectorAll(".role-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const role = (state.roles || []).find((item) => item.code === button.dataset.code);
      if (!role) return;
      rolePermissionModal = JSON.parse(JSON.stringify({ ...role, permissions: [...(role.permissions || [])] }));
      render();
    });
  });
  document.querySelectorAll(".role-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      const role = (state.roles || []).find((item) => item.code === button.dataset.code);
      if (!role || !confirm(`删除角色：${role.name}？`)) return;
      try {
        await request(`/api/roles/${encodeURIComponent(role.code)}`, { method: "DELETE" });
        userAdminNotice = `已删除角色 ${role.name}`;
        await load();
      } catch (error) {
        alert(error.message);
      }
    });
  });
  document.querySelectorAll(".role-permission-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      rolePermissionModal = null;
      render();
    });
  });
  document.querySelectorAll(".role-modal-tab").forEach((button) => {
    button.addEventListener("click", () => {
      const panelKey = button.dataset.panel;
      document.querySelectorAll(".role-modal-tab").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll(".role-modal-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === panelKey));
    });
  });
  document.querySelectorAll(".role-preset-date-rule").forEach((select) => {
    select.addEventListener("change", () => {
      const fixedInput = select.closest(".role-preset-date-wrap")?.querySelector(".role-preset-fixed-date");
      if (fixedInput) fixedInput.hidden = select.value !== "fixed";
    });
  });
  document.querySelectorAll(".role-preset-teacher-mode").forEach((select) => {
    select.addEventListener("change", () => {
      const teacherPicker = select.closest(".role-preset-field-wrap")?.querySelector(".role-preset-teachers-wrap");
      if (teacherPicker) teacherPicker.hidden = select.value !== "specific";
    });
  });
  document.querySelectorAll(".permission-parent").forEach((input) => {
    input.addEventListener("change", () => {
      const children = String(input.dataset.children || "").split(",").filter(Boolean);
      children.forEach((key) => {
        const child = document.querySelector(`.permission-child[value="${selectorEscape(key)}"]`);
        if (child) child.checked = input.checked;
      });
      updatePermissionParentStates();
    });
  });
  document.querySelectorAll(".permission-child").forEach((input) => {
    input.addEventListener("change", updatePermissionParentStates);
  });
  document.querySelectorAll(".role-permission-save").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!rolePermissionModal) return;
      const payload = {
        permissions: collectRoleModalPermissions(),
        filter_presets: collectRoleFilterPresets(),
      };
      document.querySelectorAll(".role-modal-field").forEach((input) => {
        payload[input.dataset.field] = input.value;
      });
      payload.readonly = document.querySelector(".role-readonly-field")?.checked ? 1 : 0;
      try {
        const result = await request(`/api/roles/${encodeURIComponent(rolePermissionModal.code)}`, { method: "PATCH", body: payload });
        rolePermissionModal = null;
        userAdminNotice = `已保存角色 ${result.name} 的权限和预筛选`;
        await load();
      } catch (error) {
        alert(error.message);
      }
    });
  });

  document.querySelectorAll(".download-user-import-template").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await downloadBlob("/api/users/import-template.xlsx", "黎明教育_账号导入模板.xlsx");
      } catch (error) {
        alert(error.message || "下载模板失败");
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll(".import-teacher-users").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("从 data/templates/teacher_template.xlsx 创建或更新账号？新版模板使用“初始密码”列；旧老师模板默认密码为手机号后 6 位。")) return;
      const result = await request("/api/users/import-teachers-template", { method: "POST", body: {} });
      userAdminNotice = `已处理 ${result.total || 0} 行：新增 ${result.created || 0} 个账号，更新 ${result.updated || 0} 个账号。备份：${result.backup || "已生成"}`;
      await load();
    });
  });

  document.querySelectorAll(".sync-teacher-accounts").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("将根据教师档案中的手机号自动创建老师账号，初始密码为手机号后6位。相同手机号只创建一个账号。")) return;
      const result = await request("/api/users/sync-teacher-accounts", { method: "POST", body: {} });
      userAdminNotice = `已同步老师账号：新增 ${result.created || 0} 个，已有 ${result.existing || 0} 个，跳过 ${result.skipped || 0} 个，重复手机号合并 ${result.duplicate_merged || 0} 个。`;
      if (result.conflicts) userAdminNotice += ` ${result.conflicts} 个手机号已被非老师账号占用。`;
      await load();
    });
  });

  document.querySelectorAll(".create-user").forEach((button) => {
    button.addEventListener("click", async () => {
      const payload = {};
      document.querySelectorAll(".new-user-field").forEach((input) => {
        if (!input.dataset.field) return;
        payload[input.dataset.field] = input.value;
      });
      payload.teacher_names = normalizeNameList(document.querySelector(".multi-select-value.new-user-teachers")?.value || "");
      if (!payload.username || !payload.password) return alert("请填写账号和初始密码");
      await request("/api/users", { method: "POST", body: payload });
      userAdminNotice = `已新增账号 ${payload.username}`;
      await load();
    });
  });

  document.querySelectorAll(".user-field").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest(".user-row");
      refreshAfter(() => request(`/api/users/${row.dataset.id}`, {
        method: "PATCH",
        body: { [input.dataset.field]: input.value },
      }), async (result) => {
        patchUserState(result);
        if (Number(result.id) === Number(auth.user?.id)) await load();
        else rerenderContent(renderUserAdmin);
      });
    });
  });

  document.querySelectorAll(".multi-select-value.user-row-teachers").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest(".user-row");
      const teacherNames = normalizeNameList(input.value || "");
      refreshAfter(() => request(`/api/users/${row.dataset.id}`, {
        method: "PATCH",
        body: { teacher_names: teacherNames },
      }), async (result) => {
        patchUserState(result);
        if (Number(result.id) === Number(auth.user?.id)) await load();
        else rerenderContent(renderUserAdmin);
      });
    });
  });

  document.querySelectorAll(".user-access-open").forEach((button) => {
    button.addEventListener("click", () => {
      const user = (state.users || []).find((item) => String(item.id) === String(button.dataset.id));
      if (!user) return;
      userAccessModal = JSON.parse(JSON.stringify(user));
      render();
    });
  });

  document.querySelectorAll(".user-access-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      userAccessModal = null;
      render();
    });
  });

  document.querySelectorAll(".user-access-save").forEach((button) => {
    button.addEventListener("click", async () => {
      const payload = collectUserAccessPayload();
      const result = await request(`/api/users/${button.dataset.id}/access`, { method: "PATCH", body: payload });
      userAccessModal = null;
      userAdminNotice = "账号权限配置已保存。";
      patchUserState(result);
      if (Number(result.id) === Number(auth.user?.id)) await load();
      else rerenderContent(renderUserAdmin);
    });
  });

  document.querySelectorAll(".user-reset-password").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest(".user-row");
      const password = row.querySelector(".user-reset-password-value")?.value || "";
      if (password.length < 6) return alert("新密码至少 6 位");
      await request(`/api/users/${row.dataset.id}/password`, { method: "POST", body: { password } });
      userAdminNotice = "密码已重置。";
      rerenderContent(renderUserAdmin);
    });
  });
  document.querySelectorAll(".user-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      const username = button.dataset.username || "";
      if (!confirm(`确定删除账号 ${username} 吗？删除后该账号将无法登录，但不会删除教师档案和课程数据。`)) return;
      try {
        await request(`/api/users/${button.dataset.id}`, { method: "DELETE" });
        userAdminNotice = `已删除账号 ${username}`;
        await load();
      } catch (error) {
        alert(error.message);
      }
    });
  });

  document.querySelectorAll(".lesson-filter-multi").forEach((input) => {
    input.addEventListener("change", () => {
      const field = input.dataset.filterField;
      if (field !== "teacher_names") return;
      focusedLessonIds = [];
      const teacherNames = normalizeNameList(input.value || "");
      lessonFilter = {
        ...lessonFilter,
        month_key: state.settings.month_key,
        teacher: teacherNames.join("、"),
        teacher_names: teacherNames,
        date_preset_initialized: true,
      };
      saveLessonFilter();
      render();
    });
  });

  document.querySelectorAll(".lesson-filter-input").forEach((input) => {
    const applyLessonFilter = async (value = input.value, rerender = true) => {
      const field = input.dataset.filterField;
      const monthKey = state.settings.month_key;
      focusedLessonIds = [];
      lessonFilter = {
        ...lessonFilter,
        month_key: monthKey,
        [field]: value,
        date_preset_initialized: true,
      };
      saveLessonFilter();
      if (rerender) {
        if ((field === "start_date" || field === "end_date") && !lessonRangeLoaded()) {
          await load();
        } else {
          render();
        }
      }
    };

    if (input.tagName === "SELECT" || input.type === "date") {
      input.addEventListener("change", () => applyLessonFilter(input.value, true));
      return;
    }

    bindSafeTextInput(input, (value) => {
      applyLessonFilter(value, false);
    }, async () => {
      if ((input.dataset.filterField === "start_date" || input.dataset.filterField === "end_date") && !lessonRangeLoaded()) {
        await loadLessonRangeOnly();
        render();
      } else {
        render();
      }
    }, 650);
  });

  document.querySelectorAll(".fee-details-filter-input").forEach((input) => {
    const applyFeeDetailsFilter = (value) => {
      feeDetailsFilter = {
        ...feeDetailsFilter,
        month_key: state.settings.month_key,
        [input.dataset.filterField]: value,
      };
    };
    if (input.tagName === "SELECT" || input.type === "date") {
      input.addEventListener("change", () => {
        applyFeeDetailsFilter(input.value);
        render();
      });
      return;
    }
    bindSafeTextInput(input, applyFeeDetailsFilter, () => render());
  });

  document.querySelectorAll(".reset-fee-details-filter").forEach((button) => {
    button.addEventListener("click", () => {
      resetFeeDetailsFilter();
      render();
    });
  });

  document.querySelectorAll(".fee-detail-select-row").forEach((input) => {
    input.addEventListener("change", () => {
      const key = `${input.dataset.lessonId}\u0001${input.dataset.studentName}`;
      if (input.checked) selectedFeeDetailKeys.add(key);
      else selectedFeeDetailKeys.delete(key);
      render();
    });
  });

  document.querySelectorAll(".fee-detail-select-all").forEach((input) => {
    input.addEventListener("change", () => {
      const visibleRows = (state.derived.fee_details || [])
        .filter((row) => feeDetailMatchesFilter(row))
        .filter(canApplyStudentPricingRule);
      for (const row of visibleRows) {
        const key = feeDetailKey(row);
        if (input.checked) selectedFeeDetailKeys.add(key);
        else selectedFeeDetailKeys.delete(key);
      }
      render();
    });
  });

  document.querySelectorAll(".apply-selected-student-pricing-rules").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const items = (state.derived.fee_details || [])
        .filter((row) => selectedFeeDetailKeys.has(feeDetailKey(row)))
        .filter(canApplyStudentPricingRule)
        .map((row) => ({ lesson_id: row.lesson_id, student_name: row.student_name }));
      if (!items.length) return;
      if (!confirm(`将把所选 ${items.length} 条费用明细更新为当前学生单价规则费用。未勾选的数据不会修改。是否继续？`)) return;
      button.disabled = true;
      try {
        const result = await request("/api/student-pricing/apply-selected", {
          method: "POST",
          body: { items },
        });
        selectedFeeDetailKeys = new Set();
        await load();
        alert(`已更新 ${result.updatedCount || 0} 条，跳过 ${result.skippedCount || 0} 条。`);
      } catch (error) {
        button.disabled = false;
        alert(`按规则更新费用失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll(".summary-filter-input").forEach((input) => {
    const applySummaryFilter = (value) => {
      const field = input.dataset.filterField;
      summaryFilter = {
        ...summaryFilter,
        [field]: field === "balance" ? canonicalFilterValue(balanceFilterOptions, value) : value,
      };
    };
    if (input.tagName === "SELECT") {
      input.addEventListener("change", () => {
        applySummaryFilter(input.value);
        render();
      });
      return;
    }
    bindSafeTextInput(input, applySummaryFilter, () => render());
  });

  document.querySelectorAll(".reset-summary-filter").forEach((button) => {
    button.addEventListener("click", () => {
      summaryFilter = { student: "", grade: "", balance: "" };
      render();
    });
  });

  document.querySelectorAll(".student-pricing-filter-input").forEach((input) => {
    const applyStudentPricingFilter = (value) => {
      const field = input.dataset.filterField;
      const canonical = field === "price"
        ? canonicalFilterValue(priceFilterOptions, value)
        : field === "usage"
          ? canonicalFilterValue(usageFilterOptions, value)
          : value;
      studentPricingFilter = { ...studentPricingFilter, [field]: canonical };
    };
    const selector = inputFocusSelector(input);
    let composing = false;
    let renderTimer = null;
    const renderFilter = (restoreFocus = true) => {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
      }
      const value = input.value;
      applyStudentPricingFilter(value);
      render();
      if (restoreFocus) restoreInputFocus(selector, value);
    };
    const scheduleRender = () => {
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = setTimeout(() => renderFilter(true), 250);
    };
    input.addEventListener("compositionstart", () => {
      composing = true;
    });
    input.addEventListener("compositionend", () => {
      composing = false;
      applyStudentPricingFilter(input.value);
      scheduleRender();
    });
    input.addEventListener("input", () => {
      if (composing) return;
      applyStudentPricingFilter(input.value);
      scheduleRender();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !composing) {
        event.preventDefault();
        renderFilter(true);
      }
    });
    input.addEventListener("change", () => {
      if (!composing) renderFilter(false);
    });
  });

  document.querySelectorAll(".reset-student-pricing-filter").forEach((button) => {
    button.addEventListener("click", () => {
      studentPricingFilter = { student: "", grade: "", subject: "", student_names: "", price: "", usage: "" };
      render();
    });
  });

  document.querySelectorAll(".reset-lesson-filter").forEach((button) => {
    button.addEventListener("click", () => {
      focusedLessonIds = [];
      resetLessonFilter();
      render();
    });
  });

  document.querySelectorAll(".lesson-conflict-btn").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      lessonConflictModalOpen = true;
      render();
    });
  });

  document.querySelectorAll(".lesson-conflict-modal-close").forEach((button) => {
    button.addEventListener("click", () => {
      lessonConflictModalOpen = false;
      render();
    });
  });

  document.querySelectorAll(".lesson-conflict-modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target !== modal) return;
      lessonConflictModalOpen = false;
      render();
    });
  });

  document.querySelectorAll(".clear-focused-lessons").forEach((button) => {
    button.addEventListener("click", () => {
      focusedLessonIds = [];
      render();
    });
  });

  document.querySelectorAll(".conflict-focus").forEach((button) => {
    button.addEventListener("click", () => {
      focusedLessonIds = String(button.dataset.lessonIds || "")
        .split(",")
        .map((id) => Number(id))
        .filter(Boolean);
      if (!focusedLessonIds.length) return;
      lessonConflictModalOpen = false;
      view = "lessons";
      activeNavGroup = "schedule";
      localStorage.setItem("liming:view", view);
      localStorage.setItem("liming:nav-group", activeNavGroup);
      render();
    });
  });

  document.querySelectorAll(".summary-expand-btn, .summary-name-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const studentName = button.dataset.studentName;
      if (!studentName) return;
      if (expandedSummaryStudents.has(studentName)) {
        expandedSummaryStudents.delete(studentName);
      } else {
        expandedSummaryStudents.add(studentName);
      }
      saveExpandedSummaryStudents();
      render();
    });
  });

  async function afterCopy(result) {
    const created = result.lessons || [];
    const outside = created.filter((lesson) => monthKeyFromDateValue(lesson.date) !== activeMonth);
    weekCopyDraft = null;
    if (outside.length) {
      const nextMonth = monthKeyFromDateValue(outside[0].date);
      if (nextMonth && confirm(`已复制 ${result.created} 节课，其中 ${outside.length} 节在 ${formatMonthOption(nextMonth)}，是否切换查看？`)) {
        activeMonth = nextMonth;
        localStorage.setItem("liming:month", activeMonth);
        resetFinanceRangeToActiveMonth();
      } else {
        alert(`已复制 ${result.created} 节课。`);
      }
    } else {
      alert(`已复制 ${result.created} 节课。`);
    }
    await load();
  }

  document.querySelectorAll(".batch-complete-lessons").forEach((button) => {
    button.addEventListener("click", async () => {
      const ids = [...selectedLessonIds].map(Number).filter(Boolean);
      if (!ids.length) return alert("请先选择要标记为已上的课程");
      const rows = selectedLessonRowsSorted();
      const invalid = rows.filter((row) => rowStatus(row) !== "待上");
      if (invalid.length) {
        const details = invalid.slice(0, 5)
          .map((row) => `${row.date || ""} ${row.teacher_name || ""} ${row.student_names || ""}：${rowStatus(row) || "未设置"}`)
          .join("\n");
        return alert(`只能将“待上”课程批量标记为“已上”，请先取消选择非待上课程。${details ? `\n\n${details}` : ""}`);
      }
      button.disabled = true;
      try {
        const result = await request("/api/lessons/batch-mark-completed", {
          method: "POST",
          body: { ids },
        });
        selectedLessonIds = new Set();
        await load();
        showToast(`已将 ${result.updated || ids.length} 节课程标记为已上`);
      } catch (error) {
        button.disabled = false;
        alert(error.message);
        updateLessonSelectionControls();
      }
    });
  });

  document.querySelectorAll(".batch-copy-lessons").forEach((button) => {
    button.addEventListener("click", () => {
      const ids = [...selectedLessonIds].map(Number).filter(Boolean);
      if (!ids.length) return alert("请先选择要复制的课程");
      lessonBatchCopyDraft = openLessonBatchCopyDraft();
      render();
    });
  });

  document.querySelectorAll(".batch-copy-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      lessonBatchCopyDraft = null;
      render();
    });
  });

  document.querySelectorAll(".batch-copy-drag-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, input, select, textarea")) return;
      const panel = handle.closest(".batch-copy-panel");
      if (!panel) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startOffsetX = Number(panel.dataset.dragX || 0);
      const startOffsetY = Number(panel.dataset.dragY || 0);
      const rect = panel.getBoundingClientRect();
      const baseLeft = rect.left - startOffsetX;
      const baseRight = rect.right - startOffsetX;
      const baseTop = rect.top - startOffsetY;
      const baseBottom = rect.bottom - startOffsetY;
      const applyPosition = (clientX, clientY) => {
        const rawX = startOffsetX + clientX - startX;
        const rawY = startOffsetY + clientY - startY;
        const minX = 8 - baseLeft;
        const maxX = window.innerWidth - 8 - baseRight;
        const minY = 8 - baseTop;
        const maxY = window.innerHeight - 8 - baseBottom;
        const nextX = Math.min(maxX, Math.max(minX, rawX));
        const nextY = Math.min(maxY, Math.max(minY, rawY));
        panel.dataset.dragX = String(nextX);
        panel.dataset.dragY = String(nextY);
        panel.style.transform = `translate(${nextX}px, ${nextY}px)`;
      };
      const onMove = (moveEvent) => applyPosition(moveEvent.clientX, moveEvent.clientY);
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  });

  document.querySelectorAll(".batch-copy-offset").forEach((input) => {
    input.addEventListener("change", () => {
      const offsetDays = Number.parseInt(input.value, 10);
      resetLessonBatchCopyDates(Number.isFinite(offsetDays) ? offsetDays : 7);
      render();
    });
  });

  document.querySelectorAll(".batch-copy-field").forEach((input) => {
    input.addEventListener("change", () => {
      const index = Number(input.dataset.index);
      const field = input.dataset.field;
      if (!lessonBatchCopyDraft || !Number.isInteger(index) || !field) return;
      const rows = [...(lessonBatchCopyDraft.targetRows || [])];
      if (!resolveManualSelectValue(input, rows[index]?.[field] ?? "")) return;
      rows[index] = { ...(rows[index] || {}), [field]: input.value };
      lessonBatchCopyDraft = { ...lessonBatchCopyDraft, targetRows: rows };
      if (field === "date") render();
    });
  });

  document.querySelectorAll(".batch-copy-confirm").forEach((button) => {
    button.addEventListener("click", async () => {
      const modal = button.closest(".batch-copy-modal");
      const rows = [...(lessonBatchCopyDraft?.targetRows || [])].map((row) => ({ ...row }));
      modal?.querySelectorAll(".batch-copy-field").forEach((input) => {
        const index = Number(input.dataset.index);
        const field = input.dataset.field;
        if (!Number.isInteger(index) || !field || !rows[index]) return;
        if (!resolveManualSelectValue(input, rows[index]?.[field] ?? "")) return;
        rows[index][field] = input.value;
      });
      if (!rows.length) return alert("没有可复制的课程");
      if (rows.length > 200) return alert("单次批量复制最多 200 节课");
      button.disabled = true;
      try {
        const lessons = rows.map((row) => {
          if (!isDateValue(row.date)) throw new Error(`目标日期无效：${row.date || "空"}`);
          const payload = {
            teacher_name: row.teacher_name || "",
            date: row.date,
            month_key: monthKeyFromDateValue(row.date) || state.settings.month_key,
            status: row.status || "待上",
            time_slot: row.time_slot || "",
            classroom: row.classroom || "",
            grade: row.grade || "",
            subject: row.subject || "",
            student_names: row.student_names || "",
            notes: row.notes || "",
          };
          if (String(row.teacher_salary ?? "").trim() !== "") payload.teacher_salary = numberValue(row.teacher_salary);
          return payload;
        });
        const result = await request("/api/lessons/batch-create", { method: "POST", body: { lessons } });
        lessonBatchCopyDraft = null;
        selectedLessonIds = new Set();
        await afterCopy(result);
      } catch (error) {
        button.disabled = false;
        alert(`批量复制失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll(".week-copy-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const sourceStart = startOfWeek(todayDate()) || monthBounds(activeMonth).start;
      weekCopyDraft = { sourceStart, targetStart: addDays(sourceStart, 7) };
      render();
    });
  });

  document.querySelectorAll(".week-copy-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      weekCopyDraft = null;
      render();
    });
  });

  document.querySelectorAll(".week-copy-source").forEach((input) => {
    input.addEventListener("change", () => {
      const sourceStart = startOfWeek(input.value);
      weekCopyDraft = { ...weekCopyDraft, sourceStart, targetStart: addDays(sourceStart, 7) };
      render();
    });
  });

  document.querySelectorAll(".week-copy-target").forEach((input) => {
    input.addEventListener("change", () => {
      weekCopyDraft = { ...weekCopyDraft, targetStart: startOfWeek(input.value) };
      render();
    });
  });

  document.querySelectorAll(".week-copy-confirm").forEach((button) => {
    button.addEventListener("click", async () => {
      const sourceStart = weekCopyDraft?.sourceStart;
      const targetStart = weekCopyDraft?.targetStart;
      const pairs = weekCopyPairs(sourceStart, targetStart);
      if (!pairs.length) return alert("源周暂无课程");
      if (pairs.length > 200) return alert("单次复制最多 200 节课");
      try {
        const result = await request("/api/lessons/copy", {
          method: "POST",
          body: { pairs, reset_status: true },
        });
        await afterCopy(result);
      } catch (error) {
        alert(error.message);
      }
    });
  });

  document.querySelectorAll(".schedule-mode-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const scroll = captureLessonScroll();
      scheduleMode = !scheduleMode;
      button.classList.toggle("primary", scheduleMode);
      button.textContent = scheduleMode ? "结束排课" : "开始排课";
      reRenderLessonsTbody();
      restoreLessonScroll(scroll);
    });
  });

  document.querySelectorAll(".batch-delete-lessons").forEach((button) => {
    button.addEventListener("click", async () => {
      const ids = [...selectedLessonIds].map(Number).filter(Boolean);
      if (!ids.length || lessonBatchDeleting) return;
      if (!confirm(`确认删除已选中的 ${ids.length} 节课程吗？此操作不可撤销。`)) return;
      lessonBatchDeleting = true;
      updateLessonSelectionControls();
      try {
        const result = await request("/api/lessons/batch-delete", { method: "POST", body: { ids } });
        lessonBatchDeleting = false;
        selectedLessonIds = new Set();
        await load();
        if (result.missing?.length) alert(`已删除 ${result.deleted || 0} 节课程，另有 ${result.missing.length} 节未找到。`);
      } catch (error) {
        lessonBatchDeleting = false;
        alert(`批量删除失败：${error.message}`);
        updateLessonSelectionControls();
      }
    });
  });

  /* [约束2] 事件委托：将 .lesson-field 的 change 监听挂在 contentEl 上，绑定一次，行替换不受影响 */
  if (!lessonFieldDelegatedBound) {
    lessonFieldDelegatedBound = true;
    contentEl.addEventListener("change", (event) => {
      const input = event.target.closest(".lesson-field");
      if (!input) return;
      handleLessonFieldChange(input);   /* [约束3] 配置表驱动，A/B/C 三档分派 */
    });
  }

  if (!lessonTableDelegatedBound) {
    lessonTableDelegatedBound = true;
    contentEl.addEventListener("change", (event) => {
      const rowSelect = event.target.closest(".lesson-select-row");
      if (rowSelect) {
        const id = Number(rowSelect.dataset.id);
        if (!id) return;
        if (rowSelect.checked) selectedLessonIds.add(id);
        else selectedLessonIds.delete(id);
        updateLessonSelectionControls();
        return;
      }
      const selectAll = event.target.closest(".lesson-select-all");
      if (selectAll) {
        const rows = visibleLessonRows();
        if (selectAll.checked) rows.forEach((row) => selectedLessonIds.add(Number(row.id)));
        else rows.forEach((row) => selectedLessonIds.delete(Number(row.id)));
        updateLessonSelectionControls(rows);
      }
    });
    contentEl.addEventListener("click", (event) => {
      const scheduleButton = event.target.closest(".schedule-add-btn");
      if (!scheduleButton) return;
      event.preventDefault();
      handleScheduleAddButton(scheduleButton);
    });
  }

  document.querySelectorAll(".teacher-detail-salary-field").forEach((input) => {
    input.addEventListener("change", () => {
      const value = input.value.trim() === "" ? null : optionalNumberValue(input.value);
      refreshAfter(() => request(`/api/lessons/${input.dataset.id}`, {
        method: "PATCH",
        body: { teacher_salary: value },
      }));
    });
  });

  document.querySelectorAll(".teacher-salary-lesson-select").forEach((input) => {
    input.addEventListener("change", () => {
      const id = Number(input.dataset.id);
      if (input.checked) selectedTeacherSalaryLessonIds.add(id);
      else selectedTeacherSalaryLessonIds.delete(id);
      render();
    });
  });

  document.querySelectorAll(".teacher-salary-select-all").forEach((input) => {
    input.addEventListener("change", () => {
      const rows = sortedLessons().filter((row) => (
        row.teacher_name === selectedTeacher
        && teacherDetailMatchesFilter(row)
        && teacherSalaryRuleCalculation(row)
      ));
      for (const row of rows) {
        if (input.checked) selectedTeacherSalaryLessonIds.add(Number(row.id));
        else selectedTeacherSalaryLessonIds.delete(Number(row.id));
      }
      render();
    });
  });

  document.querySelectorAll(".apply-selected-teacher-salary-rules").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const ids = [...selectedTeacherSalaryLessonIds];
      if (!ids.length) return;
      if (!confirm("将把所选课程的教师薪资更新为当前课时明细规则计算值，已有手动薪资也会被覆盖。是否继续？")) return;
      button.disabled = true;
      try {
        const result = await request("/api/teacher-salary-rules/apply-selected", {
          method: "POST",
          body: { lesson_ids: ids },
        });
        selectedTeacherSalaryLessonIds = new Set();
        await load();
        const warningText = result.warnings?.length ? `；${result.warnings.length} 条课程时间无法识别，已按 1 课时计算` : "";
        alert(`已按规则更新 ${result.updatedCount} 条，跳过 ${result.skippedCount} 条${warningText}。`);
      } catch (error) {
        button.disabled = false;
        alert(`按规则更新失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll(".teacher-detail-filter-input").forEach((input) => {
    const applyTeacherDetailFilter = (value) => {
      teacherDetailFilter = {
        ...teacherDetailFilter,
        [input.dataset.filterField]: value,
      };
    };
    bindSafeTextInput(input, applyTeacherDetailFilter, () => render());
  });

  document.querySelectorAll(".reset-teacher-detail-filter").forEach((button) => {
    button.addEventListener("click", () => {
      teacherDetailFilter = { grade: "", subject: "", student: "", source: "", rule_status: "" };
      selectedTeacherSalaryLessonIds = new Set();
      render();
    });
  });

  document.querySelectorAll(".add-lesson").forEach((button) => {
    button.addEventListener("click", () => {
      lessonCreateDraft = defaultLessonCreateDraft();
      render();
    });
  });

  document.querySelectorAll(".lesson-create-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      lessonCreateDraft = null;
      render();
    });
  });

  document.querySelectorAll(".lesson-create-date").forEach((input) => {
    input.addEventListener("change", () => {
      const modal = input.closest(".lesson-create-modal");
      const weekdayInput = modal?.querySelector(".lesson-create-weekday");
      if (weekdayInput) weekdayInput.value = weekdayCn(input.value);
    });
  });

  document.querySelectorAll(".lesson-create-field").forEach((input) => {
    input.addEventListener("change", () => {
      if (!Object.prototype.hasOwnProperty.call(LESSON_MANUAL_FIELD_LABELS, input.dataset.field)) return;
      const modal = input.closest(".lesson-create-modal");
      const manualInput = modal?.querySelector(`.lesson-create-manual-field[data-manual-field="${input.dataset.field}"]`);
      if (!manualInput) return;
      const isManual = input.value === LESSON_CREATE_MANUAL_VALUE;
      manualInput.classList.toggle("hidden", !isManual);
      if (isManual) manualInput.focus();
      else manualInput.value = "";
    });
  });

  document.querySelectorAll(".lesson-create-confirm").forEach((button) => {
    button.addEventListener("click", async () => {
      const modal = button.closest(".lesson-create-modal");
      const fieldValue = (field) => String(modal?.querySelector(`.lesson-create-field[data-field="${field}"]`)?.value || "").trim();
      const date = fieldValue("date");
      if (!isDateValue(date)) return alert("请选择有效的课程日期");
      button.disabled = true;
      try {
        const timeSlot = lessonCreateSelectValue(modal, "time_slot", "请填写新时间");
        const teacherName = lessonCreateSelectValue(modal, "teacher_name", "请填写新老师名称");
        const classroom = lessonCreateSelectValue(modal, "classroom", "请填写新教室名称");
        const grade = lessonCreateSelectValue(modal, "grade", "请填写新年级名称");
        const subject = lessonCreateSelectValue(modal, "subject", "请填写新科目名称");
        const status = lessonCreateSelectValue(modal, "status", "请填写新状态") || "待上";
        const selectedStudents = [...modal.querySelectorAll(".lesson-create-student-existing:checked")]
          .map((input) => String(input.value || "").trim())
          .filter(Boolean);
        const newStudents = parseLessonCreateStudents(modal.querySelector(".lesson-create-new-students")?.value);
        const studentNames = uniqueSorted([...selectedStudents, ...newStudents]);
        const payload = {
          date,
          month_key: monthKeyFromDateValue(date) || state.settings.month_key,
          time_slot: timeSlot,
          teacher_name: teacherName,
          classroom,
          grade,
          subject,
          student_names: studentNames.join("、"),
          notes: fieldValue("notes"),
          status,
        };
        const lesson = await request("/api/lessons", { method: "POST", body: payload });
        lessonCreateDraft = null;
        await load();
        const visible = visibleLessonRows().some((row) => Number(row.id) === Number(lesson.id));
        if (!visible) alert("新增成功，如未显示请调整日期筛选。");
      } catch (error) {
        button.disabled = false;
        alert(`新增课程失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll(".delete-lesson").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm("删除这条课程记录？")) return;
      selectedLessonIds.delete(Number(button.dataset.id));
      refreshAfter(() => request(`/api/lessons/${button.dataset.id}`, { method: "DELETE" }));
    });
  });

  document.querySelectorAll(".week-tab").forEach((button) => {
    button.addEventListener("click", () => {
      activeWeek = Number(button.dataset.week);
      localStorage.setItem("liming:week", String(activeWeek));
      localStorage.setItem(WEEK_USER_SET_KEY, "1");
      if (view === "weekMatrix") {
        matrixRange = matrixDefaultRange(state.settings.month_key || activeMonth);
        localStorage.setItem(MATRIX_RANGE_USER_SET_KEY, "1");
        saveMatrixRange();
      }
      render();
    });
  });

  document.querySelectorAll(".matrix-range-reset").forEach((button) => {
    button.addEventListener("click", () => {
      matrixRange = matrixDefaultRange(state.settings.month_key || activeMonth);
      localStorage.setItem(MATRIX_RANGE_USER_SET_KEY, "1");
      saveMatrixRange();
      render();
    });
  });

  document.querySelectorAll(".matrix-view-tab").forEach((button) => {
    button.addEventListener("click", () => {
      matrixView = button.dataset.matrixView || "time";
      localStorage.setItem(MATRIX_VIEW_KEY, matrixView);
      render();
    });
  });

  document.querySelectorAll(".export-finance-csv").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `/api/export/finance-summary.csv?${financeRangeQuery()}`;
    });
  });

  document.querySelectorAll(".fee-override").forEach((input) => {
    input.addEventListener("change", () => refreshAfter(() => request("/api/fee-overrides", {
      method: "POST",
      body: {
        lesson_id: Number(input.dataset.lessonId),
        student_name: input.dataset.studentName,
        unit_price: input.value,
      },
    })));
  });

  document.querySelectorAll(".recharge-field").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest(".recharge-row");
      const summary = state.derived.student_summary.find((item) => item.student_name === row.dataset.studentName) || {};
      const payload = collectRowPayload(row, ".recharge-field");
      if (numberValue(payload.cur_recharge) < 0 && !confirm(`充值金额为负数(${formatMoney(payload.cur_recharge)})，确认这是退费操作？`)) {
        load();
        return;
      }
      if (numberValue(payload.cur_recharge) === 0 && numberValue(payload.cur_gift) === 0
        && !confirm("实际充值和赠送充值都为 0，这将删除该充值记录。是否继续？")) {
        load();
        return;
      }
      if (!row.dataset.id) {
        alert("缺少充值记录 ID，请刷新后重试");
        load();
        return;
      }
      refreshAfter(() => request(`/api/recharges/${encodeURIComponent(row.dataset.id)}`, {
        method: "PATCH",
        body: {
          student_name: row.dataset.studentName,
          grade: row.dataset.grade || summary.grade || "",
          month_key: state.settings.month_key,
          source: row.dataset.source || "",
          ...payload,
        },
      }));
    });
  });

  document.querySelectorAll(".pricing-field").forEach((input) => {
    input.addEventListener("change", () => {
      const value = input.type === "number" ? numberValue(input.value) : input.value;
      refreshAfter(() => request(`/api/pricing-standards/${input.dataset.id}`, {
        method: "PATCH",
        body: { [input.dataset.field]: value },
      }));
    });
  });

  document.querySelectorAll(".open-teacher-salary-rule-modal").forEach((button) => {
    button.addEventListener("click", () => {
      teacherSalaryRuleModalOpen = true;
      render();
    });
  });

  document.querySelectorAll("[data-action='close-teacher-salary-rule-modal']").forEach((button) => {
    button.addEventListener("click", () => {
      teacherSalaryRuleModalOpen = false;
      render();
    });
  });

  document.querySelectorAll(".teacher-salary-rule-modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target !== modal) return;
      teacherSalaryRuleModalOpen = false;
      render();
    });
  });

  document.querySelectorAll(".teacher-salary-rule-filter-input").forEach((input) => {
    const applyTeacherSalaryRuleFilter = (value) => {
      teacherSalaryRuleFilter = {
        ...teacherSalaryRuleFilter,
        [input.dataset.filterField]: value,
      };
    };
    bindSafeTextInput(input, applyTeacherSalaryRuleFilter, () => render());
  });

  document.querySelectorAll(".reset-teacher-salary-rule-filter").forEach((button) => {
    button.addEventListener("click", () => {
      teacherSalaryRuleFilter = { teacher: "", grade: "", subject: "", student: "", salary_status: "" };
      render();
    });
  });

  document.querySelectorAll(".add-teacher-salary-rule").forEach((button) => {
    button.addEventListener("click", async () => {
      const teacherName = document.querySelector("#new-teacher-salary-rule-teacher")?.value.trim() || "";
      const grade = document.querySelector("#new-teacher-salary-rule-grade")?.value.trim() || "";
      const subject = document.querySelector("#new-teacher-salary-rule-subject")?.value.trim() || "";
      const studentNames = document.querySelector("#new-teacher-salary-rule-students")?.value.trim() || "";
      const salaryValue = document.querySelector("#new-teacher-salary-rule-salary")?.value.trim() || "";
      const notes = document.querySelector("#new-teacher-salary-rule-notes")?.value || "";
      if (!teacherName || !grade || !subject || !studentNames) return alert("请填写老师、年级、科目和学生集合");
      if (salaryValue !== "" && optionalNumberValue(salaryValue) === null) return alert("请填写有效的每2小时薪资");
      button.disabled = true;
      try {
        await request("/api/teacher-salary-rules", {
          method: "POST",
          body: {
            teacher_name: teacherName,
            grade,
            subject,
            student_names: studentNames,
            salary_per_unit: salaryValue === "" ? 0 : optionalNumberValue(salaryValue),
            unit_hours: 2,
            notes,
          },
        });
        teacherSalaryRuleModalOpen = false;
        await load();
      } catch (error) {
        button.disabled = false;
        alert(`新增课时明细失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll(".teacher-salary-rule-field").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      input.blur();
    });
    input.addEventListener("change", () => {
      const row = input.closest(".teacher-salary-rule-row");
      if (!row) return;
      const payload = {};
      row.querySelectorAll(".teacher-salary-rule-field").forEach((field) => {
        payload[field.dataset.field] = field.type === "number" ? optionalNumberValue(field.value) : field.value;
      });
      if (payload.salary_per_unit === null) payload.salary_per_unit = 0;
      refreshAfter(() => request(`/api/teacher-salary-rules/${row.dataset.ruleId}`, {
        method: "PUT",
        body: payload,
      }));
    });
  });

  document.querySelectorAll(".student-pricing-field").forEach((input) => {
    input.addEventListener("change", () => {
      const value = input.type === "number" ? numberValue(input.value) : input.value;
      if (input.dataset.field === "custom_price" && numberValue(value) < 0) {
        alert("学生单价必须大于或等于 0；0 元规则仅作为未设置候选。");
        return load();
      }
      refreshAfter(() => request(`/api/student-pricing/${input.dataset.id}`, {
        method: "PATCH",
        body: { [input.dataset.field]: value },
      }), () => refreshStudentPricingModule());
    });
  });

  document.querySelectorAll(".open-student-pricing-modal").forEach((button) => {
    button.addEventListener("click", () => {
      studentPricingModalOpen = true;
      render();
    });
  });

  document.querySelectorAll("[data-action='close-student-pricing-modal']").forEach((button) => {
    button.addEventListener("click", () => {
      studentPricingModalOpen = false;
      render();
    });
  });

  document.querySelectorAll(".student-pricing-modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target !== modal) return;
      studentPricingModalOpen = false;
      render();
    });
  });

  document.querySelectorAll(".add-student-price").forEach((button) => {
    button.addEventListener("click", async () => {
      const studentName = document.querySelector("#new-student-price-name").value.trim();
      const grade = document.querySelector("#new-student-price-grade").value.trim();
      const subject = document.querySelector("#new-student-price-subject").value;
      const studentNames = document.querySelector("#new-student-price-student-names").value.trim();
      const customPrice = document.querySelector("#new-student-price-value").value;
      const notes = document.querySelector("#new-student-price-notes").value;
      if (!studentName || !subject) return alert("请填写学生姓名和科目");
      if (customPrice !== "" && numberValue(customPrice) < 0) return alert("学生单价必须大于或等于 0；0 元规则仅作为未设置候选。");
      button.disabled = true;
      try {
        await request("/api/student-pricing", {
          method: "POST",
          body: { student_name: studentName, grade, subject, student_names: studentNames, custom_price: customPrice === "" ? 0 : customPrice, notes },
        });
        studentPricingModalOpen = false;
        await refreshStudentPricingModule();
      } catch (error) {
        button.disabled = false;
        alert(`新增学生单价规则失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll(".delete-student-price").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm("删除这条学生单价规则？")) return;
      refreshAfter(() => request(`/api/student-pricing/${button.dataset.id}`, { method: "DELETE" }), () => refreshStudentPricingModule());
    });
  });

  document.querySelectorAll(".pricing-impact-btn").forEach((button) => {
    button.addEventListener("click", () => {
      pricingAuditModal = {
        student_name: button.dataset.name,
        grade: button.dataset.grade || "",
        subject: button.dataset.subject,
        student_names: button.dataset.studentNames || "",
      };
      render();
    });
  });

  document.querySelectorAll(".pricing-audit-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      pricingAuditModal = null;
      render();
    });
  });

  document.querySelectorAll(".pricing-recompute").forEach((button) => {
    button.addEventListener("click", async () => {
      const count = Number(button.dataset.count || 0);
      const manualCount = Number(button.dataset.manualCount || 0);
      const price = button.dataset.price || "0";
      if (!confirm(`将清除 ${manualCount} 条手填价格，并重算 ${count} 节课程，回归规则单价 ¥${price}，是否继续？`)) return;
      try {
        const result = await request("/api/pricing-recompute", {
          method: "POST",
          body: {
            student_name: button.dataset.name,
            subject: button.dataset.subject,
            month_key: state.settings.month_key,
          },
        });
        pricingAuditModal = null;
        await load();
        alert(`已重算 ${result.affected} 节课，清除 ${result.cleared_overrides || 0} 条手填覆盖。`);
      } catch (error) {
        alert(error.message);
      }
    });
  });

  document.querySelectorAll(".student-query-name").forEach((input) => {
    input.addEventListener("input", () => {
      studentQueryNameDraft = input.value;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyStudentQuerySelection(input.value).catch((error) => alert(error.message || "查询失败"));
      }
    });
    input.addEventListener("change", () => {
      applyStudentQuerySelection(input.value).catch((error) => alert(error.message || "查询失败"));
    });
  });

  document.querySelectorAll(".student-query-mode").forEach((button) => {
    button.addEventListener("click", async () => {
      studentQueryRange.mode = button.dataset.mode === "range" ? "range" : "all";
      if (studentQueryRange.mode === "range" && (!studentQueryRange.start || !studentQueryRange.end)) {
        Object.assign(studentQueryRange, monthBounds(state.settings.month_key || activeMonth));
      }
      saveStudentQueryRange();
      await refreshStudentQueryOnly();
    });
  });

  document.querySelectorAll(".export-student-statement").forEach((button) => {
    button.addEventListener("click", () => {
      if (!selectedStudent) return alert("请先选择学生");
      const qs = studentStatementQueryString();
      window.location.href = `/api/export/student-statement.xlsx?student=${encodeURIComponent(selectedStudent)}&${qs}`;
    });
  });

  document.querySelectorAll(".student-statement-preview").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!selectedStudent) return alert("请先选择学生");
      try {
        if (!state.student_statement) await loadStudentStatement();
        await copyStudentStatementPng(state.student_statement || { student_name: selectedStudent, range: currentStudentQueryRange(), summary: null, details: [], month_rows: [] });
      } catch (error) {
        alert(error.message || "图片复制失败");
      }
    });
  });

  document.querySelectorAll(".statement-modal-close").forEach((button) => {
    button.addEventListener("click", () => {
      studentStatementModalOpen = false;
      render();
    });
  });

  document.querySelectorAll(".statement-download-png").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await downloadStudentStatementPng(state.student_statement);
      } catch (error) {
        alert(error.message || "图片导出失败");
      }
    });
  });

  document.querySelectorAll(".export-teacher-detail-image").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await copyTeacherDetailPng();
      } catch (error) {
        alert(error.message || "图片复制失败");
      }
    });
  });

  document.querySelectorAll(".teacher-select").forEach((select) => {
    select.addEventListener("change", () => {
      selectedTeacher = select.value;
      teacherDetailFilter = { grade: "", subject: "", student: "", source: "", rule_status: "" };
      selectedTeacherSalaryLessonIds = new Set();
      render();
    });
  });

  document.querySelectorAll(".export-teacher-salary").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `/api/export/teacher-salary.xlsx?month=${encodeURIComponent(state.settings.month_key)}`;
    });
  });

  document.querySelectorAll(".teacher-travel-fee-field").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest(".teacher-travel-fee-row");
      if (!row) return;
      const payload = collectTeacherTravelFeePayload(row);
      refreshAfter(() => request("/api/teacher-travel-fees", {
        method: "PUT",
        body: payload,
      }));
    });
  });

  document.querySelectorAll(".teacher-adjustment-field").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest(".teacher-adjustment-row");
      const payload = collectRowPayload(row, ".teacher-adjustment-field");
      refreshAfter(() => request("/api/teacher-adjustments", {
        method: "POST",
        body: {
          teacher_name: row.dataset.teacherName,
          month_key: state.settings.month_key,
          ...payload,
        },
      }));
    });
  });

  document.querySelectorAll(".course-notice-filter").forEach((input) => {
    input.addEventListener("change", () => {
      courseNoticeFilter = { ...courseNoticeFilter, [input.dataset.field]: input.value };
      ensureCourseNoticeFilterDates();
      saveCourseNoticeFilter();
      loadCourseNoticeData(true);
    });
  });

  document.querySelectorAll(".course-notice-only").forEach((input) => {
    input.addEventListener("change", () => {
      courseNoticeFilter = { ...courseNoticeFilter, onlyTeaching: input.checked };
      saveCourseNoticeFilter();
      loadCourseNoticeData(true);
    });
  });

  document.querySelectorAll(".course-notice-generate").forEach((button) => {
    button.addEventListener("click", () => loadCourseNoticeData(true));
  });

  document.querySelectorAll(".course-notice-clear-completions").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("确定清除所有课程通知的打勾完成记录吗？称呼和文案不会被清除。")) return;
      button.disabled = true;
      try {
        const result = await request("/api/course-notice/completions", { method: "DELETE" });
        showToast(`已清除 ${result.deleted || 0} 条打勾记录`);
        await loadCourseNoticeData(true);
      } catch (error) {
        showToast(error.message || "清除失败", "error");
      } finally {
        button.disabled = false;
      }
    });
  });

  if (!saveCourseNoticeTailDebounced) {
    saveCourseNoticeTailDebounced = debounce(async (value) => {
      try {
        await request("/api/course-notice/global-tail", { method: "POST", body: { global_tail: value } });
      } catch (error) {
        showToast(error.message, "error");
      }
    }, 500);
  }

  document.querySelectorAll(".course-notice-tail").forEach((input) => {
    input.addEventListener("input", () => {
      if (!courseNoticeState.data) return;
      courseNoticeState.data.global_tail = input.value;
      (courseNoticeState.data.send_objects || []).forEach((item) => updateCourseNoticeMessageDom(item.send_object_key));
      saveCourseNoticeTailDebounced(input.value);
    });
  });

  document.querySelectorAll(".notice-greeting").forEach((input) => {
    input.addEventListener("input", () => {
      const item = findCourseNoticeObject(input.dataset.sendKey);
      if (!item) return;
      item.greeting = input.value;
      updateCourseNoticeMessageDom(item.send_object_key);
    });
    input.addEventListener("change", async () => {
      const item = findCourseNoticeObject(input.dataset.sendKey);
      if (!item) return;
      try {
        await saveCourseNoticeGreeting(item);
        showToast("称呼已保存");
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });

  document.querySelectorAll(".notice-copy-message").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = findCourseNoticeObject(button.dataset.sendKey);
      if (!item) return;
      try {
        await navigator.clipboard.writeText(courseNoticeFullMessage(item));
        showToast("文案已复制");
      } catch (error) {
        alert(error.message || "复制失败");
      }
    });
  });

  document.querySelectorAll(".notice-copy-image").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = findCourseNoticeObject(button.dataset.sendKey);
      if (!item) return;
      button.disabled = true;
      try {
        await copyCourseNoticeImage(item);
      } catch (error) {
        showToast(error.message || "复制截图失败", "error");
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll(".notice-download-image").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = findCourseNoticeObject(button.dataset.sendKey);
      if (!item) return;
      try {
        await downloadCourseNoticeImage(item);
      } catch (error) {
        showToast(error.message || "下载失败", "error");
      }
    });
  });

  document.querySelectorAll(".teacher-course-notice-filter").forEach((input) => {
    input.addEventListener("change", () => {
      teacherCourseNoticeFilter = { ...teacherCourseNoticeFilter, [input.dataset.field]: input.value };
      ensureTeacherCourseNoticeFilterDates();
      saveTeacherCourseNoticeFilter();
      loadTeacherCourseNoticeData(true);
    });
  });

  document.querySelectorAll(".teacher-course-notice-only").forEach((input) => {
    input.addEventListener("change", () => {
      teacherCourseNoticeFilter = { ...teacherCourseNoticeFilter, onlyTeaching: input.checked };
      saveTeacherCourseNoticeFilter();
      loadTeacherCourseNoticeData(true);
    });
  });

  document.querySelectorAll(".teacher-course-notice-generate").forEach((button) => {
    button.addEventListener("click", () => loadTeacherCourseNoticeData(true));
  });

  document.querySelectorAll(".teacher-course-notice-clear-completions").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("确定清除所有老师课程通知的打勾完成记录吗？称呼和文案不会被清除。")) return;
      button.disabled = true;
      try {
        const result = await request("/api/teacher-course-notice/completions", { method: "DELETE" });
        showToast(`已清除 ${result.deleted || 0} 条老师版打勾记录`);
        await loadTeacherCourseNoticeData(true);
      } catch (error) {
        showToast(error.message || "清除失败", "error");
      } finally {
        button.disabled = false;
      }
    });
  });

  if (!saveTeacherCourseNoticeTailDebounced) {
    saveTeacherCourseNoticeTailDebounced = debounce(async (value) => {
      try {
        await request("/api/teacher-course-notice/global-tail", { method: "POST", body: { global_tail: value } });
      } catch (error) {
        showToast(error.message, "error");
      }
    }, 500);
  }

  document.querySelectorAll(".teacher-course-notice-tail").forEach((input) => {
    input.addEventListener("input", () => {
      if (!teacherCourseNoticeState.data) return;
      teacherCourseNoticeState.data.global_tail = input.value;
      (teacherCourseNoticeState.data.send_objects || []).forEach((item) => updateTeacherCourseNoticeMessageDom(item.send_object_key));
      saveTeacherCourseNoticeTailDebounced(input.value);
    });
  });

  document.querySelectorAll(".teacher-notice-greeting").forEach((input) => {
    input.addEventListener("input", () => {
      const item = findTeacherCourseNoticeObject(input.dataset.sendKey);
      if (!item) return;
      item.greeting = input.value;
      updateTeacherCourseNoticeMessageDom(item.send_object_key);
    });
    input.addEventListener("change", async () => {
      const item = findTeacherCourseNoticeObject(input.dataset.sendKey);
      if (!item) return;
      try {
        await saveTeacherCourseNoticeGreeting(item);
        showToast("称呼已保存");
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });

  document.querySelectorAll(".teacher-notice-copy-message").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = findTeacherCourseNoticeObject(button.dataset.sendKey);
      if (!item) return;
      try {
        await navigator.clipboard.writeText(teacherCourseNoticeFullMessage(item));
        showToast("文案已复制");
      } catch (error) {
        alert(error.message || "复制失败");
      }
    });
  });

  document.querySelectorAll(".teacher-notice-copy-image").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = findTeacherCourseNoticeObject(button.dataset.sendKey);
      if (!item) return;
      button.disabled = true;
      try {
        await copyCourseNoticeImage(item, "teacher", "本周课程安排", "/api/teacher-course-notice/complete");
      } catch (error) {
        showToast(error.message || "复制截图失败", "error");
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll(".teacher-notice-download-image").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = findTeacherCourseNoticeObject(button.dataset.sendKey);
      if (!item) return;
      try {
        await downloadCourseNoticeImage(item, "teacher", "本周课程安排");
      } catch (error) {
        showToast(error.message || "下载失败", "error");
      }
    });
  });

  enhanceCustomSelects();
  enhanceCustomDateInputs();
}

load().catch((error) => {
  renderLoadFailure(error);
});
