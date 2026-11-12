// Replay independent custody accounts with the exact tutoring batch/debt rules.
// Ledger evidence stays immutable; allocations are derived as of the queried month.
const engine = require("./account_balance").createBalanceEngine();
function account(ledger, month, cutoff = month + "-31") {
  const rows = ledger
    .filter((r) => r.date <= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const months = [
    ...new Set([...rows.map((r) => r.date.slice(0, 7)), month]),
  ].sort();
  let carry = { actual: 0, gift: 0 },
    result;
  for (const key of months) {
    if (key > month) break;
    let batches = [];
    engine.addStudentAccountBatch(batches, {
      actual_balance: carry.actual,
      gift_balance: carry.gift,
      source_type: "opening",
    });
    const current = rows.filter((r) => r.date.startsWith(key)),
      groups = new Map(),
      active = new Map();
    const allocations = new Map();
    result = {
      opening_actual: carry.actual,
      opening_gift: carry.gift,
      actual_recharge: 0,
      gift_recharge: 0,
      actual_consumption: 0,
      gift_consumption: 0,
      fee: 0,
      prior_debt_gift_offset: 0,
      legacy_unallocated: 0,
      refund: 0,
      adjustment: 0,
    };
    const events = [];
    for (const row of current) {
      if (row.attendance_id != null) {
        if (!groups.has(row.attendance_id)) groups.set(row.attendance_id, []);
        groups.get(row.attendance_id).push(row);
      } else events.push({ date: row.date, order: 0, id: row.id, row });
    }
    for (const list of groups.values())
      events.push({
        date: list[0].date,
        order: 1,
        id: list[0].id,
        list: list.sort((a, b) => a.id - b.id),
      });
    events.sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.order - b.order || a.id - b.id,
    );
    for (const event of events) {
      if (event.row) {
        const row = event.row,
          legacy = row.actual_amount == null && row.gift_amount == null;
        const actual = legacy ? row.amount : row.actual_amount,
          gift = legacy ? 0 : row.gift_amount;
        if (
          !Number.isSafeInteger(actual) ||
          !Number.isSafeInteger(gift) ||
          actual + gift !== row.amount
        )
          throw Error("托管资金分账不完整");
        const debts = new Map(
          batches
            .filter((b) => b.source_type === "lesson_debt")
            .map((b) => [b.id, b.lesson_debt_balance]),
        );
        const change = engine.addStudentAccountBatch(batches, {
          id: row.id,
          date: row.date,
          actual_balance: actual,
          gift_balance: gift,
        });
        let reclassified = 0;
        for (const batch of batches) {
          const charge = active.get(batch.id);
          if (batch.source_type !== "lesson_debt" || !charge) continue;
          const offset = Math.max(
            0,
            (debts.get(batch.id) || 0) - batch.lesson_debt_balance,
          );
          if (offset) {
            charge.actual_amount += offset;
            charge.gift_amount -= offset;
            result.actual_consumption -= offset;
            result.gift_consumption += offset;
            reclassified += offset;
          }
        }
        result.prior_debt_gift_offset +=
          change.debtSettlement.gift_offset - reclassified;
        if (row.kind === "充值") {
          result.actual_recharge += actual;
          result.gift_recharge += gift;
        } else if (row.kind === "退款") result.refund -= row.amount;
        else result.adjustment += row.amount;
        if (legacy) result.legacy_unallocated++;
        allocations.set(row.id, {
          ...row,
          actual_amount: actual,
          gift_amount: gift,
          legacy_unallocated: legacy,
        });
        continue;
      }
      let prior = null;
      for (const row of event.list) {
        if (row.kind === "考勤冲正") {
          if (!prior || prior.row.amount !== -row.amount)
            throw Error("托管冲正缺少匹配的原扣费");
          const previous = allocations.get(prior.row.id);
          allocations.set(row.id, {
            ...row,
            actual_amount: -previous.actual_amount,
            gift_amount: -previous.gift_amount,
          });
          result.actual_consumption += previous.actual_amount;
          result.gift_consumption += previous.gift_amount;
          result.fee -= row.amount;
          batches = prior.batches;
          active.delete(prior.row.id);
          prior = null;
        } else {
          if (row.kind !== "考勤扣费" || row.amount >= 0 || prior)
            throw Error("托管扣费记录关联异常");
          prior = { row, batches: structuredClone(batches) };
          const charge = engine.consumeStudentBalance(batches, -row.amount, {
            date: row.date,
            lesson_id: row.id,
          });
          const allocation = {
            ...row,
            actual_amount: -charge.actual_consumption,
            gift_amount: -charge.gift_consumption,
          };
          allocations.set(row.id, allocation);
          active.set(row.id, allocation);
          result.actual_consumption += charge.actual_consumption;
          result.gift_consumption += charge.gift_consumption;
          result.fee -= row.amount;
        }
      }
    }
    carry = engine.studentAccountBatchBalance(batches);
    Object.assign(result, {
      actual_balance: carry.actual,
      gift_balance: carry.gift,
      balance: carry.actual + carry.gift,
      opening: result.opening_actual + result.opening_gift,
      recharge: result.actual_recharge + result.gift_recharge,
      unpaid_current_fee: batches
        .filter((b) => b.source_type === "lesson_debt")
        .reduce((sum, b) => sum + Math.max(0, -b.actual_balance), 0),
      ledger: current.map((r) => allocations.get(r.id)),
    });
  }
  return result;
}
module.exports = { account };
