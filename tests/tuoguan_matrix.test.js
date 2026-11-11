const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { migrate, createStore, STATUSES } = require("../src/domain/tuoguan");
function fixture(t, file = ":memory:") {
  const db = new DatabaseSync(file);
  t.after(() => db.close());
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE students(id INTEGER PRIMARY KEY,name TEXT);INSERT INTO students VALUES(1,'Synthetic tutoring');CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT);",
  );
  migrate(db);
  const store = createStore(db),
    write = (action, body) =>
      store.mutate(
        action,
        { request_id: crypto.randomUUID(), ...body },
        "Synthetic operator",
      );
  write("student", {
    name: "Synthetic custody",
    grade: "初一",
    start_date: "2026-09-01",
  });
  write("calendar", { date: "2026-09-05", enabled: 1, version: 0 });
  write("rule", {
    effective_date: "2026-09-01",
    present: 5000,
    leave_fee: 2500,
    absent: 5000,
  });
  return { db, store, write };
}
test("class removal preserves IDs, periods, every other historical field, full backup and idempotency", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-schema-"));
  const { db, store } = fixture(t, path.join(dir, "test.sqlite"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  db.exec(
    "INSERT INTO tg_attendance(student_id,date,status,grade,rule_json,fee,pending,raw_status,reference_fee) VALUES(1,'2026-09-05','未登记','初一','{}',0,1,'26',0)",
  );
  const tables = ["tg_students", "tg_periods", "tg_attendance"];
  for (const table of tables)
    db.exec(
      `ALTER TABLE ${table} ADD COLUMN class_name TEXT NOT NULL DEFAULT 'archived class'`,
    );
  const before = Object.fromEntries(
    tables.map((table) => [
      table,
      store.all("SELECT * FROM " + table).map(({ class_name, ...row }) => row),
    ]),
  );
  const tutoring = store.all("SELECT * FROM students");
  const result = migrate(db);
  assert.ok(result.backup);
  const backup = new DatabaseSync(result.backup, { readOnly: true });
  assert.equal(
    backup.prepare("SELECT class_name FROM tg_students").get().class_name,
    "archived class",
  );
  backup.close();
  for (const table of tables) {
    assert.equal(
      store
        .all("PRAGMA table_info(" + table + ")")
        .some((c) => c.name === "class_name"),
      false,
    );
    assert.deepEqual(
      store.all("SELECT * FROM " + table).map((r) => ({ ...r })),
      before[table],
    );
  }
  assert.deepEqual(store.all("SELECT * FROM students"), tutoring);
  assert.deepEqual(store.all("PRAGMA foreign_key_check"), []);
  const audits = store.all("SELECT * FROM tg_audit");
  assert.equal(migrate(db).backup, null);
  assert.deepEqual(store.all("SELECT * FROM tg_audit"), audits);
});
test("a failed class migration rolls back schema and records", (t) => {
  const { db, store } = fixture(t);
  db.exec(
    "ALTER TABLE tg_students ADD COLUMN class_name TEXT;ALTER TABLE tg_periods ADD COLUMN class_name TEXT;CREATE INDEX block_class_drop ON tg_periods(class_name)",
  );
  const before = JSON.stringify(store.all("SELECT * FROM tg_students"));
  assert.throws(() => migrate(db));
  assert.equal(
    store
      .all("PRAGMA table_info(tg_students)")
      .some((c) => c.name === "class_name"),
    true,
  );
  assert.equal(JSON.stringify(store.all("SELECT * FROM tg_students")), before);
});
test("four statuses, explicit default save, historical edits without posting, conflict and source retention", (t) => {
  const { db, store, write } = fixture(t);
  assert.deepEqual(STATUSES, ["出勤", "请假", "放假", "不适用"]);
  store.snapshot("2026-09", true);
  assert.equal(store.all("SELECT * FROM tg_attendance").length, 0);
  assert.equal(store.all("SELECT * FROM tg_ledger").length, 0);
  for (const status of ["缺勤", "停课", "未登记"])
    assert.throws(
      () =>
        write("attendance", {
          date: "2026-09-05",
          rows: [{ student_id: 1, status, version: 0 }],
        }),
      /状态/,
    );
  const body = {
    request_id: crypto.randomUUID(),
    date: "2026-09-05",
    rows: [{ student_id: 1, status: "出勤", version: 0 }],
  };
  write("attendance", body);
  write("attendance", body);
  assert.equal(store.all("SELECT * FROM tg_ledger").length, 1);
  write("calendar", { date: "2026-09-06", enabled: 1, version: 0 });
  db.exec(
    `INSERT INTO tg_attendance(student_id,date,status,grade,rule_json,fee,pending,raw_status,source_cell) VALUES(1,'2026-09-06','未登记','初一','{"present":5000,"leave_fee":2500}',0,1,'26','E13')`,
  );
  const changed = write("attendance", {
    date: "2026-09-06",
    rows: [{ student_id: 1, status: "请假", version: 1 }],
  })[0];
  assert.equal(changed.pending, 1);
  assert.equal(changed.fee, 0);
  assert.equal(changed.reference_fee, 2500);
  assert.equal(changed.raw_status, "26");
  assert.equal(changed.source_cell, "E13");
  assert.equal(store.all("SELECT * FROM tg_ledger").length, 1);
  assert.throws(
    () =>
      write("attendance", {
        date: "2026-09-06",
        rows: [{ student_id: 1, status: "出勤", version: 1 }],
      }),
    /他人修改/,
  );
  write("student", {
    id: 1,
    version: 1,
    name: "Synthetic custody",
    grade: "初二",
  });
  assert.equal(
    store.get("SELECT grade FROM tg_attendance WHERE date='2026-09-06'").grade,
    "初一",
  );
  assert.throws(
    () => write("student", { name: "Invalid grade", grade: "高一" }),
    /初一/,
  );
});
