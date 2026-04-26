const navGroups = [
  { key: "schedule", label: "📅 排课", views: [["lessons", "课程总表"], ["week", "周课表"]] },
  {
    key: "students",
    label: "👥 学生",
    views: [["feeDetails", "费用明细"], ["summary", "费用汇总"], ["studentQuery", "学生查询"], ["recharges", "充值记录"]],
    moreViews: [["studentPricing", "学生单价"]],
  },
  { key: "teachers", label: "👨‍🏫 教师", views: [["teacherSalary", "教师薪资"], ["teacherDetail", "教师明细"]] },
  { key: "operations", label: "💼 运营", views: [["staffPayroll", "员工薪资"], ["staffProfiles", "员工档案"], ["expenses", "日常开销"]] },
  { key: "finance", label: "📊 经营概览", views: [["finance", "期间概览"]] },
  { key: "settings", label: "⚙️ 设置", views: [["pricing", "费用标准"], ["studentPricing", "学生单价"], ["profiles", "档案管理"], ["audit", "数据对账"]] },
];

const gradeOrder = ["初一", "初二", "初三", "高一", "高二", "高三"];
const LESSON_FILTER_KEY = "liming:lesson-filter";
const SUMMARY_EXPAND_KEY = "liming:summary-expanded";
const RECHARGE_SOURCE_FILTER_KEY = "liming:recharge-source-filter";
const FINANCE_RANGE_KEY = "liming:finance-range";
const THEME_KEY = "liming:theme";
let state = null;
let view = localStorage.getItem("liming:view") || "lessons";
let activeWeek = Number(localStorage.getItem("liming:week") || 0);
let months = [];
let activeMonth = localStorage.getItem("liming:month") || "";
let includeInactive = localStorage.getItem("liming:include-inactive") === "1";
let themeMode = localStorage.getItem(THEME_KEY) || "system";
let selectedStudent = "";
let selectedTeacher = "";
let lessonFilter = readLessonFilter();
let expandedSummaryStudents = readExpandedSummaryStudents();
let activeNavGroup = localStorage.getItem("liming:nav-group") || "";
let rechargeSourceFilter = localStorage.getItem(RECHARGE_SOURCE_FILTER_KEY) || "all";
let rechargeStudentFilter = "";
let rechargeGradeFilter = "";
let feeDetailsFilter = { month_key: "", student: "", teacher: "", grade: "", status: "", source: "", start: "", end: "" };
let summaryFilter = { student: "", grade: "", balance: "" };
let studentPricingFilter = { student: "", subject: "", price: "", usage: "" };
let financeRange = readFinanceRange();
let monthDeleteDraft = null;
let profileTab = localStorage.getItem("liming:profile-tab") || "teachers";
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
let auditState = { xlsxReport: null, internalReport: null, logs: [], busy: false, notice: "" };
let customSelectEventsBound = false;
let customDateEventsBound = false;
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

async function request(path, options = {}) {
  const config = {
    method: options.method || "GET",
    headers: { "content-type": "application/json" },
  };
  if (options.body !== undefined) config.body = JSON.stringify(options.body);
  const res = await fetch(path, config);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function debounce(fn, delay = 200) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function concatBytes(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

let crc32Table = null;

function crc32Bytes(bytes) {
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let j = 0; j < 8; j += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crc32Table[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime() {
  const now = new Date();
  return {
    time: (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2),
    day: ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
  };
}

function writeZipHeader(size, writer) {
  const bytes = new Uint8Array(size);
  writer(new DataView(bytes.buffer));
  return bytes;
}

function zipStoreFiles(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  const { time, day } = zipDateTime();
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.bytes instanceof Uint8Array ? file.bytes : encoder.encode(file.text || "");
    const crc = crc32Bytes(data);
    const local = writeZipHeader(30, (view) => {
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, time, true);
      view.setUint16(12, day, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, name.length, true);
      view.setUint16(28, 0, true);
    });
    localParts.push(local, name, data);

    const central = writeZipHeader(46, (view) => {
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, time, true);
      view.setUint16(14, day, true);
      view.setUint32(16, crc, true);
      view.setUint32(20, data.length, true);
      view.setUint32(24, data.length, true);
      view.setUint16(28, name.length, true);
      view.setUint16(30, 0, true);
      view.setUint16(32, 0, true);
      view.setUint16(34, 0, true);
      view.setUint16(36, 0, true);
      view.setUint32(38, 0, true);
      view.setUint32(42, offset, true);
    });
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralStart = offset;
  const centralBuffer = concatBytes(centralParts);
  const end = writeZipHeader(22, (view) => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, files.length, true);
    view.setUint16(10, files.length, true);
    view.setUint32(12, centralBuffer.length, true);
    view.setUint32(16, centralStart, true);
    view.setUint16(20, 0, true);
  });
  return concatBytes([...localParts, centralBuffer, end]);
}

function svgSize(svg) {
  const width = Number(String(svg).match(/\bwidth="(\d+(?:\.\d+)?)"/)?.[1] || 1080);
  const height = Number(String(svg).match(/\bheight="(\d+(?:\.\d+)?)"/)?.[1] || 1600);
  return { width, height };
}

async function svgToPngBytes(svg, scale = 1.5) {
  const { width, height } = svgSize(svg);
  const image = new Image();
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    image.src = url;
    await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f3f7f6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.96));
    if (!blob) throw new Error("PNG 生成失败");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

function downloadBytes(filename, bytes, type = "application/octet-stream") {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  customDatePickerEl.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-month-offset]");
    if (nav && activeCustomDateInput) {
      activeCustomDateMonth.setMonth(activeCustomDateMonth.getMonth() + Number(nav.dataset.monthOffset || 0));
      renderCustomDatePicker();
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
  document.querySelectorAll('.date-range-inputs input[type="date"]').forEach((input) => {
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

async function exportWeeklySchedulePngZip(audience, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "生成 PNG…";
  try {
    const manifest = await request(
      `/api/export/weekly-schedule-images.json?month=${encodeURIComponent(state.settings.month_key)}&week=${activeWeek}&audience=${encodeURIComponent(audience)}`,
    );
    const files = [];
    let index = 0;
    const imageFiles = (manifest.files || []).filter((file) => file.type === "svg");
    for (const file of manifest.files || []) {
      if (file.type === "text") {
        files.push({ name: file.name, text: file.text || "" });
        continue;
      }
      index += 1;
      button.textContent = `生成 PNG ${index}/${imageFiles.length}`;
      files.push({
        name: file.name,
        bytes: await svgToPngBytes(file.svg || ""),
      });
    }
    if (!files.some((file) => String(file.name).toLowerCase().endsWith(".png"))) {
      throw new Error("本周暂无可导出的课表图片");
    }
    downloadBytes(manifest.filename || "周课表PNG.zip", zipStoreFiles(files), "application/zip");
  } catch (error) {
    alert(error.message || "PNG 导出失败");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function load() {
  months = await request("/api/months");
  const params = new URLSearchParams();
  if (activeMonth) params.set("month", activeMonth);
  if (includeInactive) params.set("include_inactive", "1");
  const query = params.toString() ? `?${params.toString()}` : "";
  state = await request(`/api/bootstrap${query}`);
  activeMonth = state.active_month_key || state.settings.month_key || activeMonth;
  if (activeMonth && !months.includes(activeMonth)) months = [activeMonth, ...months];
  localStorage.setItem("liming:month", activeMonth);
  ensureFinanceRangeDates();
  state.finance = await request(`/api/finance-summary?${financeRangeQuery()}`);
  state.profile_teachers = (await request("/api/teachers")).teachers || [];
  state.profile_students = (await request("/api/students")).students || [];
  state.staff = (await request("/api/staff")).staff || [];
  state.staff_salary = (await request(`/api/staff-salary?month=${encodeURIComponent(activeMonth)}`)).rows || [];
  ensureExpenseFilterDates();
  const expenseParams = new URLSearchParams();
  if (expenseFilter.start) expenseParams.set("start", expenseFilter.start);
  if (expenseFilter.end) expenseParams.set("end", expenseFilter.end);
  if (expenseFilter.category) expenseParams.set("category", expenseFilter.category);
  if (expenseFilter.q) expenseParams.set("q", expenseFilter.q);
  state.expenses = (await request(`/api/operating-expenses?${expenseParams.toString()}`)).expenses || [];
  state.schedule_conflicts = await request(`/api/schedule-conflicts?month=${encodeURIComponent(activeMonth)}`)
    .catch(() => ({ issues: [], counts: { teacher: 0, student: 0, classroom: 0, invalid_time: 0 } }));
  const students = state.derived.student_summary.map((row) => row.student_name);
  if (selectedStudent && !students.includes(selectedStudent)) selectedStudent = "";
  state.student_history = selectedStudent
    ? ((await request(`/api/student/${encodeURIComponent(selectedStudent)}/history`)).history || [])
    : [];
  const teachers = state.teachers.map((row) => row.name);
  if (!selectedTeacher || !teachers.includes(selectedTeacher)) selectedTeacher = teachers[0] || "";
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
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
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

function readFinanceRange() {
  try {
    return { start: "", end: "", preset: "month", ...JSON.parse(localStorage.getItem(FINANCE_RANGE_KEY) || "{}") };
  } catch {
    return { start: "", end: "", preset: "month" };
  }
}

function isDateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

function saveFinanceRange() {
  localStorage.setItem(FINANCE_RANGE_KEY, JSON.stringify(financeRange));
}

function ensureFinanceRangeDates() {
  if (isDateValue(financeRange.start) && isDateValue(financeRange.end) && financeRange.start <= financeRange.end) return;
  financeRange = { ...financeRange, ...monthBounds(activeMonth), preset: "month" };
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
  if (preset === "month") return { ...monthBounds(activeMonth), preset };
  if (preset === "prev-month") return { ...monthBounds(previousMonth(activeMonth)), preset };
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
  if (filter.teacher && row.teacher_name !== filter.teacher) return false;
  if (filter.student) {
    const needle = filter.student.toLowerCase();
    if (!splitStudents(row.student_names).some((name) => name.toLowerCase().includes(needle))) return false;
  }
  if (includeDate) {
    if (filter.start_date && (!row.date || row.date < filter.start_date)) return false;
    if (filter.end_date && (!row.date || row.date > filter.end_date)) return false;
  }
  if (includeStatus && filter.status && rowStatus(row) !== filter.status) return false;
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

function renderLessonFilterBar({ rows, filteredRows, compact = false }) {
  const opts = lessonFilterOptions(rows);
  const teacherSelect = `
    <label class="filter-field">
      <span>老师</span>
      <select class="control lesson-filter-input" data-filter-field="teacher">
        ${filterSelectOptions(opts.teachers, lessonFilter.teacher, "全部")}
      </select>
    </label>
  `;
  const studentInput = `
    <label class="filter-field">
      <span>学生</span>
      <input class="control lesson-filter-input" data-filter-field="student" type="text" autocomplete="off" spellcheck="false" placeholder="输入学生姓名" value="${escapeHtml(lessonFilter.student)}">
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
      <select class="control lesson-filter-input" data-filter-field="status">
        ${options(statusValues(), lessonFilter.status, "全部")}
      </select>
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
  if (filter.teacher && row.teacher_name !== filter.teacher) return false;
  if (filter.grade && row.grade !== filter.grade) return false;
  if (filter.status) {
    const status = rowStatus(row);
    const match = status === filter.status
      || (filter.status === "未上" && (status === "待上" || row.course_status === "未上"))
      || (filter.status === "暂停" && String(row.course_status || "").startsWith("暂停"))
      || (filter.status === "调课" && String(row.notes || "").includes("调课"));
    if (!match) return false;
  }
  if (filter.source && priceSourceFilterValue(row.price_source) !== filter.source) return false;
  if (filter.start && (!row.date || row.date < filter.start)) return false;
  if (filter.end && (!row.date || row.date > filter.end)) return false;
  return true;
}

function renderFeeDetailsFilterBar(rows, filteredRows) {
  const students = uniqueSorted(rows.map((row) => row.student_name));
  const teachers = uniqueSorted(rows.map((row) => row.teacher_name));
  const grades = uniqueSorted(rows.map((row) => row.grade));
  const sourceOption = (value, label) => `<option value="${value}" ${feeDetailsFilter.source === value ? "selected" : ""}>${label}</option>`;
  return `
    <div class="filter-bar">
      <div class="filter-controls">
        <label class="filter-field">
          <span>学生姓名</span>
          <input class="control fee-details-filter-input" data-filter-field="student" type="text" autocomplete="off" spellcheck="false" placeholder="输入学生姓名" value="${escapeHtml(feeDetailsFilter.student)}">
        </label>
        <label class="filter-field">
          <span>授课老师</span>
          <select class="control fee-details-filter-input" data-filter-field="teacher">${filterSelectOptions(teachers, feeDetailsFilter.teacher, "全部")}</select>
        </label>
        <label class="filter-field">
          <span>年级</span>
          <select class="control fee-details-filter-input" data-filter-field="grade">${filterSelectOptions(grades, feeDetailsFilter.grade, "全部")}</select>
        </label>
        <label class="filter-field">
          <span>状态</span>
          <select class="control fee-details-filter-input" data-filter-field="status">${filterSelectOptions(feeDetailStatusOptions(), feeDetailsFilter.status, "全部")}</select>
        </label>
        <label class="filter-field">
          <span>价格来源</span>
          <select class="control fee-details-filter-input" data-filter-field="source">
            ${sourceOption("", "全部")}
            ${sourceOption("standard", "标准价")}
            ${sourceOption("custom", "个性价")}
            ${sourceOption("manual", "手填")}
            ${sourceOption("exam", "考试")}
            ${sourceOption("trial", "试课")}
            ${sourceOption("waiver", "退费/减免")}
          </select>
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
  if (summaryFilter.grade && row.grade !== summaryFilter.grade) return false;
  if (summaryFilter.balance === "actual" && numberValue(row.actual_balance) === 0) return false;
  if (summaryFilter.balance === "gift" && numberValue(row.gift_balance) === 0) return false;
  if (summaryFilter.balance === "zero" && (numberValue(row.actual_balance) !== 0 || numberValue(row.gift_balance) !== 0)) return false;
  return true;
}

function renderSummaryFilterBar(rows, filteredRows) {
  const students = uniqueSorted(rows.map((row) => row.student_name));
  const grades = uniqueSorted(rows.map((row) => row.grade));
  return `
    <div class="filter-bar compact summary-filter-bar">
      <label>学生姓名</label>
      <input class="control summary-filter-input" data-filter-field="student" type="text" autocomplete="off" spellcheck="false" placeholder="输入学生姓名" value="${escapeHtml(summaryFilter.student)}">
      <label>年级</label>
      <select class="control summary-filter-input" data-filter-field="grade">${filterSelectOptions(grades, summaryFilter.grade, "全部")}</select>
      <label>余额状态</label>
      <select class="control summary-filter-input" data-filter-field="balance">
        <option value="" ${summaryFilter.balance === "" ? "selected" : ""}>全部</option>
        <option value="actual" ${summaryFilter.balance === "actual" ? "selected" : ""}>有现金余额</option>
        <option value="gift" ${summaryFilter.balance === "gift" ? "selected" : ""}>有赠送余额</option>
        <option value="zero" ${summaryFilter.balance === "zero" ? "selected" : ""}>全为零</option>
      </select>
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
      <input class="cell-input number fee-override ${row.price_source === "manual" ? "manual-price" : ""}" data-lesson-id="${row.lesson_id}" data-student-name="${escapeHtml(row.student_name)}" type="number" value="${money(row.unit_price)}" title="${title}" ${locked ? "disabled" : ""}>
      ${priceSourceBadge(row)}
    </td>
  `;
}

function readonlyPriceCell(row) {
  const title = escapeHtml(priceSourceTitle(row));
  return `<td class="text-cell right price-cell-wrap" title="${title}"><span>${money(row.unit_price)}</span>${priceSourceBadge(row)}</td>`;
}

function yuan(value) {
  return `¥${money2(value)}`;
}

function balanceMiniCard(title, items) {
  return `
    <div class="balance-mini-card">
      <div class="balance-mini-title">${escapeHtml(title)}</div>
      <div class="balance-mini-lines">
        ${items.map((item) => `
          <div class="balance-mini-line">
            <span>${escapeHtml(item.label)}</span>
            <strong class="${numberValue(item.value) < 0 ? "negative" : ""}">${yuan(item.value)}</strong>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function balanceDetailCards(row) {
  return `
    <div class="balance-card-grid">
      ${balanceMiniCard("月初余额", [
        { label: "现金", value: row.prev_actual },
        { label: "赠送", value: row.prev_gift },
      ])}
      ${balanceMiniCard("本月新充", [
        { label: "现金", value: row.cur_recharge },
        { label: "赠送", value: row.cur_gift },
      ])}
      ${balanceMiniCard("本月消费", [
        { label: "课程费用", value: row.total_fee },
      ])}
      ${balanceMiniCard("月末结余", [
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

function bindSafeTextInput(input, applyValue, renderAction, delay = 380) {
  let composing = false;
  const selector = inputFocusSelector(input);
  const commit = debounce(async () => {
    const value = input.value;
    await renderAction();
    restoreInputFocus(selector, value);
  }, delay);
  const apply = () => {
    applyValue(input.value);
    commit();
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
  input.addEventListener("change", () => {
    if (!composing) apply();
  });
}

function inputCell({ className, id, field, value, type = "text", extra = "" }) {
  return `
    <td>
      <input class="cell-input ${className} ${type === "number" ? "number" : ""}" data-id="${id}" data-field="${field}" type="${type}" value="${escapeHtml(value ?? "")}" ${extra}>
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
  const tabs = [...(group.views || []), ...(group.moreViews || [])].map(([key, label]) => `
    <button class="nav-sub-btn ${view === key ? "active" : ""}" data-group="${group.key}" data-view="${key}">
      ${escapeHtml(label)}
    </button>
  `).join("");
  if (!tabs) return "";
  return `<div class="nav-subtabs">${tabs}</div>`;
}

function renderNav() {
  const currentGroup = activeGroup();
  navEl.innerHTML = navGroups.map((group) => `
    <div class="nav-group ${currentGroup.key === group.key ? "open" : ""}">
      <button class="nav-btn ${currentGroup.key === group.key ? "active" : ""}" data-group="${group.key}">
        <span>${escapeHtml(group.label)}</span>
      </button>
      ${currentGroup.key === group.key && groupViews(group).length > 1 ? renderSecondaryNav(group) : ""}
    </div>
  `).join("");
}

function renderTopbar(title, meta = "", actions = "") {
  const monthOptions = months.map((month) => `
    <option value="${escapeHtml(month)}" ${month === activeMonth ? "selected" : ""}>${escapeHtml(formatMonthOption(month))}</option>
  `).join("");
  topbarEl.innerHTML = `
    <div class="title-block">
      <div class="page-title">${escapeHtml(title)}</div>
      <div class="page-meta">${escapeHtml(meta)}</div>
    </div>
    <div class="toolbar">
      <label>月份</label>
      <select class="control month-select">
        ${monthOptions}
      </select>
      <label>主题</label>
      <select class="control theme-select" title="默认跟随系统">
        <option value="system" ${themeMode === "system" ? "selected" : ""}>跟随系统</option>
        <option value="light" ${themeMode === "light" ? "selected" : ""}>亮色</option>
        <option value="dark" ${themeMode === "dark" ? "selected" : ""}>暗色</option>
      </select>
      <button class="btn new-month" type="button">新建月份</button>
      <button class="btn icon-btn delete-month" type="button" title="删除当前月份" aria-label="删除当前月份">🗑</button>
      ${actions}
    </div>
    ${monthDeleteModal()}
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

function sortedLessons() {
  return [...state.lessons].sort((a, b) => {
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
      ${inputCell({ className: "lesson-field", id: row.id, field: "teacher_salary", value: money(row.teacher_salary), type: "number" })}
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
  return sortedLessons()
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
              <th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th class="wide">学生</th><th class="wide">备注</th><th>教师薪资</th><th>学生人数</th><th>累计序号</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => {
              cumulative += splitStudents(row.student_names).length;
              return lessonRow(row, cumulative);
            }).join("") || `<tr><td colspan="14" class="empty">暂无课程记录</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    ${lessonCopyModal()}
    ${weekCopyModal()}
  `;
}

function weekRanges() {
  const month = state.settings.month_key || "2026-04-01";
  const date = new Date(`${month}T00:00:00`);
  const y = date.getFullYear();
  const m = date.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const ranges = [[1, 8], [9, 15], [16, 22], [23, last]];
  return ranges.map(([start, end]) => ({
    start,
    end,
    label: `${m + 1}.${start}-${m + 1}.${end}`,
    includes(value) {
      const d = new Date(`${value}T00:00:00`);
      return d.getFullYear() === y && d.getMonth() === m && d.getDate() >= start && d.getDate() <= end;
    },
  }));
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

function scheduleConflictPanel(issues) {
  const counts = { teacher: 0, student: 0, classroom: 0, invalid_time: 0 };
  for (const issue of issues) counts[issue.type] = (counts[issue.type] || 0) + 1;
  const total = issues.length;
  const preview = issues.slice(0, 12);
  return `
    <div class="band schedule-conflict-panel ${total ? "has-conflict" : "ok"}">
      <div class="section-head">
        <div>
          <div class="section-title">本周冲突检查</div>
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

function renderWeek() {
  ensureLessonFilterDates();
  const ranges = weekRanges();
  const range = ranges[activeWeek] || ranges[0];
  const weekRows = sortedLessons()
    .filter((row) => range.includes(row.date));
  const rows = weekRows
    .filter((row) => lessonMatchesFilter(row, lessonFilter, { includeDate: false, includeStatus: false, includeQuery: false }))
    .sort((a, b) => `${a.date || ""} ${a.teacher_name || ""} ${a.time_slot || ""}`.localeCompare(`${b.date || ""} ${b.teacher_name || ""} ${b.time_slot || ""}`, "zh-Hans-CN"));
  const conflicts = weekConflictIssues(range);
  renderTopbar(
    `${monthLabel()} 周课表`,
    `${range.label} · ${conflicts.length ? `发现 ${conflicts.length} 条冲突` : "无时间冲突"}`,
    `<button class="btn weekly-copy" type="button" data-audience="teacher">复制老师课表</button>
     <button class="btn weekly-copy" type="button" data-audience="student">复制学生课表</button>
     <button class="btn weekly-image-export" type="button" data-audience="teacher">导出老师 PNG</button>
     <button class="btn weekly-image-export" type="button" data-audience="student">导出学生/班课 PNG</button>`,
  );
  contentEl.innerHTML = `
    <div class="tabs">
      ${ranges.map((item, index) => `<button class="tab week-tab ${activeWeek === index ? "active" : ""}" data-week="${index}">${escapeHtml(item.label)}</button>`).join("")}
    </div>
    ${scheduleConflictPanel(conflicts)}
    ${renderLessonFilterBar({ rows: weekRows, filteredRows: rows, compact: true })}
    <div class="band">
      <div class="table-wrap">
        <table class="course-table">
          <thead>
            <tr><th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th class="wide">学生</th><th class="wide">备注</th><th>教师薪资</th><th>学生人数</th></tr>
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
                  <td class="text-cell right">${money(row.teacher_salary)}</td>
                  <td class="text-cell right">${splitStudents(row.student_names).length}</td>
                </tr>
              `;
            }).join("") || `<tr><td colspan="12" class="empty">本周暂无课程</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
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
  const rows = state.derived.student_summary;
  const visibleRows = rows.filter(summaryMatchesFilter);
  const totalFee = rows.reduce((sum, row) => sum + numberValue(row.total_fee), 0);
  const totalBalance = rows.reduce((sum, row) => sum + numberValue(row.actual_balance) + numberValue(row.gift_balance), 0);
  const filteredFee = visibleRows.reduce((sum, row) => sum + numberValue(row.total_fee), 0);
  const filteredBalance = visibleRows.reduce((sum, row) => sum + numberValue(row.actual_balance) + numberValue(row.gift_balance), 0);
  renderTopbar(
    `${monthLabel()} 学生费用汇总`,
    `课程费用 ${money(totalFee)} 元，余额合计 ${money(totalBalance)} 元`,
    `<button class="btn rollover-recharges" type="button">从上月结转</button>`,
  );
  contentEl.innerHTML = `
    <div class="band">
      ${renderSummaryFilterBar(rows, visibleRows)}
      <div class="table-wrap">
        <table class="student-summary-table">
          <thead>
            <tr><th></th><th>学生姓名</th><th>年级</th><th>上课次数</th><th>课程总费用</th><th>月末结余现金</th><th>月末结余赠送</th></tr>
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
    { label: "现金消费", value: summary.overview.revenue.current, color: "var(--success)" },
    { label: "赠送消费", value: summary.overview.gift_consumption.current, color: "var(--accent)" },
  ];
  const costSegments = [
    { label: "课时费", value: summary.overview.teacher_cost.current, color: "var(--info)" },
    { label: "员工工资", value: op.staff_salary_total, color: "var(--warning)" },
    { label: "日常开销", value: op.operating_expense_total, color: "var(--danger)" },
    { label: "交通补贴", value: summary.overview.transport_cost.current, color: "var(--brand)" },
  ];
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
        <div class="section-head"><div class="section-title">利润走势</div></div>
        ${financeTrendChart(summary.trend_6m || [])}
      </div>
      <div class="band finance-stack-panel">
        ${compositionDonut("收入构成", incomeSegments)}
        ${compositionDonut("成本构成", costSegments)}
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

    <div class="finance-panels">
      <div class="band finance-panel">
        <div class="section-head"><div class="section-title">Top 10 学生贡献</div></div>
        <div class="table-wrap">
          <table class="finance-table top-students-table">
            <thead><tr><th>学生</th><th>课次</th><th>消费</th></tr></thead>
            <tbody>
              ${summary.top_lists.top_students.map((row) => `<tr><td class="text-cell">${escapeHtml(row.student_name)}</td><td class="text-cell right">${row.lesson_count}</td><td class="text-cell right">¥${money2(row.total_fee)}</td></tr>`).join("") || `<tr><td colspan="3" class="empty">暂无数据</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
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
    if (rechargeGradeFilter && row.grade !== rechargeGradeFilter) return false;
    return true;
  });
  renderTopbar(`${monthLabel()} 充值记录`, `已显示 ${visibleRows.length} / 共 ${rows.length} 名学生`);
  contentEl.innerHTML = `
    <div class="band">
      <div class="filter-bar compact">
        <label>来源</label>
        <select class="control recharge-source-filter">
          <option value="all" ${rechargeSourceFilter === "all" ? "selected" : ""}>全部</option>
          <option value="manual" ${rechargeSourceFilter === "manual" ? "selected" : ""}>手动/无来源</option>
          <option value="carry_over" ${rechargeSourceFilter === "carry_over" ? "selected" : ""}>自动结转</option>
        </select>
        <label>学生姓名</label>
        <input class="control recharge-student-filter" type="text" autocomplete="off" spellcheck="false" placeholder="输入学生姓名" value="${escapeHtml(rechargeStudentFilter)}">
        <label>年级</label>
        <select class="control recharge-grade-filter">${filterSelectOptions(grades, rechargeGradeFilter, "全部")}</select>
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
                <td><input class="cell-input number recharge-field" data-field="prev_actual" type="number" value="${money(row.prev_actual)}"></td>
                <td><input class="cell-input number recharge-field" data-field="prev_gift" type="number" value="${money(row.prev_gift)}"></td>
                <td><input class="cell-input number recharge-field" data-field="cur_recharge" type="number" value="${money(row.cur_recharge)}"></td>
                <td><input class="cell-input number recharge-field" data-field="cur_gift" type="number" value="${money(row.cur_gift)}"></td>
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
    <div class="band student-history-panel">
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

function renderStudentQuery() {
  const rows = state.derived.student_summary;
  const summary = selectedStudent ? rows.find((row) => row.student_name === selectedStudent) : null;
  const details = state.derived.fee_details.filter((row) => row.student_name === selectedStudent);
  const shortMonth = monthLabelShort();
  renderTopbar(
    `${monthLabel()} 学生查询`,
    selectedStudent || "未选择学生",
    `<button class="btn export-student-statement" type="button" ${selectedStudent ? "" : "disabled"}>导出本月</button>`,
  );
  contentEl.innerHTML = `
    <div class="query-head">
      <div class="metric">
        <div class="metric-label">学生姓名</div>
        <select class="control student-select" style="margin-top:8px;width:100%">
          ${options(rows.map((row) => row.student_name), selectedStudent, "选择学生")}
        </select>
      </div>
      <div class="metric"><div class="metric-label">${escapeHtml(shortMonth)}上课次数</div><div class="metric-value">${summary ? summary.lesson_count : 0}</div></div>
      <div class="metric"><div class="metric-label">${escapeHtml(shortMonth)}费用</div><div class="metric-value">${summary ? money(summary.total_fee) : 0}</div></div>
      <div class="metric"><div class="metric-label">${escapeHtml(shortMonth)}现金余额</div><div class="metric-value ${summary && numberValue(summary.actual_balance) < 0 ? "negative" : ""}">${summary ? money(summary.actual_balance) : 0}</div></div>
      <div class="metric"><div class="metric-label">${escapeHtml(shortMonth)}赠送余额</div><div class="metric-value">${summary ? money(summary.gift_balance) : 0}</div></div>
    </div>
    ${summary ? `
      <div class="band balance-query-panel">
        <div class="section-head">
          <div class="section-title">账户结构</div>
        </div>
        <div class="balance-query-body">
          ${balanceDetailCards(summary)}
        </div>
      </div>
    ` : ""}
    ${studentHistoryPanel()}
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
  `;
}

function renderAudit() {
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
                <td><input class="cell-input number pricing-field" data-id="${row.id}" data-field="unit_price" type="number" value="${money(row.unit_price)}"></td>
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
  if (filter.subject && row.subject !== filter.subject) return false;
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
  return `
    <div class="filter-bar compact student-pricing-filter-bar">
      <label>学生/备注</label>
      <input class="control student-pricing-filter-input" data-filter-field="student" type="text" autocomplete="off" spellcheck="false" placeholder="输入学生姓名或备注" value="${escapeHtml(studentPricingFilter.student)}">
      <label>科目</label>
      <select class="control student-pricing-filter-input" data-filter-field="subject">${filterSelectOptions(state.lookups.subjects, studentPricingFilter.subject, "全部")}</select>
      <label>价格状态</label>
      <select class="control student-pricing-filter-input" data-filter-field="price">
        <option value="" ${studentPricingFilter.price === "" ? "selected" : ""}>全部</option>
        <option value="positive" ${studentPricingFilter.price === "positive" ? "selected" : ""}>正常价</option>
        <option value="zero" ${studentPricingFilter.price === "zero" ? "selected" : ""}>0 元</option>
      </select>
      <label>影响范围</label>
      <select class="control student-pricing-filter-input" data-filter-field="usage">
        <option value="" ${studentPricingFilter.usage === "" ? "selected" : ""}>全部</option>
        <option value="current" ${studentPricingFilter.usage === "current" ? "selected" : ""}>本月有课</option>
        <option value="historical" ${studentPricingFilter.usage === "historical" ? "selected" : ""}>历史有课</option>
        <option value="unused" ${studentPricingFilter.usage === "unused" ? "selected" : ""}>未使用</option>
      </select>
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
                <td><input class="cell-input number student-pricing-field ${numberValue(row.custom_price) <= 0 ? "warning-cell" : ""}" data-id="${row.id}" data-field="custom_price" type="number" min="0.01" step="0.01" value="${money(row.custom_price)}"></td>
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

function profileRows() {
  const rows = profileTab === "teachers" ? state.profile_teachers || [] : state.profile_students || [];
  const statusFilter = profileStatusFilter[profileTab] || "";
  const statusRows = statusFilter ? rows.filter((row) => (row.status || "") === statusFilter) : rows;
  const query = profileSearch.trim().toLowerCase();
  if (!query) return statusRows;
  return statusRows.filter((row) => [
    row.name, row.grade, row.phone, row.guardian, row.status, row.joined_at, row.left_at, row.notes,
  ].some((value) => String(value || "").toLowerCase().includes(query)));
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

function renderProfiles() {
  const rows = profileRows();
  const isTeacher = profileTab === "teachers";
  const statusValues = isTeacher ? ["在职", "离职", "暂停"] : ["在读", "离校", "已流出", "暂停"];
  renderTopbar("档案管理", `${isTeacher ? "老师" : "学生"} ${rows.length} 条`, historyToggleAction());
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
        ${rows.map((row) => `
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
        `).join("") || `<tr><td colspan="9" class="empty">暂无学生档案</td></tr>`}
      </tbody>
    </table>
  `;
  contentEl.innerHTML = `
    <div class="band profile-panel">
      <div class="section-head profile-head">
        <div class="tabs">
          <button class="tab profile-tab ${profileTab === "teachers" ? "active" : ""}" data-tab="teachers" type="button">老师</button>
          <button class="tab profile-tab ${profileTab === "students" ? "active" : ""}" data-tab="students" type="button">学生</button>
        </div>
        <div class="profile-actions">
          <select class="control profile-status-filter">
            ${options(statusValues, profileStatusFilter[profileTab] || "", "全部状态")}
          </select>
          <input class="control profile-search" type="text" autocomplete="off" spellcheck="false" placeholder="搜索姓名、电话、备注" value="${escapeHtml(profileSearch)}">
          <button class="btn primary new-profile" type="button" data-kind="${profileTab}">+ 新增</button>
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
    if (staffStatusFilter && row.status !== staffStatusFilter) return false;
    if (!query) return true;
    return [row.name, row.role, row.phone, row.status, row.notes]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
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

function renderStaffProfiles() {
  const rows = filteredStaffRows();
  renderTopbar("员工档案", `${rows.length} 名员工`, historyToggleAction());
  contentEl.innerHTML = `
    <div class="band profile-panel">
      <div class="section-head profile-head">
        <div class="section-title">员工档案</div>
        <div class="profile-actions">
          <select class="control staff-status-filter">
            ${options(["在职", "暂停", "离职"], staffStatusFilter, "全部状态")}
          </select>
          <input class="control staff-profile-search" type="text" autocomplete="off" spellcheck="false" placeholder="搜索姓名、角色、电话、备注" value="${escapeHtml(staffProfileSearch)}">
          <button class="btn primary new-staff" type="button">+ 新增员工</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="profile-table staff-profile-table">
          <thead><tr><th>姓名</th><th>角色</th><th>基础工资</th><th>手机</th><th>状态</th><th>入职</th><th>离职</th><th class="wide">备注</th><th>操作</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="staff-row" data-id="${row.id}">
                <td><input class="cell-input staff-field" data-field="name" value="${escapeHtml(row.name)}"></td>
                <td><input class="cell-input staff-field" data-field="role" list="staff-role-options" value="${escapeHtml(row.role)}"></td>
                <td><input class="cell-input number staff-field" data-field="base_salary" type="number" value="${money(row.base_salary)}"></td>
                <td><input class="cell-input staff-field" data-field="phone" value="${escapeHtml(row.phone || "")}"></td>
                <td><select class="cell-select staff-field" data-field="status">${options(["在职", "暂停", "离职"], row.status || "在职")}</select></td>
                <td><input class="cell-input staff-field" data-field="joined_at" type="date" value="${escapeHtml(row.joined_at || "")}"></td>
                <td><input class="cell-input staff-field" data-field="left_at" type="date" value="${escapeHtml(row.left_at || "")}"></td>
                <td><input class="cell-input wide staff-field" data-field="notes" value="${escapeHtml(row.notes || "")}"></td>
                <td class="readonly"><button class="btn danger delete-staff" data-id="${row.id}" data-name="${escapeHtml(row.name)}">删除</button></td>
              </tr>
            `).join("") || `<tr><td colspan="9" class="empty">暂无员工</td></tr>`}
          </tbody>
        </table>
        <datalist id="staff-role-options">${(state.lookups.staff_roles || []).map((role) => `<option value="${escapeHtml(role)}"></option>`).join("")}</datalist>
      </div>
    </div>
    ${staffModalMarkup()}
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
  const total = rows.reduce((sum, row) => sum + numberValue(row.salary_actual), 0);
  const totalBonus = rows.reduce((sum, row) => sum + numberValue(row.bonus), 0);
  const totalDeduction = rows.reduce((sum, row) => sum + numberValue(row.deduction), 0);
  renderTopbar(`${monthLabel()} 员工薪资`, `${rows.length} 人，工资合计 ${yuan2(total)}`);
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
          <thead><tr><th>姓名</th><th>角色</th><th>基础</th><th>奖金</th><th>扣款</th><th>实发</th><th class="wide">备注</th><th>操作</th></tr></thead>
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
                  <td class="text-cell right">${money(row.base_salary)}</td>
                  <td><input class="cell-input number staff-salary-field" data-field="bonus" type="number" value="${money(row.bonus)}" ${disabled}></td>
                  <td><input class="cell-input number staff-salary-field" data-field="deduction" type="number" value="${money(row.deduction)}" ${disabled}></td>
                  <td class="text-cell right ${mismatch ? "warning-cell" : ""}" title="${mismatch ? `按基础+奖金-扣款应为 ${money(row.expected_salary)}` : ""}">${mismatch ? "⚠ " : ""}${money(row.salary_actual)}</td>
                  <td><input class="cell-input wide staff-salary-field" data-field="notes" value="${escapeHtml(row.notes === "auto" ? "" : row.notes || "")}" placeholder="${row.notes === "auto" ? "auto" : ""}" ${disabled}></td>
                  <td class="readonly"><button class="btn danger delete-staff-salary" data-id="${row.id}" data-name="${escapeHtml(row.name)}">删除</button></td>
                </tr>
              `;
            }).join("") || `<tr><td colspan="8" class="empty">暂无薪资记录</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
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
        <label>类别 <select class="control expense-filter-input" data-field="category">${options(state.lookups.expense_categories || [], expenseFilter.category, "全部类别")}</select></label>
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
                <td><input class="cell-input number expense-field" data-field="amount" type="number" value="${money(row.amount)}"></td>
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
  const total = rows.reduce((sum, row) => sum + numberValue(row.total_salary), 0);
  renderTopbar(
    `${monthLabel()} 教师薪资汇总`,
    `薪资合计 ${money(total)} 元`,
    `<button class="btn export-teacher-salary" type="button">导出本月</button>`,
  );
  contentEl.innerHTML = `
    <div class="band">
      <div class="table-wrap">
        <table class="teacher-salary-table">
          <thead><tr><th>教师姓名</th><th>上课课时数</th><th>课时合计</th><th>第一周车票</th><th>第二周车票</th><th>第三周车票</th><th>第四周车票</th><th>薪资合计</th><th class="wide">备注</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="teacher-adjustment-row" data-teacher-name="${escapeHtml(row.teacher_name)}">
                <td class="text-cell">${escapeHtml(row.teacher_name)}</td>
                <td class="text-cell right">${row.lesson_count}</td>
                <td class="text-cell right">${money(row.salary_total)}</td>
                <td><input class="cell-input number teacher-adjustment-field" data-field="week1_transport" type="number" value="${money(row.week1_transport)}"></td>
                <td><input class="cell-input number teacher-adjustment-field" data-field="week2_transport" type="number" value="${money(row.week2_transport)}"></td>
                <td><input class="cell-input number teacher-adjustment-field" data-field="week3_transport" type="number" value="${money(row.week3_transport)}"></td>
                <td><input class="cell-input number teacher-adjustment-field" data-field="week4_transport" type="number" value="${money(row.week4_transport)}"></td>
                <td class="text-cell right">${money(row.total_salary)}</td>
                <td><input class="cell-input wide teacher-adjustment-field" data-field="notes" value="${escapeHtml(row.notes)}"></td>
              </tr>
            `).join("")}
            <tr>
              <td class="text-cell"><b>合计</b></td>
              <td class="text-cell right"><b>${rows.reduce((sum, row) => sum + row.lesson_count, 0)}</b></td>
              <td class="text-cell right"><b>${money(rows.reduce((sum, row) => sum + numberValue(row.salary_total), 0))}</b></td>
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
  const salary = rows.filter(isEffective).reduce((sum, row) => sum + numberValue(row.teacher_salary), 0);
  renderTopbar(`${monthLabel()} 教师个人课程明细`, selectedTeacher || "未选择教师");
  contentEl.innerHTML = `
    <div class="query-head">
      <div class="metric">
        <div class="metric-label">教师姓名</div>
        <select class="control teacher-select" style="margin-top:8px;width:100%">
          ${options(teachers, selectedTeacher, "选择教师")}
        </select>
      </div>
      <div class="metric"><div class="metric-label">有效课时</div><div class="metric-value">${count}</div></div>
      <div class="metric"><div class="metric-label">薪资统计</div><div class="metric-value">${money(salary)}</div></div>
      <div class="metric"><div class="metric-label">课程记录</div><div class="metric-value">${rows.length}</div></div>
    </div>
    <div class="band">
      <div class="table-wrap">
        <table class="course-table">
          <thead><tr><th>授课老师</th><th>日期</th><th>状态</th><th>星期</th><th>时间</th><th>教室</th><th>年级</th><th>科目</th><th class="wide">学生</th><th class="wide">备注</th><th>教师薪资</th><th>学生人数</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="${isAbnormal(row) ? "abnormal" : ""}">
                <td class="text-cell">${escapeHtml(row.teacher_name)}</td><td class="text-cell">${escapeHtml(row.date)}</td><td class="text-cell">${statusBadge(rowStatus(row))}</td><td class="text-cell">${escapeHtml(weekdayCn(row.date))}</td><td class="text-cell">${escapeHtml(row.time_slot)}</td><td class="text-cell">${escapeHtml(row.classroom)}</td><td class="text-cell">${escapeHtml(row.grade)}</td><td class="text-cell">${escapeHtml(row.subject)}</td><td class="text-cell">${escapeHtml(row.student_names)}</td><td class="text-cell">${escapeHtml(row.notes)}</td><td class="text-cell right">${money(row.teacher_salary)}</td><td class="text-cell right">${splitStudents(row.student_names).length}</td>
              </tr>
            `).join("") || `<tr><td colspan="12" class="empty">暂无该教师课程</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function render() {
  renderNav();
  const renderers = {
    lessons: renderLessons,
    week: renderWeek,
    feeDetails: renderFeeDetails,
    summary: renderSummary,
    finance: renderFinance,
    recharges: renderRecharges,
    studentQuery: renderStudentQuery,
    audit: renderAudit,
    profiles: renderProfiles,
    staffPayroll: renderStaffPayroll,
    staffProfiles: renderStaffProfiles,
    expenses: renderExpenses,
    pricing: renderPricing,
    studentPricing: renderStudentPricing,
    teacherSalary: renderTeacherSalary,
    teacherDetail: renderTeacherDetail,
  };
  (renderers[view] || renderLessons)();
  wireEvents();
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

function collectRowPayload(row, selector) {
  const payload = {};
  row.querySelectorAll(selector).forEach((input) => {
    payload[input.dataset.field] = input.type === "number" ? numberValue(input.value) : input.value;
  });
  return payload;
}

function wireEvents() {
  const renderLessonFilterSoon = debounce((field, value) => {
    const cursor = String(value || "").length;
    render();
    requestAnimationFrame(() => {
      const next = document.querySelector(`.lesson-filter-input[data-filter-field="${field}"]`);
      if (!next || next.tagName === "SELECT" || next.type === "date") return;
      next.focus({ preventScroll: true });
      try {
        next.setSelectionRange(cursor, cursor);
      } catch {
        // Some input types do not support selection ranges.
      }
    });
  }, 450);

  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const group = navGroups.find((item) => item.key === button.dataset.group);
      if (!group) return;
      activeNavGroup = group.key;
      if (!groupViews(group).some(([key]) => key === view)) {
        view = group.views[0][0];
      }
      localStorage.setItem("liming:view", view);
      localStorage.setItem("liming:nav-group", activeNavGroup);
      render();
    });
  });

  document.querySelectorAll(".nav-sub-btn").forEach((button) => {
    button.addEventListener("click", () => {
      view = button.dataset.view;
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

  document.querySelectorAll(".delete-month").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!activeMonth) return;
      const res = await fetch(`/api/months/${encodeURIComponent(activeMonth)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        monthDeleteDraft = { monthKey: activeMonth, counts: data.counts || {} };
        render();
        return;
      }
      if (!res.ok) {
        alert(data.error || `删除失败：HTTP ${res.status}`);
        return;
      }
      activeMonth = data.next_month || "";
      if (activeMonth) localStorage.setItem("liming:month", activeMonth);
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
      const res = await fetch(`/api/months/${encodeURIComponent(monthKey)}?force=1`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || `删除失败：HTTP ${res.status}`);
        return;
      }
      monthDeleteDraft = null;
      activeMonth = data.next_month || "";
      if (activeMonth) localStorage.setItem("liming:month", activeMonth);
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

  document.querySelectorAll(".recharge-source-filter").forEach((select) => {
    select.addEventListener("change", () => {
      rechargeSourceFilter = select.value || "all";
      localStorage.setItem(RECHARGE_SOURCE_FILTER_KEY, rechargeSourceFilter);
      render();
    });
  });

  document.querySelectorAll(".recharge-student-filter").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      rechargeStudentFilter = value;
    }, () => render());
  });

  document.querySelectorAll(".recharge-grade-filter").forEach((select) => {
    select.addEventListener("change", () => {
      rechargeGradeFilter = select.value;
      render();
    });
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

  document.querySelectorAll(".profile-tab").forEach((button) => {
    button.addEventListener("click", () => {
      profileTab = button.dataset.tab || "teachers";
      localStorage.setItem("liming:profile-tab", profileTab);
      profileModal = null;
      render();
    });
  });

  document.querySelectorAll(".profile-search").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      profileSearch = value;
    }, () => render());
  });

  document.querySelectorAll(".profile-status-filter").forEach((select) => {
    select.addEventListener("change", () => {
      profileStatusFilter = { ...profileStatusFilter, [profileTab]: select.value };
      localStorage.setItem("liming:profile-status-filter", JSON.stringify(profileStatusFilter));
      render();
    });
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

  document.querySelectorAll(".staff-status-filter").forEach((select) => {
    select.addEventListener("change", () => {
      staffStatusFilter = select.value;
      localStorage.setItem("liming:staff-status-filter", staffStatusFilter);
      render();
    });
  });

  document.querySelectorAll(".staff-profile-search").forEach((input) => {
    bindSafeTextInput(input, (value) => {
      staffProfileSearch = value;
    }, () => render());
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

  document.querySelectorAll(".lesson-filter-input").forEach((input) => {
    const applyLessonFilter = (rerender = true) => {
      const field = input.dataset.filterField;
      const monthKey = state.settings.month_key;
      focusedLessonIds = [];
      lessonFilter = {
        ...lessonFilter,
        month_key: monthKey,
        [field]: input.value,
      };
      saveLessonFilter();
      if (rerender) {
        if (input.tagName === "SELECT" || input.type === "date" || field === "start_date" || field === "end_date") render();
        else renderLessonFilterSoon(field, input.value);
      }
    };

    if (input.tagName === "SELECT" || input.type === "date") {
      input.addEventListener("change", () => applyLessonFilter(true));
      return;
    }

    let composing = false;
    input.addEventListener("compositionstart", () => {
      composing = true;
    });
    input.addEventListener("compositionend", () => {
      composing = false;
      applyLessonFilter(true);
    });
    input.addEventListener("input", () => {
      if (!composing) applyLessonFilter(true);
    });
    input.addEventListener("change", () => applyLessonFilter(true));
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
      summaryFilter = { ...summaryFilter, [input.dataset.filterField]: value };
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
      studentPricingFilter = { ...studentPricingFilter, [input.dataset.filterField]: value };
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
        studentPricingFilter = { ...studentPricingFilter, [input.dataset.filterField]: input.value };
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
      render();
    });
  });

  document.querySelectorAll(".weekly-image-export").forEach((button) => {
    button.addEventListener("click", async () => {
      const audience = button.dataset.audience === "teacher" ? "teacher" : "student";
      await exportWeeklySchedulePngZip(audience, button);
    });
  });

  document.querySelectorAll(".weekly-copy").forEach((button) => {
    button.addEventListener("click", async () => {
      const audience = button.dataset.audience === "student" ? "student" : "teacher";
      const res = await fetch(`/api/export/weekly-schedule.txt?month=${encodeURIComponent(state.settings.month_key)}&week=${activeWeek}&audience=${audience}`);
      const textValue = await res.text();
      if (!res.ok) return alert(textValue || `HTTP ${res.status}`);
      try {
        await navigator.clipboard.writeText(textValue.replace(/^\ufeff/, ""));
        alert(audience === "student" ? "学生周课表已复制。" : "老师周课表已复制。");
      } catch {
        prompt("复制以下周课表", textValue.replace(/^\ufeff/, ""));
      }
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

  document.querySelectorAll(".student-select").forEach((select) => {
    select.addEventListener("change", async () => {
      selectedStudent = select.value;
      state.student_history = selectedStudent
        ? ((await request(`/api/student/${encodeURIComponent(selectedStudent)}/history`)).history || [])
        : [];
      render();
    });
  });

  document.querySelectorAll(".export-student-statement").forEach((button) => {
    button.addEventListener("click", () => {
      if (!selectedStudent) return alert("请先选择学生");
      window.location.href = `/api/export/student-statement.xlsx?month=${encodeURIComponent(state.settings.month_key)}&student=${encodeURIComponent(selectedStudent)}`;
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

  enhanceCustomSelects();
  enhanceCustomDateInputs();
}

load().catch((error) => {
  contentEl.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
});
