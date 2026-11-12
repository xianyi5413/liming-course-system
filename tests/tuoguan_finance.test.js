const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { DatabaseSync } = require("node:sqlite"),
  TG = require("../src/domain/tuoguan"),
  T = require("../src/domain/tuoguan_transfer");
function fixture(t, file = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-finance-")),
    db = new DatabaseSync(file ? path.join(dir, "db.sqlite") : ":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT);CREATE TABLE students(id INTEGER PRIMARY KEY,name TEXT,balance INTEGER);INSERT INTO students VALUES(1,'合成补课',123456)",
  );
  TG.migrate(db);
  const store = TG.createStore(db),
    write = (a, b) =>
      store.mutate(a, { request_id: crypto.randomUUID(), ...b }, "合成经办");
  write("student", {
    name: "合成托管",
    grade: "初一",
    start_date: "2026-09-01",
  });
  write("rule", {
    effective_date: "2026-09-01",
    present: 5000,
    leave_fee: 2500,
    absent: 5000,
  });
  const money = (actual, gift, date = "2026-09-01", kind = "充值") =>
    write("money", {
      student_id: 1,
      date,
      kind,
      actual_amount: actual,
      gift_amount: gift,
      notes: "合成依据",
    });
  const attend = (date = "2026-09-02", status = "出勤", version = 0) =>
    write("attendance", { date, rows: [{ student_id: 1, status, version }] });
  const read = (month = "2026-09") =>
    store.snapshot(month, true).summary.find((s) => s.id === 1);
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { db, dir, store, write, money, attend, read };
}
for (const [
  name,
  cash,
  gift,
  actualBalance,
  giftBalance,
  actualConsumption,
  giftConsumption,
] of [
  ["cash only", 10000, 0, 5000, 0, 5000, 0],
  ["gift only", 0, 10000, 0, 5000, 0, 5000],
  ["both funded", 10000, 1000, 5000, 1000, 5000, 0],
  ["cash shortfall", 2000, 5000, 0, 2000, 2000, 3000],
  ["both insufficient", 1000, 1000, -3000, 0, 4000, 1000],
  ["no funding", 0, 0, -5000, 0, 5000, 0],
])
  test("split account " + name, (t) => {
    const f = fixture(t);
    if (cash || gift) f.money(cash, gift);
    f.attend();
    const a = f.read();
    assert.deepEqual(
      [
        a.actual_balance,
        a.gift_balance,
        a.actual_consumption,
        a.gift_consumption,
      ],
      [actualBalance, giftBalance, actualConsumption, giftConsumption],
    );
    assert.equal(a.fee, a.actual_consumption + a.gift_consumption);
    assert.equal(a.recharge, cash + gift);
    assert.equal(
      f.db.prepare("SELECT balance FROM students").get().balance,
      123456,
    );
  });
test("FIFO uses an earlier batch gift before a later cash batch", (t) => {
  const f = fixture(t);
  f.money(1000, 3000);
  f.money(5000, 0, "2026-09-02");
  f.attend("2026-09-03");
  const a = f.read();
  assert.deepEqual(
    [
      a.actual_balance,
      a.gift_balance,
      a.actual_consumption,
      a.gift_consumption,
    ],
    [4000, 0, 2000, 3000],
  );
});
for (const [cash, gift, balance, giftBalance, cashCost, giftCost] of [
  [3000, 0, -2000, 0, 5000, 0],
  [0, 6000, 0, 1000, 0, 5000],
  [3000, 4000, 0, 2000, 3000, 2000],
  [1000, 2000, -2000, 0, 3000, 2000],
])
  test(`debt then recharge ${cash}/${gift}`, (t) => {
    const f = fixture(t);
    f.attend();
    f.money(cash, gift, "2026-09-03");
    const a = f.read();
    assert.deepEqual(
      [
        a.actual_balance,
        a.gift_balance,
        a.actual_consumption,
        a.gift_consumption,
      ],
      [balance, giftBalance, cashCost, giftCost],
    );
    const charge = f.store
      .snapshot("2026-09", true)
      .ledger.find((r) => r.kind === "考勤扣费");
    assert.deepEqual(
      [charge.actual_amount, charge.gift_amount],
      [-cashCost || 0, -giftCost || 0],
    );
  });
test("carry over, prior-month gift debt settlement and zero attendance are independent", (t) => {
  const f = fixture(t);
  f.attend();
  f.money(0, 6000, "2026-10-01");
  const a = f.read("2026-10");
  assert.deepEqual(
    [
      a.opening_actual,
      a.opening_gift,
      a.actual_balance,
      a.gift_balance,
      a.fee,
      a.prior_debt_gift_offset,
    ],
    [-5000, 0, 0, 1000, 0, 5000],
  );
  assert.equal(a.has_attendance, false);
  assert.equal(f.read().actual_balance, -5000);
  assert.equal(f.store.snapshot("2026-10", true).ledger.length, 1);
});
test("attendance decrease/increase, historical replay, duplicate save and optimistic rollback retain ledger evidence", (t) => {
  const f = fixture(t);
  f.money(1000, 5000);
  f.attend();
  const first = f.db.prepare("SELECT * FROM tg_ledger").all();
  f.attend("2026-09-02", "请假", 1);
  assert.equal(f.read().gift_balance, 3500);
  assert.equal(f.read().fee, 2500);
  f.attend("2026-09-02", "出勤", 2);
  assert.equal(f.read().gift_balance, 1000);
  const count = f.db.prepare("SELECT count(*) n FROM tg_ledger").get().n;
  f.attend("2026-09-02", "出勤", 3);
  assert.equal(f.db.prepare("SELECT count(*) n FROM tg_ledger").get().n, count);
  assert.throws(() => f.attend("2026-09-02", "请假", 1), /他人修改/);
  assert.deepEqual(
    f.db.prepare("SELECT * FROM tg_ledger WHERE id<=?").all(first.at(-1).id),
    first,
  );
  f.money(4000, 0, "2026-09-01");
  assert.equal(f.read().actual_balance, 4000);
  assert.equal(f.read().gift_balance, 1000);
});
test("backdated attendance recalculates following months without modifying recharge records", (t) => {
  const f = fixture(t);
  f.money(0, 10000, "2026-10-01");
  f.attend("2026-10-02");
  const ledger = f.db
    .prepare("SELECT * FROM tg_ledger WHERE kind='充值'")
    .all();
  assert.equal(f.read("2026-10").gift_balance, 5000);
  f.attend();
  assert.deepEqual(
    [f.read("2026-10").actual_balance, f.read("2026-10").gift_balance],
    [0, 0],
  );
  assert.deepEqual(
    f.db.prepare("SELECT * FROM tg_ledger WHERE kind='充值'").all(),
    ledger,
  );
});
test("refund caps each account, zero totals permit explicit transfers, gift adjustments never create negative gift", (t) => {
  const f = fixture(t);
  f.money(10000, 2000);
  f.money(1000, 500, "2026-09-02", "退款");
  assert.deepEqual(
    [f.read().actual_balance, f.read().gift_balance],
    [9000, 1500],
  );
  assert.throws(() => f.money(0, 2000, "2026-09-03", "退款"), /不能超过/);
  f.money(-1000, 1000, "2026-09-03", "调整");
  assert.deepEqual(
    [f.read().actual_balance, f.read().gift_balance],
    [8000, 2500],
  );
  f.money(0, -3000, "2026-09-04", "调整");
  assert.deepEqual([f.read().actual_balance, f.read().gift_balance], [7500, 0]);
});
test("split money atomicity and request idempotency reject partial or duplicate writes", (t) => {
  const f = fixture(t),
    b = {
      request_id: crypto.randomUUID(),
      student_id: 1,
      date: "2026-09-01",
      kind: "充值",
      actual_amount: 1000,
      gift_amount: 500,
      notes: "合成依据",
    };
  f.write("money", b);
  f.write("money", b);
  assert.equal(f.read().recharge, 1500);
  assert.throws(() => f.write("money", { ...b, gift_amount: 600 }), /不同内容/);
  assert.throws(() => f.money(0, 0), /非零/);
  assert.throws(() => f.money(1.1, 10), /整数/);
  assert.throws(() => f.money(100, undefined), /整数/);
  assert.equal(f.db.prepare("SELECT count(*) n FROM tg_ledger").get().n, 1);
});
test("legacy nonzero ledgers migrate idempotently with original values and unresolved allocation retained", (t) => {
  const f = fixture(t, true);
  f.db.exec(
    "ALTER TABLE tg_ledger DROP COLUMN actual_amount;ALTER TABLE tg_ledger DROP COLUMN gift_amount;INSERT INTO tg_ledger(student_id,date,kind,amount,notes,actor) VALUES(1,'2026-09-01','调整',1234,'合成原始依据','合成')",
  );
  const before = f.db
    .prepare("SELECT * FROM tg_ledger")
    .all()
    .map((r) => ({ ...r }));
  assert.ok(TG.migrate(f.db).backup);
  assert.equal(TG.migrate(f.db).backup, null);
  assert.deepEqual(
    f.db
      .prepare("SELECT * FROM tg_ledger")
      .all()
      .map(({ actual_amount, gift_amount, ...r }) => r),
    before,
  );
  assert.equal(f.read().balance, 1234);
  assert.equal(f.read().legacy_unallocated, 1);
  assert.equal(
    f.db.prepare("SELECT actual_amount FROM tg_ledger").get().actual_amount,
    null,
  );
});
test("v2 transfer preserves split balances and IDs; v1 compatibility retains legacy amounts and conflicts", async (t) => {
  const a = fixture(t, true),
    b = fixture(t, true);
  b.db.exec(
    "DELETE FROM tg_periods;DELETE FROM tg_students;DELETE FROM tg_rules;DELETE FROM tg_audit;DELETE FROM tg_requests",
  );
  a.money(2000, 6000);
  a.attend();
  a.money(1000, 0, "2026-10-01");
  const bundle = T.exportData(a.db);
  assert.equal(bundle.version, 2);
  let input = JSON.stringify(bundle);
  const plan = T.plan(b.db, T.parse(b.db, input));
  assert.equal(plan.summary.gift_recharge, 6000);
  await T.confirm(b.db, input, T.signature(b.db), b.dir, "合成");
  assert.deepEqual(
    [b.read().actual_balance, b.read().gift_balance],
    [a.read().actual_balance, a.read().gift_balance],
  );
  assert.equal(
    (await T.confirm(b.db, input, T.signature(b.db), b.dir, "合成")).created,
    0,
  );
  const v1 = structuredClone(bundle);
  v1.version = 1;
  for (const row of v1.records.tg_ledger) {
    delete row.record.actual_amount;
    delete row.record.gift_amount;
  }
  delete v1.checksum;
  v1.checksum = T.hash(v1);
  const old = T.parse(b.db, JSON.stringify(v1));
  assert.ok(
    old.records.tg_ledger.every((i) => i.record.actual_amount === null),
  );
  assert.ok(T.plan(b.db, old).conflicts.length > 0);
  const legacyTarget = fixture(t, true);
  legacyTarget.db.exec(
    "DELETE FROM tg_periods;DELETE FROM tg_students;DELETE FROM tg_rules;DELETE FROM tg_audit;DELETE FROM tg_requests",
  );
  await T.confirm(
    legacyTarget.db,
    JSON.stringify(v1),
    T.signature(legacyTarget.db),
    legacyTarget.dir,
    "合成",
  );
  assert.equal(legacyTarget.read().balance, a.read().balance);
  assert.equal(legacyTarget.read().legacy_unallocated, 1);
  assert.equal(legacyTarget.read().gift_balance, 0);
  assert.equal(
    (
      await T.confirm(
        legacyTarget.db,
        JSON.stringify(v1),
        T.signature(legacyTarget.db),
        legacyTarget.dir,
        "合成",
      )
    ).created,
    0,
  );
  const invalid = structuredClone(bundle);
  invalid.records.tg_ledger.find((i) => i.record.kind === "充值").record
    .gift_amount++;
  delete invalid.checksum;
  invalid.checksum = T.hash(invalid);
  assert.throws(() => T.parse(b.db, JSON.stringify(invalid)), /不一致/);
});
test("historical grade and saved attendance membership exclude periods, defaults and anomaly-only profiles", (t) => {
  const f = fixture(t);
  f.attend("2026-09-02", "不适用");
  f.write("student", { id: 1, name: "合成托管", grade: "初三", version: 1 });
  assert.equal(f.read().grade, "初一");
  assert.equal(f.read().has_attendance, true);
  const s = f.write("student", {
    name: "合成未签到",
    grade: "初二",
    start_date: "2026-09-01",
  });
  assert.equal(
    f.store.snapshot("2026-09", true).summary.find((r) => r.id === s.id)
      .has_attendance,
    false,
  );
  f.db
    .prepare(
      "INSERT INTO tg_attendance(student_id,date,status,grade,rule_json,fee,pending,raw_status) VALUES(?,'2026-09-02','未登记','初二','{}',0,1,'26')",
    )
    .run(s.id);
  assert.equal(
    f.store.snapshot("2026-09", true).summary.find((r) => r.id === s.id)
      .has_attendance,
    false,
  );
});

test("failed split migration rolls back both new fields and preserves original financial evidence", (t) => {
  const f = fixture(t, true);
  f.money(1000, 0);
  f.db.exec(
    "ALTER TABLE tg_ledger DROP COLUMN actual_amount;ALTER TABLE tg_ledger DROP COLUMN gift_amount;PRAGMA foreign_keys=OFF;UPDATE tg_ledger SET student_id=999;PRAGMA foreign_keys=ON",
  );
  const before = f.db.prepare("SELECT * FROM tg_ledger").all();
  assert.throws(() => TG.migrate(f.db), /外键校验失败/);
  assert.deepEqual(f.db.prepare("SELECT * FROM tg_ledger").all(), before);
  assert.equal(
    f.db
      .prepare("PRAGMA table_info(tg_ledger)")
      .all()
      .some((c) => c.name === "actual_amount" || c.name === "gift_amount"),
    false,
  );
  assert.equal(f.db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
});
