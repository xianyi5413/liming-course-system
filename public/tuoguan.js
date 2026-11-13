/* Integrated native UI; all financial amounts sent as integer cents. */
window.TuoguanUI = (() => {
  const statuses = ["出勤", "请假", "放假", "不适用"];
  const manualMoneyKinds = ["充值", "退款"];
  const profileStatuses = ["在托", "暂停", "已流出", "已毕业"];
  const compareProfiles = (a, b) =>
    profileStatuses.indexOf(a.status) - profileStatuses.indexOf(b.status) ||
    compareStudentGradeName(a, b);
  const isManualMoney = (row) =>
    manualMoneyKinds.includes(row.kind) &&
    row.attendance_id == null &&
    !row.voided_at;
  let activeDetail = null;
  const selectedLedgerIds = new Set();
  const grades = ["初一", "初二", "初三"];
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const today = () =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
      new Date(),
    );
  const money = (n) => formatMoney(Number(n || 0) / 100);
  const opt = (a, value) =>
    a
      .map((x) => {
        const [v, label] = Array.isArray(x) ? x : [x, x];
        return `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(label)}</option>`;
      })
      .join("");
  let root,
    data,
    day = today(),
    tab = "签到",
    query = "",
    grade = "",
    finance = false,
    epoch = 0;
  let ledgerKind = "",
    rangeStart = "",
    rangeEnd = "",
    account = null;
  const filters = new Map();
  const statusTone = (value) =>
    ({
      出勤: DEFAULT_COURSE_STATUS_COLORS["已上"],
      不适用: DEFAULT_GENERIC_STATUS_COLORS["暂停"],
      请假: DEFAULT_COURSE_STATUS_COLORS["待上"],
      放假: DEFAULT_COURSE_STATUS_COLORS["请假"],
    })[value];
  const badge = (value) => {
    return statusTone(value)
      ? '<span class="entity-badge status-badge"' +
          badgeColorStyle(statusTone(value)) +
          ">" +
          esc(value) +
          "</span>"
      : statusBadge(value);
  };
  const studentBadge = (id, historicalGrade) => {
    const student = data.students.find((s) => s.id === id);
    return student
      ? renderStudentBadge(student, { grade: historicalGrade || student.grade })
      : "—";
  };
  let filterTimer,
    cellWrites = 0,
    dateWrites = 0,
    studentWrites = 0,
    filterQueued = false;
  const metrics = (items) =>
    '<div class="summary-grid tg-metrics">' +
    items
      .map(
        ([label, value]) =>
          '<div class="metric"><div class="metric-label">' +
          esc(label) +
          '</div><div class="metric-value">' +
          esc(value) +
          "</div></div>",
      )
      .join("") +
    "</div>";
  const field = (label, control) =>
    '<label class="filter-field"><span>' +
    label +
    "</span>" +
    control +
    "</label>";
  const empty = (title, detail = "") =>
    '<div class="empty tg-empty"><strong>' +
    esc(title) +
    "</strong><p>" +
    esc(detail) +
    "</p>" +
    (tab === "签到" && canView("tgStudents")
      ? '<button class="btn" data-go="tgStudents">前往托管学生</button>'
      : "") +
    "</div>";
  function filtersHtml() {
    if (tab === "设置") return "";
    const dateControl =
      tab === "学生"
        ? ""
        : field(
            "月份",
            '<span class="tg-date-nav"><button class="date-range-nav" type="button" data-tg-month-step="-1" aria-label="上个月">‹</button><input class="control" aria-label="月份" id="tg-month" type="month" value="' +
              day.slice(0, 7) +
              '"><button class="date-range-nav" type="button" data-tg-month-step="1" aria-label="下个月">›</button></span>',
          );
    return (
      '<div class="filter-bar compact tg-filters"><div class="filter-controls">' +
      dateControl +
      field(
        "学生",
        '<input class="control" id="tg-query" placeholder="搜索学生姓名" value="' +
          esc(query) +
          '">',
      ) +
      field(
        "年级",
        '<select class="control" id="tg-grade">' +
          opt([["", "全部年级"], ...grades], grade) +
          "</select>",
      ) +
      (tab === "流水"
        ? field(
            "类型",
            '<select class="control" id="tg-kind">' +
              opt([["", "全部类型"], ...manualMoneyKinds], ledgerKind) +
              "</select>",
          ) +
          field(
            "日期范围（优先于月份）",
            dateRangePickerControl({
              scope: "tuoguan-ledger",
              start: rangeStart,
              end: rangeEnd,
            }),
          )
        : "") +
      '</div><div class="filter-summary"><button class="btn" id="tg-reset">清空筛选</button></div></div>'
    );
  }
  function monthCalendar(month, renderDay) {
    const [year, m] = month.split("-").map(Number),
      first = new Date(Date.UTC(year, m - 1, 1)).getUTCDay(),
      days = new Date(Date.UTC(year, m, 0)).getUTCDate();
    return (
      '<div class="date-range-weekdays">' +
      [..."日一二三四五六"].map((d) => "<span>" + d + "</span>").join("") +
      '</div><div class="tg-detail-calendar">' +
      '<span aria-hidden="true"></span>'.repeat(first) +
      Array.from({ length: days }, (_, i) =>
        renderDay(month + "-" + String(i + 1).padStart(2, "0"), i + 1),
      ).join("") +
      "</div>"
    );
  }
  function studentDetail(id) {
    const host = root,
      owner = auth.user?.id,
      student = data.students.find((s) => s.id === id);
    if (!student) return;
    activeDetail?.close();
    let month = day.slice(0, 7),
      sequence = 0,
      controller;
    const fields = [
      ["本月托管消费", "fee"],
      ["本月实际消费", "actual_consumption"],
      ["本月赠送消费", "gift_consumption"],
      ["本月实际充值", "actual_recharge"],
      ["本月赠送充值", "gift_recharge"],
      ["月末实际余额", "actual_balance"],
      ["月末赠送余额", "gift_balance"],
    ];
    const initial = data.summary.find((r) => r.id === id);
    const dialog = CourseDetails.dialog(
      student.name + " · 托管详情",
      '<div class="tg-detail-content"></div>',
      {
        onClose: () => {
          sequence++;
          controller?.abort();
          if (activeDetail === dialog) activeDetail = null;
        },
      },
    );
    activeDetail = dialog;
    const panel = dialog.element.querySelector(".modal-panel");
    panel.classList.add("tg-student-detail-panel");
    const content = dialog.element.querySelector(".tg-detail-content");
    // Keep the shell, cards and navigation alive throughout all month requests.
    content.innerHTML =
      '<div class="tg-actions">' +
      renderStudentBadge(student, { grade: initial?.grade || student.grade }) +
      renderGradeBadge(initial?.grade || student.grade) +
      "</div>" +
      metrics(fields.map(([label]) => [label, "—"])) +
      '<div class="tg-detail-notes muted-tip"><div></div><div></div></div>' +
      '<div class="tg-detail-month"><button class="date-range-nav" data-detail-step="-1" aria-label="上个月">‹</button><strong></strong><button class="date-range-nav" data-detail-step="1" aria-label="下个月">›</button><span class="tg-detail-loading" role="status" aria-live="polite"></span></div>' +
      monthCalendar(month, () => "") +
      '<div class="tg-calendar-legend">' +
      statuses.map(badge).join("") +
      '</div><p class="tg-detail-error" role="alert"></p>';
    const values = [...content.querySelectorAll(".metric-value")],
      notes = content.querySelector(".tg-detail-notes"),
      grid = content.querySelector(".tg-detail-calendar"),
      title = content.querySelector(".tg-detail-month strong"),
      status = content.querySelector("[role=status]"),
      error = content.querySelector("[role=alert]");
    const current = () =>
      dialog.element.isConnected &&
      activeDetail === dialog &&
      host === root &&
      owner === auth.user?.id;
    function render(snapshot, wanted) {
      const a = snapshot.summary.find((r) => r.id === id);
      if (!a) throw Error("学生档案已变化，请重新打开详情");
      const byDate = new Map(
        snapshot.attendance
          .filter((r) => r.student_id === id)
          .map((r) => [r.date, r]),
      );
      const calendar = monthCalendar(wanted, (date, n) => {
        const record = byDate.get(date),
          status = record?.status === "停课" ? "放假" : record?.status,
          tone = statusTone(status),
          title = record
            ? [
                date,
                record.status,
                record.raw_status ? "原始记录：" + record.raw_status : "",
                record.notes,
              ]
                .filter(Boolean)
                .join(" · ")
            : date + " 无已保存考勤";
        return (
          '<div class="tg-calendar-day" data-date="' +
          date +
          '" data-status="' +
          esc(status || "") +
          '" title="' +
          esc(title) +
          '"' +
          (tone ? badgeColorStyle(tone) : "") +
          "><span>" +
          n +
          '</span><span class="tg-calendar-status">' +
          esc(status === "未登记" ? "异常/空白" : status || "—") +
          "</span></div>"
        );
      });
      const template = document.createElement("template");
      template.innerHTML = calendar;
      const scrollTop = panel.scrollTop;
      // Commit the complete month synchronously; no empty/loading render in between.
      values.forEach(
        (node, index) => (node.textContent = money(a[fields[index][1]])),
      );
      notes.children[0].textContent = a.unpaid_current_fee
        ? "本月费用含未付 " + money(a.unpaid_current_fee)
        : "";
      notes.children[1].textContent = a.prior_debt_gift_offset
        ? "赠送余额抵扣结转或调整欠费 " + money(a.prior_debt_gift_offset)
        : "";
      const [year, m] = wanted.split("-").map(Number);
      title.textContent = year + "年" + m + "月";
      grid.replaceChildren(
        ...template.content.querySelector(".tg-detail-calendar").childNodes,
      );
      content.dataset.month = wanted;
      panel.scrollTop = scrollTop;
    }
    for (const button of content.querySelectorAll("[data-detail-step]"))
      button.onclick = async () => {
        month = offsetMonth(
          month + "-01",
          Number(button.dataset.detailStep),
        ).slice(0, 7);
        const wanted = month,
          request = ++sequence;
        controller?.abort();
        controller = new AbortController();
        content.dataset.loading = "true";
        content.setAttribute("aria-busy", "true");
        status.textContent = "…";
        status.setAttribute("aria-label", "正在加载" + wanted);
        error.textContent = "";
        try {
          const next = await api(
            "snapshot?month=" + wanted,
            undefined,
            controller.signal,
          );
          if (current() && request === sequence) render(next, wanted);
        } catch (e) {
          if (current() && request === sequence) {
            month = content.dataset.month;
            error.textContent = e.message;
          }
        } finally {
          if (current() && request === sequence) {
            content.dataset.loading = "false";
            content.setAttribute("aria-busy", "false");
            status.textContent = "";
            status.removeAttribute("aria-label");
          }
        }
      };
    render(data, month);
    content.dataset.loading = "false";
  }
  async function api(action, body, signal) {
    const r = await fetch("/api/tuoguan/" + action, {
      signal,
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json();
    if (!r.ok)
      throw Object.assign(Error(d.error || d.message || "操作失败"), {
        status: r.status,
      });
    return d;
  }
  async function refresh() {
    const e = ++epoch;
    const target = root;
    const month = day.slice(0, 7);
    let d;
    try {
      d = await api(
        "snapshot?month=" +
          month +
          (tab === "流水"
            ? "&ledger_only=1&start=" + rangeStart + "&end=" + rangeEnd
            : ""),
      );
    } catch (error) {
      if (e !== epoch || target !== root) return;
      throw error;
    }
    if (e !== epoch || target !== root || !target?.isConnected) return;
    data = d;
    root.dataset.loadedMonth = month;
    draw();
  }
  function loadError(host, page, error) {
    if (!host.isConnected) return;
    host.innerHTML =
      empty("托管数据加载失败", error.message) +
      '<button class="btn" id="tg-retry">重新加载</button>';
    host.querySelector("#tg-retry").onclick = () =>
      mount(host.parentElement, page);
  }
  const studentLabel = (s) =>
    data.students.filter((t) => t.name === s.name).length > 1
      ? s.name +
        " · " +
        s.grade +
        " · " +
        (s.notes ||
          data.periods.find((p) => p.student_id === s.id)?.start_date ||
          s.created_at ||
          "未入托")
      : s.name;
  const studentName = (id) =>
    data.students.find((s) => s.id === id)?.name || id;
  const period = (id, d) =>
    data.periods.find(
      (p) =>
        p.student_id === id &&
        p.start_date <= d &&
        (!p.end_date || p.end_date >= d),
    );
  function matches(s, p = {}) {
    return (!query || s.name.includes(query)) && (!grade || p?.grade === grade);
  }
  const table = (headers, rows, indexed = false, selectable = false) =>
    `<div class="band"><div class="table-wrap smooth-table-wrap tg-scroll"><table class="uniform-table nowrap-table tg-table" data-adaptive-table="true" data-adaptive-natural="true"><colgroup>${selectable ? '<col data-column-type="select">' : ""}${indexed ? rowIndexColumn() : ""}${headers.map(() => '<col data-column-type="full" data-min-width="0" data-alignment="center">').join("")}</colgroup><thead><tr>${selectable ? '<th class="select-col"><input type="checkbox" class="tg-ledger-all" aria-label="全选当前托管资金记录"></th>' : ""}${indexed ? rowIndexHeader() : ""}${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row, i) => (indexed ? row.replace(selectable ? /^(<tr[^>]*><td class="select-col[^"]*"[^>]*>.*?<\/td>)/ : /^(<tr[^>]*>)/, `$1${renderRowIndex(i)}`) : row)).join("") || `<tr><td class="empty" colspan="${headers.length + Number(indexed) + Number(selectable)}">${tab === "流水" ? "暂无充值记录" : empty("暂无符合条件的记录", "调整筛选条件，或使用页面上的新增入口。")}</td></tr>`}</tbody></table></div></div>`;
  const listTable = (headers, rows) => table(headers, rows, true);
  const tr = (values, attrs = "") =>
    `<tr${attrs}>${values.map((v) => `<td>${v}</td>`).join("")}</tr>`;
  function form(
    title,
    fields,
    save,
    savedMessage = () => "已保存",
    afterSave = null,
  ) {
    const host = root,
      owner = auth.user?.id,
      month = day.slice(0, 7);
    const modal = CourseDetails.dialog(
      title,
      '<form class="tg-form"><div class="tg-form-grid">' +
        fields +
        '</div><p role="alert"></p><div class="modal-actions"><button class="btn" type="button" data-cancel>取消</button><button class="btn primary" type="submit">保存</button></div></form>',
      { size: "compact" },
    );
    const dialog = modal.element;
    enhanceCustomSelects();
    enhanceCustomDateInputs();
    dialog.querySelector("[data-cancel]").onclick = modal.close;
    dialog.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const button = dialog.querySelector("[type=submit]");
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = "保存中…";
      try {
        const values = Object.fromEntries(new FormData(e.target));
        const result = await save(values);
        if (afterSave) await afterSave(result);
        modal.close();
        if (afterSave) return;
        if (host !== root || owner !== auth.user?.id || !day.startsWith(month))
          return;
        await refresh();
        if (host === root && owner === auth.user?.id && day.startsWith(month))
          message(savedMessage(values));
      } catch (err) {
        dialog.querySelector("[role=alert]").textContent = err.message;
      } finally {
        button.disabled = false;
        button.textContent = "保存";
      }
    };
    return modal;
  }

  const input = (name, label, value = "", type = "text") =>
    type === "hidden"
      ? `<input name="${name}" type="hidden" value="${esc(value)}">`
      : `<label class="filter-field">${esc(label)}<input class="control" name="${name}" type="${type}" value="${esc(value)}" ${type === "number" ? 'step="0.01"' : ""}></label>`;
  const select = (name, label, values, value) =>
    `<label class="filter-field">${esc(label)}<select class="control" name="${name}">${opt(values, value)}</select></label>`;
  const studentSelect = (value) =>
    select(
      "student_id",
      "托管学生档案",
      data.students.map((s) => [s.id, studentLabel(s)]),
      value,
    );
  const pendingRequests = new Map();
  const post = async (action, b) => {
    const signature = JSON.stringify({ action, b });
    if (!pendingRequests.has(signature))
      pendingRequests.set(signature, crypto.randomUUID());
    const result = await api(action, {
      ...b,
      request_id: pendingRequests.get(signature),
    });
    pendingRequests.delete(signature);
    return result;
  };
  const toCents = (v) => {
    if (!/^-?\d+(\.\d{1,2})?$/.test(v)) throw Error("金额最多两位小数");
    return Math.round(Number(v) * 100);
  };
  const profileForm = (s) =>
    form(
      s ? "编辑托管档案" : "新建托管学生",
      input("name", "姓名", s?.name || "") +
        select("grade", "年级", grades, s?.grade || "初一") +
        select("status", "状态", profileStatuses, s?.status || "在托") +
        (s ? "" : input("start_date", "入托日期", day, "date")) +
        input("notes", "备注", s?.notes || ""),
      (v) => post("student", { ...v, id: s?.id, version: s?.version }),
    );
  function manageMatrixDates() {
    if (!finance || isReadonlyUser()) return;
    if (cellWrites || dateWrites || studentWrites)
      return message("请等待保存完成");
    clearTimeout(filterTimer);
    const nextQuery = root.querySelector("#tg-query").value.trim(),
      nextGrade = root.querySelector("#tg-grade").value;
    if (nextQuery !== query || nextGrade !== grade) {
      query = nextQuery;
      grade = nextGrade;
      draw();
    }
    const host = root,
      source = data,
      owner = auth.user?.id,
      month = day.slice(0, 7);
    const samePage = () =>
      host === root &&
      source === data &&
      host.isConnected &&
      owner === auth.user?.id &&
      tab === "签到" &&
      day.slice(0, 7) === month;
    let calendar = new Map(),
      protectedDates = new Set(),
      ready = false,
      changed = false,
      queue = Promise.resolve();
    const busy = new Set();
    const scroll = root.querySelector(".table-wrap"),
      left = scroll?.scrollLeft || 0,
      top = scroll?.scrollTop || 0;
    const [year, m] = month.split("-").map(Number);
    const dialog = CourseDetails.dialog(
      "管理日期",
      '<div class="tg-detail-content tg-date-management"><div class="tg-detail-month"><strong>' +
        year +
        "年" +
        m +
        "月</strong></div>" +
        monthCalendar(
          month,
          (date, n) =>
            '<button type="button" class="tg-calendar-day tg-date-choice" data-manage-date="' +
            date +
            '" disabled><span>' +
            n +
            '</span><span class="tg-date-mark" aria-hidden="true">○</span></button>',
        ) +
        '<div class="tg-calendar-legend"><span>✓ 已启用</span><span>○ 未启用</span><span>🔒 受保护</span></div><p role="status">正在加载…</p><p role="alert"></p></div>',
      {
        size: "compact",
        onClose: async () => {
          await queue;
          if (!changed || !samePage()) return;
          renderMatrix(root.querySelector("#tg-body"));
          scheduleAdaptiveTableColumns();
          const next = root.querySelector(".table-wrap");
          if (next) {
            next.scrollLeft = left;
            next.scrollTop = top;
          }
          root
            .querySelector("#tg-manage-dates")
            ?.focus({ preventScroll: true });
        },
      },
    );
    const content = dialog.element.querySelector(".tg-date-management"),
      error = content.querySelector('[role="alert"]'),
      status = content.querySelector('[role="status"]');
    function paint() {
      if (!dialog.element.isConnected || !samePage()) return;
      status.textContent = !ready ? "正在加载…" : busy.size ? "正在保存…" : "";
      for (const button of content.querySelectorAll("[data-manage-date]")) {
        const date = button.dataset.manageDate,
          locked = protectedDates.has(date),
          enabled = locked || calendar.get(date)?.enabled === 1;
        button.dataset.enabled = String(enabled);
        button.dataset.protected = String(locked);
        button.setAttribute("aria-pressed", String(enabled));
        button.setAttribute("aria-busy", String(busy.has(date)));
        button.setAttribute(
          "aria-label",
          date + (locked ? " 已启用，受保护" : enabled ? " 已启用" : " 未启用"),
        );
        button.disabled = !ready || busy.has(date);
        button.querySelector(".tg-date-mark").textContent = locked
          ? "🔒"
          : enabled
            ? "✓"
            : "○";
      }
    }
    function accept(next) {
      if (!samePage()) return;
      changed ||=
        JSON.stringify(source.calendar) !== JSON.stringify(next.calendar);
      source.calendar = next.calendar;
      source.protected_dates = next.protected_dates;
      calendar = new Map(next.calendar.map((c) => [c.date, c]));
      protectedDates = new Set(next.protected_dates);
      ready = true;
      paint();
    }
    const latest = () => api("snapshot?month=" + month + "&calendar_only=1");
    for (const button of content.querySelectorAll("[data-manage-date]"))
      button.onclick = () => {
        const date = button.dataset.manageDate;
        if (!ready || busy.has(date) || !samePage()) return;
        if (protectedDates.has(date)) {
          error.textContent = "该日期已有考勤或费用记录，无法直接删除。";
          return;
        }
        busy.add(date);
        dateWrites++;
        error.textContent = "";
        paint();
        // Serialize distinct dates; each request uses the latest server version.
        queue = queue.then(async () => {
          try {
            if (!samePage() || !ready) return;
            const record = calendar.get(date);
            const next = await post(
              record?.enabled === 1 ? "remove-dates" : "add-dates",
              {
                month,
                dates: [{ date, version: record?.version || 0 }],
              },
            );
            accept(next);
          } catch (e) {
            if (samePage()) {
              error.textContent = e.message;
              try {
                accept(await latest());
              } catch {
                ready = false;
                error.textContent += "；请关闭后重试";
              }
            }
          } finally {
            busy.delete(date);
            dateWrites--;
            paint();
            if (!ready) status.textContent = "";
          }
        });
      };
    // Opening also checks for changes made by another operator.
    queue = latest()
      .then((next) => {
        if (dialog.element.isConnected) accept(next);
      })
      .catch((e) => {
        if (dialog.element.isConnected && samePage()) {
          error.textContent = e.message;
          status.textContent = "";
        }
      });
  }
  async function transferDialog(importing) {
    const host = root,
      owner = auth.user?.id;
    let exported;
    try {
      if (!importing) exported = (await api("transfer-export", {})).text;
    } catch (error) {
      message(error.message);
      return;
    }
    if (host !== root || owner !== auth.user?.id) return;
    let pending = null;
    const dialog = CourseDetails.dialog(
      importing ? "导入托管信息" : "复制全部托管信息",
      '<div class="salary-template-form"><p class="muted-tip">完整托管资料含学生和资金信息，请仅向获授权的系统传递。</p><textarea class="control transfer-text" rows="14" aria-label="托管数据文本" spellcheck="false"></textarea><div class="tg-transfer-preview"></div><p role="alert"></p><div class="modal-actions"><button class="btn" data-transfer-reset hidden>重新编辑</button><button class="btn primary" data-transfer-submit>' +
        (importing ? "解析与预览" : "复制文本") +
        "</button></div></div>",
      {
        onClose: () => {
          area.value = "";
          pending = null;
        },
      },
    );
    const area = dialog.element.querySelector("textarea"),
      button = dialog.element.querySelector("[data-transfer-submit]"),
      preview = dialog.element.querySelector(".tg-transfer-preview"),
      errorBox = dialog.element.querySelector("[role=alert]"),
      reset = dialog.element.querySelector("[data-transfer-reset]");
    area.value = exported || "";
    area.readOnly = !importing;
    const current = () =>
      dialog.element.isConnected && host === root && owner === auth.user?.id;
    reset.onclick = () => {
      pending = null;
      area.readOnly = false;
      preview.textContent = "";
      button.textContent = "解析与预览";
      reset.hidden = true;
      button.disabled = false;
    };
    button.onclick = async () => {
      button.disabled = true;
      errorBox.textContent = "";
      try {
        if (!importing) {
          try {
            await navigator.clipboard.writeText(area.value);
            showToast("托管信息已复制");
          } catch {
            area.focus();
            area.select();
            errorBox.textContent = "剪贴板不可用，请复制已选中的文本";
          }
          return;
        }
        if (!pending) {
          const result = await api("transfer-preview", { text: area.value });
          if (!current()) return;
          const r = result.summary;
          preview.innerHTML =
            "<p>完整托管数据：" +
            r.students +
            "名学生 · " +
            esc(r.months.join("～")) +
            " · " +
            r.attendance +
            "条考勤 · " +
            r.rules +
            "条规则 · " +
            r.ledger +
            "条资金流水</p><p>新增 " +
            r.created +
            " · 跳过 " +
            r.skipped +
            " · 冲突 " +
            r.conflicts +
            "</p><p>实际充值 " +
            money(r.actual_recharge) +
            " · 赠送充值 " +
            money(r.gift_recharge) +
            "；本次新增实际 " +
            money(r.new_actual_recharge) +
            "、赠送 " +
            money(r.new_gift_recharge) +
            (r.legacy_unallocated
              ? " · 旧账归属待核对 " + r.legacy_unallocated + " 笔"
              : "") +
            "</p>" +
            (r.settlement?.updated
              ? "<p>旧考勤自动结算 " +
                r.settlement.updated +
                " 条，净补记 " +
                money(r.settlement.net_change) +
                "</p>"
              : "") +
            (result.conflicts.length
              ? "<ul>" +
                result.conflicts
                  .slice(0, 30)
                  .map(
                    (c) =>
                      "<li>" +
                      esc(
                        c.table + " 来源记录 " + c.source_key + "：" + c.reason,
                      ) +
                      "</li>",
                  )
                  .join("") +
                "</ul>"
              : "<p>仅合并托管数据；确认前备份，已有差异不覆盖。</p>");
          reset.hidden = false;
          if (result.allowed) {
            pending = result;
            area.readOnly = true;
            button.textContent = "确认导入";
          }
        } else {
          const result = await api("transfer-confirm", {
            token: pending.token,
            confirm: true,
          });
          if (!current()) return;
          dialog.close();
          await refresh();
          showToast(
            "导入完成：新增 " + result.created + "，跳过 " + result.skipped,
          );
        }
      } catch (error) {
        if (current()) {
          errorBox.textContent = error.message;
          pending = null;
          area.readOnly = false;
          button.textContent = "解析与预览";
        }
      } finally {
        button.disabled = false;
      }
    };
  }
  function manageMatrixStudents() {
    if (!finance || isReadonlyUser()) return;
    if (cellWrites || dateWrites || studentWrites)
      return message("请等待保存完成");
    clearTimeout(filterTimer);
    const nextQuery = root.querySelector("#tg-query").value.trim(),
      nextGrade = root.querySelector("#tg-grade").value;
    if (nextQuery !== query || nextGrade !== grade) {
      query = nextQuery;
      grade = nextGrade;
      draw();
    }
    const host = root,
      source = data,
      owner = auth.user?.id,
      month = day.slice(0, 7);
    const samePage = () =>
      root === host &&
      data === source &&
      host.isConnected &&
      auth.user?.id === owner &&
      tab === "签到" &&
      day.startsWith(month);
    let ready = false,
      changed = false,
      queue = Promise.resolve(),
      protectedIds = new Set(),
      profileSignature = "";
    const busy = new Set(),
      scroll = root.querySelector(".tg-scroll"),
      left = scroll?.scrollLeft || 0,
      top = scroll?.scrollTop || 0;
    const dialog = CourseDetails.dialog(
      "管理学生 · " + month,
      '<div class="tg-detail-content tg-student-management"><div class="tg-actions tg-student-create"><button class="btn primary" type="button" data-new-member disabled>新建托管学生</button></div><div class="tg-student-groups"></div><p role="status">正在加载…</p><p role="alert"></p></div>',
      {
        onClose: async () => {
          await queue;
          if (!changed || !samePage()) return;
          renderMatrix(root.querySelector("#tg-body"));
          scheduleAdaptiveTableColumns();
          const next = root.querySelector(".tg-scroll");
          if (next) {
            next.scrollLeft = left;
            next.scrollTop = top;
          }
          root
            .querySelector("#tg-manage-students")
            ?.focus({ preventScroll: true });
        },
      },
    );
    dialog.element
      .querySelector(".modal-panel")
      .classList.add("tg-manage-students-panel");
    const groups = dialog.element.querySelector(".tg-student-groups"),
      error = dialog.element.querySelector("[role=alert]"),
      status = dialog.element.querySelector("[role=status]");
    const periods = (id) =>
      source.periods.filter(
        (p) =>
          p.student_id === id &&
          p.start_date <= month + "-31" &&
          (!p.end_date || p.end_date >= month + "-01"),
      );
    function paint() {
      if (!dialog.element.isConnected || !samePage()) return;
      status.textContent = busy.size ? "正在保存…" : "";
      dialog.element.querySelector("[data-new-member]").disabled =
        !ready || busy.size > 0 || studentWrites > 0;
      for (const button of groups.querySelectorAll("[data-member]")) {
        const id = Number(button.dataset.member),
          selected = periods(id).length > 0;
        button.dataset.selected = String(selected);
        button.setAttribute("aria-pressed", String(selected));
        button.disabled = !ready || busy.has(id);
        button.querySelector(".tg-member-mark").textContent =
          protectedIds.has(id) && selected ? "🔒" : selected ? "✓" : "○";
      }
    }
    function accept(next) {
      if (!samePage()) return;
      changed ||=
        JSON.stringify(source.periods) !== JSON.stringify(next.periods);
      source.students = next.students;
      source.periods = next.periods;
      protectedIds = new Set(next.protected_students);
      ready = true;
      const signature = JSON.stringify(
        next.students.map((s) => [s.id, s.name, s.grade, s.status, s.notes]),
      );
      if (signature !== profileSignature) {
        profileSignature = signature;
        renderGroups();
      }
      paint();
    }
    function renderGroups() {
      groups.innerHTML = profileStatuses
        .map(
          (state) =>
            '<section class="tg-student-group"><h3>' +
            statusBadge(state) +
            '</h3><div class="tg-student-choices">' +
            source.students
              .filter((s) => s.status === state)
              .sort(compareStudentGradeName)
              .map(
                (s) =>
                  '<button type="button" class="btn tg-member" data-member="' +
                  s.id +
                  '" title="' +
                  esc(s.notes || s.name) +
                  '"><span class="tg-member-mark" aria-hidden="true"></span>' +
                  renderStudentBadge(s) +
                  " " +
                  renderGradeBadge(s.grade) +
                  "</button>",
              )
              .join("") +
            "</div></section>",
        )
        .join("");
    }
    const latest = () => api("snapshot?month=" + month + "&students_only=1");
    queue = latest()
      .then((next) => {
        if (!dialog.element.isConnected || !samePage()) return;
        accept(next);
      })
      .catch((e) => {
        error.textContent = e.message;
        status.textContent = "";
      });
    dialog.element.querySelector("[data-new-member]").onclick = () => {
      if (!ready || studentWrites || !samePage()) return;
      const modal = form(
        "新建托管学生",
        input("name", "姓名") +
          select("grade", "年级", grades, "初一") +
          input("notes", "备注（选填）") +
          '<p data-name-hint hidden>已有同名档案，建议取消后选择已有学生。确为不同学生时，请填写可辨认备注并确认。</p><label data-same-name hidden><input type="checkbox" name="confirm_same_name">确认为不同学生，独立建档</label>',
        (values) => {
          if (!samePage() || !dialog.element.isConnected)
            throw Error("当前月份已变化，请重新打开");
          studentWrites++;
          paint();
          const operation = queue.then(() =>
            post("student", {
              ...values,
              confirm_same_name: values.confirm_same_name === "on",
              month,
            }),
          );
          queue = operation
            .then(
              (next) => {
                accept(next);
                changed = true;
              },
              () => {},
            )
            .finally(() => {
              studentWrites--;
              paint();
            });
          return operation;
        },
        () => "",
        async () => {
          await queue;
        },
      );
      const name = modal.element.querySelector("[name=name]"),
        notes = modal.element.querySelector("[name=notes]"),
        confirm = modal.element.querySelector("[name=confirm_same_name]");
      name.required = true;
      name.oninput = () => {
        const duplicate = source.students.some(
          (s) => s.name === name.value.trim(),
        );
        modal.element.querySelector("[data-name-hint]").hidden = !duplicate;
        modal.element.querySelector("[data-same-name]").hidden = !duplicate;
        confirm.required = duplicate;
        notes.required = duplicate;
        if (!duplicate) confirm.checked = false;
      };
    };
    groups.onclick = (event) => {
      const button = event.target.closest("[data-member]");
      if (!button || !ready || button.disabled || !samePage()) return;
      const id = Number(button.dataset.member),
        student = source.students.find((s) => s.id === id),
        selected = periods(id).length > 0;
      if (selected && protectedIds.has(id)) {
        error.textContent = "该学生本月已有考勤或资金记录，无法移除。";
        return;
      }
      if (!selected && student.status !== "在托") {
        error.textContent = "请先在托管学生中将档案状态改为在托，再加入本月。";
        return;
      }
      busy.add(id);
      studentWrites++;
      error.textContent = "";
      paint();
      queue = queue.then(async () => {
        try {
          if (!samePage() || !ready) return;
          const current = source.students.find((s) => s.id === id),
            rows = periods(id);
          accept(
            await post(
              rows.length ? "remove-students" : "period",
              rows.length
                ? {
                    month,
                    students: [
                      {
                        id,
                        versions: rows
                          .sort((a, b) => a.id - b.id)
                          .map((p) => [p.id, p.version]),
                      },
                    ],
                  }
                : { month, student_id: id, student_version: current.version },
            ),
          );
        } catch (e) {
          if (samePage()) {
            error.textContent = e.message;
            try {
              accept(await latest());
            } catch {
              ready = false;
              error.textContent += "；请关闭后重试";
            }
          }
        } finally {
          busy.delete(id);
          studentWrites--;
          paint();
        }
      });
    };
  }
  function renderMatrix(body) {
    const month = day.slice(0, 7),
      start = month + "-01",
      end = month + "-31";
    const source = data,
      host = root,
      owner = auth.user?.id;
    const attendance = new Map(
      source.attendance.map((a) => [a.student_id + ":" + a.date, a]),
    );
    const calendar = new Map(source.calendar.map((c) => [c.date, c]));
    const recordedDates = source.attendance.map((a) => a.date);
    const dates = [
      ...new Set([
        ...source.calendar.filter((c) => c.enabled).map((c) => c.date),
        ...recordedDates,
      ]),
    ].sort();
    const byStudent = new Map();
    for (const p of source.periods) {
      if (!byStudent.has(p.student_id)) byStudent.set(p.student_id, []);
      byStudent.get(p.student_id).push(p);
    }
    const monthStudents = source.students
      .flatMap((s) => {
        const periods = (byStudent.get(s.id) || []).filter(
          (p) => p.start_date <= end && (!p.end_date || p.end_date >= start),
        );
        if (!periods.length) return [];
        const historicalGrade = source.attendance.find(
          (a) => a.student_id === s.id,
        )?.grade;
        const row = {
          ...s,
          grade: historicalGrade || periods[0].grade,
          periods,
        };
        return matches(row, row) ? [row] : [];
      })
      .sort(compareStudentGradeName);
    const currentPeriod = (s, date) =>
      s.periods.find(
        (p) => p.start_date <= date && (!p.end_date || p.end_date >= date),
      );
    const cellContent = (record, editable, defaultStatus = "出勤") => {
      const label = record
        ? record.status === "停课"
          ? "放假"
          : record.status === "未登记"
            ? "原始空白/异常"
            : record.status
        : editable
          ? defaultStatus
          : "—";
      return (
        badge(label) +
        (!record && editable
          ? '<span class="tg-unsaved-dot" title="尚未保存" aria-label="尚未保存">·</span>'
          : "")
      );
    };
    body.innerHTML =
      '<div class="tg-actions tg-matrix-actions">' +
      (finance
        ? '<button class="btn" id="tg-manage-students">管理学生</button><button class="btn" id="tg-manage-dates">管理日期</button>'
        : "") +
      "</div>" +
      listTable(
        ["学生", "年级", ...dates.map((d) => d.slice(5))],
        monthStudents.map(
          (s) =>
            '<tr data-student="' +
            s.id +
            '"><td>' +
            renderStudentBadge(s, { grade: s.grade }) +
            "</td><td>" +
            renderGradeBadge(s.grade) +
            "</td>" +
            dates
              .map((date) => {
                const record = attendance.get(s.id + ":" + date),
                  editable =
                    !!currentPeriod(s, date) &&
                    calendar.get(date)?.enabled === 1;
                return (
                  '<td data-date="' +
                  date +
                  '">' +
                  (editable
                    ? '<button class="tg-cell-button" data-student="' +
                      s.id +
                      '" data-date="' +
                      date +
                      '" aria-label="' +
                      esc(s.name + " " + date + " 考勤") +
                      '" ' +
                      (isReadonlyUser() ? "disabled" : "") +
                      ">" +
                      cellContent(
                        record,
                        true,
                        currentPeriod(s, date)?.default_status,
                      ) +
                      "</button>"
                    : cellContent(record, false)) +
                  "</td>"
                );
              })
              .join("") +
            "</tr>",
        ),
      );
    const matrix = body.querySelector(".tg-table");
    matrix.classList.add("tg-matrix");
    matrix.dataset.frozenColumns = "3";
    matrix.dataset.uniformFrom = "3";
    body
      .querySelector("#tg-manage-students")
      ?.addEventListener("click", manageMatrixStudents);
    body
      .querySelector("#tg-manage-dates")
      ?.addEventListener("click", manageMatrixDates);
    for (const button of body.querySelectorAll(".tg-cell-button"))
      button.onclick = (event) => {
        if (studentWrites || dateWrites) return message("请等待保存完成");
        if (button.disabled || event.target.closest(".custom-select")) return;
        const id = Number(button.dataset.student),
          date = button.dataset.date,
          key = id + ":" + date;
        const old = attendance.get(key),
          shown =
            old?.status === "停课"
              ? "放假"
              : old?.status || period(id, date)?.default_status || "出勤";
        openInlineCustomPicker(button, {
          id,
          field: "status",
          renderOption: badge,
          choices: opt(statuses, shown),
          onChange: async (control) => {
            cellWrites++;
            try {
              const response = await post("attendance", {
                date,
                rows: [
                  {
                    student_id: id,
                    status: control.value,
                    notes: old?.notes || "",
                    version: old?.version || 0,
                  },
                ],
              });
              if (
                host !== root ||
                source !== data ||
                owner !== auth.user?.id ||
                !button.isConnected
              )
                return;
              const saved = (
                Array.isArray(response) ? response : response.rows
              )[0];
              attendance.set(key, saved);
              const index = source.attendance.findIndex(
                (a) => a.student_id === id && a.date === date,
              );
              if (index < 0) source.attendance.push(saved);
              else source.attendance[index] = saved;
              closeScheduleInlinePicker();
              button.innerHTML = cellContent(saved, true);
              button.focus({ preventScroll: true });
              message("已保存");
            } catch (error) {
              if (
                host !== root ||
                source !== data ||
                owner !== auth.user?.id ||
                !button.isConnected
              )
                return;
              if (error.status === 409) {
                try {
                  const fresh = await api("snapshot?month=" + month);
                  const record = fresh.attendance.find(
                    (a) => a.student_id === id && a.date === date,
                  );
                  if (
                    host !== root ||
                    source !== data ||
                    owner !== auth.user?.id ||
                    !button.isConnected
                  )
                    return;
                  if (record) attendance.set(key, record);
                  else attendance.delete(key);
                  source.attendance = source.attendance.filter(
                    (a) => a.student_id !== id || a.date !== date,
                  );
                  if (record) source.attendance.push(record);
                } catch {}
              }
              if (
                host !== root ||
                source !== data ||
                owner !== auth.user?.id ||
                !button.isConnected
              )
                return;
              closeScheduleInlinePicker();
              button.innerHTML = cellContent(
                attendance.get(key),
                true,
                period(id, date)?.default_status,
              );
              button.focus({ preventScroll: true });
              message(error.message);
            } finally {
              cellWrites--;
              if (
                !cellWrites &&
                filterQueued &&
                root.dataset.loadedMonth === day.slice(0, 7)
              ) {
                filterQueued = false;
                draw();
              }
            }
          },
        });
      };
    for (const button of body.querySelectorAll(".tg-cell-button"))
      button.onkeydown = (event) => {
        if (event.target === button && ["Enter", " "].includes(event.key)) {
          event.preventDefault();
          button.click();
        }
      };
  }
  function renderStudents(body) {
    const students = data.students
      .filter((s) => matches(s, s))
      .sort(compareProfiles);
    body.innerHTML =
      '<div class="tg-actions"><button class="btn primary" id="tg-new">新建托管学生</button></div>' +
      listTable(
        ["学生", "年级", "状态", "托管首日", "上次在托"],
        students.map((s) => {
          return tr([
            '<button class="tg-profile-link" data-id="' +
              s.id +
              '" aria-label="修改' +
              esc(s.name) +
              '的资料" ' +
              (isReadonlyUser() ? "disabled" : "") +
              ">" +
              studentBadge(s.id) +
              "</button>",
            renderGradeBadge(s.grade),
            `<select class="cell-select inline-status-select tg-profile-status" data-field="status" data-student="${s.id}" aria-label="${esc(s.name)}档案状态" ${isReadonlyUser() ? "disabled" : ""}>${opt(profileStatuses, s.status)}</select>`,
            s.first_attendance_date || "—",
            s.last_attendance_date || "—",
          ]);
        }),
      );
    const host = root,
      source = data,
      owner = auth.user?.id;
    for (const control of body.querySelectorAll(".tg-profile-status"))
      control.onchange = async () => {
        const student = source.students.find(
          (s) => s.id === Number(control.dataset.student),
        );
        if (isReadonlyUser() || control.disabled) return;
        control.disabled = true;
        syncCustomSelect(control, control.nextElementSibling);
        try {
          const updated = await post("student", {
            id: student.id,
            name: student.name,
            grade: student.grade,
            notes: student.notes,
            status: control.value,
            version: student.version,
          });
          if (root === host && data === source && auth.user?.id === owner) {
            Object.assign(student, updated);
            draw();
            message("状态已保存");
          }
        } catch (e) {
          if (root === host && data === source && auth.user?.id === owner) {
            control.value = student.status;
            message(e.message);
          }
        } finally {
          if (control.isConnected) {
            control.disabled = false;
            syncCustomSelect(control, control.nextElementSibling);
          }
        }
      };
    root.querySelector("#tg-new").onclick = () => profileForm();
    body
      .querySelectorAll(".tg-profile-link")
      .forEach(
        (b) =>
          (b.onclick = () =>
            profileForm(
              data.students.find((s) => s.id === Number(b.dataset.id)),
            )),
      );
  }
  function moneyForm(record = null) {
    if (isReadonlyUser()) return;
    const methods = { 微信: "wechat", 现金: "cash", 支付宝: "alipay" };
    const channel = record
      ? methods[record.method] || (record.method ? "other" : "wechat")
      : "wechat";
    const other =
      channel === "other" ? record.method.replace(/^其他[：:]\s*/, "") : "";
    const modal = form(
      record ? "编辑托管资金记录" : "托管资金记录",
      studentSelect(record?.student_id) +
        input("date", "业务日期", record?.date || today(), "date") +
        select("kind", "类型", manualMoneyKinds, record?.kind || "充值") +
        input(
          "actual_amount",
          "实际金额（元）",
          record ? String(Math.abs(record.actual_amount) / 100) : "0",
          "number",
        ) +
        input(
          "gift_amount",
          "赠送金额（元）",
          record ? String(Math.abs(record.gift_amount) / 100) : "0",
          "number",
        ) +
        select("channel", "支付方式", rechargeChannelOptions, channel) +
        input("channel_other", "其他渠道说明", other) +
        input("notes", "备注（选填）", record?.notes || ""),
      (v) =>
        post(record ? "money-edit" : "money", {
          ...v,
          ...(record ? { id: record.id, version: record.version } : {}),
          student_id: Number(v.student_id),
          actual_amount: toCents(v.actual_amount),
          gift_amount: toCents(v.gift_amount),
        }),
      (v) =>
        (rangeStart && v.date < rangeStart) ||
        (rangeEnd && v.date > rangeEnd) ||
        (!rangeStart && !rangeEnd && !v.date.startsWith(day.slice(0, 7)))
          ? "已保存至 " + v.date + "，不在当前筛选范围内"
          : "已保存",
    );
    const selectChannel = modal.element.querySelector("[name=channel]"),
      otherInput = modal.element.querySelector("[name=channel_other]");
    const sync = () => {
      otherInput.closest("label").hidden = selectChannel.value !== "other";
      otherInput.required = selectChannel.value === "other";
      if (selectChannel.value !== "other") otherInput.value = "";
    };
    selectChannel.onchange = sync;
    otherInput.maxLength = 100;
    sync();
    modal.element.querySelector("[name=date]").required = true;
    modal.element.querySelector("[name=student_id]").required = true;
  }
  function ledgerAnalysis(rows, gradeFor) {
    let actual = 0,
      gift = 0,
      refund = 0,
      records = 0;
    const students = new Set(),
      byGrade = new Map(),
      byChannel = new Map();
    for (const row of rows) {
      const cash = row.actual_amount ?? row.amount,
        bonus = row.gift_amount ?? 0,
        recharge = row.kind === "充值";
      if (recharge) {
        actual += cash;
        gift += bonus;
        records++;
        students.add(row.student_id);
      } else refund -= cash + bonus;
      const method = String(row.method || "").trim();
      const channel = !method
        ? "未记录"
        : ["微信", "现金", "支付宝"].includes(method)
          ? method
          : "其他";
      for (const [map, key, value] of [
        [byGrade, gradeFor(row), cash + bonus],
        [byChannel, channel, recharge ? cash : 0],
      ]) {
        if (map === byChannel && !recharge) continue;
        const item = map.get(key) || {
          name: key,
          net: 0,
          records: 0,
          students: new Set(),
        };
        item.net += value;
        item.records++;
        item.students.add(row.student_id);
        map.set(key, item);
      }
    }
    const splits = (map, order) =>
      [...map.values()]
        .map((r) => ({ ...r, net: r.net / 100, students: r.students.size }))
        .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    return rechargeAnalysisMarkup([], {
      summary: {
        byGrade: splits(byGrade, [...grades, "未记录"]),
        bySource: splits(byChannel, [
          "微信",
          "现金",
          "支付宝",
          "其他",
          "未记录",
        ]),
      },
      cards: [
        ["实际充值合计", actual / 100, "money"],
        ["赠送充值合计", gift / 100, "money"],
        ["净账户资金变动", (actual + gift - refund) / 100, "money"],
        ["充值记录数", records, "number"],
        ["充值学生数", students.size, "number"],
        ["退款合计", refund / 100, "money"],
      ],
      subtitle: "随当前筛选更新；净账户变动及退款含赠送金额。",
      gradeTitle: "按业务年级 · 净账户变动",
      sourceTitle: "按支付渠道 · 实际充值",
    });
  }
  function renderLedger(body) {
    const studentById = new Map(data.students.map((s) => [s.id, s]));
    const gradesByRecord = new Map();
    const gradeFor = (row) => {
      if (!gradesByRecord.has(row.id))
        gradesByRecord.set(
          row.id,
          period(row.student_id, row.date)?.grade || "未记录",
        );
      return gradesByRecord.get(row.id);
    };
    const rows = data.ledger.filter(
      (l) =>
        isManualMoney(l) &&
        (!ledgerKind || l.kind === ledgerKind) &&
        (!rangeStart || l.date >= rangeStart) &&
        (!rangeEnd || l.date <= rangeEnd) &&
        matches(studentById.get(l.student_id) || { name: "" }, {
          grade: gradeFor(l),
        }),
    );
    root.querySelector("#tg-recharge-analysis").innerHTML = ledgerAnalysis(
      rows,
      gradeFor,
    );
    const editable = (r) => !isReadonlyUser() && r.editable !== false;
    const ids = new Set(rows.filter(editable).map((r) => r.id));
    for (const id of selectedLedgerIds)
      if (!ids.has(id)) selectedLedgerIds.delete(id);
    body.innerHTML =
      '<div class="tg-actions transaction-action-row"><button class="btn primary" id="tg-money">新增资金记录</button><button class="btn danger" id="tg-money-delete">批量删除</button></div>' +
      table(
        ["日期", "学生", "类型", "实际金额", "赠送金额", "支付方式", "备注"],
        rows.map(
          (r) =>
            '<tr class="tg-ledger-row" data-ledger="' +
            r.id +
            '" tabindex="' +
            (editable(r) ? "0" : "-1") +
            '"><td class="select-col adaptive-center"><input type="checkbox" class="tg-ledger-select" data-id="' +
            r.id +
            '" aria-label="选择托管资金记录" ' +
            (editable(r) ? "" : "disabled") +
            "></td>" +
            [
              r.date,
              studentBadge(r.student_id, gradeFor(r)),
              esc(r.kind),
              money(r.actual_amount),
              money(r.gift_amount),
              esc(r.method),
              esc(r.notes) + (r.editable === false ? "（旧账归属待核对）" : ""),
            ]
              .map((v) => "<td>" + v + "</td>")
              .join("") +
            "</tr>",
        ),
        true,
        true,
      );
    for (const index of [5, 6])
      body.querySelectorAll("col")[index].dataset.alignment = "right";
    const all = body.querySelector(".tg-ledger-all"),
      remove = body.querySelector("#tg-money-delete");
    const sync = () => {
      for (const input of body.querySelectorAll(".tg-ledger-select"))
        input.checked = selectedLedgerIds.has(Number(input.dataset.id));
      all.checked = ids.size > 0 && selectedLedgerIds.size === ids.size;
      all.indeterminate = selectedLedgerIds.size > 0 && !all.checked;
      all.disabled = !ids.size;
      remove.disabled = !selectedLedgerIds.size;
      remove.textContent = bulkActionText("批量删除", selectedLedgerIds.size);
    };
    for (const input of body.querySelectorAll(".tg-ledger-select"))
      input.onchange = () => {
        const id = Number(input.dataset.id);
        if (input.checked) selectedLedgerIds.add(id);
        else selectedLedgerIds.delete(id);
        sync();
      };
    all.onchange = () => {
      selectedLedgerIds.clear();
      if (all.checked) for (const id of ids) selectedLedgerIds.add(id);
      sync();
    };
    sync();
    for (const row of body.querySelectorAll("[data-ledger]")) {
      const open = () => {
        const record = rows.find((r) => r.id === Number(row.dataset.ledger));
        if (editable(record)) moneyForm(record);
        else if (!isReadonlyUser())
          message("历史记录尚未确认分账，无法安全编辑");
      };
      row.onclick = (e) => {
        if (!e.target.closest("input,.select-col")) open();
      };
      row.onkeydown = (e) => {
        if (e.target === row && e.key === "Enter") {
          e.preventDefault();
          open();
        }
      };
    }
    body.querySelector("#tg-money").onclick = () => moneyForm();
    remove.onclick = () => {
      if (remove.disabled || isReadonlyUser()) return;
      const records = rows
        .filter((r) => selectedLedgerIds.has(r.id))
        .map((r) => ({ id: r.id, version: r.version }));
      const modal = form(
        "批量删除托管资金",
        "<p>确定删除选中的" +
          records.length +
          "条托管资金记录吗？这些记录可能影响学生实际余额、赠送余额和历史欠费。</p>",
        async () => {
          const result = await post("money-delete", { records });
          selectedLedgerIds.clear();
          return result;
        },
        () => "已删除 " + records.length + " 条记录",
      );
      modal.element.querySelector("[type=submit]").textContent = "确认删除";
    };
  }
  function renderFees(body) {
    const rows = data.summary
        .filter((s) => s.has_attendance && matches(s, s))
        .sort(compareStudentGradeName),
      keys = [
        "fee",
        "actual_consumption",
        "gift_consumption",
        "opening_actual",
        "opening_gift",
        "actual_recharge",
        "gift_recharge",
        "actual_balance",
        "gift_balance",
      ];
    const headers = [
      "学生",
      "年级",
      "本月托管消费",
      "本月实际消费",
      "本月赠送消费",
      "上月实际结转",
      "上月赠送结转",
      "本月实际充值",
      "本月赠送充值",
      "月末实际余额",
      "月末赠送余额",
    ];
    const sum = (k) => money(rows.reduce((n, r) => n + r[k], 0));
    body.innerHTML =
      metrics([
        ["本月托管消费", sum("fee")],
        ["本月实际充值", sum("actual_recharge")],
        ["本月赠送充值", sum("gift_recharge")],
        ["月末剩余余额", sum("balance")],
      ]) +
      listTable(
        headers,
        rows.map((r) =>
          tr(
            [
              renderStudentBadge(r, { grade: r.grade }),
              renderGradeBadge(r.grade),
              ...keys.map(
                (k) =>
                  '<span class="' +
                  (r[k] < 0 ? "tg-negative" : "") +
                  '">' +
                  money(r[k]) +
                  "</span>",
              ),
            ],
            ' class="tg-fee-row" data-student="' +
              r.id +
              '" tabindex="0" role="button" aria-label="查看' +
              esc(r.name) +
              '托管详情"',
          ),
        ),
      );
    body.querySelectorAll(".tg-fee-row").forEach((row) => {
      row.onclick = (e) => {
        if (!e.target.closest("button,a,input,select,textarea"))
          studentDetail(Number(row.dataset.student));
      };
      row.onkeydown = (e) => {
        if (e.target === row && ["Enter", " "].includes(e.key)) {
          e.preventDefault();
          studentDetail(Number(row.dataset.student));
        }
      };
    });
  }
  function draw() {
    if (!root?.isConnected) return;
    const focus = document.activeElement,
      focusId = root.contains(focus) ? focus.id : "",
      caret = focusId === "tg-query" ? focus.selectionStart : null;
    root.innerHTML =
      '<section class="tg-panel">' +
      (tab === "流水"
        ? '<div id="tg-recharge-analysis" class="recharge-page"></div>'
        : "") +
      filtersHtml() +
      '<p id="tg-msg" role="status" aria-live="polite"></p><div id="tg-body"></div></section>';

    const body = root.querySelector("#tg-body");
    if (tab === "签到") {
      renderMatrix(body);
    } else if (tab === "学生") {
      renderStudents(body);
    } else if (tab === "流水") {
      renderLedger(body);
    } else if (tab === "汇总") {
      renderFees(body);
    } else if (tab === "设置") {
      body.innerHTML =
        '<section class="tg-settings-section"><h3>收费规则</h3>' +
        table(
          ["考勤状态", "每日费用"],
          Object.entries(data.billing_rule).map(([status, fee]) =>
            tr([badge(status), money(fee)]),
          ),
        ) +
        '</section><div class="tg-actions"><button class="btn" id="tg-copy">复制托管信息</button><button class="btn" id="tg-paste">导入托管信息</button></div>';
      root.querySelector("#tg-copy").onclick = () => transferDialog(false);
      root.querySelector("#tg-paste").onclick = () => transferDialog(true);
    }
    const changeDay = async (value) => {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
      ) {
        message("请输入有效日期");
        return;
      }
      if (day.slice(0, 7) === value.slice(0, 7)) return;
      clearTimeout(filterTimer);
      day = value;
      rangeStart = "";
      rangeEnd = "";
      const target = root,
        page = tab;
      root.querySelector("#tg-month").value = value.slice(0, 7);
      root
        .querySelectorAll("#tg-body button")
        .forEach((b) => (b.disabled = true));
      try {
        await refresh();
      } catch (e) {
        if (day === value) loadError(target, page, e);
      }
    };
    root
      .querySelector("#tg-month")
      ?.addEventListener("change", (e) => changeDay(e.target.value + "-01"));
    const search = () => {
      query = root.querySelector("#tg-query").value.trim();
      grade = root.querySelector("#tg-grade").value;
      ledgerKind = root.querySelector("#tg-kind")?.value || "";
      if (rangeStart && rangeEnd && rangeStart > rangeEnd) {
        message("起始日期不能晚于截止日期");
        return;
      }
      draw();
    };
    const autoSearch = () => {
      if (!root.querySelector("#tg-query")) return;
      if (cellWrites || root.dataset.loadedMonth !== day.slice(0, 7)) {
        filterQueued = true;
        query = root.querySelector("#tg-query")?.value.trim() || "";
        grade = root.querySelector("#tg-grade")?.value || "";
        return;
      }
      search();
    };
    root.querySelector("#tg-query")?.addEventListener("input", () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(autoSearch, 180);
    });
    root.querySelector("#tg-grade")?.addEventListener("change", autoSearch);
    for (const id of ["tg-kind"])
      root.querySelector("#" + id)?.addEventListener("change", autoSearch);
    root
      .querySelectorAll("[data-tg-month-step]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            changeDay(
              offsetMonth(
                day.slice(0, 7) + "-01",
                Number(b.dataset.tgMonthStep),
              ),
            )),
      );
    root.querySelector("#tg-query")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        clearTimeout(filterTimer);
        autoSearch();
      }
    });
    root.querySelector("#tg-reset")?.addEventListener("click", () => {
      const reload = tab === "流水" && (rangeStart || rangeEnd);
      query = grade = ledgerKind = rangeStart = rangeEnd = "";
      if (reload) refresh().catch((e) => message(e.message));
      else draw();
    });
    root.querySelectorAll("[data-go]").forEach(
      (b) =>
        (b.onclick = () => {
          setActiveView(b.dataset.go);
          load({ refreshGlobal: false });
        }),
    );
    root
      .querySelectorAll("input:not([type=checkbox]),select")
      .forEach((e) => e.classList.add("control"));
    root.querySelectorAll(".tg-table").forEach((t) => {
      const heads = [...t.querySelectorAll("th")];
      heads.forEach((th, i) => {
        if (
          /金额|余额|结转|充值|退款|托管费|消费|优惠|出勤|请假|缺勤/.test(
            th.textContent,
          ) &&
          !["考勤", "状态"].some((x) => th.textContent.includes(x))
        )
          t.querySelectorAll("tr").forEach((row) =>
            row.children[i]?.classList.add("tg-number"),
          );
      });
    });
    if (typeof isReadonlyUser === "function" && isReadonlyUser())
      root
        .querySelectorAll(
          "#tg-manage-students,#tg-manage-dates,#tg-copy,#tg-paste,.tg-cell-button,#tg-new,#tg-money,#tg-rule",
        )
        .forEach((e) => {
          e.disabled = true;
          e.title = "当前账号只读";
        });
    enhanceCustomSelects();
    enhanceCustomDateInputs();
    bindDateRangePickerControls(root);
    scheduleAdaptiveTableColumns();
    if (focusId) {
      const next = root.querySelector("#" + focusId);
      next?.focus({ preventScroll: true });
      if (caret != null) next?.setSelectionRange(caret, caret);
    }
  }
  function message(s) {
    const m = root.querySelector("#tg-msg");
    if (m) m.textContent = s;
  }
  async function mount(el, page) {
    selectedLedgerIds.clear();
    clearTimeout(filterTimer);
    filterQueued = false;
    const sameAccount = account === auth.user?.id;
    if (!sameAccount) {
      filters.clear();
      pendingRequests.clear();
      account = auth.user?.id;
      query = grade = ledgerKind = rangeStart = rangeEnd = "";
      day = today();
    }
    filters.set(tab, {
      query,
      grade,
      ledgerKind,
      rangeStart,
      rangeEnd,
    });
    const saved = filters.get(page) || {};
    query = saved.query || "";
    grade = saved.grade || "";
    ledgerKind = saved.ledgerKind || "";
    rangeStart = saved.rangeStart || "";
    rangeEnd = saved.rangeEnd || "";
    const host = document.createElement("div");
    el.replaceChildren(host);
    root = host;
    finance = canView("tgFinance");
    tab = page;
    root.innerHTML =
      '<div class="band"><div class="loading" role="status">正在加载托管数据…</div></div>';
    try {
      await refresh();
    } catch (e) {
      loadError(host, page, e);
    }
  }
  async function applyRange(start, end) {
    if (tab !== "流水" || !root?.isConnected) return;
    rangeStart = start;
    rangeEnd = end;
    const host = root,
      wanted = start + ":" + end;
    try {
      await refresh();
    } catch (e) {
      if (root === host && wanted === rangeStart + ":" + rangeEnd)
        message(e.message);
    }
  }
  return { mount, applyRange };
})();
