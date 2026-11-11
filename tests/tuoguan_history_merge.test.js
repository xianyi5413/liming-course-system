const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {migrate} = require('../src/domain/tuoguan_schema');
const {mergeHistory, fingerprint} = require('../scripts/merge_tuoguan_history');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-merge-'));
  t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
  const sourcePath = path.join(dir,'source.sqlite'), targetPath = path.join(dir,'target.sqlite');
  for (const file of [sourcePath,targetPath]) {
    const db=new DatabaseSync(file);
    db.exec("CREATE TABLE students(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO students VALUES(1,'Synthetic tutoring'); CREATE TABLE teachers(id INTEGER PRIMARY KEY); CREATE TABLE users(id INTEGER PRIMARY KEY,secret TEXT); INSERT INTO users VALUES(1,'unchanged');");
    migrate(db); db.close();
  }
  const db=new DatabaseSync(sourcePath);
  db.exec(`INSERT INTO tg_students(id,name) VALUES(1,'Synthetic history');
    INSERT INTO tg_periods(student_id,grade,class_name,start_date,end_date) VALUES(1,'初一','A','2026-09-01','2026-09-30');
    INSERT INTO tg_imports(id,payload,result) VALUES('hash','{}','{}');
    INSERT INTO tg_import_sources(id,import_id,source_key,student_id,status) VALUES('hash:1','hash','1',1,'已导入');
    INSERT INTO tg_calendar(date,enabled) VALUES('2026-09-01',1);
    INSERT INTO tg_attendance(student_id,date,status,grade,class_name,rule_json,fee,pending,reference_fee,source_import_id,source_key,raw_status) VALUES(1,'2026-09-01','未登记','初一','A','{}',0,1,0,'hash','1','26');`);
  db.close();
  return {sourcePath,targetPath,backupDir:path.join(dir,'backups')};
}
function inspect(file, fn=fingerprint) { const db=new DatabaseSync(file,{readOnly:true}); try{return fn(db);}finally{db.close();} }
test('readonly preview, atomic custody copy, full backups and idempotent replay preserve tutoring/accounts',async t=>{
  const options=fixture(t), before=inspect(options.targetPath), source=inspect(options.sourcePath);
  assert.equal((await mergeHistory(options)).applied,false);
  assert.deepEqual(inspect(options.targetPath),before);
  const result=await mergeHistory({...options,apply:true});
  assert.equal(result.counts.tg_students,1); assert.equal(result.counts.tg_ledger,0);
  assert.deepEqual(inspect(result.targetBackup),before); assert.deepEqual(inspect(result.sourceBackup),source);
  assert.deepEqual(inspect(options.sourcePath),source);
  const after=inspect(options.targetPath);
  assert.deepEqual(after.users,before.users); assert.deepEqual(after.students,before.students);
  assert.equal(inspect(options.targetPath,db=>db.prepare('SELECT pending FROM tg_attendance').get().pending),1);
  assert.equal((await mergeHistory({...options,apply:true})).action,'already_present');
  assert.deepEqual(inspect(options.targetPath),after);
});
test('existing custody identity collision is explicit and never overwritten',async t=>{
  const options=fixture(t),db=new DatabaseSync(options.targetPath);
  db.exec("INSERT INTO tg_students(id,name) VALUES(1,'Another student')");db.close();
  const before=inspect(options.targetPath);
  await assert.rejects(mergeHistory({...options,apply:true}),/TARGET_CUSTODY_CONFLICT/);
  assert.deepEqual(inspect(options.targetPath),before);
});
test('a write failure rolls back every copied row and protected business changes',async t=>{
  const options=fixture(t),db=new DatabaseSync(options.targetPath);
  db.exec("CREATE TRIGGER interfere AFTER INSERT ON tg_students BEGIN UPDATE users SET secret='changed'; END");db.close();
  const before=inspect(options.targetPath);
  await assert.rejects(mergeHistory({...options,apply:true}),/PROTECTED_TABLE_CHANGED/);
  assert.deepEqual(inspect(options.targetPath),before);
});
test('posted histories and differing schemas are rejected before mutation',async t=>{
  const options=fixture(t),db=new DatabaseSync(options.sourcePath);
  db.exec('UPDATE tg_attendance SET fee=50');db.close();
  await assert.rejects(mergeHistory(options),/SOURCE_NOT_PENDING_HISTORY/);
  const target=new DatabaseSync(options.targetPath);target.exec('ALTER TABLE tg_students ADD COLUMN extra TEXT');target.close();
  await assert.rejects(mergeHistory(options),/SCHEMA_MISMATCH/);
});
