const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");
const tempDir = path.join(rootDir, "data", ".audit-temp");
fs.mkdirSync(tempDir, { recursive: true });

const sourceDb = path.join(rootDir, "data", "liming-local.sqlite");
const tempDb = path.join(tempDir, `audit-${Date.now()}.sqlite`);
copySqliteSnapshot(sourceDb, tempDb);

const ADJACENT_OPENING_IGNORES = new Set([
  "2026-02-01 -> 2026-03-01|何汪洋|prev_actual",
  "2026-02-01 -> 2026-03-01|何汪洋|prev_gift",
  "2026-02-01 -> 2026-03-01|陶姝岩|prev_actual",
  "2026-02-01 -> 2026-03-01|汪孝阳|prev_actual",
  "2026-02-01 -> 2026-03-01|汪雨琪|prev_actual",
]);

const originalEnv = { ...process.env };
process.env.DB_PATH = tempDb;

function copyIfExists(from, to) {
  if (fs.existsSync(from)) fs.copyFileSync(from, to);
}

function copySqliteSnapshot(from, to) {
  fs.copyFileSync(from, to);
  copyIfExists(`${from}-wal`, `${to}-wal`);
  copyIfExists(`${from}-shm`, `${to}-shm`);
}

function loadServerInternals() {
  const serverPath = path.join(rootDir, "src", "server.js");
  const source = fs.readFileSync(serverPath, "utf8");
  const marker = "\nconst server = http.createServer";
  const index = source.indexOf(marker);
  if (index === -1) throw new Error("Cannot find server bootstrap marker");
  const instrumented = `${source.slice(0, index)}
globalThis.__auditApi = {
  bootstrap,
  sourceWorkbooks,
  readXlsxSheetRows,
  monthKeyFromFilename,
  text,
  num,
  isoDateValue,
  moneyRound,
  studentSummaryHasSignal,
  importSourceWorkbook,
  closeDb: () => {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
  },
};`;
  const context = {
    require,
    console,
    process,
    Buffer,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    __dirname: path.join(rootDir, "src"),
    __filename: serverPath,
    globalThis: null,
  };
  context.globalThis = context;
  vm.runInNewContext(instrumented, context, { filename: serverPath });
  return context.__auditApi;
}

function key(name) {
  return String(name || "").trim();
}

function money(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function sameMoney(a, b) {
  return Math.abs(money(a) - money(b)) < 0.005;
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function adjacentIssueKey(issue) {
  return `${issue.pair}|${issue.student_name}|${issue.field}`;
}

function splitIgnoredAdjacentIssues(issues) {
  const visible = [];
  const ignored = [];
  for (const issue of issues) {
    if (ADJACENT_OPENING_IGNORES.has(adjacentIssueKey(issue))) {
      ignored.push(issue);
    } else {
      visible.push(issue);
    }
  }
  return { visible, ignored };
}

function sourceRechargeRows(api, filename, monthKey) {
  const workbookPath = path.join(rootDir, "data", "source-workbooks", filename);
  const sheet = api.readXlsxSheetRows(fs.readFileSync(workbookPath), "充值记录");
  const rows = [];
  for (const row of sheet.rows.filter((item) => item.source_row >= 3)) {
    const studentName = api.text(row.values[0]);
    if (!studentName) continue;
    rows.push({
      source_row: row.source_row,
      student_name: studentName,
      grade: api.text(row.values[1]),
      prev_actual: money(api.num(row.values[2])),
      prev_gift: money(api.num(row.values[3])),
      cur_recharge: money(api.num(row.values[4])),
      cur_gift: money(api.num(row.values[5])),
      recharge_date: api.isoDateValue(row.values[6]),
      notes: api.text(row.values[7]),
      month_key: monthKey,
    });
  }
  return rows;
}

function sourceFeeTotalsByMonth(api, workbooks) {
  const lessonsByMonth = new Map();
  for (const workbook of workbooks) {
    const workbookPath = path.join(rootDir, "data", "source-workbooks", workbook.filename);
    const sheet = api.readXlsxSheetRows(fs.readFileSync(workbookPath), "学生费用明细");
    for (const row of sheet.rows.filter((item) => item.source_row >= 3)) {
      const studentName = api.text(row.values[0]);
      if (!studentName) continue;
      const lessonStatus = api.text(row.values[3]);
      const courseStatus = api.text(row.values[11]);
      const fee = money(api.num(row.values[10]));
      if (!sourceFeeRowBillableStatus(lessonStatus, courseStatus)) continue;
      const isoDate = api.isoDateValue(row.values[2]);
      const rowMonthKey = isoDate ? `${isoDate.slice(0, 7)}-01` : workbook.month_key;
      const teacher = api.text(row.values[1]);
      const timeSlot = api.text(row.values[5]);
      const classroom = api.text(row.values[6]);
      const subject = api.text(row.values[8]);
      const lessonKey = `${isoDate}|${teacher}|${timeSlot}|${classroom}|${subject}|${key(studentName)}`;
      const monthLessons = lessonsByMonth.get(rowMonthKey) || new Map();
      monthLessons.set(lessonKey, { student_name: studentName, fee, source_workbook: workbook.filename });
      lessonsByMonth.set(rowMonthKey, monthLessons);
    }
  }
  const byMonth = new Map();
  for (const [monthKey, lessons] of lessonsByMonth) {
    const monthMap = new Map();
    for (const lesson of lessons.values()) {
      const name = key(lesson.student_name);
      const current = monthMap.get(name) || { student_name: lesson.student_name, total_fee: 0, lesson_count: 0 };
      current.total_fee = money(current.total_fee + lesson.fee);
      current.lesson_count += 1;
      monthMap.set(name, current);
    }
    byMonth.set(monthKey, monthMap);
  }
  return byMonth;
}

function sourceFeeRowBillableStatus(lessonStatus, courseStatus) {
  if (lessonStatus === "试课" || lessonStatus === "考试" || lessonStatus === "请假") return false;
  if (courseStatus === "已上" || courseStatus === "未缴费") return true;
  return lessonStatus === "上课（未缴费）";
}

function sourceWorkbookData(api, workbook, feeTotals) {
  const recharges = sourceRechargeRows(api, workbook.filename, workbook.month_key);
  const fees = feeTotals || new Map();
  const byStudent = new Map();

  for (const row of recharges) {
    const name = key(row.student_name);
    const existing = byStudent.get(name);
    if (existing) {
      existing.duplicate_recharge_rows.push(row.source_row);
      existing.cur_recharge = money(existing.cur_recharge + row.cur_recharge);
      existing.cur_gift = money(existing.cur_gift + row.cur_gift);
      if (!existing.grade && row.grade) existing.grade = row.grade;
      continue;
    }
    byStudent.set(name, {
      ...row,
      total_fee: 0,
      lesson_count: 0,
      duplicate_recharge_rows: [],
    });
  }

  for (const [name, fee] of fees) {
    if (!byStudent.has(name)) {
      byStudent.set(name, {
        source_row: "",
        student_name: fee.student_name,
        grade: "",
        prev_actual: 0,
        prev_gift: 0,
        cur_recharge: 0,
        cur_gift: 0,
        recharge_date: "",
        notes: "",
        month_key: workbook.month_key,
        total_fee: 0,
        lesson_count: 0,
        duplicate_recharge_rows: [],
      });
    }
    const target = byStudent.get(name);
    target.total_fee = money(fee.total_fee);
    target.lesson_count = fee.lesson_count;
  }

  const summaries = new Map();
  for (const [name, row] of byStudent) {
    const prevActual = money(row.prev_actual);
    const prevGift = money(row.prev_gift);
    const curRecharge = money(row.cur_recharge);
    const curGift = money(row.cur_gift);
    const totalFee = money(row.total_fee);
    const actualBase = money(prevActual + curRecharge + Math.min(prevGift, 0));
    const giftBase = money(Math.max(prevGift, 0) + curGift);
    const actualConsumption = money(Math.min(totalFee, Math.max(0, actualBase)));
    const remainingFee = money(totalFee - actualConsumption);
    const giftConsumption = money(Math.min(remainingFee, Math.max(0, giftBase)));
    const unpaidFee = money(remainingFee - giftConsumption);
    const actualBalance = money(actualBase - actualConsumption - unpaidFee);
    const giftBalance = money(giftBase - giftConsumption);
    summaries.set(name, {
      ...row,
      total_fee: totalFee,
      actual_consumption: actualConsumption,
      gift_consumption: giftConsumption,
      actual_balance: actualBalance,
      gift_balance: giftBalance,
    });
  }

  return {
    workbook,
    recharges,
    rechargeByStudent: new Map(recharges.map((row) => [key(row.student_name), row])),
    summaries,
  };
}

function addMismatch(issues, monthKey, studentName, field, source, system, where, detail = "") {
  if (sameMoney(source, system)) return;
  issues.push({
    month_key: monthKey,
    student_name: studentName,
    field,
    source_value: money(source),
    system_value: money(system),
    where,
    detail,
  });
}

function auditMonth(api, workbook, feeTotalsByMonth) {
  const monthKey = workbook.month_key;
  const sourceRows = sourceRechargeRows(api, workbook.filename, monthKey);
  const sourceByStudent = new Map(sourceRows.map((row) => [key(row.student_name), row]));
  const monthFees = feeTotalsByMonth?.get(monthKey) || new Map();
  const sourceData = sourceWorkbookData(api, workbook, monthFees);
  const data = api.bootstrap(monthKey, true);
  const rechargeByStudent = new Map((data.recharges || []).map((row) => [key(row.student_name), row]));
  const summaryByStudent = new Map((data.derived.student_summary || []).map((row) => [key(row.student_name), row]));
  const issues = [];

  for (const source of sourceRows) {
    const name = key(source.student_name);
    const recharge = rechargeByStudent.get(name);
    const summary = summaryByStudent.get(name);
    if (!recharge) {
      issues.push({ month_key: monthKey, student_name: source.student_name, field: "recharge_row", source_value: "存在", system_value: "缺失", where: "recharge_records", detail: `xlsx row ${source.source_row}` });
      continue;
    }
    if (!summary) {
      issues.push({ month_key: monthKey, student_name: source.student_name, field: "summary_row", source_value: "存在", system_value: "缺失", where: "student_summary", detail: `xlsx row ${source.source_row}` });
      continue;
    }

    addMismatch(issues, monthKey, source.student_name, "prev_actual", source.prev_actual, summary.prev_actual, "student_summary", summary.prev_source_month ? `auto from ${summary.prev_source_month}` : "source opening");
    addMismatch(issues, monthKey, source.student_name, "prev_gift", source.prev_gift, summary.prev_gift, "student_summary", summary.prev_source_month ? `auto from ${summary.prev_source_month}` : "source opening");
    addMismatch(issues, monthKey, source.student_name, "cur_recharge", source.cur_recharge, summary.cur_recharge, "student_summary");
    addMismatch(issues, monthKey, source.student_name, "cur_gift", source.cur_gift, summary.cur_gift, "student_summary");

    addMismatch(issues, monthKey, source.student_name, "stored_prev_actual", source.prev_actual, recharge.prev_actual, "recharge_records");
    addMismatch(issues, monthKey, source.student_name, "stored_prev_gift", source.prev_gift, recharge.prev_gift, "recharge_records");
    addMismatch(issues, monthKey, source.student_name, "stored_cur_recharge", source.cur_recharge, recharge.cur_recharge, "recharge_records");
    addMismatch(issues, monthKey, source.student_name, "stored_cur_gift", source.cur_gift, recharge.cur_gift, "recharge_records");
  }

  for (const [name, sourceSummary] of sourceData.summaries) {
    if (!sourceSummaryHasSignal(sourceSummary)) continue;
    const summary = summaryByStudent.get(name);
    if (!summary) {
      issues.push({ month_key: monthKey, student_name: sourceSummary.student_name, field: "summary_row", source_value: "存在", system_value: "缺失", where: "student_summary", detail: "source workbook summary" });
      continue;
    }
    addMismatch(issues, monthKey, sourceSummary.student_name, "lesson_count", sourceSummary.lesson_count, summary.lesson_count, "student_summary");
    addMismatch(issues, monthKey, sourceSummary.student_name, "total_fee", sourceSummary.total_fee, summary.total_fee, "student_summary");
    addMismatch(issues, monthKey, sourceSummary.student_name, "actual_balance", sourceSummary.actual_balance, summary.actual_balance, "student_summary");
    addMismatch(issues, monthKey, sourceSummary.student_name, "gift_balance", sourceSummary.gift_balance, summary.gift_balance, "student_summary");
  }

  for (const recharge of data.recharges || []) {
    const name = key(recharge.student_name);
    if (!sourceByStudent.has(name) && (
      money(recharge.prev_actual) !== 0
      || money(recharge.prev_gift) !== 0
      || money(recharge.cur_recharge) !== 0
      || money(recharge.cur_gift) !== 0
    )) {
      issues.push({
        month_key: monthKey,
        student_name: recharge.student_name,
        field: "extra_recharge_row",
        source_value: "缺失",
        system_value: "存在",
        where: "recharge_records",
        detail: `prev=${money(recharge.prev_actual)}/${money(recharge.prev_gift)}, cur=${money(recharge.cur_recharge)}/${money(recharge.cur_gift)}, source=${recharge.source || ""}`,
      });
    }
  }

  for (const summary of data.derived.student_summary || []) {
    const name = key(summary.student_name);
    if (!sourceData.summaries.has(name) && sourceSummaryHasSignal(summary)) {
      issues.push({
        month_key: monthKey,
        student_name: summary.student_name,
        field: "extra_summary_row",
        source_value: "缺失",
        system_value: "存在",
        where: "student_summary",
        detail: `lesson_count=${money(summary.lesson_count)}, total_fee=${money(summary.total_fee)}`,
      });
    }
  }

  return {
    month_key: monthKey,
    filename: workbook.filename,
    source_rows: sourceRows.length,
    system_recharges: (data.recharges || []).length,
    system_summaries: (data.derived.student_summary || []).length,
    issues,
  };
}

function addAdjacentMismatch(issues, pair, studentName, field, expected, actual, detail = "") {
  if (sameMoney(expected, actual)) return;
  issues.push({
    pair,
    student_name: studentName,
    field,
    previous_ending: money(expected),
    next_opening: money(actual),
    detail,
  });
}

function sourceSummaryHasSignal(row) {
  return !!row && (
    money(row.total_fee) !== 0
    || money(row.prev_actual) !== 0
    || money(row.prev_gift) !== 0
    || money(row.cur_recharge) !== 0
    || money(row.cur_gift) !== 0
    || money(row.actual_balance) !== 0
    || money(row.gift_balance) !== 0
    || !!textForReport(row.recharge_date)
    || !!textForReport(row.notes)
  );
}

function textForReport(value) {
  return String(value || "").trim();
}

function auditAdjacentWorkbooks(api, workbooks, feeTotalsByMonth) {
  const data = workbooks.map((workbook) => sourceWorkbookData(api, workbook, feeTotalsByMonth?.get(workbook.month_key) || new Map()));
  const results = [];
  for (let index = 1; index < data.length; index += 1) {
    const previous = data[index - 1];
    const current = data[index];
    const pair = `${previous.workbook.month_key} -> ${current.workbook.month_key}`;
    const issues = [];
    let checked = 0;

    for (const currentRow of current.recharges) {
      const name = key(currentRow.student_name);
      const previousSummary = previous.summaries.get(name);
      checked += 1;
      addAdjacentMismatch(
        issues,
        pair,
        currentRow.student_name,
        "prev_actual",
        previousSummary?.actual_balance || 0,
        currentRow.prev_actual,
        previousSummary ? `上月费用 ${money(previousSummary.total_fee)}，上月充值 ${money(previousSummary.cur_recharge)}` : "上月源表没有该学生费用/充值记录",
      );
      addAdjacentMismatch(
        issues,
        pair,
        currentRow.student_name,
        "prev_gift",
        previousSummary?.gift_balance || 0,
        currentRow.prev_gift,
        previousSummary ? `上月赠送结余 ${money(previousSummary.gift_balance)}` : "上月源表没有该学生费用/充值记录",
      );
      const currentSummary = current.summaries.get(name);
      if (currentSummary?.duplicate_recharge_rows?.length) {
        issues.push({
          pair,
          student_name: currentRow.student_name,
          field: "duplicate_recharge_rows",
          previous_ending: "重复",
          next_opening: [currentRow.source_row, ...currentSummary.duplicate_recharge_rows].join(", "),
          detail: "同一学生在本月充值记录中出现多行，结转核对已合并本月充值金额",
        });
      }
    }

    for (const previousSummary of previous.summaries.values()) {
      if (!sourceSummaryHasSignal(previousSummary)) continue;
      if (sameMoney(previousSummary.actual_balance, 0) && sameMoney(previousSummary.gift_balance, 0)) continue;
      const name = key(previousSummary.student_name);
      if (current.rechargeByStudent.has(name)) continue;
      issues.push({
        pair,
        student_name: previousSummary.student_name,
        field: "missing_next_recharge_row",
        previous_ending: `${money(previousSummary.actual_balance)} / ${money(previousSummary.gift_balance)}`,
        next_opening: "缺失",
        detail: "上月期末仍有实际/赠送结余，但下月充值记录中没有该学生",
      });
    }

    const { visible, ignored } = splitIgnoredAdjacentIssues(issues);
    results.push({
      pair,
      previous_month: previous.workbook.month_key,
      current_month: current.workbook.month_key,
      previous_file: previous.workbook.filename,
      current_file: current.workbook.filename,
      previous_summary_rows: previous.summaries.size,
      current_recharge_rows: current.recharges.length,
      checked_opening_rows: checked,
      issues: visible,
      ignored_issues: ignored,
    });
  }
  return results;
}

function markdownReport(results, adjacentResults) {
  const lines = [
    "# 源表 vs 系统充值和费用汇总核对",
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
    "| 月份 | 源表充值行 | 系统充值行 | 费用汇总行 | 问题数 |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const result of results) {
    lines.push(`| ${result.month_key} | ${result.source_rows} | ${result.system_recharges} | ${result.system_summaries} | ${result.issues.length} |`);
  }

  lines.push("", "## 相邻 Excel 结转核对", "");
  lines.push("核对逻辑：用上一个 Excel 的「充值记录」+「学生费用明细」计算学生期末实际/赠送余额，再与下一个 Excel「充值记录」中的上月实际/赠送结转比对。");
  lines.push("");
  lines.push("| 月份对 | 上月汇总学生 | 下月充值行 | 已核对下月行 | 问题数 | 已忽略 |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const result of adjacentResults) {
    lines.push(`| ${result.pair} | ${result.previous_summary_rows} | ${result.current_recharge_rows} | ${result.checked_opening_rows} | ${result.issues.length} | ${result.ignored_issues?.length || 0} |`);
  }
  const ignoredAdjacentIssues = adjacentResults.flatMap((result) => result.ignored_issues || []);
  if (ignoredAdjacentIssues.length) {
    lines.push("", `已按历史业务口径忽略 ${ignoredAdjacentIssues.length} 条相邻 Excel 结转差异。`);
  }

  const adjacentIssues = adjacentResults.flatMap((result) => result.issues);
  lines.push("", "### 相邻 Excel 明细问题", "");
  if (!adjacentIssues.length) {
    lines.push("未发现相邻 Excel 月份之间的上月结转差异。");
  } else {
    lines.push("| 月份对 | 学生 | 字段 | 上月期末 | 下月上月结转 | 说明 |");
    lines.push("| --- | --- | --- | ---: | ---: | --- |");
    for (const issue of adjacentIssues) {
      lines.push(`| ${markdownCell(issue.pair)} | ${markdownCell(issue.student_name)} | ${markdownCell(issue.field)} | ${markdownCell(issue.previous_ending)} | ${markdownCell(issue.next_opening)} | ${markdownCell(issue.detail)} |`);
    }
  }

  lines.push("", "## 明细问题", "");
  const issues = results.flatMap((result) => result.issues);
  if (!issues.length) {
    lines.push("未发现源表充值记录与系统充值/费用汇总之间的金额差异。");
    return lines.join("\n");
  }
  lines.push("| 月份 | 学生 | 字段 | 源表 | 系统 | 位置 | 说明 |");
  lines.push("| --- | --- | --- | ---: | ---: | --- | --- |");
  for (const issue of issues) {
    lines.push(`| ${markdownCell(issue.month_key)} | ${markdownCell(issue.student_name)} | ${markdownCell(issue.field)} | ${markdownCell(issue.source_value)} | ${markdownCell(issue.system_value)} | ${markdownCell(issue.where)} | ${markdownCell(issue.detail || "")} |`);
  }
  return lines.join("\n");
}

function parseSyncMonths(argv) {
  const prefix = "--simulate-sync=";
  const raw = argv.find((item) => item.startsWith(prefix));
  if (!raw) return [];
  return raw.slice(prefix.length)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function simulateSync(api, workbooks, months) {
  if (!months.length) return [];
  const byMonth = new Map(workbooks.map((workbook) => [workbook.month_key, workbook]));
  const feeTotalsByMonth = sourceFeeTotalsByMonth(api, workbooks);
  const results = [];
  for (const monthKey of months) {
    const workbook = byMonth.get(monthKey);
    if (!workbook) throw new Error(`Cannot simulate ${monthKey}: no source workbook found`);
    const before = auditMonth(api, workbook, feeTotalsByMonth);
    const imported = api.importSourceWorkbook(workbook.filename, workbook.month_key, { append: false });
    const after = auditMonth(api, workbook, feeTotalsByMonth);
    results.push({
      month_key: monthKey,
      filename: workbook.filename,
      before_issues: before.issues.length,
      after_issues: after.issues.length,
      lessons: imported.lessons,
      recharges: imported.recharges,
      student_prices: imported.student_prices,
      pricing_standards: imported.pricing_standards,
      teacher_adjustments: imported.teacher_adjustments,
      carry_over_updated: imported.carry_over?.updated || 0,
      carry_over_skipped: imported.carry_over?.skipped || 0,
      remaining_issues: after.issues,
    });
  }
  return results;
}

function markdownSyncSimulation(results) {
  if (!results.length) return "";
  const lines = [
    "",
    "## 临时库 Excel 同步模拟",
    "",
    "说明：此段只在临时 SQLite 副本中按 Excel 重放导入，不修改正式数据库。",
    "",
    "| 月份 | 文件 | 导入前问题 | 导入后问题 | 课程 | 充值 | 单价 | 标准 | 教师调整 | 结转更新/跳过 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const result of results) {
    lines.push(`| ${markdownCell(result.month_key)} | ${markdownCell(result.filename)} | ${result.before_issues} | ${result.after_issues} | ${result.lessons} | ${result.recharges} | ${result.student_prices} | ${result.pricing_standards} | ${result.teacher_adjustments} | ${result.carry_over_updated}/${result.carry_over_skipped} |`);
  }
  const issues = results.flatMap((result) => result.remaining_issues.map((issue) => ({ ...issue, month_key: result.month_key })));
  lines.push("", "### 同步模拟后仍未对齐", "");
  if (!issues.length) {
    lines.push("模拟导入后，源表充值记录与系统充值/费用汇总已全部对齐。");
    return lines.join("\n");
  }
  lines.push("| 月份 | 学生 | 字段 | 源表 | 系统 | 位置 | 说明 |");
  lines.push("| --- | --- | --- | ---: | ---: | --- | --- |");
  for (const issue of issues) {
    lines.push(`| ${markdownCell(issue.month_key)} | ${markdownCell(issue.student_name)} | ${markdownCell(issue.field)} | ${markdownCell(issue.source_value)} | ${markdownCell(issue.system_value)} | ${markdownCell(issue.where)} | ${markdownCell(issue.detail || "")} |`);
  }
  return lines.join("\n");
}

let api;
try {
  api = loadServerInternals();
  const workbooks = api.sourceWorkbooks()
    .filter((item) => item.month_key && item.filename.endsWith(".xlsx"))
    .sort((a, b) => a.month_key.localeCompare(b.month_key));
  const syncResults = simulateSync(api, workbooks, parseSyncMonths(process.argv.slice(2)));
  const feeTotalsByMonth = sourceFeeTotalsByMonth(api, workbooks);
  const results = workbooks.map((workbook) => auditMonth(api, workbook, feeTotalsByMonth));
  const adjacentResults = auditAdjacentWorkbooks(api, workbooks, feeTotalsByMonth);
  const report = `${markdownReport(results, adjacentResults)}${markdownSyncSimulation(syncResults)}`;
  const outputPath = syncResults.length
    ? path.join(rootDir, "data", "audit_source_sync_simulation.md")
    : path.join(rootDir, "data", "audit_source_vs_summary.md");
  fs.writeFileSync(outputPath, report, "utf8");
  console.log(report);
  console.log(`\nReport written to ${outputPath}`);
} finally {
  process.env = originalEnv;
  try {
    api?.closeDb?.();
  } catch {}
  for (const file of [tempDb, `${tempDb}-wal`, `${tempDb}-shm`]) {
    try {
      fs.unlinkSync(file);
    } catch {}
  }
}
