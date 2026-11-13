const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { DatabaseSync } = require("node:sqlite"),
  TG = require("../src/domain/tuoguan"),
  B = require("../src/domain/tuoguan_settlement"),
  N = require("../src/domain/tuoguan_normalization"),
  T = require("../src/domain/tuoguan_transfer");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-protection-")),
    db = new DatabaseSync(path.join(dir, "test.sqlite"));
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT);CREATE TABLE students(id INTEGER PRIMARY KEY,name TEXT);INSERT INTO students VALUES(1,'合成补课');CREATE TABLE salary_history(id INTEGER PRIMARY KEY,amount INTEGER);INSERT INTO salary_history VALUES(1,12345)",
  );
  TG.migrate(db);
  const store = TG.createStore(db),
    write = (a, b) =>
      store.mutate(a, { request_id: crypto.randomUUID(), ...b }, "合成保护");
  write("student", {
    name: "合成托管",
    grade: "初一",
    start_date: "2026-09-01",
  });
  const attend = (status, date = "2026-09-01") =>
      write("attendance", {
        date,
        rows: [
          {
            student_id: 1,
            status,
            version:
              store.get(
                "SELECT version FROM tg_attendance WHERE student_id=1 AND date=?",
                date,
              )?.version || 0,
          },
        ],
      }),
    removeDate = (date = "2026-09-01") =>
      write("remove-dates", {
        month: date.slice(0, 7),
        dates: [
          {
            date,
            version:
              store.get("SELECT version FROM tg_calendar WHERE date=?", date)
                ?.version || 0,
          },
        ],
      }),
    removeStudent = () =>
      write("remove-students", {
        month: "2026-09",
        students: [
          {
            id: 1,
            versions: store
              .all(
                "SELECT id,version FROM tg_periods WHERE student_id=1 AND start_date<='2026-09-30' AND COALESCE(end_date,'9999')>='2026-09-01' ORDER BY id",
              )
              .map((r) => [r.id, r.version]),
          },
        ],
      });
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { db, dir, store, write, attend, removeDate, removeStudent };
}
for (const state of ["出勤", "请假", "放假"])
  test(
    state +
      " protects dates and monthly students in all snapshots and both calendar write paths",
    (t) => {
      const f = fixture(t);
      f.attend(state);
      const full = f.store.snapshot("2026-09", true),
        cal = f.store.calendarSnapshot("2026-09"),
        members = f.store.participationSnapshot("2026-09");
      assert.deepEqual(full.protected_dates, cal.protected_dates);
      assert.deepEqual(cal.protected_dates, ["2026-09-01"]);
      assert.deepEqual(members.protected_students, [1]);
      assert.throws(() => f.removeDate(), /已有考勤/);
      assert.throws(() => f.removeStudent(), /已有考勤/);
      assert.throws(
        () =>
          f.write("calendar", { date: "2026-09-01", version: 1, enabled: 0 }),
        /已有考勤/,
      );
      assert.equal(full.summary[0].fee, B.FEES[state]);
    },
  );
test("not applicable and complete reversals permit removal while independent funding, source evidence and other months survive", (t) => {
  const f = fixture(t);
  f.write("money", {
    student_id: 1,
    date: "2026-09-01",
    kind: "充值",
    actual_amount: 10000,
    gift_amount: 1000,
    method: "微信",
  });
  f.attend("出勤");
  f.attend("不适用");
  f.attend("请假", "2026-10-01");
  const ledger = JSON.stringify(
      f.store.all("SELECT * FROM tg_ledger ORDER BY id"),
    ),
    attendance = JSON.stringify(
      f.store.all("SELECT * FROM tg_attendance ORDER BY id"),
    ),
    totals = f.store.snapshot("2026-10", true).summary;
  assert.deepEqual(f.store.calendarSnapshot("2026-09").protected_dates, []);
  assert.deepEqual(
    f.store.participationSnapshot("2026-09").protected_students,
    [],
  );
  f.removeDate();
  assert.equal(
    f.store
      .snapshot("2026-09", true)
      .calendar.find((r) => r.date === "2026-09-01").enabled,
    0,
  );
  f.removeStudent();
  assert.equal(
    f.store
      .participationSnapshot("2026-09")
      .periods.some((p) => p.start_date <= "2026-09-30"),
    false,
  );
  assert.equal(f.store.all("SELECT * FROM tg_students").length, 1);
  assert.deepEqual(f.store.snapshot("2026-10", true).summary, totals);
  assert.equal(
    JSON.stringify(f.store.all("SELECT * FROM tg_ledger ORDER BY id")),
    ledger,
  );
  assert.equal(
    JSON.stringify(f.store.all("SELECT * FROM tg_attendance ORDER BY id")),
    attendance,
  );
  f.write("period", { month: "2026-09", student_id: 1, student_version: 1 });
  assert.equal(
    f.store.all("SELECT * FROM tg_periods WHERE start_date='2026-09-01'")
      .length,
    1,
  );
  assert.equal(
    f.store.get(
      "SELECT default_status FROM tg_periods WHERE start_date='2026-09-01'",
    ).default_status,
    "不适用",
  );
  assert.throws(
    () =>
      f.write("period", {
        month: "2026-09",
        student_id: 1,
        student_version: 1,
      }),
    /已加入/,
  );
  f.write("add-dates", {
    month: "2026-09",
    dates: [{ date: "2026-09-01", version: 2 }],
  });
  f.attend("出勤");
  assert.equal(f.store.snapshot("2026-09", true).summary[0].fee, 5000);
  assert.equal(
    f.store.all("SELECT * FROM tg_attendance WHERE date=?", "2026-09-01")
      .length,
    1,
  );
});
test("mixed students and stale date/period versions are checked inside the atomic write", (t) => {
  const f = fixture(t);
  f.attend("不适用");
  const s = f.write("student", {
    name: "合成第二人",
    grade: "初二",
    start_date: "2026-09-01",
  });
  const stale = f.store.calendarSnapshot("2026-09");
  f.write("attendance", {
    date: "2026-09-01",
    rows: [{ student_id: s.id, status: "放假", version: 0 }],
  });
  assert.throws(() => f.removeDate(), /已有考勤/);
  f.removeStudent();
  assert.deepEqual(
    f.store.participationSnapshot("2026-09").protected_students,
    [s.id],
  );
  assert.throws(
    () =>
      f.write("remove-dates", {
        month: "2026-09",
        dates: [
          { date: "2026-09-02", version: 0 },
          { date: "2026-09-01", version: stale.calendar[0].version },
        ],
      }),
    /已有考勤/,
  );
  assert.equal(
    f.store.get("SELECT * FROM tg_calendar WHERE date='2026-09-02'"),
    undefined,
  );
  f.removeDate("2026-09-02");
  assert.throws(
    () =>
      f.write("add-dates", {
        month: "2026-09",
        dates: [{ date: "2026-09-02", version: 0 }],
      }),
    /变化/,
  );
});
test("unsettled or malformed dependencies are locked even when the current status is not applicable", (t) => {
  const f = fixture(t);
  f.attend("出勤");
  f.db.exec("UPDATE tg_attendance SET status='不适用'");
  assert.match(
    f.store.calendarSnapshot("2026-09").protected_date_reasons["2026-09-01"],
    /费用|冲正/,
  );
  assert.throws(() => f.removeStudent(), /费用|冲正/);
  f.db.exec(
    "UPDATE tg_attendance SET fee=0;INSERT INTO tg_ledger(student_id,date,kind,amount,notes,actor,attendance_id) VALUES(1,'2026-09-01','考勤冲正',4000,'合成错误','合成',1)",
  );
  assert.throws(() => f.removeDate(), /链异常/);
  f.db.exec(
    "UPDATE tg_ledger SET amount=5000 WHERE kind='考勤冲正';UPDATE tg_ledger SET date='2026-10-01' WHERE kind='考勤扣费'",
  );
  assert.throws(() => f.removeDate(), /链异常/);
  assert.ok(
    f.store.calendarSnapshot("2026-10").protected_dates.includes("2026-10-01"),
  );
  f.db.exec(
    "INSERT INTO tg_ledger(student_id,date,kind,amount,notes,actor) VALUES(1,'2026-09-03','考勤扣费',-5000,'合成断链','合成')",
  );
  assert.throws(() => f.removeDate("2026-09-03"), /关联异常/);
});
function placeholder(f, status, date) {
  f.db.exec(
    "INSERT OR IGNORE INTO tg_imports(id,payload) VALUES('synthetic-import','{}')",
  );
  f.db
    .prepare(
      "INSERT INTO tg_attendance(student_id,date,status,grade,rule_json,fee,pending,raw_status,source_cell,source_import_id,source_key) VALUES(1,?,?,'初一','{}',0,1,?,'E13','synthetic-import','source-1')",
    )
    .run(date, status, status);
}
test("placeholder migration is backed up, versioned, auditable, idempotent and leaves corrected/legacy business statuses untouched", (t) => {
  const f = fixture(t);
  for (const [i, state] of ["未登记", "", "26", "缺勤", "停课"].entries())
    placeholder(f, state, "2026-09-0" + (i + 1));
  for (const [i, state] of ["出勤", "请假", "放假"].entries())
    f.attend(state, "2026-09-0" + (i + 6));
  f.db.exec(
    "UPDATE tg_attendance SET raw_status='26' WHERE status IN ('出勤','请假','放假')",
  );
  const before = f.store.all("SELECT * FROM tg_attendance ORDER BY id"),
    ledger = JSON.stringify(f.store.all("SELECT * FROM tg_ledger ORDER BY id"));
  const result = TG.migrate(f.db);
  assert.ok(result.backup);
  assert.equal(result.normalization.updated, 3);
  assert.equal(result.normalization.skipped.length, 2);
  for (const row of before) {
    const now = f.store.get("SELECT * FROM tg_attendance WHERE id=?", row.id);
    if (row.id <= 3)
      assert.deepEqual(
        { ...now },
        {
          ...row,
          status: "不适用",
          fee: 0,
          pending: 0,
          rule_json: B.RULE_JSON,
          version: row.version + 1,
        },
      );
    else assert.deepEqual(now, row);
  }
  assert.equal(
    JSON.stringify(f.store.all("SELECT * FROM tg_ledger ORDER BY id")),
    ledger,
  );
  assert.equal(
    f.store.all("SELECT * FROM tg_audit WHERE action='规范占位考勤'").length,
    1,
  );
  assert.equal(TG.migrate(f.db).normalization.updated, 0);
  assert.equal(
    f.store.all("SELECT * FROM tg_audit WHERE action='规范占位考勤'").length,
    1,
  );
  assert.ok(
    f.store.calendarSnapshot("2026-09").protected_dates.includes("2026-09-05"),
  );
  assert.match(
    f.store.calendarSnapshot("2026-09").protected_date_reasons["2026-09-04"],
    /缺勤/,
  );
});
test("unsafe placeholders are reported and normalization SQL failure rolls back every change", (t) => {
  const f = fixture(t);
  placeholder(f, "未登记", "2026-09-01");
  placeholder(f, "", "2026-09-02");
  placeholder(f, "异常", "2026-09-03");
  f.db.exec("UPDATE tg_attendance SET fee=100 WHERE date='2026-09-03'");
  assert.equal(N.preview(f.db).skipped.length, 1);
  const before = T.signature(f.db);
  f.db.exec(
    "CREATE TRIGGER fail_normalization BEFORE UPDATE ON tg_attendance WHEN OLD.date='2026-09-02' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
  );
  assert.throws(() => TG.migrate(f.db), /synthetic/);
  assert.equal(T.signature(f.db), before);
  f.db.exec("DROP TRIGGER fail_normalization");
  const result = TG.migrate(f.db);
  assert.equal(result.normalization.updated, 2);
  assert.equal(
    f.store.get("SELECT status FROM tg_attendance WHERE date='2026-09-03'")
      .status,
    "异常",
  );
  assert.throws(() => f.removeDate("2026-09-03"), /费用/);
});
test("old text normalizes placeholders deterministically, preserves provenance and never resurrects exclusions", async (t) => {
  const a = fixture(t),
    b = fixture(t);
  b.db.exec(
    "DELETE FROM tg_periods;DELETE FROM tg_students;DELETE FROM tg_requests;DELETE FROM tg_audit",
  );
  placeholder(a, "未登记", "2026-09-01");
  const oldText = JSON.stringify(T.exportData(a.db));
  const apply = (f, text) =>
    T.confirm(
      f.db,
      text,
      T.signature(f.db),
      path.join(f.dir, "backups"),
      "合成导入",
    );
  await apply(b, oldText);
  assert.equal(
    b.store.get("SELECT status FROM tg_attendance").status,
    "不适用",
  );
  assert.equal(
    b.store.get("SELECT raw_status FROM tg_attendance").raw_status,
    "未登记",
  );
  assert.equal((await apply(b, oldText)).created, 0);
  assert.equal(b.store.all("SELECT * FROM tg_ledger").length, 0);
  b.removeDate();
  b.removeStudent();
  const onward = JSON.stringify(T.exportData(b.db)),
    c = fixture(t);
  c.db.exec(
    "DELETE FROM tg_periods;DELETE FROM tg_students;DELETE FROM tg_requests;DELETE FROM tg_audit",
  );
  await apply(c, onward);
  assert.equal(
    c.store
      .calendarSnapshot("2026-09")
      .calendar.find((r) => r.date === "2026-09-01").enabled,
    0,
  );
  assert.equal(
    c.store
      .participationSnapshot("2026-09")
      .periods.some((p) => p.start_date <= "2026-09-30"),
    false,
  );
  assert.equal(c.store.all("SELECT * FROM tg_attendance").length, 1);
  await assert.rejects(apply(b, oldText), /冲突/);
});

test("historical workbook import normalizes blank and numeric placeholders within its transaction", (t) => {
  const f = fixture(t),
    I = require("../src/domain/tuoguan_import"),
    { createWorkbook } = require("../src/excel/xlsx_codec");
  const book = createWorkbook([
    {
      name: "收费总览",
      rows: [
        ["2026年9月"],
        ["初一收费与余额"],
        ["序号", "学生编号"],
        [1, "X", "合成托管", "A", 0, 0],
      ],
    },
    {
      name: "收费规则",
      rows: [
        ["正常日托管费", 50],
        ["请假当日托管费", 25],
        ["缺勤当日托管费", 50],
      ],
    },
    {
      name: "初一考勤订餐",
      rows: [
        ["序号", "学生编号", "学生姓名", "班级", 46285, 46286],
        [1, "X", "合成托管", "A", "", 26],
      ],
    },
  ]);
  const preview = I.preview(book);
  assert.equal(preview.records.length, 2);
  I.stage(f.store, preview, "合成");
  const result = I.commit(
    f.store,
    { id: preview.id, mapping: { 4: 1 }, request_id: crypto.randomUUID() },
    "合成",
  );
  assert.equal(result.success, 2);
  const saved = f.store.all("SELECT * FROM tg_attendance ORDER BY date");
  assert.deepEqual(
    saved.map((r) => r.status),
    ["不适用", "不适用"],
  );
  assert.deepEqual(
    saved.map((r) => r.raw_status),
    ["", "26"],
  );
  assert.ok(
    saved.every(
      (r) =>
        r.source_cell &&
        r.source_import_id === preview.id &&
        r.pending === 0 &&
        r.fee === 0,
    ),
  );
  assert.equal(f.store.all("SELECT * FROM tg_ledger").length, 0);
});
