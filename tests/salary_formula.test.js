const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const S = require('../src/domain/salary_workflow');
const F = S.Formula;

test('safe formulas split base and linear K with exact decimal arithmetic and two-hour proration', () => {
  for (const [formula, expected] of [['60+30(n-1)+40K','210+40K'],['60+30(n-1)','210'],['300+40K','300+40K'],['300','300'],['80+25(n-1)+30K','205+30K'],[' 60 + 30 ( N - 1 ) + 40 k ','210+40K'],['0.1+0.2','0.3']]) {
    assert.equal(F.format(F.evaluate(formula,6)),expected);
  }
  assert.deepEqual(F.evaluate('60+30(n-1)+40K',6,60),{base_cents:10500,performance_cents:2000,normalized:'60+30*(n-1)+40*K'});
  assert.equal(F.format(F.evaluate('60+30(n-1)+40K',7)), '240+40K');
  assert.equal(F.evaluate('1/3',1).base_cents,33);
  assert.equal(F.evaluate('1.005',1).base_cents,101);
});
test('formula grammar rejects injection, nonlinear K, invalid brackets, zero division and negative components', () => {
  for (const formula of ['x+3','globalThis.process.exit()','1;alert(1)','K*K','K²','1/K','sin(K)','(K-K)*K','1/(n-n)','(3+2','3+)2(','-1','100-10K','1/(n-1)','1e3','2 3']) {
    assert.throws(()=>F.validate(formula),undefined,formula);
  }
  assert.throws(()=>F.validate('n+20',{allowN:false}),/不能包含 n/);
  assert.throws(()=>F.evaluate('20',1,0),/时长/);
});
test('performance is multiplied once, supports explicit zero, and missing K never implies a default', () => {
  const row=F.evaluate('60+30(n-1)+40K',6);
  for (const [k,total] of [[0.85,274000],[1,280000],[0.5,260000],[0,240000],[null,null]]) {
    assert.equal(F.total(row.base_cents*10,row.performance_cents*10,k,30000),total);
  }
  assert.equal(F.total(100,0,null,30),130);
  assert.equal(F.total(1000000,100000,0.85,30000),1115000);
  assert.throws(()=>F.total(100,20,1.01),/系数/);
});
test('salary migration is additive and idempotent and preserves historical salary sources and amounts', () => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE lessons(id INTEGER PRIMARY KEY,teacher_name TEXT,date TEXT,teacher_salary REAL,teacher_salary_source TEXT); INSERT INTO lessons VALUES(1,'合成老师','2026-07-01',321.45,'manual')");
    S.migrateSalaryWorkflow(db); S.migrateSalaryWorkflow(db);
    assert.deepEqual({...db.prepare('SELECT * FROM lessons').get()},{id:1,teacher_name:'合成老师',date:'2026-07-01',teacher_salary:321.45,teacher_salary_source:'manual',teacher_base_salary_override:null,teacher_base_salary_source:''});
    assert.equal(db.prepare('SELECT count(*) AS n FROM salary_tables').get().n,0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM teacher_monthly_performance').get().n,0);
  } finally { db.close(); }
});
test('table rules use strict grades, forbid junior 1V3, validate calendar dates and normalize class sets', () => {
  assert.throws(()=>S.normalizeTable({effective_start:'2026-02-30',effective_end:'2026-03-01',rules:[]}),/日期/);
  assert.throws(()=>S.normalizeTable({effective_start:'2026-07-01',effective_end:'2026-07-31',rules:[{grade:'初一',course_type:'1V3',formula:'100'}]}),/初中/);
  const lesson={teacher_name:'合成老师',grade:'高一',subject:'数学',course_type:'小班课',student_names:'甲、乙、丙'};
  assert.equal(S.classKey(lesson),S.classKey({...lesson,student_names:'丙,甲,乙,甲'}));
  assert.notEqual(S.classKey(lesson),S.classKey({...lesson,student_names:'甲、乙'}));
  const context=S.tableContext([{id:1,effective_start:'2026-07-01',effective_end:'2026-08-31'},{id:2,effective_start:'2026-09-01',effective_end:'2026-10-31'}],[]);
  assert.equal(S.matchTable(context,'2026-08-31').id,1);
  assert.equal(S.matchTable(context,'2026-09-01').id,2);
  assert.equal(S.matchTable(context,'2026-11-01'),null);
});
test('explicit salary source protects manual and imported amounts without comparing values', () => {
  assert.deepEqual(S.resolveBase({teacher_base_salary_source:'manual',teacher_base_salary_override:230},{matched:true,base_cents:22000}),{cents:23000,source:'manual'});
  assert.deepEqual(S.resolveBase({teacher_base_salary_source:'auto',teacher_salary:230,teacher_salary_source:'manual'},{matched:true,base_cents:22000}),{cents:22000,source:'auto'});
  assert.equal(S.resolveBase({teacher_salary:210,teacher_salary_source:'import'},{matched:true,base_cents:22000}).cents,21000);
  assert.equal(S.resolveBase({teacher_salary:99,teacher_salary_source:'auto'},null).cents,9900);
});
