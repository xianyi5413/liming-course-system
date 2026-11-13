// Normalize only CURRENT placeholders; raw source fields never decide current status.
// Call apply inside the caller's transaction. No ledger row is created or removed.
const Billing = require("./tuoguan_settlement");
const { isPlaceholder, financialReason } = require("./tuoguan_protection");
function plan(attendance, ledger) {
  const linked = new Map(),
    changes = [],
    skipped = [];
  for (const r of ledger) {
    if (!linked.has(r.attendance_id)) linked.set(r.attendance_id, []);
    linked.get(r.attendance_id).push(r);
  }
  for (const row of attendance) {
    if (row.status === "缺勤" || row.status === "停课") {
      skipped.push({
        id: row.id,
        status: row.status,
        reason: "旧业务状态保留，未当作空白转换",
      });
      continue;
    }
    if (!isPlaceholder(row.status)) continue;
    const reason = financialReason(row, linked.get(row.id) || []);
    if (reason) {
      skipped.push({ id: row.id, status: row.status, reason });
      continue;
    }
    changes.push({
      before: { ...row },
      after: {
        ...row,
        status: "不适用",
        fee: 0,
        pending: 0,
        rule_json: Billing.RULE_JSON,
        version: row.version + 1,
      },
    });
  }
  return { changes, skipped };
}
function preview(db, attendance = null) {
  return plan(
    attendance || db.prepare("SELECT * FROM tg_attendance ORDER BY id").all(),
    db
      .prepare(
        "SELECT * FROM tg_ledger WHERE attendance_id IS NOT NULL ORDER BY id",
      )
      .all(),
  );
}
function apply(db, actor = "system", attendance = null) {
  const result = preview(db, attendance);
  const update = db.prepare(
    "UPDATE tg_attendance SET status='不适用',fee=0,pending=0,rule_json=?,version=? WHERE id=? AND version=?",
  );
  for (const { before, after } of result.changes) {
    if (
      update.run(after.rule_json, after.version, before.id, before.version)
        .changes !== 1
    )
      throw Error("占位考勤版本已变化，规范化已取消");
  }
  if (result.changes.length)
    db.prepare("INSERT INTO tg_audit(actor,action,payload) VALUES(?,?,?)").run(
      actor,
      "规范占位考勤",
      JSON.stringify(result),
    );
  return { updated: result.changes.length, skipped: result.skipped };
}
module.exports = { plan, preview, apply };
