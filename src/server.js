const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { DatabaseSync } = require("node:sqlite");

const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "liming-local.sqlite");
const port = Number(process.env.PORT || 5177);

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
      subject TEXT NOT NULL,
      custom_price REAL NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      UNIQUE (student_name, subject)
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
      month_key TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
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
  `);

  const auditColumns = db.prepare("PRAGMA table_info(audit_logs)").all().map((column) => column.name);
  if (!auditColumns.includes("run_id")) {
    db.prepare("ALTER TABLE audit_logs ADD COLUMN run_id TEXT DEFAULT ''").run();
  }
  if (!auditColumns.includes("issue_key")) {
    db.prepare("ALTER TABLE audit_logs ADD COLUMN issue_key TEXT DEFAULT ''").run();
  }
  db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_logs_issue_key ON audit_logs(issue_key)").run();

  const rechargeColumns = db.prepare("PRAGMA table_info(recharge_records)").all().map((column) => column.name);
  if (!rechargeColumns.includes("source")) {
    db.prepare("ALTER TABLE recharge_records ADD COLUMN source TEXT DEFAULT ''").run();
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
}

initDb();

if (process.argv.includes("--init-db")) {
  console.log(`Database initialized: ${dbPath}`);
  process.exit(0);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

function splitStudents(value) {
  return text(value)
    .split(/[、,，;；]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function weekdayCn(dateValue) {
  if (!dateValue) return "";
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
}

function deriveStatus(row = {}) {
  const current = text(row.status);
  if (STATUS.includes(current)) return current;
  if (row.lesson_status === "试课") return "试课";
  if (row.lesson_status === "考试") return "考试";
  if (row.lesson_status === "上课（未缴费）") return "未缴费";
  if (row.lesson_status === "请假" || row.course_status === "请假") return "请假";
  if (row.course_status === "已上") return "已上";
  return "待上";
}

function legacyStatusFields(statusValue) {
  const status = STATUS.includes(text(statusValue)) ? text(statusValue) : "待上";
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

function isUnpaid(row) {
  return deriveStatus(row) === "未缴费";
}

function isBillableDetail(row) {
  const status = deriveStatus(row);
  if (status === "考试") return row.price_source === "manual" && num(row.unit_price) > 0;
  return isEffective(row);
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
    return { name, path: rels.get(relId) || "" };
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

function readXlsxTotalSheet(buffer, monthKey) {
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
  for (const [, rowTag, rowXml] of sheetXmlText.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowIndex = Number(xmlAttr(rowTag, "r"));
    if (!rowIndex || rowIndex < 3) continue;
    const values = [];
    const normalizedRowXml = rowXml.replace(/<c\b([^>]*)\/>/g, "<c$1></c>");
    for (const [, cellTag, cellXml] of normalizedRowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const column = cellColumnIndex(xmlAttr(cellTag, "r"));
      if (column >= 0) values[column] = cellValue(cellTag, cellXml, sharedStrings);
    }
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
    const nonTimeFields = ["teacher_name", "date", "lesson_status", "classroom", "grade", "subject", "student_names", "notes", "course_status"];
    if (!nonTimeFields.some((field) => row[field]) && (!row.time_slot || row.time_slot === "0" || row.time_slot === "0:00")) continue;
    if (![...nonTimeFields, "time_slot"].some((field) => row[field])) continue;
    if (row.date && monthKeyFromDate(row.date) && monthKeyFromDate(row.date) !== monthKey) {
      throw new Error(`文件 ${sheet.name} 第 ${rowIndex} 行日期为 ${row.date}，与当前月份 ${monthKey.slice(0, 7)} 不一致`);
    }
    row.student_count = splitStudents(row.student_names).length;
    rows.push(row);
  }
  return { sheet_name: sheet.name, rows };
}

function priceBucket(grade, studentCount) {
  if (!studentCount) return 1;
  if (String(grade).startsWith("高")) return studentCount >= 4 ? 4 : studentCount;
  if (String(grade).startsWith("初")) return studentCount >= 3 ? 4 : Math.min(studentCount, 2);
  return studentCount >= 4 ? 4 : studentCount;
}

function unitPriceFor({ studentName, subject, grade, studentCount, lessonId, status }) {
  const override = get(
    "SELECT unit_price FROM fee_overrides WHERE lesson_id = ? AND student_name = ?",
    [lessonId, studentName],
  );
  if (override) return { unit_price: num(override.unit_price), source: "manual" };

  if (status === "考试") return { unit_price: 0, source: "exam" };

  const custom = get(
    "SELECT custom_price FROM student_pricing WHERE student_name = ? AND subject = ?",
    [studentName, subject],
  );
  if (custom && custom.custom_price !== "") return { unit_price: num(custom.custom_price), source: "custom" };

  const bucket = priceBucket(grade, studentCount);
  const standard = get(
    "SELECT unit_price FROM pricing_standards WHERE grade = ? AND student_count = ?",
    [grade, bucket],
  );
  return { unit_price: standard ? num(standard.unit_price) : 0, source: "standard" };
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
    "SELECT DISTINCT student_name FROM recharge_records WHERE month_key = ? AND TRIM(student_name) <> ''",
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
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function teacherProfiles() {
  return all(`
    SELECT *
    FROM teachers
    ORDER BY CASE status WHEN '在职' THEN 0 WHEN '离职' THEN 2 ELSE 1 END, name
  `);
}

function studentProfiles() {
  return all(`
    SELECT *
    FROM students
    ORDER BY CASE status WHEN '在读' THEN 0 WHEN '已流出' THEN 2 ELSE 1 END, name
  `);
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

function deleteTeacherProfile(id) {
  const row = get("SELECT * FROM teachers WHERE id = ?", [Number(id)]);
  if (!row) return null;
  if (teacherHasHistory(row.name)) {
    db.prepare("UPDATE teachers SET status = '离职', left_at = COALESCE(NULLIF(left_at, ''), ?) WHERE id = ?").run(todayKey(), Number(id));
    return { deleted: false, soft_deleted: true, row: get("SELECT * FROM teachers WHERE id = ?", [Number(id)]) };
  }
  db.prepare("DELETE FROM teacher_adjustments_monthly WHERE teacher_name = ?").run(row.name);
  db.prepare("DELETE FROM teacher_adjustments WHERE teacher_name = ?").run(row.name);
  db.prepare("DELETE FROM teachers WHERE id = ?").run(Number(id));
  return { deleted: true, soft_deleted: false };
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
      INSERT INTO staff(name, role, base_salary, phone, status, joined_at, left_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      text(body.role) || "其他",
      num(body.base_salary),
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
    for (const field of ["name", "role", "phone", "status", "joined_at", "left_at", "notes"]) {
      if (Object.prototype.hasOwnProperty.call(body, field)) payload[field] = text(body[field]);
    }
    if (Object.prototype.hasOwnProperty.call(body, "base_salary")) payload.base_salary = num(body.base_salary);
    patchTable("staff", "id", Number(id), [
      "name", "role", "base_salary", "phone", "status", "joined_at", "left_at", "notes",
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

function staffSalaryRows(monthKey) {
  ensureStaffSalaryRows(monthKey);
  return all(`
    SELECT
      ssm.id,
      s.id AS staff_id,
      s.name,
      s.role,
      s.base_salary,
      s.phone,
      s.status,
      s.left_at,
      ssm.month_key,
      ssm.salary_actual,
      ssm.bonus,
      ssm.deduction,
      ssm.notes,
      (s.base_salary + COALESCE(ssm.bonus, 0) - COALESCE(ssm.deduction, 0)) AS expected_salary
    FROM staff_salary_monthly ssm
    JOIN staff s ON s.id = ssm.staff_id
    WHERE ssm.month_key = ?
    ORDER BY s.role, s.name
  `, [monthKey]);
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
    const salaryActual = num(staff.base_salary) + bonus - deduction;
    db.prepare(`
      INSERT INTO staff_salary_monthly(staff_id, month_key, salary_actual, bonus, deduction, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(staff_id, month_key) DO UPDATE SET
        salary_actual = excluded.salary_actual,
        bonus = excluded.bonus,
        deduction = excluded.deduction,
        notes = excluded.notes
    `).run(staffId, monthKey, salaryActual, bonus, deduction, text(body.notes));
    return get(`
      SELECT
        ssm.id, s.id AS staff_id, s.name, s.role, s.base_salary, s.status, s.left_at,
        ssm.month_key, ssm.salary_actual, ssm.bonus, ssm.deduction, ssm.notes,
        (s.base_salary + COALESCE(ssm.bonus, 0) - COALESCE(ssm.deduction, 0)) AS expected_salary
      FROM staff_salary_monthly ssm
      JOIN staff s ON s.id = ssm.staff_id
      WHERE ssm.staff_id = ? AND ssm.month_key = ?
    `, [staffId, monthKey]);
  });
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

function feeDetails(monthKey) {
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
      });
      const detail = {
        status,
        unit_price: price.unit_price,
        price_source: price.source,
      };
      details.push({
        id: `${lesson.id}:${index + 1}`,
        lesson_id: lesson.id,
        student_index: index + 1,
        student_name: studentName,
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
        unit_price: price.unit_price,
        price_source: price.source,
        course_status: lesson.course_status,
        teacher_salary: num(lesson.teacher_salary),
        student_count: studentCount,
        effective: isBillableDetail(detail),
      });
    });
  }
  return details;
}

function studentSummary(details, monthKey, includeInactive = false) {
  const byStudent = new Map();
  const active = activeStudentNames(monthKey);
  for (const detail of details) {
    if (!byStudent.has(detail.student_name)) {
      byStudent.set(detail.student_name, {
        student_name: detail.student_name,
        grade: detail.grade,
        lesson_count: 0,
        total_fee: 0,
        active_this_month: active.has(detail.student_name),
      });
    }
    const row = byStudent.get(detail.student_name);
    if (!row.grade && detail.grade) row.grade = detail.grade;
    if (detail.effective) {
      row.lesson_count += 1;
      row.total_fee += num(detail.unit_price);
    }
  }
  for (const recharge of all("SELECT * FROM recharge_records WHERE month_key = ?", [monthKey])) {
    if (!byStudent.has(recharge.student_name)) {
      byStudent.set(recharge.student_name, {
        student_name: recharge.student_name,
        grade: recharge.grade,
        lesson_count: 0,
        total_fee: 0,
        active_this_month: active.has(recharge.student_name),
      });
    }
  }
  if (includeInactive) {
    for (const student of all("SELECT * FROM students ORDER BY name")) {
      if (!byStudent.has(student.name)) {
        byStudent.set(student.name, {
          student_name: student.name,
          grade: student.grade || "",
          lesson_count: 0,
          total_fee: 0,
          active_this_month: active.has(student.name),
        });
      }
    }
  }

  const rows = [...byStudent.values()]
    .filter((row) => includeInactive || row.active_this_month)
    .sort((a, b) => a.student_name.localeCompare(b.student_name, "zh-Hans-CN"));
  return rows.map((row) => {
    const recharge = get(
      "SELECT * FROM recharge_records WHERE student_name = ? AND month_key = ?",
      [row.student_name, monthKey],
    ) || {};
    const prevActual = num(recharge.prev_actual);
    const prevGift = num(recharge.prev_gift);
    const curRecharge = num(recharge.cur_recharge);
    const curGift = num(recharge.cur_gift);
    const totalFee = num(row.total_fee);
    const actualBase = prevActual + curRecharge + Math.min(prevGift, 0);
    const allFunds = prevActual + curRecharge + prevGift + curGift;
    const actualConsumption = Math.min(totalFee, Math.max(0, actualBase));
    const giftConsumption = Math.min(Math.max(0, totalFee - actualConsumption), Math.max(0, prevGift) + curGift);
    const actualBalance = actualBase >= totalFee
      ? actualBase - totalFee
      : Math.min(0, allFunds - totalFee);
    const giftBalance = actualBase >= totalFee
      ? Math.max(prevGift, 0) + curGift
      : Math.max(0, allFunds - totalFee);
    return {
      ...row,
      grade: row.grade || recharge.grade || "",
      prev_actual: prevActual,
      prev_gift: prevGift,
      cur_recharge: curRecharge,
      cur_gift: curGift,
      recharge_date: recharge.recharge_date || "",
      recharge_notes: recharge.notes || "",
      actual_consumption: actualConsumption,
      gift_consumption: giftConsumption,
      actual_balance: actualBalance,
      gift_balance: giftBalance,
    };
  });
}

function teacherSummary(monthKey, includeInactive = false) {
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
    if (isEffective(lesson)) {
      row.lesson_count += 1;
      row.salary_total += num(lesson.teacher_salary);
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
      total_salary: row.salary_total + week1 + week2 + week3 + week4,
      notes: adj.notes || "",
    };
  }).sort((a, b) => a.teacher_name.localeCompare(b.teacher_name, "zh-Hans-CN"));
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
    operating_expenses: countByMonth("operating_expenses", monthKey),
  };
}

function allPartitionedMonths() {
  const months = new Set(availableMonths());
  for (const table of ["teacher_adjustments_monthly", "staff_salary_monthly", "operating_expenses"]) {
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
  return text(row.source) === "carry_over" && (!notes || notes.startsWith("自动结转"));
}

function hasEmptyCarryOverFields(row) {
  return row && num(row.prev_actual) === 0 && num(row.prev_gift) === 0;
}

function shouldRefreshCarryOver(row, force = false) {
  if (!row) return true;
  if (force) return true;
  return isAutoCarryOverRecord(row) || hasEmptyCarryOverFields(row);
}

function carryOverCandidates(fromMonth, includeZero = false) {
  return studentSummary(feeDetails(fromMonth), fromMonth, true)
    .filter((row) => includeZero || num(row.actual_balance) !== 0 || num(row.gift_balance) !== 0);
}

function ensureCarryOver(monthKey) {
  if (!validMonthKey(monthKey)) throw new Error("month_key must be YYYY-MM-01");
  const fromMonth = previousDataMonth(monthKey);
  if (!fromMonth) {
    return { month_key: monthKey, from_month: "", ensured: 0, updated: 0, skipped: 0, carried_actual: 0, carried_gift: 0 };
  }

  const candidates = carryOverCandidates(fromMonth);
  const insertRecharge = db.prepare(`
    INSERT OR IGNORE INTO recharge_records(
      student_name, grade, prev_actual, prev_gift, cur_recharge, cur_gift, recharge_date, notes, source, month_key
    )
    VALUES (?, ?, ?, ?, 0, 0, '', ?, 'carry_over', ?)
  `);
  const updateRecharge = db.prepare(`
    UPDATE recharge_records
    SET grade = ?,
        prev_actual = ?,
        prev_gift = ?,
        source = 'carry_over',
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
      if (!shouldRefreshCarryOver(existing)) {
        skipped += 1;
        continue;
      }
      const changed = num(existing.prev_actual) !== actual
        || num(existing.prev_gift) !== gift
        || text(existing.grade) !== text(row.grade)
        || !isAutoCarryOverRecord(existing);
      updateRecharge.run(row.grade || "", actual, gift, carryOverNote(existing, fromMonth), row.student_name, monthKey);
      if (changed) updated += 1;
    } else if (insertRecharge.run(row.student_name, row.grade || "", actual, gift, carryOverNote(null, fromMonth), monthKey).changes) {
      ensured += 1;
    }
    carriedActual += actual;
    carriedGift += gift;
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
    for (const table of ["lessons", "recharge_records", "teacher_adjustments_monthly", "staff_salary_monthly", "operating_expenses"]) {
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
      total += amount;
      const name = row.teacher_name || "未填写";
      byTeacher.set(name, (byTeacher.get(name) || 0) + amount);
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
      total += amount;
      byStaffRole[role] = (byStaffRole[role] || 0) + amount;
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
    total += amount;
    byCategory[category] = (byCategory[category] || 0) + amount;
  }
  return { rows, total, by_category: byCategory };
}

function rechargesInRange(range) {
  return all(`
    SELECT *, COALESCE(NULLIF(recharge_date, ''), month_key) AS event_date
    FROM recharge_records
    WHERE COALESCE(NULLIF(recharge_date, ''), month_key) >= ?
      AND COALESCE(NULLIF(recharge_date, ''), month_key) <= ?
  `, [range.start, range.end]);
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
      revenue += price * (num(summary.actual_consumption) / totalFee);
      giftConsumption += price * (num(summary.gift_consumption) / totalFee);
    } else {
      revenue += price;
    }
  }

  const lessonSalary = new Map();
  const teacherSalary = new Map();
  for (const detail of effectiveDetails) {
    if (lessonSalary.has(detail.lesson_id)) continue;
    const salary = num(detail.teacher_salary);
    lessonSalary.set(detail.lesson_id, salary);
    const teacherName = detail.teacher_name || "未填写";
    teacherSalary.set(teacherName, (teacherSalary.get(teacherName) || 0) + salary);
  }
  const teacherCost = [...lessonSalary.values()].reduce((sum, value) => sum + value, 0);
  const transport = weightedTeacherTransport(range);
  const staffSalary = weightedStaffSalary(range);
  const expenses = operatingExpenseSummary(range);
  const operatingCost = {
    staff_salary_total: staffSalary.total,
    operating_expense_total: expenses.total,
    total: staffSalary.total + expenses.total,
    by_staff_role: staffSalary.by_staff_role,
    by_category: expenses.by_category,
  };
  const recharges = rechargesInRange(range);
  const cashIn = recharges.reduce((sum, row) => sum + num(row.cur_recharge), 0);
  const giftIssued = recharges.reduce((sum, row) => sum + num(row.cur_gift), 0);
  const grossProfit = revenue - teacherCost - transport.total - operatingCost.total;

  return {
    range,
    details,
    effective_details: effectiveDetails,
    end_month_key: monthKeyFromDate(range.end),
    end_month_summaries: studentSummary(feeDetails(monthKeyFromDate(range.end)), monthKeyFromDate(range.end), true),
    recharges,
    teacher_salary_by_teacher: teacherSalary,
    transport_by_teacher: transport.by_teacher,
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
      net_cash_flow: cashIn - (teacherCost + transport.total + operatingCost.total),
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
    "gross_margin",
    "cash_in",
    "gift_issued",
    "net_cash_flow",
  ]) {
    overview[key] = overviewMetric(num(current[key]), num(previous?.[key]));
  }
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
  const balanceSheet = {
    total_actual_balance: current.end_month_summaries.reduce((sum, row) => sum + num(row.actual_balance), 0),
    total_gift_balance: current.end_month_summaries.reduce((sum, row) => sum + num(row.gift_balance), 0),
    accounts_receivable: current.details
      .filter(isUnpaid)
      .reduce((sum, row) => sum + num(row.unit_price), 0),
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
    teacherMap.get(name).revenue_contribution += num(row.unit_price);
  }
  const byTeacher = [...teacherMap.values()].map((row) => ({
    ...row,
    roi: row.salary_total ? row.revenue_contribution / row.salary_total : null,
  })).sort((a, b) => (num(b.roi) - num(a.roi)) || (b.revenue_contribution - a.revenue_contribution));

  const totalBreakdownRevenue = effectiveDetails.reduce((sum, row) => sum + num(row.unit_price), 0);
  const groupedRevenue = (field) => {
    const map = new Map();
    for (const row of effectiveDetails) {
      const key = row[field] || "未填写";
      map.set(key, (map.get(key) || 0) + num(row.unit_price));
    }
    return [...map.entries()].map(([name, revenue]) => ({
      name,
      revenue,
      share: totalBreakdownRevenue ? revenue / totalBreakdownRevenue : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  };

  const classMap = new Map();
  for (const row of effectiveDetails) {
    const type = classType(row.student_count);
    if (!classMap.has(type)) classMap.set(type, { class_type: type, revenue: 0, teacher_cost: 0, _lesson_ids: new Set() });
    const item = classMap.get(type);
    item.revenue += num(row.unit_price);
    if (!item._lesson_ids.has(row.lesson_id)) {
      item._lesson_ids.add(row.lesson_id);
      item.teacher_cost += num(row.teacher_salary);
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
    item.total_fee += num(row.unit_price);
  }
  const topStudents = [...studentMap.values()]
    .sort((a, b) => num(b.total_fee) - num(a.total_fee))
    .slice(0, 10)
    .map((row) => ({
      student_name: row.student_name,
      lesson_count: row.lesson_count,
      total_fee: row.total_fee,
    }));

  const lowBalance = current.end_month_summaries
    .filter((row) => {
      const avg = row.lesson_count ? num(row.total_fee) / row.lesson_count : 0;
      return avg > 0 && num(row.actual_balance) < avg;
    })
    .map((row) => ({
      student_name: row.student_name,
      actual_balance: row.actual_balance,
      avg_unit_price: row.lesson_count ? num(row.total_fee) / row.lesson_count : 0,
      lesson_count: row.lesson_count,
    }))
    .sort((a, b) => a.actual_balance - b.actual_balance);

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
      low_balance: lowBalance,
      unpaid_lessons: unpaidLessons,
    },
  };
}

function financeTrend6m(endDateKey) {
  const endMonth = monthKeyFromDate(endDateKey);
  if (!endMonth) return [];
  const endDate = parseDateKey(endMonth);
  const rows = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(endDate.getFullYear(), endDate.getMonth() - offset, 1);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
    const base = financeBase(monthRange(month));
    const totalCost = num(base.overview_raw.teacher_cost)
      + num(base.overview_raw.transport_cost)
      + num(base.overview_raw.operating_cost?.total);
    rows.push({
      month,
      revenue: base.overview_raw.revenue,
      total_cost: totalCost,
      gross_profit: base.overview_raw.gross_profit,
      gross_margin: base.overview_raw.gross_margin,
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
    balance_sheet: sections.balance_sheet,
    prev_balance_sheet: previousSections.balance_sheet,
    breakdowns: sections.breakdowns,
    top_lists: sections.top_lists,
    trend_6m: financeTrend6m(currentRange.end),
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
  }
}

function normalizeAuditName(value) {
  return text(value).replace(/\s+/g, "");
}

function inactiveStudentStatus(status) {
  return ["离校", "已流出"].includes(text(status));
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
        message: `${pricing.student_name}-${pricing.subject} 从未在课程中使用，可能是误建的个性价`,
        data: { pricing_id: pricing.id },
      }));
      continue;
    }
    usedPricing.add(`${pricing.student_name}|${pricing.subject}`);
    const latest = usages[usages.length - 1];
    const std = standardPrice(latest.lesson.grade, latest.student_count);
    const custom = num(pricing.custom_price);
    if (std > 0 && Math.abs(custom - std) / std > 0.3) {
      issues.push(auditIssue({
        severity: "WARN",
        type: "price_outlier",
        entity: `pricing_${pricing.id}`,
        field: "custom_price",
        before_value: custom,
        after_value: std,
        message: `${pricing.student_name}-${pricing.subject} 专享价相对标准价偏离超过 30%`,
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
      db.prepare(`
        UPDATE recharge_records
        SET grade = ?,
            prev_actual = ?,
            prev_gift = ?,
            source = 'carry_over',
            notes = ?
        WHERE student_name = ? AND month_key = ?
      `).run(
        row.grade || "",
        num(row.actual_balance),
        num(row.gift_balance),
        carryOverNote(existing, fromMonth),
        row.student_name,
        toMonth,
      );
      updated += 1;
    } else {
      db.prepare(`
        INSERT INTO recharge_records(
          student_name, grade, prev_actual, prev_gift, cur_recharge, cur_gift, recharge_date, notes, source, month_key
        )
        VALUES (?, ?, ?, ?, 0, 0, '', ?, 'carry_over', ?)
      `).run(row.student_name, row.grade || "", num(row.actual_balance), num(row.gift_balance), carryOverNote(null, fromMonth), toMonth);
      inserted += 1;
    }
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
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
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
    rows.push([label, item.current, item.previous, item.mom_pct == null ? "" : item.mom_pct]);
  }
  rows.push(
    [],
    ["资金负债表", "金额"],
    ["月末沉淀现金", summary.balance_sheet.total_actual_balance],
    ["月末赠送余额", summary.balance_sheet.total_gift_balance],
    ["应收账款", summary.balance_sheet.accounts_receivable],
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
    ...summary.top_lists.low_balance.map((row) => [row.student_name, "低余额", row.actual_balance, `平均单次课费 ${row.avg_unit_price}`]),
    ...summary.top_lists.unpaid_lessons.map((row) => [row.student, "未缴费课时", row.unit_price, `${row.date} #${row.lesson_id}`]),
    [],
    ["近 6 个月趋势", "收入", "总成本", "毛利", "毛利率"],
    ...summary.trend_6m.map((row) => [row.month, row.revenue, row.total_cost, row.gross_profit, row.gross_margin]),
  );
  return rows;
}

function studentStatementRows(monthKey, studentName) {
  const details = feeDetails(monthKey);
  const summaries = studentSummary(details, monthKey);
  const summary = summaries.find((row) => row.student_name === studentName);
  const studentDetails = details.filter((row) => row.student_name === studentName);
  if (!summary && !studentDetails.length) return null;
  return [
    [`${monthKey} 学生账单`, studentName],
    ["学生姓名", "年级", "上课次数", "课程总费用", "上月实际结转", "上月赠送结转", "本月实际充值", "本月赠送学费", "本月实际消费", "本月赠送消费", "实际余额", "赠送余额"],
    [
      studentName,
      summary?.grade || "",
      summary?.lesson_count || 0,
      summary?.total_fee || 0,
      summary?.prev_actual || 0,
      summary?.prev_gift || 0,
      summary?.cur_recharge || 0,
      summary?.cur_gift || 0,
      summary?.actual_consumption || 0,
      summary?.gift_consumption || 0,
      summary?.actual_balance || 0,
      summary?.gift_balance || 0,
    ],
    [],
    ["课程明细"],
    ["日期", "星期", "时间", "授课老师", "状态", "教室", "年级", "科目", "备注", "单人费用", "费用来源"],
    ...studentDetails.map((row) => [
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
      row.price_source === "manual" ? "手动" : row.price_source === "custom" ? "个性价" : row.price_source === "exam" ? "考试手填" : "标准价",
    ]),
  ];
}

function studentHistoryRows(studentName) {
  const name = text(studentName);
  if (!name) return [];
  const rows = [];
  for (const monthKey of allPartitionedMonths()) {
    const details = feeDetails(monthKey);
    const studentDetails = details.filter((row) => row.student_name === name);
    const recharge = get(
      "SELECT * FROM recharge_records WHERE student_name = ? AND month_key = ?",
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
  const normalizedNames = "REPLACE(REPLACE(REPLACE(REPLACE(l.student_names, '、', ','), '，', ','), ';', ','), '；', ',')";
  return all(`
    SELECT sp.*,
           sp.student_name || '-' || sp.subject AS lookup_key,
           (SELECT COUNT(*)
              FROM lessons l
             WHERE (',' || ${normalizedNames} || ',') LIKE '%,' || sp.student_name || ',%'
               AND l.subject = sp.subject
               AND l.month_key = ?) AS current_month_lessons,
           (SELECT COUNT(*)
              FROM lessons l
             WHERE (',' || ${normalizedNames} || ',') LIKE '%,' || sp.student_name || ',%'
               AND l.subject = sp.subject) AS total_lessons
      FROM student_pricing sp
     ORDER BY sp.student_name, sp.subject
  `, [monthKey]);
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

function bootstrap(monthKey, includeInactive = false) {
  syncStudentsFromLessons();
  syncTeachersFromLessons();
  withTransaction(() => ensureCarryOverChain(monthKey));
  const details = feeDetails(monthKey);
  const settings = Object.fromEntries(all("SELECT key, value FROM settings").map((row) => [row.key, row.value]));
  settings.month_key = monthKey;
  return {
    active_month_key: monthKey,
    settings,
    lookups: {
      lesson_status: LESSON_STATUS,
      course_status: COURSE_STATUS,
      status: STATUS,
      classrooms: CLASSROOMS,
      subjects: SUBJECTS,
      grades: GRADES,
      staff_roles: STAFF_ROLES,
      expense_categories: EXPENSE_CATEGORIES,
    },
    teachers: teachersForMonth(monthKey, includeInactive),
    students: studentsForMonth(monthKey, includeInactive),
    pricing_standards: all("SELECT * FROM pricing_standards ORDER BY grade, student_count"),
    student_pricing: studentPricingRows(monthKey),
    lessons: all("SELECT *, ? AS weekday FROM lessons WHERE month_key = ? ORDER BY date, teacher_name, time_slot, sort_order, id", ["", monthKey]),
    recharges: all("SELECT * FROM recharge_records WHERE month_key = ? ORDER BY student_name", [monthKey]),
    derived: {
      fee_details: details,
      student_summary: studentSummary(details, monthKey, includeInactive),
      teacher_summary: teacherSummary(monthKey, includeInactive),
    },
  };
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
    entity: issue.entity || "",
    field: issue.field || "",
    xlsx_value: text(issue.xlsx_value),
    db_value: text(issue.db_value),
    lesson_id: issue.lesson_id || null,
    xlsx_row: issue.xlsx_row || null,
    message: issue.message || "",
    patch: issue.patch || null,
  });
}

function xlsxLessonKey(row) {
  return [text(row.date), text(row.teacher_name), text(row.time_slot)].join("\u0001");
}

function compareXlsxLessons(monthKey, xlsxRows) {
  const issues = [];
  const dbRows = all("SELECT * FROM lessons WHERE month_key = ?", [monthKey]);
  const dbByKey = new Map();
  for (const row of dbRows) {
    const key = xlsxLessonKey(row);
    if (!dbByKey.has(key)) dbByKey.set(key, []);
    dbByKey.get(key).push(row);
  }
  const matchedDbIds = new Set();
  const xlsxKeys = new Set();
  for (const xrow of xlsxRows) {
    const key = xlsxLessonKey(xrow);
    xlsxKeys.add(key);
    const matches = dbByKey.get(key) || [];
    if (!matches.length) {
      addXlsxIssue(issues, {
        severity: "HIGH",
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
      addXlsxIssue(issues, {
        severity: "HIGH",
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
    for (const field of ["teacher_name", "date", "lesson_status", "time_slot", "classroom", "grade", "subject", "notes", "course_status"]) {
      const xval = text(xrow[field]);
      const dval = text(dbRow[field]);
      if (xval !== dval) {
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
    const xstudents = canonicalStudents(xrow.student_names);
    const dstudents = canonicalStudents(dbRow.student_names);
    if (xstudents !== dstudents) {
      addXlsxIssue(issues, {
        severity: "CRITICAL",
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
      addXlsxIssue(issues, {
        severity: "CRITICAL",
        entity: `lesson_${dbRow.id}`,
        field: "student_count",
        xlsx_value: xrow.student_count,
        db_value: dbCount,
        lesson_id: dbRow.id,
        xlsx_row: xrow.source_row,
        message: "学生人数由学生名单拆分后计算",
      });
    }
  }
  for (const dbRow of dbRows) {
    const key = xlsxLessonKey(dbRow);
    if (!matchedDbIds.has(dbRow.id) && !xlsxKeys.has(key)) {
      addXlsxIssue(issues, {
        severity: "MEDIUM",
        entity: `lesson_${dbRow.id}`,
        field: "lesson",
        xlsx_value: "xlsx 无对应课程",
        db_value: `${dbRow.date || ""} ${dbRow.teacher_name || ""} ${dbRow.time_slot || ""}`,
        lesson_id: dbRow.id,
        message: "数据库中存在本月课程，但 xlsx 权威源中未找到；可能是事后补录，需要确认",
      });
    }
  }
  return issues;
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
          message: `${student}-${pricing.subject} 专享价与按 ${match.grade}/${match.count} 人计算的标准价差额超过 50%`,
        });
      }
    }
  }
  return issues;
}

function runNodeXlsxAudit(uploadPath, monthKey) {
  if (!validMonthKey(monthKey)) throw new Error("month must be YYYY-MM-01");
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const { sheet_name: sheetName, rows } = readXlsxTotalSheet(fs.readFileSync(uploadPath), monthKey);
  const issues = visibleAuditIssues([
    ...compareXlsxLessons(monthKey, rows),
    ...xlsxStudentCrossChecks(rows),
  ], "xlsx");
  const report = {
    run_id: runId,
    month_key: monthKey,
    source_file: path.resolve(uploadPath),
    sheet_name: sheetName,
    scanned_lessons: rows.length,
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

function spawnSafeReadRaw(req) {
  return readRawBody(req);
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
    .replace(/[—–~～至到]/g, "-")
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

function scheduleConflicts(monthKey) {
  if (!validMonthKey(monthKey)) throw new Error("month must be YYYY-MM-01");
  const lessons = all(
    "SELECT * FROM lessons WHERE month_key = ? ORDER BY date, time_slot, teacher_name, classroom, sort_order, id",
    [monthKey],
  ).filter(isScheduleActive);
  const issues = [];
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
      if (text(a.lesson.classroom) && text(a.lesson.classroom) === text(b.lesson.classroom)) {
        pushIssue({
          type: "classroom",
          date: a.lesson.date,
          time_slot: `${a.lesson.time_slot} / ${b.lesson.time_slot}`,
          entity: a.lesson.classroom,
          lesson_ids: lessonIds,
          message: `${a.lesson.classroom} 在同一时间段被重复占用`,
          lessons: lessonsText,
          lesson_details: lessonDetails,
        });
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
  return { month_key: monthKey, issue_count: issues.length, counts, issues };
}

function dateKeyFromDay(monthKey, day) {
  const [year, month] = text(monthKey).split("-");
  return `${year}-${month}-${String(day).padStart(2, "0")}`;
}

function monthWeekRanges(monthKey) {
  if (!validMonthKey(monthKey)) throw new Error("month must be YYYY-MM-01");
  const date = new Date(`${monthKey}T00:00:00`);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return [[1, 8], [9, 15], [16, 22], [23, last]].map(([start, end]) => ({
    start,
    end,
    start_date: dateKeyFromDay(monthKey, start),
    end_date: dateKeyFromDay(monthKey, end),
    label: `${date.getMonth() + 1}.${start}-${date.getMonth() + 1}.${end}`,
  }));
}

function weekRangeByIndex(monthKey, index) {
  const ranges = monthWeekRanges(monthKey);
  return ranges[Math.max(0, Math.min(ranges.length - 1, Number(index) || 0))];
}

function weeklyScheduleLessons(monthKey, weekIndex) {
  const week = weekRangeByIndex(monthKey, weekIndex);
  const lessons = all(
    `SELECT * FROM lessons
     WHERE month_key = ? AND date >= ? AND date <= ?
     ORDER BY date, teacher_name, time_slot, classroom, sort_order, id`,
    [monthKey, week.start_date, week.end_date],
  ).filter(isScheduleActive)
    .sort((a, b) => `${a.date || ""}|${a.teacher_name || ""}|${a.time_slot || ""}|${String(a.id).padStart(8, "0")}`
      .localeCompare(`${b.date || ""}|${b.teacher_name || ""}|${b.time_slot || ""}|${String(b.id).padStart(8, "0")}`, "zh-Hans-CN"));
  return { week, lessons };
}

function weeklyScheduleRows(monthKey, weekIndex, audience = "teacher") {
  if (!validMonthKey(monthKey)) throw new Error("month must be YYYY-MM-01");
  const normalizedAudience = audience === "student" ? "student" : "teacher";
  const { week, lessons } = weeklyScheduleLessons(monthKey, weekIndex);
  const rows = [];
  for (const lesson of lessons) {
    const students = splitStudents(lesson.student_names);
    const base = {
      date: lesson.date,
      weekday: weekdayCn(lesson.date),
      time_slot: lesson.time_slot,
      classroom: lesson.classroom,
      course: `${lesson.grade || ""}${lesson.subject || ""}`,
      grade: lesson.grade,
      subject: lesson.subject,
      status: deriveStatus(lesson),
      notes: lesson.notes,
    };
    if (normalizedAudience === "student") {
      for (const student of students) {
        rows.push({ ...base, recipient: student, counterpart: lesson.teacher_name });
      }
    } else {
      rows.push({ ...base, recipient: lesson.teacher_name || "未填老师", counterpart: students.join("、") });
    }
  }
  return {
    month_key: monthKey,
    week,
    audience: normalizedAudience,
    rows,
  };
}

function weeklyScheduleText(monthKey, weekIndex, audience) {
  const schedule = weeklyScheduleRows(monthKey, weekIndex, audience);
  const targetLabel = schedule.audience === "student" ? "学生" : "老师";
  const counterpartLabel = schedule.audience === "student" ? "老师" : "学生";
  const groups = new Map();
  for (const row of schedule.rows) {
    if (!groups.has(row.recipient)) groups.set(row.recipient, []);
    groups.get(row.recipient).push(row);
  }
  const lines = [`${schedule.week.label} ${targetLabel}周课表`];
  if (!schedule.rows.length) {
    lines.push("暂无课程");
    return lines.join("\n");
  }
  for (const [recipient, rows] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-Hans-CN"))) {
    lines.push("", `${recipient}：`);
    for (const row of rows) {
      const place = row.classroom ? ` ${row.classroom}` : "";
      const course = row.course || "课程";
      const counterpart = row.counterpart ? ` ${counterpartLabel}：${row.counterpart}` : "";
      const notes = row.notes ? ` 备注：${row.notes}` : "";
      lines.push(`- ${row.date} ${row.weekday} ${row.time_slot || "未填时间"}${place} ${course}${counterpart}${notes}`);
    }
  }
  return lines.join("\n");
}

function safeArchiveName(value) {
  return text(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 90) || "未命名";
}

function canonicalStudentGroup(students) {
  return splitStudents(students.join("、")).sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).join("、");
}

function scheduleCardRowsFromLessons(lessons, mode = "student") {
  return lessons.map((lesson) => ({
    date: lesson.date || "",
    weekday: weekdayCn(lesson.date),
    time_slot: lesson.time_slot || "",
    classroom: lesson.classroom || "",
    teacher_name: lesson.teacher_name || "",
    course: `${lesson.grade || ""}${lesson.subject || ""}` || "课程",
    students: splitStudents(lesson.student_names).join("、"),
    status: deriveStatus(lesson),
    notes: lesson.notes || "",
    mode,
  }));
}

function visualLength(value) {
  return [...String(value || "")].reduce((total, char) => total + (char.charCodeAt(0) > 255 ? 1.7 : 1), 0);
}

function wrapVisualText(value, maxWidth = 48, maxLines = 3) {
  const textValue = text(value);
  if (!textValue) return [];
  const lines = [];
  let current = "";
  let currentWidth = 0;
  for (const char of [...textValue]) {
    const charWidth = char.charCodeAt(0) > 255 ? 1.7 : 1;
    if (current && currentWidth + charWidth > maxWidth) {
      lines.push(current);
      current = char;
      currentWidth = charWidth;
      if (lines.length >= maxLines) break;
    } else {
      current += char;
      currentWidth += charWidth;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (visualLength(textValue) > maxWidth * maxLines && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/.{1,2}$/u, "")}…`;
  }
  return lines;
}

function svgTextLines({ x, y, lines, size = 26, weight = 500, fill = "#1f2937", lineHeight = 34, anchor = "start" }) {
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + index * lineHeight}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${fill}">${xmlEscape(line)}</text>`
  )).join("");
}

function scheduleCardSvg({ title, subtitle, rows, badge = "黎明教育" }) {
  const safeRows = rows.length ? rows : [{
    date: "",
    weekday: "",
    time_slot: "本周暂无课程",
    classroom: "",
    teacher_name: "",
    course: "",
    students: "",
    status: "",
    notes: "",
  }];
  const width = 1080;
  const headerHeight = 236;
  const footerHeight = 76;
  const preparedRows = safeRows.map((row) => {
    const dateLine = [row.date, row.weekday, row.time_slot || "未填时间"].filter(Boolean).join("  ");
    const meta = [
      row.teacher_name ? `老师：${row.teacher_name}` : "",
      row.classroom ? `教室：${row.classroom}` : "",
      row.status ? `状态：${row.status}` : "",
    ].filter(Boolean).join(" · ");
    const students = row.students ? `学生：${row.students}` : "";
    const notes = row.notes ? `备注：${row.notes}` : "";
    const detailLines = wrapVisualText([students, notes].filter(Boolean).join(" · "), 50, 3);
    return {
      row,
      dateLine,
      metaLines: wrapVisualText(meta, 34, 2),
      detailLines,
      height: detailLines.length ? 160 + Math.max(0, detailLines.length - 1) * 26 : 122,
    };
  });
  const height = headerHeight + preparedRows.reduce((total, row) => total + row.height, 0) + footerHeight;
  let yCursor = headerHeight;
  const rowSvg = preparedRows.map((item, index) => {
    const y = yCursor;
    yCursor += item.height;
    const courseText = item.row.course || "课程";
    const accent = ["#0f766e", "#175cd3", "#b54708", "#7c3aed"][index % 4];
    return `
      <g transform="translate(52 ${y})">
        <rect width="976" height="${item.height - 18}" rx="24" fill="#ffffff" stroke="#dce7ea"/>
        <rect width="8" height="${item.height - 18}" rx="4" fill="${accent}"/>
        <text x="28" y="40" font-size="26" font-weight="800" fill="#12232f">${xmlEscape(item.dateLine)}</text>
        <rect x="28" y="58" width="${Math.min(230, Math.max(126, visualLength(courseText) * 15))}" height="38" rx="19" fill="#e7f6f3"/>
        <text x="46" y="84" font-size="21" font-weight="800" fill="#0f766e">${xmlEscape(courseText)}</text>
        ${svgTextLines({ x: 308, y: 84, lines: item.metaLines, size: 20, weight: 650, fill: "#344454", lineHeight: 27 })}
        ${svgTextLines({ x: 28, y: 126, lines: item.detailLines, size: 19, weight: 500, fill: "#667780", lineHeight: 26 })}
      </g>
    `;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xmlEscape(title)}" font-family="'Noto Sans SC','HarmonyOS Sans SC','Microsoft YaHei UI','PingFang SC',Arial,sans-serif">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#eef7f5"/>
      <stop offset="100%" stop-color="#edf3ff"/>
    </linearGradient>
    <linearGradient id="head" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#082032"/>
      <stop offset="58%" stop-color="#0b3040"/>
      <stop offset="100%" stop-color="#0f766e"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#123143" flood-opacity="0.14"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" rx="34" fill="url(#bg)"/>
  <rect x="26" y="26" width="${width - 52}" height="${height - 52}" rx="30" fill="#fbfdfc" filter="url(#shadow)"/>
  <rect x="26" y="26" width="${width - 52}" height="184" rx="30" fill="url(#head)"/>
  <rect x="26" y="156" width="${width - 52}" height="70" fill="#fbfdfc"/>
  <g transform="translate(58 58)">
    <rect x="0" y="0" width="132" height="40" rx="20" fill="#ffffff" fill-opacity="0.14" stroke="#ffffff" stroke-opacity="0.32"/>
    <text x="66" y="27" text-anchor="middle" font-size="17" font-weight="800" fill="#d9fff7">${xmlEscape(badge)}</text>
    <text x="0" y="93" font-size="42" font-weight="900" fill="#ffffff">${xmlEscape(title)}</text>
    <text x="0" y="132" font-size="22" font-weight="600" fill="#c8dae2">${xmlEscape(subtitle)}</text>
    <text x="920" y="38" text-anchor="end" font-size="20" font-weight="800" fill="#d9fff7">${xmlEscape(new Date().toLocaleDateString("zh-CN"))}</text>
  </g>
  ${rowSvg}
  <text x="58" y="${height - 36}" font-size="17" fill="#82929d">按 日期 - 老师 - 时间 排序 · 由黎明教育课程管理系统生成</text>
</svg>`;
}

function weeklyScheduleImageFiles(monthKey, weekIndex, audience = "all") {
  if (!validMonthKey(monthKey)) throw new Error("month must be YYYY-MM-01");
  const normalizedAudience = ["teacher", "student", "all"].includes(audience) ? audience : "all";
  const { week, lessons } = weeklyScheduleLessons(monthKey, weekIndex);
  const files = [{
    name: "README.txt",
    data: [
      `${monthKey} ${week.label} 周课表图片包`,
      "图片格式为 SVG，可直接在浏览器打开；如需发送 PNG，可用浏览器打开后另存或截图。",
      "学生规则：有一对一课程的学生生成个人课表；2 人及以上班课按班课生成一张共享图片。",
    ].join("\r\n"),
  }];

  if (normalizedAudience === "teacher" || normalizedAudience === "all") {
    const byTeacher = new Map();
    for (const lesson of lessons) {
      const teacher = lesson.teacher_name || "未填老师";
      if (!byTeacher.has(teacher)) byTeacher.set(teacher, []);
      byTeacher.get(teacher).push(lesson);
    }
    for (const [teacher, teacherLessons] of [...byTeacher.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-Hans-CN"))) {
      files.push({
        name: `老师课表/${safeArchiveName(teacher)}老师_${week.label}.svg`,
        data: scheduleCardSvg({
          title: `${teacher}老师本周课表`,
          subtitle: `${monthKey.slice(0, 7)} ${week.label} · 共 ${teacherLessons.length} 节课`,
          rows: scheduleCardRowsFromLessons(teacherLessons, "teacher"),
          badge: "老师课表",
        }),
      });
    }
  }

  if (normalizedAudience === "student" || normalizedAudience === "all") {
    const byStudent = new Map();
    const personalStudents = new Set();
    const groupClasses = new Map();
    for (const lesson of lessons) {
      const students = splitStudents(lesson.student_names);
      for (const student of students) {
        if (!byStudent.has(student)) byStudent.set(student, []);
        byStudent.get(student).push(lesson);
      }
      if (students.length === 1) {
        personalStudents.add(students[0]);
      } else if (students.length >= 2) {
        const groupKey = [
          lesson.teacher_name || "未填老师",
          lesson.grade || "",
          lesson.subject || "",
          canonicalStudentGroup(students),
        ].join("|");
        if (!groupClasses.has(groupKey)) {
          groupClasses.set(groupKey, {
            teacher: lesson.teacher_name || "未填老师",
            grade: lesson.grade || "",
            subject: lesson.subject || "",
            students,
            lessons: [],
          });
        }
        groupClasses.get(groupKey).lessons.push(lesson);
      }
    }
    for (const student of [...personalStudents].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))) {
      const studentLessons = byStudent.get(student) || [];
      files.push({
        name: `学生个人课表/${safeArchiveName(student)}_${week.label}.svg`,
        data: scheduleCardSvg({
          title: `${student}本周课表`,
          subtitle: `${monthKey.slice(0, 7)} ${week.label} · 共 ${studentLessons.length} 节课`,
          rows: scheduleCardRowsFromLessons(studentLessons, "student"),
          badge: "学生课表",
        }),
      });
    }
    for (const group of [...groupClasses.values()].sort((a, b) => `${a.teacher}|${a.grade}|${a.subject}|${a.students.join("、")}`.localeCompare(`${b.teacher}|${b.grade}|${b.subject}|${b.students.join("、")}`, "zh-Hans-CN"))) {
      const title = `${group.grade}${group.subject}班课周课表`;
      const subtitle = `${group.teacher}老师 · ${group.students.join("、")} · 共 ${group.lessons.length} 节课`;
      files.push({
        name: `班课共享课表/${safeArchiveName(`${group.grade}${group.subject}_${group.teacher}_${group.students.join("、")}`)}_${week.label}.svg`,
        data: scheduleCardSvg({
          title,
          subtitle,
          rows: scheduleCardRowsFromLessons(group.lessons, "class"),
          badge: "班课共享",
        }),
      });
    }
  }

  return { week, files };
}

function weeklySchedulePngManifest(monthKey, weekIndex, audience = "all") {
  const result = weeklyScheduleImageFiles(monthKey, weekIndex, audience);
  const files = [{
    name: "README.txt",
    type: "text",
    text: [
      `${monthKey} ${result.week.label} 周课表 PNG 图片包`,
      "包内图片均为 PNG，可直接预览、转发或发送给老师和学生。",
      "学生规则：有一对一课程的学生生成个人课表；2 人及以上班课按班课生成一张共享图片。",
    ].join("\r\n"),
  }];
  for (const file of result.files) {
    if (!String(file.name).toLowerCase().endsWith(".svg")) continue;
    files.push({
      name: file.name.replace(/\.svg$/i, ".png"),
      type: "svg",
      svg: file.data,
    });
  }
  return {
    month_key: monthKey,
    week: result.week,
    files,
  };
}

function applyAuditPatch(issue) {
  const patch = issue.patch || {};
  if (patch.type === "insert_lesson" && patch.lesson) {
    insertLesson(patch.lesson);
    return true;
  }
  if (patch.type === "lesson" && patch.id) {
    const allowed = ["teacher_name", "date", "lesson_status", "time_slot", "classroom", "grade", "subject", "student_names", "notes", "course_status", "status"];
    const payload = {};
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, field)) payload[field] = patch[field];
    }
    if (Object.keys(payload).length) {
      if (Object.prototype.hasOwnProperty.call(payload, "status")) Object.assign(payload, legacyStatusFields(payload.status));
      patchTable("lessons", "id", Number(patch.id), [...allowed, "teacher_salary", "month_key", "sort_order"], { ...payload, updated_at: new Date().toISOString() });
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
  let fixed = 0;
  let skipped = 0;
  for (const issue of issues) {
    if (issue.severity === "CRITICAL" && !confirmCritical) {
      skipped += 1;
      continue;
    }
    if (applyAuditPatch(issue)) {
      fixed += 1;
      if (issue.audit_log_id) db.prepare("UPDATE audit_logs SET status = 'fixed' WHERE id = ?").run(Number(issue.audit_log_id));
    } else {
      skipped += 1;
    }
  }
  return { ok: true, fixed, skipped, backup };
}

function ignoreAuditIssues(ids, issueKeys = []) {
  const backup = backupDb();
  let ignored = 0;
  const keys = new Set(issueKeys.map(text).filter(Boolean));
  for (const id of ids.map(Number).filter(Boolean)) {
    const log = get("SELECT * FROM audit_logs WHERE id = ?", [id]);
    if (!log) continue;
    const issueKey = text(log.issue_key) || auditLogFallbackKey(log);
    keys.add(issueKey);
    const result = db.prepare("UPDATE audit_logs SET status = 'ignored', issue_key = ? WHERE id = ?").run(issueKey, id);
    ignored += result.changes || 0;
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
  return { ok: true, ignored, ignored_keys: keys.size, backup };
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
        message: "⚠ 专享价与标准价差额较大，建议在备注里说明原因",
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

function insertLesson(data) {
  const monthKey = data.month_key || getSetting("month_key");
  const status = deriveStatus(data);
  const legacy = legacyStatusFields(status);
  const result = db.prepare(`
    INSERT INTO lessons(
      teacher_name, date, lesson_status, time_slot, classroom, grade, subject,
      student_names, notes, course_status, status, teacher_salary, month_key, sort_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    num(data.teacher_salary),
    text(monthKey),
    num(data.sort_order),
  );
  return get("SELECT * FROM lessons WHERE id = ?", [Number(result.lastInsertRowid)]);
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
        teacher_salary: src.teacher_salary,
        month_key: monthKeyFromDate(pair.target_date),
        sort_order: sortOrder,
      }));
    }
    return { created: created.length, lessons: created };
  });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/months") return sendJson(res, availableMonths());
  if (req.method === "POST" && url.pathname === "/api/months") {
    const body = await readBody(req);
    const monthKey = text(body.month_key);
    if (!/^\d{4}-\d{2}-01$/.test(monthKey)) return sendError(res, 400, "month_key must be YYYY-MM-01");
    const result = createMonth(monthKey);
    return sendJson(res, result, result.created ? 201 : 200);
  }
  const monthMatch = url.pathname.match(/^\/api\/months\/(\d{4}-\d{2}-01)$/);
  if (monthMatch && req.method === "DELETE") {
    const monthKey = monthMatch[1];
    const result = deleteMonth(monthKey, url.searchParams.get("force") === "1");
    if (result.blocked && result.reason === "has_data") return sendJson(res, { counts: result.counts }, 409);
    if (result.blocked) return sendJson(res, { error: result.reason, counts: result.counts }, 400);
    return sendJson(res, result);
  }
  if (req.method === "GET" && url.pathname === "/api/audit/logs") {
    return sendJson(res, { logs: recentAuditLogs(Number(url.searchParams.get("limit") || 200)) });
  }
  if (req.method === "GET" && url.pathname === "/api/audit-logs") {
    return sendJson(res, { logs: recentAuditLogs(Number(url.searchParams.get("limit") || 200)) });
  }
  if (req.method === "GET" && url.pathname === "/api/audit/internal-checks") {
    return sendJson(res, internalAudit(resolveMonthKey(url), { log: url.searchParams.get("log") !== "0" }));
  }
  if (req.method === "POST" && url.pathname === "/api/audit/xlsx-diff") {
    return sendJson(res, await runXlsxAuditFromUpload(req, url));
  }
  if (req.method === "POST" && url.pathname === "/api/audit/apply") {
    const body = await readBody(req);
    return sendJson(res, applyAuditIssues(body.issues || [], body.confirm_critical === true));
  }
  if (req.method === "POST" && url.pathname === "/api/audit/ignore") {
    const body = await readBody(req);
    return sendJson(res, ignoreAuditIssues(body.ids || [], body.issue_keys || []));
  }
  if (req.method === "GET" && url.pathname === "/api/schedule-conflicts") {
    return sendJson(res, scheduleConflicts(resolveMonthKey(url)));
  }
  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    return sendJson(res, bootstrap(resolveMonthKey(url), url.searchParams.get("include_inactive") === "1"));
  }
  if (req.method === "GET" && url.pathname === "/api/finance-summary") {
    const range = financeRangeFromUrl(url);
    if (!range) return sendError(res, 400, "start/end must be YYYY-MM-DD and start must be before end");
    return sendJson(res, financeSummary(range));
  }
  if (req.method === "GET" && url.pathname === "/api/derived") {
    const monthKey = resolveMonthKey(url);
    const includeInactive = url.searchParams.get("include_inactive") === "1";
    const details = feeDetails(monthKey);
    return sendJson(res, {
      fee_details: details,
      student_summary: studentSummary(details, monthKey, includeInactive),
      teacher_summary: teacherSummary(monthKey, includeInactive),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/teachers") return sendJson(res, { teachers: teacherProfiles() });
  if (req.method === "POST" && url.pathname === "/api/teachers") {
    const result = createTeacherProfile(await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    return sendJson(res, result, 201);
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
    return sendJson(res, { ...result, warnings: studentWarnings(result.name, result.grade) }, 201);
  }

  if (req.method === "GET" && url.pathname === "/api/staff") return sendJson(res, { staff: staffRows() });
  if (req.method === "POST" && url.pathname === "/api/staff") {
    const result = createStaff(await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    return sendJson(res, result, 201);
  }
  const staffMatch = url.pathname.match(/^\/api\/staff\/(\d+)$/);
  if (staffMatch && req.method === "PATCH") {
    const result = patchStaff(Number(staffMatch[1]), await readBody(req));
    if (!result) return sendError(res, 404, "staff not found");
    if (result.error) return sendError(res, result.status || 400, result.error);
    return sendJson(res, result);
  }
  if (staffMatch && req.method === "DELETE") {
    const result = deleteStaff(Number(staffMatch[1]));
    if (!result) return sendError(res, 404, "staff not found");
    return sendJson(res, result);
  }

  if (req.method === "GET" && url.pathname === "/api/staff-salary") {
    const monthKey = resolveMonthKey(url);
    if (!validMonthKey(monthKey)) return sendError(res, 400, "month must be YYYY-MM-01");
    return sendJson(res, { rows: staffSalaryRows(monthKey) });
  }
  if (req.method === "POST" && url.pathname === "/api/staff-salary") {
    const result = upsertStaffSalary(await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    return sendJson(res, result);
  }
  const staffSalaryMatch = url.pathname.match(/^\/api\/staff-salary\/(\d+)$/);
  if (staffSalaryMatch && req.method === "DELETE") {
    const result = withTransaction(() => db.prepare("DELETE FROM staff_salary_monthly WHERE id = ?").run(Number(staffSalaryMatch[1])));
    return sendJson(res, { deleted: (result.changes || 0) > 0 });
  }

  if (req.method === "GET" && url.pathname === "/api/operating-expenses") return sendJson(res, { expenses: expenseRows(url) });
  if (req.method === "POST" && url.pathname === "/api/operating-expenses") {
    const result = createExpense(await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    return sendJson(res, result, 201);
  }
  const expenseMatch = url.pathname.match(/^\/api\/operating-expenses\/(\d+)$/);
  if (expenseMatch && req.method === "PATCH") {
    const result = patchExpense(Number(expenseMatch[1]), await readBody(req));
    if (!result) return sendError(res, 404, "expense not found");
    if (result.error) return sendError(res, result.status || 400, result.error);
    return sendJson(res, result);
  }
  if (expenseMatch && req.method === "DELETE") {
    const result = withTransaction(() => db.prepare("DELETE FROM operating_expenses WHERE id = ?").run(Number(expenseMatch[1])));
    return sendJson(res, { deleted: (result.changes || 0) > 0 });
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
    const rows = studentStatementRows(monthKey, studentName);
    if (!rows) return sendError(res, 404, "student statement not found");
    return sendBuffer(
      res,
      xlsxBuffer("学生账单", rows),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      `student-statement-${studentName}-${monthKey}.xlsx`,
    );
  }

  if (req.method === "GET" && url.pathname === "/api/export/finance-summary.csv") {
    const range = financeRangeFromUrl(url);
    if (!range) return sendError(res, 400, "start/end must be YYYY-MM-DD and start must be before end");
    const summary = financeSummary(range);
    return sendCsv(res, financeCsvRows(summary), `经营概览_${summary.range.start}_至_${summary.range.end}.csv`);
  }

  if (req.method === "GET" && url.pathname === "/api/export/weekly-schedule.txt") {
    const monthKey = resolveMonthKey(url);
    const week = Number(url.searchParams.get("week") || 0);
    const audience = url.searchParams.get("audience") === "student" ? "student" : "teacher";
    const label = audience === "student" ? "学生" : "老师";
    return sendText(res, weeklyScheduleText(monthKey, week, audience), `${label}周课表_${monthKey}_第${week + 1}周.txt`);
  }

  if (req.method === "GET" && url.pathname === "/api/export/weekly-schedule-images.json") {
    const monthKey = resolveMonthKey(url);
    const week = Number(url.searchParams.get("week") || 0);
    const audienceParam = url.searchParams.get("audience");
    const audience = ["teacher", "student", "all"].includes(audienceParam) ? audienceParam : "all";
    const label = audience === "teacher" ? "老师" : audience === "student" ? "学生与班课" : "全部";
    return sendJson(res, {
      ...weeklySchedulePngManifest(monthKey, week, audience),
      filename: `${label}周课表PNG_${monthKey}_第${week + 1}周.zip`,
    });
  }

  if (req.method === "GET" && url.pathname === "/api/export/weekly-schedule-images.zip") {
    const monthKey = resolveMonthKey(url);
    const week = Number(url.searchParams.get("week") || 0);
    const audienceParam = url.searchParams.get("audience");
    const audience = ["teacher", "student", "all"].includes(audienceParam) ? audienceParam : "all";
    const label = audience === "teacher" ? "老师" : audience === "student" ? "学生与班课" : "全部";
    const result = weeklyScheduleImageFiles(monthKey, week, audience);
    return sendBuffer(
      res,
      zipStore(result.files),
      "application/zip",
      `${label}周课表图片_${monthKey}_第${week + 1}周.zip`,
    );
  }

  if (req.method === "POST" && url.pathname === "/api/recharges/rollover") {
    const fromMonth = text(url.searchParams.get("from"));
    const toMonth = text(url.searchParams.get("to"));
    const force = url.searchParams.get("force") === "1";
    return sendJson(res, rolloverRecharges(fromMonth, toMonth, force));
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    const body = await readBody(req);
    for (const [key, value] of Object.entries(body)) setSetting(key, text(value));
    return sendJson(res, bootstrap(text(body.month_key) || getSetting("month_key"), url.searchParams.get("include_inactive") === "1"));
  }

  if (req.method === "POST" && url.pathname === "/api/lessons/copy") {
    const result = copyLessons(await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    return sendJson(res, result, 201);
  }

  if (req.method === "POST" && url.pathname === "/api/lessons") {
    const body = await readBody(req);
    const lesson = insertLesson(body);
    return sendJson(res, { ...lesson, warnings: lessonWarnings(lesson) }, 201);
  }

  const lessonMatch = url.pathname.match(/^\/api\/lessons\/(\d+)$/);
  if (lessonMatch && req.method === "PATCH") {
    const body = await readBody(req);
    const current = get("SELECT * FROM lessons WHERE id = ?", [Number(lessonMatch[1])]) || {};
    const payload = { ...body, updated_at: new Date().toISOString() };
    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      Object.assign(payload, legacyStatusFields(body.status));
    } else if (Object.prototype.hasOwnProperty.call(body, "lesson_status") || Object.prototype.hasOwnProperty.call(body, "course_status")) {
      payload.status = deriveStatus({ ...current, ...body });
    }
    patchTable("lessons", "id", Number(lessonMatch[1]), [
      "teacher_name", "date", "lesson_status", "time_slot", "classroom", "grade", "subject",
      "student_names", "notes", "course_status", "status", "teacher_salary", "month_key", "sort_order",
    ], payload);
    const updated = get("SELECT * FROM lessons WHERE id = ?", [Number(lessonMatch[1])]);
    return sendJson(res, { ...updated, warnings: lessonWarnings(updated) });
  }
  if (lessonMatch && req.method === "DELETE") {
    db.prepare("DELETE FROM lessons WHERE id = ?").run(Number(lessonMatch[1]));
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
    patchTable("teachers", "id", Number(teacherIdMatch[1]), ["name", "phone", "notes", "status", "joined_at", "left_at"], payload);
    return sendJson(res, get("SELECT * FROM teachers WHERE id = ?", [Number(teacherIdMatch[1])]));
  }
  if (teacherIdMatch && req.method === "DELETE") {
    const result = deleteTeacherProfile(Number(teacherIdMatch[1]));
    if (!result) return sendError(res, 404, "teacher not found");
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
    patchTable("students", "id", Number(studentIdMatch[1]), [
      "name", "grade", "phone", "guardian", "notes", "status", "joined_at", "left_at",
    ], payload);
    const row = get("SELECT * FROM students WHERE id = ?", [Number(studentIdMatch[1])]);
    return sendJson(res, { ...row, warnings: studentWarnings(row.name, row.grade) });
  }
  if (studentIdMatch && req.method === "DELETE") {
    const result = deleteStudentProfile(Number(studentIdMatch[1]));
    if (!result) return sendError(res, 404, "student not found");
    return sendJson(res, result);
  }

  const studentMatch = url.pathname.match(/^\/api\/students\/(.+)$/);
  if (studentMatch && req.method === "PATCH") {
    const studentName = decodeURIComponent(studentMatch[1]);
    const body = await readBody(req);
    const grade = text(body.grade);
    backupDb();
    db.prepare(`
      INSERT INTO students(name, grade) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET grade = excluded.grade
    `).run(studentName, grade);
    return sendJson(res, { ok: true, student_name: studentName, grade, warnings: studentWarnings(studentName, grade) });
  }

  const pricingMatch = url.pathname.match(/^\/api\/pricing-standards\/(\d+)$/);
  if (pricingMatch && req.method === "PATCH") {
    const body = await readBody(req);
    patchTable("pricing_standards", "id", Number(pricingMatch[1]), ["unit_price", "description"], body);
    return sendJson(res, get("SELECT * FROM pricing_standards WHERE id = ?", [Number(pricingMatch[1])]));
  }

  if (req.method === "POST" && url.pathname === "/api/pricing-recompute") {
    const result = recomputePricing(await readBody(req));
    if (result.error) return sendError(res, result.status || 400, result.error);
    return sendJson(res, result);
  }

  if (req.method === "POST" && url.pathname === "/api/student-pricing") {
    const body = await readBody(req);
    const result = db.prepare(`
      INSERT INTO student_pricing(student_name, subject, custom_price, notes)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(student_name, subject) DO UPDATE SET
        custom_price = excluded.custom_price,
        notes = excluded.notes
    `).run(text(body.student_name), text(body.subject), num(body.custom_price), text(body.notes));
    return sendJson(res, { id: Number(result.lastInsertRowid), ok: true, warnings: pricingWarnings(body) }, 201);
  }
  const studentPricingMatch = url.pathname.match(/^\/api\/student-pricing\/(\d+)$/);
  if (studentPricingMatch && req.method === "PATCH") {
    const body = await readBody(req);
    patchTable("student_pricing", "id", Number(studentPricingMatch[1]), ["student_name", "subject", "custom_price", "notes"], body);
    const row = get("SELECT * FROM student_pricing WHERE id = ?", [Number(studentPricingMatch[1])]);
    return sendJson(res, { ...row, warnings: pricingWarnings(row) });
  }
  if (studentPricingMatch && req.method === "DELETE") {
    db.prepare("DELETE FROM student_pricing WHERE id = ?").run(Number(studentPricingMatch[1]));
    return sendJson(res, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/recharges") {
    const body = await readBody(req);
    const monthKey = text(body.month_key || getSetting("month_key"));
    db.prepare(`
      INSERT INTO recharge_records(
        student_name, grade, prev_actual, prev_gift, cur_recharge, cur_gift, recharge_date, notes, source, month_key
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_name, month_key) DO UPDATE SET
        grade = excluded.grade,
        prev_actual = excluded.prev_actual,
        prev_gift = excluded.prev_gift,
        cur_recharge = excluded.cur_recharge,
        cur_gift = excluded.cur_gift,
        recharge_date = excluded.recharge_date,
        notes = excluded.notes
    `).run(
      text(body.student_name),
      text(body.grade),
      num(body.prev_actual),
      num(body.prev_gift),
      num(body.cur_recharge),
      num(body.cur_gift),
      text(body.recharge_date),
      text(body.notes),
      text(body.source),
      monthKey,
    );
    return sendJson(res, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/fee-overrides") {
    const body = await readBody(req);
    const lessonId = Number(body.lesson_id);
    const studentName = text(body.student_name);
    if (!lessonId || !studentName) return sendError(res, 400, "lesson_id and student_name are required");
    if (body.unit_price === "" || body.unit_price == null) {
      db.prepare("DELETE FROM fee_overrides WHERE lesson_id = ? AND student_name = ?").run(lessonId, studentName);
    } else {
      db.prepare(`
        INSERT INTO fee_overrides(lesson_id, student_name, unit_price, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(lesson_id, student_name) DO UPDATE SET
          unit_price = excluded.unit_price,
          updated_at = CURRENT_TIMESTAMP
      `).run(lessonId, studentName, num(body.unit_price));
    }
    return sendJson(res, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/teacher-adjustments") {
    const body = await readBody(req);
    const monthKey = text(body.month_key || getSetting("month_key"));
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

