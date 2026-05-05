const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");
const tempDir = path.join(rootDir, "data", ".audit-temp");
fs.mkdirSync(tempDir, { recursive: true });

const sourceDb = path.join(rootDir, "data", "liming-local.sqlite");
const tempDb = path.join(tempDir, `audit-${Date.now()}.sqlite`);
fs.copyFileSync(sourceDb, tempDb);

const originalEnv = { ...process.env };
process.env.DB_PATH = tempDb;

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

function auditMonth(api, workbook) {
  const monthKey = workbook.month_key;
  const sourceRows = sourceRechargeRows(api, workbook.filename, monthKey);
  const sourceByStudent = new Map(sourceRows.map((row) => [key(row.student_name), row]));
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

  return {
    month_key: monthKey,
    filename: workbook.filename,
    source_rows: sourceRows.length,
    system_recharges: (data.recharges || []).length,
    system_summaries: (data.derived.student_summary || []).length,
    issues,
  };
}

function markdownReport(results) {
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
  lines.push("", "## 明细问题", "");
  const issues = results.flatMap((result) => result.issues);
  if (!issues.length) {
    lines.push("未发现源表充值记录与系统充值/费用汇总之间的金额差异。");
    return lines.join("\n");
  }
  lines.push("| 月份 | 学生 | 字段 | 源表 | 系统 | 位置 | 说明 |");
  lines.push("| --- | --- | --- | ---: | ---: | --- | --- |");
  for (const issue of issues) {
    lines.push(`| ${issue.month_key} | ${issue.student_name} | ${issue.field} | ${issue.source_value} | ${issue.system_value} | ${issue.where} | ${issue.detail || ""} |`);
  }
  return lines.join("\n");
}

try {
  const api = loadServerInternals();
  const workbooks = api.sourceWorkbooks()
    .filter((item) => item.month_key && item.filename.endsWith(".xlsx"))
    .sort((a, b) => a.month_key.localeCompare(b.month_key));
  const results = workbooks.map((workbook) => auditMonth(api, workbook));
  const report = markdownReport(results);
  const outputPath = path.join(rootDir, "data", "audit_source_vs_summary.md");
  fs.writeFileSync(outputPath, report, "utf8");
  console.log(report);
  console.log(`\nReport written to ${outputPath}`);
} finally {
  process.env = originalEnv;
  try {
    fs.unlinkSync(tempDb);
  } catch {}
}
