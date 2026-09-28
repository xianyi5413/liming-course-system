'use strict';

const Formula = require('./salary_formula');
const { normalizeStoredStudentSet, splitStoredStudents } = require('./teacher_salary_rule');
const GRADES = Object.freeze(['初一', '初二', '初三', '高一', '高二', '高三']);
const TYPES = Object.freeze(['1V1', '1V2', '1V3', '小班课']);
const text = value => String(value ?? '').trim();
function validDate(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(text(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function migrateSalaryWorkflow(db) {
  db.exec('SAVEPOINT salary_workflow_migration');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS salary_tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT '',
        effective_start TEXT NOT NULL,
        effective_end TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK(effective_start <= effective_end)
      );
      CREATE INDEX IF NOT EXISTS idx_salary_tables_start_end ON salary_tables(effective_start,effective_end);
      CREATE TABLE IF NOT EXISTS salary_table_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        salary_table_id INTEGER NOT NULL REFERENCES salary_tables(id) ON DELETE CASCADE,
        grade TEXT NOT NULL,
        course_type TEXT NOT NULL,
        formula TEXT NOT NULL,
        UNIQUE(salary_table_id,grade,course_type)
      );
      CREATE INDEX IF NOT EXISTS idx_salary_table_rules_table ON salary_table_rules(salary_table_id);
      CREATE TABLE IF NOT EXISTS teacher_monthly_performance (
        teacher_name TEXT NOT NULL,
        month_key TEXT NOT NULL,
        coefficient REAL NOT NULL CHECK(coefficient >= 0 AND coefficient <= 1),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(teacher_name,month_key)
      );
    `);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lessons'").get()) {
      const columns = new Set(db.prepare('PRAGMA table_info(lessons)').all().map(row => row.name));
      if (!columns.has('teacher_base_salary_override')) db.exec('ALTER TABLE lessons ADD COLUMN teacher_base_salary_override REAL');
      if (!columns.has('teacher_base_salary_source')) db.exec("ALTER TABLE lessons ADD COLUMN teacher_base_salary_source TEXT NOT NULL DEFAULT ''");
      db.exec('CREATE INDEX IF NOT EXISTS idx_lessons_teacher_date_salary ON lessons(teacher_name,date,id)');
    }
    db.exec('RELEASE salary_workflow_migration');
  } catch (error) { db.exec('ROLLBACK TO salary_workflow_migration; RELEASE salary_workflow_migration'); throw error; }
}
function normalizeTable(body) {
  const effective_start = text(body.effective_start), effective_end = text(body.effective_end);
  if (!validDate(effective_start) || !validDate(effective_end) || effective_start > effective_end) throw new Error('请填写有效起止日期，结束日期不得早于开始日期');
  if (!Array.isArray(body.rules) || body.rules.length > 24) throw new Error('薪资规则必须为六个年级的课型列表');
  const seen = new Set();
  const rules = body.rules.map(row => {
    const grade = text(row.grade), course_type = text(row.course_type), formula = text(row.formula);
    if (!GRADES.includes(grade) || !TYPES.includes(course_type)) throw new Error('薪资规则年级或课型无效');
    if (grade.startsWith('初') && course_type === '1V3') throw new Error('初中不支持 1V3');
    const key = `${grade}\0${course_type}`;
    if (seen.has(key)) throw new Error('同一年级课型不能重复');
    seen.add(key);
    return { grade, course_type, formula: formula ? Formula.validate(formula, { allowN: course_type === '小班课' }) : '' };
  }).filter(row => row.formula);
  const name = text(body.name);
  if (name.length > 80) throw new Error('薪资表名称不得超过 80 字符');
  return { name, effective_start, effective_end, rules };
}
function tableContext(tables = [], rules = []) {
  const ordered = [...tables].sort((a, b) => a.effective_start.localeCompare(b.effective_start));
  const byRule = new Map(rules.map(row => [`${row.salary_table_id}\0${row.grade}\0${row.course_type}`, row]));
  return { tables: ordered, byRule };
}
function matchTable(context, date) {
  let low = 0, high = context.tables.length;
  while (low < high) { const middle = (low + high) >> 1; if (context.tables[middle].effective_start <= date) low = middle + 1; else high = middle; }
  const table = context.tables[low - 1];
  return table && table.effective_end >= date ? table : null;
}
function studentCount(lesson) { return splitStoredStudents(normalizeStoredStudentSet(lesson.student_names)).length; }
function classKey(lesson) { return JSON.stringify([text(lesson.teacher_name), text(lesson.grade), text(lesson.subject), text(lesson.course_type), normalizeStoredStudentSet(lesson.student_names)]); }
function tableRule(context, table, lesson, minutes = 120) {
  const rule = context.byRule.get(`${table.id}\0${text(lesson.grade)}\0${text(lesson.course_type)}`);
  if (!rule) return { matched: false, reason: '薪资表未配置对应年级课型', table_id: table.id };
  try {
    const result = Formula.evaluate(rule.formula, Math.max(1, studentCount(lesson)), minutes, { allowN: rule.course_type === '小班课' });
    if (rule.course_type === '小班课' && !studentCount(lesson)) throw new Error('小班课程缺少学生');
    return { ...result, matched: true, table_id: table.id, expression: Formula.format(result), rule_id: rule.id };
  } catch (error) { return { matched: false, reason: error.message, table_id: table.id }; }
}
function resolveBase(lesson, newRule, legacyRule = null) {
  const explicitSource = text(lesson.teacher_base_salary_source);
  const override = lesson.teacher_base_salary_override;
  if (explicitSource === 'manual' && override != null) return { cents: Formula.cents(override), source: 'manual' };
  // A historical manual/imported amount stays protected when a new table is added.
  if (!explicitSource && lesson.teacher_salary != null && ['manual', 'import', 'legacy'].includes(text(lesson.teacher_salary_source))) {
    return { cents: Math.round(Number(lesson.teacher_salary || 0) * 100), source: 'legacy' };
  }
  if (newRule) return newRule.matched ? { cents: newRule.base_cents, source: 'auto' } : { cents: null, source: 'empty' };
  // Outside the new tables, keep the historical persisted-amount semantics.
  // Explicit restoration applies a legacy rule once in the storage layer.
  return { cents: lesson.teacher_salary == null ? null : Math.round(Number(lesson.teacher_salary) * 100), source: text(lesson.teacher_salary_source) || 'legacy' };
}
module.exports = { GRADES, TYPES, validDate, migrateSalaryWorkflow, normalizeTable, tableContext, matchTable, tableRule, studentCount, classKey, resolveBase, Formula };
