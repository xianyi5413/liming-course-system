// Only cached values are read. Formulas are never executed; source files stay unchanged.
const crypto = require("node:crypto");
const { readZip, zipStore, parseWorkbook } = require("../excel/xlsx_codec");
const { HISTORY_STATUSES: STATUSES, GRADES, fail, date } = require("./tuoguan");
function columnName(index) {
  let name = "";
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
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
  const rules_pending =
    rules.absent !== rules.present &&
    rates.some((r) => r[0] === "正常日托管费" && String(r[2]).includes("缺勤"));
  const records = [],
    issues = [
      "所有历史期初余额待核对，不记作充值；不使用含餐费的期末余额。",
      "仅独立托管档案参与匹配；编号仅用于同一来源定位。",
      "教师安排存在非姓名内容，请在设置中关联现有教师。",
    ];
  if (rules_pending)
    issues.push(
      `缺勤参数${rules.absent / 100}元与正常日说明${rules.present / 100}元冲突，规则与费用待核对。`,
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
    for (const [offset, r] of s.rows.slice(hi + 1).entries()) {
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
      const headerCol = (name) => header.findIndex((h) => h === name);
      p.attendance_sheet = s.name;
      p.attendance_row = hi + offset + 2;
      p.cached_counts = Object.fromEntries(
        ["出勤", "请假", "缺勤", "停课", "未登记"].map((k) => [
          k,
          headerCol(k) >= 0 ? r[headerCol(k)] : null,
        ]),
      );
      p.sheet_reference_fee =
        headerCol("托管费") >= 0
          ? Math.round(Number(r[headerCol("托管费")] || 0) * 100)
          : null;
      for (const c of cols) {
        const raw_status = String(r[c.i] ?? "");
        let status = raw_status || "未登记";
        if (!c.date.startsWith(month)) fail("考勤日期不属于当前月份");
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
          source_cell: s.name + "!" + columnName(c.i) + (hi + offset + 2),
          reference_fee:
            { 出勤: rules.present, 请假: rules.leave_fee, 缺勤: rules.absent }[
              status
            ] || 0,
          grade: p.grade,
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
    rules_pending,
    counts,
    calculated,
    reference,
    difference: calculated - reference,
    issues,
    dates: [...new Set(records.map((r) => r.date))].sort(),
    status: "待核对",
  };
}
function suggestions(store, p) {
  const students = store.all("SELECT * FROM tg_students");
  const prior = store.all(
    "SELECT s.*,i.payload FROM tg_import_sources s JOIN tg_imports i ON i.id=s.import_id WHERE s.status='已导入'",
  );
  return Object.fromEntries(
    p.students.map((s) => {
      const saved = prior.find(
        (r) => r.import_id === p.id && r.source_key === s.source_key,
      );
      if (saved)
        return [
          s.source_key,
          { student_id: saved.student_id, basis: saved.basis },
        ];
      const same = students.filter((t) => t.name.trim() === s.name.trim());
      const sourceDuplicates = p.students.filter(
        (t) => t.name.trim() === s.name.trim(),
      );
      if (sourceDuplicates.length !== 1)
        return [
          s.source_key,
          { pending: true, basis: "同月存在同名学生，需逐人确认" },
        ];
      if (!same.length)
        return [
          s.source_key,
          { create: true, basis: "无同名托管档案，新建来源身份" },
        ];
      const exact = same.filter((t) => t.grade === s.grade && s.grade);
      // An imported prior-month identity with the same name and grade is
      // stronger evidence than a manually entered name alone. Ambiguities stay pending.
      const matches = exact.filter((t) =>
        prior.some((r) => {
          const old = JSON.parse(r.payload),
            source = old.students.find((x) => x.source_key === r.source_key);
          return (
            r.student_id === t.id &&
            old.month !== p.month &&
            source?.name === s.name &&
            source.grade === s.grade
          );
        }),
      );
      if (same.length === 1 && matches.length === 1)
        return [
          s.source_key,
          {
            student_id: matches[0].id,
            basis: "跨月姓名、年级一致，来源与现有档案均唯一",
          },
        ];
      return [
        s.source_key,
        { pending: true, basis: "同名或年级变化，无法自动确认身份" },
      ];
    }),
  );
}
function stage(store, p, actor) {
  store.run(
    "INSERT INTO tg_imports(id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE tg_imports.result IS NULL AND NOT EXISTS (SELECT 1 FROM tg_import_sources WHERE import_id=excluded.id AND status='已导入')",
    p.id,
    JSON.stringify(p),
  );
  store.audit(actor, "导入预览", { id: p.id, month: p.month });
  return { ...p, suggestions: suggestions(store, p) };
}
function commit(store, b, actor) {
  return store.atomic(b.request_id, { b, actor }, () => {
    const row = store.get("SELECT * FROM tg_imports WHERE id=?", b.id);
    if (!row) fail("请先预览");
    const p = JSON.parse(row.payload),
      mapping = b.mapping || {},
      proposed = suggestions(store, p);
    // Old releases saved a completed result without per-source links. Preserve it.
    if (
      row.result &&
      !store.get("SELECT id FROM tg_import_sources WHERE import_id=?", p.id)
    )
      return JSON.parse(row.result);
    const used = new Set(
      store
        .all(
          "SELECT student_id FROM tg_import_sources WHERE import_id=? AND status='已导入'",
          p.id,
        )
        .map((r) => r.student_id),
    );
    const start = date(p.month + "-01"),
      end = new Date(
        Date.UTC(Number(p.month.slice(0, 4)), Number(p.month.slice(5)), 0),
      )
        .toISOString()
        .slice(0, 10);
    for (const s of p.students) {
      const sourceId = p.id + ":" + s.source_key;
      const oldSource = store.get(
        "SELECT * FROM tg_import_sources WHERE id=?",
        sourceId,
      );
      if (oldSource?.status === "已导入") continue;
      const choice = mapping[s.source_key] ?? (b.auto ? "auto" : "");
      const suggestion = proposed[s.source_key];
      const selected =
        choice === "auto"
          ? suggestion
          : choice === "new"
            ? { create: true, basis: "人工选择新建独立档案" }
            : choice
              ? { student_id: Number(choice), basis: "人工确认已有托管身份" }
              : { pending: true, basis: "尚未选择身份" };
      store.run(
        "INSERT OR IGNORE INTO tg_import_sources(id,import_id,source_key) VALUES (?,?,?)",
        sourceId,
        p.id,
        s.source_key,
      );
      if (selected.pending) {
        store.run(
          "UPDATE tg_import_sources SET status='待确认',basis=? WHERE id=?",
          selected.basis,
          sourceId,
        );
        continue;
      }
      store.run("SAVEPOINT tg_import_student");
      try {
        if (!GRADES.includes(s.grade)) fail("托管年级仅支持初一、初二、初三");
        const id = selected.create
          ? Number(
              store.run(
                "INSERT INTO tg_students(name,grade,notes) VALUES (?,?,?)",
                s.name,
                s.grade,
                "历史来源建档；实际入退托日期待核对",
              ).lastInsertRowid,
            )
          : selected.student_id;
        if (!store.get("SELECT id FROM tg_students WHERE id=?", id))
          fail("托管档案不存在");
        if (used.has(id)) fail("同月多名来源学生不能映射到同一档案");
        const records = p.records.filter((r) => r.source_key === s.source_key);
        if (!records.length) fail("没有可定位的考勤行，需先核对来源");
        const overlap = store.all(
          "SELECT * FROM tg_periods WHERE student_id=? AND start_date<=? AND COALESCE(end_date,'9999-12-31')>=?",
          id,
          end,
          start,
        );
        if (
          overlap.length &&
          records.some(
            (r) =>
              !overlap.some(
                (t) =>
                  t.start_date <= r.date &&
                  (!t.end_date || t.end_date >= r.date) &&
                  t.grade === r.grade,
              ),
          )
        )
          fail("历史周期或年级与既有周期冲突");
        if (!overlap.length)
          store.run(
            "INSERT INTO tg_periods(student_id,grade,start_date,end_date,status,notes) VALUES (?,?,?,?,'在托',?)",
            id,
            s.grade,
            start,
            end,
            "历史月份范围，实际入退托日期待核对",
          );
        for (const r of records) {
          date(r.date);
          if (
            !r.date.startsWith(p.month) ||
            !STATUSES.includes(r.status) ||
            !GRADES.includes(r.grade)
          )
            fail("导入考勤日期或状态无效");
          const existing = store.get(
            "SELECT * FROM tg_attendance WHERE student_id=? AND date=?",
            id,
            r.date,
          );
          if (existing) fail("已有考勤冲突：" + r.date + "，原记录未覆盖", 409);
          const calendar = store.get(
            "SELECT * FROM tg_calendar WHERE date=?",
            r.date,
          );
          if (calendar && !calendar.enabled)
            fail("已有停用日历冲突：" + r.date, 409);
          store.run(
            "INSERT OR IGNORE INTO tg_calendar(date,enabled) VALUES (?,1)",
            r.date,
          );
          store.run(
            "INSERT INTO tg_attendance(student_id,date,status,grade,rule_json,fee,pending,reference_fee,source_import_id,source_key,source_cell,raw_status) VALUES (?,?,?,?,?,0,1,?,?,?,?,?)",
            id,
            r.date,
            r.status,
            r.grade,
            JSON.stringify(p.rules),
            r.reference_fee ??
              ({
                出勤: p.rules.present,
                请假: p.rules.leave_fee,
                缺勤: p.rules.absent,
              }[r.status] ||
                0),
            p.id,
            s.source_key,
            r.source_cell || "",
            r.raw_status ?? r.status,
          );
        }
        for (const attendance of store.all(
          "SELECT * FROM tg_attendance WHERE student_id=? AND source_import_id=?",
          id,
          p.id,
        ))
          require("./tuoguan_settlement").settle(store.db, actor, {
            attendance: [attendance],
            reason: "历史导入自动结算",
          });
        store.run(
          "UPDATE tg_import_sources SET student_id=?,status='已导入',basis=? WHERE id=?",
          id,
          selected.create ? "新建：" + selected.basis : selected.basis,
          sourceId,
        );
        store.run("RELEASE tg_import_student");
        used.add(id);
      } catch (e) {
        store.run("ROLLBACK TO tg_import_student");
        store.run("RELEASE tg_import_student");
        if (!b.partial) throw e;
        store.run(
          "UPDATE tg_import_sources SET status='冲突',basis=? WHERE id=?",
          e.message,
          sourceId,
        );
      }
    }
    if (!store.get("SELECT id FROM tg_rules WHERE source_import_id=?", p.id)) {
      const conflict = store.get(
        "SELECT id FROM tg_rules WHERE student_id IS NULL AND effective_date<=? AND COALESCE(end_date,'9999-12-31')>=?",
        end,
        start,
      );
      store.run(
        "INSERT INTO tg_rules(effective_date,end_date,present,leave_fee,absent,notes,created_by,pending,source_import_id) VALUES (?,?,?,?,?,?,?,?,?)",
        start,
        end,
        p.rules.present,
        p.rules.leave_fee,
        p.rules.absent,
        conflict
          ? "来源历史规则与已有规则重叠，待核对"
          : p.rules_pending
            ? "来源参数与制度说明冲突，待核对"
            : "来源历史参数（归档），有效考勤按现行统一标准自动计费",
        actor,
        p.rules_pending || conflict ? 1 : 0,
        p.id,
      );
    }
    const sources = store.all(
      "SELECT * FROM tg_import_sources WHERE import_id=?",
      p.id,
    );
    const counts = store.get(
      "SELECT COUNT(*) n,COALESCE(SUM(fee),0) consumed FROM tg_attendance WHERE source_import_id=?",
      p.id,
    );
    const result = {
      success: counts.n,
      created: sources.filter(
        (s) => s.status === "已导入" && s.basis.startsWith("新建："),
      ).length,
      existing: sources.filter(
        (s) => s.status === "已导入" && !s.basis.startsWith("新建："),
      ).length,
      pending: sources.filter((s) => s.status === "待确认").length,
      conflicts: sources
        .filter((s) => s.status === "冲突")
        .map((s) => ({ source_key: s.source_key, reason: s.basis })),

      difference: p.difference,
      posted_amount: counts.consumed,
      note: "有效考勤已自动计费；历史期初与异常来源保留",
    };
    store.run(
      "UPDATE tg_imports SET result=? WHERE id=?",
      JSON.stringify(result),
      p.id,
    );
    store.audit(actor, "历史导入", { id: p.id, result });
    return result;
  });
}
module.exports = { preview, stage, commit, suggestions };
