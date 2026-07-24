"use strict";

function text(value) {
  return value == null ? "" : String(value).trim();
}

function optionalNumber(value) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function splitStoredStudents(value) {
  let source = value;
  if (typeof source === "string") {
    const raw = source.trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) source = parsed;
      } catch {
        // Historical non-JSON values continue through the delimiter parser.
      }
    }
  }
  if (Array.isArray(source)) return source.flatMap((item) => splitStoredStudents(item));
  return text(source)
    .split(/[、,，;；\n\r]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function normalizeStoredStudentSet(value) {
  const names = splitStoredStudents(value)
    .map((name) => text(name).replace(/\s+/g, ""))
    .filter(Boolean);
  return [...new Set(names)]
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"))
    .join("、");
}

function teacherSalaryRuleActivation(rule = {}) {
  const raw = rule.is_active;
  const amount = optionalNumber(rule.salary_per_unit);
  if (raw == null || (typeof raw === "string" && !raw.trim())) {
    return { enabled: amount != null, source: "legacy_missing" };
  }
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "启用", "在用", "enabled", "active", "on"].includes(normalized)) {
    return { enabled: true, source: "explicit_enabled" };
  }
  if (["-1", "false", "停用", "禁用", "disabled", "inactive", "off"].includes(normalized)) {
    return { enabled: false, source: "explicit_disabled" };
  }
  if (normalized === "0") {
    return amount != null && amount > 0
      ? { enabled: true, source: "legacy_candidate_with_amount" }
      : { enabled: false, source: "candidate_unconfigured" };
  }
  return { enabled: false, source: "invalid_status" };
}

function teacherSalaryRuleDateState(rule = {}, lesson = {}) {
  const lessonDate = text(lesson.date);
  const startDate = text(rule.start_date);
  const endDate = text(rule.end_date);
  if (startDate && lessonDate && lessonDate < startDate) {
    return { usable: false, status: "未生效", reason: "规则尚未生效" };
  }
  if (endDate && lessonDate && lessonDate > endDate) {
    return { usable: false, status: "已失效", reason: "规则已经失效" };
  }
  return { usable: true, status: "有效", reason: "" };
}

module.exports = {
  normalizeStoredStudentSet,
  splitStoredStudents,
  teacherSalaryRuleActivation,
  teacherSalaryRuleDateState,
};
