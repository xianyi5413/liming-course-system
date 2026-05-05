const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");

function loadServerInternals() {
  const serverPath = path.join(rootDir, "src", "server.js");
  const source = fs.readFileSync(serverPath, "utf8");
  const marker = "\nconst server = http.createServer";
  const index = source.indexOf(marker);
  if (index === -1) throw new Error("Cannot find server bootstrap marker");
  const instrumented = `${source.slice(0, index)}
globalThis.__syncApi = {
  sourceWorkbooks,
  importSourceWorkbook,
  backupDb,
  bootstrap,
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
  return context.__syncApi;
}

function parseMonths(argv) {
  const arg = argv.find((item) => item.startsWith("--months="));
  const raw = arg ? arg.slice("--months=".length) : "2026-02-01,2026-03-01,2026-04-01,2026-05-01";
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

let api;
try {
  api = loadServerInternals();
  const months = parseMonths(process.argv.slice(2));
  const workbooks = new Map(api.sourceWorkbooks()
    .filter((item) => item.month_key && item.filename.endsWith(".xlsx"))
    .map((item) => [item.month_key, item]));
  const missing = months.filter((monthKey) => !workbooks.has(monthKey));
  if (missing.length) throw new Error(`Missing source workbooks for months: ${missing.join(", ")}`);

  const backup = api.backupDb(`pre_source_sync_${months[0].slice(0, 7)}_${months.at(-1).slice(0, 7)}`);
  const results = [];
  for (const monthKey of months) {
    const workbook = workbooks.get(monthKey);
    const result = api.importSourceWorkbook(workbook.filename, monthKey, { append: false });
    const data = api.bootstrap(monthKey, true);
    results.push({
      month_key: monthKey,
      filename: workbook.filename,
      lessons: result.lessons,
      recharges: result.recharges,
      fee_overrides: result.fee_overrides,
      fee_override_unmatched: result.fee_override_unmatched,
      student_prices: result.student_prices,
      pricing_standards: result.pricing_standards,
      teacher_adjustments: result.teacher_adjustments,
      summary_rows: data.derived.student_summary.length,
      import_backup: result.backup,
    });
  }

  console.log(JSON.stringify({
    ok: true,
    backup,
    months,
    results,
  }, null, 2));
} finally {
  try {
    api?.closeDb?.();
  } catch {}
}
