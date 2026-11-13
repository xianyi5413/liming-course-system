// Shared existing tutoring account rules. Custody supplies integer-cent rounding.
function createBalanceEngine({
  num = (v) => Number(v) || 0,
  moneyRound = Math.round,
  text = (v) => String(v ?? ""),
  studentAccountEventDate = (r) => r.date || r.event_date || "",
  studentAccountLessonDate = (r) => r.date || "",
} = {}) {
  function studentAccountBatchBalance(batches) {
    return batches.reduce(
      (acc, batch) => ({
        actual: moneyRound(acc.actual + num(batch.actual_balance)),
        gift: moneyRound(acc.gift + num(batch.gift_balance)),
      }),
      { actual: 0, gift: 0 },
    );
  }

  function normalizeStudentAccountLedger(batches) {
    const warnings = [];
    for (const batch of batches) {
      const rawActual = Number(batch.actual_balance);
      const rawGift = Number(batch.gift_balance);
      if (!Number.isFinite(rawActual)) {
        const invalidActual = batch.actual_balance;
        batch.actual_balance = 0;
        warnings.push({
          type: "cash_balance_not_numeric",
          value: String(invalidActual),
          source_id: batch.id || 0,
          event_date: batch.date || "",
        });
      }
      if (!Number.isFinite(rawGift)) {
        const invalidGift = batch.gift_balance;
        batch.gift_balance = 0;
        warnings.push({
          type: "gift_balance_not_numeric",
          value: String(invalidGift),
          source_id: batch.id || 0,
          event_date: batch.date || "",
        });
        continue;
      }
      if (rawGift < 0) {
        batch.actual_balance = moneyRound(num(batch.actual_balance) + rawGift);
        batch.gift_balance = 0;
        warnings.push({
          type: "negative_gift_balance_converted_to_cash",
          amount: moneyRound(Math.abs(rawGift)),
          source_id: batch.id || 0,
          event_date: batch.date || "",
        });
      }
    }
    return warnings;
  }

  function reduceStudentAccountBalance(batches, field, amount) {
    let remaining = moneyRound(Math.max(0, num(amount)));
    for (const batch of batches) {
      if (remaining <= 0) break;
      const available = Math.max(num(batch[field]), 0);
      if (available <= 0) continue;
      const reduction = moneyRound(Math.min(available, remaining));
      batch[field] = moneyRound(available - reduction);
      remaining = moneyRound(remaining - reduction);
    }
    return remaining;
  }

  function emptyStudentDebtSettlement() {
    return {
      cash_offset: 0,
      gift_offset: 0,
      gift_lesson_debt_offset: 0,
    };
  }

  function settleStudentCashDebt(batches) {
    const settlement = emptyStudentDebtSettlement();
    for (let debtIndex = 0; debtIndex < batches.length; debtIndex += 1) {
      let debt = Math.max(-num(batches[debtIndex].actual_balance), 0);
      if (debt <= 0) continue;
      for (
        let cashIndex = debtIndex + 1;
        cashIndex < batches.length && debt > 0;
        cashIndex += 1
      ) {
        const available = Math.max(num(batches[cashIndex].actual_balance), 0);
        if (available <= 0) continue;
        const offset = moneyRound(Math.min(available, debt));
        batches[debtIndex].actual_balance = moneyRound(
          num(batches[debtIndex].actual_balance) + offset,
        );
        batches[cashIndex].actual_balance = moneyRound(
          num(batches[cashIndex].actual_balance) - offset,
        );
        debt = moneyRound(debt - offset);
        settlement.cash_offset = moneyRound(settlement.cash_offset + offset);
      }
      for (
        let giftIndex = 0;
        giftIndex < batches.length && debt > 0;
        giftIndex += 1
      ) {
        const available = Math.max(num(batches[giftIndex].gift_balance), 0);
        if (available <= 0) continue;
        const offset = moneyRound(Math.min(available, debt));
        const lessonDebtOffset = moneyRound(
          Math.min(
            Math.max(num(batches[debtIndex].lesson_debt_balance), 0),
            offset,
          ),
        );
        batches[debtIndex].actual_balance = moneyRound(
          num(batches[debtIndex].actual_balance) + offset,
        );
        batches[debtIndex].lesson_debt_balance = moneyRound(
          Math.max(
            0,
            num(batches[debtIndex].lesson_debt_balance) - lessonDebtOffset,
          ),
        );
        batches[giftIndex].gift_balance = moneyRound(
          num(batches[giftIndex].gift_balance) - offset,
        );
        debt = moneyRound(debt - offset);
        settlement.gift_offset = moneyRound(settlement.gift_offset + offset);
        settlement.gift_lesson_debt_offset = moneyRound(
          settlement.gift_lesson_debt_offset + lessonDebtOffset,
        );
      }
    }
    return settlement;
  }

  function addStudentAccountBatch(batches, row = {}, fallbackDate = "") {
    const actual = moneyRound(row.actual_balance ?? row.cur_recharge);
    const gift = moneyRound(row.gift_balance ?? row.cur_gift);
    const warnings = [];
    warnings.debtSettlement = emptyStudentDebtSettlement();
    if (actual === 0 && gift === 0) {
      warnings.debtSettlement = settleStudentCashDebt(batches);
      return warnings;
    }
    let batchActual = 0;
    let batchGift = 0;

    if (actual > 0) {
      batchActual = actual;
    } else if (actual < 0) {
      const remainingReduction = reduceStudentAccountBalance(
        batches,
        "actual_balance",
        Math.abs(actual),
      );
      batchActual =
        remainingReduction > 0 ? moneyRound(-remainingReduction) : 0;
    }

    if (gift > 0) {
      batchGift = gift;
    } else if (gift < 0) {
      let remainingReduction = reduceStudentAccountBalance(
        batches,
        "gift_balance",
        Math.abs(gift),
      );
      const giftShortfall = remainingReduction;
      if (remainingReduction > 0) {
        remainingReduction = reduceStudentAccountBalance(
          batches,
          "actual_balance",
          remainingReduction,
        );
        const pendingCash = Math.max(batchActual, 0);
        const pendingReduction = moneyRound(
          Math.min(pendingCash, remainingReduction),
        );
        batchActual = moneyRound(batchActual - pendingReduction);
        remainingReduction = moneyRound(remainingReduction - pendingReduction);
      }
      if (remainingReduction > 0) {
        batchActual = moneyRound(batchActual - remainingReduction);
      }
      if (giftShortfall > 0) {
        warnings.push({
          type: "gift_overdraw_converted_to_cash",
          amount: giftShortfall,
          source_id: row.id || 0,
          event_date: studentAccountEventDate(row, fallbackDate),
        });
      }
    }
    if (batchActual !== 0 || batchGift !== 0) {
      batches.push({
        date: studentAccountEventDate(row, fallbackDate),
        id: row.id || 0,
        source_type: text(row.source_type) || "account",
        actual_balance: batchActual,
        gift_balance: Math.max(0, batchGift),
        lesson_debt_balance: 0,
      });
    }
    warnings.debtSettlement = settleStudentCashDebt(batches);
    return warnings;
  }

  function consumeStudentBalance(ledger, lessonFee, context = {}) {
    const batches = Array.isArray(ledger) ? ledger : [];
    const balanceWarnings = normalizeStudentAccountLedger(batches);
    const preChargeSettlement = settleStudentCashDebt(batches);
    let remaining = moneyRound(Math.max(0, num(lessonFee)));
    let cashUsed = 0;
    let bonusUsed = 0;

    for (const batch of batches) {
      if (remaining <= 0) break;
      const cashUse = moneyRound(
        Math.min(Math.max(num(batch.actual_balance), 0), remaining),
      );
      if (cashUse > 0) {
        batch.actual_balance = moneyRound(num(batch.actual_balance) - cashUse);
        remaining = moneyRound(remaining - cashUse);
        cashUsed = moneyRound(cashUsed + cashUse);
      }
      if (remaining <= 0) break;
      const bonusUse = moneyRound(
        Math.min(Math.max(num(batch.gift_balance), 0), remaining),
      );
      if (bonusUse > 0) {
        batch.gift_balance = moneyRound(num(batch.gift_balance) - bonusUse);
        remaining = moneyRound(remaining - bonusUse);
        bonusUsed = moneyRound(bonusUsed + bonusUse);
      }
    }

    const debt = moneyRound(Math.max(0, remaining));
    if (remaining > 0) {
      batches.push({
        date: studentAccountLessonDate(context, text(context.month_key)),
        id: context.lesson_id || context.id || 0,
        source_type: "lesson_debt",
        actual_balance: moneyRound(-debt),
        gift_balance: 0,
        lesson_debt_balance: debt,
      });
    }
    const after = studentAccountBatchBalance(batches);
    return {
      cashUsed: moneyRound(cashUsed),
      giftUsed: moneyRound(bonusUsed),
      bonusUsed: moneyRound(bonusUsed),
      cash_used: moneyRound(cashUsed),
      bonus_used: moneyRound(bonusUsed),
      debt,
      afterCashBalance: moneyRound(after.actual),
      afterGiftBalance: moneyRound(Math.max(0, after.gift)),
      actual_consumption: moneyRound(cashUsed + debt),
      gift_consumption: moneyRound(bonusUsed),
      balanceWarnings,
      debtSettlement: preChargeSettlement,
      updatedLedger: batches,
    };
  }

  function applyStudentLessonCharge(batches, feeValue, context = {}) {
    return consumeStudentBalance(batches, feeValue, context);
  }

  function reclassifyStudentGiftDebtConsumption(result, settlement = {}) {
    const amount = moneyRound(
      Math.min(
        Math.max(0, num(result.actual_consumption)),
        Math.max(0, num(settlement.gift_lesson_debt_offset)),
      ),
    );
    if (amount <= 0) return 0;
    result.actual_consumption = moneyRound(result.actual_consumption - amount);
    result.gift_consumption = moneyRound(result.gift_consumption + amount);
    return amount;
  }

  function studentAccountInvariantTypes(batches) {
    const balance = studentAccountBatchBalance(batches);
    const issues = [];
    if (balance.gift < 0) issues.push("gift_balance_negative");
    if (balance.actual < 0 && balance.gift > 0)
      issues.push("cash_negative_gift_positive");
    if (balance.actual > 0 && balance.gift < 0)
      issues.push("cash_positive_gift_negative");
    return issues;
  }

  return {
    studentAccountBatchBalance,
    normalizeStudentAccountLedger,
    reduceStudentAccountBalance,
    emptyStudentDebtSettlement,
    settleStudentCashDebt,
    addStudentAccountBatch,
    consumeStudentBalance,
    applyStudentLessonCharge,
    reclassifyStudentGiftDebtConsumption,
    studentAccountInvariantTypes,
  };
}
module.exports = { createBalanceEngine };
