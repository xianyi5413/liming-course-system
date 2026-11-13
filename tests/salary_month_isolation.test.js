const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
const W = require("../src/domain/salary_workflow");
const { createSalaryStore } = require("../src/domain/salary_store");
const PerformanceScore = require("../public/performance-score");
test("an input rendered for September saves September even after the selected month changes", async () => {
  const listeners = {},
    requests = [];
  const context = {
    PerformanceScore,
    document: { addEventListener: (name, fn) => (listeners[name] = fn) },
    auth: { user: { id: 1, role: "owner" } },
    canWriteData: () => true,
    canView: () => true,
    state: {
      settings: { month_key: "2026-10-01" },
      derived: { teacher_summary: [] },
    },
    activeMonth: "2026-10-01",
    view: "teacherSalary",
    load: async () => {},
    showToast: () => {},
    request: async (url, options) => {
      requests.push(options.body);
      return {};
    },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync("public/salary-workflow.js", "utf8"),
    context,
  );
  const input = {
    dataset: { teacher: "Synthetic teacher", month: "2026-09-01" },
    value: "90",
    isConnected: true,
    validity: {},
    matches: (s) => s.includes(".salary-score-input"),
  };
  await listeners.change({ target: input });
  assert.equal(requests[0].month_key, "2026-09-01");
});
test("an older month response cannot replace the newest selected month or rendered summary", async () => {
  const app = fs.readFileSync("public/app.js", "utf8");
  const code = app.slice(
    app.indexOf("async function refreshDerivedForActiveMonth("),
    app.indexOf("async function refreshDashboardForActiveMonth("),
  );
  const pending = [];
  const context = {
    activeMonth: "2026-09-01",
    view: "teacherSalary",
    loadGeneration: 0,
    auth: { user: { id: 1 } },
    state: {},
    bootstrapQuery: () => "?month=" + context.activeMonth,
    request: () => new Promise((r) => pending.push(r)),
    normalizeBootstrapState: (d) => d,
    syncActiveMonthState: (m) => (context.activeMonth = m),
    fullBootstrapCacheKey: (m) => m,
    rerenderCurrentView: (fn) => fn(),
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  let rendered = "";
  const first = context.refreshDerivedForActiveMonth(
    () => (rendered = context.activeMonth),
  );
  context.activeMonth = "2026-10-01";
  const second = context.refreshDerivedForActiveMonth(
    () => (rendered = context.activeMonth),
  );
  pending[1]({
    active_month_key: "2026-10-01",
    settings: { month_key: "2026-10-01" },
  });
  await second;
  pending[0]({
    active_month_key: "2026-09-01",
    settings: { month_key: "2026-09-01" },
  });
  await first;
  assert.equal(context.activeMonth, "2026-10-01");
  assert.equal(rendered, "2026-10-01");
});
test("scores, coefficients, resets and course allocation remain independent by teacher and month", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(
    "CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT);INSERT INTO teachers VALUES(1,'Synthetic teacher'),(2,'Other teacher');CREATE TABLE lessons(id INTEGER PRIMARY KEY,teacher_name TEXT,date TEXT,month_key TEXT,grade TEXT,course_type TEXT,student_names TEXT,time_slot TEXT,status TEXT,teacher_salary REAL,teacher_salary_source TEXT);",
  );
  W.migrateSalaryWorkflow(db);
  const s = createSalaryStore(db, {
    minutes: () => 120,
    legacyRule: () => null,
    eligible: () => true,
  });
  s.save({
    teacher_id: 1,
    effective_start: "2026-09-01",
    effective_end: "2026-10-31",
    rules: [{ grade: "初一", course_type: "1V1", formula: "100+40K" }],
  });
  const get = (month, name = "Synthetic teacher") =>
    db
      .prepare(
        "SELECT * FROM teacher_monthly_performance WHERE teacher_name=? AND month_key=?",
      )
      .get(name, month);
  s.score("Synthetic teacher", "2026-09-01", 90);
  s.score("Synthetic teacher", "2026-10-01", 95);
  s.score("Other teacher", "2026-09-01", 80);
  s.score("Synthetic teacher", "2026-09-01", 85);
  assert.equal(get("2026-10-01").performance_score, 95);
  s.score("Synthetic teacher", "2026-10-01", 99);
  assert.equal(get("2026-09-01").performance_score, 85);
  s.coefficient("Synthetic teacher", "2026-09-01", 0.5);
  assert.equal(get("2026-10-01").coefficient, PerformanceScore.coefficient(99));
  s.score("Synthetic teacher", "2026-09-01", null);
  assert.equal(get("2026-09-01").performance_score, null);
  assert.equal(get("2026-09-01").coefficient, 0.5);
  assert.equal(get("2026-09-01", "Other teacher").performance_score, 80);
  const lessons = ["09", "10", "11"].map((month, i) => ({
    id: i + 1,
    teacher_name: "Synthetic teacher",
    date: `2026-${month}-12`,
    month_key: `2026-${month}-01`,
    grade: "初一",
    course_type: "1V1",
    student_names: "Synthetic student",
  }));
  const coefficients = new Map(
    db
      .prepare("SELECT * FROM teacher_monthly_performance")
      .all()
      .map((r) => [
        JSON.stringify([r.teacher_name, r.month_key]),
        r.coefficient,
      ]),
  );
  const allocated = s.allocate(lessons.slice(0, 2), coefficients);
  assert.equal(allocated.get(1).teacher_payroll_amount, 120);
  assert.equal(
    allocated.get(2).teacher_payroll_amount,
    100 + 40 * PerformanceScore.coefficient(99),
  );
  s.coefficient("Synthetic teacher", "2026-09-01", null);
  assert.equal(get("2026-09-01"), undefined);
  assert.equal(get("2026-10-01").performance_score, 99);
  assert.equal(get("2026-11-01"), undefined);
  const reset = s.allocate(lessons.slice(0, 2), new Map());
  assert.equal(reset.get(1).teacher_payroll_amount, 140);
});
