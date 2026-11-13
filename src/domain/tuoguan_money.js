// Manual money corrections retain immutable financial evidence. Balances are
// always replayed by the existing custody account engine, never cached here.
const { account } = require("./tuoguan_account");
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const manual = (r) =>
  r && ["充值", "退款"].includes(r.kind) && r.attendance_id == null;
function validateEvidence(rows) {
  const seen = new Map(),
    replaced = new Set();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.version) || row.version < 1)
      fail("资金版本无效");
    if (
      (row.voided_at != null &&
        (!manual(row) ||
          typeof row.voided_at !== "string" ||
          !Number.isFinite(Date.parse(row.voided_at)) ||
          !row.voided_by)) ||
      (!row.voided_at && row.voided_by)
    )
      fail("资金作废证据无效");
    if (row.replaces_id != null) {
      const prior = seen.get(row.replaces_id);
      if (
        !manual(row) ||
        !prior?.voided_at ||
        !manual(prior) ||
        replaced.has(row.replaces_id)
      )
        fail("资金替代关联无效");
      replaced.add(row.replaces_id);
    }
    seen.set(row.id, row);
  }
}
function change(db, action, b, actor, insert) {
  const get = (id) => db.prepare("SELECT * FROM tg_ledger WHERE id=?").get(id);
  const items =
    action === "money-edit" ? [{ id: b.id, version: b.version }] : b.records;
  if (
    !Array.isArray(items) ||
    !items.length ||
    items.length > 500 ||
    items.some((r) => !r || typeof r !== "object") ||
    new Set(items.map((r) => r.id)).size !== items.length
  )
    fail("请选择1至500条不重复的资金记录");
  const errors = [],
    rows = [];
  for (const item of items) {
    if (!Number.isSafeInteger(item.id) || !Number.isSafeInteger(item.version)) {
      errors.push("记录标识或版本无效");
      continue;
    }
    const row = get(item.id);
    if (!row || row.voided_at || row.version !== item.version)
      errors.push("记录 " + item.id + " 已被修改或删除，请刷新后重新打开");
    else if (!manual(row))
      errors.push("记录 " + item.id + " 不是可修改的充值或退款");
    else if (row.actual_amount == null || row.gift_amount == null)
      errors.push("记录 " + item.id + " 为未确认分账的历史格式，请先核账");
    else rows.push(row);
  }
  if (errors.length)
    fail(
      errors.join("；"),
      rows.length !== items.length && errors.some((e) => e.includes("已被修改"))
        ? 409
        : 400,
    );
  let replacement = null;
  const before = rows.map((r) => ({ ...r }));
  // Metadata-only edits preserve event order and avoid an unnecessary replay.
  const metadataOnly =
    action === "money-edit" &&
    ["student_id", "date", "kind"].every((k) => b[k] === rows[0][k]) &&
    b.actual_amount === Math.abs(rows[0].actual_amount) &&
    b.gift_amount === Math.abs(rows[0].gift_amount);
  if (metadataOnly) {
    if (typeof b.method !== "string" || b.method.length > 120)
      fail("支付方式无效");
    db.prepare(
      "UPDATE tg_ledger SET method=?,notes=?,version=version+1 WHERE id=?",
    ).run(b.method, String(b.notes || "").slice(0, 2000), b.id);
    replacement = get(b.id);
  } else {
    const now = new Date().toISOString();
    for (const row of rows)
      db.prepare(
        "UPDATE tg_ledger SET voided_at=?,voided_by=?,version=version+1 WHERE id=? AND version=?",
      ).run(now, actor, row.id, row.version);
    if (action === "money-edit") {
      if (!["充值", "退款"].includes(b.kind)) fail("类型仅支持充值或退款");
      replacement = insert(b, rows[0].id);
    }
    const affected = new Set(rows.map((r) => r.student_id));
    if (replacement) affected.add(replacement.student_id);
    for (const id of affected) {
      const ledger = db
        .prepare("SELECT * FROM tg_ledger WHERE student_id=? ORDER BY date,id")
        .all(id);
      const month = ledger
        .map((r) => r.date.slice(0, 7))
        .sort()
        .at(-1);
      account(ledger, month, month + "-31", { validateRefunds: true });
    }
  }
  db.prepare("INSERT INTO tg_audit(actor,action,payload) VALUES(?,?,?)").run(
    actor,
    action,
    JSON.stringify({
      before,
      after: rows.map((r) => get(r.id)),
      replacement,
      metadata_only: metadataOnly,
    }),
  );
  return {
    ok: true,
    record: replacement,
    deleted: action === "money-delete" ? rows.length : 0,
  };
}
module.exports = { change, validateEvidence };
