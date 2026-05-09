const navGroups = [
  { key: "schedule", label: "📅 排课", views: [["lessons", "课程总表"], ["week", "周课表"], ["weekMatrix", "矩阵课表"], ["courseNotice", "家长群课程截图"]] },
  {
    key: "students",
    label: "👥 学生",
    views: [["feeDetails", "费用明细"], ["summary", "费用汇总"], ["studentQuery", "学生查询"], ["recharges", "充值记录"]],
    moreViews: [["studentPricing", "学生单价"], ["studentProfiles", "学生档案"]],
  },
  { key: "teachers", label: "👨‍🏫 教师", views: [["teacherSalary", "教师薪资"], ["teacherDetail", "教师明细"], ["teacherProfiles", "老师档案"]] },
  { key: "operations", label: "💼 运营", views: [["staffPayroll", "员工薪资"], ["staffAttendance", "员工考勤"], ["expenses", "日常开销"]] },
  { key: "finance", label: "📊 经营概览", views: [["finance", "期间概览"]] },
  { key: "settings", label: "⚙️ 设置", views: [["pricing", "费用标准"], ["audit", "数据对账"], ["userAdmin", "账号权限"]] },
];

const gradeOrder = ["初一", "初二", "初三", "高一", "高二", "高三"];
const gradeTrendColors = {
  "初一": "#10b981",
  "初二": "#06b6d4",
  "初三": "#3b82f6",
  "高一": "#8b5cf6",
  "高二": "#f59e0b",
  "高三": "#f43f5e",
};
const LESSON_FILTER_KEY = "liming:lesson-filter";
const SUMMARY_EXPAND_KEY = "liming:summary-expanded";
const RECHARGE_SOURCE_FILTER_KEY = "liming:recharge-source-filter";
const FINANCE_RANGE_KEY = "liming:finance-range";
const MATRIX_RANGE_KEY = "liming:matrix-range";
const THEME_KEY = "liming:theme";
const SUMMARY_SCOPE_KEY = "liming:summary-scope";
const STUDENT_QUERY_RANGE_KEY = "liming:student-query-range";
const LOGIN_REMEMBER_KEY = "liming:login-remember";
const ROLE_LABELS = { owner: "Qing", admin: "管理员", academic: "教务", finance: "财务", teacher: "老师" };
const ROLE_VIEWS = {
  owner: null,
  admin: null,
  academic: new Set(["lessons", "week", "weekMatrix", "courseNotice", "feeDetails", "summary", "studentQuery", "recharges", "teacherSalary", "studentProfiles", "teacherProfiles", "pricing", "userAdmin"]),
  finance: new Set(["finance", "recharges", "studentQuery", "expenses"]),
  teacher: new Set(["weekMatrix", "teacherDetail"]),
};
let state = null;
let auth = { user: null, roles: ROLE_LABELS };
let loadGeneration = 0;
let view = localStorage.getItem("liming:view") || "lessons";
let lastRenderedView = "";
if (view === "staffProfiles") view = "staffPayroll";
let activeWeek = Number(localStorage.getItem("liming:week") || 0);
let matrixRange = readMatrixRange();
let months = [];
let activeMonth = localStorage.getItem("liming:month") || "";
let includeInactive = localStorage.getItem("liming:include-inactive") === "1";
let themeMode = localStorage.getItem(THEME_KEY) || "system";
let selectedStudent = "";
let studentQueryNameDraft = "";
let studentQueryRange = readStudentQueryRange();
let studentStatementModalOpen = false;
const COURSE_NOTICE_FILTER_KEY = "liming:course-notice-filter";
let courseNoticeFilter = readCourseNoticeFilter();
let courseNoticeState = { data: null, busy: false, error: "", loadedQuery: "" };
let saveCourseNoticeTailDebounced = null;
let selectedTeacher = "";
let passwordModalOpen = false;
let userAdminNotice = "";
let lessonFilter = readLessonFilter();
let expandedSummaryStudents = readExpandedSummaryStudents();
let activeNavGroup = localStorage.getItem("liming:nav-group") || "";
let rechargeSourceFilter = localStorage.getItem(RECHARGE_SOURCE_FILTER_KEY) || "all";
let rechargeStudentFilter = "";
let rechargeGradeFilter = "";
let feeDetailsFilter = { month_key: "", student: "", teacher: "", grade: "", status: "", source: "", start: "", end: "" };
let summaryFilter = { student: "", grade: "", balance: "" };
let summaryScope = localStorage.getItem(SUMMARY_SCOPE_KEY) || "month";
let studentPricingFilter = { student: "", subject: "", price: "", usage: "" };
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
let staffProfileSearch = "";
let staffStatusFilter = localStorage.getItem("liming:staff-status-filter") || "";
let staffModal = null;
let staffPayrollSearch = "";
let expenseModal = null;
let pricingAuditModal = null;
let lessonCopyDraft = null;
let weekCopyDraft = null;
let focusedLessonIds = [];
let expenseFilter = (() => {
  try {
    return { month_key: "", start: "", end: "", category: "", q: "", ...JSON.parse(localStorage.getItem("liming:expense-filter") || "{}") };
  } catch {
    return { month_key: "", start: "", end: "", category: "", q: "" };
  }
})();
let auditState = { xlsxReport: null, internalReport: null, logs: [], events: [], busy: false, notice: "" };
let auditSourceWorkbook = localStorage.getItem("liming:audit-source-workbook") || "";
let customSelectEventsBound = false;
let customDateEventsBound = false;
let filterComboEventsBound = false;
let customDatePickerEl = null;
let activeCustomDateInput = null;
let activeCustomDateMonth = null;

const navEl = document.querySelector("#nav");
const topbarEl = document.querySelector("#topbar");
const contentEl = document.querySelector("#content");

function applyTheme() {
  const mode = ["system", "light", "dark"].includes(themeMode) ? themeMode : "system";
  document.documentElement.dataset.theme = mode;
  localStorage.setItem(THEME_KEY, mode);
}

applyTheme();

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
  const config = {
    method: options.method || "GET",
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
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function requestWithStatus(path, options = {}) {
  const config = {
    method: options.method || "GET",
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

function canView(viewKey) {
  if (!auth.user) return false;
  const allowed = ROLE_VIEWS[auth.user.role];
  return !allowed || allowed.has(viewKey);
}

function canArea(area) {
  if (!auth.user) return false;
  if (auth.user.role === "owner" || auth.user.role === "admin") return true;
  if (auth.user.role === "academic") return ["schedule", "students", "profiles", "pricing", "teacherTransport", "users"].includes(area);
  if (auth.user.role === "finance") return ["finance", "expenses", "recharges", "studentBilling", "students"].includes(area);
  if (auth.user.role === "teacher") return ["scheduleRead", "teacherSelf", "profiles"].includes(area);
  if (area === "salary" || area === "finance" || area === "staff" || area === "audit") return false;
  return false;
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
  for (const group of navGroups) {
    for (const [key] of [...group.views, ...(group.moreViews || [])]) {
      if (canView(key)) return key;
    }
  }
  return "week";
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

function selectDisplayText(select) {
  return select.selectedOptions?.[0]?.textContent?.trim() || select.options?.[select.selectedIndex]?.textContent?.trim() || "请选择";
}

function syncCustomSelect(select, wrapper) {
  wrapper.querySelector(".custom-select-value").textContent = selectDisplayText(select);
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
  positionCustomSelectMenu(wrapper);
  scrollCustomSelectOptionIntoView(wrapper);
  positionCustomSelectMenu(wrapper);
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
        (customSelectMenu(wrapper)?.querySelector(".custom-select-option.selected") || customSelectMenu(wrapper)?.querySelector(".custom-select-option"))?.focus();
      }
    });
    menu.addEventListener("keydown", (event) => {
      const optionsList = [...menu.querySelectorAll(".custom-select-option:not(:disabled)")];
      const currentIndex = optionsList.indexOf(document.activeElement);
      if (event.key === "Escape") {
        closeCustomSelects();
        button.focus();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        optionsList[Math.min(optionsList.length - 1, currentIndex + 1)]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        optionsList[Math.max(0, currentIndex - 1)]?.focus();
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

async function load() {
  const thisGeneration = ++loadGeneration;
  const authResult = await request("/api/auth/me");
  if (loadGeneration !== thisGeneration) return;
  auth = { ...auth, ...authResult };
  if (!auth.user) return renderLogin();
  if (!canView(view)) view = firstAllowedView();
  months = await request("/api/months");
  if (loadGeneration !== thisGeneration) return;
  const params = new URLSearchParams();
  if (activeMonth) params.set("month", activeMonth);
  if (includeInactive) params.set("include_inactive", "1");
  const query = params.toString() ? `?${params.toString()}` : "";
  state = await request(`/api/bootstrap${query}`);
  if (loadGeneration !== thisGeneration) return;
  activeMonth = state.active_month_key || state.settings.month_key || activeMonth;
  if (activeMonth && !months.includes(activeMonth)) months = [activeMonth, ...months];
  localStorage.setItem("liming:month", activeMonth);
  ensureLessonFilterDates();
  const lessonRange = lessonLoadRange();
  if (lessonRange) {
    const lessonsResult = await request(`/api/lessons-range?start=${encodeURIComponent(lessonRange.start)}&end=${encodeURIComponent(lessonRange.end)}`);
    if (loadGeneration !== thisGeneration) return;
    state.lessons = (lessonsResult.lessons || []);
    state.lesson_loaded_range = lessonRange;
  }
  const weekSpan = naturalWeekSpan(activeMonth);
  ensureMatrixRange();
  const matrixStart = matrixRange.start && (!weekSpan || matrixRange.start < weekSpan.start) ? matrixRange.start : weekSpan?.start;
  const matrixEnd = matrixRange.end && (!weekSpan || matrixRange.end > weekSpan.end) ? matrixRange.end : weekSpan?.end;
  if (matrixStart && matrixEnd) {
    const weekLessonsResult = await request(`/api/lessons-range?start=${encodeURIComponent(matrixStart)}&end=${encodeURIComponent(matrixEnd)}`);
    if (loadGeneration !== thisGeneration) return;
    state.week_lessons = weekLessonsResult.lessons || [];
  } else {
    state.week_lessons = state.lessons;
  }
  ensureFinanceRangeDates();
  state.finance = canArea("finance") ? await request(`/api/finance-summary?${financeRangeQuery()}`) : null;
  if (loadGeneration !== thisGeneration) return;
  state.profile_teachers = canArea("profiles") || canArea("scheduleRead") ? ((await request("/api/teachers")).teachers || []) : [];
  if (loadGeneration !== thisGeneration) return;
  state.profile_students = canArea("students") ? ((await request("/api/students")).students || []) : [];
  if (loadGeneration !== thisGeneration) return;
  state.source_workbooks = canArea("audit") ? ((await request("/api/source-workbooks")).workbooks || []) : [];
  if (loadGeneration !== thisGeneration) return;
  state.users = canArea("users") ? ((await request("/api/users")).users || []) : [];
  if (loadGeneration !== thisGeneration) return;
  if (canArea("audit")) {
    await refreshAuditEvents();
    if (loadGeneration !== thisGeneration) return;
  } else {
    auditState.events = [];
  }
  if (!auditSourceWorkbook && state.source_workbooks.length) {
    auditSourceWorkbook = state.source_workbooks.find((item) => item.month_key === activeMonth)?.filename
      || state.source_workbooks[0].filename;
  }
  state.staff = canArea("staff") ? ((await request("/api/staff")).staff || []) : [];
  if (loadGeneration !== thisGeneration) return;
  state.staff_salary = canArea("staff") ? ((await request(`/api/staff-salary?month=${encodeURIComponent(activeMonth)}`)).rows || []) : [];
  if (loadGeneration !== thisGeneration) return;
  state.staff_attendance = canArea("staff") ? ((await request(`/api/staff-attendance?month=${encodeURIComponent(activeMonth)}`)).rows || []) : [];
  if (loadGeneration !== thisGeneration) return;
  ensureExpenseFilterDates();
  const expenseParams = new URLSearchParams();
  if (expenseFilter.start) expenseParams.set("start", expenseFilter.start);
  if (expenseFilter.end) expenseParams.set("end", expenseFilter.end);
  if (expenseFilter.category) expenseParams.set("category", expenseFilter.category);
  if (expenseFilter.q) expenseParams.set("q", expenseFilter.q);
  state.expenses = canArea("expenses") ? ((await request(`/api/operating-expenses?${expenseParams.toString()}`)).expenses || []) : [];
  if (loadGeneration !== thisGeneration) return;
  state.schedule_conflicts = await request(`/api/schedule-conflicts?month=${encodeURIComponent(activeMonth)}`)
    .catch(() => ({ issues: [], counts: { teacher: 0, student: 0, classroom: 0, invalid_time: 0 } }));
  if (loadGeneration !== thisGeneration) return;
  const students = uniqueSorted([
    ...state.derived.student_summary.map((row) => row.student_name),
    ...(state.profile_students || []).map((row) => row.name),
  ]);
  if (selectedStudent && !students.includes(selectedStudent)) selectedStudent = "";
  studentQueryNameDraft = selectedStudent || studentQueryNameDraft;
  state.student_history = selectedStudent
    ? ((await request(`/api/student/${encodeURIComponent(selectedStudent)}/history`)).history || [])
    : [];
  if (loadGeneration !== thisGeneration) return;
  await loadStudentStatement();
  if (loadGeneration !== thisGeneration) return;
  const teachers = state.teachers.map((row) => row.name);
  if (auth.user.role === "teacher") {
    selectedTeacher = auth.user.teacher_name || teachers[0] || "";
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

function yuan2(value) {
  return `¥${money2(value)}`;
}

function todayDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

function readCourseNoticeFilter() {
  return { ...currentWeekRange(), onlyTeaching: true };
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
  courseNoticeFilter = readCourseNoticeFilter();
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
    .split(/[、,，;；]/)
    .map((name) => name.trim())
    .filter(Boolean);
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

function readMatrixRange() {
  try {
    return { month_key: "", start: "", end: "", ...JSON.parse(localStorage.getItem(MATRIX_RANGE_KEY) || "{}") };
  } catch {
    return { month_key: "", start: "", end: "" };
  }
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

function ensureMatrixRange() {
  const monthKey = state?.settings?.month_key || activeMonth;
  if (
    matrixRange.month_key !== monthKey
    || !isDateValue(matrixRange.start)
    || !isDateValue(matrixRange.end)
    || matrixRange.start > matrixRange.end
  ) {
    matrixRange = matrixDefaultRange(monthKey);
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

function readLessonFilter() {
  const defaults = { month_key: "", teacher: "", student: "", start_date: "", end_date: "", status: "", query: "" };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(LESSON_FILTER_KEY) || "{}") };
  } catch {
    return defaults;
  }
}

function saveLessonFilter() {
  localStorage.setItem(LESSON_FILTER_KEY, JSON.stringify(lessonFilter));
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
  return state.recharges.find((item) => item.student_name === row.student_name)?.source || "";
}

function rechargeSourceTag(source) {
  if (source === "carry_over") return `<span class="source-tag" title="该行由上月余额自动结转">结转</span>`;
  return "";
}

function rechargePrevCell(row, field) {
  const value = field === "prev_gift" ? row.prev_gift : row.prev_actual;
  const title = row.prev_source_month
    ? `自动取 ${formatMonthOption(row.prev_source_month)} 的月末结余`
    : "源表期初结转";
  return `<td class="readonly right" title="${escapeHtml(title)}">${money(value)}</td>`;
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
  const bounds = monthBounds(monthKey);
  if (lessonFilter.month_key !== monthKey) {
    lessonFilter = { ...lessonFilter, month_key: monthKey, start_date: bounds.start, end_date: bounds.end };
    saveLessonFilter();
    return;
  }
  if (!lessonFilter.start_date || !lessonFilter.end_date) {
    lessonFilter = {
      ...lessonFilter,
      month_key: monthKey,
      start_date: lessonFilter.start_date || bounds.start,
      end_date: lessonFilter.end_date || bounds.end,
    };
    saveLessonFilter();
  }
}

function lessonLoadRange() {
  const bounds = monthBounds(state?.settings?.month_key || activeMonth);
  const start = isDateValue(lessonFilter.start_date) ? lessonFilter.start_date : bounds.start;
  const end = isDateValue(lessonFilter.end_date) ? lessonFilter.end_date : bounds.end;
  if (!start || !end || start > end) return null;
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

function resetLessonFilter() {
  const monthKey = state?.settings?.month_key || activeMonth;
  const bounds = monthBounds(monthKey);
  lessonFilter = { month_key: monthKey, teacher: "", student: "", start_date: bounds.start, end_date: bounds.end, status: "", query: "" };
  saveLessonFilter();
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function lessonFilterOptions(rows) {
  return {
    teachers: uniqueSorted(rows.map((row) => row.teacher_name)),
    students: uniqueSorted(rows.flatMap((row) => splitStudents(row.student_names))),
  };
}

function lessonMatchesFilter(row, filter, options = {}) {
  const { includeDate = true, includeStatus = true, includeQuery = true } = options;
  if (filter.teacher && !textContains(row.teacher_name, filter.teacher)) return false;
  if (filter.student) {
    const needle = filter.student.toLowerCase();
    if (!splitStudents(row.student_names).some((name) => name.toLowerCase().includes(needle))) return false;
  }
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

function filterSelectOptions(values, current, emptyText) {
  const normalized = uniqueSorted(current && !values.includes(current) ? [...values, current] : values);
  return options(normalized, current, emptyText);
}

function filterComboControl({ className, field, value, values, placeholder = "全部", dataAttr = "filter-field" }) {
  const normalized = uniqueSorted(value && !values.includes(value) ? [...values, value] : values);
  const dataName = dataAttr === "field" ? "data-field" : "data-filter-field";
  return `
    <span class="filter-combo">
      <input class="control filter-combo-input ${className}" ${dataName}="${escapeHtml(field)}" type="text" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value || "")}">
      <button class="filter-combo-toggle" type="button" aria-label="展开候选">⌄</button>
      <span class="filter-combo-menu">
        <button class="filter-combo-option muted" type="button" data-value="">全部</button>
        ${normalized.map((item) => `<button class="filter-combo-option" type="button" data-value="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}
      </span>
    </span>
  `;
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
const priceFilterOptions = [["positive", "正常价"], ["zero", "0 元"]];
const usageFilterOptions = [["current", "本月有课"], ["historical", "历史有课"], ["unused", "未使用"]];

function renderLessonFilterBar({ rows, filteredRows, compact = false }) {
  const opts = lessonFilterOptions(rows);
  const teacherSelect = `
    <label class="filter-field">
      <span>老师</span>
      ${filterComboControl({ className: "lesson-filter-input", field: "teacher", value: lessonFilter.teacher, values: opts.teachers, placeholder: "输入或选择老师" })}
    </label>
  `;
  const studentInput = `
    <label class="filter-field">
      <span>学生</span>
      ${filterComboControl({ className: "lesson-filter-input", field: "student", value: lessonFilter.student, values: opts.students, placeholder: "输入或选择学生" })}
    </label>
  `;
  const fullFilters = compact ? "" : `
    <label class="filter-field filter-date-range">
      <span>日期</span>
      <span class="date-range-inputs">
        <input class="control lesson-filter-input" data-filter-field="start_date" type="date" value="${escapeHtml(lessonFilter.start_date)}">
        <b>—</b>
        <input class="control lesson-filter-input" data-filter-field="end_date" type="date" value="${escapeHtml(lessonFilter.end_date)}">
      </span>
    </label>
    <label class="filter-field">
      <span>状态</span>
      ${filterComboControl({ className: "lesson-filter-input", field: "status", value: lessonFilter.status, values: statusValues(), placeholder: "输入或选择状态" })}
    </label>
    <label class="filter-field filter-search">
      <span>搜索</span>
      <input class="control lesson-filter-input" data-filter-field="query" type="text" autocomplete="off" spellcheck="false" placeholder="学生、备注、教室、科目" value="${escapeHtml(lessonFilter.query)}">
    </label>
  `;
  return `
    <div class="filter-bar lesson-filter-bar">
      <div class="filter-controls">
        ${teacherSelect}
        ${studentInput}
        ${fullFilters}
      </div>
      <div class="filter-summary">
        <span>已筛选 <b>${filteredRows.length}</b> / 共 ${rows.length} 节</span>
        <button class="btn reset-lesson-filter" type="button">重置</button>
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
  if (source === "custom") return "custom";
  if (source === "exam") return "exam";
  if (source === "trial") return "trial";
  if (source === "waiver") return "waiver";
  return "standard";
}

function feeDetailStatusOptions() {
  return uniqueSorted([...statusValues(), "未上", "暂停", "调课"]);
}

function feeDetailMatchesFilter(row) {
  const filter = feeDetailsFilter;
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

function renderFeeDetailsFilterBar(rows, filteredRows) {
  const students = uniqueSorted(rows.map((row) => row.student_name));
  const teachers = uniqueSorted(rows.map((row) => row.teacher_name));
  const grades = uniqueSorted(rows.map((row) => row.grade));
  const sourceOptions = ["标准价", "个性价", "手动", "考试手填", "试课免费", "退费/减免"];
  return `
    <div class="filter-bar">
      <div class="filter-controls">
        <label class="filter-field">
          <span>学生姓名</span>
          ${filterComboControl({ className: "fee-details-filter-input", field: "student", value: feeDetailsFilter.student, values: students, placeholder: "输入或选择学生" })}
        </label>
        <label class="filter-field">
          <span>授课老师</span>
          ${filterComboControl({ className: "fee-details-filter-input", field: "teacher", value: feeDetailsFilter.teacher, values: teachers, placeholder: "输入或选择老师" })}
        </label>
        <label class="filter-field">
          <span>年级</span>
          ${filterComboControl({ className: "fee-details-filter-input", field: "grade", value: feeDetailsFilter.grade, values: grades, placeholder: "输入或选择年级" })}
        </label>
        <label class="filter-field">
          <span>状态</span>
          ${filterComboControl({ className: "fee-details-filter-input", field: "status", value: feeDetailsFilter.status, values: feeDetailStatusOptions(), placeholder: "输入或选择状态" })}
        </label>
        <label class="filter-field">
          <span>价格来源</span>
          ${filterComboControl({ className: "fee-details-filter-input", field: "source", value: feeDetailsFilter.source, values: sourceOptions, placeholder: "输入或选择来源" })}
        </label>
        <label class="filter-field filter-date-range">
          <span>日期</span>
          <span class="date-range-inputs">
            <input class="control fee-details-filter-input" data-filter-field="start" type="date" value="${escapeHtml(feeDetailsFilter.start)}">
            <b>—</b>
            <input class="control fee-details-filter-input" data-filter-field="end" type="date" value="${escapeHtml(feeDetailsFilter.end)}">
          </span>
        </label>
      </div>
      <div class="filter-summary">
        <span>已筛选 <b>${filteredRows.length}</b> / 共 ${rows.length} 条</span>
        <button class="btn reset-fee-details-filter" type="button">清空筛选</button>
      </div>
    </div>
  `;
}

function summaryMatchesFilter(row) {
  if (summaryFilter.student && !row.student_name.toLowerCase().includes(summaryFilter.student.toLowerCase())) return false;
  if (summaryFilter.grade && !textContains(row.grade, summaryFilter.grade)) return false;
  if (summaryFilter.balance === "actual" && numberValue(row.actual_balance) === 0) return false;
  if (summaryFilter.balance === "gift" && numberValue(row.gift_balance) === 0) return false;
  if (summaryFilter.balance === "zero" && (numberValue(row.actual_balance) !== 0 || numberValue(row.gift_balance) !== 0)) return false;
  return true;
}

function summaryRows() {
  return summaryScope === "toDate"
    ? state.derived.student_summary_to_date || state.derived.student_summary || []
    : state.derived.student_summary || [];
}

function renderSummaryFilterBar(rows, filteredRows) {
  const students = uniqueSorted(rows.map((row) => row.student_name));
  const grades = uniqueSorted(rows.map((row) => row.grade));
  return `
    <div class="filter-bar compact summary-filter-bar">
      <div class="segmented summary-scope-toggle">
        <button class="segmented-option summary-scope-option ${summaryScope === "month" ? "active" : ""}" type="button" data-scope="month">本月</button>
        <button class="segmented-option summary-scope-option ${summaryScope === "toDate" ? "active" : ""}" type="button" data-scope="toDate">迄今为止</button>
      </div>
      <label>学生姓名</label>
      ${filterComboControl({ className: "summary-filter-input", field: "student", value: summaryFilter.student, values: students, placeholder: "输入或选择学生" })}
      <label>年级</label>
      ${filterComboControl({ className: "summary-filter-input", field: "grade", value: summaryFilter.grade, values: grades, placeholder: "输入或选择年级" })}
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
  return state?.lookups?.status || ["待上", "已上", "请假", "试课", "考试", "未缴费"];
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

function statusSelectCell({ id, value }) {
  const status = rowStatus({ status: value });
  return `
    <td>
      <select class="cell-select lesson-field status-select ${statusClass(status)}" data-id="${id}" data-field="status">
        ${options(statusValues(), status)}
      </select>
    </td>
  `;
}

function isEffective(row) {
  if (typeof row.effective === "boolean") return row.effective;
  const status = rowStatus(row);
  return status === "已上" || status === "未缴费";
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
  if (source === "custom") return "个性价";
  if (source === "exam") return "考试手填";
  if (source === "trial") return "试课免费";
  if (source === "waiver") return "退费/减免";
  return "标准价";
}

function priceSourceTitle(row) {
  const amount = `¥${money(row.unit_price)}`;
  if (row.price_source === "manual") return `本节课手动调整：${amount}`;
  if (row.price_source === "custom") return `该学生本科目专享价：${amount}`;
  if (row.price_source === "exam") return "考试课需手动填写费用";
  if (row.price_source === "trial") return "试课不向学生收费，且不计入教师课时费";
  if (row.price_source === "waiver") return "退费/减免口径：学生费用为 0，教师课时费按课程状态计算";
  return "按年级+班型标准价";
}

function priceSourceBadge(row) {
  const title = escapeHtml(priceSourceTitle(row));
  if (row.price_source === "manual") return `<span class="price-source-badge manual" title="${title}">✏</span>`;
  if (row.price_source === "custom") return `<span class="price-source-badge custom" title="${title}">★</span>`;
  if (row.price_source === "exam") return `<span class="price-source-badge exam" title="${title}">考</span>`;
  if (row.price_source === "trial") return `<span class="price-source-badge trial" title="${title}">试</span>`;
  if (row.price_source === "waiver") return `<span class="price-source-badge waiver" title="${title}">免</span>`;
  return "";
}

function editablePriceCell(row) {
  const title = escapeHtml(priceSourceTitle(row));
  const locked = row.price_source === "trial";
  return `
    <td class="price-cell-wrap" title="${title}">
      <input class="cell-input number fee-override ${row.price_source === "manual" ? "manual-price" : ""}" data-lesson-id="${row.lesson_id}" data-student-name="${escapeHtml(row.student_name)}" type="number" min="0" value="${moneyInput(row.unit_price)}" title="${title}" ${locked ? "disabled" : ""}>
      ${priceSourceBadge(row)}
    </td>
  `;
}

function readonlyPriceCell(row) {
  const title = escapeHtml(priceSourceTitle(row));
  return `<td class="text-cell right price-cell-wrap" title="${title}"><span>${money(row.unit_price)}</span>${priceSourceBadge(row)}</td>`;
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
  return `
    <div class="audit-source-meta">
      <span>月份：${escapeHtml(report.month_key || state?.settings?.month_key || "")}</span>
      <span>工作表：${escapeHtml(report.sheet_name || "-")}</span>
      <span>扫描课程：${Number(report.scanned_lessons || 0)}</span>
      ${fileName ? `<span>文件：${escapeHtml(fileName)}</span>` : ""}
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
    <details class="audit-group" ${severity === "CRITICAL" ? "open" : ""}>
      <summary><span class="severity-pill ${severity}">${severity}</span><strong>${bySeverity[severity].length}</strong></summary>
      <div class="table-wrap">
        <table class="audit-table">
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

function options(values, current, emptyText = "") {
  const normalized = [...values];
  if (current && !normalized.some((value) => String(value) === String(current))) normalized.push(current);
  const empty = emptyText ? `<option value="">${escapeHtml(emptyText)}</option>` : "";
  return empty + normalized.map((value) => {
    const selected = String(value) === String(current) ? "selected" : "";
    return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(value)}</option>`;
  }).join("");
}

function selectCell({ className, id, field, value, values, emptyText = "" }) {
  return `
    <td>
      <select class="cell-select ${className}" data-id="${id}" data-field="${field}">
        ${options(values, value, emptyText)}
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
    if (event.key === "Enter" && !composing) {
      event.preventDefault();
      commit(true);
    }
  });
  input.addEventListener("change", () => {
    if (!composing) commit(false);
  });
  input.addEventListener("blur", () => {
    if (!composing) commit(false);
  });
}

function inputCell({ className, id, field, value, type = "text", extra = "" }) {
  const inputValue = type === "number" ? moneyInput(value) : (value ?? "");
  return `
    <td>
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

function renderLogin(error = "") {
  const remembered = loginRemember();
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
          <input class="control login-username" autocomplete="username" value="${escapeHtml(remembered.username || "boss")}">
        </label>
        <label class="login-field">
          <span>密码</span>
          <input class="control login-password" type="password" autocomplete="current-password" value="${escapeHtml(remembered.password || "")}">
        </label>
        <div class="login-checks">
          <label><input class="login-remember-username" type="checkbox" ${remembered.rememberUsername ? "checked" : ""}> 记住账号</label>
          <label><input class="login-remember-password" type="checkbox" ${remembered.rememberPassword ? "checked" : ""}> 记住密码</label>
        </div>
        <button class="btn primary login-submit" type="submit">登录</button>
        <div class="login-tip">首次默认账号：boss / admin / jiaowu，初始密码均为 123456。记住密码只保存在本机浏览器。</div>
      </form>
    </div>
  `;
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

function sidebarMonthTools() {
  const monthOptions = months.map((month) => `
    <option value="${escapeHtml(month)}" ${month === activeMonth ? "selected" : ""}>${escapeHtml(formatMonthOption(month))}</option>
  `).join("");
  return `
    <div class="sidebar-month-tools">
      <label class="sidebar-tool-label" for="sidebar-month-select">月份</label>
      <select id="sidebar-month-select" class="control month-select">
        ${monthOptions}
      </select>
      ${canArea("schedule") ? `<div class="sidebar-month-actions">
        <button class="btn new-month" type="button">新建</button>
        <button class="btn icon-btn delete-month" type="button" title="删除当前月份" aria-label="删除当前月份">🗑</button>
      </div>` : ""}
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
          <button class="nav-btn ${currentGroup.key === group.key ? "active" : ""}" data-group="${group.key}">
            <span>${escapeHtml(group.label)}</span>
          </button>
          ${currentGroup.key === group.key && groupViews(group).length > 1 ? renderSecondaryNav(group) : ""}
        </div>
      `).join("")}
    </div>
    <div class="sidebar-tools">
      ${sidebarMonthTools()}
      <div class="sidebar-user">
        <strong>${escapeHtml(auth.user?.display_name || "")}</strong>
        <span>${escapeHtml(auth.user?.role_label || ROLE_LABELS[auth.user?.role] || "")}</span>
      </div>
      <button class="btn open-password-modal" type="button">修改密码</button>
      <button class="btn logout-btn" type="button">退出登录</button>
      <label class="sidebar-tool-label" for="sidebar-theme-select">主题</label>
      <select id="sidebar-theme-select" class="control theme-select" title="默认跟随系统">
        <option value="system" ${themeMode === "system" ? "selected" : ""}>跟随系统</option>
        <option value="light" ${themeMode === "light" ? "selected" : ""}>亮色</option>
        <option value="dark" ${themeMode === "dark" ? "selected" : ""}>暗色</option>
      </select>
    </div>
  `;
}

function renderTopbar(title, meta = "", actions = "") {
  topbarEl.innerHTML = `
    <div style="display: flex; align-items: center;">
      <button class="mobile-menu-btn" onclick="document.querySelector('.sidebar').classList.toggle('open')" aria-label="菜单">☰</button>
      <div class="title-block">
        <div class="page-title">${escapeHtml(title)}</div>
        <div class="page-meta">${escapeHtml(meta)}</div>
      </div>
    </div>
    <div class="toolbar">
      ${actions}
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

function lessonRow(row, cumulative) {
  const count = splitStudents(row.student_names).length;
  const teacherOptions = (state.profile_teachers || state.teachers || [])
    .filter((teacher) => (teacher.status || "在职") !== "离职")
    .map((teacher) => teacher.name);
  return `
    <tr class="${isAbnormal(row) ? "abnormal" : ""}">
      ${selectCell({ className: "lesson-field", id: row.id, field: "teacher_name", value: row.teacher_name, values: teacherOptions, emptyText: "未选" })}
      ${inputCell({ className: "lesson-field", id: row.id, field: "date", value: row.date, type: "date" })}
      ${statusSelectCell({ id: row.id, value: rowStatus(row) })}
      <td class="readonly">${escapeHtml(weekdayCn(row.date))}</td>
      ${inputCell({ className: "lesson-field", id: row.id, field: "time_slot", value: row.time_slot })}
      ${selectCell({ className: "lesson-field", id: row.id, field: "classroom", value: row.classroom, values: state.lookups.classrooms, emptyText: "未选" })}
      ${selectCell({ className: "lesson-field", id: row.id, field: "grade", value: row.grade, values: state.lookups.grades.map((g) => g.name), emptyText: "未选" })}
      ${selectCell({ className: "lesson-field", id: row.id, field: "subject", value: row.subject, values: state.lookups.subjects, emptyText: "未选" })}
      ${inputCell({ className: "lesson-field wide", id: row.id, field: "student_names", value: row.student_names })}
      ${inputCell({ className: "lesson-field wide", id: row.id, field: "notes", value: row.notes })}
      <td class="readonly right narrow">${count}</td>
      <td class="readonly right narrow">${cumulative}</td>
      <td class="readonly narrow row-actions">
        <button class="btn ghost lesson-copy-btn" data-lesson-id="${row.id}" title="复制到其他日期">⎘</button>
        <button class="btn danger delete-lesson" data-id="${row.id}">删除</button>
      </td>
    </tr>
  `;
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

function lessonCopyModal() {
  if (!lessonCopyDraft) return "";
  const lesson = state.lessons.find((row) => Number(row.id) === Number(lessonCopyDraft.lessonId));
  if (!lesson) return "";
  const defaultDate = lessonCopyDraft.targetDate || addDays(lesson.date, 1);
  const multiText = lessonCopyDraft.multiText || [defaultDate].filter(Boolean).join("\n");
  return `
    <div class="modal-backdrop copy-modal">
      <div class="modal-panel copy-panel">
        <div class="modal-head">
          <div>
            <div class="modal-title">复制课程</div>
            <div class="modal-subtitle">${escapeHtml(lesson.date)} ${escapeHtml(lesson.time_slot)} · ${escapeHtml(lesson.teacher_name)} · ${escapeHtml(lesson.student_names)}</div>
          </div>
          <button class="btn lesson-copy-cancel" type="button">取消</button>
        </div>
        <div class="copy-form">
          <div class="quick-row">
            <button class="btn ghost lesson-copy-quick" type="button" data-days="1">+1 天</button>
            <button class="btn ghost lesson-copy-quick" type="button" data-days="7">+7 天</button>
          </div>
          <label class="filter-field">
            <span>复制到日期</span>
            <input class="control lesson-copy-date" type="date" value="${escapeHtml(defaultDate)}">
          </label>
          <label class="copy-check">
            <input class="lesson-copy-multi-toggle" type="checkbox" ${lessonCopyDraft.multi ? "checked" : ""}>
            <span>多选日期模式（最多 7 天）</span>
          </label>
          <label class="filter-field ${lessonCopyDraft.multi ? "" : "hidden"}">
            <span>目标日期，一行一个</span>
            <textarea class="control lesson-copy-dates" rows="5">${escapeHtml(multiText)}</textarea>
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn lesson-copy-cancel" type="button">取消</button>
          <button class="btn primary lesson-copy-confirm" type="button" data-lesson-id="${lesson.id}">确认复制</button>
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
  const allRows = sortedLessons();
  const focusSet = new Set(focusedLessonIds.map(Number).filter(Boolean));
  const rows = focusSet.size
    ? allRows.filter((row) => focusSet.has(Number(row.id)))
    : allRows.filter((row) => lessonMatchesFilter(row, lessonFilter));
  let cumulative = 0;
  const effectiveCount = rows.filter(isEffective).length;
  const studentTotal = state.derived.fee_details.length;
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
    `${monthLabel()} 黎明教育课程安排`,
    `有效课程 ${effectiveCount} 节，学生人次 ${studentTotal}`,
    `<button class="btn week-copy-btn" type="button">整周复制…</button><button class="btn primary add-lesson">新增课程</button>`,
  );
  contentEl.innerHTML = `
    <div class="summary-grid">
      <div class="metric"><div class="metric-label">课程记录</div><div class="metric-value">${rows.length}</div></div>
      <div class="metric"><div class="metric-label">有效课程</div><div class="metric-value">${effectiveCount}</div></div>
      <div class="metric"><div class="metric-label">学生人次</div><div class="metric-value">${studentTotal}</div></div>
      <div class="metric"><div class="metric-label">教师人数</div><div class="metric-value">${state.teachers.length}</div></div>
    </div>
    ${focusNotice}
    <div class="band">
      <div class="table-wrap">
        <table class="course-table">
          <thead>
            <tr>
              <th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th class="wide">学生</th><th class="wide">备注</th><th>学生人数</th><th>累计序号</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => {
              cumulative += splitStudents(row.student_names).length;
              return lessonRow(row, cumulative);
            }).join("") || `<tr><td colspan="13" class="empty">暂无课程记录</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    ${lessonCopyModal()}
    ${weekCopyModal()}
  `;
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
      if (a.row.classroom && a.row.classroom === b.row.classroom) {
        pushIssue({
          type: "classroom",
          date: a.row.date,
          time_slot: `${a.row.time_slot} / ${b.row.time_slot}`,
          entity: a.row.classroom,
          lesson_ids: lessonIds,
          message: `${a.row.classroom} 在重叠时间段被重复占用`,
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
  for (const issue of issues) {
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
  const conflicts = localScheduleConflicts(weekRows);
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
      <label>开始日期</label>
      <input class="control matrix-range-input" data-field="start" type="date" value="${escapeHtml(matrixRange.start)}">
      <label>结束日期</label>
      <input class="control matrix-range-input" data-field="end" type="date" value="${escapeHtml(matrixRange.end)}">
      <button class="btn matrix-range-reset" type="button">恢复当前周</button>
    </div>
  `;
}

function renderWeek() {
  const { ranges, range, weekRows, rows, conflicts } = weekViewData();
  const showSalary = canArea("salary");
  renderTopbar(
    `${monthLabel()} 周课表`,
    `${range.label} · ${conflicts.length ? `发现 ${conflicts.length} 条冲突` : "无时间冲突"}`,
  );
  contentEl.innerHTML = `
    ${renderWeekTabs(ranges)}
    ${scheduleConflictPanel(conflicts)}
    ${renderLessonFilterBar({ rows: weekRows, filteredRows: rows, compact: true })}
    <div class="band">
      <div class="section-head">
        <div>
          <div class="section-title">周课表明细</div>
          <div class="section-subtitle">保留原列表视图，便于逐条核对课程信息。</div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="course-table">
          <thead>
            <tr><th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th class="wide">学生</th><th class="wide">备注</th>${showSalary ? "<th>教师薪资</th>" : ""}<th>学生人数</th></tr>
          </thead>
          <tbody>
            ${rows.map((row, index) => {
              const next = rows[index + 1];
              const groupBreak = next && next.teacher_name !== row.teacher_name;
              return `
                <tr class="${isAbnormal(row) ? "abnormal" : ""} ${groupBreak ? "group-break" : ""}">
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
                  ${showSalary ? `<td class="text-cell right">${money(row.teacher_salary)}</td>` : ""}
                  <td class="text-cell right">${splitStudents(row.student_names).length}</td>
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
    `${range.label} · ${conflicts.length ? `发现 ${conflicts.length} 条冲突` : "无时间冲突"}`,
  );
  contentEl.innerHTML = `
    ${renderWeekTabs(ranges)}
    ${renderMatrixDateFilter()}
    ${scheduleConflictPanel(conflicts)}
    ${renderLessonFilterBar({ rows: weekRows, filteredRows: rows, compact: true })}
    ${renderWeekGrid(rows, range, conflicts)}
  `;
}

function renderFeeDetails() {
  ensureFeeDetailsFilterMonth();
  const rows = state.derived.fee_details;
  const visibleRows = rows.filter(feeDetailMatchesFilter);
  const total = visibleRows.filter((row) => row.effective).reduce((sum, row) => sum + numberValue(row.unit_price), 0);
  renderTopbar(`${monthLabel()} 学生费用明细`, `已筛选 ${visibleRows.length} / 共 ${rows.length} 条，有效费用合计 ${money(total)} 元`);
  contentEl.innerHTML = `
    <div class="band">
      ${renderFeeDetailsFilterBar(rows, visibleRows)}
      <div class="table-wrap">
        <table class="fee-detail-table">
          <thead>
            <tr><th>学生姓名</th><th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th class="wide">备注</th><th>单人费用</th><th>来源</th></tr>
          </thead>
          <tbody>
            ${visibleRows.map((row) => `
              <tr class="${detailRowClass(row)}">
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
                <td class="text-cell">${priceSourceLabel(row.price_source)}</td>
              </tr>
            `).join("") || `<tr><td colspan="12" class="empty">暂无费用明细</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="filter-summary table-filter-summary">
        <span>已筛选 <b>${visibleRows.length}</b> / 共 ${rows.length} 条</span>
        <button class="btn reset-fee-details-filter" type="button">清空筛选</button>
      </div>
    </div>
  `;
}

function renderSummary() {
  const rows = summaryRows();
  const visibleRows = rows.filter(summaryMatchesFilter);
  const totalFee = rows.reduce((sum, row) => sum + numberValue(row.total_fee), 0);
  const totalBalance = rows.reduce((sum, row) => sum + numberValue(row.actual_balance) + numberValue(row.gift_balance), 0);
  const filteredFee = visibleRows.reduce((sum, row) => sum + numberValue(row.total_fee), 0);
  const filteredBalance = visibleRows.reduce((sum, row) => sum + numberValue(row.actual_balance) + numberValue(row.gift_balance), 0);
  const isToDate = summaryScope === "toDate";
  renderTopbar(
    `${isToDate ? `截至${monthLabel()}` : monthLabel()} 学生费用汇总`,
    `课程费用 ${money(totalFee)} 元，余额合计 ${money(totalBalance)} 元`,
    `<button class="btn rollover-recharges" type="button">从上月结转</button>`,
  );
  contentEl.innerHTML = `
    <div class="band">
      ${renderSummaryFilterBar(rows, visibleRows)}
      <div class="table-wrap">
        <table class="student-summary-table">
          <thead>
            <tr><th></th><th>学生姓名</th><th>年级</th><th>${isToDate ? "累计上课次数" : "上课次数"}</th><th>${isToDate ? "累计课程费用" : "课程总费用"}</th><th>${isToDate ? "截至结余现金" : "月末结余现金"}</th><th>${isToDate ? "截至结余赠送" : "月末结余赠送"}</th></tr>
          </thead>
          <tbody>
            ${visibleRows.map((row) => {
              const expanded = expandedSummaryStudents.has(row.student_name);
              return `
                <tr class="summary-master-row" style="background:${gradeColor(row.grade)}">
                  <td class="text-cell summary-expand-cell">
                    <button class="summary-expand-btn" type="button" data-student-name="${escapeHtml(row.student_name)}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? "⏷" : "⏵"}</button>
                  </td>
                  <td class="text-cell">
                    <button class="summary-name-btn" type="button" data-student-name="${escapeHtml(row.student_name)}">${escapeHtml(row.student_name)}</button>
                  </td>
                  <td class="text-cell grade-cell">${escapeHtml(row.grade)}</td>
                  <td class="text-cell right">${row.lesson_count}</td>
                  <td class="text-cell right">${money(row.total_fee)}</td>
                  <td class="text-cell right ${numberValue(row.actual_balance) < 0 ? "negative" : ""}">${money(row.actual_balance)}</td>
                  <td class="text-cell right ${numberValue(row.gift_balance) < 0 ? "negative" : ""}">${money(row.gift_balance)}</td>
                </tr>
                ${expanded ? `
                  <tr class="summary-detail-row">
                    <td colspan="7">${balanceDetailCards(row)}</td>
                  </tr>
                ` : ""}
              `;
            }).join("") || `<tr><td colspan="7" class="empty">暂无学生费用汇总</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="filter-summary table-filter-summary">
        <span>已筛选 <b>${visibleRows.length}</b> 条，课程费用 ¥${money(filteredFee)}，余额 ¥${money(filteredBalance)}</span>
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
  const fullValue = `¥${money2(current)}`;
  const displayValue = Math.abs(current) >= 10000000 ? `¥${compactMoney(current)}` : fullValue;
  const delta = metric?.mom_pct == null
    ? `无上期（上期 ¥${money2(previous)}）`
    : `${metric.mom_pct >= 0 ? "▲" : "▼"}${metric.mom_pct >= 0 ? "+" : ""}${(metric.mom_pct * 100).toFixed(1)}%（上期 ¥${money2(previous)}）`;
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
      body: `学生现金余额为负的欠款合计 ¥${money2(debt)}，已并入应收合计。`,
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
      <td class="text-cell right">${isMoney ? `¥${money2(metric.current)}` : percent(metric.current)}</td>
      <td class="text-cell right">${isMoney ? `¥${money2(metric.previous)}` : percent(metric.previous)}</td>
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
    const label = `${segment.label} ¥${money2(value)} (${(pct * 100).toFixed(0)}%)`;
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
  const currency = "\u00a5";
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
    const label = `${segment.label} ${currency}${money2(segment.value)} (${(pct * 100).toFixed(1)}%)`;
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
        <span class="donut-value">${currency}${money2(segment.value)}</span>
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
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return money2(n);
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
        <title>${escapeHtml(`${month}：毛利 ¥${money2(row.gross_profit)} / 毛利率 ${percent(row.gross_margin)}`)}</title>
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
      note: `现金余额 ¥${money2(row.actual_balance)}`,
      cls: "risk-debt",
    })),
    ...summary.top_lists.low_balance.map((row) => ({
      type: "低余额",
      name: row.student_name,
      amount: row.actual_balance,
      note: `低于平均单次课费 ¥${money2(row.avg_unit_price)}`,
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
  const presets = [
    ["month", "本月"],
    ["prev-month", "上月"],
    ["30d", "近 30 天"],
    ["90d", "近 90 天"],
    ["semester", "本学期"],
    ["all", "全部"],
  ];
  contentEl.innerHTML = `
    <div class="band finance-range-panel">
      <div class="finance-range-controls">
        <label class="filter-field"><span>开始</span><input class="control finance-range-input" data-field="start" type="date" value="${escapeHtml(financeRange.start)}"></label>
        <label class="filter-field"><span>结束</span><input class="control finance-range-input" data-field="end" type="date" value="${escapeHtml(financeRange.end)}"></label>
        <div class="finance-presets">
          ${presets.map(([key, label]) => `<button class="btn finance-preset ${financeRange.preset === key ? "active" : ""}" type="button" data-preset="${key}">${escapeHtml(label)}</button>`).join("")}
        </div>
      </div>
    </div>

    ${financeQualityNotices(summary)}

    <div class="finance-command-panel">
      <div class="finance-command-main ${netCashValue >= 0 ? "positive" : "negative"}">
        <span>净现金流</span>
        <strong>¥${money2(netCashValue)}</strong>
        <small class="mom ${momClass(netCashFlow.mom_pct)}">环比 ${momLabel(netCashFlow.mom_pct)}</small>
      </div>
    </div>

    <div class="finance-kpi-grid">
      ${financeMetric("收入", summary.overview.revenue)}
      ${financeMetric("师资成本", teacherCostMetric, { reverse: true })}
      ${financeMetric("运营成本", summary.overview.operating_cost, {
        reverse: true,
        title: `员工工资 ¥${money2(op.staff_salary_total)} / 日常开销 ¥${money2(op.operating_expense_total)}`,
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
              <tr><td class="text-cell">月末沉淀现金</td><td class="text-cell right">¥${money2(balanceSheet.total_actual_balance)}</td></tr>
              <tr><td class="text-cell">月末赠送余额</td><td class="text-cell right">¥${money2(balanceSheet.total_gift_balance)}</td></tr>
              <tr><td class="text-cell">未缴费课时</td><td class="text-cell right">¥${money2(balanceSheet.unpaid_lesson_receivable)}</td></tr>
              <tr><td class="text-cell">账户欠款</td><td class="text-cell right negative">¥${money2(balanceSheet.account_debt_receivable)}</td></tr>
              <tr><td class="text-cell">应收合计</td><td class="text-cell right">¥${money2(balanceSheet.accounts_receivable)}</td></tr>
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
              ${summary.breakdowns.by_teacher.map((row) => `<tr><td class="text-cell">${escapeHtml(row.teacher_name)}</td><td class="text-cell right">¥${money2(row.revenue_contribution)}</td><td class="text-cell right">¥${money2(row.salary_total)}</td><td class="text-cell right">${row.roi == null ? "" : row.roi.toFixed(2)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">暂无数据</td></tr>`}
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
              ${riskRows.map((row) => `<tr class="${row.cls}"><td class="text-cell">${escapeHtml(row.type)}</td><td class="text-cell">${escapeHtml(row.name)}</td><td class="text-cell right">¥${money2(row.amount)}</td><td class="text-cell">${escapeHtml(row.note)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">暂无风险</td></tr>`}
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
          valueFormatter: (value) => `¥${money2(value)}`,
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

function renderRecharges() {
  const rows = state.derived.student_summary;
  const students = uniqueSorted(rows.map((row) => row.student_name));
  const grades = uniqueSorted(rows.map((row) => row.grade));
  const visibleRows = rows.filter((row) => {
    const source = rechargeSource(row);
    if (rechargeSourceFilter === "carry_over" && source !== "carry_over") return false;
    if (rechargeSourceFilter === "manual" && source === "carry_over") return false;
    if (rechargeStudentFilter && !row.student_name.toLowerCase().includes(rechargeStudentFilter.toLowerCase())) return false;
    if (rechargeGradeFilter && !textContains(row.grade, rechargeGradeFilter)) return false;
    return true;
  });
  renderTopbar(`${monthLabel()} 充值记录`, `已显示 ${visibleRows.length} / 共 ${rows.length} 名学生`);
  contentEl.innerHTML = `
    <div class="band">
      <div class="filter-bar compact">
        <label>来源</label>
        ${filterComboControl({ className: "recharge-source-filter", field: "source", value: filterLabel(rechargeSourceOptions, rechargeSourceFilter), values: rechargeSourceOptions.map((item) => item[1]), placeholder: "输入或选择来源" })}
        <label>学生姓名</label>
        ${filterComboControl({ className: "recharge-student-filter", field: "student", value: rechargeStudentFilter, values: uniqueSorted(rows.map((row) => row.student_name)), placeholder: "输入或选择学生", dataAttr: "field" })}
        <label>年级</label>
        ${filterComboControl({ className: "recharge-grade-filter", field: "grade", value: rechargeGradeFilter, values: grades, placeholder: "输入或选择年级" })}
        <button class="btn reset-recharge-filter" type="button">清空筛选</button>
      </div>
      <div class="table-wrap">
        <table class="recharge-table">
          <thead>
            <tr><th>学生姓名</th><th>年级</th><th>上月实际结转</th><th>上月赠送结转</th><th>本月实际充值</th><th>本月赠送学费</th><th>充值日期</th><th class="wide">备注</th></tr>
          </thead>
          <tbody>
            ${visibleRows.map((row) => `
              <tr class="recharge-row" data-student-name="${escapeHtml(row.student_name)}">
                <td class="text-cell">${escapeHtml(row.student_name)} ${rechargeSourceTag(rechargeSource(row))}</td>
                <td class="text-cell">${escapeHtml(row.grade)}</td>
                ${rechargePrevCell(row, "prev_actual")}
                ${rechargePrevCell(row, "prev_gift")}
                <td><input class="cell-input number recharge-field" data-field="cur_recharge" type="number" value="${moneyInput(row.cur_recharge)}"></td>
                <td><input class="cell-input number recharge-field" data-field="cur_gift" type="number" value="${moneyInput(row.cur_gift)}"></td>
                <td><input class="cell-input recharge-field" data-field="recharge_date" type="date" value="${escapeHtml(row.recharge_date)}"></td>
                <td><input class="cell-input recharge-field wide" data-field="notes" value="${escapeHtml(row.recharge_notes)}"></td>
              </tr>
            `).join("") || `<tr><td colspan="8" class="empty">暂无学生</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
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
      <div class="table-wrap">
        <table class="student-history-table">
          <thead>
            <tr><th>月份</th><th>上课数</th><th>当月费用</th><th>月末现金</th><th>月末赠送</th><th>净充值</th></tr>
          </thead>
          <tbody>
            ${history.map((row) => `
              <tr class="${row.month_key === state.settings.month_key ? "current-month-row" : ""}">
                <td class="text-cell">${escapeHtml(formatMonthOption(row.month_key))}</td>
                <td class="text-cell right">${row.lesson_count}</td>
                <td class="text-cell right">${money(row.total_fee)}</td>
                <td class="text-cell right ${numberValue(row.actual_balance) < 0 ? "negative" : ""}">${money(row.actual_balance)}</td>
                <td class="text-cell right">${money(row.gift_balance)}</td>
                <td class="text-cell right">${money(row.net_recharge)}</td>
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
        <button class="btn primary student-query-apply" type="button">查询</button>
        <div class="segmented student-query-mode-toggle">
          <button class="segmented-option student-query-mode ${studentQueryRange.mode !== "range" ? "active" : ""}" type="button" data-mode="all">全部月份</button>
          <button class="segmented-option student-query-mode ${studentQueryRange.mode === "range" ? "active" : ""}" type="button" data-mode="range">日期范围</button>
        </div>
        <input class="control student-query-range" data-field="start" type="date" value="${escapeHtml(range.start || "")}" ${studentQueryRange.mode === "range" ? "" : "disabled"}>
        <input class="control student-query-range" data-field="end" type="date" value="${escapeHtml(range.end || "")}" ${studentQueryRange.mode === "range" ? "" : "disabled"}>
      </div>
    </div>
  `;
}

function studentQueryComparisonPanel(report) {
  if (!selectedStudent || !report?.summary) return "";
  const summary = report.summary;
  const netCash = Number(summary.cur_recharge) - Number(summary.total_fee);
  return `
    <div class="band student-comparison-panel">
      <div class="section-head">
        <div>
          <div class="section-title">期间消费情况</div>
          <div class="section-subtitle">${escapeHtml(studentStatementRangeLabel(report))}</div>
        </div>
      </div>
      <div class="query-head" style="margin-bottom: var(--space-4);">
        <div class="metric"><div class="metric-label">期间现金充值</div><div class="metric-value">¥${money2(summary.cur_recharge)}</div></div>
        <div class="metric"><div class="metric-label">期间赠送充值</div><div class="metric-value">¥${money2(summary.cur_gift)}</div></div>
        <div class="metric"><div class="metric-label">期间消费课费</div><div class="metric-value">¥${money2(summary.total_fee)}</div></div>
        <div class="metric"><div class="metric-label">期间净现金流变动</div><div class="metric-value ${netCash < 0 ? "negative" : ""}">${netCash > 0 ? "+" : ""}¥${money2(netCash)}</div></div>
      </div>
      <div class="table-wrap">
        <table class="student-history-table">
          <thead><tr><th>月份</th><th>有效课次</th><th>当月课费</th><th>现金充值</th><th>赠送充值</th></tr></thead>
          <tbody>
            ${(report.month_rows || []).map((row) => `
              <tr><td class="text-cell">${escapeHtml(formatMonthOption(row.month_key))}</td><td class="text-cell right">${row.lesson_count}</td><td class="text-cell right">¥${money2(row.total_fee)}</td><td class="text-cell right">¥${money2(row.cur_recharge)}</td><td class="text-cell right">¥${money2(row.cur_gift)}</td></tr>
            `).join("") || `<tr><td colspan="5" class="empty">暂无期间明细</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
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
      <text x="1048" y="${y}" class="cell num">¥${money(row.unit_price)}</text>
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
    <text x="190" class="label">课程费用</text><text x="190" y="42" class="metric">¥${money(summary.total_fee || 0)}</text>
    <text x="430" class="label">期间充值</text><text x="430" y="42" class="metric">¥${money(summary.cur_recharge || 0)}</text>
    <text x="670" class="label">最新月末现金</text><text x="670" y="42" class="metric">¥${money(summary.actual_balance || 0)}</text>
    <text x="900" class="label">最新月末赠送</text><text x="900" y="42" class="metric">¥${money(summary.gift_balance || 0)}</text>
  </g>
  <line x1="48" x2="${width - 48}" y1="236" y2="236" stroke="#d4e2e3"/>
  <text x="48" y="264" class="head">日期</text><text x="152" y="264" class="head">时间</text><text x="292" y="264" class="head">老师</text><text x="420" y="264" class="head">科目</text><text x="520" y="264" class="head">状态</text><text x="650" y="264" class="head">备注</text><text x="1048" y="264" class="head num">费用</text>
  ${rows || `<text x="48" y="286" class="cell">暂无课程明细</text>`}
  <text x="48" y="${height - 42}" class="muted">由黎明教育课程管理系统生成，请核对课程日期、状态和费用。</text>
</svg>`;
}

async function downloadStudentStatementPng(report) {
  if (!report?.summary) throw new Error("请先查询学生");
  const svg = studentStatementSvg(report);
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || 1120;
    canvas.height = image.naturalHeight || 900;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.96));
    if (!blob) throw new Error("图片生成失败");
    const link = document.createElement("a");
    const range = report.range || currentStudentQueryRange();
    link.href = URL.createObjectURL(blob);
    link.download = `${report.student_name}_${range.start}_${range.end}_课程核对.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
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

function renderStudentQuery() {
  const rows = state.derived.student_summary;
  const studentNames = uniqueSorted([...rows.map((row) => row.student_name), ...(state.profile_students || []).map((row) => row.name)]);
  const report = studentStatementReport();
  const summary = selectedStudent ? report.summary : null;
  const details = selectedStudent ? (report.details || []) : [];
  renderTopbar(
    "学生查询",
    selectedStudent || "未选择学生",
    `<button class="btn export-student-statement" type="button" ${selectedStudent ? "" : "disabled"}>导出 Excel</button>
     <button class="btn student-statement-preview" type="button" ${summary ? "" : "disabled"}>导出图片</button>`,
  );
  contentEl.innerHTML = `
    ${studentQueryControls(studentNames)}
    <div class="query-head">
      <div class="metric"><div class="metric-label">查询范围</div><div class="metric-value small">${escapeHtml(studentStatementRangeLabel(report))}</div></div>
      <div class="metric"><div class="metric-label">有效上课次数</div><div class="metric-value">${summary ? summary.lesson_count : 0}</div></div>
      <div class="metric"><div class="metric-label">课程费用</div><div class="metric-value">${summary ? money(summary.total_fee) : 0}</div></div>
      <div class="metric"><div class="metric-label">最新月末现金</div><div class="metric-value ${summary && numberValue(summary.actual_balance) < 0 ? "negative" : ""}">${summary ? money(summary.actual_balance) : 0}</div></div>
      <div class="metric"><div class="metric-label">最新月末赠送</div><div class="metric-value">${summary ? money(summary.gift_balance) : 0}</div></div>
    </div>
    ${studentQueryComparisonPanel(report)}
    <div class="band">
      <div class="table-wrap">
        <table class="fee-detail-table">
          <thead>
            <tr><th>学生姓名</th><th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th class="wide">备注</th><th>单人费用</th></tr>
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
    ${studentStatementModal(report)}
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
      <div class="table-wrap">
        <table class="audit-table">
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
      <div class="table-wrap">
        <table class="audit-table">
          <thead><tr><th>时间</th><th>操作者</th><th>角色</th><th>动作</th><th>对象</th><th>对象 ID</th><th>IP</th></tr></thead>
          <tbody>
            ${auditState.events.map((event) => `
              <tr>
                <td class="text-cell">${escapeHtml(event.created_at)}</td>
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
  const roles = auth.user?.role === "academic" ? ["teacher"] : Object.keys(ROLE_LABELS);
  return roles.map((role) => `<option value="${role}" ${role === value ? "selected" : ""}>${escapeHtml(ROLE_LABELS[role])}</option>`).join("");
}

function renderUserAdmin() {
  const users = state.users || [];
  const canImportTeachers = canArea("users");
  renderTopbar(
    "账号权限",
    auth.user?.role === "academic" ? "教务仅可维护老师账号" : "维护账号、角色和绑定老师",
    `<button class="btn primary import-teacher-users" type="button" ${canImportTeachers ? "" : "disabled"}>从模板导入老师账号</button>`,
  );
  contentEl.innerHTML = `
    ${userAdminNotice ? `<div class="audit-inline-notice">${escapeHtml(userAdminNotice)}</div>` : ""}
    <div class="band user-admin-panel">
      <div class="section-head">
        <div>
          <div class="section-title">新增账号</div>
          <div class="section-subtitle">老师账号建议使用手机号作为账号，老师姓名必须与课表中的授课老师一致。</div>
        </div>
      </div>
      <div class="user-create-grid">
        <input class="control new-user-field" data-field="username" placeholder="账号/手机号">
        <input class="control new-user-field" data-field="display_name" placeholder="显示姓名">
        <select class="control new-user-field" data-field="role">${roleSelectOptions(auth.user?.role === "academic" ? "teacher" : "teacher")}</select>
        <input class="control new-user-field" data-field="teacher_name" placeholder="绑定老师姓名">
        <input class="control new-user-field" data-field="password" type="password" placeholder="初始密码，至少 6 位">
        <button class="btn primary create-user" type="button">新增账号</button>
      </div>
    </div>
    <div class="band user-admin-panel">
      <div class="table-wrap">
        <table class="user-table">
          <thead><tr><th>账号</th><th>显示姓名</th><th>角色</th><th>绑定老师</th><th>状态</th><th>重置密码</th></tr></thead>
          <tbody>
            ${users.map((user) => `
              <tr class="user-row" data-id="${user.id}">
                <td><input class="cell-input user-field" data-field="username" value="${escapeHtml(user.username)}"></td>
                <td><input class="cell-input user-field" data-field="display_name" value="${escapeHtml(user.display_name || "")}"></td>
                <td><select class="cell-select user-field" data-field="role">${roleSelectOptions(user.role)}</select></td>
                <td><input class="cell-input user-field" data-field="teacher_name" value="${escapeHtml(user.teacher_name || "")}" placeholder="老师账号必填"></td>
                <td><select class="cell-select user-field" data-field="status">${options(["active", "disabled"], user.status || "active")}</select></td>
                <td class="readonly user-password-cell">
                  <input class="control user-reset-password-value" type="password" placeholder="新密码">
                  <button class="btn user-reset-password" type="button">重置</button>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="6" class="empty">暂无账号</td></tr>`}
          </tbody>
        </table>
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
        <table class="pricing-table">
          <thead><tr><th>年级</th><th>人数</th><th>单人费用</th><th>查找键</th><th>说明</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td class="text-cell">${escapeHtml(row.grade)}</td>
                <td class="text-cell right">${row.student_count}</td>
                <td><input class="cell-input number pricing-field" data-id="${row.id}" data-field="unit_price" type="number" value="${moneyInput(row.unit_price)}"></td>
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
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time_slot).localeCompare(String(b.time_slot)));
}

function pricingAuditModalMarkup() {
  if (!pricingAuditModal) return "";
  const pricing = state.student_pricing.find((row) => (
    row.student_name === pricingAuditModal.student_name && row.subject === pricingAuditModal.subject
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
            <div class="modal-subtitle">当前个性价 ¥${money(customPrice)}，本月命中 ${details.length} 节课，手填覆盖 ${manualCount} 条。</div>
          </div>
          <button class="btn pricing-audit-cancel" type="button">取消</button>
        </div>
        <div class="table-wrap">
          <table class="pricing-audit-table">
            <thead><tr><th>日期</th><th>状态</th><th>当前单价</th><th>来源</th><th>与个性价差额</th></tr></thead>
            <tbody>
              ${details.map((row) => {
                const diff = numberValue(row.unit_price) - customPrice;
                return `
                  <tr>
                    <td class="text-cell">${escapeHtml(row.date)}</td>
                    <td class="text-cell">${statusBadge(rowStatus(row))}</td>
                    <td class="text-cell right price-cell-wrap">${money(row.unit_price)} ${priceSourceBadge(row)}</td>
                    <td class="text-cell">${priceSourceLabel(row.price_source)}</td>
                    <td class="text-cell right ${diff !== 0 ? "negative" : ""}">${money(diff)}</td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="5" class="empty">本月没有命中课程</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="modal-actions">
          <button class="btn pricing-audit-cancel" type="button">取消</button>
          <button class="btn primary pricing-recompute" type="button" ${details.length ? "" : "disabled"} data-name="${escapeHtml(pricing.student_name)}" data-subject="${escapeHtml(pricing.subject)}" data-count="${details.length}" data-manual-count="${manualCount}" data-price="${money(customPrice)}">全部重算（按最新个性价）</button>
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
      row.lookup_key,
      row.notes,
    ].map((value) => String(value || "").toLowerCase()).join(" ");
    if (!haystack.includes(studentNeedle)) return false;
  }
  if (filter.subject && !textContains(row.subject, filter.subject)) return false;
  if (filter.price === "zero" && numberValue(row.custom_price) > 0) return false;
  if (filter.price === "positive" && numberValue(row.custom_price) <= 0) return false;
  const currentLessons = numberValue(row.current_month_lessons);
  const totalLessons = numberValue(row.total_lessons);
  if (filter.usage === "current" && currentLessons <= 0) return false;
  if (filter.usage === "historical" && (currentLessons > 0 || totalLessons <= 0)) return false;
  if (filter.usage === "unused" && totalLessons > 0) return false;
  return true;
}

function renderStudentPricingFilterBar(rows, visibleRows) {
  const students = uniqueSorted(rows.map((row) => row.student_name));
  return `
    <div class="filter-bar compact student-pricing-filter-bar">
      <label>学生/备注</label>
      ${filterComboControl({ className: "student-pricing-filter-input", field: "student", value: studentPricingFilter.student, values: students, placeholder: "输入或选择学生/备注" })}
      <label>科目</label>
      ${filterComboControl({ className: "student-pricing-filter-input", field: "subject", value: studentPricingFilter.subject, values: state.lookups.subjects, placeholder: "输入或选择科目" })}
      <label>价格状态</label>
      ${filterComboControl({ className: "student-pricing-filter-input", field: "price", value: filterLabel(priceFilterOptions, studentPricingFilter.price), values: priceFilterOptions.map((item) => item[1]), placeholder: "输入或选择价格状态" })}
      <label>影响范围</label>
      ${filterComboControl({ className: "student-pricing-filter-input", field: "usage", value: filterLabel(usageFilterOptions, studentPricingFilter.usage), values: usageFilterOptions.map((item) => item[1]), placeholder: "输入或选择影响范围" })}
      <div class="filter-summary">
        <span>已筛选 <b>${visibleRows.length}</b> / 共 ${rows.length} 条</span>
        <button class="btn primary apply-student-pricing-filter" type="button">筛选</button>
        <button class="btn reset-student-pricing-filter" type="button">清空筛选</button>
      </div>
    </div>
  `;
}

function renderStudentPricing() {
  const rows = state.student_pricing;
  const visibleRows = rows.filter(studentPricingMatchesFilter);
  const zeroPriceRows = rows.filter((row) => numberValue(row.custom_price) <= 0);
  const studentNames = (state.profile_students || state.students || [])
    .filter((row) => !["已流出", "离校"].includes(row.status || "在读"))
    .map((row) => row.name);
  renderTopbar("学生单价表", `已筛选 ${visibleRows.length} / 共 ${rows.length} 条个性化价格`, historyToggleAction());
  contentEl.innerHTML = `
    ${zeroPriceRows.length ? `
      <div class="finance-notice-list">
        <div class="finance-notice">
          <strong>发现 ${zeroPriceRows.length} 条 0 元专享价</strong>
          <span>专享价是长期规则。试课请改课程状态为「试课」，退费/减免请到费用明细做单节手动覆盖。</span>
        </div>
      </div>
    ` : ""}
    <div class="band">
      <div class="section-head"><div class="section-title">新增个性化单价</div></div>
      <div class="table-wrap">
        <table class="student-pricing-create-table">
          <tbody>
            <tr>
              <td><input id="new-student-price-name" class="cell-input" list="student-name-list" placeholder="学生姓名"></td>
              <td><select id="new-student-price-subject" class="cell-select">${options(state.lookups.subjects, "", "科目")}</select></td>
              <td><input id="new-student-price-value" class="cell-input number" type="number" min="0.01" step="0.01" placeholder="单价"></td>
              <td><input id="new-student-price-notes" class="cell-input wide" placeholder="备注"></td>
              <td class="readonly"><button class="btn primary add-student-price">新增</button></td>
            </tr>
          </tbody>
        </table>
        <datalist id="student-name-list">${studentNames.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}</datalist>
      </div>
    </div>
    <div class="band">
      ${renderStudentPricingFilterBar(rows, visibleRows)}
      <div class="table-wrap">
        <table class="student-pricing-table">
          <thead><tr><th>学生姓名</th><th>科目</th><th>单价</th><th>本月影响</th><th>查找键</th><th class="wide">备注</th><th>操作</th></tr></thead>
          <tbody>
            ${visibleRows.map((row) => `
              <tr>
                <td><input class="cell-input student-pricing-field" data-id="${row.id}" data-field="student_name" value="${escapeHtml(row.student_name)}"></td>
                <td><select class="cell-select student-pricing-field" data-id="${row.id}" data-field="subject">${options(state.lookups.subjects, row.subject)}</select></td>
                <td><input class="cell-input number student-pricing-field ${numberValue(row.custom_price) <= 0 ? "warning-cell" : ""}" data-id="${row.id}" data-field="custom_price" type="number" min="0.01" step="0.01" value="${moneyInput(row.custom_price)}"></td>
                <td class="text-cell right">
                  <button class="btn ghost pricing-impact-btn" type="button" data-name="${escapeHtml(row.student_name)}" data-subject="${escapeHtml(row.subject)}">${row.current_month_lessons || 0} 次</button>
                  <span class="muted-tip">/ 累计 ${row.total_lessons || 0}</span>
                </td>
                <td class="text-cell">${escapeHtml(row.lookup_key)}</td>
                <td><input class="cell-input wide student-pricing-field" data-id="${row.id}" data-field="notes" value="${escapeHtml(row.notes)}"></td>
                <td class="readonly"><button class="btn danger delete-student-price" data-id="${row.id}">删除</button></td>
              </tr>
            `).join("") || `<tr><td colspan="7" class="empty">暂无个性化单价</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    ${pricingAuditModalMarkup()}
  `;
}

function profileRows(kind = profileTab) {
  const rows = kind === "teachers" ? state.profile_teachers || [] : state.profile_students || [];
  const statusFilter = profileStatusFilter[kind] || "";
  const statusRows = statusFilter ? rows.filter((row) => textContains(row.status || "", statusFilter)) : rows;
  const query = profileSearch.trim().toLowerCase();
  const searchFields = kind === "students"
    ? (row) => [row.name]
    : (row) => [row.name, row.phone, row.status, row.joined_at, row.left_at, row.notes];
  const filtered = query
    ? statusRows.filter((row) => searchFields(row).some((value) => String(value || "").toLowerCase().includes(query)))
    : statusRows;
  if (kind !== "students") return filtered;
  return [...filtered].sort((a, b) => {
    const gradeDelta = gradeOrder.indexOf(a.grade) - gradeOrder.indexOf(b.grade);
    if (gradeOrder.includes(a.grade) && gradeOrder.includes(b.grade) && gradeDelta) return gradeDelta;
    if (gradeOrder.includes(a.grade) !== gradeOrder.includes(b.grade)) return gradeOrder.includes(a.grade) ? -1 : 1;
    return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN");
  });
}

function studentProfileTableRows(rows) {
  let currentGrade = null;
  return rows.map((row) => {
    const grade = row.grade || "未选年级";
    const group = grade !== currentGrade ? (() => {
      currentGrade = grade;
      return `<tr class="profile-grade-row"><td colspan="9">${escapeHtml(grade)}</td></tr>`;
    })() : "";
    return `
      ${group}
      <tr class="profile-row" data-kind="students" data-id="${row.id}">
        <td><input class="cell-input profile-field" data-field="name" value="${escapeHtml(row.name)}"></td>
        <td><select class="cell-select profile-field" data-field="grade">${options(state.lookups.grades.map((g) => g.name), row.grade || "", "未选")}</select></td>
        <td><input class="cell-input profile-field" data-field="guardian" value="${escapeHtml(row.guardian || "")}"></td>
        <td><input class="cell-input profile-field" data-field="phone" value="${escapeHtml(row.phone || "")}"></td>
        <td><select class="cell-select profile-field" data-field="status">${options(["在读", "离校", "已流出", "暂停"], row.status || "在读")}</select></td>
        <td><input class="cell-input profile-field" data-field="joined_at" type="date" value="${escapeHtml(row.joined_at || "")}"></td>
        <td><input class="cell-input profile-field" data-field="left_at" type="date" value="${escapeHtml(row.left_at || "")}"></td>
        <td><input class="cell-input wide profile-field" data-field="notes" value="${escapeHtml(row.notes || "")}"></td>
        <td class="readonly"><button class="btn danger delete-profile" data-kind="students" data-id="${row.id}" data-name="${escapeHtml(row.name)}">删除</button></td>
      </tr>
    `;
  }).join("");
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
          ${isTeacher ? "" : `<label>年级<select class="control profile-modal-field" data-field="grade">${options(state.lookups.grades.map((g) => g.name), "", "未选")}</select></label>`}
          ${isTeacher ? "" : `<label>监护人<input class="control profile-modal-field" data-field="guardian" placeholder="家长/监护人"></label>`}
          <label>电话<input class="control profile-modal-field" data-field="phone" placeholder="联系电话"></label>
          <label>状态<select class="control profile-modal-field" data-field="status">${options(isTeacher ? ["在职", "离职", "暂停"] : ["在读", "离校", "暂停"], isTeacher ? "在职" : "在读")}</select></label>
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
  const statusValues = isTeacher ? ["在职", "离职", "暂停"] : ["在读", "离校", "已流出", "暂停"];
  renderTopbar(isTeacher ? "老师档案" : "学生档案", `${rows.length} 条`, historyToggleAction());
  const teacherTable = `
    <table class="profile-table">
      <thead><tr><th>姓名</th><th>电话</th><th>状态</th><th>入职日期</th><th>离职日期</th><th class="wide">备注</th><th>操作</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr class="profile-row" data-kind="teachers" data-id="${row.id}">
            <td><input class="cell-input profile-field" data-field="name" value="${escapeHtml(row.name)}"></td>
            <td><input class="cell-input profile-field" data-field="phone" value="${escapeHtml(row.phone || "")}"></td>
            <td><select class="cell-select profile-field" data-field="status">${options(["在职", "离职", "暂停"], row.status || "在职")}</select></td>
            <td><input class="cell-input profile-field" data-field="joined_at" type="date" value="${escapeHtml(row.joined_at || "")}"></td>
            <td><input class="cell-input profile-field" data-field="left_at" type="date" value="${escapeHtml(row.left_at || "")}"></td>
            <td><input class="cell-input wide profile-field" data-field="notes" value="${escapeHtml(row.notes || "")}"></td>
            <td class="readonly"><button class="btn danger delete-profile" data-kind="teachers" data-id="${row.id}" data-name="${escapeHtml(row.name)}">删除</button></td>
          </tr>
        `).join("") || `<tr><td colspan="7" class="empty">暂无老师档案</td></tr>`}
      </tbody>
    </table>
  `;
  const studentTable = `
    <table class="profile-table">
      <thead><tr><th>姓名</th><th>年级</th><th>监护人</th><th>电话</th><th>状态</th><th>入学日期</th><th>离校日期</th><th class="wide">备注</th><th>操作</th></tr></thead>
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
          <input class="control profile-search" type="text" autocomplete="off" spellcheck="false" placeholder="${isTeacher ? "搜索老师姓名、电话、备注" : "按学生姓名筛选"}" value="${escapeHtml(profileSearch)}">
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
          <input class="control staff-profile-search" type="text" autocomplete="off" spellcheck="false" placeholder="搜索姓名、角色、电话、备注" value="${escapeHtml(staffProfileSearch)}">
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
                <td><input class="cell-input number staff-field" data-field="base_salary" type="number" value="${moneyInput(row.base_salary)}"></td>
                <td><input class="cell-input number staff-field" data-field="daily_rate" type="number" value="${moneyInput(row.daily_rate)}"></td>
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
            <input class="control staff-profile-search" type="text" autocomplete="off" spellcheck="false" placeholder="搜索员工/角色/电话/备注" value="${escapeHtml(staffProfileSearch)}">
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
        <input class="control staff-payroll-search" type="text" autocomplete="off" spellcheck="false" placeholder="搜索员工/角色/备注" value="${escapeHtml(staffPayrollSearch)}">
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
                  <td class="text-cell right">${row.pay_type === "日薪" ? money(row.daily_rate || row.base_salary) : money(row.base_salary)}</td>
                  <td class="text-cell right" title="${row.attendance_days ? `已登记 ${row.attendance_days} 天考勤` : "未登记考勤，按整月基础工资"}">${row.attendance_days ? money(row.pay_units) : "整月"}</td>
                  <td><input class="cell-input number staff-salary-field" data-field="bonus" type="number" value="${moneyInput(row.bonus)}" ${disabled}></td>
                  <td><input class="cell-input number staff-salary-field" data-field="deduction" type="number" value="${moneyInput(row.deduction)}" ${disabled}></td>
                  <td class="text-cell right ${mismatch ? "warning-cell" : ""}" title="${mismatch ? `按基础+奖金-扣款应为 ${money(row.expected_salary)}` : ""}">${mismatch ? "⚠ " : ""}${money(row.salary_actual)}</td>
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
        <label>开始 <input class="control expense-filter-input" data-field="start" type="date" value="${escapeHtml(expenseFilter.start)}"></label>
        <label>结束 <input class="control expense-filter-input" data-field="end" type="date" value="${escapeHtml(expenseFilter.end)}"></label>
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
                <td><input class="cell-input number expense-field" data-field="amount" type="number" value="${moneyInput(row.amount)}"></td>
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

function renderTeacherSalary() {
  const rows = state.derived.teacher_summary;
  const showSalary = canArea("salary");
  const total = rows.reduce((sum, row) => sum + numberValue(showSalary ? row.total_salary : (
    numberValue(row.week1_transport) + numberValue(row.week2_transport) + numberValue(row.week3_transport) + numberValue(row.week4_transport)
  )), 0);
  renderTopbar(
    showSalary ? `${monthLabel()} 教师薪资汇总` : `${monthLabel()} 教师每周车票登记`,
    `${showSalary ? "薪资合计" : "车票合计"} ${money(total)} 元`,
    showSalary ? `<button class="btn export-teacher-salary" type="button">导出本月</button>` : "",
  );
  contentEl.innerHTML = `
    <div class="band">
      <div class="table-wrap">
        <table class="teacher-salary-table">
          <thead><tr><th>教师姓名</th>${showSalary ? "<th>上课课时数</th><th>课时合计</th>" : ""}<th>第一周车票</th><th>第二周车票</th><th>第三周车票</th><th>第四周车票</th>${showSalary ? "<th>薪资合计</th>" : "<th>车票合计</th>"}<th class="wide">备注</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="teacher-adjustment-row" data-teacher-name="${escapeHtml(row.teacher_name)}">
                <td class="text-cell">${escapeHtml(row.teacher_name)}</td>
                ${showSalary ? `<td class="text-cell right">${row.lesson_count}</td><td class="text-cell right">${money(row.salary_total)}</td>` : ""}
                <td><input class="cell-input number teacher-adjustment-field" data-field="week1_transport" type="number" value="${moneyInput(row.week1_transport)}"></td>
                <td><input class="cell-input number teacher-adjustment-field" data-field="week2_transport" type="number" value="${moneyInput(row.week2_transport)}"></td>
                <td><input class="cell-input number teacher-adjustment-field" data-field="week3_transport" type="number" value="${moneyInput(row.week3_transport)}"></td>
                <td><input class="cell-input number teacher-adjustment-field" data-field="week4_transport" type="number" value="${moneyInput(row.week4_transport)}"></td>
                <td class="text-cell right">${money(showSalary ? row.total_salary : numberValue(row.week1_transport) + numberValue(row.week2_transport) + numberValue(row.week3_transport) + numberValue(row.week4_transport))}</td>
                <td><input class="cell-input wide teacher-adjustment-field" data-field="notes" value="${escapeHtml(row.notes)}"></td>
              </tr>
            `).join("")}
            <tr>
              <td class="text-cell"><b>合计</b></td>
              ${showSalary ? `<td class="text-cell right"><b>${rows.reduce((sum, row) => sum + row.lesson_count, 0)}</b></td><td class="text-cell right"><b>${money(rows.reduce((sum, row) => sum + numberValue(row.salary_total), 0))}</b></td>` : ""}
              <td colspan="4"></td>
              <td class="text-cell right"><b>${money(total)}</b></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderTeacherDetail() {
  const teachers = state.teachers.map((row) => row.name);
  const rows = sortedLessons().filter((row) => row.teacher_name === selectedTeacher);
  const count = rows.filter(isEffective).length;
  const showSalary = canArea("salary");
  const salary = rows.filter(isEffective).reduce((sum, row) => sum + numberValue(row.teacher_salary), 0);
  renderTopbar(`${monthLabel()} 教师个人课程明细`, selectedTeacher ? (showSalary ? `${selectedTeacher} · 在这里录入课时薪资` : selectedTeacher) : "未选择教师");
  contentEl.innerHTML = `
    <div class="query-head">
      <div class="metric">
        <div class="metric-label">教师姓名</div>
        ${auth.user?.role === "teacher" ? `<div class="metric-value small">${escapeHtml(selectedTeacher || "未绑定老师")}</div>` : `<select class="control teacher-select" style="margin-top:8px;width:100%">
          ${options(teachers, selectedTeacher, "选择教师")}
        </select>`}
      </div>
      <div class="metric"><div class="metric-label">有效课时</div><div class="metric-value">${count}</div></div>
      ${showSalary ? `<div class="metric"><div class="metric-label">薪资统计</div><div class="metric-value">${money(salary)}</div></div>` : ""}
      <div class="metric"><div class="metric-label">课程记录</div><div class="metric-value">${rows.length}</div></div>
    </div>
    <div class="band">
      <div class="table-wrap">
        <table class="course-table">
          <thead><tr><th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th class="wide">学生</th><th class="wide">备注</th>${showSalary ? "<th>教师薪资</th>" : ""}<th>学生人数</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="${isAbnormal(row) ? "abnormal" : ""}">
                <td class="text-cell">${escapeHtml(row.teacher_name)}</td><td class="text-cell">${escapeHtml(row.date)}</td><td class="text-cell">${statusBadge(rowStatus(row))}</td><td class="text-cell">${escapeHtml(weekdayCn(row.date))}</td><td class="text-cell">${escapeHtml(row.time_slot)}</td><td class="text-cell">${escapeHtml(row.classroom)}</td><td class="text-cell">${escapeHtml(row.grade)}</td><td class="text-cell">${escapeHtml(row.subject)}</td><td class="text-cell">${escapeHtml(row.student_names)}</td><td class="text-cell">${escapeHtml(row.notes)}</td>${showSalary ? inputCell({ className: "teacher-detail-salary-field", id: row.id, field: "teacher_salary", value: money(row.teacher_salary), type: "number" }) : ""}<td class="text-cell right">${splitStudents(row.student_names).length}</td>
              </tr>
            `).join("") || `<tr><td colspan="${showSalary ? 12 : 11}" class="empty">暂无该教师课程</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function courseNoticeFullMessage(item) {
  return `${item.greeting || ""}\n${courseNoticeState.data?.global_tail || ""}`;
}

function courseNoticeStatusText(item) {
  if (item.completed) return "已完成";
  if (item.partial_completed) return `部分完成 ${item.completed_count}/${item.lesson_count}`;
  return "待发送";
}

function renderCourseNoticePreview(item) {
  const rows = item.lessons || [];
  return `
    <div class="notice-shot-preview" data-shot-key="${escapeHtml(item.send_object_key)}">
      <table class="notice-shot-table">
        <thead>
          <tr>
            <th>授课老师</th><th>日期</th><th>上课情况</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th>学生</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((lesson) => `
            <tr>
              <td>${escapeHtml(lesson.teacher_name)}</td>
              <td>${escapeHtml(lesson.date)}</td>
              <td>${escapeHtml(lesson.lesson_status || lesson.status)}</td>
              <td>${escapeHtml(lesson.weekday || weekdayCn(lesson.date))}</td>
              <td>${escapeHtml(lesson.time_slot)}</td>
              <td>${escapeHtml(lesson.classroom)}</td>
              <td>${escapeHtml(lesson.grade)}</td>
              <td>${escapeHtml(lesson.subject)}</td>
              <td>${escapeHtml(lesson.student_names)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
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
          <span>起始日期</span>
          <input class="control custom-date-input course-notice-filter" data-field="start" type="date" value="${escapeHtml(courseNoticeFilter.start)}">
        </label>
        <label class="filter-field">
          <span>终末日期</span>
          <input class="control custom-date-input course-notice-filter" data-field="end" type="date" value="${escapeHtml(courseNoticeFilter.end)}">
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

function findCourseNoticeObject(key) {
  return (courseNoticeState.data?.send_objects || []).find((item) => item.send_object_key === key);
}

function updateCourseNoticeMessageDom(key) {
  const item = findCourseNoticeObject(key);
  const textarea = document.querySelector(`.notice-message[data-send-key="${CSS.escape(key)}"]`);
  if (item && textarea) textarea.value = courseNoticeFullMessage(item);
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

function courseNoticeCanvas(item) {
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
  const rows = item.lessons || [];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = "16px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  const headFont = "700 16px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  ctx.font = font;
  const paddingX = 18;
  const rowHeight = 44;
  const outerPadding = 30;
  const titleHeight = 58;
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
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(ratio, ratio);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#fbfdfc";
  ctx.fillRect(outerPadding / 2, outerPadding / 2, width - outerPadding, height - outerPadding);
  ctx.fillStyle = "#102a2a";
  ctx.font = "700 20px Microsoft YaHei, PingFang SC, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("课程通知", width / 2, outerPadding + 26);
  ctx.textAlign = "left";
  ctx.save();
  ctx.shadowColor = "rgba(16, 42, 42, 0.08)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(tableX, tableY, tableWidth, tableHeight);
  ctx.restore();
  ctx.strokeStyle = "#d9e9e8";
  ctx.strokeRect(tableX, tableY, tableWidth, tableHeight);
  let x = tableX;
  ctx.font = headFont;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  columns.forEach(([, label], index) => {
    ctx.fillStyle = "#eef8f6";
    ctx.fillRect(x, tableY, colWidths[index], rowHeight);
    ctx.strokeStyle = "#d9e9e8";
    ctx.strokeRect(x, tableY, colWidths[index], rowHeight);
    ctx.fillStyle = "#24524f";
    ctx.fillText(label, x + colWidths[index] / 2, tableY + rowHeight / 2);
    x += colWidths[index];
  });
  ctx.font = font;
  rows.forEach((row, rowIndex) => {
    x = tableX;
    const y = tableY + rowHeight * (rowIndex + 1);
    columns.forEach(([key], index) => {
      ctx.fillStyle = rowIndex % 2 ? "#fbfdfc" : "#ffffff";
      ctx.fillRect(x, y, colWidths[index], rowHeight);
      ctx.strokeStyle = "#e7f0ef";
      ctx.strokeRect(x, y, colWidths[index], rowHeight);
      ctx.fillStyle = "#17212b";
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

async function downloadCourseNoticeImage(item) {
  const canvas = courseNoticeCanvas(item);
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `${item.send_object_name || "课程安排"}.png`;
  link.click();
}

async function completeCourseNoticeItem(item) {
  await request("/api/course-notice/complete", {
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

async function copyCourseNoticeImage(item) {
  const canvas = courseNoticeCanvas(item);
  const blob = await canvasBlob(canvas);
  if (!navigator.clipboard?.write || !window.ClipboardItem) {
    await downloadCourseNoticeImage(item);
    throw new Error("当前浏览器不支持直接复制图片，已改为下载图片");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  await completeCourseNoticeItem(item);
  showToast(`${item.send_object_name} 已完成`);
  render();
}

function render() {
  const viewChanged = lastRenderedView && lastRenderedView !== view;
  lastRenderedView = view;
  renderNav();
  const renderers = {
    lessons: renderLessons,
    week: renderWeek,
    weekMatrix: renderWeekMatrix,
    courseNotice: renderCourseNotice,
    feeDetails: renderFeeDetails,
    summary: renderSummary,
    finance: renderFinance,
    recharges: renderRecharges,
    studentQuery: renderStudentQuery,
    audit: renderAudit,
    teacherProfiles: renderTeacherProfiles,
    studentProfiles: renderStudentProfiles,
    staffPayroll: renderStaffPayroll,
    staffAttendance: renderStaffAttendance,
    expenses: renderExpenses,
    pricing: renderPricing,
    userAdmin: renderUserAdmin,
    studentPricing: renderStudentPricing,
    teacherSalary: renderTeacherSalary,
    teacherDetail: renderTeacherDetail,
  };
  (renderers[view] || renderLessons)();
  wireEvents();
  if (viewChanged) {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0 });
      document.querySelector(".main")?.scrollTo?.({ top: 0, left: 0 });
      contentEl.scrollTo?.({ top: 0, left: 0 });
    });
  }
}

async function refreshAfter(action) {
  try {
    const result = await action();
    if (result?.warnings?.length) {
      alert(result.warnings.map((warning) => warning.message || warning.type).join("\n"));
    }
    await load();
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

function wireEvents() {
  document.querySelectorAll(".filter-combo").forEach((combo) => {
    const input = combo.querySelector(".filter-combo-input");
    const menu = combo.querySelector(".filter-combo-menu");
    const close = () => combo.classList.remove("open");
    combo.querySelector(".filter-combo-toggle")?.addEventListener("click", (event) => {
      event.preventDefault();
      document.querySelectorAll(".filter-combo.open").forEach((item) => {
        if (item !== combo) item.classList.remove("open");
      });
      combo.classList.toggle("open");
    });
    menu?.querySelectorAll(".filter-combo-option").forEach((option) => {
      option.addEventListener("click", () => {
        input.value = option.dataset.value || "";
        close();
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        combo.classList.add("open");
        menu?.querySelector(".filter-combo-option")?.focus();
      }
      if (event.key === "Escape") close();
    });
    menu?.addEventListener("keydown", (event) => {
      const optionsList = [...menu.querySelectorAll(".filter-combo-option")];
      const index = optionsList.indexOf(document.activeElement);
      if (event.key === "Escape") {
        close();
        input?.focus();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        optionsList[Math.min(optionsList.length - 1, index + 1)]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        optionsList[Math.max(0, index - 1)]?.focus();
      }
    });
  });

  if (!filterComboEventsBound) {
    filterComboEventsBound = true;
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".filter-combo")) {
        document.querySelectorAll(".filter-combo.open").forEach((combo) => combo.classList.remove("open"));
      }
    });
  }

  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const group = navGroups.find((item) => item.key === button.dataset.group);
      if (!group) return;
      activeNavGroup = group.key;
      const allowedViews = groupViews(group).filter(([key]) => canView(key));
      if (!allowedViews.some(([key]) => key === view)) {
        view = allowedViews[0]?.[0] || firstAllowedView();
        if (view === "courseNotice") resetCourseNoticeFilterToThisWeek();
      }
      localStorage.setItem("liming:view", view);
      localStorage.setItem("liming:nav-group", activeNavGroup);
      render();
    });
  });

  document.querySelectorAll(".nav-sub-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const nextView = button.dataset.view;
      if (nextView === "courseNotice" && view !== "courseNotice") resetCourseNoticeFilterToThisWeek();
      view = nextView;
      activeNavGroup = button.dataset.group || groupForView(view).key;
      localStorage.setItem("liming:view", view);
      localStorage.setItem("liming:nav-group", activeNavGroup);
      render();
    });
  });

  document.querySelectorAll(".month-select").forEach((select) => {
    select.addEventListener("change", async () => {
      activeMonth = select.value;
      localStorage.setItem("liming:month", activeMonth);
      resetFinanceRangeToActiveMonth();
      await load();
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
        alert(`${from} ${result.carried_students || 0} 位学生，实际余额合计 ¥${money2(result.carried_actual || 0)}，赠送余额合计 ¥${money2(result.carried_gift || 0)}`);
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

  document.querySelectorAll(".logout-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      await request("/api/auth/logout", { method: "POST" });
      auth.user = null;
      renderLogin();
    });
  });

  document.querySelectorAll(".open-password-modal").forEach((button) => {
    button.addEventListener("click", () => {
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

  document.querySelectorAll(".new-profile").forEach((button) => {
    button.addEventListener("click", () => {
      profileModal = { kind: button.dataset.kind || profileTab };
      render();
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
        await request(`/api/${kind}`, { method: "POST", body: payload });
        profileModal = null;
        await load();
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
      }));
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

  document.querySelectorAll(".import-teacher-users").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("从 data/templates/teacher_template.xlsx 创建或更新老师账号？新账号密码为手机号后 6 位。")) return;
      const result = await request("/api/users/import-teachers-template", { method: "POST", body: {} });
      userAdminNotice = `已处理 ${result.total || 0} 位老师：新增 ${result.created || 0} 个账号，更新 ${result.updated || 0} 个账号。新账号规则：账号为手机号，初始密码为手机号后 6 位。备份：${result.backup || "已生成"}`;
      await load();
    });
  });

  document.querySelectorAll(".create-user").forEach((button) => {
    button.addEventListener("click", async () => {
      const payload = {};
      document.querySelectorAll(".new-user-field").forEach((input) => {
        payload[input.dataset.field] = input.value;
      });
      if (!payload.password) payload.password = "123456";
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
      }));
    });
  });

  document.querySelectorAll(".user-reset-password").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest(".user-row");
      const password = row.querySelector(".user-reset-password-value")?.value || "";
      if (password.length < 6) return alert("新密码至少 6 位");
      await request(`/api/users/${row.dataset.id}/password`, { method: "POST", body: { password } });
      userAdminNotice = "密码已重置。";
      await load();
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
        await load();
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

  document.querySelectorAll(".summary-scope-option").forEach((button) => {
    button.addEventListener("click", () => {
      summaryScope = button.dataset.scope === "toDate" ? "toDate" : "month";
      localStorage.setItem(SUMMARY_SCOPE_KEY, summaryScope);
      render();
    });
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
    if (input.tagName === "SELECT") {
      input.addEventListener("change", () => {
        applyStudentPricingFilter(input.value);
        render();
      });
      return;
    }
    input.addEventListener("input", () => {
      applyStudentPricingFilter(input.value);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        applyStudentPricingFilter(input.value);
        render();
      }
    });
    input.addEventListener("change", () => {
      applyStudentPricingFilter(input.value);
    });
  });

  document.querySelectorAll(".apply-student-pricing-filter").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".student-pricing-filter-input").forEach((input) => {
        const field = input.dataset.filterField;
        const value = field === "price"
          ? canonicalFilterValue(priceFilterOptions, input.value)
          : field === "usage"
            ? canonicalFilterValue(usageFilterOptions, input.value)
            : input.value;
        studentPricingFilter = { ...studentPricingFilter, [field]: value };
      });
      render();
    });
  });

  document.querySelectorAll(".reset-student-pricing-filter").forEach((button) => {
    button.addEventListener("click", () => {
      studentPricingFilter = { student: "", subject: "", price: "", usage: "" };
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
    lessonCopyDraft = null;
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

  document.querySelectorAll(".lesson-copy-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const lesson = state.lessons.find((row) => String(row.id) === String(button.dataset.lessonId));
      if (!lesson) return;
      lessonCopyDraft = {
        lessonId: Number(lesson.id),
        targetDate: addDays(lesson.date, 1),
        multi: false,
        multiText: addDays(lesson.date, 1),
      };
      render();
    });
  });

  document.querySelectorAll(".lesson-copy-cancel").forEach((button) => {
    button.addEventListener("click", () => {
      lessonCopyDraft = null;
      render();
    });
  });

  document.querySelectorAll(".lesson-copy-quick").forEach((button) => {
    button.addEventListener("click", () => {
      const lesson = state.lessons.find((row) => Number(row.id) === Number(lessonCopyDraft?.lessonId));
      if (!lesson) return;
      const targetDate = addDays(lesson.date, Number(button.dataset.days || 1));
      lessonCopyDraft = { ...lessonCopyDraft, targetDate, multiText: targetDate };
      render();
    });
  });

  document.querySelectorAll(".lesson-copy-date").forEach((input) => {
    input.addEventListener("change", () => {
      lessonCopyDraft = { ...lessonCopyDraft, targetDate: input.value, multiText: input.value };
      render();
    });
  });

  document.querySelectorAll(".lesson-copy-multi-toggle").forEach((input) => {
    input.addEventListener("change", () => {
      lessonCopyDraft = { ...lessonCopyDraft, multi: input.checked };
      render();
    });
  });

  document.querySelectorAll(".lesson-copy-confirm").forEach((button) => {
    button.addEventListener("click", async () => {
      const modal = button.closest(".copy-modal");
      const useMulti = modal.querySelector(".lesson-copy-multi-toggle")?.checked;
      const dates = useMulti
        ? parseDateList(modal.querySelector(".lesson-copy-dates")?.value)
        : [modal.querySelector(".lesson-copy-date")?.value].filter(isDateValue);
      if (!dates.length) return alert("请选择目标日期");
      if (dates.length > 7) return alert("多选日期最多 7 天");
      try {
        const result = await request("/api/lessons/copy", {
          method: "POST",
          body: { source_lesson_ids: [Number(button.dataset.lessonId)], target_dates: dates, reset_status: true },
        });
        await afterCopy(result);
      } catch (error) {
        alert(error.message);
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

  document.querySelectorAll(".lesson-field").forEach((input) => {
    input.addEventListener("change", () => {
      const value = input.type === "number" ? numberValue(input.value) : input.value;
      refreshAfter(() => request(`/api/lessons/${input.dataset.id}`, {
        method: "PATCH",
        body: { [input.dataset.field]: value },
      }));
    });
  });

  document.querySelectorAll(".teacher-detail-salary-field").forEach((input) => {
    input.addEventListener("change", () => {
      refreshAfter(() => request(`/api/lessons/${input.dataset.id}`, {
        method: "PATCH",
        body: { teacher_salary: numberValue(input.value) },
      }));
    });
  });

  document.querySelectorAll(".add-lesson").forEach((button) => {
    button.addEventListener("click", () => refreshAfter(() => request("/api/lessons", {
      method: "POST",
      body: { date: state.settings.month_key, month_key: state.settings.month_key, status: "待上" },
    })));
  });

  document.querySelectorAll(".delete-lesson").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm("删除这条课程记录？")) return;
      refreshAfter(() => request(`/api/lessons/${button.dataset.id}`, { method: "DELETE" }));
    });
  });

  document.querySelectorAll(".week-tab").forEach((button) => {
    button.addEventListener("click", () => {
      activeWeek = Number(button.dataset.week);
      localStorage.setItem("liming:week", String(activeWeek));
      if (view === "weekMatrix") {
        matrixRange = matrixDefaultRange(state.settings.month_key || activeMonth);
        saveMatrixRange();
      }
      render();
    });
  });

  document.querySelectorAll(".matrix-range-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const field = input.dataset.field;
      matrixRange = {
        ...matrixRange,
        month_key: state.settings.month_key || activeMonth,
        [field]: input.value,
      };
      if (matrixRange.start && matrixRange.end && matrixRange.start > matrixRange.end) {
        matrixRange = { ...matrixRange, [field === "start" ? "end" : "start"]: input.value };
      }
      saveMatrixRange();
      await load();
    });
  });

  document.querySelectorAll(".matrix-range-reset").forEach((button) => {
    button.addEventListener("click", () => {
      matrixRange = matrixDefaultRange(state.settings.month_key || activeMonth);
      saveMatrixRange();
      render();
    });
  });

  document.querySelectorAll(".rollover-recharges").forEach((button) => {
    button.addEventListener("click", async () => {
      const toMonth = state.settings.month_key;
      const fromMonth = previousMonth(toMonth);
      if (!fromMonth) return alert("当前月份无效，无法结转");
      if (!confirm(`从 ${formatMonthOption(fromMonth)} 结转余额到 ${formatMonthOption(toMonth)}？自动结转和空白结转会刷新，已手工填写的非 0 结转会跳过。`)) return;
      const result = await request(`/api/recharges/rollover?from=${encodeURIComponent(fromMonth)}&to=${encodeURIComponent(toMonth)}`, { method: "POST" });
      if (result.skipped > 0 && confirm(`新增 ${result.inserted} 人，更新 ${result.updated} 人，跳过 ${result.skipped} 人。是否覆盖这些手工结转？`)) {
        const forced = await request(`/api/recharges/rollover?from=${encodeURIComponent(fromMonth)}&to=${encodeURIComponent(toMonth)}&force=1`, { method: "POST" });
        alert(`结转完成：新增 ${forced.inserted} 人，覆盖 ${forced.updated} 人，跳过 ${forced.skipped} 人。`);
      } else {
        alert(`结转完成：新增 ${result.inserted} 人，更新 ${result.updated} 人，跳过 ${result.skipped} 人。`);
      }
      await load();
    });
  });

  document.querySelectorAll(".finance-range-input").forEach((input) => {
    input.addEventListener("change", async () => {
      financeRange = { ...financeRange, [input.dataset.field]: input.value, preset: "custom" };
      saveFinanceRange();
      state.finance = await request(`/api/finance-summary?${financeRangeQuery()}`);
      render();
    });
  });

  document.querySelectorAll(".finance-preset").forEach((button) => {
    button.addEventListener("click", async () => {
      financeRange = financePresetRange(button.dataset.preset);
      saveFinanceRange();
      state.finance = await request(`/api/finance-summary?${financeRangeQuery()}`);
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
      if (numberValue(payload.cur_recharge) < 0 && !confirm(`充值金额为负数(${money(payload.cur_recharge)})，确认这是退费操作？`)) {
        load();
        return;
      }
      refreshAfter(() => request("/api/recharges", {
        method: "POST",
        body: {
          student_name: row.dataset.studentName,
          grade: summary.grade || "",
          month_key: state.settings.month_key,
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

  document.querySelectorAll(".student-pricing-field").forEach((input) => {
    input.addEventListener("change", () => {
      const value = input.type === "number" ? numberValue(input.value) : input.value;
      if (input.dataset.field === "custom_price" && numberValue(value) <= 0) {
        alert("学生专享价必须大于 0。试课请设置课程状态，退费/减免请到费用明细做单节手动覆盖。");
        return load();
      }
      refreshAfter(() => request(`/api/student-pricing/${input.dataset.id}`, {
        method: "PATCH",
        body: { [input.dataset.field]: value },
      }));
    });
  });

  document.querySelectorAll(".add-student-price").forEach((button) => {
    button.addEventListener("click", () => {
      const studentName = document.querySelector("#new-student-price-name").value.trim();
      const subject = document.querySelector("#new-student-price-subject").value;
      const customPrice = document.querySelector("#new-student-price-value").value;
      const notes = document.querySelector("#new-student-price-notes").value;
      if (!studentName || !subject) return alert("请填写学生姓名和科目");
      if (numberValue(customPrice) <= 0) return alert("学生专享价必须大于 0。试课请设置课程状态，退费/减免请到费用明细做单节手动覆盖。");
      refreshAfter(() => request("/api/student-pricing", {
        method: "POST",
        body: { student_name: studentName, subject, custom_price: customPrice, notes },
      }));
    });
  });

  document.querySelectorAll(".delete-student-price").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm("删除这条个性化单价？")) return;
      refreshAfter(() => request(`/api/student-pricing/${button.dataset.id}`, { method: "DELETE" }));
    });
  });

  document.querySelectorAll(".pricing-impact-btn").forEach((button) => {
    button.addEventListener("click", () => {
      pricingAuditModal = {
        student_name: button.dataset.name,
        subject: button.dataset.subject,
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
      if (!confirm(`将清除 ${manualCount} 条手填价格，并重算 ${count} 节课程，回归个性价 ¥${price}，是否继续？`)) return;
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
      if (event.key === "Enter") document.querySelector(".student-query-apply")?.click();
    });
    input.addEventListener("change", () => {
      studentQueryNameDraft = input.value;
    });
  });

  document.querySelectorAll(".student-query-apply").forEach((button) => {
    button.addEventListener("click", async () => {
      selectedStudent = String(document.querySelector(".student-query-name")?.value || "").trim();
      studentQueryNameDraft = selectedStudent;
      await refreshStudentQueryOnly();
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

  document.querySelectorAll(".student-query-range").forEach((input) => {
    input.addEventListener("change", async () => {
      studentQueryRange = { ...studentQueryRange, mode: "range", [input.dataset.field]: input.value };
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
    button.addEventListener("click", () => {
      if (!state.student_statement?.summary) return alert("请先查询学生");
      studentStatementModalOpen = true;
      render();
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

  document.querySelectorAll(".teacher-select").forEach((select) => {
    select.addEventListener("change", () => {
      selectedTeacher = select.value;
      render();
    });
  });

  document.querySelectorAll(".export-teacher-salary").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `/api/export/teacher-salary.xlsx?month=${encodeURIComponent(state.settings.month_key)}`;
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

  enhanceCustomSelects();
  enhanceCustomDateInputs();
}

load().catch((error) => {
  contentEl.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
});
