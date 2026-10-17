"use strict";
// Existing settlement falls back to the institution standard, not custom pricing.
function planFeeRestore({status, actual, target, fallback, hasOverride}) {
  const cents = value => Math.round(Number(value) * 100);
  if (status !== '已上') return {action:'skip', reason:'非已上课程，不参与收费恢复'};
  if (target == null || !Number.isFinite(Number(target))) return {action:'skip', reason:'无法计算规则费用'};
  if (cents(actual) === cents(target)) return {action:'unchanged', reason:'金额已一致，无需写入'};
  if (fallback == null || cents(fallback) !== cents(target)) return {action:'skip', reason:'个性规则与机构标准不同，现有收费机制不能安全恢复跟随；本次不修改'};
  if (!hasOverride) return {action:'skip', reason:'没有可清除的单节覆盖，请刷新核对'};
  return {action:'restore', reason:'清除单节覆盖，恢复当前课程自动收费'};
}
function migrateStudentFeeMode(db) {
  const columns = db.prepare('PRAGMA table_info(lessons)').all();
  if (!columns.some(column => column.name === 'student_fee_mode')) db.exec("ALTER TABLE lessons ADD COLUMN student_fee_mode TEXT NOT NULL DEFAULT 'standard'");
}
function automaticStudentFee(mode, customPrice, standard) {
  return mode === 'rule' && Number(customPrice) > 0 ? Number(customPrice) : standard == null ? null : Number(standard);
}
module.exports = {planFeeRestore, migrateStudentFeeMode, automaticStudentFee};
