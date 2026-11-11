const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const { migrate, createStore } = require("../src/domain/tuoguan");
const { stage, commit, preview } = require("../src/domain/tuoguan_import");
const { createWorkbook } = require("../src/excel/xlsx_codec");
test("historical import conflict rolls back prior rows and calendar atomically", () => {
  const { s, write, db } = fixture();
  write("attendance", {
    date: "2026-09-20",
    rows: [{ student_id: 1, status: "出勤", version: 0 }],
  });
  const p = {
    id: "synthetic-source",
    month: "2026-09",
    students: [
      { source_key: "1", name: "合成学生甲", grade: "初一", class_name: "A" },
    ],
    records: [
      {
        source_key: "1",
        date: "2026-09-19",
        status: "出勤",
        grade: "初一",
        class_name: "A",
      },
      {
        source_key: "1",
        date: "2026-09-20",
        status: "请假",
        grade: "初一",
        class_name: "A",
      },
    ],
    rules: { present: 5000, leave_fee: 2500, absent: 5000 },
    issues: [],
    difference: 0,
  };
  stage(s, p, "测试");
  assert.throws(
    () =>
      commit(
        s,
        { id: p.id, mapping: { 1: 1 }, request_id: crypto.randomUUID() },
        "测试",
      ),
    /冲突/,
  );
  assert.equal(s.all("SELECT * FROM tg_attendance").length, 1);
  assert.equal(
    s.get("SELECT * FROM tg_calendar WHERE date='2026-09-19'"),
    undefined,
  );
  assert.equal(
    s.get("SELECT result FROM tg_imports WHERE id=?", p.id).result,
    null,
  );
  db.close();
});
test("pending historical charge requires explicit resolution and keeps zero-fee states free", () => {
  const { s, write, db } = fixture();
  s.run(
    "INSERT INTO tg_attendance(student_id,date,status,grade,class_name,rule_json,fee,pending) VALUES(1,'2026-09-20','未登记','初一','A','{}',0,1)",
  );
  assert.throws(
    () =>
      write("attendance", {
        date: "2026-09-20",
        rows: [{ student_id: 1, status: "出勤", version: 1 }],
      }),
    /待核对/,
  );
  const b = {
    id: 1,
    version: 1,
    status: "出勤",
    present: 5000,
    leave_fee: 2500,
    absent: 2500,
    notes: "合成核对凭据",
    request_id: crypto.randomUUID(),
  };
  write("resolve", b);
  write("resolve", b);
  assert.equal(s.snapshot("2026-09", true).summary[0].fee, 5000);
  assert.equal(s.snapshot("2026-09", true).summary[0].pending, 0);
  assert.throws(
    () => write("resolve", { ...b, request_id: crypto.randomUUID() }),
    /变更/,
  );
  db.close();
});
test("student specific rates, effective dates and calendar integrity", () => {
  const { s, write, db } = fixture();
  write("rule", {
    student_id: 1,
    effective_date: "2026-09-21",
    present: 3000,
    leave_fee: 1500,
    absent: 3000,
  });
  write("calendar", { date: "2026-09-21", enabled: 1, version: 0 });
  write("attendance", {
    date: "2026-09-20",
    rows: [{ student_id: 1, status: "出勤", version: 0 }],
  });
  write("attendance", {
    date: "2026-09-21",
    rows: [{ student_id: 1, status: "出勤", version: 0 }],
  });
  assert.equal(s.snapshot("2026-09", true).summary[0].fee, 8000);
  assert.throws(
    () => write("calendar", { date: "2026-09-20", enabled: 0, version: 1 }),
    /先更正/,
  );
  const publicRows = s.snapshot("2026-09", false).attendance;
  assert.ok(
    publicRows.every((r) => r.fee === undefined && r.rule_json === undefined),
  );
  db.close();
});
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE students(id INTEGER PRIMARY KEY,name TEXT,grade TEXT);CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT);INSERT INTO students VALUES(1,'合成学生甲','初一'),(2,'合成学生乙','初二');CREATE TABLE lessons(id INTEGER PRIMARY KEY,student_names TEXT);INSERT INTO lessons VALUES(1,'合成学生甲');",
  );
  migrate(db);
  const s = createStore(db);
  const write = (a, b) =>
    s.mutate(a, { request_id: crypto.randomUUID(), ...b }, "合成管理员");
  write("period", {
    student_id: 1,
    grade: "初一",
    class_name: "A",
    start_date: "2026-09-01",
    status: "在托",
  });
  write("rule", {
    effective_date: "2026-09-01",
    present: 5000,
    leave_fee: 2500,
    absent: 5000,
  });
  write("calendar", { date: "2026-09-20", enabled: 1, version: 0 });
  return { db, s, write };
}
test("all statuses, immutable rate snapshot, correction and idempotency", () => {
  const { s, write, db } = fixture();
  assert.equal(s.snapshot("2026-09", true).summary[0].balance, 0);
  assert.equal(s.snapshot("2026-09", true).summary[0].unregistered, 1);
  let version = 0;
  for (const [status, fee] of [
    ["未登记", 0],
    ["出勤", 5000],
    ["请假", 2500],
    ["缺勤", 5000],
    ["停课", 0],
    ["不适用", 0],
  ]) {
    const b = {
      request_id: crypto.randomUUID(),
      date: "2026-09-20",
      rows: [{ student_id: 1, status, version, notes: "" }],
    };
    const r = write("attendance", b);
    version = r[0].version;
    assert.deepEqual(write("attendance", b), JSON.parse(JSON.stringify(r)));
    assert.equal(
      s.snapshot("2026-09", true).summary[0].balance,
      fee ? -fee : 0,
    );
  }
  assert.throws(
    () =>
      write("attendance", {
        date: "2026-09-20",
        rows: [{ student_id: 1, status: "出勤", version: 0 }],
      }),
    /他人修改/,
  );
  write("rule", {
    effective_date: "2026-09-01",
    present: 9900,
    leave_fee: 4900,
    absent: 9900,
  });
  write("attendance", {
    date: "2026-09-20",
    rows: [{ student_id: 1, status: "出勤", version }],
  });
  assert.equal(s.snapshot("2026-09", true).summary[0].fee, 5000);
  assert.equal(db.prepare("SELECT count(*) n FROM lessons").get().n, 1);
  db.close();
});
test("money types, duplicate requests, monthly rollover and atomic batch rollback", () => {
  const { s, write, db } = fixture();
  const request_id = crypto.randomUUID();
  write("money", {
    request_id,
    student_id: 1,
    date: "2026-09-01",
    kind: "充值",
    amount: 10000,
    notes: "合成收款",
  });
  write("money", {
    request_id,
    student_id: 1,
    date: "2026-09-01",
    kind: "充值",
    amount: 10000,
    notes: "合成收款",
  });
  assert.throws(
    () =>
      write("money", {
        request_id,
        student_id: 1,
        date: "2026-09-01",
        kind: "充值",
        amount: 20000,
        notes: "合成收款",
      }),
    /不同内容/,
  );
  for (const [kind, amount] of [
    ["退款", 1000],
    ["优惠", 500],
    ["调整", -200],
  ])
    write("money", {
      student_id: 1,
      date: "2026-09-02",
      kind,
      amount,
      notes: "测试",
    });
  assert.equal(s.snapshot("2026-10", true).summary[0].opening, 9300);
  assert.throws(
    () =>
      write("money", {
        student_id: 1,
        date: "2026-09-02",
        kind: "充值",
        amount: 0.1,
        notes: "测试",
      }),
    /整数/,
  );
  assert.throws(
    () =>
      write("attendance", {
        date: "2026-09-20",
        rows: [
          { student_id: 1, status: "出勤", version: 0 },
          { student_id: 2, status: "出勤", version: 0 },
        ],
      }),
    /周期/,
  );
  assert.equal(s.all("SELECT * FROM tg_attendance").length, 0);
  assert.equal(s.snapshot("2026-09", false).ledger, undefined);
  db.close();
});
test("exit, resume and overlap prevention", () => {
  const { s, write, db } = fixture();
  const p = s.all("SELECT * FROM tg_periods")[0];
  write("period", { ...p, end_date: "2026-09-20", status: "暂停" });
  write("period", {
    student_id: 1,
    grade: "初二",
    class_name: "B",
    start_date: "2026-10-01",
    status: "在托",
  });
  assert.throws(
    () =>
      write("period", {
        student_id: 1,
        grade: "初二",
        class_name: "B",
        start_date: "2026-10-02",
        status: "在托",
      }),
    /重叠/,
  );
  assert.equal(s.all("SELECT * FROM tg_periods").length, 2);
  db.close();
});
test("synthetic September/October XLSX preview and repeated import do not post funds", () => {
  const { s, db } = fixture();
  for (const m of [9, 10]) {
    const serial = m === 9 ? 46285 : 46305;
    const buffer = createWorkbook([
      {
        name: "收费总览",
        rows: [
          [`2026年${m}月`],
          ["初一收费与余额"],
          ["序号", "学生编号"],
          [1, "X" + m, "合成学生甲", "A", 100, 50],
        ],
      },
      {
        name: "收费规则",
        rows: [
          ["正常日托管费", 50],
          ["请假当日托管费", 25],
          ["缺勤当日托管费", m === 9 ? 25 : 50],
        ],
      },
      {
        name: "初一考勤订餐",
        rows: [
          ["序号", "学生编号", "学生姓名", "班级", serial],
          [1, "X" + m, "合成学生甲", "A", "出勤"],
          ["序号", "学生编号", "学生姓名", "班级", serial],
          [1, "X" + m, "合成学生甲", "A", "订餐"],
        ],
      },
    ]);
    const p = preview(buffer);
    assert.equal(p.records.length, 1);
    assert.equal(p.reference, 5000);
    stage(s, p, "测试");
    const b = { id: p.id, mapping: { 4: 1 }, request_id: crypto.randomUUID() };
    const r = commit(s, b, "测试");
    assert.equal(r.posted_amount, 0);
    assert.deepEqual(
      commit(s, { ...b, request_id: crypto.randomUUID() }, "测试"),
      r,
    );
  }
  assert.equal(s.all("SELECT * FROM tg_ledger").length, 0);
  assert.equal(s.all("SELECT * FROM students").length, 2);
  db.close();
});
