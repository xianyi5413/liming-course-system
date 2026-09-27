const { splitStoredStudents } = require("./teacher_salary_rule");
// Only approved business fields enter semantic text; caller retains existing redaction.
const LESSON_FIELDS = {
  teacher_name: "授课老师", date: "上课日期", time_slot: "上课时间", classroom: "教室",
  status: "课程状态", grade: "年级", subject: "科目", course_type: "课程类型", notes: "备注", student_names: "学生集合",
};
const names = value => [...new Set(splitStoredStudents(value))];
function formatSetDiff(before, after) {
  const oldNames = names(before), newNames = names(after);
  const added = newNames.filter(name => !oldNames.includes(name));
  const removed = oldNames.filter(name => !newNames.includes(name));
  if (added.length && removed.length) return `学生集合加入“${added.join("、")}”，移除“${removed.join("、")}”`;
  if (added.length) return `在学生集合中加入“${added.join("、")}”`;
  if (removed.length) return `从学生集合中移除“${removed.join("、")}”`;
  return "";
}
function formatFieldChange(field, before, after) {
  if (!Object.hasOwn(LESSON_FIELDS, field) || String(before ?? "") === String(after ?? "")) return "";
  if (field === "student_names") return formatSetDiff(before, after);
  if (field === "notes") return String(after || "").trim() ? `备注更新为“${after}”` : "清空课程备注";
  return `${LESSON_FIELDS[field]}由“${before || "空"}”调整为“${after || "空"}”`;
}
function formatAuditChange(before = {}, after = {}) {
  return Object.keys(LESSON_FIELDS).map(field => formatFieldChange(field, before[field], after[field])).filter(Boolean).join("；");
}
module.exports = { LESSON_FIELDS, formatSetDiff, formatFieldChange, formatAuditChange };
