const { fail } = require("./tuoguan");
function bounds(month) {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "") ||
    Number(month.slice(0, 4)) < 1900
  )
    fail("月份无效");
  const [year, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
  return {
    start: month + "-01",
    end,
    previous: new Date(Date.UTC(year, m - 1, 0)).toISOString().slice(0, 10),
    next: new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 10),
  };
}
function defaults(month, stored = [], attendance = []) {
  const { start, end } = bounds(month),
    rows = new Map(stored.map((r) => [r.date, r]));
  for (
    let d = new Date(start + "T00:00:00Z");
    d.toISOString().slice(0, 10) <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const date = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 6 && !rows.has(date))
      rows.set(date, { date, enabled: 1, version: 0, virtual: true });
  }
  for (const a of attendance)
    if (!rows.has(a.date))
      rows.set(a.date, { date: a.date, enabled: 1, version: 0, virtual: true });
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}
module.exports = { bounds, defaults };
