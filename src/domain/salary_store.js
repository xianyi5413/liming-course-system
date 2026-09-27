'use strict';

const W = require('./salary_workflow');

// Storage operations stay synchronous and atomic. The HTTP layer owns permissions
// and audit logs; all readers share the same date/formula/base resolution.
function createSalaryStore(db, { minutes, legacyRule, eligible }) {
  let cached = null;
  const rows = (sql, ...params) => db.prepare(sql).all(...params);
  function invalidate() { cached = null; }
  function context() {
    if (!cached) cached = W.tableContext(rows('SELECT * FROM salary_tables ORDER BY effective_start,id'), rows('SELECT * FROM salary_table_rules ORDER BY id'));
    return cached;
  }
  function list() {
    const ctx = context();
    return ctx.tables.map(table => ({ ...table, rules: [...ctx.byRule.values()].filter(rule => rule.salary_table_id === table.id) }));
  }
  function atomic(work) {
    db.exec('SAVEPOINT salary_change');
    try { const result = work(); db.exec('RELEASE salary_change'); invalidate(); return result; }
    catch (error) { db.exec('ROLLBACK TO salary_change; RELEASE salary_change'); throw error; }
  }
  function save(body, id = null) {
    const value = W.normalizeTable(body);
    return atomic(() => {
      if (id != null && !db.prepare('SELECT id FROM salary_tables WHERE id=?').get(id)) throw new Error('薪资表不存在');
      const conflict = db.prepare('SELECT * FROM salary_tables WHERE effective_start <= ? AND effective_end >= ? AND id <> ? LIMIT 1').get(value.effective_end, value.effective_start, id || 0);
      if (conflict) throw new Error(`日期与薪资表 ${conflict.name || conflict.id}（${conflict.effective_start} 至 ${conflict.effective_end}）重叠`);
      // Validate actual class sizes as well as the parser's common-size checks.
      const classes = rows('SELECT DISTINCT grade,course_type,student_names FROM lessons WHERE date BETWEEN ? AND ?', value.effective_start, value.effective_end);
      for (const lesson of classes) {
        const rule = value.rules.find(rule => rule.grade === lesson.grade && rule.course_type === lesson.course_type);
        if (rule) W.Formula.evaluate(rule.formula, Math.max(1, W.studentCount(lesson)), 120, { allowN: rule.course_type === '小班课' });
      }
      if (id == null) id = Number(db.prepare('INSERT INTO salary_tables(name,effective_start,effective_end) VALUES(?,?,?)').run(value.name, value.effective_start, value.effective_end).lastInsertRowid);
      else db.prepare("UPDATE salary_tables SET name=?,effective_start=?,effective_end=?,updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?").run(value.name, value.effective_start, value.effective_end, id);
      db.prepare('DELETE FROM salary_table_rules WHERE salary_table_id=?').run(id);
      const insert = db.prepare('INSERT INTO salary_table_rules(salary_table_id,grade,course_type,formula) VALUES(?,?,?,?)');
      for (const rule of value.rules) insert.run(id, rule.grade, rule.course_type, rule.formula);
      return { id, ...value };
    });
  }
  function impact(id) {
    const table = db.prepare('SELECT * FROM salary_tables WHERE id=?').get(id);
    if (!table) throw new Error('薪资表不存在');
    const affected = db.prepare('SELECT COUNT(*) AS count FROM lessons WHERE date BETWEEN ? AND ?').get(table.effective_start, table.effective_end).count;
    return { ...table, affected };
  }
  function remove(id, confirmation = {}) {
    return atomic(() => {
      const before = impact(id);
      if (before.affected && (confirmation.affected !== before.affected || confirmation.updated_at !== before.updated_at || confirmation.confirm !== true)) throw new Error(`删除将影响 ${before.affected} 节课程，请重新确认；特殊薪资会保留`);
      db.prepare('DELETE FROM salary_table_rules WHERE salary_table_id=?').run(id);
      db.prepare('DELETE FROM salary_tables WHERE id=?').run(id);
      return before;
    });
  }
  function coefficient(teacher, month, value) {
    if (!String(teacher || '').trim() || !W.validDate(month) || !month.endsWith('-01')) throw new Error('教师或月份无效');
    const before = db.prepare('SELECT coefficient FROM teacher_monthly_performance WHERE teacher_name=? AND month_key=?').get(teacher, month)?.coefficient ?? null;
    if (value === null) db.prepare('DELETE FROM teacher_monthly_performance WHERE teacher_name=? AND month_key=?').run(teacher, month);
    else {
      const k = W.Formula.cents(value);
      if (k > 100) throw new Error('绩效系数必须在 0.00～1.00 之间');
      db.prepare("INSERT INTO teacher_monthly_performance(teacher_name,month_key,coefficient) VALUES(?,?,?) ON CONFLICT(teacher_name,month_key) DO UPDATE SET coefficient=excluded.coefficient,updated_at=CURRENT_TIMESTAMP").run(teacher, month, k / 100);
    }
    return { teacher_name: teacher, month_key: month, before, coefficient: value == null ? null : Number(value) };
  }
  function resolve(lesson, oldRules) {
    const ctx = context(), table = W.matchTable(ctx, lesson.date);
    const rule = table ? W.tableRule(ctx, table, lesson, minutes(lesson.time_slot)) : null;
    const legacy = !table && oldRules !== false ? legacyRule(lesson, oldRules) : null;
    const base = W.resolveBase(lesson, rule, legacy);
    return {
      teacher_base_salary: base.cents == null ? null : base.cents / 100,
      teacher_base_salary_source: base.source,
      salary_table_id: table?.id ?? null,
      salary_rule_expression: rule ? (rule.matched ? rule.expression : '无规则') : (legacy?.calculation ? String(legacy.calculation.salary) : '无规则'),
      salary_rule_reason: rule?.reason || legacy?.reason || '',
      salary_rule_missing: Boolean(table && !rule.matched),
      performance_base: rule?.matched ? rule.performance_cents / 100 : 0,
      rule_base_salary: rule?.matched ? rule.base_cents / 100 : legacy?.calculation?.salary ?? null,
      payroll_eligible: eligible(lesson),
    };
  }
  function override(id, body) {
    const before = db.prepare('SELECT * FROM lessons WHERE id=?').get(id);
    if (!before) throw new Error('课程不存在');
    const automatic = body.source === 'auto';
    if (!automatic && body.source !== 'manual') throw new Error('薪资来源必须为自动或特殊');
    const amount = automatic ? null : W.Formula.cents(body.amount) / 100;
    if (amount > 100000) throw new Error('单节基础课薪不得超过 100000 元');
    atomic(() => {
      if (automatic && !W.matchTable(context(), before.date)) {
        const legacy = legacyRule(before);
        if (!legacy?.calculation || !eligible(before)) throw new Error('当前课程没有可应用的历史规则');
        db.prepare("UPDATE lessons SET teacher_salary=?,teacher_salary_source='auto' WHERE id=?").run(legacy.calculation.salary, id);
      }
      db.prepare('UPDATE lessons SET teacher_base_salary_override=?,teacher_base_salary_source=? WHERE id=?').run(amount, automatic ? 'auto' : 'manual', id);
    });
    return { before, id, source: body.source, amount };
  }
  function allocate(lessons, coefficients, oldRules) {
    const running = new Map(), result = new Map();
    for (const lesson of lessons) {
      const resolved = resolve(lesson, oldRules);
      const key = JSON.stringify([lesson.teacher_name, lesson.month_key]);
      const k = coefficients.get(key) ?? null;
      const previous = running.get(key) || 0;
      const performance = eligible(lesson) ? Math.round(resolved.performance_base * 100) : 0;
      running.set(key, previous + performance);
      const pending = eligible(lesson) && (resolved.salary_rule_missing || (performance > 0 && k == null));
      // Difference of cumulative rounded amounts allocates the monthly rounding
      // remainder deterministically; monthly finance and payroll reconcile.
      const allocated = k == null ? 0 : W.Formula.total(0, previous + performance, k) - W.Formula.total(0, previous, k);
      result.set(lesson.id, { ...resolved, teacher_payroll_pending: pending, teacher_payroll_amount: eligible(lesson) ? ((Math.round((resolved.teacher_base_salary || 0) * 100) + allocated) / 100) : 0 });
    }
    return result;
  }
  return { context, list, save, impact, remove, coefficient, resolve, override, allocate, invalidate };
}

module.exports = { createSalaryStore };
