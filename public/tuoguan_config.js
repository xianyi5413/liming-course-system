/* Shared custody vocabulary; deliberately independent from course grades. */
(function (root) {
  const stages = Object.freeze({
    三年级: "小学",
    初一: "初中",
    初二: "初中",
    初三: "初中",
  });
  const management = ["tgStudents", "tgLedger", "tgSummary", "tgSettings"];
  const config = {
    stages,
    grades: Object.keys(stages),
    management,
    defaults: {
      小学: { present: 3000, leave_fee: 2500, absent: 0 },
      初中: { present: 5000, leave_fee: 2500, absent: 0 },
    },
    permissions: (keys) => [
      ...new Set(keys.flatMap((k) => (k === "tgFinance" ? management : [k]))),
    ],
  };
  if (typeof module !== "undefined") module.exports = config;
  else root.TuoguanConfig = config;
})(typeof window === "undefined" ? globalThis : window);
