// Only cached values are read. Formulas are never executed; source files stay unchanged.
const crypto = require("node:crypto");
const { readZip, zipStore, parseWorkbook } = require("../excel/xlsx_codec");
const { STATUSES, fail } = require("./tuoguan");
function excelDate(n) {
  return new Date(Date.UTC(1899, 11, 30) + Number(n) * 86400000)
    .toISOString()
    .slice(0, 10);
}
function preview(buffer) {
  const entries = readZip(buffer);
  const sheets = parseWorkbook(
    zipStore(
      [...entries].map(([name, data]) => ({
        name,
        data: name.endsWith(".xml")
          ? data.toString().replace(/<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/g, "")
          : data,
      })),
    ),
  ).sheets;
  const byName = (n) => sheets.find((s) => s.name === n)?.rows || [];
  const overview = byName("收费总览"),
    title = String(overview[0]?.[0] || "");
  const m = title.match(/(\d{4})年(\d{1,2})月/);
  if (!m) fail("不支持的工作簿：缺少收费总览月份");
  const month = m[1] + "-" + m[2].padStart(2, "0");
  let grade = "";
  const students = [];
  for (const [i, r] of overview.entries()) {
    if (/^初[一二三]收费/.test(String(r[0]))) grade = String(r[0]).slice(0, 2);
    if (typeof r[0] === "number" && r[1] && r[2] && r[1] !== "学生编号")
      students.push({
        source_key: String(i + 1),
        source_id: String(r[1]),
        name: String(r[2]),
        grade,
        class_name: String(r[3] || ""),
        opening_pending: Math.round(Number(r[4] || 0) * 100),
        reference_fee: Math.round(Number(r[5] || 0) * 100),
      });
  }
  if (!students.length) fail("没有可识别学生");
  const rates = byName("收费规则");
  const rate = (label) =>
    Math.round(Number(rates.find((r) => r[0] === label)?.[1]) * 100);
  const rules = {
    present: rate("正常日托管费"),
    leave_fee: rate("请假当日托管费"),
    absent: rate("缺勤当日托管费"),
  };
  if (Object.values(rules).some((v) => !Number.isSafeInteger(v) || v < 0))
    fail("收费参数无效");
  const records = [],
    issues = [
      "所有历史期初余额待核对，不记作充值；不使用含餐费的期末余额。",
      "学生身份必须逐人确认；编号仅用于同一来源定位。",
      "教师安排存在非姓名内容，请在设置中关联现有教师。",
    ];
  if (month === "2026-09")
    issues.push(
      "9月缺勤参数25元与文字50元冲突：全部历史费用保留待核对，不入正式账本。",
    );
  for (const s of sheets.filter((s) => /^初[一二三]考勤/.test(s.name))) {
    const hi = s.rows.findIndex((r) => r[0] === "序号" && r[1] === "学生编号");
    if (hi < 0) continue;
    const header = s.rows[hi];
    const cols = header.flatMap((v, i) =>
      typeof v === "number" && v > 40000 && v < 60000
        ? [{ i, date: excelDate(v) }]
        : [],
    );
    for (const r of s.rows.slice(hi + 1)) {
      if (r[0] === "序号") break;
      if (typeof r[0] !== "number" || !r[1] || !r[2]) continue;
      const candidates = students.filter(
        (p) => p.source_id === String(r[1]) && p.name === String(r[2]),
      );
      if (candidates.length !== 1) {
        issues.push(`${s.name}存在身份无法定位的考勤行`);
        continue;
      }
      const p = candidates[0];
      for (const c of cols) {
        let status = String(r[c.i] || "未登记");
        if (!c.date.startsWith(month)) fail("考勤日期不属于当前月份");
        const raw_status = status;
        if (!STATUSES.includes(status)) {
          issues.push(
            `${s.name} ${c.date} 来源编号 ${p.source_id} 未识别状态 ${status}`,
          );
          status = "未登记";
        }
        records.push({
          source_key: p.source_key,
          date: c.date,
          status,
          raw_status,
          grade: p.grade,
          class_name: p.class_name,
        });
      }
    }
  }
  const counts = Object.fromEntries(
    STATUSES.map((s) => [s, records.filter((r) => r.status === s).length]),
  );
  const calculated = records.reduce(
    (sum, r) =>
      sum +
      ({ 出勤: rules.present, 请假: rules.leave_fee, 缺勤: rules.absent }[
        r.status
      ] || 0),
    0,
  );
  const reference = students.reduce((sum, s) => sum + s.reference_fee, 0);
  if (calculated !== reference)
    issues.push("逐日计算与收费总览不一致，必须人工核对");
  return {
    id: crypto.createHash("sha256").update(buffer).digest("hex"),
    month,
    students,
    records,
    rules,
    counts,
    calculated,
    reference,
    difference: calculated - reference,
    issues,
    dates: [...new Set(records.map((r) => r.date))].sort(),
    status: "待核对",
  };
}
function stage(store, p, actor) {
  store.run(
    "INSERT OR IGNORE INTO tg_imports(id,payload) VALUES (?,?)",
    p.id,
    JSON.stringify(p),
  );
  store.audit(actor, "导入预览", { id: p.id, month: p.month });
  return p;
}
function commit(store, b, actor) {
  return store.atomic(b.request_id, { b, actor }, () => {
    const row = store.get("SELECT * FROM tg_imports WHERE id=?", b.id);
    if (!row) fail("请先预览");
    if (row.result) return JSON.parse(row.result);
    const p = JSON.parse(row.payload),
      mapping = b.mapping || {};
    const ids = p.students.map((s) => Number(mapping[s.source_key]));
    if (
      ids.some(
        (id) => !id || !store.get("SELECT id FROM students WHERE id=?", id),
      )
    )
      fail("请为每名学生确认已有身份；新学生先在学生档案建立");
    if (new Set(ids).size !== ids.length)
      fail("同一月份多个学生不能映射到同一身份");
    for (const [i, s] of p.students.entries()) {
      const id = ids[i],
        start = p.month + "-01",
        end = new Date(
          Date.UTC(Number(p.month.slice(0, 4)), Number(p.month.slice(5)), 0),
        )
          .toISOString()
          .slice(0, 10);
      const overlap = store.all(
        "SELECT * FROM tg_periods WHERE student_id=? AND start_date<=? AND COALESCE(end_date,'9999-12-31')>=?",
        id,
        end,
        start,
      );
      if (!overlap.length)
        store.run(
          "INSERT INTO tg_periods(student_id,grade,class_name,start_date,end_date,status,notes) VALUES (?,?,?,?,?,'退托',?)",
          id,
          s.grade,
          s.class_name,
          start,
          end,
          "历史月份范围，实际入退托日期待核对",
        );
    }
    let success = 0,
      skipped = 0;
    for (const r of p.records) {
      const id = Number(mapping[r.source_key]);
      const old = store.get(
        "SELECT * FROM tg_attendance WHERE student_id=? AND date=?",
        id,
        r.date,
      );
      if (old) {
        if (old.status !== r.status) fail("已有考勤与导入冲突，整批回滚", 409);
        skipped++;
        continue;
      }
      store.run(
        "INSERT OR IGNORE INTO tg_calendar(date,enabled) VALUES (?,1)",
        r.date,
      );
      store.run(
        "INSERT INTO tg_attendance(student_id,date,status,grade,class_name,rule_json,fee,pending) VALUES (?,?,?,?,?,?,0,1)",
        id,
        r.date,
        r.status,
        r.grade,
        r.class_name,
        JSON.stringify(p.rules),
      );
      success++;
    }
    const result = {
      success,
      skipped,
      exceptions: p.issues,
      difference: p.difference,
      posted_amount: 0,
      note: "仅导入考勤；所有历史资金保持待核对",
    };
    store.run(
      "UPDATE tg_imports SET result=? WHERE id=?",
      JSON.stringify(result),
      b.id,
    );
    store.audit(actor, "历史导入", { id: b.id, result });
    return result;
  });
}
module.exports = { preview, stage, commit };
