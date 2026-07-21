const PRICE_STATUS = Object.freeze({
  AUTOMATIC: "自动",
  MANUAL: "手动",
  UNSET: "未设置",
  SET: "已设置",
  DISABLED: "已停用",
});

const STUDENT_PRICE_STATUS_VALUES = Object.freeze([
  PRICE_STATUS.AUTOMATIC,
  PRICE_STATUS.MANUAL,
  PRICE_STATUS.UNSET,
]);

const TEACHER_PRICE_STATUS_VALUES = Object.freeze([
  PRICE_STATUS.SET,
  PRICE_STATUS.UNSET,
  PRICE_STATUS.DISABLED,
]);

function studentPriceStatus(source) {
  if (source === "manual") return PRICE_STATUS.MANUAL;
  if (source === "pending") return PRICE_STATUS.UNSET;
  return PRICE_STATUS.AUTOMATIC;
}

function teacherPriceStatus(rule = {}) {
  if (Number(rule.is_active) === 0) return PRICE_STATUS.DISABLED;
  return Number(rule.salary_per_unit) > 0 ? PRICE_STATUS.SET : PRICE_STATUS.UNSET;
}

function teacherActiveFromPriceStatus(value) {
  return value === PRICE_STATUS.DISABLED ? 0 : 1;
}

module.exports = {
  PRICE_STATUS,
  STUDENT_PRICE_STATUS_VALUES,
  TEACHER_PRICE_STATUS_VALUES,
  studentPriceStatus,
  teacherPriceStatus,
  teacherActiveFromPriceStatus,
};
