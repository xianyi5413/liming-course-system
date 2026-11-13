// One tariff and one reconciliation path for saves, upgrades and old imports.
// Call apply/settle inside the caller's transaction; source evidence is archived.
const RULE = Object.freeze({ present: 5000, leave_fee: 2500, absent: 0 });
const crypto = require("node:crypto");
function entryUid(attendanceUid, ordinal) {
  const hex = crypto
    .createHash("sha256")
    .update("custody:auto-consumption:v1:" + attendanceUid + ":" + ordinal)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
const RULE_ACTOR = "system:auto-consumption-v1";
const RULE_JSON = JSON.stringify(RULE);
const FEES = Object.freeze({
  出勤: RULE.present,
  请假: RULE.leave_fee,
  放假: 0,
  不适用: 0,
});
function chargedAmount(row, entries) {
  let charged = 0;
  for (const entry of [...entries].sort((a, b) => a.id - b.id)) {
    if (entry.student_id !== row.student_id || entry.date !== row.date)
      throw Error("考勤与消费关联不一致，自动结算已取消");
    if (entry.kind === "考勤扣费" && entry.amount < 0 && !charged)
      charged = -entry.amount;
    else if (
      entry.kind === "考勤冲正" &&
      entry.amount === charged &&
      charged > 0
    )
      charged = 0;
    else throw Error("考勤扣费冲正链异常，自动结算已取消");
  }
  return charged;
}
function plan(attendance, ledger) {
  const linked = new Map();
  for (const row of ledger) {
    if (row.attendance_id == null) continue;
    if (!linked.has(row.attendance_id)) linked.set(row.attendance_id, []);
    linked.get(row.attendance_id).push(row);
  }
  const changes = [];
  for (const row of attendance) {
    if (!Object.hasOwn(FEES, row.status)) continue;
    const charged = chargedAmount(row, linked.get(row.id) || []);
    const fee = FEES[row.status];
    if (
      charged === fee &&
      row.fee === fee &&
      !row.pending &&
      row.rule_json === RULE_JSON
    )
      continue;
    const entries = [];
    if (charged !== fee) {
      if (charged) entries.push({ kind: "考勤冲正", amount: charged });
      if (fee) entries.push({ kind: "考勤扣费", amount: -fee });
    }
    changes.push({
      before: { ...row },
      after: {
        ...row,
        fee,
        pending: 0,
        rule_json: RULE_JSON,
        version: row.version + 1,
      },
      charged,
      entries,
      ordinal: (linked.get(row.id) || []).length,
    });
  }
  return changes;
}
function ensureRule(db) {
  if (!db.prepare("SELECT id FROM tg_rules WHERE created_by=?").get(RULE_ACTOR))
    db.prepare(
      "INSERT INTO tg_rules(effective_date,present,leave_fee,absent,notes,created_by) VALUES('0001-01-01',?,?,?,'统一自动计费',?)",
    ).run(RULE.present, RULE.leave_fee, RULE.absent, RULE_ACTOR);
}
function apply(
  db,
  changes,
  actor = "system",
  { bumpVersion = true, reason = "托管自动结算" } = {},
) {
  if (!changes.length) return { updated: 0, entries: 0, net_change: 0 };
  const update = db.prepare(
    "UPDATE tg_attendance SET fee=?,pending=0,rule_json=?,version=? WHERE id=? AND version=?",
  );
  const insert = db.prepare(
    "INSERT INTO tg_ledger(student_id,date,kind,amount,notes,actor,attendance_id) VALUES(?,?,?,?,?,?,?)",
  );
  let entries = 0,
    net_change = 0;
  for (const c of changes) {
    if (!bumpVersion) c.after.version = c.before.version;
    if (
      update.run(
        c.after.fee,
        RULE_JSON,
        c.after.version,
        c.before.id,
        c.before.version,
      ).changes !== 1
    )
      throw Error("考勤版本已变化，自动结算已取消");
    let attendanceUid;
    if (c.entries.length) {
      attendanceUid = db
        .prepare(
          "SELECT uid FROM tg_transfer_keys WHERE table_name='tg_attendance' AND row_key=? ORDER BY id LIMIT 1",
        )
        .get(String(c.before.id))?.uid;
      if (!attendanceUid) {
        attendanceUid = crypto.randomUUID();
        db.prepare(
          "INSERT INTO tg_transfer_keys(table_name,row_key,uid) VALUES('tg_attendance',?,?)",
        ).run(String(c.before.id), attendanceUid);
      }
    }
    for (const [index, entry] of c.entries.entries()) {
      const inserted = insert.run(
        c.before.student_id,
        c.before.date,
        entry.kind,
        entry.amount,
        reason,
        actor,
        c.before.id,
      );
      db.prepare(
        "INSERT INTO tg_transfer_keys(table_name,row_key,uid) VALUES('tg_ledger',?,?)",
      ).run(
        String(inserted.lastInsertRowid),
        entryUid(attendanceUid, c.ordinal + index),
      );
      entries++;
    }
    net_change += c.after.fee - c.charged;
  }
  db.prepare("INSERT INTO tg_audit(actor,action,payload) VALUES(?,?,?)").run(
    actor,
    reason,
    JSON.stringify({ rule: RULE, changes }),
  );
  return { updated: changes.length, entries, net_change };
}
function settle(db, actor = "system", options = {}) {
  ensureRule(db);
  const rows =
    options.attendance ||
    db.prepare("SELECT * FROM tg_attendance ORDER BY id").all();
  const ledger = options.attendance
    ? db
        .prepare("SELECT * FROM tg_ledger WHERE attendance_id=? ORDER BY id")
        .all(rows[0].id)
    : db
        .prepare(
          "SELECT * FROM tg_ledger WHERE attendance_id IS NOT NULL ORDER BY id",
        )
        .all();
  return apply(db, plan(rows, ledger), actor, options);
}
function needsMigration(db) {
  if (
    !db.prepare("SELECT 1 FROM sqlite_schema WHERE name='tg_attendance'").get()
  )
    return false;
  return (
    plan(
      db.prepare("SELECT * FROM tg_attendance").all(),
      db.prepare("SELECT * FROM tg_ledger ORDER BY id").all(),
    ).length > 0
  );
}
module.exports = {
  RULE,
  RULE_ACTOR,
  RULE_JSON,
  FEES,
  plan,
  chargedAmount,
  apply,
  settle,
  ensureRule,
  needsMigration,
  entryUid,
};
