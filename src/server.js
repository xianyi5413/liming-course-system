const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, "data"));
const dbPath = path.resolve(process.env.DB_PATH || path.join(dataDir, "liming-local.sqlite"));
const port = Number(process.env.PORT || 5177);
const secureCookies = process.env.SESSION_COOKIE_SECURE !== "0" && process.env.SESSION_COOKIE_SECURE !== "false";
const sessions = new Map();

const LESSON_STATUS = ["上课", "试课", "监考", "休息", "上课（未缴费）", "待定", "请假", "考试"];
const COURSE_STATUS = ["未上", "已上", "请假", "暂停一次", "暂停一阵"];
const STATUS = ["待上", "已上", "请假", "试课", "考试", "未缴费"];
const CLASSROOMS = [
  "C1", "C2", "C3", "C4", "C5",
  "B1", "B2", "B3", "B4",
  "A1", "A2", "A3",
  "101-1", "101-2", "101-3", "101-4",
  "39-5", "39-6", "39-7",
  "101", "39",
];
const SUBJECTS = ["英语", "数学", "物理", "语文", "生物", "化学", "地理", "道法", "历史"];
const STAFF_ROLES = ["教学主管", "教务主管", "小助手", "做饭阿姨", "前台", "其他"];
const EXPENSE_CATEGORIES = ["房租", "水电", "食材", "办公", "维修", "推广", "杂项", "其他"];
const ATTENDANCE_STATUS = ["上班", "休息", "请假", "病假", "事假", "半天", "加班", "调休", "旷工"];
const ATTENDANCE_PAY_UNITS = {
  上班: 1,
  休息: 0,
  请假: 0,
  病假: 0,
  事假: 0,
  半天: 0.5,
  加班: 1.5,
  调休: 0,
  旷工: 0,
};
const USER_ROLES = {
  owner: "Qing",
  admin: "管理员",
  academic: "教务",
  finance: "财务",
  teacher: "老师",
};
const GRADES = [
  { name: "初一", color: "#E8F5E9" },
  { name: "初二", color: "#E3F2FD" },
  { name: "初三", color: "#FFF3E0" },
  { name: "高一", color: "#F3E5F5" },
  { name: "高二", color: "#E0F7FA" },
  { name: "高三", color: "#FBE9E7" },
];
const PRICING = [
  ["高三", 1, 600, "1对1"], ["高三", 2, 460, "1对2"], ["高三", 3, 390, "1对3"], ["高三", 4, 300, "1对多"],
  ["高二", 1, 500, "1对1"], ["高二", 2, 380, "1对2"], ["高二", 3, 330, "1对3"], ["高二", 4, 270, "1对多"],
  ["高一", 1, 450, "1对1"], ["高一", 2, 350, "1对2"], ["高一", 3, 300, "1对3"], ["高一", 4, 240, "1对多"],
  ["初三", 1, 370, "1对1"], ["初三", 2, 290, "1对2"], ["初三", 4, 180, "1对多"],
  ["初二", 1, 300, "1对1"], ["初二", 2, 240, "1对2"], ["初二", 4, 160, "1对多"],
  ["初一", 1, 300, "1对1"], ["初一", 2, 240, "1对2"], ["初一", 4, 160, "1对多"],
];
const GRADE_ORDER = [...GRADES.map((grade) => grade.name), "已毕业"];
const NEXT_GRADE = {
  初一: "初二",
  初二: "初三",
  初三: "高一",
  高一: "高二",
  高二: "高三",
  高三: "高三",
};

fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA locking_mode = NORMAL;
  PRAGMA foreign_keys = ON;
`);

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      phone TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT '在职',
      joined_at TEXT DEFAULT '',
      left_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      grade TEXT,
      phone TEXT DEFAULT '',
      guardian TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT '在读',
      joined_at TEXT DEFAULT '',
      left_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS pricing_standards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grade TEXT NOT NULL,
      student_count INTEGER NOT NULL,
      unit_price REAL NOT NULL DEFAULT 0,
      description TEXT DEFAULT '',
      UNIQUE (grade, student_count)
    );

    CREATE TABLE IF NOT EXISTS student_pricing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_name TEXT NOT NULL,
      grade TEXT DEFAULT '',
      subject TEXT NOT NULL,
      student_names TEXT DEFAULT '',
      custom_price REAL NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      UNIQUE (student_name, grade, subject, student_names)
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_name TEXT DEFAULT '',
      date TEXT DEFAULT '',
      lesson_status TEXT DEFAULT '上课',
      time_slot TEXT DEFAULT '',
      classroom TEXT DEFAULT '',
      grade TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      student_names TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      course_status TEXT DEFAULT '未上',
      status TEXT DEFAULT '待上',
      teacher_salary REAL DEFAULT 0,
      teacher_salary_source TEXT DEFAULT '',
      teacher_salary_rule_id INTEGER,
      month_key TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teacher_salary_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_name TEXT NOT NULL,
      grade TEXT NOT NULL,
      subject TEXT NOT NULL,
      student_names TEXT NOT NULL,
      salary_per_unit REAL NOT NULL DEFAULT 0,
      unit_hours REAL NOT NULL DEFAULT 2,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fee_overrides (
      lesson_id INTEGER NOT NULL,
      student_name TEXT NOT NULL,
      unit_price REAL NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (lesson_id, student_name),
      FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recharge_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_name TEXT NOT NULL,
      grade TEXT DEFAULT '',
      prev_actual REAL DEFAULT 0,
      prev_gift REAL DEFAULT 0,
      cur_recharge REAL DEFAULT 0,
      cur_gift REAL DEFAULT 0,
      recharge_date TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      source TEXT DEFAULT '',
      month_key TEXT DEFAULT '',
      UNIQUE (student_name, month_key)
    );

    CREATE TABLE IF NOT EXISTS student_opening_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_key TEXT NOT NULL DEFAULT '',
      student_name TEXT NOT NULL,
      grade TEXT DEFAULT '',
      opening_actual_balance REAL DEFAULT 0,
      opening_gift_balance REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (month_key, student_name)
    );

    CREATE TABLE IF NOT EXISTS teacher_adjustments (
      teacher_name TEXT PRIMARY KEY,
      week1_transport REAL DEFAULT 0,
      week2_transport REAL DEFAULT 0,
      week3_transport REAL DEFAULT 0,
      week4_transport REAL DEFAULT 0,
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS teacher_adjustments_monthly (
      teacher_name TEXT NOT NULL,
      month_key TEXT NOT NULL,
      week1_transport REAL DEFAULT 0,
      week2_transport REAL DEFAULT 0,
      week3_transport REAL DEFAULT 0,
      week4_transport REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      PRIMARY KEY (teacher_name, month_key)
    );

    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      base_salary REAL DEFAULT 0,
      pay_type TEXT DEFAULT '月薪',
      daily_rate REAL DEFAULT 0,
      standard_work_days REAL DEFAULT 26,
      phone TEXT DEFAULT '',
      status TEXT DEFAULT '在职',
      joined_at TEXT DEFAULT '',
      left_at TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS staff_salary_monthly (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      month_key TEXT NOT NULL,
      salary_actual REAL DEFAULT 0,
      bonus REAL DEFAULT 0,
      deduction REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      UNIQUE (staff_id, month_key),
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS staff_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      attendance_date TEXT NOT NULL,
      month_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '上班',
      pay_units REAL DEFAULT 1,
      hours REAL DEFAULT 0,
      reason TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (staff_id, attendance_date),
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS operating_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      expense_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      vendor TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      month_key TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at TEXT DEFAULT CURRENT_TIMESTAMP,
      run_id TEXT DEFAULT '',
      issue_key TEXT DEFAULT '',
      source TEXT,
      severity TEXT,
      entity TEXT,
      field TEXT,
      before_value TEXT,
      after_value TEXT,
      status TEXT DEFAULT 'open',
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS audit_ignores (
      issue_key TEXT PRIMARY KEY,
      ignored_at TEXT DEFAULT CURRENT_TIMESTAMP,
      source TEXT DEFAULT '',
      entity TEXT DEFAULT '',
      field TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      actor_username TEXT DEFAULT '',
      actor_role TEXT DEFAULT '',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT DEFAULT '',
      before_json TEXT DEFAULT '',
      after_json TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'academic',
      teacher_name TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS parent_message_greetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      send_object_key TEXT NOT NULL UNIQUE,
      send_object_name TEXT DEFAULT '',
      send_object_type TEXT DEFAULT '',
      students TEXT DEFAULT '',
      greeting TEXT DEFAULT '',
      global_tail TEXT DEFAULT '',
      full_message TEXT DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS course_notice_completion_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unique_key TEXT NOT NULL UNIQUE,
      grade TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      students TEXT DEFAULT '',
      teacher TEXT DEFAULT '',
      date TEXT DEFAULT '',
      time TEXT DEFAULT '',
      status TEXT DEFAULT '',
      classroom TEXT DEFAULT '',
      send_object_key TEXT DEFAULT '',
      send_object_name TEXT DEFAULT '',
      send_object_type TEXT DEFAULT '',
      completed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_by TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campus_name TEXT DEFAULT '黎明教育',
      operator_name TEXT DEFAULT '',
      operator_account TEXT DEFAULT '',
      operation_type TEXT NOT NULL,
      operation_content TEXT DEFAULT '',
      target_type TEXT DEFAULT '',
      target_id TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      extra_json TEXT DEFAULT ''
    );
  `);

  const auditColumns = db.prepare("PRAGMA table_info(audit_logs)").all().map((column) => column.name);
  if (!auditColumns.includes("run_id")) {
    db.prepare("ALTER TABLE audit_logs ADD COLUMN run_id TEXT DEFAULT ''").run();
  }
  if (!auditColumns.includes("issue_key")) {
    db.prepare("ALTER TABLE audit_logs ADD COLUMN issue_key TEXT DEFAULT ''").run();
  }
  db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_logs_issue_key ON audit_logs(issue_key)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_parent_message_greetings_key ON parent_message_greetings(send_object_key)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_course_notice_completion_key ON course_notice_completion_records(unique_key)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_course_notice_completion_object ON course_notice_completion_records(send_object_key)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_operation_logs_created_at ON operation_logs(created_at)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_operation_logs_operator ON operation_logs(operator_name, operator_account)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_operation_logs_type ON operation_logs(operation_type)").run();
  db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_salary_rules_active_key
    ON teacher_salary_rules(teacher_name, grade, subject, student_names)
    WHERE is_active = 1
  `).run();

  const rechargeColumns = db.prepare("PRAGMA table_info(recharge_records)").all().map((column) => column.name);
  if (!rechargeColumns.includes("source")) {
    db.prepare("ALTER TABLE recharge_records ADD COLUMN source TEXT DEFAULT ''").run();
  }
  db.prepare("CREATE INDEX IF NOT EXISTS idx_student_opening_balances_student ON student_opening_balances(student_name)").run();

  const studentPricingSql = text(get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'student_pricing'")?.sql);
  if (!studentPricingSql.includes("grade TEXT") || !studentPricingSql.includes("student_names TEXT") || !studentPricingSql.includes("UNIQUE (student_name, grade, subject, student_names)")) {
    withTransaction(() => {
      db.prepare("ALTER TABLE student_pricing RENAME TO student_pricing_legacy").run();
      db.exec(`
        CREATE TABLE student_pricing (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_name TEXT NOT NULL,
          grade TEXT DEFAULT '',
          subject TEXT NOT NULL,
          student_names TEXT DEFAULT '',
          custom_price REAL NOT NULL DEFAULT 0,
          notes TEXT DEFAULT '',
          UNIQUE (student_name, grade, subject, student_names)
        );
      `);
      const legacyColumns = db.prepare("PRAGMA table_info(student_pricing_legacy)").all().map((column) => column.name);
      const hasGrade = legacyColumns.includes("grade");
      const hasStudentNames = legacyColumns.includes("student_names");
      const legacyRows = all("SELECT * FROM student_pricing_legacy ORDER BY id");
      const insert = db.prepare(`
        INSERT OR IGNORE INTO student_pricing(id, student_name, grade, subject, student_names, custom_price, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of legacyRows) {
        insert.run(
          Number(row.id),
          text(row.student_name),
          hasGrade ? text(row.grade) : "",
          text(row.subject),
          hasStudentNames ? normalizedStudents(row.student_names) : "",
          num(row.custom_price),
          text(row.notes),
        );
      }
      db.prepare("DROP TABLE student_pricing_legacy").run();
    });
  }

  const staffColumns = db.prepare("PRAGMA table_info(staff)").all().map((column) => column.name);
  const staffColumnDefs = {
    pay_type: "TEXT DEFAULT '月薪'",
    daily_rate: "REAL DEFAULT 0",
    standard_work_days: "REAL DEFAULT 26",
  };
  for (const [column, definition] of Object.entries(staffColumnDefs)) {
    if (!staffColumns.includes(column)) db.prepare(`ALTER TABLE staff ADD COLUMN ${column} ${definition}`).run();
  }

  const teacherColumns = db.prepare("PRAGMA table_info(teachers)").all().map((column) => column.name);
  const teacherColumnDefs = {
    phone: "TEXT DEFAULT ''",
    notes: "TEXT DEFAULT ''",
    status: "TEXT DEFAULT '在职'",
    joined_at: "TEXT DEFAULT ''",
    left_at: "TEXT DEFAULT ''",
  };
  for (const [column, definition] of Object.entries(teacherColumnDefs)) {
    if (!teacherColumns.includes(column)) db.prepare(`ALTER TABLE teachers ADD COLUMN ${column} ${definition}`).run();
  }
  db.prepare("UPDATE teachers SET status = '在职' WHERE status IS NULL OR TRIM(status) = ''").run();

  const studentColumns = db.prepare("PRAGMA table_info(students)").all().map((column) => column.name);
  const studentColumnDefs = {
    phone: "TEXT DEFAULT ''",
    guardian: "TEXT DEFAULT ''",
    notes: "TEXT DEFAULT ''",
    status: "TEXT DEFAULT '在读'",
    joined_at: "TEXT DEFAULT ''",
    left_at: "TEXT DEFAULT ''",
  };
  for (const [column, definition] of Object.entries(studentColumnDefs)) {
    if (!studentColumns.includes(column)) db.prepare(`ALTER TABLE students ADD COLUMN ${column} ${definition}`).run();
  }
  db.prepare("UPDATE students SET status = '在读' WHERE status IS NULL OR TRIM(status) = ''").run();

  const lessonColumns = db.prepare("PRAGMA table_info(lessons)").all().map((column) => column.name);
  if (!lessonColumns.includes("status")) {
    db.prepare("ALTER TABLE lessons ADD COLUMN status TEXT DEFAULT ''").run();
  }
  if (!lessonColumns.includes("teacher_salary_source")) {
    db.prepare("ALTER TABLE lessons ADD COLUMN teacher_salary_source TEXT DEFAULT ''").run();
  }
  if (!lessonColumns.includes("teacher_salary_rule_id")) {
    db.prepare("ALTER TABLE lessons ADD COLUMN teacher_salary_rule_id INTEGER").run();
  }
  db.prepare(`
    UPDATE lessons
    SET teacher_salary_source = 'legacy'
    WHERE teacher_salary_source IS NULL OR TRIM(teacher_salary_source) = ''
  `).run();
  db.prepare(`
    UPDATE lessons
    SET status = '考试'
    WHERE lesson_status = '考试'
      AND (status IS NULL OR TRIM(status) = '' OR status = '待上')
  `).run();
  db.prepare(`
    UPDATE lessons
    SET status = CASE
      WHEN lesson_status = '试课' THEN '试课'
      WHEN lesson_status = '考试' THEN '考试'
      WHEN lesson_status = '上课（未缴费）' THEN '未缴费'
      WHEN lesson_status = '请假' OR course_status = '请假' THEN '请假'
      WHEN course_status = '已上' THEN '已上'
      ELSE '待上'
    END
    WHERE status IS NULL OR TRIM(status) = ''
  `).run();

  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('month_key', '2026-04-01')").run();
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('course_notice_global_tail', '这是我们本周的上课安排哦[玫瑰]')").run();
  const currentMonth = db.prepare("SELECT value FROM settings WHERE key = 'month_key'").get().value;
  db.prepare(`
    INSERT OR IGNORE INTO teacher_adjustments_monthly(
      teacher_name, month_key, week1_transport, week2_transport, week3_transport, week4_transport, notes
    )
    SELECT teacher_name, ?, week1_transport, week2_transport, week3_transport, week4_transport, notes
    FROM teacher_adjustments
  `).run(currentMonth);
  db.prepare("INSERT OR IGNORE INTO teachers(name) SELECT DISTINCT TRIM(teacher_name) FROM lessons WHERE TRIM(teacher_name) <> ''").run();
  db.prepare("INSERT OR IGNORE INTO teachers(name) SELECT DISTINCT TRIM(teacher_name) FROM teacher_adjustments_monthly WHERE TRIM(teacher_name) <> ''").run();
  for (const teacher of all("SELECT name FROM teachers ORDER BY name")) {
    db.prepare("INSERT OR IGNORE INTO teacher_adjustments_monthly(teacher_name, month_key) VALUES (?, ?)").run(teacher.name, currentMonth);
  }
  for (const row of PRICING) {
    db.prepare(`
      INSERT OR IGNORE INTO pricing_standards(grade, student_count, unit_price, description)
      VALUES (?, ?, ?, ?)
    `).run(row[0], row[1], row[2], row[3]);
  }
  preserveLegacyStudentPricingFeeOverrides();
  seedDefaultUsers();
  db.prepare("UPDATE users SET display_name = 'Qing' WHERE username = 'boss' AND display_name IN ('最大老板', '晴')").run();
}

initDb();

if (process.argv.includes("--init-db")) {
  console.log(`Database initialized: ${dbPath}`);
  process.exit(0);
}

const REAL_RECHARGE_SQL = "(COALESCE(cur_recharge, 0) <> 0 OR COALESCE(cur_gift, 0) <> 0)";

const DERIVED_CACHE_LOG_THRESHOLD_MS = Number(process.env.DERIVED_CACHE_LOG_THRESHOLD_MS || 120);
const DERIVED_CACHE_DEBUG = process.env.DERIVED_CACHE_DEBUG === "1";
const derivedCaches = {
  bootstrap: new Map(),
  feeDetails: new Map(),
  studentSummary: new Map(),
  studentSummaryToDate: new Map(),
  teacherSummary: new Map(),
  studentBalanceThroughDate: new Map(),
};

function cacheKey(...parts) {
  return parts.map((part) => text(part)).join("|");
}

function cloneDerivedValue(value) {
  return value == null ? value : structuredClone(value);
}

function derivedCacheEntryCount() {
  return Object.values(derivedCaches).reduce((sum, cache) => sum + cache.size, 0);
}

function clearDerivedCache(reason = "") {
  const count = derivedCacheEntryCount();
  for (const cache of Object.values(derivedCaches)) cache.clear();
  if (count && DERIVED_CACHE_DEBUG) {
    console.info(`[perf] derived cache cleared entries=${count}${reason ? ` reason=${reason}` : ""}`);
  }
}

function logDerivedTiming(label, elapsedMs, extra = "") {
  if (DERIVED_CACHE_DEBUG || elapsedMs >= DERIVED_CACHE_LOG_THRESHOLD_MS) {
    console.info(`[perf] ${label} ${elapsedMs.toFixed(1)}ms${extra ? ` ${extra}` : ""}`);
  }
}

function cachedDerived(cacheName, key, label, build, decorate = (value) => value) {
  const cache = derivedCaches[cacheName];
  if (cache?.has(key)) {
    if (DERIVED_CACHE_DEBUG) console.info(`[perf] ${label} cache hit`);
    return decorate(cloneDerivedValue(cache.get(key)));
  }
  const started = performance.now();
  const value = build();
  const elapsed = performance.now() - started;
  if (cache) cache.set(key, cloneDerivedValue(value));
  logDerivedTiming(label, elapsed, "cache miss");
  return decorate(value);
}

function markFeeDetails(rows, monthKey) {
  if (Array.isArray(rows)) {
    Object.defineProperty(rows, "__feeDetailsMonthKey", {
      value: monthKey,
      configurable: true,
    });
  }
  return rows;
}

function isRealRechargeRecord(row) {
  return num(row?.cur_recharge) !== 0 || num(row?.cur_gift) !== 0;
}

function openingBalanceRows() {
  return all(`
    SELECT ob.*, COALESCE(NULLIF(ob.grade, ''), s.grade, '') AS display_grade
    FROM student_opening_balances ob
    LEFT JOIN students s ON s.name = ob.student_name
    WHERE COALESCE(ob.opening_actual_balance, 0) <> 0 OR COALESCE(ob.opening_gift_balance, 0) <> 0
    ORDER BY ob.student_name
  `).map((row) => ({
    ...row,
    grade: row.display_grade || row.grade || "",
  }));
}

function openingBalanceMap() {
  return new Map(openingBalanceRows().map((row) => [row.student_name, {
    month_key: "",
    actual_balance: num(row.opening_actual_balance),
    gift_balance: num(row.opening_gift_balance),
    grade: text(row.grade),
    opening_balance_id: row.id,
  }]));
}

const OPENING_BALANCE_IMPORT_HEADERS = ["学生姓名", "年级", "期初现金余额", "期初赠送余额", "备注"];

const OPENING_BALANCE_HEADER_ALIASES = {
  student_name: new Set(["学生姓名", "姓名", "学生"]),
  grade: new Set(["年级"]),
  opening_actual_balance: new Set(["期初现金余额", "期初现金", "现金余额", "实际余额", "期初实际余额"]),
  opening_gift_balance: new Set(["期初赠送余额", "期初赠送", "赠送余额", "期初赠送学费", "赠送学费"]),
  notes: new Set(["备注", "说明"]),
};

function openingBalanceTemplateRows() {
  return [OPENING_BALANCE_IMPORT_HEADERS];
}

function openingBalanceExportRows() {
  return [
    OPENING_BALANCE_IMPORT_HEADERS,
    ...openingBalanceRows()
      .sort((a, b) => compareGradeName(a.grade, b.grade) || text(a.student_name).localeCompare(text(b.student_name), "zh-Hans-CN"))
      .map((row) => [
        row.student_name,
        row.grade || "",
        moneyRound(row.opening_actual_balance).toFixed(2),
        moneyRound(row.opening_gift_balance).toFixed(2),
        row.notes || "",
      ]),
  ];
}

function openingBalanceExportFilename() {
  return `黎明教育_学生期初余额_${exportTimestamp()}.xlsx`;
}

function normalizedOpeningBalanceHeader(value) {
  return text(value).replace(/\s+/g, "").replace(/[：:]/g, "");
}

function openingBalanceHeaderField(value) {
  const header = normalizedOpeningBalanceHeader(value);
  for (const [field, aliases] of Object.entries(OPENING_BALANCE_HEADER_ALIASES)) {
    if (aliases.has(header)) return field;
  }
  return "";
}

function readOpeningBalanceImportSheet(buffer) {
  const entries = unzipXlsx(buffer);
  const sheets = workbookSheets(entries).filter((sheet) => sheet.state !== "hidden" && sheet.state !== "veryHidden");
  const preferredNames = new Set(["期初余额", "期初余额导入模板"]);
  const preferred = sheets.filter((sheet) => preferredNames.has(sheet.name));
  const candidates = [...preferred, ...sheets.filter((sheet) => !preferredNames.has(sheet.name))];
  for (const sheetInfo of candidates) {
    const sheet = readXlsxSheetRows(buffer, sheetInfo.name);
    if (sheet.rows.some((row) => row.values.some((value) => text(value)))) return sheet;
  }
  return candidates[0] ? readXlsxSheetRows(buffer, candidates[0].name) : { sheet_name: "", rows: [] };
}

function openingBalanceImportHeader(rows) {
  for (const row of rows.slice(0, 20)) {
    const columns = {};
    for (const [index, value] of row.values.entries()) {
      const field = openingBalanceHeaderField(value);
      if (field && columns[field] == null) columns[field] = index;
    }
    if (columns.student_name != null
      && (columns.opening_actual_balance != null || columns.opening_gift_balance != null)) {
      return { source_row: row.source_row, columns };
    }
  }
  return null;
}

function parseOpeningBalanceImportAmount(value) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return { ok: true, value: 0 };
  if (typeof value === "number") return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  const raw = text(value).replace(/[,\s￥¥]/g, "");
  if (!raw) return { ok: true, value: 0 };
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false };
}

function openingBalanceImportCell(row, columns, field) {
  const index = columns[field];
  return index == null ? "" : row.values[index];
}

function importOpeningBalancesFromWorkbook(buffer) {
  const sheet = readOpeningBalanceImportSheet(buffer);
  const header = openingBalanceImportHeader(sheet.rows);
  if (!header) {
    return {
      ok: false,
      sheet_name: sheet.sheet_name,
      imported: 0,
      skipped: 0,
      failed: 1,
      details: [{ row: 0, status: "failed", message: "未找到期初余额表头，请使用学生姓名、期初现金余额、期初赠送余额等列" }],
    };
  }

  const profiles = new Map(all("SELECT name, grade FROM students").map((row) => [text(row.name), row]));
  const existingNames = new Set(all("SELECT student_name FROM student_opening_balances")
    .map((row) => text(row.student_name))
    .filter(Boolean));
  const seenNames = new Set();
  const details = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const insert = db.prepare(`
    INSERT INTO student_opening_balances(
      month_key, student_name, grade, opening_actual_balance, opening_gift_balance, notes
    )
    VALUES ('', ?, ?, ?, ?, ?)
  `);

  withTransaction(() => {
    for (const row of sheet.rows.filter((item) => item.source_row > header.source_row)) {
      if (!row.values.some((value) => text(value))) continue;
      const studentName = text(openingBalanceImportCell(row, header.columns, "student_name"));
      if (!studentName) {
        failed += 1;
        details.push({ row: row.source_row, status: "failed", message: "学生姓名为空" });
        continue;
      }
      if (seenNames.has(studentName)) {
        skipped += 1;
        details.push({ row: row.source_row, student_name: studentName, status: "skipped", message: "Excel 内重复学生，已跳过" });
        continue;
      }
      seenNames.add(studentName);

      const actual = parseOpeningBalanceImportAmount(openingBalanceImportCell(row, header.columns, "opening_actual_balance"));
      const gift = parseOpeningBalanceImportAmount(openingBalanceImportCell(row, header.columns, "opening_gift_balance"));
      if (!actual.ok || !gift.ok) {
        failed += 1;
        details.push({ row: row.source_row, student_name: studentName, status: "failed", message: "金额格式错误" });
        continue;
      }
      if (actual.value === 0 && gift.value === 0) {
        skipped += 1;
        details.push({ row: row.source_row, student_name: studentName, status: "skipped", message: "现金和赠送均为 0，跳过" });
        continue;
      }
      if (existingNames.has(studentName)) {
        skipped += 1;
        details.push({ row: row.source_row, student_name: studentName, status: "skipped", message: "已存在，跳过" });
        continue;
      }

      const profile = profiles.get(studentName);
      const grade = text(openingBalanceImportCell(row, header.columns, "grade")) || text(profile?.grade);
      const notes = text(openingBalanceImportCell(row, header.columns, "notes"));
      insert.run(studentName, grade, actual.value, gift.value, notes);
      existingNames.add(studentName);
      imported += 1;
      details.push({ row: row.source_row, student_name: studentName, status: "imported", message: "导入成功" });
    }
  });

  return { ok: true, sheet_name: sheet.sheet_name, imported, skipped, failed, details };
}

async function importOpeningBalancesFromUpload(req) {
  const raw = await spawnSafeReadRaw(req);
  const parts = parseMultipart(req, raw);
  const file = parts.file || parts.xlsx || Object.values(parts).find((part) => part.filename);
  if (!file || !file.content?.length) throw new Error("请先选择 xlsx 文件");
  if (file.filename && !file.filename.toLowerCase().endsWith(".xlsx")) throw new Error("仅支持 .xlsx 文件");
  return importOpeningBalancesFromWorkbook(file.content);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password || ""), salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [method, salt, hash] = String(stored || "").split("$");
  if (method !== "pbkdf2" || !salt || !hash) return false;
  const actual = passwordHash(password, salt).split("$")[2];
  if (actual.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(hash, "hex"));
}

function seedDefaultUsers() {
  const count = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (count) return;
  const defaults = [
    ["boss", "Qing", "owner"],
    ["admin", "管理员", "admin"],
    ["jiaowu", "教务", "academic"],
    ["teacher", "老师", "teacher"],
  ];
  const stmt = db.prepare(`
    INSERT INTO users(username, display_name, role, password_hash)
    VALUES (?, ?, ?, ?)
  `);
  for (const [username, displayName, role] of defaults) {
    stmt.run(username, displayName, role, passwordHash("123456"));
  }
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function optionalNumber(value) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function moneyRound(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function validMonthKey(value) {
  return /^\d{4}-\d{2}-01$/.test(text(value));
}

function monthKeyFromDate(value) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return "";
  return `${match[1]}-${match[2]}-01`;
}

function monthKeyFromFilename(filename) {
  const match = text(filename).match(/(\d{4})年(\d{1,2})月/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-01`;
}

function splitStudents(value) {
  return text(value)
    .split(/[、,，;；\n\r]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function weekdayCn(dateValue) {
  if (!dateValue) return "";
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
}

function courseStatusValues() {
  return mergeLookupValues(STATUS, "custom_course_statuses");
}

function deriveStatus(row = {}) {
  const current = text(row.status);
  if (courseStatusValues().includes(current)) return current;
  if (row.lesson_status === "试课") return "试课";
  if (row.lesson_status === "考试") return "考试";
  if (row.lesson_status === "上课（未缴费）") return "未缴费";
  if (row.lesson_status === "请假" || row.course_status === "请假") return "请假";
  if (row.course_status === "已上") return "已上";
  return "待上";
}

function gradeRank(grade) {
  const index = GRADE_ORDER.indexOf(text(grade));
  return index === -1 ? GRADE_ORDER.length : index;
}

function compareGradeName(a, b) {
  return gradeRank(a) - gradeRank(b) || text(a).localeCompare(text(b), "zh-Hans-CN");
}

function legacyStatusFields(statusValue) {
  const status = courseStatusValues().includes(text(statusValue)) ? text(statusValue) : "待上";
  if (status === "试课") return { lesson_status: "试课", course_status: "未上" };
  if (status === "考试") return { lesson_status: "考试", course_status: "未上" };
  if (status === "未缴费") return { lesson_status: "上课（未缴费）", course_status: "已上" };
  if (status === "请假") return { lesson_status: "请假", course_status: "请假" };
  if (status === "已上") return { lesson_status: "上课", course_status: "已上" };
  return { lesson_status: "上课", course_status: "未上" };
}

function isEffective(row) {
  const status = deriveStatus(row);
  return status === "已上" || status === "未缴费";
}

function isCompletedLesson(row) {
  return deriveStatus(row) === "已上";
}

function effectiveTeacherSalary(row) {
  return isCompletedLesson(row) ? num(row.teacher_salary) : 0;
}

function isUnpaid(row) {
  return deriveStatus(row) === "未缴费";
}

function isBillableDetail(row) {
  return isCompletedLesson(row);
}

function xmlDecode(value) {
  return String(value || "")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function xmlAttr(tag, name) {
  const match = String(tag || "").match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? xmlDecode(match[1]) : "";
}

function unzipXlsx(buffer) {
  const sig = 0x06054b50;
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 66000); index -= 1) {
    if (buffer.readUInt32LE(index) === sig) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 xlsx 文件：未找到 ZIP 目录");
  const total = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let cursor = centralOffset;
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("xlsx ZIP 目录损坏");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`xlsx ZIP 条目损坏：${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`xlsx 使用了暂不支持的压缩方式：${method}`);
    entries.set(name.replaceAll("\\", "/"), data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/g)].map(([item]) => (
    [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((match) => xmlDecode(match[1]))
      .join("")
  ));
}

function relationshipTarget(baseDir, target) {
  if (!target) return "";
  if (target.startsWith("/")) return target.slice(1);
  return path.posix.normalize(path.posix.join(baseDir, target));
}

function workbookSheets(entries) {
  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8");
  const relsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  if (!workbookXml || !relsXml) throw new Error("xlsx 缺少 workbook.xml");
  const rels = new Map();
  for (const [, tag] of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = xmlAttr(tag, "Id");
    const target = relationshipTarget("xl", xmlAttr(tag, "Target"));
    if (id && target) rels.set(id, target);
  }
  return [...workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)].map(([, tag]) => {
    const name = xmlAttr(tag, "name");
    const relId = xmlAttr(tag, "r:id") || xmlAttr(tag, "id");
    const state = xmlAttr(tag, "state") || "visible";
    return { name, path: rels.get(relId) || "", state };
  });
}

function excelSerialDate(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial)) return "";
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  return date.toISOString().slice(0, 10);
}

function isoDateValue(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number") return excelSerialDate(value);
  const raw = text(value);
  const match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return raw;
}

function cellColumnIndex(ref) {
  const letters = String(ref || "").match(/[A-Z]+/i)?.[0] || "";
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}

function cellValue(cellTag, cellXml, sharedStrings) {
  const type = xmlAttr(cellTag, "t");
  if (type === "inlineStr") {
    return [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlDecode(match[1])).join("");
  }
  const raw = xmlDecode(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "");
  if (type === "s") return sharedStrings[Number(raw)] || "";
  if (type === "str") return raw;
  if (raw !== "" && Number.isFinite(Number(raw))) return Number(raw);
  return raw;
}

function xlsxTotalRow(values, rowIndex, monthKey, includeTeacherSalary = false) {
  const row = {
    source_row: rowIndex,
    teacher_name: text(values[0]),
    date: isoDateValue(values[1]),
    lesson_status: text(values[2]),
    time_slot: text(values[4]),
    classroom: text(values[5]),
    grade: text(values[6]),
    subject: text(values[7]),
    student_names: text(values[8]),
    notes: text(values[9]),
    course_status: text(values[10]),
  };
  if (includeTeacherSalary) {
    row.teacher_salary = optionalNumber(values[11]);
    row.teacher_salary_present = row.teacher_salary !== null;
  }
  return row;
}

function xlsxLessonHasCandidateData(row) {
  return [
    "teacher_name", "date", "lesson_status", "time_slot", "classroom",
    "grade", "subject", "student_names", "notes", "course_status",
  ].some((field) => text(row[field]))
    || num(row.teacher_salary) !== 0;
}

function validXlsxLessonTime(value) {
  const slot = text(value);
  if (!slot || slot === "0" || slot === "0:00") return false;
  return /\d/.test(slot);
}

function xlsxLessonSkipReasons(row) {
  const reasons = [];
  if (!row.date) reasons.push("missing-date");
  if (!text(row.student_names)) reasons.push("missing-student");
  if (!text(row.teacher_name)) reasons.push("missing-teacher");
  if (!validXlsxLessonTime(row.time_slot)) reasons.push("missing-time");
  return reasons;
}

function finalizeXlsxLessonRow(row, monthKey) {
  row.lesson_status ||= "上课";
  row.course_status ||= "未上";
  row.student_count = splitStudents(row.student_names).length;
  row.month_key = monthKeyFromDate(row.date) || monthKey;
  row.status = deriveStatus(row);
  return row;
}

function xlsxDebugCellSummary(cells) {
  return cells
    .filter((cell) => cell.value !== "" || cell.formula)
    .map((cell) => `${cell.address}=${text(cell.value) || (cell.formula ? `formula:${cell.formula}` : "")}`)
    .join(";");
}

function readXlsxTotalSheet(buffer, monthKey, options = {}) {
  const entries = unzipXlsx(buffer);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8"));
  const sheets = workbookSheets(entries);
  const month = Number(monthKey.slice(5, 7));
  const preferred = `${month}月总表`;
  const sheet = sheets.find((item) => item.name === preferred);
  if (!sheet) {
    const found = sheets.map((item) => item.name).filter(Boolean).join("、") || "无";
    throw new Error(`当前选择 ${monthKey.slice(0, 7)}，但文件中未找到「${preferred}」。已找到：${found}`);
  }
  const sheetXmlText = entries.get(sheet.path)?.toString("utf8");
  if (!sheetXmlText) throw new Error(`xlsx 缺少工作表内容：${sheet.name}`);
  const rows = [];
  const skippedRows = [];
  let rawCandidateRows = 0;
  for (const [, rowTag, rowXml] of sheetXmlText.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowIndex = Number(xmlAttr(rowTag, "r"));
    if (!rowIndex || rowIndex < 3) continue;
    const values = [];
    const cells = [];
    const normalizedRowXml = rowXml.replace(/<c\b([^>]*)\/>/g, "<c$1></c>");
    for (const [, cellTag, cellXml] of normalizedRowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = xmlAttr(cellTag, "r");
      const column = cellColumnIndex(ref);
      if (column < 0) continue;
      const value = cellValue(cellTag, cellXml, sharedStrings);
      values[column] = value;
      const formula = xmlDecode(cellXml.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1] || "");
      if (value !== "" || formula) cells.push({ address: ref, value, formula });
    }
    const row = xlsxTotalRow(values, rowIndex, monthKey, true);
    if (!xlsxLessonHasCandidateData(row)) continue;
    rawCandidateRows += 1;
    const skipReasons = xlsxLessonSkipReasons(row);
    if (skipReasons.length) {
      skippedRows.push({
        source_row: rowIndex,
        cells: xlsxDebugCellSummary(cells),
        reason: skipReasons.join("|"),
      });
      continue;
    }
    rows.push(finalizeXlsxLessonRow(row, monthKey));
  }
  if (options.log) {
    console.info(`[xlsx audit][lessons] month=${monthKey.slice(0, 7)} rawCandidateRows=${rawCandidateRows} validLessonRows=${rows.length} skippedRows=${skippedRows.length}`);
    for (const skipped of skippedRows) {
      console.info(`[xlsx audit][lessons][skip] sheet=${sheet.name} row=${skipped.source_row} cells=${skipped.cells} reason=${skipped.reason}`);
    }
  }
  return { sheet_name: sheet.name, rows, raw_candidate_rows: rawCandidateRows, skipped_rows: skippedRows };
}

function readXlsxSheetRows(buffer, sheetName) {
  const entries = unzipXlsx(buffer);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8"));
  const sheets = workbookSheets(entries);
  const sheet = sheets.find((item) => item.name === sheetName);
  if (!sheet) return { sheet_name: sheetName, rows: [] };
  const sheetXmlText = entries.get(sheet.path)?.toString("utf8");
  if (!sheetXmlText) throw new Error(`xlsx 缺少工作表内容：${sheet.name}`);
  const rows = [];
  for (const [, rowTag, rowXml] of sheetXmlText.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const sourceRow = Number(xmlAttr(rowTag, "r"));
    if (!sourceRow) continue;
    const values = [];
    const normalizedRowXml = rowXml.replace(/<c\b([^>]*)\/>/g, "<c$1></c>");
    for (const [, cellTag, cellXml] of normalizedRowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const column = cellColumnIndex(xmlAttr(cellTag, "r"));
      if (column >= 0) values[column] = cellValue(cellTag, cellXml, sharedStrings);
    }
    rows.push({ source_row: sourceRow, values });
  }
  return { sheet_name: sheet.name, rows };
}

function readXlsxSheetRowsDetailed(buffer, sheetName) {
  const entries = unzipXlsx(buffer);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8"));
  const sheets = workbookSheets(entries);
  const sheet = sheets.find((item) => item.name === sheetName);
  if (!sheet) return { sheet_name: sheetName, sheet_state: "", sheet_path: "", dimension: "", merge_cells: [], rows: [] };
  const sheetXmlText = entries.get(sheet.path)?.toString("utf8");
  if (!sheetXmlText) throw new Error(`xlsx 缺少工作表内容：${sheet.name}`);
  const dimension = sheetXmlText.match(/<dimension\b[^>]*ref="([^"]+)"/)?.[1] || "";
  const mergeCells = [...sheetXmlText.matchAll(/<mergeCell\b[^>]*ref="([^"]+)"/g)].map((match) => match[1]);
  const rows = [];
  for (const [, rowTag, rowXml] of sheetXmlText.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const sourceRow = Number(xmlAttr(rowTag, "r"));
    if (!sourceRow) continue;
    const values = [];
    const cells = [];
    const normalizedRowXml = rowXml.replace(/<c\b([^>]*)\/>/g, "<c$1></c>");
    for (const [, cellTag, cellXml] of normalizedRowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = xmlAttr(cellTag, "r");
      const column = cellColumnIndex(ref);
      if (column < 0) continue;
      const value = cellValue(cellTag, cellXml, sharedStrings);
      values[column] = value;
      const formula = xmlDecode(cellXml.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1] || "");
      const rawValue = xmlDecode(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "");
      if (value !== "" || formula || rawValue !== "") {
        cells.push({
          column,
          address: ref,
          type: xmlAttr(cellTag, "t"),
          style: xmlAttr(cellTag, "s"),
          formula,
          raw_value: rawValue,
          value,
        });
      }
    }
    rows.push({
      source_row: sourceRow,
      hidden: xmlAttr(rowTag, "hidden") === "1" || xmlAttr(rowTag, "hidden") === "true",
      values,
      cells,
    });
  }
  return {
    sheet_name: sheet.name,
    sheet_state: sheet.state || "visible",
    sheet_path: sheet.path,
    dimension,
    merge_cells: mergeCells,
    rows,
  };
}

function readXlsxTotalRowsForImport(buffer, monthKey) {
  const entries = unzipXlsx(buffer);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8"));
  const sheets = workbookSheets(entries);
  const preferred = `${Number(monthKey.slice(5, 7))}月总表`;
  const sheet = sheets.find((item) => item.name === preferred)
    || sheets.find((item) => /^\d{1,2}月总表$/.test(item.name));
  if (!sheet) {
    const found = sheets.map((item) => item.name).filter(Boolean).join("、") || "无";
    throw new Error(`未找到月度总表。当前选择 ${monthKey.slice(0, 7)}，已找到：${found}`);
  }
  const sheetXmlText = entries.get(sheet.path)?.toString("utf8");
  if (!sheetXmlText) throw new Error(`xlsx 缺少工作表内容：${sheet.name}`);
  const rows = [];
  for (const [, rowTag, rowXml] of sheetXmlText.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowIndex = Number(xmlAttr(rowTag, "r"));
    if (!rowIndex || rowIndex < 3) continue;
    const values = [];
    const normalizedRowXml = rowXml.replace(/<c\b([^>]*)\/>/g, "<c$1></c>");
    for (const [, cellTag, cellXml] of normalizedRowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const column = cellColumnIndex(xmlAttr(cellTag, "r"));
      if (column >= 0) values[column] = cellValue(cellTag, cellXml, sharedStrings);
    }
    const row = xlsxTotalRow(values, rowIndex, monthKey, true);
    if (!xlsxLessonHasCandidateData(row)) continue;
    if (xlsxLessonSkipReasons(row).length) continue;
    rows.push(finalizeXlsxLessonRow(row, monthKey));
  }
  return { sheet_name: sheet.name, rows };
}

function priceBucket(grade, studentCount) {
  if (!studentCount) return 1;
  if (String(grade).startsWith("高")) return studentCount >= 4 ? 4 : studentCount;
  if (String(grade).startsWith("初")) return studentCount >= 3 ? 4 : Math.min(studentCount, 2);
  return studentCount >= 4 ? 4 : studentCount;
}

function activeStudentPricingRuleForLesson({ studentName, grade, subject, studentNames }) {
  const name = text(studentName);
  const gradeValue = text(grade);
  const subjectValue = text(subject);
  const studentNamesValue = normalizedStudents(studentNames);
  if (!name || !gradeValue || !subjectValue || !studentNamesValue) return null;
  return all(`
    SELECT *
    FROM student_pricing
    WHERE student_name = ?
      AND grade = ?
      AND subject = ?
      AND custom_price > 0
    ORDER BY id DESC
  `, [name, gradeValue, subjectValue]).find((rule) => normalizedStudents(rule.student_names) === studentNamesValue) || null;
}

function unitPriceFor({ studentName, subject, grade, studentCount, lessonId, status, studentNames }) {
  if (status !== "已上") return { unit_price: 0, source: "auto", rule_price: 0, pricing_rule_id: null };

  const override = get(
    "SELECT unit_price FROM fee_overrides WHERE lesson_id = ? AND student_name = ?",
    [lessonId, studentName],
  );

  const rule = activeStudentPricingRuleForLesson({ studentName, grade, subject, studentNames });
  const rulePrice = rule ? num(rule.custom_price) : 0;

  const bucket = priceBucket(grade, studentCount);
  const standard = get(
    "SELECT unit_price FROM pricing_standards WHERE grade = ? AND student_count = ?",
    [grade, bucket],
  );
  const currentPrice = override
    ? num(override.unit_price)
    : (standard ? num(standard.unit_price) : 0);
  const source = rule
    ? (Math.abs(currentPrice - rulePrice) < 0.0001 ? "auto" : "manual")
    : "pending";
  return {
    unit_price: currentPrice,
    source,
    rule_price: rule ? rulePrice : null,
    pricing_rule_id: rule ? Number(rule.id) : null,
  };
}

function studentPricingRuleKey(row) {
  return [
    text(row.student_name),
    text(row.grade),
    text(row.subject),
    normalizedStudents(row.student_names),
  ].join("\u0001");
}

function isCompleteStudentPricingRule(row) {
  return Boolean(
    text(row.student_name)
    && text(row.grade)
    && text(row.subject)
    && normalizedStudents(row.student_names)
  );
}

function preserveLegacyStudentPricingFeeOverrides() {
  const legacyRules = all(`
    SELECT *
    FROM student_pricing
    WHERE custom_price > 0
      AND TRIM(COALESCE(grade, '')) = ''
      AND TRIM(COALESCE(student_names, '')) = ''
    ORDER BY id
  `);
  if (!legacyRules.length) return { insertedCount: 0, legacyRuleCount: 0 };

  const rulesByStudentSubject = new Map();
  for (const rule of legacyRules) {
    const studentName = text(rule.student_name);
    const subject = text(rule.subject);
    if (!studentName || !subject) continue;
    rulesByStudentSubject.set(`${studentName}\u0001${subject}`, rule);
  }

  let insertedCount = 0;
  return withTransaction(() => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO fee_overrides(lesson_id, student_name, unit_price, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);
    for (const lesson of all("SELECT * FROM lessons ORDER BY id")) {
      if (!isCompletedLesson(lesson)) continue;
      for (const studentName of splitStudents(lesson.student_names)) {
        const rule = rulesByStudentSubject.get(`${studentName}\u0001${text(lesson.subject)}`);
        if (!rule) continue;
        const result = insert.run(Number(lesson.id), studentName, moneyRound(rule.custom_price));
        insertedCount += result.changes || 0;
      }
    }
    return { insertedCount, legacyRuleCount: legacyRules.length };
  });
}

function syncStudentPricingCandidatesFromLessons() {
  return withTransaction(() => {
    const existingKeys = new Set(all("SELECT * FROM student_pricing").map((rule) => studentPricingRuleKey(rule)));
    const seenLessonKeys = new Set();
    const skippedReasons = new Map();
    const insert = db.prepare(`
      INSERT INTO student_pricing(student_name, grade, subject, student_names, custom_price, notes)
      VALUES (?, ?, ?, ?, 0, '')
    `);
    let createdCount = 0;
    let existingCount = 0;
    let scannedLessonCount = 0;
    const createdRules = [];

    for (const lesson of all(`
      SELECT grade, subject, student_names
      FROM lessons
      ORDER BY grade, subject, student_names, id
    `)) {
      scannedLessonCount += 1;
      const grade = text(lesson.grade);
      const subject = text(lesson.subject);
      const studentNames = normalizedStudents(lesson.student_names);
      const students = splitStudents(studentNames);
      const missing = [];
      if (!grade) missing.push("缺少年级");
      if (!subject) missing.push("缺少科目");
      if (!studentNames || !students.length) missing.push("缺少学生");
      if (missing.length) {
        const reason = missing.join("、");
        skippedReasons.set(reason, (skippedReasons.get(reason) || 0) + 1);
        continue;
      }

      for (const studentName of students) {
        const candidate = { student_name: studentName, grade, subject, student_names: studentNames };
        const key = studentPricingRuleKey(candidate);
        if (seenLessonKeys.has(key)) continue;
        seenLessonKeys.add(key);
        if (existingKeys.has(key)) {
          existingCount += 1;
          continue;
        }
        const result = insert.run(studentName, grade, subject, studentNames);
        const created = get("SELECT * FROM student_pricing WHERE id = ?", [Number(result.lastInsertRowid)]);
        createdRules.push(created);
        existingKeys.add(key);
        createdCount += 1;
      }
    }

    return {
      scannedLessonCount,
      uniqueCandidateCount: seenLessonKeys.size,
      createdCount,
      existingCount,
      skippedCount: [...skippedReasons.values()].reduce((sum, count) => sum + count, 0),
      skippedReasons: [...skippedReasons.entries()].map(([reason, count]) => ({ reason, count })),
      createdRules,
    };
  });
}

function upsertStudent(name, grade) {
  if (!name) return;
  db.prepare(`
    INSERT INTO students(name, grade) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET grade = COALESCE(NULLIF(excluded.grade, ''), students.grade)
  `).run(name, grade || "");
}

function upsertTeacher(name) {
  if (!name) return;
  db.prepare("INSERT OR IGNORE INTO teachers(name) VALUES (?)").run(name);
}

function syncStudentsFromLessons() {
  for (const lesson of all("SELECT student_names, grade FROM lessons")) {
    for (const name of splitStudents(lesson.student_names)) upsertStudent(name, lesson.grade);
  }
}

function syncTeachersFromLessons() {
  for (const row of all("SELECT DISTINCT teacher_name FROM lessons WHERE TRIM(teacher_name) <> ''")) {
    upsertTeacher(row.teacher_name);
  }
}

function autoPromoteStudentsForMonth(monthKey) {
  if (!validMonthKey(monthKey)) return { promoted: 0 };
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  if (month < 9) return { promoted: 0 };
  const settingKey = "grade_promotion_last_year";
  if (Number(getSetting(settingKey)) >= year) return { promoted: 0, already_done: true };
  const rows = all(`
    SELECT id, name, grade
    FROM students
    WHERE status IN ('在读', '暂停')
      AND grade IN (${GRADE_ORDER.map(() => "?").join(",")})
  `, GRADE_ORDER);
  let promoted = 0;
  for (const row of rows) {
    const next = NEXT_GRADE[row.grade] || row.grade;
    if (next === row.grade) continue;
    db.prepare("UPDATE students SET grade = ? WHERE id = ?").run(next, row.id);
    promoted += 1;
  }
  setSetting(settingKey, String(year));
  if (promoted) {
    db.prepare(`
      INSERT INTO audit_logs(run_id, source, severity, entity, field, before_value, after_value, status, notes)
      VALUES (?, 'student_grade_promotion', 'info', ?, 'grade', ?, ?, 'fixed', ?)
    `).run(
      `grade_promotion_${year}`,
      `students_${year}`,
      `${rows.length} students checked`,
      `${promoted} students promoted`,
      `${year} 年 9 月自动升年级`,
    );
  }
  return { promoted, year };
}

function activeTeacherNames(monthKey) {
  return new Set(all(
    "SELECT DISTINCT teacher_name FROM lessons WHERE month_key = ? AND TRIM(teacher_name) <> ''",
    [monthKey],
  ).map((row) => row.teacher_name));
}

function activeStudentNames(monthKey) {
  const active = new Set();
  for (const lesson of all("SELECT student_names FROM lessons WHERE month_key = ?", [monthKey])) {
    for (const name of splitStudents(lesson.student_names)) active.add(name);
  }
  for (const recharge of all(
    `SELECT DISTINCT student_name FROM recharge_records WHERE month_key = ? AND TRIM(student_name) <> '' AND ${REAL_RECHARGE_SQL}`,
    [monthKey],
  )) {
    active.add(recharge.student_name);
  }
  return active;
}

function teachersForMonth(monthKey, includeInactive = false) {
  const active = activeTeacherNames(monthKey);
  const rows = all("SELECT * FROM teachers ORDER BY name").map((row) => ({
    ...row,
    active_this_month: active.has(row.name),
  }));
  for (const name of active) {
    if (!rows.some((row) => row.name === name)) rows.push({ id: null, name, active_this_month: true });
  }
  return rows
    .filter((row) => includeInactive || row.active_this_month)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

function studentsForMonth(monthKey, includeInactive = false) {
  const active = activeStudentNames(monthKey);
  const rows = all("SELECT * FROM students ORDER BY name").map((row) => ({
    ...row,
    active_this_month: active.has(row.name),
  }));
  for (const name of active) {
    if (!rows.some((row) => row.name === name)) rows.push({ id: null, name, grade: "", active_this_month: true });
  }
  return rows
    .filter((row) => includeInactive || row.active_this_month)
    .sort((a, b) => compareGradeName(a.grade, b.grade) || a.name.localeCompare(b.name, "zh-Hans-CN"));
}

function todayKey() {
  return dateKey(new Date());
}

function firstTeacherLessonDate(name) {
  return text(get(`
    SELECT MIN(date) AS first_lesson_date
    FROM lessons
    WHERE teacher_name = ? AND date IS NOT NULL AND TRIM(date) <> ''
  `, [name])?.first_lesson_date);
}

function firstStudentLessonDate(name) {
  const studentName = text(name);
  if (!studentName) return "";
  for (const lesson of all(`
    SELECT date, student_names
    FROM lessons
    WHERE date IS NOT NULL AND TRIM(date) <> ''
    ORDER BY date, id
  `)) {
    if (splitStudents(lesson.student_names).includes(studentName)) return text(lesson.date);
  }
  return "";
}

function teacherProfiles() {
  return all(`
    SELECT *
    FROM teachers
    ORDER BY CASE status WHEN '在职' THEN 0 WHEN '离职' THEN 2 ELSE 1 END, name
  `).map((row) => ({ ...row, first_lesson_date: firstTeacherLessonDate(row.name) }));
}

function studentProfiles() {
  return all(`
    SELECT *
    FROM students
  `).map((row) => ({ ...row, first_lesson_date: firstStudentLessonDate(row.name) })).sort((a, b) => (
    ({ 在读: 0, 暂停: 1, 离校: 2, 已流出: 3, 已毕业: 4 }[a.status] ?? 1)
    - ({ 在读: 0, 暂停: 1, 离校: 2, 已流出: 3, 已毕业: 4 }[b.status] ?? 1)
    || compareGradeName(a.grade, b.grade)
    || a.name.localeCompare(b.name, "zh-Hans-CN")
  ));
}

function teacherHasHistory(name) {
  if (!name) return false;
  return num(get("SELECT COUNT(*) AS count FROM lessons WHERE teacher_name = ?", [name])?.count) > 0;
}

function studentHasHistory(name) {
  if (!name) return false;
  for (const lesson of all("SELECT student_names FROM lessons")) {
    if (splitStudents(lesson.student_names).includes(name)) return true;
  }
  if (num(get("SELECT COUNT(*) AS count FROM recharge_records WHERE student_name = ?", [name])?.count) > 0) return true;
  return num(get("SELECT COUNT(*) AS count FROM student_pricing WHERE student_name = ?", [name])?.count) > 0;
}

function createTeacherProfile(body) {
  const name = text(body.name);
  if (!name) return { error: "name is required", status: 400 };
  if (get("SELECT id FROM teachers WHERE name = ?", [name])) return { error: "teacher already exists", status: 409 };
  const result = db.prepare(`
    INSERT INTO teachers(name, phone, notes, status, joined_at, left_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    name,
    text(body.phone),
    text(body.notes),
    text(body.status || "在职"),
    text(body.joined_at),
    text(body.left_at),
  );
  return get("SELECT * FROM teachers WHERE id = ?", [Number(result.lastInsertRowid)]);
}

function upsertTeacherProfileFromAccount(name, phone = "") {
  if (!name) return null;
  db.prepare(`
    INSERT INTO teachers(name, phone, status)
    VALUES (?, ?, '在职')
    ON CONFLICT(name) DO UPDATE SET
      phone = COALESCE(NULLIF(excluded.phone, ''), teachers.phone),
      status = CASE WHEN teachers.status IS NULL OR TRIM(teachers.status) = '' THEN '在职' ELSE teachers.status END
  `).run(text(name), text(phone));
  return get("SELECT * FROM teachers WHERE name = ?", [text(name)]);
}

function createStudentProfile(body) {
  const name = text(body.name);
  if (!name) return { error: "name is required", status: 400 };
  if (get("SELECT id FROM students WHERE name = ?", [name])) return { error: "student already exists", status: 409 };
  const result = db.prepare(`
    INSERT INTO students(name, grade, phone, guardian, notes, status, joined_at, left_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    text(body.grade),
    text(body.phone),
    text(body.guardian),
    text(body.notes),
    text(body.status || "在读"),
    text(body.joined_at),
    text(body.left_at),
  );
  return get("SELECT * FROM students WHERE id = ?", [Number(result.lastInsertRowid)]);
}

function backfillStudentJoinedAt() {
  return withTransaction(() => {
    const updatedRows = [];
    const skippedRows = [];
    const rows = all(`
      SELECT id, name
      FROM students
      WHERE TRIM(COALESCE(joined_at, '')) = ''
      ORDER BY name
    `);
    for (const row of rows) {
      const joinedAt = firstStudentLessonDate(row.name);
      if (!joinedAt) {
        skippedRows.push({ id: row.id, name: row.name });
        continue;
      }
      db.prepare(`
        UPDATE students
        SET joined_at = ?
        WHERE id = ? AND TRIM(COALESCE(joined_at, '')) = ''
      `).run(joinedAt, Number(row.id));
      updatedRows.push({ id: row.id, name: row.name, joined_at: joinedAt });
    }
    return {
      updated: updatedRows.length,
      updated_rows: updatedRows,
      skipped_without_lessons: skippedRows.length,
      skipped_rows: skippedRows,
    };
  });
}

function backfillTeacherJoinedAt() {
  return withTransaction(() => {
    const updatedRows = [];
    const skippedRows = [];
    const rows = all(`
      SELECT id, name
      FROM teachers
      WHERE TRIM(COALESCE(joined_at, '')) = ''
      ORDER BY name
    `);
    for (const row of rows) {
      const joinedAt = firstTeacherLessonDate(row.name);
      if (!joinedAt) {
        skippedRows.push({ id: row.id, name: row.name });
        continue;
      }
      db.prepare(`
        UPDATE teachers
        SET joined_at = ?
        WHERE id = ? AND TRIM(COALESCE(joined_at, '')) = ''
      `).run(joinedAt, Number(row.id));
      updatedRows.push({ id: row.id, name: row.name, joined_at: joinedAt });
    }
    return {
      updated: updatedRows.length,
      updated_rows: updatedRows,
      skipped_without_lessons: skippedRows.length,
      skipped_rows: skippedRows,
    };
  });
}

function disableTeacherAccountsByName(teacherName) {
  const name = text(teacherName);
  if (!name) return { before: [], after: [], count: 0 };
  const before = all(`
    SELECT id, username, display_name, role, teacher_name, status, created_at, updated_at
    FROM users
    WHERE role = 'teacher' AND teacher_name = ? AND status <> 'disabled'
    ORDER BY id
  `, [name]);
  if (!before.length) return { before: [], after: [], count: 0 };
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE users
    SET status = 'disabled', updated_at = ?
    WHERE role = 'teacher' AND teacher_name = ? AND status <> 'disabled'
  `).run(now, name);
  const ids = before.map((row) => Number(row.id));
  const placeholders = ids.map(() => "?").join(",");
  const after = all(`
    SELECT id, username, display_name, role, teacher_name, status, created_at, updated_at
    FROM users
    WHERE id IN (${placeholders})
    ORDER BY id
  `, ids);
  return { before, after, count: after.length };
}

function deleteTeacherProfile(id) {
  const row = get("SELECT * FROM teachers WHERE id = ?", [Number(id)]);
  if (!row) return null;
  return withTransaction(() => {
    const disabledAccounts = disableTeacherAccountsByName(row.name);
    if (teacherHasHistory(row.name)) {
      db.prepare("UPDATE teachers SET status = '离职', left_at = COALESCE(NULLIF(left_at, ''), ?) WHERE id = ?").run(todayKey(), Number(id));
      return {
        deleted: false,
        soft_deleted: true,
        row: get("SELECT * FROM teachers WHERE id = ?", [Number(id)]),
        disabled_accounts_before: disabledAccounts.before,
        disabled_accounts: disabledAccounts.after,
        disabled_account_count: disabledAccounts.count,
      };
    }
    db.prepare("DELETE FROM teacher_adjustments_monthly WHERE teacher_name = ?").run(row.name);
    db.prepare("DELETE FROM teacher_adjustments WHERE teacher_name = ?").run(row.name);
    db.prepare("DELETE FROM teachers WHERE id = ?").run(Number(id));
    return {
      deleted: true,
      soft_deleted: false,
      disabled_accounts_before: disabledAccounts.before,
      disabled_accounts: disabledAccounts.after,
      disabled_account_count: disabledAccounts.count,
    };
  });
}

function deleteStudentProfile(id) {
  const row = get("SELECT * FROM students WHERE id = ?", [Number(id)]);
  if (!row) return null;
  if (studentHasHistory(row.name)) {
    db.prepare("UPDATE students SET status = '离校', left_at = COALESCE(NULLIF(left_at, ''), ?) WHERE id = ?").run(todayKey(), Number(id));
    return { deleted: false, soft_deleted: true, row: get("SELECT * FROM students WHERE id = ?", [Number(id)]) };
  }
  db.prepare("DELETE FROM students WHERE id = ?").run(Number(id));
  return { deleted: true, soft_deleted: false };
}

function staffRows() {
  return all(`
    SELECT *, CASE WHEN status IN ('在职', '暂停') THEN 1 ELSE 0 END AS active
    FROM staff
    ORDER BY CASE status WHEN '在职' THEN 0 WHEN '暂停' THEN 1 WHEN '离职' THEN 2 ELSE 3 END, name
  `);
}

function createStaff(body) {
  const name = text(body.name);
  if (!name) return { error: "name is required", status: 400 };
  return withTransaction(() => {
    const result = db.prepare(`
      INSERT INTO staff(name, role, base_salary, pay_type, daily_rate, standard_work_days, phone, status, joined_at, left_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      text(body.role) || "其他",
      num(body.base_salary),
      text(body.pay_type) || "月薪",
      num(body.daily_rate),
      num(body.standard_work_days) || 26,
      text(body.phone),
      text(body.status || "在职"),
      text(body.joined_at),
      text(body.left_at),
      text(body.notes),
    );
    return get("SELECT *, CASE WHEN status IN ('在职', '暂停') THEN 1 ELSE 0 END AS active FROM staff WHERE id = ?", [Number(result.lastInsertRowid)]);
  });
}

function patchStaff(id, body) {
  const current = get("SELECT * FROM staff WHERE id = ?", [Number(id)]);
  if (!current) return null;
  if (Object.prototype.hasOwnProperty.call(body, "name") && !text(body.name)) {
    return { error: "name is required", status: 400 };
  }
  return withTransaction(() => {
    const payload = {};
    for (const field of ["name", "role", "pay_type", "phone", "status", "joined_at", "left_at", "notes"]) {
      if (Object.prototype.hasOwnProperty.call(body, field)) payload[field] = text(body[field]);
    }
    if (Object.prototype.hasOwnProperty.call(body, "base_salary")) payload.base_salary = num(body.base_salary);
    if (Object.prototype.hasOwnProperty.call(body, "daily_rate")) payload.daily_rate = num(body.daily_rate);
    if (Object.prototype.hasOwnProperty.call(body, "standard_work_days")) payload.standard_work_days = num(body.standard_work_days) || 26;
    patchTable("staff", "id", Number(id), [
      "name", "role", "base_salary", "pay_type", "daily_rate", "standard_work_days", "phone", "status", "joined_at", "left_at", "notes",
    ], payload);
    return get("SELECT *, CASE WHEN status IN ('在职', '暂停') THEN 1 ELSE 0 END AS active FROM staff WHERE id = ?", [Number(id)]);
  });
}

function staffHasPayrollValue(staffId) {
  const row = get(`
    SELECT COUNT(*) AS count
    FROM staff_salary_monthly
    WHERE staff_id = ?
      AND (COALESCE(salary_actual, 0) <> 0 OR COALESCE(bonus, 0) <> 0 OR COALESCE(deduction, 0) <> 0)
  `, [Number(staffId)]);
  return num(row?.count) > 0;
}

function deleteStaff(id) {
  const row = get("SELECT * FROM staff WHERE id = ?", [Number(id)]);
  if (!row) return null;
  return withTransaction(() => {
    if (staffHasPayrollValue(id)) {
      db.prepare("UPDATE staff SET status = '离职', left_at = COALESCE(NULLIF(left_at, ''), ?) WHERE id = ?").run(todayKey(), Number(id));
      return { deleted: false, soft_deleted: true, row: get("SELECT * FROM staff WHERE id = ?", [Number(id)]) };
    }
    db.prepare("DELETE FROM staff_salary_monthly WHERE staff_id = ?").run(Number(id));
    db.prepare("DELETE FROM staff_attendance WHERE staff_id = ?").run(Number(id));
    db.prepare("DELETE FROM staff WHERE id = ?").run(Number(id));
    return { deleted: true, soft_deleted: false };
  });
}

function ensureStaffSalaryRows(monthKey) {
  if (!validMonthKey(monthKey)) throw new Error("month must be YYYY-MM-01");
  db.prepare(`
    INSERT OR IGNORE INTO staff_salary_monthly(staff_id, month_key, salary_actual, bonus, deduction, notes)
    SELECT id, ?, base_salary, 0, 0, 'auto'
    FROM staff
    WHERE status IN ('在职', '暂停')
  `).run(monthKey);
}

function attendancePayUnit(statusValue) {
  const status = text(statusValue) || "上班";
  return Object.prototype.hasOwnProperty.call(ATTENDANCE_PAY_UNITS, status) ? ATTENDANCE_PAY_UNITS[status] : 1;
}

function staffAttendanceSummary(monthKey) {
  const rows = all(`
    SELECT staff_id, status, COUNT(*) AS count, SUM(COALESCE(pay_units, 0)) AS pay_units
    FROM staff_attendance
    WHERE month_key = ?
    GROUP BY staff_id, status
  `, [monthKey]);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.staff_id)) {
      map.set(row.staff_id, { attendance_days: 0, pay_units: 0, by_status: {} });
    }
    const summary = map.get(row.staff_id);
    summary.attendance_days += num(row.count);
    summary.pay_units += num(row.pay_units);
    summary.by_status[row.status] = num(row.count);
  }
  return map;
}

function staffBasePay(row, attendanceSummary = null) {
  if (!attendanceSummary || !attendanceSummary.attendance_days) return moneyRound(row.base_salary);
  if (row.pay_type === "日薪") {
    const rate = num(row.daily_rate) || num(row.base_salary);
    return moneyRound(rate * num(attendanceSummary.pay_units));
  }
  const standardDays = Math.max(1, num(row.standard_work_days) || 26);
  return moneyRound(num(row.base_salary) / standardDays * num(attendanceSummary.pay_units));
}

function staffSalaryRows(monthKey) {
  ensureStaffSalaryRows(monthKey);
  const attendance = staffAttendanceSummary(monthKey);
  for (const row of all(`
    SELECT s.*, ssm.bonus, ssm.deduction, ssm.notes
    FROM staff_salary_monthly ssm
    JOIN staff s ON s.id = ssm.staff_id
    WHERE ssm.month_key = ?
  `, [monthKey])) {
    upsertStaffSalaryRow(row, monthKey, row.bonus, row.deduction, row.notes, attendance);
  }
  return all(`
    SELECT
      ssm.id,
      s.id AS staff_id,
      s.name,
      s.role,
      s.base_salary,
      s.pay_type,
      s.daily_rate,
      s.standard_work_days,
      s.phone,
      s.status,
      s.left_at,
      ssm.month_key,
      ssm.salary_actual,
      ssm.bonus,
      ssm.deduction,
      ssm.notes
    FROM staff_salary_monthly ssm
    JOIN staff s ON s.id = ssm.staff_id
    WHERE ssm.month_key = ?
    ORDER BY s.role, s.name
  `, [monthKey]).map((row) => {
    const summary = attendance.get(row.staff_id) || { attendance_days: 0, pay_units: 0, by_status: {} };
    const basePay = staffBasePay(row, summary.attendance_days ? summary : null);
    return {
      ...row,
      attendance_days: summary.attendance_days,
      pay_units: summary.pay_units,
      attendance_by_status: summary.by_status,
      expected_salary: moneyRound(basePay + num(row.bonus) - num(row.deduction)),
    };
  });
}

function upsertStaffSalaryRow(staff, monthKey, bonus, deduction, notes, attendanceSummary = null) {
  const attendance = (attendanceSummary || staffAttendanceSummary(monthKey)).get(staff.id);
  const salaryActual = moneyRound(staffBasePay(staff, attendance) + num(bonus) - num(deduction));
  db.prepare(`
    INSERT INTO staff_salary_monthly(staff_id, month_key, salary_actual, bonus, deduction, notes)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(staff_id, month_key) DO UPDATE SET
      salary_actual = excluded.salary_actual,
      bonus = excluded.bonus,
      deduction = excluded.deduction,
      notes = excluded.notes
  `).run(staff.id, monthKey, salaryActual, num(bonus), num(deduction), text(notes));
  return salaryActual;
}

function upsertStaffSalary(body) {
  const staffId = Number(body.staff_id);
  const monthKey = text(body.month_key || getSetting("month_key"));
  if (!staffId) return { error: "staff_id is required", status: 400 };
  if (!validMonthKey(monthKey)) return { error: "month_key must be YYYY-MM-01", status: 400 };
  const staff = get("SELECT * FROM staff WHERE id = ?", [staffId]);
  if (!staff) return { error: "staff not found", status: 404 };
  return withTransaction(() => {
    const existing = get("SELECT id FROM staff_salary_monthly WHERE staff_id = ? AND month_key = ?", [staffId, monthKey]);
    if (staff.status === "离职" && existing) {
      return { error: "该员工已离职，不能修改其薪资记录", status: 409 };
    }
    const bonus = num(body.bonus);
    const deduction = num(body.deduction);
    upsertStaffSalaryRow(staff, monthKey, bonus, deduction, body.notes);
    return get(`
      SELECT
        ssm.id, s.id AS staff_id, s.name, s.role, s.base_salary, s.pay_type, s.daily_rate, s.standard_work_days, s.status, s.left_at,
        ssm.month_key, ssm.salary_actual, ssm.bonus, ssm.deduction, ssm.notes,
        ssm.salary_actual AS expected_salary
      FROM staff_salary_monthly ssm
      JOIN staff s ON s.id = ssm.staff_id
      WHERE ssm.staff_id = ? AND ssm.month_key = ?
    `, [staffId, monthKey]);
  });
}

function staffAttendanceRows(monthKey) {
  if (!validMonthKey(monthKey)) throw new Error("month must be YYYY-MM-01");
  return all(`
    SELECT
      sa.*,
      s.name,
      s.role,
      s.status AS staff_status,
      s.left_at
    FROM staff_attendance sa
    JOIN staff s ON s.id = sa.staff_id
    WHERE sa.month_key = ?
    ORDER BY s.role, s.name, sa.attendance_date
  `, [monthKey]);
}

function upsertStaffAttendance(body) {
  return withTransaction(() => upsertStaffAttendanceRow(body));
}

function upsertStaffAttendanceRow(body) {
  const staffId = Number(body.staff_id);
  const date = isoDateValue(body.attendance_date || body.date);
  const monthKey = monthKeyFromDate(date);
  if (!staffId || !date || !monthKey) return { error: "staff_id and attendance_date are required", status: 400 };
  const staff = get("SELECT * FROM staff WHERE id = ?", [staffId]);
  if (!staff) return { error: "staff not found", status: 404 };
  const status = ATTENDANCE_STATUS.includes(text(body.status)) ? text(body.status) : "上班";
  const payUnits = Object.prototype.hasOwnProperty.call(body, "pay_units") ? num(body.pay_units) : attendancePayUnit(status);
  db.prepare(`
    INSERT INTO staff_attendance(staff_id, attendance_date, month_key, status, pay_units, hours, reason, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(staff_id, attendance_date) DO UPDATE SET
      status = excluded.status,
      pay_units = excluded.pay_units,
      hours = excluded.hours,
      reason = excluded.reason,
      notes = excluded.notes,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    staffId,
    date,
    monthKey,
    status,
    payUnits,
    num(body.hours),
    text(body.reason),
    text(body.notes),
  );
  // Keep the monthly payroll row in sync once attendance starts driving pay.
  const salary = get("SELECT * FROM staff_salary_monthly WHERE staff_id = ? AND month_key = ?", [staffId, monthKey]);
  if (salary) upsertStaffSalaryRow(staff, monthKey, salary.bonus, salary.deduction, salary.notes);
  return get(`
    SELECT sa.*, s.name, s.role, s.status AS staff_status
    FROM staff_attendance sa
    JOIN staff s ON s.id = sa.staff_id
    WHERE sa.staff_id = ? AND sa.attendance_date = ?
  `, [staffId, date]);
}

function deleteStaffAttendance(staffId, date) {
  return withTransaction(() => deleteStaffAttendanceRow(staffId, date));
}

function deleteStaffAttendanceRow(staffId, date) {
  const dateValue = isoDateValue(date);
  if (!staffId || !dateValue) return { error: "staff_id and attendance_date are required", status: 400 };
  const monthKey = monthKeyFromDate(dateValue);
  const staff = get("SELECT * FROM staff WHERE id = ?", [Number(staffId)]);
  const salary = get("SELECT * FROM staff_salary_monthly WHERE staff_id = ? AND month_key = ?", [Number(staffId), monthKey]);
  const result = db.prepare("DELETE FROM staff_attendance WHERE staff_id = ? AND attendance_date = ?").run(Number(staffId), dateValue);
  if (salary && staff) upsertStaffSalaryRow(staff, monthKey, salary.bonus, salary.deduction, salary.notes);
  return { deleted: (result.changes || 0) > 0 };
}

function expenseRows(url) {
  const start = text(url.searchParams.get("start"));
  const end = text(url.searchParams.get("end"));
  const category = text(url.searchParams.get("category"));
  const q = text(url.searchParams.get("q"));
  const where = [];
  const params = [];
  if (start) {
    where.push("expense_date >= ?");
    params.push(start);
  }
  if (end) {
    where.push("expense_date <= ?");
    params.push(end);
  }
  if (category) {
    where.push("category = ?");
    params.push(category);
  }
  if (q) {
    where.push("(vendor LIKE ? OR notes LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const sql = `
    SELECT *
    FROM operating_expenses
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY expense_date DESC, id DESC
  `;
  return all(sql, params);
}

function createExpense(body) {
  const category = text(body.category) || "其他";
  const expenseDate = text(body.expense_date);
  const amount = num(body.amount);
  if (!expenseDate || !monthKeyFromDate(expenseDate)) return { error: "expense_date must be YYYY-MM-DD", status: 400 };
  if (amount <= 0) return { error: "amount must be greater than 0", status: 400 };
  return withTransaction(() => {
    const result = db.prepare(`
      INSERT INTO operating_expenses(category, expense_date, amount, vendor, notes, month_key)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(category, expenseDate, amount, text(body.vendor), text(body.notes), monthKeyFromDate(expenseDate));
    return get("SELECT * FROM operating_expenses WHERE id = ?", [Number(result.lastInsertRowid)]);
  });
}

function patchExpense(id, body) {
  const current = get("SELECT * FROM operating_expenses WHERE id = ?", [Number(id)]);
  if (!current) return null;
  return withTransaction(() => {
    const payload = {};
    for (const field of ["category", "expense_date", "vendor", "notes"]) {
      if (Object.prototype.hasOwnProperty.call(body, field)) payload[field] = text(body[field]);
    }
    if (Object.prototype.hasOwnProperty.call(body, "amount")) payload.amount = num(body.amount);
    const dateValue = payload.expense_date || current.expense_date;
    if (!monthKeyFromDate(dateValue)) return { error: "expense_date must be YYYY-MM-DD", status: 400 };
    if (Object.prototype.hasOwnProperty.call(payload, "amount") && payload.amount <= 0) {
      return { error: "amount must be greater than 0", status: 400 };
    }
    payload.month_key = monthKeyFromDate(dateValue);
    patchTable("operating_expenses", "id", Number(id), [
      "category", "expense_date", "amount", "vendor", "notes", "month_key",
    ], payload);
    return get("SELECT * FROM operating_expenses WHERE id = ?", [Number(id)]);
  });
}

function buildFeeDetails(monthKey) {
  const lessons = all("SELECT * FROM lessons WHERE month_key = ? ORDER BY date, teacher_name, time_slot, sort_order, id", [monthKey]);
  const details = [];
  for (const lesson of lessons) {
    const names = splitStudents(lesson.student_names);
    const studentCount = names.length;
    const status = deriveStatus(lesson);
    names.forEach((studentName, index) => {
      const price = unitPriceFor({
        studentName,
        subject: lesson.subject,
        grade: lesson.grade,
        studentCount,
        lessonId: lesson.id,
        status,
        studentNames: lesson.student_names,
      });
      const detail = {
        status,
        unit_price: price.unit_price,
        price_source: price.source,
      };
      const billable = isBillableDetail(detail);
      details.push({
        id: `${lesson.id}:${index + 1}`,
        lesson_id: lesson.id,
        student_index: index + 1,
        student_name: studentName,
        student_names: normalizedStudents(lesson.student_names),
        teacher_name: lesson.teacher_name,
        date: lesson.date,
        lesson_status: lesson.lesson_status,
        status,
        weekday: weekdayCn(lesson.date),
        time_slot: lesson.time_slot,
        classroom: lesson.classroom,
        grade: lesson.grade,
        subject: lesson.subject,
        notes: lesson.notes,
        unit_price: billable ? price.unit_price : 0,
        price_source: price.source,
        rule_price: billable ? price.rule_price : 0,
        pricing_rule_id: price.pricing_rule_id || null,
        can_apply_pricing_rule: billable && price.pricing_rule_id && price.rule_price != null,
        course_status: lesson.course_status,
        teacher_salary: num(lesson.teacher_salary),
        student_count: studentCount,
        effective: billable,
      });
    });
  }
  return details;
}

function feeDetails(monthKey) {
  const key = text(monthKey);
  return cachedDerived(
    "feeDetails",
    key,
    `feeDetails month=${key}`,
    () => buildFeeDetails(key),
    (rows) => markFeeDetails(rows, key),
  );
}

function studentAccountEventDate(row, monthKey = "") {
  const direct = text(row.event_date || row.recharge_date || row.date);
  if (validDateKey(direct)) return direct;
  const rowMonth = text(row.month_key);
  if (validMonthKey(rowMonth)) return rowMonth;
  if (validMonthKey(monthKey)) return monthKey;
  return "";
}

function studentAccountLessonDate(row, monthKey = "") {
  const direct = text(row.date);
  if (validDateKey(direct)) return direct;
  if (validMonthKey(monthKey)) return monthEndKey(monthKey);
  return studentAccountEventDate(row, monthKey);
}

function studentAccountTimeOrder(value) {
  const range = parseTimeRange(value);
  return range ? range.start : 24 * 60 + 999;
}

function studentAccountEventSortKey(event) {
  if (event.type === "recharge") {
    return [
      event.date,
      "0",
      "0000",
      String(num(event.row?.id)).padStart(10, "0"),
      String(event.index).padStart(10, "0"),
    ].join("|");
  }
  return [
    event.date,
    "1",
    String(event.time_order).padStart(4, "0"),
    String(num(event.row?.lesson_id)).padStart(10, "0"),
    String(num(event.row?.student_index)).padStart(6, "0"),
    text(event.row?.id),
    String(event.index).padStart(10, "0"),
  ].join("|");
}

function compareStudentAccountEvents(a, b) {
  return studentAccountEventSortKey(a).localeCompare(studentAccountEventSortKey(b), "zh-Hans-CN");
}

function studentAccountBatchBalance(batches) {
  return batches.reduce((acc, batch) => ({
    actual: moneyRound(acc.actual + num(batch.actual_balance)),
    gift: moneyRound(acc.gift + num(batch.gift_balance)),
  }), { actual: 0, gift: 0 });
}

function addStudentAccountBatch(batches, row = {}, fallbackDate = "") {
  const actual = moneyRound(row.actual_balance ?? row.cur_recharge);
  const gift = moneyRound(row.gift_balance ?? row.cur_gift);
  if (actual === 0 && gift === 0) return;
  let batchActual = actual;
  let batchGift = gift;

  if (actual > 0) {
    const current = studentAccountBatchBalance(batches);
    let remainingOffset = Math.min(Math.max(-current.actual, 0), actual);
    for (const batch of batches) {
      if (remainingOffset <= 0) break;
      const debt = Math.max(-num(batch.actual_balance), 0);
      if (debt <= 0) continue;
      const offset = Math.min(debt, remainingOffset);
      batch.actual_balance = moneyRound(num(batch.actual_balance) + offset);
      remainingOffset = moneyRound(remainingOffset - offset);
    }
    batchActual = moneyRound(actual - Math.min(Math.max(-current.actual, 0), actual));
  } else if (actual < 0) {
    let remainingReduction = Math.abs(actual);
    for (const batch of batches) {
      if (remainingReduction <= 0) break;
      const available = Math.max(num(batch.actual_balance), 0);
      if (available <= 0) continue;
      const reduction = Math.min(available, remainingReduction);
      batch.actual_balance = moneyRound(num(batch.actual_balance) - reduction);
      remainingReduction = moneyRound(remainingReduction - reduction);
    }
    batchActual = remainingReduction > 0 ? moneyRound(-remainingReduction) : 0;
  }

  if (gift < 0) {
    let remainingReduction = Math.abs(gift);
    for (const batch of batches) {
      if (remainingReduction <= 0) break;
      const available = Math.max(num(batch.gift_balance), 0);
      if (available <= 0) continue;
      const reduction = Math.min(available, remainingReduction);
      batch.gift_balance = moneyRound(num(batch.gift_balance) - reduction);
      remainingReduction = moneyRound(remainingReduction - reduction);
    }
    batchGift = remainingReduction > 0 ? moneyRound(-remainingReduction) : 0;
  }
  if (batchActual === 0 && batchGift === 0) return;
  batches.push({
    date: studentAccountEventDate(row, fallbackDate),
    id: row.id || 0,
    actual_balance: batchActual,
    gift_balance: batchGift,
  });
}

function applyStudentLessonCharge(batches, feeValue) {
  let remaining = moneyRound(Math.max(0, num(feeValue)));
  let actualUse = 0;
  let giftUse = 0;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const cashUse = moneyRound(Math.min(Math.max(num(batch.actual_balance), 0), remaining));
    if (cashUse > 0) {
      batch.actual_balance = moneyRound(num(batch.actual_balance) - cashUse);
      remaining = moneyRound(remaining - cashUse);
      actualUse = moneyRound(actualUse + cashUse);
    }
    if (remaining <= 0) break;
    const giftUseValue = moneyRound(Math.min(Math.max(num(batch.gift_balance), 0), remaining));
    if (giftUseValue > 0) {
      batch.gift_balance = moneyRound(num(batch.gift_balance) - giftUseValue);
      remaining = moneyRound(remaining - giftUseValue);
      giftUse = moneyRound(giftUse + giftUseValue);
    }
  }

  if (remaining > 0) {
    batches.push({ date: "", id: 0, actual_balance: moneyRound(-remaining), gift_balance: 0 });
    actualUse = moneyRound(actualUse + remaining);
  }
  return {
    actual_consumption: moneyRound(actualUse),
    gift_consumption: moneyRound(giftUse),
  };
}

function calculateStudentAccountTimeline(options = {}) {
  const monthKey = text(options.monthKey);
  const batches = [];
  addStudentAccountBatch(batches, {
    event_date: "",
    id: 0,
    actual_balance: options.openingActual,
    gift_balance: options.openingGift,
  }, monthKey);
  const details = (options.details || []).filter((row) => row.effective);
  const recharges = (options.recharges || []).filter(isRealRechargeRecord);
  const events = [
    ...recharges.map((row, index) => ({ type: "recharge", date: studentAccountEventDate(row, monthKey), row, index })),
    ...details.map((row, index) => ({
      type: "lesson",
      date: studentAccountLessonDate(row, monthKey),
      time_order: studentAccountTimeOrder(row.time_slot),
      row,
      index,
    })),
  ].sort(compareStudentAccountEvents);
  const result = {
    lesson_count: 0,
    total_fee: 0,
    cur_recharge: 0,
    cur_gift: 0,
    actual_consumption: 0,
    gift_consumption: 0,
    actual_balance: moneyRound(options.openingActual),
    gift_balance: moneyRound(options.openingGift),
  };

  for (const event of events) {
    if (event.type === "recharge") {
      const actual = moneyRound(event.row.cur_recharge);
      const gift = moneyRound(event.row.cur_gift);
      result.cur_recharge = moneyRound(result.cur_recharge + actual);
      result.cur_gift = moneyRound(result.cur_gift + gift);
      addStudentAccountBatch(batches, event.row, monthKey);
      continue;
    }
    const fee = moneyRound(Math.max(0, num(event.row.unit_price)));
    result.lesson_count += 1;
    result.total_fee = moneyRound(result.total_fee + fee);
    const charge = applyStudentLessonCharge(batches, fee);
    result.actual_consumption = moneyRound(result.actual_consumption + charge.actual_consumption);
    result.gift_consumption = moneyRound(result.gift_consumption + charge.gift_consumption);
  }

  const balance = studentAccountBatchBalance(batches);
  result.actual_balance = moneyRound(balance.actual);
  result.gift_balance = moneyRound(balance.gift);
  return result;
}

function previousCarryOverBalances(monthKey, cache = new Map()) {
  if (!validMonthKey(monthKey)) return new Map();
  if (cache.has(monthKey)) return cache.get(monthKey);
  const fromMonth = previousDataMonth(monthKey);
  if (!fromMonth) {
    const opening = openingBalanceMap();
    cache.set(monthKey, opening);
    return opening;
  }
  const rows = studentSummary(feeDetails(fromMonth), fromMonth, true, cache);
  const balances = new Map(rows.filter(studentSummaryHasSignal).map((row) => [row.student_name, {
    month_key: fromMonth,
    actual_balance: num(row.actual_balance),
    gift_balance: num(row.gift_balance),
  }]));
  cache.set(monthKey, balances);
  return balances;
}

function buildStudentSummary(details, monthKey, includeInactive = false, carryOverCache = new Map()) {
  const byStudent = new Map();
  const active = activeStudentNames(monthKey);
  const profiles = new Map(all("SELECT name, grade, status FROM students").map((row) => [row.name, row]));
  const carryOverBalances = previousCarryOverBalances(monthKey, carryOverCache);
  for (const detail of details) {
    const profile = profiles.get(detail.student_name) || {};
    if (!byStudent.has(detail.student_name)) {
      byStudent.set(detail.student_name, {
        student_name: detail.student_name,
        grade: detail.grade || profile.grade || "",
        status: profile.status || "在读",
        lesson_count: 0,
        total_fee: 0,
        active_this_month: active.has(detail.student_name),
      });
    }
    const row = byStudent.get(detail.student_name);
    if (!row.grade && detail.grade) row.grade = detail.grade;
    if (detail.effective) {
      row.lesson_count += 1;
      row.total_fee = moneyRound(row.total_fee + num(detail.unit_price));
    }
  }
  for (const recharge of all(`SELECT * FROM recharge_records WHERE month_key = ? AND ${REAL_RECHARGE_SQL}`, [monthKey])) {
    const profile = profiles.get(recharge.student_name) || {};
    if (!byStudent.has(recharge.student_name)) {
      byStudent.set(recharge.student_name, {
        student_name: recharge.student_name,
        grade: recharge.grade || profile.grade || "",
        status: profile.status || "在读",
        lesson_count: 0,
        total_fee: 0,
        active_this_month: active.has(recharge.student_name),
      });
    }
  }
  for (const [studentName, balance] of carryOverBalances.entries()) {
    if (num(balance.actual_balance) === 0 && num(balance.gift_balance) === 0) continue;
    const profile = profiles.get(studentName) || {};
    if (!byStudent.has(studentName)) {
      byStudent.set(studentName, {
        student_name: studentName,
        grade: balance.grade || profile.grade || "",
        status: profile.status || "在读",
        lesson_count: 0,
        total_fee: 0,
        active_this_month: active.has(studentName),
      });
    }
  }
  if (includeInactive) {
    for (const student of all("SELECT * FROM students ORDER BY name")) {
      if (!byStudent.has(student.name)) {
        byStudent.set(student.name, {
          student_name: student.name,
          grade: student.grade || "",
          status: student.status || "在读",
          lesson_count: 0,
          total_fee: 0,
          active_this_month: active.has(student.name),
        });
      }
    }
  }

  const rows = [...byStudent.values()]
    .sort((a, b) => a.student_name.localeCompare(b.student_name, "zh-Hans-CN"));
  const rechargeRows = all(`SELECT * FROM recharge_records WHERE month_key = ? AND ${REAL_RECHARGE_SQL}`, [monthKey]);
  const rechargesByStudent = new Map();
  for (const recharge of rechargeRows) {
    if (!rechargesByStudent.has(recharge.student_name)) rechargesByStudent.set(recharge.student_name, []);
    rechargesByStudent.get(recharge.student_name).push(recharge);
  }
  for (const list of rechargesByStudent.values()) {
    list.sort((a, b) => compareStudentAccountEvents(
      { type: "recharge", date: studentAccountEventDate(a, monthKey), row: a, index: 0 },
      { type: "recharge", date: studentAccountEventDate(b, monthKey), row: b, index: 0 },
    ));
  }
  const detailsByStudent = new Map();
  for (const detail of details) {
    if (!detail.effective) continue;
    if (!detailsByStudent.has(detail.student_name)) detailsByStudent.set(detail.student_name, []);
    detailsByStudent.get(detail.student_name).push(detail);
  }
  return rows.map((row) => {
    const studentRecharges = rechargesByStudent.get(row.student_name) || [];
    const recharge = studentRecharges[0] || {};
    const carryOver = carryOverBalances.get(row.student_name);
    const storedPrevActual = num(recharge.prev_actual);
    const storedPrevGift = num(recharge.prev_gift);
    const prevActual = carryOver ? num(carryOver.actual_balance) : storedPrevActual;
    const prevGift = carryOver ? num(carryOver.gift_balance) : storedPrevGift;
    const account = calculateStudentAccountTimeline({
      studentName: row.student_name,
      monthKey,
      details: detailsByStudent.get(row.student_name) || [],
      recharges: studentRecharges,
      openingActual: prevActual,
      openingGift: prevGift,
    });
    return {
      ...row,
      lesson_count: account.lesson_count,
      total_fee: account.total_fee,
      grade: row.grade || recharge.grade || profiles.get(row.student_name)?.grade || "",
      status: row.status || profiles.get(row.student_name)?.status || "在读",
      prev_actual: moneyRound(prevActual),
      prev_gift: moneyRound(prevGift),
      prev_actual_stored: storedPrevActual,
      prev_gift_stored: storedPrevGift,
      prev_source_month: carryOver?.month_key || "",
      cur_recharge: account.cur_recharge,
      cur_gift: account.cur_gift,
      recharge_date: recharge.recharge_date || "",
      recharge_notes: recharge.notes || "",
      actual_consumption: account.actual_consumption,
      gift_consumption: account.gift_consumption,
      actual_balance: account.actual_balance,
      gift_balance: account.gift_balance,
    };
  }).filter((row) => shouldShowStudentSummaryRow(row, includeInactive));
}

function studentSummary(details, monthKey, includeInactive = false, carryOverCache = new Map()) {
  const canCache = Array.isArray(details) && details.__feeDetailsMonthKey === monthKey;
  if (!canCache) return buildStudentSummary(details, monthKey, includeInactive, carryOverCache);
  return cachedDerived(
    "studentSummary",
    cacheKey(monthKey, includeInactive ? "1" : "0"),
    `studentSummary month=${monthKey} includeInactive=${includeInactive ? 1 : 0}`,
    () => buildStudentSummary(details, monthKey, includeInactive, carryOverCache),
  );
}

function studentSummaryHasSignal(row) {
  return row.active_this_month
    || num(row.lesson_count) !== 0
    || num(row.total_fee) !== 0
    || num(row.prev_actual) !== 0
    || num(row.prev_gift) !== 0
    || num(row.cur_recharge) !== 0
    || num(row.cur_gift) !== 0
    || num(row.actual_balance) !== 0
    || num(row.gift_balance) !== 0
    || !!text(row.recharge_date)
    || !!text(row.recharge_notes);
}

function buildStudentSummaryToDate(monthKey, includeInactive = false) {
  if (!validMonthKey(monthKey)) return [];
  const months = allPartitionedMonths()
    .filter((item) => item <= monthKey)
    .sort((a, b) => a.localeCompare(b));
  const profiles = new Map(all("SELECT name, grade, status FROM students").map((row) => [row.name, row]));
  const active = activeStudentNames(monthKey);
  const byStudent = new Map();
  const carryOverCache = new Map();

  for (const itemMonth of months) {
    const monthRows = studentSummary(feeDetails(itemMonth), itemMonth, true, carryOverCache);
    for (const row of monthRows) {
      if (!studentSummaryHasSignal(row)) continue;
      const profile = profiles.get(row.student_name) || {};
      if (!byStudent.has(row.student_name)) {
        byStudent.set(row.student_name, {
          student_name: row.student_name,
          grade: row.grade || profile.grade || "",
          status: profile.status || row.status || "在读",
          lesson_count: 0,
          total_fee: 0,
          prev_actual: 0,
          prev_gift: 0,
          cur_recharge: 0,
          cur_gift: 0,
          actual_consumption: 0,
          gift_consumption: 0,
          actual_balance: 0,
          gift_balance: 0,
          active_this_month: active.has(row.student_name),
          first_month: itemMonth,
          latest_month: itemMonth,
          summary_scope: "to_date",
        });
      }
      const target = byStudent.get(row.student_name);
      if (!target.grade && row.grade) target.grade = row.grade;
      target.status = profile.status || row.status || target.status;
      target.lesson_count += num(row.lesson_count);
      target.total_fee = moneyRound(target.total_fee + num(row.total_fee));
      target.cur_recharge = moneyRound(target.cur_recharge + num(row.cur_recharge));
      target.cur_gift = moneyRound(target.cur_gift + num(row.cur_gift));
      target.actual_consumption = moneyRound(target.actual_consumption + num(row.actual_consumption));
      target.gift_consumption = moneyRound(target.gift_consumption + num(row.gift_consumption));
      target.actual_balance = moneyRound(row.actual_balance);
      target.gift_balance = moneyRound(row.gift_balance);
      target.latest_month = itemMonth;
    }
  }

  return [...byStudent.values()]
    .filter((row) => shouldShowStudentSummaryRow(row, includeInactive))
    .sort((a, b) => compareGradeName(a.grade, b.grade) || a.student_name.localeCompare(b.student_name, "zh-Hans-CN"));
}

function studentSummaryToDate(monthKey, includeInactive = false) {
  return cachedDerived(
    "studentSummaryToDate",
    cacheKey(monthKey, includeInactive ? "1" : "0"),
    `studentSummaryToDate month=${monthKey} includeInactive=${includeInactive ? 1 : 0}`,
    () => buildStudentSummaryToDate(monthKey, includeInactive),
  );
}

function buildTeacherSummary(monthKey, includeInactive = false) {
  const lessons = all("SELECT * FROM lessons WHERE month_key = ? ORDER BY date, teacher_name, time_slot, sort_order, id", [monthKey]);
  const byTeacher = new Map();
  const active = activeTeacherNames(monthKey);
  const seedTeachers = includeInactive
    ? all("SELECT name FROM teachers ORDER BY name").map((row) => row.name)
    : [...active];
  for (const teacherName of seedTeachers) {
    byTeacher.set(teacherName, {
      teacher_name: teacherName,
      lesson_count: 0,
      salary_total: 0,
      active_this_month: active.has(teacherName),
    });
  }
  for (const lesson of lessons) {
    const name = lesson.teacher_name || "未填写";
    if (!byTeacher.has(name)) byTeacher.set(name, {
      teacher_name: name,
      lesson_count: 0,
      salary_total: 0,
      active_this_month: active.has(name),
    });
    const row = byTeacher.get(name);
    if (isCompletedLesson(lesson)) {
      row.lesson_count += 1;
      row.salary_total = moneyRound(row.salary_total + num(lesson.teacher_salary));
    }
  }
  return [...byTeacher.values()].filter((row) => includeInactive || row.active_this_month).map((row) => {
    const adj = get(
      "SELECT * FROM teacher_adjustments_monthly WHERE teacher_name = ? AND month_key = ?",
      [row.teacher_name, monthKey],
    ) || {};
    const week1 = num(adj.week1_transport);
    const week2 = num(adj.week2_transport);
    const week3 = num(adj.week3_transport);
    const week4 = num(adj.week4_transport);
    return {
      ...row,
      week1_transport: week1,
      week2_transport: week2,
      week3_transport: week3,
      week4_transport: week4,
      salary_total: moneyRound(row.salary_total),
      total_salary: moneyRound(row.salary_total + week1 + week2 + week3 + week4),
      notes: adj.notes || "",
    };
  }).sort((a, b) => a.teacher_name.localeCompare(b.teacher_name, "zh-Hans-CN"));
}

function teacherSummary(monthKey, includeInactive = false) {
  return cachedDerived(
    "teacherSummary",
    cacheKey(monthKey, includeInactive ? "1" : "0"),
    `teacherSummary month=${monthKey} includeInactive=${includeInactive ? 1 : 0}`,
    () => buildTeacherSummary(monthKey, includeInactive),
  );
}

function getSetting(key) {
  const row = get("SELECT value FROM settings WHERE key = ?", [key]);
  return row ? row.value : "";
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function jsonArraySetting(key) {
  const raw = getSetting(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function mergeLookupValues(defaults, customKey) {
  const seen = new Set();
  return [...(defaults || []), ...jsonArraySetting(customKey)].filter((value) => {
    const normalized = text(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).map(text);
}

function usedLessonLookups() {
  const fields = {
    teachers: "teacher_name",
    classrooms: "classroom",
    grades: "grade",
    subjects: "subject",
    times: "time_slot",
  };
  const distinct = (field) => all(`
    SELECT DISTINCT ${field} AS value
    FROM lessons
    WHERE ${field} IS NOT NULL AND TRIM(${field}) <> ''
    ORDER BY value
  `).map((row) => text(row.value)).filter(Boolean);
  const lookups = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, distinct(field)]));
  lookups.students = uniqueNames(all(`
    SELECT student_names
    FROM lessons
    WHERE student_names IS NOT NULL AND TRIM(student_names) <> ''
  `).flatMap((row) => splitStudents(row.student_names)))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  return lookups;
}

function resolveMonthKey(url) {
  return text(url.searchParams.get("month")) || getSetting("month_key");
}

function availableMonths() {
  return all(`
    SELECT month_key
    FROM (
      SELECT DISTINCT month_key FROM lessons WHERE month_key IS NOT NULL AND month_key <> ''
      UNION
      SELECT DISTINCT month_key FROM recharge_records WHERE month_key IS NOT NULL AND month_key <> ''
    )
    ORDER BY month_key DESC
  `).map((row) => row.month_key);
}

function tableExists(tableName) {
  return !!get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [tableName]);
}

function safeIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe identifier: ${value}`);
  return value;
}

function countByMonth(tableName, monthKey) {
  if (!tableExists(tableName)) return 0;
  const table = safeIdentifier(tableName);
  return num(get(`SELECT COUNT(*) AS count FROM ${table} WHERE month_key = ?`, [monthKey])?.count);
}

function monthDataCounts(monthKey) {
  return {
    lessons: countByMonth("lessons", monthKey),
    recharge_records: countByMonth("recharge_records", monthKey),
    teacher_adjustments_monthly: countByMonth("teacher_adjustments_monthly", monthKey),
    staff_salary_monthly: countByMonth("staff_salary_monthly", monthKey),
    staff_attendance: countByMonth("staff_attendance", monthKey),
    operating_expenses: countByMonth("operating_expenses", monthKey),
  };
}

function allPartitionedMonths() {
  const months = new Set(availableMonths());
  for (const table of ["teacher_adjustments_monthly", "staff_salary_monthly", "staff_attendance", "operating_expenses"]) {
    if (!tableExists(table)) continue;
    for (const row of all(`SELECT DISTINCT month_key FROM ${safeIdentifier(table)} WHERE month_key IS NOT NULL AND month_key <> ''`)) {
      months.add(row.month_key);
    }
  }
  return [...months].sort((a, b) => b.localeCompare(a));
}

function monthExistsInPrimaryTables(monthKey) {
  return countByMonth("lessons", monthKey) > 0 || countByMonth("recharge_records", monthKey) > 0;
}

function previousDataMonth(monthKey) {
  return availableMonths()
    .filter((month) => month < monthKey)
    .sort((a, b) => b.localeCompare(a))[0] || "";
}

function earliestDataMonth() {
  return availableMonths().sort((a, b) => a.localeCompare(b))[0] || "";
}

function monthsBetweenExclusive(startMonth, endMonth) {
  if (!validMonthKey(startMonth) || !validMonthKey(endMonth) || startMonth >= endMonth) return [];
  return monthsCovered(startMonth, endMonth).slice(1);
}

function carryOverNote(existing, fromMonth) {
  const marker = `自动结转 ← ${fromMonth.slice(0, 7)}`;
  const notes = text(existing?.notes);
  if (!notes || notes.startsWith("自动结转")) return marker;
  if (notes.includes(marker) || notes.includes("自动结转")) return notes;
  return `${notes}；${marker}`;
}

function isAutoCarryOverRecord(row) {
  if (!row) return false;
  const notes = text(row.notes);
  return text(row.source) === "carry_over"
    && num(row.cur_recharge) === 0
    && num(row.cur_gift) === 0
    && !text(row.recharge_date)
    && (!notes || notes.startsWith("自动结转"));
}

function hasManualRechargeData(row) {
  if (!row) return false;
  const notes = text(row.notes);
  return num(row.cur_recharge) !== 0
    || num(row.cur_gift) !== 0
    || !!text(row.recharge_date)
    || (!!notes && !notes.startsWith("自动结转"))
    || (text(row.source) && text(row.source) !== "carry_over");
}

function hasEmptyCarryOverFields(row) {
  return row && num(row.prev_actual) === 0 && num(row.prev_gift) === 0;
}

function sourceWorkbookRechargeCount(monthKey) {
  if (!validMonthKey(monthKey)) return 0;
  return num(get(
    "SELECT COUNT(*) AS count FROM recharge_records WHERE month_key = ? AND source LIKE 'source-workbook:%'",
    [monthKey],
  )?.count);
}

function monthUsesSourceWorkbookOpening(monthKey) {
  return sourceWorkbookRechargeCount(monthKey) > 0;
}

function shouldRefreshCarryOver(row, force = false) {
  if (!row) return true;
  if (force) return true;
  return isAutoCarryOverRecord(row) || hasEmptyCarryOverFields(row);
}

function carryOverRecordPatch(existing, fromMonth) {
  if (hasManualRechargeData(existing)) {
    return {
      source: text(existing?.source),
      notes: text(existing?.notes),
    };
  }
  return {
    source: "carry_over",
    notes: carryOverNote(existing, fromMonth),
  };
}

function carryOverCandidates(fromMonth, includeZero = false) {
  return studentSummary(feeDetails(fromMonth), fromMonth, true)
    .filter((row) => includeZero || num(row.actual_balance) !== 0 || num(row.gift_balance) !== 0);
}

function ensureCarryOver(monthKey) {
  if (!validMonthKey(monthKey)) throw new Error("month_key must be YYYY-MM-01");
  const fromMonth = previousDataMonth(monthKey);
  const sourceRows = sourceWorkbookRechargeCount(monthKey);
  if (sourceRows > 0) {
    return { month_key: monthKey, from_month: fromMonth, ensured: 0, updated: 0, skipped: sourceRows, carried_actual: 0, carried_gift: 0, source_opening: true };
  }
  if (!fromMonth) {
    return { month_key: monthKey, from_month: "", ensured: 0, updated: 0, skipped: 0, carried_actual: 0, carried_gift: 0 };
  }

  const candidates = carryOverCandidates(fromMonth);
  const updateRecharge = db.prepare(`
    UPDATE recharge_records
    SET grade = ?,
        prev_actual = ?,
        prev_gift = ?,
        source = ?,
        notes = ?
    WHERE student_name = ? AND month_key = ?
  `);
  let ensured = 0;
  let updated = 0;
  let skipped = 0;
  let carriedActual = 0;
  let carriedGift = 0;
  for (const row of candidates) {
    const actual = num(row.actual_balance);
    const gift = num(row.gift_balance);
    const existing = get(
      "SELECT * FROM recharge_records WHERE student_name = ? AND month_key = ?",
      [row.student_name, monthKey],
    );
    if (existing) {
      if (!isRealRechargeRecord(existing)) {
        db.prepare("DELETE FROM recharge_records WHERE id = ?").run(existing.id);
        updated += 1;
        carriedActual += actual;
        carriedGift += gift;
        continue;
      }
      if (!shouldRefreshCarryOver(existing)) {
        skipped += 1;
        continue;
      }
      const changed = num(existing.prev_actual) !== actual
        || num(existing.prev_gift) !== gift
        || text(existing.grade) !== text(row.grade)
        || !isAutoCarryOverRecord(existing);
      const patch = carryOverRecordPatch(existing, fromMonth);
      updateRecharge.run(row.grade || "", actual, gift, patch.source, patch.notes, row.student_name, monthKey);
      if (changed) updated += 1;
    }
    carriedActual += actual;
    carriedGift += gift;
  }
  const candidateNames = new Set(candidates.map((row) => row.student_name));
  for (const existing of all("SELECT * FROM recharge_records WHERE month_key = ?", [monthKey])) {
    if (candidateNames.has(existing.student_name) || !isAutoCarryOverRecord(existing)) continue;
    db.prepare("DELETE FROM recharge_records WHERE id = ?").run(existing.id);
    updated += 1;
  }
  return { month_key: monthKey, from_month: fromMonth, ensured, updated, skipped, carried_actual: carriedActual, carried_gift: carriedGift };
}

function ensureCarryOverChain(monthKey) {
  if (!validMonthKey(monthKey)) throw new Error("month_key must be YYYY-MM-01");
  const start = earliestDataMonth();
  if (!start || start >= monthKey) return { ensured: 0, results: [] };
  const results = [];
  for (const month of monthsBetweenExclusive(start, monthKey)) {
    results.push(ensureCarryOver(month));
  }
  return {
    ensured: results.reduce((sum, row) => sum + num(row.ensured), 0),
    updated: results.reduce((sum, row) => sum + num(row.updated), 0),
    skipped: results.reduce((sum, row) => sum + num(row.skipped), 0),
    carried_actual: results.reduce((sum, row) => sum + num(row.carried_actual), 0),
    carried_gift: results.reduce((sum, row) => sum + num(row.carried_gift), 0),
    results,
  };
}

function refreshCarryOverAfter(monthKey) {
  if (!validMonthKey(monthKey)) return { ensured: 0, updated: 0, skipped: 0, carried_actual: 0, carried_gift: 0, results: [] };
  const latest = allPartitionedMonths().sort((a, b) => b.localeCompare(a))[0] || monthKey;
  if (monthKey >= latest) return { ensured: 0, updated: 0, skipped: 0, carried_actual: 0, carried_gift: 0, results: [] };
  const results = [];
  for (const month of monthsBetweenExclusive(monthKey, latest)) {
    results.push(ensureCarryOver(month));
  }
  return {
    ensured: results.reduce((sum, row) => sum + num(row.ensured), 0),
    updated: results.reduce((sum, row) => sum + num(row.updated), 0),
    skipped: results.reduce((sum, row) => sum + num(row.skipped), 0),
    carried_actual: results.reduce((sum, row) => sum + num(row.carried_actual), 0),
    carried_gift: results.reduce((sum, row) => sum + num(row.carried_gift), 0),
    results,
  };
}

function withTransaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function createMonth(monthKey) {
  if (!/^\d{4}-\d{2}-01$/.test(monthKey)) throw new Error("month_key must be YYYY-MM-01");
  return withTransaction(() => {
    if (monthExistsInPrimaryTables(monthKey)) {
      return { created: false, already_exists: true, month_key: monthKey };
    }

    const chainResult = ensureCarryOverChain(monthKey);
    const currentResult = chainResult.results.find((row) => row.month_key === monthKey) || {};

    if (tableExists("staff") && tableExists("staff_salary_monthly")) {
      db.prepare(`
        INSERT OR IGNORE INTO staff_salary_monthly(staff_id, month_key, salary_actual, bonus, deduction, notes)
        SELECT id, ?, base_salary, 0, 0, 'auto'
        FROM staff
        WHERE status IN ('在职', '暂停')
      `).run(monthKey);
    }

    return {
      created: true,
      already_exists: false,
      month_key: monthKey,
      carried_students: num(currentResult.ensured),
      carried_actual: num(currentResult.carried_actual),
      carried_gift: num(currentResult.carried_gift),
      from_month: currentResult.from_month || previousDataMonth(monthKey),
      carry_over_chain: chainResult.results,
    };
  });
}

function deleteMonth(monthKey, force = false) {
  if (!/^\d{4}-\d{2}-01$/.test(monthKey)) throw new Error("month_key must be YYYY-MM-01");
  const months = allPartitionedMonths();
  if (months.length <= 1 && months.includes(monthKey)) {
    return { blocked: true, reason: "last_month", counts: monthDataCounts(monthKey) };
  }
  const counts = monthDataCounts(monthKey);
  const total = Object.values(counts).reduce((sum, value) => sum + num(value), 0);
  if (!force && total > 0) return { blocked: true, reason: "has_data", counts };

  const backup = total > 0 ? backupDb("pre_month_delete") : "";
  return withTransaction(() => {
    for (const table of ["lessons", "recharge_records", "teacher_adjustments_monthly", "staff_salary_monthly", "staff_attendance", "operating_expenses"]) {
      if (tableExists(table)) db.prepare(`DELETE FROM ${safeIdentifier(table)} WHERE month_key = ?`).run(monthKey);
    }
    const afterMonths = allPartitionedMonths().filter((month) => month !== monthKey);
    db.prepare(`
      INSERT INTO audit_logs(run_id, source, severity, entity, field, before_value, after_value, status, notes)
      VALUES (?, 'month_delete', 'MEDIUM', ?, 'month_key', ?, '', 'fixed', ?)
    `).run(
      `month_delete_${Date.now()}`,
      `month_${monthKey}`,
      JSON.stringify({ month_key: monthKey, counts, backup }),
      force ? "强制删除月份数据" : "删除空月份",
    );
    return {
      deleted: true,
      month_key: monthKey,
      counts,
      backup,
      remaining_months: afterMonths,
      next_month: afterMonths[0] || "",
    };
  });
}

function previousMonthKey(monthKey) {
  const date = new Date(`${monthKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  const prev = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-01`;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(value) {
  const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function validDateKey(value) {
  return !!parseDateKey(value);
}

function addDays(value, days) {
  const date = parseDateKey(value);
  if (!date) return "";
  date.setDate(date.getDate() + Number(days || 0));
  return dateKey(date);
}

function daysInclusive(start, end) {
  const startDate = parseDateKey(start);
  const endDate = parseDateKey(end);
  if (!startDate || !endDate || startDate > endDate) return 0;
  return Math.round((endDate - startDate) / 86400000) + 1;
}

function monthEndKey(monthKey) {
  if (!validMonthKey(monthKey)) return "";
  const date = new Date(`${monthKey}T00:00:00`);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return dateKey(end);
}

function monthRange(monthKey) {
  const key = validMonthKey(monthKey) ? monthKey : getSetting("month_key");
  return { start: key, end: monthEndKey(key), days: daysInclusive(key, monthEndKey(key)) };
}

function normalizeRange(start, end) {
  if (!validDateKey(start) || !validDateKey(end)) return null;
  if (start > end) return null;
  return { start, end, days: daysInclusive(start, end) };
}

function financeRangeFromUrl(url) {
  const start = text(url.searchParams.get("start"));
  const end = text(url.searchParams.get("end"));
  if (start || end) return normalizeRange(start, end);
  return monthRange(resolveMonthKey(url));
}

function previousEqualRange(range) {
  if (validMonthKey(range.start) && range.end === monthEndKey(range.start)) {
    return monthRange(previousMonthKey(range.start));
  }
  const prevEnd = addDays(range.start, -1);
  const prevStart = addDays(prevEnd, -(range.days - 1));
  return { start: prevStart, end: prevEnd, days: range.days };
}

function monthsCovered(start, end) {
  const result = [];
  const startDate = parseDateKey(start);
  const endDate = parseDateKey(end);
  if (!startDate || !endDate) return result;
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const last = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (cursor <= last) {
    result.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-01`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return result;
}

function monthOverlap(range, monthKey) {
  const start = range.start > monthKey ? range.start : monthKey;
  const monthEnd = monthEndKey(monthKey);
  const end = range.end < monthEnd ? range.end : monthEnd;
  const overlapDays = daysInclusive(start, end);
  const monthDays = daysInclusive(monthKey, monthEnd);
  return {
    days: overlapDays,
    month_days: monthDays,
    weight: monthDays ? Math.min(overlapDays / monthDays, 1) : 0,
  };
}

function financeAvailableRange() {
  const row = get("SELECT MIN(date) AS start, MAX(date) AS end FROM lessons WHERE TRIM(date) <> ''") || {};
  return { start: row.start || "", end: row.end || "" };
}

function pctChange(current, previous) {
  if (!previous) return current ? null : 0;
  return (current - previous) / Math.abs(previous);
}

function overviewMetric(current, previous) {
  return {
    current,
    previous,
    mom_pct: pctChange(current, previous),
  };
}

function classType(studentCount) {
  if (studentCount <= 1) return "1对1";
  if (studentCount === 2) return "1对2";
  return "1对多";
}

function weightedTeacherTransport(range) {
  let total = 0;
  const byTeacher = new Map();
  for (const monthKey of monthsCovered(range.start, range.end)) {
    const overlap = monthOverlap(range, monthKey);
    if (!overlap.days) continue;
    for (const row of all("SELECT * FROM teacher_adjustments_monthly WHERE month_key = ?", [monthKey])) {
      const amount = (
        num(row.week1_transport) + num(row.week2_transport) + num(row.week3_transport) + num(row.week4_transport)
      ) * overlap.weight;
      total = moneyRound(total + amount);
      const name = row.teacher_name || "未填写";
      byTeacher.set(name, moneyRound((byTeacher.get(name) || 0) + amount));
    }
  }
  return { total, by_teacher: byTeacher };
}

function weightedStaffSalary(range) {
  let total = 0;
  const byStaffRole = {};
  for (const monthKey of monthsCovered(range.start, range.end)) {
    const overlap = monthOverlap(range, monthKey);
    if (!overlap.days) continue;
    for (const row of all(`
      SELECT s.role, ssm.salary_actual
      FROM staff_salary_monthly ssm
      JOIN staff s ON s.id = ssm.staff_id
      WHERE ssm.month_key = ?
    `, [monthKey])) {
      const role = row.role || "其他";
      const amount = num(row.salary_actual) * overlap.weight;
      total = moneyRound(total + amount);
      byStaffRole[role] = moneyRound((byStaffRole[role] || 0) + amount);
    }
  }
  return { total, by_staff_role: byStaffRole };
}

function operatingExpenseSummary(range) {
  const rows = all(`
    SELECT *
    FROM operating_expenses
    WHERE expense_date >= ? AND expense_date <= ?
  `, [range.start, range.end]);
  const byCategory = {};
  let total = 0;
  for (const row of rows) {
    const category = row.category || "其他";
    const amount = num(row.amount);
    total = moneyRound(total + amount);
    byCategory[category] = moneyRound((byCategory[category] || 0) + amount);
  }
  return { rows, total, by_category: byCategory };
}

function rechargesInRange(range) {
  return all(`
    SELECT *, COALESCE(NULLIF(recharge_date, ''), month_key) AS event_date
    FROM recharge_records
    WHERE COALESCE(NULLIF(recharge_date, ''), month_key) >= ?
      AND COALESCE(NULLIF(recharge_date, ''), month_key) <= ?
      AND ${REAL_RECHARGE_SQL}
  `, [range.start, range.end]);
}

function studentAccountRowsInRange(studentName, range) {
  const name = text(studentName);
  if (!name || !range) return { details: [], recharges: [] };
  const details = [];
  for (const monthKey of monthsCovered(range.start, range.end)) {
    for (const detail of feeDetails(monthKey)) {
      if (detail.student_name !== name || !detail.effective) continue;
      const eventDate = studentAccountLessonDate(detail, monthKey);
      if (eventDate >= range.start && eventDate <= range.end) details.push(detail);
    }
  }
  return {
    details,
    recharges: rechargesInRange(range).filter((row) => row.student_name === name),
  };
}

function calculateStudentAccountRange(studentName, range) {
  const name = text(studentName);
  if (!name || !range) return null;
  const openingBalance = studentBalanceThroughDate(name, addDays(range.start, -1));
  const rows = studentAccountRowsInRange(name, range);
  return {
    opening_actual_balance: openingBalance.actual_balance,
    opening_gift_balance: openingBalance.gift_balance,
    ...calculateStudentAccountTimeline({
      studentName: name,
      monthKey: monthKeyFromDate(range.start),
      details: rows.details,
      recharges: rows.recharges,
      openingActual: openingBalance.actual_balance,
      openingGift: openingBalance.gift_balance,
    }),
    details: rows.details,
    recharges: rows.recharges,
  };
}

function buildStudentBalanceThroughDate(studentName, dateKeyValue) {
  const name = text(studentName);
  const dateKey = text(dateKeyValue);
  if (!name || !validDateKey(dateKey)) return { actual_balance: 0, gift_balance: 0 };
  const opening = openingBalanceMap().get(name) || {};
  let actualBalance = moneyRound(opening.actual_balance);
  let giftBalance = moneyRound(opening.gift_balance);
  const earliest = earliestDataMonth();
  if (!earliest || dateKey < earliest) {
    return { actual_balance: actualBalance, gift_balance: giftBalance };
  }
  const targetMonth = monthKeyFromDate(dateKey);
  for (const monthKey of monthsCovered(earliest, dateKey)) {
    const range = {
      start: monthKey,
      end: monthKey === targetMonth ? dateKey : monthEndKey(monthKey),
    };
    const rows = studentAccountRowsInRange(name, range);
    const account = calculateStudentAccountTimeline({
      studentName: name,
      monthKey,
      details: rows.details,
      recharges: rows.recharges,
      openingActual: actualBalance,
      openingGift: giftBalance,
    });
    actualBalance = account.actual_balance;
    giftBalance = account.gift_balance;
  }
  return {
    actual_balance: moneyRound(actualBalance),
    gift_balance: moneyRound(giftBalance),
  };
}

function studentBalanceThroughDate(studentName, dateKeyValue) {
  const name = text(studentName);
  const dateKey = text(dateKeyValue);
  if (!name || !validDateKey(dateKey)) return { actual_balance: 0, gift_balance: 0 };
  return cachedDerived(
    "studentBalanceThroughDate",
    cacheKey(name, dateKey),
    `studentBalanceThroughDate student=${name} date=${dateKey}`,
    () => buildStudentBalanceThroughDate(name, dateKey),
  );
}

function financeBase(range) {
  const monthKeys = monthsCovered(range.start, range.end);
  const details = [];
  const monthlySummaries = new Map();
  for (const monthKey of monthKeys) {
    const monthDetails = feeDetails(monthKey);
    monthlySummaries.set(monthKey, new Map(
      studentSummary(monthDetails, monthKey, true).map((row) => [row.student_name, row]),
    ));
    for (const detail of monthDetails) {
      if (detail.date >= range.start && detail.date <= range.end) {
        details.push({ ...detail, month_key: monthKeyFromDate(detail.date) || monthKey });
      }
    }
  }

  const effectiveDetails = details.filter((row) => row.effective);
  let revenue = 0;
  let giftConsumption = 0;
  for (const detail of effectiveDetails) {
    const monthKey = detail.month_key || monthKeyFromDate(detail.date);
    const summary = monthlySummaries.get(monthKey)?.get(detail.student_name);
    const totalFee = num(summary?.total_fee);
    const price = num(detail.unit_price);
    if (totalFee > 0) {
      const allocatedRevenue = moneyRound(price * (num(summary.actual_consumption) / totalFee));
      const allocatedGiftConsumption = moneyRound(price * (num(summary.gift_consumption) / totalFee));
      detail.allocated_revenue = allocatedRevenue;
      detail.allocated_gift_consumption = allocatedGiftConsumption;
      revenue = moneyRound(revenue + allocatedRevenue);
      giftConsumption = moneyRound(giftConsumption + allocatedGiftConsumption);
    } else {
      detail.allocated_revenue = moneyRound(price);
      detail.allocated_gift_consumption = 0;
      revenue = moneyRound(revenue + detail.allocated_revenue);
    }
  }

  const lessonSalary = new Map();
  const teacherSalary = new Map();
  for (const detail of effectiveDetails) {
    if (lessonSalary.has(detail.lesson_id)) continue;
    const salary = effectiveTeacherSalary(detail);
    lessonSalary.set(detail.lesson_id, salary);
    const teacherName = detail.teacher_name || "未填写";
    teacherSalary.set(teacherName, moneyRound((teacherSalary.get(teacherName) || 0) + salary));
  }
  const teacherCost = moneyRound([...lessonSalary.values()].reduce((sum, value) => sum + value, 0));
  const lessonSalaryValues = [...lessonSalary.values()];
  const teacherSalaryMissingLessons = lessonSalaryValues.filter((value) => num(value) <= 0).length;
  const transport = weightedTeacherTransport(range);
  const staffSalary = weightedStaffSalary(range);
  const expenses = operatingExpenseSummary(range);
  const operatingCost = {
    staff_salary_total: staffSalary.total,
    operating_expense_total: expenses.total,
    total: moneyRound(staffSalary.total + expenses.total),
    by_staff_role: staffSalary.by_staff_role,
    by_category: expenses.by_category,
  };
  const recharges = rechargesInRange(range);
  const cashIn = moneyRound(recharges.reduce((sum, row) => sum + num(row.cur_recharge), 0));
  const giftIssued = moneyRound(recharges.reduce((sum, row) => sum + num(row.cur_gift), 0));
  const grossProfit = moneyRound(revenue - teacherCost - transport.total - operatingCost.total);

  return {
    range,
    details,
    effective_details: effectiveDetails,
    end_month_key: monthKeyFromDate(range.end),
    end_month_summaries: studentSummary(feeDetails(monthKeyFromDate(range.end)), monthKeyFromDate(range.end), true),
    recharges,
    teacher_salary_by_teacher: teacherSalary,
    transport_by_teacher: transport.by_teacher,
    data_quality: {
      teacher_salary_lessons: lessonSalaryValues.length,
      teacher_salary_filled_lessons: lessonSalaryValues.length - teacherSalaryMissingLessons,
      teacher_salary_missing_lessons: teacherSalaryMissingLessons,
      teacher_salary_complete: teacherSalaryMissingLessons === 0,
    },
    overview_raw: {
      revenue,
      gift_consumption: giftConsumption,
      teacher_cost: teacherCost,
      transport_cost: transport.total,
      operating_cost: operatingCost,
      gross_profit: grossProfit,
      gross_margin: revenue ? grossProfit / revenue : 0,
      cash_in: cashIn,
      gift_issued: giftIssued,
      net_cash_flow: moneyRound(cashIn - (teacherCost + transport.total + operatingCost.total)),
    },
  };
}

function metricOverview(current, previous) {
  const overview = {};
  for (const key of [
    "revenue",
    "gift_consumption",
    "teacher_cost",
    "transport_cost",
    "gross_profit",
    "cash_in",
    "gift_issued",
    "net_cash_flow",
  ]) {
    overview[key] = overviewMetric(num(current[key]), num(previous?.[key]));
  }
  const currentMargin = num(current.gross_margin);
  const previousMargin = num(previous?.gross_margin);
  overview.gross_margin = {
    ...overviewMetric(currentMargin, previousMargin),
    mom_pp: currentMargin - previousMargin,
  };
  overview.operating_cost = {
    ...current.operating_cost,
    current: num(current.operating_cost?.total),
    previous: num(previous?.operating_cost?.total),
    mom_pct: pctChange(num(current.operating_cost?.total), num(previous?.operating_cost?.total)),
  };
  return overview;
}

function financeBreakdowns(current) {
  const effectiveDetails = current.effective_details;
  const summaries = current.end_month_summaries || [];
  const detailRevenue = (row) => moneyRound(row.allocated_revenue ?? row.unit_price);
  const unpaidByStudent = new Map();
  for (const row of current.details.filter(isUnpaid)) {
    const name = row.student_name || row.student || "未填写";
    unpaidByStudent.set(name, moneyRound((unpaidByStudent.get(name) || 0) + num(row.unit_price)));
  }
  const debtByStudent = new Map();
  for (const row of summaries) {
    const debt = Math.max(0, -num(row.actual_balance));
    if (debt > 0) debtByStudent.set(row.student_name, debt);
  }
  const receivableNames = new Set([...unpaidByStudent.keys(), ...debtByStudent.keys()]);
  const accountDebtReceivable = moneyRound([...debtByStudent.values()].reduce((sum, value) => sum + value, 0));
  const unpaidLessonReceivable = moneyRound([...unpaidByStudent.values()].reduce((sum, value) => sum + value, 0));
  const totalActualBalance = moneyRound(summaries.reduce((sum, row) => sum + Math.max(0, num(row.actual_balance)), 0));
  const balanceSheet = {
    total_actual_balance: totalActualBalance,
    raw_actual_balance: moneyRound(summaries.reduce((sum, row) => sum + num(row.actual_balance), 0)),
    total_gift_balance: moneyRound(summaries.reduce((sum, row) => sum + num(row.gift_balance), 0)),
    account_debt_receivable: accountDebtReceivable,
    unpaid_lesson_receivable: unpaidLessonReceivable,
    accounts_receivable: moneyRound([...receivableNames].reduce((sum, name) => (
      sum + Math.max(num(unpaidByStudent.get(name)), num(debtByStudent.get(name)))
    ), 0)),
    burn_rate_months: current.overview_raw.revenue > 0 ? totalActualBalance / current.overview_raw.revenue : 0,
  };

  const teacherMap = new Map();
  for (const [teacherName, salaryTotal] of current.teacher_salary_by_teacher.entries()) {
    teacherMap.set(teacherName, {
      teacher_name: teacherName,
      revenue_contribution: 0,
      salary_total: salaryTotal,
      roi: null,
    });
  }
  for (const row of effectiveDetails) {
    const name = row.teacher_name || "未填写";
    if (!teacherMap.has(name)) teacherMap.set(name, { teacher_name: name, revenue_contribution: 0, salary_total: 0, roi: null });
    teacherMap.get(name).revenue_contribution = moneyRound(teacherMap.get(name).revenue_contribution + detailRevenue(row));
  }
  const byTeacher = [...teacherMap.values()].map((row) => ({
    ...row,
    roi: row.salary_total ? row.revenue_contribution / row.salary_total : null,
  })).sort((a, b) => (num(b.roi) - num(a.roi)) || (b.revenue_contribution - a.revenue_contribution));

  const totalBreakdownRevenue = moneyRound(effectiveDetails.reduce((sum, row) => sum + detailRevenue(row), 0));
  const groupedRevenue = (field) => {
    const map = new Map();
    for (const row of effectiveDetails) {
      const key = row[field] || "未填写";
      if (!map.has(key)) map.set(key, { revenue: 0, _lesson_ids: new Set(), teacher_cost: 0 });
      const item = map.get(key);
      item.revenue = moneyRound(item.revenue + detailRevenue(row));
      if (!item._lesson_ids.has(row.lesson_id)) {
        item._lesson_ids.add(row.lesson_id);
        item.teacher_cost = moneyRound(item.teacher_cost + effectiveTeacherSalary(row));
      }
    }
    return [...map.entries()].map(([name, data]) => ({
      name,
      revenue: data.revenue,
      teacher_cost: data.teacher_cost,
      gross_profit: moneyRound(data.revenue - data.teacher_cost),
      gross_margin: data.revenue ? (data.revenue - data.teacher_cost) / data.revenue : 0,
      share: totalBreakdownRevenue ? data.revenue / totalBreakdownRevenue : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  };

  const classMap = new Map();
  for (const row of effectiveDetails) {
    const type = classType(row.student_count);
    if (!classMap.has(type)) classMap.set(type, { class_type: type, revenue: 0, teacher_cost: 0, _lesson_ids: new Set() });
    const item = classMap.get(type);
    item.revenue = moneyRound(item.revenue + detailRevenue(row));
    if (!item._lesson_ids.has(row.lesson_id)) {
      item._lesson_ids.add(row.lesson_id);
      item.teacher_cost = moneyRound(item.teacher_cost + effectiveTeacherSalary(row));
    }
  }
  const byClassType = [...classMap.values()].map((row) => ({
    class_type: row.class_type,
    revenue: row.revenue,
    teacher_cost: row.teacher_cost,
    gross_margin: row.revenue ? (row.revenue - row.teacher_cost) / row.revenue : 0,
  })).sort((a, b) => b.revenue - a.revenue);

  const studentMap = new Map();
  for (const row of effectiveDetails) {
    if (!studentMap.has(row.student_name)) studentMap.set(row.student_name, { student_name: row.student_name, lesson_count: 0, total_fee: 0 });
    const item = studentMap.get(row.student_name);
    item.lesson_count += 1;
    item.total_fee = moneyRound(item.total_fee + detailRevenue(row));
  }
  const topStudents = [...studentMap.values()]
    .sort((a, b) => num(b.total_fee) - num(a.total_fee))
    .slice(0, 10)
    .map((row) => ({
      student_name: row.student_name,
      lesson_count: row.lesson_count,
      total_fee: row.total_fee,
    }));

  const lowBalance = summaries
    .filter((row) => {
      const avg = row.lesson_count ? num(row.total_fee) / row.lesson_count : 0;
      const actualBalance = num(row.actual_balance);
      return avg > 0 && actualBalance >= 0 && actualBalance < avg;
    })
    .map((row) => ({
      student_name: row.student_name,
      actual_balance: row.actual_balance,
      avg_unit_price: row.lesson_count ? num(row.total_fee) / row.lesson_count : 0,
      lesson_count: row.lesson_count,
    }))
    .sort((a, b) => a.actual_balance - b.actual_balance);

  const accountDebts = summaries
    .filter((row) => num(row.actual_balance) < 0)
    .map((row) => ({
      student_name: row.student_name,
      amount: Math.max(0, -num(row.actual_balance)),
      actual_balance: row.actual_balance,
      lesson_count: row.lesson_count,
      total_fee: row.total_fee,
    }))
    .sort((a, b) => b.amount - a.amount);

  const unpaidLessons = current.details
    .filter(isUnpaid)
    .map((row) => ({
      lesson_id: row.lesson_id,
      student: row.student_name,
      date: row.date,
      unit_price: row.unit_price,
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return {
    balance_sheet: balanceSheet,
    breakdowns: {
      by_teacher: byTeacher,
      by_grade: groupedRevenue("grade"),
      by_subject: groupedRevenue("subject"),
      by_class_type: byClassType,
    },
    top_lists: {
      top_students: topStudents,
      account_debts: accountDebts,
      low_balance: lowBalance,
      unpaid_lessons: unpaidLessons,
    },
  };
}

function financeTrend6m(asOfDateKey = todayKey()) {
  const asOfDate = parseDateKey(asOfDateKey) ? asOfDateKey : todayKey();
  const endMonth = monthKeyFromDate(asOfDate);
  if (!endMonth) return [];
  const endDate = parseDateKey(endMonth);
  const rows = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(endDate.getFullYear(), endDate.getMonth() - offset, 1);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
    const range = month === endMonth
      ? normalizeRange(month, asOfDate)
      : monthRange(month);
    const base = financeBase(range);
    const totalCost = num(base.overview_raw.teacher_cost)
      + num(base.overview_raw.transport_cost)
      + num(base.overview_raw.operating_cost?.total);

    const gradeRevenue = {};
    for (const detail of base.effective_details) {
      const grade = detail.grade || "未填写";
      const rev = moneyRound(detail.allocated_revenue ?? num(detail.unit_price));
      gradeRevenue[grade] = moneyRound((gradeRevenue[grade] || 0) + rev);
    }

    rows.push({
      month,
      range,
      revenue: base.overview_raw.revenue,
      total_cost: totalCost,
      gross_profit: base.overview_raw.gross_profit,
      gross_margin: base.overview_raw.gross_margin,
      grade_revenue: gradeRevenue,
    });
  }
  return rows;
}

function financeSummary(range) {
  const currentRange = typeof range === "string" ? monthRange(range) : range;
  const previousRange = previousEqualRange(currentRange);
  const current = financeBase(currentRange);
  const previous = financeBase(previousRange);
  const overview = metricOverview(current.overview_raw, previous.overview_raw);
  const sections = financeBreakdowns(current);
  const previousSections = financeBreakdowns(previous);
  const monthKey = monthKeyFromDate(currentRange.end);
  return {
    month_key: monthKey,
    previous_month_key: previousMonthKey(monthKey),
    range: {
      ...currentRange,
      months_covered: monthsCovered(currentRange.start, currentRange.end),
    },
    prev_range: {
      ...previousRange,
      months_covered: monthsCovered(previousRange.start, previousRange.end),
    },
    available_range: financeAvailableRange(),
    overview,
    prev_overview: previous.overview_raw,
    data_quality: current.data_quality,
    prev_data_quality: previous.data_quality,
    balance_sheet: sections.balance_sheet,
    prev_balance_sheet: previousSections.balance_sheet,
    breakdowns: sections.breakdowns,
    top_lists: sections.top_lists,
    trend_as_of: todayKey(),
    trend_6m: financeTrend6m(),
  };
}

function severityCounts(issues) {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, WARN: 0 };
  for (const issue of issues) {
    if (counts[issue.severity] == null) counts[issue.severity] = 0;
    counts[issue.severity] += 1;
  }
  return counts;
}

function auditIssue({ source = "internal", severity = "WARN", type = "", entity = "", field = "", before_value = "", after_value = "", message = "", fix = null, data = {} }) {
  return { source, severity, type, entity, field, before_value: text(before_value), after_value: text(after_value), message, fix, ...data };
}

function auditKeyPart(value) {
  return text(value).replace(/\s+/g, " ");
}

function auditIssueKey(issue, source = "internal") {
  return [
    auditKeyPart(issue.source || source),
    auditKeyPart(issue.type || issue.source || ""),
    auditKeyPart(issue.entity || ""),
    auditKeyPart(issue.field || ""),
    auditKeyPart(issue.before_value ?? issue.db_value ?? ""),
    auditKeyPart(issue.after_value ?? issue.xlsx_value ?? ""),
  ].join("||");
}

function auditLogFallbackKey(log) {
  return [
    auditKeyPart(log.source || ""),
    auditKeyPart(log.severity || ""),
    auditKeyPart(log.entity || ""),
    auditKeyPart(log.field || ""),
    auditKeyPart(log.before_value || ""),
    auditKeyPart(log.after_value || ""),
    auditKeyPart(log.notes || ""),
  ].join("||");
}

function visibleAuditIssues(issues, source = "internal") {
  return issues.filter((issue) => {
    issue.issue_key = auditIssueKey(issue, source);
    return !get("SELECT 1 FROM audit_ignores WHERE issue_key = ?", [issue.issue_key]);
  });
}

function recordAuditIssues(runId, issues, source = "internal") {
  return withTransaction(() => {
    let recorded = 0;
    for (const issue of issues) {
      const issueKey = issue.issue_key || auditIssueKey(issue, source);
      issue.issue_key = issueKey;
      if (get("SELECT 1 FROM audit_ignores WHERE issue_key = ?", [issueKey])) continue;
      const existing = get("SELECT id FROM audit_logs WHERE issue_key = ? AND status = 'open' ORDER BY id DESC LIMIT 1", [issueKey]);
      if (existing) {
        db.prepare(`
          UPDATE audit_logs
          SET run_at = CURRENT_TIMESTAMP,
              run_id = ?,
              source = ?,
              severity = ?,
              entity = ?,
              field = ?,
              before_value = ?,
              after_value = ?,
              notes = ?
          WHERE id = ?
        `).run(
          runId,
          issue.source || source,
          issue.severity || "",
          issue.entity || "",
          issue.field || "",
          issue.before_value ?? issue.db_value ?? "",
          issue.after_value ?? issue.xlsx_value ?? "",
          issue.message || issue.notes || "",
          existing.id,
        );
        issue.audit_log_id = existing.id;
        recorded += 1;
        continue;
      }
      db.prepare(`
        INSERT INTO audit_logs(run_id, issue_key, source, severity, entity, field, before_value, after_value, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
      `).run(
        runId,
        issueKey,
        issue.source || source,
        issue.severity || "",
        issue.entity || "",
        issue.field || "",
        issue.before_value ?? issue.db_value ?? "",
        issue.after_value ?? issue.xlsx_value ?? "",
        issue.message || issue.notes || "",
      );
      issue.audit_log_id = get("SELECT last_insert_rowid() AS id").id;
      recorded += 1;
    }
    return { recorded };
  });
}

function normalizeAuditName(value) {
  return text(value).replace(/\s+/g, "");
}

function inactiveStudentStatus(status) {
  return ["离校", "已流出", "已毕业"].includes(text(status));
}

function studentBalanceOpen(row) {
  return num(row?.actual_balance) !== 0 || num(row?.gift_balance) !== 0;
}

function shouldShowStudentSummaryRow(row, includeInactive = false) {
  if (includeInactive) return true;
  if (row.active_this_month) return true;
  if (num(row.prev_actual) !== 0 || num(row.prev_gift) !== 0) return true;
  if (!inactiveStudentStatus(row.status)) return true;
  return studentBalanceOpen(row);
}

function activeStudentProfile(name) {
  const student = get("SELECT * FROM students WHERE name = ?", [name]);
  return !student || !inactiveStudentStatus(student.status);
}

function levenshtein(a, b) {
  const left = Array.from(String(a || ""));
  const right = Array.from(String(b || ""));
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[left.length][right.length];
}

function standardPrice(grade, studentCount) {
  const bucket = priceBucket(grade, studentCount);
  const row = get("SELECT unit_price FROM pricing_standards WHERE grade = ? AND student_count = ?", [grade, bucket]);
  return row ? num(row.unit_price) : 0;
}

function monthLessonStudents(monthKey) {
  const rows = all("SELECT * FROM lessons WHERE month_key = ? ORDER BY date, teacher_name, time_slot, sort_order, id", [monthKey]);
  const items = [];
  for (const lesson of rows) {
    const names = splitStudents(lesson.student_names);
    for (const studentName of names) {
      items.push({ lesson, studentName, student_count: names.length });
    }
  }
  return items;
}

function studentSubjectUsageSet() {
  const used = new Set();
  const rows = all("SELECT subject, student_names FROM lessons WHERE TRIM(subject) <> '' AND TRIM(student_names) <> ''");
  for (const lesson of rows) {
    for (const studentName of splitStudents(lesson.student_names)) {
      used.add(`${studentName}|${lesson.subject}`);
    }
  }
  return used;
}

function internalAudit(monthKey, { log = true } = {}) {
  const runId = `internal_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  let issues = [];
  const lessonStudents = monthLessonStudents(monthKey);
  const byStudent = new Map();
  for (const item of lessonStudents) {
    if (!byStudent.has(item.studentName)) byStudent.set(item.studentName, []);
    byStudent.get(item.studentName).push(item);
  }

  for (const [studentName, items] of byStudent) {
    const grades = [...new Set(items.map((item) => text(item.lesson.grade)).filter(Boolean))];
    if (grades.length > 1) {
      issues.push(auditIssue({
        severity: "CRITICAL",
        type: "grade_inconsistency",
        entity: `student_${studentName}`,
        field: "grade",
        before_value: grades.join(" / "),
        message: `${studentName} 在本月课程中出现多个年级`,
        data: { student_name: studentName, lesson_ids: items.map((item) => item.lesson.id) },
      }));
    }
    const student = get("SELECT * FROM students WHERE name = ?", [studentName]);
    if ((!student || !text(student.grade)) && items.length) {
      const lessonGrades = items.map((item) => text(item.lesson.grade)).filter(Boolean);
      const suggested = lessonGrades.length ? lessonGrades[lessonGrades.length - 1] : "";
      issues.push(auditIssue({
        severity: "MEDIUM",
        type: "missing_grade",
        entity: `student_${studentName}`,
        field: "grade",
        before_value: "",
        after_value: suggested,
        message: `${studentName} 在本月有课，但 students 表年级为空`,
        fix: suggested ? { action: "student_grade", student_name: studentName, grade: suggested } : null,
        patch: suggested ? { type: "student", name: studentName, grade: suggested } : null,
        data: { student_name: studentName },
      }));
    }
  }

  const teachers = all("SELECT teacher_name, COUNT(*) AS count FROM lessons WHERE month_key = ? AND TRIM(teacher_name) <> '' GROUP BY teacher_name", [monthKey]);
  for (let i = 0; i < teachers.length; i += 1) {
    for (let j = i + 1; j < teachers.length; j += 1) {
      const a = teachers[i].teacher_name;
      const b = teachers[j].teacher_name;
      if (a !== b && levenshtein(normalizeAuditName(a), normalizeAuditName(b)) <= 1) {
        issues.push(auditIssue({
          severity: "WARN",
          type: "teacher_typo",
          entity: "teacher_names",
          field: "teacher_name",
          before_value: a,
          after_value: b,
          message: `教师姓名疑似变体：${a} / ${b}`,
        }));
      }
    }
  }

  const studentCounts = new Map();
  const studentGrades = new Map();
  for (const item of lessonStudents) studentCounts.set(item.studentName, (studentCounts.get(item.studentName) || 0) + 1);
  for (const item of lessonStudents) {
    if (!studentGrades.has(item.studentName)) studentGrades.set(item.studentName, new Set());
    const lessonGrade = text(item.lesson.grade);
    if (lessonGrade) studentGrades.get(item.studentName).add(lessonGrade);
  }
  for (const studentName of studentCounts.keys()) {
    const profileGrade = text(get("SELECT grade FROM students WHERE name = ?", [studentName])?.grade);
    if (profileGrade) {
      if (!studentGrades.has(studentName)) studentGrades.set(studentName, new Set());
      studentGrades.get(studentName).add(profileGrade);
    }
  }
  const studentNames = [...studentCounts.keys()];
  for (let i = 0; i < studentNames.length; i += 1) {
    for (let j = i + 1; j < studentNames.length; j += 1) {
      const a = studentNames[i];
      const b = studentNames[j];
      if (!activeStudentProfile(a) || !activeStudentProfile(b)) continue;
      const gradesA = studentGrades.get(a) || new Set();
      const gradesB = studentGrades.get(b) || new Set();
      const knownA = [...gradesA];
      const knownB = [...gradesB];
      const sameKnownGrade = knownA.length && knownB.length && knownA.some((grade) => gradesB.has(grade));
      const gradeUnknown = !knownA.length || !knownB.length;
      if (a !== b && (sameKnownGrade || gradeUnknown) && levenshtein(normalizeAuditName(a), normalizeAuditName(b)) <= 1) {
        const gradeNote = sameKnownGrade ? `（年级：${knownA.filter((grade) => gradesB.has(grade)).join("、")}）` : "（年级缺失，需人工确认）";
        issues.push(auditIssue({
          severity: "WARN",
          type: "student_typo",
          entity: "student_names",
          field: "student_name",
          before_value: a,
          after_value: b,
          message: `学生姓名疑似变体：${a} / ${b}${gradeNote}`,
          data: { grade_a: knownA.join("、"), grade_b: knownB.join("、") },
        }));
      }
    }
  }

  const usedPricing = new Set();
  const historicalStudentSubjects = studentSubjectUsageSet();
  const pricingRows = all("SELECT * FROM student_pricing ORDER BY student_name, subject");
  for (const pricing of pricingRows) {
    if (!activeStudentProfile(pricing.student_name)) continue;
    const usages = lessonStudents.filter((item) => item.studentName === pricing.student_name && item.lesson.subject === pricing.subject);
    if (!usages.length) {
      if (historicalStudentSubjects.has(`${pricing.student_name}|${pricing.subject}`)) continue;
      issues.push(auditIssue({
        severity: "WARN",
        type: "orphan_pricing",
        entity: `pricing_${pricing.id}`,
        field: "student_pricing",
        before_value: `${pricing.student_name}-${pricing.subject}`,
        message: `${pricing.student_name}-${pricing.subject} 从未在课程中使用，可能是误建的学生单价规则`,
        data: { pricing_id: pricing.id },
      }));
      continue;
    }
    usedPricing.add(`${pricing.student_name}|${pricing.subject}`);
    const latest = usages[usages.length - 1];
    const std = standardPrice(latest.lesson.grade, latest.student_count);
    const custom = num(pricing.custom_price);
    if (custom <= 0) {
      const hasCurrentNonTrialUse = usages.some((item) => deriveStatus(item.lesson) !== "试课");
      issues.push(auditIssue({
        severity: hasCurrentNonTrialUse ? "HIGH" : "MEDIUM",
        type: "zero_custom_pricing",
        entity: `pricing_${pricing.id}`,
        field: "custom_price",
        before_value: custom,
        message: `${pricing.student_name}-${pricing.subject} 学生单价规则为 0，建议设置有效规则或单节手动费用覆盖`,
        data: { pricing_id: pricing.id, student_name: pricing.student_name, subject: pricing.subject, custom_price: custom },
      }));
      continue;
    }
    if (std > 0 && Math.abs(custom - std) / std > 0.3) {
      issues.push(auditIssue({
        severity: "WARN",
        type: "price_outlier",
        entity: `pricing_${pricing.id}`,
        field: "custom_price",
        before_value: custom,
        after_value: std,
        message: `${pricing.student_name}-${pricing.subject} 学生单价规则相对标准价偏离超过 30%`,
        data: { pricing_id: pricing.id, student_name: pricing.student_name, subject: pricing.subject, custom_price: custom, standard_price: std },
      }));
    }
  }

  for (const detail of feeDetails(monthKey)) {
    if (detail.effective && num(detail.unit_price) === 0) {
      issues.push(auditIssue({
        severity: "HIGH",
        type: "price_zero",
        entity: `lesson_${detail.lesson_id}`,
        field: "unit_price",
        before_value: 0,
        message: `${detail.student_name} 的有效课时单价为 0`,
        data: { lesson_id: detail.lesson_id, student_name: detail.student_name, date: detail.date },
      }));
    }
  }

  for (const row of studentSummary(feeDetails(monthKey), monthKey, true)) {
    if (inactiveStudentStatus(row.status) && studentBalanceOpen(row)) {
      issues.push(auditIssue({
        severity: "HIGH",
        type: "inactive_student_open_balance",
        entity: `student_${row.student_name}`,
        field: "balance",
        before_value: `${row.status} / 现金 ${row.actual_balance} / 赠送 ${row.gift_balance}`,
        message: `${row.student_name} 已标为${row.status}，但余额未清零；确认结清前仍会显示在费用汇总中`,
        data: { student_name: row.student_name, actual_balance: row.actual_balance, gift_balance: row.gift_balance },
      }));
    }
  }

  issues = visibleAuditIssues(issues, "internal");
  if (log) recordAuditIssues(runId, issues, "internal");
  const groups = {};
  for (const issue of issues) {
    if (!groups[issue.type]) groups[issue.type] = [];
    groups[issue.type].push(issue);
  }
  return { run_id: runId, month_key: monthKey, counts: severityCounts(issues), issue_count: issues.length, groups, issues };
}

function rolloverRecharges(fromMonth, toMonth, force = false) {
  if (!fromMonth || !toMonth) {
    throw new Error("from and to are required");
  }
  const rows = carryOverCandidates(fromMonth);
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const existing = get(
      "SELECT * FROM recharge_records WHERE student_name = ? AND month_key = ?",
      [row.student_name, toMonth],
    );
    if (existing && !shouldRefreshCarryOver(existing, force)) {
      skipped += 1;
      continue;
    }
    if (existing) {
      if (!isRealRechargeRecord(existing)) {
        db.prepare("DELETE FROM recharge_records WHERE id = ?").run(existing.id);
        updated += 1;
        continue;
      }
      const patch = carryOverRecordPatch(existing, fromMonth);
      db.prepare(`
        UPDATE recharge_records
        SET grade = ?,
            prev_actual = ?,
            prev_gift = ?,
            source = ?,
            notes = ?
        WHERE student_name = ? AND month_key = ?
      `).run(
        row.grade || "",
        num(row.actual_balance),
        num(row.gift_balance),
        patch.source,
        patch.notes,
        row.student_name,
        toMonth,
      );
      updated += 1;
    }
  }
  const candidateNames = new Set(rows.map((row) => row.student_name));
  for (const existing of all("SELECT * FROM recharge_records WHERE month_key = ?", [toMonth])) {
    if (candidateNames.has(existing.student_name) || !isAutoCarryOverRecord(existing)) continue;
    db.prepare("DELETE FROM recharge_records WHERE id = ?").run(existing.id);
    updated += 1;
  }

  return {
    from: fromMonth,
    to: toMonth,
    force,
    source_students: rows.length,
    inserted,
    updated,
    skipped,
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = zipDateTime();

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralStart = offset;
  const centralBuffer = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralBuffer, end]);
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function columnName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetXml(rows) {
  const body = rows.map((row, rIndex) => {
    const cells = row.map((value, cIndex) => {
      const ref = `${columnName(cIndex)}${rIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
      const textValue = value instanceof Date ? value.toISOString().slice(0, 10) : value;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(textValue)}</t></is></c>`;
    }).join("");
    return `<row r="${rIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function safeWorksheetName(name, fallback = "Sheet") {
  const base = text(name).replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31);
  return base || fallback;
}

function xlsxBuffer(sheetName, rows) {
  const safeSheetName = xmlEscape(sheetName).slice(0, 31) || "Sheet1";
  return zipStore([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    {
      name: "xl/styles.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>`,
    },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml(rows) },
  ]);
}

function multiSheetXlsxBuffer(sheets) {
  const normalized = [];
  const used = new Set();
  for (const [index, sheet] of sheets.entries()) {
    const base = safeWorksheetName(sheet.name, `Sheet${index + 1}`);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      const tail = `_${suffix}`;
      candidate = `${base.slice(0, 31 - tail.length)}${tail}`;
      suffix += 1;
    }
    used.add(candidate);
    normalized.push({ name: candidate, rows: Array.isArray(sheet.rows) ? sheet.rows : [] });
  }

  const worksheetOverrides = normalized.map((_, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join("");
  const workbookSheets = normalized.map((sheet, index) => (
    `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join("");
  const worksheetRels = normalized.map((_, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  )).join("");
  const styleRelId = normalized.length + 1;
  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${worksheetOverrides}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${workbookSheets}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${worksheetRels}
<Relationship Id="rId${styleRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    {
      name: "xl/styles.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>`,
    },
  ];
  normalized.forEach((sheet, index) => {
    files.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(sheet.rows) });
  });
  return zipStore(files);
}

function monthLabelCn(monthKey) {
  const year = monthKey.slice(0, 4);
  const month = Number(monthKey.slice(5, 7));
  return `${year}年${month}月`;
}

function monthNumberCn(monthKey) {
  return `${Number(monthKey.slice(5, 7))}月`;
}

function normalizeExportMonthKey(value) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] == null ? 1 : Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

function exportTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function coreWorkbookFilename(monthKey) {
  return `黎明教育_${monthLabelCn(monthKey)}_核心数据_${exportTimestamp()}.xlsx`;
}

function coreLessonRows(monthKey) {
  const lessons = all(
    "SELECT * FROM lessons WHERE month_key = ? ORDER BY date, teacher_name, time_slot, sort_order, id",
    [monthKey],
  );
  let sequence = 0;
  const rows = lessons.map((lesson) => {
    if (isEffective(lesson)) sequence += 1;
    return [
      lesson.teacher_name,
      lesson.date,
      lesson.lesson_status,
      weekdayCn(lesson.date),
      lesson.time_slot,
      lesson.classroom,
      lesson.grade,
      lesson.subject,
      lesson.student_names,
      lesson.notes,
      lesson.course_status,
      effectiveTeacherSalary(lesson),
      splitStudents(lesson.student_names).length,
      sequence,
    ];
  });
  return [
    [`${monthLabelCn(monthKey)}黎明教育课程安排`],
    ["授课老师", "日期", "上课情况", "星期", "时间", "教室", "年级", "科目", "学生", "备注", "课程状态", "教师薪资", "学生人数", "累计序号"],
    ...rows,
  ];
}

function coreStudentSummaryRows(monthKey, details) {
  const summaryRows = studentSummary(details, monthKey);
  const includedStudentNames = coreStudentSummaryIncludedNames(details, summaryRows);
  const rows = summaryRows.filter((row) => includedStudentNames.has(text(row.student_name)));
  return [
    [`${monthLabelCn(monthKey)} 学生费用汇总`],
    ["学生姓名", "年级", "上课次数", "课程总费用", "上月实际结转", "上月赠送结转", "本月实际充值", "本月赠送学费", "本月实际消费", "本月赠送消费", "本月实际余额", "本月赠送余额"],
    ...rows.map((row) => [
      row.student_name,
      row.grade,
      row.lesson_count,
      row.total_fee,
      row.prev_actual,
      row.prev_gift,
      row.cur_recharge,
      row.cur_gift,
      row.actual_consumption,
      row.gift_consumption,
      row.actual_balance,
      row.gift_balance,
    ]),
  ];
}

function coreStudentSummaryIncludedNames(details, summaryRows) {
  const included = new Set();
  for (const detail of details) {
    const studentName = text(detail.student_name);
    if (studentName) included.add(studentName);
  }
  for (const row of summaryRows) {
    const studentName = text(row.student_name);
    if (!studentName) continue;
    const rechargeNotes = text(row.recharge_notes);
    const hasRechargeSignal = num(row.cur_recharge) !== 0
      || num(row.cur_gift) !== 0
      || !!text(row.recharge_date)
      || (!!rechargeNotes && !rechargeNotes.startsWith("自动结转"));
    const hasPositiveBalance = num(row.actual_balance) > 0 || num(row.gift_balance) > 0;
    if (hasRechargeSignal || hasPositiveBalance) included.add(studentName);
  }
  return included;
}

function coreFeeDetailRows(monthKey, details) {
  const sorted = [...details].sort((a, b) => [
    text(a.student_name),
    text(a.date),
    text(a.time_slot),
    String(a.lesson_id || "").padStart(8, "0"),
    String(a.student_index || "").padStart(4, "0"),
  ].join("|").localeCompare([
    text(b.student_name),
    text(b.date),
    text(b.time_slot),
    String(b.lesson_id || "").padStart(8, "0"),
    String(b.student_index || "").padStart(4, "0"),
  ].join("|"), "zh-Hans-CN"));
  return [
    [`${monthLabelCn(monthKey)} 黎明教育学生费用明细`],
    ["学生姓名", "授课老师", "日期", "上课情况", "星期", "时间", "教室", "年级", "科目", "备注", "单人费用", "课程状态"],
    ...sorted.map((row) => [
      row.student_name,
      row.teacher_name,
      row.date,
      row.lesson_status,
      row.weekday,
      row.time_slot,
      row.classroom,
      row.grade,
      row.subject,
      row.notes,
      row.unit_price,
      row.course_status,
    ]),
  ];
}

function unregisteredRechargeRows(details, rechargeRows) {
  const registered = new Set(rechargeRows.map((row) => text(row.student_name)).filter(Boolean));
  const profiles = new Map(all("SELECT name, grade FROM students").map((row) => [row.name, row]));
  const byStudent = new Map();
  for (const detail of details) {
    const studentName = text(detail.student_name);
    if (!studentName || registered.has(studentName) || byStudent.has(studentName)) continue;
    const profile = profiles.get(studentName) || {};
    byStudent.set(studentName, {
      student_name: studentName,
      grade: detail.grade || profile.grade || "",
    });
  }
  return [...byStudent.values()].sort((a, b) => compareGradeName(a.grade, b.grade) || a.student_name.localeCompare(b.student_name, "zh-Hans-CN"));
}

function coreRechargeRows(monthKey, details) {
  const recharges = all(
    `SELECT * FROM recharge_records
     WHERE month_key = ?
       AND ${REAL_RECHARGE_SQL}
     ORDER BY CASE WHEN recharge_date IS NULL OR TRIM(recharge_date) = '' THEN 1 ELSE 0 END,
       recharge_date, id, student_name`,
    [monthKey],
  );
  const profiles = new Map(all("SELECT name, grade FROM students").map((row) => [row.name, row]));
  const missing = unregisteredRechargeRows(details, recharges);
  const maxRows = Math.max(recharges.length, missing.length);
  const rows = [];
  for (let index = 0; index < maxRows; index += 1) {
    const recharge = recharges[index] || {};
    const profile = profiles.get(recharge.student_name) || {};
    const miss = missing[index] || {};
    rows.push([
      recharge.student_name || "",
      recharge.grade || profile.grade || "",
      recharge.id ? num(recharge.prev_actual) : "",
      recharge.id ? num(recharge.prev_gift) : "",
      recharge.id ? num(recharge.cur_recharge) : "",
      recharge.id ? num(recharge.cur_gift) : "",
      recharge.recharge_date || "",
      recharge.notes || "",
      "",
      miss.student_name || "",
      miss.grade || "",
    ]);
  }
  return [
    ["充值记录（静态导出；右侧 J/K 列为未登记充值提醒）", "", "", "", "", "", "", "", "", "未登记充值提醒", ""],
    ["学生姓名", "年级", "上月实际结转", "上月赠送结转", "本月实际充值", "本月赠送学费", "充值日期", "备注", "", "未登记姓名", "未登记年级"],
    ...rows,
  ];
}

function coreTeacherSalaryRows(monthKey) {
  const rows = teacherSummary(monthKey);
  const totals = rows.reduce((acc, row) => {
    acc.lesson_count += num(row.lesson_count);
    acc.salary_total = moneyRound(acc.salary_total + num(row.salary_total));
    acc.week1_transport = moneyRound(acc.week1_transport + num(row.week1_transport));
    acc.week2_transport = moneyRound(acc.week2_transport + num(row.week2_transport));
    acc.week3_transport = moneyRound(acc.week3_transport + num(row.week3_transport));
    acc.week4_transport = moneyRound(acc.week4_transport + num(row.week4_transport));
    acc.total_salary = moneyRound(acc.total_salary + num(row.total_salary));
    return acc;
  }, {
    lesson_count: 0,
    salary_total: 0,
    week1_transport: 0,
    week2_transport: 0,
    week3_transport: 0,
    week4_transport: 0,
    total_salary: 0,
  });
  const output = [
    [`${monthLabelCn(monthKey)} 教师薪资汇总`],
    ["教师姓名", "上课课时数", "课时合计", "第一周车票", "第二周车票", "第三周车票", "第四周车票", "薪资合计", "备注"],
    ...rows.map((row) => [
      row.teacher_name,
      row.lesson_count,
      row.salary_total,
      row.week1_transport,
      row.week2_transport,
      row.week3_transport,
      row.week4_transport,
      row.total_salary,
      row.notes,
    ]),
  ];
  if (rows.length) {
    output.push([
      "合计",
      totals.lesson_count,
      totals.salary_total,
      totals.week1_transport,
      totals.week2_transport,
      totals.week3_transport,
      totals.week4_transport,
      totals.total_salary,
      "",
    ]);
  }
  return output;
}

function coreWorkbookSheets(monthKey) {
  const details = feeDetails(monthKey);
  const monthNumber = monthNumberCn(monthKey);
  return [
    { name: `${monthNumber}总表`, rows: coreLessonRows(monthKey) },
    { name: `${monthNumber}学生费用汇总`, rows: coreStudentSummaryRows(monthKey, details) },
    { name: "学生费用明细", rows: coreFeeDetailRows(monthKey, details) },
    { name: "充值记录", rows: coreRechargeRows(monthKey, details) },
    { name: "教师薪资汇总", rows: coreTeacherSalaryRows(monthKey) },
  ];
}

function teacherSalaryRows(monthKey) {
  const rows = teacherSummary(monthKey);
  const total = rows.reduce((sum, row) => sum + num(row.total_salary), 0);
  return [
    [`${monthKey} 教师薪资汇总`],
    ["教师姓名", "上课课时数", "课时合计", "第一周车票", "第二周车票", "第三周车票", "第四周车票", "薪资合计", "备注"],
    ...rows.map((row) => [
      row.teacher_name,
      row.lesson_count,
      row.salary_total,
      row.week1_transport,
      row.week2_transport,
      row.week3_transport,
      row.week4_transport,
      row.total_salary,
      row.notes,
    ]),
    ["合计", rows.reduce((sum, row) => sum + num(row.lesson_count), 0), rows.reduce((sum, row) => sum + num(row.salary_total), 0), "", "", "", "", total, ""],
  ];
}

function financeCsvRows(summary) {
  const rows = [
    ["经营概览", `${summary.range?.start || ""} 至 ${summary.range?.end || ""}`],
    [],
    ["期间汇总", "本期", "上期", "环比"],
  ];
  const overviewLabels = {
    revenue: "收入",
    gift_consumption: "赠送课消费",
    teacher_cost: "老师课时费",
    transport_cost: "交通补贴",
    operating_cost: "运营成本",
    gross_profit: "毛利",
    gross_margin: "毛利率",
    cash_in: "现金充值",
    gift_issued: "赠送发放",
    net_cash_flow: "净现金流",
  };
  for (const [key, label] of Object.entries(overviewLabels)) {
    const item = summary.overview[key];
    const delta = key === "gross_margin" ? item.mom_pp : item.mom_pct;
    rows.push([label, item.current, item.previous, delta == null ? "" : delta]);
  }
  rows.push(
    [],
    ["资金负债表", "金额"],
    ["月末沉淀现金", summary.balance_sheet.total_actual_balance],
    ["月末赠送余额", summary.balance_sheet.total_gift_balance],
    ["未缴费课时", summary.balance_sheet.unpaid_lesson_receivable],
    ["账户欠款", summary.balance_sheet.account_debt_receivable],
    ["应收合计", summary.balance_sheet.accounts_receivable],
    [],
    ["收入分布", "收入", "占比"],
    ...summary.breakdowns.by_grade.map((row) => [`年级：${row.name}`, row.revenue, row.share]),
    ...summary.breakdowns.by_subject.map((row) => [`科目：${row.name}`, row.revenue, row.share]),
    [],
    ["班型", "收入", "毛利率"],
    ...summary.breakdowns.by_class_type.map((row) => [row.class_type, row.revenue, row.gross_margin]),
    [],
    ["Top 10 学生", "课次", "消费"],
    ...summary.top_lists.top_students.map((row) => [row.student_name, row.lesson_count, row.total_fee]),
    [],
    ["老师人效", "贡献", "薪资", "ROI"],
    ...summary.breakdowns.by_teacher.map((row) => [row.teacher_name, row.revenue_contribution, row.salary_total, row.roi == null ? "" : row.roi]),
    [],
    ["风险清单", "类型", "金额/余额", "日期/参考"],
    ...summary.top_lists.account_debts.map((row) => [row.student_name, "账户欠款", row.amount, `现金余额 ${row.actual_balance}`]),
    ...summary.top_lists.low_balance.map((row) => [row.student_name, "低余额", row.actual_balance, `平均单次课费 ${row.avg_unit_price}`]),
    ...summary.top_lists.unpaid_lessons.map((row) => [row.student, "未缴费课时", row.unit_price, `${row.date} #${row.lesson_id}`]),
    [],
    ["近 6 个月趋势", "收入", "总成本", "毛利", "毛利率"],
    ...summary.trend_6m.map((row) => [row.month, row.revenue, row.total_cost, row.gross_profit, row.gross_margin]),
  );
  return rows;
}

function defaultStudentStatementRange() {
  const months = allPartitionedMonths().sort((a, b) => a.localeCompare(b));
  if (!months.length) return monthRange(getSetting("month_key"));
  return normalizeRange(months[0], monthEndKey(months[months.length - 1]));
}

function studentStatementRangeFromUrl(url) {
  const start = text(url.searchParams.get("start"));
  const end = text(url.searchParams.get("end"));
  if (start || end) return normalizeRange(start, end);
  return defaultStudentStatementRange();
}

function studentStatementData(studentName, range) {
  const name = text(studentName);
  if (!name || !range) return null;
  const details = [];
  const monthRows = [];
  const recharges = rechargesInRange(range).filter((row) => row.student_name === name);
  for (const monthKey of monthsCovered(range.start, range.end)) {
    const monthDetails = feeDetails(monthKey);
    const studentDetails = monthDetails.filter((row) => row.student_name === name && row.date >= range.start && row.date <= range.end);
    details.push(...studentDetails);
    const effectiveDetails = studentDetails.filter((row) => row.effective);
    const monthRecharge = recharges.filter((row) => (row.event_date || row.month_key) >= monthKey && (row.event_date || row.month_key) <= monthEndKey(monthKey));
    const overlap = {
      start: range.start > monthKey ? range.start : monthKey,
      end: range.end < monthEndKey(monthKey) ? range.end : monthEndKey(monthKey),
    };
    const monthAccount = calculateStudentAccountRange(name, overlap) || {};
    if (effectiveDetails.length || monthRecharge.length) {
      monthRows.push({
        month_key: monthKey,
        lesson_count: num(monthAccount.lesson_count),
        total_fee: num(monthAccount.total_fee),
        cur_recharge: num(monthAccount.cur_recharge),
        cur_gift: num(monthAccount.cur_gift),
        actual_consumption: num(monthAccount.actual_consumption),
        gift_consumption: num(monthAccount.gift_consumption),
        actual_balance: num(monthAccount.actual_balance),
        gift_balance: num(monthAccount.gift_balance),
      });
    }
  }
  const latestMonth = monthsCovered(range.start, range.end).filter((monthKey) => monthKey <= range.end).sort((a, b) => b.localeCompare(a))[0] || "";
  const latestSummary = latestMonth
    ? studentSummary(feeDetails(latestMonth), latestMonth, true).find((row) => row.student_name === name)
    : null;
  if (!details.length && !recharges.length && !latestSummary) return null;
  const effectiveDetails = details.filter((row) => row.effective);
  const accountRange = calculateStudentAccountRange(name, range) || {};
  return {
    student_name: name,
    range,
    summary: {
      grade: latestSummary?.grade || details.find((row) => row.grade)?.grade || "",
      lesson_count: num(accountRange.lesson_count ?? effectiveDetails.length),
      total_fee: moneyRound(accountRange.total_fee ?? effectiveDetails.reduce((sum, row) => sum + num(row.unit_price), 0)),
      cur_recharge: moneyRound(accountRange.cur_recharge ?? recharges.reduce((sum, row) => sum + num(row.cur_recharge), 0)),
      cur_gift: moneyRound(accountRange.cur_gift ?? recharges.reduce((sum, row) => sum + num(row.cur_gift), 0)),
      actual_consumption: moneyRound(accountRange.actual_consumption),
      gift_consumption: moneyRound(accountRange.gift_consumption),
      opening_actual_balance: moneyRound(accountRange.opening_actual_balance),
      opening_gift_balance: moneyRound(accountRange.opening_gift_balance),
      closing_actual_balance: moneyRound(accountRange.actual_balance),
      closing_gift_balance: moneyRound(accountRange.gift_balance),
      actual_balance: moneyRound(accountRange.actual_balance),
      gift_balance: moneyRound(accountRange.gift_balance),
      latest_month: latestMonth,
    },
    month_rows: monthRows.sort((a, b) => a.month_key.localeCompare(b.month_key)),
    details: details.sort((a, b) => `${a.date}|${a.time_slot}|${a.teacher_name}|${a.id}`.localeCompare(`${b.date}|${b.time_slot}|${b.teacher_name}|${b.id}`, "zh-Hans-CN")),
    recharges,
  };
}

function studentStatementRows(monthKey, studentName, range = null) {
  const report = studentStatementData(studentName, range || monthRange(monthKey));
  if (!report) return null;
  const { summary, details, recharges } = report;
  return [
    [`${report.range.start} 至 ${report.range.end} 学生账单`, report.student_name],
    ["学生姓名", "年级", "上课次数", "课程总费用", "期间实际充值", "期间赠送学费", "期间实际消费", "期间赠送消费", "最新实际余额", "最新赠送余额"],
    [
      report.student_name,
      summary.grade || "",
      summary.lesson_count || 0,
      summary.total_fee || 0,
      summary.cur_recharge || 0,
      summary.cur_gift || 0,
      summary.actual_consumption || 0,
      summary.gift_consumption || 0,
      summary.actual_balance || 0,
      summary.gift_balance || 0,
    ],
    [],
    ["充值明细"],
    ["日期", "现金充值", "赠送学费", "备注"],
    ...recharges.map((row) => [row.event_date || row.month_key, row.cur_recharge, row.cur_gift, row.notes]),
    [],
    ["课程明细"],
    ["日期", "星期", "时间", "授课老师", "状态", "教室", "年级", "科目", "备注", "单人费用", "费用来源"],
    ...details.map((row) => [
      row.date,
      row.weekday,
      row.time_slot,
      row.teacher_name,
      row.status,
      row.classroom,
      row.grade,
      row.subject,
      row.notes,
      row.unit_price,
      row.price_source === "manual" ? "手动"
        : row.price_source === "pending" ? "未设置"
          : "自动",
    ]),
  ];
}

function studentHistoryRows(studentName) {
  const name = text(studentName);
  if (!name) return [];
  const earliest = earliestDataMonth();
  if (earliest) withTransaction(() => refreshCarryOverAfter(earliest));
  const rows = [];
  for (const monthKey of allPartitionedMonths()) {
    const details = feeDetails(monthKey);
    const studentDetails = details.filter((row) => row.student_name === name);
    const recharge = get(
      `SELECT * FROM recharge_records WHERE student_name = ? AND month_key = ? AND ${REAL_RECHARGE_SQL}`,
      [name, monthKey],
    );
    if (!studentDetails.length && !recharge) continue;
    const summary = studentSummary(details, monthKey, true).find((row) => row.student_name === name) || {};
    rows.push({
      month_key: monthKey,
      lesson_count: num(summary.lesson_count),
      total_fee: num(summary.total_fee),
      actual_balance: num(summary.actual_balance),
      gift_balance: num(summary.gift_balance),
      net_recharge: num(summary.cur_recharge),
      cur_recharge: num(summary.cur_recharge),
      cur_gift: num(summary.cur_gift),
    });
  }
  return rows.sort((a, b) => b.month_key.localeCompare(a.month_key));
}

function studentPricingRows(monthKey) {
  const lessons = all("SELECT id, month_key, grade, subject, student_names FROM lessons ORDER BY date, teacher_name, time_slot, id");
  const rows = all("SELECT * FROM student_pricing ORDER BY id").filter(isCompleteStudentPricingRule).map((row) => {
    const studentName = text(row.student_name);
    const grade = text(row.grade);
    const subject = text(row.subject);
    const studentNames = normalizedStudents(row.student_names);
    const matches = lessons.filter((lesson) => (
      splitStudents(normalizedStudents(lesson.student_names)).includes(studentName)
      && text(lesson.subject) === subject
      && text(lesson.grade) === grade
      && normalizedStudents(lesson.student_names) === studentNames
      && isCompletedLesson(lesson)
    ));
    const rulePrice = num(row.custom_price);
    const mismatchCount = rulePrice > 0
      ? matches.filter((lesson) => {
        const price = unitPriceFor({
          studentName,
          subject: lesson.subject,
          grade: lesson.grade,
          studentCount: splitStudents(lesson.student_names).length,
          lessonId: lesson.id,
          status: deriveStatus(lesson),
          studentNames: lesson.student_names,
        });
        return Math.abs(num(price.unit_price) - rulePrice) >= 0.0001;
      }).length
      : 0;
    return {
      ...row,
      grade,
      student_names: studentNames,
      lookup_key: [studentName, grade, subject, studentNames].filter(Boolean).join("-"),
      current_month_lessons: matches.filter((lesson) => lesson.month_key === monthKey).length,
      total_lessons: matches.length,
      rule_source: rulePrice <= 0 ? "pending" : (mismatchCount > 0 ? "manual" : "auto"),
      mismatch_lessons: mismatchCount,
    };
  });
  return rows.sort((a, b) => (
    compareGradeName(a.grade, b.grade)
    || text(a.student_name).localeCompare(text(b.student_name), "zh-Hans-CN")
    || text(a.subject).localeCompare(text(b.subject), "zh-Hans-CN")
    || text(a.student_names).localeCompare(text(b.student_names), "zh-Hans-CN")
    || Number(a.id || 0) - Number(b.id || 0)
  ));
}

function recomputePricing(body) {
  const studentName = text(body.student_name);
  const subject = text(body.subject);
  const monthKey = text(body.month_key || getSetting("month_key"));
  if (!studentName || !subject || !validMonthKey(monthKey)) {
    return { error: "student_name, subject and month_key are required", status: 400 };
  }
  return withTransaction(() => {
    const lessons = all(
      "SELECT * FROM lessons WHERE month_key = ? AND subject = ? ORDER BY date, teacher_name, time_slot, sort_order, id",
      [monthKey, subject],
    ).filter((lesson) => splitStudents(lesson.student_names).includes(studentName));
    let oldTotal = 0;
    let newTotal = 0;
    let clearedOverrides = 0;
    for (const lesson of lessons) {
      const names = splitStudents(lesson.student_names);
      const oldPrice = unitPriceFor({
        studentName,
        subject: lesson.subject,
        grade: lesson.grade,
        studentCount: names.length,
        lessonId: lesson.id,
        status: deriveStatus(lesson),
        studentNames: lesson.student_names,
      });
      oldTotal += num(oldPrice.unit_price);
      const removed = db.prepare("DELETE FROM fee_overrides WHERE lesson_id = ? AND student_name = ?").run(lesson.id, studentName);
      clearedOverrides += removed.changes || 0;
      const newPrice = unitPriceFor({
        studentName,
        subject: lesson.subject,
        grade: lesson.grade,
        studentCount: names.length,
        lessonId: lesson.id,
        status: deriveStatus(lesson),
        studentNames: lesson.student_names,
      });
      newTotal += num(newPrice.unit_price);
    }
    db.prepare(`
      INSERT INTO audit_logs(run_id, source, severity, entity, field, before_value, after_value, status, notes)
      VALUES (?, 'pricing_recompute', 'info', ?, 'unit_price', ?, ?, 'fixed', ?)
    `).run(
      `pricing_recompute_${Date.now()}`,
      `${studentName} / ${subject} / ${monthKey}`,
      `旧价合计 ¥${oldTotal}`,
      `新价合计 ¥${newTotal}`,
      `重算 ${lessons.length} 节课，清除 ${clearedOverrides} 条手填覆盖`,
    );
    return {
      affected: lessons.length,
      cleared_overrides: clearedOverrides,
      old_total: oldTotal,
      new_total: newTotal,
      audit_log_id: Number(get("SELECT last_insert_rowid() AS id").id),
    };
  });
}

function applyStudentPricingRulesToDetails(items) {
  const normalizedItems = [];
  const seen = new Set();
  for (const item of items || []) {
    const lessonId = Number(item.lesson_id);
    const studentName = text(item.student_name);
    const key = `${lessonId}\u0001${studentName}`;
    if (!lessonId || !studentName || seen.has(key)) continue;
    seen.add(key);
    normalizedItems.push({ lesson_id: lessonId, student_name: studentName });
  }
  if (!normalizedItems.length) return { error: "请选择要按规则更新的费用明细", status: 400 };
  return withTransaction(() => {
    const updatedDetails = [];
    const skippedDetails = [];
    for (const item of normalizedItems) {
      const lesson = get("SELECT * FROM lessons WHERE id = ?", [item.lesson_id]);
      if (!lesson) {
        skippedDetails.push({ ...item, reason: "lesson_not_found" });
        continue;
      }
      if (!isCompletedLesson(lesson)) {
        skippedDetails.push({ ...item, reason: "not_completed" });
        continue;
      }
      if (!splitStudents(lesson.student_names).includes(item.student_name)) {
        skippedDetails.push({ ...item, reason: "student_not_in_lesson" });
        continue;
      }
      const rule = activeStudentPricingRuleForLesson({
        studentName: item.student_name,
        grade: lesson.grade,
        subject: lesson.subject,
        studentNames: lesson.student_names,
      });
      if (!rule || num(rule.custom_price) <= 0) {
        skippedDetails.push({ ...item, reason: "no_active_rule" });
        continue;
      }
      const unitPrice = moneyRound(num(rule.custom_price));
      db.prepare(`
        INSERT INTO fee_overrides(lesson_id, student_name, unit_price, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(lesson_id, student_name) DO UPDATE SET
          unit_price = excluded.unit_price,
          updated_at = CURRENT_TIMESTAMP
      `).run(item.lesson_id, item.student_name, unitPrice);
      updatedDetails.push({
        ...item,
        unit_price: unitPrice,
        pricing_rule_id: Number(rule.id),
      });
    }
    return {
      updatedCount: updatedDetails.length,
      skippedCount: skippedDetails.length,
      updatedDetails,
      skippedDetails,
    };
  });
}

function buildBootstrap(monthKey, includeInactive = false) {
  syncStudentsFromLessons();
  syncTeachersFromLessons();
  withTransaction(() => {
    autoPromoteStudentsForMonth(monthKey);
    ensureCarryOverChain(monthKey);
  });
  syncStudentPricingCandidatesFromLessons();
  const details = feeDetails(monthKey);
  const settings = Object.fromEntries(all("SELECT key, value FROM settings").map((row) => [row.key, row.value]));
  settings.month_key = monthKey;
  return {
    active_month_key: monthKey,
    settings,
    lookups: {
      lesson_status: LESSON_STATUS,
      course_status: COURSE_STATUS,
      status: courseStatusValues(),
      classrooms: mergeLookupValues(CLASSROOMS, "custom_classrooms"),
      subjects: mergeLookupValues(SUBJECTS, "custom_subjects"),
      times: mergeLookupValues([], "custom_time_slots"),
      grades: GRADES,
      staff_roles: STAFF_ROLES,
      expense_categories: EXPENSE_CATEGORIES,
      attendance_status: ATTENDANCE_STATUS,
    },
    teachers: teachersForMonth(monthKey, includeInactive),
    students: studentsForMonth(monthKey, includeInactive),
    used_lesson_lookups: usedLessonLookups(),
    pricing_standards: all("SELECT * FROM pricing_standards ORDER BY grade, student_count"),
    student_pricing: studentPricingRows(monthKey),
    lessons: all("SELECT *, ? AS weekday FROM lessons WHERE month_key = ? ORDER BY date, teacher_name, time_slot, sort_order, id", ["", monthKey]),
    recharges: all(`SELECT * FROM recharge_records WHERE month_key = ? AND ${REAL_RECHARGE_SQL} ORDER BY student_name`, [monthKey]),
    opening_balances: openingBalanceRows(),
    derived: {
      fee_details: details,
      student_summary: studentSummary(details, monthKey, includeInactive),
      student_summary_to_date: studentSummaryToDate(monthKey, includeInactive),
      teacher_summary: teacherSummary(monthKey, includeInactive),
    },
  };
}

function bootstrap(monthKey, includeInactive = false) {
  const key = cacheKey(monthKey, includeInactive ? "1" : "0");
  return cachedDerived(
    "bootstrap",
    key,
    `bootstrap month=${monthKey} includeInactive=${includeInactive ? 1 : 0}`,
    () => buildBootstrap(monthKey, includeInactive),
  );
}

function lessonsInDateRange(start, end) {
  const range = normalizeRange(start, end);
  if (!range) return null;
  return all(
    `SELECT *, '' AS weekday FROM lessons
     WHERE date >= ? AND date <= ?
     ORDER BY date, teacher_name, time_slot, classroom, sort_order, id`,
    [range.start, range.end],
  );
}

function normalizedStudents(value) {
  return uniqueNames(splitStudents(value)).sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).join("、");
}

function uniqueNames(values) {
  return [...new Set((values || []).map((value) => text(value).replace(/\s+/g, "")).filter(Boolean))];
}

function courseClassKey(row) {
  return [
    text(row.grade),
    text(row.subject),
    normalizedStudents(row.student_names),
    text(row.teacher_name),
  ].join("+");
}

function teacherSalaryRuleKey(row) {
  return [
    text(row.teacher_name),
    text(row.grade),
    text(row.subject),
    normalizedStudents(row.student_names),
  ].join("\u0001");
}

function teacherSalaryRules() {
  return all(`
    SELECT *
    FROM teacher_salary_rules
    ORDER BY teacher_name,
      CASE grade
        WHEN '初一' THEN 1
        WHEN '初二' THEN 2
        WHEN '初三' THEN 3
        WHEN '高一' THEN 4
        WHEN '高二' THEN 5
        WHEN '高三' THEN 6
        ELSE 99
      END,
      grade, subject, student_names, id
  `);
}

function activeTeacherSalaryRuleForLesson(lesson) {
  const teacherName = text(lesson.teacher_name);
  const grade = text(lesson.grade);
  const subject = text(lesson.subject);
  const studentNames = normalizedStudents(lesson.student_names);
  if (!teacherName || !grade || !subject || !studentNames) return null;
  return get(`
    SELECT *
    FROM teacher_salary_rules
    WHERE salary_per_unit > 0
      AND teacher_name = ?
      AND grade = ?
      AND subject = ?
      AND student_names = ?
    ORDER BY id DESC
    LIMIT 1
  `, [teacherName, grade, subject, studentNames]);
}

function normalizeTeacherSalaryRuleInput(body, current = {}) {
  const teacherName = Object.prototype.hasOwnProperty.call(body, "teacher_name") ? text(body.teacher_name) : text(current.teacher_name);
  const grade = Object.prototype.hasOwnProperty.call(body, "grade") ? text(body.grade) : text(current.grade);
  const subject = Object.prototype.hasOwnProperty.call(body, "subject") ? text(body.subject) : text(current.subject);
  const studentNames = Object.prototype.hasOwnProperty.call(body, "student_names")
    ? normalizedStudents(body.student_names)
    : normalizedStudents(current.student_names);
  const salaryPerUnit = Object.prototype.hasOwnProperty.call(body, "salary_per_unit")
    ? optionalNumber(body.salary_per_unit)
    : optionalNumber(current.salary_per_unit);
  const unitHoursValue = Object.prototype.hasOwnProperty.call(body, "unit_hours")
    ? optionalNumber(body.unit_hours)
    : optionalNumber(current.unit_hours);
  const unitHours = unitHoursValue == null ? 2 : unitHoursValue;
  const isActive = Object.prototype.hasOwnProperty.call(body, "is_active")
    ? (Number(body.is_active) === 0 ? 0 : 1)
    : (Number(current.is_active) === 0 ? 0 : 1);
  if (!teacherName || !grade || !subject || !studentNames) {
    return { error: "老师、年级、科目和学生集合均为必填项", status: 400 };
  }
  if (salaryPerUnit == null || salaryPerUnit < 0) {
    return { error: "每课时薪资必须是大于或等于 0 的有效数字", status: 400 };
  }
  if (!Number.isFinite(unitHours) || unitHours <= 0) {
    return { error: "课时小时数必须是大于 0 的有效数字", status: 400 };
  }
  return {
    teacher_name: teacherName,
    grade,
    subject,
    student_names: studentNames,
    salary_per_unit: moneyRound(salaryPerUnit),
    unit_hours: unitHours,
    is_active: isActive,
    notes: Object.prototype.hasOwnProperty.call(body, "notes") ? text(body.notes) : text(current.notes),
  };
}

function activeTeacherSalaryRuleConflict(rule, excludeId = 0) {
  return get(`
    SELECT *
    FROM teacher_salary_rules
    WHERE teacher_name = ?
      AND grade = ?
      AND subject = ?
      AND student_names = ?
      AND id <> ?
    LIMIT 1
  `, [rule.teacher_name, rule.grade, rule.subject, rule.student_names, Number(excludeId) || 0]);
}

function createTeacherSalaryRule(body) {
  const rule = normalizeTeacherSalaryRuleInput(body);
  if (rule.error) return rule;
  if (activeTeacherSalaryRuleConflict(rule)) {
    return { error: "相同老师、年级、科目和学生集合的薪资规则已存在", status: 409 };
  }
  const result = db.prepare(`
    INSERT INTO teacher_salary_rules(
      teacher_name, grade, subject, student_names, salary_per_unit, unit_hours, is_active, notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rule.teacher_name,
    rule.grade,
    rule.subject,
    rule.student_names,
    rule.salary_per_unit,
    rule.unit_hours,
    rule.is_active,
    rule.notes,
  );
  return get("SELECT * FROM teacher_salary_rules WHERE id = ?", [Number(result.lastInsertRowid)]);
}

function updateTeacherSalaryRule(id, body) {
  const current = get("SELECT * FROM teacher_salary_rules WHERE id = ?", [Number(id)]);
  if (!current) return { error: "薪资规则不存在", status: 404 };
  const rule = normalizeTeacherSalaryRuleInput(body, current);
  if (rule.error) return rule;
  if (activeTeacherSalaryRuleConflict(rule, id)) {
    return { error: "相同老师、年级、科目和学生集合的薪资规则已存在", status: 409 };
  }
  db.prepare(`
    UPDATE teacher_salary_rules
    SET teacher_name = ?, grade = ?, subject = ?, student_names = ?,
        salary_per_unit = ?, unit_hours = ?, is_active = ?, notes = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    rule.teacher_name,
    rule.grade,
    rule.subject,
    rule.student_names,
    rule.salary_per_unit,
    rule.unit_hours,
    rule.is_active,
    rule.notes,
    Number(id),
  );
  return get("SELECT * FROM teacher_salary_rules WHERE id = ?", [Number(id)]);
}

function deactivateTeacherSalaryRule(id) {
  const current = get("SELECT * FROM teacher_salary_rules WHERE id = ?", [Number(id)]);
  if (!current) return { error: "薪资规则不存在", status: 404 };
  db.prepare(`
    UPDATE teacher_salary_rules
    SET is_active = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(Number(id));
  return get("SELECT * FROM teacher_salary_rules WHERE id = ?", [Number(id)]);
}

function syncTeacherSalaryRuleCandidatesFromLessons() {
  return withTransaction(() => {
    const existingKeys = new Set(teacherSalaryRules().map((rule) => teacherSalaryRuleKey(rule)));
    const seenLessonKeys = new Set();
    const skippedReasons = new Map();
    const insert = db.prepare(`
      INSERT INTO teacher_salary_rules(
        teacher_name, grade, subject, student_names, salary_per_unit, unit_hours, is_active, notes
      )
      VALUES (?, ?, ?, ?, 0, 2, 0, ?)
    `);
    let createdCount = 0;
    let existingCount = 0;
    let scannedLessonCount = 0;
    const createdRules = [];
    for (const lesson of all(`
      SELECT teacher_name, grade, subject, student_names
      FROM lessons
      ORDER BY teacher_name, grade, subject, student_names, id
    `)) {
      scannedLessonCount += 1;
      const candidate = {
        teacher_name: text(lesson.teacher_name),
        grade: text(lesson.grade),
        subject: text(lesson.subject),
        student_names: normalizedStudents(lesson.student_names),
      };
      const missing = [];
      if (!candidate.teacher_name) missing.push("缺少老师");
      if (!candidate.grade) missing.push("缺少年级");
      if (!candidate.subject) missing.push("缺少科目");
      if (!candidate.student_names) missing.push("缺少学生");
      if (missing.length) {
        const reason = missing.join("、");
        skippedReasons.set(reason, (skippedReasons.get(reason) || 0) + 1);
        continue;
      }
      const key = teacherSalaryRuleKey(candidate);
      if (seenLessonKeys.has(key)) continue;
      seenLessonKeys.add(key);
      if (existingKeys.has(key)) {
        existingCount += 1;
        continue;
      }
      const result = insert.run(
        candidate.teacher_name,
        candidate.grade,
        candidate.subject,
        candidate.student_names,
        "",
      );
      const created = get("SELECT * FROM teacher_salary_rules WHERE id = ?", [Number(result.lastInsertRowid)]);
      createdRules.push(created);
      existingKeys.add(key);
      createdCount += 1;
    }
    return {
      scannedLessonCount,
      uniqueCandidateCount: seenLessonKeys.size,
      createdCount,
      existingCount,
      skippedCount: [...skippedReasons.values()].reduce((sum, count) => sum + count, 0),
      skippedReasons: [...skippedReasons.entries()].map(([reason, count]) => ({ reason, count })),
      createdRules,
    };
  });
}

function parseLessonHours(timeSlot) {
  const range = parseTimeRange(timeSlot);
  if (!range) return null;
  const hours = (range.end - range.start) / 60;
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

function lessonSalaryUnits(timeSlot, unitHours = 2) {
  const normalizedUnitHours = optionalNumber(unitHours);
  const divisor = normalizedUnitHours != null && normalizedUnitHours > 0 ? normalizedUnitHours : 2;
  const hours = parseLessonHours(timeSlot);
  if (hours == null) {
    return {
      hours: null,
      units: 1,
      warning: `无法解析课程时间「${text(timeSlot) || "空"}」，已默认按 1 课时计算`,
    };
  }
  return { hours, units: hours / divisor, warning: "" };
}

function calculateTeacherSalaryFromRule(rule, lesson) {
  if (!rule) return null;
  if (!isCompletedLesson(lesson)) return null;
  const unitResult = lessonSalaryUnits(lesson.time_slot, rule.unit_hours);
  return {
    rule_id: Number(rule.id),
    salary: moneyRound(num(rule.salary_per_unit) * unitResult.units),
    salary_per_unit: num(rule.salary_per_unit),
    unit_hours: num(rule.unit_hours) || 2,
    lesson_hours: unitResult.hours,
    lesson_units: unitResult.units,
    warning: unitResult.warning,
  };
}

function resolvedTeacherSalaryForLesson(data, options = {}) {
  if (!isCompletedLesson(data)) {
    return {
      teacher_salary: 0,
      teacher_salary_source: "empty",
      teacher_salary_rule_id: null,
      warning: "",
    };
  }
  const teacherSalary = optionalNumber(data.teacher_salary);
  const explicitSalary = data.teacher_salary_present === true
    || (
      data.teacher_salary_present !== false
      && Object.prototype.hasOwnProperty.call(data, "teacher_salary")
      && teacherSalary !== null
    );
  if (explicitSalary && teacherSalary !== null) {
    return {
      teacher_salary: teacherSalary,
      teacher_salary_source: text(data.teacher_salary_source) || text(options.explicitSource) || "manual",
      teacher_salary_rule_id: optionalNumber(data.teacher_salary_rule_id),
      warning: "",
    };
  }
  if (options.autoTeacherSalary !== false) {
    const rule = activeTeacherSalaryRuleForLesson(data);
    const calculated = calculateTeacherSalaryFromRule(rule, data);
    if (calculated) {
      return {
        teacher_salary: calculated.salary,
        teacher_salary_source: "auto",
        teacher_salary_rule_id: calculated.rule_id,
        warning: calculated.warning,
      };
    }
  }
  return {
    teacher_salary: null,
    teacher_salary_source: "empty",
    teacher_salary_rule_id: null,
    warning: "",
  };
}

function applyTeacherSalaryRulesToLessons(lessonIds) {
  const ids = [...new Set((lessonIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return { error: "请至少选择一条课程记录", status: 400 };
  if (ids.length > 500) return { error: "单次最多处理 500 条课程记录", status: 400 };
  return withTransaction(() => {
    const updatedLessons = [];
    const skippedReasons = [];
    const warnings = [];
    for (const id of ids) {
      const lesson = get("SELECT * FROM lessons WHERE id = ?", [id]);
      if (!lesson) {
        skippedReasons.push({ lesson_id: id, reason: "课程不存在" });
        continue;
      }
      if (!isCompletedLesson(lesson)) {
        skippedReasons.push({ lesson_id: id, reason: "非已上课程不参与薪资规则" });
        continue;
      }
      const rule = activeTeacherSalaryRuleForLesson(lesson);
      const calculated = calculateTeacherSalaryFromRule(rule, lesson);
      if (!calculated) {
        skippedReasons.push({ lesson_id: id, reason: "未匹配到启用的教师薪资规则" });
        continue;
      }
      db.prepare(`
        UPDATE lessons
        SET teacher_salary = ?, teacher_salary_source = 'auto',
            teacher_salary_rule_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(calculated.salary, calculated.rule_id, id);
      const updated = get("SELECT * FROM lessons WHERE id = ?", [id]);
      updatedLessons.push(updated);
      if (calculated.warning) warnings.push({ lesson_id: id, warning: calculated.warning });
    }
    return {
      updatedCount: updatedLessons.length,
      skippedCount: skippedReasons.length,
      updatedLessons,
      skippedReasons,
      warnings,
    };
  });
}

function courseCompletionKey(row) {
  return [
    text(row.grade),
    text(row.subject),
    normalizedStudents(row.student_names),
    text(row.teacher_name),
    text(row.date),
    text(row.time_slot),
  ].join("+");
}

function sendObjectDefaultGreeting(item) {
  if (item.send_object_type !== "1V1个人群") return "各位家长您们好！";
  const student = text(item.students).replace(/\s+/g, "");
  const shortName = student.length === 2 ? student : student.slice(-2) || student;
  return `${shortName}妈妈您好！`;
}

function teacherNoticeDefaultGreeting(item) {
  const teacher = text(item.teachers?.[0] || item.teacher_name || item.send_object_name).replace(/老师课程$/, "");
  return `${teacher}老师你好！`;
}

function courseNoticeLesson(row) {
  const students = normalizedStudents(row.student_names);
  return {
    id: row.id,
    teacher_name: text(row.teacher_name),
    date: text(row.date),
    lesson_status: text(row.lesson_status),
    status: deriveStatus(row),
    weekday: weekdayCn(row.date),
    time_slot: text(row.time_slot),
    classroom: text(row.classroom),
    grade: text(row.grade),
    subject: text(row.subject),
    student_names: students,
    notes: text(row.notes),
    class_key: courseClassKey(row),
    completion_key: courseCompletionKey(row),
  };
}

function courseNoticeData(start, end, onlyTeaching = false) {
  const rows = lessonsInDateRange(start, end);
  if (!rows) return null;
  const lessons = rows
    .filter((row) => !onlyTeaching || text(row.lesson_status) === "上课")
    .map(courseNoticeLesson);
  const classMap = new Map();
  const personalStudents = new Set();
  for (const lesson of lessons) {
    const students = splitStudents(lesson.student_names);
    if (students.length === 1) personalStudents.add(students[0]);
    if (students.length >= 2) {
      const key = `CLASS|${lesson.class_key}`;
      if (!classMap.has(key)) {
        classMap.set(key, {
          send_object_key: key,
          send_object_name: `${lesson.grade}${lesson.subject}-${lesson.student_names}`,
          send_object_type: "班级群",
          students: lesson.student_names,
          teachers: [lesson.teacher_name],
          grades: [lesson.grade],
          subjects: [lesson.subject],
          lessons: [],
        });
      }
      classMap.get(key).lessons.push(lesson);
    }
  }

  const objects = [];
  for (const student of [...personalStudents].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))) {
    const studentLessons = lessons.filter((lesson) => splitStudents(lesson.student_names).includes(student));
    const teachers = uniqueNames(studentLessons.map((lesson) => lesson.teacher_name));
    const grades = uniqueNames(studentLessons.map((lesson) => lesson.grade));
    const subjects = uniqueNames(studentLessons.map((lesson) => lesson.subject));
    objects.push({
      send_object_key: `PERSONAL_ALL|${student}`,
      send_object_name: `${student}个人课程`,
      send_object_type: "1V1个人群",
      students: student,
      teachers,
      grades,
      subjects,
      lessons: studentLessons,
    });
  }
  objects.push(...classMap.values());

  const completionKeys = new Set(all("SELECT unique_key FROM course_notice_completion_records").map((row) => row.unique_key));
  const greetingRows = new Map(all("SELECT * FROM parent_message_greetings").map((row) => [row.send_object_key, row]));
  const globalTail = getSetting("course_notice_global_tail") || "这是我们本周的上课安排哦[玫瑰]";

  return {
    range: { start, end },
    only_teaching: Boolean(onlyTeaching),
    global_tail: globalTail,
    send_objects: objects
      .map((item) => {
        const saved = greetingRows.get(item.send_object_key);
        const greeting = text(saved?.greeting) || sendObjectDefaultGreeting(item);
        const lessonKeys = item.lessons.map((lesson) => lesson.completion_key);
        const completedCount = lessonKeys.filter((key) => completionKeys.has(key)).length;
        const completed = lessonKeys.length > 0 && completedCount === lessonKeys.length;
        const partial_completed = completedCount > 0 && !completed;
        return {
          ...item,
          teachers: uniqueNames(item.teachers),
          grades: uniqueNames(item.grades),
          subjects: uniqueNames(item.subjects),
          greeting,
          global_tail: globalTail,
          full_message: `${greeting}\n${globalTail}`,
          completed,
          partial_completed,
          completed_count: completedCount,
          lesson_count: item.lessons.length,
        };
      })
      .sort((a, b) => [
        a.send_object_type === "1V1个人群" ? "0" : "1",
        a.send_object_name,
      ].join("|").localeCompare([
        b.send_object_type === "1V1个人群" ? "0" : "1",
        b.send_object_name,
      ].join("|"), "zh-Hans-CN")),
  };
}

function teacherCourseNoticeData(start, end, onlyTeaching = false) {
  const rows = lessonsInDateRange(start, end);
  if (!rows) return null;
  const lessons = rows
    .filter((row) => !onlyTeaching || text(row.lesson_status) === "上课")
    .map((row) => {
      const lesson = courseNoticeLesson(row);
      lesson.completion_key = `TEACHER|${lesson.teacher_name}|${lesson.completion_key}`;
      return lesson;
    })
    .filter((lesson) => text(lesson.teacher_name));
  const teacherMap = new Map();
  for (const lesson of lessons) {
    const teacher = text(lesson.teacher_name);
    const key = `TEACHER|${teacher}`;
    if (!teacherMap.has(key)) {
      teacherMap.set(key, {
        send_object_key: key,
        send_object_name: `${teacher}老师课程`,
        send_object_type: "老师课程通知",
        students: "",
        teachers: [teacher],
        grades: [],
        subjects: [],
        lessons: [],
      });
    }
    const item = teacherMap.get(key);
    item.grades.push(lesson.grade);
    item.subjects.push(lesson.subject);
    item.lessons.push(lesson);
  }

  const completionKeys = new Set(all("SELECT unique_key FROM course_notice_completion_records WHERE send_object_key LIKE 'TEACHER|%'").map((row) => row.unique_key));
  const greetingRows = new Map(all("SELECT * FROM parent_message_greetings WHERE send_object_key LIKE 'TEACHER|%'").map((row) => [row.send_object_key, row]));
  const globalTail = getSetting("teacher_course_notice_global_tail") || "这是我们本周的上课安排哦[玫瑰]";

  return {
    range: { start, end },
    only_teaching: Boolean(onlyTeaching),
    global_tail: globalTail,
    send_objects: [...teacherMap.values()]
      .map((item) => {
        item.lessons.sort((a, b) => `${a.date} ${a.time_slot} ${String(a.id).padStart(8, "0")}`.localeCompare(`${b.date} ${b.time_slot} ${String(b.id).padStart(8, "0")}`, "zh-Hans-CN"));
        const saved = greetingRows.get(item.send_object_key);
        const greeting = text(saved?.greeting) || teacherNoticeDefaultGreeting(item);
        const lessonKeys = item.lessons.map((lesson) => lesson.completion_key);
        const completedCount = lessonKeys.filter((key) => completionKeys.has(key)).length;
        const completed = lessonKeys.length > 0 && completedCount === lessonKeys.length;
        const partial_completed = completedCount > 0 && !completed;
        return {
          ...item,
          grades: uniqueNames(item.grades),
          subjects: uniqueNames(item.subjects),
          greeting,
          global_tail: globalTail,
          full_message: `${greeting}\n${globalTail}`,
          completed,
          partial_completed,
          completed_count: completedCount,
          lesson_count: item.lessons.length,
        };
      })
      .sort((a, b) => a.send_object_name.localeCompare(b.send_object_name, "zh-Hans-CN")),
  };
}

function saveCourseNoticeGreeting(body) {
  const sendObjectKey = text(body.send_object_key);
  if (!sendObjectKey) return { error: "send_object_key is required", status: 400 };
  const globalTail = text(body.global_tail) || getSetting("course_notice_global_tail") || "这是我们本周的上课安排哦[玫瑰]";
  const greeting = text(body.greeting);
  db.prepare(`
    INSERT INTO parent_message_greetings(
      send_object_key, send_object_name, send_object_type, students, greeting, global_tail, full_message, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(send_object_key) DO UPDATE SET
      send_object_name = excluded.send_object_name,
      send_object_type = excluded.send_object_type,
      students = excluded.students,
      greeting = excluded.greeting,
      global_tail = excluded.global_tail,
      full_message = excluded.full_message,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    sendObjectKey,
    text(body.send_object_name),
    text(body.send_object_type),
    normalizedStudents(body.students),
    greeting,
    globalTail,
    `${greeting}\n${globalTail}`,
  );
  return { ok: true };
}

function completeCourseNoticeObject(user, body) {
  const lessons = Array.isArray(body.lessons) ? body.lessons : [];
  if (!text(body.send_object_key) || !lessons.length) return { error: "send_object_key and lessons are required", status: 400 };
  const stmt = db.prepare(`
    INSERT INTO course_notice_completion_records(
      unique_key, grade, subject, students, teacher, date, time, status, classroom,
      send_object_key, send_object_name, send_object_type, completed_at, completed_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(unique_key) DO UPDATE SET
      status = excluded.status,
      classroom = excluded.classroom,
      send_object_key = excluded.send_object_key,
      send_object_name = excluded.send_object_name,
      send_object_type = excluded.send_object_type,
      completed_at = CURRENT_TIMESTAMP,
      completed_by = excluded.completed_by
  `);
  let count = 0;
  withTransaction(() => {
    for (const lesson of lessons) {
      const row = {
        grade: text(lesson.grade),
        subject: text(lesson.subject),
        student_names: normalizedStudents(lesson.student_names || lesson.students),
        teacher_name: text(lesson.teacher_name || lesson.teacher),
        date: text(lesson.date),
        time_slot: text(lesson.time_slot || lesson.time),
        status: text(lesson.status || lesson.lesson_status),
        classroom: text(lesson.classroom),
      };
      const key = text(lesson.completion_key) || courseCompletionKey(row);
      if (!key) continue;
      stmt.run(
        key,
        row.grade,
        row.subject,
        row.student_names,
        row.teacher_name,
        row.date,
        row.time_slot,
        row.status,
        row.classroom,
        text(body.send_object_key),
        text(body.send_object_name),
        text(body.send_object_type),
        text(user.display_name || user.username),
      );
      count += 1;
    }
  });
  return { ok: true, completed: count };
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendBuffer(res, buffer, contentType, filename) {
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": buffer.length,
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  res.end(buffer);
}

function csvEscape(value) {
  const textValue = value == null ? "" : String(value);
  return /[",\r\n]/.test(textValue) ? `"${textValue.replaceAll('"', '""')}"` : textValue;
}

function sendCsv(res, rows, filename) {
  const csv = "\ufeff" + rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  sendBuffer(res, Buffer.from(csv, "utf8"), "text/csv; charset=utf-8", filename);
}

function sendText(res, content, filename) {
  const body = "\ufeff" + String(content || "");
  sendBuffer(res, Buffer.from(body, "utf8"), "text/plain; charset=utf-8", filename);
}

function sendError(res, status, message) {
  sendJson(res, { error: message }, status);
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

function auditJson(value) {
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "unserializable" });
  }
}

function requestIp(req) {
  return text(String(req.headers["x-forwarded-for"] || "").split(",")[0]) || text(req.socket?.remoteAddress);
}

function recordAuditEvent(req, actor, { action, entity_type, entity_id = "", before = null, after = null }) {
  if (!actor || !action || !entity_type) return;
  db.prepare(`
    INSERT INTO audit_events(
      actor_user_id, actor_username, actor_role, action, entity_type, entity_id,
      before_json, after_json, ip, user_agent
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(actor.id) || null,
    text(actor.username),
    text(actor.role),
    text(action),
    text(entity_type),
    text(entity_id),
    auditJson(before),
    auditJson(after),
    requestIp(req),
    text(req.headers["user-agent"]),
  );
}

function writeOperationLog(operator, { operation_type, operation_content = "", target_type = "", target_id = "" }) {
  if (!operator || !operation_type) return;
  db.prepare(`
    INSERT INTO operation_logs(campus_name, operator_name, operator_account, operation_type, operation_content, target_type, target_id)
    VALUES ('黎明教育', ?, ?, ?, ?, ?, ?)
  `).run(
    text(operator.display_name),
    text(operator.username),
    text(operation_type),
    text(operation_content),
    text(target_type),
    text(target_id),
  );
}

function auditedPatchTable(req, actor, table, idField, idValue, allowedFields, data, entityType = table) {
  const before = get(`SELECT * FROM ${table} WHERE ${idField} = ?`, [idValue]);
  patchTable(table, idField, idValue, allowedFields, data);
  const after = get(`SELECT * FROM ${table} WHERE ${idField} = ?`, [idValue]);
  recordAuditEvent(req, actor, { action: "update", entity_type: entityType, entity_id: String(idValue), before, after });
  return after;
}

function auditedDelete(req, actor, table, idField, idValue, entityType = table) {
  const before = get(`SELECT * FROM ${table} WHERE ${idField} = ?`, [idValue]);
  const result = db.prepare(`DELETE FROM ${table} WHERE ${idField} = ?`).run(idValue);
  recordAuditEvent(req, actor, { action: "delete", entity_type: entityType, entity_id: String(idValue), before, after: { deleted: (result.changes || 0) > 0 } });
  return result;
}

function normalizedOpeningBalancePayload(body) {
  const studentName = text(body.student_name);
  if (!studentName) return { error: "学生姓名不能为空", status: 400 };
  const profile = get("SELECT grade FROM students WHERE name = ?", [studentName]);
  const payload = {
    month_key: text(body.month_key),
    student_name: studentName,
    grade: text(body.grade) || text(profile?.grade),
    opening_actual_balance: num(body.opening_actual_balance),
    opening_gift_balance: num(body.opening_gift_balance),
    notes: text(body.notes),
  };
  if (Math.abs(payload.opening_actual_balance) > 100000) return { error: "期初现金余额超出合理范围", status: 400 };
  if (Math.abs(payload.opening_gift_balance) > 100000) return { error: "期初赠送余额超出合理范围", status: 400 };
  return { payload };
}

function createOpeningBalance(body) {
  const normalized = normalizedOpeningBalancePayload(body);
  if (normalized.error) return normalized;
  const payload = normalized.payload;
  if (payload.opening_actual_balance === 0 && payload.opening_gift_balance === 0) {
    return { error: "期初现金余额和期初赠送余额不能同时为 0", status: 400 };
  }
  if (get("SELECT id FROM student_opening_balances WHERE student_name = ?", [payload.student_name])) {
    return { error: "该学生已有期初余额", status: 409 };
  }
  const result = db.prepare(`
    INSERT INTO student_opening_balances(
      month_key, student_name, grade, opening_actual_balance, opening_gift_balance, notes
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    payload.month_key,
    payload.student_name,
    payload.grade,
    payload.opening_actual_balance,
    payload.opening_gift_balance,
    payload.notes,
  );
  upsertStudent(payload.student_name, payload.grade);
  return { ok: true, id: result.lastInsertRowid, row: get("SELECT * FROM student_opening_balances WHERE id = ?", [result.lastInsertRowid]) };
}

function updateOpeningBalance(id, body) {
  const before = get("SELECT * FROM student_opening_balances WHERE id = ?", [id]);
  if (!before) return { error: "未找到期初余额记录", status: 404 };
  const normalized = normalizedOpeningBalancePayload({ ...before, ...body });
  if (normalized.error) return normalized;
  const payload = normalized.payload;
  if (payload.opening_actual_balance === 0 && payload.opening_gift_balance === 0) {
    db.prepare("DELETE FROM student_opening_balances WHERE id = ?").run(id);
    return { ok: true, deleted: true, before };
  }
  const duplicate = get("SELECT id FROM student_opening_balances WHERE student_name = ? AND id <> ?", [payload.student_name, id]);
  if (duplicate) return { error: "该学生已有期初余额", status: 409 };
  db.prepare(`
    UPDATE student_opening_balances
    SET month_key = ?,
        student_name = ?,
        grade = ?,
        opening_actual_balance = ?,
        opening_gift_balance = ?,
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    payload.month_key,
    payload.student_name,
    payload.grade,
    payload.opening_actual_balance,
    payload.opening_gift_balance,
    payload.notes,
    id,
  );
  upsertStudent(payload.student_name, payload.grade);
  return { ok: true, row: get("SELECT * FROM student_opening_balances WHERE id = ?", [id]), before };
}

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name || row.username,
    role: row.role,
    role_label: USER_ROLES[row.role] || row.role,
    teacher_name: row.teacher_name || "",
  };
}

function currentUser(req) {
  const sid = parseCookies(req).liming_session;
  const session = sid ? sessions.get(sid) : null;
  if (!session || session.expires_at < Date.now()) {
    if (sid) sessions.delete(sid);
    return null;
  }
  const row = get("SELECT * FROM users WHERE id = ? AND status = 'active'", [session.user_id]);
  if (!row) {
    sessions.delete(sid);
    return null;
  }
  return publicUser(row);
}

function setSessionCookie(res, sid) {
  const secure = secureCookies ? "; Secure" : "";
  res.setHeader("set-cookie", `liming_session=${encodeURIComponent(sid)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`);
}

function clearSessionCookie(res) {
  const secure = secureCookies ? "; Secure" : "";
  res.setHeader("set-cookie", `liming_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function loginUser(username, password) {
  const row = get("SELECT * FROM users WHERE username = ? AND status = 'active'", [text(username)]);
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return row;
}

function actorCanManageUser(actor, targetRole = "") {
  if (!actor) return false;
  if (actor.role === "owner") return true;
  if (actor.role === "admin") return targetRole !== "owner";
  if (actor.role === "academic") return targetRole === "teacher";
  return false;
}

function userRows(actor) {
  const rows = all(`
    SELECT id, username, display_name, role, teacher_name, status, created_at, updated_at
    FROM users
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'academic' THEN 2 WHEN 'finance' THEN 3 ELSE 4 END, display_name, username
  `);
  return actor.role === "academic" ? rows.filter((row) => row.role === "teacher") : rows;
}

function ensureValidUserRole(role) {
  const value = text(role || "teacher");
  return Object.prototype.hasOwnProperty.call(USER_ROLES, value) ? value : "";
}

function createUser(actor, body) {
  const role = ensureValidUserRole(body.role);
  if (!role) return { error: "role is invalid", status: 400 };
  if (!actorCanManageUser(actor, role)) return { error: "当前角色不能任命该权限", status: 403 };
  const username = text(body.username);
  const displayName = text(body.display_name) || username;
  const teacherName = role === "teacher" ? text(body.teacher_name || displayName) : text(body.teacher_name);
  const password = String(body.password || "123456");
  if (!username || password.length < 6) return { error: "username and password(>=6) are required", status: 400 };
  if (get("SELECT id FROM users WHERE username = ?", [username])) return { error: "username already exists", status: 409 };
  if (role === "teacher") upsertTeacherProfileFromAccount(teacherName, username);
  const result = db.prepare(`
    INSERT INTO users(username, display_name, role, teacher_name, password_hash, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(username, displayName, role, teacherName, passwordHash(password), text(body.status || "active"));
  return publicUser(get("SELECT * FROM users WHERE id = ?", [Number(result.lastInsertRowid)]));
}

function patchUser(actor, id, body) {
  const current = get("SELECT * FROM users WHERE id = ?", [Number(id)]);
  if (!current) return { error: "user not found", status: 404 };
  const nextRole = Object.prototype.hasOwnProperty.call(body, "role") ? ensureValidUserRole(body.role) : current.role;
  if (!nextRole) return { error: "role is invalid", status: 400 };
  if (!actorCanManageUser(actor, current.role) || !actorCanManageUser(actor, nextRole)) {
    return { error: "当前角色不能修改该账号权限", status: 403 };
  }
  if (Number(actor.id) === Number(id) && text(body.status) && text(body.status) !== "active") {
    return { error: "不能停用当前登录账号", status: 400 };
  }
  const payload = {};
  for (const field of ["username", "display_name", "role", "teacher_name", "status"]) {
    if (Object.prototype.hasOwnProperty.call(body, field)) payload[field] = text(body[field]);
  }
  if (payload.role === "teacher" || (!payload.role && nextRole === "teacher")) {
    payload.teacher_name ||= text(body.teacher_name || current.teacher_name || payload.display_name || current.display_name);
    upsertTeacherProfileFromAccount(payload.teacher_name, payload.username || current.username);
  }
  payload.updated_at = new Date().toISOString();
  patchTable("users", "id", Number(id), ["username", "display_name", "role", "teacher_name", "status", "updated_at"], payload);
  return publicUser(get("SELECT * FROM users WHERE id = ?", [Number(id)]));
}

function resetUserPassword(actor, id, password) {
  const current = get("SELECT * FROM users WHERE id = ?", [Number(id)]);
  if (!current) return { error: "user not found", status: 404 };
  if (!actorCanManageUser(actor, current.role)) return { error: "当前角色不能重置该账号密码", status: 403 };
  const next = String(password || "");
  if (next.length < 6) return { error: "password must be at least 6 chars", status: 400 };
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash(next), new Date().toISOString(), Number(id));
  return { ok: true };
}

function changeOwnPassword(user, currentPassword, nextPassword) {
  const row = get("SELECT * FROM users WHERE id = ? AND status = 'active'", [Number(user.id)]);
  if (!row || !verifyPassword(currentPassword, row.password_hash)) return { error: "当前密码不正确", status: 400 };
  const next = String(nextPassword || "");
  if (next.length < 6) return { error: "新密码至少 6 位", status: 400 };
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash(next), new Date().toISOString(), Number(user.id));
  return { ok: true };
}

function teacherTemplateRows() {
  const templatePath = path.join(dataDir, "templates", "teacher_template.xlsx");
  if (!fs.existsSync(templatePath)) return [];
  const buffer = fs.readFileSync(templatePath);
  const entries = unzipXlsx(buffer);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8"));
  const rows = [];
  for (const sheet of workbookSheets(entries)) {
    const sheetXmlText = entries.get(sheet.path)?.toString("utf8");
    if (!sheetXmlText) continue;
    let nameColumn = 0;
    let phoneColumn = 1;
    for (const [, rowTag, rowXml] of sheetXmlText.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const sourceRow = Number(xmlAttr(rowTag, "r"));
      const values = [];
      const normalizedRowXml = rowXml.replace(/<c\b([^>]*)\/>/g, "<c$1></c>");
      for (const [, cellTag, cellXml] of normalizedRowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const column = cellColumnIndex(xmlAttr(cellTag, "r"));
        if (column >= 0) values[column] = cellValue(cellTag, cellXml, sharedStrings);
      }
      if (sourceRow === 1) {
        const nameIndex = values.findIndex((value) => /教师姓名|姓名/.test(text(value)));
        const phoneIndex = values.findIndex((value) => /手机号|电话|手机/.test(text(value)));
        if (nameIndex >= 0) nameColumn = nameIndex;
        if (phoneIndex >= 0) phoneColumn = phoneIndex;
        continue;
      }
      const name = text(values[nameColumn]);
      const phone = text(values[phoneColumn]).replace(/\D/g, "");
      if (name && phone) rows.push({ name, phone, sheet: sheet.name, source_row: sourceRow });
    }
  }
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.phone || row.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function importTeacherUsersFromTemplate(actor, options = {}) {
  if (!actorCanManageUser(actor, "teacher")) return { error: "当前角色不能创建老师账号", status: 403 };
  const resetPassword = options.reset_password === true;
  const rows = teacherTemplateRows();
  const backup = backupDb("pre_teacher_accounts");
  let created = 0;
  let updated = 0;
  const accounts = [];
  for (const row of rows) {
    upsertTeacherProfileFromAccount(row.name, row.phone);
    const username = row.phone;
    const initialPassword = row.phone.slice(-6);
    const existing = get("SELECT * FROM users WHERE username = ?", [username]);
    if (existing) {
      const payload = {
        display_name: row.name,
        role: "teacher",
        teacher_name: row.name,
        status: "active",
        updated_at: new Date().toISOString(),
      };
      if (resetPassword) payload.password_hash = passwordHash(initialPassword);
      patchTable("users", "id", existing.id, ["display_name", "role", "teacher_name", "status", "updated_at", "password_hash"], payload);
      updated += 1;
    } else {
      db.prepare(`
        INSERT INTO users(username, display_name, role, teacher_name, password_hash, status)
        VALUES (?, ?, 'teacher', ?, ?, 'active')
      `).run(username, row.name, row.name, passwordHash(initialPassword));
      created += 1;
    }
    accounts.push({ username, display_name: row.name, teacher_name: row.name, initial_password: initialPassword });
  }
  return { ok: true, created, updated, total: rows.length, accounts, backup };
}

function roleCan(user, area, action = "read") {
  if (!user) return false;
  if (user.role === "owner") return true;
  if (user.role === "admin") return true;
  const grants = {
    academic: new Set(["schedule", "students", "profiles", "pricing", "teacherTransport", "users"]),
    finance: new Set(["finance", "expenses", "recharges", "studentBilling", "students"]),
    teacher: new Set(["teacherSelf", "scheduleRead"]),
  };
  if (user.role === "academic") return grants.academic.has(area) && area !== "audit";
  if (user.role === "finance") {
    if (action !== "read" && !["expenses", "recharges"].includes(area)) return false;
    return grants.finance.has(area);
  }
  if (user.role === "teacher") {
    if (action !== "read" && area !== "teacherSelf") return false;
    return grants.teacher.has(area);
  }
  return false;
}

function apiArea(req, url) {
  const p = url.pathname;
  if (p.startsWith("/api/users")) return "users";
  if (p === "/api/export/core-workbook.xlsx") return "coreExport";
  if (p.startsWith("/api/export/finance") || p === "/api/finance-summary") return "finance";
  if (p === "/api/teacher-adjustments") return "teacherTransport";
  if (p.includes("teacher-salary")) return "teacherSalary";
  if (p.startsWith("/api/operating-expenses")) return "expenses";
  if (p.startsWith("/api/staff")) return "staff";
  if (p.startsWith("/api/reconcile")) return "audit";
  if (p.startsWith("/api/audit") || p === "/api/source-workbooks" || p === "/api/import/source-workbook") return "audit";
  if (p === "/api/recharges" || p === "/api/recharges/rollover") return "recharges";
  if (p.startsWith("/api/opening-balances")) return "students";
  if (p.includes("/statement") || p.includes("student-statement")) return "studentBilling";
  if (p.includes("pricing")) return "pricing";
  if (p.includes("student") || p === "/api/fee-overrides") return "students";
  if (p.startsWith("/api/course-notice") || p.startsWith("/api/teacher-course-notice")) return "schedule";
  if (p.includes("lessons") || p.includes("months") || p.includes("schedule-conflicts") || p === "/api/settings") return "schedule";
  if (p.startsWith("/api/teachers")) return "profiles";
  return "schedule";
}

function authorizeApi(user, req, url) {
  const area = apiArea(req, url);
  const method = req.method;
  if (method === "GET" && ["/api/bootstrap", "/api/months"].includes(url.pathname)) return true;
  if (user.role === "owner" || user.role === "admin") return true;
  if (user.role === "teacher") {
    return method === "GET" && (area === "schedule" || area === "profiles");
  }
  if (user.role === "finance") return roleCan(user, area, method === "GET" ? "read" : "write");
  if (["finance", "teacherSalary", "staff", "expenses", "audit", "coreExport"].includes(area)) return false;
  return roleCan(user, area, method === "GET" ? "read" : "write");
}

function sanitizeLessonRows(rows, user) {
  let output = rows || [];
  if (user.role === "teacher") {
    output = output.filter((row) => text(row.teacher_name) === text(user.teacher_name));
  }
  if (user.role === "owner" || user.role === "admin") return output;
  return output.map((row) => ({
    ...row,
    teacher_salary: 0,
    teacher_salary_source: "",
    teacher_salary_rule_id: null,
  }));
}

function sanitizeBootstrap(data, user) {
  if (user.role === "owner" || user.role === "admin") return { ...data, user };
  const sanitized = {
    ...data,
    user,
    lessons: sanitizeLessonRows(data.lessons, user),
    teachers: user.role === "teacher" && user.teacher_name
      ? [{ id: null, name: user.teacher_name, active_this_month: true }]
      : data.teachers,
    recharges: user.role === "teacher" ? [] : data.recharges,
    opening_balances: user.role === "teacher" ? [] : data.opening_balances,
    student_pricing: user.role === "teacher" ? [] : data.student_pricing,
    derived: {
      ...data.derived,
      teacher_summary: user.role === "academic"
        ? (data.derived.teacher_summary || []).map((row) => ({
          ...row,
          salary_total: 0,
          total_salary: num(row.week1_transport) + num(row.week2_transport) + num(row.week3_transport) + num(row.week4_transport),
        }))
        : [],
    },
  };
  if (user.role === "teacher") {
    sanitized.derived = {
      ...sanitized.derived,
      fee_details: [],
      student_summary: [],
      student_summary_to_date: [],
    };
  }
  return sanitized;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function readRawBody(req, limit = 50_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    req.on("data", (chunk) => {
      length += chunk.length;
      if (length > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(req, body) {
  const contentType = req.headers["content-type"] || "";
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error("multipart boundary is required");
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const parts = {};
  let cursor = body.indexOf(boundary);
  while (cursor !== -1) {
    let start = cursor + boundary.length;
    if (body.slice(start, start + 2).toString() === "--") break;
    if (body.slice(start, start + 2).toString() === "\r\n") start += 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), start);
    if (headerEnd === -1) break;
    const headers = body.slice(start, headerEnd).toString("utf8");
    const next = body.indexOf(boundary, headerEnd + 4);
    if (next === -1) break;
    let contentEnd = next;
    if (body.slice(contentEnd - 2, contentEnd).toString() === "\r\n") contentEnd -= 2;
    const content = body.slice(headerEnd + 4, contentEnd);
    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || "";
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/)?.[1] || "";
    if (name) parts[name] = { filename, content, headers };
    cursor = next;
  }
  return parts;
}

function backupDb(prefix = "pre_audit") {
  const backupDir = path.join(dataDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  let target = path.join(backupDir, `${prefix}_${stamp}.sqlite`);
  let suffix = 1;
  while (fs.existsSync(target)) {
    target = path.join(backupDir, `${prefix}_${stamp}_${suffix}.sqlite`);
    suffix += 1;
  }
  db.exec("PRAGMA wal_checkpoint(FULL)");
  fs.copyFileSync(dbPath, target);
  return target;
}

function recentAuditLogs(limit = 200) {
  return all(`
    SELECT *
    FROM audit_logs
    WHERE id IN (
      SELECT MAX(id)
      FROM audit_logs
      GROUP BY COALESCE(
        NULLIF(issue_key, ''),
        COALESCE(source, '') || '|' || COALESCE(severity, '') || '|' || COALESCE(entity, '') || '|' ||
        COALESCE(field, '') || '|' || COALESCE(before_value, '') || '|' || COALESCE(after_value, '') || '|' ||
        COALESCE(notes, '')
      )
    )
    ORDER BY run_at DESC, id DESC
    LIMIT ?
  `, [limit]);
}

function canonicalStudents(value) {
  return [...new Set(splitStudents(value))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).join("、");
}

function addXlsxIssue(issues, issue) {
  issues.push({
    source: issue.source || "xlsx",
    severity: issue.severity || "WARN",
    type: issue.type || "",
    entity: issue.entity || "",
    field: issue.field || "",
    xlsx_value: text(issue.xlsx_value),
    db_value: text(issue.db_value),
    lesson_id: issue.lesson_id || null,
    xlsx_row: issue.xlsx_row || null,
    message: issue.message || "",
    patch: issue.patch || null,
    data: issue.data || {},
  });
}

function xlsxLessonKey(row) {
  return [text(row.date), text(row.teacher_name), text(row.time_slot)].join("\u0001");
}

function xlsxLessonSalaryPreserveKey(row) {
  return [
    text(row.date),
    text(row.teacher_name),
    text(row.time_slot),
    text(row.classroom),
    text(row.grade),
    text(row.subject),
    normalizedStudents(row.student_names),
  ].join("\u0001");
}

function compareXlsxLessons(monthKey, xlsxRows, options = {}) {
  const issues = [];
  const dbRows = all("SELECT * FROM lessons WHERE month_key = ?", [monthKey]);
  const dbByKey = new Map();
  for (const row of dbRows) {
    const key = xlsxLessonKey(row);
    if (!dbByKey.has(key)) dbByKey.set(key, []);
    dbByKey.get(key).push(row);
  }
  const sourceKeyCounts = new Map();
  for (const row of xlsxRows) {
    const key = xlsxLessonKey(row);
    sourceKeyCounts.set(key, (sourceKeyCounts.get(key) || 0) + 1);
  }
  const sourceDuplicateCount = [...sourceKeyCounts.values()].filter((count) => count > 1).length;
  const dbDuplicateCount = [...dbByKey.values()].filter((rows) => rows.length > 1).length;
  const matchedDbIds = new Set();
  const xlsxKeys = new Set();
  const stats = {
    month: monthKey.slice(0, 7),
    sourceCourseCount: xlsxRows.length,
    dbCourseCountBefore: options.dbCourseCountBefore ?? dbRows.length,
    dbCourseCountAfter: options.dbCourseCountAfter ?? dbRows.length,
    matched: 0,
    sourceOnly: 0,
    internalOnly: 0,
    changed: 0,
    unchanged: 0,
    skipped: 0,
    duplicates: 0,
    sourceDuplicateGroups: sourceDuplicateCount,
    dbDuplicateGroups: dbDuplicateCount,
  };
  for (const xrow of xlsxRows) {
    const key = xlsxLessonKey(xrow);
    xlsxKeys.add(key);
    if (!text(xrow.date) || !text(xrow.teacher_name) || !text(xrow.time_slot)) {
      stats.skipped += 1;
    }
    const matches = dbByKey.get(key) || [];
    if (!matches.length) {
      stats.sourceOnly += 1;
      addXlsxIssue(issues, {
        severity: "HIGH",
        type: "source-only",
        entity: `xlsx_row_${xrow.source_row}`,
        field: "lesson",
        xlsx_value: `${xrow.date} ${xrow.teacher_name} ${xrow.time_slot}`,
        db_value: "数据库缺失",
        xlsx_row: xrow.source_row,
        message: "xlsx 中存在课程，但数据库未找到 date+teacher+time_slot 完全匹配的记录",
        patch: { type: "insert_lesson", lesson: { ...xrow, month_key: monthKey } },
      });
      continue;
    }
    if (matches.length > 1) {
      stats.duplicates += 1;
      addXlsxIssue(issues, {
        severity: "HIGH",
        type: "duplicate",
        entity: `xlsx_row_${xrow.source_row}`,
        field: "lesson",
        xlsx_value: `${xrow.date} ${xrow.teacher_name} ${xrow.time_slot}`,
        db_value: `匹配到 ${matches.length} 条数据库记录`,
        xlsx_row: xrow.source_row,
        message: "数据库存在重复三元组，无法唯一定位课程",
      });
      continue;
    }
    const dbRow = matches[0];
    matchedDbIds.add(dbRow.id);
    stats.matched += 1;
    let changed = false;
    for (const field of ["teacher_name", "date", "lesson_status", "time_slot", "classroom", "grade", "subject", "notes", "course_status"]) {
      const xval = text(xrow[field]);
      const dval = text(dbRow[field]);
      if (xval !== dval) {
        changed = true;
        const severity = {
          teacher_name: "CRITICAL",
          date: "HIGH",
          lesson_status: "MEDIUM",
          time_slot: "HIGH",
          classroom: "HIGH",
          grade: "CRITICAL",
          subject: "CRITICAL",
          notes: "LOW",
          course_status: "MEDIUM",
        }[field] || "WARN";
        addXlsxIssue(issues, {
          severity,
          type: "changed",
          entity: `lesson_${dbRow.id}`,
          field,
          xlsx_value: xval,
          db_value: dval,
          lesson_id: dbRow.id,
          xlsx_row: xrow.source_row,
          patch: { type: "lesson", id: dbRow.id, [field]: xval },
        });
      }
    }
    const xSalary = moneyRound(num(xrow.teacher_salary));
    const dbSalary = moneyRound(num(dbRow.teacher_salary));
    if (xrow.teacher_salary_present && xSalary !== dbSalary) {
      changed = true;
      addXlsxIssue(issues, {
        severity: "MEDIUM",
        type: "changed",
        entity: `lesson_${dbRow.id}`,
        field: "teacher_salary",
        xlsx_value: xSalary,
        db_value: dbSalary,
        lesson_id: dbRow.id,
        xlsx_row: xrow.source_row,
        message: "教师薪资与 xlsx 权威源不一致",
        patch: { type: "lesson", id: dbRow.id, teacher_salary: xSalary },
      });
    }
    const xstudents = canonicalStudents(xrow.student_names);
    const dstudents = canonicalStudents(dbRow.student_names);
    if (xstudents !== dstudents) {
      changed = true;
      addXlsxIssue(issues, {
        severity: "CRITICAL",
        type: "changed",
        entity: `lesson_${dbRow.id}`,
        field: "student_names",
        xlsx_value: xstudents,
        db_value: dstudents,
        lesson_id: dbRow.id,
        xlsx_row: xrow.source_row,
        message: "学生名单成员不一致，已按去空白、去重、排序后比较",
        patch: { type: "lesson", id: dbRow.id, student_names: xrow.student_names },
      });
    }
    const dbCount = splitStudents(dbRow.student_names).length;
    if (xrow.student_count !== dbCount) {
      changed = true;
      addXlsxIssue(issues, {
        severity: "CRITICAL",
        type: "changed",
        entity: `lesson_${dbRow.id}`,
        field: "student_count",
        xlsx_value: xrow.student_count,
        db_value: dbCount,
        lesson_id: dbRow.id,
        xlsx_row: xrow.source_row,
        message: "学生人数由学生名单拆分后计算",
      });
    }
    if (changed) stats.changed += 1;
    else stats.unchanged += 1;
  }
  const internalOnlyRows = [];
  for (const dbRow of dbRows) {
    const key = xlsxLessonKey(dbRow);
    if (!matchedDbIds.has(dbRow.id) && !xlsxKeys.has(key)) {
      stats.internalOnly += 1;
      internalOnlyRows.push(dbRow);
      addXlsxIssue(issues, {
        severity: "HIGH",
        type: "internal-only",
        entity: `lesson_${dbRow.id}`,
        field: "lesson",
        xlsx_value: "xlsx 无对应课程",
        db_value: `${dbRow.date || ""} ${dbRow.teacher_name || ""} ${dbRow.time_slot || ""}`,
        lesson_id: dbRow.id,
        message: "系统中存在，但源文件中不存在；不会自动删除，请人工确认是否为内部多余课程",
        data: {
          id: dbRow.id,
          teacher_name: dbRow.teacher_name,
          date: dbRow.date,
          time_slot: dbRow.time_slot,
          classroom: dbRow.classroom,
          grade: dbRow.grade,
          subject: dbRow.subject,
          student_names: dbRow.student_names,
          course_status: dbRow.course_status,
          created_at: dbRow.created_at,
          updated_at: dbRow.updated_at,
        },
      });
    }
  }
  console.info(`[reconcile][course records][summary] ${JSON.stringify(stats)}`);
  for (const row of internalOnlyRows) {
    console.info(`[reconcile][course records][internal-only] ${JSON.stringify({
      courseId: row.id,
      student: row.student_names || "",
      teacher: row.teacher_name || "",
      date: row.date || "",
      time: row.time_slot || "",
      subject: row.subject || "",
      classroom: row.classroom || "",
      grade: row.grade || "",
      courseStatus: row.course_status || "",
      teacherSalary: row.teacher_salary || 0,
      createdAt: row.created_at || "",
      updatedAt: row.updated_at || "",
      reason: "exists in DB but no matching source row",
    })}`);
  }
  return { issues, summary: stats };
}

function lessonCleanupSummary(row) {
  return {
    id: Number(row.id),
    lessonId: Number(row.id),
    date: row.date || "",
    student: row.student_names || "",
    student_names: row.student_names || "",
    teacher: row.teacher_name || "",
    teacher_name: row.teacher_name || "",
    time_slot: row.time_slot || "",
    subject: row.subject || "",
    classroom: row.classroom || "",
    grade: row.grade || "",
    lesson_status: row.lesson_status || "",
    course_status: row.course_status || "",
    teacher_salary: num(row.teacher_salary),
    amount: num(row.teacher_salary),
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
  };
}

function sourceRowsForInternalOnly(monthKey, filename = "") {
  const sourcePath = filename ? safeSourceWorkbookPath(filename) : sourceWorkbookPathByMonth(monthKey);
  if (!sourcePath) throw new Error(`未找到 ${monthKey.slice(0, 7)} 对应的源工作簿`);
  const { sheet_name: sheetName, rows } = readXlsxTotalSheet(fs.readFileSync(sourcePath), monthKey);
  return { sourcePath, sheetName, rows };
}

function currentInternalOnlyLessons(monthKey, sourceRows) {
  const dbRows = all("SELECT * FROM lessons WHERE month_key = ? ORDER BY date, time_slot, teacher_name, classroom, sort_order, id", [monthKey]);
  const dbByKey = new Map();
  for (const row of dbRows) {
    const key = xlsxLessonKey(row);
    if (!dbByKey.has(key)) dbByKey.set(key, []);
    dbByKey.get(key).push(row);
  }
  const matchedDbIds = new Set();
  const xlsxKeys = new Set();
  for (const xrow of sourceRows) {
    const key = xlsxLessonKey(xrow);
    xlsxKeys.add(key);
    const matches = dbByKey.get(key) || [];
    if (matches.length === 1) matchedDbIds.add(matches[0].id);
  }
  return dbRows.filter((row) => {
    const key = xlsxLessonKey(row);
    return !matchedDbIds.has(row.id) && !xlsxKeys.has(key);
  });
}

function internalOnlyLessonPreview(body = {}) {
  const monthKey = normalizeExportMonthKey(body.month || body.month_key);
  if (!monthKey) return { error: "month must be YYYY-MM or YYYY-MM-01", status: 400 };
  const filename = text(body.filename || body.sourceWorkbookId || body.source_workbook || "");
  const source = sourceRowsForInternalOnly(monthKey, filename);
  const lessons = currentInternalOnlyLessons(monthKey, source.rows).map(lessonCleanupSummary);
  console.info(`[reconcile][internal-only][preview] ${JSON.stringify({
    month: monthKey.slice(0, 7),
    count: lessons.length,
    lessonIds: lessons.map((row) => `lesson_${row.id}`).join(","),
    sourceWorkbook: path.basename(source.sourcePath),
  })}`);
  return {
    month_key: monthKey,
    source_file: path.basename(source.sourcePath),
    sheet_name: source.sheetName,
    internalOnlyCount: lessons.length,
    lessons,
    warning: lessons.length
      ? "这些课程存在于系统数据库中，但不在当前月份源文件中。确认后将只按课程 ID 删除 lessons 表记录。"
      : "当前没有系统多余课程。",
    canApply: lessons.length > 0,
  };
}

function rejectInternalOnlyApply(reason, status, details = {}) {
  console.warn(`[reconcile][internal-only][apply][reject] ${JSON.stringify({ reason, ...details })}`);
  return { error: reason, status, ...details };
}

function applyInternalOnlyLessonCleanup(req, user, body = {}) {
  const monthKey = normalizeExportMonthKey(body.month || body.month_key);
  const rawLessonIds = Array.isArray(body.lessonIds) ? body.lessonIds : body.lesson_ids;
  const lessonIds = [...new Set((Array.isArray(rawLessonIds) ? rawLessonIds : []).map(Number).filter(Boolean))];
  const expectedCount = body.expectedCount == null ? null : Number(body.expectedCount);
  const filename = text(body.filename || body.sourceWorkbookId || body.source_workbook || "");
  if (!monthKey) return rejectInternalOnlyApply("month must be YYYY-MM or YYYY-MM-01", 400, { month: text(body.month || body.month_key) });
  if (body.confirm !== true) return rejectInternalOnlyApply("confirm must be true", 400, { month: monthKey, lessonIds });
  if (!lessonIds.length) return rejectInternalOnlyApply("lessonIds must not be empty", 400, { month: monthKey, lessonIds });

  const source = sourceRowsForInternalOnly(monthKey, filename);
  const internalOnlyRows = currentInternalOnlyLessons(monthKey, source.rows);
  const internalOnlyIds = new Set(internalOnlyRows.map((row) => Number(row.id)));
  const currentCount = internalOnlyRows.length;
  console.info(`[reconcile][internal-only][apply][before] ${JSON.stringify({
    month: monthKey.slice(0, 7),
    expectedCount,
    currentCount,
    lessonIds: lessonIds.map((id) => `lesson_${id}`).join(","),
    sourceWorkbook: path.basename(source.sourcePath),
  })}`);

  if (expectedCount != null && expectedCount !== currentCount) {
    return rejectInternalOnlyApply("系统多余课程数量已变化，请重新对账后再处理", 409, {
      month: monthKey,
      expectedCount,
      currentCount,
      lessonIds,
    });
  }
  const requestedRows = lessonIds.map((id) => get("SELECT * FROM lessons WHERE id = ?", [id]));
  const missingIds = lessonIds.filter((id, index) => !requestedRows[index]);
  if (missingIds.length) return rejectInternalOnlyApply("部分课程已不存在，请重新对账", 409, { month: monthKey, lessonIds, missingIds });
  const wrongMonthIds = requestedRows.filter((row) => row && row.month_key !== monthKey).map((row) => Number(row.id));
  if (wrongMonthIds.length) return rejectInternalOnlyApply("部分课程不属于当前月份，拒绝删除", 400, { month: monthKey, lessonIds, wrongMonthIds });
  const notInternalOnlyIds = lessonIds.filter((id) => !internalOnlyIds.has(id));
  if (notInternalOnlyIds.length) {
    return rejectInternalOnlyApply("部分课程当前不再是系统多余课程，请重新对账", 409, {
      month: monthKey,
      lessonIds,
      notInternalOnlyIds,
    });
  }

  const deleteRows = internalOnlyRows.filter((row) => lessonIds.includes(Number(row.id)));
  const backup = backupDb("pre_internal_only_cleanup");
  const result = withTransaction(() => {
    const deletedLessons = [];
    for (const row of deleteRows) {
      const before = get("SELECT * FROM lessons WHERE id = ? AND month_key = ?", [Number(row.id), monthKey]);
      if (!before) throw new Error(`课程 ${row.id} 已不存在或不属于 ${monthKey}`);
      const deleted = db.prepare("DELETE FROM lessons WHERE id = ? AND month_key = ?").run(Number(row.id), monthKey);
      if (deleted.changes !== 1) throw new Error(`课程 ${row.id} 删除失败`);
      deletedLessons.push(lessonCleanupSummary(before));
    }
    recordAuditEvent(req, user, {
      action: "delete-internal-only-lessons",
      entity_type: "lessons",
      entity_id: monthKey,
      before: deletedLessons,
      after: {
        month_key: monthKey,
        source_file: path.basename(source.sourcePath),
        deletedCount: deletedLessons.length,
        deletedLessonIds: deletedLessons.map((row) => row.id),
      },
    });
    writeOperationLog(user, {
      operation_type: "清理系统多余课程",
      operation_content: `${monthKey.slice(0, 7)} 删除 ${deletedLessons.length} 条源文件不存在课程：${deletedLessons.map((row) => `#${row.id}`).join("、")}`,
      target_type: "lessons",
      target_id: monthKey,
    });
    return { deletedLessons };
  });
  console.info(`[reconcile][internal-only][apply][after] ${JSON.stringify({
    month: monthKey.slice(0, 7),
    deletedCount: result.deletedLessons.length,
    deletedLessonIds: result.deletedLessons.map((row) => `lesson_${row.id}`).join(","),
    sourceWorkbook: path.basename(source.sourcePath),
  })}`);
  const audit = runNodeXlsxAudit(source.sourcePath, monthKey, {
    dbCourseCountBefore: countByMonth("lessons", monthKey) + result.deletedLessons.length,
    dbCourseCountAfter: countByMonth("lessons", monthKey),
  });
  return {
    ok: true,
    month_key: monthKey,
    source_file: path.basename(source.sourcePath),
    deletedCount: result.deletedLessons.length,
    deletedLessons: result.deletedLessons,
    backup,
    audit,
  };
}

function xlsxStudentCrossChecks(xlsxRows) {
  const issues = [];
  const appearances = new Map();
  for (const row of xlsxRows) {
    for (const student of splitStudents(row.student_names)) {
      if (!appearances.has(student)) appearances.set(student, []);
      appearances.get(student).push({ row_idx: row.source_row, grade: row.grade, subject: row.subject, count: row.student_count });
    }
  }
  const students = new Map(all("SELECT * FROM students").map((row) => [row.name, row]));
  const pricingByStudent = new Map();
  for (const row of all("SELECT * FROM student_pricing")) {
    if (!pricingByStudent.has(row.student_name)) pricingByStudent.set(row.student_name, []);
    pricingByStudent.get(row.student_name).push(row);
  }
  for (const [student, rows] of appearances.entries()) {
    const gradeRows = rows.filter((row) => row.grade);
    const grades = new Set(gradeRows.map((row) => row.grade));
    if (grades.size > 1) {
      addXlsxIssue(issues, {
        source: "student_cross",
        severity: "CRITICAL",
        entity: `student_${student}`,
        field: "grade",
        xlsx_value: gradeRows.map((row) => `${row.grade}@row${row.row_idx}`).join("; "),
        db_value: students.get(student)?.grade || "",
        message: "同一学生在 xlsx 本月课程中出现多个年级",
      });
    }
    const latestGrade = [...gradeRows].reverse().find((row) => row.grade)?.grade || "";
    const dbGrade = text(students.get(student)?.grade);
    if (latestGrade && dbGrade && latestGrade !== dbGrade) {
      addXlsxIssue(issues, {
        source: "student_cross",
        severity: "CRITICAL",
        entity: `student_${student}`,
        field: "student_grade",
        xlsx_value: latestGrade,
        db_value: dbGrade,
        message: "students 表年级与 xlsx 最新出现年级不一致",
        patch: { type: "student", name: student, grade: latestGrade },
      });
    }
    for (const pricing of pricingByStudent.get(student) || []) {
      const match = [...rows].reverse().find((row) => row.subject === pricing.subject && row.grade);
      if (!match) continue;
      const std = standardPrice(match.grade, match.count);
      const custom = num(pricing.custom_price);
      if (std > 0 && Math.abs(custom - std) / std > 0.5) {
        addXlsxIssue(issues, {
          source: "student_cross",
          severity: "WARN",
          entity: `pricing_${pricing.id}`,
          field: "custom_price",
          xlsx_value: `标准价 ${std}`,
          db_value: custom,
          message: `${student}-${pricing.subject} 学生单价规则与按 ${match.grade}/${match.count} 人计算的标准价差额超过 50%`,
        });
      }
    }
  }
  return issues;
}

function runNodeXlsxAudit(uploadPath, monthKey, options = {}) {
  if (!validMonthKey(monthKey)) throw new Error("month must be YYYY-MM-01");
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const { sheet_name: sheetName, rows } = readXlsxTotalSheet(fs.readFileSync(uploadPath), monthKey, { log: true });
  const lessonCompare = compareXlsxLessons(monthKey, rows, {
    dbCourseCountBefore: options.dbCourseCountBefore ?? countByMonth("lessons", monthKey),
    dbCourseCountAfter: options.dbCourseCountAfter ?? countByMonth("lessons", monthKey),
  });
  const issues = visibleAuditIssues([
    ...lessonCompare.issues,
    ...xlsxStudentCrossChecks(rows),
  ], "xlsx");
  const report = {
    run_id: runId,
    month_key: monthKey,
    source_file: path.resolve(uploadPath),
    sheet_name: sheetName,
    scanned_lessons: rows.length,
    reconcile: lessonCompare.summary,
    issue_count: issues.length,
    counts: severityCounts(issues),
    issues,
  };
  recordAuditIssues(runId, issues, "xlsx");
  return report;
}

function runXlsxAuditFromUpload(req, url) {
  const monthKey = resolveMonthKey(url);
  const body = spawnSafeReadRaw(req);
  return body.then((raw) => {
    const parts = parseMultipart(req, raw);
    const file = parts.file || parts.xlsx || Object.values(parts).find((part) => part.filename);
    if (!file || !file.content?.length) throw new Error("请先选择 xlsx 文件");
    const uploadDir = path.join(dataDir, "uploads");
    fs.mkdirSync(uploadDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const uploadPath = path.join(uploadDir, `audit_${monthKey}_${stamp}.xlsx`);
    fs.writeFileSync(uploadPath, file.content);
    return runNodeXlsxAudit(uploadPath, monthKey);
  });
}

function sourceWorkbookDir() {
  return path.join(dataDir, "source-workbooks");
}

function safeSourceWorkbookPath(filename) {
  const base = path.basename(text(filename));
  if (!base || base !== text(filename) || !base.toLowerCase().endsWith(".xlsx")) {
    throw new Error("请选择 data/source-workbooks 下的 xlsx 文件");
  }
  const fullPath = path.resolve(sourceWorkbookDir(), base);
  const root = path.resolve(sourceWorkbookDir());
  if (!fullPath.startsWith(root + path.sep)) throw new Error("source workbook path is outside data/source-workbooks");
  if (!fs.existsSync(fullPath)) throw new Error(`未找到源工作簿：${base}`);
  return fullPath;
}

function sourceWorkbooks() {
  const dir = sourceWorkbookDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((filename) => filename.toLowerCase().endsWith(".xlsx") && !filename.startsWith("~$"))
    .map((filename) => {
      const fullPath = path.join(dir, filename);
      const stat = fs.statSync(fullPath);
      return {
        filename,
        month_key: monthKeyFromFilename(filename),
        size: stat.size,
        updated_at: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => text(b.month_key).localeCompare(text(a.month_key)) || a.filename.localeCompare(b.filename, "zh-Hans-CN"));
}

function upsertRechargeFromWorkbook(row, monthKey, sourceLabel) {
  const studentName = text(row.values[0]);
  if (!studentName) return false;
  const grade = text(row.values[1]);
  const curRecharge = num(row.values[4]);
  const curGift = num(row.values[5]);
  if (curRecharge === 0 && curGift === 0) return false;
  db.prepare(`
    INSERT INTO recharge_records(
      student_name, grade, prev_actual, prev_gift, cur_recharge, cur_gift,
      recharge_date, notes, source, month_key
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_name, month_key) DO UPDATE SET
      grade = COALESCE(NULLIF(excluded.grade, ''), recharge_records.grade),
      prev_actual = excluded.prev_actual,
      prev_gift = excluded.prev_gift,
      cur_recharge = excluded.cur_recharge,
      cur_gift = excluded.cur_gift,
      recharge_date = excluded.recharge_date,
      notes = excluded.notes,
      source = excluded.source
  `).run(
    studentName,
    grade,
    num(row.values[2]),
    num(row.values[3]),
    curRecharge,
    curGift,
    isoDateValue(row.values[6]),
    text(row.values[7]),
    sourceLabel,
    monthKey,
  );
  upsertStudent(studentName, grade);
  return true;
}

function importRechargesFromWorkbook(buffer, monthKey, sourceLabel, replace = true) {
  const sheet = readXlsxSheetRows(buffer, "充值记录");
  if (replace && sheet.rows.length) db.prepare("DELETE FROM recharge_records WHERE month_key = ?").run(monthKey);
  let count = 0;
  for (const row of sheet.rows.filter((item) => item.source_row >= 3)) {
    if (upsertRechargeFromWorkbook(row, monthKey, sourceLabel)) count += 1;
  }
  return count;
}

function sourceFeeRowCountsForBilling(lessonStatus, courseStatus) {
  if (lessonStatus === "试课" || lessonStatus === "考试" || lessonStatus === "请假") return false;
  if (courseStatus === "已上" || courseStatus === "未缴费") return true;
  return lessonStatus === "上课（未缴费）";
}

function findLessonForFeeOverride(row, monthKey) {
  const studentName = text(row.values[0]);
  const date = isoDateValue(row.values[2]);
  const teacherName = text(row.values[1]);
  const timeSlot = text(row.values[5]);
  const classroom = text(row.values[6]);
  const grade = text(row.values[7]);
  const subject = text(row.values[8]);
  if (!studentName || !date || !teacherName || !timeSlot) return null;
  const lessonMonthKey = monthKeyFromDate(date) || monthKey;
  const candidates = all(`
    SELECT id, student_names
    FROM lessons
    WHERE month_key = ?
      AND date = ?
      AND teacher_name = ?
      AND time_slot = ?
      AND classroom = ?
      AND grade = ?
      AND subject = ?
    ORDER BY sort_order, id
  `, [lessonMonthKey, date, teacherName, timeSlot, classroom, grade, subject]);
  return candidates.find((lesson) => splitStudents(lesson.student_names).includes(studentName)) || null;
}

function importFeeOverridesFromWorkbook(buffer, monthKey) {
  const sheet = readXlsxSheetRows(buffer, "学生费用明细");
  let count = 0;
  let unmatched = 0;
  const upsert = db.prepare(`
    INSERT INTO fee_overrides(lesson_id, student_name, unit_price, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(lesson_id, student_name) DO UPDATE SET
      unit_price = excluded.unit_price,
      updated_at = CURRENT_TIMESTAMP
  `);
  for (const row of sheet.rows.filter((item) => item.source_row >= 3)) {
    const studentName = text(row.values[0]);
    const hasFeeCell = row.values[10] != null && row.values[10] !== "";
    if (!studentName || !hasFeeCell) continue;
    if (!sourceFeeRowCountsForBilling(text(row.values[3]), text(row.values[11]))) continue;
    const lesson = findLessonForFeeOverride(row, monthKey);
    if (!lesson) {
      unmatched += 1;
      continue;
    }
    upsert.run(lesson.id, studentName, num(row.values[10]));
    count += 1;
  }
  return { count, unmatched };
}

function importStudentPricingFromWorkbook(buffer) {
  const sheet = readXlsxSheetRows(buffer, "学生单价表");
  let count = 0;
  for (const row of sheet.rows.filter((item) => item.source_row >= 3)) {
    let studentName = text(row.values[0]);
    let subject = text(row.values[1]);
    const helper = text(row.values[7]);
    if ((!studentName || !subject) && helper.includes("|")) {
      const [helperName, helperSubject] = helper.split("|", 2);
      studentName = studentName || text(helperName);
      subject = subject || text(helperSubject);
    }
    if (!studentName || !subject || row.values[2] == null || row.values[2] === "") continue;
    db.prepare(`
      INSERT INTO student_pricing(student_name, grade, subject, student_names, custom_price, notes)
      VALUES (?, '', ?, '', ?, ?)
      ON CONFLICT(student_name, grade, subject, student_names) DO UPDATE SET
        custom_price = excluded.custom_price,
        notes = excluded.notes
    `).run(studentName, subject, num(row.values[2]), text(row.values[5]));
    count += 1;
  }
  return count;
}

function importPricingStandardsFromWorkbook(buffer) {
  const sheet = readXlsxSheetRows(buffer, "费用标准");
  let count = 0;
  for (const row of sheet.rows.filter((item) => item.source_row >= 3)) {
    const grade = text(row.values[0]);
    const studentCount = Math.trunc(num(row.values[1]));
    if (!grade || !studentCount || row.values[2] == null || row.values[2] === "") continue;
    db.prepare(`
      INSERT INTO pricing_standards(grade, student_count, unit_price, description)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(grade, student_count) DO UPDATE SET
        unit_price = excluded.unit_price,
        description = excluded.description
    `).run(grade, studentCount, num(row.values[2]), text(row.values[4]));
    count += 1;
  }
  return count;
}

function validTeacherName(value) {
  const name = text(value);
  if (!name || name === "合计" || name.startsWith("#")) return "";
  if (/^\d{1,2}\.\d{1,2}[-－~～]\d{1,2}\.\d{1,2}$/.test(name)) return "";
  if (/^\d+月/.test(name) || /学生费用汇总$/.test(name)) return "";
  return name;
}

function teacherSalaryHeaderMap(sheet) {
  const header = sheet.rows.find((row) => row.source_row === 2)
    || sheet.rows.find((row) => row.values.some((value) => /教师.*姓名|老师.*姓名/.test(text(value))));
  const labels = header?.values || [];
  const teacherNameColumn = labels.findIndex((value) => /教师.*姓名|老师.*姓名/.test(text(value)));
  if (teacherNameColumn < 0) {
    throw new Error(`教师薪资汇总未找到「教师姓名」表头。当前表头：${labels.map(text).filter(Boolean).join("、") || "空"}`);
  }
  const transportColumns = labels
    .map((value, index) => ({ label: text(value), index }))
    .filter((item) => /(车票|交通|补贴)/.test(item.label) && !/(合计|总计|小计|薪资|工资)/.test(item.label))
    .map((item) => item.index);
  const notesColumn = labels.findIndex((value) => /备注/.test(text(value)));
  const salaryTotalColumn = labels.findIndex((value) => /(薪资|工资).*合计|合计.*(薪资|工资)/.test(text(value)));
  return {
    header_row: header?.source_row || 0,
    labels,
    teacher_name_column: teacherNameColumn,
    transport_columns: transportColumns.length ? transportColumns : [3, 4, 5, 6],
    notes_column: notesColumn,
    salary_total_column: salaryTotalColumn,
  };
}

function teacherSalaryTransportValues(row, headerMap) {
  const values = headerMap.transport_columns.map((column) => num(row.values[column]));
  return [
    values[0] || 0,
    values[1] || 0,
    values[2] || 0,
    values.slice(3).reduce((sum, value) => moneyRound(sum + num(value)), 0),
  ];
}

function teacherSalaryRowKind(rawTeacherName) {
  const normalized = text(rawTeacherName).replace(/\s+/g, "");
  if (["合计", "总计", "小计", "汇总"].includes(normalized)) return "summary";
  if (/^(备注|说明|注[:：]?)/.test(normalized)) return "note";
  return "";
}

function cellRefParts(ref) {
  const letters = String(ref || "").match(/[A-Z]+/i)?.[0] || "";
  const row = Number(String(ref || "").match(/\d+/)?.[0] || 0);
  return { column: cellColumnIndex(letters), row };
}

function mergeInfoForCell(mergeCells, row, column) {
  for (const range of mergeCells || []) {
    const [startRef, endRef] = String(range).split(":");
    if (!endRef) continue;
    const start = cellRefParts(startRef);
    const end = cellRefParts(endRef);
    if (row >= start.row && row <= end.row && column >= start.column && column <= end.column) {
      return {
        range,
        source_cell: startRef,
        is_continuation: row !== start.row || column !== start.column,
      };
    }
  }
  return null;
}

function teacherSalaryRowDebug(sheet, row, headerMap, options = {}) {
  const rawTeacherName = text(row.values[headerMap.teacher_name_column]);
  const normalizedTeacherName = validTeacherName(rawTeacherName);
  const transports = teacherSalaryTransportValues(row, headerMap);
  const notes = headerMap.notes_column >= 0 ? text(row.values[headerMap.notes_column]) : "";
  const rowKind = teacherSalaryRowKind(rawTeacherName);
  const mergeInfo = mergeInfoForCell(sheet.merge_cells, row.source_row, headerMap.teacher_name_column);
  const matched = normalizedTeacherName
    ? get("SELECT id, name FROM teachers WHERE name = ?", [normalizedTeacherName])
    : null;
  const hasDataReasons = [];
  headerMap.transport_columns.forEach((column, index) => {
    if (num(row.values[column])) hasDataReasons.push(`${columnName(column)}${row.source_row}=transport${index + 1}:${num(row.values[column])}`);
  });
  if (notes) hasDataReasons.push(`${columnName(headerMap.notes_column)}${row.source_row}=notes`);
  return {
    file: options.filename || "",
    month: options.month_key || "",
    sheet: sheet.sheet_name,
    sheetHidden: sheet.sheet_state && sheet.sheet_state !== "visible",
    range: sheet.dimension,
    excelRow: row.source_row,
    rowHidden: row.hidden,
    nonEmptyCells: row.cells.map((cell) => ({
      column: columnName(cell.column),
      address: cell.address,
      value: cell.value,
      formula: cell.formula,
      type: cell.type,
      style: cell.style,
    })),
    expectedTeacherNameColumn: columnName(headerMap.teacher_name_column),
    rawTeacherName,
    normalizedTeacherName,
    matchedTeacherId: matched?.id || "",
    matchedTeacherName: matched?.name || "",
    hasDataReason: hasDataReasons.join("; ") || "no transport/notes data",
    isSummaryRow: rowKind === "summary",
    isNoteRow: rowKind === "note",
    isMergedContinuation: !!mergeInfo?.is_continuation,
    mergedSourceCell: mergeInfo?.source_cell || "",
    inheritedTeacherName: "",
    headerMap: {
      headerRow: headerMap.header_row,
      teacherNameColumn: columnName(headerMap.teacher_name_column),
      transportColumns: headerMap.transport_columns.map(columnName),
      salaryTotalColumn: headerMap.salary_total_column >= 0 ? columnName(headerMap.salary_total_column) : "",
      notesColumn: headerMap.notes_column >= 0 ? columnName(headerMap.notes_column) : "",
    },
  };
}

function logTeacherSalarySheetSnapshot(label, sheet, headerMap, options = {}) {
  const rows = sheet.rows
    .filter((row) => row.source_row >= 18 && row.source_row <= 26)
    .map((row) => teacherSalaryRowDebug(sheet, row, headerMap, options));
  console.info(`[source import][teacher salary][${label}] ${JSON.stringify({
    file: options.filename || "",
    month: options.month_key || "",
    sheet: sheet.sheet_name,
    sheetHidden: sheet.sheet_state && sheet.sheet_state !== "visible",
    range: sheet.dimension,
    mergeCells: sheet.merge_cells,
    headerMap: rows[0]?.headerMap || {
      headerRow: headerMap.header_row,
      teacherNameColumn: columnName(headerMap.teacher_name_column),
      transportColumns: headerMap.transport_columns.map(columnName),
      salaryTotalColumn: headerMap.salary_total_column >= 0 ? columnName(headerMap.salary_total_column) : "",
      notesColumn: headerMap.notes_column >= 0 ? columnName(headerMap.notes_column) : "",
    },
    rows,
  })}`);
}

function sourceWorkbookPathByMonth(monthKey) {
  const workbook = sourceWorkbooks().find((item) => item.month_key === monthKey);
  return workbook ? path.join(sourceWorkbookDir(), workbook.filename) : "";
}

function logTeacherSalaryPreviousMonthCompare(monthKey) {
  const previousMonth = previousMonthKey(monthKey);
  const previousPath = previousMonth ? sourceWorkbookPathByMonth(previousMonth) : "";
  if (!previousPath) return;
  try {
    const previousSheet = readXlsxSheetRowsDetailed(fs.readFileSync(previousPath), "教师薪资汇总");
    const previousHeaderMap = teacherSalaryHeaderMap(previousSheet);
    logTeacherSalarySheetSnapshot("compare", previousSheet, previousHeaderMap, {
      filename: path.basename(previousPath),
      month_key: previousMonth,
    });
  } catch (error) {
    console.warn(`[source import][teacher salary][compare] failed: ${error.message}`);
  }
}

function importTeacherAdjustmentsFromWorkbook(buffer, monthKey, replace = true, options = {}) {
  const sheet = readXlsxSheetRowsDetailed(buffer, "教师薪资汇总");
  const headerMap = teacherSalaryHeaderMap(sheet);
  logTeacherSalarySheetSnapshot("debug", sheet, headerMap, { filename: options.filename || "", month_key: monthKey });
  logTeacherSalaryPreviousMonthCompare(monthKey);
  if (headerMap.transport_columns.length > 4) {
    console.warn(`[source import][teacher salary][debug] ${JSON.stringify({
      file: options.filename || "",
      month: monthKey,
      sheet: sheet.sheet_name,
      message: "教师薪资汇总包含超过4个车票/交通补贴列；由于系统当前仅有4个周车票字段，第4列及之后会合并写入第四周车票。",
      transportColumns: headerMap.transport_columns.map(columnName),
    })}`);
  }
  if (replace) db.prepare("DELETE FROM teacher_adjustments_monthly WHERE month_key = ?").run(monthKey);
  let count = 0;
  for (const row of sheet.rows.filter((item) => item.source_row >= 3)) {
    const rawTeacherName = text(row.values[headerMap.teacher_name_column]);
    const rowKind = teacherSalaryRowKind(rawTeacherName);
    if (rowKind === "summary" || rowKind === "note") continue;
    const teacherName = validTeacherName(rawTeacherName);
    const transports = teacherSalaryTransportValues(row, headerMap);
    const notes = headerMap.notes_column >= 0 ? text(row.values[headerMap.notes_column]) : "";
    if (!teacherName) {
      if (!transports.some(Boolean) && !notes) continue;
      const debug = teacherSalaryRowDebug(sheet, row, headerMap, { filename: options.filename || "", month_key: monthKey });
      console.error(`[source import][teacher salary][error] ${JSON.stringify({ ...debug, errorLocation: "importTeacherAdjustmentsFromWorkbook" })}`);
      throw new Error(
        `教师薪资汇总第 ${row.source_row} 行有车票/备注数据，但教师姓名为空或不是有效姓名。`
        + ` 教师姓名列=${columnName(headerMap.teacher_name_column)}，有数据依据=${debug.hasDataReason}。`,
      );
    }
    if (!transports.some(Boolean) && !notes) continue;
    upsertTeacher(teacherName);
    db.prepare(`
      INSERT INTO teacher_adjustments_monthly(
        teacher_name, month_key, week1_transport, week2_transport, week3_transport, week4_transport, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(teacher_name, month_key) DO UPDATE SET
        week1_transport = excluded.week1_transport,
        week2_transport = excluded.week2_transport,
        week3_transport = excluded.week3_transport,
        week4_transport = excluded.week4_transport,
        notes = excluded.notes
    `).run(teacherName, monthKey, transports[0], transports[1], transports[2], transports[3], notes);
    count += 1;
  }
  return count;
}

function importLessonsFromWorkbook(buffer, monthKey, replace = true) {
  const { sheet_name: sheetName, rows } = readXlsxTotalRowsForImport(buffer, monthKey);
  const existingByKey = new Map();
  const existingBySalaryPreserveKey = new Map();
  for (const row of all("SELECT * FROM lessons WHERE month_key = ?", [monthKey])) {
    const key = xlsxLessonKey(row);
    if (!existingByKey.has(key)) existingByKey.set(key, []);
    existingByKey.get(key).push(row);
    const salaryPreserveKey = xlsxLessonSalaryPreserveKey(row);
    if (!existingBySalaryPreserveKey.has(salaryPreserveKey)) existingBySalaryPreserveKey.set(salaryPreserveKey, []);
    existingBySalaryPreserveKey.get(salaryPreserveKey).push(row);
  }
  if (replace) {
    const seen = new Set();
    const deleteByDate = db.prepare("DELETE FROM lessons WHERE date = ? AND month_key = ?");
    for (const row of rows) {
      if (!row.date) continue;
      const key = `${row.date}|${row.month_key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deleteByDate.run(row.date, row.month_key);
    }
    if (!seen.size) db.prepare("DELETE FROM lessons WHERE month_key = ?").run(monthKey);
  }
  let count = 0;
  for (const row of rows) {
    upsertTeacher(row.teacher_name);
    for (const name of splitStudents(row.student_names)) upsertStudent(name, row.grade);
    const lessonData = { ...row };
    if (row.teacher_salary_present) {
      lessonData.teacher_salary_source = "import";
      lessonData.teacher_salary_rule_id = null;
    } else {
      const exactMatches = existingBySalaryPreserveKey.get(xlsxLessonSalaryPreserveKey(row)) || [];
      const existingMatches = exactMatches.length === 1 ? exactMatches : (existingByKey.get(xlsxLessonKey(row)) || []);
      const existing = existingMatches.length === 1 ? existingMatches[0] : null;
      const existingSalary = optionalNumber(existing?.teacher_salary);
      if (existing && existingSalary !== null) {
        lessonData.teacher_salary = existingSalary;
        lessonData.teacher_salary_present = true;
        lessonData.teacher_salary_source = text(existing.teacher_salary_source) || "legacy";
        lessonData.teacher_salary_rule_id = optionalNumber(existing.teacher_salary_rule_id);
      } else {
        lessonData.teacher_salary = null;
        lessonData.teacher_salary_present = false;
        lessonData.teacher_salary_source = "empty";
        lessonData.teacher_salary_rule_id = null;
      }
    }
    insertLesson({
      ...lessonData,
      month_key: lessonData.month_key,
      sort_order: lessonData.source_row,
    }, { autoTeacherSalary: false, explicitSource: "import" });
    count += 1;
  }
  return { sheet_name: sheetName, lessons: count, rows };
}

function importSourceWorkbook(filename, monthKey = "", options = {}) {
  const sourcePath = safeSourceWorkbookPath(filename);
  const resolvedMonthKey = text(monthKey) || monthKeyFromFilename(sourcePath);
  if (!validMonthKey(resolvedMonthKey)) throw new Error("month_key must be YYYY-MM-01");
  const buffer = fs.readFileSync(sourcePath);
  const sourceLabel = `source-workbook:${path.basename(sourcePath)}`;
  const dbLessonCountBefore = countByMonth("lessons", resolvedMonthKey);
  const backup = backupDb("pre_import");
  const summary = withTransaction(() => {
    setSetting("month_key", resolvedMonthKey);
    const lessonResult = importLessonsFromWorkbook(buffer, resolvedMonthKey, options.append !== true);
    const recharges = importRechargesFromWorkbook(buffer, resolvedMonthKey, sourceLabel, options.append !== true);
    const feeOverrides = importFeeOverridesFromWorkbook(buffer, resolvedMonthKey);
    const studentPrices = importStudentPricingFromWorkbook(buffer);
    const standards = importPricingStandardsFromWorkbook(buffer);
    const teacherAdjustments = options.skip_teacher_adjustments
      ? 0
      : importTeacherAdjustmentsFromWorkbook(buffer, resolvedMonthKey, options.append !== true, { filename: path.basename(sourcePath) });
    const carryOver = refreshCarryOverAfter(resolvedMonthKey);
    return {
      source_file: sourcePath,
      month_key: resolvedMonthKey,
      backup,
      sheet_name: lessonResult.sheet_name,
      lessons: lessonResult.lessons,
      recharges,
      fee_overrides: feeOverrides.count,
      fee_override_unmatched: feeOverrides.unmatched,
      student_prices: studentPrices,
      pricing_standards: standards,
      teacher_adjustments: teacherAdjustments,
      carry_over: carryOver,
    };
  });
  const dbLessonCountAfter = countByMonth("lessons", resolvedMonthKey);
  const audit = runNodeXlsxAudit(sourcePath, resolvedMonthKey, {
    dbCourseCountBefore: dbLessonCountBefore,
    dbCourseCountAfter: dbLessonCountAfter,
  });
  console.info(`[source import][course records][summary] ${JSON.stringify({
    file: path.basename(sourcePath),
    month: resolvedMonthKey.slice(0, 7),
    sourceCourseCount: audit.scanned_lessons,
    parsedCourseCount: summary.lessons,
    dbCourseCountBefore: dbLessonCountBefore,
    dbCourseCountAfter: dbLessonCountAfter,
    reconcile: audit.reconcile,
  })}`);
  return { ...summary, audit };
}

function spawnSafeReadRaw(req) {
  return readRawBody(req, 10_000_000);
}

function timeTokenToMinutes(value) {
  const raw = text(value).replaceAll("：", ":");
  const match = raw.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function parseTimeRange(value) {
  const raw = text(value)
    .replaceAll("：", ":")
    .replace(/[—–－~～至到]/g, "-")
    .replace(/\s+/g, "");
  if (!raw) return null;
  const parts = raw.split("-").filter(Boolean);
  let start = null;
  let end = null;
  if (parts.length >= 2) {
    start = timeTokenToMinutes(parts[0]);
    end = timeTokenToMinutes(parts[1]);
  } else {
    const tokens = [...raw.matchAll(/\d{1,2}:?\d{0,2}/g)].map((item) => item[0]);
    if (tokens.length >= 2) {
      start = timeTokenToMinutes(tokens[0]);
      end = timeTokenToMinutes(tokens[1]);
    }
  }
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

function isScheduleActive(row) {
  const lessonStatus = text(row.lesson_status);
  const courseStatus = text(row.course_status);
  if (lessonStatus === "休息") return false;
  if (courseStatus.startsWith("暂停")) return false;
  return deriveStatus(row) !== "请假";
}

function lessonScheduleLabel(row) {
  const students = splitStudents(row.student_names).join("、") || "未填学生";
  return `${row.date || "未填日期"} ${weekdayCn(row.date)} ${row.time_slot || "未填时间"} ${row.teacher_name || "未填老师"} ${row.classroom || "未填教室"} ${row.grade || ""}${row.subject || ""} ${students}`;
}

function conflictLessonDetail(row) {
  return {
    id: row.id,
    date: row.date || "",
    weekday: weekdayCn(row.date),
    time_slot: row.time_slot || "",
    teacher_name: row.teacher_name || "",
    classroom: row.classroom || "",
    grade: row.grade || "",
    subject: row.subject || "",
    student_names: row.student_names || "",
    status: deriveStatus(row),
    notes: row.notes || "",
  };
}

function normalizeRoom(value) {
  return text(value);
}

function isVirtualRoomOne(value) {
  const room = normalizeRoom(value);
  return room === "1" || room === "1.0";
}

function scheduleConflicts(monthKey, options = {}) {
  if (!validMonthKey(monthKey)) throw new Error("month must be YYYY-MM-01");
  const lessons = all(
    "SELECT * FROM lessons WHERE month_key = ? ORDER BY date, time_slot, teacher_name, classroom, sort_order, id",
    [monthKey],
  ).filter(isScheduleActive);
  const issues = [];
  let ignored_room_one_count = 0;
  const parsed = [];
  const pushIssue = (issue) => issues.push({
    severity: issue.severity || "HIGH",
    type: issue.type,
    date: issue.date || "",
    time_slot: issue.time_slot || "",
    entity: issue.entity || "",
    lesson_ids: issue.lesson_ids || [],
    message: issue.message || "",
    lessons: issue.lessons || [],
    lesson_details: issue.lesson_details || [],
  });

  for (const lesson of lessons) {
    const range = parseTimeRange(lesson.time_slot);
    if (!lesson.date || !range) {
      pushIssue({
        severity: "MEDIUM",
        type: "invalid_time",
        date: lesson.date,
        time_slot: lesson.time_slot,
        entity: `lesson_${lesson.id}`,
        lesson_ids: [lesson.id],
        message: "课程日期或时间段无法识别，无法参与冲突判断",
        lessons: [lessonScheduleLabel(lesson)],
        lesson_details: [conflictLessonDetail(lesson)],
      });
      continue;
    }
    parsed.push({ lesson, ...range });
  }

  for (let i = 0; i < parsed.length; i += 1) {
    for (let j = i + 1; j < parsed.length; j += 1) {
      const a = parsed[i];
      const b = parsed[j];
      if (a.lesson.date !== b.lesson.date) continue;
      if (!(a.start < b.end && b.start < a.end)) continue;
      const sharedStudents = splitStudents(a.lesson.student_names)
        .filter((name) => splitStudents(b.lesson.student_names).includes(name));
      const lessonIds = [a.lesson.id, b.lesson.id];
      const lessonsText = [lessonScheduleLabel(a.lesson), lessonScheduleLabel(b.lesson)];
      const lessonDetails = [conflictLessonDetail(a.lesson), conflictLessonDetail(b.lesson)];
      if (text(a.lesson.teacher_name) && text(a.lesson.teacher_name) === text(b.lesson.teacher_name)) {
        pushIssue({
          type: "teacher",
          date: a.lesson.date,
          time_slot: `${a.lesson.time_slot} / ${b.lesson.time_slot}`,
          entity: a.lesson.teacher_name,
          lesson_ids: lessonIds,
          message: `${a.lesson.teacher_name} 在同一时间段有两节课`,
          lessons: lessonsText,
          lesson_details: lessonDetails,
        });
      }
      const roomA = normalizeRoom(a.lesson.classroom);
      const roomB = normalizeRoom(b.lesson.classroom);
      if (roomA && roomA === roomB) {
        if (options.ignoreRoomOneConflict && isVirtualRoomOne(roomA) && isVirtualRoomOne(roomB)) {
          ignored_room_one_count += 1;
        } else {
          pushIssue({
            type: "classroom",
            date: a.lesson.date,
            time_slot: `${a.lesson.time_slot} / ${b.lesson.time_slot}`,
            entity: roomA,
            lesson_ids: lessonIds,
            message: `${roomA} 在同一时间段被重复占用`,
            lessons: lessonsText,
            lesson_details: lessonDetails,
          });
        }
      }
      if (sharedStudents.length) {
        pushIssue({
          type: "student",
          date: a.lesson.date,
          time_slot: `${a.lesson.time_slot} / ${b.lesson.time_slot}`,
          entity: sharedStudents.join("、"),
          lesson_ids: lessonIds,
          message: `${sharedStudents.join("、")} 在同一时间段有重复课程`,
          lessons: lessonsText,
          lesson_details: lessonDetails,
        });
      }
    }
  }

  const counts = { teacher: 0, student: 0, classroom: 0, invalid_time: 0 };
  for (const issue of issues) counts[issue.type] = (counts[issue.type] || 0) + 1;
  return { month_key: monthKey, issue_count: issues.length, ignored_room_one_count, counts, issues };
}

function applyAuditPatch(issue) {
  const patch = issue.patch || {};
  if (patch.type === "insert_lesson" && patch.lesson) {
    if (patch.lesson.teacher_name) upsertTeacher(patch.lesson.teacher_name);
    for (const name of splitStudents(patch.lesson.student_names)) upsertStudent(name, patch.lesson.grade || "");
    insertLesson({
      ...patch.lesson,
      teacher_salary_source: patch.lesson.teacher_salary_present ? "import" : "empty",
      teacher_salary_rule_id: null,
    }, { autoTeacherSalary: false, explicitSource: "import" });
    return true;
  }
  if (patch.type === "lesson" && patch.id) {
    const allowed = [
      "teacher_name", "date", "lesson_status", "time_slot", "classroom", "grade", "subject",
      "student_names", "notes", "course_status", "status", "teacher_salary",
      "teacher_salary_source", "teacher_salary_rule_id",
    ];
    const payload = {};
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, field)) payload[field] = patch[field];
    }
    if (Object.keys(payload).length) {
      if (Object.prototype.hasOwnProperty.call(payload, "status")) Object.assign(payload, legacyStatusFields(payload.status));
      if (Object.prototype.hasOwnProperty.call(payload, "teacher_salary")) {
        payload.teacher_salary_source = "import";
        payload.teacher_salary_rule_id = null;
      }
      patchTable("lessons", "id", Number(patch.id), [...allowed, "month_key", "sort_order", "updated_at"], { ...payload, updated_at: new Date().toISOString() });
      return true;
    }
  }
  if (patch.type === "student" && patch.name) {
    db.prepare(`
      INSERT INTO students(name, grade) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET grade = excluded.grade
    `).run(text(patch.name), text(patch.grade));
    return true;
  }
  return false;
}

function applyAuditIssues(issues, confirmCritical = false) {
  const backup = backupDb();
  const result = withTransaction(() => {
    let fixed = 0;
    let skipped = 0;
    const affectedMonths = new Set();
    for (const issue of issues) {
      if (issue.severity === "CRITICAL" && !confirmCritical) {
        skipped += 1;
        continue;
      }
      const patch = issue.patch || {};
      const lesson = patch.lesson || {};
      if (lesson.month_key) affectedMonths.add(lesson.month_key);
      if (patch.id && (patch.student_names || patch.date || patch.course_status || patch.lesson_status)) {
        const row = get("SELECT month_key FROM lessons WHERE id = ?", [Number(patch.id)]);
        if (row?.month_key) affectedMonths.add(row.month_key);
      }
      if (applyAuditPatch(issue)) {
        fixed += 1;
        if (issue.audit_log_id) db.prepare("UPDATE audit_logs SET status = 'fixed' WHERE id = ?").run(Number(issue.audit_log_id));
      } else {
        skipped += 1;
      }
    }
    const carryOver = [];
    for (const monthKey of affectedMonths) {
      if (validMonthKey(monthKey)) carryOver.push(refreshCarryOverAfter(monthKey));
    }
    return { fixed, skipped, carry_over: carryOver };
  });
  return { ok: true, ...result, backup };
}

function ignoreAuditIssues(ids, issueKeys = []) {
  const backup = backupDb();
  const result = withTransaction(() => {
    let ignored = 0;
    const keys = new Set(issueKeys.map(text).filter(Boolean));
    for (const id of ids.map(Number).filter(Boolean)) {
      const log = get("SELECT * FROM audit_logs WHERE id = ?", [id]);
      if (!log) continue;
      const issueKey = text(log.issue_key) || auditLogFallbackKey(log);
      keys.add(issueKey);
      const update = db.prepare("UPDATE audit_logs SET status = 'ignored', issue_key = ? WHERE id = ?").run(issueKey, id);
      ignored += update.changes || 0;
    }
    for (const issueKey of keys) {
      const log = get("SELECT * FROM audit_logs WHERE issue_key = ? ORDER BY id DESC LIMIT 1", [issueKey]) || {};
      db.prepare(`
        INSERT INTO audit_ignores(issue_key, source, entity, field, notes)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(issue_key) DO UPDATE SET
          ignored_at = CURRENT_TIMESTAMP,
          source = excluded.source,
          entity = excluded.entity,
          field = excluded.field,
          notes = excluded.notes
      `).run(
        issueKey,
        log.source || "",
        log.entity || "",
        log.field || "",
        log.notes || "",
      );
      db.prepare("UPDATE audit_logs SET status = 'ignored' WHERE issue_key = ?").run(issueKey);
    }
    return { ignored, ignored_keys: keys.size };
  });
  return { ok: true, ...result, backup };
}

function lessonWarnings(lesson) {
  const warnings = [];
  const names = splitStudents(lesson.student_names);
  for (const studentName of names) {
    const rows = all(`
      SELECT id, grade FROM lessons
      WHERE month_key = ? AND id <> ? AND student_names LIKE ?
    `, [lesson.month_key, lesson.id || 0, `%${studentName}%`]);
    const conflicts = rows.filter((row) => text(row.grade) && text(row.grade) !== text(lesson.grade));
    if (conflicts.length) {
      warnings.push({
        type: "grade_inconsistency",
        message: `⚠ ${studentName} 在其它 ${conflicts.length} 节课中仍为 ${conflicts[0].grade}，确认变更？`,
        action: { label: "同步修正其它记录", type: "sync_lesson_grade", student_name: studentName, grade: lesson.grade },
      });
    }
  }
  return warnings;
}

function studentWarnings(studentName, grade) {
  const rows = all("SELECT id, grade FROM lessons WHERE student_names LIKE ?", [`%${studentName}%`]);
  const conflicts = rows.filter((row) => text(row.grade) && text(row.grade) !== text(grade));
  if (!conflicts.length) return [];
  return [{
    type: "grade_inconsistency",
    message: `⚠ ${studentName} 在其它 ${conflicts.length} 节课中仍为 ${conflicts[0].grade}，确认变更？`,
  }];
}

function pricingWarnings({ student_name, subject, custom_price, notes }) {
  const warnings = [];
  const rows = monthLessonStudents(getSetting("month_key"))
    .filter((item) => item.studentName === student_name && item.lesson.subject === subject);
  const latest = rows[rows.length - 1];
  if (latest) {
    const std = standardPrice(latest.lesson.grade, latest.student_count);
    const custom = num(custom_price);
    if (std > 0 && Math.abs(custom - std) / std > 0.5 && !text(notes)) {
      warnings.push({
        type: "price_outlier",
        message: "⚠ 学生单价规则与标准价差额较大，建议在备注里说明原因",
      });
    }
  }
  return warnings;
}

function patchTable(table, idField, idValue, allowedFields, data) {
  const fields = Object.keys(data).filter((field) => allowedFields.includes(field));
  if (!fields.length) return;
  const assignments = fields.map((field) => `${field} = ?`).join(", ");
  const params = fields.map((field) => data[field]);
  db.prepare(`UPDATE ${table} SET ${assignments} WHERE ${idField} = ?`).run(...params, idValue);
}

function insertLesson(data, options = {}) {
  const monthKey = data.month_key || getSetting("month_key");
  const status = deriveStatus(data);
  const legacy = legacyStatusFields(status);
  const salary = resolvedTeacherSalaryForLesson(data, options);
  const result = db.prepare(`
    INSERT INTO lessons(
      teacher_name, date, lesson_status, time_slot, classroom, grade, subject,
      student_names, notes, course_status, status, teacher_salary, teacher_salary_source,
      teacher_salary_rule_id, month_key, sort_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    text(data.teacher_name),
    text(data.date || monthKey),
    text(data.lesson_status || legacy.lesson_status),
    text(data.time_slot),
    text(data.classroom),
    text(data.grade),
    text(data.subject),
    text(data.student_names),
    text(data.notes),
    text(data.course_status || legacy.course_status),
    status,
    salary.teacher_salary,
    salary.teacher_salary_source,
    salary.teacher_salary_rule_id,
    text(monthKey),
    num(data.sort_order),
  );
  const lesson = get("SELECT * FROM lessons WHERE id = ?", [Number(result.lastInsertRowid)]);
  return salary.warning ? { ...lesson, teacher_salary_warning: salary.warning } : lesson;
}

function copyLessons(body) {
  const resetStatus = body.reset_status !== false;
  const pairs = Array.isArray(body.pairs)
    ? body.pairs.map((pair) => ({
      source_id: Number(pair.source_id || pair.id || pair.source_lesson_id),
      target_date: text(pair.target_date || pair.date),
    })).filter((pair) => pair.source_id && validDateKey(pair.target_date))
    : [];
  let copyPairs = pairs;
  if (!copyPairs.length) {
    const sourceIds = Array.isArray(body.source_lesson_ids) ? body.source_lesson_ids.map(Number).filter(Boolean) : [];
    const targetDates = Array.isArray(body.target_dates) ? body.target_dates.map(text).filter(validDateKey) : [];
    copyPairs = sourceIds.flatMap((sourceId) => targetDates.map((targetDate) => ({ source_id: sourceId, target_date: targetDate })));
  }
  if (!copyPairs.length) return { error: "source_lesson_ids and target_dates required", status: 400 };
  if (copyPairs.length > 200) return { error: "single copy capped at 200 rows", status: 400 };

  return withTransaction(() => {
    const created = [];
    const nextOrderByDate = new Map();
    for (const pair of copyPairs) {
      const src = get("SELECT * FROM lessons WHERE id = ?", [pair.source_id]);
      if (!src || pair.target_date === src.date) continue;
      if (!nextOrderByDate.has(pair.target_date)) {
        const maxOrder = num(get(
          "SELECT COALESCE(MAX(sort_order), 0) AS m FROM lessons WHERE date = ?",
          [pair.target_date],
        )?.m);
        nextOrderByDate.set(pair.target_date, maxOrder + 1);
      }
      const sortOrder = nextOrderByDate.get(pair.target_date);
      nextOrderByDate.set(pair.target_date, sortOrder + 1);
      created.push(insertLesson({
        teacher_name: src.teacher_name,
        date: pair.target_date,
        lesson_status: resetStatus ? "上课" : src.lesson_status,
        time_slot: src.time_slot,
        classroom: src.classroom,
        grade: src.grade,
        subject: src.subject,
        student_names: src.student_names,
        notes: src.notes || "",
        course_status: resetStatus ? "未上" : src.course_status,
        status: resetStatus ? "待上" : src.status,
        month_key: monthKeyFromDate(pair.target_date),
        sort_order: sortOrder,
      }));
    }
    return { created: created.length, lessons: created };
  });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    return sendJson(res, { user: currentUser(req), roles: USER_ROLES });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const row = loginUser(body.username, body.password);
    if (!row) return sendError(res, 401, "用户名或密码错误");
    const sid = crypto.randomBytes(32).toString("hex");
    sessions.set(sid, { user_id: row.id, expires_at: Date.now() + 7 * 86400000 });
    setSessionCookie(res, sid);
    return sendJson(res, { user: publicUser(row) });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const sid = parseCookies(req).liming_session;
    if (sid) sessions.delete(sid);
    clearSessionCookie(res);
    return sendJson(res, { ok: true });
  }
  const user = currentUser(req);
  if (!user) return sendError(res, 401, "请先登录");
  if (req.method === "POST" && url.pathname === "/api/auth/change-password") {
    const body = await readBody(req);
    const result = changeOwnPassword(user, body.current_password, body.new_password);
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "change_password", entity_type: "users", entity_id: String(user.id), before: null, after: { id: user.id, username: user.username } });
    return sendJson(res, result);
  }
  if (!authorizeApi(user, req, url)) return sendError(res, 403, "当前角色无权访问此功能");
  if (req.method !== "GET") clearDerivedCache(`${req.method} ${url.pathname}`);

  if (req.method === "GET" && url.pathname === "/api/teacher-salary-rules") {
    return sendJson(res, { rules: teacherSalaryRules() });
  }
  if (req.method === "POST" && url.pathname === "/api/teacher-salary-rules") {
    const body = await readBody(req);
    const rule = createTeacherSalaryRule(body);
    if (rule.error) return sendError(res, rule.status || 400, rule.error);
    recordAuditEvent(req, user, { action: "create", entity_type: "teacher_salary_rules", entity_id: String(rule.id), before: null, after: rule });
    writeOperationLog(user, {
      operation_type: "新增教师薪资规则",
      operation_content: `${rule.teacher_name} ${rule.grade} ${rule.subject} ${rule.student_names} ${rule.salary_per_unit}/${rule.unit_hours}小时`,
      target_type: "teacher_salary_rules",
      target_id: String(rule.id),
    });
    return sendJson(res, rule, 201);
  }
  if (req.method === "POST" && url.pathname === "/api/teacher-salary-rules/sync-candidates") {
    const result = syncTeacherSalaryRuleCandidatesFromLessons();
    recordAuditEvent(req, user, {
      action: "sync_candidates",
      entity_type: "teacher_salary_rules",
      entity_id: "lessons",
      before: null,
      after: result,
    });
    writeOperationLog(user, {
      operation_type: "同步教师薪资规则候选",
      operation_content: `扫描 ${result.scannedLessonCount} 节历史课，新增 ${result.createdCount} 条，已有 ${result.existingCount} 条，跳过 ${result.skippedCount} 条`,
      target_type: "teacher_salary_rules",
      target_id: result.createdRules.map((row) => row.id).join(","),
    });
    return sendJson(res, result);
  }
  if (req.method === "POST" && url.pathname === "/api/teacher-salary-rules/apply-selected") {
    const body = await readBody(req);
    const ids = [...new Set((body.lesson_ids || []).map(Number).filter(Boolean))];
    const before = ids.length
      ? all(`SELECT * FROM lessons WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`, ids)
      : [];
    const result = applyTeacherSalaryRulesToLessons(ids);
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, {
      action: "apply_selected",
      entity_type: "teacher_salary_rules",
      entity_id: "lessons",
      before,
      after: result,
    });
    writeOperationLog(user, {
      operation_type: "按规则更新教师薪资",
      operation_content: `所选 ${ids.length} 条，更新 ${result.updatedCount} 条，跳过 ${result.skippedCount} 条`,
      target_type: "lessons",
      target_id: result.updatedLessons.map((row) => row.id).join(","),
    });
    return sendJson(res, result);
  }
  const teacherSalaryRuleMatch = url.pathname.match(/^\/api\/teacher-salary-rules\/(\d+)$/);
  if (teacherSalaryRuleMatch && req.method === "PUT") {
    const id = Number(teacherSalaryRuleMatch[1]);
    const before = get("SELECT * FROM teacher_salary_rules WHERE id = ?", [id]);
    const rule = updateTeacherSalaryRule(id, await readBody(req));
    if (rule.error) return sendError(res, rule.status || 400, rule.error);
    recordAuditEvent(req, user, { action: "update", entity_type: "teacher_salary_rules", entity_id: String(id), before, after: rule });
    writeOperationLog(user, {
      operation_type: "修改教师薪资规则",
      operation_content: `${rule.teacher_name} ${rule.grade} ${rule.subject} ${rule.student_names} ${rule.salary_per_unit}/${rule.unit_hours}小时`,
      target_type: "teacher_salary_rules",
      target_id: String(id),
    });
    return sendJson(res, rule);
  }
  if (teacherSalaryRuleMatch && req.method === "DELETE") {
    const id = Number(teacherSalaryRuleMatch[1]);
    const before = get("SELECT * FROM teacher_salary_rules WHERE id = ?", [id]);
    const rule = deactivateTeacherSalaryRule(id);
    if (rule.error) return sendError(res, rule.status || 400, rule.error);
    recordAuditEvent(req, user, { action: "deactivate", entity_type: "teacher_salary_rules", entity_id: String(id), before, after: rule });
    writeOperationLog(user, {
      operation_type: "停用教师薪资规则",
      operation_content: `${rule.teacher_name} ${rule.grade} ${rule.subject} ${rule.student_names}`,
      target_type: "teacher_salary_rules",
      target_id: String(id),
    });
    return sendJson(res, rule);
  }

  if (req.method === "GET" && url.pathname === "/api/users") {
    return sendJson(res, { users: userRows(user), roles: USER_ROLES });
  }
  if (req.method === "POST" && url.pathname === "/api/users") {
    const result = createUser(user, await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "create", entity_type: "users", entity_id: String(result.id), before: null, after: result });
    return sendJson(res, result, 201);
  }
  if (req.method === "POST" && url.pathname === "/api/users/import-teachers-template") {
    const result = importTeacherUsersFromTemplate(user, await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "import_teacher_users", entity_type: "users", entity_id: "teacher_template", before: null, after: { created: result.created, updated: result.updated, total: result.total, backup: result.backup } });
    return sendJson(res, result);
  }
  const userMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
  if (userMatch && req.method === "PATCH") {
    const before = get("SELECT id, username, display_name, role, teacher_name, status, created_at, updated_at FROM users WHERE id = ?", [Number(userMatch[1])]);
    const result = patchUser(user, Number(userMatch[1]), await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "update", entity_type: "users", entity_id: String(userMatch[1]), before, after: result });
    return sendJson(res, result);
  }
  const userPasswordMatch = url.pathname.match(/^\/api\/users\/(\d+)\/password$/);
  if (userPasswordMatch && req.method === "POST") {
    const body = await readBody(req);
    const result = resetUserPassword(user, Number(userPasswordMatch[1]), body.password);
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "reset_password", entity_type: "users", entity_id: String(userPasswordMatch[1]), before: null, after: { ok: true } });
    return sendJson(res, result);
  }

  if (req.method === "GET" && url.pathname === "/api/months") return sendJson(res, availableMonths());
  if (req.method === "POST" && url.pathname === "/api/months") {
    const body = await readBody(req);
    const monthKey = text(body.month_key);
    if (!/^\d{4}-\d{2}-01$/.test(monthKey)) return sendError(res, 400, "month_key must be YYYY-MM-01");
    const result = createMonth(monthKey);
    writeOperationLog(user, { operation_type: "创建月份", operation_content: `月份 ${monthKey}`, target_type: "months", target_id: monthKey });
    return sendJson(res, result, result.created ? 201 : 200);
  }
  const monthMatch = url.pathname.match(/^\/api\/months\/(\d{4}-\d{2}-01)$/);
  if (monthMatch && req.method === "DELETE") {
    const monthKey = monthMatch[1];
    const result = deleteMonth(monthKey, url.searchParams.get("force") === "1");
    if (result.blocked && result.reason === "has_data") return sendJson(res, { counts: result.counts }, 409);
    if (result.blocked) return sendJson(res, { error: result.reason, counts: result.counts }, 400);
    writeOperationLog(user, { operation_type: "删除月份", operation_content: `月份 ${monthKey}${url.searchParams.get("force") === "1" ? " (强制)" : ""}`, target_type: "months", target_id: monthKey });
    return sendJson(res, result);
  }
  if (req.method === "GET" && url.pathname === "/api/operation-logs") {
    const conditions = [];
    const params = [];
    const operator = text(url.searchParams.get("operator") || "");
    const operator_account = text(url.searchParams.get("operator_account") || "");
    const operation_type = text(url.searchParams.get("operation_type") || "");
    const content = text(url.searchParams.get("content") || "");
    const start_date = text(url.searchParams.get("start_date") || "");
    const end_date = text(url.searchParams.get("end_date") || "");
    if (operator) { conditions.push("operator_name LIKE ?"); params.push(`%${operator}%`); }
    if (operator_account) { conditions.push("operator_account LIKE ?"); params.push(`%${operator_account}%`); }
    if (operation_type) { conditions.push("operation_type LIKE ?"); params.push(`%${operation_type}%`); }
    if (content) { conditions.push("operation_content LIKE ?"); params.push(`%${content}%`); }
    if (start_date) { conditions.push("created_at >= ?"); params.push(start_date); }
    if (end_date) { conditions.push("created_at <= ?"); params.push(end_date + " 23:59:59"); }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const page_size = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size")) || 10));
    const total = Number(get(`SELECT COUNT(*) AS count FROM operation_logs ${whereClause}`, params)?.count) || 0;
    const offset = (page - 1) * page_size;
    const items = all(
      `SELECT * FROM operation_logs ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, page_size, offset],
    );
    return sendJson(res, { items, total, page, page_size });
  }
  if (req.method === "GET" && url.pathname === "/api/audit/logs") {
    return sendJson(res, { logs: recentAuditLogs(Number(url.searchParams.get("limit") || 200)) });
  }
  if (req.method === "GET" && url.pathname === "/api/audit/events") {
    return sendJson(res, {
      events: all(`
        SELECT *
        FROM audit_events
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `, [Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)))]),
    });
  }
  if (req.method === "GET" && url.pathname === "/api/source-workbooks") {
    return sendJson(res, { workbooks: sourceWorkbooks() });
  }
  if (req.method === "POST" && url.pathname === "/api/import/source-workbook") {
    const body = await readBody(req);
    const result = importSourceWorkbook(body.filename, text(body.month_key) || text(url.searchParams.get("month")), {
      append: body.append === true,
      skip_teacher_adjustments: body.skip_teacher_adjustments === true,
    });
    recordAuditEvent(req, user, { action: "import", entity_type: "source_workbook", entity_id: text(body.filename), before: null, after: result });
    return sendJson(res, result);
  }
  if (req.method === "POST" && url.pathname === "/api/reconcile/internal-only-lessons/preview") {
    try {
      const result = internalOnlyLessonPreview(await readBody(req));
      if (result.error) return sendError(res, result.status || 400, result.error);
      return sendJson(res, result);
    } catch (error) {
      return sendError(res, 400, error.message || "预览系统多余课程失败");
    }
  }
  if (req.method === "POST" && url.pathname === "/api/reconcile/internal-only-lessons/apply") {
    try {
      const result = applyInternalOnlyLessonCleanup(req, user, await readBody(req));
      if (result.error) return sendError(res, result.status || 400, result.error);
      return sendJson(res, result);
    } catch (error) {
      console.error("internal-only lesson cleanup failed", error);
      return sendError(res, 500, error.message || "清理系统多余课程失败");
    }
  }
  if (req.method === "GET" && url.pathname === "/api/audit/internal-checks") {
    return sendJson(res, internalAudit(resolveMonthKey(url), { log: url.searchParams.get("log") !== "0" }));
  }
  if (req.method === "POST" && url.pathname === "/api/audit/xlsx-diff") {
    return sendJson(res, await runXlsxAuditFromUpload(req, url));
  }
  if (req.method === "POST" && url.pathname === "/api/audit/apply") {
    const body = await readBody(req);
    const result = applyAuditIssues(body.issues || [], body.confirm_critical === true);
    recordAuditEvent(req, user, { action: "audit_apply", entity_type: "audit_logs", entity_id: "batch", before: { issues: (body.issues || []).length }, after: result });
    return sendJson(res, result);
  }
  if (req.method === "POST" && url.pathname === "/api/audit/ignore") {
    const body = await readBody(req);
    return sendJson(res, ignoreAuditIssues(body.ids || [], body.issue_keys || []));
  }
  if (req.method === "GET" && url.pathname === "/api/schedule-conflicts") {
    const report = scheduleConflicts(resolveMonthKey(url), {
      ignoreRoomOneConflict: url.searchParams.get("ignore_room_one") === "1",
    });
    if (user.role === "teacher") return sendJson(res, { ...report, issue_count: 0, ignored_room_one_count: 0, counts: { teacher: 0, student: 0, classroom: 0, invalid_time: 0 }, issues: [] });
    return sendJson(res, report);
  }
  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    return sendJson(res, sanitizeBootstrap(bootstrap(resolveMonthKey(url), url.searchParams.get("include_inactive") === "1"), user));
  }
  if (req.method === "GET" && url.pathname === "/api/lessons-range") {
    const lessons = lessonsInDateRange(text(url.searchParams.get("start")), text(url.searchParams.get("end")));
    if (!lessons) return sendError(res, 400, "start/end must be YYYY-MM-DD and start must be before end");
    return sendJson(res, { lessons: sanitizeLessonRows(lessons, user) });
  }
  if (req.method === "GET" && url.pathname === "/api/course-notice") {
    const data = courseNoticeData(
      text(url.searchParams.get("start")),
      text(url.searchParams.get("end")),
      url.searchParams.get("only_teaching") === "1",
    );
    if (!data) return sendError(res, 400, "start/end must be YYYY-MM-DD and start must be before end");
    if (user.role === "teacher") {
      data.send_objects = data.send_objects.filter((item) => item.lessons.some((lesson) => text(lesson.teacher_name) === text(user.teacher_name)));
    }
    return sendJson(res, data);
  }
  if (req.method === "POST" && url.pathname === "/api/course-notice/greeting") {
    const result = saveCourseNoticeGreeting(await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    return sendJson(res, result);
  }
  if (req.method === "POST" && url.pathname === "/api/course-notice/global-tail") {
    const body = await readBody(req);
    const globalTail = text(body.global_tail) || "这是我们本周的上课安排哦[玫瑰]";
    setSetting("course_notice_global_tail", globalTail);
    db.prepare("UPDATE parent_message_greetings SET global_tail = ?, full_message = greeting || char(10) || ?, updated_at = CURRENT_TIMESTAMP WHERE send_object_key NOT LIKE 'TEACHER|%'").run(globalTail, globalTail);
    return sendJson(res, { ok: true, global_tail: globalTail });
  }
  if (req.method === "POST" && url.pathname === "/api/course-notice/complete") {
    const body = await readBody(req);
    const result = completeCourseNoticeObject(user, body);
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "complete", entity_type: "course_notice", entity_id: text(body.send_object_key), before: null, after: result });
    return sendJson(res, result);
  }
  if (req.method === "DELETE" && url.pathname === "/api/course-notice/completions") {
    const before = get("SELECT COUNT(*) AS count FROM course_notice_completion_records WHERE send_object_key NOT LIKE 'TEACHER|%'");
    const result = db.prepare("DELETE FROM course_notice_completion_records WHERE send_object_key NOT LIKE 'TEACHER|%'").run();
    recordAuditEvent(req, user, {
      action: "clear_completions",
      entity_type: "course_notice",
      entity_id: "all",
      before,
      after: { deleted: result.changes || 0 },
    });
    return sendJson(res, { ok: true, deleted: result.changes || 0 });
  }
  if (req.method === "GET" && url.pathname === "/api/teacher-course-notice") {
    const data = teacherCourseNoticeData(
      text(url.searchParams.get("start")),
      text(url.searchParams.get("end")),
      url.searchParams.get("only_teaching") === "1",
    );
    if (!data) return sendError(res, 400, "start/end must be YYYY-MM-DD and start must be before end");
    if (user.role === "teacher") {
      data.send_objects = data.send_objects.filter((item) => item.lessons.some((lesson) => text(lesson.teacher_name) === text(user.teacher_name)));
    }
    return sendJson(res, data);
  }
  if (req.method === "POST" && url.pathname === "/api/teacher-course-notice/greeting") {
    const result = saveCourseNoticeGreeting(await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    return sendJson(res, result);
  }
  if (req.method === "POST" && url.pathname === "/api/teacher-course-notice/global-tail") {
    const body = await readBody(req);
    const globalTail = text(body.global_tail) || "这是我们本周的上课安排哦[玫瑰]";
    setSetting("teacher_course_notice_global_tail", globalTail);
    db.prepare("UPDATE parent_message_greetings SET global_tail = ?, full_message = greeting || char(10) || ?, updated_at = CURRENT_TIMESTAMP WHERE send_object_key LIKE 'TEACHER|%'").run(globalTail, globalTail);
    return sendJson(res, { ok: true, global_tail: globalTail });
  }
  if (req.method === "POST" && url.pathname === "/api/teacher-course-notice/complete") {
    const body = await readBody(req);
    const result = completeCourseNoticeObject(user, body);
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "complete", entity_type: "teacher_course_notice", entity_id: text(body.send_object_key), before: null, after: result });
    return sendJson(res, result);
  }
  if (req.method === "DELETE" && url.pathname === "/api/teacher-course-notice/completions") {
    const before = get("SELECT COUNT(*) AS count FROM course_notice_completion_records WHERE send_object_key LIKE 'TEACHER|%'");
    const result = db.prepare("DELETE FROM course_notice_completion_records WHERE send_object_key LIKE 'TEACHER|%'").run();
    recordAuditEvent(req, user, {
      action: "clear_completions",
      entity_type: "teacher_course_notice",
      entity_id: "all",
      before,
      after: { deleted: result.changes || 0 },
    });
    return sendJson(res, { ok: true, deleted: result.changes || 0 });
  }
  if (req.method === "GET" && url.pathname === "/api/finance-summary") {
    const range = financeRangeFromUrl(url);
    if (!range) return sendError(res, 400, "start/end must be YYYY-MM-DD and start must be before end");
    return sendJson(res, financeSummary(range));
  }
  if (req.method === "GET" && url.pathname === "/api/teachers") {
    const teachers = user.role === "teacher" && user.teacher_name
      ? teacherProfiles().filter((row) => row.name === user.teacher_name)
      : teacherProfiles();
    return sendJson(res, { teachers });
  }
  if (req.method === "POST" && url.pathname === "/api/teachers") {
    const result = createTeacherProfile(await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "create", entity_type: "teachers", entity_id: String(result.id), before: null, after: result });
    return sendJson(res, result, 201);
  }
  if (req.method === "POST" && url.pathname === "/api/teachers/backfill-joined-at") {
    const result = backfillTeacherJoinedAt();
    recordAuditEvent(req, user, { action: "backfill_joined_at", entity_type: "teachers", entity_id: "batch", before: null, after: result });
    writeOperationLog(user, {
      operation_type: "补齐老师入职日期",
      operation_content: `补齐 ${result.updated} 条，保持空 ${result.skipped_without_lessons} 条`,
      target_type: "teachers",
      target_id: "batch",
    });
    return sendJson(res, result);
  }

  const studentHistoryMatch = url.pathname.match(/^\/api\/student\/([^/]+)\/history$/);
  if (studentHistoryMatch && req.method === "GET") {
    const studentName = decodeURIComponent(studentHistoryMatch[1]);
    return sendJson(res, { student_name: studentName, history: studentHistoryRows(studentName) });
  }

  if (req.method === "GET" && url.pathname === "/api/students") return sendJson(res, { students: studentProfiles() });
  if (req.method === "POST" && url.pathname === "/api/students") {
    const result = createStudentProfile(await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "create", entity_type: "students", entity_id: String(result.id), before: null, after: result });
    return sendJson(res, { ...result, warnings: studentWarnings(result.name, result.grade) }, 201);
  }
  if (req.method === "POST" && url.pathname === "/api/students/backfill-joined-at") {
    const result = backfillStudentJoinedAt();
    recordAuditEvent(req, user, { action: "backfill_joined_at", entity_type: "students", entity_id: "batch", before: null, after: result });
    writeOperationLog(user, {
      operation_type: "补齐学生入学日期",
      operation_content: `补齐 ${result.updated} 条，保持空 ${result.skipped_without_lessons} 条`,
      target_type: "students",
      target_id: "batch",
    });
    return sendJson(res, result);
  }

  if (req.method === "GET" && url.pathname === "/api/staff") return sendJson(res, { staff: staffRows() });
  if (req.method === "POST" && url.pathname === "/api/staff") {
    const result = createStaff(await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "create", entity_type: "staff", entity_id: String(result.id), before: null, after: result });
    return sendJson(res, result, 201);
  }
  const staffMatch = url.pathname.match(/^\/api\/staff\/(\d+)$/);
  if (staffMatch && req.method === "PATCH") {
    const before = get("SELECT * FROM staff WHERE id = ?", [Number(staffMatch[1])]);
    const result = patchStaff(Number(staffMatch[1]), await readBody(req));
    if (!result) return sendError(res, 404, "staff not found");
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "update", entity_type: "staff", entity_id: String(staffMatch[1]), before, after: result });
    return sendJson(res, result);
  }
  if (staffMatch && req.method === "DELETE") {
    const before = get("SELECT * FROM staff WHERE id = ?", [Number(staffMatch[1])]);
    const result = deleteStaff(Number(staffMatch[1]));
    if (!result) return sendError(res, 404, "staff not found");
    recordAuditEvent(req, user, { action: "delete", entity_type: "staff", entity_id: String(staffMatch[1]), before, after: result });
    return sendJson(res, result);
  }

  if (req.method === "GET" && url.pathname === "/api/staff-salary") {
    const monthKey = resolveMonthKey(url);
    if (!validMonthKey(monthKey)) return sendError(res, 400, "month must be YYYY-MM-01");
    return sendJson(res, { rows: staffSalaryRows(monthKey) });
  }
  if (req.method === "POST" && url.pathname === "/api/staff-salary") {
    const body = await readBody(req);
    const before = get("SELECT * FROM staff_salary_monthly WHERE staff_id = ? AND month_key = ?", [Number(body.staff_id), text(body.month_key || getSetting("month_key"))]);
    const result = upsertStaffSalary(body);
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "upsert", entity_type: "staff_salary", entity_id: `${body.staff_id}|${text(body.month_key || getSetting("month_key"))}`, before, after: result });
    return sendJson(res, result);
  }
  const staffSalaryMatch = url.pathname.match(/^\/api\/staff-salary\/(\d+)$/);
  if (staffSalaryMatch && req.method === "DELETE") {
    const result = auditedDelete(req, user, "staff_salary_monthly", "id", Number(staffSalaryMatch[1]), "staff_salary");
    return sendJson(res, { deleted: (result.changes || 0) > 0 });
  }

  if (req.method === "GET" && url.pathname === "/api/staff-attendance") {
    const monthKey = resolveMonthKey(url);
    if (!validMonthKey(monthKey)) return sendError(res, 400, "month must be YYYY-MM-01");
    return sendJson(res, { rows: staffAttendanceRows(monthKey) });
  }
  if (req.method === "POST" && url.pathname === "/api/staff-attendance") {
    const body = await readBody(req);
    const before = get("SELECT * FROM staff_attendance WHERE staff_id = ? AND attendance_date = ?", [Number(body.staff_id), text(body.attendance_date)]);
    const result = upsertStaffAttendance(body);
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "upsert", entity_type: "staff_attendance", entity_id: `${body.staff_id}|${text(body.attendance_date)}`, before, after: result });
    return sendJson(res, result, 201);
  }
  if (req.method === "DELETE" && url.pathname === "/api/staff-attendance") {
    const before = get("SELECT * FROM staff_attendance WHERE staff_id = ? AND attendance_date = ?", [Number(url.searchParams.get("staff_id")), text(url.searchParams.get("date"))]);
    const result = deleteStaffAttendance(Number(url.searchParams.get("staff_id")), url.searchParams.get("date"));
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "delete", entity_type: "staff_attendance", entity_id: `${url.searchParams.get("staff_id")}|${url.searchParams.get("date")}`, before, after: result });
    return sendJson(res, result);
  }
  if (req.method === "POST" && url.pathname === "/api/staff-attendance-batch") {
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length || items.length > 1000) return sendError(res, 400, "items must contain 1-1000 records");
    const result = withTransaction(() => {
      let upserted = 0;
      let deleted = 0;
      const errors = [];
      items.forEach((item, index) => {
        if (item && item._delete) {
          const outcome = deleteStaffAttendanceRow(Number(item.staff_id), item.attendance_date || item.date);
          if (outcome.error) errors.push({ index, error: outcome.error });
          else if (outcome.deleted) deleted += 1;
          return;
        }
        const outcome = upsertStaffAttendanceRow(item || {});
        if (outcome.error) errors.push({ index, error: outcome.error });
        else upserted += 1;
      });
      return { upserted, deleted, errors };
    });
    recordAuditEvent(req, user, { action: "batch_attendance", entity_type: "staff_attendance", entity_id: "batch", before: { count: items.length }, after: result });
    return sendJson(res, result);
  }

  if (req.method === "GET" && url.pathname === "/api/operating-expenses") return sendJson(res, { expenses: expenseRows(url) });
  if (req.method === "POST" && url.pathname === "/api/operating-expenses") {
    const result = createExpense(await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "create", entity_type: "operating_expenses", entity_id: String(result.id), before: null, after: result });
    return sendJson(res, result, 201);
  }
  const expenseMatch = url.pathname.match(/^\/api\/operating-expenses\/(\d+)$/);
  if (expenseMatch && req.method === "PATCH") {
    const before = get("SELECT * FROM operating_expenses WHERE id = ?", [Number(expenseMatch[1])]);
    const result = patchExpense(Number(expenseMatch[1]), await readBody(req));
    if (!result) return sendError(res, 404, "expense not found");
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "update", entity_type: "operating_expenses", entity_id: String(expenseMatch[1]), before, after: result });
    return sendJson(res, result);
  }
  if (expenseMatch && req.method === "DELETE") {
    const result = auditedDelete(req, user, "operating_expenses", "id", Number(expenseMatch[1]), "operating_expenses");
    return sendJson(res, { deleted: (result.changes || 0) > 0 });
  }

  if (req.method === "GET" && url.pathname === "/api/export/core-workbook.xlsx") {
    const monthKey = normalizeExportMonthKey(url.searchParams.get("month"));
    if (!monthKey) return sendError(res, 400, "month must be YYYY-MM or YYYY-MM-01");
    try {
      return sendBuffer(
        res,
        multiSheetXlsxBuffer(coreWorkbookSheets(monthKey)),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        coreWorkbookFilename(monthKey),
      );
    } catch (error) {
      console.error("core workbook export failed", error);
      return sendError(res, 500, `导出核心 Excel 失败：${error.message || "未知错误"}`);
    }
  }

  if (req.method === "GET" && url.pathname === "/api/export/teacher-salary.xlsx") {
    const monthKey = resolveMonthKey(url);
    return sendBuffer(
      res,
      xlsxBuffer("教师薪资汇总", teacherSalaryRows(monthKey)),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      `teacher-salary-${monthKey}.xlsx`,
    );
  }

  if (req.method === "GET" && url.pathname === "/api/export/student-statement.xlsx") {
    const monthKey = resolveMonthKey(url);
    const studentName = text(url.searchParams.get("student"));
    if (!studentName) return sendError(res, 400, "student is required");
    const range = studentStatementRangeFromUrl(url);
    if (!range) return sendError(res, 400, "start/end must be YYYY-MM-DD and start must be before end");
    const rows = studentStatementRows(monthKey, studentName, range);
    if (!rows) return sendError(res, 404, "student statement not found");
    return sendBuffer(
      res,
      xlsxBuffer("学生账单", rows),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      `student-statement-${studentName}-${range.start}_${range.end}.xlsx`,
    );
  }

  if (req.method === "GET" && url.pathname === "/api/opening-balances/template.xlsx") {
    return sendBuffer(
      res,
      xlsxBuffer("期初余额", openingBalanceTemplateRows()),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "期初余额导入模板.xlsx",
    );
  }

  if (req.method === "GET" && url.pathname === "/api/opening-balances/export.xlsx") {
    return sendBuffer(
      res,
      xlsxBuffer("期初余额", openingBalanceExportRows()),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      openingBalanceExportFilename(),
    );
  }

  if (req.method === "POST" && url.pathname === "/api/opening-balances/import") {
    try {
      const result = await importOpeningBalancesFromUpload(req);
      recordAuditEvent(req, user, {
        action: "import",
        entity_type: "student_opening_balances",
        entity_id: "xlsx",
        before: null,
        after: {
          imported: result.imported,
          skipped: result.skipped,
          failed: result.failed,
          sheet_name: result.sheet_name,
        },
      });
      return sendJson(res, result);
    } catch (error) {
      return sendError(res, 400, error.message || "导入期初余额失败");
    }
  }

  const studentStatementMatch = url.pathname.match(/^\/api\/student\/(.+)\/statement$/);
  if (studentStatementMatch && req.method === "GET") {
    const studentName = decodeURIComponent(studentStatementMatch[1]);
    const range = studentStatementRangeFromUrl(url);
    if (!range) return sendError(res, 400, "start/end must be YYYY-MM-DD and start must be before end");
    const report = studentStatementData(studentName, range);
    if (!report) return sendJson(res, { student_name: studentName, range, summary: null, details: [], month_rows: [], recharges: [] });
    return sendJson(res, report);
  }

  if (req.method === "GET" && url.pathname === "/api/export/finance-summary.csv") {
    const range = financeRangeFromUrl(url);
    if (!range) return sendError(res, 400, "start/end must be YYYY-MM-DD and start must be before end");
    const summary = financeSummary(range);
    return sendCsv(res, financeCsvRows(summary), `经营概览_${summary.range.start}_至_${summary.range.end}.csv`);
  }

  if (req.method === "POST" && url.pathname === "/api/recharges/rollover") {
    const fromMonth = text(url.searchParams.get("from"));
    const toMonth = text(url.searchParams.get("to"));
    const force = url.searchParams.get("force") === "1";
    const before = all("SELECT * FROM recharge_records WHERE month_key IN (?, ?) ORDER BY month_key, student_name", [fromMonth, toMonth]);
    const result = rolloverRecharges(fromMonth, toMonth, force);
    const after = all("SELECT * FROM recharge_records WHERE month_key IN (?, ?) ORDER BY month_key, student_name", [fromMonth, toMonth]);
    recordAuditEvent(req, user, { action: "rollover", entity_type: "recharge_records", entity_id: `${fromMonth}->${toMonth}`, before, after: { result, rows: after } });
    return sendJson(res, result);
  }

  if (req.method === "GET" && url.pathname === "/api/opening-balances") {
    return sendJson(res, { scope: "global", opening_balances: openingBalanceRows() });
  }
  if (req.method === "POST" && url.pathname === "/api/opening-balances") {
    const result = createOpeningBalance(await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "create", entity_type: "student_opening_balances", entity_id: String(result.id), before: null, after: result.row });
    return sendJson(res, result, 201);
  }
  const openingBalanceMatch = url.pathname.match(/^\/api\/opening-balances\/(\d+)$/);
  if (openingBalanceMatch && req.method === "PUT") {
    const id = Number(openingBalanceMatch[1]);
    const result = updateOpeningBalance(id, await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, {
      action: result.deleted ? "delete_zero" : "update",
      entity_type: "student_opening_balances",
      entity_id: String(id),
      before: result.before,
      after: result.deleted ? { deleted: true } : result.row,
    });
    return sendJson(res, result);
  }
  if (openingBalanceMatch && req.method === "DELETE") {
    const id = Number(openingBalanceMatch[1]);
    const result = auditedDelete(req, user, "student_opening_balances", "id", id, "student_opening_balances");
    return sendJson(res, { ok: true, deleted: (result.changes || 0) > 0 });
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    const body = await readBody(req);
    for (const [key, value] of Object.entries(body)) setSetting(key, text(value));
    return sendJson(res, sanitizeBootstrap(bootstrap(text(body.month_key) || getSetting("month_key"), url.searchParams.get("include_inactive") === "1"), user));
  }

  if (req.method === "POST" && url.pathname === "/api/lessons/copy") {
    const body = await readBody(req);
    const result = copyLessons(body);
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "copy", entity_type: "lessons", entity_id: "batch", before: body, after: result });
    return sendJson(res, result, 201);
  }

  if (req.method === "POST" && url.pathname === "/api/lessons") {
    const body = await readBody(req);
    const lessonData = { ...body };
    delete lessonData.teacher_salary_source;
    delete lessonData.teacher_salary_rule_id;
    const lesson = insertLesson(lessonData);
    recordAuditEvent(req, user, { action: "create", entity_type: "lessons", entity_id: String(lesson.id), before: null, after: lesson });
    writeOperationLog(user, { operation_type: "创建课程", operation_content: `${text(body.teacher_name)} ${text(body.date)} ${text(body.time_slot)} ${text(body.subject)} ${text(body.student_names)}`, target_type: "lessons", target_id: String(lesson.id) });
    return sendJson(res, { ...lesson, warnings: lessonWarnings(lesson) }, 201);
  }

  const lessonMatch = url.pathname.match(/^\/api\/lessons\/(\d+)$/);
  if (lessonMatch && req.method === "PATCH") {
    const body = await readBody(req);
    const current = get("SELECT * FROM lessons WHERE id = ?", [Number(lessonMatch[1])]) || {};
    const payload = { ...body, updated_at: new Date().toISOString() };
    delete payload.teacher_salary_source;
    delete payload.teacher_salary_rule_id;
    if (Object.prototype.hasOwnProperty.call(body, "teacher_salary")) {
      const manualSalary = optionalNumber(body.teacher_salary);
      payload.teacher_salary = manualSalary;
      payload.teacher_salary_source = manualSalary === null ? "empty" : "manual";
      payload.teacher_salary_rule_id = null;
    } else {
      const salaryMatchFields = ["teacher_name", "grade", "subject", "student_names", "time_slot"];
      const matchFieldsChanged = salaryMatchFields.some((field) => Object.prototype.hasOwnProperty.call(body, field));
      const currentSource = text(current.teacher_salary_source);
      if (matchFieldsChanged && (!currentSource || currentSource === "empty" || currentSource === "auto")) {
        const resolvedSalary = resolvedTeacherSalaryForLesson({
          ...current,
          ...body,
          teacher_salary_present: false,
        });
        payload.teacher_salary = resolvedSalary.teacher_salary;
        payload.teacher_salary_source = resolvedSalary.teacher_salary_source;
        payload.teacher_salary_rule_id = resolvedSalary.teacher_salary_rule_id;
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      Object.assign(payload, legacyStatusFields(body.status));
    } else if (Object.prototype.hasOwnProperty.call(body, "lesson_status") || Object.prototype.hasOwnProperty.call(body, "course_status")) {
      payload.status = deriveStatus({ ...current, ...body });
    }
    const statusChanged = ["status", "lesson_status", "course_status"].some((field) => Object.prototype.hasOwnProperty.call(body, field));
    if (statusChanged && !isCompletedLesson({ ...current, ...payload })) {
      payload.teacher_salary = 0;
      payload.teacher_salary_source = "empty";
      payload.teacher_salary_rule_id = null;
    }
    auditedPatchTable(req, user, "lessons", "id", Number(lessonMatch[1]), [
      "teacher_name", "date", "lesson_status", "time_slot", "classroom", "grade", "subject",
      "student_names", "notes", "course_status", "status", "teacher_salary", "teacher_salary_source",
      "teacher_salary_rule_id", "month_key", "sort_order", "updated_at",
    ], payload, "lessons");
    const updated = get("SELECT * FROM lessons WHERE id = ?", [Number(lessonMatch[1])]);
    writeOperationLog(user, { operation_type: "修改课程", operation_content: `${text(updated.teacher_name)} ${text(updated.date)} ${text(updated.time_slot)} ${text(updated.subject)} ${text(updated.student_names)}`, target_type: "lessons", target_id: String(lessonMatch[1]) });
    return sendJson(res, { ...updated, warnings: lessonWarnings(updated) });
  }
  if (lessonMatch && req.method === "DELETE") {
    auditedDelete(req, user, "lessons", "id", Number(lessonMatch[1]), "lessons");
    writeOperationLog(user, { operation_type: "删除课程", operation_content: `课程ID ${lessonMatch[1]}`, target_type: "lessons", target_id: String(lessonMatch[1]) });
    return sendJson(res, { ok: true });
  }

  const teacherIdMatch = url.pathname.match(/^\/api\/teachers\/(\d+)$/);
  if (teacherIdMatch && req.method === "PATCH") {
    const body = await readBody(req);
    const current = get("SELECT * FROM teachers WHERE id = ?", [Number(teacherIdMatch[1])]);
    if (!current) return sendError(res, 404, "teacher not found");
    if (Object.prototype.hasOwnProperty.call(body, "name") && !text(body.name)) return sendError(res, 400, "name is required");
    const payload = {};
    for (const field of ["name", "phone", "notes", "status", "joined_at", "left_at"]) {
      if (Object.prototype.hasOwnProperty.call(body, field)) payload[field] = text(body[field]);
    }
    const after = auditedPatchTable(req, user, "teachers", "id", Number(teacherIdMatch[1]), ["name", "phone", "notes", "status", "joined_at", "left_at"], payload, "teachers");
    return sendJson(res, after);
  }
  if (teacherIdMatch && req.method === "DELETE") {
    const before = get("SELECT * FROM teachers WHERE id = ?", [Number(teacherIdMatch[1])]);
    const result = deleteTeacherProfile(Number(teacherIdMatch[1]));
    if (!result) return sendError(res, 404, "teacher not found");
    recordAuditEvent(req, user, { action: "delete", entity_type: "teachers", entity_id: String(teacherIdMatch[1]), before, after: result });
    return sendJson(res, result);
  }

  const studentIdMatch = url.pathname.match(/^\/api\/students\/(\d+)$/);
  if (studentIdMatch && req.method === "PATCH") {
    const body = await readBody(req);
    const current = get("SELECT * FROM students WHERE id = ?", [Number(studentIdMatch[1])]);
    if (!current) return sendError(res, 404, "student not found");
    if (Object.prototype.hasOwnProperty.call(body, "name") && !text(body.name)) return sendError(res, 400, "name is required");
    const payload = {};
    for (const field of ["name", "grade", "phone", "guardian", "notes", "status", "joined_at", "left_at"]) {
      if (Object.prototype.hasOwnProperty.call(body, field)) payload[field] = text(body[field]);
    }
    auditedPatchTable(req, user, "students", "id", Number(studentIdMatch[1]), [
      "name", "grade", "phone", "guardian", "notes", "status", "joined_at", "left_at",
    ], payload, "students");
    const row = get("SELECT * FROM students WHERE id = ?", [Number(studentIdMatch[1])]);
    return sendJson(res, { ...row, warnings: studentWarnings(row.name, row.grade) });
  }
  if (studentIdMatch && req.method === "DELETE") {
    const before = get("SELECT * FROM students WHERE id = ?", [Number(studentIdMatch[1])]);
    const result = deleteStudentProfile(Number(studentIdMatch[1]));
    if (!result) return sendError(res, 404, "student not found");
    recordAuditEvent(req, user, { action: "delete", entity_type: "students", entity_id: String(studentIdMatch[1]), before, after: result });
    return sendJson(res, result);
  }

  const studentMatch = url.pathname.match(/^\/api\/students\/(.+)$/);
  if (studentMatch && req.method === "PATCH") {
    const studentName = decodeURIComponent(studentMatch[1]);
    const body = await readBody(req);
    const grade = text(body.grade);
    backupDb();
    const before = get("SELECT * FROM students WHERE name = ?", [studentName]);
    db.prepare(`
      INSERT INTO students(name, grade) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET grade = excluded.grade
    `).run(studentName, grade);
    const after = get("SELECT * FROM students WHERE name = ?", [studentName]);
    recordAuditEvent(req, user, { action: "upsert", entity_type: "students", entity_id: studentName, before, after });
    return sendJson(res, { ok: true, student_name: studentName, grade, warnings: studentWarnings(studentName, grade) });
  }

  const pricingMatch = url.pathname.match(/^\/api\/pricing-standards\/(\d+)$/);
  if (pricingMatch && req.method === "PATCH") {
    const body = await readBody(req);
    const row = auditedPatchTable(req, user, "pricing_standards", "id", Number(pricingMatch[1]), ["unit_price", "description"], body, "pricing_standards");
    return sendJson(res, row);
  }

  if (req.method === "POST" && url.pathname === "/api/pricing-recompute") {
    const body = await readBody(req);
    const result = recomputePricing(body);
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "recompute", entity_type: "pricing", entity_id: "batch", before: body, after: result });
    return sendJson(res, result);
  }

  if (req.method === "POST" && url.pathname === "/api/student-pricing/apply-selected") {
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    const result = applyStudentPricingRulesToDetails(items);
    if (result.error) return sendError(res, result.status || 400, result.error);
    recordAuditEvent(req, user, { action: "apply_selected", entity_type: "student_pricing", entity_id: "fee_overrides", before: body, after: result });
    writeOperationLog(user, {
      operation_type: "按规则更新学生费用",
      operation_content: `所选 ${items.length} 条，更新 ${result.updatedCount} 条，跳过 ${result.skippedCount} 条`,
      target_type: "fee_overrides",
      target_id: result.updatedDetails.map((row) => `${row.lesson_id}:${row.student_name}`).join(","),
    });
    return sendJson(res, result);
  }

  if (req.method === "POST" && url.pathname === "/api/student-pricing") {
    const body = await readBody(req);
    const payload = {
      student_name: text(body.student_name),
      grade: text(body.grade),
      subject: text(body.subject),
      student_names: normalizedStudents(body.student_names),
      custom_price: num(body.custom_price),
      notes: text(body.notes),
    };
    if (!payload.student_name || !payload.subject) return sendError(res, 400, "student_name and subject are required");
    if (payload.custom_price < 0) {
      return sendError(res, 400, "学生单价必须大于或等于 0；0 元规则仅作为未设置候选");
    }
    const result = db.prepare(`
      INSERT INTO student_pricing(student_name, grade, subject, student_names, custom_price, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_name, grade, subject, student_names) DO UPDATE SET
        custom_price = excluded.custom_price,
        notes = excluded.notes
    `).run(payload.student_name, payload.grade, payload.subject, payload.student_names, payload.custom_price, payload.notes);
    const row = get(`
      SELECT *
      FROM student_pricing
      WHERE student_name = ? AND grade = ? AND subject = ? AND student_names = ?
    `, [payload.student_name, payload.grade, payload.subject, payload.student_names]);
    recordAuditEvent(req, user, { action: "upsert", entity_type: "student_pricing", entity_id: `${payload.student_name}|${payload.grade}|${payload.subject}|${payload.student_names}`, before: null, after: row });
    return sendJson(res, { id: Number(row.id), ok: true, warnings: pricingWarnings(row) }, 201);
  }
  const studentPricingMatch = url.pathname.match(/^\/api\/student-pricing\/(\d+)$/);
  if (studentPricingMatch && req.method === "PATCH") {
    const body = await readBody(req);
    if (Object.prototype.hasOwnProperty.call(body, "custom_price") && num(body.custom_price) < 0) {
      return sendError(res, 400, "学生单价必须大于或等于 0；0 元规则仅作为未设置候选");
    }
    const payload = { ...body };
    if (Object.prototype.hasOwnProperty.call(payload, "student_names")) payload.student_names = normalizedStudents(payload.student_names);
    const row = auditedPatchTable(req, user, "student_pricing", "id", Number(studentPricingMatch[1]), ["student_name", "grade", "subject", "student_names", "custom_price", "notes"], payload, "student_pricing");
    return sendJson(res, { ...row, warnings: pricingWarnings(row) });
  }
  if (studentPricingMatch && req.method === "DELETE") {
    auditedDelete(req, user, "student_pricing", "id", Number(studentPricingMatch[1]), "student_pricing");
    return sendJson(res, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/recharges") {
    const body = await readBody(req);
    const monthKey = text(body.month_key || getSetting("month_key"));
    const studentName = text(body.student_name);
    if (!studentName) return sendError(res, 400, "学生姓名不能为空");
    const curRecharge = num(body.cur_recharge);
    const curGift = num(body.cur_gift);
    if (Math.abs(curRecharge) > 100000) return sendError(res, 400, "充值金额超出合理范围");
    if (Math.abs(curGift) > 100000) return sendError(res, 400, "赠送金额超出合理范围");
    const canEditOpeningBalance = !previousDataMonth(monthKey);
    const before = get("SELECT * FROM recharge_records WHERE student_name = ? AND month_key = ?", [studentName, monthKey]);
    if (curRecharge === 0 && curGift === 0) {
      if (!before) return sendError(res, 400, "实际充值和赠送充值不能同时为 0");
      const result = withTransaction(() => {
        db.prepare("DELETE FROM recharge_records WHERE id = ?").run(before.id);
        return refreshCarryOverAfter(monthKey);
      });
      recordAuditEvent(req, user, { action: "delete_zero_recharge", entity_type: "recharge_records", entity_id: `${studentName}|${monthKey}`, before, after: { row: null, carry_over: result } });
      return sendJson(res, { ok: true, deleted: true, carry_over: result });
    }
    const result = withTransaction(() => {
      db.prepare(`
        INSERT INTO recharge_records(
          student_name, grade, prev_actual, prev_gift, cur_recharge, cur_gift, recharge_date, notes, source, month_key
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_name, month_key) DO UPDATE SET
          grade = excluded.grade,
          prev_actual = CASE WHEN ? THEN excluded.prev_actual ELSE recharge_records.prev_actual END,
          prev_gift = CASE WHEN ? THEN excluded.prev_gift ELSE recharge_records.prev_gift END,
          cur_recharge = excluded.cur_recharge,
          cur_gift = excluded.cur_gift,
          recharge_date = excluded.recharge_date,
          notes = excluded.notes,
          source = excluded.source
      `).run(
        studentName,
        text(body.grade),
        canEditOpeningBalance ? num(body.prev_actual) : 0,
        canEditOpeningBalance ? num(body.prev_gift) : 0,
        curRecharge,
        curGift,
        text(body.recharge_date),
        text(body.notes),
        text(body.source),
        monthKey,
        canEditOpeningBalance ? 1 : 0,
        canEditOpeningBalance ? 1 : 0,
      );
      return refreshCarryOverAfter(monthKey);
    });
    const after = get("SELECT * FROM recharge_records WHERE student_name = ? AND month_key = ?", [studentName, monthKey]);
    recordAuditEvent(req, user, { action: "upsert", entity_type: "recharge_records", entity_id: `${studentName}|${monthKey}`, before, after: { row: after, carry_over: result } });
    return sendJson(res, { ok: true, carry_over: result });
  }

  if (req.method === "POST" && url.pathname === "/api/fee-overrides") {
    const body = await readBody(req);
    const lessonId = Number(body.lesson_id);
    const studentName = text(body.student_name);
    if (!lessonId || !studentName) return sendError(res, 400, "lesson_id and student_name are required");
    const unitPrice = num(body.unit_price);
    if (body.unit_price !== "" && body.unit_price != null && unitPrice < 0) return sendError(res, 400, "单价不能为负数");
    if (body.unit_price !== "" && body.unit_price != null && unitPrice > 10000) return sendError(res, 400, "单价超出合理范围");
    const before = get("SELECT * FROM fee_overrides WHERE lesson_id = ? AND student_name = ?", [lessonId, studentName]);
    if (body.unit_price === "" || body.unit_price == null) {
      db.prepare("DELETE FROM fee_overrides WHERE lesson_id = ? AND student_name = ?").run(lessonId, studentName);
    } else {
      db.prepare(`
        INSERT INTO fee_overrides(lesson_id, student_name, unit_price, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(lesson_id, student_name) DO UPDATE SET
          unit_price = excluded.unit_price,
          updated_at = CURRENT_TIMESTAMP
      `).run(lessonId, studentName, unitPrice);
    }
    const after = get("SELECT * FROM fee_overrides WHERE lesson_id = ? AND student_name = ?", [lessonId, studentName]);
    recordAuditEvent(req, user, { action: after ? "upsert" : "delete", entity_type: "fee_overrides", entity_id: `${lessonId}|${studentName}`, before, after });
    return sendJson(res, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/teacher-adjustments") {
    const body = await readBody(req);
    const monthKey = text(body.month_key || getSetting("month_key"));
    const before = get("SELECT * FROM teacher_adjustments_monthly WHERE teacher_name = ? AND month_key = ?", [text(body.teacher_name), monthKey]);
    db.prepare(`
      INSERT INTO teacher_adjustments_monthly(
        teacher_name, month_key, week1_transport, week2_transport, week3_transport, week4_transport, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(teacher_name, month_key) DO UPDATE SET
        week1_transport = excluded.week1_transport,
        week2_transport = excluded.week2_transport,
        week3_transport = excluded.week3_transport,
        week4_transport = excluded.week4_transport,
        notes = excluded.notes
    `).run(
      text(body.teacher_name),
      monthKey,
      num(body.week1_transport),
      num(body.week2_transport),
      num(body.week3_transport),
      num(body.week4_transport),
      text(body.notes),
    );
    const after = get("SELECT * FROM teacher_adjustments_monthly WHERE teacher_name = ? AND month_key = ?", [text(body.teacher_name), monthKey]);
    recordAuditEvent(req, user, { action: "upsert", entity_type: "teacher_adjustments", entity_id: `${text(body.teacher_name)}|${monthKey}`, before, after });
    return sendJson(res, { ok: true });
  }

  sendError(res, 404, "API not found");
}

function serveStatic(req, res, url) {
  let filePath = url.pathname === "/" ? path.join(publicDir, "index.html") : path.join(publicDir, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(publicDir, "index.html");
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  }[ext] || "application/octet-stream";
  const body = fs.readFileSync(filePath);
  res.writeHead(200, { "content-type": mime, "content-length": body.length });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendError(res, 500, error.message || "Internal server error");
  }
});

server.listen(port, () => {
  console.log(`黎明教育课程管理系统: http://localhost:${port}`);
  console.log(`SQLite: ${dbPath}`);
});
