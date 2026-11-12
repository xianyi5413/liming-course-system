/* Integrated native UI; all financial amounts sent as integer cents. */
window.TuoguanUI = (() => {
  const statuses = ["出勤", "请假", "放假", "不适用"];
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
    const monthEnd = new Date(
      Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0),
    )
      .toISOString()
      .slice(0, 10);
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
              opt(
                [["", "全部类型"], ...new Set(data.ledger.map((l) => l.kind))],
                ledgerKind,
              ) +
              "</select>",
          ) +
          field(
            "起始日（本月）",
            '<input class="control" id="tg-start" type="date" value="' +
              rangeStart +
              '" min="' +
              day.slice(0, 7) +
              '-01" max="' +
              monthEnd +
              '">',
          ) +
          field(
            "截止日（本月）",
            '<input class="control" id="tg-end" type="date" value="' +
              rangeEnd +
              '" min="' +
              day.slice(0, 7) +
              '-01" max="' +
              monthEnd +
              '">',
          )
        : "") +
      '</div><div class="filter-summary"><button class="btn" id="tg-reset">清空筛选</button></div></div>'
    );
  }
  function studentDetail(id) {
    const host = root,
      owner = auth.user?.id,
      student = data.students.find((s) => s.id === id);
    if (!student) return;
    let month = day.slice(0, 7),
      sequence = 0;
    const dialog = CourseDetails.dialog(
      student.name + " · 托管详情",
      '<div class="tg-detail-content"></div>',
      { onClose: () => sequence++ },
    );
    dialog.element
      .querySelector(".modal-panel")
      .classList.add("tg-student-detail-panel");
    const content = dialog.element.querySelector(".tg-detail-content");
    const current = () =>
      dialog.element.isConnected && host === root && owner === auth.user?.id;
    function render(snapshot, loading = false, error = "") {
      const a = snapshot?.summary.find((r) => r.id === id),
        history = snapshot?.attendance.filter((r) => r.student_id === id) || [],
        byDate = new Map(history.map((r) => [r.date, r]));
      const [year, m] = month.split("-").map(Number),
        first = new Date(Date.UTC(year, m - 1, 1)).getUTCDay(),
        days = new Date(Date.UTC(year, m, 0)).getUTCDate();
      const cells = Array.from(
        { length: first },
        () => '<span aria-hidden="true"></span>',
      );
      for (let n = 1; n <= days; n++) {
        const date = month + "-" + String(n).padStart(2, "0"),
          record = byDate.get(date),
          status = record?.status === "停课" ? "放假" : record?.status;
        const tone = statusTone(status),
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
        cells.push(
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
            "</span></div>",
        );
      }
      const header =
        '<div class="tg-actions">' +
        renderStudentBadge(student, { grade: a?.grade || student.grade }) +
        renderGradeBadge(a?.grade || student.grade) +
        '</div><div class="tg-detail-month"><button class="date-range-nav" data-detail-step="-1" aria-label="上个月">‹</button><strong>' +
        year +
        "年" +
        m +
        '月</strong><button class="date-range-nav" data-detail-step="1" aria-label="下个月">›</button></div>';
      content.innerHTML =
        header +
        (loading
          ? '<p role="status">正在加载…</p>'
          : error
            ? '<p role="alert">' + esc(error) + "</p>"
            : '<div class="date-range-weekdays">' +
              [..."日一二三四五六"]
                .map((d) => "<span>" + d + "</span>")
                .join("") +
              '</div><div class="tg-detail-calendar">' +
              cells.join("") +
              '</div><div class="tg-calendar-legend">' +
              statuses.map(badge).join("") +
              "</div>" +
              metrics([
                ["实际充值", money(a.actual_recharge)],
                ["赠送充值", money(a.gift_recharge)],
                ["本月托管消费", money(a.fee)],
                ["本月实际消费", money(a.actual_consumption)],
                ["本月赠送消费", money(a.gift_consumption)],
                ["月末实际余额", money(a.actual_balance)],
                ["月末赠送余额", money(a.gift_balance)],
              ]) +
              (a.unpaid_current_fee
                ? '<p class="muted-tip">本月费用含未付 ' +
                  money(a.unpaid_current_fee) +
                  "</p>"
                : "") +
              (a.prior_debt_gift_offset
                ? '<p class="muted-tip">赠送余额抵扣结转或调整欠费 ' +
                  money(a.prior_debt_gift_offset) +
                  "</p>"
                : "") +
              table(
                ["日期", "类型", "实际金额", "赠送金额", "备注"],
                snapshot.ledger
                  .filter((r) => r.student_id === id)
                  .map((r) =>
                    tr([
                      r.date,
                      esc(r.kind),
                      money(r.actual_amount),
                      money(r.gift_amount),
                      esc(r.notes) +
                        (r.legacy_unallocated ? "（旧账归属待核对）" : ""),
                    ]),
                  ),
              ));
      content.dataset.month = month;
      content.dataset.loading = loading ? "true" : "false";
      for (const b of content.querySelectorAll("[data-detail-step]"))
        b.onclick = async () => {
          month = offsetMonth(
            month + "-01",
            Number(b.dataset.detailStep),
          ).slice(0, 7);
          const wanted = month,
            request = ++sequence;
          render(null, true);
          try {
            const next = await api("snapshot?month=" + wanted);
            if (current() && request === sequence && wanted === month)
              render(next);
          } catch (e) {
            if (current() && request === sequence)
              render(null, false, e.message);
          }
        };
      scheduleAdaptiveTableColumns();
    }
    render(data);
  }
  async function api(action, body) {
    const r = await fetch("/api/tuoguan/" + action, {
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
      d = await api("snapshot?month=" + month);
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
  const table = (headers, rows, indexed = false) =>
    `<div class="band"><div class="table-wrap smooth-table-wrap tg-scroll"><table class="uniform-table nowrap-table tg-table" data-adaptive-table="true" data-adaptive-natural="true"><colgroup>${indexed ? rowIndexColumn() : ""}${headers.map((h) => '<col data-column-type="full" data-min-width="0" data-alignment="center">').join("")}</colgroup><thead><tr>${indexed ? rowIndexHeader() : ""}${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row, i) => (indexed ? row.replace(/^(<tr[^>]*>)/, `$1${renderRowIndex(i)}`) : row)).join("") || `<tr><td class="empty" colspan="${headers.length + Number(indexed)}">${empty("暂无符合条件的记录", "调整筛选条件，或使用页面上的新增入口。")}</td></tr>`}</tbody></table></div></div>`;
  const listTable = (headers, rows) => table(headers, rows, true);
  const tr = (values, attrs = "") =>
    `<tr${attrs}>${values.map((v) => `<td>${v}</td>`).join("")}</tr>`;
  function form(title, fields, save) {
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
        await save(Object.fromEntries(new FormData(e.target)));
        modal.close();
        if (host !== root || owner !== auth.user?.id || !day.startsWith(month))
          return;
        await refresh();
        if (host === root && owner === auth.user?.id && day.startsWith(month))
          message("已保存");
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
  const studentSelect = () =>
    select(
      "student_id",
      "托管学生档案",
      data.students.map((s) => [s.id, studentLabel(s)]),
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
        (s ? "" : input("start_date", "入托日期", day, "date")) +
        input("notes", "备注", s?.notes || ""),
      (v) => post("student", { ...v, id: s?.id, version: s?.version }),
    );
  function chooseRemoval(title, choices, action, payload) {
    const host = root,
      month = day.slice(0, 7),
      owner = auth.user?.id;
    const dialog = CourseDetails.dialog(
      title,
      '<form class="tg-form"><div class="tg-choice-list">' +
        choices
          .map(
            ([value, label]) =>
              '<label><input type="checkbox" name="choice" value="' +
              esc(value) +
              '"> ' +
              label +
              "</label>",
          )
          .join("") +
        '</div><p role="alert"></p><div class="modal-actions"><button class="btn" type="submit">确认移除</button></div></form>',
      { size: "compact" },
    );
    dialog.element.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      const button = dialog.element.querySelector("[type=submit]");
      if (button.disabled) return;
      const values = [
        ...dialog.element.querySelectorAll("[name=choice]:checked"),
      ].map((x) => x.value);
      if (!values.length) {
        dialog.element.querySelector("[role=alert]").textContent =
          "请至少选择一项";
        return;
      }
      button.disabled = true;
      try {
        if (
          host !== root ||
          month !== day.slice(0, 7) ||
          owner !== auth.user?.id
        )
          throw Error("页面已变化，请重新选择");
        await post(action, { month, ...payload(values) });
        dialog.close();
        if (host === root && month === day.slice(0, 7)) {
          await refresh();
          message("已移除");
        }
      } catch (error) {
        dialog.element.querySelector("[role=alert]").textContent =
          error.message;
      } finally {
        button.disabled = false;
      }
    };
  }
  function removeMatrixStudents(students) {
    chooseRemoval(
      "移除本月签到行（保留档案）",
      students.map((s) => [s.id, studentBadge(s.id, s.grade)]),
      "remove-students",
      (values) => ({
        students: values.map((id) => {
          const s = students.find((s) => s.id === Number(id));
          return {
            id: s.id,
            versions: [...s.periods]
              .sort((a, b) => a.id - b.id)
              .map((p) => [p.id, p.version]),
          };
        }),
      }),
    );
  }
  function removeMatrixDates(dates) {
    const calendar = new Map(data.calendar.map((c) => [c.date, c]));
    chooseRemoval(
      "移除日期（已有记录将阻止删除）",
      dates.map((d) => [d, esc(d)]),
      "remove-dates",
      (values) => ({
        dates: values.map((date) => ({
          date,
          version: calendar.get(date)?.version || 0,
        })),
      }),
    );
  }
  function addMatrixDate() {
    const month = day.slice(0, 7),
      calendar = new Map(data.calendar.map((c) => [c.date, c]));
    form("添加日期", input("date", "本月日期", day, "date"), (v) =>
      post("add-dates", {
        month,
        dates: [{ date: v.date, version: calendar.get(v.date)?.version || 0 }],
      }),
    );
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
  function addMatrixStudent() {
    const month = day.slice(0, 7);
    const host = root,
      owner = auth.user?.id;
    const modal = form(
      "添加学生",
      select(
        "student_id",
        "托管档案",
        [
          ["new", "新建托管学生"],
          ...data.students.map((s) => [s.id, studentLabel(s)]),
        ],
        "new",
      ) +
        input("name", "新学生姓名") +
        select("grade", "年级", grades, grade || grades[0]) +
        input("start_date", "入托日期", day, "date"),
      async (v) => {
        if (!v.start_date.startsWith(month + "-"))
          throw Error("请选择当前月份的入托日期");
        if (v.student_id === "new") {
          if (data.students.some((s) => s.name.trim() === v.name.trim()))
            throw Error(
              "已有同名档案，请先选择已有学生；确为不同学生可在托管学生中单独建档并填写辨认备注",
            );
          await post("student", {
            name: v.name,
            grade: v.grade,
            start_date: v.start_date,
          });
        } else {
          const next = data.periods
            .filter(
              (p) =>
                p.student_id === Number(v.student_id) &&
                p.start_date > v.start_date,
            )
            .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
          await post("period", {
            student_id: Number(v.student_id),
            grade: v.grade,
            start_date: v.start_date,
            end_date: next
              ? new Date(Date.parse(next.start_date + "T00:00:00Z") - 86400000)
                  .toISOString()
                  .slice(0, 10)
              : null,
            status: "在托",
          });
        }
        if (host === root && owner === auth.user?.id && day.startsWith(month)) {
          query = "";
          grade = "";
        }
      },
    );
    const pick = modal.element.querySelector("[name=student_id]");
    pick.addEventListener("change", () => {
      const isNew = pick.value === "new";
      modal.element.querySelector("[name=name]").closest("label").hidden =
        !isNew;
      if (!isNew) {
        const student = data.students.find((s) => s.id === Number(pick.value));
        const gradeInput = modal.element.querySelector("[name=grade]");
        gradeInput.value = student.grade;
        syncCustomSelect(gradeInput, gradeInput.nextElementSibling);
      }
    });
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
    const cellContent = (record, editable) => {
      const label = record
        ? record.status === "停课"
          ? "放假"
          : record.status === "未登记"
            ? "原始空白/异常"
            : record.status
        : editable
          ? "出勤"
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
        ? '<button class="btn" id="tg-add-student">添加学生</button><button class="btn" id="tg-remove-students">删除学生</button><button class="btn" id="tg-add-date">添加日期</button><button class="btn" id="tg-remove-dates">删除日期</button>'
        : "") +
      "</div>" +
      listTable(
        [
          "学生",
          "年级",
          ...dates.map((d) =>
            finance
              ? `<button class="tg-date-header" data-remove-date="${d}" aria-label="删除${d}托管日期" ${isReadonlyUser() ? "disabled" : ""}>${d.slice(5)}</button>`
              : d.slice(5),
          ),
        ],
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
                      cellContent(record, true) +
                      "</button>"
                    : cellContent(record, false)) +
                  "</td>"
                );
              })
              .join("") +
            "</tr>",
        ),
      );
    body
      .querySelectorAll("[data-remove-date]")
      .forEach(
        (b) => (b.onclick = () => deleteMatrixDate(b.dataset.removeDate)),
      );
    const matrix = body.querySelector(".tg-table");
    matrix.classList.add("tg-matrix");
    matrix.dataset.frozenColumns = "3";
    matrix.dataset.uniformFrom = "3";
    body
      .querySelector("#tg-remove-students")
      ?.addEventListener("click", () => removeMatrixStudents(monthStudents));
    body
      .querySelector("#tg-add-date")
      ?.addEventListener("click", () => addMatrixDate());
    body
      .querySelector("#tg-remove-dates")
      ?.addEventListener("click", () => removeMatrixDates(dates));
    body
      .querySelector("#tg-add-student")
      ?.addEventListener("click", addMatrixStudent);
    for (const button of body.querySelectorAll(".tg-cell-button"))
      button.onclick = (event) => {
        if (button.disabled || event.target.closest(".custom-select")) return;
        const id = Number(button.dataset.student),
          date = button.dataset.date,
          key = id + ":" + date;
        const old = attendance.get(key),
          shown = old?.status === "停课" ? "放假" : old?.status || "出勤";
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
                  if (record) attendance.set(key, record);
                  else attendance.delete(key);
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
              button.innerHTML = cellContent(attendance.get(key), true);
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
      .sort(compareStudentGradeName);
    body.innerHTML =
      '<div class="tg-actions"><button class="btn primary" id="tg-new">新建托管学生</button></div>' +
      listTable(
        ["学生", "年级", "托管首日", "最近托管"],
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
            s.first_attendance_date || "—",
            s.last_attendance_date || "—",
          ]);
        }),
      );
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
  function renderLedger(body) {
    const rows = data.ledger.filter(
      (l) =>
        (!ledgerKind || l.kind === ledgerKind) &&
        (!rangeStart || l.date >= rangeStart) &&
        (!rangeEnd || l.date <= rangeEnd) &&
        matches(
          { name: studentName(l.student_id) },
          period(l.student_id, l.date) ||
            data.students.find((s) => s.id === l.student_id),
        ),
    );
    body.innerHTML =
      '<div class="tg-actions"><button class="btn primary" id="tg-money">新增资金记录</button></div>' +
      listTable(
        [
          "日期",
          "学生",
          "类型",
          "实际金额",
          "赠送金额",
          "方式",
          "经办人",
          "凭证",
          "备注",
        ],
        rows.map((l) =>
          tr([
            l.date,
            studentBadge(l.student_id, period(l.student_id, l.date)?.grade),
            esc(l.kind),
            money(l.actual_amount),
            money(l.gift_amount),
            esc(l.method),
            esc(l.actor),
            esc(l.voucher),
            esc(l.notes) + (l.legacy_unallocated ? "（旧账归属待核对）" : ""),
          ]),
        ),
      );
    root.querySelector("#tg-money").onclick = () =>
      form(
        "托管资金记录",
        studentSelect() +
          input("date", "业务日期", day, "date") +
          select("kind", "类型", ["充值", "退款", "优惠", "调整", "期初核定"]) +
          input("actual_amount", "实际金额（元）", "0", "number") +
          input("gift_amount", "赠送金额（元）", "0", "number") +
          input("method", "支付方式") +
          input("voucher", "凭证 / 单号") +
          input("notes", "原因及核对依据（必填）"),
        (v) =>
          post("money", {
            ...v,
            student_id: Number(v.student_id),
            actual_amount: toCents(v.actual_amount),
            gift_amount: toCents(v.gift_amount),
          }),
      );
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
  function deleteMatrixDate(date) {
    const month = day.slice(0, 7),
      host = root,
      owner = auth.user?.id,
      version = data.calendar.find((c) => c.date === date)?.version || 0;
    const [y, m, d] = date.split("-").map(Number);
    const dialog = CourseDetails.dialog(
      "删除托管日期",
      '<div class="tg-detail-content"><p>确定删除' +
        y +
        "年" +
        m +
        "月" +
        d +
        '日的托管日期吗？</p><p role="alert"></p><div class="modal-actions"><button class="btn" data-date-cancel>取消</button><button class="btn primary" data-date-confirm>确认删除</button></div></div>',
      { size: "compact" },
    );
    dialog.element.querySelector("[data-date-cancel]").onclick = dialog.close;
    const button = dialog.element.querySelector("[data-date-confirm]");
    button.onclick = async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        if (
          host !== root ||
          owner !== auth.user?.id ||
          month !== day.slice(0, 7)
        )
          throw Error("页面已变化，请重新选择");
        await post("remove-dates", { month, dates: [{ date, version }] });
        dialog.close();
        if (host === root && month === day.slice(0, 7)) await refresh();
      } catch (e) {
        dialog.element.querySelector("[role=alert]").textContent = e.message;
      } finally {
        button.disabled = false;
      }
    };
  }
  function draw() {
    if (!root?.isConnected) return;
    const focus = document.activeElement,
      focusId = root.contains(focus) ? focus.id : "",
      caret = focusId === "tg-query" ? focus.selectionStart : null;
    root.innerHTML =
      '<section class="tg-panel">' +
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
      rangeStart = root.querySelector("#tg-start")?.value || "";
      rangeEnd = root.querySelector("#tg-end")?.value || "";
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
    for (const id of ["tg-kind", "tg-start", "tg-end"])
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
      query = grade = ledgerKind = rangeStart = rangeEnd = "";
      draw();
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
          "#tg-add-student,#tg-remove-students,#tg-add-date,#tg-remove-dates,#tg-copy,#tg-paste,.tg-cell-button,#tg-new,#tg-money,#tg-rule",
        )
        .forEach((e) => {
          e.disabled = true;
          e.title = "当前账号只读";
        });
    enhanceCustomSelects();
    enhanceCustomDateInputs();
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
  return { mount };
})();
