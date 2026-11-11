const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const CHILDREN = ["tg_periods", "tg_rules", "tg_attendance", "tg_ledger"];
const TABLES = [
  "tg_students",
  "tg_legacy_student_map",
  "tg_periods",
  "tg_rules",
  "tg_calendar",
  "tg_attendance",
  "tg_ledger",
  "tg_requests",
  "tg_audit",
  "tg_imports",
  "tg_import_sources",
];
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tg_students(id INTEGER PRIMARY KEY,name TEXT NOT NULL,grade TEXT NOT NULL DEFAULT '',class_name TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tg_legacy_student_map(id INTEGER PRIMARY KEY,student_id INTEGER NOT NULL UNIQUE REFERENCES tg_students(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tg_periods(id INTEGER PRIMARY KEY,student_id INTEGER NOT NULL REFERENCES tg_students(id),grade TEXT NOT NULL,class_name TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT,status TEXT NOT NULL DEFAULT '在托',notes TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS tg_period_dates ON tg_periods(student_id,start_date,end_date);
CREATE TABLE IF NOT EXISTS tg_rules(id INTEGER PRIMARY KEY,student_id INTEGER REFERENCES tg_students(id),effective_date TEXT NOT NULL,present INTEGER NOT NULL,leave_fee INTEGER NOT NULL,absent INTEGER NOT NULL,notes TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL,end_date TEXT,pending INTEGER NOT NULL DEFAULT 0,source_import_id TEXT);
CREATE TABLE IF NOT EXISTS tg_calendar(date TEXT PRIMARY KEY,enabled INTEGER NOT NULL,teacher_id INTEGER REFERENCES teachers(id),time_slot TEXT NOT NULL DEFAULT '18:30—21:30',leave_deadline TEXT NOT NULL DEFAULT '17:30',notes TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS tg_attendance(id INTEGER PRIMARY KEY,student_id INTEGER NOT NULL REFERENCES tg_students(id),date TEXT NOT NULL,status TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',grade TEXT NOT NULL,class_name TEXT NOT NULL,rule_json TEXT NOT NULL,fee INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,pending INTEGER NOT NULL DEFAULT 0,reference_fee INTEGER NOT NULL DEFAULT 0,source_import_id TEXT,source_key TEXT,source_cell TEXT,raw_status TEXT,UNIQUE(student_id,date));
CREATE TABLE IF NOT EXISTS tg_ledger(id INTEGER PRIMARY KEY,student_id INTEGER NOT NULL REFERENCES tg_students(id),date TEXT NOT NULL,kind TEXT NOT NULL,amount INTEGER NOT NULL,method TEXT NOT NULL DEFAULT '',voucher TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL,actor TEXT NOT NULL,attendance_id INTEGER REFERENCES tg_attendance(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS tg_ledger_student_date ON tg_ledger(student_id,date);
CREATE TABLE IF NOT EXISTS tg_requests(key TEXT PRIMARY KEY,payload TEXT NOT NULL,result TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tg_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tg_imports(id TEXT PRIMARY KEY,payload TEXT NOT NULL,result TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tg_import_sources(id TEXT PRIMARY KEY,import_id TEXT NOT NULL REFERENCES tg_imports(id),source_key TEXT NOT NULL,student_id INTEGER REFERENCES tg_students(id),status TEXT NOT NULL DEFAULT '待确认',basis TEXT NOT NULL DEFAULT '',UNIQUE(import_id,source_key));
`;
function digest(rows) {
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
function legacyProfiles(data) {
  const ids = [
    ...new Set(
      CHILDREN.flatMap((t) => (data[t] || []).map((r) => r.student_id)).filter(
        (id) => id != null,
      ),
    ),
  ].sort((a, b) => a - b);
  return ids.map((id) => {
    const s = (data.students || []).find((s) => s.id === id);
    if (!s) throw Error("托管旧记录引用缺失学生，迁移已取消");
    const p = (data.tg_periods || [])
      .filter((p) => p.student_id === id)
      .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
    return {
      id,
      name: s.name,
      grade: p?.grade || s.grade || "",
      class_name: p?.class_name || "",
      notes: "从旧托管引用独立迁移",
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
}
function upgradeLegacyBackup(data) {
  for (const a of data.tg_attendance || [])
    if (!Object.hasOwn(a, "reference_fee"))
      a.reference_fee = legacyReference(a);
  data.tg_students = legacyProfiles(data);
  data.tg_legacy_student_map = data.tg_students.map((s) => ({
    id: s.id,
    student_id: s.id,
    created_at: s.created_at,
  }));
  data.tg_import_sources ||= [];
  return data;
}
function legacyReference(a) {
  if (!a.pending) return 0;
  try {
    const r = JSON.parse(a.rule_json),
      value =
        r[{ 出勤: "present", 请假: "leave_fee", 缺勤: "absent" }[a.status]];
    return Number.isSafeInteger(value) && value >= 0 && value <= 10000000000
      ? value
      : 0;
  } catch {
    return 0;
  }
}
function migrate(db) {
  const exists = (t) =>
    !!db
      .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?")
      .get(t);
  const legacy = CHILDREN.filter(
    (t) =>
      exists(t) &&
      db
        .prepare(`PRAGMA foreign_key_list(${t})`)
        .all()
        .some((f) => f.table === "students"),
  );
  const foreignKeys = db.prepare("PRAGMA foreign_keys").get().foreign_keys;
  let backup = null;
  if (legacy.length) {
    const file = db
      .prepare("PRAGMA database_list")
      .all()
      .find((r) => r.name === "main")?.file;
    if (file) {
      const dir = path.join(path.dirname(file), "backups");
      fs.mkdirSync(dir, { recursive: true });
      backup = path.join(
        dir,
        path.basename(file) +
          ".pre-tuoguan-independent-" +
          Date.now() +
          ".sqlite",
      );
      db.prepare("VACUUM INTO ?").run(backup);
    }
  }
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  try {
    let migrated = 0;
    if (legacy.length) {
      if (
        exists("tg_students") &&
        db.prepare("SELECT COUNT(*) n FROM tg_students").get().n
      )
        throw Error("旧外键与独立档案混用，拒绝自动覆盖");
      const old = Object.fromEntries(
        ["students", ...CHILDREN].map((t) => [
          t,
          exists(t) ? db.prepare(`SELECT * FROM ${t} ORDER BY id`).all() : [],
        ]),
      );
      const profiles = legacyProfiles(old);
      db.exec(SCHEMA);
      for (const s of profiles) {
        db.prepare(
          "INSERT INTO tg_students(id,name,grade,class_name,notes) VALUES (?,?,?,?,?)",
        ).run(s.id, s.name, s.grade, s.class_name, s.notes);
        db.prepare(
          "INSERT INTO tg_legacy_student_map(id,student_id) VALUES (?,?)",
        ).run(s.id, s.id);
      }
      // Copy and verify every column before replacing any legacy table. Keeping IDs
      // preserves ledger links, audit JSON and already-completed idempotency results.
      const indexes = [];
      for (const t of legacy) {
        const sql = db
          .prepare("SELECT sql FROM sqlite_schema WHERE name=?")
          .get(t).sql;
        indexes.push(
          ...db
            .prepare(
              "SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
            )
            .all(t)
            .map((r) => r.sql),
        );
        db.exec(
          sql
            .replace(
              /^CREATE TABLE[^\(]+\(/i,
              "CREATE TABLE " + t + "_independent(",
            )
            .replace(
              /REFERENCES\s+"?students"?\s*\(/gi,
              "REFERENCES tg_students(",
            ),
        );
        db.exec(`INSERT INTO ${t}_independent SELECT * FROM ${t}`);
        if (
          digest(
            db.prepare(`SELECT * FROM ${t}_independent ORDER BY id`).all(),
          ) !== digest(old[t])
        )
          throw Error("迁移复制校验失败");
      }
      for (const t of [...legacy].reverse()) db.exec(`DROP TABLE ${t}`);
      for (const t of legacy)
        db.exec(`ALTER TABLE ${t}_independent RENAME TO ${t}`);
      for (const sql of indexes) db.exec(sql);
      if (
        digest(db.prepare("SELECT * FROM students ORDER BY id").all()) !==
        digest(old.students)
      )
        throw Error("原学生数据校验失败");
      migrated = profiles.length;
    }
    db.exec(SCHEMA);
    const additions = {
      tg_rules: {
        end_date: "TEXT",
        pending: "INTEGER NOT NULL DEFAULT 0",
        source_import_id: "TEXT",
      },
      tg_attendance: {
        reference_fee: "INTEGER NOT NULL DEFAULT 0",
        source_import_id: "TEXT",
        source_key: "TEXT",
        source_cell: "TEXT",
        raw_status: "TEXT",
      },
    };
    for (const [t, fields] of Object.entries(additions)) {
      const cols = new Set(
        db
          .prepare(`PRAGMA table_info(${t})`)
          .all()
          .map((r) => r.name),
      );
      for (const [name, type] of Object.entries(fields))
        if (!cols.has(name))
          db.exec(`ALTER TABLE ${t} ADD COLUMN ${name} ${type}`);
      if (t === "tg_attendance" && !cols.has("reference_fee")) {
        const put = db.prepare(
          "UPDATE tg_attendance SET reference_fee=? WHERE id=?",
        );
        for (const row of db
          .prepare("SELECT * FROM tg_attendance WHERE pending=1")
          .all())
          put.run(legacyReference(row), row.id);
      }
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw Error("迁移外键校验失败，已回滚");
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw Error("迁移完整性校验失败，已回滚");
    db.exec("COMMIT");
    return { migrated, backup };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.exec("PRAGMA foreign_keys=" + foreignKeys);
  }
}
module.exports = { TABLES, migrate, upgradeLegacyBackup };
