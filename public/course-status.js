(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CourseStatus = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const defaults = ["待上", "已上", "请假", "试课", "考试"];
  const isLegacyUnpaid = value => ["未缴费", "上课（未缴费）"].includes(String(value || "").trim());
  const display = value => isLegacyUnpaid(value) ? "已上" : String(value || "").trim();
  const candidates = values => [...new Set([...defaults, ...(values || [])].map(value => String(value || "").trim()).filter(value => value && !isLegacyUnpaid(value)))];
  return { defaults, isLegacyUnpaid, display, candidates };
});
