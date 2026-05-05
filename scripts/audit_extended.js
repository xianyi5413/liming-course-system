const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");
const tempDir = path.join(rootDir, "data", ".audit-temp");
fs.mkdirSync(tempDir, { recursive: true });

const sourceDb = path.join(rootDir, "data", "liming-local.sqlite");
const tempDb = path.join(tempDir, `audit-ext-${Date.now()}.sqlite`);
fs.copyFileSync(sourceDb, tempDb);
["-wal", "-shm"].forEach((suffix) => {
  const p = sourceDb + suffix;
  if (fs.existsSync(p)) fs.copyFileSync(p, tempDb + suffix);
});

const originalEnv = { ...process.env };
process.env.DB_PATH = tempDb;
process.env.NODE_ENV = process.env.NODE_ENV || "development";

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
  feeDetails,
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

function studentSummaryHasSignalLocal(row) {
  return row.active_this_month
    || money(row.lesson_count) !== 0
    || money(row.total_fee) !== 0
    || money(row.prev_actual) !== 0
    || money(row.prev_gift) !== 0
    || money(row.cur_recharge) !== 0
    || money(row.cur_gift) !== 0
    || money(row.actual_balance) !== 0
    || money(row.gift_balance) !== 0
    || !!(row.recharge_date || "")
    || !!(row.recharge_notes || "");
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

// --- Excel fee extraction ---

function sourceFeeDetailRows(api, filename) {
  const workbookPath = path.join(rootDir, "data", "source-workbooks", filename);
  const sheet = api.readXlsxSheetRows(fs.readFileSync(workbookPath), "学生费用明细");
  const rows = [];
  for (const row of sheet.rows.filter((item) => item.source_row >= 3)) {
    const studentName = api.text(row.values[0]);
    if (!studentName) continue;
    const fee = money(api.num(row.values[10]));
    rows.push({
      source_row: row.source_row,
      student_name: studentName,
      lesson_status: api.text(row.values[3]),
      course_status: api.text(row.values[11]),
      fee,
      billable: sourceFeeRowBillable(api.text(row.values[3]), api.text(row.values[11]), fee),
    });
  }
  return rows;
}

function sourceFeeRowBillable(lessonStatus, courseStatus, fee) {
  if (!fee) return false;
  if (lessonStatus === "试课" || lessonStatus === "考试" || lessonStatus === "请假") return false;
  if (courseStatus === "已上" || courseStatus === "未缴费") return true;
  return lessonStatus === "上课（未缴费）";
}

function sourceFeeTotalsMap(api, filename) {
  const rows = sourceFeeDetailRows(api, filename);
  const totals = new Map();
  for (const row of rows) {
    if (!row.billable) continue;
    const name = key(row.student_name);
    const cur = totals.get(name) || { student_name: row.student_name, total_fee: 0, lesson_count: 0, rows: [] };
    cur.total_fee = money(cur.total_fee + row.fee);
    cur.lesson_count += 1;
    cur.rows.push(row.source_row);
    totals.set(name, cur);
  }
  return totals;
}

function sourceRechargeMap(api, filename, monthKey) {
  const workbookPath = path.join(rootDir, "data", "source-workbooks", filename);
  const sheet = api.readXlsxSheetRows(fs.readFileSync(workbookPath), "充值记录");
  const map = new Map();
  for (const row of sheet.rows.filter((item) => item.source_row >= 3)) {
    const studentName = api.text(row.values[0]);
    if (!studentName) continue;
    const name = key(studentName);
    if (map.has(name)) {
      const existing = map.get(name);
      existing.cur_recharge = money(existing.cur_recharge + money(api.num(row.values[4])));
      existing.cur_gift = money(existing.cur_gift + money(api.num(row.values[5])));
      existing.duplicates = (existing.duplicates || 0) + 1;
    } else {
      map.set(name, {
        student_name: studentName,
        source_row: row.source_row,
        prev_actual: money(api.num(row.values[2])),
        prev_gift: money(api.num(row.values[3])),
        cur_recharge: money(api.num(row.values[4])),
        cur_gift: money(api.num(row.values[5])),
        duplicates: 0,
      });
    }
  }
  return map;
}

// --- Main audit ---

function extendedAudit(api) {
  const workbooks = api.sourceWorkbooks()
    .filter((item) => item.month_key && item.filename.endsWith(".xlsx"))
    .sort((a, b) => a.month_key.localeCompare(b.month_key));

  const results = {
    fee_mismatches: [],
    missing_students: [],
    extra_students: [],
    duplicate_recharge: [],
    internal_consistency: [],
    actual_gift_swap_analysis: [],
    byMonth: new Map(),
    summary: { fee_checked: 0, fee_ok: 0, fee_mismatch: 0, internal_ok: 0, internal_bad: 0 },
  };

  for (const wb of workbooks) {
    const monthKey = wb.month_key;
    const filename = wb.filename;

    // Excel data
    const excelFees = sourceFeeTotalsMap(api, filename);
    const excelRecharges = sourceRechargeMap(api, filename, monthKey);

    // System data
    const data = api.bootstrap(monthKey, true);
    const sysSummary = new Map((data.derived.student_summary || []).map((r) => [key(r.student_name), r]));
    const sysRecharges = new Map((data.recharges || []).map((r) => [key(r.student_name), r]));

    let monthFeeChecked = 0;
    let monthFeeOk = 0;
    let monthFeeMismatch = 0;
    let monthInternalOk = 0;
    let monthInternalBad = 0;

    // 1. Compare fee totals: Excel "学生费用明细" vs system total_fee
    for (const [name, excelFee] of excelFees) {
      monthFeeChecked++;
      const sys = sysSummary.get(name);
      if (!sys) {
        results.missing_students.push({
          month_key: monthKey,
          student_name: excelFee.student_name,
          where: "student_summary",
          detail: `Excel 费用 ${excelFee.total_fee} (${excelFee.lesson_count} 课)，系统无此学生`,
        });
        monthFeeMismatch++;
        continue;
      }
      if (!sameMoney(excelFee.total_fee, sys.total_fee)) {
        results.fee_mismatches.push({
          month_key: monthKey,
          student_name: excelFee.student_name,
          excel_total_fee: excelFee.total_fee,
          system_total_fee: sys.total_fee,
          excel_lessons: excelFee.lesson_count,
          system_lessons: sys.lesson_count,
        });
        monthFeeMismatch++;
      } else {
        monthFeeOk++;
      }
    }

    // 2. Check if system has students with fees but Excel doesn't
    for (const [name, sys] of sysSummary) {
      if (!excelFees.has(name) && money(sys.total_fee) !== 0) {
        results.extra_students.push({
          month_key: monthKey,
          student_name: sys.student_name,
          system_total_fee: sys.total_fee,
          system_lessons: sys.lesson_count,
          detail: "系统有此学生费用但 Excel 学生费用明细中无记录",
        });
      }
    }

    // 3. Check for duplicate recharge rows in Excel
    for (const [name, recharge] of excelRecharges) {
      if (recharge.duplicates > 0) {
        results.duplicate_recharge.push({
          month_key: monthKey,
          student_name: recharge.student_name,
          count: recharge.duplicates + 1,
          detail: "Excel 充值记录中有多行同一学生",
        });
      }
    }

    // 4. Internal consistency: use SYSTEM's own numbers to verify arithmetic
    for (const [name, sys] of sysSummary) {
      if (!studentSummaryHasSignalLocal(sys)) continue;

      const sysPrevActual = money(sys.prev_actual);
      const sysPrevGift = money(sys.prev_gift);
      const sysCurRecharge = money(sys.cur_recharge);
      const sysCurGift = money(sys.cur_gift);
      const sysTotalFee = money(sys.total_fee);
      const sysActualBalance = money(sys.actual_balance);
      const sysGiftBalance = money(sys.gift_balance);

      const sysActualBase = money(sysPrevActual + sysCurRecharge + Math.min(sysPrevGift, 0));
      const sysAllFunds = money(sysPrevActual + sysCurRecharge + sysPrevGift + sysCurGift);
      const expectedActualBalance = money(sysActualBase >= sysTotalFee
        ? sysActualBase - sysTotalFee
        : Math.min(0, sysAllFunds - sysTotalFee));
      const expectedGiftBalance = money(sysActualBase >= sysTotalFee
        ? Math.max(sysPrevGift, 0) + sysCurGift
        : Math.max(0, sysAllFunds - sysTotalFee));

      const actualMatch = sameMoney(sysActualBalance, expectedActualBalance);
      const giftMatch = sameMoney(sysGiftBalance, expectedGiftBalance);

      if (!actualMatch || !giftMatch) {
        results.internal_consistency.push({
          month_key: monthKey,
          student_name: sys.student_name,
          sys_prev_actual: sysPrevActual,
          sys_prev_gift: sysPrevGift,
          sys_cur_recharge: sysCurRecharge,
          sys_cur_gift: sysCurGift,
          sys_total_fee: sysTotalFee,
          sys_actual_balance: sysActualBalance,
          sys_gift_balance: sysGiftBalance,
          expected_actual: expectedActualBalance,
          expected_gift: expectedGiftBalance,
        });
        monthInternalBad++;
      } else {
        monthInternalOk++;
      }
    }

    // 5. Analyze actual/gift swap pattern
    for (const [name, recharge] of excelRecharges) {
      const sys = sysSummary.get(name);
      if (!sys) continue;
      const excelPrevActual = recharge.prev_actual;
      const excelPrevGift = recharge.prev_gift;
      const sysPrevActual = money(sys.prev_actual);
      const sysPrevGift = money(sys.prev_gift);

      if (
        !sameMoney(excelPrevActual, sysPrevActual)
        && sameMoney(excelPrevActual, sysPrevGift)
        && sameMoney(excelPrevGift, sysPrevActual)
        && (Math.abs(excelPrevActual) > 0.01 || Math.abs(sysPrevActual) > 0.01)
      ) {
        results.actual_gift_swap_analysis.push({
          month_key: monthKey,
          student_name: recharge.student_name,
          excel_prev_actual: excelPrevActual,
          excel_prev_gift: excelPrevGift,
          sys_prev_actual: sysPrevActual,
          sys_prev_gift: sysPrevGift,
          pattern: "actual_gift_swapped",
        });
      }
    }

    results.byMonth.set(monthKey, {
      fee_checked: monthFeeChecked,
      fee_ok: monthFeeOk,
      fee_mismatch: monthFeeMismatch,
      internal_ok: monthInternalOk,
      internal_bad: monthInternalBad,
    });
  }

  return { results, workbooks };
}

// --- Report ---

function report(extended) {
  const { results, workbooks } = extended;
  const lines = [
    "# 扩展审计报告",
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
    "## 1. 费用对比：Excel 学生费用明细 vs 系统计算",
    "",
    `| 月份 | 已核对 | 一致 | 不一致 |`,
    "| --- | ---: | ---: | ---: |",
  ];

  const byMonth = new Map();
  for (const m of results.fee_mismatches) {
    if (!byMonth.has(m.month_key)) byMonth.set(m.month_key, []);
    byMonth.get(m.month_key).push(m);
  }
  for (const m of results.missing_students) {
    if (!byMonth.has(m.month_key)) byMonth.set(m.month_key, []);
    byMonth.get(m.month_key).push(m);
  }

  for (const wb of workbooks) {
    const stats = results.byMonth.get(wb.month_key) || { fee_checked: 0, fee_ok: 0, fee_mismatch: 0 };
    lines.push(`| ${wb.month_key} | ${stats.fee_checked} | ${stats.fee_ok} | ${stats.fee_mismatch} |`);
  }

  const allFeeIssues = [...results.fee_mismatches, ...results.missing_students];
  if (allFeeIssues.length) {
    lines.push("", "### 费用差异明细", "");
    lines.push("| 月份 | 学生 | Excel 费用 | 系统费用 | Excel 课次 | 系统课次 | 说明 |");
    lines.push("| --- | --- | ---: | ---: | ---: | ---: | --- |");
    for (const issue of results.fee_mismatches) {
      lines.push(`| ${issue.month_key} | ${issue.student_name} | ${issue.excel_total_fee} | ${issue.system_total_fee} | ${issue.excel_lessons} | ${issue.system_lessons} | |`);
    }
    for (const issue of results.missing_students) {
      lines.push(`| ${issue.month_key} | ${issue.student_name} | ${issue.detail.match(/Excel 费用 ([\d.]+)/)?.[1] || "?"} | 缺失 | | | ${issue.detail} |`);
    }
  } else {
    lines.push("", "Excel 学生费用明细与系统计算的费用完全一致。");
  }

  // Extra students
  if (results.extra_students.length) {
    lines.push("", "### 系统有费用但 Excel 无记录的学生", "");
    lines.push("| 月份 | 学生 | 系统费用 | 系统课次 | 说明 |");
    lines.push("| --- | --- | ---: | ---: | --- |");
    for (const issue of results.extra_students) {
      lines.push(`| ${issue.month_key} | ${issue.student_name} | ${issue.system_total_fee} | ${issue.system_lessons} | ${issue.detail} |`);
    }
  }

  // Duplicate recharge
  if (results.duplicate_recharge.length) {
    lines.push("", "## 2. Excel 充值记录重复行", "");
    lines.push("| 月份 | 学生 | 行数 | 说明 |");
    lines.push("| --- | --- | ---: | --- |");
    for (const issue of results.duplicate_recharge) {
      lines.push(`| ${issue.month_key} | ${issue.student_name} | ${issue.count} | ${issue.detail} |`);
    }
  } else {
    lines.push("", "## 2. Excel 充值记录重复行", "", "未发现重复。");
  }

  // Internal consistency
  lines.push("", "## 3. 系统内部一致性检查", "");
  lines.push("检查系统 student_summary 中 prev + cur_recharge - fee = closing_balance 是否自恰（使用系统自身数值）。");
  lines.push("");
  lines.push("| 月份 | 已核对 | 一致 | 不一致 |");
  lines.push("| --- | ---: | ---: | ---: |");
  const totalInternal = { ok: 0, bad: 0 };
  for (const wb of workbooks) {
    const stats = results.byMonth.get(wb.month_key) || { internal_ok: 0, internal_bad: 0 };
    totalInternal.ok += stats.internal_ok;
    totalInternal.bad += stats.internal_bad;
    lines.push(`| ${wb.month_key} | ${stats.internal_ok + stats.internal_bad} | ${stats.internal_ok} | ${stats.internal_bad} |`);
  }
  lines.push(`| **合计** | **${totalInternal.ok + totalInternal.bad}** | **${totalInternal.ok}** | **${totalInternal.bad}** |`);
  if (results.internal_consistency.length) {
    lines.push("", "### 不一致明细", "");
    lines.push("| 月份 | 学生 | prev实际 | prev赠送 | 充值实际 | 充值赠送 | 费用 | 系统实际余额 | 预期实际余额 | 系统赠送余额 | 预期赠送余额 |");
    lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const issue of results.internal_consistency) {
      lines.push(`| ${issue.month_key} | ${issue.student_name} | ${issue.sys_prev_actual} | ${issue.sys_prev_gift} | ${issue.sys_cur_recharge} | ${issue.sys_cur_gift} | ${issue.sys_total_fee} | ${issue.sys_actual_balance} | ${issue.expected_actual} | ${issue.sys_gift_balance} | ${issue.expected_gift} |`);
    }
  }

  // Actual/Gift swap analysis
  lines.push("", "## 4. actual/gift 列互换分析", "");
  lines.push("检测源表 prev_actual 与 prev_gift 是否在系统中被互换存储。");
  lines.push("");
  if (results.actual_gift_swap_analysis.length) {
    lines.push(`发现 ${results.actual_gift_swap_analysis.length} 个互换案例：`);
    lines.push("");
    lines.push("| 月份 | 学生 | Excel prev实际 | Excel prev赠送 | 系统 prev实际 | 系统 prev赠送 |");
    lines.push("| --- | --- | ---: | ---: | ---: | ---: |");
    for (const issue of results.actual_gift_swap_analysis) {
      lines.push(`| ${issue.month_key} | ${issue.student_name} | ${issue.excel_prev_actual} | ${issue.excel_prev_gift} | ${issue.sys_prev_actual} | ${issue.sys_prev_gift} |`);
    }
  } else {
    lines.push("未发现 actual/gift 列互换。");
  }

  return lines.join("\n");
}

let api;
try {
  api = loadServerInternals();
  const extended = extendedAudit(api);
  const reportText = report(extended);
  console.log(reportText);

  const outputPath = path.join(rootDir, "data", "audit_extended.md");
  fs.writeFileSync(outputPath, reportText, "utf8");
  console.log(`\nReport written to ${outputPath}`);
} finally {
  process.env = originalEnv;
  try { api?.closeDb?.(); } catch {}
  for (const file of [tempDb, `${tempDb}-wal`, `${tempDb}-shm`]) {
    try { fs.unlinkSync(file); } catch {}
  }
}
