const navGroups = [
  { key: "home", label: "首页", views: [["dashboard", "首页"]] },
  { key: "schedule", label: "排课", views: [["lessons", "课程总表"], ["weekMatrix", "矩阵课表"], ["courseNotice", "家长群课程截图"], ["teacherCourseNotice", "老师课程截图"]] },
  {
    key: "students",
    label: "学生",
    views: [["summary", "费用汇总"], ["feeDetails", "费用明细"], ["recharges", "充值记录"], ["openingBalances", "期初余额"], ["studentQuery", "学生查询"]],
    moreViews: [["studentPricing", "学生单价"], ["classGroups", "班级管理"], ["studentProfiles", "学生档案"]],
  },
  { key: "teachers", label: "教师", views: [["teacherSalary", "薪资汇总"], ["teacherTravelFees", "车费明细"], ["teacherDetail", "课时明细"], ["teacherSalaryRules", "薪资规则"], ["teacherProfiles", "教师档案"]] },
  { key: "operations", label: "运营", views: [["staffPayroll", "员工薪资"], ["staffAttendance", "员工考勤"], ["expenses", "日常开销"]] },
  { key: "finance", label: "经营概览", views: [["finance", "期间概览"]] },
  { key: "settings", label: "设置", views: [["appearance", "外观设置"], ["baseData", "基础数据"], ["pricing", "费用标准"], ["audit", "数据中心"], ["operationLogs", "操作日志"], ["userAdmin", "账号权限"]] },
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
const studentStatusOptions = ["在读", "暂停", "已毕业", "已流出"];
const defaultCourseStatuses = ["待上", "已上", "请假", "试课", "考试", "未缴费"];
const DEFAULT_COURSE_STATUS_COLORS = {
  "待上": { background: "#e8f1fb", color: "#1d4f91" },
  "已上": { background: "#e7f6ed", color: "#16713a" },
  "请假": { background: "#eef0f3", color: "#56606d" },
  "试课": { background: "#eee9ff", color: "#6246b5" },
  "考试": { background: "#fff3d7", color: "#9a6200" },
  "未缴费": { background: "#fde9e8", color: "#b42318" },
};
const DEFAULT_STUDENT_GRADE_COLORS = {
  "初一": { background: "#e8f7ef", color: "#16734a" },
  "初二": { background: "#e8f6fb", color: "#126a88" },
  "初三": { background: "#eaf0ff", color: "#3451a6" },
  "高一": { background: "#f1eafe", color: "#6d3db1" },
  "高二": { background: "#fff3df", color: "#a25c00" },
  "高三": { background: "#fdebed", color: "#b23b55" },
};
const DEFAULT_SUBJECT_COLORS = {};
const DEFAULT_GENERIC_STATUS_COLORS = {
  "在读": { background: "#e7f6ed", color: "#16713a" },
  "在职": { background: "#e7f6ed", color: "#16713a" },
  "成功": { background: "#e7f6ed", color: "#16713a" },
  "已完成": { background: "#e7f6ed", color: "#16713a" },
  "部分完成": { background: "#fff3d7", color: "#9a6200" },
  "待完成": { background: "#e8f1fb", color: "#1d4f91" },
  "暂停": { background: "#fff3d7", color: "#9a6200" },
  "离职": { background: "#eef0f3", color: "#56606d" },
  "已毕业": { background: "#eee9ff", color: "#6246b5" },
  "失败": { background: "#fde9e8", color: "#b42318" },
};
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
const NAV_EXPANDED_KEY = "liming:nav-expanded-groups";
const NAV_EXPANSION_MODE_KEY = "liming:nav-expansion-mode";
// Session-scoped GET data is safe to reuse until a related write invalidates it.
// `?perf=1` is deliberately opt-in so production consoles stay quiet.
const REQUEST_CACHE_TTL = 5 * 60 * 1000;
const PERF_LOG = new URLSearchParams(window.location.search).get("perf") === "1";
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
const TEACHER_COURSE_NOTICE_LAYOUT_KEY = "liming:teacher-course-notice-layout";
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
    label: "课时明细",
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
  academic: new Set(["dashboard", "lessons", "weekMatrix", "courseNotice", "teacherCourseNotice", "summary", "feeDetails", "recharges", "openingBalances", "studentQuery", "studentPricing", "classGroups", "studentProfiles", "teacherProfiles", "teacherSalary", "teacherTravelFees", "teacherDetail", "teacherSalaryRules", "finance", "appearance", "baseData", "pricing", "operationLogs"]),
  jiaowu: new Set(["dashboard", "lessons", "weekMatrix", "courseNotice", "teacherCourseNotice", "summary", "feeDetails", "recharges", "openingBalances", "studentQuery", "studentPricing", "classGroups", "studentProfiles", "teacherProfiles", "teacherSalary", "teacherTravelFees", "teacherDetail", "teacherSalaryRules", "finance", "appearance", "baseData", "pricing", "operationLogs"]),
  helper: new Set(["dashboard", "lessons", "weekMatrix", "courseNotice", "teacherCourseNotice", "feeDetails", "recharges", "studentQuery", "studentProfiles", "teacherProfiles", "appearance"]),
  finance: new Set(["dashboard", "lessons", "weekMatrix", "courseNotice", "teacherCourseNotice", "feeDetails", "recharges", "studentQuery", "studentProfiles", "teacherProfiles", "appearance"]),
  assistant: new Set(["dashboard", "lessons", "weekMatrix", "courseNotice", "teacherCourseNotice", "studentQuery", "studentProfiles", "teacherProfiles", "appearance"]),
  teacher: new Set(["lessons", "teacherDetail", "teacherProfiles", "appearance"]),
};
const PALETTES = [
  { key: "liming-blue", label: "黎明蓝", colors: ["#002147", "#00172F", "#EAF0F7", "#C8D6E5"] },
  { key: "black-white", label: "黑白", colors: ["#111111", "#3f3f46", "#ffffff", "#e5e7eb"] },
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
const requestCache = new Map();
const requestInflight = new Map();
let requestCacheRevision = 0;
let navigationTransitionStartedAt = 0;
const storedInitialView = localStorage.getItem("liming:view");
const shouldMigrateDashboardDefault = localStorage.getItem(DASHBOARD_DEFAULT_MIGRATED_KEY) !== "1" && (!storedInitialView || storedInitialView === "lessons");
let view = shouldMigrateDashboardDefault ? "dashboard" : (storedInitialView || "dashboard");
if (shouldMigrateDashboardDefault) {
  localStorage.setItem("liming:view", "dashboard");
  localStorage.setItem(DASHBOARD_DEFAULT_MIGRATED_KEY, "1");
}
let lastRenderedView = "";
if (view === "staffProfiles") view = "staffPayroll";
if (view === "week") view = "lessons";
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
let studentQueryRequestGeneration = 0;
const studentStatementCache = new Map();
const COURSE_NOTICE_FILTER_KEY = "liming:course-notice-filter";
const TEACHER_COURSE_NOTICE_FILTER_KEY = "liming:teacher-course-notice-filter";
const CLASS_GROUP_HIDE_INACTIVE_TEACHERS_KEY = "liming:class-groups-hide-inactive-teachers";
const TEACHER_RULE_HIDE_INACTIVE_TEACHERS_KEY = "liming:teacher-rules-hide-inactive-teachers";
let courseNoticeFilter = readCourseNoticeFilter();
let courseNoticeState = { data: null, busy: false, error: "", loadedQuery: "" };
let courseNoticeLayoutMode = "preview";
let courseNoticeSimpleActions = {};
let saveCourseNoticeTailDebounced = null;
let teacherCourseNoticeFilter = readTeacherCourseNoticeFilter();
let teacherCourseNoticeState = { data: null, busy: false, error: "", loadedQuery: "" };
let teacherCourseNoticeLayoutMode = localStorage.getItem(TEACHER_COURSE_NOTICE_LAYOUT_KEY) === "simple" ? "simple" : "preview";
let teacherCourseNoticeSimpleActions = {};
let saveTeacherCourseNoticeTailDebounced = null;
let selectedTeacher = "";
let selectedTeacherDetail = "";
let selectedTeacherSalaryLessonIds = new Set();
let teacherSalaryBatchResult = null;
let teacherSalaryRuleCandidateSync = { requested: false, busy: false, result: null, error: "" };
let teacherDetailFilter = { grade: "", subject: "", student: "", source: "", rule_status: "" };
let teacherSalaryRuleFilter = { teacher: "", grade: "", subject: "", student: "", salary_status: "" };
let teacherSalaryRuleModalOpen = false;
let selectedTeacherSalaryRuleIds = new Set();
let teacherSalaryRuleBatchModalOpen = false;
let passwordModalOpen = false;
let userMenuOpen = false;
let userAdminNotice = "";
let userAdminTab = localStorage.getItem("liming:user-admin-tab") || "accounts";
let userAdminFocusId = null;
let rolePermissionModal = null;
let userAccessModal = null;
let userCreateModalOpen = false;
let roleCreateDraft = null;
let lessonFilter = readLessonFilter();
let appliedUserFilterPresetViews = new Set();
let scheduleMode = false;
let lessonStudentWidthCache = { signature: "", width: 156 };
let activeScheduleInlinePicker = null;
let scheduleInlinePickerEventsBound = false;
let selectedLessonIds = new Set();
let lessonBatchDeleting = false;
let lessonConflictModalOpen = false;
let lessonConflictEditDraft = null;
let lessonConflictRefreshRequest = 0;
let lessonConflictEventsBound = false;
let expandedSummaryStudents = readExpandedSummaryStudents();
let activeNavGroup = localStorage.getItem("liming:nav-group") || "";
let expandedNavGroups = readExpandedNavGroups();
let navExpansionMode = localStorage.getItem(NAV_EXPANSION_MODE_KEY) || "initial";
let rechargeSourceFilter = localStorage.getItem(RECHARGE_SOURCE_FILTER_KEY) || "all";
let rechargeStudentFilter = "";
let rechargeGradeFilter = "";
let rechargeDateFilter = { start: "", end: "" };
let rechargeModalOpen = false;
let rechargeModalDraft = null;
let selectedRechargeIds = new Set();
let activeRechargeChannelOverlay = null;
let rechargeChannelEventsBound = false;
let openingBalanceFilter = { student: "", grade: "" };
let openingBalanceModalOpen = false;
let selectedOpeningBalanceIds = new Set();
let feeDetailsFilter = { month_key: "", student: "", teacher: "", grade: "", status: "", source: "", start: "", end: "" };
let selectedFeeDetailKeys = new Set();
let summaryFilter = { student: "", grade: "", balance: "" };
let studentPricingFilter = { student: "", grade: "", subject: "", student_names: "", price: "", usage: "" };
let studentPricingModalOpen = false;
let selectedStudentPricingIds = new Set();
let studentPricingBatchModalOpen = false;
const STUDENT_PRICING_CLIENT_CACHE_TTL_MS = 60_000;
const STUDENT_PRICING_INITIAL_ROW_COUNT = 36;
const STUDENT_PRICING_RENDER_BATCH_SIZE = 72;
const studentPricingPageCache = new Map();
let studentPricingPageRequest = null;
let studentPricingRenderGeneration = 0;
let studentPricingRenderHandle = 0;
let studentPricingVisibleRows = [];
let studentPricingDelegatedEventsBound = false;
let classGroupFilter = { teacher: "", grade: "", subject: "", student: "" };
let classGroupHideInactiveTeachers = localStorage.getItem(CLASS_GROUP_HIDE_INACTIVE_TEACHERS_KEY) !== "0";
let teacherSalaryRuleHideInactiveTeachers = localStorage.getItem(TEACHER_RULE_HIDE_INACTIVE_TEACHERS_KEY) !== "0";
let financeRange = readFinanceRange();
let monthDeleteDraft = null;
let profileTab = localStorage.getItem("liming:profile-tab") || "teachers";
if (view === "profiles") view = profileTab === "students" ? "studentProfiles" : "teacherProfiles";
let profileNameFilter = { teachers: "", students: "" };
let profileKeywordFilter = { teachers: "", students: "" };
let profileGradeFilter = { students: "" };
let profileStatusFilter = (() => {
  try {
    const stored = { teachers: "", students: "", ...JSON.parse(localStorage.getItem("liming:profile-status-filter") || "{}") };
    if (stored.students === "离校") stored.students = "已流出";
    return stored;
  } catch {
    return { teachers: "", students: "" };
  }
})();
let profileModal = null;
let selectedTeacherProfileIds = new Set();
let selectedStudentProfileIds = new Set();
let studentGradeStageModalDraft = null;
let studentGradeStageConflicts = [];
let studentGradeStageConflictCheck = { status: "idle", errorKind: "" };
let studentGradeStageConflictRequestId = 0;
let studentGradeStageConflictModalOpen = false;
let studentGradeStageTrigger = null;
let studentGradeStageReturnView = "";
let studentGradeStageEventsBound = false;
let studentGradeStageBatchModalOpen = false;
let studentGradeStageBatchDraft = { stage: "初一", start_date: "", end_date: "" };
let staffProfileSearch = "";
let staffStatusFilter = localStorage.getItem("liming:staff-status-filter") || "";
let staffModal = null;
let operationLogFilter = { operator_name: "", operator_account: "", operation_type: "", result_status: "", content: "", start_date: "", end_date: "" };
let operationLogPage = 1;
let operationLogPageSize = 10;
let operationLogData = { items: [], total: 0, page: 1, page_size: 10 };
let staffPayrollSearch = "";
let expenseModal = null;
let pricingAuditModal = null;
let lessonCreateDraft = null;
let lessonCreateConflictRequest = 0;
let lessonCreateConflictRows = [];
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
const DATA_CENTER_DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  time: "02:30",
  timezone: "Asia/Shanghai",
  daily_retention: 14,
  monthly_retention: 12,
  manual_retention: 20,
  retry_count: 3,
  local_include_operation_logs: false,
  remote_enabled: false,
  remote_frequency: "weekly",
  remote_time: "03:30",
  remote_timezone: "Asia/Shanghai",
  remote_weekday: 3,
  remote_monthday: 1,
  remote_retention: 20,
  remote_retry_count: 3,
  remote_include_operation_logs: true,
  remote_directory: "/apps/liming-course-system",
  remote_status: "not_configured",
  remote_plaintext_acknowledged: false,
  local_storage_status: "not_created",
});
const DATA_CENTER_DEFAULT_BAIDU = Object.freeze({
  app_key_configured: false,
  app_secret_configured: false,
  redirect_uri_configured: false,
  authorized: false,
  authorization_status: "not_authorized",
  token_status: "not_configured",
  redirect_uri: "",
  callback_route: "/api/data-center/baidu/callback",
  remote_directory: "/apps/liming-course-system",
  missing_items: ["BAIDU_APP_KEY", "BAIDU_APP_SECRET", "BAIDU_REDIRECT_URI"],
  last_test_at: "",
  last_test_result: "not_tested",
  test_passed: false,
});
let backupState = { settings: { ...DATA_CENTER_DEFAULT_SETTINGS }, draft: { ...DATA_CENTER_DEFAULT_SETTINGS }, draftDirty: false, exportIncludeOperationLogs: true, baidu: { ...DATA_CENTER_DEFAULT_BAIDU }, baiduSchedule: { due: false, reason: "disabled" }, baiduConfigEditing: false, baiduTestDetails: null, baiduTestDetailsOpen: false, preflight: null, preflightDetails: null, preflightDetailsOpen: false, preflightDetailsLoading: false, preflightDetailsError: "", records: [], busy: false, error: "", loadError: "", importFile: null, importPreview: null, importMode: "initialize", showBaiduGuide: false, deleteDialog: null, fileBrowser: { open: false, source: "local", loading: false, error: "", items: [], query: "", sort: "modified_desc", cursor: "", hasMore: false, generation: 0 } };
let selectedBackupRecordIds = new Set();
let backupBatchDeleteDialog = null;
let backupDeleteEventsBound = false;
let dashboardRange = readDashboardRange();
let dashboardShortcutModalOpen = false;
let dashboardShortcutDraft = null;
let dashboardTrendChart = null;
let dashboardTrendChartElement = null;
let dashboardTrendResizeObserver = null;
let customSelectEventsBound = false;
let customDateEventsBound = false;
let filterComboEventsBound = false;
let multiSelectEventsBound = false;
let colorConfigPreviewEventsBound = false;
let userMenuEventsBound = false;
let customDatePickerEl = null;
let activeCustomDateInput = null;
let activeCustomDateMonth = null;
let dateRangePickerEl = null;
let activeDateRangePicker = null;
let dateRangePickerEventsBound = false;
let navigationEventsBound = false;
let toastDismissTimer = 0;
let pendingBaiduOAuthNotice = "";

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
  const containers = [...document.querySelectorAll(".toast-container")];
  let container = containers.shift();
  containers.forEach((item) => item.remove());
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  return container;
}

function dismissToast({ removeContainer = true } = {}) {
  clearTimeout(toastDismissTimer);
  toastDismissTimer = 0;
  document.querySelectorAll(".toast-container .toast").forEach((toast) => toast.remove());
  if (removeContainer) document.querySelectorAll(".toast-container").forEach((container) => container.remove());
}

function showToast(message, type = "success") {
  const container = ensureToastContainer();
  let toast = container.querySelector(".toast");
  container.querySelectorAll(".toast").forEach((item) => {
    if (item !== toast) item.remove();
  });
  if (!toast) {
    toast = document.createElement("div");
    container.appendChild(toast);
  }
  toast.className = `toast toast-${type}`;
  toast.textContent = String(message || "操作完成");
  clearTimeout(toastDismissTimer);
  toastDismissTimer = window.setTimeout(() => dismissToast(), 2600);
}

function consumeBaiduOAuthResult() {
  const url = new URL(window.location.href); const result = url.searchParams.get("baidu");
  if (!["connected", "failed", "denied"].includes(result || "") && !url.searchParams.has("code") && !url.searchParams.has("state")) return "";
  url.searchParams.delete("baidu"); url.searchParams.delete("code"); url.searchParams.delete("state");
  const query = url.searchParams.toString(); history.replaceState(history.state, "", `${url.pathname}${query ? `?${query}` : ""}${url.hash}`);
  return result || "";
}

function isCacheableGetRequest(path, options = {}) {
  if (options.cache === false || !String(path).startsWith("/api/")) return false;
  return !String(path).startsWith("/api/auth/");
}

function invalidateRequestCache(prefixes = []) {
  requestCacheRevision += 1;
  if (!prefixes.length) {
    requestCache.clear();
    return;
  }
  for (const key of requestCache.keys()) {
    const path = key.slice(key.lastIndexOf("|") + 1);
    if (prefixes.some((prefix) => path.startsWith(prefix))) requestCache.delete(key);
  }
}

function cacheInvalidationPrefixes(path = "") {
  const base = String(path).split("?")[0];
  if (base.startsWith("/api/student-grade-stages")) return ["/api/student-grade-stages/conflicts", "/api/students", "/api/recharges", "/api/bootstrap", "/api/dashboard", "/api/finance-summary"];
  if (base.startsWith("/api/recharges")) return ["/api/recharges", "/api/bootstrap", "/api/dashboard", "/api/finance-summary"];
  if (base.startsWith("/api/student-pricing")) return ["/api/student-pricing", "/api/lessons-range", "/api/bootstrap", "/api/dashboard", "/api/finance-summary"];
  if (base.startsWith("/api/teacher-salary-rules")) return ["/api/teacher-salary-rules", "/api/lessons-range", "/api/bootstrap", "/api/dashboard", "/api/finance-summary"];
  if (base.startsWith("/api/lessons")) return ["/api/bootstrap", "/api/lessons", "/api/schedule-conflicts", "/api/dashboard", "/api/finance-summary"];
  if (base.startsWith("/api/auth")) return [];
  return [];
}

function requestCacheKey(path) {
  const user = auth.user || {};
  return `${user.id || "guest"}|${user.role || "anonymous"}|${String(path)}`;
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
  const cacheable = method === "GET" && isCacheableGetRequest(path, options);
  const cacheRevision = requestCacheRevision;
  const cacheKey = cacheable ? requestCacheKey(path) : "";
  const now = Date.now();
  const cached = cacheable ? requestCache.get(cacheKey) : null;
  if (cached && cached.expiresAt > now) return cached.data;
  if (cacheable && requestInflight.has(cacheKey)) return requestInflight.get(cacheKey);
  const config = {
    method,
    headers: { "content-type": "application/json" },
    cache: "no-store",
  };
  if (options.body !== undefined) config.body = JSON.stringify(options.body);
  if (options.signal) config.signal = options.signal;
  const run = (async () => {
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
    if (cacheable && cacheRevision === requestCacheRevision) {
      requestCache.set(cacheKey, { data, expiresAt: Date.now() + REQUEST_CACHE_TTL });
    }
    if (method !== "GET") {
      clearStudentQueryCache();
      invalidateRequestCache(cacheInvalidationPrefixes(path));
      if (String(path).startsWith("/api/student-pricing")
        || String(path).startsWith("/api/students")
        || String(path).startsWith("/api/lessons")
        || String(path).startsWith("/api/pricing")
        || String(path).startsWith("/api/fee-overrides")
        || String(path).startsWith("/api/settings")
        || String(path).startsWith("/api/import")
        || String(path).startsWith("/api/data-center/import")
        || String(path).startsWith("/api/audit/apply")) {
        studentPricingPageCache.clear();
      }
    }
    return data;
  })();
  if (cacheable) requestInflight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    if (cacheable) requestInflight.delete(cacheKey);
  }
}

const recentClientOperationLogs = new Map();

function logClientOperation(action, payload = {}) {
  if (!auth.user || !action) return;
  const body = { action, ...payload };
  const dedupeKey = `${action}|${JSON.stringify(body)}`;
  const now = Date.now();
  if (now - Number(recentClientOperationLogs.get(dedupeKey) || 0) < 2000) return;
  recentClientOperationLogs.set(dedupeKey, now);
  fetch("/api/operation-logs/client", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }).catch((error) => {
    console.warn(`操作日志写入失败: ${error.message}`);
  });
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
  if (res.ok && method !== "GET") {
    clearStudentQueryCache();
    invalidateRequestCache(cacheInvalidationPrefixes(path));
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
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.status = res.status;
    error.path = path;
    error.data = data;
    throw error;
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
  schedule: ["lessons", "weekMatrix", "courseNotice", "teacherCourseNotice"],
  scheduleRead: ["lessons", "weekMatrix", "courseNotice", "teacherCourseNotice"],
  students: ["summary", "feeDetails", "studentQuery", "studentProfiles", "studentPricing", "classGroups", "recharges", "openingBalances"],
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
  if ((nextView || "") !== view) {
    closeAllFloatingOverlays();
    dismissToast();
  }
  const previousView = view;
  view = nextView || "";
  if (previousView === "studentPricing" && view !== "studentPricing") {
    cancelStudentPricingPageRequest();
    cancelStudentPricingProgressiveRender();
  }
  if (previousView === "audit" && view !== "audit" && backupState.fileBrowser?.open) {
    backupState.fileBrowser = { ...backupState.fileBrowser, open: false, generation: backupState.fileBrowser.generation + 1 };
  }
  if (view === "teacherDetail" && previousView !== "teacherDetail") {
    selectedTeacherDetail = "";
    selectedTeacherSalaryLessonIds = new Set();
    teacherSalaryBatchResult = null;
    teacherDetailFilter = { grade: "", subject: "", student: "", source: "", rule_status: "" };
  }
  if (view === "studentPricing" && previousView !== "studentPricing") {
    selectedStudentPricingIds = new Set();
    studentPricingBatchModalOpen = false;
  }
  if (view === "teacherSalaryRules" && previousView !== "teacherSalaryRules") {
    selectedTeacherSalaryRuleIds = new Set();
    teacherSalaryRuleBatchModalOpen = false;
  }
  activeNavGroup = view ? groupForView(view).key : "";
  if (activeNavGroup && navExpansionMode !== "all-collapsed") expandedNavGroups.add(activeNavGroup);
  saveExpandedNavGroups();
  if (view) {
    localStorage.setItem("liming:view", view);
    localStorage.setItem("liming:nav-group", activeNavGroup);
  } else {
    clearPagePositionCache();
  }
}

function readExpandedNavGroups() {
  try {
    const saved = JSON.parse(localStorage.getItem(NAV_EXPANDED_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved.filter((key) => navGroups.some((group) => group.key === key)) : []);
  } catch {
    return new Set();
  }
}

function saveExpandedNavGroups() {
  try {
    localStorage.setItem(NAV_EXPANDED_KEY, JSON.stringify([...expandedNavGroups]));
    localStorage.setItem(NAV_EXPANSION_MODE_KEY, navExpansionMode);
  } catch {
    // Navigation remains usable when storage is unavailable.
  }
}

function visibleNavGroups() {
  return navGroups.map((group) => ({
    ...group,
    views: (group.views || []).filter(([key]) => canView(key)),
    moreViews: (group.moreViews || []).filter(([key]) => canView(key)),
  })).filter((group) => group.views.length || group.moreViews.length);
}

function normalizeExpandedNavGroups(groups = visibleNavGroups()) {
  const allowed = new Set(groups.map((group) => group.key));
  const next = new Set([...expandedNavGroups].filter((key) => allowed.has(key)));
  const currentGroup = groupForView(view);
  if (navExpansionMode === "all-expanded") {
    allowed.forEach((key) => next.add(key));
  } else if (navExpansionMode === "initial" && !next.size && currentGroup?.key && allowed.has(currentGroup.key)) {
    // First visit with no saved preference opens the current group once. An explicit
    // all-collapsed preference is distinct from an empty legacy array.
    next.add(currentGroup.key);
    navExpansionMode = "custom";
  }
  const changed = next.size !== expandedNavGroups.size || [...next].some((key) => !expandedNavGroups.has(key));
  expandedNavGroups = next;
  if (changed) saveExpandedNavGroups();
  return next;
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

function customSelectOwner(node) {
  const wrapper = node?.closest?.(".custom-select");
  if (wrapper) return wrapper;
  return node?.closest?.(".custom-select-menu")?._customSelectOwner || null;
}

function customSelectNative(wrapper) {
  return wrapper?._customSelectNative || null;
}

function customSelectSearchInput(wrapper) {
  return customSelectMenu(wrapper)?.querySelector(".custom-select-search-input") || null;
}

function customSelectVisibleOptions(menu) {
  return [...(menu?.querySelectorAll(".custom-select-option:not(:disabled)") || [])]
    .filter((option) => !option.hidden);
}

function customSelectFilterText(value) {
  return normalizeSearchKeyword(value);
}

function normalizeSearchKeyword(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("zh-Hans-CN");
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
  const resultCount = menu.querySelector("[data-custom-select-result-count]");
  if (resultCount) resultCount.textContent = String(visibleCount);
}

function renderCustomSelectBadge(select, value) {
  const field = select?.dataset?.field || "";
  if (field === "status") return renderCourseStatusBadge(value);
  if (field === "grade") return renderGradeBadge(value);
  if (field === "subject") return renderSubjectBadge(value);
  return escapeHtml(value || "请选择");
}

function selectDisplayText(select) {
  const selected = select.selectedOptions?.[0] || select.options?.[select.selectedIndex];
  // 候选列表的标签可带“可选/冲突”，但选择完成后的控件只展示真实 value。
  if (selected?.dataset?.candidateConflict !== undefined) return String(select.value || "").trim() || "请选择";
  return selected?.textContent?.trim() || "请选择";
}

function syncCustomSelect(select, wrapper) {
  const valueNode = wrapper.querySelector(".custom-select-value");
  const field = select.dataset.field || "";
  if (["status", "grade", "subject"].includes(field)) valueNode.innerHTML = renderCustomSelectBadge(select, selectDisplayText(select));
  else valueNode.textContent = selectDisplayText(select);
  const selectedOption = select.selectedOptions?.[0] || select.options?.[select.selectedIndex];
  wrapper.classList.toggle("candidate-conflict", selectedOption?.dataset?.candidateConflict === "1");
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

function closeSearchablePicker() {
  closeCustomSelects();
  closeOpenMultiSelectMenus();
  closeCustomDatePicker();
}

function closeAllFloatingOverlays() {
  closeCustomSelects();
  closeOpenMultiSelectMenus();
  document.querySelectorAll(".floating-multi-select-menu").forEach((menu) => {
    const owner = menu._multiSelectOwner;
    if (owner?.isConnected) closeMultiSelectMenu(owner);
    else menu.remove();
  });
  cleanupCustomSelectPortals();
  closeCustomDatePicker();
  closeDateRangePicker();
  closeRechargeChannelOverlay();
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
      select.classList.contains("inline-status-select") ? "custom-select-inline-status" : "",
      select.dataset.field ? `custom-select-field-${select.dataset.field}` : "",
    ].filter(Boolean).join(" ");
    if (select.style.width) wrapper.style.width = select.style.width;
    if (select.style.marginTop) wrapper.style.marginTop = select.style.marginTop;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "custom-select-button";
    button.disabled = select.disabled;
    button.setAttribute("aria-disabled", select.disabled ? "true" : "false");
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = `<span class="custom-select-value"></span><span class="custom-select-arrow" aria-hidden="true"></span>`;

    const menu = document.createElement("div");
    menu.className = "custom-select-menu";
    menu.dataset.selectPortal = "1";
    menu.setAttribute("role", "listbox");
    menu._customSelectOwner = wrapper;
    wrapper._customSelectMenu = menu;
    wrapper._customSelectNative = select;

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
    emptyOption.textContent = "暂无匹配结果";
    const resultCount = document.createElement("div");
    resultCount.className = "custom-select-result-count";
    resultCount.innerHTML = `当前结果 <b data-custom-select-result-count>0</b> 项`;
    menu.append(searchWrap, resultCount, emptyOption);

    [...select.options].forEach((nativeOption) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "custom-select-option";
      option.dataset.value = nativeOption.value;
      option.setAttribute("role", "option");
      option.disabled = nativeOption.disabled;
      const field = select.dataset.field || "";
      const isCandidateOption = nativeOption.dataset.candidateConflict !== undefined && ["time_slot", "classroom"].includes(field);
      if (isCandidateOption) {
        option.classList.add("candidate-option");
        const valueNode = document.createElement("span");
        valueNode.className = "custom-select-candidate-value";
        valueNode.textContent = nativeOption.value;
        const stateNode = document.createElement("span");
        stateNode.className = "custom-select-candidate-state";
        stateNode.textContent = nativeOption.dataset.candidateConflict === "1" ? "冲突" : "可选";
        option.append(valueNode, stateNode);
      } else if (["status", "grade", "subject"].includes(field)) {
        const rawValue = nativeOption.dataset.candidateConflict !== undefined ? nativeOption.value : nativeOption.textContent;
        option.innerHTML = renderCustomSelectBadge(select, rawValue);
      } else option.textContent = nativeOption.textContent;
      if (nativeOption.title) option.title = nativeOption.title;
      if (nativeOption.dataset.candidateConflict === "1") option.classList.add("candidate-conflict", "option-conflict");
      menu.appendChild(option);
    });

    wrapper.append(button);
    select.insertAdjacentElement("afterend", wrapper);
    document.body.appendChild(menu);
    syncCustomSelect(select, wrapper);
  });

  if (!customSelectEventsBound) {
    customSelectEventsBound = true;
    document.addEventListener("click", (event) => {
      const option = event.target.closest(".custom-select-option");
      if (option) {
        const wrapper = customSelectOwner(option);
        const select = customSelectNative(wrapper);
        if (!wrapper || !select || option.disabled) return;
        select.value = option.dataset.value || "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        if (wrapper.isConnected) syncCustomSelect(select, wrapper);
        closeCustomSelects();
        return;
      }

      const clear = event.target.closest(".custom-select-search-clear");
      if (clear) {
        const wrapper = customSelectOwner(clear);
        const input = customSelectSearchInput(wrapper);
        if (!wrapper || !input) return;
        input.value = "";
        filterCustomSelectOptions(wrapper);
        input.focus({ preventScroll: true });
        return;
      }

      const button = event.target.closest(".custom-select-button");
      if (button) {
        const wrapper = customSelectOwner(button);
        if (!wrapper) return;
        const willOpen = !wrapper.classList.contains("open");
        closeCustomSelects(wrapper);
        if (willOpen) openCustomSelect(wrapper);
        else {
          wrapper.classList.remove("open", "open-up");
          customSelectMenu(wrapper)?.classList.remove("open", "open-up");
          button.setAttribute("aria-expanded", "false");
        }
        return;
      }

      if (!event.target.closest(".custom-select") && !event.target.closest(".custom-select-menu")) closeCustomSelects();
    });
    document.addEventListener("compositionstart", (event) => {
      if (event.target.matches?.(".custom-select-search-input")) event.target.dataset.composing = "1";
    });
    document.addEventListener("compositionend", (event) => {
      if (!event.target.matches?.(".custom-select-search-input")) return;
      event.target.dataset.composing = "0";
      filterCustomSelectOptions(customSelectOwner(event.target));
    });
    document.addEventListener("input", (event) => {
      if (!event.target.matches?.(".custom-select-search-input") || event.target.dataset.composing === "1") return;
      filterCustomSelectOptions(customSelectOwner(event.target));
    });
    document.addEventListener("keydown", (event) => {
      const wrapper = customSelectOwner(event.target);
      if (!wrapper) return;
      const button = wrapper.querySelector(".custom-select-button");
      const menu = customSelectMenu(wrapper);
      const optionsList = customSelectVisibleOptions(menu);
      if (event.target.matches?.(".custom-select-search-input")) {
        if (event.key === "Escape") {
          event.stopPropagation();
          closeCustomSelects();
          button?.focus();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          optionsList[0]?.focus();
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          optionsList[optionsList.length - 1]?.focus();
        } else if (event.key === "Enter") {
          event.preventDefault();
          (menu?.querySelector(".custom-select-option.selected:not([hidden])") || optionsList[0])?.click();
        }
        return;
      }
      if (event.target.closest?.(".custom-select-button")) {
        if (event.key === "Escape") {
          event.stopPropagation();
          closeCustomSelects();
          button?.focus();
        } else if (["ArrowDown", "Enter", " "].includes(event.key)) {
          event.preventDefault();
          openCustomSelect(wrapper);
          customSelectSearchInput(wrapper)?.focus({ preventScroll: true });
        }
        return;
      }
      if (!event.target.closest?.(".custom-select-menu")) return;
      const currentIndex = optionsList.indexOf(document.activeElement);
      if (event.key === "Escape") {
        event.stopPropagation();
        closeCustomSelects();
        button?.focus();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        optionsList[Math.min(optionsList.length - 1, currentIndex + 1)]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (currentIndex <= 0) customSelectSearchInput(wrapper)?.focus({ preventScroll: true });
        else optionsList[Math.max(0, currentIndex - 1)]?.focus();
      }
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
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
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
      input.removeAttribute("aria-invalid");
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
    if (input.dataset.customDate === "1" || input.dataset.nativeDate === "1") return;
    input.dataset.dateKind = input.dataset.dateKind || "single";
    if (input.dataset.dateKind !== "single") return;
    input.dataset.customDate = "1";
    input.type = "text";
    const editable = !input.disabled && !input.readOnly && input.dataset.dateInputMode !== "picker-only";
    input.readOnly = !editable;
    if (editable) {
      input.inputMode = "numeric";
      input.maxLength = 10;
      input.pattern = "\\d{4}-\\d{2}-\\d{2}";
      input.title = "请输入 YYYY-MM-DD 格式的日期";
    }
    input.placeholder = "选择日期";
    input.classList.add("custom-date-input");
    input.setAttribute("aria-haspopup", "dialog");
    input.setAttribute("aria-expanded", "false");
    input.addEventListener("click", () => openCustomDatePicker(input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeCustomDatePicker();
      } else if (editable && event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "ArrowDown" || (!editable && (event.key === "Enter" || event.key === " "))) {
        event.preventDefault();
        openCustomDatePicker(input);
      }
    });
    input.addEventListener("input", () => {
      const value = String(input.value || "").trim();
      if (!value || isDateValue(value)) input.removeAttribute("aria-invalid");
    });
    input.addEventListener("blur", () => {
      const value = String(input.value || "").trim();
      if (value && !isDateValue(value)) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
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
    teacher_detail_teachers: keepPreviousPageData ? previousState.teacher_detail_teachers || [] : [],
    profile_students: keepPreviousPageData ? previousState.profile_students || [] : [],
    student_grade_stage_conflicts: keepPreviousPageData ? previousState.student_grade_stage_conflicts || [] : [],
    users: keepPreviousPageData ? previousState.users || [] : [],
    roles: keepPreviousPageData ? previousState.roles || [] : [],
    permission_tree: keepPreviousPageData ? previousState.permission_tree || [] : [],
    staff: keepPreviousPageData ? previousState.staff || [] : [],
    staff_salary: keepPreviousPageData ? previousState.staff_salary || [] : [],
    staff_attendance: keepPreviousPageData ? previousState.staff_attendance || [] : [],
    expenses: keepPreviousPageData ? previousState.expenses || [] : [],
    class_groups: keepPreviousPageData ? previousState.class_groups || [] : [],
    schedule_conflicts: keepPreviousPageData
      ? previousState.schedule_conflicts || { issues: [], counts: { teacher: 0, student: 0, classroom: 0, invalid_time: 0 } }
      : { issues: [], counts: { teacher: 0, student: 0, classroom: 0, invalid_time: 0 } },
    student_history: keepPreviousPageData ? previousState.student_history || [] : [],
    student_statement: keepPreviousPageData ? previousState.student_statement || null : null,
  };
  return next;
}

function fullBootstrapCacheKey(monthKey = activeMonth) {
  return `${String(monthKey || "")}\u0001${includeInactive ? "all" : "active"}`;
}

function viewNeedsFullBootstrap(viewKey = view) {
  return ["feeDetails", "summary", "teacherSalary", "teacherTravelFees"].includes(viewKey)
    || (viewKey === "pricing" && Boolean(pricingAuditModal));
}

function viewNeedsProfileTeachers(viewKey = view) {
  return [
    "lessons", "weekMatrix", "courseNotice", "teacherCourseNotice",
    "teacherProfiles", "teacherDetail", "teacherSalary", "teacherTravelFees", "teacherSalaryRules", "classGroups", "userAdmin",
  ].includes(viewKey);
}

function viewNeedsProfileStudents(viewKey = view) {
  return [
    "lessons",
    "recharges", "openingBalances", "studentQuery", "studentProfiles",
    "teacherSalaryRules", "classGroups",
  ].includes(viewKey);
}

function viewNeedsLessonRange(viewKey = view) {
  return ["lessons", "teacherDetail"].includes(viewKey);
}

function viewNeedsWeekLessons(viewKey = view) {
  return ["weekMatrix"].includes(viewKey);
}

function viewNeedsScheduleConflicts(viewKey = view) {
  return ["lessons", "weekMatrix"].includes(viewKey);
}

function bootstrapQuery(lite = true) {
  const params = new URLSearchParams();
  if (activeMonth) params.set("month", activeMonth);
  if (includeInactive) params.set("include_inactive", "1");
  if (lite) params.set("lite", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

function studentPricingPageCacheKey(monthKey = activeMonth) {
  return `${Number(auth.user?.id || 0)}\u0001${auth.user?.role || ""}\u0001${monthKey || ""}`;
}

function prepareStudentPricingRule(row = {}) {
  const studentNames = String(row.student_names || "");
  return {
    ...row,
    id: Number(row.id),
    custom_price: numberValue(row.custom_price),
    current_month_lessons: Number(row.current_month_lessons || 0),
    total_lessons: Number(row.total_lessons || 0),
    _student_key: String(row.student_name || "").trim().toLocaleLowerCase("zh-CN"),
    _grade_key: String(row.grade || "").trim().toLocaleLowerCase("zh-CN"),
    _subject_key: String(row.subject || "").trim().toLocaleLowerCase("zh-CN"),
    _student_names_key: studentNames.trim().toLocaleLowerCase("zh-CN"),
    _students: splitStudents(studentNames),
  };
}

function prepareStudentPricingPage(data = {}) {
  return {
    ...data,
    rules: (data.rules || []).map(prepareStudentPricingRule),
    filters: {
      students: data.filters?.students || [],
      grades: data.filters?.grades || [],
      subjects: data.filters?.subjects || [],
      student_groups: data.filters?.student_groups || [],
    },
  };
}

function cancelStudentPricingPageRequest() {
  if (!studentPricingPageRequest) return;
  studentPricingPageRequest.controller.abort();
  studentPricingPageRequest = null;
}

async function loadStudentPricingPage({ force = false } = {}) {
  const key = studentPricingPageCacheKey();
  const cached = studentPricingPageCache.get(key);
  if (!force && cached && cached.expires_at > Date.now()) return cached.data;
  if (studentPricingPageRequest?.key === key && !force) return studentPricingPageRequest.promise;
  cancelStudentPricingPageRequest();
  if (force) studentPricingPageCache.delete(key);
  const controller = new AbortController();
  const promise = request(`/api/student-pricing-page?month=${encodeURIComponent(activeMonth)}`, {
    cache: false,
    signal: controller.signal,
  }).then((data) => {
    const prepared = prepareStudentPricingPage(data);
    studentPricingPageCache.set(key, {
      data: prepared,
      expires_at: Date.now() + STUDENT_PRICING_CLIENT_CACHE_TTL_MS,
    });
    return prepared;
  }).finally(() => {
    if (studentPricingPageRequest?.controller === controller) studentPricingPageRequest = null;
  });
  studentPricingPageRequest = { key, controller, promise };
  return promise;
}

async function loadActiveViewData({ refreshGlobal = false, fullBootstrap = false, generation = loadGeneration } = {}) {
  const stillCurrent = () => loadGeneration === generation;
  const stageConflictsPromise = view === "studentProfiles" && canView("studentProfiles")
    ? refreshStudentGradeStageConflicts({ renderStatus: false, generation })
    : null;

  const [teachersResult, studentsResult, teacherDetailTeachersResult, studentPricingResult] = await Promise.all([
    viewNeedsProfileTeachers() && view !== "teacherDetail" ? request("/api/teachers") : null,
    viewNeedsProfileStudents() && canArea("students") ? request("/api/students") : null,
    view === "teacherDetail" ? request("/api/teacher-detail/teachers", { cache: false }) : null,
    view === "studentPricing" && canView("studentPricing") ? loadStudentPricingPage() : null,
  ]);
  if (!stillCurrent()) return false;
  if (teachersResult) state.profile_teachers = teachersResult.teachers || [];
  if (studentsResult) state.profile_students = studentsResult.students || [];
  if (studentPricingResult) {
    state.student_pricing = studentPricingResult.rules || [];
    state.student_pricing_filters = studentPricingResult.filters || {};
  }
  if (teacherDetailTeachersResult) {
    state.teacher_detail_teachers = teacherDetailTeachersResult.teachers || [];
    const candidateNames = new Set(state.teacher_detail_teachers.map((row) => row.name));
    if (selectedTeacherDetail && !candidateNames.has(selectedTeacherDetail)) {
      selectedTeacherDetail = "";
      selectedTeacherSalaryLessonIds = new Set();
      teacherSalaryBatchResult = null;
    }
  }
  if (stageConflictsPromise) await stageConflictsPromise;
  if (!stillCurrent()) return false;

  if (viewNeedsLessonRange()) {
    const lessonRange = lessonLoadRange();
    if (view === "teacherDetail" && !selectedTeacherDetail) {
      state.lessons = [];
      state.lesson_loaded_range = lessonRange || null;
    } else if (lessonRange) {
      const lessonsResult = await request(
        lessonsRangeUrl(lessonRange, lessonDataViewKey()),
        view === "teacherDetail" ? { cache: false } : {},
      );
      if (!stillCurrent()) return false;
      state.lessons = lessonsResult.lessons || [];
      state.lesson_loaded_range = lessonRange;
    }
  }

  if (viewNeedsWeekLessons()) {
    ensureMatrixRange();
    const matrixStart = matrixRange.start;
    const matrixEnd = matrixRange.end;
    if (matrixStart && matrixEnd) {
      const weekViewKey = "weekMatrix";
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

  if (view === "classGroups") {
    state.class_groups = canView("classGroups") ? ((await request("/api/class-groups")).class_groups || []) : [];
    if (!stillCurrent()) return false;
  }

  if (view === "teacherSalaryRules") {
    state.teacher_salary_rules = canView("teacherSalaryRules") ? ((await request("/api/teacher-salary-rules")).rules || []) : [];
    if (!stillCurrent()) return false;
  }

  if (view === "audit") {
    if (canArea("audit")) {
      await refreshBackupData({ tolerateFailure: true });
      if (!stillCurrent()) return false;
    } else {
      backupState = { ...backupState, settings: { ...DATA_CENTER_DEFAULT_SETTINGS }, records: [], error: "", loadError: "" };
    }
  }

  if (view === "userAdmin") {
    const [usersResult, rolesResult] = await Promise.all([
      canArea("users") ? request("/api/users") : Promise.resolve({ users: [], roles: {} }),
      auth.user?.role === "owner"
        ? request("/api/roles")
        : Promise.resolve({ roles: [], permission_tree: auth.permission_tree || state.permission_tree || [] }),
    ]);
    if (!stillCurrent()) return false;
    state.users = usersResult.users || [];
    auth.roles = usersResult.roles || auth.roles || ROLE_LABELS;
    state.roles = rolesResult.roles || [];
    state.permission_tree = rolesResult.permission_tree || state.permission_tree || [];
  } else if (refreshGlobal && !state.permission_tree?.length) {
    state.permission_tree = auth.permission_tree || [];
  }

  if (view === "staffPayroll" || view === "staffAttendance") {
    const [staffResult, salaryResult, attendanceResult] = await Promise.all([
      canArea("staff") ? request("/api/staff") : Promise.resolve({ staff: [] }),
      canArea("staff") ? request(`/api/staff-salary?month=${encodeURIComponent(activeMonth)}`) : Promise.resolve({ rows: [] }),
      canArea("staff") ? request(`/api/staff-attendance?month=${encodeURIComponent(activeMonth)}`) : Promise.resolve({ rows: [] }),
    ]);
    if (!stillCurrent()) return false;
    state.staff = staffResult.staff || [];
    state.staff_salary = salaryResult.rows || [];
    state.staff_attendance = attendanceResult.rows || [];
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
    state.student_history = [];
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
  clearStudentQueryCache();
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
  if (!pendingBaiduOAuthNotice) pendingBaiduOAuthNotice = consumeBaiduOAuthResult();
  if (!auth.user) return renderLogin();
  if (pendingBaiduOAuthNotice && canView("audit")) setActiveView("audit");
  if (!ensureAccessibleView()) return;
  if (refreshGlobal || !months.length) {
    months = await request("/api/months");
    if (loadGeneration !== thisGeneration) return;
  }
  const fullBootstrap = viewNeedsFullBootstrap();
  // Navigation retains the session bootstrap. View-specific endpoints below
  // own fresh data; login, refresh and explicit callers still reload it.
  const requestedFullKey = fullBootstrapCacheKey(activeMonth || previousState.active_month_key || previousState.settings?.month_key);
  const refreshBootstrap = refreshGlobal || !previousState.settings || options.refreshBootstrap === true
    || (fullBootstrap && previousState.full_bootstrap_key !== requestedFullKey);
  if (refreshBootstrap) {
    state = normalizeBootstrapState(
      await request(`/api/bootstrap${bootstrapQuery(!fullBootstrap)}`),
      previousState,
      !fullBootstrap,
    );
    if (loadGeneration !== thisGeneration) return;
    if (fullBootstrap) state.full_bootstrap_key = fullBootstrapCacheKey(state.active_month_key || state.settings?.month_key || activeMonth);
  } else {
    state = previousState;
  }
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
  if (pendingBaiduOAuthNotice) {
    const result = pendingBaiduOAuthNotice; pendingBaiduOAuthNotice = "";
    showToast(result === "connected" ? "百度网盘连接成功" : result === "denied" ? "百度网盘授权已取消" : "百度网盘连接失败", result === "connected" ? "success" : "error");
  }
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
  if (preset === "yesterday") {
    const yesterday = addDays(today, -1);
    return { start: yesterday, end: yesterday };
  }
  if (preset === "today") return { start: today, end: today };
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
    <span class="date-range-picker ${hasValue ? "has-value" : ""} ${disabled ? "disabled" : ""}" data-date-kind="range" data-range-scope="${escapeHtml(scope || "")}" data-start-field="${escapeHtml(startField)}" data-end-field="${escapeHtml(endField)}" data-start="${escapeHtml(start || "")}" data-end="${escapeHtml(end || "")}">
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
    if (!activeDateRangePicker.anchor) return;
    if (activeDateRangePicker.hover === day.dataset.rangeDate) return;
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
    ["yesterday", "昨日"],
    ["today", "今日"],
    ["current-month", "本月"],
    ["current-week", "本周"],
    ["prev-month", "上月"],
    ["prev-week", "上周"],
    ["last-3-months", "近三个月"],
    ["last-year", "近一年"],
    ["prev-year", "去年"],
    ["current-year", "今年"],
  ];
  const presetScrollTop = picker.querySelector(".date-range-presets")?.scrollTop || 0;
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
  const presetList = picker.querySelector(".date-range-presets");
  if (presetList) presetList.scrollTop = presetScrollTop;
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
    activeDateRangePicker.wrapper.dataset.start = state.start || "";
    activeDateRangePicker.wrapper.dataset.end = state.end || "";
    activeDateRangePicker.wrapper.classList.toggle("has-value", Boolean(state.start || state.end));
    syncDateRangeTriggerText(activeDateRangePicker.wrapper, state.start || "", state.end || "");
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
  wrapper.dataset.start = "";
  wrapper.dataset.end = "";
  wrapper.classList.remove("has-value");
  syncDateRangeTriggerText(wrapper, "", "");
  closeDateRangePicker();
  await applyDateRangeToScope(wrapper.dataset.rangeScope || "", "", "");
}

async function applyDateRangeToScope(scope, start, end) {
  if (scope === "lesson") {
    focusedLessonIds = [];
    lessonFilter = { ...lessonFilter, start_date: start, end_date: end, date_preset_initialized: true };
    saveLessonFilter();
    await refreshLessonsView({ reloadRange: !lessonRangeLoaded() });
    return;
  }
  if (scope === "fee-details") {
    feeDetailsFilter = { ...feeDetailsFilter, start, end };
    render();
    return;
  }
  if (scope === "recharges") {
    rechargeDateFilter = { start, end };
    render();
    return;
  }
  if (scope === "matrix") {
    const fallback = currentMatrixRange(state?.settings?.month_key || activeMonth);
    matrixRange = {
      month_key: matrixRange.month_key || state?.settings?.month_key || activeMonth,
      start: start || fallback.start,
      end: end || fallback.end,
    };
    localStorage.setItem(MATRIX_RANGE_USER_SET_KEY, "1");
    saveMatrixRange();
    await refreshWeekMatrixView({ reloadRange: true });
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
    studentQueryRange = start && end
      ? { ...studentQueryRange, mode: "range", start, end }
      : { ...studentQueryRange, mode: "all" };
    saveStudentQueryRange();
    await refreshStudentQueryOnly();
    return;
  }
  if (scope === "finance") {
    if (start && end) financeRange = { ...financeRange, start, end, preset: "custom" };
    else financeRange = monthScopedFinanceRange("month");
    saveFinanceRange();
    await refreshFinanceForActiveMonth({ resetToActiveMonth: false });
    return;
  }
  if (scope === "expenses") {
    expenseFilter = { ...expenseFilter, start, end };
    localStorage.setItem("liming:expense-filter", JSON.stringify(expenseFilter));
    await refreshExpensesForActiveMonth({ keepRange: true });
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
    await refreshDashboardForActiveMonth();
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
    logClientOperation("parent_notice_generate", {
      content: `生成家长课程通知：${courseNoticeFilter.start} 至 ${courseNoticeFilter.end}`,
      target_type: "course_notice",
      target_id: `${courseNoticeFilter.start}|${courseNoticeFilter.end}`,
      details: { start: courseNoticeFilter.start, end: courseNoticeFilter.end, object_count: (data.send_objects || data.items || []).length },
    });
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
  if (teacherCourseNoticeState.loadedQuery && teacherCourseNoticeState.loadedQuery !== query) teacherCourseNoticeSimpleActions = {};
  teacherCourseNoticeState = { ...teacherCourseNoticeState, busy: true, error: "" };
  render();
  try {
    const data = await request(`/api/teacher-course-notice?${query}`);
    teacherCourseNoticeState = { data, busy: false, error: "", loadedQuery: query };
    logClientOperation("teacher_notice_generate", {
      content: `生成老师课程通知：${teacherCourseNoticeFilter.start} 至 ${teacherCourseNoticeFilter.end}`,
      target_type: "teacher_course_notice",
      target_id: `${teacherCourseNoticeFilter.start}|${teacherCourseNoticeFilter.end}`,
      details: { start: teacherCourseNoticeFilter.start, end: teacherCourseNoticeFilter.end, object_count: (data.send_objects || data.items || []).length },
    });
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
  let source = value;
  if (typeof source === "string") {
    const raw = source.trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) source = parsed;
      } catch {
        // Historical delimiter strings continue through the normal parser.
      }
    }
  }
  if (Array.isArray(source)) return source.flatMap((item) => splitStudents(item));
  return String(source || "")
    .split(/[、,，;；\n\r]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function studentSetInlineText(value) {
  return studentSetNames(value).join("、") || "—";
}

function studentSetNames(value) {
  const seen = new Set();
  const names = [];
  for (const name of splitStudents(value)) {
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function renderStudentSetBadges(value, options = {}) {
  const names = studentSetNames(value);
  if (!names.length) return '<span class="student-set-badges student-set-empty">—</span>';
  return `<span class="student-set-badges">${names.map((name) => renderStudentBadge(name, options)).join("")}</span>`;
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

function teacherProfileForName(name) {
  const teacherName = String(name || "").trim();
  return (state?.profile_teachers || []).find((row) => String(row.name || "").trim() === teacherName) || null;
}

function isActiveTeacherName(name) {
  const profile = teacherProfileForName(name);
  if (!profile) return true;
  return String(profile.status || "在职").trim() === "在职";
}

function classGroupMatchesFilter(row, filter = classGroupFilter) {
  if (classGroupHideInactiveTeachers && !isActiveTeacherName(row.teacher)) return false;
  if (filter.teacher && !textContains(row.teacher, filter.teacher)) return false;
  if (filter.grade && !textContains(row.grade, filter.grade)) return false;
  if (filter.subject && !textContains(row.subject, filter.subject)) return false;
  if (filter.student && !textContains(row.students_display, filter.student)) return false;
  return true;
}

function dynamicClassGroupFilterOptions(rows, filter = classGroupFilter) {
  return {
    teachers: uniqueSorted(rowsForFilterOption(rows, filter, "teacher", classGroupMatchesFilter).map((row) => row.teacher)),
    grades: uniqueSorted(rowsForFilterOption(rows, filter, "grade", classGroupMatchesFilter).map((row) => row.grade)),
    subjects: uniqueSorted(rowsForFilterOption(rows, filter, "subject", classGroupMatchesFilter).map((row) => row.subject)),
    students: uniqueSorted(rowsForFilterOption(rows, filter, "student", classGroupMatchesFilter).flatMap((row) => splitStudents(row.students_display))),
  };
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
  const range = parseLessonTimeRange(timeSlot);
  return range ? (range.end - range.start) / 60 : null;
}

function teacherSalaryRuleCalculation(lesson) {
  if ((lesson.rule_match_status || lesson.teacher_salary_rule_status) !== "matched") return null;
  const salary = optionalNumberValue(lesson.rule_salary);
  if (salary == null) return null;
  return {
    rule: {
      id: lesson.rule_salary_rule_id,
      salary_per_unit: lesson.rule_salary_per_unit,
      unit_hours: lesson.rule_salary_unit_hours,
    },
    salary,
    warning: lesson.rule_salary_warning || "",
  };
}

function displayTeacherSalaryForLesson(lesson) {
  return isCompletedLesson(lesson) ? numberValue(lesson.teacher_salary) : 0;
}

function displayTeacherRuleSalaryForLesson(lesson) {
  const calculated = teacherSalaryRuleCalculation(lesson);
  return calculated ? calculated.salary : null;
}

function teacherSalarySourceLabel(lesson) {
  if (!isCompletedLesson(lesson)) return "自动";
  const calculated = teacherSalaryRuleCalculation(lesson);
  const ruleSalary = calculated ? calculated.salary : null;
  const current = displayTeacherSalaryForLesson(lesson);
  if (ruleSalary == null) return current === 0 ? "未设置" : "手动";
  return Math.abs(current - ruleSalary) < 0.005 ? "自动" : "手动";
}

function teacherSalarySourceTitle(lesson) {
  if (!isCompletedLesson(lesson)) return "非已上课程教师薪资自动按 0 处理";
  const label = teacherSalarySourceLabel(lesson);
  const amount = formatMoney(displayTeacherSalaryForLesson(lesson));
  const ruleSalary = displayTeacherRuleSalaryForLesson(lesson);
  const rule = ruleSalary == null ? "" : `，规则薪资 ${formatMoney(ruleSalary)}`;
  if (label === "未设置") return "已上课程未设置有效薪资规则";
  if (label === "手动") return `当前薪资 ${amount}${rule}，与规则不一致，视为手动`;
  return `系统自动薪资 ${amount}${rule}`;
}

function teacherSalarySourceBadge(lesson) {
  return sourceStatusBadge(teacherSalarySourceLabel(lesson), teacherSalarySourceTitle(lesson));
}

function teacherSalaryRuleDisableReason(lesson) {
  const reasons = {
    not_matched: "未找到教师、年级、科目和学生集合完全一致的规则",
    rule_unavailable: "匹配规则当前不可用",
    ambiguous: "存在多条完全匹配的有效规则",
    calculation_error: "规则薪资无法计算",
  };
  const status = lesson.rule_match_status || lesson.teacher_salary_rule_status;
  return lesson.rule_match_reason || lesson.teacher_salary_rule_reason || reasons[status] || "未设置有效薪资规则";
}

function teacherSalaryRuleStatusForLesson(lesson) {
  const status = lesson.rule_match_status || lesson.teacher_salary_rule_status;
  return {
    matched: lesson.payroll_eligible === false ? "已匹配（不参与计薪）" : "已匹配",
    not_matched: "未匹配",
    rule_unavailable: "规则不可用",
    ambiguous: "存在多条匹配规则",
    calculation_error: "无法计算",
  }[status] || "未匹配";
}

function teacherSalaryRuleDiagnosticMarkup(lesson) {
  const status = lesson.rule_match_status || lesson.teacher_salary_rule_status;
  if (status === "matched") return "";
  const diagnostics = lesson.rule_match_diagnostics || {};
  const items = [
    ["教师", diagnostics.teacher],
    ["年级", diagnostics.grade],
    ["科目", diagnostics.subject],
    ["学生集合", diagnostics.students],
    ["规则状态", diagnostics.rule_status],
    ["规则日期", diagnostics.rule_date],
    ["课程时长", diagnostics.lesson_duration],
    ["课程状态", diagnostics.course_status],
  ];
  return `
    <details class="teacher-rule-match-details">
      <summary>查看匹配详情</summary>
      <div class="teacher-rule-match-grid">
        ${items.map(([label, value]) => `<span><b>${label}</b>${escapeHtml(value || "未知")}</span>`).join("")}
      </div>
    </details>
  `;
}

function teacherSalaryRuleCellMarkup(lesson) {
  const status = lesson.rule_match_status || lesson.teacher_salary_rule_status;
  const salary = optionalNumberValue(lesson.rule_salary);
  const reason = teacherSalaryRuleDisableReason(lesson);
  if (status === "matched" && salary != null) {
    return `
      <div class="teacher-rule-result matched">
        <strong>${formatMoney(salary)}</strong>
        ${lesson.payroll_eligible === false ? `<small>当前状态不参与计薪</small>` : ""}
      </div>
    `;
  }
  const label = {
    not_matched: "未匹配",
    rule_unavailable: "规则不可用",
    ambiguous: "存在多条匹配规则",
    calculation_error: "无法计算",
  }[status] || "未匹配";
  return `
    <div class="teacher-rule-result ${escapeHtml(status || "not_matched")}">
      <strong>${label}</strong>
      <small>${escapeHtml(reason)}</small>
      ${teacherSalaryRuleDiagnosticMarkup(lesson)}
    </div>
  `;
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

function visiblePriceStatus(amount, isActive = 1) {
  return Number(isActive) !== 0 && optionalNumberValue(amount) > 0 ? "已设置" : "未设置";
}

function visiblePriceStatusBadge(status) {
  const normalized = status === "已设置" ? "已设置" : "未设置";
  return `<span class="visible-price-status ${normalized === "已设置" ? "is-set" : "is-unset"}">${normalized}</span>`;
}

function studentPricingVisibleStatus(rule) {
  return rule.price_status === "已设置" || rule.price_status === "未设置"
    ? rule.price_status
    : visiblePriceStatus(rule.custom_price);
}

function teacherSalaryRuleSalaryStatus(rule) {
  return teacherSalaryRuleEnabled(rule) && optionalNumberValue(rule.salary_per_unit) != null ? "已设置" : "未设置";
}

function teacherSalaryRuleEnabled(rule) {
  if (typeof rule.effective_is_active === "boolean") return rule.effective_is_active;
  const raw = String(rule.is_active ?? "").trim().toLowerCase();
  if (["1", "true", "启用", "在用", "enabled", "active", "on"].includes(raw)) return true;
  if (["-1", "false", "停用", "禁用", "disabled", "inactive", "off"].includes(raw)) return false;
  return raw === "0" && (optionalNumberValue(rule.salary_per_unit) || 0) > 0;
}

function teacherSalaryRuleMatchesFilter(rule, filter = teacherSalaryRuleFilter) {
  if (teacherSalaryRuleHideInactiveTeachers && !isActiveTeacherName(rule.teacher_name)) return false;
  if (filter.teacher && !textContains(rule.teacher_name, filter.teacher)) return false;
  if (filter.grade && !textContains(rule.grade, filter.grade)) return false;
  if (filter.subject && !textContains(rule.subject, filter.subject)) return false;
  if (filter.student && ![rule.student_names, rule.teacher_name, rule.grade, rule.subject, rule.notes].some((value) => textContains(value, filter.student))) return false;
  if (filter.salary_status && teacherSalaryRuleSalaryStatus(rule) !== filter.salary_status) return false;
  return true;
}

function dynamicTeacherSalaryRuleFilterOptions(rules, filter = teacherSalaryRuleFilter) {
  return {
    teachers: uniqueSorted(rowsForFilterOption(rules, filter, "teacher", teacherSalaryRuleMatchesFilter).map((rule) => rule.teacher_name)),
    grades: uniqueSorted(rowsForFilterOption(rules, filter, "grade", teacherSalaryRuleMatchesFilter).map((rule) => rule.grade)),
    subjects: uniqueSorted(rowsForFilterOption(rules, filter, "subject", teacherSalaryRuleMatchesFilter).map((rule) => rule.subject)),
    students: uniqueSorted(rowsForFilterOption(rules, filter, "student", teacherSalaryRuleMatchesFilter).flatMap((rule) => splitStudents(rule.student_names))),
    salaryStatuses: ["已设置", "未设置"],
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

function normalizeStudentStatus(value = "") {
  const status = String(value || "").trim();
  return status === "离校" ? "已流出" : status;
}

function compareStudentProfile(a = {}, b = {}) {
  const statusRank = (status) => {
    const index = studentStatusOptions.indexOf(normalizeStudentStatus(status));
    return index === -1 ? studentStatusOptions.length : index;
  };
  const gradeRank = (row) => {
    const index = gradeOrder.indexOf(studentCurrentGrade(row));
    return index === -1 ? gradeOrder.length : index;
  };
  return statusRank(a.status) - statusRank(b.status)
    || gradeRank(a) - gradeRank(b)
    || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN")
    || Number(a.id || 0) - Number(b.id || 0);
}

function sortStudentProfiles(rows = []) {
  return [...rows].sort(compareStudentProfile);
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
    teacherSalaryRuleCandidateSync = { requested: true, busy: false, result: null, error: error.message || "同步薪资规则候选失败" };
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

function studentStatementCacheKey(studentName = selectedStudent, range = currentStudentQueryRange()) {
  return `${String(studentName || "").trim()}|${range.start || ""}|${range.end || ""}`;
}

function clearStudentQueryCache() {
  studentStatementCache.clear();
  studentQueryRequestGeneration += 1;
}

async function fetchStudentStatement(studentName = selectedStudent) {
  const normalizedName = String(studentName || "").trim();
  if (!normalizedName) return null;
  const range = currentStudentQueryRange();
  const key = studentStatementCacheKey(normalizedName, range);
  const cached = studentStatementCache.get(key);
  if (cached) return cached instanceof Promise ? cached : Promise.resolve(cached);
  const requestPromise = request(`/api/student/${encodeURIComponent(normalizedName)}/statement?${studentStatementQueryString()}`)
    .then((data) => {
      if (studentStatementCache.get(key) === requestPromise) studentStatementCache.set(key, data);
      return data;
    })
    .catch((error) => {
      if (studentStatementCache.get(key) === requestPromise) studentStatementCache.delete(key);
      throw error;
    });
  studentStatementCache.set(key, requestPromise);
  return requestPromise;
}

async function loadStudentStatement() {
  state.student_statement = await fetchStudentStatement();
  return state.student_statement;
}

async function refreshStudentQueryOnly() {
  const requestGeneration = ++studentQueryRequestGeneration;
  const studentName = String(selectedStudent || "").trim();
  const queryKey = studentStatementCacheKey(studentName);
  if (!studentName) {
    state.student_history = [];
    state.student_statement = null;
    if (view === "studentQuery") updateStudentQueryViewOnly();
    return;
  }
  const report = await fetchStudentStatement(studentName);
  if (requestGeneration !== studentQueryRequestGeneration || view !== "studentQuery" || selectedStudent !== studentName || studentStatementCacheKey(studentName) !== queryKey) return;
  state.student_history = [];
  state.student_statement = report;
  updateStudentQueryViewOnly();
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
  if (!isDateValue(matrixRange.start) || !isDateValue(matrixRange.end) || matrixRange.start > matrixRange.end) {
    matrixRange = currentMatrixRange(matrixRange.month_key || state?.settings?.month_key || activeMonth);
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
  return Boolean(parseDateValue(value));
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
  return { month_key: "", teacher: "", teacher_names: [], student: "", student_names: [], start_date: "", end_date: "", status: "", classroom: "", grade: "", subject: "", query: "", date_preset_initialized: false };
}

function readLessonFilter() {
  const defaults = defaultLessonFilter();
  try {
    const parsed = { ...defaults, ...JSON.parse(localStorage.getItem(LESSON_FILTER_KEY) || "{}") };
    parsed.teacher_names = normalizeNameList(parsed.teacher_names || (parsed.teacher ? [parsed.teacher] : []));
    // 兼容旧版单学生筛选；转换后仍会作为多选已选值保留在控件中，用户可单独移除。
    parsed.student_names = normalizeNameList(parsed.student_names || (parsed.student ? [parsed.student] : []));
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
  return ["lessons", "weekMatrix", "teacherDetail"].includes(viewKey) ? viewKey : "lessons";
}

function lessonsRangeUrl(range, viewKey = lessonDataViewKey()) {
  const params = new URLSearchParams();
  params.set("start", range.start);
  params.set("end", range.end);
  params.set("view", viewKey);
  // 课程总表的学生多选在本地即时筛选；当日期范围需要补拉数据时，同时把
  // 已选学生带给轻量范围接口，后端仍按角色预筛选 ∩ 用户筛选返回任意命中项。
  if (viewKey === "lessons") {
    normalizeNameList(lessonFilter.student_names || []).forEach((name) => params.append("student_names", name));
  } else if (viewKey === "teacherDetail" && selectedTeacherDetail) {
    params.append("teacher_names", selectedTeacherDetail);
  }
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
  const normalized = String(name || "").trim();
  return (state.profile_students || []).find((row) => String(row.name || "").trim() === normalized) || null;
}

function rechargeRows() {
  return [...(state.recharges || [])]
    .filter(isRealRechargeRow)
    .map((row) => {
      const profile = studentProfileByName(row.student_name);
      return {
        ...row,
        // Recharge grade is a historical snapshot. Page presentation, filters
        // and analysis use the profile's current-grade authority instead.
        grade: studentCurrentGrade(profile || {}) || row.grade || "未设置",
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

const rechargeChannelOptions = [["wechat", "微信"], ["cash", "现金"], ["alipay", "支付宝"], ["other", "其他"]];

function rechargeChannelLabel(row) {
  const value = String(row?.channel || "").trim();
  const label = rechargeChannelOptions.find(([key]) => key === value)?.[1] || "未记录";
  if (value === "other" && row?.channel_other) return `${label}：${row.channel_other}`;
  return label;
}

function rechargeChannelCellMarkup(row) {
  const editable = canWriteData();
  const label = rechargeChannelLabel(row);
  return `
    <td class="recharge-channel-cell adaptive-center ${row?.channel ? "" : "is-unrecorded"}"
        data-recharge-id="${escapeHtml(row.id)}"
        data-channel="${escapeHtml(row.channel || "")}"
        data-channel-other="${escapeHtml(row.channel_other || "")}"
        ${editable ? 'data-channel-editable="1" role="button" tabindex="0" aria-haspopup="listbox" aria-expanded="false"' : 'aria-readonly="true"'}>
      <span class="recharge-channel-value">${escapeHtml(label)}</span>
      <span class="recharge-channel-saving" hidden aria-hidden="true"></span>
    </td>
  `;
}

const adaptiveTableTextWidthCache = new Map();
let adaptiveTableMeasureToken = 0;
let adaptiveTableResizeTimer = 0;
let adaptiveTableCanvasContext = null;

function adaptiveTableTextWidth(text, element) {
  const value = String(text ?? "");
  const style = getComputedStyle(element);
  const font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const key = `${font}\u0000${value}`;
  if (adaptiveTableTextWidthCache.has(key)) return adaptiveTableTextWidthCache.get(key);
  if (!adaptiveTableCanvasContext) adaptiveTableCanvasContext = document.createElement("canvas").getContext("2d");
  adaptiveTableCanvasContext.font = font;
  const width = adaptiveTableCanvasContext.measureText(value).width;
  adaptiveTableTextWidthCache.set(key, width);
  return width;
}

function adaptiveHorizontalBox(element) {
  const style = getComputedStyle(element);
  return ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"]
    .reduce((sum, key) => sum + (Number.parseFloat(style[key]) || 0), 0);
}

function adaptiveStudentSetWidth(container) {
  const badges = [...container.querySelectorAll(":scope > .student-badge")];
  if (!badges.length) return adaptiveTableTextWidth(container.textContent.trim() || "—", container);
  return Math.max(...badges.map((badge) => badge.getBoundingClientRect().width));
}

function adaptiveColumnDefinition(column, header) {
  const type = column.dataset.columnType || "short";
  const presets = {
    select: { minWidth: 44, maxWidth: 44, grow: 0, wrap: false, alignment: "center" },
    short: { minWidth: 76, maxWidth: 180, grow: 0, wrap: false, alignment: "center" },
    name: { minWidth: 96, maxWidth: 190, grow: 0, wrap: false, alignment: "center" },
    phone: { minWidth: 132, maxWidth: 210, grow: 0, wrap: false, alignment: "center" },
    status: { minWidth: 92, maxWidth: 150, grow: 0, wrap: false, alignment: "center" },
    date: { minWidth: 132, maxWidth: 156, grow: 0, wrap: false, alignment: "center" },
    money: { minWidth: 128, maxWidth: 168, grow: 0, wrap: false, alignment: "right" },
    action: { minWidth: 92, maxWidth: 250, grow: 0, wrap: false, alignment: "center" },
    account: { minWidth: 132, maxWidth: 220, grow: 0, wrap: false, alignment: "center" },
    long: { minWidth: 160, maxWidth: 360, grow: 1, wrap: true, alignment: "left" },
    students: { minWidth: 220, maxWidth: 480, grow: 2, wrap: true, alignment: "left" },
    permissions: { minWidth: 220, maxWidth: 420, grow: 1, wrap: true, alignment: "left" },
  };
  const preset = presets[type] || presets.short;
  const numeric = (key, fallback) => {
    const value = Number(column.dataset[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    type,
    minWidth: numeric("minWidth", preset.minWidth),
    maxWidth: numeric("maxWidth", preset.maxWidth),
    grow: numeric("grow", preset.grow),
    wrap: column.dataset.wrap === "" ? true : column.dataset.wrap == null ? preset.wrap : column.dataset.wrap === "true",
    alignment: column.dataset.alignment || preset.alignment,
    header,
  };
}

function adaptiveWrappedTextWidth(value, element) {
  const tokens = String(value || "").split(/[\s,，、;；/|]+/).filter(Boolean);
  if (!tokens.length) return adaptiveTableTextWidth(value, element);
  return Math.max(...tokens.map((token) => adaptiveTableTextWidth(token, element)));
}

function adaptiveCellContentWidth(cell, definition) {
  const cellBox = adaptiveHorizontalBox(cell);
  const studentSet = cell.querySelector(".student-set-badges");
  if (studentSet) return adaptiveStudentSetWidth(studentSet) + cellBox;

  const currencyDisplay = cell.querySelector(".currency-display");
  if (currencyDisplay) {
    const input = cell.querySelector(".currency-input");
    const inputBox = input ? adaptiveHorizontalBox(input) : 0;
    return Math.max(88, adaptiveTableTextWidth(currencyDisplay.textContent.trim(), currencyDisplay) + inputBox) + cellBox;
  }

  const input = cell.querySelector(":scope > .cell-input");
  if (input) {
    const displayValue = input.value || input.placeholder || "";
    const affordance = input.type === "date" ? 28 : 0;
    const measured = definition.wrap
      ? adaptiveWrappedTextWidth(displayValue, input)
      : adaptiveTableTextWidth(displayValue, input);
    return Math.max(48, measured + adaptiveHorizontalBox(input) + affordance) + cellBox;
  }

  if (definition.wrap) return adaptiveWrappedTextWidth(cell.textContent.trim(), cell) + cellBox;
  const inlineChildren = [...cell.children].filter((element) => !element.hidden);
  if (inlineChildren.length) {
    const widths = inlineChildren.map((element) => element.getBoundingClientRect().width);
    return widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * 5 + cellBox;
  }
  return adaptiveTableTextWidth(cell.textContent.trim(), cell) + cellBox;
}

function resizeAdaptiveTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(38, textarea.scrollHeight)}px`;
  if (textarea.dataset.adaptiveTextareaBound !== "1") {
    textarea.dataset.adaptiveTextareaBound = "1";
    textarea.addEventListener("input", () => resizeAdaptiveTextarea(textarea));
  }
}

function adaptiveTextWidthForData(value, font) {
  const textValue = String(value ?? "");
  const key = `${font}\u0000${textValue}`;
  if (adaptiveTableTextWidthCache.has(key)) return adaptiveTableTextWidthCache.get(key);
  if (!adaptiveTableCanvasContext) adaptiveTableCanvasContext = document.createElement("canvas").getContext("2d");
  adaptiveTableCanvasContext.font = font;
  const width = adaptiveTableCanvasContext.measureText(textValue).width;
  adaptiveTableTextWidthCache.set(key, width);
  return width;
}

function distributeAdaptiveGrowth(widths, definitions, availableWidth) {
  let remaining = Math.max(0, availableWidth - widths.reduce((sum, width) => sum + width, 0));
  let growIndexes = definitions.map((definition, index) => ({ ...definition, index }))
    .filter((definition) => definition.grow > 0 && widths[definition.index] < definition.maxWidth);
  while (remaining > 0.5 && growIndexes.length) {
    const growTotal = growIndexes.reduce((sum, definition) => sum + definition.grow, 0);
    let distributed = 0;
    for (const definition of growIndexes) {
      const share = remaining * (definition.grow / growTotal);
      const addition = Math.min(share, definition.maxWidth - widths[definition.index]);
      widths[definition.index] += addition;
      distributed += addition;
    }
    if (distributed < 0.5) break;
    remaining -= distributed;
    growIndexes = growIndexes.filter((definition) => widths[definition.index] < definition.maxWidth - 0.5);
  }
  return widths;
}

function applyStudentPricingAdaptiveColumns(table, columns, headerCells, definitions) {
  const started = performance.now();
  const style = getComputedStyle(table);
  const font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const rows = studentPricingVisibleRows.length ? studentPricingVisibleRows : (state?.student_pricing || []);
  const unique = (values) => [...new Set(values.map((value) => String(value || "")).filter(Boolean))];
  const measured = (values, fallback = "—") => Math.max(
    adaptiveTextWidthForData(fallback, font),
    ...unique(values).map((value) => adaptiveTextWidthForData(value, font)),
  );
  const noteTokens = unique(rows.flatMap((row) => String(row.notes || "").split(/[\s,，、;；/|]+/).filter(Boolean)));
  const studentLabels = unique(rows.flatMap((row) => row._students || splitStudents(row.student_names)));
  const rawWidths = [
    44,
    measured(rows.map((row) => row.student_name)) + 36,
    measured(rows.map((row) => row.grade)) + 34,
    measured(rows.map((row) => row.subject)) + 34,
    measured(studentLabels) + 42,
    measured(rows.map((row) => moneyInput(row.custom_price))) + 56,
    measured(rows.map((row) => studentPricingVisibleStatus(row))) + 34,
    measured(noteTokens) + 38,
  ];
  const widths = rawWidths.map((width, index) => Math.ceil(Math.min(
    definitions[index].maxWidth,
    Math.max(definitions[index].minWidth, width),
  )));
  const wrapper = table.closest(".table-wrap");
  distributeAdaptiveGrowth(widths, definitions, wrapper?.clientWidth || widths.reduce((sum, width) => sum + width, 0));
  columns.forEach((column, index) => {
    column.style.width = `${Math.ceil(widths[index])}px`;
    headerCells[index].classList.toggle("adaptive-wrap", definitions[index].wrap);
  });
  table.classList.add("adaptive-table");
  table.style.tableLayout = "fixed";
  table.style.width = `${Math.ceil(widths.reduce((sum, width) => sum + width, 0))}px`;
  table.style.minWidth = "0";
  table.dataset.adaptiveWidths = widths.map((width) => Math.ceil(width)).join(",");
  table.dataset.adaptiveColumnConfig = JSON.stringify(definitions.map(({ header, ...definition }) => definition));
  table.dataset.adaptiveLayoutReads = "0";
  table.dataset.adaptiveMeasurementMs = (performance.now() - started).toFixed(2);
  return widths;
}

function applyAdaptiveTableColumns({ table, flexibleColumn = null } = {}) {
  if (!table?.isConnected) return [];
  const headerCells = [...table.querySelectorAll(":scope > thead > tr:first-child > th")];
  const columns = [...table.querySelectorAll(":scope > colgroup > col")];
  if (!headerCells.length || columns.length !== headerCells.length) return [];

  table.classList.add("adaptive-table");
  table.style.tableLayout = "auto";
  table.style.width = "max-content";
  table.style.minWidth = "0";
  columns.forEach((column) => { column.style.width = "auto"; });

  const definitions = columns.map((column, index) => adaptiveColumnDefinition(column, headerCells[index]));
  if (table.dataset.adaptiveSource === "student-pricing") {
    return applyStudentPricingAdaptiveColumns(table, columns, headerCells, definitions);
  }
  const bodyRows = [...table.querySelectorAll(":scope > tbody > tr")];
  const widths = headerCells.map((header, index) => {
    const definition = definitions[index];
    let width = adaptiveTableTextWidth(header.textContent.trim(), header) + adaptiveHorizontalBox(header);
    for (const row of bodyRows) {
      const cell = row.children[index];
      if (!cell || cell.classList.contains("empty")) continue;
      width = Math.max(width, adaptiveCellContentWidth(cell, definition));
    }
    return Math.ceil(Math.min(definition.maxWidth, Math.max(definition.minWidth, width + 2)));
  });

  const wrapper = table.closest(".table-wrap");
  const availableWidth = wrapper?.clientWidth || widths.reduce((sum, width) => sum + width, 0);
  distributeAdaptiveGrowth(widths, definitions, availableWidth);

  columns.forEach((column, index) => {
    const definition = definitions[index];
    column.style.width = `${Math.ceil(widths[index])}px`;
    headerCells[index].classList.toggle("adaptive-wrap", definition.wrap);
    bodyRows.map((row) => row.children[index]).filter(Boolean).forEach((cell) => {
      cell.classList.toggle("adaptive-wrap", definition.wrap);
      cell.dataset.adaptiveAlignment = definition.alignment;
    });
  });
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  table.style.tableLayout = "fixed";
  table.style.width = `${Math.ceil(tableWidth)}px`;
  table.style.minWidth = "0";
  table.dataset.adaptiveWidths = widths.map((width) => Math.ceil(width)).join(",");
  table.dataset.adaptiveColumnConfig = JSON.stringify(definitions.map(({ header, ...definition }) => definition));
  table.querySelectorAll("textarea.adaptive-textarea").forEach(resizeAdaptiveTextarea);
  return widths;
}

function scheduleAdaptiveTableColumns() {
  const token = ++adaptiveTableMeasureToken;
  requestAnimationFrame(() => {
    if (token !== adaptiveTableMeasureToken) return;
    document.querySelectorAll('table[data-adaptive-table="true"]').forEach((table) => {
      applyAdaptiveTableColumns({ table });
    });
  });
}

window.addEventListener("resize", () => {
  window.clearTimeout(adaptiveTableResizeTimer);
  adaptiveTableResizeTimer = window.setTimeout(scheduleAdaptiveTableColumns, 120);
}, { passive: true });

function closeRechargeChannelOverlay({ restoreFocus = false } = {}) {
  const active = activeRechargeChannelOverlay;
  if (!active) {
    document.querySelectorAll(".recharge-channel-overlay").forEach((menu) => menu.remove());
    return;
  }
  const cell = active.cell;
  active.menu?.remove();
  if (cell?.isConnected) {
    cell.classList.remove("is-open", "is-saving");
    cell.setAttribute("aria-expanded", "false");
    cell.querySelector(".recharge-channel-saving")?.setAttribute("hidden", "");
    if (restoreFocus) cell.focus({ preventScroll: true });
  }
  activeRechargeChannelOverlay = null;
}

function positionRechargeChannelOverlay() {
  const active = activeRechargeChannelOverlay;
  if (!active?.cell?.isConnected || !active?.menu?.isConnected) {
    closeRechargeChannelOverlay();
    return;
  }
  const rect = active.cell.getBoundingClientRect();
  const menu = active.menu;
  const viewportGap = 8;
  menu.style.minWidth = `${Math.max(200, Math.round(rect.width))}px`;
  menu.style.maxWidth = `${Math.max(220, Math.min(360, window.innerWidth - viewportGap * 2))}px`;
  menu.style.left = `${viewportGap}px`;
  menu.style.top = `${viewportGap}px`;
  const menuRect = menu.getBoundingClientRect();
  const left = Math.max(viewportGap, Math.min(rect.left, window.innerWidth - menuRect.width - viewportGap));
  const below = window.innerHeight - rect.bottom - viewportGap;
  const above = rect.top - viewportGap;
  const openUp = below < Math.min(220, menuRect.height) && above > below;
  const top = openUp
    ? Math.max(viewportGap, rect.top - menuRect.height - 6)
    : Math.min(window.innerHeight - menuRect.height - viewportGap, rect.bottom + 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(viewportGap, top)}px`;
  menu.classList.toggle("open-up", openUp);
}

function showRechargeChannelOtherEditor(active, { focus = true } = {}) {
  if (!active?.menu) return;
  active.menu.querySelectorAll(".recharge-channel-option").forEach((option) => {
    const selected = option.dataset.channel === "other";
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-selected", selected ? "true" : "false");
  });
  const editor = active.menu.querySelector(".recharge-channel-other-editor");
  const input = active.menu.querySelector(".recharge-channel-other-input");
  if (editor) editor.hidden = false;
  if (input && !input.value) input.value = active.channel === "other" ? active.channelOther : "";
  active.menu.querySelector(".recharge-channel-error").textContent = "";
  positionRechargeChannelOverlay();
  if (focus) requestAnimationFrame(() => input?.focus({ preventScroll: true }));
}

async function saveRechargeChannel(active, channel, channelOther = "") {
  if (!active || active !== activeRechargeChannelOverlay || active.saving) return;
  const normalizedOther = channel === "other" ? String(channelOther || "").trim() : "";
  const errorNode = active.menu.querySelector(".recharge-channel-error");
  if (channel === "other" && !normalizedOther) {
    errorNode.textContent = "请填写其他渠道说明";
    active.menu.querySelector(".recharge-channel-other-input")?.focus({ preventScroll: true });
    return;
  }
  active.saving = true;
  active.cell.classList.add("is-saving");
  active.cell.querySelector(".recharge-channel-saving")?.removeAttribute("hidden");
  active.menu.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
  errorNode.textContent = "";
  try {
    const result = await request(`/api/recharges/${encodeURIComponent(active.id)}/channel`, {
      method: "PATCH",
      body: { channel, channel_other: normalizedOther },
    });
    if (!result?.row) throw new Error("渠道保存结果缺少记录");
    state.recharges = upsertById(state.recharges || [], result.row);
    const rowElement = active.cell.closest(".recharge-row");
    const label = rechargeChannelLabel(result.row);
    active.cell.dataset.channel = result.row.channel || "";
    active.cell.dataset.channelOther = result.row.channel_other || "";
    active.cell.classList.toggle("is-unrecorded", !result.row.channel);
    active.cell.querySelector(".recharge-channel-value").textContent = label;
    if (rowElement) {
      rowElement.dataset.channel = result.row.channel || "";
      rowElement.dataset.channelOther = result.row.channel_other || "";
    }
    closeRechargeChannelOverlay();
    scheduleAdaptiveTableColumns();
  } catch (error) {
    active.saving = false;
    active.cell.classList.remove("is-saving");
    active.cell.querySelector(".recharge-channel-saving")?.setAttribute("hidden", "");
    active.menu.querySelectorAll("button, input").forEach((control) => { control.disabled = false; });
    errorNode.textContent = error.message || "保存失败，请重试";
    positionRechargeChannelOverlay();
  }
}

function openRechargeChannelOverlay(cell) {
  if (!cell?.isConnected || cell.dataset.channelEditable !== "1" || isReadonlyUser()) return;
  if (activeRechargeChannelOverlay?.cell === cell) {
    closeRechargeChannelOverlay({ restoreFocus: true });
    return;
  }
  closeAllFloatingOverlays();
  const channel = String(cell.dataset.channel || "");
  const channelOther = String(cell.dataset.channelOther || "");
  const menu = document.createElement("div");
  menu.className = "custom-select-menu recharge-channel-overlay open";
  menu.dataset.rechargeChannelOverlay = "1";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "选择充值来源或渠道");
  menu.innerHTML = `
    ${rechargeChannelOptions.map(([value, label]) => `
      <button class="custom-select-option recharge-channel-option ${channel === value ? "selected" : ""}"
              type="button" role="option" data-channel="${escapeHtml(value)}"
              aria-selected="${channel === value ? "true" : "false"}">${escapeHtml(label)}</button>
    `).join("")}
    <div class="recharge-channel-other-editor" ${channel === "other" ? "" : "hidden"}>
      <label for="recharge-channel-other-inline">其他渠道说明</label>
      <input id="recharge-channel-other-inline" class="control recharge-channel-other-input" maxlength="100"
             value="${escapeHtml(channel === "other" ? channelOther : "")}" autocomplete="off">
      <div class="recharge-channel-error" role="alert"></div>
      <div class="recharge-channel-editor-actions">
        <button class="btn compact recharge-channel-cancel" type="button">取消</button>
        <button class="btn primary compact recharge-channel-save-other" type="button">保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(menu);
  cell.classList.add("is-open");
  cell.setAttribute("aria-expanded", "true");
  activeRechargeChannelOverlay = {
    id: Number(cell.dataset.rechargeId),
    cell,
    menu,
    channel,
    channelOther,
    saving: false,
  };
  positionRechargeChannelOverlay();
  if (channel === "other") showRechargeChannelOtherEditor(activeRechargeChannelOverlay, { focus: false });
  const selected = menu.querySelector(".recharge-channel-option.selected") || menu.querySelector(".recharge-channel-option");
  requestAnimationFrame(() => selected?.focus({ preventScroll: true }));
}

function ensureRechargeChannelEvents() {
  if (rechargeChannelEventsBound) return;
  rechargeChannelEventsBound = true;
  document.addEventListener("click", (event) => {
    const option = event.target.closest(".recharge-channel-option");
    if (option && activeRechargeChannelOverlay?.menu.contains(option)) {
      event.preventDefault();
      const channel = option.dataset.channel || "";
      if (channel === "other") showRechargeChannelOtherEditor(activeRechargeChannelOverlay);
      else saveRechargeChannel(activeRechargeChannelOverlay, channel, "");
      return;
    }
    if (event.target.closest(".recharge-channel-cancel") && activeRechargeChannelOverlay) {
      event.preventDefault();
      closeRechargeChannelOverlay({ restoreFocus: true });
      return;
    }
    if (event.target.closest(".recharge-channel-save-other") && activeRechargeChannelOverlay) {
      event.preventDefault();
      const value = activeRechargeChannelOverlay.menu.querySelector(".recharge-channel-other-input")?.value || "";
      saveRechargeChannel(activeRechargeChannelOverlay, "other", value);
      return;
    }
    const cell = event.target.closest(".recharge-channel-cell[data-channel-editable='1']");
    if (cell) {
      event.preventDefault();
      openRechargeChannelOverlay(cell);
      return;
    }
    if (activeRechargeChannelOverlay && !event.target.closest(".recharge-channel-overlay")) closeRechargeChannelOverlay();
  });
  document.addEventListener("keydown", (event) => {
    const cell = event.target.closest?.(".recharge-channel-cell[data-channel-editable='1']");
    if (cell && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      openRechargeChannelOverlay(cell);
      return;
    }
    if (!activeRechargeChannelOverlay) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeRechargeChannelOverlay({ restoreFocus: true });
      return;
    }
    if (event.target.matches?.(".recharge-channel-other-input") && event.key === "Enter") {
      event.preventDefault();
      saveRechargeChannel(activeRechargeChannelOverlay, "other", event.target.value);
    }
  });
  window.addEventListener("resize", () => {
    if (activeRechargeChannelOverlay) positionRechargeChannelOverlay();
  });
  window.addEventListener("scroll", () => {
    if (activeRechargeChannelOverlay) positionRechargeChannelOverlay();
  }, true);
}

function rechargeModalMarkup() {
  if (!rechargeModalOpen) return "";
  const students = uniqueSorted((state.profile_students || []).map((row) => row.name).filter(Boolean));
  const grades = uniqueSorted([...gradeOrder, ...usedLessonLookupValues("grades")]);
  const draft = rechargeModalDraft || { recharge_date: defaultRechargeDate(), cur_recharge: 0, cur_gift: 0, channel: "wechat" };
  const editing = Boolean(draft.id);
  const channel = String(draft.channel || "");
  return `
    <div class="modal-backdrop recharge-modal">
      <div class="modal-panel recharge-modal-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">${editing ? "编辑充值记录" : "新增充值记录"}</div>
            <div class="modal-subtitle">${escapeHtml(formatMonthOption(state?.settings?.month_key || activeMonth))}</div>
          </div>
          <button class="btn recharge-modal-cancel" type="button">取消</button>
        </div>
        <div class="lesson-create-form recharge-form-grid">
          <label>学生姓名${filterComboControl({ id: "new-recharge-student", className: "recharge-modal-field", field: "student_name", value: draft.student_name || "", values: students, placeholder: "输入或选择学生", emptyLabel: "" })}</label>
          <label>年级${filterComboControl({ id: "new-recharge-grade", className: "recharge-modal-field", field: "grade", value: draft.grade || "", values: grades, placeholder: "输入或选择年级", emptyLabel: "" })}</label>
          <label>充值日期<input id="new-recharge-date" class="control recharge-modal-field" data-date-kind="single" data-field="recharge_date" type="date" value="${escapeHtml(draft.recharge_date || defaultRechargeDate())}"></label>
          <label>现金充值<input id="new-recharge-cur" class="control money-input recharge-modal-field" data-field="cur_recharge" type="number" step="0.01" value="${escapeHtml(draft.cur_recharge ?? 0)}"></label>
          <label>赠送充值<input id="new-recharge-gift" class="control money-input recharge-modal-field" data-field="cur_gift" type="number" step="0.01" value="${escapeHtml(draft.cur_gift ?? 0)}"></label>
          <fieldset class="recharge-channel-fieldset wide">
            <legend>来源 / 渠道</legend>
            <div class="recharge-channel-options">${rechargeChannelOptions.map(([value, label]) => `<label><input class="recharge-channel-radio" type="radio" name="recharge-channel" value="${value}" ${channel === value ? "checked" : ""}>${label}</label>`).join("")}</div>
            ${editing && !channel ? `<div class="field-hint warning-text">该旧记录未保存渠道，请在保存前选择。</div>` : ""}
          </fieldset>
          <label class="wide recharge-channel-other" ${channel === "other" ? "" : "hidden"}>其他渠道说明<input id="new-recharge-channel-other" class="control recharge-modal-field" maxlength="100" value="${escapeHtml(channel === "other" ? (draft.channel_other || "") : "")}" placeholder="请填写具体渠道"></label>
          <label class="wide">备注<input id="new-recharge-notes" class="control recharge-modal-field" data-field="notes" value="${escapeHtml(draft.notes || "")}" placeholder="备注"></label>
        </div>
        <div class="modal-actions">
          <button class="btn recharge-modal-cancel" type="button">取消</button>
          <button class="btn primary add-recharge-record" type="button" data-id="${escapeHtml(draft.id || "")}">保存</button>
        </div>
      </div>
    </div>
  `;
}

function openingBalanceRows() {
  return [...(state.opening_balances || [])]
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
          <label>期初实际余额<input id="new-opening-actual" class="control money-input opening-balance-modal-field" data-field="opening_actual_balance" type="number" step="0.01" value="0"></label>
          <label>期初赠送余额<input id="new-opening-gift" class="control money-input opening-balance-modal-field" data-field="opening_gift_balance" type="number" step="0.01" value="0"></label>
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

function ensureLessonFilterDates({ defaultToThisWeek = view === "lessons" } = {}) {
  const nextFilter = { ...lessonFilter };
  let changed = false;
  const monthKey = nextFilter.month_key || state?.settings?.month_key || activeMonth;
  if (monthKey && !nextFilter.month_key) {
    nextFilter.month_key = monthKey;
    changed = true;
  }
  const teacherNames = normalizeNameList(nextFilter.teacher_names || (nextFilter.teacher ? [nextFilter.teacher] : []));
  if (teacherNames.join("\n") !== normalizeNameList(nextFilter.teacher_names || []).join("\n")) {
    nextFilter.teacher_names = teacherNames;
    nextFilter.teacher = teacherNames.join("、");
    changed = true;
  }
  const studentNames = normalizeNameList(nextFilter.student_names || []);
  const studentLabel = studentNames.join("、");
  if (studentNames.join("\n") !== normalizeNameList(nextFilter.student_names || []).join("\n") || (studentNames.length && nextFilter.student !== studentLabel)) {
    nextFilter.student_names = studentNames;
    nextFilter.student = studentLabel;
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
  if (defaultToThisWeek && !nextFilter.date_preset_initialized && (!nextFilter.start_date || !nextFilter.end_date)) {
    const range = currentWeekRange();
    nextFilter.start_date = range.start;
    nextFilter.end_date = range.end;
    nextFilter.date_preset_initialized = true;
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
  state.week_lessons = result.lessons || [];
  state.lesson_loaded_range = range;
}

function resetLessonFilter() {
  const range = currentWeekRange();
  const monthKey = lessonFilter.month_key || state?.settings?.month_key || activeMonth;
  lessonFilter = { month_key: monthKey, teacher: "", teacher_names: [], student: "", student_names: [], start_date: range.start, end_date: range.end, status: "", classroom: "", grade: "", subject: "", query: "", date_preset_initialized: true };
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
  if (excludeField === "student") optionFilter.student_names = [];
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
  const studentNames = normalizeNameList(filter.student_names || []);
  if (studentNames.length && !splitStudents(row.student_names).some((name) => studentNames.includes(name))) return false;
  if (!studentNames.length && filter.student) {
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
  const allLabels = {
    student: "全部学生",
    student_name: "全部学生",
    students: "全部学生",
    student_names: "全部学生",
    teacher: "全部老师",
    teacher_name: "全部老师",
    classroom: "全部教室",
    status: "全部状态",
    grade: "全部年级",
    subject: "全部科目",
  };
  const displayPlaceholder = !value && emptyLabel ? (allLabels[field] || placeholder) : placeholder;
  return `
    <span class="filter-combo ${hasValueClass}">
      <input ${id ? `id="${escapeHtml(id)}"` : ""} class="control filter-combo-input ${className}" ${dataName}="${escapeHtml(field)}" type="text" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(displayPlaceholder)}" value="${escapeHtml(value || "")}">
      <button class="filter-combo-clear" type="button" aria-label="清空" ${value ? "" : "hidden"}>×</button>
      <button class="filter-combo-toggle" type="button" aria-label="展开候选">⌄</button>
      <span class="filter-combo-menu">
        ${emptyLabel ? `<button class="filter-combo-option muted" type="button" data-value="">${escapeHtml(emptyLabel)}</button>` : ""}
        <span class="filter-combo-count" data-filter-combo-count></span>
        ${normalized.map((item) => `<button class="filter-combo-option" type="button" data-value="${escapeHtml(item)}">${filterComboOptionLabel(field, item)}</button>`).join("")}
        <span class="filter-combo-empty" hidden>无匹配选项</span>
      </span>
    </span>
  `;
}

function filterComboOptionLabel(field, value) {
  if (field === "student" || field === "student_name" || field === "student_names" || field === "students") return renderEntityBadge("student", value);
  if (["grade", "subject", "status"].includes(field)) return renderEntityBadge(field, value);
  return escapeHtml(value);
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

function multiSelectControl({ id = "", className = "", field, selected = [], values = [], placeholder = "全部", clearLabel = "全部", dataAttr = "filter-field", includeSelected = true, searchable = false, searchPlaceholder = "搜索选项", inputAttrs = "", selectionSummary = "", multiple = true, emptyText = "" }) {
  const selectedList = normalizeNameList(selected);
  const selectedSet = new Set(selectedList);
  const rawValues = [...(values || []), ...(includeSelected ? selectedList : [])];
  const normalized = ["price", "salary_status"].includes(field)
    ? [...new Set(rawValues.map((value) => String(value || "").trim()).filter(Boolean))]
    : uniqueSorted(rawValues);
  const dataName = dataAttr === "field" ? "data-field" : "data-filter-field";
  const label = multiSelectSelectionMarkup(field, selectedList, placeholder);
  const emptyLabel = emptyText || (/student/.test(field || "") ? "暂无匹配学生" : "暂无匹配选项");
  return `
    <span class="multi-select ${selectedList.length ? "has-value" : ""}" data-field="${escapeHtml(field)}" data-placeholder="${escapeHtml(placeholder)}" data-selection-mode="${multiple ? "multiple" : "single"}">
      <button ${id ? `id="${escapeHtml(id)}"` : ""} class="control multi-select-toggle ${className}" type="button" aria-expanded="false">
        <span class="multi-select-label">${label}</span>
        <span class="multi-select-caret">⌄</span>
        <span class="multi-select-clear-icon" aria-hidden="true">×</span>
      </button>
      <input class="multi-select-value ${className}" ${dataName}="${escapeHtml(field)}" type="hidden" value="${escapeHtml(selectedList.join("\n"))}" ${inputAttrs}>
      ${selectionSummary ? `<span class="multi-select-selection-summary">${selectionSummary}</span>` : ""}
      <span class="multi-select-menu">
        ${searchable ? `<span class="multi-select-search-row"><input class="multi-select-search" type="search" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(searchPlaceholder)}"><button class="multi-select-search-clear" type="button" aria-label="清空搜索">×</button></span>` : ""}
        ${searchable ? `<span class="multi-select-result-count">当前结果 <b data-multi-select-result-count>${normalized.length}</b> 项</span>` : ""}
        <button class="multi-select-clear" type="button">${escapeHtml(clearLabel)}</button>
        ${normalized.map((item) => `
          <button class="multi-select-option ${selectedSet.has(item) ? "selected" : ""}" type="button" data-value="${escapeHtml(item)}">
            <span class="multi-select-check">${selectedSet.has(item) ? "✓" : ""}</span>
            ${multiSelectOptionLabel(field, item)}
          </button>
        `).join("")}
        <span class="multi-select-empty" ${normalized.length ? "hidden" : ""}>${emptyLabel}</span>
      </span>
    </span>
  `;
}

function multiSelectSelectionMarkup(field, values = [], placeholder = "全部") {
  const selected = normalizeNameList(values);
  if (!selected.length) return escapeHtml(placeholder);
  if (field === "teacher" && selected.length === 1 && selected[0] === TEACHER_ALL_VALUE) return "全部教师";
  if (["student", "student_name", "student_names", "students"].includes(field)) {
    return `<span class="entity-badge-list">${selected.map((value) => renderEntityBadge("student", value)).join("")}</span>`;
  }
  if (["grade", "subject", "status"].includes(field)) {
    return `<span class="entity-badge-list">${selected.map((value) => renderEntityBadge(field, value)).join("")}</span>`;
  }
  return escapeHtml(selected.join("、"));
}

function multiSelectOptionLabel(field, value) {
  if (field === "teacher" && value === TEACHER_ALL_VALUE) return "<span>全部教师</span>";
  if (field === "student" || field === "student_name" || field === "student_names" || field === "students") return renderEntityBadge("student", value);
  if (["grade", "subject", "status"].includes(field)) return renderEntityBadge(field, value);
  if (field === "classroom") return `<span class="entity-badge classroom-badge">${escapeHtml(value)}</span>`;
  return `<span>${escapeHtml(value)}</span>`;
}

const FLOATING_MULTI_SELECT_TOGGLE_SELECTOR = [
  ".lesson-filter-select",
  ".user-row-teachers",
  ".new-user-teachers",
  ".user-access-teachers",
  ".schedule-student-popover .multi-select-toggle",
  ".conflict-edit-students",
].join(",");

function usesFloatingMultiSelectMenu(select) {
  return Boolean(select?.querySelector(FLOATING_MULTI_SELECT_TOGGLE_SELECTOR));
}

function multiSelectMenuFor(select) {
  return select?._floatingMenu || select?.querySelector(".multi-select-menu") || null;
}

function multiSelectOwner(node) {
  const select = node?.closest?.(".multi-select");
  if (select) return select;
  return node?.closest?.(".multi-select-menu")?._multiSelectOwner || null;
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
  delete select._studentPickerLayout;
}

function closeOpenMultiSelectMenus() {
  document.querySelectorAll(".multi-select.open").forEach((select) => {
    if (select.classList.contains("schedule-student-popover") && typeof select._studentClose === "function") select._studentClose();
    else closeMultiSelectMenu(select);
  });
}

function closeOtherMultiSelectMenus(except) {
  document.querySelectorAll(".multi-select.open").forEach((select) => {
    if (select === except) return;
    if (select.classList.contains("schedule-student-popover") && typeof select._studentClose === "function") select._studentClose();
    else closeMultiSelectMenu(select);
  });
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
  const isStudentPicker = select.classList.contains("schedule-student-popover");
  const isLessonFilter = Boolean(select.querySelector(".lesson-filter-select"));
  const minWidth = isStudentPicker ? 380 : isLessonFilter ? 240 : 188;
  const preferredWidth = isStudentPicker ? 400 : isLessonFilter ? Math.max(240, rect.width) : rect.width;
  const maximumWidth = Math.max(160, window.innerWidth - viewportGap * 2);
  const width = Math.min(Math.max(rect.width, preferredWidth, Math.min(minWidth, maximumWidth)), maximumWidth);
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - viewportGap - menuGap);
  const spaceAbove = Math.max(0, rect.top - viewportGap - menuGap);
  let openAbove;
  let maxHeight;
  let measuredHeight;
  if (isStudentPicker) {
    // The picker list is the only scrolling region.  Its geometry is captured once
    // per open so list scroll events can never feed its current height back into layout.
    let layout = select._studentPickerLayout;
    if (!layout) {
      const list = menu.querySelector(".lesson-student-picker-list");
      const preferredListHeight = 210;
      const fixedHeight = Math.max(0, Math.ceil(menu.getBoundingClientRect().height - (list?.getBoundingClientRect().height || 0)));
      const preferredHeight = fixedHeight + preferredListHeight;
      openAbove = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
      const availableHeight = openAbove ? spaceAbove : spaceBelow;
      const listHeight = Math.max(80, Math.min(preferredListHeight, Math.floor(availableHeight - fixedHeight)));
      layout = { openAbove, listHeight, height: fixedHeight + listHeight };
      select._studentPickerLayout = layout;
      if (list) {
        list.style.height = `${layout.listHeight}px`;
        list.style.maxHeight = `${layout.listHeight}px`;
      }
    }
    openAbove = layout.openAbove;
    maxHeight = layout.height;
    measuredHeight = layout.height;
  } else {
    const preferredHeight = 180;
    openAbove = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableHeight = openAbove ? spaceAbove : spaceBelow;
    maxHeight = Math.max(1, Math.min(260, availableHeight || 260));
    measuredHeight = Math.min(menu.scrollHeight || maxHeight, maxHeight);
  }
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
  menu.style.maxHeight = isStudentPicker ? "none" : `${Math.round(maxHeight)}px`;
  menu.style.height = isStudentPicker ? `${Math.round(measuredHeight)}px` : "";
}

function positionOpenFloatingMultiSelectMenus(event) {
  // Capturing scroll also sees the candidate list's own scroll events. Those must
  // never reposition (or remeasure) the student picker.
  if (event?.target instanceof Element && event.target.closest(".lesson-student-picker-list")) return;
  document.querySelectorAll(".multi-select.open").forEach(positionFloatingMultiSelectMenu);
}

function refreshScheduleStudentPopoverLayout(select) {
  if (!select?.classList.contains("open")) return;
  delete select._studentPickerLayout;
  const menu = multiSelectMenuFor(select);
  menu?.style.removeProperty("height");
  positionFloatingMultiSelectMenu(select);
}

function filterSearchableOptions(options, keyword, readValue = (item) => item) {
  const query = normalizeSearchKeyword(keyword);
  if (!query) return [...options];
  return [...options].filter((item) => normalizeSearchKeyword(readValue(item)).includes(query));
}

function refreshSearchableSelectResults(select) {
  const menu = multiSelectMenuFor(select);
  const searchInput = menu?.querySelector(".multi-select-search");
  const options = select?._searchableOptionPool || [];
  const matched = new Set(filterSearchableOptions(options, searchInput?.value, (option) => option.dataset.value));
  options.forEach((option) => {
    option.remove();
    option.hidden = false;
    option.removeAttribute("aria-hidden");
  });
  const empty = menu?.querySelector(".multi-select-empty");
  matched.forEach((option) => menu?.insertBefore(option, empty || null));
  if (empty) empty.hidden = matched.size > 0;
  const result = menu?.querySelector("[data-multi-select-result-count]");
  if (result) result.textContent = String(matched.size);
  return [...matched];
}

function bindMultiSelectControl(select) {
  if (!select || select.dataset.multiSelectBound === "true") return;
  select.dataset.multiSelectBound = "true";
  const hidden = select.querySelector(".multi-select-value");
  const label = select.querySelector(".multi-select-label");
  const menu = select.querySelector(".multi-select-menu");
  select._searchableOptionPool = [...(menu?.querySelectorAll(".multi-select-option") || [])];
  const selectedValues = () => normalizeNameList(hidden?.value || "");
  const syncUi = () => {
    const selected = selectedValues();
    const selectedSet = new Set(selected);
    select.classList.toggle("has-value", selected.length > 0);
    if (label) label.innerHTML = multiSelectSelectionMarkup(select.dataset.field || "", selected, select.dataset.placeholder || "全部");
    (select._searchableOptionPool || []).forEach((option) => {
      const active = selectedSet.has(option.dataset.value || "");
      option.classList.toggle("selected", active);
      const check = option.querySelector(".multi-select-check");
      if (check) check.textContent = active ? "✓" : "";
    });
    select.querySelectorAll("[data-multi-select-count]").forEach((counter) => {
      counter.textContent = String(selected.length);
    });
    refreshSearchableSelectResults(select);
  };
  const commit = (values) => {
    if (!hidden) return;
    hidden.value = normalizeNameList(values).join("\n");
    syncUi();
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  };
  select._multiSelectSelectedValues = selectedValues;
  select._multiSelectSync = syncUi;
  select._multiSelectCommit = commit;
  const toggle = select.querySelector(".multi-select-toggle");
  const activateToggle = (event) => {
    event?.preventDefault();
    event?.stopPropagation();
    const currentMenu = multiSelectMenuFor(select);
    const search = currentMenu?.querySelector(".multi-select-search");
    if (event?.target?.closest?.(".multi-select-clear-icon") && selectedValues().length) {
      closeMultiSelectMenu(select);
      if (search) search.value = "";
      commit([]);
      toggle?.blur();
      return;
    }
    closeOtherMultiSelectMenus(select);
    const shouldOpen = !select.classList.contains("open");
    if (!shouldOpen) closeMultiSelectMenu(select);
    else {
      select.classList.add("open");
      mountFloatingMultiSelectMenu(select);
    }
    toggle?.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    if (shouldOpen) {
      multiSelectMenuFor(select)?.querySelector(".multi-select-search")?.focus({ preventScroll: true });
      positionFloatingMultiSelectMenu(select);
      requestAnimationFrame(() => positionFloatingMultiSelectMenu(select));
    }
  };
  toggle?.addEventListener("click", activateToggle);
  toggle?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMultiSelectMenu(select);
      toggle.focus({ preventScroll: true });
    } else if (event.key === "ArrowDown") {
      activateToggle(event);
    }
  });
  syncUi();
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
const priceFilterOptions = [["set", "已设置"], ["unset", "未设置"]];
const usageFilterOptions = [["current", "本月有课"], ["historical", "历史有课"], ["unused", "未使用"]];

function renderLessonFilterBar({ rows, filteredRows, compact = false }) {
  const matchOptions = compact ? { includeDate: false, includeStatus: false, includeQuery: false } : {};
  const opts = dynamicLessonFilterOptions(rows, lessonFilter, matchOptions);
  const teacherSelect = `
    <label class="filter-field">
      <span>老师</span>
      ${multiSelectControl({ className: "lesson-filter-multi lesson-filter-select", field: "teacher_names", selected: lessonFilter.teacher_names || [], values: opts.teachers, placeholder: "全部老师", clearLabel: "全部老师", searchable: true, searchPlaceholder: "搜索老师", emptyText: "暂无匹配结果" })}
    </label>
  `;
  const studentSelect = `
    <label class="filter-field">
      <span>学生</span>
      ${multiSelectControl({ className: "lesson-filter-multi lesson-filter-select", field: "student_names", selected: lessonFilter.student_names || [], values: opts.students, placeholder: "全部学生", clearLabel: "全部学生", searchable: true, searchPlaceholder: "搜索学生", emptyText: "暂无匹配结果" })}
    </label>
  `;
  const lessonDateFilters = compact ? "" : `
    <div class="lesson-date-filter-group">
      <div class="date-shortcuts lesson-date-shortcuts" aria-label="课程总表快捷日期">
        <button class="btn lesson-date-shortcut ${lessonDateShortcutActive("yesterday") ? "active" : ""}" type="button" data-preset="yesterday">昨日</button>
        <button class="btn lesson-date-shortcut ${lessonDateShortcutActive("today") ? "active" : ""}" type="button" data-preset="today">今日</button>
        <button class="btn lesson-date-shortcut ${lessonDateShortcutActive("tomorrow") ? "active" : ""}" type="button" data-preset="tomorrow">明日</button>
        <button class="btn lesson-date-shortcut ${lessonDateShortcutActive("this-week") ? "active" : ""}" type="button" data-preset="this-week">本周</button>
        <button class="btn lesson-date-shortcut ${lessonDateShortcutActive("next-week") ? "active" : ""}" type="button" data-preset="next-week">下周</button>
        <button class="btn lesson-date-shortcut ${lessonDateShortcutActive("this-month") ? "active" : ""}" type="button" data-preset="this-month">本月</button>
      </div>
      <label class="filter-field filter-date-range">
        <span>日期</span>
        ${dateRangePickerControl({ scope: "lesson", startField: "start_date", endField: "end_date", start: lessonFilter.start_date, end: lessonFilter.end_date, placeholder: "选择课程日期范围" })}
      </label>
    </div>
  `;
  const compactExtraFilters = compact ? `
    <label class="filter-field">
      <span>教室</span>
      ${multiSelectControl({ className: "lesson-filter-input lesson-filter-select", field: "classroom", selected: lessonFilter.classroom, values: opts.classrooms, placeholder: "全部教室", clearLabel: "全部教室", searchable: true, searchPlaceholder: "搜索教室", multiple: false, emptyText: "暂无匹配结果" })}
    </label>
    <label class="filter-field">
      <span>年级</span>
      ${multiSelectControl({ className: "lesson-filter-input lesson-filter-select", field: "grade", selected: lessonFilter.grade, values: opts.grades, placeholder: "全部年级", clearLabel: "全部年级", searchable: true, searchPlaceholder: "搜索年级", multiple: false, emptyText: "暂无匹配结果" })}
    </label>
    <label class="filter-field">
      <span>科目</span>
      ${multiSelectControl({ className: "lesson-filter-input lesson-filter-select", field: "subject", selected: lessonFilter.subject, values: opts.subjects, placeholder: "全部科目", clearLabel: "全部科目", searchable: true, searchPlaceholder: "搜索科目", multiple: false, emptyText: "暂无匹配结果" })}
    </label>
  ` : "";
  const fullFilters = compact ? "" : `
    <label class="filter-field">
      <span>教室</span>
      ${multiSelectControl({ className: "lesson-filter-input lesson-filter-select", field: "classroom", selected: lessonFilter.classroom, values: opts.classrooms, placeholder: "全部教室", clearLabel: "全部教室", searchable: true, searchPlaceholder: "搜索教室", multiple: false, emptyText: "暂无匹配结果" })}
    </label>
    <label class="filter-field">
      <span>状态</span>
      ${multiSelectControl({ className: "lesson-filter-input lesson-filter-select", field: "status", selected: lessonFilter.status, values: opts.statuses, placeholder: "全部状态", clearLabel: "全部状态", searchable: true, searchPlaceholder: "搜索状态", multiple: false, emptyText: "暂无匹配结果" })}
    </label>
    <label class="filter-field">
      <span>年级</span>
      ${multiSelectControl({ className: "lesson-filter-input lesson-filter-select", field: "grade", selected: lessonFilter.grade, values: opts.grades, placeholder: "全部年级", clearLabel: "全部年级", searchable: true, searchPlaceholder: "搜索年级", multiple: false, emptyText: "暂无匹配结果" })}
    </label>
    <label class="filter-field">
      <span>科目</span>
      ${multiSelectControl({ className: "lesson-filter-input lesson-filter-select", field: "subject", selected: lessonFilter.subject, values: opts.subjects, placeholder: "全部科目", clearLabel: "全部科目", searchable: true, searchPlaceholder: "搜索科目", multiple: false, emptyText: "暂无匹配结果" })}
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
          ${compact ? `${teacherSelect}${studentSelect}${compactExtraFilters}` : `${lessonDateFilters}${teacherSelect}${studentSelect}${fullFilters}`}
          <div class="filter-summary">
            <span>已筛选 <b>${filteredRows.length}</b> / 共 ${rows.length} 节</span>
            <button class="btn reset-lesson-filter" type="button">重置</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function lessonDateShortcutRange(preset) {
  if (preset === "yesterday") {
    const yesterday = addDays(todayDate(), -1);
    return { start: yesterday, end: yesterday };
  }
  if (preset === "today") {
    const today = todayDate();
    return { start: today, end: today };
  }
  if (preset === "tomorrow") {
    const tomorrow = addDays(todayDate(), 1);
    return { start: tomorrow, end: tomorrow };
  }
  if (preset === "this-week") return currentWeekRange();
  if (preset === "next-week") {
    const current = currentWeekRange();
    return { start: addDays(current.start, 7), end: addDays(current.end, 7) };
  }
  if (preset === "this-month") return monthBounds(state?.settings?.month_key || activeMonth);
  return null;
}

function lessonDateShortcutActive(preset) {
  const range = lessonDateShortcutRange(preset);
  return Boolean(range && lessonFilter.start_date === range.start && lessonFilter.end_date === range.end);
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
        ${unifiedFilterField({ label: "学生", className: "fee-details-filter-input", field: "student", value: feeDetailsFilter.student, values: opts.students })}
        ${unifiedFilterField({ label: "教师", className: "fee-details-filter-input", field: "teacher", value: feeDetailsFilter.teacher, values: opts.teachers })}
        ${unifiedFilterField({ label: "年级", className: "fee-details-filter-input", field: "grade", value: feeDetailsFilter.grade, values: opts.grades })}
        ${unifiedFilterField({ label: "状态", className: "fee-details-filter-input", field: "status", value: feeDetailsFilter.status, values: opts.statuses })}
        ${unifiedFilterField({ label: "价格状态", className: "fee-details-filter-input", field: "source", value: feeDetailsFilter.source, values: opts.sources, placeholder: "全部价格状态" })}
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
  const amountFields = [
    "total_fee", "prev_actual", "prev_gift", "cur_recharge", "cur_gift",
    "actual_consumption", "gift_consumption", "actual_balance", "gift_balance",
  ];
  return rows
    .filter((row) => amountFields.some((field) => numberValue(row[field]) !== 0))
    .sort(compareStudentGradeName);
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
    <div class="filter-bar compact unified-filter-bar summary-filter-bar">
      <div class="filter-controls">
        ${unifiedFilterField({ label: "学生", className: "summary-filter-input", field: "student", value: summaryFilter.student, values: opts.students })}
        ${unifiedFilterField({ label: "年级", className: "summary-filter-input", field: "grade", value: summaryFilter.grade, values: opts.grades })}
        ${unifiedFilterField({ label: "余额状态", className: "summary-filter-input", field: "balance", value: filterLabel(balanceFilterOptions, summaryFilter.balance), values: balanceFilterOptions.map((item) => item[1]), placeholder: "全部余额状态" })}
      </div>
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

const configuredColorCache = new Map();

function configuredColorMap(settingKey, defaults) {
  const raw = state?.settings?.[settingKey] || "{}";
  const cached = configuredColorCache.get(settingKey);
  if (cached?.raw === raw && cached?.defaults === defaults) return cached.value;
  try {
    const parsed = JSON.parse(raw);
    const value = parsed && typeof parsed === "object" ? { ...defaults, ...parsed } : defaults;
    configuredColorCache.set(settingKey, { raw, defaults, value });
    return value;
  } catch {
    configuredColorCache.set(settingKey, { raw, defaults, value: defaults });
    return defaults;
  }
}

function safeBadgeColor(color, fallback) {
  const value = String(color || "").trim();
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

function getCourseStatusColor(status) {
  const colors = configuredColorMap("course_status_colors", DEFAULT_COURSE_STATUS_COLORS);
  const item = colors[status] || DEFAULT_GENERIC_STATUS_COLORS[status] || generatedBadgeColor(status);
  return { background: safeBadgeColor(item.background, "#eef0f3"), color: safeBadgeColor(item.color, "#4b5563") };
}

function getStudentGradeColor(grade) {
  const colors = configuredColorMap("student_grade_colors", DEFAULT_STUDENT_GRADE_COLORS);
  const item = colors[grade] || {};
  return { background: safeBadgeColor(item.background, "#eef0f3"), color: safeBadgeColor(item.color, "#4b5563") };
}

function generatedBadgeColor(value) {
  const palette = [
    { background: "#e8f1fb", color: "#1d4f91" },
    { background: "#e7f6ed", color: "#16713a" },
    { background: "#fff3df", color: "#a25c00" },
    { background: "#f1eafe", color: "#6d3db1" },
    { background: "#fdebed", color: "#b23b55" },
    { background: "#e8f6fb", color: "#126a88" },
  ];
  const hash = [...String(value || "")].reduce((total, char) => ((total * 31) + char.codePointAt(0)) >>> 0, 0);
  return palette[hash % palette.length];
}

function getSubjectColor(subject) {
  const colors = configuredColorMap("course_subject_colors", DEFAULT_SUBJECT_COLORS);
  const item = colors[subject] || generatedBadgeColor(subject);
  return { background: safeBadgeColor(item.background, "#eef0f3"), color: safeBadgeColor(item.color, "#4b5563") };
}

function studentGradeForName(name, fallbackGrade = "") {
  const profile = (state?.profile_students || []).find((row) => String(row.name) === String(name));
  return String(profile?.current_grade || profile?.grade || fallbackGrade || "").trim();
}

function badgeColorStyle(colors) {
  return ` style="--badge-bg:${escapeHtml(colors.background)};--badge-fg:${escapeHtml(colors.color)}"`;
}

function renderStudentBadge(student, options = {}) {
  const name = typeof student === "string" ? student : (student?.name || student?.student_name || "");
  const grade = options.grade || (typeof student === "object" ? (student.grade || student.current_grade) : "") || studentGradeForName(name, options.fallbackGrade);
  const removable = Boolean(options.removable);
  const attrs = removable
    ? ` data-lesson-id="${escapeHtml(String(options.lessonId || ""))}" data-student-name="${escapeHtml(name)}" title="移除 ${escapeHtml(name)}"`
    : "";
  const tag = removable ? "button" : "span";
  return `<${tag} class="entity-badge student-badge ${removable ? "student-badge-removable" : ""}"${removable ? ' type="button"' : ""}${attrs}${badgeColorStyle(getStudentGradeColor(grade))}><span>${escapeHtml(name)}</span>${removable ? '<span class="student-badge-remove" aria-hidden="true">×</span>' : ""}</${tag}>`;
}

function renderGradeBadge(grade, className = "") {
  const label = String(grade || "").trim() || "未填年级";
  return `<span class="entity-badge grade-badge ${className}"${badgeColorStyle(getStudentGradeColor(label))}>${escapeHtml(label)}</span>`;
}

function renderSubjectBadge(subject, className = "") {
  const label = String(subject || "").trim() || "未填科目";
  return `<span class="entity-badge subject-badge ${className}"${badgeColorStyle(getSubjectColor(label))}>${escapeHtml(label)}</span>`;
}

function renderCourseStatusBadge(value, className = "") {
  const status = String(value || "").trim() || "待上";
  return `<span class="entity-badge status-badge ${statusClass(status)} ${className}"${badgeColorStyle(getCourseStatusColor(status))}>${escapeHtml(status)}</span>`;
}

function renderEntityBadge(type, value, context = {}) {
  if (type === "student") return renderStudentBadge(value, context);
  if (type === "grade") return renderGradeBadge(value, context.className || "");
  if (type === "subject") return renderSubjectBadge(value, context.className || "");
  if (type === "status") return renderCourseStatusBadge(value, context.className || "");
  return escapeHtml(value || "");
}

function statusBadge(value) {
  return renderCourseStatusBadge(value);
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

function normalizeDataCenterSettings(settings = {}) {
  return { ...DATA_CENTER_DEFAULT_SETTINGS, ...(settings && typeof settings === "object" ? settings : {}) };
}

function unifiedFilterField({ label, className, field, value, values, placeholder = "全部", dataAttr = "filter-field", emptyLabel = "", emptyText = "暂无匹配结果" }) {
  const defaults = {
    student: "全部学生",
    student_name: "全部学生",
    teacher: "全部教师",
    teacher_name: "全部教师",
    grade: "全部年级",
    subject: "全部科目",
    status: "全部状态",
    price: "全部价格状态",
    salary_status: "全部价格状态",
  };
  const resolvedPlaceholder = placeholder === "全部" ? (defaults[field] || placeholder) : placeholder;
  return `
    <div class="filter-field unified-filter-field">
      <span>${escapeHtml(label)}</span>
      ${multiSelectControl({
        className: `lesson-filter-select unified-filter-control ${className || ""}`.trim(),
        field,
        selected: value ? [value] : [],
        values,
        placeholder: resolvedPlaceholder,
        clearLabel: emptyLabel || resolvedPlaceholder,
        dataAttr,
        searchable: true,
        searchPlaceholder: `搜索${label}`,
        multiple: false,
        emptyText,
      })}
    </div>
  `;
}

function safeDataCenterLoadError(error) {
  const status = Number(error?.status || 0);
  if (status === 401) return "登录状态已失效";
  if (status === 403) return "当前账号没有数据中心权限";
  if (status >= 500) return "服务器暂时无法读取数据中心信息";
  const message = String(error?.message || "").trim();
  return /^[A-Z0-9_-]{3,100}$/.test(message) ? message : "数据中心信息暂时不可用";
}

async function refreshBackupData({ logView = false, tolerateFailure = false } = {}) {
  try {
    const data = await request(`/api/data-center${logView ? "?log=1" : ""}`, { cache: false });
    const serverSettings = normalizeDataCenterSettings(data.settings);
    backupState = {
      ...backupState,
      settings: serverSettings,
      draft: backupState.draftDirty ? normalizeDataCenterSettings(backupState.draft) : { ...serverSettings },
      baidu: { ...DATA_CENTER_DEFAULT_BAIDU, ...(data.baidu || {}) },
      baiduSchedule: data.baidu_schedule || { due: false, reason: "disabled" },
      preflight: data.preflight || null,
      records: Array.isArray(data.records) ? data.records : [],
      error: "",
      loadError: "",
    };
    const recordIds = new Set(backupState.records.map((row) => Number(row.id)).filter(Boolean));
    selectedBackupRecordIds = new Set([...selectedBackupRecordIds].filter((id) => recordIds.has(Number(id))));
    return true;
  } catch (error) {
    backupState = {
      ...backupState,
      settings: normalizeDataCenterSettings(backupState.settings),
      records: Array.isArray(backupState.records) ? backupState.records : [],
      loadError: safeDataCenterLoadError(error),
    };
    if (!tolerateFailure) throw error;
    return false;
  }
}

function markBackupDraftFromDom() {
  const draft = { ...normalizeDataCenterSettings(backupState.draft) };
  const read = (selector, fallback = "") => document.querySelector(selector)?.value ?? fallback;
  const checked = (selector, fallback = false) => document.querySelector(selector)?.checked ?? fallback;
  Object.assign(draft, {
    enabled: checked(".data-backup-enabled", draft.enabled), time: read(".data-backup-time", draft.time), timezone: read(".data-backup-timezone", draft.timezone),
    daily_retention: Number(read(".data-backup-daily", draft.daily_retention)), monthly_retention: Number(read(".data-backup-monthly", draft.monthly_retention)), manual_retention: Number(read(".data-backup-manual", draft.manual_retention)), retry_count: Number(read(".data-backup-retries", draft.retry_count)),
    local_include_operation_logs: checked(".data-backup-local-logs", draft.local_include_operation_logs),
    remote_directory: read(".data-backup-remote-directory", draft.remote_directory), remote_plaintext_acknowledged: checked(".data-backup-remote-plaintext-ack", draft.remote_plaintext_acknowledged), remote_include_operation_logs: checked(".data-backup-remote-logs", draft.remote_include_operation_logs),
    remote_enabled: checked(".data-backup-remote-enabled", draft.remote_enabled), remote_frequency: read(".data-backup-remote-frequency", draft.remote_frequency), remote_time: read(".data-backup-remote-time", draft.remote_time), remote_timezone: read(".data-backup-remote-timezone", draft.remote_timezone),
    remote_weekday: Number(read(".data-backup-remote-weekday", draft.remote_weekday)), remote_monthday: Number(read(".data-backup-remote-monthday", draft.remote_monthday)), remote_retention: Number(read(".data-backup-remote-retention", draft.remote_retention)), remote_retry_count: Number(read(".data-backup-remote-retries", draft.remote_retry_count)),
  });
  backupState.draft = normalizeDataCenterSettings(draft); backupState.draftDirty = true;
  return backupState.draft;
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
  const selectOptions = manualLabel ? manualSelectOptions(values, value, manualLabel, { emptyText }) : options(values, value, emptyText);
  return `
    <td class="${tdClass}">
      <select class="cell-select ${className}" data-id="${id}" data-field="${field}">
        ${selectOptions}
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
  let commitTimer = null;
  const commit = async (restoreFocus = false) => {
    if (commitTimer) {
      clearTimeout(commitTimer);
      commitTimer = null;
    }
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
  const scheduleCommit = () => {
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(() => commit(true), _delay);
  };
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    apply();
    scheduleCommit();
  });
  input.addEventListener("input", () => {
    if (!composing) {
      apply();
      scheduleCommit();
    }
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
  const moneyField = /(?:price|amount|salary|balance|fee|recharge|gift|cost|rate)/i.test(field || "");
  const dateKind = type === "date" ? 'data-date-kind="single"' : "";
  return `
    <td class="${tdClass}">
      <input class="cell-input ${className} ${type === "number" ? "number" : ""} ${moneyField ? "money-input" : ""}" data-id="${id}" data-field="${field}" ${dateKind} type="${type}" value="${escapeHtml(inputValue)}" ${extra}>
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
    <button class="nav-sub-btn ${view === key ? "active" : ""}" type="button" data-nav-group="${group.key}" data-view="${key}">
      ${escapeHtml(label)}
    </button>
  `).join("");
  if (!tabs) return "";
  return `<div class="nav-subtabs">${tabs}</div>`;
}

function navLabelText(group) {
  return String(group.label || "").replace(/^\S+\s+/, "").trim() || group.label || "";
}

function expandableNavGroups(groups = visibleNavGroups()) {
  return groups.filter((group) => groupViews(group).length > 0);
}

function navExpandToggleIcon(expanded) {
  return expanded
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"></path><path d="M5 19h14"></path></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"></path><path d="M5 5h14"></path></svg>`;
}

function syncNavExpandToggle(groups = visibleNavGroups()) {
  const button = document.querySelector("#nav-expand-toggle");
  if (!button) return;
  const expandable = expandableNavGroups(groups);
  const allExpanded = expandable.length > 0 && expandable.every((group) => expandedNavGroups.has(group.key));
  const label = allExpanded ? "折叠全部菜单" : "展开全部菜单";
  button.hidden = expandable.length === 0 || sidebarCollapsed;
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  button.setAttribute("aria-pressed", allExpanded ? "true" : "false");
  button.innerHTML = navExpandToggleIcon(allExpanded);
}

function toggleAllVisibleNavGroups() {
  const groups = visibleNavGroups();
  const expandable = expandableNavGroups(groups);
  if (!expandable.length) return;
  const allExpanded = expandable.every((group) => expandedNavGroups.has(group.key));
  if (allExpanded) {
    expandable.forEach((group) => expandedNavGroups.delete(group.key));
    navExpansionMode = "all-collapsed";
  } else {
    expandable.forEach((group) => expandedNavGroups.add(group.key));
    navExpansionMode = "all-expanded";
  }
  normalizeExpandedNavGroups(groups);
  saveExpandedNavGroups();
  renderNav();
}

function passwordEyeIcon(visible) {
  return visible
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"></path><path d="M10.6 5.2A9.8 9.8 0 0 1 12 5c5.8 0 9.2 7 9.2 7a15.9 15.9 0 0 1-3 3.7"></path><path d="M14.1 14.1A3 3 0 0 1 9.9 9.9"></path><path d="M6.5 6.8A16.3 16.3 0 0 0 2.8 12s3.4 7 9.2 7a9.6 9.6 0 0 0 4.4-1.1"></path></svg>`;
}

function renderLogin(error = "") {
  dismissToast();
  closeSearchablePicker();
  cleanupCustomSelectPortals();
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
  const visibleGroups = visibleNavGroups();
  normalizeExpandedNavGroups(visibleGroups);
  navEl.innerHTML = `
    <div class="nav-sections">
      ${visibleGroups.map((group) => `
        <div class="nav-group ${expandedNavGroups.has(group.key) ? "open" : ""}">
          <button class="nav-btn ${currentGroup.key === group.key ? "active" : ""}" type="button" data-nav-group="${group.key}" data-tooltip="${escapeHtml(navLabelText(group))}" title="${sidebarCollapsed ? escapeHtml(navLabelText(group)) : ""}">
            <span class="nav-icon" aria-hidden="true">${NAV_ICONS[group.key] || ""}</span>
            <span class="nav-label">${escapeHtml(navLabelText(group))}</span>
          </button>
          ${expandedNavGroups.has(group.key) ? renderSecondaryNav(group) : ""}
        </div>
      `).join("")}
    </div>
  `;
  syncNavExpandToggle(visibleGroups);
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
      <span>显示历史（含已流出）</span>
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

function viewLabel(viewKey = view) {
  for (const group of navGroups) {
    const item = groupViews(group).find(([key]) => key === viewKey);
    if (item) return item[1];
  }
  return "课程管理";
}

function renderViewTransitionSkeleton() {
  navigationTransitionStartedAt = performance.now();
  if (view === "dashboard") {
    renderDashboard({ currentMessage: "正在加载课程...", currentSubtitle: "正在加载" });
    return;
  }
  renderNav();
  renderTopbar(viewLabel());
  contentEl.innerHTML = `
    ${view === "studentProfiles" ? studentStageConflictBannerMarkup("loading") : ""}
    <div class="view-loading-skeleton" role="status" aria-live="polite">
      ${view === "studentPricing" ? '<strong>正在加载学生单价规则</strong>' : ""}
      <div class="view-loading-bar wide"></div>
      <div class="view-loading-grid"><span></span><span></span><span></span></div>
      <div class="view-loading-table"></div>
    </div>
  `;
}

function bindNavigationEvents() {
  if (navigationEventsBound || !navEl) return;
  navigationEventsBound = true;
  const sidebar = navEl.closest(".sidebar") || navEl;
  sidebar.addEventListener("click", async (event) => {
    const allToggle = event.target.closest("#nav-expand-toggle");
    if (allToggle && sidebar.contains(allToggle)) {
      event.preventDefault();
      toggleAllVisibleNavGroups();
      return;
    }
    const primary = event.target.closest(".nav-btn[data-nav-group]");
    if (primary && navEl.contains(primary)) {
      const group = navGroups.find((item) => item.key === primary.dataset.navGroup);
      if (!group || !groupViews(group).some(([key]) => canView(key))) return;
      if (expandedNavGroups.has(group.key)) expandedNavGroups.delete(group.key);
      else expandedNavGroups.add(group.key);
      navExpansionMode = "custom";
      normalizeExpandedNavGroups();
      saveExpandedNavGroups();
      renderNav();
      return;
    }

    const secondary = event.target.closest(".nav-sub-btn[data-view]");
    if (!secondary || !navEl.contains(secondary) || !canView(secondary.dataset.view)) return;
    const nextView = secondary.dataset.view;
    if (!nextView) return;
    event.preventDefault();
    setActiveView(nextView);
    renderViewTransitionSkeleton();
    try { await load({ refreshGlobal: false }); }
    catch (error) {
      if (error?.name !== "AbortError") renderLoadFailure(error);
    }
  });
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
function markDirty(key) { dirtyFlags[key] = true; if (state) state.full_bootstrap_key = ""; }     /* [约束6] 设置脏标记 */
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
  const metricValues = document.querySelectorAll(".lesson-summary-grid .metric-value");
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
  closeScheduleInlinePicker();
  tbody.innerHTML = lessonRowsHtml(rows);
  applyLessonTableStudentColumnWidth(measureVisibleStudentColumnWidth(rows));
  updateLessonSelectionControls(rows);
  cleanupCustomSelectPortals();
  if (scheduleMode) {
    /* 排课模式才渲染 select/date input，避免浏览态滚动时背着大量控件。 */
    enhanceCustomDateInputs();
    tbody.querySelectorAll(".multi-select:not(.schedule-student-popover)").forEach(bindMultiSelectControl);
    tbody.querySelectorAll(".schedule-student-popover").forEach(bindScheduleStudentPopover);
  }
}

function lessonFilterRegionHtml(allRows = lessonDateRangeRows(), rows = visibleLessonRows()) {
  const focusSet = new Set(focusedLessonIds.map(Number).filter(Boolean));
  if (focusSet.size) {
    return `
    <div class="band focus-lesson-panel">
      <div class="focus-lesson-body">
        <div>
          <strong>正在查看冲突相关课程</strong>
          <span>已定位 ${rows.length} 节课程，可直接在下方修改老师、时间、教室或学生。</span>
        </div>
        <button class="btn clear-focused-lessons" type="button">返回全部课程</button>
      </div>
    </div>
  `;
  }
  return renderLessonFilterBar({ rows: allRows, filteredRows: rows });
}

function lessonModalsHtml(rows = visibleLessonRows()) {
  return `
    ${lessonCreateModal()}
    ${lessonBatchCopyModal()}
    ${weekCopyModal()}
    ${lessonConflictModal(rows)}
    ${lessonConflictEditModal()}
  `;
}

function updateLessonFilterRegion(rows = visibleLessonRows(), allRows = lessonDateRangeRows()) {
  const region = document.querySelector(".lesson-filter-region");
  if (region) {
    region.querySelectorAll(".multi-select.open").forEach(closeMultiSelectMenu);
    region.innerHTML = lessonFilterRegionHtml(allRows, rows);
  }
}

function updateLessonToolbarRegion(rows = visibleLessonRows()) {
  const region = document.querySelector(".lesson-toolbar-region");
  if (region) region.innerHTML = lessonToolbarHtml(rows);
}

function updateLessonModalRegion(rows = visibleLessonRows()) {
  const region = document.querySelector(".lesson-modal-region");
  if (region) {
    closeSearchablePicker();
    region.innerHTML = lessonModalsHtml(rows);
  }
}

function updateLessonsViewDom({
  refreshSummary = true,
  refreshFilter = true,
  refreshToolbar = true,
  refreshTable = true,
  refreshModals = true,
} = {}) {
  if (view !== "lessons" || !document.querySelector("#lessons-tbody")) {
    render();
    return;
  }
  ensureLessonFilterDates();
  const scroll = captureLessonScroll();
  const allRows = lessonDateRangeRows();
  const rows = visibleLessonRows();
  pruneSelectedLessons(rows);
  renderTopbar(`课程总表：${formatLessonDateRange()}`, "");
  if (refreshSummary) updateLessonSummaryMetrics();
  if (refreshFilter) updateLessonFilterRegion(rows, allRows);
  if (refreshToolbar) updateLessonToolbarRegion(rows);
  if (refreshTable) reRenderLessonsTbody();
  else updateLessonSelectionControls(rows);
  if (refreshModals) updateLessonModalRegion(rows);
  updateLessonConflictButton(rows);
  applyReadonlyUi();
  wireEvents();
  restoreLessonScroll(scroll);
}

async function refreshLessonsView({
  reloadRange = false,
  full = false,
  refreshSummary = true,
  refreshFilter = true,
  refreshToolbar = true,
  refreshTable = true,
  refreshModals = true,
} = {}) {
  ensureLessonFilterDates();
  if (reloadRange || !lessonRangeLoaded()) {
    await loadLessonRangeOnly();
    await refreshLessonConflicts();
  }
  if (full || view !== "lessons" || !document.querySelector("#lessons-tbody")) {
    render();
    return;
  }
  updateLessonsViewDom({ refreshSummary, refreshFilter, refreshToolbar, refreshTable, refreshModals });
}

/* ── 冲突重刷 ─────────────────────────────────────────────────────── */
async function refreshLessonConflicts() {                /* [B档] 只调 GET /api/schedule-conflicts，不调 bootstrap / lessons-range */
  const requestId = ++lessonConflictRefreshRequest;
  try {
    const report = await request(
      `/api/schedule-conflicts?month=${encodeURIComponent(activeMonth)}${ignoreRoomOneConflict ? "&ignore_room_one=1" : ""}`
    );
    if (requestId === lessonConflictRefreshRequest) state.schedule_conflicts = report;
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
  let value = input.type === "number" ? numberValue(input.value) : input.value;
  if (field === "time_slot" && value) {
    const normalized = normalizeTimeSlot(value);
    if (!normalized) {
      input.value = previousLesson[field] ?? "";
      alert("时间格式无效，请使用 HH:mm-HH:mm，例如 08:30-10:30");
      return;
    }
    value = normalized;
    input.value = normalized;
  }
  if (field === "student_names") {
    value = normalizeLessonStudentNames(value);
    input.value = value;
  }

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
      let result;
      try {
        result = await request(`/api/lessons/${lessonId}`, {
          method: "PATCH",
          body: { [field]: value },
        });
      } catch (error) {
        if (error?.status !== 409 || !error?.data?.schedule_conflicts?.issue_count) throw error;
        const details = (error.data.schedule_conflicts.issues || []).slice(0, 3)
          .map((issue) => `${conflictTypeLabel(issue.type)}${issue.entity ? `：${issue.entity}` : ""}`)
          .join("；");
        if (!confirm(`服务端发现最新冲突：${details || "请检查时间安排"}。仍要保存吗？`)) throw new Error("已取消保存");
        result = await request(`/api/lessons/${lessonId}`, {
          method: "PATCH",
          body: { [field]: value, allow_conflicts: true },
        });
      }

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

function lessonInlineConflict(row = {}, field = "") {
  const lessonId = Number(row.id);
  if (!lessonId || !["time_slot", "classroom"].includes(field)) return false;
  return (state.schedule_conflicts?.issues || []).some((issue) => {
    if (!(issue.lesson_ids || []).map(Number).includes(lessonId)) return false;
    return field === "classroom" ? issue.type === "classroom" : ["teacher", "student", "classroom", "invalid_time"].includes(issue.type);
  });
}

function lessonInlinePickerDisplay(row = {}, field = "") {
  if (field === "status") return renderCourseStatusBadge(rowStatus(row));
  if (field === "grade") return renderGradeBadge(row.grade);
  if (field === "subject") return renderSubjectBadge(row.subject);
  const value = field === "time_slot" ? lessonCandidateValue(field, row[field]) : (row[field] || "");
  return `<span class="lesson-cell-text ${lessonInlineConflict(row, field) ? "candidate-conflict-text" : ""}">${escapeHtml(value)}</span>`;
}

function lessonInlinePickerCell(row, field, tdClass = "") {
  const fieldLabel = {
    teacher_name: "授课老师",
    status: "状态",
    time_slot: "时间",
    classroom: "教室",
    grade: "年级",
    subject: "科目",
  }[field] || "课程字段";
  const interaction = isReadonlyUser()
    ? ` aria-disabled="true" title="${escapeHtml(READONLY_WRITE_MESSAGE)}"`
    : ` data-lesson-edit-trigger data-lesson-id="${escapeHtml(row.id)}" data-field="${escapeHtml(field)}" role="button" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-label="编辑${fieldLabel}"`;
  // 触发属性放在 td 上，使单元格空白、文字和实体标签都属于同一个点击区域；
  // 事件委托绑定在稳定的 contentEl，tbody 局部重绘不会丢失编辑能力。
  return `<td class="${tdClass} lesson-edit-cell"${interaction}><span class="lesson-inline-picker">${lessonInlinePickerDisplay(row, field)}</span></td>`;
}

function scheduleInlinePickerOptions(row = {}, field = "") {
  const current = row[field] || "";
  const manualLabel = lessonManualLabel(field);
  if (field === "time_slot" || field === "classroom") {
    return lessonCandidateSelectOptions({
      field,
      values: field === "time_slot" ? getTimeOptions() : getRoomOptions(),
      current,
      candidate: { ...row, student_names: normalizeLessonStudentNames(row.student_names) },
      emptyText: "未选",
      manualLabel,
      excludeLessonId: row.id,
    });
  }
  const values = {
    teacher_name: getActiveTeacherOptions(),
    status: getStatusOptions(current),
    grade: getGradeOptions(),
    subject: getSubjectOptions(),
  }[field] || [];
  return manualSelectOptions(values, current, manualLabel, { emptyText: "未选" });
}

function closeScheduleInlinePicker({ restoreFocus = false } = {}) {
  const active = activeScheduleInlinePicker;
  activeScheduleInlinePicker = null;
  if (!active) return;
  active.trigger?.setAttribute("aria-expanded", "false");
  closeCustomSelects();
  active.menu?.remove();
  active.wrapper?.remove();
  active.select?.remove();
  if (restoreFocus && active.trigger?.isConnected) active.trigger.focus();
}

function openScheduleInlinePicker(trigger) {
  if (!trigger || isReadonlyUser()) return;
  const row = (state.lessons || []).find((item) => String(item.id) === String(trigger.dataset.lessonId));
  const field = trigger.dataset.field || "";
  if (!row || !field) return;
  closeScheduleInlinePicker();
  const select = document.createElement("select");
  select.className = `schedule-inline-picker-native ${field === "status" ? "status-select" : ""}`;
  select.dataset.id = String(row.id);
  select.dataset.field = field;
  select.innerHTML = scheduleInlinePickerOptions(row, field);
  trigger.appendChild(select);
  enhanceCustomSelects();
  const wrapper = select.nextElementSibling?.matches?.(".custom-select") ? select.nextElementSibling : null;
  const menu = customSelectMenu(wrapper);
  if (!wrapper || !menu) {
    select.remove();
    return;
  }
  wrapper.classList.add("schedule-inline-picker-anchor");
  activeScheduleInlinePicker = { select, wrapper, menu, trigger };
  trigger.setAttribute("aria-expanded", "true");
  select.addEventListener("change", () => {
    Promise.resolve(handleLessonFieldChange(select)).finally(() => closeScheduleInlinePicker());
  }, { once: true });
  openCustomSelect(wrapper);
}

function lessonTextCell(colClass, value, { html = "", title = value } = {}) {
  const shown = html || escapeHtml(value || "");
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<td class="readonly ${colClass}"${titleAttr}><span class="lesson-cell-text">${shown}</span></td>`;
}

function measureVisibleStudentColumnWidth(lessons = visibleLessonRows()) {
  const signature = (lessons || []).map((row) => `${row.id}:${row.student_names || ""}`).join("|");
  if (lessonStudentWidthCache.signature === signature) return lessonStudentWidthCache.width;
  const probe = document.createElement("canvas").getContext("2d");
  const rootStyle = getComputedStyle(document.documentElement);
  const bodyStyle = getComputedStyle(document.body);
  const tableFontSize = rootStyle.getPropertyValue("--text-table").trim() || "13px";
  // 使用课程表自身的设计变量，不依赖首次渲染时旧表格 DOM 是否已经存在。
  probe.font = `400 ${tableFontSize} ${bodyStyle.fontFamily}`;
  const badgePadding = 16;
  const badgeGap = 5;
  const cellPadding = 16;
  const contentWidth = Math.max(0, ...(lessons || []).map((row) => splitStudents(row.student_names || "").reduce((sum, value, index) => (
    sum + probe.measureText(value).width + badgePadding + (index ? badgeGap : 0)
  ), 0)));
  // 文字宽度加上单元格内边距；排课态另为按钮预留下拉箭头空间。
  const width = Math.max(156, Math.ceil(contentWidth + cellPadding));
  lessonStudentWidthCache = { signature, width };
  return width;
}

function applyLessonTableStudentColumnWidth(width = measureVisibleStudentColumnWidth()) {
  document.querySelector(".lesson-table")?.style.setProperty("--lesson-student-column-width", `${width}px`);
}

function lessonReadonlyCells(row, visibleIndex, cumulative) {
  return [
    lessonTextCell("col-serial narrow", String(visibleIndex), { title: `当前可见序号 ${visibleIndex}` }),
    lessonTextCell("col-teacher", row.teacher_name),
    lessonTextCell("col-date", row.date),
    lessonTextCell("col-weekday", weekdayCn(row.date)),
    lessonTextCell("col-time", row.time_slot, { html: `<span class="${lessonInlineConflict(row, "time_slot") ? "candidate-conflict-text" : ""}">${escapeHtml(row.time_slot || "")}</span>` }),
    lessonTextCell("col-room", row.classroom, { html: `<span class="${lessonInlineConflict(row, "classroom") ? "candidate-conflict-text" : ""}">${escapeHtml(row.classroom || "")}</span>` }),
    `<td class="readonly col-status">${renderCourseStatusBadge(rowStatus(row))}</td>`,
    `<td class="readonly col-grade">${renderGradeBadge(row.grade)}</td>`,
    `<td class="readonly col-subject">${renderSubjectBadge(row.subject)}</td>`,
    `<td class="readonly col-students"><div class="lesson-student-badges">${splitStudents(row.student_names).map((name) => renderStudentBadge(name, { fallbackGrade: row.grade })).join("") || '<span class="muted-tip">未填学生</span>'}</div></td>`,
    lessonTextCell("col-note", row.notes),
    lessonTextCell("col-index narrow", String(cumulative), { title: String(cumulative) }),
  ].join("");
}

function lessonEditCells(row, visibleIndex, cumulative) {
  return `
      <td class="readonly col-serial narrow"><span class="lesson-cell-text">${visibleIndex}</span></td>
      ${lessonInlinePickerCell(row, "teacher_name", "col-teacher")}
      ${inputCell({ className: "lesson-field", id: row.id, field: "date", value: row.date, type: "date", tdClass: "col-date" })}
      <td class="readonly col-weekday">${escapeHtml(weekdayCn(row.date))}</td>
      ${lessonInlinePickerCell(row, "time_slot", "col-time")}
      ${lessonInlinePickerCell(row, "classroom", "col-room")}
      ${lessonInlinePickerCell(row, "status", "col-status")}
      ${lessonInlinePickerCell(row, "grade", "col-grade")}
      ${lessonInlinePickerCell(row, "subject", "col-subject")}
      ${lessonScheduleStudentCell(row)}
      <td class="col-note"><textarea class="cell-input lesson-field wide lesson-note-input" data-id="${row.id}" data-field="notes" rows="1">${escapeHtml(row.notes || "")}</textarea></td>
      <td class="readonly col-index narrow">${cumulative}</td>
  `;
}

function lessonRow(row, visibleIndex, cumulative) {
  const lessonId = Number(row.id);
  const checked = selectedLessonIds.has(lessonId) ? "checked" : "";
  const rowWarnings = getLessonWarnings(row.id);         /* [约束5] 从缓存读取该行 warnings */
  const warningIcon = rowWarnings.length
    ? `<span class="lesson-warning-icon" title="${escapeHtml(rowWarnings.map((w) => w.message).join("\n"))}">⚠️</span>`
    : "";
  return `
    <tr class="${rowWarnings.length ? "has-warnings" : ""}" data-row-id="${row.id}"> <!-- [约束1/边界2] data-row-id 用于行定位与焦点恢复 -->
      <td class="lesson-select-cell col-select"><input class="lesson-select-row" type="checkbox" data-id="${row.id}" aria-label="选择课程" ${checked}>${warningIcon}</td>
      ${scheduleMode ? lessonEditCells(row, visibleIndex, cumulative) : lessonReadonlyCells(row, visibleIndex, cumulative)}
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
  return rows.map((row, index) => {
    cumulative += splitStudents(row.student_names).length;
    const currentGroup = `${row.date || ""}|${row.teacher_name || ""}`;
    const next = rows[index + 1];
    const nextGroup = next ? `${next.date || ""}|${next.teacher_name || ""}` : "";
    const addRow = scheduleMode && currentGroup !== nextGroup ? lessonScheduleAddRow(row) : "";
    return `${lessonRow(row, index + 1, cumulative)}${addRow}`;
  }).join("");
}

function lessonToolbarHtml(rows) {
  const selectedCount = selectedLessonIds.size;
  return `
    <div class="lesson-table-toolbar">
      <div class="lesson-table-actions">
        <button class="btn schedule-mode-toggle ${scheduleMode ? "primary" : ""}" type="button">${scheduleMode ? "结束排课" : "开始排课"}</button>
        <button class="btn add-lesson" type="button">新增课程</button>
        <button class="btn week-copy-btn" type="button">整周复制</button>
        <button class="btn batch-copy-lessons" type="button" ${selectedCount ? "" : "disabled"}>批量复制${selectedCount ? `（${selectedCount}）` : ""}</button>
        <button class="btn batch-complete-lessons" type="button" ${selectedCount ? "" : "disabled"}>批量已上${selectedCount ? `（${selectedCount}）` : ""}</button>
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
  syncNavExpandToggle(visibleGroups);
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
  if (key === "grades") {
    return uniqueSorted([
      ...((state.lookups?.grades || []).map((grade) => grade.name)),
      ...(state.used_lesson_lookups?.grades || []),
    ]);
  }
  return normalizeBaseDataValues(key, state.used_lesson_lookups?.[key] || []);
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
  const valid = uniqueSorted((usedLessonLookupValues("times") || [])
    .map((value) => normalizeTimeSlot(value))
    .filter(Boolean));
  const rawCurrent = String(current || "").trim();
  const normalizedCurrent = normalizeTimeSlot(rawCurrent);
  if (!includeCurrent || !rawCurrent) return valid;
  // 已审计但无法解析的历史原值仍可在历史课程中显示；它不会进入普通候选池。
  return uniqueSorted([...valid, normalizedCurrent || rawCurrent]);
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
  let value = String(entered || "").trim();
  if (!value) {
    setSelectValueWithOption(select, previousValue || "");
    return false;
  }
  if (field === "time_slot") {
    const normalized = normalizeTimeSlot(value);
    if (!normalized) {
      alert("时间格式无效，请使用 HH:mm-HH:mm，例如 08:30-10:30");
      setSelectValueWithOption(select, previousValue || "");
      return false;
    }
    value = normalized;
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

function lessonCreateSelectedStudentNames(modal) {
  return [...(modal?.querySelectorAll(".lesson-create-student-existing:checked") || [])]
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);
}

function updateLessonCreateStudentStats(modal) {
  if (!modal) return;
  const selected = lessonCreateSelectedStudentNames(modal);
  const visible = [...modal.querySelectorAll(".lesson-create-student-option")]
    .filter((option) => !option.hidden).length;
  const selectedCount = modal.querySelector("[data-student-selected-count]");
  const resultCount = modal.querySelector("[data-student-result-count]");
  const empty = modal.querySelector(".lesson-create-student-search-empty");
  if (selectedCount) selectedCount.textContent = String(selected.length);
  if (resultCount) resultCount.textContent = String(visible);
  if (empty) empty.hidden = visible > 0;
  if (lessonCreateDraft) {
    lessonCreateDraft = { ...lessonCreateDraft, selected_students: selected };
  }
}

function filterLessonCreateStudents(modal, value = "") {
  if (!modal) return;
  const query = String(value || "").trim().toLocaleLowerCase("zh-Hans-CN");
  modal.querySelectorAll(".lesson-create-student-option").forEach((option) => {
    const name = String(option.dataset.studentName || "").toLocaleLowerCase("zh-Hans-CN");
    const filteredOut = Boolean(query) && !name.includes(query);
    option.hidden = filteredOut;
    option.classList.toggle("is-search-filtered", filteredOut);
    option.setAttribute("aria-hidden", String(filteredOut));
  });
  if (lessonCreateDraft) lessonCreateDraft = { ...lessonCreateDraft, student_search: value };
  updateLessonCreateStudentStats(modal);
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
    student_search: "",
    new_student_names: "",
    notes: "",
    status: "待上",
  };
}

function lessonCreateCandidateFromDraft(draft = {}) {
  const selected = normalizeNameList(draft.selected_students || []);
  const manualStudents = parseLessonCreateStudents(draft.new_student_names || "");
  return {
    date: isDateValue(draft.date) ? draft.date : "",
    time_slot: String(draft.time_slot || "").trim(),
    teacher_name: String(draft.teacher_name || "").trim(),
    classroom: String(draft.classroom || "").trim(),
    student_names: normalizeLessonStudentNames([...selected, ...manualStudents].join("、")),
    status: draft.status || "待上",
  };
}

function lessonCreateFieldValue(modal, field) {
  const select = modal?.querySelector(`.lesson-create-field[data-field="${field}"]`);
  if (!select) return "";
  if (select.value !== LESSON_CREATE_MANUAL_VALUE) return String(select.value || "").trim();
  return String(modal?.querySelector(`.lesson-create-manual-field[data-manual-field="${field}"]`)?.value || "").trim();
}

function lessonCreateCandidateFromModal(modal) {
  const selectedStudents = lessonCreateSelectedStudentNames(modal);
  const manualStudents = parseLessonCreateStudents(modal?.querySelector(".lesson-create-new-students")?.value || "");
  return {
    date: String(modal?.querySelector(".lesson-create-field[data-field=\"date\"]")?.value || "").trim(),
    time_slot: lessonCreateFieldValue(modal, "time_slot"),
    teacher_name: lessonCreateFieldValue(modal, "teacher_name"),
    classroom: lessonCreateFieldValue(modal, "classroom"),
    student_names: normalizeLessonStudentNames([...selectedStudents, ...manualStudents].join("、")),
    status: lessonCreateFieldValue(modal, "status") || "待上",
  };
}

function lessonCreateConflictHintHtml(info, candidate = {}) {
  if (!candidate.date || !candidate.time_slot) {
    return `<span>选择日期和时间后会实时检查老师、学生和教室冲突。</span>`;
  }
  if (!info?.conflict) return `<span>当前选择未发现冲突；候选项会随日期、老师、学生和教室即时排序。</span>`;
  const reasons = (info.reasons || []).slice(0, 4).map((reason) => {
    const detail = reason.lesson_label ? `（${reason.lesson_label}）` : "";
    return `${conflictTypeLabel(reason.type)}${reason.entity ? `：${reason.entity}` : ""}${detail}`;
  });
  const more = (info.reasons?.length || 0) > reasons.length ? `；另有 ${info.reasons.length - reasons.length} 项` : "";
  return `<strong>发现冲突</strong><span>${escapeHtml(`${reasons.join("；")}${more}`)}</span>`;
}

function rebuildLessonCreateSelect(select, optionsHtml) {
  if (!select) return;
  const wrapper = enhancedSelectWrapper(select);
  const menu = customSelectMenu(wrapper);
  closeCustomSelects();
  menu?.remove();
  wrapper?.remove();
  delete select.dataset.customSelect;
  select.classList.remove("native-select-hidden");
  select.removeAttribute("tabindex");
  select.removeAttribute("aria-hidden");
  select.innerHTML = optionsHtml;
  enhanceCustomSelects();
}

function lessonCreateConflictCandidateRows() {
  const rows = new Map();
  for (const row of [...(state?.lessons || []), ...(lessonCreateConflictRows || [])]) {
    const key = Number(row?.id) || `${row?.date || ""}|${row?.time_slot || ""}|${row?.teacher_name || ""}|${row?.classroom || ""}|${row?.student_names || ""}`;
    rows.set(key, row);
  }
  return [...rows.values()];
}

async function refreshLessonCreateConflictRows(modal) {
  const candidate = lessonCreateCandidateFromModal(modal);
  const requestId = ++lessonCreateConflictRequest;
  if (!isDateValue(candidate.date)) {
    lessonCreateConflictRows = [];
    refreshLessonCreateConflictUi(modal);
    return;
  }
  try {
    const params = new URLSearchParams({ start: candidate.date, end: candidate.date, view: "lessons" });
    const result = await request(`/api/lessons-range?${params.toString()}`);
    if (requestId !== lessonCreateConflictRequest || !modal?.isConnected) return;
    const latestDate = lessonCreateCandidateFromModal(modal).date;
    if (latestDate !== candidate.date) return;
    lessonCreateConflictRows = result.lessons || [];
    refreshLessonCreateConflictUi(modal);
  } catch {
    // 当前已加载课程仍会参与本地检查；范围请求失败不阻断课程填写。
  }
}

function refreshLessonCreateConflictUi(modal) {
  if (!modal) return;
  const candidate = lessonCreateCandidateFromModal(modal);
  const conflictRows = lessonCreateConflictCandidateRows();
  const definitions = [
    { field: "time_slot", values: getTimeOptions(candidate.time_slot), manualLabel: lessonManualLabel("time_slot") },
    { field: "classroom", values: getRoomOptions(candidate.classroom), manualLabel: lessonManualLabel("classroom") },
  ];
  for (const definition of definitions) {
    const select = modal.querySelector(`.lesson-create-field[data-field="${definition.field}"]`);
    if (!select) continue;
    const currentSelectValue = String(select.value || "").trim();
    const current = currentSelectValue === LESSON_CREATE_MANUAL_VALUE
      ? LESSON_CREATE_MANUAL_VALUE
      : lessonCreateFieldValue(modal, definition.field);
    const markup = lessonCandidateSelectOptions({
      field: definition.field,
      values: definition.values,
      current,
      candidate,
      emptyText: "未选",
      manualLabel: definition.manualLabel,
      rows: conflictRows,
    });
    rebuildLessonCreateSelect(select, markup);
  }
  const nextCandidate = lessonCreateCandidateFromModal(modal);
  const info = buildLessonCandidateConflict(nextCandidate, { rows: conflictRows });
  const hint = modal.querySelector(".lesson-create-conflict-hint");
  if (hint) {
    hint.classList.toggle("has-conflict", info.conflict);
    hint.innerHTML = lessonCreateConflictHintHtml(info, nextCandidate);
  }
  if (lessonCreateDraft) {
    lessonCreateDraft = {
      ...lessonCreateDraft,
      ...nextCandidate,
      selected_students: lessonCreateSelectedStudentNames(modal),
      new_student_names: modal.querySelector(".lesson-create-new-students")?.value || "",
    };
  }
}

function lessonCreateModal() {
  if (!lessonCreateDraft) return "";
  const draft = { ...defaultLessonCreateDraft(), ...lessonCreateDraft };
  const date = isDateValue(draft.date) ? draft.date : todayDate();
  const students = lessonStudentOptions();
  const selectedStudents = new Set(draft.selected_students || []);
  const studentSearch = String(draft.student_search || "");
  const normalizedStudentSearch = studentSearch.trim().toLocaleLowerCase("zh-Hans-CN");
  const studentResultCount = students.filter((name) => String(name).toLocaleLowerCase("zh-Hans-CN").includes(normalizedStudentSearch)).length;
  const status = draft.status || "待上";
  const candidate = lessonCreateCandidateFromDraft({ ...draft, date });
  const conflictInfo = buildLessonCandidateConflict(candidate, { rows: lessonCreateConflictCandidateRows() });
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
            <input class="control lesson-create-field lesson-create-date" data-date-kind="single" data-field="date" type="date" value="${escapeHtml(date)}">
          </label>
          <label class="filter-field">
            <span>星期</span>
            <input class="control lesson-create-weekday" type="text" value="${escapeHtml(weekdayCn(date))}" readonly>
          </label>
          <label class="filter-field">
            <span>时间</span>
            <select class="control lesson-create-field" data-field="time_slot">
              ${lessonCandidateSelectOptions({ field: "time_slot", values: getTimeOptions(draft.time_slot), current: draft.time_slot, candidate, manualLabel: lessonManualLabel("time_slot") })}
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
              ${lessonCandidateSelectOptions({ field: "classroom", values: getRoomOptions(draft.classroom), current: draft.classroom, candidate, manualLabel: lessonManualLabel("classroom") })}
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
            <div class="lesson-create-student-search-wrap">
              <input class="control lesson-create-student-search" type="search" autocomplete="off" spellcheck="false" placeholder="按学生姓名搜索" value="${escapeHtml(studentSearch)}">
              <div class="lesson-create-student-search-stats" aria-live="polite">
                <span>已选择 <b data-student-selected-count>${selectedStudents.size}</b> 人</span>
                <span>当前结果 <b data-student-result-count>${studentResultCount}</b> 人</span>
              </div>
            </div>
            <div class="lesson-create-student-list">
              ${students.map((name) => `
                <label class="lesson-create-student-option ${normalizedStudentSearch && !String(name).toLocaleLowerCase("zh-Hans-CN").includes(normalizedStudentSearch) ? "is-search-filtered" : ""}" data-student-name="${escapeHtml(name)}" ${normalizedStudentSearch && !String(name).toLocaleLowerCase("zh-Hans-CN").includes(normalizedStudentSearch) ? "hidden aria-hidden=\"true\"" : "aria-hidden=\"false\""}>
                  <input class="lesson-create-student-existing" type="checkbox" value="${escapeHtml(name)}" ${selectedStudents.has(name) ? "checked" : ""}>
                  <span>${escapeHtml(name)}</span>
                </label>
              `).join("") || `<span class="muted-tip">暂无学生档案，可在下方手动输入。</span>`}
              <span class="muted-tip lesson-create-student-search-empty" ${studentResultCount ? "hidden" : ""}>未找到匹配的在读学生，已勾选学生不会被清除。</span>
            </div>
            <textarea class="control lesson-create-new-students" rows="3" placeholder="新增学生，可用逗号、顿号或换行分隔">${escapeHtml(draft.new_student_names || "")}</textarea>
          </label>
          <label class="filter-field">
            <span>备注</span>
            <input class="control lesson-create-field" data-field="notes" type="text" value="${escapeHtml(draft.notes)}">
          </label>
        </div>
        <div class="lesson-create-conflict-hint ${conflictInfo.conflict ? "has-conflict" : ""}" aria-live="polite">
          ${lessonCreateConflictHintHtml(conflictInfo, candidate)}
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
              <thead><tr><th>授课老师</th><th>日期</th><th>星期</th><th>时间</th><th>教室</th><th>状态</th><th>年级</th><th>科目</th><th>学生</th><th>备注</th></tr></thead>
              <tbody>
                ${sourceRows.map((row) => `
                  <tr>
                    <td class="text-cell">${escapeHtml(row.teacher_name)}</td>
                    <td class="text-cell">${escapeHtml(row.date)}</td>
                    <td class="text-cell">${escapeHtml(weekdayCn(row.date))}</td>
                    <td class="text-cell">${escapeHtml(row.time_slot)}</td>
                    <td class="text-cell">${escapeHtml(row.classroom)}</td>
                    <td class="text-cell">${renderEntityBadge("status", rowStatus(row))}</td>
                    <td class="text-cell">${renderEntityBadge("grade", row.grade)}</td>
                    <td class="text-cell">${renderEntityBadge("subject", row.subject)}</td>
                    <td class="text-cell"><span class="entity-badge-list">${splitStudents(row.student_names).map((name) => renderEntityBadge("student", name, { fallbackGrade: row.grade })).join("")}</span></td>
                    <td class="text-cell">${escapeHtml(row.notes)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <div class="small-title">目标课程</div>
          <div class="table-wrap copy-preview-wrap batch-copy-edit-wrap">
            <table class="copy-preview-table batch-copy-edit-table">
              <thead><tr><th>授课老师</th><th>日期</th><th>星期</th><th>时间</th><th>教室</th><th>状态</th><th>年级</th><th>科目</th><th>学生</th><th>备注</th></tr></thead>
              <tbody>
                ${targetRows.map((row, index) => `
                  <tr>
                    <td>${batchCopySelectCell(index, "teacher_name", row.teacher_name)}</td>
                    <td>${batchCopyInputCell(index, "date", row.date, "date")}</td>
                    <td class="readonly">${escapeHtml(weekdayCn(row.date))}</td>
                    <td>${batchCopySelectCell(index, "time_slot", row.time_slot)}</td>
                    <td>${batchCopySelectCell(index, "classroom", row.classroom)}</td>
                    <td>${batchCopySelectCell(index, "status", row.status || "待上", { emptyText: "" })}</td>
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

function weekCopyPreviewRows(sourceStart, targetStart) {
  const offset = dayDiff(sourceStart, targetStart);
  return weekCopySourceRows(sourceStart).map((source) => ({
    source,
    target: {
      ...source,
      id: -Math.abs(Number(source.id) || Date.now()),
      source_id: Number(source.id),
      date: addDays(source.date, offset),
      month_key: monthKeyFromDateValue(addDays(source.date, offset)) || source.month_key,
      status: "待上",
      lesson_status: "",
      course_status: "",
    },
  }));
}

function weekCopyTargetConflictInfo(previewRows) {
  const targetRows = previewRows.map((item) => item.target);
  const targetDates = new Set(targetRows.map((row) => row.date).filter(Boolean));
  const sourceIds = new Set(previewRows.map((item) => Number(item.source.id)).filter(Boolean));
  const existingRows = sortLessons(state.week_lessons || state.lessons || [])
    .filter((row) => targetDates.has(row.date) && !sourceIds.has(Number(row.id)));
  const issues = localScheduleConflicts([...existingRows, ...targetRows]);
  const visible = visibleConflictIssues(issues);
  const conflictMap = conflictMapByLesson(issues);
  return { issues: visible.issues, conflictMap, targetRows };
}

function weekCopyModal() {
  if (!weekCopyDraft) return "";
  const sourceStart = weekCopyDraft.sourceStart || startOfWeek(todayDate());
  const targetStart = weekCopyDraft.targetStart || addDays(sourceStart, 7);
  const previewRows = weekCopyPreviewRows(sourceStart, targetStart);
  const { issues, conflictMap } = weekCopyTargetConflictInfo(previewRows);
  const conflictTotal = issues.length;
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
              <input class="control week-copy-source" data-date-kind="single" type="date" value="${escapeHtml(sourceStart)}">
          </label>
          <label class="filter-field">
            <span>目标周周一</span>
              <input class="control week-copy-target" data-date-kind="single" type="date" value="${escapeHtml(targetStart)}">
          </label>
        </div>
        <div class="week-copy-conflict-summary ${conflictTotal ? "has-conflict" : "is-clear"}">
          <strong>${conflictTotal ? `发现 ${conflictTotal} 条冲突提示` : "冲突数量 0"}</strong>
          <span>${conflictTotal ? "请重点核对目标课程的老师、学生、时间和教室。" : "当前已加载课程中未发现目标周时间冲突。"}</span>
        </div>
        <div class="table-wrap copy-preview-wrap">
          <table class="copy-preview-table">
            <thead><tr><th>原课程</th><th>目标课程</th><th>老师</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th>学生</th><th>备注/冲突</th></tr></thead>
            <tbody>
              ${previewRows.map(({ source, target }) => {
                const conflictLabels = [...(conflictMap.get(Number(target.id)) || [])];
                return `
                  <tr class="${conflictLabels.length ? "has-conflict" : ""}">
                    <td class="text-cell">${escapeHtml(source.date)} ${escapeHtml(weekdayCn(source.date))}</td>
                    <td class="text-cell">${escapeHtml(target.date)} ${escapeHtml(weekdayCn(target.date))}</td>
                    <td class="text-cell">${escapeHtml(target.teacher_name)}</td>
                    <td class="text-cell">${escapeHtml(target.time_slot)}</td>
                    <td class="text-cell">${escapeHtml(target.classroom)}</td>
                    <td class="text-cell">${renderEntityBadge("grade", target.grade)}</td>
                    <td class="text-cell">${renderEntityBadge("subject", target.subject)}</td>
                    <td class="text-cell"><span class="entity-badge-list">${splitStudents(target.student_names).map((name) => renderEntityBadge("student", name, { fallbackGrade: target.grade })).join("")}</span></td>
                    <td class="text-cell">${escapeHtml([target.notes, ...conflictLabels].filter(Boolean).join(" / "))}</td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="9" class="empty">源周暂无课程</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="modal-actions">
          <span class="muted-tip">将复制 ${previewRows.length} 节课</span>
          <button class="btn week-copy-cancel" type="button">取消</button>
          <button class="btn primary week-copy-confirm" type="button" ${previewRows.length ? "" : "disabled"}>确认复制</button>
        </div>
      </div>
    </div>
  `;
}

function renderLessons() {
  ensureLessonFilterDates();
  const allRows = lessonDateRangeRows();
  const rows = visibleLessonRows();
  pruneSelectedLessons(rows);
  const stats = lessonStats(rows);
  const studentColumnWidth = measureVisibleStudentColumnWidth(rows);
  const rangeText = formatLessonDateRange();
  renderTopbar(
    `课程总表：${rangeText}`,
    "",
  );
  contentEl.innerHTML = `
    <div class="summary-grid lesson-summary-grid">
      <div class="metric"><div class="metric-label">课程记录</div><div class="metric-value">${stats.records}</div></div>
      <div class="metric"><div class="metric-label">有效课程</div><div class="metric-value">${stats.effective}</div></div>
      <div class="metric"><div class="metric-label">学生人次</div><div class="metric-value">${stats.studentTotal}</div></div>
      <div class="metric"><div class="metric-label">教师人数</div><div class="metric-value">${stats.teacherCount}</div></div>
    </div>
    <div class="lesson-filter-region">${lessonFilterRegionHtml(allRows, rows)}</div>
    <div class="lesson-toolbar-region">${lessonToolbarHtml(rows)}</div>
    <div class="band">
      <div class="table-wrap smooth-table-wrap lesson-table-scroll">
        <table class="course-table lesson-table uniform-table nowrap-table ${scheduleMode ? "is-editing" : "is-browsing"}" style="--lesson-student-column-width:${studentColumnWidth}px">
          <colgroup><col span="10"><col class="col-students"><col span="2"></colgroup>
          <thead>
            <tr>
              <th class="lesson-select-head col-select"><input class="lesson-select-all" type="checkbox" aria-label="全选当前可见课程" ${rows.length ? "" : "disabled"}></th><th class="col-serial">序号</th><th class="col-teacher">授课老师</th><th class="col-date">日期</th><th class="col-weekday">星期</th><th class="col-time">时间</th><th class="col-room">教室</th><th class="col-status">状态</th><th class="col-grade">年级</th><th class="col-subject">科目</th><th class="col-students">学生</th><th class="col-note">备注</th><th class="col-index">累计序号</th>
            </tr>
          </thead>
          <tbody id="lessons-tbody"> <!-- [约束1] 固定 id 用于局部重绘定位 -->
            ${lessonRowsHtml(rows)}
          </tbody>
        </table>
      </div>
    </div>
    <div class="lesson-modal-region">${lessonModalsHtml(rows)}</div>
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
    .replace(/[：﹕]/g, ":")
    .replace(/[—–~～至到]/g, "-")
    .replace(/\s+/g, "");
  if (!raw || !/^[^-]+-[^-]+$/.test(raw)) return null;
  const toMinutes = (token) => {
    const match = String(token || "").match(/^(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  };
  const [startToken, endToken] = raw.split("-");
  const start = toMinutes(startToken);
  const end = toMinutes(endToken);
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

/*
 * 课程时间在前端的唯一规范：HH:mm-HH:mm。
 * 解析失败时返回空字符串，让调用方可以保留历史原值作展示、或在保存新值时明确提示用户。
 */
function normalizeTimeSlot(value) {
  const range = parseLessonTimeRange(value);
  if (!range) return "";
  const format = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return `${format(range.start)}-${format(range.end)}`;
}

function normalizeLessonStudentNames(value) {
  return uniqueSorted(splitStudents(value)).join("、");
}

function isLessonConflictActive(row = {}) {
  return rowStatus(row) !== "请假"
    && String(row.lesson_status || "").trim() !== "休息"
    && !String(row.course_status || "").trim().startsWith("暂停");
}

function lessonCandidateValue(field, value) {
  const raw = String(value || "").trim();
  return field === "time_slot" ? (normalizeTimeSlot(raw) || raw) : raw;
}

function lessonCandidateContext(values = {}) {
  return {
    id: values.id,
    date: String(values.date || "").trim(),
    time_slot: lessonCandidateValue("time_slot", values.time_slot),
    teacher_name: String(values.teacher_name || "").trim(),
    classroom: normalizeRoom(values.classroom),
    student_names: normalizeLessonStudentNames(values.student_names),
    status: values.status || rowStatus(values),
    lesson_status: values.lesson_status || "",
    course_status: values.course_status || "",
  };
}

function lessonCandidateConflictLessonLabel(row = {}) {
  return [
    row.date || "未填日期",
    row.time_slot || "未填时间",
    row.teacher_name || "未填老师",
    row.classroom || "未填教室",
    `${row.grade || ""}${row.subject || ""}`,
  ].filter(Boolean).join(" · ");
}

/*
 * 新增课程和排课行内编辑共用的候选冲突检查。
 * 只依赖当前已加载课程，不发 bootstrap 请求；最终保存仍由后端再校验。
 */
function buildLessonCandidateConflict(candidate = {}, { excludeLessonId = null, rows = state?.lessons || [] } = {}) {
  const target = lessonCandidateContext(candidate);
  const reasons = [];
  const relatedLessons = [];
  const seen = new Set();
  const targetRange = parseLessonTimeRange(target.time_slot);
  const addReason = (type, entity, row) => {
    const key = `${type}|${row.id || ""}|${entity || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    reasons.push({
      type,
      entity,
      lesson_id: row.id,
      lesson_label: lessonCandidateConflictLessonLabel(row),
    });
    relatedLessons.push(row);
  };

  if (!isLessonConflictActive(target)) {
    return { conflict: false, invalid_time: false, reasons, relatedLessons, candidate: target };
  }
  if (target.time_slot && !targetRange) {
    reasons.push({
      type: "invalid_time",
      entity: target.time_slot,
      lesson_id: null,
      lesson_label: "时间格式无法识别，请使用 HH:mm-HH:mm",
    });
    return { conflict: true, invalid_time: true, reasons, relatedLessons, candidate: target };
  }
  if (!target.date || !targetRange) {
    return { conflict: false, invalid_time: false, reasons, relatedLessons, candidate: target };
  }

  const targetStudents = new Set(splitStudents(target.student_names));
  const excludedId = excludeLessonId == null ? Number(target.id) : Number(excludeLessonId);
  for (const row of rows || []) {
    if (!isLessonConflictActive(row) || Number(row.id) === excludedId || row.date !== target.date) continue;
    const rowRange = parseLessonTimeRange(normalizeTimeSlot(row.time_slot) || row.time_slot);
    if (!rowRange || !(targetRange.start < rowRange.end && rowRange.start < targetRange.end)) continue;
    if (target.teacher_name && String(row.teacher_name || "").trim() === target.teacher_name) {
      addReason("teacher", target.teacher_name, row);
    }
    const room = normalizeRoom(row.classroom);
    if (target.classroom && room && room === target.classroom) {
      addReason("classroom", target.classroom, row);
    }
    const sharedStudents = splitStudents(row.student_names).filter((name) => targetStudents.has(name));
    for (const name of sharedStudents) addReason("student", name, row);
  }
  return { conflict: reasons.length > 0, invalid_time: false, reasons, relatedLessons, candidate: target };
}

function lessonCandidateConflictText(info, { limit = 3 } = {}) {
  if (!info?.conflict) return "当前候选未发现冲突";
  const text = (info.reasons || []).slice(0, limit).map((reason) => {
    if (reason.type === "invalid_time") return "时间格式无效，请使用 HH:mm-HH:mm";
    const entity = reason.entity ? `：${reason.entity}` : "";
    return `${conflictTypeLabel(reason.type)}${entity}`;
  });
  const more = (info.reasons?.length || 0) > limit ? ` 等 ${info.reasons.length} 项` : "";
  return `${text.join("；")}${more}`;
}

function sortLessonCandidateOptions({ field, values = [], current = "", candidate = {}, excludeLessonId = null, includeCurrent = true, rows } = {}) {
  const seen = new Set();
  const normalizedValues = [];
  const push = (value) => {
    const normalized = lessonCandidateValue(field, value);
    if (!normalized || normalized === LESSON_CREATE_MANUAL_VALUE || seen.has(normalized)) return;
    seen.add(normalized);
    normalizedValues.push(normalized);
  };
  (values || []).forEach(push);
  if (includeCurrent) push(current);
  return normalizedValues.map((value) => {
    const conflict = buildLessonCandidateConflict(
      { ...candidate, [field]: value },
      { excludeLessonId, rows },
    );
    return {
      value,
      conflict,
      label: value,
      title: conflict.conflict ? lessonCandidateConflictText(conflict) : "当前选课信息下可选",
    };
  }).sort((a, b) => {
    const status = Number(a.conflict.conflict) - Number(b.conflict.conflict);
    return status || a.value.localeCompare(b.value, "zh-Hans-CN");
  });
}

function lessonCandidateSelectOptions({
  field,
  values = [],
  current = "",
  candidate = {},
  emptyText = "未选",
  manualLabel = "",
  includeCurrent = true,
  excludeLessonId = null,
  rows,
} = {}) {
  const selected = lessonCandidateValue(field, current);
  const optionsForField = sortLessonCandidateOptions({ field, values, current: selected, candidate, excludeLessonId, includeCurrent, rows });
  return [
    emptyText ? `<option value="">${escapeHtml(emptyText)}</option>` : "",
    ...optionsForField.map((option) => `
      <option value="${escapeHtml(option.value)}" title="${escapeHtml(option.title)}" data-candidate-conflict="${option.conflict.conflict ? "1" : "0"}" ${option.value === selected ? "selected" : ""}>${escapeHtml(option.label)}</option>
    `),
    manualLabel ? `<option value="${LESSON_CREATE_MANUAL_VALUE}" ${current === LESSON_CREATE_MANUAL_VALUE ? "selected" : ""}>＋ ${escapeHtml(manualLabel)}</option>` : "",
  ].join("");
}

function lessonStudentPickerMarkup({
  selected = [],
  values = [],
  fallbackGrade = "",
  lessonId = "",
  className = "",
  toggleClass = "",
  hiddenClass = "",
  hiddenAttrs = "",
} = {}) {
  const selectedNames = normalizeNameList(selected);
  const candidateNames = optionValuesWithCurrent(values, selectedNames, true);
  return `
    <span class="multi-select schedule-student-popover ${escapeHtml(className)}" data-placeholder="选择学生" data-student-fallback-grade="${escapeHtml(fallbackGrade)}">
      <button class="multi-select-toggle lesson-schedule-student-field ${escapeHtml(toggleClass)}" type="button" aria-expanded="false" aria-label="编辑学生" title="编辑学生"><span class="lesson-student-badges schedule-student-badges">${selectedNames.map((name) => renderStudentBadge(name, { fallbackGrade })).join("") || '<span class="muted-tip">未填学生</span>'}</span></button>
      <input class="multi-select-value ${escapeHtml(hiddenClass)}" ${hiddenAttrs} type="hidden" value="${escapeHtml(selectedNames.join("\n"))}">
      <span class="multi-select-menu schedule-student-menu" role="dialog" aria-label="学生选择">
        <div class="lesson-student-picker-header">
          <div class="lesson-student-picker-search"><input class="multi-select-search" type="search" autocomplete="off" spellcheck="false" placeholder="搜索在读学生"><button class="btn schedule-student-search-clear" type="button">清空</button></div>
          <div class="schedule-student-stats">已选择 <b data-student-selected-count>${selectedNames.length}</b> 人 · 当前结果 <b data-student-result-count>${candidateNames.length}</b> 人</div>
        </div>
        <div class="schedule-student-selected" data-student-selected-list ${selectedNames.length ? "" : "hidden"}>${selectedNames.map((name) => renderStudentBadge(name, { fallbackGrade, removable: true, lessonId })).join("")}</div>
        <div class="schedule-student-options lesson-student-picker-list">
          ${candidateNames.map((name) => `<button class="multi-select-option ${selectedNames.includes(name) ? "selected" : ""}" type="button" data-value="${escapeHtml(name)}" title="${escapeHtml(name)}"><span class="multi-select-check">${selectedNames.includes(name) ? "✓" : ""}</span>${renderStudentBadge(name, { fallbackGrade })}</button>`).join("") || `<span class="multi-select-empty">暂无在读学生</span>`}
        </div>
        <div class="lesson-student-picker-add"><textarea class="control schedule-student-new-names" rows="2" placeholder="新增学生：用逗号、顿号、空格或换行分隔"></textarea></div>
        <div class="schedule-student-actions lesson-student-picker-footer"><button class="btn schedule-student-cancel" type="button">取消</button><button class="btn primary schedule-student-confirm" type="button">确认</button></div>
      </span>
    </span>`;
}

function lessonScheduleStudentCell(row) {
  const selected = normalizeNameList(splitStudents(row.student_names));
  const values = getActiveStudentOptions(selected, { includeCurrent: true });
  return `
    <td class="col-students lesson-schedule-students">
      ${lessonStudentPickerMarkup({
        selected,
        values,
        fallbackGrade: row.grade || "",
        lessonId: row.id,
        hiddenClass: "lesson-field",
        hiddenAttrs: `data-id="${escapeHtml(String(row.id))}" data-field="student_names"`,
      })}
    </td>`;
}

function filterLessonStudentCandidates(select, keyword = "") {
  const candidates = select?._studentCandidates || [];
  const needle = String(keyword || "").trim().toLocaleLowerCase("zh-Hans-CN");
  return candidates.filter((name) => !needle || String(name).toLocaleLowerCase("zh-Hans-CN").includes(needle));
}

function renderLessonStudentCandidateList(select, draft = []) {
  const menu = multiSelectMenuFor(select);
  const list = menu?.querySelector(".lesson-student-picker-list");
  if (!list) return;
  const selected = new Set(draft);
  const values = filterLessonStudentCandidates(select, menu.querySelector(".multi-select-search")?.value);
  const fallbackGrade = select.dataset.studentFallbackGrade || "";
  list.innerHTML = values.map((name) => `<button class="multi-select-option ${selected.has(name) ? "selected" : ""}" type="button" data-value="${escapeHtml(name)}" title="${escapeHtml(name)}"><span class="multi-select-check">${selected.has(name) ? "✓" : ""}</span>${renderStudentBadge(name, { fallbackGrade })}</button>`).join("") || '<span class="multi-select-empty">暂无匹配的在读学生</span>';
  const selectedCounter = menu.querySelector("[data-student-selected-count]");
  const resultCounter = menu.querySelector("[data-student-result-count]");
  if (selectedCounter) selectedCounter.textContent = String(draft.length);
  if (resultCounter) resultCounter.textContent = String(values.length);
  const selectedList = menu.querySelector("[data-student-selected-list]");
  if (selectedList) {
    selectedList.hidden = draft.length === 0;
    selectedList.innerHTML = draft.map((name) => renderStudentBadge(name, {
      fallbackGrade,
      removable: true,
      lessonId: select.querySelector(".lesson-field")?.dataset.id || "",
    })).join("");
  }
}

function bindScheduleStudentPopover(select) {
  if (!select || select.dataset.studentPopoverBound === "true") return;
  select.dataset.studentPopoverBound = "true";
  const hidden = select.querySelector(".multi-select-value");
  select._studentDraft = normalizeNameList(hidden?.value || "");
  select._studentCandidates = getActiveStudentOptions(select._studentDraft, { includeCurrent: true });
  select._studentSync = () => renderLessonStudentCandidateList(select, select._studentDraft || []);
  select._studentClose = () => {
    const menu = multiSelectMenuFor(select);
    const search = menu?.querySelector(".multi-select-search");
    const newNames = menu?.querySelector(".schedule-student-new-names");
    if (search) search.value = "";
    if (newNames) newNames.value = "";
    select._studentDraft = normalizeNameList(hidden?.value || "");
    select._studentSync();
    closeMultiSelectMenu(select);
  };
  select._studentConfirm = () => {
    const menu = multiSelectMenuFor(select);
    const newNames = menu?.querySelector(".schedule-student-new-names");
    const added = parseLessonCreateStudents(newNames?.value || "");
    const next = normalizeNameList([...(select._studentDraft || []), ...added]);
    select._studentDraft = next;
    select._studentCandidates = getActiveStudentOptions(next, { includeCurrent: true });
    if (newNames) newNames.value = "";
    if (hidden) {
      hidden.value = normalizeLessonStudentNames(next.join("、"));
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    }
    select._studentClose();
  };
  select._studentSync();
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
  return calculateVisibleLessonConflicts(rows);
}

// 课程总表的冲突提示必须与表格使用同一份可见课程集合；服务端全月冲突报告
// 仍用于最终保存校验，不能直接拿来作为当前筛选视图的统计或弹窗数据。
function getVisibleLessonsForConflictCheck() {
  return visibleLessonRows();
}

function calculateVisibleLessonConflicts(rows = getVisibleLessonsForConflictCheck()) {
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
      ${details.length ? `<div class="conflict-lessons">${details.map((lesson) => `<div class="conflict-lesson-entry">${conflictLessonDetailMarkup(lesson)}${Number(lesson.id) ? `<button class="btn conflict-edit-lesson" type="button" data-lesson-id="${Number(lesson.id)}" ${isReadonlyUser() ? "disabled title=\"只读账号不能修改\"" : ""}>${isReadonlyUser() ? "只读查看" : "处理"}</button>` : ""}</div>`).join("")}</div>` : (ids.length ? `<button class="btn conflict-edit-lesson" type="button" data-lesson-id="${ids[0]}" ${isReadonlyUser() ? "disabled" : ""}>${isReadonlyUser() ? "只读查看" : "处理"}</button>` : "")}
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

function syncLessonConflictModalBodyState() {
  document.body.classList.toggle("lesson-conflict-modal-open", Boolean(lessonConflictModalOpen || lessonConflictEditDraft));
}

function openVisibleLessonConflictsModal() {
  if (lessonConflictModalOpen) return;
  lessonConflictEditDraft = null;
  lessonConflictModalOpen = true;
  updateLessonsViewDom({ refreshSummary: false, refreshFilter: false, refreshToolbar: false, refreshTable: false, refreshModals: true });
  syncLessonConflictModalBodyState();
}

function closeVisibleLessonConflictsModal() {
  const changed = lessonConflictModalOpen || lessonConflictEditDraft;
  lessonConflictModalOpen = false;
  lessonConflictEditDraft = null;
  if (changed) updateLessonsViewDom({ refreshSummary: false, refreshFilter: false, refreshToolbar: false, refreshTable: false, refreshModals: true });
  syncLessonConflictModalBodyState();
}

function openConflictLessonEditor(lessonId) {
  if (isReadonlyUser() || !lessonConflictModalOpen) return;
  const id = Number(lessonId);
  const lesson = getVisibleLessonsForConflictCheck().find((row) => Number(row.id) === id)
    || state.lessons.find((row) => Number(row.id) === id)
    || (state.schedule_conflicts?.issues || []).flatMap((issue) => issue.lesson_details || []).find((row) => Number(row.id) === id);
  if (!lesson) return alert("未找到该课程，请刷新后重试");
  lessonConflictEditDraft = { ...lesson, status: lesson.status || rowStatus(lesson) };
  updateLessonsViewDom({ refreshSummary: false, refreshFilter: false, refreshToolbar: false, refreshTable: false, refreshModals: true });
  syncLessonConflictModalBodyState();
}

function closeConflictLessonEditor() {
  if (!lessonConflictEditDraft) return;
  lessonConflictEditDraft = null;
  updateLessonModalRegion();
  syncLessonConflictModalBodyState();
}

function conflictLessonDraftFromModal(modal) {
  const next = { ...(lessonConflictEditDraft || {}) };
  modal?.querySelectorAll(".conflict-edit-field").forEach((input) => {
    next[input.dataset.field] = input.value;
  });
  const selected = normalizeNameList(modal?.querySelector(".multi-select-value.conflict-edit-students")?.value || "");
  next.student_names = normalizeLessonStudentNames(selected.join("、"));
  next.weekday = weekdayCn(next.date);
  return next;
}

function refreshConflictLessonEditorForDate(modal) {
  if (!lessonConflictEditDraft || !modal) return;
  lessonConflictEditDraft = conflictLessonDraftFromModal(modal);
  updateLessonModalRegion();
  applyReadonlyUi();
  wireEvents();
  syncLessonConflictModalBodyState();
}

async function saveConflictLessonEditor(button) {
  if (!lessonConflictEditDraft || isReadonlyUser() || button.disabled) return;
  const modal = button.closest(".lesson-conflict-edit-modal");
  const payload = conflictLessonDraftFromModal(modal);
  payload.time_slot = normalizeTimeSlot(payload.time_slot);
  if (!isDateValue(payload.date) || !payload.time_slot) return alert("请填写有效日期和规范的时间（HH:mm-HH:mm）");
  const localConflict = buildLessonCandidateConflict(payload, { excludeLessonId: payload.id });
  if (localConflict.conflict && !confirm(`修改后仍有冲突：${lessonCandidateConflictText(localConflict)}。是否继续保存？`)) return;
  button.disabled = true;
  try {
    let updated;
    try {
      updated = await request(`/api/lessons/${payload.id}`, { method: "PATCH", body: payload });
    } catch (error) {
      if (error?.status !== 409 || !error?.data?.schedule_conflicts?.issue_count) throw error;
      if (!confirm("服务端发现最新冲突，仍要保存吗？")) { button.disabled = false; return; }
      updated = await request(`/api/lessons/${payload.id}`, { method: "PATCH", body: { ...payload, allow_conflicts: true } });
    }
    patchLessonInState(updated);
    markLessonDerivedDataDirty();
    lessonConflictEditDraft = null;
    await refreshLessonConflicts();
    updateLessonsViewDom({ refreshFilter: false, refreshSummary: true, refreshToolbar: true, refreshTable: true, refreshModals: true });
    syncLessonConflictModalBodyState();
  } catch (error) {
    button.disabled = false;
    alert(error.message || "保存失败");
  }
}

function lessonConflictEditModal() {
  const draft = lessonConflictEditDraft;
  if (!draft) return "";
  const candidate = lessonCandidateContext(draft);
  const students = normalizeNameList(splitStudents(draft.student_names));
  const studentSelector = lessonStudentPickerMarkup({
    selected: students,
    values: getActiveStudentOptions(students, { includeCurrent: true }),
    fallbackGrade: draft.grade || "",
    lessonId: draft.id,
    className: "conflict-student-popover",
    toggleClass: "conflict-edit-student-toggle",
    hiddenClass: "conflict-edit-students",
    hiddenAttrs: 'data-field="student_names"',
  });
  return `
    <div class="modal-backdrop lesson-conflict-edit-modal">
      <div class="modal-panel lesson-conflict-edit-panel">
        <div class="modal-head"><div><div class="modal-title">处理冲突课程</div><div class="modal-subtitle">修改只保存在此弹窗草稿；确认后由服务端进行最终冲突校验。</div></div><button class="btn conflict-edit-cancel" type="button">取消</button></div>
        <div class="copy-form conflict-edit-form">
          <label class="filter-field conflict-edit-date-field"><span>日期</span><span class="conflict-edit-date-control"><input class="control conflict-edit-field" data-date-kind="single" data-date-input-mode="editable" data-field="date" type="date" value="${escapeHtml(draft.date || "")}" aria-label="课程日期"><span class="conflict-edit-weekday">${escapeHtml(weekdayCn(draft.date) || "")}</span></span></label>
          <label class="filter-field"><span>授课老师</span><select class="control conflict-edit-field" data-field="teacher_name">${manualSelectOptions(getActiveTeacherOptions(draft.teacher_name), draft.teacher_name, lessonManualLabel("teacher_name"))}</select></label>
          <label class="filter-field"><span>时间</span><select class="control conflict-edit-field conflict-edit-candidate" data-field="time_slot">${lessonCandidateSelectOptions({ field: "time_slot", values: getTimeOptions(draft.time_slot), current: draft.time_slot, candidate, excludeLessonId: draft.id, manualLabel: lessonManualLabel("time_slot") })}</select></label>
          <label class="filter-field"><span>教室</span><select class="control conflict-edit-field conflict-edit-candidate" data-field="classroom">${lessonCandidateSelectOptions({ field: "classroom", values: getRoomOptions(draft.classroom), current: draft.classroom, candidate, excludeLessonId: draft.id, manualLabel: lessonManualLabel("classroom") })}</select></label>
          <label class="filter-field"><span>年级</span><select class="control conflict-edit-field" data-field="grade">${manualSelectOptions(getGradeOptions(draft.grade), draft.grade, lessonManualLabel("grade"))}</select></label>
          <label class="filter-field"><span>科目</span><select class="control conflict-edit-field" data-field="subject">${manualSelectOptions(getSubjectOptions(draft.subject), draft.subject, lessonManualLabel("subject"))}</select></label>
          <label class="filter-field"><span>状态</span><select class="control conflict-edit-field" data-field="status">${manualSelectOptions(getStatusOptions(draft.status || rowStatus(draft)), draft.status || rowStatus(draft), lessonManualLabel("status"), { emptyText: "" })}</select></label>
          <label class="filter-field"><span>备注</span><textarea class="control conflict-edit-field" data-field="notes" rows="2">${escapeHtml(draft.notes || "")}</textarea></label>
          <div class="filter-field conflict-edit-student-field"><span>学生</span>${studentSelector}</div>
        </div>
        <div class="modal-actions"><button class="btn conflict-edit-cancel" type="button">取消</button><button class="btn primary conflict-edit-save" type="button">保存修改</button></div>
      </div>
    </div>`;
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
  const meta = [
    row.teacher_name ? `<span>老师：${escapeHtml(row.teacher_name)}</span>` : "",
    row.classroom ? `<span>教室：${escapeHtml(row.classroom)}</span>` : "",
  ].filter(Boolean).join("");
  const students = splitStudents(row.student_names);
  const notes = row.notes ? `<div class="week-grid-notes">${escapeHtml(row.notes)}</div>` : "";
  const conflictLabels = [...(conflictMap.get(Number(row.id)) || [])];
  const conflictBadges = conflictLabels.length
    ? `<div class="week-grid-conflicts">${conflictLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>`
    : "";
  return `
    <div class="matrix-lesson-card week-grid-card ${isAbnormal(row) ? "abnormal" : ""} ${conflictLabels.length ? "has-conflict" : ""}">
      <div class="week-grid-course"><span class="entity-badge-list">${renderEntityBadge("grade", row.grade)}${renderEntityBadge("subject", row.subject)}${statusBadge(rowStatus(row))}</span></div>
      ${conflictBadges}
      <div class="week-grid-meta">${meta}</div>
      <div class="week-grid-students"><span class="entity-badge-list">${students.map((name) => renderEntityBadge("student", name, { fallbackGrade: row.grade })).join("") || "未填学生"}</span></div>
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
  const counterpartLabel = type === "teacher" ? "教室" : "老师";
  const counterpartValue = type === "teacher" ? row.classroom : row.teacher_name;
  const students = splitStudents(row.student_names)
    .map((name) => renderEntityBadge("student", name, { fallbackGrade: row.grade }))
    .join("");
  const notes = row.notes ? `<div class="matrix-dimension-note">${escapeHtml(row.notes)}</div>` : "";
  return `
    <div class="matrix-lesson-card matrix-dimension-card ${isAbnormal(row) ? "abnormal" : ""}">
      <div class="matrix-dimension-time">${escapeHtml(row.time_slot || "未填时间")}</div>
      <div class="matrix-lesson-card-badges entity-badge-list">
        ${renderEntityBadge("grade", row.grade)}
        ${renderEntityBadge("subject", row.subject)}
        ${statusBadge(rowStatus(row))}
      </div>
      <div class="matrix-dimension-meta">
        <span>${escapeHtml(counterpartLabel)}：${escapeHtml(counterpartValue || "未填")}</span>
        <span class="entity-badge-list">${students || "未填学生"}</span>
      </div>
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
              ${days.map((day) => `<th class="matrix-dimension-date-head">${escapeHtml(day.label)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${entities.map((entity) => `
              <tr>
                <th class="matrix-dimension-entity">${escapeHtml(entity)}</th>
                ${days.map((day) => {
                  const lessons = byCell.get(`${entity}|${day.date}`) || [];
                  return `<td class="matrix-dimension-day">${lessons.map((lesson) => matrixDimensionCard(lesson, type)).join("")}</td>`;
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
  const ranges = [];
  ensureMatrixRange();
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
    : {
      ...currentWeekRange(),
      start_date: currentWeekRange().start,
      end_date: currentWeekRange().end,
      label: "当前周",
      includes(value) {
        const current = currentWeekRange();
        return value >= current.start && value <= current.end;
      },
    };
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
      <button class="btn matrix-range-reset" type="button">重置</button>
    </div>
  `;
}

function weekDetailGroupKey(row) {
  const teacherName = String(row?.teacher_name ?? "").trim();
  const date = String(row?.date ?? "").trim();
  return `${teacherName}__${date}`;
}

function renderWeekMatrix() {
  const { range, weekRows, rows, conflicts } = weekViewData({ customRange: true });
  renderTopbar(
    "矩阵课表",
    `${range.label} · 已筛选 ${rows.length} / 共 ${weekRows.length} 节`,
  );
  contentEl.innerHTML = `
    <div class="matrix-date-region">${renderMatrixDateFilter()}</div>
    <div class="matrix-tabs-region">${renderMatrixViewTabs()}</div>
    <div class="matrix-filter-region">${renderLessonFilterBar({ rows: weekRows, filteredRows: rows, compact: true })}</div>
    <div class="matrix-view-region">${renderMatrixScheduleView(rows, range, conflicts)}</div>
  `;
}

async function loadWeekMatrixRangeOnly() {
  ensureMatrixRange();
  const matrixStart = matrixRange.start;
  const matrixEnd = matrixRange.end;
  if (!matrixStart || !matrixEnd) return;
  const result = await request(lessonsRangeUrl({ start: matrixStart, end: matrixEnd }, "weekMatrix"));
  state.week_lessons = result.lessons || [];
}

function bindMatrixViewTabEvents() {
  document.querySelectorAll(".matrix-view-tab").forEach((button) => {
    button.addEventListener("click", () => {
      switchMatrixViewOnly(button.dataset.matrixView || "time");
    });
  });
}

function updateMatrixViewOnly() {
  if (view !== "weekMatrix" || !document.querySelector(".matrix-view-region")) {
    render();
    return;
  }
  const { range, rows, conflicts } = weekViewData({ customRange: true });
  const tabsRegion = document.querySelector(".matrix-tabs-region");
  const viewRegion = document.querySelector(".matrix-view-region");
  if (tabsRegion) tabsRegion.innerHTML = renderMatrixViewTabs();
  if (viewRegion) viewRegion.innerHTML = renderMatrixScheduleView(rows, range, conflicts);
  applyReadonlyUi();
  bindMatrixViewTabEvents();
}

function switchMatrixViewOnly(nextView) {
  matrixView = ["time", "teacher", "classroom"].includes(nextView) ? nextView : "time";
  localStorage.setItem(MATRIX_VIEW_KEY, matrixView);
  updateMatrixViewOnly();
}

async function refreshWeekMatrixView({ reloadRange = false } = {}) {
  ensureMatrixRange();
  if (reloadRange) await loadWeekMatrixRangeOnly();
  if (view !== "weekMatrix" || !document.querySelector(".matrix-view-region")) {
    render();
    return;
  }
  const { range, weekRows, rows, conflicts } = weekViewData({ customRange: true });
  renderTopbar("矩阵课表", `${range.label} · 已筛选 ${rows.length} / 共 ${weekRows.length} 节`);
  document.querySelector(".matrix-date-region")?.replaceChildren();
  const dateRegion = document.querySelector(".matrix-date-region");
  const tabsRegion = document.querySelector(".matrix-tabs-region");
  const filterRegion = document.querySelector(".matrix-filter-region");
  const viewRegion = document.querySelector(".matrix-view-region");
  if (dateRegion) dateRegion.innerHTML = renderMatrixDateFilter();
  if (tabsRegion) tabsRegion.innerHTML = renderMatrixViewTabs();
  if (filterRegion) filterRegion.innerHTML = renderLessonFilterBar({ rows: weekRows, filteredRows: rows, compact: true });
  if (viewRegion) viewRegion.innerHTML = renderMatrixScheduleView(rows, range, conflicts);
  applyReadonlyUi();
  wireEvents();
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
          <colgroup>
            <col class="fee-detail-col-select"><col><col><col><col><col class="fee-detail-col-time">
            <col><col><col><col><col><col><col>
          </colgroup>
          <thead>
            <tr>
              <th class="select-col"><input class="fee-detail-select-all" type="checkbox" ${allSelectableChecked ? "checked" : ""} ${selectableRows.length ? "" : "disabled"} title="全选当前可按规则更新的费用明细"></th>
              <th>学生姓名</th><th>授课老师</th><th>日期</th><th>星期</th><th>时间</th><th>教室</th><th>状态</th><th>年级</th><th>科目</th><th class="wide note-head">备注</th><th>单人费用</th><th>规则费用</th>
            </tr>
          </thead>
          <tbody>
            ${visibleRows.map((row) => {
              const canApply = canApplyStudentPricingRule(row);
              const key = feeDetailKey(row);
              return `
              <tr class="${detailRowClass(row)}">
                <td class="select-col"><input class="fee-detail-select-row" type="checkbox" data-lesson-id="${row.lesson_id}" data-student-name="${escapeHtml(row.student_name)}" ${selectedFeeDetailKeys.has(key) ? "checked" : ""} ${canApply ? "" : "disabled"} title="${escapeHtml(feeDetailSelectTitle(row))}"></td>
                <td class="text-cell">${renderStudentBadge(row.student_name, { fallbackGrade: row.grade })}</td>
                <td class="text-cell">${escapeHtml(row.teacher_name)}</td>
                <td class="text-cell">${escapeHtml(row.date)}</td>
                <td class="text-cell">${escapeHtml(row.weekday)}</td>
                <td class="text-cell">${escapeHtml(row.time_slot)}</td>
                <td class="text-cell">${escapeHtml(row.classroom)}</td>
                <td class="text-cell">${statusBadge(rowStatus(row))}</td>
                <td class="text-cell">${renderEntityBadge("grade", row.grade)}</td>
                <td class="text-cell">${renderEntityBadge("subject", row.subject)}</td>
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
  const totalFee = visibleRows.reduce((sum, row) => sum + numberValue(row.total_fee), 0);
  const totalBalance = visibleRows.reduce((sum, row) => sum + numberValue(row.actual_balance) + numberValue(row.gift_balance), 0);
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
                <tr class="summary-master-row">
                  <td class="text-cell">${renderStudentBadge(row.student_name, { fallbackGrade: row.grade })}</td>
                  <td class="text-cell grade-cell">${renderGradeBadge(row.grade)}</td>
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
    start: rechargeDateFilter.start,
    end: rechargeDateFilter.end,
  };
}

function rechargeMatchesFilter(row, filter = currentRechargeFilter()) {
  const source = rechargeSource(row);
  if (filter.source === "carry_over" && source !== "carry_over") return false;
  if (filter.source === "manual" && source === "carry_over") return false;
  if (filter.student && !row.student_name.toLowerCase().includes(filter.student.toLowerCase())) return false;
  if (filter.grade && !textContains(row.grade, filter.grade)) return false;
  if (filter.start && (!row.recharge_date || row.recharge_date < filter.start)) return false;
  if (filter.end && (!row.recharge_date || row.recharge_date > filter.end)) return false;
  return true;
}

function dynamicRechargeFilterOptions(rows, filter = currentRechargeFilter()) {
  const rowsFor = (field) => rowsForFilterOption(rows, filter, field, rechargeMatchesFilter);
  return {
    students: uniqueSorted(rowsFor("student").map((row) => row.student_name)),
    grades: uniqueSorted(rowsFor("grade").map((row) => row.grade)),
  };
}

function rechargeSourceLabel(source) {
  if (source === "carry_over") return "自动结转";
  return "手动/无来源";
}

function rechargeAnalysis(rows = []) {
  const actual = rows.reduce((sum, row) => sum + numberValue(row.cur_recharge), 0);
  const gift = rows.reduce((sum, row) => sum + numberValue(row.cur_gift), 0);
  const negative = rows.reduce((sum, row) => {
    const actualValue = numberValue(row.cur_recharge);
    const giftValue = numberValue(row.cur_gift);
    return sum + (actualValue < 0 ? actualValue : 0) + (giftValue < 0 ? giftValue : 0);
  }, 0);
  const byGrade = new Map();
  const bySource = new Map();
  for (const row of rows) {
    const grade = row.grade || "未设置";
    const source = rechargeSourceLabel(rechargeSource(row));
    for (const [map, key] of [[byGrade, grade], [bySource, source]]) {
      const item = map.get(key) || { name: key, records: 0, actual: 0, gift: 0, students: new Set() };
      item.records += 1;
      item.actual += numberValue(row.cur_recharge);
      item.gift += numberValue(row.cur_gift);
      item.students.add(row.student_name);
      map.set(key, item);
    }
  }
  const normalizeSplit = (items) => [...items.values()]
    .map((item) => ({ ...item, students: item.students.size, net: item.actual + item.gift }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.name.localeCompare(b.name, "zh-Hans-CN"));
  return {
    actual,
    gift,
    net: actual + gift,
    records: rows.length,
    students: uniqueSorted(rows.map((row) => row.student_name)).length,
    negative,
    byGrade: normalizeSplit(byGrade),
    bySource: normalizeSplit(bySource),
  };
}

function rechargeAnalysisSplitMarkup(title, rows = []) {
  if (!rows.length) return "";
  return `
    <div class="recharge-analysis-split">
      <div class="recharge-analysis-split-title">${escapeHtml(title)}</div>
      <div class="recharge-analysis-chip-list">
        ${rows.slice(0, 6).map((row) => `
          <span class="recharge-analysis-chip">
            <b>${escapeHtml(row.name)}</b>
            <span class="${row.net < 0 ? "negative-text" : ""}">${escapeHtml(formatMoney(row.net))}</span>
            <em>${row.records} 笔 / ${row.students} 人</em>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function rechargeAnalysisMarkup(rows = []) {
  const summary = rechargeAnalysis(rows);
  const cards = [
    ["本月实际充值合计", summary.actual, "money"],
    ["本月赠送充值合计", summary.gift, "money"],
    ["本月净充值合计", summary.net, "money"],
    ["充值记录数", summary.records, "number"],
    ["充值学生数", summary.students, "number"],
    ["退款/负充值合计", summary.negative, "money"],
  ];
  return `
    <section class="recharge-analysis-panel">
      <div class="section-head">
        <div>
          <div class="section-title">充值数据分析汇总</div>
          <div class="section-subtitle">随当前来源、学生姓名和年级筛选同步更新。</div>
        </div>
      </div>
      <div class="recharge-analysis-grid">
        ${cards.map(([label, value, type]) => `
          <div class="recharge-analysis-card ${numberValue(value) < 0 ? "is-negative" : ""}">
            <span>${escapeHtml(label)}</span>
            <strong>${type === "money" ? escapeHtml(formatMoney(value)) : Number(value || 0).toLocaleString("zh-CN")}</strong>
          </div>
        `).join("")}
      </div>
      <div class="recharge-analysis-breakdowns">
        ${rechargeAnalysisSplitMarkup("按年级", summary.byGrade)}
        ${rechargeAnalysisSplitMarkup("按来源", summary.bySource)}
      </div>
    </section>
  `;
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
    <div class="band recharge-page">
      ${rechargeAnalysisMarkup(visibleRows)}
      <div class="filter-bar compact unified-filter-bar recharge-filter-bar">
        <div class="filter-controls">
          ${unifiedFilterField({ label: "来源", className: "recharge-source-filter", field: "source", value: filterLabel(rechargeSourceOptions, rechargeSourceFilter), values: rechargeSourceOptions.map((item) => item[1]), placeholder: "全部来源" })}
          ${unifiedFilterField({ label: "学生", className: "recharge-student-filter", field: "student", value: rechargeStudentFilter, values: opts.students, dataAttr: "field" })}
          ${unifiedFilterField({ label: "年级", className: "recharge-grade-filter", field: "grade", value: rechargeGradeFilter, values: opts.grades })}
          <label class="filter-field filter-date-range"><span>日期</span>${dateRangePickerControl({ scope: "recharges", start: rechargeDateFilter.start, end: rechargeDateFilter.end, placeholder: "选择充值日期范围" })}</label>
        </div>
        <div class="filter-summary"><span>已筛选 <b>${visibleRows.length}</b> / 共 ${rows.length} 条</span><button class="btn reset-recharge-filter" type="button">清空筛选</button></div>
      </div>
      <div class="transaction-action-row recharge-action-row" role="toolbar" aria-label="充值记录操作">
        <button class="btn danger batch-delete-recharges" type="button" ${bulkActionDisabledAttr(selectedRechargeIds.size)}>${bulkActionText("批量删除", selectedRechargeIds.size)}</button>
        <button class="btn primary open-recharge-modal" type="button">+ 新增充值记录</button>
      </div>
      <div class="table-wrap smooth-table-wrap">
        <table class="recharge-table uniform-table nowrap-table" data-adaptive-table="true" data-adaptive-flex-column="7">
          <colgroup>
            <col class="recharge-col-select" data-column-type="select"><col class="recharge-col-student" data-column-type="name"><col class="recharge-col-grade" data-column-type="short" data-max-width="120">
            <col class="recharge-col-money" data-column-type="money"><col class="recharge-col-money" data-column-type="money"><col class="recharge-col-date" data-column-type="date">
            <col class="recharge-col-channel" data-column-type="long" data-min-width="128" data-max-width="260" data-grow="0.5" data-alignment="center"><col class="recharge-col-notes" data-column-type="long">
          </colgroup>
          <thead>
            <tr><th class="select-col"><input class="recharge-select-all" type="checkbox" ${allVisibleSelected ? "checked" : ""} ${visibleRows.length ? "" : "disabled"} aria-label="全选当前充值记录"></th><th>学生姓名</th><th>年级</th><th>本月实际充值</th><th>本月赠送充值</th><th>充值日期</th><th>来源/渠道</th><th class="wide recharge-notes-head">备注</th></tr>
          </thead>
          <tbody>
            ${visibleRows.map((row) => `
              <tr class="recharge-row" data-id="${escapeHtml(row.id)}" data-student-name="${escapeHtml(row.student_name)}" data-grade="${escapeHtml(row.grade)}" data-source="${escapeHtml(row.source || "")}" data-channel="${escapeHtml(row.channel || "")}" data-channel-other="${escapeHtml(row.channel_other || "")}">
                <td class="select-col adaptive-center"><input class="recharge-select-row" type="checkbox" data-id="${escapeHtml(row.id)}" ${selectedRechargeIds.has(Number(row.id)) ? "checked" : ""} aria-label="选择充值记录"></td>
                <td class="text-cell adaptive-center">${renderStudentBadge(row.student_name, { fallbackGrade: row.grade })} ${rechargeSourceTag(rechargeSource(row))}</td>
                <td class="text-cell adaptive-center">${renderGradeBadge(row.grade)}</td>
                <td class="currency-input-cell adaptive-right">${currencyInputMarkup(row.cur_recharge, { className: "recharge-field", attrs: `data-field="cur_recharge"` })}</td>
                <td class="currency-input-cell adaptive-right">${currencyInputMarkup(row.cur_gift, { className: "recharge-field", attrs: `data-field="cur_gift"` })}</td>
                <td class="adaptive-center"><input class="cell-input recharge-field" data-date-kind="single" data-field="recharge_date" type="date" value="${escapeHtml(row.recharge_date)}"></td>
                ${rechargeChannelCellMarkup(row)}
                <td class="recharge-notes-cell adaptive-left"><textarea class="cell-input adaptive-textarea recharge-field wide" data-field="notes" rows="1" wrap="soft">${escapeHtml(row.recharge_notes)}</textarea></td>
              </tr>
            `).join("") || `<tr><td colspan="8" class="empty">暂无充值记录</td></tr>`}
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
    <div class="band opening-balance-page">
      <div class="filter-bar compact unified-filter-bar opening-balance-filter-bar">
        <div class="filter-controls">
          ${unifiedFilterField({ label: "学生", className: "opening-balance-filter", field: "student", value: openingBalanceFilter.student, values: opts.students, dataAttr: "field" })}
          ${unifiedFilterField({ label: "年级", className: "opening-balance-filter", field: "grade", value: openingBalanceFilter.grade, values: opts.grades })}
        </div>
        <div class="filter-summary"><span>已筛选 <b>${visibleRows.length}</b> / 共 ${rows.length} 条</span><button class="btn reset-opening-balance-filter" type="button">清空筛选</button></div>
      </div>
      <div class="transaction-action-row opening-balance-actions" role="toolbar" aria-label="期初余额操作">
        <button class="btn primary open-opening-balance-modal" type="button">+ 新增期初余额</button>
        <button class="btn danger batch-delete-opening-balances" type="button" ${bulkActionDisabledAttr(selectedOpeningBalanceIds.size)}>${bulkActionText("批量删除", selectedOpeningBalanceIds.size)}</button>
        <button class="btn download-opening-balance-template" type="button">下载模板</button>
        <button class="btn import-opening-balance-excel" type="button">导入 Excel</button>
        <button class="btn export-opening-balance-excel" type="button">导出 Excel</button>
      </div>
      <div class="table-wrap smooth-table-wrap">
        <table class="recharge-table opening-balance-table uniform-table nowrap-table" data-adaptive-table="true" data-adaptive-flex-column="5">
          <colgroup><col class="opening-balance-col-select" data-column-type="select"><col class="opening-balance-col-student" data-column-type="name"><col class="opening-balance-col-grade" data-column-type="short" data-max-width="120"><col class="opening-balance-col-money" data-column-type="money"><col class="opening-balance-col-money" data-column-type="money"><col class="opening-balance-col-notes" data-column-type="long"></colgroup>
          <thead>
            <tr><th class="select-col"><input class="opening-balance-select-all" type="checkbox" ${allVisibleSelected ? "checked" : ""} ${visibleRows.length ? "" : "disabled"} aria-label="全选当前期初余额"></th><th>学生姓名</th><th>年级</th><th>期初实际余额</th><th>期初赠送余额</th><th class="wide opening-balance-notes-head">备注</th></tr>
          </thead>
          <tbody>
            ${visibleRows.map((row) => `
              <tr class="opening-balance-row" data-id="${row.id}" data-student-name="${escapeHtml(row.student_name)}" data-grade="${escapeHtml(row.grade)}">
                <td class="select-col adaptive-center"><input class="opening-balance-select-row" type="checkbox" data-id="${escapeHtml(row.id)}" ${selectedOpeningBalanceIds.has(Number(row.id)) ? "checked" : ""} aria-label="选择期初余额记录"></td>
                <td class="text-cell adaptive-center">${renderStudentBadge(row.student_name, { fallbackGrade: row.grade })}</td>
                <td class="text-cell adaptive-center">${renderGradeBadge(row.grade)}</td>
                <td class="currency-input-cell adaptive-right">${currencyInputMarkup(row.opening_actual_balance, { className: "opening-balance-field", attrs: `data-field="opening_actual_balance"` })}</td>
                <td class="currency-input-cell adaptive-right">${currencyInputMarkup(row.opening_gift_balance, { className: "opening-balance-field", attrs: `data-field="opening_gift_balance"` })}</td>
                <td class="opening-balance-notes-cell adaptive-left"><textarea class="cell-input adaptive-textarea wide opening-balance-field opening-balance-notes-input" data-field="notes" rows="1" wrap="soft">${escapeHtml(String(row.notes || "").replace(/[\r\n]+/g, " "))}</textarea></td>
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
  return `
    <div class="band student-query-controls">
      <div class="filter-bar compact">
        <label>学生姓名</label>
        ${filterComboControl({ className: "student-query-name", field: "student", value: studentQueryNameDraft || selectedStudent, values: studentNames, placeholder: "输入或选择学生", dataAttr: "field" })}
        <div class="segmented student-query-mode-toggle">
          <button class="segmented-option student-query-mode ${studentQueryRange.mode !== "range" ? "active" : ""}" type="button" data-mode="all" aria-pressed="${studentQueryRange.mode !== "range"}">全部月份</button>
          <button class="segmented-option student-query-mode ${studentQueryRange.mode === "range" ? "active" : ""}" type="button" data-mode="range" aria-pressed="${studentQueryRange.mode === "range"}">日期范围</button>
        </div>
        ${dateRangePickerControl({ scope: "student-query", start: studentQueryRange.start || "", end: studentQueryRange.end || "", placeholder: "选择账单日期范围", disabled: studentQueryRange.mode !== "range" })}
      </div>
    </div>
  `;
}

function studentQueryComparisonPanel(report) {
  const hasReport = Boolean(selectedStudent && report?.summary);
  return `
    <div class="band student-comparison-panel" data-student-query-comparison-panel ${hasReport ? "" : "hidden"}>
      <div class="section-head">
        <div>
          <div class="section-title">月份汇总</div>
          <div class="section-subtitle" data-student-query-range-label>${escapeHtml(studentStatementRangeLabel(report))}</div>
        </div>
      </div>
      <div class="table-wrap smooth-table-wrap">
        <table class="student-history-table uniform-table nowrap-table">
          <thead><tr><th>月份</th><th>有效课次</th><th>当月课费</th><th>现金充值</th><th>赠送充值</th></tr></thead>
          <tbody data-student-query-month-body>${studentQueryMonthRowsMarkup(report)}</tbody>
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

function teacherTravelHeaderMarkup(week) {
  const title = `第${week.week_index}周车票`;
  const start = week.start || week.week_start || "";
  const end = week.end || week.week_end || "";
  const dateText = start && end ? `${start}~${end}` : "";
  return `
    <span class="travel-week-head">
      <span>${escapeHtml(title)}</span>
      ${dateText ? `<small>${escapeHtml(dateText)}</small>` : ""}
    </span>
  `;
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
  drawShotHeader(ctx, colors, `${monthLabel()} ${teacherName || "未选择教师"} 课时明细`, "", width);
  drawShotMetricCards(ctx, colors, [
    { label: "有效课时", value: String(completedRows.length) },
    { label: "课程记录", value: String(rows.length) },
    { label: "课时薪资", value: formatMoney(classSalary) },
    { label: "车票/交通补贴", value: formatMoney(transportTotal) },
    { label: "薪资统计", value: formatMoney(salaryTotal) },
  ], 48, 142, contentWidth);
  let y = 246;
  drawShotTable(ctx, colors, [
    { label: "授课老师", value: (row) => row.teacher_name },
    { label: "日期", value: (row) => row.date, align: "left" },
    { label: "星期", value: (row) => weekdayCn(row.date) },
    { label: "时间", value: (row) => row.time_slot, align: "left" },
    { label: "教室", value: (row) => row.classroom },
    { label: "状态", value: (row) => rowStatus(row) },
    { label: "年级", value: (row) => row.grade },
    { label: "科目", value: (row) => row.subject },
    { label: "学生", value: (row) => row.student_names, align: "left" },
    { label: "备注", value: (row) => row.notes || "", align: "left" },
    { label: "教师薪资", value: (row) => formatMoney(displayTeacherSalaryForLesson(row)), align: "right" },
    { label: "规则薪资", value: (row) => { const amount = displayTeacherRuleSalaryForLesson(row); return amount == null ? "" : formatMoney(amount); }, align: "right" },
  ], rows, 48, y, [90, 95, 50, 85, 50, 55, 50, 55, 180, 235, 85, 85], { rowHeight: 38, headHeight: 42, emptyText: "暂无教师课程明细" });
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
  await downloadCanvasPng(canvas, `黎明教育_${imageFilenamePart(monthLabel())}_${imageFilenamePart(selectedTeacher)}_课时明细.png`);
}

async function copyTeacherDetailPng() {
  if (!selectedTeacher) throw new Error("请先选择教师");
  const filename = `黎明教育_${imageFilenamePart(monthLabel())}_${imageFilenamePart(selectedTeacher)}_课时明细.png`;
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
  return studentStatementMetricCards(summary).map((card, index) => `
    <div class="metric" data-student-statement-metric="${index}">
      <div class="metric-label">${escapeHtml(card.label)}</div>
      <div class="metric-value ${card.negative ? "negative" : ""}">${escapeHtml(card.value)}</div>
    </div>
  `).join("");
}

function studentQueryMonthRowsMarkup(report = studentStatementReport()) {
  if (!selectedStudent || !report?.summary) return `<tr><td colspan="5" class="empty">请先选择学生</td></tr>`;
  return (report.month_rows || []).map((row) => `
    <tr><td class="text-cell">${escapeHtml(formatMonthOption(row.month_key))}</td><td class="text-cell">${row.lesson_count}</td><td class="text-cell right">${formatMoney(row.total_fee)}</td><td class="text-cell right">${formatMoney(row.cur_recharge)}</td><td class="text-cell right">${formatMoney(row.cur_gift)}</td></tr>
  `).join("") || `<tr><td colspan="5" class="empty">暂无期间明细</td></tr>`;
}

function studentQueryDetailRowsMarkup(report = studentStatementReport()) {
  const details = selectedStudent ? (report.details || []) : [];
  return details.map((row) => `
    <tr class="${detailRowClass(row)}">
      <td class="text-cell">${renderStudentBadge(row.student_name, { fallbackGrade: row.grade })}</td><td class="text-cell">${escapeHtml(row.teacher_name)}</td><td class="text-cell">${escapeHtml(row.date)}</td><td class="text-cell">${statusBadge(rowStatus(row))}</td><td class="text-cell">${escapeHtml(row.weekday)}</td><td class="text-cell">${escapeHtml(row.time_slot)}</td><td class="text-cell">${escapeHtml(row.classroom)}</td><td class="text-cell">${renderGradeBadge(row.grade)}</td><td class="text-cell">${renderSubjectBadge(row.subject)}</td><td class="text-cell">${escapeHtml(row.notes)}</td>${readonlyPriceCell(row)}
    </tr>
  `).join("") || `<tr><td colspan="11" class="empty">暂无课程明细</td></tr>`;
}

function studentQueryResultsMarkup(report = studentStatementReport()) {
  const summary = selectedStudent ? report.summary : null;
  return `
    <div class="query-head student-statement-metrics">
      ${studentStatementMetricCardsMarkup(summary || {})}
    </div>
    <div class="student-query-comparison-slot">
      ${studentQueryComparisonPanel(report)}
    </div>
    <div class="student-query-detail-slot">
      <div class="band">
        <div class="table-wrap smooth-table-wrap">
          <table class="fee-detail-table student-query-detail-table uniform-table nowrap-table">
            <thead>
              <tr><th>学生姓名</th><th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th class="wide note-head">备注</th><th>单人费用</th></tr>
            </thead>
            <tbody id="student-query-detail-tbody" data-student-query-detail-body>${studentQueryDetailRowsMarkup(report)}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function updateStudentQueryControlsOnly() {
  const rangeEnabled = studentQueryRange.mode === "range";
  document.querySelectorAll(".student-query-mode").forEach((button) => {
    const active = (button.dataset.mode || "all") === (rangeEnabled ? "range" : "all");
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const picker = document.querySelector('.date-range-picker[data-range-scope="student-query"]');
  if (!picker) return;
  const start = studentQueryRange.start || "";
  const end = studentQueryRange.end || "";
  picker.dataset.start = start;
  picker.dataset.end = end;
  picker.classList.toggle("has-value", Boolean(start || end));
  picker.classList.toggle("disabled", !rangeEnabled);
  const trigger = picker.querySelector(".date-range-trigger");
  const clear = picker.querySelector(".date-range-clear");
  if (trigger) trigger.disabled = !rangeEnabled;
  if (clear) clear.hidden = !rangeEnabled || !(start || end);
  syncDateRangeTriggerText(picker, start, end);
}

function updateStudentQueryToolbarOnly() {
  const hasStudent = Boolean(selectedStudent);
  const meta = topbarEl?.querySelector(".page-meta");
  if (meta) meta.textContent = selectedStudent || "未选择学生";
  topbarEl?.querySelectorAll(".export-student-statement, .student-statement-preview").forEach((button) => {
    button.disabled = !hasStudent;
  });
}

function updateStudentQueryResultsOnly(report = studentStatementReport()) {
  const resultRegion = document.querySelector(".student-query-results");
  if (!resultRegion) return false;
  const cards = studentStatementMetricCards(selectedStudent ? (report.summary || {}) : {});
  resultRegion.querySelectorAll("[data-student-statement-metric]").forEach((card, index) => {
    const metric = cards[index] || { label: "", value: "", negative: false };
    const label = card.querySelector(".metric-label");
    const value = card.querySelector(".metric-value");
    if (label) label.textContent = metric.label;
    if (value) {
      value.textContent = metric.value;
      value.classList.toggle("negative", Boolean(metric.negative));
    }
  });
  const comparison = resultRegion.querySelector("[data-student-query-comparison-panel]");
  const hasReport = Boolean(selectedStudent && report?.summary);
  if (comparison) {
    comparison.hidden = !hasReport;
    const rangeLabel = comparison.querySelector("[data-student-query-range-label]");
    if (rangeLabel) rangeLabel.textContent = studentStatementRangeLabel(report);
    const monthBody = comparison.querySelector("[data-student-query-month-body]");
    if (monthBody) monthBody.innerHTML = studentQueryMonthRowsMarkup(report);
  }
  const detailBody = resultRegion.querySelector("[data-student-query-detail-body]");
  if (detailBody) detailBody.innerHTML = studentQueryDetailRowsMarkup(report);
  return true;
}

function updateStudentQueryViewOnly() {
  if (view !== "studentQuery" || !document.querySelector(".student-query-results")) {
    render();
    return;
  }
  updateStudentQueryResultsOnly();
  updateStudentQueryControlsOnly();
  updateStudentQueryToolbarOnly();
}

function renderStudentQuery() {
  const rows = state.derived.student_summary;
  const studentNames = uniqueSorted((state.profile_students || [])
    .map((row) => String(row.name || "").trim())
    .filter(Boolean));
  const report = studentStatementReport();
  renderTopbar(
    "学生查询",
    selectedStudent || "未选择学生",
    `<button class="btn export-student-statement" type="button" ${selectedStudent ? "" : "disabled"}>导出 Excel</button>
     <button class="btn student-statement-preview" type="button" ${selectedStudent ? "" : "disabled"}>复制图片</button>`,
  );
  contentEl.innerHTML = `
    ${studentQueryControls(studentNames)}
    <div class="student-query-results">${studentQueryResultsMarkup(report)}</div>
  `;
}

function dataCenterRemoteLabel(value) {
  const labels = { not_configured: "未配置", not_authorized: "等待授权", authorized: "已授权", refresh_required: "等待刷新", pending: "等待上传", uploading: "上传中", success: "上传成功", partial_failed: "部分上传失败", failed: "上传失败", authorization_expired: "授权过期", delete_partial: "部分删除失败", delete_failed: "远端删除失败", deleted: "已删除", legacy: "旧版" };
  return labels[value] || value || "未配置";
}

function dataCenterRemotePartLabel(value) {
  const labels = { pending: "等待处理", success: "上传成功", failed: "上传失败", deleted: "已删除", already_absent: "本来不存在", delete_failed: "删除失败", delete_partial: "部分删除失败", rejected_symlink: "已拒绝符号链接", missing: "文件缺失", not_present: "无记录" };
  return labels[value] || "未上传";
}

function dataCenterRemoteIntegrityLabel(value) {
  const labels = { verified: "已验证", not_verified: "未验证", failed: "验证失败" };
  return labels[value] || "未验证";
}

function dataCenterRemoteSummary(row) {
  if (/\.enc$/i.test(row.remote_path || "")) return `<span class="remote-legacy-encrypted">旧版加密远端备份</span>`;
  return `<div class="remote-pair-status">
    <span>远端 Excel：${escapeHtml(dataCenterRemotePartLabel(row.remote_file_status))}</span>
    <span>远端校验文件：${escapeHtml(dataCenterRemotePartLabel(row.remote_checksum_status))}</span>
    <span>远端完整性：${escapeHtml(dataCenterRemoteIntegrityLabel(row.remote_integrity_status))}</span>
  </div>`;
}

function backupStatusLabel(value) {
  const labels = { creating: "创建中", success: "成功", failed: "失败", verifying: "验证中", restoring: "恢复中", deleted: "已删除", delete_partial: "本地部分删除失败", missing: "文件缺失" };
  return labels[value] || value || "未知";
}

async function pollBackupJob(jobId) {
  const terminal = new Set(["success", "partial_failed", "failed"]);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    let result;
    try { result = await request(`/api/data-center/backups/${encodeURIComponent(jobId)}/job`, { cache: false }); }
    catch (error) { if (view === "audit") showToast(error.message || "备份任务状态读取失败", "error"); return; }
    const index = (backupState.records || []).findIndex((row) => Number(row.id) === Number(jobId));
    if (index >= 0) backupState.records[index] = result.record;
    else backupState.records = [result.record, ...(backupState.records || [])];
    if (view === "audit") render();
    if (!terminal.has(result.status)) continue;
    if (view === "audit") showToast(result.status === "success" ? "百度网盘备份成功" : (result.status === "partial_failed" ? "百度备份部分失败，请查看记录" : "百度网盘备份失败，请查看原因"), result.status === "success" ? "success" : "error");
    return;
  }
}

function backupJobStatusLabel(value) {
  const labels = {
    queued: "等待执行", preflight: "正在执行数据预检", exporting: "正在导出 Excel", hashing: "正在校验与计算摘要",
    uploading_excel: "正在上传 Excel", uploading_checksum: "正在上传校验文件",
    verifying_metadata: "正在核对远端元数据", downloading_for_verification: "正在下载远端副本校验",
    integrity_check: "正在执行完整性校验", success: "任务成功", partial_failed: "任务部分失败", failed: "任务失败",
  };
  return labels[value] || "";
}

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const amount = bytes / (1024 ** index);
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function dataCenterStorageLabel(value) {
  const labels = { available: "可用", not_created: "尚未创建（首次备份时创建）", unwritable: "暂不可写", invalid: "路径无效" };
  return labels[value] || "状态未知";
}

function backupFailureMarkup(row = {}) {
  const failure = row.failure;
  if (!failure?.message) return `<span class="backup-failure-empty">—</span>`;
  const issues = failure.details?.preflight?.issues || [];
  const conflict = issues.find((issue) => issue.code === "STUDENT_GRADE_STAGE_OVERLAP")?.records?.[0];
  return `<div class="backup-failure-reason"><strong>失败原因</strong><span>${escapeHtml(failure.message)}</span>${issues.length ? `<div class="backup-failure-actions"><button class="btn data-preflight-view" type="button">查看全部问题</button>${conflict?.student_id ? `<button class="btn backup-failure-student-link" type="button" data-student-id="${escapeHtml(conflict.student_id)}" data-stage-a="${escapeHtml(conflict.stage_a)}" data-stage-b="${escapeHtml(conflict.stage_b)}">前往学生档案</button>` : ""}</div>` : ""}</div>`;
}

function backupLocalStatusMarkup(row = {}) {
  const label = row.status === "success" ? "本地备份成功" : row.status === "failed" ? "本地备份失败" : backupStatusLabel(row.status);
  const jobLabel = backupJobStatusLabel(row.job_status);
  return `<div class="backup-local-status">${escapeHtml(label)}</div>${jobLabel ? `<div class="backup-job-status" data-job-id="${escapeHtml(row.id)}">${escapeHtml(jobLabel)}</div>` : ""}`;
}

function backupDeleteLocation(row = {}) {
  const locations = [];
  if (row.managed_relative_path || !["missing", "deleted"].includes(row.status)) locations.push("服务器本地");
  if (row.remote_path || row.remote_checksum_path) locations.push("百度网盘");
  return locations.join(" / ") || "备份记录";
}

function backupDeleteDialogMarkup() {
  const dialog = backupState.deleteDialog;
  if (!dialog) return "";
  const row = dialog.record || {};
  const status = dialog.result?.cleanup;
  return `<div class="modal-backdrop backup-delete-modal"><div class="modal-panel backup-delete-panel" role="dialog" aria-modal="true" aria-labelledby="backup-delete-title">
    <div class="modal-head"><div><div class="modal-title" id="backup-delete-title">确认删除这条备份吗？</div><div class="modal-subtitle">此操作无法撤销。</div></div><button class="btn backup-delete-cancel" type="button" ${dialog.busy ? "disabled" : ""}>关闭</button></div>
    <div class="backup-delete-summary"><div><span>文件</span><strong>${escapeHtml(row.filename || "未记录文件名")}</strong></div><div><span>位置</span><strong>${escapeHtml(backupDeleteLocation(row))}</strong></div><p>此操作会按当前规则删除对应备份文件和记录，且无法撤销。</p></div>
    ${dialog.error ? `<div class="audit-inline-notice danger backup-delete-error"><strong>删除未完成</strong><span>${escapeHtml(dialog.error)}</span></div>` : ""}
    ${status ? `<dl class="backup-delete-result"><div><dt>本地 Excel</dt><dd>${escapeHtml(dataCenterRemotePartLabel(status.local_excel))}</dd></div><div><dt>本地 SHA-256</dt><dd>${escapeHtml(dataCenterRemotePartLabel(status.local_checksum))}</dd></div><div><dt>百度 Excel</dt><dd>${escapeHtml(dataCenterRemotePartLabel(status.remote_excel))}</dd></div><div><dt>百度 SHA-256</dt><dd>${escapeHtml(dataCenterRemotePartLabel(status.remote_checksum))}</dd></div></dl>` : ""}
    <div class="modal-actions"><button class="btn backup-delete-cancel" type="button" ${dialog.busy ? "disabled" : ""}>取消</button><button class="btn danger backup-delete-confirm" type="button" ${dialog.busy ? "disabled" : ""}>${dialog.busy ? "正在删除…" : (dialog.result ? "重新删除" : "确认删除")}</button></div>
  </div></div>`;
}

function backupRecordDeletePolicy(row = {}) {
  if (!isOwnerRoleValue(auth.user?.role)) return { allowed: false, reason: "当前权限不能删除备份" };
  if (isReadonlyUser()) return { allowed: false, reason: "当前账号为只读，不能删除备份" };
  if (row.delete_allowed === false) return { allowed: false, reason: row.delete_protection_reason || "该备份受安全规则保护" };
  if (row.backup_format !== "full_data_excel") return { allowed: false, reason: "旧版备份不能由新体系删除" };
  if (Number(row.pinned || 0)) return { allowed: false, reason: "固定备份受保护，请先取消固定" };
  const activeJobs = ["queued", "preflight", "exporting", "hashing", "uploading_excel", "uploading_checksum", "verifying_metadata", "downloading_for_verification", "integrity_check"];
  if (["creating", "verifying", "uploading", "restoring"].includes(row.status) || row.remote_status === "uploading" || activeJobs.includes(row.job_status)) {
    return { allowed: false, reason: "备份正在使用中" };
  }
  const validRows = (backupState.records || []).filter((item) => item.backup_format === "full_data_excel" && item.status === "success" && !item.deleted_at);
  if (row.status === "success" && validRows.length <= 1) return { allowed: false, reason: "不能删除最后一份有效全量备份" };
  return { allowed: true, reason: "" };
}

function selectedBackupRecords() {
  const selected = new Set([...selectedBackupRecordIds].map(Number));
  return (backupState.records || []).filter((row) => selected.has(Number(row.id)));
}

function backupBatchDeleteToolbarMarkup() {
  const eligible = (backupState.records || []).filter((row) => backupRecordDeletePolicy(row).allowed);
  const selectedEligible = eligible.filter((row) => selectedBackupRecordIds.has(Number(row.id)));
  const allSelected = eligible.length > 0 && selectedEligible.length === eligible.length;
  const indeterminate = selectedEligible.length > 0 && !allSelected;
  return `
    <div class="backup-batch-toolbar">
      <span class="backup-selected-count">已选择 <b>${selectedBackupRecordIds.size}</b> 条</span>
      <button class="btn backup-selection-clear" type="button" ${selectedBackupRecordIds.size ? "" : "disabled"}>清除选择</button>
      <button class="btn danger backup-batch-delete-open" type="button" ${selectedBackupRecordIds.size && !backupBatchDeleteDialog?.busy && !isReadonlyUser() ? "" : "disabled"}>批量删除</button>
      <span class="backup-selection-hint">${indeterminate ? "当前可删除记录为半选状态" : allSelected ? "已全选当前可删除记录" : "只会选择当前可见且可删除的记录"}</span>
    </div>
  `;
}

function backupBatchDeleteDialogMarkup() {
  const dialog = backupBatchDeleteDialog;
  if (!dialog) return "";
  const records = dialog.records || [];
  const successful = records.filter((row) => row.status === "success").length;
  const failed = records.filter((row) => row.status !== "success").length;
  const local = records.filter((row) => row.managed_relative_path).length;
  const remote = records.filter((row) => row.remote_path || row.remote_checksum_path).length;
  const result = dialog.result;
  const resultSummary = result
    ? `已处理${Number(result.selected_count || 0)}条：删除${Number(result.deleted_count || 0)}条，失败${Number(result.failed_count || 0)}条，受保护${Number(result.protected_count || 0)}条。`
    : "";
  const detailRows = (result?.results || []).map((item) => `
    <tr data-result-backup-id="${escapeHtml(item.backup_id ?? "")}">
      <td>${escapeHtml(item.filename || "未找到记录")}</td>
      <td>${escapeHtml(formatBeijingTime(item.backup_time) || item.backup_time || "-")}</td>
      <td>${escapeHtml(item.created_by_label || "-")}</td>
      <td>${escapeHtml(item.status === "deleted" ? "已删除" : item.status === "protected" ? "受保护" : item.status === "invalid" ? "ID无效" : "失败")}</td>
      <td>${escapeHtml(dataCenterRemotePartLabel(item.cleanup?.local_excel))}</td>
      <td>${escapeHtml(dataCenterRemotePartLabel(item.cleanup?.local_checksum))}</td>
      <td>${escapeHtml(dataCenterRemotePartLabel(item.cleanup?.remote_excel))}</td>
      <td>${escapeHtml(dataCenterRemotePartLabel(item.cleanup?.remote_checksum))}</td>
      <td>${escapeHtml(item.reason || "—")}</td>
    </tr>
  `).join("");
  return `<div class="modal-backdrop backup-batch-delete-modal"><div class="modal-panel backup-batch-delete-panel" role="dialog" aria-modal="true" aria-labelledby="backup-batch-delete-title">
    <div class="modal-head"><div><div class="modal-title" id="backup-batch-delete-title">${result ? "批量删除结果" : "确认批量删除备份"}</div><div class="modal-subtitle">${result ? escapeHtml(resultSummary) : "普通二次确认，不需要输入密码或确认文字。"}</div></div><button class="btn backup-batch-delete-close" type="button" ${dialog.busy ? "disabled" : ""}>关闭</button></div>
    ${result ? "" : `<div class="backup-batch-confirm-summary"><div><span>已选择</span><strong>${records.length} 条</strong></div><div><span>成功备份</span><strong>${successful} 条</strong></div><div><span>失败备份</span><strong>${failed} 条</strong></div><div><span>本地备份</span><strong>${local} 条</strong></div><div><span>百度备份</span><strong>${remote} 条</strong></div><p>删除后将清理对应受管文件和记录；部分记录可能因固定、运行中或最后有效备份保护而无法删除。</p></div>`}
    ${dialog.error ? `<div class="audit-inline-notice danger"><span>${escapeHtml(dialog.error)}</span></div>` : ""}
    ${result ? `<div class="audit-inline-notice ${result.failed_count || result.protected_count ? "danger" : "neutral"} backup-batch-result-summary"><strong>${escapeHtml(resultSummary)}</strong><button class="btn backup-batch-details-toggle" type="button">${dialog.detailsOpen ? "收起详情" : "查看详情"}</button></div>` : ""}
    ${result && dialog.detailsOpen ? `<div class="table-wrap backup-batch-result-wrap"><table class="audit-table backup-batch-result-table"><thead><tr><th>文件名</th><th>创建时间</th><th>创建账号</th><th>删除结果</th><th>本地Excel</th><th>本地SHA-256</th><th>百度Excel</th><th>百度SHA-256</th><th>安全原因</th></tr></thead><tbody>${detailRows}</tbody></table></div>` : ""}
    <div class="modal-actions"><button class="btn backup-batch-delete-close" type="button" ${dialog.busy ? "disabled" : ""}>${result ? "完成" : "取消"}</button>${result ? "" : `<button class="btn danger backup-batch-delete-confirm" type="button" ${dialog.busy ? "disabled" : ""}>${dialog.busy ? "正在删除…" : "确认删除"}</button>`}</div>
  </div></div>`;
}

function dataCenterBackupRows() {
  return (backupState.records || []).map((row) => {
    const legacy = row.backup_format !== "full_data_excel";
    const downloadPath = legacy ? `/api/backups/${encodeURIComponent(row.id)}/download` : `/api/data-center/backups/${encodeURIComponent(row.id)}/download`;
    const deletePolicy = backupRecordDeletePolicy(row);
    return `<tr data-backup-id="${escapeHtml(row.id)}">
      <td class="select-col backup-select-col"><input class="backup-record-select-row" type="checkbox" data-id="${escapeHtml(row.id)}" ${selectedBackupRecordIds.has(Number(row.id)) ? "checked" : ""} ${deletePolicy.allowed ? "" : `disabled title="${escapeHtml(deletePolicy.reason)}"`} aria-label="选择备份记录：${escapeHtml(row.filename || row.id)}"></td>
      <td>${escapeHtml(formatBeijingTime(row.backup_time) || row.backup_time || "-")}</td>
      <td>${escapeHtml(legacy ? "旧版业务归档" : `${row.retention_class || "全量数据"} · ${row.operation_logs_included === false ? "不含操作日志" : "包含操作日志"}`)}</td>
      <td>${escapeHtml(row.trigger || row.backup_type || "-")}</td>
      <td class="backup-filename-cell" title="${escapeHtml(row.filename || "")}">${escapeHtml(row.filename || "-")}</td>
      <td>${backupLocalStatusMarkup(row)}</td>
      <td><div>${escapeHtml(dataCenterRemoteLabel(row.remote_status))}</div>${legacy ? "" : dataCenterRemoteSummary(row)}</td>
      <td class="backup-failure-cell">${backupFailureMarkup(row)}</td>
      <td class="right">${escapeHtml(formatFileSize(row.file_size))}</td>
      <td class="mono-cell" title="${escapeHtml(row.sha256 || "")}">${escapeHtml(row.sha256 ? `${row.sha256.slice(0, 12)}…` : "-")}</td>
      <td>${escapeHtml(row.created_by_label || "历史记录")}</td>
      <td><input class="control backup-note-field" data-id="${escapeHtml(row.id)}" value="${escapeHtml(row.note || "")}" maxlength="500" ${legacy ? "disabled" : ""}></td>
      <td class="data-center-actions">
        <button class="btn backup-download" type="button" data-path="${escapeHtml(downloadPath)}" data-name="${escapeHtml(row.filename || "backup.xlsx")}" ${row.status === "success" ? "" : "disabled"}>下载</button>
        ${legacy ? "" : `<button class="btn backup-verify" type="button" data-id="${escapeHtml(row.id)}" ${row.status === "success" ? "" : "disabled"}>验证</button>${isOwnerRoleValue(auth.user?.role) ? `<button class="btn backup-remote-retry" type="button" data-id="${escapeHtml(row.id)}" ${row.status === "success" ? "" : "disabled"}>重试上传</button>${row.remote_status === "success" && !/\.enc$/i.test(row.remote_path || "") ? `<button class="btn backup-remote-download" type="button" data-id="${escapeHtml(row.id)}" data-name="${escapeHtml(row.filename || "backup.xlsx")}">下载远端</button>` : ""}<button class="btn backup-toggle-pinned" type="button" data-id="${escapeHtml(row.id)}" data-pinned="${row.pinned ? "1" : "0"}">${row.pinned ? "取消固定" : "固定"}</button>` : ""}<button class="btn backup-metadata-save" type="button" data-id="${escapeHtml(row.id)}">保存</button>${isOwnerRoleValue(auth.user?.role) ? `<button class="btn danger backup-delete" type="button" data-id="${escapeHtml(row.id)}" ${deletePolicy.allowed ? "" : `disabled title="${escapeHtml(deletePolicy.reason)}"`}>删除</button>` : ""}`}
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="13" class="empty">暂无备份记录</td></tr>`;
}

function importPreviewMarkup() {
  const preview = backupState.importPreview;
  if (!preview) return `<div class="section-subtitle">上传后先执行只读校验；确认前不会修改数据库。</div>`;
  const counts = Object.entries(preview.preview_counts || {}).map(([sheet, count]) => `<span class="data-count-chip">${escapeHtml(sheet)}：${Number(count || 0)}</span>`).join("");
  const confirmation = backupState.importMode === "overwrite" ? "覆盖导入" : "初始化导入";
  return `<div class="data-import-preview">
    <div class="audit-inline-notice">文件校验通过，请核对各表记录数后再执行。</div>
    <div class="data-count-list">${counts}</div>
    <div class="data-confirm-grid">
      <label class="filter-field"><span>老板密码</span><input class="control data-import-password" type="password" autocomplete="current-password"></label>
      <label class="filter-field"><span>确认文字：${confirmation}</span><input class="control data-import-confirmation" autocomplete="off"></label>
      <button class="btn danger data-import-execute" type="button" ${backupState.busy ? "disabled" : ""}>确认执行</button>
    </div>
  </div>`;
}

function dataPreflightMarkup() {
  const result = backupState.preflight;
  if (!result || result.ok) return "";
  if (result.check_failed) return `<div class="audit-inline-notice danger data-preflight-panel"><div><strong>数据完整性预检暂时不可用</strong><div>${escapeHtml(result.user_message || "请稍后重新检查")}</div></div><button class="btn data-preflight-recheck" type="button">重新检查</button></div>`;
  const issueRows = (result.issues || []).map((issue) => `
    <div class="data-preflight-issue">
      <div><strong>${escapeHtml(issue.label || issue.code)}</strong><span>${Number(issue.count || 0)} 条</span></div>
      ${(issue.records || []).map((record) => `<div class="data-preflight-record">记录#${escapeHtml(record.record_id ?? "-")}　${escapeHtml(record.username || record.student_name || "")}　${escapeHtml(record.display_name || record.grade || "")}${record.invalid_reason ? `　${escapeHtml(record.invalid_reason)}` : ""}${record.record_ids ? `　关联记录：${escapeHtml(record.record_ids)}` : ""}</div>`).join("")}
    </div>`).join("");
  return `<section class="band data-preflight-panel danger">
    <div class="section-head"><div><div class="section-title">数据完整性预检未通过</div><div class="section-subtitle preflight-message">${escapeHtml(result.user_message || "请修复问题后重新检查")}</div></div><span class="data-count-chip">共 ${Number(result.issue_count || 0)} 个问题</span></div>
    <div class="data-preflight-list">${issueRows}</div>
    <div class="audit-toolbar"><button class="btn primary data-preflight-view" type="button">查看问题记录</button><button class="btn data-preflight-recheck" type="button">重新检查</button><button class="btn data-preflight-download" type="button">下载错误清单</button></div>
  </section>`;
}

async function loadPreflightDetails() {
  backupState.preflightDetailsOpen = true;
  backupState.preflightDetailsLoading = true;
  backupState.preflightDetailsError = "";
  render();
  try {
    backupState.preflightDetails = await request("/api/data-center/preflight/details");
  } catch (error) {
    backupState.preflightDetails = null;
    backupState.preflightDetailsError = safeDataCenterLoadError(error);
  } finally {
    backupState.preflightDetailsLoading = false;
    render();
  }
}

function preflightRecordFields(record = {}) {
  const accountRecord = Boolean(record.username || Object.prototype.hasOwnProperty.call(record, "current_role_code"));
  const fields = [
    ["账号记录ID", record.record_id],
    ["账号", record.username],
    ["姓名", record.display_name],
    ["当前角色ID", accountRecord ? (record.current_role_id ?? "无") : record.current_role_id],
    ["当前角色代码", record.current_role_code],
    ["当前角色名称", accountRecord ? (record.current_role_name || "无") : record.current_role_name],
    ["无效原因", record.invalid_reason],
    ["建议处理方式", record.suggestion],
    ["学生姓名", record.student_name],
    ["当前年级", record.current_grade || record.grade],
    ["冲突阶段 A", record.stage_a],
    ["阶段 A 日期", record.stage_a ? `${record.start_a || "未设置"}—${record.end_a || "长期"}` : ""],
    ["冲突阶段 B", record.stage_b],
    ["阶段 B 日期", record.stage_b ? `${record.start_b || "未设置"}—${record.end_b || "长期"}` : ""],
    ["实际重叠", record.overlap_start ? `${record.overlap_start}—${record.overlap_end || "长期"}` : ""],
    ["冲突原因", record.reason],
    ["关联记录", record.record_ids],
  ];
  return fields.filter(([, value]) => value !== undefined && value !== null && String(value) !== "");
}

function preflightDetailsMarkup() {
  if (!backupState.preflightDetailsOpen) return "";
  const details = backupState.preflightDetails;
  let body = `<div class="data-preflight-detail-state">正在加载问题详情…</div>`;
  if (backupState.preflightDetailsError) {
    body = `<div class="audit-inline-notice danger data-preflight-detail-error"><span>问题详情加载失败：${escapeHtml(backupState.preflightDetailsError)}</span><button class="btn data-preflight-detail-retry" type="button">重试</button></div>`;
  } else if (!backupState.preflightDetailsLoading) {
    if (details?.check_failed) {
      body = `<div class="audit-inline-notice danger data-preflight-detail-error"><span>问题详情加载失败：${escapeHtml(details.user_message || "数据完整性预检暂时不可用")}</span><button class="btn data-preflight-detail-retry" type="button">重试</button></div>`;
    } else {
    const issues = details?.issues || [];
    body = issues.length ? `<div class="data-preflight-detail-list">${issues.map((issue) => `
      <section class="data-preflight-detail-issue">
        <div class="data-preflight-detail-heading"><div><strong>${escapeHtml(issue.label || issue.code)}</strong><span>${escapeHtml(issue.code || "")}</span></div><span>${Number(issue.count || 0)} 条</span></div>
        <div class="data-preflight-detail-records">${(issue.records || []).map((record) => `
          <article class="data-preflight-detail-record" data-record-id="${escapeHtml(record.record_id ?? "")}">
            <dl>${preflightRecordFields(record).map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd title="${escapeHtml(value)}">${escapeHtml(value)}</dd></div>`).join("")}</dl>
            ${issue.code === "ACCOUNT_ROLE_INVALID" && canView("userAdmin") ? `<button class="btn primary preflight-account-link" type="button" data-record-id="${escapeHtml(record.record_id)}" data-username="${escapeHtml(record.username || "")}">前往账号权限</button>` : ""}
            ${issue.code === "STUDENT_GRADE_STAGE_OVERLAP" && canView("studentProfiles") ? `<button class="btn primary preflight-student-stage-link" type="button" data-student-id="${escapeHtml(record.student_id)}" data-stage-a="${escapeHtml(record.stage_a)}" data-stage-b="${escapeHtml(record.stage_b)}">前往学生档案</button>` : ""}
          </article>`).join("") || `<div class="empty">该类型暂无可显示记录，请重新检查。</div>`}</div>
      </section>`).join("")}</div>` : `<div class="data-preflight-detail-state">没有可显示的问题记录，请重新检查。</div>`;
    }
  }
  return `<div class="modal-backdrop data-preflight-detail-modal"><div class="modal-panel data-preflight-detail-panel" role="dialog" aria-modal="true" aria-labelledby="data-preflight-detail-title">
    <div class="modal-head"><div><div class="modal-title" id="data-preflight-detail-title">数据完整性问题记录</div><div class="modal-subtitle">仅展示修复所需业务字段，不包含密码、Token、Cookie、Session 或 Secret。</div></div><button class="btn data-preflight-detail-close" type="button">关闭</button></div>
    ${body}
  </div></div>`;
}

function baiduSimpleGuideMarkup() {
  if (!backupState.showBaiduGuide) return "";
  const baidu = backupState.baidu || DATA_CENTER_DEFAULT_BAIDU;
  const owner = canView("audit");
  const callback = baidu.redirect_uri || `${window.location.origin}/api/data-center/baidu/callback`;
  const configured = baidu.app_key_configured && baidu.app_secret_configured && baidu.redirect_uri_configured;
  const editing = !configured || backupState.baiduConfigEditing;
  let configMarkup = `<div class="audit-inline-notice neutral">当前账号没有提交百度应用配置的权限。</div>`;
  if (owner && editing) configMarkup = `<p>App Key 与 App Secret 保存后均不回显。此表单不会使用登录账号自动填充。</p><form class="data-backup-settings-grid baidu-secret-form" autocomplete="off" onsubmit="return false">
    <label class="filter-field"><span>App Key</span><input class="control baidu-config-app-key" type="search" name="baidu_app_key_new" value="" autocomplete="off" autocapitalize="none" spellcheck="false" data-lpignore="true" data-1p-ignore="true"></label>
    <label class="filter-field"><span>App Secret</span><input class="control baidu-config-app-secret" type="password" name="baidu_app_secret_new" value="" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true"></label>
  </form><div class="audit-toolbar"><button class="btn primary baidu-config-save" type="button">保存百度配置</button>${configured ? `<button class="btn baidu-config-edit-cancel" type="button">取消重新配置</button>` : ""}</div>`;
  else if (owner) configMarkup = `<div class="audit-inline-notice neutral"><strong>百度应用已配置</strong><br>App Key：已配置；App Secret：已配置。出于安全原因不回显。</div><div class="audit-toolbar"><button class="btn baidu-config-edit" type="button">重新配置</button><button class="btn danger baidu-config-clear" type="button">清除配置</button></div>`;
  return `<div class="modal-backdrop baidu-guide-modal"><div class="modal-panel baidu-guide-panel">
    <div class="modal-head"><div><div class="modal-title">百度网盘备份三步配置</div><div class="modal-subtitle">本地备份不依赖百度配置；远端保存未加密 Excel 及其 SHA-256 校验文件。</div></div><button class="btn baidu-guide-close" type="button">关闭</button></div>
    <div class="baidu-guide-steps">
      <section><h3>第一步：填写百度应用信息</h3><ol><li>打开百度开放平台并创建应用。</li><li>把下方回调地址原样复制到应用配置。</li><li>复制应用的 App Key 和 App Secret。</li></ol><div class="audit-toolbar"><a class="btn" href="https://pan.baidu.com/union" target="_blank" rel="noopener noreferrer">打开百度开放平台</a><button class="btn baidu-copy-callback" type="button">复制回调地址</button><a class="btn" href="https://openauth.baidu.com/doc/" target="_blank" rel="noopener noreferrer">查看图文说明</a></div><label class="filter-field wide"><span>准备回调地址</span><input class="control" value="${escapeHtml(callback)}" readonly></label>${configMarkup}</section>
      <section><h3>第二步：连接百度网盘</h3><p>保存配置后完成 OAuth 授权。Token 仅保存在服务器受限文件中，不会回显到页面。</p><div class="audit-toolbar"><button class="btn baidu-connect" type="button" ${configured && owner ? "" : "disabled"}>连接百度网盘</button><button class="btn baidu-disconnect" type="button" ${baidu.authorized && owner ? "" : "disabled"}>解除授权</button></div></section>
      <section><h3>第三步：测试并启用</h3><p>测试会上传无业务数据的普通文本及 SHA-256 文件，再下载校验并分别删除。全部通过后才可启用自动上传。</p><div class="audit-toolbar"><button class="btn baidu-test" type="button" ${configured && baidu.authorized && owner ? "" : "disabled"}>测试连接</button></div></section>
    </div>
  </div></div>`;
}

function baiduTestDetailsMarkup() {
  const result = backupState.baiduTestDetails; if (!result || !backupState.baiduTestDetailsOpen) return "";
  const labels = { authorization: "授权", connection: "连接", test_directory: "测试目录", file_upload: "普通文件上传", checksum_upload: "校验文件上传", file_metadata: "普通文件元信息", checksum_metadata: "校验文件元信息", file_download: "普通文件下载", checksum_download: "校验文件下载", integrity_check: "SHA-256完整性", test_delete_file: "普通文件清理", test_delete_checksum: "校验文件清理" };
  return `<div class="modal-backdrop baidu-test-detail-modal"><div class="modal-panel baidu-test-detail-panel" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="modal-title">百度连接测试详情</div><div class="modal-subtitle">仅显示安全诊断，不含凭据或下载链接。</div></div><button class="btn baidu-test-detail-close" type="button">关闭</button></div><div class="baidu-test-step-list">${Object.entries(labels).map(([key,label]) => `<div><span>${label}</span><strong>${result.steps?.[key] ? "通过" : "未通过"}</strong></div>`).join("")}</div>${result.code ? `<div class="audit-inline-notice danger">阶段：${escapeHtml(result.stage || "unknown")}；内部码：${escapeHtml(result.code)}；百度码：${escapeHtml(result.provider_code || "无")}；HTTP：${Number(result.http_status || 0) || "无"}</div>` : ""}<div class="audit-inline-notice ${result.cleanup?.complete || result.cleanup_ok ? "neutral" : "warning"}">测试文件清理：${result.cleanup?.complete || result.cleanup_ok ? "已完成" : "未完全完成"}${result.cleanup?.remaining_paths?.length ? `；请人工处理：${result.cleanup.remaining_paths.map(escapeHtml).join("、")}` : ""}</div></div></div>`;
}

function baiduTestFailureMessage(detail = {}) {
  const labels = {
    file_metadata: "获取文件元信息失败",
    checksum_metadata: "获取校验文件元信息失败",
    file_download: "下载文件失败",
    checksum_download: "下载校验文件失败",
    integrity_check: "远端文件完整性校验失败",
  };
  let message = labels[detail.stage] || detail.error || "百度连接测试失败";
  if (["file_metadata", "checksum_metadata"].includes(detail.stage) && String(detail.provider_code) === "2") message += "：百度参数错误（错误码2）";
  else if (detail.provider_code) message += `（百度错误码：${detail.provider_code}）`;
  if (detail.cleanup?.complete) message += "，测试文件已清理";
  return message;
}

function baiduSimpleSettingsCardMarkup() {
  const baidu = backupState.baidu || DATA_CENTER_DEFAULT_BAIDU;
  const preflightBlocked = Boolean(backupState.preflight && !backupState.preflight.ok);
  const configured = baidu.app_key_configured && baidu.app_secret_configured && baidu.redirect_uri_configured;
  const tested = baidu.test_passed || baidu.last_test_result === "success";
  const testLabel = tested ? "测试通过" : baidu.last_test_result && baidu.last_test_result !== "not_tested" ? "测试失败，请重新测试" : "未测试";
  const draft = backupState.draft || backupState.settings || DATA_CENTER_DEFAULT_SETTINGS; const owner = canView("audit");
  const frequency = draft.remote_frequency || "weekly"; const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const scheduleState = backupState.baiduSchedule || { due: false, reason: "disabled" };
  const scheduleLabel = scheduleState.due ? "可以执行" : ({
    not_configured: "百度应用尚未配置",
    not_authorized: "百度网盘尚未授权",
    plaintext_not_acknowledged: "尚未确认明文备份风险",
    disabled: "自动备份未启用",
    manual: "自动备份未启用",
  }[scheduleState.reason] || "等待计划时间");
  const activeJob = (backupState.records || []).find((row) => ["queued", "preflight", "exporting", "hashing", "uploading_excel", "uploading_checksum", "verifying_metadata", "downloading_for_verification", "integrity_check"].includes(row.job_status));
  return `<div class="data-backup-subcard baidu-backup-card">
    <div class="section-head"><div><div class="section-title">百度网盘备份</div><div class="section-subtitle">按三步向导配置，未配置不影响服务器本地备份。</div></div>${owner ? `<button class="btn primary baidu-guide-open" type="button">${configured ? "查看配置" : "配置百度网盘"}</button>` : ""}</div>
    <div class="baidu-status-grid simple">
      <div><span>① 百度应用</span><strong>${configured ? "已配置" : "未配置"}</strong></div>
      <div><span>② 百度授权</span><strong>${baidu.authorized ? "已连接" : "未连接"}</strong></div>
      <div><span>③ 连接测试</span><strong>${testLabel}</strong></div>
      <div><span>④ 自动上传</span><strong>${backupState.settings?.remote_enabled ? "已启用" : "未启用"}</strong></div>
      <div><span>⑤ 计划状态</span><strong class="baidu-schedule-state">${scheduleLabel}</strong></div>
    </div>
    ${configured ? "" : `<div class="audit-inline-notice neutral">尚未填写App Key和App Secret，请先点击“配置百度网盘”。</div>`}
    <div class="audit-inline-notice danger baidu-plaintext-warning"><strong>百度网盘将保存未加密的完整 Excel 备份。</strong><span>文件包含学生、课程、充值、账号权限及账号认证哈希等敏感数据。请确保百度账号已启用可靠密码和安全验证，不要公开分享备份文件。</span></div>
    <div class="baidu-settings-group baidu-settings-files"><label class="filter-field baidu-remote-directory-field"><span>远端目录</span><input class="control data-backup-remote-directory" value="${escapeHtml(draft.remote_directory)}" ${owner ? "" : "readonly"}></label><label class="history-toggle baidu-plaintext-ack data-backup-checkbox-row"><input class="data-backup-remote-plaintext-ack" type="checkbox" ${draft.remote_plaintext_acknowledged ? "checked" : ""} ${owner ? "" : "disabled"}><span>我已知晓百度网盘中将保存未加密的完整备份文件</span></label><label class="history-toggle data-backup-checkbox-row"><input class="data-backup-remote-logs" type="checkbox" ${draft.remote_include_operation_logs ? "checked" : ""} ${owner ? "" : "disabled"}><span>百度备份中包含操作日志</span></label></div>
    <div class="baidu-settings-group baidu-settings-schedule"><label class="history-toggle data-backup-checkbox-row"><input class="data-backup-remote-enabled" type="checkbox" ${draft.remote_enabled ? "checked" : ""} ${owner ? "" : "disabled"}><span>启用百度网盘自动备份</span></label><label class="filter-field"><span>备份频率</span><select class="control data-backup-remote-frequency"><option value="manual" ${frequency === "manual" ? "selected" : ""}>仅手动</option><option value="daily" ${frequency === "daily" ? "selected" : ""}>每天</option><option value="weekly" ${frequency === "weekly" ? "selected" : ""}>每周</option><option value="monthly" ${frequency === "monthly" ? "selected" : ""}>每月</option></select></label><label class="filter-field remote-schedule-time" ${frequency === "manual" ? "hidden" : ""}><span>执行时间</span><input class="control data-backup-remote-time" type="time" value="${escapeHtml(draft.remote_time)}"></label><label class="filter-field remote-schedule-time" ${frequency === "manual" ? "hidden" : ""}><span>时区</span><select class="control data-backup-remote-timezone"><option value="Asia/Shanghai">Asia/Shanghai</option></select></label></div>
    <div class="baidu-settings-group baidu-settings-policy"><label class="filter-field remote-weekday" ${frequency === "weekly" ? "" : "hidden"}><span>每周执行日</span><select class="control data-backup-remote-weekday">${weekdayLabels.map((label,index) => `<option value="${index + 1}" ${Number(draft.remote_weekday) === index + 1 ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="filter-field remote-monthday" ${frequency === "monthly" ? "" : "hidden"}><span>每月执行日</span><input class="control data-backup-remote-monthday" type="number" min="1" max="28" value="${Number(draft.remote_monthday)}"></label><label class="filter-field"><span>远端保留数量</span><input class="control data-backup-remote-retention" type="number" min="1" max="200" value="${Number(draft.remote_retention)}"></label><label class="filter-field"><span>失败重试次数</span><input class="control data-backup-remote-retries" type="number" min="0" max="10" value="${Number(draft.remote_retry_count)}"></label></div>
    <div class="audit-toolbar"><button class="btn primary baidu-backup-now" type="button" ${baidu.authorized && tested && draft.remote_plaintext_acknowledged && !preflightBlocked && !activeJob ? "" : "disabled"} ${preflightBlocked ? 'title="请先修复数据完整性问题并重新检查"' : ""}>${activeJob ? backupJobStatusLabel(activeJob.job_status) : "立即备份到百度网盘"}</button><button class="btn baidu-settings-save" type="button">保存百度备份设置</button>${configured ? `<button class="btn baidu-test" type="button" ${baidu.authorized ? "" : "disabled"}>测试连接</button>${baidu.authorized ? `<button class="btn baidu-disconnect" type="button">解除授权</button>` : ""}` : ""}${backupState.baiduTestDetails ? `<button class="btn baidu-test-detail-open" type="button">查看测试详情</button>` : ""}</div>
  </div>`;
}

function managedExcelBrowserVisibleItems() {
  const browser = backupState.fileBrowser || {};
  const query = String(browser.query || "").trim().toLowerCase();
  const items = (browser.items || []).filter((item) => !query
    || [item.filename, item.relative_path, item.backup_record?.created_by_label]
      .some((value) => String(value || "").toLowerCase().includes(query)));
  const sizeSort = String(browser.sort || "").startsWith("size_");
  const direction = String(browser.sort || "").endsWith("_asc") ? 1 : -1;
  return items.sort((left, right) => direction * (sizeSort
    ? Number(left.size || 0) - Number(right.size || 0)
    : String(left.modified_at || "").localeCompare(String(right.modified_at || "")))
    || String(left.filename || "").localeCompare(String(right.filename || ""), "zh-CN"));
}

function managedExcelBrowserMarkup() {
  const browser = backupState.fileBrowser;
  if (!browser?.open) return "";
  const local = browser.source === "local";
  const title = local ? "本地托管 Excel 文件" : "百度网盘托管 Excel 文件";
  const items = managedExcelBrowserVisibleItems();
  const body = browser.error
    ? `<div class="managed-file-browser-state danger"><span>${escapeHtml(browser.error)}</span><button class="btn managed-file-browser-retry" type="button">重试</button></div>`
    : browser.loading && !(browser.items || []).length
      ? `<div class="managed-file-browser-state">正在读取文件列表…</div>`
      : `<div class="table-wrap managed-file-browser-table-wrap"><table class="uniform-table managed-file-browser-table">
          <thead><tr><th>文件名</th><th>相对路径</th><th>大小</th><th>修改时间</th>${local ? "" : "<th>fs_id</th>"}<th>校验文件</th><th>备份记录</th><th>创建账号</th><th>文件状态</th>${local ? "<th>操作</th>" : ""}</tr></thead>
          <tbody>${items.map((item) => `<tr>
            <td class="managed-file-name">${escapeHtml(item.filename)}</td>
            <td class="managed-file-relative-path">${escapeHtml(item.relative_path)}</td>
            <td class="right">${escapeHtml(formatFileSize(item.size))}</td>
            <td>${escapeHtml(item.modified_at || "—")}</td>
            ${local ? "" : `<td class="managed-file-id">${escapeHtml(item.fs_id || "—")}</td>`}
            <td><span class="status-badge ${item.checksum_status === "present" ? "success" : "warning"}">${item.checksum_status === "present" ? "已找到" : "缺失"}</span></td>
            <td>${item.backup_record ? `#${Number(item.backup_record.id)} · ${escapeHtml(item.backup_record.status || "—")}` : '<span class="status-badge warning">孤立文件</span>'}</td>
            <td>${escapeHtml(item.backup_record?.created_by_label || "—")}</td>
            <td>${local ? (item.local_file_status === "recorded" ? "已关联" : "孤立文件") : (item.remote_file_status === "recorded" ? "已关联" : "远端孤立文件")}</td>
            ${local ? `<td><a class="btn managed-file-download" href="/api/data-center/files/local-excel/download?path=${encodeURIComponent(item.relative_path)}" download>下载</a></td>` : ""}
          </tr>`).join("") || `<tr><td class="empty" colspan="${local ? 9 : 9}">没有符合条件的 Excel 文件</td></tr>`}</tbody>
        </table></div>`;
  return `<div class="modal-backdrop managed-file-browser-modal">
    <div class="modal-panel managed-file-browser-panel" role="dialog" aria-modal="true" aria-labelledby="managed-file-browser-title">
      <div class="modal-head"><div><div class="modal-title" id="managed-file-browser-title">${title}</div><div class="modal-subtitle">${local ? "仅浏览服务器受管备份目录中的 .xlsx 文件" : "当前仅展示百度应用受管目录中的Excel文件"}；此窗口不提供删除操作，也不会显示绝对路径、Token、Secret 或下载直链。</div></div><button class="btn managed-file-browser-close" type="button">关闭</button></div>
      <div class="managed-file-browser-toolbar">
        <label class="filter-field"><span>搜索</span><input class="control managed-file-browser-query" value="${escapeHtml(browser.query || "")}" placeholder="文件名、相对路径或创建账号"></label>
        <label class="filter-field"><span>排序</span><select class="control managed-file-browser-sort"><option value="modified_desc" ${browser.sort === "modified_desc" ? "selected" : ""}>修改时间从新到旧</option><option value="modified_asc" ${browser.sort === "modified_asc" ? "selected" : ""}>修改时间从旧到新</option><option value="size_desc" ${browser.sort === "size_desc" ? "selected" : ""}>文件大小从大到小</option><option value="size_asc" ${browser.sort === "size_asc" ? "selected" : ""}>文件大小从小到大</option></select></label>
        <button class="btn managed-file-browser-refresh" type="button" ${browser.loading ? "disabled" : ""}>刷新</button>
      </div>
      ${body}
      ${!local && browser.hasMore && !browser.error ? `<div class="modal-actions"><button class="btn managed-file-browser-more" type="button" ${browser.loading ? "disabled" : ""}>${browser.loading ? "正在加载…" : "加载更多"}</button></div>` : ""}
    </div>
  </div>`;
}

async function loadManagedExcelBrowser(source, { append = false } = {}) {
  const previous = backupState.fileBrowser || {};
  const generation = Number(previous.generation || 0) + 1;
  const cursor = append ? previous.cursor || "" : "";
  backupState.fileBrowser = {
    ...previous,
    open: true,
    source,
    loading: true,
    error: "",
    items: append ? previous.items || [] : [],
    cursor,
    hasMore: append ? previous.hasMore : false,
    generation,
  };
  render();
  try {
    const endpoint = source === "local"
      ? "/api/data-center/files/local-excel"
      : `/api/data-center/files/baidu-excel?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const result = await request(endpoint);
    if (backupState.fileBrowser?.generation !== generation
      || backupState.fileBrowser?.source !== source
      || !backupState.fileBrowser?.open
      || view !== "audit") return;
    const combined = append ? [...(previous.items || []), ...(result.items || [])] : result.items || [];
    const byPath = new Map(combined.map((item) => [item.relative_path, item]));
    backupState.fileBrowser = {
      ...backupState.fileBrowser,
      loading: false,
      error: "",
      items: [...byPath.values()],
      cursor: result.next_cursor || "",
      hasMore: Boolean(result.has_more),
    };
  } catch (error) {
    if (backupState.fileBrowser?.generation !== generation) return;
    backupState.fileBrowser = { ...backupState.fileBrowser, loading: false, error: error.message || "文件列表读取失败" };
  }
  render();
}

function renderAudit() {
  const preflightBlocked = Boolean(backupState.preflight && !backupState.preflight.ok);
  const draft = backupState.draft || backupState.settings || DATA_CENTER_DEFAULT_SETTINGS;
  const deletableBackupRows = (backupState.records || []).filter((row) => backupRecordDeletePolicy(row).allowed);
  const selectedDeletableCount = deletableBackupRows.filter((row) => selectedBackupRecordIds.has(Number(row.id))).length;
  const allDeletableSelected = deletableBackupRows.length > 0 && selectedDeletableCount === deletableBackupRows.length;
  renderTopbar("数据中心", "全量 Excel 导入、导出与备份", "");
  contentEl.innerHTML = `
    ${backupState.loadError ? `<div class="audit-inline-notice danger data-center-load-error"><span>数据中心加载失败：${escapeHtml(backupState.loadError)}</span><button class="btn data-center-reload" type="button">重新加载</button></div>` : ""}
    ${backupState.error ? `<div class="audit-inline-notice danger">${escapeHtml(backupState.error)}</div>` : ""}
    ${dataPreflightMarkup()}
    <section class="band audit-panel data-center-section" data-region="import-export">
      <div class="section-head"><div><div class="section-title">数据导入导出</div><div class="section-subtitle">完整备份含 22 张可见业务表和 4 张 veryHidden 恢复表；空白模板不含内部恢复数据。覆盖导入会先创建服务器备份。</div></div></div>
      <div class="audit-toolbar">
        <button class="btn primary data-full-export" type="button" ${backupState.busy ? "disabled" : ""}>导出全部数据</button>
        <button class="btn data-template-download" type="button" ${backupState.busy ? "disabled" : ""}>下载空白模板</button>
        <label class="history-toggle data-backup-checkbox-row data-export-log-option"><input class="data-export-include-logs" type="checkbox" ${backupState.exportIncludeOperationLogs ? "checked" : ""}><span>导出时包含操作日志</span></label>
      </div>
      <div class="data-import-grid">
        <div class="filter-field data-import-file-field"><span>Excel 文件</span><div class="data-file-picker">
          <input id="data-import-file-input" class="data-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
          <button class="btn data-import-file-trigger" type="button">${backupState.importFile ? "重新选择" : "选择Excel文件"}</button>
          <span class="data-import-file-name ${backupState.importFile ? "has-file" : ""}" title="${escapeHtml(backupState.importFile?.name || "尚未选择文件")}">${escapeHtml(backupState.importFile?.name || "尚未选择文件")}</span>
        </div></div>
        <label class="filter-field"><span>导入模式</span><select class="control data-import-mode"><option value="initialize" ${backupState.importMode === "initialize" ? "selected" : ""}>空系统初始化导入</option><option value="overwrite" ${backupState.importMode === "overwrite" ? "selected" : ""}>完整覆盖恢复</option></select></label>
        <button class="btn primary data-import-preview-button" type="button" ${backupState.busy ? "disabled" : ""}>上传并预检</button>
      </div>
      ${importPreviewMarkup()}
    </section>
    <section class="band audit-panel data-center-section" data-region="backup-settings">
      <div class="section-head"><div><div class="section-title">备份设置</div><div class="section-subtitle">服务器目录：${escapeHtml(backupState.settings?.managed_directory || "backups/full-excel")}（${escapeHtml(dataCenterStorageLabel(backupState.settings?.local_storage_status))}）；时间按 Asia/Shanghai 解释。</div></div></div>
      <div class="data-backup-card-grid">
        <div class="data-backup-subcard local-backup-card">
          <div class="section-head"><div><div class="section-title">服务器本地备份</div><div class="section-subtitle">独立生成并验证全量 Excel，本功能不依赖百度配置。</div></div></div>
          <div class="data-backup-primary-grid">
            <label class="history-toggle data-backup-checkbox-row"><input class="data-backup-enabled" type="checkbox" ${draft.enabled ? "checked" : ""}><span>启用自动备份</span></label>
            <label class="filter-field"><span>每天执行时间</span><input class="control data-backup-time" type="time" value="${escapeHtml(draft.time || "02:30")}"></label>
            <label class="filter-field"><span>时区</span><select class="control data-backup-timezone"><option value="Asia/Shanghai">Asia/Shanghai</option></select></label>
            <label class="history-toggle data-backup-checkbox-row"><input class="data-backup-local-logs" type="checkbox" ${draft.local_include_operation_logs ? "checked" : ""}><span>备份中包含操作日志</span></label>
          </div>
          <div class="data-backup-retention-grid">
            <label class="filter-field"><span>每日保留</span><input class="control data-backup-daily" type="number" min="1" max="365" value="${Number(draft.daily_retention || 14)}"></label>
            <label class="filter-field"><span>每月保留</span><input class="control data-backup-monthly" type="number" min="1" max="120" value="${Number(draft.monthly_retention || 12)}"></label>
            <label class="filter-field"><span>手动保留</span><input class="control data-backup-manual" type="number" min="1" max="200" value="${Number(draft.manual_retention || 20)}"></label>
            <label class="filter-field"><span>失败重试次数</span><input class="control data-backup-retries" type="number" min="0" max="10" value="${Number(draft.retry_count ?? 3)}"></label>
          </div>
          <div class="audit-toolbar"><button class="btn primary backup-run-now" type="button" ${backupState.busy || preflightBlocked ? "disabled" : ""} ${preflightBlocked ? 'title="请先修复数据完整性问题并重新检查"' : ""}>立即备份</button><button class="btn backup-settings-save" type="button" ${backupState.busy ? "disabled" : ""}>保存设置</button><span class="audit-toolbar-note">自动备份：${backupState.settings?.enabled ? "已启用" : "未启用"}</span></div>
        </div>
        ${baiduSimpleSettingsCardMarkup()}
      </div>
    </section>
    <section class="band audit-panel data-center-section" data-region="backup-records">
      <div class="section-head"><div><div class="section-title">备份记录</div><div class="section-subtitle">旧业务归档仅兼容查看和下载，不参与新备份清理。</div></div><div class="audit-toolbar"><button class="btn managed-local-excel-open" type="button">查看本地Excel文件</button><button class="btn managed-baidu-excel-open" type="button">查看百度Excel文件</button><button class="btn backup-refresh" type="button">刷新</button></div></div>
      ${backupBatchDeleteToolbarMarkup()}
      <div class="table-wrap smooth-table-wrap"><table class="audit-table uniform-table nowrap-table data-center-backup-table">
        <thead><tr><th class="select-col backup-select-col"><input class="backup-record-select-all" type="checkbox" ${allDeletableSelected ? "checked" : ""} ${deletableBackupRows.length ? "" : "disabled"} aria-label="全选当前可删除备份记录"></th><th>时间</th><th>类型</th><th>触发</th><th>文件</th><th>本地状态</th><th>百度状态</th><th>失败原因</th><th>大小</th><th>SHA-256</th><th>创建账号</th><th>备注</th><th>操作</th></tr></thead>
        <tbody>${dataCenterBackupRows()}</tbody>
      </table></div>
    </section>
    ${baiduSimpleGuideMarkup()}
    ${baiduTestDetailsMarkup()}
    ${preflightDetailsMarkup()}
    ${backupDeleteDialogMarkup()}
    ${backupBatchDeleteDialogMarkup()}
    ${managedExcelBrowserMarkup()}`;
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
  const canManageUsers = canArea("users");
  const teacherValues = userTeacherValues();
  return `
    <div class="user-admin-actions">
      <button class="btn download-user-import-template" type="button" ${canManageUsers ? "" : "disabled"}>下载导入模板</button>
      <button class="btn primary import-teacher-users" type="button" ${canManageUsers ? "" : "disabled"}>从模板导入账号</button>
      <button class="btn sync-teacher-accounts" type="button" ${canManageUsers ? "" : "disabled"}>同步老师账号</button>
      <button class="btn primary open-user-create-modal" type="button" ${canManageUsers ? "" : "disabled"}>+ 新增账号</button>
    </div>
    ${userAccountsTableMarkup(users, teacherValues)}
    ${userCreateModalRegionMarkup(teacherValues)}
  `;
}

function userTeacherValues() {
  return uniqueSorted((state.profile_teachers || []).map((row) => row.name).filter(Boolean));
}

function userAccountRowMarkup(user, teacherValues = userTeacherValues()) {
  const teacherNames = normalizeNameList(user.bound_teacher_names || user.teacher_names || user.teacher_name);
  const ownerAccount = isOwnerRoleValue(user.role);
  const isSelf = Number(auth.user?.id) === Number(user.id);
  const canDelete = auth.user?.role === "owner" && !isSelf && !ownerAccount;
  const deleteTitle = ownerAccount ? "老板账号不可删除" : (isSelf ? "不能删除当前登录账号" : "软删除账号");
  const isPreflightTarget = Number(userAdminFocusId) === Number(user.id);
  return `
    <tr class="user-row ${isPreflightTarget ? "preflight-target" : ""}" data-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}">
      <td><input class="cell-input user-field" data-field="username" value="${escapeHtml(user.username)}"></td>
      <td><input class="cell-input user-field" data-field="display_name" value="${escapeHtml(user.display_name || "")}"></td>
      <td><select class="cell-select user-field" data-field="role">${roleSelectOptions(user.role)}</select></td>
      <td>${multiSelectControl({ className: "user-row-teachers", field: "teacher_names", selected: teacherNames, values: teacherValues, placeholder: "未绑定", clearLabel: "清空", dataAttr: "field", includeSelected: false, searchable: true })}</td>
      <td><select class="cell-select user-field inline-status-select user-inline-status" data-field="status" data-original-value="${escapeHtml(user.status || "active")}">
        <option value="active" ${user.status !== "disabled" ? "selected" : ""}>启用</option>
        <option value="disabled" ${user.status === "disabled" ? "selected" : ""}>停用</option>
      </select></td>
      <td class="readonly user-actions-cell">
        <div class="user-reset-password-inline">
          <input class="control user-reset-password-value" type="password" autocomplete="new-password" placeholder="新密码">
          <button class="btn user-reset-password" type="button">重置</button>
        </div>
      </td>
      <td class="readonly">
        <button class="btn danger user-delete" type="button" data-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}" ${canDelete ? "" : "disabled"} title="${escapeHtml(deleteTitle)}">删除</button>
      </td>
    </tr>
  `;
}

function userAccountsTableMarkup(users = [], teacherValues = userTeacherValues()) {
  return `
    <div class="band user-admin-panel">
      <div class="table-wrap">
        <table class="user-table uniform-table nowrap-table" data-adaptive-table="true">
          <colgroup>
            <col class="user-col-username" data-column-type="account">
            <col class="user-col-display-name" data-column-type="name">
            <col class="user-col-role" data-column-type="status">
            <col class="user-col-teachers" data-column-type="permissions">
            <col class="user-col-status" data-column-type="status">
            <col class="user-col-password" data-column-type="action" data-min-width="210">
            <col class="user-col-delete" data-column-type="action">
          </colgroup>
          <thead><tr><th>账号</th><th>显示姓名</th><th>角色</th><th>绑定老师</th><th>状态</th><th>重置密码</th><th>删除</th></tr></thead>
          <tbody class="user-account-table-body">
            ${users.map((user) => userAccountRowMarkup(user, teacherValues)).join("") || `<tr><td colspan="7" class="empty">暂无账号</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function userCreateModalRegionMarkup(teacherValues = userTeacherValues()) {
  return `<div class="user-create-modal-region">${userCreateModalMarkup(teacherValues)}</div>`;
}

function userCreateModalMarkup(teacherValues = []) {
  if (!userCreateModalOpen) return "";
  const canManageUsers = canArea("users");
  const disabled = canManageUsers ? "" : "disabled";
  return `
    <div class="modal-backdrop user-create-modal">
      <div class="modal-panel user-create-modal-panel" role="dialog" aria-modal="true" aria-labelledby="user-create-modal-title">
        <div class="modal-head">
          <div>
            <div id="user-create-modal-title" class="modal-title">新增账号</div>
            <div class="modal-subtitle">老师账号建议使用手机号作为账号；绑定老师必须与教师档案和课表中的授课老师一致。</div>
          </div>
          <button class="btn user-create-modal-cancel" type="button">关闭</button>
        </div>
        <form class="user-create-form" novalidate>
          <div class="user-create-form-grid">
            <label class="user-create-form-field">
              <span>账号 / 手机号</span>
              <input class="control new-user-field" data-field="username" name="new_account_id" autocomplete="off" placeholder="账号/手机号" autofocus>
            </label>
            <label class="user-create-form-field">
              <span>显示姓名</span>
              <input class="control new-user-field" data-field="display_name" name="new_account_display_name" autocomplete="off" placeholder="显示姓名">
            </label>
            <label class="user-create-form-field">
              <span>角色</span>
              <select class="control new-user-field" data-field="role">${roleSelectOptions(auth.user?.role === "academic" ? "teacher" : "teacher")}</select>
            </label>
            <label class="user-create-form-field">
              <span>绑定老师</span>
              ${multiSelectControl({ className: "new-user-teachers", field: "teacher_names", selected: [], values: teacherValues, placeholder: "未绑定", clearLabel: "清空", dataAttr: "field", includeSelected: false, searchable: true })}
            </label>
            <label class="user-create-form-field wide">
              <span>初始密码</span>
              <input class="control new-user-field" data-field="password" name="new_account_secret" type="password" autocomplete="new-password" placeholder="初始密码，至少 6 位">
            </label>
          </div>
          <div class="modal-actions">
            <button class="btn user-create-modal-cancel" type="button">取消</button>
            <button class="btn primary create-user" type="submit" ${disabled}>确认新增</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function updateUserCreateModalRegion() {
  const region = document.querySelector(".user-create-modal-region");
  if (!region) return;
  closeOpenMultiSelectMenus();
  region.innerHTML = userCreateModalMarkup(userTeacherValues());
  bindUserCreateModalRegion(region);
  region.querySelectorAll(".multi-select").forEach(bindMultiSelectControl);
  if (isReadonlyUser()) {
    region.querySelectorAll(".create-user, .new-user-field, .new-user-teachers").forEach((element) => {
      element.disabled = true;
      element.title = element.title || READONLY_WRITE_MESSAGE;
    });
  }
  if (userCreateModalOpen) {
    requestAnimationFrame(() => region.querySelector(".new-user-field[data-field=\"username\"]")?.focus({ preventScroll: true }));
  }
}

function bindUserCreateModalRegion(region) {
  if (!region || region.dataset.userCreateModalBound === "true") return;
  region.dataset.userCreateModalBound = "true";
  region.addEventListener("click", (event) => {
    if (!event.target.closest(".user-create-modal-cancel")) return;
    event.preventDefault();
    userCreateModalOpen = false;
    updateUserCreateModalRegion();
  });
  region.addEventListener("submit", async (event) => {
    const form = event.target.closest(".user-create-form");
    if (!form || !region.contains(form)) return;
    event.preventDefault();
    const modal = form.closest(".user-create-modal");
    const payload = {};
    modal?.querySelectorAll(".new-user-field").forEach((input) => {
      if (!input.dataset.field) return;
      payload[input.dataset.field] = input.value;
    });
    payload.teacher_names = normalizeNameList(modal?.querySelector(".multi-select-value.new-user-teachers")?.value || "");
    if (!payload.username || !payload.password) return alert("请填写账号和初始密码");
    if (payload.password.length < 6) return alert("初始密码至少 6 位");
    if (!payload.role) return alert("请选择角色");
    const submitButton = form.querySelector(".create-user");
    if (submitButton?.disabled || !canWriteData()) return;
    if (submitButton) submitButton.disabled = true;
    try {
      const result = await request("/api/users", { method: "POST", body: payload });
      userCreateModalOpen = false;
      userAdminNotice = `已新增账号 ${result.username || payload.username}`;
      patchUserState(result);
      insertUserAccountRow(result);
      updateUserAdminNoticeRegion();
      updateUserCreateModalRegion();
    } catch (error) {
      alert(error.message || "新增账号失败");
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function insertUserAccountRow(user) {
  const tableBody = document.querySelector(".user-account-table-body");
  if (!tableBody || !user?.id) return;
  tableBody.querySelector(".empty")?.closest("tr")?.remove();
  const scratch = document.createElement("tbody");
  scratch.innerHTML = userAccountRowMarkup(user, userTeacherValues()).trim();
  const nextRow = scratch.firstElementChild;
  if (!nextRow) return;
  const users = state.users || [];
  const createdIndex = users.findIndex((item) => String(item.id) === String(user.id));
  const laterRow = [...tableBody.querySelectorAll(".user-row")].find((row) => {
    const rowIndex = users.findIndex((item) => String(item.id) === String(row.dataset.id));
    return rowIndex > createdIndex;
  });
  tableBody.insertBefore(nextRow, laterRow || null);
  applyReadonlyUi();
  enhanceCustomSelects();
  bindMultiSelectControl(nextRow.querySelector(".multi-select"));
  bindUserAccountRowEvents(nextRow);
}

function userAdminNoticeMarkup() {
  return userAdminNotice ? `<div class="audit-inline-notice">${escapeHtml(userAdminNotice)}</div>` : "";
}

function updateUserAdminNoticeRegion() {
  const region = document.querySelector(".user-admin-notice-region");
  if (region) region.innerHTML = userAdminNoticeMarkup();
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
    if (!Array.isArray(parsed)) return [];
    if (key === "custom_time_slots") {
      return uniqueSorted(parsed.map((value) => normalizeTimeSlot(value)).filter(Boolean));
    }
    return uniqueSorted(parsed);
  } catch {
    return [];
  }
}

function baseDataDefinitions() {
  return [
    {
      key: "classrooms",
      title: "教室",
      settingKey: "custom_classrooms",
      placeholder: "例如 C6",
      currentValues: uniqueSorted(state.used_lesson_lookups?.classrooms || []),
    },
    {
      key: "subjects",
      title: "科目",
      settingKey: "custom_subjects",
      placeholder: "例如 政治",
      currentValues: uniqueSorted(state.used_lesson_lookups?.subjects || []),
    },
    {
      key: "times",
      title: "常用时间",
      settingKey: "custom_time_slots",
      placeholder: "例如 19:00-21:00",
      currentValues: uniqueSorted((state.used_lesson_lookups?.times || []).map((value) => normalizeTimeSlot(value)).filter(Boolean)),
    },
    {
      key: "statuses",
      title: "课程状态",
      settingKey: "custom_course_statuses",
      placeholder: "例如 调课",
      currentValues: uniqueSorted(state.used_lesson_lookups?.statuses || []),
    },
  ];
}

function normalizeBaseDataValues(key, values = []) {
  const normalized = (values || []).map((value) => {
    const raw = typeof value === "object" ? value?.name : value;
    const clean = String(raw || "").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
    return key === "times" ? normalizeTimeSlot(clean) : clean;
  }).filter(Boolean);
  return uniqueSorted(normalized);
}

function baseDataCandidateValues(def) {
  if (!def) return [];
  return normalizeBaseDataValues(def.key, def.currentValues || []);
}

function baseDataCard(def) {
  const customValues = settingsArray(def.settingKey);
  const candidateValues = baseDataCandidateValues(def);
  const colorKind = def.settingKey === "custom_course_statuses"
    ? "status"
    : def.settingKey === "custom_subjects"
      ? "subject"
      : "";
  return `
    <div class="base-data-card ${colorKind ? "base-data-card-with-colors" : ""}" data-setting-key="${escapeHtml(def.settingKey)}">
      <div class="section-head base-data-card-head">
        <div>
          <div class="section-title">${escapeHtml(def.title)}</div>
          <div class="section-subtitle">当前候选只统计数据库中仍存在的课程；自定义值不会把无课程引用的旧项补回候选。</div>
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
      <div class="base-data-list-title">当前课程实际使用</div>
      <div class="base-data-chip-list">
        ${candidateValues.map((value) => `<span class="neutral-chip">${escapeHtml(value)}</span>`).join("") || `<span class="muted-tip">暂无可用候选</span>`}
      </div>
      ${colorKind ? inlineColorConfigCard(colorKind) : ""}
    </div>
  `;
}

function colorConfigEntries(kind) {
  if (kind === "status") {
    const def = baseDataDefinitions().find((item) => item.key === "statuses");
    return baseDataCandidateValues(def);
  }
  if (kind === "subject") {
    const def = baseDataDefinitions().find((item) => item.key === "subjects");
    return baseDataCandidateValues(def);
  }
  return normalizeBaseDataValues("grades", [
    ...gradeOrder,
    ...(state?.profile_students || []).map((row) => row.current_grade || row.grade),
    ...usedLessonLookupValues("grades"),
  ].filter(Boolean));
}

function inlineColorConfigCard(kind) {
  const config = {
    status: { settingKey: "course_status_colors", defaults: DEFAULT_COURSE_STATUS_COLORS, render: renderCourseStatusBadge },
    subject: { settingKey: "course_subject_colors", defaults: DEFAULT_SUBJECT_COLORS, render: renderSubjectBadge },
  }[kind];
  if (!config) return "";
  const colors = configuredColorMap(config.settingKey, config.defaults);
  return `
    <div class="color-config-card color-config-card-inline" data-color-config="${kind}">
      <div class="base-data-list-title">标签配色</div>
      <div class="color-config-list">
        ${colorConfigEntries(kind).map((name) => {
          const value = colors[name] || generatedBadgeColor(name);
          return `<div class="color-config-row" data-color-name="${escapeHtml(name)}"><span class="color-config-label">${config.render(name)}</span><label>背景 <input class="color-config-input" data-color-part="background" type="color" value="${escapeHtml(safeBadgeColor(value.background, "#eef0f3"))}"></label><label>文字 <input class="color-config-input" data-color-part="color" type="color" value="${escapeHtml(safeBadgeColor(value.color, "#4b5563"))}"></label></div>`;
        }).join("") || '<span class="muted-tip">暂无可配置项</span>'}
      </div>
      <div class="base-data-actions"><button class="btn primary color-config-save" type="button" data-setting-key="${config.settingKey}">保存配色</button><button class="btn color-config-reset" type="button" data-setting-key="${config.settingKey}">恢复默认</button></div>
    </div>
  `;
}

function colorConfigCard(kind) {
  const isStatus = kind === "status";
  const isSubject = kind === "subject";
  const settingKey = isStatus ? "course_status_colors" : isSubject ? "course_subject_colors" : "student_grade_colors";
  const defaults = isStatus ? DEFAULT_COURSE_STATUS_COLORS : isSubject ? DEFAULT_SUBJECT_COLORS : DEFAULT_STUDENT_GRADE_COLORS;
  const colors = configuredColorMap(settingKey, defaults);
  const title = isStatus ? "课程状态配色" : "学生年级配色";
  return `
    <div class="base-data-card color-config-card" data-color-config="${kind}">
      <div class="section-head base-data-card-head"><div><div class="section-title">${title}</div><div class="section-subtitle">背景色与文字色会同步用于课程表、筛选候选和学生标签；未配置的新值使用中性灰。</div></div></div>
      <div class="color-config-list">
        ${colorConfigEntries(kind).map((name) => {
          const value = colors[name] || { background: "#eef0f3", color: "#4b5563" };
          return `<div class="color-config-row" data-color-name="${escapeHtml(name)}"><span class="color-config-label">${isStatus ? renderCourseStatusBadge(name) : isSubject ? renderSubjectBadge(name) : renderStudentBadge({ name, grade: name })}</span><label>背景 <input class="color-config-input" data-color-part="background" type="color" value="${escapeHtml(safeBadgeColor(value.background, "#eef0f3"))}"></label><label>文字 <input class="color-config-input" data-color-part="color" type="color" value="${escapeHtml(safeBadgeColor(value.color, "#4b5563"))}"></label></div>`;
        }).join("") || '<span class="muted-tip">暂无可配置项</span>'}
      </div>
      <div class="base-data-actions"><button class="btn primary color-config-save" type="button" data-setting-key="${settingKey}">保存配色</button><button class="btn color-config-reset" type="button" data-setting-key="${settingKey}">恢复默认</button></div>
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
      <div class="table-wrap">
        <table class="user-table role-table uniform-table nowrap-table" data-adaptive-table="true">
          <colgroup><col data-column-type="name"><col data-column-type="status"><col data-column-type="action"><col data-column-type="action"></colgroup>
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
        <input class="control role-preset-fixed-date" data-date-kind="single" type="date" value="${escapeHtml(fixedDate)}" ${selectedRule === "fixed" ? "" : "hidden"}>
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
    <div class="user-admin-notice-region">${userAdminNoticeMarkup()}</div>
    ${renderUserAdminTabs()}
    ${userAdminTab === "roles" ? renderRoleManagementPanel() : renderUserAccountsPanel()}
  `;
  document.querySelectorAll(".permission-parent").forEach((input) => {
    input.indeterminate = input.dataset.partial === "1";
  });
  if (userAdminTab === "accounts" && userAdminFocusId != null) {
    const target = document.querySelector(`.user-row[data-id="${selectorEscape(String(userAdminFocusId))}"]`);
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        target.querySelector('.user-field[data-field="username"]')?.focus({ preventScroll: true });
      });
    }
  }
}

function renderBaseData() {
  renderTopbar("基础数据", "候选与配色仅统计数据库中当前仍存在的课程记录");
  contentEl.innerHTML = `
    <div class="band base-data-panel">
      <div class="section-head">
        <div>
          <div class="section-title">基础数据 / 数据字典</div>
          <div class="section-subtitle">教室、科目、常用时间和课程状态按现存课程实时汇总；删除最后一条引用课程后，对应候选与配色同步消失。</div>
        </div>
      </div>
      <div class="base-data-grid">
        ${baseDataDefinitions().map(baseDataCard).join("")}
        ${colorConfigCard("grade")}
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
                <td class="text-cell">${renderEntityBadge("grade", row.grade)}</td>
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
  if (studentNeedle && !row._student_key.includes(studentNeedle)) return false;
  if (filter.grade && !row._grade_key.includes(filter.grade.toLocaleLowerCase("zh-CN"))) return false;
  if (filter.subject && !row._subject_key.includes(filter.subject.toLocaleLowerCase("zh-CN"))) return false;
  if (filter.student_names && !row._student_names_key.includes(filter.student_names.toLocaleLowerCase("zh-CN"))) return false;
  if (filter.price && filter.price !== (studentPricingVisibleStatus(row) === "已设置" ? "set" : "unset")) return false;
  const currentLessons = numberValue(row.current_month_lessons);
  const totalLessons = numberValue(row.total_lessons);
  if (filter.usage === "current" && currentLessons <= 0) return false;
  if (filter.usage === "historical" && (currentLessons > 0 || totalLessons <= 0)) return false;
  if (filter.usage === "unused" && totalLessons > 0) return false;
  return true;
}

function renderStudentPricingFilterBar(rows, visibleRows) {
  const filters = state.student_pricing_filters || {};
  const students = filters.students || uniqueSorted(rows.map((row) => row.student_name));
  const grades = filters.grades || uniqueSorted(rows.map((row) => row.grade));
  const subjects = filters.subjects || uniqueSorted(rows.map((row) => row.subject));
  const studentGroups = filters.student_groups || uniqueSorted(rows.map((row) => row.student_names));
  return `
    <div class="filter-bar compact unified-filter-bar student-pricing-filter-bar">
      <div class="filter-controls">
        ${unifiedFilterField({ label: "学生", className: "student-pricing-filter-input", field: "student", value: studentPricingFilter.student, values: students })}
        ${unifiedFilterField({ label: "年级", className: "student-pricing-filter-input", field: "grade", value: studentPricingFilter.grade, values: grades })}
        ${unifiedFilterField({ label: "科目", className: "student-pricing-filter-input", field: "subject", value: studentPricingFilter.subject, values: subjects })}
        ${unifiedFilterField({ label: "学生集合", className: "student-pricing-filter-input", field: "student_names", value: studentPricingFilter.student_names, values: studentGroups, placeholder: "全部学生集合" })}
        ${unifiedFilterField({ label: "价格状态", className: "student-pricing-filter-input", field: "price", value: filterLabel(priceFilterOptions, studentPricingFilter.price), values: priceFilterOptions.map((item) => item[1]), placeholder: "全部价格状态" })}
      </div>
      <div class="filter-summary">
        <span>已筛选 <b>${visibleRows.length}</b> / 共 ${rows.length} 条</span>
        <button class="btn reset-student-pricing-filter" type="button">清空筛选</button>
      </div>
    </div>
  `;
}

function studentPricingRowMarkup(row) {
  const readonly = canWriteData() ? "" : " disabled";
  return `
    <tr class="student-pricing-rule-row" data-rule-id="${row.id}">
      <td class="select-col adaptive-center" data-adaptive-alignment="center"><input class="student-pricing-select-row" type="checkbox" data-id="${escapeHtml(row.id)}" ${selectedStudentPricingIds.has(Number(row.id)) ? "checked" : ""}${readonly} aria-label="选择学生单价规则"></td>
      <td class="text-cell adaptive-center" data-adaptive-alignment="center">${renderStudentBadge(row.student_name, { fallbackGrade: row.grade })}</td>
      <td class="text-cell adaptive-center" data-adaptive-alignment="center">${renderGradeBadge(row.grade)}</td>
      <td class="text-cell adaptive-center" data-adaptive-alignment="center">${renderSubjectBadge(row.subject)}</td>
      <td class="text-cell wide student-set-cell adaptive-left adaptive-wrap" data-adaptive-alignment="left">${renderStudentSetBadges(row.student_names, { fallbackGrade: row.grade })}</td>
      <td class="currency-input-cell student-pricing-value-cell adaptive-right" data-adaptive-alignment="right">${currencyInputMarkup(row.custom_price, { className: "student-pricing-field", attrs: `data-id="${row.id}" data-field="custom_price" min="0" step="0.01" aria-invalid="false"${readonly}` })}</td>
      <td class="text-cell adaptive-center student-pricing-status-cell" data-adaptive-alignment="center">${visiblePriceStatusBadge(studentPricingVisibleStatus(row))}</td>
      <td class="adaptive-left adaptive-wrap" data-adaptive-alignment="left"><textarea class="cell-input adaptive-textarea wide student-pricing-field" data-id="${row.id}" data-field="notes" rows="1" wrap="soft"${readonly}>${escapeHtml(row.notes)}</textarea></td>
    </tr>
  `;
}

function cancelStudentPricingProgressiveRender() {
  studentPricingRenderGeneration += 1;
  if (studentPricingRenderHandle) {
    window.cancelIdleCallback?.(studentPricingRenderHandle);
    window.clearTimeout(studentPricingRenderHandle);
    studentPricingRenderHandle = 0;
  }
}

function scheduleStudentPricingProgressiveRender(rows, startIndex) {
  const generation = ++studentPricingRenderGeneration;
  const schedule = (callback) => {
    studentPricingRenderHandle = window.requestIdleCallback
      ? window.requestIdleCallback(callback, { timeout: 80 })
      : window.setTimeout(() => callback({ timeRemaining: () => 8 }), 0);
  };
  const appendBatch = () => {
    if (generation !== studentPricingRenderGeneration || view !== "studentPricing") return;
    const body = document.querySelector(".student-pricing-table tbody");
    if (!body) return;
    const end = Math.min(rows.length, startIndex + STUDENT_PRICING_RENDER_BATCH_SIZE);
    body.insertAdjacentHTML("beforeend", rows.slice(startIndex, end).map(studentPricingRowMarkup).join(""));
    startIndex = end;
    const progress = document.querySelector(".student-pricing-render-progress");
    if (progress) progress.textContent = startIndex < rows.length
      ? `正在加载更多规则 ${startIndex} / ${rows.length}`
      : `已加载全部 ${rows.length} 条规则`;
    const table = document.querySelector(".student-pricing-table");
    if (table) table.dataset.renderedRows = String(startIndex);
    if (startIndex < rows.length) {
      schedule(appendBatch);
    } else if (table) {
      table.dataset.renderComplete = "true";
      studentPricingRenderHandle = 0;
    }
  };
  if (startIndex < rows.length) schedule(appendBatch);
}

function renderStudentPricing() {
  cancelStudentPricingProgressiveRender();
  const rows = state.student_pricing || [];
  const visibleRows = rows.filter(studentPricingMatchesFilter);
  studentPricingVisibleRows = visibleRows;
  const activeFilterSummary = Object.entries(studentPricingFilter)
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => `${({ student: "学生", grade: "年级", subject: "科目", student_names: "学生集合", price: "价格状态", usage: "使用状态" })[key]}：${value}`)
    .join("；") || "全部规则";
  const visibleIds = new Set(visibleRows.map((row) => Number(row.id)));
  selectedStudentPricingIds = new Set([...selectedStudentPricingIds].filter((id) => visibleIds.has(Number(id))));
  const selectedVisibleCount = visibleRows.filter((row) => selectedStudentPricingIds.has(Number(row.id))).length;
  const allVisibleSelected = visibleRows.length > 0 && selectedVisibleCount === visibleRows.length;
  const unsetRows = rows.filter((row) => numberValue(row.custom_price) <= 0);
  const initialRows = visibleRows.slice(0, STUDENT_PRICING_INITIAL_ROW_COUNT);
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
    <div class="band student-pricing-page">
      ${renderStudentPricingFilterBar(rows, visibleRows)}
      <div class="transaction-action-row pricing-batch-actions" role="toolbar" aria-label="学生单价批量操作">
        <span class="batch-selection-summary">已选择 <b>${selectedStudentPricingIds.size}</b> 条</span>
        <button class="btn clear-student-pricing-selection" type="button" ${selectedStudentPricingIds.size ? "" : "disabled"}>清空选择</button>
        <button class="btn primary open-student-pricing-batch-modal" type="button" ${selectedStudentPricingIds.size && canWriteData() ? "" : "disabled"}>批量设置单价</button>
      </div>
      <div id="student-pricing-table-wrap" class="table-wrap smooth-table-wrap">
        <table class="student-pricing-table uniform-table nowrap-table" data-adaptive-table="true" data-adaptive-source="student-pricing" data-adaptive-flex-column="7" data-initial-row-count="${initialRows.length}" data-rendered-rows="${initialRows.length}" ${initialRows.length === visibleRows.length ? 'data-render-complete="true"' : ""}>
          <colgroup><col data-column-type="select"><col data-column-type="name"><col data-column-type="short" data-max-width="120"><col data-column-type="short" data-max-width="120"><col data-column-type="students"><col data-column-type="money"><col data-column-type="status"><col data-column-type="long"></colgroup>
          <thead><tr><th class="select-col"><input class="student-pricing-select-all" type="checkbox" ${allVisibleSelected ? "checked" : ""} ${visibleRows.length && canWriteData() ? "" : "disabled"} aria-label="全选当前可见学生单价规则"></th><th>学生</th><th>年级</th><th>科目</th><th>学生集合</th><th>单价</th><th>价格状态</th><th class="wide">备注</th></tr></thead>
          <tbody>
            ${initialRows.map(studentPricingRowMarkup).join("") || `<tr><td colspan="8" class="empty">暂无学生单价规则</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="student-pricing-render-progress muted-tip" role="status" aria-live="polite">${initialRows.length < visibleRows.length ? `正在加载更多规则 ${initialRows.length} / ${visibleRows.length}` : `已加载全部 ${visibleRows.length} 条规则`}</div>
    </div>
    ${studentPricingBatchModalOpen ? `
      <div class="modal-backdrop student-pricing-batch-modal">
        <div class="modal-panel batch-pricing-modal-panel" role="dialog" aria-modal="true" aria-labelledby="student-pricing-batch-title">
          <div class="modal-head"><div><div class="modal-title" id="student-pricing-batch-title">批量设置学生单价</div><div class="modal-subtitle">仅修改已选择 ${selectedStudentPricingIds.size} 条规则的单价，其他字段保持不变。</div><div class="modal-subtitle">当前筛选：${escapeHtml(activeFilterSummary)}</div></div></div>
          <label class="filter-field"><span>统一单价</span><input class="control student-pricing-batch-value" type="number" min="0" max="100000" step="0.01" value="0"></label>
          <div class="batch-pricing-result" aria-live="polite"></div>
          <div class="modal-actions"><button class="btn close-student-pricing-batch-modal" type="button">取消</button><button class="btn primary confirm-student-pricing-batch" type="button">确认更新</button></div>
        </div>
      </div>
    ` : ""}
  `;
  updateStudentPricingSelectionUi();
  scheduleStudentPricingProgressiveRender(visibleRows, initialRows.length);
}

function renderClassGroups() {
  const rows = state.class_groups || [];
  const opts = dynamicClassGroupFilterOptions(rows);
  const visibleRows = rows.filter((row) => classGroupMatchesFilter(row));
  const hiddenInactiveCount = rows.filter((row) => !isActiveTeacherName(row.teacher)).length;
  renderTopbar("班级管理", `已筛选 ${visibleRows.length} / 共 ${rows.length} 个班级`);
  contentEl.innerHTML = `
    <div class="band class-group-page">
      <div class="filter-bar compact unified-filter-bar class-group-filter-bar">
        <div class="filter-controls">
          ${unifiedFilterField({ label: "教师", className: "class-group-filter-input", field: "teacher", value: classGroupFilter.teacher, values: opts.teachers })}
          ${unifiedFilterField({ label: "年级", className: "class-group-filter-input", field: "grade", value: classGroupFilter.grade, values: opts.grades })}
          ${unifiedFilterField({ label: "科目", className: "class-group-filter-input", field: "subject", value: classGroupFilter.subject, values: opts.subjects })}
          ${unifiedFilterField({ label: "学生", className: "class-group-filter-input", field: "student", value: classGroupFilter.student, values: opts.students })}
        </div>
        <label class="history-toggle compact-toggle">
          <input class="class-group-hide-inactive" type="checkbox" ${classGroupHideInactiveTeachers ? "checked" : ""}>
          <span>隐藏非在职老师</span>
        </label>
        <div class="filter-summary">
          <span>已筛选 <b>${visibleRows.length}</b> / 共 ${rows.length} 条${classGroupHideInactiveTeachers && hiddenInactiveCount ? `，已隐藏 ${hiddenInactiveCount} 条` : ""}</span>
          <button class="btn reset-class-group-filter" type="button">清空筛选</button>
        </div>
      </div>
      <div class="table-wrap smooth-table-wrap">
        <table class="class-group-table uniform-table nowrap-table" data-adaptive-table="true" data-adaptive-flex-column="3">
          <colgroup><col data-column-type="name"><col data-column-type="short" data-max-width="120"><col data-column-type="short" data-max-width="120"><col data-column-type="students"><col data-column-type="long"></colgroup>
          <thead><tr><th>老师</th><th>年级</th><th>科目</th><th class="wide">学生集合</th><th class="wide">班级名</th></tr></thead>
          <tbody>
            ${visibleRows.map((row) => `
              <tr class="class-group-row" data-class-group-id="${row.id}">
                <td class="text-cell center adaptive-center">${escapeHtml(row.teacher)}</td>
                <td class="text-cell center adaptive-center">${renderGradeBadge(row.grade)}</td>
                <td class="text-cell center adaptive-center">${renderSubjectBadge(row.subject)}</td>
                <td class="text-cell wide class-group-students-cell adaptive-left">${renderStudentSetBadges(row.students_display || row.students_key || "", { fallbackGrade: row.grade })}</td>
                <td class="adaptive-left"><input class="cell-input wide class-group-field" data-id="${row.id}" data-field="class_name" value="${escapeHtml(row.class_name || "")}" placeholder="未命名"></td>
              </tr>
            `).join("") || `<tr><td colspan="5" class="empty">暂无班级候选</td></tr>`}
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
  const gradeFilter = kind === "students" ? (profileGradeFilter.students || "") : "";
  const gradeRows = gradeFilter ? statusRows.filter((row) => textContains(row.grade || "", gradeFilter)) : statusRows;
  const nameQuery = String(profileNameFilter[kind] || "").trim().toLowerCase();
  const nameRows = nameQuery
    ? gradeRows.filter((row) => String(row.name || "").toLowerCase().includes(nameQuery))
    : gradeRows;
  const keyword = String(profileKeywordFilter[kind] || "").trim().toLowerCase();
  const filtered = keyword
    ? nameRows.filter((row) => [row.phone, row.status, row.joined_at, row.left_at, row.notes].some((value) => String(value || "").toLowerCase().includes(keyword)))
    : nameRows;
  if (kind !== "students") return filtered;
  return sortStudentProfiles(filtered);
}

function studentGradeStageMap(row = {}) {
  const map = new Map();
  for (const stage of row.grade_stages || []) map.set(stage.stage, stage);
  return map;
}

function studentStageConflictsFor(studentId) {
  return (studentGradeStageConflicts || []).filter((conflict) => Number(conflict.student_id) === Number(studentId));
}

function studentStageConflictSummary(conflict = {}) {
  const endA = conflict.end_a || "长期";
  const endB = conflict.end_b || "长期";
  return `${conflict.student_name}：${conflict.stage_a}（${conflict.start_a || "未设置"}—${endA}）与${conflict.stage_b}（${conflict.start_b || "未设置"}—${endB}）重叠；重叠时间：${conflict.overlap_start || "-"}—${conflict.overlap_end || "-"}`;
}

function studentStageConflictErrorKind(error = {}) {
  const status = Number(error.status || 0);
  if (status === 403) return "无权限查看";
  if (status === 404) return "接口不存在";
  if (status >= 500) return "服务器处理失败";
  if (!status) return "网络连接失败";
  return "无法获取检查结果";
}

async function refreshStudentGradeStageConflicts({ renderStatus = true, generation = loadGeneration } = {}) {
  const requestId = ++studentGradeStageConflictRequestId;
  studentGradeStageConflictCheck = { status: "loading", errorKind: "" };
  if (renderStatus && view === "studentProfiles") rerenderCurrentView(() => renderProfileDirectory("students"));
  try {
    const result = await request("/api/student-grade-stages/conflicts", { cache: false });
    if (requestId !== studentGradeStageConflictRequestId || generation !== loadGeneration) return false;
    studentGradeStageConflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
    state.student_grade_stage_conflicts = studentGradeStageConflicts;
    studentGradeStageConflictCheck = { status: "success", errorKind: "" };
  } catch (error) {
    if (requestId !== studentGradeStageConflictRequestId || generation !== loadGeneration) return false;
    studentGradeStageConflicts = [];
    state.student_grade_stage_conflicts = [];
    studentGradeStageConflictCheck = { status: "error", errorKind: studentStageConflictErrorKind(error) };
  }
  if (renderStatus && view === "studentProfiles") rerenderCurrentView(() => renderProfileDirectory("students"));
  return studentGradeStageConflictCheck.status === "success";
}

function studentStageConflictBannerMarkup(forcedStatus = "") {
  const status = forcedStatus || studentGradeStageConflictCheck.status || "idle";
  const studentCount = new Set((studentGradeStageConflicts || []).map((item) => Number(item.student_id) || item.student_name)).size;
  if (status === "loading" || status === "idle") return `<section class="student-stage-conflict-banner student-stage-conflict-check loading" data-status="loading" role="status" aria-live="polite">
    <div><span class="student-stage-conflict-icon" aria-hidden="true">…</span><div><strong>阶段冲突：正在检查……</strong></div></div>
    <button class="btn student-stage-conflict-refresh" type="button" disabled>重新检查</button>
  </section>`;
  if (status === "error") return `<section class="student-stage-conflict-banner student-stage-conflict-check error" data-status="error" role="status" aria-live="polite">
    <div><span class="student-stage-conflict-icon" aria-hidden="true">!</span><div><strong>阶段冲突检查失败：${escapeHtml(studentGradeStageConflictCheck.errorKind || "无法获取检查结果")}</strong></div></div>
    <button class="btn danger student-stage-conflict-refresh" type="button">重试</button>
  </section>`;
  if (!studentCount) return `<section class="student-stage-conflict-banner student-stage-conflict-check success" data-status="success" role="status" aria-live="polite">
    <div><span class="student-stage-conflict-icon" aria-hidden="true">✓</span><div><strong>阶段冲突：未发现冲突</strong></div></div>
    <button class="btn student-stage-conflict-refresh" type="button">重新检查</button>
  </section>`;
  return `<section class="student-stage-conflict-banner student-stage-conflict-check warning" data-status="warning" role="status" aria-live="polite">
    <div><span class="student-stage-conflict-icon" aria-hidden="true">!</span><div><strong>发现 ${studentCount} 名学生存在年级阶段时间冲突</strong><span class="student-stage-conflict-chip">阶段冲突 ${studentGradeStageConflicts.length}</span></div></div>
    <div class="student-stage-conflict-actions"><button class="btn danger student-stage-conflict-view" type="button">查看冲突</button><button class="btn student-stage-conflict-refresh" type="button">重新检查</button></div>
  </section>`;
}

function studentStageConflictModalMarkup() {
  if (!studentGradeStageConflictModalOpen) return "";
  return `<div class="modal-backdrop student-stage-conflict-modal"><div class="modal-panel student-stage-conflict-panel" role="dialog" aria-modal="true" aria-labelledby="student-stage-conflict-title">
    <div class="modal-head"><div><div class="modal-title" id="student-stage-conflict-title">年级阶段时间冲突</div><div class="modal-subtitle">共 ${studentGradeStageConflicts.length} 组冲突；日期端点相同也视为重叠。</div></div><button class="btn student-stage-conflict-close" type="button">关闭</button></div>
    <div class="student-stage-conflict-list">${studentGradeStageConflicts.map((conflict) => `<article class="student-stage-conflict-record">
      <div class="student-stage-conflict-record-head"><strong>${escapeHtml(conflict.student_name || "未命名学生")}</strong><span>${escapeHtml(conflict.current_grade || "未设置")}</span></div>
      <p>${escapeHtml(studentStageConflictSummary(conflict))}</p>
      <dl>
        <div><dt>冲突阶段 A</dt><dd>${escapeHtml(conflict.stage_a)} · ${escapeHtml(conflict.start_a || "未设置")}—${escapeHtml(conflict.end_a || "长期")}</dd></div>
        <div><dt>冲突阶段 B</dt><dd>${escapeHtml(conflict.stage_b)} · ${escapeHtml(conflict.start_b || "未设置")}—${escapeHtml(conflict.end_b || "长期")}</dd></div>
        <div><dt>实际重叠</dt><dd>${escapeHtml(conflict.overlap_start || "-")}—${escapeHtml(conflict.overlap_end || "-")}</dd></div>
        <div><dt>原因</dt><dd>${escapeHtml(conflict.reason || "阶段时间重叠")}</dd></div>
      </dl>
      <button class="btn primary student-stage-conflict-edit" type="button" data-student-id="${escapeHtml(conflict.student_id)}" data-stage-a="${escapeHtml(conflict.stage_a)}" data-stage-b="${escapeHtml(conflict.stage_b)}">修改该学生</button>
    </article>`).join("")}</div>
  </div></div>`;
}

function studentGradeStageDraftFor(row = {}) {
  const map = studentGradeStageMap(row);
  const stages = Object.fromEntries(gradeSortOrder.map((stage) => {
    const item = map.get(stage) || {};
    return [stage, {
      start_date: item.start_date || "",
      end_date: stage === "已毕业" ? "" : item.end_date || "",
    }];
  }));
  return {
    student_id: Number(row.id),
    student_name: row.name || "",
    fallback_grade: row.grade || "未设置",
    current_grade: studentCurrentGrade(row),
    stages,
    original_stages: structuredClone(stages),
  };
}

function collectStudentGradeStageModalDraft(modal) {
  if (!studentGradeStageModalDraft || !modal) return studentGradeStageModalDraft;
  modal.querySelectorAll(".student-grade-stage-field").forEach((input) => {
    const stage = input.dataset.stage;
    const field = input.dataset.field;
    if (!studentGradeStageModalDraft.stages?.[stage] || !field) return;
    studentGradeStageModalDraft.stages[stage][field] = String(input.value || "").trim();
  });
  return studentGradeStageModalDraft;
}

function studentGradeStageModalRows(draft) {
  return gradeSortOrder.map((stage) => {
    const item = draft.stages?.[stage] || { start_date: "", end_date: "" };
    const isGraduated = stage === "已毕业";
    const disabled = isReadonlyUser() ? "disabled" : "";
    const conflict = (draft.conflict_stages || []).includes(stage);
    return `
      <section class="student-stage-card ${conflict ? "student-stage-card-conflict" : ""}" data-stage="${escapeHtml(stage)}">
        <div class="student-stage-name">${escapeHtml(stage)}</div>
        <label>
          <span>起始日期</span>
          <input class="control student-grade-stage-field ${conflict ? "student-grade-stage-field-conflict" : ""}" type="date" data-date-kind="single" data-stage="${escapeHtml(stage)}" data-field="start_date" value="${escapeHtml(item.start_date || "")}" ${disabled}>
        </label>
        ${isGraduated ? "" : `<label>
          <span>截止日期</span>
          <input class="control student-grade-stage-field ${conflict ? "student-grade-stage-field-conflict" : ""}" type="date" data-date-kind="single" data-stage="${escapeHtml(stage)}" data-field="end_date" value="${escapeHtml(item.end_date || "")}" ${disabled}>
        </label>`}
        ${conflict ? `<div class="student-stage-field-error">此阶段与另一阶段时间重叠，请核对起止日期。</div>` : ""}
      </section>
    `;
  }).join("");
}

function studentGradeStageModalMarkup() {
  const draft = studentGradeStageModalDraft;
  if (!draft) return "";
  const saveDisabled = isReadonlyUser() ? `disabled title="${escapeHtml(READONLY_WRITE_MESSAGE)}"` : "";
  return `
    <div class="modal-backdrop student-grade-stage-modal">
      <div class="modal-panel student-grade-stage-panel" role="dialog" aria-modal="true" aria-labelledby="student-grade-stage-modal-title">
        <div class="modal-head student-grade-stage-modal-head">
          <div>
            <div class="modal-title" id="student-grade-stage-modal-title">${escapeHtml(draft.student_name)} · 年级阶段</div>
            <div class="modal-subtitle">当前年级按今天日期自动判断；未命中阶段时回退档案年级“${escapeHtml(draft.fallback_grade)}”。</div>
          </div>
          <button class="btn student-grade-stage-cancel" type="button">关闭</button>
        </div>
        <div class="student-grade-stage-modal-body">
          <div class="student-grade-stage-current">当前显示：${renderGradeBadge(draft.current_grade || draft.fallback_grade)}</div>
          <div class="student-stage-grid">${studentGradeStageModalRows(draft)}</div>
        </div>
        <div class="modal-actions student-grade-stage-modal-actions">
          <button class="btn student-grade-stage-cancel" type="button">取消</button>
          <button class="btn primary student-grade-stage-save" type="button" ${saveDisabled}>保存</button>
        </div>
      </div>
    </div>
  `;
}

function openStudentGradeStageModal(studentId, options = {}) {
  const row = (state.profile_students || []).find((item) => Number(item.id) === Number(studentId));
  const region = document.querySelector(".student-grade-stage-modal-region");
  if (!row || !region) return;
  closeSearchablePicker();
  studentGradeStageTrigger = options.trigger || document.activeElement;
  studentGradeStageModalDraft = { ...studentGradeStageDraftFor(row), conflict_stages: uniqueSorted([...(options.stages || []), ...studentStageConflictsFor(studentId).flatMap((item) => [item.stage_a, item.stage_b])]) };
  region.innerHTML = studentGradeStageModalMarkup();
  document.body.classList.add("student-grade-stage-modal-open");
  enhanceCustomDateInputs();
  applyReadonlyUi();
  const targetStage = options.stage || studentGradeStageModalDraft.conflict_stages[0];
  requestAnimationFrame(() => {
    const target = targetStage ? region.querySelector(`.student-stage-card[data-stage="${selectorEscape(targetStage)}"]`) : null;
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    (target?.querySelector("input") || region.querySelector(".student-grade-stage-cancel"))?.focus();
  });
}

function closeStudentGradeStageModal() {
  closeSearchablePicker();
  studentGradeStageModalDraft = null;
  document.querySelector(".student-grade-stage-modal-region")?.replaceChildren();
  document.body.classList.remove("student-grade-stage-modal-open");
  if (studentGradeStageTrigger?.isConnected) studentGradeStageTrigger.focus();
  studentGradeStageTrigger = null;
  studentGradeStageReturnView = "";
}

async function saveStudentGradeStageModal(button) {
  if (!studentGradeStageModalDraft || isReadonlyUser() || button.disabled) return;
  const modal = button.closest(".student-grade-stage-modal");
  const draft = collectStudentGradeStageModalDraft(modal);
  const stages = gradeSortOrder.map((stage) => ({
    stage,
    start_date: draft.stages?.[stage]?.start_date || "",
    end_date: stage === "已毕业" ? "" : draft.stages?.[stage]?.end_date || "",
  })).filter((item) => {
    const original = draft.original_stages?.[item.stage] || { start_date: "", end_date: "" };
    return item.start_date !== original.start_date || item.end_date !== original.end_date;
  });
  if (!stages.length) {
    closeStudentGradeStageModal();
    showToast("年级阶段没有变化");
    return;
  }
  for (const item of stages) {
    if (item.start_date && !isDateValue(item.start_date)) return showToast(`${item.stage}起始日期格式不正确`, "error");
    if (item.end_date && !isDateValue(item.end_date)) return showToast(`${item.stage}截止日期格式不正确`, "error");
    if (item.stage !== "已毕业" && item.start_date && item.end_date && item.start_date > item.end_date) return showToast(`${item.stage}起始日期不能晚于截止日期`, "error");
  }
  button.disabled = true;
  try {
    const result = await request("/api/student-grade-stages", {
      method: "PUT",
      body: { student_name: draft.student_name, stages },
    });
    if (result.student) {
      patchProfileState("students", result.student);
      const row = document.querySelector(`.student-profile-main-row[data-id="${selectorEscape(result.student.id)}"]`);
      const currentGrade = studentCurrentGrade(result.student);
      if (row) {
        const nameCell = row.querySelector(".student-name-cell");
        const gradeCell = row.querySelector(".current-grade-cell");
        if (nameCell) nameCell.innerHTML = renderStudentBadge(result.student.name, { grade: currentGrade });
        if (gradeCell) gradeCell.innerHTML = renderGradeBadge(currentGrade);
      }
    }
    await refreshStudentGradeStageConflicts({ renderStatus: false });
    const returnView = studentGradeStageReturnView;
    closeStudentGradeStageModal();
    showToast("年级阶段已保存");
    if (returnView === "audit") {
      setActiveView("audit");
      await refreshBackupData({ tolerateFailure: true });
      render();
    } else {
      rerenderContent(() => renderProfileDirectory("students"));
    }
  } catch (error) {
    button.disabled = false;
    const conflicts = error.data?.conflicts || [];
    if (error.data?.code === "STUDENT_GRADE_STAGE_OVERLAP" && conflicts.length) {
      studentGradeStageModalDraft.conflict_stages = uniqueSorted(conflicts.flatMap((item) => [item.stage_a, item.stage_b]));
      const region = document.querySelector(".student-grade-stage-modal-region");
      if (region) {
        region.innerHTML = studentGradeStageModalMarkup();
        enhanceCustomDateInputs();
        const first = conflicts[0];
        requestAnimationFrame(() => region.querySelector(`.student-stage-card[data-stage="${selectorEscape(first.stage_a)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
      }
      showToast(`${studentStageConflictSummary(conflicts[0])}`, "error");
    } else showToast(error.message || "保存失败", "error");
  }
}

function studentProfileTableRowMarkup(row) {
  const currentGrade = studentCurrentGrade(row);
  const conflicts = studentStageConflictsFor(row.id);
  const conflictMarker = conflicts.length ? `<button class="student-stage-conflict-marker" type="button" data-student-id="${escapeHtml(row.id)}" data-stage="${escapeHtml(conflicts[0].stage_a)}" title="${escapeHtml(studentStageConflictSummary(conflicts[0]))}">阶段冲突${conflicts.length > 1 ? ` ${conflicts.length}` : ""}</button>` : "";
  return `
    <tr class="profile-row student-profile-main-row" data-kind="students" data-id="${row.id}" title="点击查看年级阶段">
      <td class="select-col"><input class="student-profile-select-row" type="checkbox" data-id="${escapeHtml(row.id)}" ${selectedStudentProfileIds.has(Number(row.id)) ? "checked" : ""} aria-label="选择学生档案"></td>
      <td class="student-name-cell"><div class="student-name-with-conflict">${renderStudentBadge(row.name, { grade: currentGrade })}${conflictMarker}</div></td>
      <td class="text-cell center current-grade-cell">${renderGradeBadge(currentGrade)}</td>
      <td><input class="cell-input profile-field" data-field="guardian" value="${escapeHtml(row.guardian || "")}"></td>
      <td><input class="cell-input profile-field" data-field="phone" value="${escapeHtml(row.phone || "")}"></td>
      <td><select class="cell-select profile-field inline-status-select profile-inline-status" data-field="status" data-original-value="${escapeHtml(row.status || "在读")}">${options(studentStatusOptions, row.status || "在读")}</select></td>
      <td><input class="cell-input profile-field" data-field="joined_at" type="date" data-date-kind="single" value="${escapeHtml(profileDateValue(row))}"></td>
      <td><input class="cell-input profile-field" data-field="left_at" type="date" data-date-kind="single" value="${escapeHtml(row.left_at || "")}"></td>
      <td class="profile-notes-col"><input class="cell-input wide profile-field" data-field="notes" value="${escapeHtml(row.notes || "")}"></td>
    </tr>
  `;
}

function studentProfileTableRows(rows) {
  return rows.map(studentProfileTableRowMarkup).join("");
}

function revealStudentProfileConflictTarget(studentId) {
  const row = (state.profile_students || []).find((item) => Number(item.id) === Number(studentId));
  if (!row) return null;
  if (row.status && row.status !== "在读") {
    includeInactive = true;
    localStorage.setItem("liming:include-inactive", "1");
  }
  if (!profileRows("students").some((item) => Number(item.id) === Number(studentId))) {
    profileNameFilter = { ...profileNameFilter, students: "" };
    profileKeywordFilter = { ...profileKeywordFilter, students: "" };
    profileGradeFilter = { ...profileGradeFilter, students: "" };
    profileStatusFilter = { ...profileStatusFilter, students: "" };
    localStorage.setItem("liming:profile-status-filter", JSON.stringify(profileStatusFilter));
  }
  return row;
}

function studentGradeStageBatchModal() {
  if (!studentGradeStageBatchModalOpen) return "";
  const stage = studentGradeStageBatchDraft.stage || "初一";
  const isGraduated = stage === "已毕业";
  return `
    <div class="modal-backdrop student-stage-batch-modal">
      <div class="modal-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">批量修改界定时间</div>
            <div class="modal-subtitle">将为已勾选的 ${selectedStudentProfileIds.size} 名学生写入同一个阶段，不影响其他阶段。</div>
          </div>
          <button class="btn student-stage-batch-cancel" type="button">取消</button>
        </div>
        <div class="profile-form">
          <label>阶段<select class="control student-stage-batch-field" data-field="stage">${options(gradeSortOrder, stage)}</select></label>
          <label>起始日期<input class="control student-stage-batch-field" data-field="start_date" type="date" data-date-kind="single" value="${escapeHtml(studentGradeStageBatchDraft.start_date || "")}"></label>
          <label class="${isGraduated ? "hidden" : ""}">截止日期<input class="control student-stage-batch-field" data-field="end_date" type="date" data-date-kind="single" value="${escapeHtml(isGraduated ? "" : studentGradeStageBatchDraft.end_date || "")}"></label>
        </div>
        <div class="modal-actions">
          <button class="btn student-stage-batch-cancel" type="button">取消</button>
          <button class="btn primary student-stage-batch-save" type="button">保存</button>
        </div>
      </div>
    </div>
  `;
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
  const sourceRows = kind === "teachers" ? (state.profile_teachers || []) : (state.profile_students || []);
  const rows = profileRows(kind);
  const isTeacher = kind === "teachers";
  if (isTeacher) {
    const rowIds = new Set(rows.map((row) => Number(row.id)).filter(Boolean));
    selectedTeacherProfileIds = new Set([...selectedTeacherProfileIds].filter((id) => rowIds.has(Number(id))));
  } else {
    const rowIds = new Set(rows.map((row) => Number(row.id)).filter(Boolean));
    selectedStudentProfileIds = new Set([...selectedStudentProfileIds].filter((id) => rowIds.has(Number(id))));
  }
  const selectedTeacherVisibleCount = isTeacher
    ? rows.filter((row) => selectedTeacherProfileIds.has(Number(row.id))).length
    : 0;
  const selectedStudentVisibleCount = !isTeacher
    ? rows.filter((row) => selectedStudentProfileIds.has(Number(row.id))).length
    : 0;
  const allVisibleTeachersSelected = isTeacher && rows.length > 0 && selectedTeacherVisibleCount === rows.length;
  const allVisibleStudentsSelected = !isTeacher && rows.length > 0 && selectedStudentVisibleCount === rows.length;
  const statusValues = isTeacher ? ["在职", "离职", "暂停"] : studentStatusOptions;
  renderTopbar(isTeacher ? "老师档案" : "学生档案", `${rows.length} 条`, historyToggleAction());
  const teacherTable = `
    <table class="profile-table teacher-profile-table uniform-table nowrap-table" data-adaptive-table="true">
      <colgroup><col data-column-type="select"><col data-column-type="name"><col data-column-type="phone"><col data-column-type="status"><col data-column-type="date"><col data-column-type="date"><col data-column-type="long"></colgroup>
      <thead><tr><th class="select-col"><input class="teacher-profile-select-all" type="checkbox" ${allVisibleTeachersSelected ? "checked" : ""} ${rows.length ? "" : "disabled"} aria-label="全选当前老师档案"></th><th>姓名</th><th>电话</th><th>状态</th><th>入职日期</th><th>离职日期</th><th class="wide profile-notes-col">备注</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr class="profile-row" data-kind="teachers" data-id="${row.id}">
            <td class="select-col"><input class="teacher-profile-select-row" type="checkbox" data-id="${escapeHtml(row.id)}" ${selectedTeacherProfileIds.has(Number(row.id)) ? "checked" : ""} aria-label="选择老师档案"></td>
            <td><input class="cell-input profile-field" data-field="name" value="${escapeHtml(row.name)}"></td>
            <td><input class="cell-input profile-field" data-field="phone" value="${escapeHtml(row.phone || "")}"></td>
            <td><select class="cell-select profile-field inline-status-select profile-inline-status" data-field="status" data-original-value="${escapeHtml(row.status || "在职")}">${options(["在职", "离职", "暂停"], row.status || "在职")}</select></td>
          <td><input class="cell-input profile-field" data-date-kind="single" data-field="joined_at" type="date" value="${escapeHtml(profileDateValue(row))}"></td>
          <td><input class="cell-input profile-field" data-date-kind="single" data-field="left_at" type="date" value="${escapeHtml(row.left_at || "")}"></td>
            <td class="profile-notes-col"><textarea class="cell-input adaptive-textarea wide profile-field" data-field="notes" rows="1" wrap="soft">${escapeHtml(row.notes || "")}</textarea></td>
          </tr>
        `).join("") || `<tr><td colspan="7" class="empty">暂无老师档案</td></tr>`}
      </tbody>
    </table>
  `;
  const studentTable = `
    <table class="profile-table student-profile-table uniform-table nowrap-table">
      <colgroup>
        <col class="student-profile-col-select">
        <col class="student-profile-col-name">
        <col class="student-profile-col-grade">
        <col class="student-profile-col-guardian">
        <col class="student-profile-col-phone">
        <col class="student-profile-col-status">
        <col class="student-profile-col-date">
        <col class="student-profile-col-date">
        <col class="student-profile-col-notes">
      </colgroup>
      <thead><tr><th class="select-col"><input class="student-profile-select-all" type="checkbox" ${allVisibleStudentsSelected ? "checked" : ""} ${rows.length ? "" : "disabled"} aria-label="全选当前学生档案"></th><th class="student-name-head">姓名</th><th>当前年级</th><th>监护人</th><th>电话</th><th>状态</th><th>入学日期</th><th>离校日期</th><th class="wide profile-notes-col">备注</th></tr></thead>
      <tbody>
        ${studentProfileTableRows(rows) || `<tr><td colspan="9" class="empty">暂无学生档案</td></tr>`}
      </tbody>
    </table>
  `;
  contentEl.innerHTML = `
    ${isTeacher ? "" : studentStageConflictBannerMarkup()}
    <div class="band profile-panel">
      <div class="filter-bar compact unified-filter-bar profile-filter-bar">
        <div class="filter-controls">
          ${unifiedFilterField({ label: isTeacher ? "教师" : "学生", className: "profile-name-filter", field: isTeacher ? "teacher" : "student", value: profileNameFilter[kind] || "", values: uniqueSorted(sourceRows.map((row) => row.name)) })}
          ${isTeacher ? "" : unifiedFilterField({ label: "年级", className: "profile-grade-filter", field: "grade", value: profileGradeFilter.students || "", values: uniqueSorted(sourceRows.map((row) => row.grade)) })}
          ${unifiedFilterField({ label: "状态", className: "profile-status-filter", field: "status", value: profileStatusFilter[kind] || "", values: statusValues })}
          ${isTeacher ? `<label class="filter-field"><span>关键字</span>${textFilterControl({ className: "profile-keyword-filter", field: "q", value: profileKeywordFilter[kind] || "", placeholder: "电话、日期或备注" })}</label>` : ""}
        </div>
        <div class="filter-summary"><span>已筛选 <b>${rows.length}</b> / 共 ${sourceRows.length} 条</span><button class="btn reset-profile-filter" type="button">清空筛选</button></div>
      </div>
      <div class="profile-actions profile-toolbar">
        ${isTeacher ? "" : `<button class="btn primary open-student-stage-batch" type="button" ${bulkActionDisabledAttr(selectedStudentProfileIds.size)}>${bulkActionText("批量修改界定时间", selectedStudentProfileIds.size)}</button>`}
        ${isTeacher ? "" : `<button class="btn danger batch-delete-student-profiles" type="button" ${bulkActionDisabledAttr(selectedStudentProfileIds.size)}>${bulkActionText("批量删除", selectedStudentProfileIds.size)}</button>`}
        ${isTeacher ? `<button class="btn danger batch-delete-teacher-profiles" type="button" ${bulkActionDisabledAttr(selectedTeacherProfileIds.size)}>${bulkActionText("批量删除", selectedTeacherProfileIds.size)}</button>` : ""}
        <button class="btn backfill-profile-joined-at" type="button" data-kind="${kind}">${isTeacher ? "补齐入职日期" : "补齐入学日期"}</button>
        <button class="btn primary new-profile" type="button" data-kind="${kind}">+ 新增${isTeacher ? "老师" : "学生"}</button>
      </div>
      <div class="table-wrap">
        ${isTeacher ? teacherTable : studentTable}
      </div>
    </div>
    ${profileModalMarkup()}
    ${studentGradeStageBatchModal()}
    ${isTeacher ? "" : studentStageConflictModalMarkup()}
    <div class="student-grade-stage-modal-region">${isTeacher ? "" : studentGradeStageModalMarkup()}</div>
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
          <label>基础工资<input class="control money-input staff-modal-field" data-field="base_salary" type="number" value="0"></label>
          <label>计薪方式<select class="control staff-modal-field" data-field="pay_type">${options(["月薪", "日薪"], "月薪")}</select></label>
          <label>日薪单价<input class="control money-input staff-modal-field" data-field="daily_rate" type="number" value="0"></label>
          <label>标准天数<input class="control staff-modal-field" data-field="standard_work_days" type="number" value="26"></label>
          <label>手机<input class="control staff-modal-field" data-field="phone" placeholder="联系电话"></label>
          <label>状态<select class="control staff-modal-field" data-field="status">${options(["在职", "暂停", "离职"], "在职")}</select></label>
        <label>入职日期<input class="control staff-modal-field" data-date-kind="single" data-field="joined_at" type="date"></label>
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
            <td><input class="cell-input staff-field" data-date-kind="single" data-field="joined_at" type="date" value="${escapeHtml(row.joined_at || "")}"></td>
            <td><input class="cell-input staff-field" data-date-kind="single" data-field="left_at" type="date" value="${escapeHtml(row.left_at || "")}"></td>
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
        <label>日期<input class="control expense-modal-field" data-date-kind="single" data-field="expense_date" type="date" value="${todayDate()}"></label>
          <label>类别<input class="control expense-modal-field" data-field="category" list="expense-category-list" value="其他"></label>
          <label>金额<input class="control money-input expense-modal-field" data-field="amount" type="number" placeholder="0"></label>
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
            <td><input class="cell-input expense-field" data-date-kind="single" data-field="expense_date" type="date" value="${escapeHtml(row.expense_date)}"></td>
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
  if (operationLogFilter.result_status) params.set("result_status", operationLogFilter.result_status);
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

  const operationTypes = operationLogData.operation_types || [];

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
              ${operationTypes.map((type) => `<option value="${escapeHtml(type)}" ${operationLogFilter.operation_type === type ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}
            </select>
          </label>
          <label class="filter-field">
            <span>操作结果</span>
            <select class="control operation-log-filter" data-field="result_status">
              <option value="">全部结果</option>
              <option value="success" ${operationLogFilter.result_status === "success" ? "selected" : ""}>成功</option>
              <option value="failure" ${operationLogFilter.result_status === "failure" ? "selected" : ""}>失败</option>
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
        <table class="operation-log-table uniform-table">
          <thead>
            <tr>
              <th>操作人</th>
              <th>操作账号</th>
              <th>操作类型</th>
              <th>操作内容</th>
              <th>结果</th>
              <th>操作时间</th>
            </tr>
          </thead>
          <tbody>
            ${operationLogData.items.map((log) => `
              <tr>
                <td class="text-cell">${escapeHtml(log.operator_name)}</td>
                <td class="text-cell">${escapeHtml(log.operator_account)}</td>
                <td class="text-cell">${escapeHtml(log.operation_type)}</td>
                <td class="text-cell operation-log-content">${escapeHtml(log.display_content || log.operation_content)}</td>
                <td class="text-cell"><span class="operation-result-badge ${log.result_status === "failure" ? "failure" : "success"}">${log.result_status === "failure" ? "失败" : "成功"}</span></td>
                <td class="text-cell">${escapeHtml(formatBeijingTime(log.created_at))}</td>
              </tr>
            `).join("") || `<tr><td colspan="6" class="empty">暂无操作日志</td></tr>`}
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
    operationLogFilter = { operator_name: "", operator_account: "", operation_type: "", result_status: "", content: "", start_date: "", end_date: "" };
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
  const disabled = canWriteData() ? "" : "disabled";
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
              ${weeks.map((week) => `<th>${teacherTravelHeaderMarkup(week)}</th>`).join("")}
              <th>薪资合计</th>
              <th class="wide">备注</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="teacher-salary-summary-row" data-teacher-name="${escapeHtml(row.teacher_name)}">
                <td class="text-cell">${escapeHtml(row.teacher_name)}</td>
                <td class="text-cell right">${row.lesson_count}</td>
                <td class="text-cell right">${formatMoney(row.salary_total)}</td>
                ${weeks.map((week) => `<td class="text-cell right">${formatMoney(teacherTravelAmount(row, week))}</td>`).join("")}
                <td class="text-cell right">${formatMoney(row.total_salary)}</td>
                <td><input class="cell-input wide teacher-salary-notes-field" data-field="notes" value="${escapeHtml(row.notes || "")}" ${disabled}></td>
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
  const names = uniqueSorted((state.derived.teacher_summary || []).map((row) => row.teacher_name).filter(Boolean));
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
              ${weeks.map((week) => `<th>${teacherTravelHeaderMarkup(week)}</th>`).join("")}
              <th>合计</th>
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
              </tr>
            `).join("") || `<tr><td colspan="${weeks.length + 2}" class="empty">暂无老师档案</td></tr>`}
            ${rows.length ? `
              <tr>
                <td class="text-cell"><b>合计</b></td>
                ${weeks.map((week) => `<td class="text-cell right"><b>${formatMoney(rows.reduce((sum, row) => sum + teacherTravelAmount(row, week), 0))}</b></td>`).join("")}
                <td class="text-cell right"><b>${formatMoney(total)}</b></td>
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
  const visibleRuleIds = new Set(visibleRules.map((rule) => Number(rule.id)));
  selectedTeacherSalaryRuleIds = new Set([...selectedTeacherSalaryRuleIds].filter((id) => visibleRuleIds.has(Number(id))));
  const selectedVisibleCount = visibleRules.filter((rule) => selectedTeacherSalaryRuleIds.has(Number(rule.id))).length;
  const allVisibleSelected = visibleRules.length > 0 && selectedVisibleCount === visibleRules.length;
  const hiddenInactiveCount = sortedRules.filter((rule) => !isActiveTeacherName(rule.teacher_name)).length;
  const modalCandidates = {
    teachers: uniqueSorted((state.profile_teachers || []).map((row) => row.name).filter(Boolean)),
    grades: uniqueSorted([...gradeOrder, ...usedLessonLookupValues("grades")]),
    subjects: uniqueSorted([...(state.lookups.subjects || []), ...usedLessonLookupValues("subjects")]),
    students: uniqueSorted((state.profile_students || []).map((row) => row.name).filter(Boolean)),
  };
  const effectiveCount = rules.filter((rule) => teacherSalaryRuleSalaryStatus(rule) === "已设置").length;
  const pendingCount = rules.length - effectiveCount;
  const sync = teacherSalaryRuleCandidateSync;
  const syncNotice = sync.busy
    ? `<div class="section-subtitle">正在根据历史课程自动补齐薪资规则候选...</div>`
    : sync.error
      ? `<div class="section-subtitle">薪资规则候选同步失败：${escapeHtml(sync.error)}</div>`
      : sync.result
        ? `<div class="section-subtitle">已根据历史课程补齐薪资规则候选：新增 ${sync.result.createdCount || 0} 条，已有 ${sync.result.existingCount || 0} 条，跳过 ${sync.result.skippedCount || 0} 条。</div>`
        : "";
  renderTopbar(
    "薪资规则",
    `有效 ${effectiveCount} 条 / 待设置 ${pendingCount} 条 / 共 ${rules.length} 条`,
  );
  contentEl.innerHTML = `
    <div class="band teacher-salary-rule-page">
      <div class="filter-bar compact unified-filter-bar teacher-salary-rule-toolbar">
        <div class="filter-controls">
          ${unifiedFilterField({ label: "教师", className: "teacher-salary-rule-filter-input", field: "teacher", value: teacherSalaryRuleFilter.teacher, values: opts.teachers })}
          ${unifiedFilterField({ label: "搜索", className: "teacher-salary-rule-filter-input", field: "student", value: teacherSalaryRuleFilter.student, values: opts.students, placeholder: "搜索学生集合" })}
          ${unifiedFilterField({ label: "价格状态", className: "teacher-salary-rule-filter-input", field: "salary_status", value: teacherSalaryRuleFilter.salary_status, values: opts.salaryStatuses, placeholder: "全部价格状态" })}
        </div>
        <label class="history-toggle compact-toggle">
          <input class="teacher-salary-rule-hide-inactive" type="checkbox" ${teacherSalaryRuleHideInactiveTeachers ? "checked" : ""}>
          <span>隐藏离职</span>
        </label>
        <div class="filter-summary">
          <span><b>${visibleRules.length}</b> / ${rules.length} 条${teacherSalaryRuleHideInactiveTeachers && hiddenInactiveCount ? ` · 隐藏 ${hiddenInactiveCount}` : ""}</span>
        </div>
        <div class="teacher-salary-rule-toolbar-actions">
          <span class="batch-selection-summary">已选择 <b>${selectedTeacherSalaryRuleIds.size}</b> 条</span>
          <button class="btn clear-teacher-salary-rule-selection" type="button" ${selectedTeacherSalaryRuleIds.size ? "" : "disabled"}>清空选择</button>
          <button class="btn primary open-teacher-salary-rule-batch-modal" type="button" ${selectedTeacherSalaryRuleIds.size && canWriteData() ? "" : "disabled"}>批量设置薪资</button>
          <button class="btn reset-teacher-salary-rule-filter" type="button">清筛</button>
          <button class="btn primary open-teacher-salary-rule-modal" type="button">+ 新增薪资规则</button>
        </div>
      </div>
      <div class="teacher-salary-rule-actions" role="toolbar" aria-label="薪资规则操作">
        ${syncNotice}
      </div>
      <div class="table-wrap smooth-table-wrap">
        <table class="teacher-salary-rule-table uniform-table nowrap-table" data-adaptive-table="true" data-adaptive-flex-column="8">
          <colgroup><col data-column-type="select"><col data-column-type="name"><col data-column-type="short" data-max-width="120"><col data-column-type="short" data-max-width="120"><col data-column-type="students"><col data-column-type="money"><col data-column-type="status"><col data-column-type="status"><col data-column-type="long"></colgroup>
          <thead><tr><th class="select-col"><input class="teacher-salary-rule-select-all" type="checkbox" ${allVisibleSelected ? "checked" : ""} ${visibleRules.length && canWriteData() ? "" : "disabled"} aria-label="全选当前可见薪资规则"></th><th>老师</th><th>年级</th><th>科目</th><th class="wide">学生集合</th><th>每2小时薪资</th><th>启用</th><th>价格状态</th><th class="wide">备注</th></tr></thead>
          <tbody>
            ${visibleRules.map((rule) => `
              <tr class="teacher-salary-rule-row" data-rule-id="${rule.id}">
                <td class="select-col adaptive-center"><input class="teacher-salary-rule-select-row" type="checkbox" data-id="${escapeHtml(rule.id)}" ${selectedTeacherSalaryRuleIds.has(Number(rule.id)) ? "checked" : ""} ${canWriteData() ? "" : "disabled"} aria-label="选择薪资规则"></td>
                <td class="text-cell adaptive-center">${escapeHtml(rule.teacher_name)}</td>
                <td class="text-cell adaptive-center">${renderEntityBadge("grade", rule.grade)}</td>
                <td class="text-cell adaptive-center">${renderEntityBadge("subject", rule.subject)}</td>
                <td class="text-cell wide student-set-cell adaptive-left">${renderStudentSetBadges(rule.student_names, { fallbackGrade: rule.grade })}</td>
                <td class="currency-input-cell adaptive-right">${currencyInputMarkup(rule.salary_per_unit, { className: "teacher-salary-rule-field", attrs: `data-field="salary_per_unit" min="0" step="0.01"`, inputValue: teacherSalaryInputValue(rule.salary_per_unit) })}</td>
                <td class="text-cell adaptive-center"><input class="teacher-salary-rule-field teacher-salary-rule-active" data-field="is_active" type="checkbox" ${teacherSalaryRuleEnabled(rule) ? "checked" : ""} aria-label="启用薪资规则"></td>
                <td class="text-cell adaptive-center">${visiblePriceStatusBadge(teacherSalaryRuleSalaryStatus(rule))}</td>
                <td class="adaptive-left"><textarea class="cell-input adaptive-textarea wide teacher-salary-rule-field" data-field="notes" rows="1" wrap="soft">${escapeHtml(teacherSalaryRuleDisplayNotes(rule))}</textarea></td>
              </tr>
            `).join("") || `<tr><td colspan="9" class="empty">暂无符合条件的薪资规则</td></tr>`}
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
              <div class="modal-title">新增薪资规则</div>
              <div class="modal-subtitle">学生集合会自动规范化；规则启用后参与匹配，0 元也是有效金额。</div>
            </div>
          </div>
          <div class="lesson-create-form">
            <label>老师${filterComboControl({ id: "new-teacher-salary-rule-teacher", className: "modal-combo-input", field: "teacher", value: "", values: modalCandidates.teachers, placeholder: "输入或选择老师", emptyLabel: "" })}</label>
            <label>年级${filterComboControl({ id: "new-teacher-salary-rule-grade", className: "modal-combo-input", field: "grade", value: "", values: modalCandidates.grades, placeholder: "输入或选择年级", emptyLabel: "" })}</label>
            <label>科目${filterComboControl({ id: "new-teacher-salary-rule-subject", className: "modal-combo-input", field: "subject", value: "", values: modalCandidates.subjects, placeholder: "输入或选择科目", emptyLabel: "" })}</label>
            <label class="wide">学生集合${filterComboControl({ id: "new-teacher-salary-rule-students", className: "modal-combo-input", field: "students", value: "", values: modalCandidates.students, placeholder: "多个学生用顿号分隔", emptyLabel: "" })}</label>
            <label>每2小时薪资<input id="new-teacher-salary-rule-salary" class="control money-input" type="number" min="0" step="0.01" placeholder="可先留空为 0"></label>
            <label class="history-toggle"><input id="new-teacher-salary-rule-active" type="checkbox" checked><span>启用规则</span></label>
            <label class="wide">备注<input id="new-teacher-salary-rule-notes" class="control" placeholder="备注"></label>
          </div>
          <div class="modal-actions">
            <button class="btn" type="button" data-action="close-teacher-salary-rule-modal">取消</button>
            <button class="btn primary add-teacher-salary-rule" type="button">保存</button>
          </div>
        </div>
      </div>
    ` : ""}
    ${teacherSalaryRuleBatchModalOpen ? `
      <div class="modal-backdrop teacher-salary-rule-batch-modal">
        <div class="modal-panel batch-pricing-modal-panel" role="dialog" aria-modal="true" aria-labelledby="teacher-salary-rule-batch-title">
          <div class="modal-head"><div><div class="modal-title" id="teacher-salary-rule-batch-title">批量设置教师薪资</div><div class="modal-subtitle">仅修改已选择 ${selectedTeacherSalaryRuleIds.size} 条规则的薪资，启用状态和其他字段保持不变。</div></div></div>
          <label class="filter-field"><span>每2小时薪资</span><input class="control teacher-salary-rule-batch-value" type="number" min="0" max="100000" step="0.01" value="0"></label>
          <div class="batch-pricing-result" aria-live="polite"></div>
          <div class="modal-actions"><button class="btn close-teacher-salary-rule-batch-modal" type="button">取消</button><button class="btn primary confirm-teacher-salary-rule-batch" type="button">确认更新</button></div>
        </div>
      </div>
    ` : ""}
  `;
}

function teacherSalaryBatchStatusLabel(status) {
  return {
    updated: "已更新",
    unchanged: "无需更新",
    skipped: "已跳过",
    failed: "处理失败",
  }[status] || "处理失败";
}

function teacherSalaryBatchResultMarkup(result) {
  if (!result) return "";
  const selectedCount = Number(result.selected_count || 0);
  const updatedCount = Number(result.updated_count || 0);
  const unchangedCount = Number(result.unchanged_count || 0);
  const skippedCount = Number(result.skipped_count || 0);
  const failedCount = Number(result.failed_count || 0);
  const detailRows = Array.isArray(result.results) ? result.results : [];
  return `
    <div class="teacher-salary-batch-result" role="status">
      <strong>已处理${selectedCount}节课：更新${updatedCount}节，无需更新${unchangedCount}节，跳过${skippedCount}节${failedCount ? `，失败${failedCount}节` : ""}。</strong>
      ${detailRows.length ? `
        <details class="teacher-salary-batch-details">
          <summary>查看详情</summary>
          <div class="table-wrap">
            <table class="course-table uniform-table">
              <thead><tr><th>日期</th><th>教师</th><th>年级</th><th>科目</th><th>学生</th><th>处理结果</th><th>跳过原因</th></tr></thead>
              <tbody>${detailRows.map((item) => `
                <tr>
                  <td>${escapeHtml(item.date || "-")}</td>
                  <td>${escapeHtml(item.teacher_name || "-")}</td>
                  <td>${escapeHtml(item.grade || "-")}</td>
                  <td>${escapeHtml(item.subject || "-")}</td>
                  <td>${escapeHtml(item.student_names || "-")}</td>
                  <td>${escapeHtml(teacherSalaryBatchStatusLabel(item.status))}</td>
                  <td>${escapeHtml(item.reason || "-")}</td>
                </tr>
              `).join("")}</tbody>
            </table>
          </div>
        </details>
      ` : ""}
    </div>
  `;
}

function renderTeacherDetail() {
  const teachers = (state.teacher_detail_teachers || []).map((row) => row.name);
  const monthKey = state?.settings?.month_key || activeMonth;
  const monthRows = sortedLessons().filter((row) => (row.month_key || monthKeyFromDateValue(row.date)) === monthKey);
  const rows = selectedTeacherDetail ? monthRows.filter((row) => row.teacher_name === selectedTeacherDetail) : [];
  const filterOptions = dynamicTeacherDetailFilterOptions(rows);
  const visibleRows = rows.filter((row) => teacherDetailMatchesFilter(row));
  const count = rows.filter(isCompletedLesson).length;
  const showSalary = canView("teacherDetail") || canArea("salary");
  const canUpdateSalary = showSalary && canWriteData() && Boolean(selectedTeacherDetail);
  const salary = rows.reduce((sum, row) => sum + displayTeacherSalaryForLesson(row), 0);
  const selectableRows = canUpdateSalary ? visibleRows : [];
  const selectableIds = new Set(selectableRows.map((row) => Number(row.id)));
  for (const id of [...selectedTeacherSalaryLessonIds]) {
    if (!selectableIds.has(Number(id))) selectedTeacherSalaryLessonIds.delete(Number(id));
  }
  const selectedCount = selectedTeacherSalaryLessonIds.size;
  const allSelected = selectableRows.length > 0 && selectableRows.every((row) => selectedTeacherSalaryLessonIds.has(Number(row.id)));
  renderTopbar(
    `${monthLabel()} 课时明细`,
    selectedTeacherDetail ? (showSalary ? `${selectedTeacherDetail} · 在这里录入课时薪资` : selectedTeacherDetail) : "未选择教师",
    `<button class="btn export-teacher-detail-image" type="button" ${selectedTeacherDetail ? "" : "disabled"}>复制图片</button>`,
  );
  contentEl.innerHTML = `
    <div class="query-head">
        <div class="metric">
          <div class="metric-label">教师姓名</div>
        <div class="metric-value small">${escapeHtml(selectedTeacherDetail || "未选择")}</div>
      </div>
      <div class="metric"><div class="metric-label">有效课时</div><div class="metric-value">${count}</div></div>
      ${showSalary ? `<div class="metric"><div class="metric-label">薪资统计</div><div class="metric-value">${formatMoney(salary)}</div></div>` : ""}
      <div class="metric"><div class="metric-label">课程记录</div><div class="metric-value">${rows.length}</div></div>
    </div>
    <div class="band">
      <div class="filter-bar compact unified-filter-bar">
        <div class="filter-controls">
          ${unifiedFilterField({ label: "教师", className: "teacher-detail-teacher-select", field: "teacher", value: selectedTeacherDetail, values: teachers, placeholder: "请选择教师", emptyLabel: "清空选择", emptyText: "暂无可选择的在职教师" })}
          ${unifiedFilterField({ label: "年级", className: "teacher-detail-filter-input", field: "grade", value: teacherDetailFilter.grade, values: filterOptions.grades })}
          ${unifiedFilterField({ label: "科目", className: "teacher-detail-filter-input", field: "subject", value: teacherDetailFilter.subject, values: filterOptions.subjects })}
          ${unifiedFilterField({ label: "学生", className: "teacher-detail-filter-input", field: "student", value: teacherDetailFilter.student, values: filterOptions.students })}
          ${unifiedFilterField({ label: "薪资状态", className: "teacher-detail-filter-input", field: "source", value: teacherDetailFilter.source, values: filterOptions.sources, placeholder: "全部薪资状态" })}
          ${unifiedFilterField({ label: "规则状态", className: "teacher-detail-filter-input", field: "rule_status", value: teacherDetailFilter.rule_status, values: filterOptions.ruleStatuses, placeholder: "全部规则状态" })}
        </div>
        <div class="filter-summary"><span>已筛选 <b>${visibleRows.length}</b> / 共 ${rows.length} 条</span><button class="btn reset-teacher-detail-filter" type="button">清空筛选</button></div>
      </div>
      ${showSalary ? `
        <div class="teacher-detail-bulkbar">
          <button class="btn primary apply-selected-teacher-salary-rules" type="button" ${bulkActionDisabledAttr(canUpdateSalary ? selectedCount : 0)}>${bulkActionText("按规则更新所选薪资", selectedCount)}</button>
          <span class="section-subtitle">勾选课程后，可批量按当前薪资规则更新教师薪资</span>
        </div>
        ${teacherSalaryBatchResultMarkup(teacherSalaryBatchResult)}
      ` : ""}
      <div class="table-wrap">
        <table class="course-table teacher-detail-table uniform-table nowrap-table">
          <thead><tr>${showSalary ? `<th class="select-col"><input class="teacher-salary-select-all" type="checkbox" ${allSelected ? "checked" : ""} ${selectableRows.length ? "" : "disabled"} title="全选当前可见课程"></th>` : ""}<th>授课老师</th><th>日期</th><th>星期</th><th>时间</th><th>教室</th><th>状态</th><th>年级</th><th>科目</th><th class="wide teacher-detail-students-head">学生</th><th class="wide teacher-detail-notes-head">备注</th>${showSalary ? "<th>教师薪资</th><th>规则薪资</th>" : ""}</tr></thead>
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
                  ${showSalary ? `<td class="teacher-salary-select-cell select-col"><input class="teacher-salary-lesson-select" data-id="${row.id}" type="checkbox" ${selected ? "checked" : ""} ${canUpdateSalary ? "" : "disabled"} title="${escapeHtml(calculated ? "选择后可按规则覆盖当前薪资" : `选择后将返回处理原因：${disabledReason}`)}"></td>` : ""}
                  <td class="text-cell">${escapeHtml(row.teacher_name)}</td><td class="text-cell">${escapeHtml(row.date)}</td><td class="text-cell">${escapeHtml(weekdayCn(row.date))}</td><td class="text-cell">${escapeHtml(row.time_slot)}</td><td class="text-cell">${escapeHtml(row.classroom)}</td><td class="text-cell">${statusBadge(rowStatus(row))}</td><td class="text-cell">${renderEntityBadge("grade", row.grade)}</td><td class="text-cell">${renderEntityBadge("subject", row.subject)}</td><td class="text-cell teacher-detail-students"><span class="entity-badge-list">${splitStudents(row.student_names).map((name) => renderEntityBadge("student", name, { fallbackGrade: row.grade })).join("")}</span></td><td class="text-cell teacher-detail-notes">${escapeHtml(row.notes)}</td>
                  ${showSalary ? `
                    <td class="text-cell right price-cell-wrap teacher-salary-cell" title="${escapeHtml(salaryTitle)}"><span class="price-inline editable-price-inline">${currencyInputMarkup(displayedTeacherSalary, { className: `teacher-detail-salary-field ${sourceLabel === "手动" ? "manual-price" : ""}`, attrs: `data-id="${row.id}" data-field="teacher_salary" step="0.01" placeholder="未填写" title="${escapeHtml(salaryTitle)}" ${isCompletedLesson(row) ? "" : "disabled"}`, inputValue: teacherSalaryInputValue(displayedTeacherSalary) })}${teacherSalarySourceBadge(row)}</span></td>
                    <td class="text-cell right teacher-rule-salary-cell" title="${escapeHtml(ruleTitle)}">${teacherSalaryRuleCellMarkup(row)}</td>
                  ` : ""}
                </tr>
              `;
            }).join("") || `<tr><td colspan="${showSalary ? 13 : 10}" class="empty">${selectedTeacherDetail ? "暂无符合条件的教师课程" : "请先选择教师，再查看课时明细"}</td></tr>`}
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
    ["weekday", "星期"],
    ["time_slot", "时间"],
    ["classroom", "教室"],
    ["status", "状态"],
    ["grade", "年级"],
    ["subject", "科目"],
    ["student_names", "学生"],
  ];
  return columns;
}

function renderCourseNoticePreview(item, mode = "parent", title = "课程通知") {
  const rows = item.lessons || [];
  const columns = courseNoticeColumns(mode);
  const identityMarkup = courseNoticeIdentityMarkup(item, mode, { includeRecipientSummary: false });
  return `
    <div class="notice-shot-preview" data-shot-key="${escapeHtml(item.send_object_key)}">
      <div class="notice-shot-shell">
        <div class="notice-shot-head">
          <div class="notice-shot-title">${escapeHtml(title)}</div>
        </div>
        ${identityMarkup ? `<div class="notice-card-identity">${identityMarkup}</div>` : ""}
        <table class="notice-shot-table">
          <thead>
            <tr>
              ${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.map((lesson) => `
              <tr>
                ${columns.map(([key]) => `<td>${courseNoticeCellMarkup(lesson, key)}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function courseNoticeCellValue(row = {}, key = "") {
  if (key === "weekday") return row.weekday || weekdayCn(row.date);
  if (key === "student_names") return row.display_student_names || row.student_names || "";
  if (key === "status") return String(row.status || rowStatus(row) || "").trim();
  return row[key] || "";
}

function courseNoticeCellBadges(row = {}, key = "") {
  const value = String(courseNoticeCellValue(row, key) || "").trim();
  if (!value) return [];
  if (key === "status") return [{ type: "status", label: value }];
  if (key === "grade") return [{ type: "grade", label: value }];
  if (key === "subject") return [{ type: "subject", label: value }];
  if (key === "student_names") return splitStudents(value).map((label) => ({ type: "student", label }));
  return [];
}

function courseNoticeCellMarkup(row = {}, key = "") {
  const badges = courseNoticeCellBadges(row, key);
  if (!badges.length) return escapeHtml(courseNoticeCellValue(row, key));
  return `<span class="entity-badge-list">${badges.map((badge) => renderEntityBadge(badge.type, badge.label, { fallbackGrade: row.grade })).join("")}</span>`;
}

function isPersonalCourseNoticeObject(item = {}) {
  return String(item.send_object_key || "").startsWith("PERSONAL_ALL|");
}

function isMergedClassCourseNoticeObject(item = {}) {
  return item.send_object_type === "班级合并发送" || String(item.send_object_key || "").startsWith("CLASS_MERGED|");
}

function stableUniqueValues(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values.flatMap((item) => Array.isArray(item) ? item : [item])) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function courseNoticeObjectStudents(item = {}) {
  const explicit = splitStudents(item.students || "");
  const lessonStudents = (item.lessons || [])
    .flatMap((lesson) => splitStudents(lesson.display_student_names || lesson.student_names || ""));
  const students = stableUniqueValues(explicit.length ? explicit : lessonStudents);
  if (!isPersonalCourseNoticeObject(item)) return students;
  const objectName = String(item.send_object_name || "").replace(/个人课程$/, "").trim();
  return [students[0] || objectName].filter(Boolean);
}

function courseNoticeObjectGrades(item = {}) {
  return stableUniqueValues([...(item.grades || []), ...(item.lessons || []).map((lesson) => lesson.grade)])
    .sort(compareGradeForSort);
}

function courseNoticeObjectSubjects(item = {}) {
  return uniqueSorted([...(item.subjects || []), ...(item.lessons || []).map((lesson) => lesson.subject)]);
}

function teacherNoticeObjectNames(item = {}) {
  const explicit = stableUniqueValues(item.teachers || []);
  if (explicit.length) return explicit;
  const objectName = String(item.send_object_name || "").replace(/老师课程$/, "").trim();
  return [objectName || "未命名老师"];
}

function courseNoticeIdentityRows(item = {}, mode = "parent", { includeRecipientSummary = true } = {}) {
  const students = courseNoticeObjectStudents(item);
  const grades = courseNoticeObjectGrades(item);
  const subjects = courseNoticeObjectSubjects(item);
  const studentBadges = students.map((label) => ({ type: "student", label }));
  const gradeSubjectBadges = [
    ...grades.map((label) => ({ type: "grade", label })),
    ...subjects.map((label) => ({ type: "subject", label })),
  ];
  if (mode === "teacher") {
    const teacherRow = { key: "teacher", badges: teacherNoticeObjectNames(item).map((label) => ({ type: "teacher", label })) };
    return includeRecipientSummary
      ? [teacherRow, { key: "students", badges: studentBadges }, { key: "grade-subject", badges: gradeSubjectBadges }]
      : [];
  }
  if (!includeRecipientSummary) return [];
  if (isPersonalCourseNoticeObject(item)) {
    return [{ key: "personal", badges: [...studentBadges.slice(0, 1), ...gradeSubjectBadges] }];
  }
  return [
    { key: isMergedClassCourseNoticeObject(item) ? "merged-students" : "class-students", badges: studentBadges },
    { key: "grade-subject", badges: gradeSubjectBadges },
  ];
}

function courseNoticeIdentityBadgeMarkup(badge = {}, fallbackGrade = "") {
  if (badge.type === "teacher") {
    return `<span class="entity-badge teacher-badge">${escapeHtml(badge.label)}</span>`;
  }
  return renderEntityBadge(badge.type, badge.label, { fallbackGrade });
}

function courseNoticeIdentityMarkup(item = {}, mode = "parent", options = {}) {
  const fallbackGrade = courseNoticeObjectGrades(item)[0] || "";
  return courseNoticeIdentityRows(item, mode, options).map((row) => `
    <span class="notice-card-identity-row notice-card-identity-${escapeHtml(row.key)} entity-badge-list">
      ${row.badges.map((badge) => courseNoticeIdentityBadgeMarkup(badge, fallbackGrade)).join("") || '<span class="muted-tip">未设置</span>'}
    </span>
  `).join("");
}

function studentCurrentGrade(row = {}) {
  if (row.current_grade) return row.current_grade;
  const today = todayDate();
  const stages = Array.isArray(row.grade_stages) ? row.grade_stages : [];
  const graduated = stages.find((stage) => stage.stage === "已毕业" && isDateValue(stage.start_date) && stage.start_date <= today);
  if (graduated) return "已毕业";
  for (const grade of gradeOrder) {
    const stage = stages.find((item) => item.stage === grade);
    if (stage && isDateValue(stage.start_date) && isDateValue(stage.end_date) && stage.start_date <= today && today <= stage.end_date) return grade;
  }
  return row.grade || "未设置";
}

function courseNoticeObjectGrade(item = {}) {
  const grades = uniqueSorted([...(item.grades || []), ...(item.lessons || []).map((lesson) => lesson.grade)].filter(Boolean));
  const ordered = grades.find((grade) => gradeOrder.includes(grade));
  if (ordered) return ordered;
  if (isPersonalCourseNoticeObject(item)) {
    const studentName = splitStudents(item.students)[0] || String(item.send_object_name || "").replace(/个人课程$/, "");
    const profile = studentProfileByName(studentName);
    return studentCurrentGrade(profile || {}) || "未设置";
  }
  return grades[0] || "未设置";
}

function groupedCourseNoticeObjects(items = []) {
  const groups = new Map();
  for (const item of items) {
    const grade = courseNoticeObjectGrade(item);
    if (!groups.has(grade)) groups.set(grade, []);
    groups.get(grade).push(item);
  }
  const orderedGrades = [...gradeOrder, ...[...groups.keys()].filter((grade) => !gradeOrder.includes(grade))];
  return orderedGrades
    .filter((grade) => (groups.get(grade) || []).length)
    .map((grade) => [grade, (groups.get(grade) || []).sort((a, b) => String(a.send_object_name || "").localeCompare(String(b.send_object_name || ""), "zh-Hans-CN"))]);
}

function noticeSimpleAction(item = {}, actionStore = {}) {
  const key = item.send_object_key || "";
  if (!actionStore[key]) {
    actionStore[key] = { next: item.completed ? "message" : "image", done: Boolean(item.completed) };
  }
  return actionStore[key];
}

function noticeSimpleStatus(item = {}, actionStore = {}) {
  const action = noticeSimpleAction(item, actionStore);
  if (item.completed || action.done) return "已完成";
  return action.next === "message" ? "待复制文案" : "待复制截图";
}

function noticeSimpleTile(item = {}, {
  actionStore = {},
  meta = "",
  className = "notice-simple-tile",
  details = "",
} = {}) {
  const action = noticeSimpleAction(item, actionStore);
  const done = Boolean(item.completed || action.done);
  return `
    <button class="${escapeHtml(className)} ${done ? "done" : ""}" type="button" data-send-key="${escapeHtml(item.send_object_key)}">
      ${details}
      <span class="notice-simple-state">${escapeHtml(noticeSimpleStatus(item, actionStore))}</span>
      <span class="notice-simple-meta">${escapeHtml(meta || `${Number(item.lesson_count || item.lessons?.length || 0)} 节课`)}</span>
    </button>
  `;
}

function courseNoticeTagGroup(item = {}) {
  const grades = uniqueSorted([...(item.grades || []), ...(item.lessons || []).map((lesson) => lesson.grade)].filter(Boolean));
  const subjects = uniqueSorted([...(item.subjects || []), ...(item.lessons || []).map((lesson) => lesson.subject)].filter(Boolean));
  const badges = [
    ...grades.map((value) => renderEntityBadge("grade", value)),
    ...subjects.map((value) => renderEntityBadge("subject", value)),
  ].join("");
  return badges ? `<span class="notice-course-tag-group entity-badge-list">${badges}</span>` : "";
}

function courseNoticeSimpleDetails(item = {}, mode = "parent") {
  return courseNoticeIdentityMarkup(item, mode);
}

function courseNoticeSimpleAction(item = {}) {
  return noticeSimpleAction(item, courseNoticeSimpleActions);
}

function courseNoticeSimpleStatus(item = {}) {
  return noticeSimpleStatus(item, courseNoticeSimpleActions);
}

function courseNoticeSimpleTile(item = {}) {
  const count = Number(item.lesson_count || item.lessons?.length || 0);
  const objectName = isPersonalCourseNoticeObject(item) ? "" : (item.send_object_name || "");
  return noticeSimpleTile(item, {
    actionStore: courseNoticeSimpleActions,
    meta: `${objectName ? `${objectName} · ` : ""}${count} 节课`,
    details: courseNoticeSimpleDetails(item),
  });
}

function renderCourseNoticeSimpleGroup(title, items = []) {
  const groups = groupedCourseNoticeObjects(items);
  return `
    <section class="notice-simple-panel">
      <div class="notice-simple-panel-head">
        <div class="section-title">${escapeHtml(title)}</div>
        <div class="section-subtitle">${items.length} 个发送对象</div>
      </div>
      ${groups.length ? groups.map(([grade, gradeItems]) => `
        <div class="notice-simple-grade">
          <div class="notice-simple-grade-title">${escapeHtml(grade)}</div>
          <div class="notice-simple-grid">
            ${gradeItems.map(courseNoticeSimpleTile).join("")}
          </div>
        </div>
      `).join("") : `<div class="empty">暂无${escapeHtml(title)}对象</div>`}
    </section>
  `;
}

function renderCourseNoticeSimpleMode(objects = []) {
  const personal = objects.filter((item) => isPersonalCourseNoticeObject(item));
  const mergedClasses = objects.filter((item) => isMergedClassCourseNoticeObject(item));
  const classes = objects.filter((item) => !isPersonalCourseNoticeObject(item) && !isMergedClassCourseNoticeObject(item));
  return `
    <div class="notice-simple-mode">
      ${renderCourseNoticeSimpleGroup("个人发送", personal)}
      ${renderCourseNoticeSimpleGroup("班级发送", classes)}
      ${renderCourseNoticeSimpleGroup("班级合并发送", mergedClasses)}
    </div>
  `;
}

function courseNoticePreviewItemMarkup(item) {
  return `
    <div class="notice-item ${item.completed ? "completed" : ""} ${item.partial_completed ? "partial" : ""}" data-send-key="${escapeHtml(item.send_object_key)}">
      <div class="notice-left">
        ${item.completed ? `<div class="notice-checkmark">✓</div>` : ""}
        <div class="notice-object-head">
          <div>
            <div class="notice-object-name">${escapeHtml(item.send_object_name)}</div>
            <div class="notice-object-meta">
              <span>${escapeHtml(item.send_object_type)}</span>
              <span>老师：${escapeHtml((item.teachers || []).join("、") || "-")}</span>
              ${courseNoticeTagGroup(item) || "-"}
              ${item.student_count ? `<span>人数：${Number(item.student_count)}</span>` : ""}
              <span>${item.lesson_count} 节课</span>
            </div>
          </div>
          ${renderEntityBadge("status", courseNoticeStatusText(item))}
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
  `;
}

function renderCourseNoticePreviewGroup(title, items = []) {
  if (!items.length) return "";
  return `
    <section class="notice-preview-panel">
      <div class="notice-simple-panel-head">
        <div class="section-title">${escapeHtml(title)}</div>
        <div class="section-subtitle">${items.length} 个发送对象</div>
      </div>
      <div class="notice-list">
        ${items.map(courseNoticePreviewItemMarkup).join("")}
      </div>
    </section>
  `;
}

function renderCourseNoticePreviewMode(objects = []) {
  const personal = objects.filter((item) => isPersonalCourseNoticeObject(item));
  const mergedClasses = objects.filter((item) => isMergedClassCourseNoticeObject(item));
  const classes = objects.filter((item) => !isPersonalCourseNoticeObject(item) && !isMergedClassCourseNoticeObject(item));
  if (!objects.length) return `<div class="empty">当前日期范围暂无可发送课程</div>`;
  return `
    <div class="notice-preview-mode">
      ${renderCourseNoticePreviewGroup("个人发送", personal)}
      ${renderCourseNoticePreviewGroup("班级发送", classes)}
      ${renderCourseNoticePreviewGroup("班级合并发送", mergedClasses)}
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
    <div class="filter-bar notice-filter-bar notice-filter-two-row">
      <div class="notice-filter-row notice-filter-primary-row">
        <div class="filter-controls notice-primary-controls">
          <label class="filter-field">
            <span>日期范围</span>
            ${dateRangePickerControl({ scope: "course-notice", start: courseNoticeFilter.start, end: courseNoticeFilter.end, placeholder: "选择课程通知日期范围" })}
          </label>
          <label class="history-toggle">
            <input class="course-notice-only" type="checkbox" ${courseNoticeFilter.onlyTeaching ? "checked" : ""}>
            <span>只选择“已上”</span>
          </label>
          <div class="segmented notice-layout-toggle" role="group" aria-label="家长群截图模式">
            <button class="segmented-btn course-notice-layout-toggle ${courseNoticeLayoutMode === "preview" ? "active" : ""}" type="button" data-layout="preview">详细模式</button>
            <button class="segmented-btn course-notice-layout-toggle ${courseNoticeLayoutMode === "simple" ? "active" : ""}" type="button" data-layout="simple">简洁模式</button>
          </div>
          <button class="btn primary course-notice-generate" type="button">生成课程通知</button>
          <button class="btn danger course-notice-clear-completions" type="button">清除所有打勾记录</button>
        </div>
        <div class="filter-summary">
          <span>已完成对象 <b>${completedObjects}/${objects.length}</b></span>
        </div>
      </div>
      <label class="filter-field notice-tail-field notice-tail-row">
        <span>全局后半句</span>
        <input class="control course-notice-tail" value="${escapeHtml(data?.global_tail || "这是我们本周的上课安排哦[玫瑰]")}">
      </label>
    </div>
    ${courseNoticeState.error ? `<div class="empty">${escapeHtml(courseNoticeState.error)}</div>` : ""}
    ${courseNoticeState.busy ? `<div class="empty">正在生成课程通知...</div>` : ""}
    ${!courseNoticeState.busy && data && courseNoticeLayoutMode === "simple" ? renderCourseNoticeSimpleMode(objects) : ""}
    ${!courseNoticeState.busy && data && courseNoticeLayoutMode !== "simple" ? renderCourseNoticePreviewMode(objects) : ""}
  `;
}

function teacherCourseNoticeSimpleTile(item = {}) {
  return noticeSimpleTile(item, {
    actionStore: teacherCourseNoticeSimpleActions,
    meta: `${Number(item.lesson_count || item.lessons?.length || 0)} 节课`,
    className: "notice-simple-tile teacher-notice-simple-tile",
    details: courseNoticeSimpleDetails(item, "teacher"),
  });
}

function renderTeacherCourseNoticeSimpleMode(objects = []) {
  if (!objects.length) return `<div class="empty">当前日期范围暂无老师课程</div>`;
  return `
    <div class="notice-simple-mode teacher-notice-simple-mode">
      <section class="notice-simple-panel">
        <div class="notice-simple-panel-head">
          <div class="section-title">老师发送</div>
          <div class="section-subtitle">${objects.length} 位老师</div>
        </div>
        <div class="notice-simple-grid">
          ${objects.map(teacherCourseNoticeSimpleTile).join("")}
        </div>
      </section>
    </div>
  `;
}

function teacherCourseNoticePreviewItemMarkup(item = {}) {
  return `
    <div class="notice-item ${item.completed ? "completed" : ""} ${item.partial_completed ? "partial" : ""}" data-send-key="${escapeHtml(item.send_object_key)}">
      <div class="notice-left">
        ${item.completed ? `<div class="notice-checkmark">✓</div>` : ""}
        <div class="notice-object-head">
          <div>
            <div class="notice-object-name">${escapeHtml(item.send_object_name)}</div>
            <div class="notice-object-meta">
              <span>${escapeHtml(item.send_object_type)}</span>
              ${courseNoticeTagGroup(item) || "-"}
              <span>${item.lesson_count} 节课</span>
            </div>
          </div>
          ${renderEntityBadge("status", courseNoticeStatusText(item))}
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
  `;
}

function renderTeacherCourseNoticePreviewMode(objects = []) {
  return `<div class="notice-list">${objects.map(teacherCourseNoticePreviewItemMarkup).join("") || `<div class="empty">当前日期范围暂无老师课程</div>`}</div>`;
}

function teacherCourseNoticeContentMarkup() {
  const data = teacherCourseNoticeState.data;
  const objects = data?.send_objects || [];
  if (teacherCourseNoticeState.error) return `<div class="empty">${escapeHtml(teacherCourseNoticeState.error)}</div>`;
  if (teacherCourseNoticeState.busy) return `<div class="empty">正在生成老师课程通知...</div>`;
  if (!data) return "";
  return teacherCourseNoticeLayoutMode === "simple"
    ? renderTeacherCourseNoticeSimpleMode(objects)
    : renderTeacherCourseNoticePreviewMode(objects);
}

function updateTeacherCourseNoticeModeOnly() {
  if (view !== "teacherCourseNotice" || !document.querySelector(".teacher-course-notice-content")) {
    render();
    return;
  }
  document.querySelectorAll(".teacher-course-notice-layout-toggle").forEach((button) => {
    const active = (button.dataset.layout || "preview") === teacherCourseNoticeLayoutMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const region = document.querySelector(".teacher-course-notice-content");
  if (region) {
    region.innerHTML = teacherCourseNoticeContentMarkup();
    bindTeacherCourseNoticeContentEvents(region);
  }
  applyReadonlyUi();
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
    <div class="filter-bar notice-filter-bar notice-filter-two-row">
      <div class="notice-filter-row notice-filter-primary-row">
        <div class="filter-controls notice-primary-controls">
          <label class="filter-field">
            <span>日期范围</span>
            ${dateRangePickerControl({ scope: "teacher-course-notice", start: teacherCourseNoticeFilter.start, end: teacherCourseNoticeFilter.end, placeholder: "选择老师课程日期范围" })}
          </label>
          <label class="history-toggle">
            <input class="teacher-course-notice-only" type="checkbox" ${teacherCourseNoticeFilter.onlyTeaching ? "checked" : ""}>
            <span>只选择“已上”</span>
          </label>
          <div class="segmented notice-layout-toggle" role="group" aria-label="老师截图模式">
            <button class="segmented-btn teacher-course-notice-layout-toggle ${teacherCourseNoticeLayoutMode === "preview" ? "active" : ""}" type="button" data-layout="preview" aria-pressed="${teacherCourseNoticeLayoutMode === "preview"}">详细模式</button>
            <button class="segmented-btn teacher-course-notice-layout-toggle ${teacherCourseNoticeLayoutMode === "simple" ? "active" : ""}" type="button" data-layout="simple" aria-pressed="${teacherCourseNoticeLayoutMode === "simple"}">简洁模式</button>
          </div>
          <button class="btn primary teacher-course-notice-generate" type="button">生成课程通知</button>
          <button class="btn danger teacher-course-notice-clear-completions" type="button">清除所有打勾记录</button>
        </div>
        <div class="filter-summary">
          <span>已完成对象 <b>${completedObjects}/${objects.length}</b></span>
        </div>
      </div>
      <label class="filter-field notice-tail-field notice-tail-row">
        <span>全局后半句</span>
        <input class="control teacher-course-notice-tail" value="${escapeHtml(data?.global_tail || "这是我们本周的上课安排哦[玫瑰]")}">
      </label>
    </div>
    <div class="teacher-course-notice-content">${teacherCourseNoticeContentMarkup()}</div>
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

function courseNoticeCanvasBadgeColor(badge = {}, row = {}) {
  if (badge.type === "teacher") return { background: cssVar("--brand-soft", "#eaf0f7"), color: cssVar("--brand", "#002147") };
  if (badge.type === "status") return getCourseStatusColor(badge.label);
  if (badge.type === "grade") return getStudentGradeColor(badge.label);
  if (badge.type === "subject") return getSubjectColor(badge.label);
  return getStudentGradeColor(studentGradeForName(badge.label, row.grade));
}

function roundedCanvasRect(ctx, x, y, width, height, radius = 7) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function courseNoticeCanvasBadgeWidth(ctx, badges = []) {
  if (!badges.length) return 0;
  return badges.reduce((sum, badge) => sum + Math.ceil(ctx.measureText(badge.label).width) + 16, 0) + Math.max(0, badges.length - 1) * 6;
}

function drawCourseNoticeCanvasBadges(ctx, badges, row, x, y, width, height) {
  const totalWidth = courseNoticeCanvasBadgeWidth(ctx, badges);
  let badgeX = x + Math.max(8, (width - totalWidth) / 2);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const badge of badges) {
    const badgeWidth = Math.ceil(ctx.measureText(badge.label).width) + 16;
    const badgeHeight = 26;
    const badgeY = y + (height - badgeHeight) / 2;
    const color = courseNoticeCanvasBadgeColor(badge, row);
    ctx.fillStyle = color.background;
    roundedCanvasRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 7);
    ctx.fill();
    ctx.fillStyle = color.color;
    ctx.fillText(badge.label, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2);
    badgeX += badgeWidth + 6;
  }
  ctx.restore();
}

function courseNoticeCanvasBadgeLines(ctx, badges = [], width = 0, wrap = false) {
  if (!badges.length) return [[]];
  if (!wrap) return [badges];
  const lines = [];
  let current = [];
  let currentWidth = 0;
  for (const badge of badges) {
    const badgeWidth = Math.ceil(ctx.measureText(badge.label).width) + 16;
    const nextWidth = currentWidth + (current.length ? 6 : 0) + badgeWidth;
    if (current.length && nextWidth > Math.max(80, width - 16)) {
      lines.push(current);
      current = [badge];
      currentWidth = badgeWidth;
    } else {
      current.push(badge);
      currentWidth = nextWidth;
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

function courseNoticeScreenshotLayout(mode = "parent") {
  return mode === "teacher" ? teacherCourseNoticeLayoutMode : courseNoticeLayoutMode;
}

function courseNoticeCanvas(item, mode = "parent", title = "课程通知", { layoutMode = courseNoticeScreenshotLayout(mode) } = {}) {
  const colors = courseNoticeShotPalette();
  const columns = courseNoticeColumns(mode);
  const rows = item.lessons || [];
  const identityRows = courseNoticeIdentityRows(item, mode, { includeRecipientSummary: layoutMode === "simple" });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = "16px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  const headFont = "700 16px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  ctx.font = font;
  const paddingX = 18;
  const rowHeight = 44;
  const outerPadding = 30;
  const titleHeight = 54;
  const identityRowHeight = 34;
  const colWidths = columns.map(([key, label]) => {
    const maxText = Math.max(
      ctx.measureText(label).width,
      ...rows.map((row) => {
        const badges = courseNoticeCellBadges(row, key);
        return badges.length ? courseNoticeCanvasBadgeWidth(ctx, badges) : ctx.measureText(String(courseNoticeCellValue(row, key))).width;
      }),
    );
    return Math.ceil(Math.max(82, maxText + paddingX * 2));
  });
  const minimumTableWidth = 760;
  const naturalTableWidth = colWidths.reduce((sum, value) => sum + value, 0);
  if (naturalTableWidth < minimumTableWidth) colWidths[colWidths.length - 1] += minimumTableWidth - naturalTableWidth;
  const tableWidth = colWidths.reduce((sum, value) => sum + value, 0);
  const identityLayouts = identityRows.map((identityRow) => ({
    ...identityRow,
    lines: courseNoticeCanvasBadgeLines(
      ctx,
      identityRow.badges,
      tableWidth,
      identityRow.key.includes("students"),
    ),
  }));
  const identityHeight = identityLayouts.length
    ? identityLayouts.reduce((sum, row) => sum + row.lines.length * identityRowHeight, 0) + 12
    : 0;
  const tableHeight = rowHeight * (rows.length + 1);
  const width = tableWidth + outerPadding * 2;
  const height = titleHeight + identityHeight + tableHeight + outerPadding * 2;
  const tableX = outerPadding;
  const tableY = outerPadding + titleHeight + identityHeight;
  const panelX = outerPadding / 2;
  const panelY = outerPadding / 2;
  const panelWidth = width - outerPadding;
  const panelHeight = height - outerPadding;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.dataset.noticeIdentity = JSON.stringify(identityRows);
  canvas.dataset.noticeLayout = layoutMode;
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
  ctx.font = font;
  let identityY = outerPadding + titleHeight + 6;
  identityLayouts.forEach((identityRow) => {
    identityRow.lines.forEach((line) => {
      drawCourseNoticeCanvasBadges(ctx, line, rows[0] || {}, tableX, identityY, tableWidth, identityRowHeight);
      identityY += identityRowHeight;
    });
  });
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
      const badges = courseNoticeCellBadges(row, key);
      if (badges.length) {
        drawCourseNoticeCanvasBadges(ctx, badges, row, x, y, colWidths[index], rowHeight);
      } else {
        ctx.fillStyle = colors.title;
        const value = String(courseNoticeCellValue(row, key));
        ctx.fillText(value, x + colWidths[index] / 2, y + rowHeight / 2);
      }
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

async function downloadCourseNoticeImage(item, mode = "parent", title = "课程通知", notify = true) {
  const canvas = courseNoticeCanvas(item, mode, title);
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `${item.send_object_name || "课程安排"}.png`;
  link.click();
  logClientOperation(mode === "teacher" ? "teacher_notice_download_image" : "parent_notice_download_image", {
    content: `下载${mode === "teacher" ? "老师" : "家长"}课程截图：${item.send_object_name || "课程安排"}`,
    target_type: mode === "teacher" ? "teacher_course_notice" : "course_notice",
    target_id: item.send_object_key || "",
    details: { object_name: item.send_object_name || "", lesson_count: item.lesson_count || item.lessons?.length || 0, filename: link.download },
  });
  if (notify) showToast("课程截图已下载");
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

async function copyCourseNoticeImage(item, mode = "parent", title = "课程通知", endpoint = "/api/course-notice/complete", onCompleted = null) {
  const canvas = courseNoticeCanvas(item, mode, title);
  const blob = await canvasBlob(canvas);
  if (!navigator.clipboard?.write || !window.ClipboardItem) {
    await downloadCourseNoticeImage(item, mode, title, false);
    throw new Error("当前浏览器不支持直接复制图片，已改为下载图片");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  await completeCourseNoticeItem(item, endpoint);
  logClientOperation(mode === "teacher" ? "teacher_notice_copy_image" : "parent_notice_copy_image", {
    content: `复制${mode === "teacher" ? "老师" : "家长"}课程截图：${item.send_object_name || "课程安排"}`,
    target_type: mode === "teacher" ? "teacher_course_notice" : "course_notice",
    target_id: item.send_object_key || "",
    details: { object_name: item.send_object_name || "", lesson_count: item.lesson_count || item.lessons?.length || 0 },
  });
  showToast(`${item.send_object_name} 已完成`);
  if (typeof onCompleted === "function") onCompleted(item);
  else render();
}

function bindTeacherCourseNoticeContentEvents(root = document) {
  root.querySelectorAll(".teacher-notice-greeting").forEach((input) => {
    if (input.dataset.noticeBound === "1") return;
    input.dataset.noticeBound = "1";
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

  root.querySelectorAll(".teacher-notice-copy-message").forEach((button) => {
    if (button.dataset.noticeBound === "1") return;
    button.dataset.noticeBound = "1";
    button.addEventListener("click", async () => {
      const item = findTeacherCourseNoticeObject(button.dataset.sendKey);
      if (!item) return;
      try {
        await navigator.clipboard.writeText(teacherCourseNoticeFullMessage(item));
        logClientOperation("teacher_notice_copy_message", {
          content: `复制老师课程文案：${item.send_object_name || "课程安排"}`,
          target_type: "teacher_course_notice",
          target_id: item.send_object_key || "",
          details: { object_name: item.send_object_name || "", lesson_count: item.lesson_count || item.lessons?.length || 0 },
        });
        showToast("文案已复制");
      } catch (error) {
        showToast(error.message || "复制失败", "error");
      }
    });
  });

  root.querySelectorAll(".teacher-notice-copy-image").forEach((button) => {
    if (button.dataset.noticeBound === "1") return;
    button.dataset.noticeBound = "1";
    button.addEventListener("click", async () => {
      const item = findTeacherCourseNoticeObject(button.dataset.sendKey);
      if (!item) return;
      button.disabled = true;
      try {
        await copyCourseNoticeImage(item, "teacher", "本周课程安排", "/api/teacher-course-notice/complete", updateTeacherCourseNoticeModeOnly);
      } catch (error) {
        showToast(error.message || "复制截图失败", "error");
      } finally {
        button.disabled = false;
      }
    });
  });

  root.querySelectorAll(".teacher-notice-download-image").forEach((button) => {
    if (button.dataset.noticeBound === "1") return;
    button.dataset.noticeBound = "1";
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

  root.querySelectorAll(".teacher-notice-simple-tile").forEach((button) => {
    if (button.dataset.noticeBound === "1") return;
    button.dataset.noticeBound = "1";
    button.addEventListener("click", async () => {
      const item = findTeacherCourseNoticeObject(button.dataset.sendKey);
      if (!item) return;
      const action = noticeSimpleAction(item, teacherCourseNoticeSimpleActions);
      button.disabled = true;
      try {
        if (action.next === "message") {
          await navigator.clipboard.writeText(teacherCourseNoticeFullMessage(item));
          action.done = true;
          action.next = "image";
          showToast("文案已复制");
        } else {
          await copyCourseNoticeImage(item, "teacher", "本周课程安排", "/api/teacher-course-notice/complete", updateTeacherCourseNoticeModeOnly);
          action.next = "message";
          action.done = true;
        }
        updateTeacherCourseNoticeModeOnly();
      } catch (error) {
        showToast(error.message || "操作失败", "error");
      } finally {
        button.disabled = false;
      }
    });
  });
}

function storedJsonArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function dashboardShortcutCatalog() {
  return [
    { key: "studentProfiles", label: "学生档案", view: "studentProfiles", group: "学生管理", icon: NAV_ICONS.students },
    { key: "lessons", label: "课程总表", view: "lessons", group: "教务管理", icon: NAV_ICONS.schedule },
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
  return ["studentProfiles", "lessons", "teacherProfiles", "recharges", "summary", "newLesson", "weekMatrix"]
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

function dashboardTrendChartMarkup(rows = []) {
  const values = rows.map((row) => Number(row.lesson_count || 0));
  if (!rows.length || values.every((value) => value === 0)) {
    return `<div class="dashboard-empty-chart">暂无课程数据</div>`;
  }
  return `<div class="dashboard-trend-chart" role="img" aria-label="课程趋势图"></div>`;
}

function dashboardChartCssValue(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function disposeDashboardTrendChart() {
  dashboardTrendResizeObserver?.disconnect();
  dashboardTrendResizeObserver = null;
  if (dashboardTrendChart && !dashboardTrendChart.isDisposed?.()) dashboardTrendChart.dispose();
  dashboardTrendChart = null;
  dashboardTrendChartElement = null;
}

function initDashboardTrendChart(rows = []) {
  const element = document.querySelector(".dashboard-trend-chart");
  if (!element || !window.echarts) {
    disposeDashboardTrendChart();
    if (element && !window.echarts) element.innerHTML = '<div class="dashboard-empty-chart">图表组件加载失败</div>';
    return;
  }
  if (dashboardTrendChartElement !== element) {
    disposeDashboardTrendChart();
    dashboardTrendChartElement = element;
    dashboardTrendChart = window.echarts.getInstanceByDom(element) || window.echarts.init(element);
    if (window.ResizeObserver) {
      dashboardTrendResizeObserver = new window.ResizeObserver(() => {
        if (dashboardTrendChartElement?.isConnected && dashboardTrendChart && !dashboardTrendChart.isDisposed?.()) dashboardTrendChart.resize();
      });
      dashboardTrendResizeObserver.observe(element);
    }
  }
  const brand = dashboardChartCssValue("--brand", "#2563eb");
  const brandSoft = dashboardChartCssValue("--brand-soft", "#dbeafe");
  const muted = dashboardChartCssValue("--muted", "#64748b");
  const line = dashboardChartCssValue("--line-soft", "#e5e7eb");
  dashboardTrendChart.setOption({
    animation: false,
    grid: { left: 8, right: 8, top: 10, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", appendToBody: true, confine: true },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: rows.map((row) => String(row.date || "").slice(5)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: line } },
      axisLabel: { color: muted, fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      min: 0,
      minInterval: 1,
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { color: muted, fontSize: 11 },
      splitLine: { lineStyle: { color: line, type: "dashed" } },
    },
    series: [{
      name: "课程数量",
      type: "line",
      smooth: 0.24,
      showSymbol: false,
      data: rows.map((row) => Number(row.lesson_count || 0)),
      lineStyle: { color: brand, width: 2 },
      itemStyle: { color: brand },
      areaStyle: { color: brandSoft, opacity: 0.52 },
      emphasis: { disabled: true },
    }],
  }, true);
  dashboardTrendChart.resize();
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

function dashboardCurrentLessonsMarkup(rows = [], statusMessage = "") {
  return `
    <div class="dashboard-current-viewport">
      ${!statusMessage && rows.length ? `
        <div class="dashboard-current-list">
          ${rows.map((row) => {
            const students = splitStudents(row.student_names);
            const shownStudents = students.slice(0, 5);
            const hiddenStudentCount = Math.max(0, students.length - shownStudents.length);
            return `
            <div class="dashboard-current-item">
              <div class="dashboard-current-top">
                <strong title="${escapeHtml(row.teacher_name || "未填老师")}">${escapeHtml(row.teacher_name || "未填老师")}</strong>
                <span title="${escapeHtml(row.time_slot || "未填时间")}">${escapeHtml(row.time_slot || "未填时间")}</span>
              </div>
              <div class="dashboard-current-facts">
                <span class="dashboard-current-fact"><em>教室</em><b title="${escapeHtml(row.classroom || "未填教室")}">${escapeHtml(row.classroom || "未填教室")}</b></span>
                <span class="dashboard-current-fact"><em>年级</em>${renderEntityBadge("grade", row.grade)}</span>
                <span class="dashboard-current-fact"><em>科目</em>${renderEntityBadge("subject", row.subject)}</span>
                <span class="dashboard-current-fact"><em>状态</em>${statusBadge(row.status || "待上")}</span>
              </div>
              <div class="dashboard-current-students" title="${escapeHtml(students.join("、") || "未填学生")}">
                <em>学生</em><span class="entity-badge-list">${shownStudents.map((name) => renderEntityBadge("student", name, { fallbackGrade: row.grade })).join("") || "未填学生"}</span>${hiddenStudentCount ? `<span class="dashboard-current-more">等${hiddenStudentCount}人</span>` : ""}
              </div>
            </div>
          `;
          }).join("")}
        </div>
      ` : `<div class="dashboard-current-empty">${escapeHtml(statusMessage || "当前没有正在上的课程")}</div>`}
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

function renderDashboard({ currentMessage = "", currentSubtitle = "" } = {}) {
  disposeDashboardTrendChart();
  const dashboard = state.dashboard || { todos: [], trend: [], student_pie: { items: [], total: 0 }, teacher_pie: { items: [], total: 0 }, current_lessons: [] };
  const shortcuts = dashboardShortcutCatalog();
  const shortcutMap = new Map(shortcuts.map((item) => [item.key, item]));
  const selectedShortcuts = dashboardSelectedShortcutKeys().map((key) => shortcutMap.get(key)).filter(Boolean);
  renderTopbar("首页");
  contentEl.innerHTML = `
    <div class="dashboard-page">
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
        <section class="band dashboard-current-section">
          <div class="section-head">
            <div>
              <div class="section-title">正在上的课程</div>
              <div class="section-subtitle">${escapeHtml(currentSubtitle || `北京时间 ${dashboard.current_date || ""} ${dashboard.current_time || "--:--"} · 共 ${(dashboard.current_lessons || []).length} 节`)}</div>
            </div>
          </div>
          ${dashboardCurrentLessonsMarkup(dashboard.current_lessons || [], currentMessage)}
        </section>

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
          ${dashboardTrendChartMarkup(dashboard.trend || [])}
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
    ${dashboardShortcutModal()}
  `;
  initDashboardTrendChart(dashboard.trend || []);
}

function applyReadonlyUi() {
  if (!isReadonlyUser()) return;
  const selectors = [
    ".new-month", ".delete-month", ".add-lesson", ".lesson-field", ".delete-lesson", ".batch-delete-lessons", ".batch-complete-lessons",
    ".batch-copy-lessons", ".week-copy-btn", ".schedule-add-btn", ".student-badge-removable", ".lesson-create-confirm", ".lesson-create-field",
    ".lesson-create-manual-field", ".lesson-create-student-existing", ".lesson-create-new-students",
    ".batch-copy-confirm", ".batch-copy-field", ".profile-field", ".delete-profile", ".profile-modal-save",
    ".student-grade-stage-field", ".student-grade-stage-save", ".open-student-stage-batch", ".student-stage-batch-field", ".student-stage-batch-save",
    ".open-user-create-modal", ".create-user", ".new-user-field", ".new-user-teachers", ".user-field", ".user-reset-password", ".user-reset-password-value",
    ".user-access-open", ".user-access-save", ".import-teacher-users", ".sync-teacher-accounts", ".role-edit", ".role-delete", ".role-permission-save",
    ".base-data-add", ".base-data-delete", ".color-config-save", ".color-config-reset", ".color-config-input", ".staff-field", ".delete-staff", ".staff-modal-save",
    ".delete-staff-salary", ".staff-salary-field", ".staff-attendance-field", ".delete-expense", ".expense-field",
    ".pricing-field", ".recharge-field", ".open-recharge-modal", ".add-recharge-record", ".recharge-modal-field", ".recharge-channel-radio", ".batch-delete-recharges", ".opening-balance-field", ".batch-delete-opening-balances", ".student-pricing-field",
    ".class-group-field", ".batch-delete-student-profiles",
    ".teacher-detail-salary-field", ".apply-selected-teacher-salary-rules", ".teacher-adjustment-field", ".teacher-travel-fee-field", ".teacher-salary-notes-field",
    ".batch-delete-teacher-profiles",
    ".course-notice-tail", ".notice-greeting", ".course-notice-clear-completions",
    ".teacher-course-notice-tail", ".teacher-notice-greeting", ".teacher-course-notice-clear-completions",
  ];
  document.querySelectorAll(selectors.join(",")).forEach((element) => {
    element.disabled = true;
    element.title = element.title || READONLY_WRITE_MESSAGE;
    const customButton = element.matches("select")
      ? element.nextElementSibling?.querySelector?.(".custom-select-button")
      : null;
    if (customButton) {
      customButton.disabled = true;
      customButton.setAttribute("aria-disabled", "true");
      customButton.title = customButton.title || READONLY_WRITE_MESSAGE;
    }
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
  if (view === "dashboard" && !permissionError) {
    renderDashboard({
      currentMessage: `课程加载失败：${error?.message || "请稍后重试"}`,
      currentSubtitle: "加载失败",
    });
    applyReadonlyUi();
    wireEvents();
    return;
  }
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
  if (view !== "dashboard") disposeDashboardTrendChart();
  if (view !== "studentProfiles" && studentGradeStageModalDraft) {
    studentGradeStageModalDraft = null;
    document.body.classList.remove("student-grade-stage-modal-open");
  }
  if (view !== "studentProfiles") studentGradeStageConflictModalOpen = false;
  closeSearchablePicker();
  closeRechargeChannelOverlay();
  closeDateRangePicker();
  appEl?.classList.remove("login-mode");
  appEl?.classList.toggle("readonly-mode", isReadonlyUser());
  applySidebarState();
  const previousView = lastRenderedView;
  const viewChanged = previousView && previousView !== view;
  if (view === "audit" && previousView !== "audit") {
    selectedBackupRecordIds.clear();
    backupBatchDeleteDialog = null;
  }
  if (viewChanged) dismissToast();
  const enteringTeacherSalaryRules = view === "teacherSalaryRules" && previousView !== "teacherSalaryRules";
  if (enteringTeacherSalaryRules) resetTeacherSalaryRuleCandidateSync();
  applyUserFilterPreset(view);
  lastRenderedView = view;
  renderNav();
  const renderers = {
    dashboard: renderDashboard,
    lessons: renderLessons,
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
    classGroups: renderClassGroups,
    teacherSalary: renderTeacherSalary,
    teacherTravelFees: renderTeacherTravelFees,
    teacherDetail: renderTeacherDetail,
    teacherSalaryRules: renderTeacherSalaryRules,
  };
  (renderers[view] || renderLessons)();
  applyReadonlyUi();
  wireEvents();
  scheduleAdaptiveTableColumns();
  if (navigationTransitionStartedAt) {
    console.debug("[navigation-performance]", {
      view,
      skeleton_to_data_ms: Math.round(performance.now() - navigationTransitionStartedAt),
    });
    navigationTransitionStartedAt = 0;
  }
  if (viewChanged) {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0 });
      document.querySelector(".main")?.scrollTo?.({ top: 0, left: 0 });
      contentEl.scrollTo?.({ top: 0, left: 0 });
    });
  }
}

function rerenderContent(renderAction) {
  closeSearchablePicker();
  closeDateRangePicker();
  closeRechargeChannelOverlay();
  renderAction();
  cleanupCustomSelectPortals();
  applyReadonlyUi();
  wireEvents();
  scheduleAdaptiveTableColumns();
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
  state.profile_students = sortStudentProfiles(upsertById(state.profile_students || [], {
    ...row,
    status: normalizeStudentStatus(row.status),
  }));
  for (const key of ["studentSummary", "summary", "finance"]) markDirty(key);
}

function patchUserState(row) {
  if (!row || row.id == null) return;
  state.users = upsertById(state.users || [], row).sort(compareUserRow);
  if (Number(row.id) === Number(auth.user?.id)) auth.user = { ...auth.user, ...row };
}

function syncInlineStatusPicker(select, value) {
  if (!select?.isConnected) return;
  select.value = String(value ?? "");
  const wrapper = select.nextElementSibling?.matches?.(".custom-select") ? select.nextElementSibling : null;
  if (wrapper) syncCustomSelect(select, wrapper);
}

function bindInlineStatusPicker(select, { save, onSaved, successMessage = "状态已更新" } = {}) {
  if (!select || select.dataset.inlineStatusBound === "1") return;
  select.dataset.inlineStatusBound = "1";
  select.addEventListener("change", async () => {
    if (select.dataset.inlineStatusSaving === "1" || typeof save !== "function") return;
    const previousValue = select.dataset.originalValue ?? "";
    const nextValue = select.value;
    if (nextValue === previousValue) return;
    select.dataset.inlineStatusSaving = "1";
    select.disabled = true;
    const wrapper = select.nextElementSibling?.matches?.(".custom-select") ? select.nextElementSibling : null;
    const button = wrapper?.querySelector(".custom-select-button");
    if (button) button.disabled = true;
    try {
      const result = await save(nextValue);
      const savedValue = String(result?.status ?? nextValue);
      select.dataset.originalValue = savedValue;
      syncInlineStatusPicker(select, savedValue);
      if (typeof onSaved === "function") await onSaved(result);
      showToast(typeof successMessage === "function" ? successMessage(result) : successMessage);
    } catch (error) {
      syncInlineStatusPicker(select, previousValue);
      showToast(error.message || "状态更新失败，已恢复原值", "error");
    } finally {
      if (select.isConnected) {
        select.dataset.inlineStatusSaving = "0";
        select.disabled = isReadonlyUser();
        if (button?.isConnected) {
          button.disabled = select.disabled;
          button.setAttribute("aria-disabled", select.disabled ? "true" : "false");
        }
      }
    }
  });
}

function bindUserAccountRowEvents(row) {
  if (!row || row.dataset.userAccountRowBound === "true") return;
  row.dataset.userAccountRowBound = "true";
  row.querySelectorAll(".user-field").forEach((input) => {
    if (input.classList.contains("user-inline-status")) return;
    input.addEventListener("change", () => {
      const currentRow = input.closest(".user-row");
      if (!currentRow) return;
      refreshAfter(() => request(`/api/users/${currentRow.dataset.id}`, {
        method: "PATCH",
        body: { [input.dataset.field]: input.value },
      }), async (result) => {
        patchUserState(result);
        if (Number(result.id) === Number(auth.user?.id)) await load();
        else rerenderContent(renderUserAdmin);
      });
    });
  });
  row.querySelectorAll(".user-inline-status").forEach((select) => {
    bindInlineStatusPicker(select, {
      save: (status) => request(`/api/users/${row.dataset.id}`, { method: "PATCH", body: { status } }),
      onSaved: async (result) => {
        patchUserState(result);
        if (Number(result.id) === Number(auth.user?.id)) await load();
      },
      successMessage: "账号状态已更新",
    });
  });
  row.querySelectorAll(".multi-select-value.user-row-teachers").forEach((input) => {
    input.addEventListener("change", () => {
      const currentRow = input.closest(".user-row");
      if (!currentRow) return;
      const teacherNames = normalizeNameList(input.value || "");
      refreshAfter(() => request(`/api/users/${currentRow.dataset.id}`, {
        method: "PATCH",
        body: { teacher_names: teacherNames },
      }), async (result) => {
        patchUserState(result);
        if (Number(result.id) === Number(auth.user?.id)) await load();
        else rerenderContent(renderUserAdmin);
      });
    });
  });
  row.querySelectorAll(".user-reset-password").forEach((button) => {
    button.addEventListener("click", async () => {
      const password = row.querySelector(".user-reset-password-value")?.value || "";
      if (password.length < 6) return alert("新密码至少 6 位");
      await request(`/api/users/${row.dataset.id}/password`, { method: "POST", body: { password } });
      userAdminNotice = "密码已重置。";
      rerenderContent(renderUserAdmin);
    });
  });
  row.querySelectorAll(".user-delete").forEach((button) => {
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
}

async function refreshStudentPricingModule() {
  const data = await loadStudentPricingPage({ force: true });
  state.student_pricing = data.rules || [];
  state.student_pricing_filters = data.filters || {};
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

const TOPBAR_MONTH_INDEPENDENT_VIEWS = new Set([
  "lessons",
  "weekMatrix",
  "courseNotice",
  "teacherCourseNotice",
  "openingBalances",
  "studentQuery",
  "studentProfiles",
  "teacherProfiles",
  "appearance",
  "baseData",
  "pricing",
  "userAdmin",
  "operationLogs",
]);

function syncActiveMonthState(monthKey) {
  if (!monthKey) return;
  activeMonth = monthKey;
  localStorage.setItem("liming:month", activeMonth);
  if (state) {
    state.settings = { ...(state.settings || {}), month_key: activeMonth };
    state.active_month_key = activeMonth;
  }
  document.querySelectorAll(".month-select").forEach((select) => {
    select.value = activeMonth;
  });
}

function captureCurrentScroll() {
  const mainEl = document.querySelector(".main");
  const pricingTable = document.querySelector("#student-pricing-table-wrap");
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    mainTop: mainEl?.scrollTop || 0,
    mainLeft: mainEl?.scrollLeft || 0,
    contentTop: contentEl?.scrollTop || 0,
    contentLeft: contentEl?.scrollLeft || 0,
    pricingTableTop: pricingTable?.scrollTop || 0,
    pricingTableLeft: pricingTable?.scrollLeft || 0,
  };
}

function restoreCurrentScroll(position = {}) {
  requestAnimationFrame(() => {
    window.scrollTo(position.windowX || 0, position.windowY || 0);
    document.querySelector(".main")?.scrollTo?.({ top: position.mainTop || 0, left: position.mainLeft || 0 });
    contentEl?.scrollTo?.({ top: position.contentTop || 0, left: position.contentLeft || 0 });
    document.querySelector("#student-pricing-table-wrap")?.scrollTo?.({ top: position.pricingTableTop || 0, left: position.pricingTableLeft || 0 });
  });
}

function rerenderCurrentView(renderAction) {
  const position = captureCurrentScroll();
  rerenderContent(renderAction);
  restoreCurrentScroll(position);
}

async function refreshDerivedForActiveMonth(renderAction) {
  const data = await request(`/api/bootstrap${bootstrapQuery(false)}`);
  state = normalizeBootstrapState(data, state, true);
  syncActiveMonthState(state.active_month_key || state.settings?.month_key || activeMonth);
  state.full_bootstrap_key = fullBootstrapCacheKey(activeMonth);
  rerenderCurrentView(renderAction);
}

async function refreshDashboardForActiveMonth() {
  const dashboardParams = new URLSearchParams();
  dashboardParams.set("month", activeMonth || state.settings.month_key);
  dashboardParams.set("start", dashboardRange.start);
  dashboardParams.set("end", dashboardRange.end);
  state.dashboard = canView("dashboard") ? await request(`/api/dashboard?${dashboardParams.toString()}`) : null;
  rerenderCurrentView(renderDashboard);
}

async function refreshFinanceForActiveMonth({ resetToActiveMonth = true } = {}) {
  if (resetToActiveMonth) resetFinanceRangeToActiveMonth();
  state.finance = canArea("finance") ? await request(`/api/finance-summary?${financeRangeQuery()}`) : null;
  rerenderCurrentView(renderFinance);
}

async function refreshRechargesForActiveMonth() {
  state.recharges = canView("recharges") ? ((await request(`/api/recharges?month=${encodeURIComponent(activeMonth)}`)).recharges || []) : [];
  rerenderCurrentView(renderRecharges);
}

async function refreshStaffMonthForActiveView() {
  state.staff = canArea("staff") ? ((await request("/api/staff")).staff || []) : [];
  state.staff_salary = canArea("staff") ? ((await request(`/api/staff-salary?month=${encodeURIComponent(activeMonth)}`)).rows || []) : [];
  state.staff_attendance = canArea("staff") ? ((await request(`/api/staff-attendance?month=${encodeURIComponent(activeMonth)}`)).rows || []) : [];
  rerenderCurrentView(view === "staffAttendance" ? renderStaffAttendance : renderStaffPayroll);
}

async function refreshExpensesForActiveMonth({ keepRange = false } = {}) {
  if (!keepRange) ensureExpenseFilterDates();
  const expenseParams = new URLSearchParams();
  if (expenseFilter.start) expenseParams.set("start", expenseFilter.start);
  if (expenseFilter.end) expenseParams.set("end", expenseFilter.end);
  if (expenseFilter.category) expenseParams.set("category", expenseFilter.category);
  if (expenseFilter.q) expenseParams.set("q", expenseFilter.q);
  state.expenses = canArea("expenses") ? ((await request(`/api/operating-expenses?${expenseParams.toString()}`)).expenses || []) : [];
  rerenderCurrentView(renderExpenses);
}

async function refreshAuditForActiveMonth() {
  if (canArea("audit")) await refreshBackupData();
  rerenderCurrentView(renderAudit);
}

async function refreshTeacherDetailForActiveMonth() {
  await loadActiveViewData({ refreshGlobal: false, fullBootstrap: false, generation: loadGeneration });
  rerenderCurrentView(renderTeacherDetail);
}

async function refreshMonthRelatedActiveView() {
  if (view === "dashboard") return refreshDashboardForActiveMonth();
  if (view === "finance") return refreshFinanceForActiveMonth({ resetToActiveMonth: true });
  if (view === "recharges") return refreshRechargesForActiveMonth();
  if (view === "summary") return refreshDerivedForActiveMonth(renderSummary);
  if (view === "feeDetails") return refreshDerivedForActiveMonth(renderFeeDetails);
  if (view === "studentPricing") return refreshStudentPricingModule();
  if (view === "classGroups") return refreshDerivedForActiveMonth(renderClassGroups);
  if (view === "teacherSalary") return refreshDerivedForActiveMonth(renderTeacherSalary);
  if (view === "teacherTravelFees") return refreshDerivedForActiveMonth(renderTeacherTravelFees);
  if (view === "teacherDetail") return refreshTeacherDetailForActiveMonth();
  if (view === "teacherSalaryRules") {
    await loadActiveViewData({ refreshGlobal: false, fullBootstrap: false, generation: loadGeneration });
    return rerenderCurrentView(renderTeacherSalaryRules);
  }
  if (view === "staffPayroll" || view === "staffAttendance") return refreshStaffMonthForActiveView();
  if (view === "expenses") return refreshExpensesForActiveMonth();
  if (view === "audit") return refreshAuditForActiveMonth();
  syncActiveMonthState(activeMonth);
}

async function onActiveMonthChanged(newMonth, oldMonth = activeMonth) {
  if (!newMonth) return;
  syncActiveMonthState(newMonth);
  closeOpenMultiSelectMenus();
  closeDateRangePicker();
  if (newMonth === oldMonth) return;
  if (view === "recharges") {
    rechargeStudentFilter = "";
    rechargeGradeFilter = "";
    rechargeDateFilter = { start: "", end: "" };
  } else if (view === "summary") summaryFilter = { student: "", grade: "", balance: "" };
  else if (view === "feeDetails") feeDetailsFilter = { month_key: "", student: "", teacher: "", grade: "", status: "", source: "", start: "", end: "" };
  else if (view === "studentPricing") studentPricingFilter = { student: "", grade: "", subject: "", student_names: "", price: "", usage: "" };
  else if (view === "classGroups") classGroupFilter = { teacher: "", grade: "", subject: "", student: "" };
  else if (view === "teacherDetail") teacherDetailFilter = { grade: "", subject: "", student: "", source: "", rule_status: "" };
  else if (view === "teacherSalaryRules") teacherSalaryRuleFilter = { teacher: "", grade: "", subject: "", student: "", salary_status: "" };
  logClientOperation("month_switch", {
    content: `切换月份：${oldMonth || "未设置"} → ${newMonth}`,
    target_type: "months",
    target_id: newMonth,
    details: { before: oldMonth || "", after: newMonth, view },
  });
  if (TOPBAR_MONTH_INDEPENDENT_VIEWS.has(view)) return;
  await refreshMonthRelatedActiveView();
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
  const summary = teacherSummaryRowFor(row.dataset.teacherName || "");
  return {
    teacher_name: row.dataset.teacherName || "",
    month_key: state.settings.month_key,
    notes: summary.notes || "",
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

function updateStudentPricingSelectionUi() {
  const visibleIds = studentPricingVisibleRows.map((row) => Number(row.id));
  const selectedCount = visibleIds.filter((id) => selectedStudentPricingIds.has(id)).length;
  document.querySelectorAll(".student-pricing-select-row").forEach((input) => {
    input.checked = selectedStudentPricingIds.has(Number(input.dataset.id));
  });
  const selectAll = document.querySelector(".student-pricing-select-all");
  if (selectAll) {
    selectAll.checked = visibleIds.length > 0 && selectedCount === visibleIds.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < visibleIds.length;
  }
  const summary = document.querySelector(".batch-selection-summary b");
  if (summary) summary.textContent = String(selectedStudentPricingIds.size);
  const clear = document.querySelector(".clear-student-pricing-selection");
  if (clear) clear.disabled = selectedStudentPricingIds.size === 0;
  const batch = document.querySelector(".open-student-pricing-batch-modal");
  if (batch) batch.disabled = selectedStudentPricingIds.size === 0 || !canWriteData();
}

function studentPricingActiveFilterSummary() {
  return Object.entries(studentPricingFilter)
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => `${({ student: "学生", grade: "年级", subject: "科目", student_names: "学生集合", price: "价格状态", usage: "使用状态" })[key]}：${value}`)
    .join("；") || "全部规则";
}

function closeStudentPricingBatchModal() {
  studentPricingBatchModalOpen = false;
  document.querySelector(".student-pricing-batch-modal")?.remove();
}

function openStudentPricingBatchModal() {
  if (!selectedStudentPricingIds.size || !canWriteData()) return;
  closeStudentPricingBatchModal();
  studentPricingBatchModalOpen = true;
  contentEl.insertAdjacentHTML("beforeend", `
    <div class="modal-backdrop student-pricing-batch-modal">
      <div class="modal-panel batch-pricing-modal-panel" role="dialog" aria-modal="true" aria-labelledby="student-pricing-batch-title">
        <div class="modal-head"><div><div class="modal-title" id="student-pricing-batch-title">批量设置学生单价</div><div class="modal-subtitle">仅修改已选择 ${selectedStudentPricingIds.size} 条规则的单价，其他字段保持不变。</div><div class="modal-subtitle">当前筛选：${escapeHtml(studentPricingActiveFilterSummary())}</div></div></div>
        <label class="filter-field"><span>统一单价</span><input class="control student-pricing-batch-value" type="number" min="0" max="100000" step="0.01" value="0"></label>
        <div class="batch-pricing-result" aria-live="polite"></div>
        <div class="modal-actions"><button class="btn close-student-pricing-batch-modal" type="button">取消</button><button class="btn primary confirm-student-pricing-batch" type="button">确认更新</button></div>
      </div>
    </div>
  `);
  document.querySelector(".student-pricing-batch-value")?.focus();
}

function patchStudentPricingRowDom(row) {
  const element = document.querySelector(`.student-pricing-rule-row[data-rule-id="${Number(row.id)}"]`);
  if (!element) return;
  const priceInput = element.querySelector('.student-pricing-field[data-field="custom_price"]');
  if (priceInput && document.activeElement !== priceInput) priceInput.value = moneyInput(row.custom_price);
  const notesInput = element.querySelector('.student-pricing-field[data-field="notes"]');
  if (notesInput && document.activeElement !== notesInput) notesInput.value = String(row.notes || "");
  const status = element.querySelector(".student-pricing-status-cell");
  if (status) status.innerHTML = visiblePriceStatusBadge(studentPricingVisibleStatus(row));
}

function mergeStudentPricingResponseRow(row) {
  const prepared = prepareStudentPricingRule(row);
  state.student_pricing = upsertById(state.student_pricing || [], prepared);
  const visibleIndex = studentPricingVisibleRows.findIndex((item) => Number(item.id) === Number(prepared.id));
  if (visibleIndex >= 0) studentPricingVisibleRows[visibleIndex] = { ...studentPricingVisibleRows[visibleIndex], ...prepared };
  patchStudentPricingRowDom(prepared);
  studentPricingPageCache.set(studentPricingPageCacheKey(), {
    data: {
      month_key: activeMonth,
      rules: state.student_pricing,
      filters: state.student_pricing_filters || {},
      cache_status: "client-patched",
    },
    expires_at: Date.now() + STUDENT_PRICING_CLIENT_CACHE_TTL_MS,
  });
  return prepared;
}

async function saveStudentPricingField(input) {
  if (!input || input.dataset.saving === "1") return;
  const value = input.type === "number" ? numberValue(input.value) : input.value;
  if (input.dataset.field === "custom_price" && numberValue(value) < 0) {
    showToast("学生单价必须大于或等于 0；0 元规则仅作为未设置候选。", "error");
    return;
  }
  const id = Number(input.dataset.id);
  const before = (state.student_pricing || []).find((row) => Number(row.id) === id);
  input.dataset.saving = "1";
  input.disabled = true;
  try {
    const result = await request(`/api/student-pricing/${id}?month=${encodeURIComponent(activeMonth)}`, {
      method: "PATCH",
      body: { [input.dataset.field]: value },
    });
    const row = mergeStudentPricingResponseRow(result);
    for (const key of ["studentSummary", "summary", "finance"]) markDirty(key);
    if (input.dataset.field === "notes") scheduleAdaptiveTableColumns();
    if (result?.warnings?.length) alert(result.warnings.map((warning) => warning.message || warning.type).join("\n"));
    showToast("学生单价已保存");
    return row;
  } catch (error) {
    if (before && input.isConnected) input.value = String(before[input.dataset.field] ?? "");
    showToast(error.message || "学生单价保存失败", "error");
  } finally {
    if (input.isConnected) {
      input.dataset.saving = "0";
      input.disabled = !canWriteData();
    }
  }
}

async function confirmStudentPricingBatch(button) {
  const value = document.querySelector(".student-pricing-batch-value")?.value ?? "";
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0 || price > 100000 || Math.abs(price * 100 - Math.round(price * 100)) >= 1e-8) {
    return showToast("单价须为 0 到 100000 之间且最多两位小数", "error");
  }
  const ids = [...new Set([...selectedStudentPricingIds].map(Number).filter(Boolean))];
  button.disabled = true;
  try {
    const result = await request(`/api/student-pricing/batch?month=${encodeURIComponent(activeMonth)}`, {
      method: "PATCH",
      body: { ids, price },
    });
    for (const row of result.rows || []) {
      mergeStudentPricingResponseRow(row);
      selectedStudentPricingIds.delete(Number(row.id));
    }
    closeStudentPricingBatchModal();
    updateStudentPricingSelectionUi();
    for (const key of ["studentSummary", "summary", "finance"]) markDirty(key);
    showToast(`已处理 ${result.processed || ids.length} 条：成功 ${result.success || 0} 条，失败 ${(result.failed || []).length} 条。`);
  } catch (error) {
    button.disabled = false;
    const failed = Array.isArray(error.data?.failed) ? error.data.failed : [{ message: error.message || "批量设置单价失败" }];
    const box = document.querySelector(".student-pricing-batch-modal .batch-pricing-result");
    if (box) {
      box.innerHTML = `<strong>已处理 ${escapeHtml(error.data?.processed ?? ids.length)} 条：成功 ${escapeHtml(error.data?.success || 0)} 条，失败 ${escapeHtml(failed.length)} 条。</strong>${failed.map((item) => `<div>记录 ${escapeHtml(item.id || "未知")} · 原因 ${escapeHtml(item.message || error.message || "更新失败")}</div>`).join("")}`;
    }
    showToast(error.message || "批量设置单价失败", "error");
  }
}

function ensureStudentPricingDelegatedEvents() {
  if (studentPricingDelegatedEventsBound || !contentEl) return;
  studentPricingDelegatedEventsBound = true;
  contentEl.addEventListener("change", (event) => {
    const rowCheckbox = event.target.closest?.(".student-pricing-select-row");
    if (rowCheckbox) {
      const id = Number(rowCheckbox.dataset.id);
      if (rowCheckbox.checked) selectedStudentPricingIds.add(id);
      else selectedStudentPricingIds.delete(id);
      updateStudentPricingSelectionUi();
      return;
    }
    const selectAll = event.target.closest?.(".student-pricing-select-all");
    if (selectAll) {
      for (const row of studentPricingVisibleRows) {
        if (selectAll.checked) selectedStudentPricingIds.add(Number(row.id));
        else selectedStudentPricingIds.delete(Number(row.id));
      }
      updateStudentPricingSelectionUi();
      return;
    }
    const field = event.target.closest?.(".student-pricing-field");
    if (field) saveStudentPricingField(field);
  });
  contentEl.addEventListener("keydown", (event) => {
    const field = event.target.closest?.('.student-pricing-field[data-field="custom_price"]');
    if (field && event.key === "Enter") {
      event.preventDefault();
      field.blur();
    }
  });
  contentEl.addEventListener("click", (event) => {
    if (event.target.closest?.(".clear-student-pricing-selection")) {
      selectedStudentPricingIds.clear();
      updateStudentPricingSelectionUi();
      return;
    }
    if (event.target.closest?.(".open-student-pricing-batch-modal")) return openStudentPricingBatchModal();
    if (event.target.closest?.(".close-student-pricing-batch-modal")) return closeStudentPricingBatchModal();
    const confirmButton = event.target.closest?.(".confirm-student-pricing-batch");
    if (confirmButton) return confirmStudentPricingBatch(confirmButton);
    if (event.target.classList?.contains("student-pricing-batch-modal")) closeStudentPricingBatchModal();
  });
}

function wireEvents() {
  ensureRechargeChannelEvents();
  ensureStudentPricingDelegatedEvents();
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
  document.querySelectorAll(".multi-select:not(.schedule-student-popover)").forEach(bindMultiSelectControl);
  document.querySelectorAll(".schedule-student-popover").forEach(bindScheduleStudentPopover);

  if (!multiSelectEventsBound) {
    multiSelectEventsBound = true;
    document.addEventListener("click", (event) => {
      const select = multiSelectOwner(event.target);
      if (select?.classList.contains("schedule-student-popover")) {
        const menu = multiSelectMenuFor(select);
        const toggle = select.querySelector(".multi-select-toggle");
        if (event.target.closest(".multi-select-toggle")) {
          event.preventDefault();
          closeOtherMultiSelectMenus(select);
          if (select.classList.contains("open")) {
            select._studentClose?.();
          } else {
            select._studentDraft = normalizeNameList(select.querySelector(".multi-select-value")?.value || "");
            const search = menu?.querySelector(".multi-select-search");
            if (search) search.value = "";
            select.classList.add("open");
            toggle?.setAttribute("aria-expanded", "true");
            mountFloatingMultiSelectMenu(select);
            select._studentSync?.();
            positionFloatingMultiSelectMenu(select);
            requestAnimationFrame(() => multiSelectMenuFor(select)?.querySelector(".multi-select-search")?.focus({ preventScroll: true }));
          }
          return;
        }
        const searchClear = event.target.closest(".schedule-student-search-clear");
        if (searchClear) {
          const search = menu?.querySelector(".multi-select-search");
          if (search) search.value = "";
          select._studentSync?.();
          search?.focus({ preventScroll: true });
          return;
        }
        const selectedBadge = event.target.closest(".schedule-student-selected .student-badge-removable");
        if (selectedBadge) {
          select._studentDraft = (select._studentDraft || []).filter((name) => name !== (selectedBadge.dataset.studentName || ""));
          select._studentSync?.();
          refreshScheduleStudentPopoverLayout(select);
          return;
        }
        const option = event.target.closest(".multi-select-option");
        if (option) {
          const value = option.dataset.value || "";
          const draft = select._studentDraft || [];
          select._studentDraft = draft.includes(value) ? draft.filter((name) => name !== value) : normalizeNameList([...draft, value]);
          select._studentSync?.();
          refreshScheduleStudentPopoverLayout(select);
          return;
        }
        if (event.target.closest(".schedule-student-cancel")) {
          select._studentClose?.();
          return;
        }
        if (event.target.closest(".schedule-student-confirm")) {
          select._studentConfirm?.();
          return;
        }
      } else if (select) {
        const toggle = select.querySelector(".multi-select-toggle");
        const search = multiSelectMenuFor(select)?.querySelector(".multi-select-search");
        if (event.target.closest(".multi-select-toggle")) {
          event.preventDefault();
          if (event.target.closest(".multi-select-clear-icon") && select._multiSelectSelectedValues?.().length) {
            closeMultiSelectMenu(select);
            if (search) search.value = "";
            select._multiSelectCommit?.([]);
            toggle?.blur();
            return;
          }
          closeOtherMultiSelectMenus(select);
          const isOpen = !select.classList.contains("open");
          if (!isOpen) closeMultiSelectMenu(select);
          else {
            select.classList.add("open");
            mountFloatingMultiSelectMenu(select);
          }
          toggle?.setAttribute("aria-expanded", isOpen ? "true" : "false");
          if (isOpen) {
            search?.focus({ preventScroll: true });
            positionFloatingMultiSelectMenu(select);
            requestAnimationFrame(() => positionFloatingMultiSelectMenu(select));
          }
          return;
        }
        if (event.target.closest(".multi-select-search-clear")) {
          if (search) search.value = "";
          refreshSearchableSelectResults(select);
          search?.focus({ preventScroll: true });
          return;
        }
        if (event.target.closest(".multi-select-clear")) {
          closeMultiSelectMenu(select);
          if (search) search.value = "";
          select._multiSelectCommit?.([]);
          return;
        }
        const option = event.target.closest(".multi-select-option");
        if (option) {
          const value = option.dataset.value || "";
          if (select.dataset.selectionMode === "single") {
            select._multiSelectCommit?.(value ? [value] : []);
            closeMultiSelectMenu(select);
            toggle?.focus({ preventScroll: true });
          } else {
            const next = select._multiSelectSelectedValues?.() || [];
            const index = next.indexOf(value);
            if (index >= 0) next.splice(index, 1);
            else next.push(value);
            select._multiSelectCommit?.(next);
          }
          return;
        }
      }
      if (!event.target.closest(".multi-select") && !event.target.closest(".floating-multi-select-menu")) {
        closeOpenMultiSelectMenus();
      }
    });
    document.addEventListener("compositionstart", (event) => {
      if (event.target.matches?.(".multi-select-search")) event.target.dataset.composing = "1";
    });
    document.addEventListener("compositionend", (event) => {
      if (!event.target.matches?.(".multi-select-search")) return;
      event.target.dataset.composing = "0";
      const select = multiSelectOwner(event.target);
      if (select?.classList.contains("schedule-student-popover")) select._studentSync?.();
      else refreshSearchableSelectResults(select);
    });
    document.addEventListener("input", (event) => {
      if (!event.target.matches?.(".multi-select-search") || event.target.dataset.composing === "1") return;
      const select = multiSelectOwner(event.target);
      if (select?.classList.contains("schedule-student-popover")) select._studentSync?.();
      else refreshSearchableSelectResults(select);
    });
    document.addEventListener("keydown", (event) => {
      const select = multiSelectOwner(event.target);
      if (!select || !event.target.closest(".multi-select-menu")) return;
      const menu = multiSelectMenuFor(select);
      const toggle = select.querySelector(".multi-select-toggle");
      const search = menu?.querySelector(".multi-select-search");
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (select.classList.contains("schedule-student-popover")) select._studentClose?.();
        else closeMultiSelectMenu(select);
        toggle?.focus({ preventScroll: true });
        return;
      }
      if (select.classList.contains("schedule-student-popover")) {
        if (event.key === "Enter" && event.target === search) event.preventDefault();
        return;
      }
      const visible = [...(menu?.querySelectorAll(".multi-select-option") || [])].filter((option) => !option.hidden);
      if (event.target === search && event.key === "Enter") {
        event.preventDefault();
        (visible.find((option) => option.classList.contains("selected")) || visible[0])?.click();
      } else if (event.target === search && event.key === "ArrowDown") {
        event.preventDefault();
        visible[0]?.focus();
      } else if (event.key === "Enter" && visible.includes(document.activeElement)) {
        event.preventDefault();
        document.activeElement?.click?.();
      } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        const index = visible.indexOf(document.activeElement);
        event.preventDefault();
        if (event.key === "ArrowDown") visible[Math.min(visible.length - 1, index + 1)]?.focus();
        else if (index <= 0) search?.focus({ preventScroll: true });
        else visible[index - 1]?.focus();
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
      const count = menu?.querySelector("[data-filter-combo-count]");
      if (count) count.textContent = `${visibleCount} 项结果`;
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
      applySidebarState();
      const label = sidebarCollapsed ? "展开侧栏" : "收起侧栏";
      document.querySelectorAll(".sidebar-toggle").forEach((toggle) => {
        toggle.setAttribute("aria-label", label);
        toggle.setAttribute("title", label);
        toggle.setAttribute("aria-pressed", sidebarCollapsed ? "true" : "false");
      });
      document.querySelectorAll(".nav-btn[data-tooltip]").forEach((navButton) => {
        navButton.setAttribute("title", sidebarCollapsed ? navButton.dataset.tooltip || "" : "");
      });
      syncNavExpandToggle();
      requestAnimationFrame(() => {
        if (dashboardTrendChart && !dashboardTrendChart.isDisposed?.()) dashboardTrendChart.resize();
      });
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

  document.querySelectorAll(".month-select").forEach((select) => {
    select.addEventListener("change", async () => {
      const oldMonth = activeMonth;
      await onActiveMonthChanged(select.value, oldMonth);
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
      const before = themeMode;
      themeMode = select.value || "system";
      applyTheme();
      logClientOperation("appearance_theme_change", {
        content: `修改外观主题：${before} → ${themeMode}`,
        target_type: "appearance",
        target_id: "theme",
        details: { before, after: themeMode },
      });
      render();
    });
  });

  document.querySelectorAll(".palette-select").forEach((select) => {
    select.addEventListener("change", () => {
      const before = paletteMode;
      paletteMode = select.value || "liming-blue";
      applyPalette();
      logClientOperation("appearance_palette_change", {
        content: `修改外观配色：${before} → ${paletteMode}`,
        target_type: "appearance",
        target_id: "palette",
        details: { before, after: paletteMode },
      });
      render();
    });
  });

  document.querySelectorAll(".base-data-add").forEach((button) => {
    button.addEventListener("click", async () => {
      const settingKey = button.dataset.settingKey;
      const def = baseDataDefinitions().find((item) => item.settingKey === settingKey);
      const input = document.querySelector(`.base-data-new-value[data-setting-key="${selectorEscape(settingKey)}"]`);
      let value = String(input?.value || "").trim();
      if (!def || !value) return alert("请先填写有效内容");
      if (settingKey === "custom_time_slots") {
        const normalized = normalizeTimeSlot(value);
        if (!normalized) return alert("常用时间格式无效，请使用 HH:mm-HH:mm，例如 08:30-10:30");
        value = normalized;
      }
      if ([...settingsArray(settingKey), ...(def.currentValues || [])].some((item) => item === value)) return alert("该值已存在，不能重复新增");
      const nextValues = settingKey === "custom_time_slots"
        ? uniqueSorted([...settingsArray(settingKey), value].map((item) => normalizeTimeSlot(item)).filter(Boolean))
        : uniqueSorted([...settingsArray(settingKey), value]);
      try {
        const result = await request("/api/settings", { method: "POST", body: { [settingKey]: JSON.stringify(nextValues) } });
        state.settings = { ...state.settings, ...(result.settings || {}), [settingKey]: JSON.stringify(nextValues) };
        state.lookups = { ...state.lookups, ...(result.lookups || {}) };
        state.used_lesson_lookups = result.used_lesson_lookups || state.used_lesson_lookups;
        renderBaseData();
        applyReadonlyUi();
        wireEvents();
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

  if (!colorConfigPreviewEventsBound) {
    colorConfigPreviewEventsBound = true;
    contentEl.addEventListener("input", (event) => {
      const input = event.target.closest?.(".color-config-input");
      const row = input?.closest(".color-config-row");
      const preview = row?.querySelector(".color-config-label > *");
      if (!input || !preview) return;
      const variable = input.dataset.colorPart === "background" ? "--badge-bg" : "--badge-fg";
      preview.style.setProperty(variable, input.value);
    });
  }

  document.querySelectorAll(".base-data-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      const settingKey = button.dataset.settingKey;
      const value = button.dataset.value;
      if (!settingKey || !value) return;
      if (!confirm(`从基础字典删除“${value}”？历史课程不会被修改。`)) return;
      const nextValues = settingsArray(settingKey).filter((item) => item !== value);
      try {
        const result = await request("/api/settings", { method: "POST", body: { [settingKey]: JSON.stringify(nextValues) } });
        state.settings = { ...state.settings, ...(result.settings || {}), [settingKey]: JSON.stringify(nextValues) };
        state.lookups = { ...state.lookups, ...(result.lookups || {}) };
        state.used_lesson_lookups = result.used_lesson_lookups || state.used_lesson_lookups;
        renderBaseData();
        applyReadonlyUi();
        wireEvents();
      } catch (error) {
        alert(error.message || "删除失败");
      }
    });
  });

  document.querySelectorAll(".color-config-save, .color-config-reset").forEach((button) => {
    button.addEventListener("click", async () => {
      const settingKey = button.dataset.settingKey;
      const kind = button.closest("[data-color-config]")?.dataset.colorConfig;
      if (!settingKey || !kind) return;
      const defaults = kind === "status"
        ? DEFAULT_COURSE_STATUS_COLORS
        : kind === "subject"
          ? DEFAULT_SUBJECT_COLORS
          : DEFAULT_STUDENT_GRADE_COLORS;
      const values = button.classList.contains("color-config-reset")
        ? defaults
        : Object.fromEntries([...button.closest(".color-config-card").querySelectorAll(".color-config-row")].map((row) => {
          const name = row.dataset.colorName;
          return [name, {
            background: row.querySelector('[data-color-part="background"]')?.value || "#eef0f3",
            color: row.querySelector('[data-color-part="color"]')?.value || "#4b5563",
          }];
        }));
      button.disabled = true;
      try {
        const result = await request("/api/settings", { method: "POST", body: { [settingKey]: JSON.stringify(values) } });
        state.settings = { ...state.settings, ...(result.settings || {}), [settingKey]: JSON.stringify(values) };
        renderBaseData();
        applyReadonlyUi();
        wireEvents();
      } catch (error) {
        alert(error.message || "保存配色失败");
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll(".ignore-room-one-conflict").forEach((input) => {
    input.addEventListener("change", async () => {
      ignoreRoomOneConflict = input.checked;
      localStorage.setItem(IGNORE_ROOM_ONE_CONFLICT_KEY, ignoreRoomOneConflict ? "1" : "0");
      if (view === "lessons" || view === "weekMatrix") render();
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
      rechargeModalDraft = { recharge_date: defaultRechargeDate(), cur_recharge: 0, cur_gift: 0, channel: "wechat" };
      rechargeModalOpen = true;
      render();
    });
  });

  document.querySelectorAll(".recharge-modal-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      rechargeModalOpen = false;
      rechargeModalDraft = null;
      render();
    });
  });

  document.querySelectorAll(".recharge-modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target !== modal) return;
      rechargeModalOpen = false;
      rechargeModalDraft = null;
      render();
    });
  });

  document.querySelectorAll(".recharge-channel-radio").forEach((radio) => {
    radio.addEventListener("change", () => {
      const other = document.querySelector(".recharge-channel-other");
      if (!other) return;
      const isOther = radio.checked && radio.value === "other";
      other.hidden = !isOther;
      if (!isOther) {
        const input = other.querySelector("input");
        if (input) input.value = "";
      }
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
      const id = Number(button.dataset.id || 0);
      const studentName = document.querySelector("#new-recharge-student")?.value.trim() || "";
      const grade = document.querySelector("#new-recharge-grade")?.value.trim() || "";
      const rechargeDate = document.querySelector("#new-recharge-date")?.value || "";
      const curRecharge = document.querySelector("#new-recharge-cur")?.value || "0";
      const curGift = document.querySelector("#new-recharge-gift")?.value || "0";
      const channel = document.querySelector('input[name="recharge-channel"]:checked')?.value || "";
      const channelOther = channel === "other" ? (document.querySelector("#new-recharge-channel-other")?.value.trim() || "") : "";
      const notes = document.querySelector("#new-recharge-notes")?.value || "";
      if (!studentName) return alert("请填写学生姓名");
      if (!channel) return alert("请选择来源 / 渠道");
      if (channel === "other" && !channelOther) return alert("选择“其他”时，请填写具体渠道");
      if (optionalNumberValue(curRecharge) === null) return alert("请填写有效的现金充值");
      if (optionalNumberValue(curGift) === null) return alert("请填写有效的赠送充值");
      if (numberValue(curRecharge) === 0 && numberValue(curGift) === 0) return alert("实际充值和赠送充值不能同时为 0");
      button.disabled = true;
      try {
        await request(id ? `/api/recharges/${encodeURIComponent(id)}` : "/api/recharges", {
          method: id ? "PATCH" : "POST",
          body: {
            student_name: studentName,
            grade,
            month_key: state.settings.month_key,
            cur_recharge: optionalNumberValue(curRecharge) || 0,
            cur_gift: optionalNumberValue(curGift) || 0,
            recharge_date: rechargeDate,
            source: id ? (rechargeModalDraft?.source || "manual") : "manual",
            channel,
            channel_other: channelOther,
            notes,
          },
        });
        rechargeModalOpen = false;
        rechargeModalDraft = null;
        await refreshRechargesForActiveMonth();
      } catch (error) {
        button.disabled = false;
        alert(`${id ? "编辑" : "新增"}充值记录失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll("input.recharge-source-filter").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      rechargeSourceFilter = canonicalFilterValue(rechargeSourceOptions, value) || "all";
      localStorage.setItem(RECHARGE_SOURCE_FILTER_KEY, rechargeSourceFilter);
    }, () => render());
  });

  document.querySelectorAll("input.recharge-student-filter").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      rechargeStudentFilter = value;
    }, () => render());
  });

  document.querySelectorAll("input.recharge-grade-filter").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      rechargeGradeFilter = value;
    }, () => render());
  });

  document.querySelectorAll(".reset-recharge-filter").forEach((button) => {
    button.addEventListener("click", () => {
      rechargeSourceFilter = "all";
      rechargeStudentFilter = "";
      rechargeGradeFilter = "";
      rechargeDateFilter = { start: "", end: "" };
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

  document.querySelectorAll("input.opening-balance-filter").forEach((input) => {
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

  document.querySelectorAll("input.profile-name-filter").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      profileNameFilter = { ...profileNameFilter, [profileTab]: value };
    }, () => render());
  });

  document.querySelectorAll("input.profile-grade-filter").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      profileGradeFilter = { ...profileGradeFilter, students: value };
    }, () => render());
  });

  document.querySelectorAll("input.profile-keyword-filter").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      profileKeywordFilter = { ...profileKeywordFilter, [profileTab]: value };
    }, () => render());
  });

  document.querySelectorAll("input.profile-status-filter").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      profileStatusFilter = { ...profileStatusFilter, [profileTab]: value };
      localStorage.setItem("liming:profile-status-filter", JSON.stringify(profileStatusFilter));
    }, () => render());
  });

  document.querySelectorAll(".reset-profile-filter").forEach((button) => {
    button.addEventListener("click", () => {
      profileNameFilter = { ...profileNameFilter, [profileTab]: "" };
      profileKeywordFilter = { ...profileKeywordFilter, [profileTab]: "" };
      if (profileTab === "students") profileGradeFilter = { ...profileGradeFilter, students: "" };
      profileStatusFilter = { ...profileStatusFilter, [profileTab]: "" };
      localStorage.setItem("liming:profile-status-filter", JSON.stringify(profileStatusFilter));
      render();
    });
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

  document.querySelectorAll(".student-profile-select-row").forEach((input) => {
    input.addEventListener("change", () => {
      const id = Number(input.dataset.id);
      if (!id) return;
      if (input.checked) selectedStudentProfileIds.add(id);
      else selectedStudentProfileIds.delete(id);
      render();
    });
  });

  document.querySelectorAll(".student-profile-select-all").forEach((input) => {
    input.addEventListener("change", () => {
      const rows = profileRows("students");
      if (input.checked) rows.forEach((row) => selectedStudentProfileIds.add(Number(row.id)));
      else rows.forEach((row) => selectedStudentProfileIds.delete(Number(row.id)));
      render();
    });
  });

  if (!studentGradeStageEventsBound) {
    studentGradeStageEventsBound = true;
    contentEl.addEventListener("click", (event) => {
      const refreshConflicts = event.target.closest(".student-stage-conflict-refresh");
      if (refreshConflicts && !refreshConflicts.disabled) {
        refreshStudentGradeStageConflicts();
        return;
      }
      const viewConflicts = event.target.closest(".student-stage-conflict-view");
      if (viewConflicts) {
        studentGradeStageConflictModalOpen = true;
        render();
        requestAnimationFrame(() => document.querySelector(".student-stage-conflict-close")?.focus());
        return;
      }
      const closeConflicts = event.target.closest(".student-stage-conflict-close");
      if (closeConflicts || event.target.classList?.contains("student-stage-conflict-modal")) {
        studentGradeStageConflictModalOpen = false;
        render();
        requestAnimationFrame(() => document.querySelector(".student-stage-conflict-view")?.focus());
        return;
      }
      const conflictEdit = event.target.closest(".student-stage-conflict-edit, .student-stage-conflict-marker");
      if (conflictEdit) {
        const studentId = Number(conflictEdit.dataset.studentId);
        const stages = [conflictEdit.dataset.stage, conflictEdit.dataset.stageA, conflictEdit.dataset.stageB].filter(Boolean);
        studentGradeStageConflictModalOpen = false;
        revealStudentProfileConflictTarget(studentId);
        render();
        const trigger = document.querySelector(`.student-stage-conflict-marker[data-student-id="${selectorEscape(studentId)}"]`);
        openStudentGradeStageModal(studentId, { stages, stage: stages[0], trigger });
        return;
      }
      const cancelButton = event.target.closest(".student-grade-stage-cancel");
      if (cancelButton) {
        event.preventDefault();
        closeStudentGradeStageModal();
        return;
      }
      const saveButton = event.target.closest(".student-grade-stage-save");
      if (saveButton) {
        event.preventDefault();
        saveStudentGradeStageModal(saveButton);
        return;
      }
      if (event.target.classList?.contains("student-grade-stage-modal")) {
        closeStudentGradeStageModal();
        return;
      }
      const row = event.target.closest(".student-profile-main-row");
      if (!row || event.target.closest("input, select, button, textarea, a, label, .custom-select, .multi-select")) return;
      const id = Number(row.dataset.id);
      if (id) openStudentGradeStageModal(id);
    });
    contentEl.addEventListener("change", (event) => {
      const input = event.target.closest(".student-grade-stage-modal .student-grade-stage-field");
      if (!input || !studentGradeStageModalDraft) return;
      const stage = input.dataset.stage;
      const field = input.dataset.field;
      if (studentGradeStageModalDraft.stages?.[stage] && field) studentGradeStageModalDraft.stages[stage][field] = String(input.value || "").trim();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (studentGradeStageConflictModalOpen) {
        event.preventDefault();
        studentGradeStageConflictModalOpen = false;
        render();
        requestAnimationFrame(() => document.querySelector(".student-stage-conflict-view")?.focus());
        return;
      }
      if (!studentGradeStageModalDraft) return;
      if (activeCustomDateInput || activeDateRangePicker || event.target.closest?.(".custom-select-menu, .multi-select-menu, .custom-date-picker, .date-range-picker-panel")) {
        event.preventDefault();
        closeSearchablePicker();
        closeDateRangePicker();
        return;
      }
      event.preventDefault();
      closeStudentGradeStageModal();
    });
  }

  document.querySelectorAll(".open-student-stage-batch").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      studentGradeStageBatchModalOpen = true;
      studentGradeStageBatchDraft = { stage: studentGradeStageBatchDraft.stage || "初一", start_date: "", end_date: "" };
      render();
    });
  });

  document.querySelectorAll(".student-stage-batch-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      studentGradeStageBatchModalOpen = false;
      render();
    });
  });

  document.querySelectorAll(".student-stage-batch-field").forEach((input) => {
    input.addEventListener("change", () => {
      studentGradeStageBatchDraft = { ...studentGradeStageBatchDraft, [input.dataset.field]: input.value };
      if (input.dataset.field === "stage" && input.value === "已毕业") studentGradeStageBatchDraft.end_date = "";
      render();
    });
  });

  document.querySelectorAll(".student-stage-batch-save").forEach((button) => {
    button.addEventListener("click", async () => {
      const ids = [...selectedStudentProfileIds].map(Number).filter(Boolean);
      if (!ids.length) return;
      button.disabled = true;
      try {
        const result = await request("/api/student-grade-stages/batch", {
          method: "POST",
          body: {
            student_ids: ids,
            stage: studentGradeStageBatchDraft.stage,
            start_date: studentGradeStageBatchDraft.start_date || "",
            end_date: studentGradeStageBatchDraft.stage === "已毕业" ? "" : studentGradeStageBatchDraft.end_date || "",
          },
        });
        for (const student of result.students || []) patchProfileState("students", student);
        studentGradeStageBatchModalOpen = false;
        showToast(`已批量修改 ${result.updated || 0} 名学生`);
        rerenderContent(() => renderProfileDirectory("students"));
      } catch (error) {
        button.disabled = false;
        alert(`批量修改失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll(".batch-delete-student-profiles").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const ids = [...selectedStudentProfileIds].map(Number).filter(Boolean);
      if (!ids.length) return;
      const names = profileRows("students")
        .filter((row) => ids.includes(Number(row.id)))
        .map((row) => row.name)
        .filter(Boolean);
      const sample = names.slice(0, 8).join("、");
      const suffix = names.length > 8 ? ` 等 ${names.length} 名学生` : "";
      if (!confirm(`确认批量删除已选中的 ${ids.length} 名学生吗？\n\n${sample}${suffix}\n\n已有历史课程、充值或单价规则的学生会改为已流出并保留档案。`)) return;
      button.disabled = true;
      try {
        const result = await request("/api/students/batch-delete", { method: "POST", body: { ids } });
        selectedStudentProfileIds.clear();
        await load({ refreshGlobal: false });
        const message = `已删除 ${result.deleted || 0} 条学生档案，改为已流出 ${result.soft_deleted || 0} 条。`;
        showToast(message);
        if (result.missing?.length) alert(`${message}\n另有 ${result.missing.length} 条未找到。`);
      } catch (error) {
        button.disabled = false;
        alert(`批量删除学生档案失败：${error.message}`);
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

  document.querySelectorAll(".profile-inline-status").forEach((select) => {
    const row = select.closest(".profile-row");
    if (!row) return;
    bindInlineStatusPicker(select, {
      save: (status) => request(`/api/${row.dataset.kind}/${row.dataset.id}`, { method: "PATCH", body: { status } }),
      onSaved: (result) => {
        patchProfileState(row.dataset.kind, result);
        const scrollTop = document.querySelector(".main")?.scrollTop || window.scrollY || 0;
        rerenderContent(() => renderProfileDirectory(row.dataset.kind));
        requestAnimationFrame(() => {
          document.querySelector(".main")?.scrollTo?.({ top: scrollTop });
          window.scrollTo({ top: scrollTop });
        });
      },
      successMessage: (result) => {
        const resolved = result?.exit_date_resolution;
        if (!resolved) return "档案状态已更新";
        return resolved.found
          ? `档案状态已更新，离开日期已按最后一节课程自动填写为 ${resolved.date}`
          : "档案状态已更新；未找到课程记录，未自动填写离开日期";
      },
    });
  });

  document.querySelectorAll(".profile-field:not(.profile-inline-status)").forEach((input) => {
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
      if (!confirm(`删除${label}档案：${button.dataset.name}？已有历史记录时会改为${button.dataset.kind === "students" ? "已流出" : "离职"}并保留档案。`)) return;
      refreshAfter(async () => {
        const result = await request(`/api/${button.dataset.kind}/${button.dataset.id}`, { method: "DELETE" });
        if (result.soft_deleted) alert(`存在历史记录，已改为${button.dataset.kind === "students" ? "已流出" : "离职"}并保留档案。`);
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

  document.querySelectorAll(".data-full-export").forEach((button) => {
    button.addEventListener("click", async () => {
      backupState.busy = true;
      render();
      try {
        const includeLogs = Boolean(backupState.exportIncludeOperationLogs);
        await downloadBlob(`/api/data-center/export.xlsx?include_operation_logs=${includeLogs ? "1" : "0"}`, `黎明教育_全量数据_${Date.now()}.xlsx`);
      } catch (error) {
        if (error.data?.preflight) backupState.preflight = error.data.preflight;
        showToast(error.message || "导出全部数据失败", "error");
      } finally {
        backupState.busy = false;
        render();
      }
    });
  });
  document.querySelectorAll(".data-export-include-logs").forEach((checkbox) => checkbox.addEventListener("change", () => { backupState.exportIncludeOperationLogs = checkbox.checked; }));

  document.querySelectorAll(".data-template-download").forEach((button) => {
    button.addEventListener("click", async () => {
      backupState.busy = true;
      render();
      try {
        await downloadBlob("/api/data-center/template.xlsx", "黎明教育_全量数据导入模板_v4.xlsx");
      } catch (error) {
        showToast(error.message || "下载模板失败", "error");
      } finally {
        backupState.busy = false;
        render();
      }
    });
  });

  document.querySelectorAll(".data-import-file").forEach((input) => {
    input.addEventListener("change", () => {
      const file = input.files?.[0] || null;
      if (file && !/\.xlsx$/i.test(file.name || "")) {
        backupState.importFile = null;
        backupState.importPreview = null;
        backupState.error = "请选择 .xlsx 格式的 Excel 文件";
      } else {
        backupState.importFile = file;
        backupState.importPreview = null;
        backupState.error = "";
      }
      render();
    });
  });
  document.querySelectorAll(".data-import-file-trigger").forEach((button) => {
    const activateFilePicker = () => document.getElementById("data-import-file-input")?.click();
    button.addEventListener("click", activateFilePicker);
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activateFilePicker();
    });
  });

  document.querySelectorAll(".data-import-mode").forEach((select) => {
    select.addEventListener("change", () => { backupState.importMode = select.value; backupState.importPreview = null; render(); });
  });

  document.querySelectorAll(".data-import-preview-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const file = backupState.importFile || document.querySelector(".data-import-file")?.files?.[0];
      if (!file) return showToast("请选择 xlsx 文件", "error");
      backupState.busy = true;
      render();
      try {
        const form = new FormData(); form.append("file", file, file.name);
        const response = await fetch("/api/data-center/import/preview", { method: "POST", body: form, cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        backupState.importPreview = data; backupState.error = "";
      } catch (error) {
        backupState.importPreview = null; backupState.error = error.message || "Excel 预检失败";
      } finally {
        backupState.busy = false;
        render();
      }
    });
  });

  document.querySelectorAll(".data-import-execute").forEach((button) => {
    button.addEventListener("click", async () => {
      const password = document.querySelector(".data-import-password")?.value || "";
      const confirmation = document.querySelector(".data-import-confirmation")?.value || "";
      backupState.busy = true;
      render();
      try {
        await request("/api/data-center/import/execute", { method: "POST", body: { upload_id: backupState.importPreview?.upload_id, mode: backupState.importMode, password, confirmation } });
        backupState.importPreview = null; backupState.importFile = null;
        alert("导入成功。所有登录会话已清除，请重新登录。");
        window.location.reload();
      } catch (error) {
        backupState.error = error.message || "数据导入失败";
      } finally {
        backupState.busy = false;
        render();
      }
    });
  });

  document.querySelectorAll(".backup-run-now").forEach((button) => {
    button.addEventListener("click", async () => {
      backupState.busy = true;
      render();
      try {
        const result = await request("/api/data-center/backups", { method: "POST", body: {} });
        backupState.records = result.records || backupState.records;
        backupState.error = "";
        showToast(`已生成备份：${result.record?.filename || ""}`);
      } catch (error) {
        if (error.data?.preflight) backupState.preflight = error.data.preflight;
        const message = error.message || "手动备份失败";
        await refreshBackupData({ tolerateFailure: true });
        backupState.error = message;
        showToast(message, "error");
      } finally {
        backupState.busy = false;
        render();
      }
    });
  });

  document.querySelectorAll(".backup-download").forEach((button) => {
    button.addEventListener("click", async () => {
      const downloadPath = button.dataset.path;
      if (!downloadPath) return;
      try {
        await downloadBlob(downloadPath, button.dataset.name || "backup.xlsx");
      } catch (error) {
        showToast(error.message || "下载备份失败", "error");
      }
    });
  });

  document.querySelectorAll(".backup-settings-save").forEach((button) => {
    button.addEventListener("click", async () => {
      backupState.busy = true;
      try {
        const draft = markBackupDraftFromDom();
        const result = await request("/api/data-center/settings", { method: "PUT", body: {
          enabled: draft.enabled, time: draft.time, timezone: draft.timezone, daily_retention: draft.daily_retention,
          monthly_retention: draft.monthly_retention, manual_retention: draft.manual_retention, retry_count: draft.retry_count,
          local_include_operation_logs: draft.local_include_operation_logs,
        } });
        backupState.settings = { ...backupState.settings, ...result.settings }; backupState.draft = { ...backupState.settings }; backupState.draftDirty = false; showToast("服务器备份设置已保存");
      } catch (error) { backupState.error = error.message || "保存备份设置失败"; }
      finally { backupState.busy = false; render(); }
    });
  });

  document.querySelectorAll(".baidu-settings-save").forEach((button) => button.addEventListener("click", async () => {
    backupState.busy = true;
    try {
      const draft = markBackupDraftFromDom(); const result = await request("/api/data-center/baidu/settings", { method: "PUT", body: {
        remote_enabled: draft.remote_enabled, remote_directory: draft.remote_directory, remote_plaintext_acknowledged: draft.remote_plaintext_acknowledged,
        remote_include_operation_logs: draft.remote_include_operation_logs, remote_frequency: draft.remote_frequency, remote_time: draft.remote_time,
        remote_timezone: draft.remote_timezone, remote_weekday: draft.remote_weekday, remote_monthday: draft.remote_monthday,
        remote_retention: draft.remote_retention, remote_retry_count: draft.remote_retry_count,
      } });
      backupState.settings = { ...backupState.settings, ...result.settings }; backupState.draft = { ...backupState.settings }; backupState.draftDirty = false; backupState.error = ""; await refreshBackupData({ tolerateFailure: true }); showToast("百度备份设置已保存");
    } catch (error) { backupState.error = error.message || "保存百度备份设置失败"; }
    finally { backupState.busy = false; render(); }
  }));

  document.querySelectorAll(".data-backup-subcard input, .data-backup-subcard select").forEach((control) => control.addEventListener("input", () => { markBackupDraftFromDom(); }));
  document.querySelectorAll(".data-backup-remote-frequency").forEach((select) => select.addEventListener("change", () => { markBackupDraftFromDom(); render(); }));

  document.querySelectorAll(".data-backup-remote-plaintext-ack").forEach((checkbox) => checkbox.addEventListener("change", () => { markBackupDraftFromDom(); }));

  document.querySelectorAll(".backup-verify").forEach((button) => {
    button.addEventListener("click", async () => {
      try { await request(`/api/data-center/backups/${encodeURIComponent(button.dataset.id)}/verify`, { method: "POST", body: {} }); await refreshBackupData(); showToast("备份验证通过"); }
      catch (error) { showToast(error.message || "备份验证失败", "error"); }
      finally { render(); }
    });
  });

  document.querySelectorAll(".backup-metadata-save").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.id; const note = document.querySelector(`.backup-note-field[data-id="${id}"]`)?.value || "";
      try { await request(`/api/data-center/backups/${encodeURIComponent(id)}`, { method: "PATCH", body: { note } }); await refreshBackupData(); showToast("备份信息已保存"); }
      catch (error) { showToast(error.message || "保存失败", "error"); }
      finally { render(); }
    });
  });
  document.querySelectorAll(".backup-toggle-pinned").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.id;
      try {
        await request(`/api/data-center/backups/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: { pinned: button.dataset.pinned !== "1" },
        });
        await refreshBackupData();
        showToast(button.dataset.pinned === "1" ? "已取消固定" : "备份已固定");
      } catch (error) { showToast(error.message || "修改固定状态失败", "error"); }
      finally { render(); }
    });
  });

  document.querySelectorAll(".backup-refresh").forEach((button) => button.addEventListener("click", async () => {
    await refreshBackupData({ logView: true, tolerateFailure: true });
    render();
  }));

  document.querySelectorAll(".managed-local-excel-open").forEach((button) => button.addEventListener("click", () => {
    loadManagedExcelBrowser("local");
  }));
  document.querySelectorAll(".managed-baidu-excel-open").forEach((button) => button.addEventListener("click", () => {
    loadManagedExcelBrowser("baidu");
  }));
  document.querySelectorAll(".managed-file-browser-close").forEach((button) => button.addEventListener("click", () => {
    backupState.fileBrowser = { ...backupState.fileBrowser, open: false, generation: backupState.fileBrowser.generation + 1 };
    render();
  }));
  document.querySelectorAll(".managed-file-browser-modal").forEach((modal) => modal.addEventListener("click", (event) => {
    if (event.target !== modal) return;
    backupState.fileBrowser = { ...backupState.fileBrowser, open: false, generation: backupState.fileBrowser.generation + 1 };
    render();
  }));
  document.querySelectorAll(".managed-file-browser-refresh, .managed-file-browser-retry").forEach((button) => button.addEventListener("click", () => {
    loadManagedExcelBrowser(backupState.fileBrowser.source);
  }));
  document.querySelectorAll(".managed-file-browser-more").forEach((button) => button.addEventListener("click", () => {
    loadManagedExcelBrowser("baidu", { append: true });
  }));
  document.querySelectorAll(".managed-file-browser-query").forEach((input) => input.addEventListener("change", () => {
    backupState.fileBrowser = { ...backupState.fileBrowser, query: input.value };
    render();
  }));
  document.querySelectorAll(".managed-file-browser-sort").forEach((select) => select.addEventListener("change", () => {
    backupState.fileBrowser = { ...backupState.fileBrowser, sort: select.value };
    render();
  }));

  document.querySelectorAll(".data-center-reload").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    await refreshBackupData({ tolerateFailure: true });
    render();
  }));

  document.querySelectorAll(".data-preflight-recheck").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try { backupState.preflight = await request("/api/data-center/preflight"); backupState.error = ""; }
    catch (error) { backupState.error = error.message || "重新检查失败"; }
    finally { render(); }
  }));
  document.querySelectorAll(".data-preflight-download").forEach((button) => button.addEventListener("click", async () => {
    try { await downloadBlob("/api/data-center/preflight.csv", "数据完整性问题.csv"); }
    catch (error) { showToast(error.message || "下载错误清单失败", "error"); }
  }));
  document.querySelectorAll(".data-preflight-view").forEach((button) => button.addEventListener("click", async () => {
    await loadPreflightDetails();
  }));
  document.querySelectorAll(".data-preflight-detail-retry").forEach((button) => button.addEventListener("click", loadPreflightDetails));
  document.querySelectorAll(".data-preflight-detail-close").forEach((button) => button.addEventListener("click", () => {
    backupState.preflightDetailsOpen = false;
    backupState.preflightDetailsError = "";
    render();
  }));
  document.querySelectorAll(".data-preflight-detail-modal").forEach((modal) => modal.addEventListener("click", (event) => {
    if (event.target !== modal) return;
    backupState.preflightDetailsOpen = false;
    backupState.preflightDetailsError = "";
    render();
  }));
  document.querySelectorAll(".preflight-account-link").forEach((button) => button.addEventListener("click", async () => {
    if (!canView("userAdmin")) return showToast("当前账号没有账号权限页面访问权限", "error");
    userAdminFocusId = Number(button.dataset.recordId || 0) || null;
    userAdminTab = "accounts";
    userAdminNotice = button.dataset.username ? `已定位需要修复角色的账号：${button.dataset.username}` : "已定位需要修复角色的账号";
    localStorage.setItem("liming:user-admin-tab", userAdminTab);
    backupState.preflightDetailsOpen = false;
    setActiveView("userAdmin");
    renderViewTransitionSkeleton();
    try { await load({ refreshGlobal: false }); }
    catch (error) { renderLoadFailure(error); }
  }));
  document.querySelectorAll(".preflight-student-stage-link, .backup-failure-student-link").forEach((button) => button.addEventListener("click", async () => {
    if (!canView("studentProfiles")) return showToast("当前账号没有学生档案访问权限", "error");
    const studentId = Number(button.dataset.studentId || 0);
    const stages = [button.dataset.stageA, button.dataset.stageB].filter(Boolean);
    studentGradeStageReturnView = "audit";
    backupState.preflightDetailsOpen = false;
    setActiveView("studentProfiles");
    renderViewTransitionSkeleton();
    try {
      await load({ refreshGlobal: false });
      revealStudentProfileConflictTarget(studentId);
      render();
      openStudentGradeStageModal(studentId, { stages, stage: stages[0] });
    } catch (error) { renderLoadFailure(error); }
  }));

  document.querySelectorAll(".backup-remote-retry").forEach((button) => button.addEventListener("click", async () => {
    try { await request(`/api/data-center/backups/${encodeURIComponent(button.dataset.id)}/remote-retry`, { method: "POST", body: {} }); await refreshBackupData(); showToast("百度网盘上传成功"); }
    catch (error) { showToast(error.message || "百度网盘上传失败", "error"); } finally { render(); }
  }));

  document.querySelectorAll(".backup-remote-download").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("该文件是未加密 Excel，包含敏感业务和账号认证数据。确认下载并妥善保管吗？")) return;
    try { await downloadBlob(`/api/data-center/backups/${encodeURIComponent(button.dataset.id)}/remote-download`, button.dataset.name || "backup.xlsx"); }
    catch (error) { showToast(error.message || "远端备份下载或 SHA-256 校验失败", "error"); }
  }));

  const backupSelectAll = document.querySelector(".backup-record-select-all");
  if (backupSelectAll) {
    const eligibleRows = (backupState.records || []).filter((row) => backupRecordDeletePolicy(row).allowed);
    const selectedCount = eligibleRows.filter((row) => selectedBackupRecordIds.has(Number(row.id))).length;
    backupSelectAll.indeterminate = selectedCount > 0 && selectedCount < eligibleRows.length;
    backupSelectAll.addEventListener("change", () => {
      if (backupSelectAll.checked) eligibleRows.forEach((row) => selectedBackupRecordIds.add(Number(row.id)));
      else eligibleRows.forEach((row) => selectedBackupRecordIds.delete(Number(row.id)));
      render();
    });
  }
  document.querySelectorAll(".backup-record-select-row").forEach((input) => input.addEventListener("change", () => {
    const id = Number(input.dataset.id);
    if (!id || input.disabled) return;
    if (input.checked) selectedBackupRecordIds.add(id);
    else selectedBackupRecordIds.delete(id);
    render();
  }));
  document.querySelectorAll(".backup-selection-clear").forEach((button) => button.addEventListener("click", () => {
    selectedBackupRecordIds.clear();
    render();
  }));
  document.querySelectorAll(".backup-batch-delete-open").forEach((button) => button.addEventListener("click", () => {
    const records = selectedBackupRecords();
    if (!records.length || button.disabled) return;
    backupBatchDeleteDialog = { records, busy: false, error: "", result: null, detailsOpen: false };
    render();
    requestAnimationFrame(() => document.querySelector(".backup-batch-delete-close")?.focus());
  }));
  document.querySelectorAll(".backup-batch-delete-close").forEach((button) => button.addEventListener("click", () => {
    if (backupBatchDeleteDialog?.busy) return;
    backupBatchDeleteDialog = null;
    render();
    requestAnimationFrame(() => document.querySelector(".backup-batch-delete-open")?.focus());
  }));
  document.querySelectorAll(".backup-batch-details-toggle").forEach((button) => button.addEventListener("click", () => {
    if (!backupBatchDeleteDialog?.result) return;
    backupBatchDeleteDialog = { ...backupBatchDeleteDialog, detailsOpen: !backupBatchDeleteDialog.detailsOpen };
    render();
  }));
  document.querySelectorAll(".backup-batch-delete-confirm").forEach((button) => button.addEventListener("click", async () => {
    const dialog = backupBatchDeleteDialog;
    if (!dialog || dialog.busy) return;
    const backupIds = dialog.records.map((row) => Number(row.id)).filter(Boolean);
    if (!backupIds.length) return;
    backupBatchDeleteDialog = { ...dialog, busy: true, error: "" };
    render();
    try {
      const result = await request("/api/data-center/backups/batch-delete", { method: "POST", body: { backup_ids: backupIds } });
      const deletedIds = new Set((result.results || []).filter((item) => item.status === "deleted").map((item) => Number(item.backup_id)));
      const protectedIds = new Set((result.results || []).filter((item) => item.status === "protected").map((item) => Number(item.backup_id)));
      deletedIds.forEach((id) => {
        selectedBackupRecordIds.delete(id);
        document.querySelector(`tr[data-backup-id="${selectorEscape(id)}"]`)?.remove();
      });
      protectedIds.forEach((id) => selectedBackupRecordIds.delete(id));
      backupState.records = (backupState.records || []).filter((row) => !deletedIds.has(Number(row.id)));
      backupBatchDeleteDialog = { ...dialog, busy: false, error: "", result, detailsOpen: false };
      showToast(`已处理${result.selected_count || 0}条：删除${result.deleted_count || 0}条，失败${result.failed_count || 0}条，受保护${result.protected_count || 0}条。`, result.failed_count || result.protected_count ? "error" : "success");
    } catch (error) {
      backupBatchDeleteDialog = { ...dialog, busy: false, error: error.message || "批量删除备份失败", result: null };
    }
    render();
  }));
  document.querySelectorAll(".backup-batch-delete-modal").forEach((modal) => modal.addEventListener("click", (event) => {
    if (event.target !== modal || backupBatchDeleteDialog?.busy) return;
    backupBatchDeleteDialog = null;
    render();
  }));

  document.querySelectorAll(".backup-delete").forEach((button) => button.addEventListener("click", () => {
    const record = (backupState.records || []).find((row) => Number(row.id) === Number(button.dataset.id));
    if (!record) return showToast("备份记录不存在", "error");
    backupState.deleteDialog = { record, busy: false, error: "", result: null };
    render();
    requestAnimationFrame(() => document.querySelector(".backup-delete-cancel")?.focus());
  }));
  document.querySelectorAll(".backup-delete-cancel").forEach((button) => button.addEventListener("click", () => {
    if (backupState.deleteDialog?.busy) return;
    const id = backupState.deleteDialog?.record?.id;
    backupState.deleteDialog = null;
    render();
    requestAnimationFrame(() => document.querySelector(`.backup-delete[data-id="${selectorEscape(id)}"]`)?.focus());
  }));
  document.querySelectorAll(".backup-delete-confirm").forEach((button) => button.addEventListener("click", async () => {
    const dialog = backupState.deleteDialog;
    if (!dialog || dialog.busy) return;
    const id = dialog.record.id;
    backupState.deleteDialog = { ...dialog, busy: true, error: "" };
    render();
    try {
      const result = await request(`/api/data-center/backups/${encodeURIComponent(id)}`, { method: "DELETE", body: {} });
      selectedBackupRecordIds.delete(Number(id));
      backupState.records = (backupState.records || []).filter((row) => Number(row.id) !== Number(id));
      document.querySelector(`.backup-delete[data-id="${selectorEscape(id)}"]`)?.closest("tr")?.remove();
      await refreshBackupData({ tolerateFailure: true });
      backupState.deleteDialog = null;
      showToast(result.deleted ? "备份文件和记录已删除" : "删除未完成");
    } catch (error) {
      backupState.deleteDialog = { ...dialog, busy: false, error: error.message || "删除备份失败", result: error.data || null };
    }
    render();
  }));
  document.querySelectorAll(".backup-delete-modal").forEach((modal) => modal.addEventListener("click", (event) => {
    if (event.target !== modal || backupState.deleteDialog?.busy) return;
    const id = backupState.deleteDialog?.record?.id;
    backupState.deleteDialog = null;
    render();
    requestAnimationFrame(() => document.querySelector(`.backup-delete[data-id="${selectorEscape(id)}"]`)?.focus());
  }));
  if (!backupDeleteEventsBound) {
    backupDeleteEventsBound = true;
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (backupState.fileBrowser?.open) {
        event.preventDefault();
        backupState.fileBrowser = { ...backupState.fileBrowser, open: false, generation: backupState.fileBrowser.generation + 1 };
        render();
        return;
      }
      if (backupBatchDeleteDialog && !backupBatchDeleteDialog.busy) {
        event.preventDefault();
        backupBatchDeleteDialog = null;
        render();
        return;
      }
      if (!backupState.deleteDialog || backupState.deleteDialog.busy) return;
      event.preventDefault();
      const id = backupState.deleteDialog.record?.id;
      backupState.deleteDialog = null;
      render();
      requestAnimationFrame(() => document.querySelector(`.backup-delete[data-id="${selectorEscape(id)}"]`)?.focus());
    });
  }

  document.querySelectorAll(".baidu-connect").forEach((button) => button.addEventListener("click", async () => {
    try { const result = await request("/api/data-center/baidu/authorize", { method: "POST", body: {} }); window.location.assign(result.authorization_url); }
    catch (error) { showToast(error.message || "无法发起百度授权", "error"); }
  }));
  document.querySelectorAll(".baidu-test").forEach((button) => button.addEventListener("click", async () => {
    const draft = markBackupDraftFromDom();
    try { const result = await request("/api/data-center/baidu/test", { method: "POST", body: { remote_directory: draft.remote_directory } }); backupState.baiduTestDetails = result; await refreshBackupData(); showToast(result.cleanup_ok ? "百度连接、下载校验和测试文件清理均已通过" : "连接及完整性测试通过，但测试文件清理失败", result.cleanup_ok ? "success" : "error"); }
    catch (error) { backupState.baiduTestDetails = error.data || { code: error.message, stage: "unknown", steps: {}, cleanup: { complete: false } }; const detail = error.data || {}; showToast(baiduTestFailureMessage(detail), "error"); }
    finally { render(); }
  }));
  document.querySelectorAll(".baidu-disconnect").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("确认解除百度网盘授权？服务器本地备份不会删除。")) return;
    try { await request("/api/data-center/baidu/disconnect", { method: "POST", body: {} }); await refreshBackupData(); showToast("百度网盘授权已解除"); }
    catch (error) { showToast(error.message || "解除授权失败", "error"); } finally { render(); }
  }));
  document.querySelectorAll(".baidu-guide-open").forEach((button) => button.addEventListener("click", () => { backupState.showBaiduGuide = true; render(); }));
  document.querySelectorAll(".baidu-guide-close").forEach((button) => button.addEventListener("click", () => { backupState.showBaiduGuide = false; render(); }));
  document.querySelectorAll(".baidu-guide-modal").forEach((modal) => modal.addEventListener("click", (event) => { if (event.target === modal) { backupState.showBaiduGuide = false; render(); } }));
  document.querySelectorAll(".baidu-copy-callback").forEach((button) => button.addEventListener("click", async () => {
    const value = backupState.baidu?.redirect_uri || "";
    if (!value) return;
    try { await navigator.clipboard.writeText(value); showToast("回调地址已复制"); } catch { showToast("复制失败，请手动选择地址", "error"); }
  }));
  document.querySelectorAll(".baidu-config-save").forEach((button) => button.addEventListener("click", async () => {
    const body = {
      app_key: document.querySelector(".baidu-config-app-key")?.value || "",
      app_secret: document.querySelector(".baidu-config-app-secret")?.value || "",
    };
    button.disabled = true;
    try { await request("/api/data-center/baidu/config", { method: "PUT", body }); await refreshBackupData(); backupState.showBaiduGuide = false; backupState.baiduConfigEditing = false; showToast("百度应用配置已保存，请继续授权"); }
    catch (error) { showToast(error.message || "百度配置保存失败", "error"); }
    finally { render(); }
  }));
  document.querySelectorAll(".baidu-config-edit").forEach((button) => button.addEventListener("click", () => { backupState.baiduConfigEditing = true; render(); }));
  document.querySelectorAll(".baidu-config-edit-cancel").forEach((button) => button.addEventListener("click", () => { backupState.baiduConfigEditing = false; render(); }));
  document.querySelectorAll(".baidu-test-detail-open").forEach((button) => button.addEventListener("click", () => { backupState.baiduTestDetailsOpen = true; render(); }));
  document.querySelectorAll(".baidu-test-detail-close").forEach((button) => button.addEventListener("click", () => { backupState.baiduTestDetailsOpen = false; render(); }));
  document.querySelectorAll(".baidu-backup-now").forEach((button) => button.addEventListener("click", async () => {
    markBackupDraftFromDom(); backupState.busy = true; render();
    try {
      const result = await request("/api/data-center/baidu/backups", { method: "POST", body: {} });
      backupState.records = [result.record, ...(backupState.records || []).filter((row) => Number(row.id) !== Number(result.backup_id))];
      showToast(result.duplicate ? "已有百度备份任务正在执行" : "百度备份任务已开始，可在记录中查看进度");
      void pollBackupJob(result.job_id);
    }
    catch (error) { showToast(error.message || "百度网盘备份失败", "error"); }
    finally { backupState.busy = false; render(); }
  }));
  document.querySelectorAll(".baidu-config-clear").forEach((button) => button.addEventListener("click", async () => {
    const password = prompt("请输入当前老板密码"); if (password == null) return;
    const confirmation = prompt("请输入确认文字：清除百度配置"); if (confirmation == null) return;
    try { await request("/api/data-center/baidu/config", { method: "DELETE", body: { password, confirmation } }); await refreshBackupData(); backupState.showBaiduGuide = true; showToast("百度配置和授权已清除"); }
    catch (error) { showToast(error.message || "清除配置失败", "error"); }
    finally { render(); }
  }));

  document.querySelectorAll(".user-admin-tab").forEach((button) => {
    button.addEventListener("click", () => {
      userAdminTab = button.dataset.tab || "accounts";
      userCreateModalOpen = false;
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

  document.querySelectorAll(".user-create-modal-region").forEach(bindUserCreateModalRegion);
  document.querySelectorAll(".open-user-create-modal").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled || !canWriteData()) return;
      userCreateModalOpen = true;
      updateUserCreateModalRegion();
    });
  });
  document.querySelectorAll(".user-row").forEach(bindUserAccountRowEvents);

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

  document.querySelectorAll(".user-reset-password-legacy-handler").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest(".user-row");
      const password = row.querySelector(".user-reset-password-value")?.value || "";
      if (password.length < 6) return alert("新密码至少 6 位");
      await request(`/api/users/${row.dataset.id}/password`, { method: "POST", body: { password } });
      userAdminNotice = "密码已重置。";
      rerenderContent(renderUserAdmin);
    });
  });
  document.querySelectorAll(".user-delete-legacy-handler").forEach((button) => {
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

  document.querySelectorAll(".multi-select-value.lesson-filter-multi").forEach((input) => {
    input.addEventListener("change", async () => {
      const field = input.dataset.filterField;
      focusedLessonIds = [];
      const selectedNames = normalizeNameList(input.value || "");
      const nextFilter = {
        ...lessonFilter,
        month_key: lessonFilter.month_key || state.settings.month_key,
        date_preset_initialized: true,
      };
      if (field === "teacher_names") {
        nextFilter.teacher = selectedNames.join("、");
        nextFilter.teacher_names = selectedNames;
      } else if (field === "student_names") {
        nextFilter.student = selectedNames.join("、");
        nextFilter.student_names = selectedNames;
      } else {
        return;
      }
      lessonFilter = nextFilter;
      saveLessonFilter();
      await refreshLessonsView({ reloadRange: field === "student_names" });
    });
  });

  document.querySelectorAll(".lesson-filter-input:not(.multi-select-toggle)").forEach((input) => {
    const applyLessonFilter = async (value = input.value, rerender = true) => {
      const field = input.dataset.filterField;
      const monthKey = lessonFilter.month_key || state.settings.month_key;
      focusedLessonIds = [];
      lessonFilter = {
        ...lessonFilter,
        month_key: monthKey,
        [field]: value,
        date_preset_initialized: true,
      };
      saveLessonFilter();
      if (rerender) {
        await refreshLessonsView({ reloadRange: (field === "start_date" || field === "end_date") && !lessonRangeLoaded() });
      }
    };

    if (input.tagName === "SELECT" || input.type === "date" || input.type === "hidden") {
      input.addEventListener("change", () => applyLessonFilter(input.value, true));
      return;
    }

    bindSafeTextInput(input, (value) => {
      applyLessonFilter(value, false);
    }, async () => {
      await refreshLessonsView({ reloadRange: (input.dataset.filterField === "start_date" || input.dataset.filterField === "end_date") && !lessonRangeLoaded() });
    }, 650);
  });

  document.querySelectorAll("input.fee-details-filter-input").forEach((input) => {
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

  document.querySelectorAll("input.summary-filter-input").forEach((input) => {
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

  document.querySelectorAll("input.student-pricing-filter-input").forEach((input) => {
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

  document.querySelectorAll("input.class-group-filter-input").forEach((input) => {
    const applyClassGroupFilter = (value) => {
      classGroupFilter = { ...classGroupFilter, [input.dataset.filterField]: value };
    };
    bindSafeTextInput(input, applyClassGroupFilter, () => render());
  });

  document.querySelectorAll(".reset-class-group-filter").forEach((button) => {
    button.addEventListener("click", () => {
      classGroupFilter = { teacher: "", grade: "", subject: "", student: "" };
      render();
    });
  });

  document.querySelectorAll(".class-group-hide-inactive").forEach((input) => {
    input.addEventListener("change", () => {
      classGroupHideInactiveTeachers = input.checked;
      localStorage.setItem(CLASS_GROUP_HIDE_INACTIVE_TEACHERS_KEY, classGroupHideInactiveTeachers ? "1" : "0");
      render();
    });
  });

  document.querySelectorAll(".class-group-field").forEach((input) => {
    input.addEventListener("change", async () => {
      const id = Number(input.dataset.id);
      if (!id) return;
      input.disabled = true;
      try {
        const result = await request(`/api/class-groups/${id}`, {
          method: "PATCH",
          body: { class_name: input.value },
        });
        state.class_groups = (state.class_groups || []).map((row) => Number(row.id) === id ? { ...row, ...(result.row || {}) } : row);
        showToast("班级名已保存");
      } catch (error) {
        showToast(error.message || "班级名保存失败", "error");
        const row = (state.class_groups || []).find((item) => Number(item.id) === id);
        input.value = row?.class_name || "";
      } finally {
        input.disabled = isReadonlyUser();
      }
    });
  });

  document.querySelectorAll(".reset-lesson-filter").forEach((button) => {
    button.addEventListener("click", async () => {
      const hadStudentSelection = normalizeNameList(lessonFilter.student_names || []).length > 0;
      focusedLessonIds = [];
      resetLessonFilter();
      await refreshLessonsView({ reloadRange: hadStudentSelection || !lessonRangeLoaded() });
    });
  });

  document.querySelectorAll(".lesson-date-shortcut").forEach((button) => {
    button.addEventListener("click", async () => {
      const range = lessonDateShortcutRange(button.dataset.preset);
      if (!range?.start || !range?.end) return;
      focusedLessonIds = [];
      lessonFilter = { ...lessonFilter, start_date: range.start, end_date: range.end, date_preset_initialized: true };
      saveLessonFilter();
      await refreshLessonsView({ reloadRange: !lessonRangeLoaded() });
    });
  });

  if (!lessonConflictEventsBound) {
    lessonConflictEventsBound = true;
    contentEl.addEventListener("change", (event) => {
      const dateInput = event.target.closest?.(".lesson-conflict-edit-modal .conflict-edit-field[data-field=\"date\"]");
      if (dateInput) {
        const value = String(dateInput.value || "").trim();
        if (value && !isDateValue(value)) dateInput.setAttribute("aria-invalid", "true");
        else dateInput.removeAttribute("aria-invalid");
        if (value && !isDateValue(value)) {
          showToast("请输入 YYYY-MM-DD 格式的有效日期", "error");
          return;
        }
        refreshConflictLessonEditorForDate(dateInput.closest(".lesson-conflict-edit-modal"));
        return;
      }
      const studentInput = event.target.closest?.(".lesson-conflict-edit-modal .multi-select-value.conflict-edit-students");
      if (studentInput && lessonConflictEditDraft) {
        lessonConflictEditDraft.student_names = normalizeLessonStudentNames(studentInput.value);
      }
    });
    contentEl.addEventListener("click", (event) => {
      const target = event.target;
      const conflictButton = target.closest(".lesson-conflict-btn");
      if (conflictButton) {
        event.preventDefault();
        if (!conflictButton.disabled) openVisibleLessonConflictsModal();
        return;
      }
      const closeButton = target.closest(".lesson-conflict-modal-close");
      if (closeButton) {
        event.preventDefault();
        closeVisibleLessonConflictsModal();
        return;
      }
      const editButton = target.closest(".conflict-edit-lesson");
      if (editButton) {
        event.preventDefault();
        if (!editButton.disabled) openConflictLessonEditor(editButton.dataset.lessonId);
        return;
      }
      const editCancelButton = target.closest(".conflict-edit-cancel");
      if (editCancelButton) {
        event.preventDefault();
        closeConflictLessonEditor();
        return;
      }
      const editSaveButton = target.closest(".conflict-edit-save");
      if (editSaveButton) {
        event.preventDefault();
        saveConflictLessonEditor(editSaveButton);
        return;
      }
      if (target.classList?.contains("lesson-conflict-edit-modal")) {
        closeConflictLessonEditor();
      } else if (target.classList?.contains("lesson-conflict-modal")) {
        closeVisibleLessonConflictsModal();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (event.target instanceof Element && event.target.closest(".custom-select-menu, .multi-select-menu, .custom-date-picker, .date-range-picker-panel")) {
        closeSearchablePicker();
        return;
      }
      if (lessonConflictEditDraft) {
        event.preventDefault();
        closeConflictLessonEditor();
      } else if (lessonConflictModalOpen) {
        event.preventDefault();
        closeVisibleLessonConflictsModal();
      }
    });
  }

  document.querySelectorAll(".clear-focused-lessons").forEach((button) => {
    button.addEventListener("click", () => {
      focusedLessonIds = [];
      updateLessonsViewDom();
    });
  });

  // 矩阵课表中的旧冲突摘要仍保留“定位课程”能力；课程总表弹窗本身已改为独立编辑弹窗。
  document.querySelectorAll(".schedule-conflict-panel .conflict-focus").forEach((button) => {
    button.addEventListener("click", () => {
      focusedLessonIds = String(button.dataset.lessonIds || "").split(",").map(Number).filter(Boolean);
      if (!focusedLessonIds.length) return;
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
        state.settings = { ...(state.settings || {}), month_key: activeMonth };
        state.active_month_key = activeMonth;
      } else {
        alert(`已复制 ${result.created} 节课。`);
      }
    } else {
      alert(`已复制 ${result.created} 节课。`);
    }
    markLessonDerivedDataDirty();
    await refreshLessonsView({ reloadRange: true });
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
        markLessonDerivedDataDirty();
        await refreshLessonsView({ reloadRange: true });
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
      updateLessonsViewDom({ refreshSummary: false, refreshFilter: false, refreshToolbar: false, refreshTable: false, refreshModals: true });
    });
  });

  document.querySelectorAll(".batch-copy-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      lessonBatchCopyDraft = null;
      updateLessonsViewDom({ refreshSummary: false, refreshFilter: false, refreshToolbar: false, refreshTable: false, refreshModals: true });
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
      updateLessonsViewDom({ refreshSummary: false, refreshFilter: false, refreshToolbar: false, refreshTable: false, refreshModals: true });
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
      if (field === "date") updateLessonsViewDom({ refreshSummary: false, refreshFilter: false, refreshToolbar: false, refreshTable: false, refreshModals: true });
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
          const rawTimeSlot = String(row.time_slot || "").trim();
          const timeSlot = rawTimeSlot ? normalizeTimeSlot(rawTimeSlot) : "";
          if (rawTimeSlot && !timeSlot) throw new Error(`时间格式无效：${rawTimeSlot}。请使用 HH:mm-HH:mm，例如 08:30-10:30`);
          const payload = {
            teacher_name: row.teacher_name || "",
            date: row.date,
            month_key: monthKeyFromDateValue(row.date) || state.settings.month_key,
            status: row.status || "待上",
            time_slot: timeSlot,
            classroom: row.classroom || "",
            grade: row.grade || "",
            subject: row.subject || "",
            student_names: normalizeLessonStudentNames(row.student_names || ""),
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
      updateLessonsViewDom({ refreshSummary: false, refreshFilter: false, refreshToolbar: false, refreshTable: false, refreshModals: true });
    });
  });

  document.querySelectorAll(".week-copy-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      weekCopyDraft = null;
      updateLessonsViewDom({ refreshSummary: false, refreshFilter: false, refreshToolbar: false, refreshTable: false, refreshModals: true });
    });
  });

  document.querySelectorAll(".week-copy-source").forEach((input) => {
    input.addEventListener("change", () => {
      const sourceStart = startOfWeek(input.value);
      weekCopyDraft = { ...weekCopyDraft, sourceStart, targetStart: addDays(sourceStart, 7) };
      updateLessonsViewDom({ refreshSummary: false, refreshFilter: false, refreshToolbar: false, refreshTable: false, refreshModals: true });
    });
  });

  document.querySelectorAll(".week-copy-target").forEach((input) => {
    input.addEventListener("change", () => {
      weekCopyDraft = { ...weekCopyDraft, targetStart: startOfWeek(input.value) };
      updateLessonsViewDom({ refreshSummary: false, refreshFilter: false, refreshToolbar: false, refreshTable: false, refreshModals: true });
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
    if (button.dataset.scheduleModeBound === "true") return;
    button.dataset.scheduleModeBound = "true";
    button.addEventListener("click", () => {
      const startedAt = performance.now();
      const scroll = captureLessonScroll();
      const focused = document.activeElement?.closest?.(".lesson-field");
      const focus = focused ? { id: focused.dataset.id, field: focused.dataset.field } : null;
      const drafts = captureLessonDrafts();
      scheduleMode = !scheduleMode;
      logClientOperation(scheduleMode ? "schedule_mode_start" : "schedule_mode_end", {
        content: `${scheduleMode ? "开始" : "结束"}排课：当前筛选 ${visibleLessonRows().length} 节课程`,
        target_type: "lessons",
        target_id: activeMonth || "",
        details: { month_key: activeMonth, visible_lessons: visibleLessonRows().length, start: lessonFilter.start_date || "", end: lessonFilter.end_date || "" },
      });
      button.classList.toggle("primary", scheduleMode);
      button.textContent = scheduleMode ? "结束排课" : "开始排课";
      reRenderLessonsTbody();
      restoreLessonScroll(scroll);
      restoreLessonDrafts(drafts);
      if (focus?.id && focus?.field) requestAnimationFrame(() => {
        document.querySelector(`.lesson-field[data-id="${selectorEscape(focus.id)}"][data-field="${selectorEscape(focus.field)}"]`)?.focus({ preventScroll: true });
      });
      requestAnimationFrame(() => {
        if (PERF_LOG) console.info(`[performance] ${scheduleMode ? "enter" : "exit"} schedule mode: ${(performance.now() - startedAt).toFixed(1)}ms`);
      });
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
        markLessonDerivedDataDirty();
        await refreshLessonsView({ reloadRange: true });
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
    contentEl.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-lesson-edit-trigger]");
      if (!trigger || !contentEl.contains(trigger) || trigger.getAttribute("aria-disabled") === "true") return;
      event.preventDefault();
      event.stopPropagation();
      openScheduleInlinePicker(trigger);
    });
    contentEl.addEventListener("keydown", (event) => {
      if (!(["Enter", " ", "Spacebar"].includes(event.key))) return;
      const trigger = event.target.closest("[data-lesson-edit-trigger]");
      if (!trigger || !contentEl.contains(trigger) || trigger.getAttribute("aria-disabled") === "true") return;
      event.preventDefault();
      openScheduleInlinePicker(trigger);
    });
    contentEl.addEventListener("change", (event) => {
      const input = event.target.closest(".lesson-field");
      if (!input) return;
      handleLessonFieldChange(input);   /* [约束3] 配置表驱动，A/B/C 三档分派 */
    });
  }

  if (!scheduleInlinePickerEventsBound) {
    scheduleInlinePickerEventsBound = true;
    document.addEventListener("click", (event) => {
      if (!activeScheduleInlinePicker) return;
      if (event.target.closest("[data-lesson-edit-trigger], .custom-select, .custom-select-menu")) return;
      closeScheduleInlinePicker();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && activeScheduleInlinePicker) closeScheduleInlinePicker({ restoreFocus: true });
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
      const studentBadge = event.target.closest(".student-badge-removable[data-lesson-id][data-student-name]");
      if (studentBadge) {
        if (studentBadge.disabled || isReadonlyUser()) return;
        event.preventDefault();
        event.stopPropagation();
        const lessonId = studentBadge.dataset.lessonId;
        const studentName = studentBadge.dataset.studentName;
        const hidden = document.querySelector(`.lesson-field[data-id="${selectorEscape(lessonId)}"][data-field="student_names"]`);
        if (!hidden) return;
        hidden.value = normalizeLessonStudentNames(normalizeNameList(hidden.value).filter((name) => name !== studentName).join("、"));
        studentBadge.remove();
        hidden.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
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
        row.teacher_name === selectedTeacherDetail
        && teacherDetailMatchesFilter(row)
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
      if (!confirm("将把所选课程的教师薪资更新为当前薪资规则计算值，已有手动薪资也会被覆盖。是否继续？")) return;
      button.disabled = true;
      try {
        const result = await request("/api/teacher-salary-rules/apply-selected", {
          method: "POST",
          body: { lesson_ids: ids },
        });
        teacherSalaryBatchResult = result;
        const keepSelected = new Set(
          (result.results || [])
            .filter((item) => item.status === "skipped" || item.status === "failed")
            .map((item) => Number(item.lesson_id))
            .filter(Boolean),
        );
        selectedTeacherSalaryLessonIds = keepSelected;
        const scrollY = window.scrollY;
        await load({ refreshGlobal: false });
        requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "auto" }));
        showToast(`已处理${result.selected_count}节课：更新${result.updated_count}节，无需更新${result.unchanged_count}节，跳过${result.skipped_count}节。`, result.failed_count ? "error" : "success");
      } catch (error) {
        button.disabled = false;
        alert(`按规则更新失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll("input.teacher-detail-filter-input").forEach((input) => {
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

  document.querySelectorAll("input.teacher-detail-teacher-select").forEach((select) => {
    select.addEventListener("change", async () => {
      selectedTeacherDetail = select.value;
      teacherDetailFilter = { grade: "", subject: "", student: "", source: "", rule_status: "" };
      selectedTeacherSalaryLessonIds = new Set();
      teacherSalaryBatchResult = null;
      if (!selectedTeacherDetail) {
        state.lessons = [];
        render();
        return;
      }
      try {
        await load({ refreshGlobal: false });
      } catch (error) {
        renderLoadFailure(error);
      }
    });
  });

  document.querySelectorAll(".add-lesson").forEach((button) => {
    if (button.dataset.lessonCreateOpenBound === "true") return;
    button.dataset.lessonCreateOpenBound = "true";
    button.addEventListener("click", () => {
      const startedAt = performance.now();
      lessonCreateDraft = defaultLessonCreateDraft();
      lessonCreateConflictRows = [];
      lessonCreateConflictRequest += 1;
      // Keep the table, filters and summary in place; only mount the modal region.
      updateLessonsViewDom({ refreshSummary: false, refreshFilter: false, refreshToolbar: false, refreshTable: false, refreshModals: true });
      requestAnimationFrame(() => console.info(`[performance] open add-lesson modal: ${(performance.now() - startedAt).toFixed(1)}ms`));
    });
  });

  document.querySelectorAll(".lesson-create-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      lessonCreateDraft = null;
      lessonCreateConflictRows = [];
      lessonCreateConflictRequest += 1;
      updateLessonsViewDom({ refreshSummary: false, refreshFilter: false, refreshToolbar: false, refreshTable: false, refreshModals: true });
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
      const modal = input.closest(".lesson-create-modal");
      const field = input.dataset.field;
      if (Object.prototype.hasOwnProperty.call(LESSON_MANUAL_FIELD_LABELS, field)) {
        const manualInput = modal?.querySelector(`.lesson-create-manual-field[data-manual-field="${field}"]`);
        if (manualInput) {
          const isManual = input.value === LESSON_CREATE_MANUAL_VALUE;
          manualInput.classList.toggle("hidden", !isManual);
          if (isManual) manualInput.focus();
          else manualInput.value = "";
        }
      }
      if (field === "date") {
        lessonCreateConflictRows = [];
        refreshLessonCreateConflictRows(modal);
      } else {
        refreshLessonCreateConflictUi(modal);
      }
    });
  });

  document.querySelectorAll(".lesson-create-modal").forEach((modal) => {
    if (modal.dataset.conflictRangeLoaded === "true") return;
    modal.dataset.conflictRangeLoaded = "true";
    refreshLessonCreateConflictRows(modal);
  });

  document.querySelectorAll(".lesson-create-manual-field").forEach((input) => {
    let composing = false;
    const update = () => refreshLessonCreateConflictUi(input.closest(".lesson-create-modal"));
    input.addEventListener("compositionstart", () => {
      composing = true;
    });
    input.addEventListener("compositionend", () => {
      composing = false;
      update();
    });
    input.addEventListener("input", () => {
      if (!composing) update();
    });
    input.addEventListener("change", update);
  });

  document.querySelectorAll(".lesson-create-student-search").forEach((input) => {
    let composing = false;
    const applySearch = () => filterLessonCreateStudents(input.closest(".lesson-create-modal"), input.value);
    input.addEventListener("compositionstart", () => {
      composing = true;
    });
    input.addEventListener("compositionend", () => {
      composing = false;
      applySearch();
    });
    input.addEventListener("input", () => {
      if (!composing) applySearch();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") event.preventDefault();
    });
  });

  document.querySelectorAll(".lesson-create-student-existing").forEach((input) => {
    input.addEventListener("change", () => {
      const modal = input.closest(".lesson-create-modal");
      updateLessonCreateStudentStats(modal);
      refreshLessonCreateConflictUi(modal);
    });
  });

  document.querySelectorAll(".lesson-create-new-students").forEach((input) => {
    let composing = false;
    const update = () => refreshLessonCreateConflictUi(input.closest(".lesson-create-modal"));
    input.addEventListener("compositionstart", () => {
      composing = true;
    });
    input.addEventListener("compositionend", () => {
      composing = false;
      update();
    });
    input.addEventListener("input", () => {
      if (!composing) update();
    });
    input.addEventListener("change", update);
  });

  document.querySelectorAll(".lesson-create-confirm").forEach((button) => {
    button.addEventListener("click", async () => {
      const modal = button.closest(".lesson-create-modal");
      const fieldValue = (field) => String(modal?.querySelector(`.lesson-create-field[data-field="${field}"]`)?.value || "").trim();
      const date = fieldValue("date");
      if (!isDateValue(date)) return alert("请选择有效的课程日期");
      button.disabled = true;
      try {
        const rawTimeSlot = lessonCreateSelectValue(modal, "time_slot", "请填写新时间");
        const timeSlot = normalizeTimeSlot(rawTimeSlot);
        if (!timeSlot) throw new Error("时间格式无效，请使用 HH:mm-HH:mm，例如 08:30-10:30");
        const teacherName = lessonCreateSelectValue(modal, "teacher_name", "请填写新老师名称");
        const classroom = lessonCreateSelectValue(modal, "classroom", "请填写新教室名称");
        const grade = lessonCreateSelectValue(modal, "grade", "请填写新年级名称");
        const subject = lessonCreateSelectValue(modal, "subject", "请填写新科目名称");
        const status = lessonCreateSelectValue(modal, "status", "请填写新状态") || "待上";
        const selectedStudents = lessonCreateSelectedStudentNames(modal);
        const newStudents = parseLessonCreateStudents(modal.querySelector(".lesson-create-new-students")?.value);
        const studentNames = normalizeNameList([...selectedStudents, ...newStudents]);
        const payload = {
          date,
          month_key: monthKeyFromDateValue(date) || state.settings.month_key,
          time_slot: timeSlot,
          teacher_name: teacherName,
          classroom,
          grade,
          subject,
          student_names: normalizeLessonStudentNames(studentNames.join("、")),
          notes: fieldValue("notes"),
          status,
        };
        const localConflict = buildLessonCandidateConflict(payload);
        if (localConflict.conflict) {
          const related = (localConflict.reasons || []).slice(0, 5)
            .map((reason) => `${conflictTypeLabel(reason.type)}${reason.entity ? `：${reason.entity}` : ""}${reason.lesson_label ? `\n  ${reason.lesson_label}` : ""}`)
            .join("\n");
          if (!confirm(`当前课程与已有课程存在冲突：\n${related}\n\n仍要确认新增吗？`)) {
            button.disabled = false;
            return;
          }
          payload.allow_conflicts = true;
        }
        let lesson;
        try {
          lesson = await request("/api/lessons", { method: "POST", body: payload });
        } catch (error) {
          const serverConflicts = error?.data?.schedule_conflicts;
          if (error?.status !== 409 || !serverConflicts?.issue_count) throw error;
          const details = (serverConflicts.issues || []).slice(0, 5)
            .map((issue) => `${conflictTypeLabel(issue.type)}${issue.entity ? `：${issue.entity}` : ""}${issue.lessons?.[0] ? `\n  ${issue.lessons[0]}` : ""}`)
            .join("\n");
          if (!confirm(`服务端发现最新冲突：\n${details}\n\n仍要确认新增吗？`)) {
            button.disabled = false;
            return;
          }
          lesson = await request("/api/lessons", { method: "POST", body: { ...payload, allow_conflicts: true } });
        }
        lessonCreateDraft = null;
        lessonCreateConflictRows = [];
        lessonCreateConflictRequest += 1;
        markLessonDerivedDataDirty();
        await refreshLessonsView({ reloadRange: true });
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
      refreshAfter(() => request(`/api/lessons/${button.dataset.id}`, { method: "DELETE" }), async () => {
        markLessonDerivedDataDirty();
        await refreshLessonsView({ reloadRange: true });
      });
    });
  });

  document.querySelectorAll(".week-tab").forEach((button) => {
    button.addEventListener("click", async () => {
      activeWeek = Number(button.dataset.week);
      localStorage.setItem("liming:week", String(activeWeek));
      localStorage.setItem(WEEK_USER_SET_KEY, "1");
      if (view === "weekMatrix") {
        matrixRange = currentMatrixRange(state.settings.month_key || activeMonth);
        localStorage.setItem(MATRIX_RANGE_USER_SET_KEY, "1");
        saveMatrixRange();
        await load();
        return;
      }
      render();
    });
  });

  document.querySelectorAll(".matrix-range-reset").forEach((button) => {
    button.addEventListener("click", async () => {
      matrixRange = currentMatrixRange(state.settings.month_key || activeMonth);
      localStorage.setItem(MATRIX_RANGE_USER_SET_KEY, "1");
      saveMatrixRange();
      await load();
    });
  });

  document.querySelectorAll(".matrix-view-tab").forEach((button) => {
    button.addEventListener("click", () => {
      switchMatrixViewOnly(button.dataset.matrixView || "time");
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
          channel: row.dataset.channel || "",
          channel_other: row.dataset.channelOther || "",
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

  document.querySelectorAll("input.teacher-salary-rule-filter-input").forEach((input) => {
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

  document.querySelectorAll(".teacher-salary-rule-select-row").forEach((input) => {
    input.addEventListener("change", () => {
      const id = Number(input.dataset.id);
      if (input.checked) selectedTeacherSalaryRuleIds.add(id);
      else selectedTeacherSalaryRuleIds.delete(id);
      render();
    });
  });
  document.querySelectorAll(".teacher-salary-rule-select-all").forEach((input) => {
    const visibleIds = [...document.querySelectorAll(".teacher-salary-rule-select-row")].map((item) => Number(item.dataset.id));
    const selectedCount = visibleIds.filter((id) => selectedTeacherSalaryRuleIds.has(id)).length;
    input.indeterminate = selectedCount > 0 && selectedCount < visibleIds.length;
    input.addEventListener("change", () => {
      for (const id of visibleIds) {
        if (input.checked) selectedTeacherSalaryRuleIds.add(id);
        else selectedTeacherSalaryRuleIds.delete(id);
      }
      render();
    });
  });
  document.querySelectorAll(".clear-teacher-salary-rule-selection").forEach((button) => button.addEventListener("click", () => {
    selectedTeacherSalaryRuleIds = new Set();
    render();
  }));
  document.querySelectorAll(".open-teacher-salary-rule-batch-modal").forEach((button) => button.addEventListener("click", () => {
    if (!selectedTeacherSalaryRuleIds.size || !canWriteData()) return;
    teacherSalaryRuleBatchModalOpen = true;
    render();
  }));
  document.querySelectorAll(".close-teacher-salary-rule-batch-modal").forEach((button) => button.addEventListener("click", () => {
    teacherSalaryRuleBatchModalOpen = false;
    render();
  }));
  document.querySelectorAll(".teacher-salary-rule-batch-modal").forEach((modal) => modal.addEventListener("click", (event) => {
    if (event.target !== modal) return;
    teacherSalaryRuleBatchModalOpen = false;
    render();
  }));
  document.querySelectorAll(".confirm-teacher-salary-rule-batch").forEach((button) => button.addEventListener("click", async () => {
    const value = document.querySelector(".teacher-salary-rule-batch-value")?.value ?? "";
    const salary = Number(value);
    if (!Number.isFinite(salary) || salary < 0 || salary > 100000 || Math.abs(salary * 100 - Math.round(salary * 100)) >= 1e-8) {
      return showToast("薪资须为 0 到 100000 之间且最多两位小数", "error");
    }
    const ids = [...selectedTeacherSalaryRuleIds];
    button.disabled = true;
    try {
      const result = await request("/api/teacher-salary-rules/batch", {
        method: "PATCH",
        body: { ids, salary },
      });
      for (const row of result.rows || []) state.teacher_salary_rules = upsertById(state.teacher_salary_rules || [], row);
      for (const row of result.rows || []) selectedTeacherSalaryRuleIds.delete(Number(row.id));
      teacherSalaryRuleBatchModalOpen = false;
      for (const key of ["teacherSummary", "summary", "finance"]) markDirty(key);
      rerenderCurrentView(renderTeacherSalaryRules);
      showToast(`已处理 ${result.processed || ids.length} 条：成功 ${result.success || 0} 条，失败 ${(result.failed || []).length} 条。`);
    } catch (error) {
      button.disabled = false;
      const failed = Array.isArray(error.data?.failed) ? error.data.failed : [{ message: error.message || "批量设置薪资失败" }];
      const box = document.querySelector(".teacher-salary-rule-batch-modal .batch-pricing-result");
      if (box) {
        box.innerHTML = `<strong>已处理 ${escapeHtml(error.data?.processed ?? ids.length)} 条：成功 ${escapeHtml(error.data?.success || 0)} 条，失败 ${escapeHtml(failed.length)} 条。</strong>${failed.map((item) => {
          const row = (state.teacher_salary_rules || []).find((candidate) => Number(candidate.id) === Number(item.id)) || {};
          return `<div>记录 ${escapeHtml(item.id || "未知")} · 教师 ${escapeHtml(row.teacher_name || "未知")} · 年级 ${escapeHtml(row.grade || "未知")} · 科目 ${escapeHtml(row.subject || "未知")} · 原因 ${escapeHtml(item.message || error.message || "更新失败")}</div>`;
        }).join("")}`;
      }
      showToast(error.message || "批量设置薪资失败", "error");
    }
  }));

  document.querySelectorAll(".teacher-salary-rule-hide-inactive").forEach((input) => {
    input.addEventListener("change", () => {
      teacherSalaryRuleHideInactiveTeachers = input.checked;
      localStorage.setItem(TEACHER_RULE_HIDE_INACTIVE_TEACHERS_KEY, teacherSalaryRuleHideInactiveTeachers ? "1" : "0");
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
      const isActive = document.querySelector("#new-teacher-salary-rule-active")?.checked !== false;
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
            is_active: isActive,
            notes,
          },
        });
        teacherSalaryRuleModalOpen = false;
        await load();
      } catch (error) {
        button.disabled = false;
        alert(`新增薪资规则失败：${error.message}`);
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
      if (input.dataset.field === "salary_per_unit" && optionalNumberValue(input.value) != null) {
        const activeInput = row.querySelector(".teacher-salary-rule-active");
        if (activeInput) activeInput.checked = true;
      }
      const payload = {};
      row.querySelectorAll(".teacher-salary-rule-field").forEach((field) => {
        payload[field.dataset.field] = field.type === "checkbox"
          ? field.checked
          : field.type === "number"
            ? optionalNumberValue(field.value)
            : field.value;
      });
      if (payload.salary_per_unit === null) payload.salary_per_unit = 0;
      refreshAfter(() => request(`/api/teacher-salary-rules/${row.dataset.ruleId}`, {
        method: "PUT",
        body: payload,
      }));
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
      updateStudentQueryControlsOnly();
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

  document.querySelectorAll("input.teacher-select").forEach((select) => {
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

  document.querySelectorAll(".teacher-salary-notes-field").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest(".teacher-salary-summary-row");
      if (!row) return;
      refreshAfter(() => request("/api/teacher-salary-notes", {
        method: "PATCH",
        body: {
          teacher_name: row.dataset.teacherName,
          month_key: state.settings.month_key,
          notes: input.value,
        },
      }));
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

  document.querySelectorAll(".course-notice-layout-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      courseNoticeLayoutMode = button.dataset.layout === "simple" ? "simple" : "preview";
      render();
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
        courseNoticeSimpleActions = {};
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
        logClientOperation("parent_notice_copy_message", {
          content: `复制家长课程文案：${item.send_object_name || "课程安排"}`,
          target_type: "course_notice",
          target_id: item.send_object_key || "",
          details: { object_name: item.send_object_name || "", lesson_count: item.lesson_count || item.lessons?.length || 0 },
        });
        showToast("文案已复制");
      } catch (error) {
        showToast(error.message || "复制失败", "error");
      }
    });
  });

  document.querySelectorAll(".notice-simple-tile").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = findCourseNoticeObject(button.dataset.sendKey);
      if (!item) return;
      const action = courseNoticeSimpleAction(item);
      button.disabled = true;
      try {
        if (action.next === "message") {
          await navigator.clipboard.writeText(courseNoticeFullMessage(item));
          action.done = true;
          action.next = "image";
          showToast("文案已复制");
          render();
        } else {
          await copyCourseNoticeImage(item);
          action.next = "message";
          render();
        }
      } catch (error) {
        showToast(error.message || "操作失败", "error");
      } finally {
        button.disabled = false;
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

  document.querySelectorAll(".teacher-course-notice-layout-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      teacherCourseNoticeLayoutMode = button.dataset.layout === "simple" ? "simple" : "preview";
      localStorage.setItem(TEACHER_COURSE_NOTICE_LAYOUT_KEY, teacherCourseNoticeLayoutMode);
      updateTeacherCourseNoticeModeOnly();
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
        teacherCourseNoticeSimpleActions = {};
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
  bindTeacherCourseNoticeContentEvents();

  enhanceCustomSelects();
  enhanceCustomDateInputs();
}

bindNavigationEvents();

load().catch((error) => {
  renderLoadFailure(error);
});
