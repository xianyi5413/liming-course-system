// Only committed domain audit records may describe successful changes.
function describe(db, action, audits) {
  const name = (id) =>
    db.prepare("SELECT name FROM tg_students WHERE id=?").get(id)?.name ||
    `学生#${id}`;
  const changes = audits
    .filter((a) => a.action === "考勤")
    .map((a) => {
      const { before, after, default_status, student_name } = JSON.parse(
        a.payload,
      );
      return {
        student_id: after.student_id,
        attendance_id: after.id,
        date: after.date,
        text: `${student_name || name(after.student_id)}（${after.grade}）${after.date}考勤：${before?.status || "未保存默认" + (default_status || "出勤")} → ${after.status}${before?.status === after.status ? "（备注或结算变更）" : ""}`,
      };
    });
  if (["attendance", "batch-attendance"].includes(action)) {
    if (!changes.length) return null;
    return {
      operation_type:
        action === "attendance" ? "修改托管考勤" : "批量修改托管考勤",
      operation_content:
        changes.length === 1
          ? changes[0].text
          : `批量修改托管考勤：${new Set(changes.map((c) => c.student_id)).size}名学生、${new Set(changes.map((c) => c.date)).size}个日期，共${changes.length}格`,
      details: { changes },
    };
  }
  const audit = audits.at(-1);
  if (!audit) return null;
  const p = JSON.parse(audit.payload),
    b = p.input || p;
  const labels = {
    student: "维护托管学生",
    period: "维护托管参与",
    money: "托管资金",
    "money-edit": "编辑托管资金",
    "money-delete": "删除托管资金",
    rule: "新增托管规则",
    calendar: "维护托管日期",
    "remove-students": "移除本月学生",
    "add-dates": "添加托管日期",
    "remove-dates": "移除托管日期",
  };
  let content = labels[action] || action;
  if (action === "student") {
    const changes = p.before
      ? [
          ["姓名", "name"],
          ["年级", "grade"],
          ["状态", "status"],
          ["备注", "notes"],
        ]
          .filter(([, key]) => p.before[key] !== p.after[key])
          .map(
            ([label, key]) =>
              `${label}：${p.before[key] || "空"} → ${p.after[key] || "空"}`,
          )
      : [
          "新建，" +
            (p.after?.grade || b.grade) +
            "，" +
            (p.after?.status || "在托"),
        ];
    content = `托管学生${p.after?.name || b.name}：${changes.join("；") || "资料已保存"}`;
  } else if (["money-edit", "money-delete"].includes(action)) {
    const rows = p.before || [],
      old = rows[0],
      next = p.replacement;
    content =
      action === "money-delete"
        ? `删除托管资金${rows.length}条：${[...new Set(rows.map((r) => name(r.student_id)))].join("、")}`
        : `${name(old.student_id)} ${old.date} ${old.kind}：实际${(old.actual_amount ?? old.amount) / 100}元、赠送${(old.gift_amount || 0) / 100}元 → 实际${(next.actual_amount ?? next.amount) / 100}元、赠送${(next.gift_amount || 0) / 100}元；${next.method || "未记录支付方式"}`;
  } else if (action === "rule")
    content = `${b.stage}收费规则 ${b.effective_date}生效：出勤${b.present / 100}元，请假${b.leave_fee / 100}元`;
  else if (action === "calendar")
    content = `托管日期${b.date}：${p.before ? (p.before.enabled ? "启用" : "停用") : "默认"} → ${b.enabled ? "启用" : "停用"}`;
  else
    content +=
      "：" +
      [
        b.student_id ? name(b.student_id) : "",
        b.date,
        b.month,
        b.kind,
        b.amount != null ? `${b.amount / 100}元` : "",
        b.dates?.map((d) => (typeof d === "string" ? d : d.date)).join("、"),
        b.students?.map((s) => name(s.id)).join("、"),
        b.actual_amount != null
          ? `实际${b.actual_amount / 100}元、赠送${(b.gift_amount || 0) / 100}元`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
  return {
    operation_type: labels[action] || action,
    operation_content: content,
    details: p,
  };
}
module.exports = { describe };
