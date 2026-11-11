/* Integrated native UI; all financial amounts sent as integer cents. */
window.TuoguanUI = (() => {
  const statuses = ["未登记", "出勤", "请假", "缺勤", "停课", "不适用"];
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
  const money = (n) => (Number(n || 0) / 100).toFixed(2);
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
    cls = "",
    status = "",
    matrix = false,
    finance = false,
    epoch = 0;
  let periodStatus = "",
    ledgerKind = "",
    rangeStart = "",
    rangeEnd = "",
    busy = false,
    account = null;
  const drafts = new Map(),
    selections = new Set(),
    filters = new Map();
  window.addEventListener("beforeunload", (event) => {
    if (drafts.size && account === auth.user?.id) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  const draftKey = (id) => day + ":" + id;
  const badge = (value) => statusBadge(value);
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
    const daily = tab === "签到" && !matrix,
      settings = ["设置", "导入核对"].includes(tab);
    const monthEnd = new Date(
      Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0),
    )
      .toISOString()
      .slice(0, 10);
    const dateControl = daily
      ? '<div class="tg-date-nav"><button class="btn" data-shift="-1" aria-label="上一天">‹</button><input class="control" aria-label="托管日期" id="tg-day" type="date" value="' +
        day +
        '"><button class="btn" data-shift="1" aria-label="下一天">›</button><button class="btn" id="tg-today">今天</button></div>'
      : tab === "学生"
        ? ""
        : field(
            "月份",
            '<input class="control" aria-label="月份" id="tg-month" type="month" value="' +
              day.slice(0, 7) +
              '">',
          );
    if (settings)
      return (
        '<div class="filter-bar compact tg-filters"><div class="filter-controls">' +
        dateControl +
        "</div></div>"
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
          opt(
            [
              ["", "全部年级"],
              ...new Set(
                [...data.periods, ...data.students].map((p) => p.grade),
              ),
            ],
            grade,
          ) +
          "</select>",
      ) +
      field(
        "班级",
        '<select class="control" id="tg-class">' +
          opt(
            [
              ["", "全部班级"],
              ...new Set(
                [...data.periods, ...data.students].map((p) => p.class_name),
              ),
            ],
            cls,
          ) +
          "</select>",
      ) +
      (daily
        ? field(
            "考勤",
            '<select class="control" id="tg-status">' +
              opt([["", "全部状态"], ...statuses], status) +
              "</select>",
          )
        : "") +
      (tab === "学生"
        ? field(
            "周期状态",
            '<select class="control" id="tg-period-status">' +
              opt(
                [
                  ["", "全部周期"],
                  ["当前在托", "当前在托"],
                  ["暂停", "暂停"],
                  ["退托", "退托"],
                  ["历史周期", "历史周期"],
                  ["待入托", "待入托"],
                  ["未入托", "未入托"],
                ],
                periodStatus,
              ) +
              "</select>",
          )
        : "") +
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
      '</div><div class="filter-summary"><button class="btn" id="tg-search">查询</button><button class="btn" id="tg-reset">清空筛选</button></div></div>'
    );
  }
  function periodLabel(p) {
    return p.end_date && p.end_date < today()
      ? p.status === "在托"
        ? "历史周期"
        : p.status
      : p.start_date > today()
        ? "待入托"
        : p.status;
  }
  function rememberDrafts() {
    if (!root) return;
    root.querySelectorAll("tr[data-student]").forEach((tr) => {
      const id = Number(tr.dataset.student),
        old = data.attendance.find(
          (a) => a.student_id === id && a.date === day,
        );
      const value = {
        status: tr.querySelector(".tg-state").value,
        notes: tr.querySelector(".tg-note").value,
        version: drafts.get(draftKey(id))?.version ?? (old?.version || 0),
      };
      if (
        value.status !== (old?.status || "未登记") ||
        value.notes !== (old?.notes || "")
      )
        drafts.set(draftKey(id), value);
      else drafts.delete(draftKey(id));
      if (tr.querySelector(".tg-check").checked) selections.add(draftKey(id));
      else selections.delete(draftKey(id));
      tr.classList.toggle("tg-dirty", drafts.has(draftKey(id)));
    });
    const label = root.querySelector("#tg-dirty");
    const discard = root.querySelector("#tg-discard");
    if (discard)
      discard.hidden = ![...drafts.keys()].some((key) =>
        key.startsWith(day + ":"),
      );
    if (label)
      label.textContent = drafts.size
        ? "有 " + drafts.size + " 条未保存更改（切换页面保留）"
        : "";
  }
  function studentDetail(id) {
    const summary = data.summary.find((r) => r.id === id);
    CourseDetails.dialog(
      studentName(id) + " (#" + id + ") · 托管详情",
      '<div class="tg-detail-content"><p class="muted">' +
        day.slice(0, 7) +
        " · " +
        (summary
          ? "月末余额 ¥" +
            money(summary.balance) +
            " / 待核对 " +
            summary.pending +
            " 条"
          : "") +
        "</p><h3>托管周期</h3>" +
        table(
          ["年级 / 班级", "起始日期", "最后在托", "状态"],
          data.periods
            .filter((p) => p.student_id === id)
            .map((p) =>
              tr([
                esc(p.grade + " / " + p.class_name),
                p.start_date,
                p.end_date || "—",
                badge(periodLabel(p)),
              ]),
            ),
        ) +
        "<h3>当月考勤</h3>" +
        table(
          ["日期", "状态", "备注"],
          data.attendance
            .filter((a) => a.student_id === id)
            .map((a) =>
              tr([
                a.date,
                badge(a.status) + (a.pending ? " · 待核对" : ""),
                esc(a.notes),
              ]),
            ),
        ) +
        "<h3>当月资金明细</h3>" +
        table(
          ["日期", "类型", "金额（元）", "备注"],
          data.ledger
            .filter((l) => l.student_id === id)
            .map((l) =>
              tr([l.date, esc(l.kind), money(l.amount), esc(l.notes)]),
            ),
        ) +
        "</div>",
    );
  }

  async function api(action, body) {
    const r = await fetch("/api/tuoguan/" + action, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || d.message || "操作失败");
    return d;
  }
  async function refresh() {
    const e = ++epoch;
    const target = root;
    const d = await api("snapshot?month=" + day.slice(0, 7));
    if (e !== epoch || target !== root || !target?.isConnected) return;
    data = d;
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
    s.name + " · " + s.grade + "/" + s.class_name + " (#" + s.id + ")";
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
    return (
      (!query || s.name.includes(query)) &&
      (!grade || p?.grade === grade) &&
      (!cls || p?.class_name === cls)
    );
  }
  const table = (headers, rows) =>
    `<div class="band"><div class="table-wrap smooth-table-wrap tg-scroll"><table class="uniform-table nowrap-table tg-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${headers.length}">${empty("暂无符合条件的记录", "调整筛选条件，或使用页面上的新增入口。")}</td></tr>`}</tbody></table></div></div>`;
  const tr = (values) =>
    `<tr>${values.map((v) => `<td>${v}</td>`).join("")}</tr>`;
  function form(title, fields, save) {
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
        await refresh();
        message("已保存");
      } catch (err) {
        dialog.querySelector("[role=alert]").textContent = err.message;
      } finally {
        button.disabled = false;
        button.textContent = "保存";
      }
    };
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
  function draw() {
    if (!root?.isConnected) return;
    root.innerHTML =
      '<section class="tg-panel">' +
      filtersHtml() +
      '<p id="tg-msg" role="status" aria-live="polite"></p><div id="tg-body"></div></section>';

    const body = root.querySelector("#tg-body");
    if (tab === "签到") {
      const rows = data.students.filter((s) => {
        const p = period(s.id, day);
        return p && matches(s, p);
      });
      const current = (s) =>
        data.attendance.find((a) => a.student_id === s.id && a.date === day);
      const visible = rows.filter(
        (s) => !status || (current(s)?.status || "未登记") === status,
      );
      const scope = visible;
      body.innerHTML =
        (matrix
          ? ""
          : metrics([
              ["应到人数", scope.length],
              [
                "已出勤",
                scope.filter((s) => current(s)?.status === "出勤").length,
              ],
              [
                "已请假",
                scope.filter((s) => current(s)?.status === "请假").length,
              ],
              [
                "缺勤人数",
                scope.filter((s) => current(s)?.status === "缺勤").length,
              ],
              [
                "未登记",
                scope.filter(
                  (s) => !current(s) || current(s).status === "未登记",
                ).length,
              ],
            ])) +
        '<div class="tg-section-note">' +
        (matrix
          ? day.slice(0, 7) + " · 月度考勤"
          : "统计当前日期及全部筛选结果 · 停课 " +
            scope.filter((s) => current(s)?.status === "停课").length +
            " / 不适用 " +
            scope.filter((s) => current(s)?.status === "不适用").length) +
        "</div>" +
        '<div class="tg-actions"><button class="btn" id="tg-matrix">' +
        (matrix ? "返回每日签到" : "月度矩阵") +
        "</button>" +
        (matrix
          ? ""
          : '<div class="tg-batch-actions"><span id="tg-dirty" class="tg-unsaved"></span><button class="btn" id="tg-discard" hidden>放弃当天修改</button><label class="filter-field"><span>批量设置</span><select class="control" id="tg-batch">' +
            opt(statuses, "出勤") +
            '</select></label><button class="btn primary" id="tg-save">保存勾选学生</button></div>') +
        "</div>";

      if (matrix) {
        const dates = data.calendar.map((c) => c.date);
        body.innerHTML += table(
          ["学生", ...dates.map((d) => d.slice(5))],
          data.students
            .filter(
              (s) =>
                data.periods.some(
                  (p) =>
                    p.student_id === s.id &&
                    p.start_date <= day.slice(0, 7) + "-31" &&
                    (!p.end_date || p.end_date >= day.slice(0, 7) + "-01"),
                ) &&
                matches(
                  s,
                  period(s.id, day) ||
                    data.periods.find((p) => p.student_id === s.id),
                ),
            )
            .map((s) =>
              tr([
                esc(s.name),
                ...dates.map((d) =>
                  (() => {
                    const a = data.attendance.find(
                      (a) => a.student_id === s.id && a.date === d,
                    );
                    return (
                      badge(a?.status || (period(s.id, d) ? "未登记" : "—")) +
                      (a?.pending ? '<span class="muted"> 待核对</span>' : "")
                    );
                  })(),
                ),
              ]),
            ),
        );
      } else
        body.innerHTML += table(
          [
            '<input type="checkbox" id="tg-all" aria-label="全选">',
            "学生",
            "年级 / 班级",
            "考勤",
            "备注",
            "操作",
          ],
          visible.map((s) => {
            const a = current(s),
              p = period(s.id, day);
            const draft = drafts.get(draftKey(s.id)) || a;
            return `<tr data-student="${s.id}"><td><input type="checkbox" class="tg-check" aria-label="选择 ${esc(s.name)}" ${selections.has(draftKey(s.id)) ? "checked" : ""}></td><td>${esc(s.name)}</td><td>${esc(p.grade + " / " + p.class_name)}</td><td><select class="control tg-state" aria-label="${esc(s.name)}考勤">${opt(statuses, draft?.status || "未登记")}</select>${a?.pending ? " 待核对" : ""}</td><td><input class="control tg-note" aria-label="${esc(s.name)}备注" value="${esc(draft?.notes || "")}"></td><td><button class="btn tg-one">保存</button></td></tr>`;
          }),
        );
      root.querySelector("#tg-matrix").onclick = () => {
        rememberDrafts();
        matrix = !matrix;
        draw();
      };
      if (root.querySelector("#tg-status"))
        root.querySelector("#tg-status").onchange = (e) => {
          rememberDrafts();
          status = e.target.value;
          draw();
        };
      const saveRows = async (trs, batch) => {
        if (!trs.length) throw Error("请勾选学生");
        rememberDrafts();
        const savedDay = day;
        await post("attendance", {
          date: savedDay,
          rows: trs.map((tr) => {
            const id = Number(tr.dataset.student);
            return {
              student_id: id,
              version:
                drafts.get(draftKey(id))?.version ??
                (current({ id })?.version || 0),
              status: batch || tr.querySelector(".tg-state").value,
              notes: tr.querySelector(".tg-note").value,
            };
          }),
        });
        trs.forEach((tr) => {
          const key = savedDay + ":" + Number(tr.dataset.student);
          drafts.delete(key);
          selections.delete(key);
        });
      };
      root
        .querySelector("#tg-all")
        ?.addEventListener("change", (e) =>
          root
            .querySelectorAll(".tg-check")
            .forEach((c) => (c.checked = e.target.checked)),
        );
      root
        .querySelectorAll(".tg-one")
        .forEach(
          (b) => (b.onclick = () => act(() => saveRows([b.closest("tr")]))),
        );
      root.querySelector("#tg-save")?.addEventListener("click", () =>
        act(() =>
          saveRows(
            [...root.querySelectorAll("tr[data-student]")].filter(
              (t) => t.querySelector(".tg-check").checked,
            ),
            root.querySelector("#tg-batch").value,
          ),
        ),
      );
    } else if (tab === "学生") {
      const studentRows = [
        ...data.periods,
        ...data.students
          .filter((s) => !data.periods.some((p) => p.student_id === s.id))
          .map((s) => ({
            student_id: s.id,
            grade: s.grade,
            class_name: s.class_name,
            start_date: "",
            end_date: "",
            status: "未入托",
          })),
      ];
      const profileForm = (s) =>
        form(
          s ? "编辑托管档案" : "新建托管学生",
          input("name", "姓名", s?.name || "") +
            select(
              "grade",
              "年级",
              [
                ...new Set(
                  [
                    ...(state?.lookups?.grades || [
                      "初一",
                      "初二",
                      "初三",
                      "高一",
                      "高二",
                      "高三",
                    ]),
                    s?.grade,
                  ].filter(Boolean),
                ),
              ],
              s?.grade || "初一",
            ) +
            input("class_name", "班级", s?.class_name || "A班") +
            (s ? "" : input("start_date", "入托日期", day, "date")) +
            input("notes", "备注", s?.notes || ""),
          (v) => post("student", { ...v, id: s?.id, version: s?.version }),
        );
      body.innerHTML =
        '<div class="tg-actions"><span class="muted">独立托管档案；按周期展示，历史记录保留。</span><div class="tg-batch-actions"><button class="btn" id="tg-add">已有学生入托</button><button class="btn primary" id="tg-new">新建托管学生</button></div></div>' +
        table(
          ["学生", "年级", "班级", "入托", "最后在托", "状态", "操作"],
          studentRows
            .filter(
              (p) =>
                matches({ name: studentName(p.student_id) }, p) &&
                (!periodStatus ||
                  (periodStatus === "当前在托"
                    ? p.id &&
                      p.start_date <= today() &&
                      (!p.end_date || p.end_date >= today())
                    : periodLabel(p) === periodStatus)),
            )
            .map((p) =>
              tr([
                esc(studentName(p.student_id)) +
                  ' <span class="muted">#' +
                  p.student_id +
                  "</span>",
                esc(p.grade),
                esc(p.class_name),
                p.start_date || "—",
                p.end_date || "—",
                badge(periodLabel(p)),
                `${p.id ? `<button class="btn tg-edit" data-id="${p.id}">编辑周期</button>` : ""}<button class="btn tg-profile" data-id="${p.student_id}">编辑资料</button><button class="btn tg-detail" data-id="${p.student_id}">明细</button>`,
              ]),
            ),
        );
      if (!data.periods.length)
        body.insertAdjacentHTML(
          "afterbegin",
          '<p class="tg-section-note">可直接新建托管学生；补课档案不参与此列表。</p>',
        );
      const open = (p) =>
        form(
          "托管周期",
          (p
            ? input("student_id", "学生编号", p.student_id, "hidden")
            : studentSelect()) +
            select(
              "grade",
              "年级",
              [
                ...new Set(
                  [
                    ...(state?.lookups?.grades || [
                      "初一",
                      "初二",
                      "初三",
                      "高一",
                      "高二",
                      "高三",
                    ]),
                    ...data.students.map((s) => s.grade),
                    p?.grade,
                  ].filter(Boolean),
                ),
              ],
              p?.grade || "初一",
            ) +
            input(
              "class_name",
              "班级（优先选择已有班级）",
              p?.class_name || "A班",
            ).replace(
              'name="class_name"',
              'list="tg-class-options" name="class_name"',
            ) +
            '<datalist id="tg-class-options">' +
            opt([...new Set(data.periods.map((p) => p.class_name))]) +
            "</datalist>" +
            input("start_date", "入托日期", p?.start_date || day, "date") +
            input(
              "end_date",
              "最后在托日期（含当天）",
              p?.end_date || "",
              "date",
            ) +
            select(
              "status",
              "状态",
              ["在托", "暂停", "退托"],
              p?.status || "在托",
            ) +
            input("notes", "备注", p?.notes || ""),
          (v) =>
            post("period", {
              ...v,
              student_id: Number(v.student_id),
              id: p?.id,
              version: p?.version,
            }),
        );
      root.querySelector("#tg-add").onclick = () => open();
      root.querySelector("#tg-new").onclick = () => profileForm();
      root
        .querySelectorAll(".tg-profile")
        .forEach(
          (b) =>
            (b.onclick = () =>
              profileForm(
                data.students.find((s) => s.id === Number(b.dataset.id)),
              )),
        );
      root
        .querySelectorAll(".tg-edit")
        .forEach(
          (b) =>
            (b.onclick = () =>
              open(data.periods.find((p) => p.id === Number(b.dataset.id)))),
        );
    } else if (tab === "流水") {
      body.innerHTML =
        '<div class="tg-actions"><span class="muted">显示所选月份的资金记录 · 点击学生查看余额与明细</span><button class="btn primary" id="tg-money">新增资金记录</button></div>' +
        table(
          ["日期", "学生", "类型", "金额", "方式", "经办人", "凭证", "备注"],
          data.ledger
            .filter(
              (l) =>
                (!ledgerKind || l.kind === ledgerKind) &&
                (!rangeStart || l.date >= rangeStart) &&
                (!rangeEnd || l.date <= rangeEnd) &&
                matches(
                  { name: studentName(l.student_id) },
                  period(l.student_id, l.date) ||
                    data.students.find((s) => s.id === l.student_id),
                ),
            )
            .map((l) =>
              tr([
                l.date,
                `<button class="btn tg-detail" data-id="${l.student_id}">${esc(studentName(l.student_id))}</button>`,
                l.kind,
                money(l.amount),
                esc(l.method),
                esc(l.actor),
                esc(l.voucher),
                esc(l.notes),
              ]),
            ),
        );
      root.querySelector("#tg-money").onclick = () =>
        form(
          "托管资金记录",
          studentSelect() +
            input("date", "业务日期", day, "date") +
            select("kind", "类型", [
              "充值",
              "退款",
              "优惠",
              "调整",
              "期初核定",
            ]) +
            input("amount", "金额（元）", "", "number") +
            input("method", "支付方式") +
            input("voucher", "凭证 / 单号") +
            input("notes", "原因及核对依据（必填）"),
          (v) =>
            post("money", {
              ...v,
              student_id: Number(v.student_id),
              amount: toCents(v.amount),
            }),
        );
    } else if (tab === "汇总") {
      const rows = data.summary.filter((s) =>
        matches(
          s,
          period(s.id, day) ||
            data.periods.find((p) => p.student_id === s.id) ||
            s,
        ),
      );
      body.innerHTML =
        metrics([
          [
            "本月已入账托管费",
            "¥" + money(rows.reduce((a, s) => a + s.fee, 0)),
          ],
          ["本月充值", "¥" + money(rows.reduce((a, s) => a + s.recharge, 0))],
          [
            "月末预存",
            "¥" + money(rows.reduce((a, s) => a + Math.max(s.balance, 0), 0)),
          ],
          [
            "月末欠费",
            "¥" + money(rows.reduce((a, s) => a + Math.max(-s.balance, 0), 0)),
          ],
        ]) +
        '<div class="tg-actions"><span class="muted">' +
        day.slice(0, 7) +
        " · 当前筛选 " +
        rows.length +
        ' 名学生 · 账面金额不含未核定期初与待核对费用</span><button class="btn" id="tg-export">导出 CSV</button></div>' +
        table(
          [
            "学生",
            "上月结转",
            "充值",
            "退款",
            "优惠/调整/期初",
            "已入账托管费",
            "账面月末余额",
            "未登记",
            "待核对",
            "待核对参考费",
          ],
          rows.map((s) =>
            tr([
              esc(s.name),
              ...["opening", "recharge", "refund", "adjustment", "fee"].map(
                (k) => money(s[k]),
              ),
              `<span class="${s.balance < 0 ? "tg-negative" : ""}">${money(s.balance)}</span>`,
              s.unregistered,
              s.pending,
              money(s.reference_pending),
            ]),
          ),
        );
      root.querySelector("#tg-export").onclick = () => {
        const keys = [
          "name",
          "opening",
          "recharge",
          "refund",
          "adjustment",
          "fee",
          "balance",
          "unregistered",
          "pending",
          "reference_pending",
        ];
        const csv =
          "\ufeff" +
          [
            "学生,上月结转(元),充值(元),退款(元),调整(元),已入账托管费(元),账面余额(元),未登记,待核对,待核对参考费(元)",
            ...rows.map((s) =>
              keys
                .map(
                  (k) =>
                    '"' +
                    String(
                      typeof s[k] === "number" &&
                        !["unregistered", "pending"].includes(k)
                        ? money(s[k])
                        : s[k],
                    )
                      .replace(/^[=+@-]/, "'")
                      .replace(/"/g, '""') +
                    '"',
                )
                .join(","),
            ),
          ].join("\r\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        a.download = "托管汇总-" + day.slice(0, 7) + ".csv";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };
    } else if (tab === "设置") {
      body.innerHTML =
        '<section class="tg-settings-section"><div class="tg-actions"><div><h3>收费规则</h3><p class="muted">按生效日期新增，历史考勤沿用原规则。</p></div><button class="btn primary" id="tg-rule">新增收费标准</button></div>' +
        table(
          [
            "生效日期",
            "截止日期",
            "状态",
            "适用学生",
            "出勤",
            "请假",
            "缺勤",
            "说明",
          ],
          data.rules.map((r) =>
            tr([
              r.effective_date,
              r.end_date || "长期",
              r.pending ? "待核对" : "已确定",
              r.student_id ? esc(studentName(r.student_id)) : "所有学生",
              money(r.present),
              money(r.leave_fee),
              money(r.absent),
              esc(r.notes),
            ]),
          ),
        ) +
        '</section><section class="tg-settings-section"><div class="tg-actions"><h3>托管日期与值班安排</h3><div class="tg-date-nav"><input class="control" aria-label="维护日期" id="tg-day" type="date" value="' +
        day +
        '"><button class="btn" id="tg-calendar">维护所选日期</button></div></div>' +
        table(
          ["托管日期", "启用", "值班教师", "时段", "请假截止"],
          data.calendar.map((c) =>
            tr([
              c.date,
              c.enabled ? "是" : "否",
              esc(
                data.teachers.find((t) => t.id === c.teacher_id)?.name || "—",
              ),
              esc(c.time_slot),
              esc(c.leave_deadline),
            ]),
          ),
        ) +
        "</section>";
      body.insertAdjacentHTML(
        "beforeend",
        '<section class="band tg-import-entry"><h3>历史导入与核对</h3><p class="muted">先预览、再确认身份与资金。9月缺勤规则、10月3格数字考勤与100元差异仍待核对。</p><button class="btn" data-tab="导入核对">打开导入核对</button></section>',
      );
      root.querySelector("#tg-rule").onclick = () =>
        form(
          "新增收费标准",
          select("student_id", "适用学生", [
            [0, "所有学生"],
            ...data.students.map((s) => [s.id, studentLabel(s)]),
          ]) +
            input("effective_date", "生效日期", day, "date") +
            input("present", "出勤（元）", 50, "number") +
            input("leave_fee", "请假（元）", 25, "number") +
            input("absent", "缺勤（元）", 50, "number") +
            input("notes", "说明"),
          (v) =>
            post("rule", {
              ...v,
              student_id: Number(v.student_id),
              present: toCents(v.present),
              leave_fee: toCents(v.leave_fee),
              absent: toCents(v.absent),
            }),
        );
      root.querySelector("#tg-calendar").onclick = () => {
        const c = data.calendar.find((c) => c.date === day);
        form(
          "托管日历 " + day,
          select(
            "enabled",
            "启用",
            [
              [1, "启用"],
              [0, "停用"],
            ],
            c?.enabled ?? 1,
          ) +
            select(
              "teacher_id",
              "值班教师",
              [[0, "未安排"], ...data.teachers.map((t) => [t.id, t.name])],
              c?.teacher_id || 0,
            ) +
            input("time_slot", "时段", c?.time_slot || "18:30—21:30") +
            input(
              "leave_deadline",
              "请假截止",
              c?.leave_deadline || "17:30",
              "time",
            ) +
            input("notes", "备注", c?.notes || ""),
          (v) =>
            post("calendar", {
              ...v,
              date: day,
              enabled: Number(v.enabled),
              teacher_id: Number(v.teacher_id),
              version: c?.version || 0,
            }),
        );
      };
    } else if (tab === "导入核对") {
      body.innerHTML =
        '<button class="btn" data-tab="设置">返回托管设置</button><p>选择原始工作簿先预览。识别独立托管学生后导入历史考勤；同名冲突暂留待确认，不影响其他学生。历史费用与期初余额保持待核对，不产生充值或扣费。</p><input id="tg-file" type="file" accept=".xlsx"><div id="tg-preview"></div>' +
        table(
          ["批次月份", "状态", "操作"],
          data.imports.map((i) => {
            const p = JSON.parse(i.payload);
            return tr([
              esc(p.month),
              i.result
                ? `已导入 ${JSON.parse(i.result).success} 条 / 身份待确认 ${JSON.parse(i.result).pending || 0} / 冲突 ${JSON.parse(i.result).conflicts?.length || 0} / 资金待核对`
                : "待确认",
              `<button class="btn tg-preview" data-id="${i.id}">核对</button>`,
            ]);
          }),
        );
      const show = (p) => {
        const box = root.querySelector("#tg-preview");
        if (!box) return;
        box.innerHTML =
          `<h3>${p.month} 导入预览</h3><p>${p.students.length} 人 / ${p.dates.length} 天 / 考勤 ${p.records.length} 条；计算 ¥${money(p.calculated)} / 参考 ¥${money(p.reference)} / 差异 ¥${money(p.difference)}</p><p>${Object.entries(
            p.counts,
          )
            .map(([s, n]) => esc(s) + ": " + n)
            .join(
              " · ",
            )}</p><ul>${p.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` +
          table(
            [
              "来源姓名",
              "来源年级/班级",
              "期初待核对",
              "匹配托管档案",
              "处理结果",
            ],
            p.students.map((s) =>
              tr([
                esc(s.name),
                esc(s.grade + "/" + s.class_name),
                money(s.opening_pending),
                `<select data-source="${s.source_key}">${opt([["auto", "自动识别；不确定则保留"], ["", "暂不导入"], ["new", "新建独立托管档案"], ...data.students.map((s) => [s.id, studentLabel(s)])], data.import_sources?.find((x) => x.import_id === p.id && x.source_key === s.source_key)?.student_id || "auto")}</select>`,
                esc(
                  (data.import_sources?.find(
                    (x) =>
                      x.import_id === p.id && x.source_key === s.source_key,
                  )?.status || "待导入") +
                    " · " +
                    (data.import_sources?.find(
                      (x) =>
                        x.import_id === p.id && x.source_key === s.source_key,
                    )?.basis ||
                      p.suggestions?.[s.source_key]?.basis ||
                      "由姓名、年级、班级及来源共同识别"),
                ),
              ]),
            ),
          ) +
          '<button class="btn primary" id="tg-import">导入可确认档案与考勤</button>';
        box.querySelector("#tg-import").onclick = () =>
          act(async () => {
            const mapping = Object.fromEntries(
              [...box.querySelectorAll("[data-source]")].map((e) => [
                e.dataset.source,
                e.value,
              ]),
            );
            await post("import", { id: p.id, mapping, partial: true });
          });
        if (isReadonlyUser())
          box
            .querySelectorAll("button,select")
            .forEach((e) => (e.disabled = true));
        enhanceCustomSelects();
      };
      root.querySelector("#tg-file").onchange = async (e) => {
        try {
          const f = e.target.files[0];
          if (!f) return;
          if (f.size > 12000000) throw Error("文件超过12MB");
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              show(
                await api("preview", {
                  base64: String(reader.result).split(",")[1],
                }),
              );
            } catch (e) {
              message(e.message);
            }
          };
          reader.readAsDataURL(f);
        } catch (e) {
          message(e.message);
        }
      };
      root
        .querySelectorAll(".tg-preview")
        .forEach(
          (b) =>
            (b.onclick = () =>
              show(
                JSON.parse(
                  data.imports.find((i) => i.id === b.dataset.id).payload,
                ),
              )),
        );
    }
    if (finance && tab === "导入核对") {
      body.insertAdjacentHTML(
        "beforeend",
        "<h3>当月待核对考勤</h3>" +
          table(
            [
              "学生",
              "日期",
              "考勤",
              "来源单元格",
              "原值",
              "参考费（待核对）",
              "操作",
            ],
            data.attendance
              .filter((a) => a.pending)
              .map((a) =>
                tr([
                  esc(studentName(a.student_id)),
                  a.date,
                  a.status,
                  esc(a.source_cell || "—"),
                  esc(a.raw_status == null ? "未留存" : a.raw_status || "空白"),
                  money(a.reference_fee),
                  `<button class="btn tg-resolve" data-id="${a.id}">核对并入账</button>`,
                ]),
              ),
          ),
      );
      root.querySelectorAll(".tg-resolve").forEach(
        (button) =>
          (button.onclick = () => {
            const a = data.attendance.find(
                (a) => a.id === Number(button.dataset.id),
              ),
              r = JSON.parse(a.rule_json);
            form(
              "核对 " + studentName(a.student_id) + " " + a.date,
              select("status", "确认考勤", statuses, a.status) +
                input("present", "出勤（元）", money(r.present), "number") +
                input("leave_fee", "请假（元）", money(r.leave_fee), "number") +
                input(
                  "absent",
                  "缺勤（元）：9月需确认",
                  money(r.absent),
                  "number",
                ) +
                input("notes", "核对依据（必填）"),
              (v) =>
                post("resolve", {
                  ...v,
                  id: a.id,
                  version: a.version,
                  present: toCents(v.present),
                  leave_fee: toCents(v.leave_fee),
                  absent: toCents(v.absent),
                }),
            );
          }),
      );
    }
    if (finance && tab === "流水")
      body.insertAdjacentHTML(
        "beforeend",
        "<details><summary>最近操作记录</summary>" +
          table(
            ["时间", "操作", "经办人"],
            data.audit.map((a) =>
              tr([esc(a.created_at), esc(a.action), esc(a.actor)]),
            ),
          ) +
          "</details>",
      );
    root.querySelectorAll("[data-tab]").forEach(
      (b) =>
        (b.onclick = () => {
          tab = b.dataset.tab;
          draw();
        }),
    );
    const changeDay = async (value) => {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
      ) {
        message("请输入有效日期");
        return;
      }
      rememberDrafts();
      day = value;
      rangeStart = "";
      rangeEnd = "";
      const target = root,
        page = tab;
      target.innerHTML =
        '<div class="band"><div class="loading" role="status">正在加载托管数据…</div></div>';
      try {
        await refresh();
      } catch (e) {
        loadError(target, page, e);
      }
    };
    root
      .querySelector("#tg-day")
      ?.addEventListener("change", (e) => changeDay(e.target.value));
    root
      .querySelector("#tg-month")
      ?.addEventListener("change", (e) => changeDay(e.target.value + "-01"));
    root.querySelectorAll("[data-shift]").forEach(
      (b) =>
        (b.onclick = () => {
          const d = new Date(day + "T00:00:00Z");
          d.setUTCDate(d.getUTCDate() + Number(b.dataset.shift));
          changeDay(d.toISOString().slice(0, 10));
        }),
    );
    root
      .querySelector("#tg-today")
      ?.addEventListener("click", () => changeDay(today()));
    const search = () => {
      rememberDrafts();
      query = root.querySelector("#tg-query").value.trim();
      grade = root.querySelector("#tg-grade").value;
      cls = root.querySelector("#tg-class").value;
      periodStatus =
        root.querySelector("#tg-period-status")?.value ?? periodStatus;
      ledgerKind = root.querySelector("#tg-kind")?.value || "";
      rangeStart = root.querySelector("#tg-start")?.value || "";
      rangeEnd = root.querySelector("#tg-end")?.value || "";
      if (rangeStart && rangeEnd && rangeStart > rangeEnd) {
        message("起始日期不能晚于截止日期");
        return;
      }
      draw();
    };
    root.querySelector("#tg-search")?.addEventListener("click", search);
    root.querySelector("#tg-discard")?.addEventListener("click", () => {
      for (const key of drafts.keys())
        if (key.startsWith(day + ":")) drafts.delete(key);
      refresh().catch((error) => message(error.message));
    });
    root.querySelector("#tg-query")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") search();
    });
    root.querySelector("#tg-reset")?.addEventListener("click", () => {
      rememberDrafts();
      query =
        grade =
        cls =
        status =
        periodStatus =
        ledgerKind =
        rangeStart =
        rangeEnd =
          "";
      draw();
    });
    root
      .querySelectorAll(".tg-state,.tg-note,.tg-check,#tg-all")
      .forEach((e) => {
        e.addEventListener("input", rememberDrafts);
        e.addEventListener("change", rememberDrafts);
      });
    root.querySelectorAll("[data-go]").forEach(
      (b) =>
        (b.onclick = () => {
          setActiveView(b.dataset.go);
          load({ refreshGlobal: false });
        }),
    );
    root
      .querySelectorAll(".tg-detail")
      .forEach((b) => (b.onclick = () => studentDetail(Number(b.dataset.id))));
    root
      .querySelectorAll("input:not([type=checkbox]),select")
      .forEach((e) => e.classList.add("control"));
    root.querySelectorAll(".tg-table").forEach((t) => {
      const heads = [...t.querySelectorAll("th")];
      heads.forEach((th, i) => {
        if (
          /金额|余额|结转|充值|退款|托管费|优惠|出勤|请假|缺勤/.test(
            th.textContent,
          ) &&
          !["考勤", "状态"].some((x) => th.textContent.includes(x))
        )
          t.querySelectorAll("tr").forEach((row) =>
            row.children[i]?.classList.add("tg-number"),
          );
      });
    });
    if (tab === "签到") {
      if (matrix) root.querySelector(".tg-table")?.classList.add("tg-matrix");
      const dailyRows = [...root.querySelectorAll("tr[data-student]")];
      if (!matrix && !dailyRows.length) {
        const hasPeriod = data.students.some((s) => period(s.id, day));
        const box = root.querySelector(".band");
        if (box)
          box.innerHTML = empty(
            !data.periods.length
              ? "学生尚未入托"
              : hasPeriod
                ? "当前筛选没有结果"
                : "当前日期没有在托学生",
            hasPeriod
              ? "调整姓名、年级、班级或考勤状态后重试。"
              : "请核对托管周期，或选择其他日期。",
          );
        root.querySelectorAll("[data-go]").forEach(
          (b) =>
            (b.onclick = () => {
              setActiveView(b.dataset.go);
              load({ refreshGlobal: false });
            }),
        );
      }
      dailyRows.forEach((tr) =>
        tr.classList.toggle(
          "tg-dirty",
          drafts.has(draftKey(Number(tr.dataset.student))),
        ),
      );
      const dirtyLabel = root.querySelector("#tg-dirty");
      const discard = root.querySelector("#tg-discard");
      if (discard)
        discard.hidden = ![...drafts.keys()].some((key) =>
          key.startsWith(day + ":"),
        );
      if (dirtyLabel)
        dirtyLabel.textContent = drafts.size
          ? "有 " + drafts.size + " 条未保存更改（切换页面保留）"
          : "";
    }
    if (typeof isReadonlyUser === "function" && isReadonlyUser())
      root
        .querySelectorAll(
          "#tg-save,.tg-one,#tg-add,#tg-new,.tg-profile,.tg-edit,#tg-money,#tg-rule,#tg-calendar,#tg-file,#tg-import,.tg-resolve,.tg-state,.tg-note,.tg-check,#tg-all",
        )
        .forEach((e) => {
          e.disabled = true;
          e.title = "当前账号只读";
        });
    enhanceCustomSelects();
    enhanceCustomDateInputs();
  }
  function message(s) {
    const m = root.querySelector("#tg-msg");
    if (m) m.textContent = s;
  }
  async function act(fn) {
    if (busy) return;
    busy = true;
    const target = root;
    const controls = [...root.querySelectorAll("button,input,select")].map(
      (element) => ({ element, disabled: element.disabled }),
    );
    controls.forEach(({ element }) => (element.disabled = true));
    try {
      await fn();
      if (target !== root || !target.isConnected) return;
      await refresh();
      if (target === root && target.isConnected) message("已保存");
    } catch (e) {
      if (target === root && target.isConnected) message(e.message);
    } finally {
      busy = false;
      controls.forEach(
        ({ element, disabled }) => (element.disabled = disabled),
      );
    }
  }
  async function mount(el, page) {
    const sameAccount = account === auth.user?.id;
    if (!sameAccount) {
      filters.clear();
      drafts.clear();
      selections.clear();
      pendingRequests.clear();
      account = auth.user?.id;
      query =
        grade =
        cls =
        status =
        periodStatus =
        ledgerKind =
        rangeStart =
        rangeEnd =
          "";
      day = today();
      matrix = false;
    }
    if (sameAccount && root?.isConnected) rememberDrafts();
    filters.set(tab, {
      query,
      grade,
      cls,
      status,
      periodStatus,
      ledgerKind,
      rangeStart,
      rangeEnd,
    });
    const saved = filters.get(page) || {};
    query = saved.query || "";
    grade = saved.grade || "";
    cls = saved.cls || "";
    status = saved.status || "";
    periodStatus = saved.periodStatus || "";
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
