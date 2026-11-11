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
    const d = await api("snapshot?month=" + day.slice(0, 7));
    if (e !== epoch) return;
    data = d;
    draw();
  }
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
      (!grade || p.grade === grade) &&
      (!cls || p.class_name === cls)
    );
  }
  const table = (headers, rows) =>
    `<div class="table-wrap tg-scroll"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${headers.length}">暂无记录</td></tr>`}</tbody></table></div>`;
  const tr = (values) =>
    `<tr>${values.map((v) => `<td>${v}</td>`).join("")}</tr>`;
  function form(title, fields, save) {
    const dialog = document.createElement("dialog");
    dialog.className = "tg-dialog";
    dialog.innerHTML = `<form><h3>${esc(title)}</h3>${fields}<div class="toolbar"><button class="btn primary" type="submit">保存</button><button class="btn" type="button" data-cancel>取消</button></div><p role="alert"></p></form>`;
    root.append(dialog);
    dialog.showModal();
    dialog.querySelector("[data-cancel]").onclick = () => dialog.remove();
    dialog.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const button = dialog.querySelector("[type=submit]");
      button.disabled = true;
      try {
        await save(Object.fromEntries(new FormData(e.target)));
        dialog.remove();
        await refresh();
      } catch (err) {
        dialog.querySelector("[role=alert]").textContent = err.message;
      } finally {
        button.disabled = false;
      }
    };
  }
  const input = (name, label, value = "", type = "text") =>
    `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${type === "number" ? 'step="0.01"' : ""}></label>`;
  const select = (name, label, values, value) =>
    `<label>${esc(label)}<select name="${name}">${opt(values, value)}</select></label>`;
  const studentSelect = () =>
    select(
      "student_id",
      "统一学生档案",
      data.students.map((s) => [s.id, s.name]),
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
    root.innerHTML = `<section class="panel tg-panel"><h2>托管管理</h2><div class="toolbar">${(finance ? ["签到", "学生", "流水", "汇总", "设置", "导入核对"] : ["签到"]).map((t) => `<button class="btn ${t === tab ? "primary" : ""}" data-tab="${t}">${t}</button>`).join("")}</div><div class="toolbar"><button class="btn" data-shift="-1">上一天</button><input aria-label="托管日期" id="tg-day" type="date" value="${day}"><button class="btn" data-shift="1">下一天</button><button class="btn" id="tg-today">今天</button><input aria-label="月份" id="tg-month" type="month" value="${day.slice(0, 7)}"><input id="tg-query" placeholder="学生姓名" value="${esc(query)}"><select id="tg-grade" aria-label="年级">${opt([["", "全部年级"], ...new Set(data.periods.map((p) => p.grade))], grade)}</select><select id="tg-class" aria-label="班级">${opt([["", "全部班级"], ...new Set(data.periods.map((p) => p.class_name))], cls)}</select><button class="btn" id="tg-search">查询</button></div><p id="tg-msg" role="status"></p><div id="tg-body"></div></section>`;
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
      body.innerHTML = `<p>应到 ${rows.length} 人 · ${statuses.map((st) => `${st} ${rows.filter((s) => (current(s)?.status || "未登记") === st).length}`).join(" · ")}</p><p>未登记不扣费。历史待核对考勤不计入已结算费用。</p><div class="toolbar"><select id="tg-status">${opt([["", "全部状态"], ...statuses], status)}</select><button class="btn" id="tg-matrix">${matrix ? "每日签到" : "月度矩阵"}</button>${!matrix ? `<select id="tg-batch">${opt(statuses, "出勤")}</select><button class="btn primary" id="tg-save">保存勾选学生</button>` : ""}</div>`;
      if (matrix) {
        const dates = data.calendar.map((c) => c.date);
        body.innerHTML += table(
          ["学生", ...dates.map((d) => d.slice(5))],
          data.students
            .filter((s) =>
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
                  esc(
                    data.attendance.find(
                      (a) => a.student_id === s.id && a.date === d,
                    )?.status || (period(s.id, d) ? "未登记" : "—"),
                  ),
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
            return `<tr data-student="${s.id}"><td><input type="checkbox" class="tg-check"></td><td>${esc(s.name)}</td><td>${esc(p.grade + " / " + p.class_name)}</td><td><select class="tg-state">${opt(statuses, a?.status || "未登记")}</select>${a?.pending ? " 待核对" : ""}</td><td><input class="tg-note" value="${esc(a?.notes || "")}"></td><td><button class="btn tg-one">保存</button></td></tr>`;
          }),
        );
      root.querySelector("#tg-matrix").onclick = () => {
        matrix = !matrix;
        draw();
      };
      root.querySelector("#tg-status").onchange = (e) => {
        status = e.target.value;
        draw();
      };
      const saveRows = async (trs, batch) => {
        if (!trs.length) throw Error("请勾选学生");
        await post("attendance", {
          date: day,
          rows: trs.map((tr) => {
            const id = Number(tr.dataset.student);
            return {
              student_id: id,
              version: current({ id })?.version || 0,
              status: batch || tr.querySelector(".tg-state").value,
              notes: tr.querySelector(".tg-note").value,
            };
          }),
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
      body.innerHTML =
        '<p>新学生先在“学生档案”建立身份；暂停或退托填写最后在托日期。恢复或换班时新增不重叠周期。</p><button class="btn primary" id="tg-add">学生入托</button>' +
        table(
          ["学生", "年级", "班级", "入托", "最后在托", "状态", "操作"],
          data.periods
            .filter((p) => matches({ name: studentName(p.student_id) }, p))
            .map((p) =>
              tr([
                esc(studentName(p.student_id)),
                esc(p.grade),
                esc(p.class_name),
                p.start_date,
                p.end_date || "—",
                esc(p.status),
                `<button class="btn tg-edit" data-id="${p.id}">编辑周期</button><button class="btn tg-detail" data-id="${p.student_id}">明细</button>`,
              ]),
            ),
        );
      const open = (p) =>
        form(
          "托管周期",
          (p
            ? input("student_id", "学生编号", p.student_id, "hidden")
            : studentSelect()) +
            input("grade", "年级", p?.grade || "初一") +
            input("class_name", "班级", p?.class_name || "A班") +
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
      root
        .querySelectorAll(".tg-edit")
        .forEach(
          (b) =>
            (b.onclick = () =>
              open(data.periods.find((p) => p.id === Number(b.dataset.id)))),
        );
      root.querySelectorAll(".tg-detail").forEach(
        (b) =>
          (b.onclick = () => {
            query = studentName(Number(b.dataset.id));
            tab = "流水";
            draw();
          }),
      );
    } else if (tab === "流水") {
      body.innerHTML =
        '<button class="btn primary" id="tg-money">新增资金记录</button>' +
        table(
          ["日期", "学生", "类型", "金额", "方式", "经办人", "凭证", "备注"],
          data.ledger
            .filter((l) =>
              matches(
                { name: studentName(l.student_id) },
                period(l.student_id, l.date),
              ),
            )
            .map((l) =>
              tr([
                l.date,
                esc(studentName(l.student_id)),
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
          period(s.id, day) || data.periods.find((p) => p.student_id === s.id),
        ),
      );
      body.innerHTML =
        `<p>托管费 ¥${money(rows.reduce((a, s) => a + s.fee, 0))} · 实际充值 ¥${money(rows.reduce((a, s) => a + s.recharge, 0))} · 预存 ¥${money(rows.reduce((a, s) => a + Math.max(s.balance, 0), 0))} · 欠费 ¥${money(rows.reduce((a, s) => a + Math.max(-s.balance, 0), 0))}</p><button class="btn" id="tg-export">导出 CSV</button>` +
        table(
          [
            "学生",
            "上月结转",
            "充值",
            "退款",
            "优惠/调整/期初",
            "托管费",
            "月末余额",
            "未登记",
            "待核对",
          ],
          rows.map((s) =>
            tr([
              esc(s.name),
              ...["opening", "recharge", "refund", "adjustment", "fee"].map(
                (k) => money(s[k]),
              ),
              `<span ${s.balance < 0 ? 'style="color:#c0392b"' : ""}>${money(s.balance)}</span>`,
              s.unregistered,
              s.pending,
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
        ];
        const csv =
          "\ufeff" +
          [
            "学生,上月结转(元),充值(元),退款(元),调整(元),托管费(元),余额(元),未登记,待核对",
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
        '<p>收费标准按生效日期追加，已登记考勤保留原规则。周末可手动启用，不自动排除。</p><div class="toolbar"><button class="btn primary" id="tg-rule">新增收费标准</button><button class="btn" id="tg-calendar">维护所选日期 / 值班教师</button></div>' +
        table(
          ["生效日期", "适用学生", "出勤", "请假", "缺勤", "说明"],
          data.rules.map((r) =>
            tr([
              r.effective_date,
              r.student_id ? esc(studentName(r.student_id)) : "所有学生",
              money(r.present),
              money(r.leave_fee),
              money(r.absent),
              esc(r.notes),
            ]),
          ),
        ) +
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
        );
      root.querySelector("#tg-rule").onclick = () =>
        form(
          "新增收费标准",
          select("student_id", "适用学生", [
            [0, "所有学生"],
            ...data.students.map((s) => [s.id, s.name]),
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
        '<p>选择原始工作簿先预览。逐人确认统一学生身份后，仅导入历史考勤。历史费用与期初余额保持待核对，不产生充值或扣费。</p><input id="tg-file" type="file" accept=".xlsx"><div id="tg-preview"></div>' +
        table(
          ["批次月份", "状态", "操作"],
          data.imports.map((i) => {
            const p = JSON.parse(i.payload);
            return tr([
              esc(p.month),
              i.result ? "已导入考勤 / 资金待核对" : "待确认",
              `<button class="btn tg-preview" data-id="${i.id}">核对</button>`,
            ]);
          }),
        );
      const show = (p) => {
        const box = root.querySelector("#tg-preview");
        box.innerHTML =
          `<h3>${p.month} 导入预览</h3><p>${p.students.length} 人 / ${p.dates.length} 天 / 考勤 ${p.records.length} 条；计算 ¥${money(p.calculated)} / 参考 ¥${money(p.reference)} / 差异 ¥${money(p.difference)}</p><p>${Object.entries(
            p.counts,
          )
            .map(([s, n]) => esc(s) + ": " + n)
            .join(
              " · ",
            )}</p><ul>${p.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` +
          table(
            ["来源姓名", "来源年级/班级", "期初待核对", "确认统一档案"],
            p.students.map((s) =>
              tr([
                esc(s.name),
                esc(s.grade + "/" + s.class_name),
                money(s.opening_pending),
                `<select data-source="${s.source_key}">${opt([["", "请选择"], ...data.students.map((s) => [s.id, s.name])])}</select>`,
              ]),
            ),
          ) +
          '<button class="btn primary" id="tg-import">确认身份并导入考勤</button>';
        box.querySelector("#tg-import").onclick = () =>
          act(async () => {
            const mapping = Object.fromEntries(
              [...box.querySelectorAll("[data-source]")].map((e) => [
                e.dataset.source,
                e.value,
              ]),
            );
            await post("import", { id: p.id, mapping });
          });
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
            ["学生", "日期", "考勤", "操作"],
            data.attendance
              .filter((a) => a.pending)
              .map((a) =>
                tr([
                  esc(studentName(a.student_id)),
                  a.date,
                  a.status,
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
    root.querySelector("#tg-day").onchange = (e) => {
      day = e.target.value;
      refresh().catch((e) => message(e.message));
    };
    root.querySelector("#tg-month").onchange = (e) => {
      day = e.target.value + "-01";
      refresh().catch((e) => message(e.message));
    };
    root.querySelectorAll("[data-shift]").forEach(
      (b) =>
        (b.onclick = () => {
          const d = new Date(day + "T00:00:00Z");
          d.setUTCDate(d.getUTCDate() + Number(b.dataset.shift));
          day = d.toISOString().slice(0, 10);
          refresh().catch((e) => message(e.message));
        }),
    );
    root.querySelector("#tg-today").onclick = () => {
      day = today();
      refresh().catch((e) => message(e.message));
    };
    root.querySelector("#tg-search").onclick = () => {
      query = root.querySelector("#tg-query").value.trim();
      grade = root.querySelector("#tg-grade").value;
      cls = root.querySelector("#tg-class").value;
      draw();
    };
    if (typeof isReadonlyUser === "function" && isReadonlyUser())
      root
        .querySelectorAll(
          "#tg-save,.tg-one,#tg-add,.tg-edit,#tg-money,#tg-rule,#tg-calendar,#tg-file,#tg-import,.tg-resolve,.tg-state,.tg-note,.tg-check,#tg-all",
        )
        .forEach((e) => {
          e.disabled = true;
          e.title = "当前账号只读";
        });
  }
  function message(s) {
    const m = root.querySelector("#tg-msg");
    if (m) m.textContent = s;
  }
  async function act(fn) {
    const buttons = [...root.querySelectorAll("button")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      await fn();
      await refresh();
      message("已保存");
    } catch (e) {
      message(e.message);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  }
  async function mount(el, financial) {
    const host = document.createElement("div");
    el.replaceChildren(host);
    root = host;
    finance = financial;
    tab = financial ? "学生" : "签到";
    root.innerHTML = "<p>正在加载托管数据…</p>";
    try {
      await refresh();
    } catch (e) {
      host.textContent = e.message;
    }
  }
  return { mount };
})();
