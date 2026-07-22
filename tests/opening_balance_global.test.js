const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const {
  migrateOpeningBalancesToGlobal,
  scanOpeningBalanceMigration,
} = require("../src/domain/opening_balance_migration");

function legacyDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE student_opening_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_key TEXT NOT NULL,
      student_name TEXT NOT NULL,
      grade TEXT DEFAULT '',
      opening_actual_balance REAL DEFAULT 0,
      opening_gift_balance REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (month_key, student_name)
    );
    CREATE TABLE operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_name TEXT,
      operator_account TEXT,
      operation_type TEXT,
      operation_content TEXT,
      target_type TEXT,
      target_id TEXT,
      result_status TEXT,
      extra_json TEXT
    );
  `);
  return db;
}

function insertLegacy(db, values) {
  db.prepare(`
    INSERT INTO student_opening_balances(
      id, month_key, student_name, grade, opening_actual_balance,
      opening_gift_balance, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...values);
}

test("one legacy opening balance migrates to one global row without month", () => {
  const db = legacyDatabase();
  insertLegacy(db, [11, "2026-02-01", "单条学生", "初一", 1000, 200, "保留备注", "2026-01-01", "2026-02-01"]);
  const result = migrateOpeningBalancesToGlobal(db);
  assert.deepEqual(result, { migrated: true, deduplicated_students: 0, migrated_rows: 1 });
  assert.equal(db.prepare("PRAGMA table_info(student_opening_balances)").all().some((column) => column.name === "month_key"), false);
  assert.deepEqual({ ...db.prepare("SELECT id,student_name,grade,opening_actual_balance,opening_gift_balance,notes FROM student_opening_balances").get() }, {
    id: 11, student_name: "单条学生", grade: "初一", opening_actual_balance: 1000, opening_gift_balance: 200, notes: "保留备注",
  });
  assert.throws(() => db.prepare("INSERT INTO student_opening_balances(student_name) VALUES ('单条学生')").run(), /UNIQUE constraint failed/);
  db.close();
});

test("identical legacy rows are deduplicated and their original months are logged", () => {
  const db = legacyDatabase();
  insertLegacy(db, [21, "2026-02-01", "重复学生", "初二", 300, 40, "相同", "2026-01-01", "2026-02-01"]);
  insertLegacy(db, [22, "2026-03-01", "重复学生", "初二", 300, 40, "相同", "2026-01-01", "2026-03-01"]);
  const result = migrateOpeningBalancesToGlobal(db);
  assert.deepEqual(result, { migrated: true, deduplicated_students: 1, migrated_rows: 1 });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM student_opening_balances").get().count, 1);
  assert.equal(db.prepare("SELECT id FROM student_opening_balances").get().id, 21);
  const log = db.prepare("SELECT operation_type,target_id,extra_json FROM operation_logs").get();
  assert.equal(log.operation_type, "合并重复期初余额");
  assert.equal(log.target_id, "21");
  assert.deepEqual(JSON.parse(log.extra_json).source_record_ids, [21, 22]);
  assert.deepEqual(JSON.parse(log.extra_json).original_months, ["2026-02-01", "2026-03-01"]);
  db.close();
});

test("different legacy values produce a complete conflict list and leave the old table untouched", () => {
  const db = legacyDatabase();
  insertLegacy(db, [31, "2026-02-01", "冲突学生", "初一", 500, 50, "二月", "2026-01-01", "2026-02-01"]);
  insertLegacy(db, [32, "2026-03-01", "冲突学生", "初二", 700, 70, "三月", "2026-02-01", "2026-03-01"]);
  const before = db.prepare("SELECT * FROM student_opening_balances ORDER BY id").all();
  assert.throws(() => migrateOpeningBalancesToGlobal(db), (error) => {
    assert.equal(error.code, "OPENING_BALANCE_MIGRATION_CONFLICT");
    assert.deepEqual(error.conflicts, [{
      student_name: "冲突学生",
      records: [
        { id: 31, grade: "初一", opening_actual_balance: 500, opening_gift_balance: 50, notes: "二月", original_month: "2026-02-01", created_at: "2026-01-01", updated_at: "2026-02-01" },
        { id: 32, grade: "初二", opening_actual_balance: 700, opening_gift_balance: 70, notes: "三月", original_month: "2026-03-01", created_at: "2026-02-01", updated_at: "2026-03-01" },
      ],
    }]);
    return true;
  });
  assert.equal(db.prepare("PRAGMA table_info(student_opening_balances)").all().some((column) => column.name === "month_key"), true);
  assert.deepEqual(db.prepare("SELECT * FROM student_opening_balances ORDER BY id").all(), before);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM operation_logs").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='student_opening_balances_legacy_global_v1'").get().count, 0);
  db.close();
});

test("the global opening-balance migration is idempotent", () => {
  const db = legacyDatabase();
  insertLegacy(db, [41, "2026-02-01", "幂等学生", "高一", 800, 80, "幂等", "2026-01-01", "2026-02-01"]);
  migrateOpeningBalancesToGlobal(db);
  assert.deepEqual(scanOpeningBalanceMigration(db), { needs_migration: false, rows: [], groups: [], conflicts: [], duplicate_groups: [] });
  assert.deepEqual(migrateOpeningBalancesToGlobal(db), { migrated: false, deduplicated_students: 0, migrated_rows: 0 });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM student_opening_balances").get().count, 1);
  db.close();
});
