const PRICE_STATUS = Object.freeze({
  UNSET: "未设置",
  SET: "已设置",
});

const STUDENT_PRICE_STATUS_VALUES = Object.freeze([
  PRICE_STATUS.SET,
  PRICE_STATUS.UNSET,
]);

const TEACHER_PRICE_STATUS_VALUES = STUDENT_PRICE_STATUS_VALUES;

function visiblePriceStatus(amount, isActive = 1) {
  return Number(isActive) !== 0 && Number(amount) > 0 ? PRICE_STATUS.SET : PRICE_STATUS.UNSET;
}

function studentPriceStatus(source) {
  return visiblePriceStatus(source === "pending" ? 0 : 1);
}

function teacherPriceStatus(rule = {}) {
  return visiblePriceStatus(rule.salary_per_unit, rule.is_active);
}

function teacherActiveFromPriceStatus(value) {
  return value === PRICE_STATUS.SET ? 1 : 0;
}

module.exports = {
  PRICE_STATUS,
  STUDENT_PRICE_STATUS_VALUES,
  TEACHER_PRICE_STATUS_VALUES,
  visiblePriceStatus,
  studentPriceStatus,
  teacherPriceStatus,
  teacherActiveFromPriceStatus,
};
