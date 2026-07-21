const GLOBAL_OPENING_BALANCE_SCHEMA = `
  CREATE TABLE student_opening_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT NOT NULL,
    grade TEXT DEFAULT '',
    opening_actual_balance REAL DEFAULT 0,
    opening_gift_balance REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_name)
  )
`;

class OpeningBalanceMigrationConflictError extends Error {
  constructor(conflicts) {
    super(`检测到 ${conflicts.length} 名学生的旧期初余额存在冲突，迁移已安全中止，原表未修改`);
    this.name = "OpeningBalanceMigrationConflictError";
    this.code = "OPENING_BALANCE_MIGRATION_CONFLICT";
    this.conflicts = conflicts;
  }
}

function text(value) { return String(value ?? "").trim(); }
function amount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function openingBalanceBusinessValue(row) {
  return {
    student_name: text(row.student_name),
    grade: text(row.grade),
    opening_actual_balance: amount(row.opening_actual_balance),
    opening_gift_balance: amount(row.opening_gift_balance),
    notes: text(row.notes),
  };
}

function sameBusinessValue(left, right) {
  return JSON.stringify(openingBalanceBusinessValue(left)) === JSON.stringify(openingBalanceBusinessValue(right));
}

function scanOpeningBalanceMigration(db) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='student_opening_balances'").get();
  if (!table) return { needs_migration: false, rows: [], groups: [], conflicts: [], duplicate_groups: [] };
  const columns = db.prepare("PRAGMA table_info(student_opening_balances)").all().map((column) => column.name);
  const hasLegacyMonth = columns.includes("month_key");
  const hasUniqueStudent = /UNIQUE\s*\(\s*student_name\s*\)/i.test(String(table.sql || ""));
  if (!hasLegacyMonth && hasUniqueStudent) {
    return { needs_migration: false, rows: [], groups: [], conflicts: [], duplicate_groups: [] };
  }

  const rows = db.prepare("SELECT * FROM student_opening_balances ORDER BY id").all();
  const grouped = new Map();
  for (const row of rows) {
    const studentName = text(row.student_name);
    const list = grouped.get(studentName) || [];
    list.push(row);
    grouped.set(studentName, list);
  }
  const groups = [...grouped.entries()].map(([student_name, records]) => ({ student_name, records }));
  const conflicts = [];
  const duplicateGroups = [];
  for (const group of groups) {
    if (group.records.length <= 1) continue;
    if (group.records.every((row) => sameBusinessValue(group.records[0], row))) {
      duplicateGroups.push(group);
      continue;
    }
    conflicts.push({
      student_name: group.student_name,
      records: group.records.map((row) => ({
        id: Number(row.id),
        grade: text(row.grade),
        opening_actual_balance: amount(row.opening_actual_balance),
        opening_gift_balance: amount(row.opening_gift_balance),
        notes: text(row.notes),
        original_month: hasLegacyMonth ? text(row.month_key) : "",
        created_at: text(row.created_at),
        updated_at: text(row.updated_at),
      })),
    });
  }
  return {
    needs_migration: true,
    has_legacy_month: hasLegacyMonth,
    rows,
    groups,
    conflicts,
    duplicate_groups: duplicateGroups,
  };
}

function recordDeduplication(db, group, keptRow) {
  const sourceIds = group.records.map((row) => Number(row.id));
  const originalMonths = group.records.map((row) => text(row.month_key)).filter(Boolean);
  const details = JSON.stringify({
    migration: "student_opening_balances_global_v1",
    student_name: group.student_name,
    kept_record_id: Number(keptRow.id),
    source_record_ids: sourceIds,
    original_months: originalMonths,
    reason: "identical_business_values",
  });
  db.prepare(`
    INSERT INTO operation_logs(
      operator_name, operator_account, operation_type, operation_content,
      target_type, target_id, result_status, extra_json
    ) VALUES ('系统迁移', 'system', '合并重复期初余额', ?, 'student_opening_balances', ?, 'success', ?)
  `).run(
    `${group.student_name} 的 ${sourceIds.length} 条完全一致旧记录已合并为全局唯一记录`,
    String(keptRow.id),
    details,
  );
}

function migrateOpeningBalancesToGlobal(db) {
  const scan = scanOpeningBalanceMigration(db);
  if (!scan.needs_migration) return { migrated: false, deduplicated_students: 0, migrated_rows: 0 };
  if (scan.conflicts.length) throw new OpeningBalanceMigrationConflictError(scan.conflicts);

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("ALTER TABLE student_opening_balances RENAME TO student_opening_balances_legacy_global_v1");
    db.exec(GLOBAL_OPENING_BALANCE_SCHEMA);
    const insert = db.prepare(`
      INSERT INTO student_opening_balances(
        id, student_name, grade, opening_actual_balance, opening_gift_balance,
        notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const duplicateByStudent = new Map(scan.duplicate_groups.map((group) => [group.student_name, group]));
    for (const group of scan.groups) {
      const kept = group.records[0];
      insert.run(
        Number(kept.id),
        text(kept.student_name),
        text(kept.grade),
        amount(kept.opening_actual_balance),
        amount(kept.opening_gift_balance),
        text(kept.notes),
        text(kept.created_at) || null,
        text(kept.updated_at) || null,
      );
      const duplicate = duplicateByStudent.get(group.student_name);
      if (duplicate) recordDeduplication(db, duplicate, kept);
    }
    db.exec("DROP TABLE student_opening_balances_legacy_global_v1");
    db.exec("COMMIT");
    return {
      migrated: true,
      deduplicated_students: scan.duplicate_groups.length,
      migrated_rows: scan.groups.length,
    };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

module.exports = {
  GLOBAL_OPENING_BALANCE_SCHEMA,
  OpeningBalanceMigrationConflictError,
  openingBalanceBusinessValue,
  sameBusinessValue,
  scanOpeningBalanceMigration,
  migrateOpeningBalancesToGlobal,
};
