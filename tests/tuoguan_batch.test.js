const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite"),
  TG = require("../src/domain/tuoguan");
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT)",
  );
  TG.migrate(db);
  t.after(() => db.close());
  const store = TG.createStore(db),
    write = (a, b) =>
      store.mutate(a, { request_id: crypto.randomUUID(), ...b }, "合成批量");
  for (let i = 0; i < 3; i++)
    write("student", {
      name: "合成" + i,
      grade: "初一",
      start_date: "2026-09-01",
    });
  write("money", {
    student_id: 1,
    date: "2026-09-01",
    kind: "充值",
    actual_amount: 10000,
    gift_amount: 5000,
  });
  const targets = [
    { student_id: 1, date: "2026-09-01" },
    { student_id: 1, date: "2026-09-02" },
    { student_id: 2, date: "2026-09-01" },
  ];
  const cells = () =>
    targets.map((c) => ({
      ...c,
      version:
        store.get(
          "SELECT version FROM tg_attendance WHERE student_id=? AND date=?",
          c.student_id,
          c.date,
        )?.version || 0,
    }));
  const batch = (status, extra = {}) =>
    write("batch-attendance", {
      month: "2026-09",
      status,
      cells: cells(),
      ...extra,
    });
  const dump = () =>
    JSON.stringify(TG.TABLES.map((n) => [n, store.all("SELECT * FROM " + n)]));
  return { db, store, write, cells, batch, dump };
}
for (const [status, fee] of [
  ["出勤", 5000],
  ["请假", 2500],
  ["放假", 0],
  ["不适用", 0],
])
  test(
    "batch " +
      status +
      " reuses integer settlement and preserves unrelated cells/notes",
    (t) => {
      const f = fixture(t);
      f.write("attendance", {
        date: "2026-09-01",
        rows: [
          { student_id: 1, status: "不适用", version: 0, notes: "保留原备注" },
          { student_id: 3, status: "请假", version: 0, notes: "未选择" },
        ],
      });
      const untouched = f.store.get(
        "SELECT * FROM tg_attendance WHERE student_id=3",
      );
      const result = f.batch(status);
      assert.equal(result.length, 3);
      for (const row of result) {
        assert.equal(row.status, status);
        assert.equal(row.fee, fee);
      }
      assert.equal(
        result.find((r) => r.student_id === 1 && r.date === "2026-09-01").notes,
        "保留原备注",
      );
      assert.deepEqual(
        f.store.get("SELECT * FROM tg_attendance WHERE student_id=3"),
        untouched,
      );
      assert.equal(
        f.store.get(
          "SELECT SUM(amount) n FROM tg_ledger WHERE attendance_id IS NOT NULL",
        ).n || 0,
        -(3 * fee + 2500),
      );
      assert.deepEqual(f.store.all("PRAGMA foreign_key_check"), []);
    },
  );
test("one request is idempotent; new same-state request does not charge twice; reversals net correctly", (t) => {
  const f = fixture(t),
    request_id = crypto.randomUUID(),
    cells = f.cells();
  const first = f.batch("出勤", { request_id, cells }),
    ledger = f.store.all("SELECT * FROM tg_ledger");
  assert.deepEqual(
    f.batch("出勤", { request_id, cells }),
    JSON.parse(JSON.stringify(first)),
  );
  assert.deepEqual(f.store.all("SELECT * FROM tg_ledger"), ledger);
  assert.throws(() => f.batch("请假", { request_id, cells }), /请求编号/);
  f.batch("出勤");
  assert.deepEqual(f.store.all("SELECT * FROM tg_ledger"), ledger);
  f.batch("请假");
  assert.equal(
    f.store.get(
      "SELECT SUM(amount) n FROM tg_ledger WHERE attendance_id IS NOT NULL",
    ).n,
    -7500,
  );
  f.batch("放假");
  assert.equal(
    f.store.get(
      "SELECT SUM(amount) n FROM tg_ledger WHERE attendance_id IS NOT NULL",
    ).n,
    0,
  );
  f.batch("不适用");
  assert.equal(
    f.store.get(
      "SELECT SUM(amount) n FROM tg_ledger WHERE attendance_id IS NOT NULL",
    ).n,
    0,
  );
  assert.ok(
    f.store.get("SELECT id FROM tg_audit WHERE action='batch-attendance'"),
  );
});
for (const [name, change] of [
  [
    "stale version",
    (f) => [{ ...f.cells()[0] }, { ...f.cells()[1], version: 99 }],
  ],
  [
    "disabled date",
    (f) => {
      f.write("remove-dates", {
        month: "2026-09",
        dates: [{ date: "2026-09-02", version: 0 }],
      });
      return f.cells();
    },
  ],
  [
    "outside period",
    (f) => [f.cells()[0], { student_id: 999, date: "2026-09-02", version: 0 }],
  ],
  [
    "cross month",
    (f) => [f.cells()[0], { student_id: 1, date: "2026-10-01", version: 0 }],
  ],
  ["duplicate target", (f) => [f.cells()[0], f.cells()[0]]],
  ["invalid date", (f) => [{ student_id: 1, date: "2026-09-31", version: 0 }]],
  [
    "Saturday not enabled",
    (f) => [f.cells()[0], { student_id: 1, date: "2026-09-05", version: 0 }],
  ],
  ["invalid version", (f) => [{ ...f.cells()[0], version: -1 }]],
])
  test("whole batch rolls back on " + name, (t) => {
    const f = fixture(t),
      cells = change(f),
      before = f.dump();
    assert.throws(() => f.batch("出勤", { cells }));
    assert.equal(f.dump(), before);
  });
test("invalid status and empty/oversized input reject without mutation", (t) => {
  const f = fixture(t),
    before = f.dump();
  for (const extra of [
    { status: "缺勤" },
    { cells: [] },
    { cells: Array(15501).fill(f.cells()[0]) },
    { month: "2026-13" },
  ])
    assert.throws(() => f.batch("出勤", extra));
  assert.equal(f.dump(), before);
});
test("settlement failure after an earlier date is also atomic", (t) => {
  const f = fixture(t);
  f.db.exec(
    "CREATE TRIGGER fail_second BEFORE INSERT ON tg_ledger WHEN NEW.date='2026-09-02' BEGIN SELECT RAISE(ABORT,'synthetic ledger failure');END",
  );
  const before = f.dump();
  assert.throws(() => f.batch("出勤"), /synthetic ledger failure/);
  assert.equal(f.dump(), before);
});
test("batch and ordinary attendance produce the same cash, gift, debt and next-month carry", (t) => {
  const a = fixture(t),
    b = fixture(t);
  const dates = [
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-06",
  ];
  const cells = dates.flatMap((date) =>
    [1, 2].map((student_id) => ({ student_id, date, version: 0 })),
  );
  a.batch("出勤", { cells });
  for (const date of dates)
    b.write("attendance", {
      date,
      rows: [1, 2].map((student_id) => ({
        student_id,
        status: "出勤",
        version: 0,
      })),
    });
  assert.equal(a.store.get("SELECT SUM(fee) n FROM tg_attendance").n, 50000);
  for (const month of ["2026-09", "2026-10"])
    assert.deepEqual(
      a.store.snapshot(month, true).summary,
      b.store.snapshot(month, true).summary,
    );
  const account = require("../src/domain/tuoguan_account").account;
  const cash = account(
    a.store.all("SELECT * FROM tg_ledger WHERE student_id=1"),
    "2026-10",
  );
  const debt = account(
    a.store.all("SELECT * FROM tg_ledger WHERE student_id=2"),
    "2026-10",
  );
  assert.equal(cash.balance, -10000);
  assert.equal(debt.balance, -25000);
  assert.equal(cash.gift_balance, 0);
});
