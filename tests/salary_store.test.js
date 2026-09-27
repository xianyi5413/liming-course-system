'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const W = require('../src/domain/salary_workflow');
const { createSalaryStore } = require('../src/domain/salary_store');

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE lessons(id INTEGER PRIMARY KEY,teacher_name TEXT,date TEXT,month_key TEXT,grade TEXT,subject TEXT,course_type TEXT,student_names TEXT,time_slot TEXT,status TEXT,teacher_salary REAL,teacher_salary_source TEXT);
    INSERT INTO lessons VALUES(1,'合成教师','2026-09-12','2026-09-01','高一','数学','小班课','甲、乙、丙、丁、戊、己','120','已上',99,'auto');`);
  W.migrateSalaryWorkflow(db);
  return { db, store: createSalaryStore(db, { minutes: Number, legacyRule: () => ({ calculation: { salary: 99 } }), eligible: row => row.status === '已上' }) };
}
const autumn = (formula = '60+30(n-1)+40K') => ({ effective_start: '2026-09-01', effective_end: '2027-01-31', rules: [{ grade: '高一', course_type: '小班课', formula }] });

test('salary tables reject inclusive overlap, allow adjacent periods, and invalidate parsed context after edits', t => {
  const { store } = fixture(t);
  const first = store.save(autumn());
  assert.equal(store.list().length, 1);
  assert.throws(() => store.save({ ...autumn(), effective_start: '2027-01-31', effective_end: '2027-02-28' }), /重叠/);
  store.save({ ...autumn(), effective_start: '2027-02-01', effective_end: '2027-02-28' });
  store.save(autumn('220+40K'), first.id);
  assert.equal(store.list()[0].rules[0].formula, '220+40*K');
  assert.equal(W.matchTable(store.context(), '2027-01-31').id, first.id);
  assert.notEqual(W.matchTable(store.context(), '2027-02-01').id, first.id);
  assert.equal(W.matchTable(store.context(), '2026-08-31'), null);
});

test('automatic base follows rule, manual base survives edits and deletion, reset restores latest rule', t => {
  const { db, store } = fixture(t), table = store.save(autumn());
  const lesson = () => db.prepare('SELECT * FROM lessons WHERE id=1').get();
  assert.equal(store.resolve(lesson()).teacher_base_salary, 210);
  assert.equal(store.resolve({ ...lesson(), time_slot: '60' }).teacher_base_salary, 105);
  assert.equal(store.resolve({ ...lesson(), time_slot: '60' }).performance_base, 20);
  store.override(1, { source: 'manual', amount: '230.00' });
  store.save(autumn('220+40K'), table.id);
  assert.equal(store.resolve(lesson()).teacher_base_salary, 230);
  assert.equal(store.resolve(lesson()).rule_base_salary, 220);
  store.override(1, { source: 'auto' });
  assert.equal(store.resolve(lesson()).teacher_base_salary, 220);
  store.override(1, { source: 'manual', amount: 230 });
  assert.throws(() => store.remove(table.id), /影响 1 节/);
  const impact = store.impact(table.id);
  assert.throws(() => store.remove(table.id, { ...impact, affected: 2, confirm: true }), /重新确认/);
  store.remove(table.id, { ...impact, confirm: true });
  assert.equal(store.resolve(lesson()).teacher_base_salary, 230);
  assert.equal(lesson().teacher_salary, 99, 'historical field was never rewritten');
  store.override(1, { source: 'auto' });
  assert.equal(store.resolve(lesson()).teacher_base_salary, 99);
});

test('missing rule is explicit and does not fall back within a new salary table', t => {
  const { db, store } = fixture(t);
  store.save({ ...autumn(), rules: [] });
  const resolved = store.resolve(db.prepare('SELECT * FROM lessons').get());
  assert.equal(resolved.teacher_base_salary, null);
  assert.equal(resolved.salary_rule_missing, true);
  assert.equal(resolved.salary_rule_expression, '无规则');
});

test('monthly coefficient accepts explicit zero and null reset but rejects malformed or overprecision amounts', t => {
  const { db, store } = fixture(t);
  for (const coefficient of [0, 0.5, 0.85, 1]) assert.equal(store.coefficient('合成教师', '2026-09-01', coefficient).coefficient, coefficient);
  for (const coefficient of [-1, 1.01, 0.001, '', 'bad', undefined]) assert.throws(() => store.coefficient('合成教师', '2026-09-01', coefficient));
  assert.throws(() => store.coefficient('合成教师', '2026-09-02', 1), /月份/);
  assert.equal(store.coefficient('合成教师', '2026-09-01', null).before, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teacher_monthly_performance').get().n, 0);
});

test('small class actual headcounts and normalized student sets preserve class identity', t => {
  const { db, store } = fixture(t);
  store.save(autumn());
  const lesson = db.prepare('SELECT * FROM lessons').get();
  for (const n of [1, 2, 3, 6, 7]) {
    const row = { ...lesson, student_names: Array.from({ length: n }, (_, i) => `合成学生${i}`).join('、') };
    assert.equal(store.resolve(row).teacher_base_salary, 60 + 30 * (n - 1));
    assert.equal(store.resolve(row).performance_base, 40);
    assert.equal(W.classKey(row), W.classKey({ ...row, student_names: row.student_names.split('、').reverse().join(',') }));
  }
});
