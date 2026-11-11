const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { migrate, createStore, TABLES } = require("../src/domain/tuoguan");
const { stage, commit, suggestions } = require("../src/domain/tuoguan_import");
const { upgradeLegacyBackup } = require("../src/domain/tuoguan_schema");
test("legacy pending attendance gains a reference amount without posting funds", () => {
  const { db, s, write } = fixture();
  write("student", {
    name: "合成同名学生",
    grade: "初一",
    class_name: "A",
    start_date: "2026-11-01",
  });
  legacy(db);
  db.exec(
    "ALTER TABLE tg_attendance DROP COLUMN reference_fee;INSERT INTO tg_attendance(student_id,date,status,grade,class_name,rule_json,fee,pending) VALUES(1,'2026-11-11','出勤','初一','A','{\"present\":5000}',0,1)",
  );
  migrate(db);
  const a = s.get("SELECT * FROM tg_attendance");
  assert.equal(a.reference_fee, 5000);
  assert.equal(a.fee, 0);
  assert.equal(a.pending, 1);
  assert.equal(s.all("SELECT * FROM tg_ledger").length, 0);
  const b = { ...a };
  delete b.reference_fee;
  const data = {
    students: [{ id: 1, name: "合成旧身份" }],
    tg_attendance: [b],
  };
  upgradeLegacyBackup(data);
  assert.equal(data.tg_attendance[0].reference_fee, 5000);
  db.close();
});
test("restaging an uncommitted old preview refreshes conflict metadata", () => {
  const { db, s } = fixture(),
    p = source("2026-09", [["合成新档案", "初一", "A"]]);
  stage(s, p, "测试");
  stage(s, { ...p, rules_pending: true }, "测试");
  assert.equal(
    JSON.parse(s.get("SELECT payload FROM tg_imports WHERE id=?", p.id).payload)
      .rules_pending,
    true,
  );
  commit(s, { id: p.id, auto: true, request_id: crypto.randomUUID() }, "测试");
  assert.equal(s.get("SELECT pending FROM tg_rules").pending, 1);
  db.close();
});
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE students(id INTEGER PRIMARY KEY,name TEXT,grade TEXT);CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT);CREATE TABLE lessons(id INTEGER PRIMARY KEY,student_names TEXT);CREATE TABLE recharges(id INTEGER PRIMARY KEY,student_name TEXT,amount INTEGER);INSERT INTO students VALUES(1,'合成同名学生','初一');INSERT INTO lessons VALUES(1,'合成同名学生');INSERT INTO recharges VALUES(1,'合成同名学生',100);",
  );
  migrate(db);
  const s = createStore(db);
  return {
    db,
    s,
    write: (action, b) =>
      s.mutate(action, { request_id: crypto.randomUUID(), ...b }, "测试"),
  };
}
const snapshot = (db, t) =>
  JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all());
test("independent identity, same names, periods and financial isolation", () => {
  const { db, s, write } = fixture(),
    before = ["students", "lessons", "recharges"].map((t) => snapshot(db, t));
  assert.equal(s.snapshot("2026-11", true).students.length, 0);
  const a = write("student", {
    name: "合成同名学生",
    grade: "初一",
    class_name: "A",
    start_date: "2026-11-01",
  });
  const b = write("student", {
    name: "合成同名学生",
    grade: "初二",
    class_name: "B",
  });
  assert.notEqual(a.id, b.id);
  write("student", {
    ...a,
    name: "合成托管更名",
    grade: "初二",
    class_name: "B",
  });
  assert.throws(() => write("student", { ...a, name: "旧版本" }), /变更/);
  assert.equal(
    s.get("SELECT grade FROM tg_periods WHERE student_id=?", a.id).grade,
    "初一",
  );
  write("money", {
    student_id: a.id,
    date: "2026-11-01",
    kind: "充值",
    amount: 10000,
    notes: "托管收款",
  });
  assert.deepEqual(
    ["students", "lessons", "recharges"].map((t) => snapshot(db, t)),
    before,
  );
  const tgBefore = TABLES.map((t) => snapshot(db, t));
  db.exec(
    "INSERT INTO students VALUES(2,'补课新学生','初二');INSERT INTO recharges VALUES(2,'补课新学生',300)",
  );
  assert.deepEqual(
    TABLES.map((t) => snapshot(db, t)),
    tgBefore,
  );
  assert.equal(s.snapshot("2026-11", true).students.length, 2);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  db.close();
});
function legacy(db) {
  const tables = ["tg_periods", "tg_rules", "tg_attendance", "tg_ledger"];
  db.exec("PRAGMA foreign_keys=OFF");
  const indexes = [];
  for (const t of tables) {
    indexes.push(
      ...db
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
        )
        .all(t)
        .map((r) => r.sql),
    );
    const sql = db
      .prepare("SELECT sql FROM sqlite_schema WHERE name=?")
      .get(t).sql;
    db.exec(
      sql
        .replace("CREATE TABLE " + t, "CREATE TABLE " + t + "_old")
        .replaceAll("REFERENCES tg_students(", "REFERENCES students("),
    );
    db.exec(`INSERT INTO ${t}_old SELECT * FROM ${t}`);
  }
  for (const t of [...tables].reverse()) db.exec(`DROP TABLE ${t}`);
  for (const t of tables) db.exec(`ALTER TABLE ${t}_old RENAME TO ${t}`);
  indexes.forEach((sql) => db.exec(sql));
  db.exec(
    "DELETE FROM tg_legacy_student_map; DELETE FROM tg_students;PRAGMA foreign_keys=ON",
  );
}
test("legacy FK upgrade preserves exact rows, IDs and original business; repeated startup is safe", () => {
  const { db, s, write } = fixture();
  write("student", {
    name: "合成同名学生",
    grade: "初一",
    class_name: "A",
    start_date: "2026-11-01",
  });
  write("rule", {
    student_id: 1,
    effective_date: "2026-11-01",
    present: 5000,
    leave_fee: 2500,
    absent: 5000,
  });
  write("calendar", { date: "2026-11-11", enabled: 1, version: 0 });
  write("attendance", {
    date: "2026-11-11",
    rows: [{ student_id: 1, status: "出勤", version: 0 }],
  });
  legacy(db);
  const tables = [
      "students",
      "lessons",
      "recharges",
      "tg_periods",
      "tg_rules",
      "tg_attendance",
      "tg_ledger",
      "tg_requests",
      "tg_audit",
    ],
    before = tables.map((t) => snapshot(db, t));
  assert.equal(migrate(db).migrated, 1);
  assert.deepEqual(
    tables.map((t) => snapshot(db, t)),
    before,
  );
  assert.equal(
    s.get("SELECT student_id FROM tg_legacy_student_map WHERE id=1").student_id,
    1,
  );
  assert.equal(migrate(db).migrated, 0);
  assert.equal(s.all("SELECT * FROM tg_students").length, 1);
  for (const t of ["tg_periods", "tg_rules", "tg_attendance", "tg_ledger"])
    assert.equal(
      db
        .prepare(`PRAGMA foreign_key_list(${t})`)
        .all()
        .find((f) => f.from === "student_id").table,
      "tg_students",
    );
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  db.close();
});
test("invalid legacy references roll back schema and all data", () => {
  const { db, write } = fixture();
  write("student", {
    name: "合成同名学生",
    grade: "初一",
    class_name: "A",
    start_date: "2026-11-01",
  });
  legacy(db);
  db.exec(
    "PRAGMA foreign_keys=OFF;DELETE FROM students;PRAGMA foreign_keys=ON",
  );
  const before = snapshot(db, "tg_periods");
  assert.throws(() => migrate(db), /缺失学生/);
  assert.equal(snapshot(db, "tg_periods"), before);
  assert.equal(
    db.prepare("PRAGMA foreign_key_list(tg_periods)").all()[0].table,
    "students",
  );
  db.close();
});
function source(month, names) {
  return {
    id: "synthetic-" + month,
    month,
    students: names.map(([name, grade, class_name], i) => ({
      source_key: String(i),
      source_id: "M" + i,
      name,
      grade,
      class_name,
      reference_fee: 5000,
    })),
    records: names.map(([name, grade, class_name], i) => ({
      source_key: String(i),
      date: month + "-10",
      status: "出勤",
      raw_status: "出勤",
      grade,
      class_name,
      reference_fee: 5000,
    })),
    rules: { present: 5000, leave_fee: 2500, absent: 5000 },
    issues: [],
    difference: 0,
  };
}
test("cross-month unique identity reuse, partial conflict isolation and retry without money", () => {
  const { db, s } = fixture();
  const p = source("2026-09", [
    ["合成甲", "初一", "A"],
    ["合成乙", "初二", "B"],
  ]);
  stage(s, p, "测试");
  const run = (p, extra = {}) =>
    commit(
      s,
      {
        id: p.id,
        auto: true,
        partial: true,
        request_id: crypto.randomUUID(),
        ...extra,
      },
      "测试",
    );
  assert.equal(run(p).created, 2);
  const q = source("2026-10", [
    ["合成甲", "初一", "A"],
    ["合成乙", "初三", "C"],
    ["合成丙", "初一", "A"],
  ]);
  stage(s, q, "测试");
  const r = run(q);
  assert.equal(r.existing, 1);
  assert.equal(r.created, 1);
  assert.equal(r.pending, 1);
  assert.equal(r.success, 2);
  assert.deepEqual(run(q), r);
  assert.equal(s.all("SELECT * FROM tg_students").length, 3);
  const resolved = run(q, { mapping: { 1: "new" } });
  assert.equal(resolved.success, 3);
  assert.equal(resolved.pending, 0);
  assert.equal(s.all("SELECT * FROM tg_ledger").length, 0);
  assert.equal(
    s.get("SELECT COUNT(*) n FROM tg_attendance WHERE pending=1").n,
    5,
  );
  const c = source("2026-10", [
    ["合成新", "初一", "A"],
    ["合成冲突", "初一", "A"],
  ]);
  c.id += "-conflict";
  stage(s, c, "测试");
  const result = run(c, { mapping: { 1: 1 } });
  assert.equal(result.success, 1);
  assert.equal(result.conflicts.length, 1);
  assert.match(result.conflicts[0].reason, /冲突/);
  assert.equal(s.all("SELECT * FROM students").length, 1);
  db.close();
});
test("legacy backup identity reconstruction copies only custody references", () => {
  const d = {
    students: [
      { id: 7, name: "合成旧托管", grade: "初一" },
      { id: 9, name: "合成仅补课" },
    ],
    tg_periods: [
      {
        student_id: 7,
        grade: "初二",
        class_name: "A",
        start_date: "2026-09-01",
      },
    ],
  };
  upgradeLegacyBackup(d);
  assert.equal(d.tg_students.length, 1);
  assert.equal(d.tg_students[0].id, 7);
  assert.equal(d.tg_students[0].grade, "初二");
  assert.equal(d.students.length, 2);
});

test("profile without enrollment keeps its prepayment visible in financial summaries", () => {
  const { db, s, write } = fixture();
  const p = write("student", {
    name: "合成待入托",
    grade: "初一",
    class_name: "A",
  });
  write("money", {
    student_id: p.id,
    date: "2026-11-01",
    kind: "充值",
    amount: 10000,
    notes: "合成预缴",
  });
  assert.equal(
    s.snapshot("2026-11", true).summary.find((s) => s.id === p.id).balance,
    10000,
  );
  assert.equal(s.all("SELECT * FROM tg_periods").length, 0);
  db.close();
});

test("late migration foreign-key failure restores original schema after table replacement", () => {
  const { db, write } = fixture();
  write("student", {
    name: "合成同名学生",
    grade: "初一",
    class_name: "A",
    start_date: "2026-11-01",
  });
  legacy(db);
  db.exec(
    "PRAGMA foreign_keys=OFF;INSERT INTO tg_ledger(student_id,date,kind,amount,notes,actor,attendance_id) VALUES(1,'2026-11-01','考勤扣费',-100,'合成损坏引用','测试',999);PRAGMA foreign_keys=ON",
  );
  const before = snapshot(db, "tg_ledger");
  assert.throws(() => migrate(db), /外键校验失败/);
  assert.equal(snapshot(db, "tg_ledger"), before);
  assert.equal(
    db.prepare("PRAGMA foreign_key_list(tg_periods)").all()[0].table,
    "students",
  );
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  db.close();
});
