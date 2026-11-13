const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const TG = require("../src/domain/tuoguan"),
  T = require("../src/domain/tuoguan_transfer"),
  C = require("../src/domain/tuoguan_calendar");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-transfer-"));
  const db = new DatabaseSync(path.join(dir, "fixture.sqlite"));
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE students(id INTEGER PRIMARY KEY,name TEXT);INSERT INTO students VALUES(1,'合成补课');CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT);CREATE TABLE salary_history(id INTEGER PRIMARY KEY,amount INTEGER);INSERT INTO salary_history VALUES(1,999)",
  );
  TG.migrate(db);
  const store = TG.createStore(db),
    write = (action, b) =>
      store.mutate(
        action,
        { request_id: crypto.randomUUID(), ...b },
        "合成操作人",
      );
  return { db, dir, store, write };
}
function seed(f, name = "合成托管") {
  const student = f.write("student", {
    name,
    grade: "初一",
    start_date: "2026-09-01",
  });
  f.write("rule", {
    stage: "初中",
    effective_date: "2026-09-01",
    present: 5000,
    leave_fee: 2500,
    absent: 0,
  });
  f.write("money", {
    student_id: student.id,
    date: "2026-09-01",
    kind: "充值",
    amount: 100000,
    notes: "合成充值",
  });
  f.write("attendance", {
    date: "2026-09-02",
    rows: [{ student_id: student.id, status: "出勤", version: 0 }],
  });
  f.write("attendance", {
    date: "2026-09-02",
    rows: [{ student_id: student.id, status: "请假", version: 1 }],
  });
  f.write("money", {
    student_id: student.id,
    date: "2026-09-03",
    kind: "退款",
    amount: 1000,
    notes: "合成退款",
  });
  f.write("remove-dates", {
    month: "2026-09",
    dates: [{ date: "2026-09-04", version: 0 }],
  });
  return student;
}
const text = (db) => JSON.stringify(T.exportData(db));
const apply = (f, input) =>
  T.confirm(
    f.db,
    input,
    T.signature(f.db),
    path.join(f.dir, "backups"),
    "合成导入人",
  );

test("removed participation keeps a tombstone so old exports cannot resurrect it after local ID reuse", async (t) => {
  const a = fixture(t),
    b = fixture(t);
  const s = a.write("student", { name: "合成移除来源", grade: "初一" });
  a.write("period", {
    student_id: s.id,
    grade: "初一",
    start_date: "2026-11-01",
    end_date: "2026-11-30",
    status: "在托",
  });
  const input = text(a.db);
  await apply(b, input);
  const p = b.store.get("SELECT * FROM tg_periods");
  b.write("remove-students", {
    month: "2026-11",
    students: [{ id: s.id, versions: [[p.id, p.version]] }],
  });
  b.write("period", {
    student_id: s.id,
    grade: "初一",
    start_date: "2026-12-01",
    status: "在托",
  });
  assert.ok(
    b.store
      .get("SELECT * FROM tg_transfer_keys WHERE table_name='tg_periods'")
      .row_key.startsWith("removed:"),
  );
  const before = T.signature(b.db);
  await assert.rejects(apply(b, input), /冲突/);
  assert.equal(T.signature(b.db), before);
  const next = T.exportData(b.db).records.tg_periods[0];
  assert.notEqual(next.uid, JSON.parse(input).records.tg_periods[0].uid);
});
test("defaults cover Sunday-Friday, leap/year boundaries and retain Saturdays without writes", (t) => {
  const f = fixture(t),
    before = T.signature(f.db);
  for (const month of ["2026-11", "2026-12", "2027-01", "2028-02"]) {
    const days = C.defaults(month);
    assert.ok(
      days.every((d) => new Date(d.date + "T00:00:00Z").getUTCDay() !== 6),
    );
    assert.equal(new Set(days.map((d) => d.date)).size, days.length);
    assert.equal(days[0].date.slice(0, 7), month);
  }
  assert.ok(C.defaults("2028-02").some((d) => d.date === "2028-02-29"));
  assert.equal(C.bounds("2026-12").next, "2027-01-01");
  assert.ok(
    C.defaults("2026-09", [], [{ date: "2026-09-19" }]).some(
      (d) => d.date === "2026-09-19",
    ),
  );
  f.store.snapshot("2026-11", true);
  assert.equal(T.signature(f.db), before);
});
test("date removal persists, explicit attendance materializes only its day, protected dates reject atomically", (t) => {
  const f = fixture(t),
    student = seed(f);
  assert.equal(
    f.store
      .snapshot("2026-09", true)
      .calendar.find((c) => c.date === "2026-09-04").enabled,
    0,
  );
  assert.throws(
    () =>
      f.write("attendance", {
        date: "2026-09-04",
        rows: [{ student_id: student.id, status: "出勤", version: 0 }],
      }),
    /添加/,
  );
  f.write("add-dates", {
    month: "2026-09",
    dates: [{ date: "2026-09-19", version: 0 }],
  });
  assert.throws(
    () =>
      f.write("add-dates", {
        month: "2026-09",
        dates: [{ date: "2026-09-19", version: 1 }],
      }),
    /已在/,
  );
  const before = T.signature(f.db);
  assert.throws(
    () =>
      f.write("remove-dates", {
        month: "2026-09",
        dates: [
          { date: "2026-09-06", version: 0 },
          { date: "2026-09-02", version: 1 },
        ],
      }),
    /已有/,
  );
  assert.equal(T.signature(f.db), before);
  assert.equal(f.store.all("SELECT * FROM tg_calendar").length, 3);
});
test("removing participation splits only an empty month, retains profile and other months, protects funded/history rows", (t) => {
  const f = fixture(t),
    s = seed(f),
    p = f.store.get("SELECT * FROM tg_periods");
  f.write("remove-students", {
    month: "2026-11",
    students: [{ id: s.id, versions: [[p.id, p.version]] }],
  });
  const periods = f.store.all("SELECT * FROM tg_periods ORDER BY start_date");
  assert.deepEqual(
    periods.map((p) => [p.start_date, p.end_date]),
    [
      ["2026-09-01", "2026-10-31"],
      ["2026-12-01", null],
    ],
  );
  assert.equal(f.store.all("SELECT * FROM tg_students").length, 1);
  assert.throws(
    () =>
      f.write("remove-students", {
        month: "2026-09",
        students: [{ id: s.id, versions: [[p.id, 2]] }],
      }),
    /已有/,
  );
  f.write("period", {
    student_id: s.id,
    grade: "初一",
    start_date: "2026-11-05",
    end_date: "2026-11-30",
    status: "在托",
  });
  assert.equal(f.store.all("SELECT * FROM tg_periods").length, 3);
});
test("portable merge remaps IDs, preserves funds and exclusions, skips repeated data and permits incremental/return transfers", async (t) => {
  const a = fixture(t),
    b = fixture(t);
  seed(a);
  b.write("student", { name: "合成目标已有", grade: "初二" });
  const outside = b.db.prepare("SELECT * FROM students").all(),
    input = text(a.db),
    before = T.signature(b.db),
    bundle = T.parse(b.db, input);
  const plan = T.plan(b.db, bundle);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(T.signature(b.db), before);
  const result = await apply(b, input);
  assert.ok(result.created);
  assert.ok(fs.existsSync(result.backup));
  const target = b.store.get("SELECT * FROM tg_students WHERE name='合成托管'");
  assert.notEqual(target.id, 1);
  assert.equal(
    b.store.snapshot("2026-09", true).summary.find((s) => s.id === target.id)
      .balance,
    96500,
  );
  assert.deepEqual(b.db.prepare("SELECT * FROM students").all(), outside);
  assert.equal(
    b.db.prepare("SELECT amount FROM salary_history").get().amount,
    999,
  );
  const ledger = b.store.all("SELECT * FROM tg_ledger");
  assert.equal((await apply(b, input)).created, 0);
  assert.deepEqual(b.store.all("SELECT * FROM tg_ledger"), ledger);
  a.write("money", {
    student_id: 1,
    date: "2026-09-08",
    kind: "充值",
    amount: 3000,
    notes: "合成新增",
  });
  const second = await apply(b, text(a.db));
  assert.ok(second.skipped > 0);
  assert.equal(
    b.store.snapshot("2026-09", true).summary.find((s) => s.id === target.id)
      .balance,
    99500,
  );
  const reverse = T.plan(a.db, T.parse(a.db, text(b.db)));
  assert.equal(reverse.conflicts.length, 0);
  assert.deepEqual(b.db.prepare("PRAGMA foreign_key_check").all(), []);
});
test("different identities conflict; baseline permits source corrections without duplicate charges", async (t) => {
  const a = fixture(t),
    b = fixture(t);
  seed(a);
  b.write("student", { name: "合成托管", grade: "初一" });
  let input = text(a.db);
  assert.ok(T.plan(b.db, T.parse(b.db, input)).conflicts.length);
  const before = T.signature(b.db);
  await assert.rejects(apply(b, input), /冲突/);
  assert.equal(T.signature(b.db), before);
  const c = fixture(t);
  await apply(c, input);
  a.write("attendance", {
    date: "2026-09-02",
    rows: [{ student_id: 1, status: "出勤", version: 2 }],
  });
  input = text(a.db);
  assert.equal(T.plan(c.db, T.parse(c.db, input)).conflicts.length, 0);
  assert.ok((await apply(c, input)).updated > 0);
  assert.equal(c.store.snapshot("2026-09",true).summary[0].fee,5000);
});
test("tampered format, unknown fields, missing references and inconsistent financial ledger are rejected", (t) => {
  const f = fixture(t);
  seed(f);
  const original = T.exportData(f.db);
  const corrupt = (change) => {
    const b = structuredClone(original);
    change(b);
    delete b.checksum;
    b.checksum = T.hash(b);
    return JSON.stringify(b);
  };
  assert.throws(
    () => T.parse(f.db, JSON.stringify({ ...original, source: "changed" })),
    /摘要/,
  );
  assert.throws(
    () =>
      T.parse(
        f.db,
        corrupt((b) => (b.version = 99)),
      ),
    /版本/,
  );
  assert.throws(
    () =>
      T.parse(
        f.db,
        corrupt((b) => (b.records.tg_students[0].record.password = "no")),
      ),
    /字段/,
  );
  assert.throws(
    () =>
      T.parse(
        f.db,
        corrupt(
          (b) =>
            (b.records.tg_ledger[0].record.student_id = crypto.randomUUID()),
        ),
      ),
    /关联/,
  );
  assert.throws(
    () =>
      T.parse(
        f.db,
        corrupt((b) => (b.records.tg_attendance[0].record.fee = 123)),
      ),
    /金额与/,
  );
});
test("stale previews reject and late SQL failure rolls back all imported business and identity keys", async (t) => {
  const a = fixture(t),
    b = fixture(t);
  seed(a);
  const input = text(a.db),
    expected = T.signature(b.db);
  b.write("student", { name: "合成并发", grade: "初三" });
  await assert.rejects(T.confirm(b.db, input, expected, b.dir, "合成"), /变化/);
  b.db.exec(
    "CREATE TRIGGER reject_transfer BEFORE INSERT ON tg_ledger BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
  );
  const before = T.signature(b.db);
  await assert.rejects(apply(b, input), /synthetic failure/);
  assert.equal(T.signature(b.db), before);
});
