const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite"),
  TG = require("../src/domain/tuoguan"),
  T = require("../src/domain/tuoguan_transfer"),
  B = require("../src/domain/tuoguan_settlement");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-stage-")),
    db = new DatabaseSync(path.join(dir, "test.sqlite"));
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT)",
  );
  TG.migrate(db);
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const store = TG.createStore(db),
    write = (a, b) =>
      store.mutate(a, { request_id: crypto.randomUUID(), ...b }, "合成");
  return { dir, db, store, write };
}
const exportText = (f) => JSON.stringify(T.exportData(f.db));
const apply = (f, text) =>
  T.confirm(f.db, text, T.signature(f.db), f.dir, "合成同步");
const attend = (f, id, date, status = "出勤") =>
  f.write("attendance", {
    date,
    rows: [
      {
        student_id: id,
        status,
        version:
          f.store.get(
            "SELECT version FROM tg_attendance WHERE student_id=? AND date=?",
            id,
            date,
          )?.version || 0,
      },
    ],
  })[0];
test("stage pricing, mixed batch, effective dates, historical grade and pinned snapshots", (t) => {
  const f = fixture(t),
    primary = f.write("student", {
      name: "合成小学",
      grade: "三年级",
      start_date: "2026-09-01",
    }),
    junior = f.write("student", {
      name: "合成初三",
      grade: "初三",
      start_date: "2026-09-01",
    });
  const result = f.write("batch-attendance", {
    month: "2026-09",
    status: "出勤",
    cells: [primary, junior].map((s) => ({
      student_id: s.id,
      date: "2026-09-01",
      version: 0,
    })),
  });
  assert.deepEqual(
    result.map((r) => r.fee),
    [3000, 5000],
  );
  assert.equal(attend(f, primary.id, "2026-09-02", "请假").fee, 2500);
  f.write("rule", {
    stage: "小学",
    effective_date: "2026-09-03",
    present: 3200,
    leave_fee: 1900,
    absent: 0,
  });
  assert.equal(attend(f, primary.id, "2026-09-03", "请假").fee, 1900);
  assert.equal(attend(f, junior.id, "2026-09-03", "请假").fee, 2500);
  f.write("rule", {
    stage: "小学",
    effective_date: "2026-09-01",
    present: 3500,
    leave_fee: 1800,
    absent: 0,
  });
  assert.equal(
    attend(f, primary.id, "2026-09-01", "请假").fee,
    2500,
    "saved rule remains pinned",
  );
  assert.equal(attend(f, primary.id, "2026-09-04").fee, 3200);
  for (const state of ["放假", "不适用"])
    assert.equal(attend(f, primary.id, "2026-09-04", state).fee, 0);
  f.write("student", {
    id: primary.id,
    version: primary.version,
    name: primary.name,
    grade: "初一",
  });
  assert.equal(
    attend(f, primary.id, "2026-09-07").fee,
    3200,
    "historical period grade wins over profile",
  );
  const period = f.store.get(
    "SELECT * FROM tg_periods WHERE student_id=?",
    primary.id,
  );
  f.write("period", { ...period, end_date: "2026-09-30" });
  f.write("period", {
    student_id: primary.id,
    grade: "初一",
    start_date: "2026-10-01",
    status: "在托",
  });
  assert.equal(attend(f, primary.id, "2026-10-01").fee, 5000);
  const before = T.signature(f.db);
  TG.migrate(f.db);
  assert.equal(T.signature(f.db), before);
  assert.equal(B.needsMigration(f.db), false);
  for (const value of [-1, 1.5, NaN])
    assert.throws(() =>
      f.write("rule", {
        stage: "小学",
        effective_date: "2026-11-01",
        present: value,
        leave_fee: 2500,
        absent: 0,
      }),
    );
});
test("legacy settlement JSON remains byte-identical with unchanged ledger and summary", (t) => {
  const f = fixture(t),
    s = f.write("student", {
      name: "合成旧初中",
      grade: "初一",
      start_date: "2026-09-01",
    });
  attend(f, s.id, "2026-09-01");
  f.db.prepare("UPDATE tg_attendance SET rule_json=?").run(B.RULE_JSON);
  const before = T.signature(f.db),
    summary = f.store.snapshot("2026-09", true).summary;
  TG.migrate(f.db);
  assert.equal(T.signature(f.db), before);
  assert.deepEqual(f.store.snapshot("2026-09", true).summary, summary);
});
test("A to B corrections, voids, source period removal, replays, independent target rows and conflicts", async (t) => {
  const a = fixture(t),
    b = fixture(t),
    s = a.write("student", {
      name: "合成同步小学",
      grade: "三年级",
      start_date: "2026-09-01",
    });
  a.write("money", {
    student_id: s.id,
    date: "2026-09-01",
    kind: "充值",
    actual_amount: 20000,
    gift_amount: 5000,
  });
  attend(a, s.id, "2026-09-01");
  a.write("student", { name: "合成空周期", grade: "初二", month: "2026-11" });
  const input = exportText(a);
  await apply(b, input);
  const first = T.signature(b.db);
  await apply(b, input);
  assert.equal(T.signature(b.db), first);
  const money = a.store.get("SELECT * FROM tg_ledger WHERE kind='充值'");
  a.write("money-edit", { ...money, actual_amount: 30000, gift_amount: 7000 });
  attend(a, s.id, "2026-09-01", "请假");
  const p = a.store.get("SELECT * FROM tg_periods WHERE student_id=2");
  a.write("remove-students", {
    month: "2026-11",
    students: [{ id: 2, versions: [[p.id, p.version]] }],
  });
  b.write("student", { name: "合成目标独立", grade: "初三" });
  const updated = exportText(a),
    preview = T.plan(b.db, T.parse(b.db, updated));
  assert.equal(preview.conflicts.length, 0, JSON.stringify(preview.conflicts));
  assert.ok(preview.summary.updated >= 2);
  assert.equal(preview.summary.deleted, 1);
  await apply(b, updated);
  assert.equal(b.store.get("SELECT count(*) n FROM tg_students").n, 3);
  assert.deepEqual(
    b.store.snapshot("2026-09", true).summary.find((x) => x.id === s.id),
    a.store.snapshot("2026-09", true).summary.find((x) => x.id === s.id),
  );
  const stable = T.signature(b.db);
  await apply(b, updated);
  assert.equal(T.signature(b.db), stable);
  const replacement = a.store.get(
    "SELECT * FROM tg_ledger WHERE kind='充值' AND voided_at IS NULL",
  );
  a.write("money-delete", {
    records: [{ id: replacement.id, version: replacement.version }],
  });
  await apply(b, exportText(a));
  assert.equal(
    b.store.get(
      "SELECT count(*) n FROM tg_ledger WHERE kind='充值' AND voided_at IS NULL",
    ).n,
    0,
  );
  attend(b, s.id, "2026-09-01", "放假");
  const local = T.signature(b.db);
  await apply(b, exportText(a));
  assert.equal(
    T.signature(b.db),
    local,
    "unchanged source preserves independent target change",
  );
  attend(a, s.id, "2026-09-01", "出勤");
  const conflict = exportText(a);
  assert.ok(T.plan(b.db, T.parse(b.db, conflict)).conflicts.length);
  await assert.rejects(apply(b, conflict));
  assert.equal(T.signature(b.db), local);
});
test("teacher references resolve by unique name; missing or ambiguous names block import", async (t) => {
  const a = fixture(t),
    b = fixture(t);
  a.db.exec("INSERT INTO teachers VALUES(3,'合成教师')");
  a.write("calendar", {
    date: "2026-09-01",
    enabled: 1,
    teacher_id: 3,
    version: 0,
  });
  const input = exportText(a);
  assert.ok(
    T.plan(b.db, T.parse(b.db, input)).conflicts.some((c) =>
      c.reason.includes("教师"),
    ),
  );
  b.db.exec("INSERT INTO teachers VALUES(70,'合成教师')");
  await apply(b, input);
  assert.equal(
    b.store.get("SELECT teacher_id FROM tg_calendar").teacher_id,
    70,
  );
  b.db.exec("INSERT INTO teachers VALUES(71,'合成教师')");
  assert.ok(T.plan(b.db, T.parse(b.db, input)).conflicts.length);
});
test("v5 import preserves historical rules and repeats without billing again", async (t) => {
  const a = fixture(t),
    b = fixture(t),
    s = a.write("student", {
      name: "合成v5",
      grade: "初一",
      start_date: "2026-09-01",
    });
  attend(a, s.id, "2026-09-01");
  const old = T.exportData(a.db);
  old.version = 5;
  delete old.teacher_links;
  for (const i of old.records.tg_audit) delete i.record.origin_json;
  old.records.tg_rules = old.records.tg_rules.filter(
    (i) => i.record.stage === "初中",
  );
  for (const i of old.records.tg_rules) delete i.record.stage;
  delete old.checksum;
  old.checksum = T.hash(old);
  const text = JSON.stringify(old);
  await apply(b, text);
  const before = T.signature(b.db);
  await apply(b, text);
  assert.equal(T.signature(b.db), before);
  assert.equal(b.store.snapshot("2026-09", true).summary[0].fee, 5000);
});
test("logs use saved truth, unsaved default and committed cell count, never log no-op or rollback", (t) => {
  const f = fixture(t),
    s = f.write("student", {
      name: "合成日志",
      grade: "三年级",
      month: "2026-11",
    }).student,
    describe = require("../src/domain/tuoguan_log").describe;
  const start = f.store.get("SELECT MAX(id) id FROM tg_audit").id;
  attend(f, s.id, "2026-11-02");
  const logs = f.store.all("SELECT * FROM tg_audit WHERE id>?", start),
    entry = describe(f.db, "attendance", logs);
  assert.match(
    entry.operation_content,
    /合成日志（三年级）2026-11-02考勤：未保存默认不适用 → 出勤/,
  );
  const before = f.store.get("SELECT count(*) n FROM tg_audit").n;
  attend(f, s.id, "2026-11-02");
  assert.equal(f.store.get("SELECT count(*) n FROM tg_audit").n, before);
  assert.throws(() =>
    f.write("batch-attendance", {
      month: "2026-11",
      status: "请假",
      cells: [
        { student_id: s.id, date: "2026-11-02", version: 1 },
        { student_id: s.id, date: "2026-11-03", version: 99 },
      ],
    }),
  );
  assert.equal(f.store.get("SELECT count(*) n FROM tg_audit").n, before);
});

test("same-day rule amendments and original audit identities survive onward exports", async (t) => {
  const a = fixture(t),
    b = fixture(t),
    c = fixture(t);
  a.write("student", {
    name: "合成来源证据",
    grade: "三年级",
    start_date: "2026-09-01",
  });
  attend(a, 1, "2026-09-01");
  a.write("rule", {
    stage: "小学",
    effective_date: "2026-11-01",
    present: 3200,
    leave_fee: 2400,
    absent: 0,
  });
  await apply(b, exportText(a));
  a.write("rule", {
    stage: "小学",
    effective_date: "2026-11-01",
    present: 3300,
    leave_fee: 2300,
    absent: 0,
  });
  await apply(b, exportText(a));
  assert.equal(
    b.store.all(
      "SELECT * FROM tg_rules WHERE stage='小学' AND effective_date='2026-11-01'",
    ).length,
    2,
  );
  await apply(c, exportText(b));
  const originA = a.store.get(
      "SELECT origin_json FROM tg_audit WHERE action='考勤'",
    ).origin_json,
    originC = c.store.get(
      "SELECT origin_json FROM tg_audit WHERE action='考勤'",
    ).origin_json;
  assert.equal(originC, originA);
  assert.ok(
    Object.keys(JSON.parse(originC).references).includes("tg_students:1"),
  );
});

test("backup compatibility rejects invalid stages and fractional/negative rates before restoring", () => {
  const normalize = require("../src/domain/tuoguan_schema").simplifyBackup;
  for (const patch of [
    { stage: "高中" },
    { present: -1 },
    { leave_fee: 1.5 },
    { absent: 100 },
  ])
    assert.throws(() =>
      normalize({
        tg_rules: [
          {
            stage: "小学",
            present: 3000,
            leave_fee: 2500,
            absent: 0,
            ...patch,
          },
        ],
      }),
    );
  assert.throws(() =>
    normalize({ tg_students: [{ name: "合成", grade: "三" }] }),
  );
  assert.equal(
    normalize({ tg_rules: [{ present: 5000, leave_fee: 2500, absent: 5000 }] })
      .tg_rules[0].stage,
    "",
  );
});
