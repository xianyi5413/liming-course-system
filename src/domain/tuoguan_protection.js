// Shared read model and mutation guard. Independent funds never lock attendance.
const Billing = require("./tuoguan_settlement");
const REAL_STATUSES = new Set(["出勤", "请假", "放假", "停课"]); // legacy 停课 already displays as 放假
const KNOWN_STATUSES = new Set([...REAL_STATUSES, "不适用", "缺勤"]);
const isPlaceholder = (status) =>
  typeof status === "string" && !KNOWN_STATUSES.has(status);
function financialReason(row, entries) {
  try {
    if (
      entries.some(
        (e) => e.voided_at || e.actual_amount != null || e.gift_amount != null,
      )
    )
      return "考勤账本关联异常，请先核对";
    if (Billing.chargedAmount(row, entries) !== 0 || row.fee !== 0)
      return "考勤仍有有效费用或未完成冲正，请先核对";
  } catch {
    return "考勤扣费冲正链异常，请先核对";
  }
  return "";
}
function snapshot(db, start, end, attendance = null) {
  const rows =
    attendance ||
    db
      .prepare("SELECT * FROM tg_attendance WHERE date BETWEEN ? AND ?")
      .all(start, end);
  // Also load cross-date dependencies, so a broken link cannot evade the guard.
  const ledger = db
    .prepare(
      `SELECT * FROM tg_ledger WHERE
    (attendance_id IS NOT NULL OR kind IN ('考勤扣费','考勤冲正')) AND
    (date BETWEEN ? AND ? OR attendance_id IN (SELECT id FROM tg_attendance WHERE date BETWEEN ? AND ?)) ORDER BY id`,
    )
    .all(start, end, start, end);
  const byId = new Map(rows.map((r) => [r.id, r])),
    linked = new Map(),
    dates = {},
    students = {};
  const protect = (row, reason) => {
    dates[row.date] ||= reason;
    students[row.student_id] ||= reason;
  };
  for (const entry of ledger) {
    if (!linked.has(entry.attendance_id)) linked.set(entry.attendance_id, []);
    linked.get(entry.attendance_id).push(entry);
    const row = byId.get(entry.attendance_id);
    if (!row || row.student_id !== entry.student_id || row.date !== entry.date)
      protect(entry, "考勤账本关联异常，请先核对");
  }
  for (const row of rows) {
    const reason = REAL_STATUSES.has(row.status)
      ? "已有考勤（出勤、请假或放假），不能直接移除"
      : financialReason(row, linked.get(row.id) || []) ||
        (row.status === "缺勤" ? "旧缺勤含义待核对，请先更正考勤" : "");
    if (reason) protect(row, reason);
  }
  return {
    protected_dates: Object.keys(dates).sort(),
    protected_students: Object.keys(students).map(Number),
    protected_date_reasons: dates,
    protected_student_reasons: students,
  };
}
module.exports = { snapshot, isPlaceholder, financialReason };
