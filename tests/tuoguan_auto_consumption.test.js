const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { DatabaseSync } = require("node:sqlite"),
  TG = require("../src/domain/tuoguan"),
  B = require("../src/domain/tuoguan_settlement"),
  T = require("../src/domain/tuoguan_transfer");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-auto-")),
    db = new DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT);CREATE TABLE students(id INTEGER PRIMARY KEY,balance INTEGER);INSERT INTO students VALUES(1,12345)",
  );
  TG.migrate(db);
  const store = TG.createStore(db),
    write = (action, b) =>
      store.mutate(action, { request_id: crypto.randomUUID(), ...b }, "合成");
  write("student", {
    name: "合成自动计费",
    grade: "初一",
    start_date: "2026-09-01",
  });
  const read = (month = "2026-09") =>
    store.snapshot(month, true).summary.find((s) => s.id === 1);
  const historical = (status, date = "2026-09-01", fee = 0, pending = 1) =>
    Number(
      db
        .prepare(
          "INSERT INTO tg_attendance(student_id,date,status,grade,rule_json,fee,pending,reference_fee,raw_status,source_cell) VALUES(1,?,?,'初一','{\"present\":3000,\"leave_fee\":1500}',?,?,3000,?,'E13')",
        )
        .run(date, status, fee, pending, status).lastInsertRowid,
    );
  const attend = (status, date = "2026-09-01", version = 0) =>
    write("attendance", { date, rows: [{ student_id: 1, status, version }] });
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { db, dir, store, write, read, historical, attend };
}
test("saved four states charge fixed cents; defaults and archived rates never charge", (t) => {
  const f = fixture(t);
  assert.equal(f.read().fee, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM tg_attendance").get().n, 0);
  f.db.exec(
    "INSERT INTO tg_rules(effective_date,present,leave_fee,absent,notes,created_by,pending) VALUES('2026-09-01',3000,1500,3000,'合成旧标准','合成',1)",
  );
  for (const [i, status] of Object.keys(B.FEES).entries())
    f.attend(status, "2026-09-0" + (i + 1));
  assert.equal(f.read().fee, 7500);
  assert.equal(f.read().actual_consumption, 7500);
  assert.equal(f.read().gift_consumption, 0);
  assert.throws(
    () =>
      f.write("rule", {
        effective_date: "2026-09-01",
        present: 3000,
        leave_fee: 1500,
        absent: 0,
      }),
    /统一标准/,
  );
  assert.throws(() => f.write("resolve", { id: 1 }), /不支持/);
});
test("historical effective attendance settles and placeholders normalize while source evidence survives idempotently", (t) => {
  const f = fixture(t);
  for (const [i, status] of [
    "出勤",
    "请假",
    "放假",
    "不适用",
    "未登记",
    "缺勤",
    "停课",
  ].entries())
    f.historical(status, "2026-09-0" + (i + 1));
  const original = f.db
    .prepare(
      "SELECT id,status,raw_status,source_cell,reference_fee FROM tg_attendance ORDER BY id",
    )
    .all();
  original.find(r=>r.status==="未登记").status="不适用";
  const result = TG.migrate(f.db).settlement;
  assert.equal(result.entries, 2);
  assert.equal(result.net_change, 7500);
  assert.equal(f.read().fee, 7500);
  assert.deepEqual(
    f.db
      .prepare(
        "SELECT id,status,raw_status,source_cell,reference_fee FROM tg_attendance ORDER BY id",
      )
      .all(),
    original,
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT count(*) n FROM tg_attendance WHERE status IN ('未登记','缺勤','停课') AND pending=1",
      )
      .get().n,
    2,
  );
  const signature = T.signature(f.db);
  assert.equal(TG.migrate(f.db).settlement.updated, 0);
  assert.equal(T.signature(f.db), signature);
  assert.equal(
    f.db.prepare("SELECT balance FROM students").get().balance,
    12345,
  );
});
test("existing charge is recognized; old rate is reversed and recharged without deleting ledger", (t) => {
  const f = fixture(t);
  const existing = f.historical("出勤", "2026-09-01", 5000, 0),
    changed = f.historical("请假", "2026-09-02", 1500, 0);
  for (const [id, date, amount] of [
    [existing, "2026-09-01", -5000],
    [changed, "2026-09-02", -1500],
  ])
    f.db
      .prepare(
        "INSERT INTO tg_ledger(student_id,date,kind,amount,notes,actor,attendance_id) VALUES(1,?,'考勤扣费',?,'合成原账','合成',?)",
      )
      .run(date, amount, id);
  const before = f.db.prepare("SELECT * FROM tg_ledger ORDER BY id").all();
  assert.equal(TG.migrate(f.db).settlement.entries, 2);
  assert.deepEqual(
    f.db.prepare("SELECT * FROM tg_ledger WHERE id<=2 ORDER BY id").all(),
    before,
  );
  assert.equal(f.read().fee, 7500);
  assert.equal(
    f.db
      .prepare("SELECT count(*) n FROM tg_ledger WHERE attendance_id=?")
      .get(existing).n,
    1,
  );
});
test("direct pending correction, status reversals, duplicate saves and optimistic conflict maintain net consumption", (t) => {
  const f = fixture(t);
  f.historical("出勤");
  let version = 1;
  for (const [status, fee] of [
    ["请假", 2500],
    ["出勤", 5000],
    ["放假", 0],
    ["不适用", 0],
    ["出勤", 5000],
  ]) {
    const row = f.attend(status, "2026-09-01", version)[0];
    assert.equal(row.version, ++version);
    assert.equal(row.pending, 0);
    assert.equal(f.read().fee, fee);
    const count = f.db.prepare("SELECT count(*) n FROM tg_ledger").get().n;
    assert.equal(f.attend(status, "2026-09-01", version)[0].version, version);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM tg_ledger").get().n,
      count,
    );
  }
  assert.throws(() => f.attend("请假", "2026-09-01", 1), /他人修改/);
  assert.equal(f.read().fee, 5000);
});
test("automatic historical consumption uses shared gift/debt allocation and recalculates following months", (t) => {
  const f = fixture(t);
  f.historical("出勤");
  f.historical("请假", "2026-09-02");
  f.write("money", {
    student_id: 1,
    date: "2026-09-03",
    kind: "充值",
    actual_amount: 2000,
    gift_amount: 4000,
    notes: "合成",
  });
  TG.migrate(f.db);
  assert.deepEqual(
    [
      f.read().fee,
      f.read().actual_consumption,
      f.read().gift_consumption,
      f.read().actual_balance,
      f.read().gift_balance,
    ],
    [7500, 3500, 4000, -1500, 0],
  );
  f.write("money", {
    student_id: 1,
    date: "2026-10-01",
    kind: "充值",
    actual_amount: 1000,
    gift_amount: 2000,
    notes: "合成",
  });
  assert.deepEqual(
    [
      f.read("2026-10").fee,
      f.read("2026-10").actual_balance,
      f.read("2026-10").gift_balance,
    ],
    [0, 0, 1500],
  );
  const version = f.db
    .prepare("SELECT version FROM tg_attendance WHERE id=1")
    .get().version;
  f.attend("放假", "2026-09-01", version);
  assert.deepEqual(
    [f.read("2026-10").actual_balance, f.read("2026-10").gift_balance],
    [1000, 5500],
  );
});
test("late migration failure rolls back attendance, ledger, audit and portable IDs", (t) => {
  const f = fixture(t);
  f.historical("出勤");
  f.historical("请假", "2026-09-02");
  f.db.exec(
    "CREATE TRIGGER reject_auto BEFORE INSERT ON tg_ledger WHEN NEW.attendance_id=2 BEGIN SELECT RAISE(ABORT,'synthetic settlement failure');END",
  );
  const before = T.signature(f.db);
  assert.throws(() => TG.migrate(f.db), /synthetic settlement/);
  assert.equal(T.signature(f.db), before);
  assert.equal(f.db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
});
test("broken charge chains reject migration before any writes", (t) => {
  const f = fixture(t);
  const id = f.historical("出勤");
  f.db
    .prepare(
      "INSERT INTO tg_ledger(student_id,date,kind,amount,notes,actor,attendance_id) VALUES(1,'2026-09-01','考勤冲正',5000,'合成坏链','合成',?)",
    )
    .run(id);
  const before = T.signature(f.db);
  assert.throws(() => TG.migrate(f.db), /冲正链异常/);
  assert.equal(T.signature(f.db), before);
});
test("v1/v2 pending imports settle in preview and once in transaction; v3 transfers do not charge twice", async (t) => {
  const source = fixture(t);
  source.historical("出勤");
  source.historical("请假", "2026-09-02");
  const exported = T.exportData(source.db);
  for (const version of [1, 2]) {
    const target = fixture(t);
    target.db.exec(
      "DELETE FROM tg_periods;DELETE FROM tg_students;DELETE FROM tg_audit;DELETE FROM tg_requests",
    );
    const bundle = structuredClone(exported);
    bundle.version = version;
    if (version === 1)
      for (const i of bundle.records.tg_ledger) {
        delete i.record.actual_amount;
        delete i.record.gift_amount;
      }
    delete bundle.checksum;
    bundle.checksum = T.hash(bundle);
    const text = JSON.stringify(bundle),
      before = T.signature(target.db);
    const preview = T.plan(target.db, T.parse(target.db, text));
    assert.equal(preview.summary.settlement.net_change, 7500);
    assert.equal(T.signature(target.db), before);
    await T.confirm(target.db, text, before, target.dir, "合成");
    assert.equal(target.read().fee, 7500);
    const signature = T.signature(target.db);
    assert.deepEqual(
      T.plan(target.db, T.parse(target.db, text)).summary.settlement,
      { updated: 0, net_change: 0 },
    );
    assert.equal(
      (await T.confirm(target.db, text, signature, target.dir, "合成")).created,
      0,
    );
    assert.equal(T.signature(target.db), signature);
    const v3 = JSON.stringify(T.exportData(target.db));
    assert.equal(T.plan(target.db, T.parse(target.db, v3)).summary.created, 0);
    assert.equal(TG.migrate(target.db).settlement.entries, 0);
  }
});
test("first and latest custody dates reflect saved presence only across months", (t) => {
  const f = fixture(t);
  f.attend("请假");
  f.attend("放假", "2026-09-02");
  assert.equal(f.read().first_attendance_date, null);
  f.attend("出勤", "2026-09-03");
  f.attend("不适用", "2026-10-01");
  f.attend("出勤", "2026-10-02");
  assert.deepEqual(
    [f.read().first_attendance_date, f.read().last_attendance_date],
    ["2026-09-03", "2026-10-02"],
  );
  f.attend("请假", "2026-10-02", 1);
  assert.equal(f.read().last_attendance_date, "2026-09-03");
});
