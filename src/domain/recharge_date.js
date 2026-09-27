// Calendar dates, deliberately independent of the process/browser time zone.
function validRechargeDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function rechargeMonth(date) { return validRechargeDate(date) ? `${date.slice(0, 7)}-01` : ""; }
function normalizeHistoricalRecharge(row) {
  // Legacy zero-value carry-over markers are not recharge transactions.
  if (row.source === "carry_over" && !Number(row.cur_recharge) && !Number(row.cur_gift) && !row.recharge_date) return { ...row };
  const date = String(row.recharge_date || "").trim();
  if (validRechargeDate(date)) return { ...row, month_key: rechargeMonth(date) };
  const month = String(row.month_key || "").trim();
  const first = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : month;
  if (!date && validRechargeDate(first) && first.endsWith("-01")) return { ...row, recharge_date: first, month_key: first };
  return { ...row };
}
function migrateRechargeDates(db) {
  const report = { filled: 0, realigned: 0, unresolved: 0, carry_over_preserved: 0 };
  db.exec("SAVEPOINT recharge_dates");
  try {
    const update = db.prepare("UPDATE recharge_records SET recharge_date=?,month_key=? WHERE id=?");
    for (const row of db.prepare("SELECT id,recharge_date,month_key,source,cur_recharge,cur_gift FROM recharge_records").all()) {
      if (row.source === "carry_over" && !Number(row.cur_recharge) && !Number(row.cur_gift) && !row.recharge_date) { report.carry_over_preserved++; continue; }
      const normalized = normalizeHistoricalRecharge(row);
      if (!validRechargeDate(normalized.recharge_date)) { report.unresolved++; continue; }
      if (normalized.recharge_date === row.recharge_date && normalized.month_key === row.month_key) continue;
      update.run(normalized.recharge_date, normalized.month_key, row.id);
      if (!String(row.recharge_date || "").trim()) report.filled++;
      else report.realigned++;
    }
    db.exec("RELEASE recharge_dates");
    return report;
  } catch (error) { db.exec("ROLLBACK TO recharge_dates; RELEASE recharge_dates"); throw error; }
}
module.exports = { validRechargeDate, rechargeMonth, normalizeHistoricalRecharge, migrateRechargeDates };
