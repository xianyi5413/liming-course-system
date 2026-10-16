'use strict';
// Synthetic-only benchmark. Instrument copies in memory, never production data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '../..');
const BASELINE = '9d2d86c51f1a38cf0e6a98816713ac7083463dbe';
function instrument(relative, names, metrics, baseline = false) {
  const filename = path.join(root, relative);
  let source = baseline ? spawnSync('git',['show',`${BASELINE}:${relative}`],{cwd:root,encoding:'utf8',maxBuffer:4e6}).stdout : fs.readFileSync(filename, 'utf8');
  if (!source) throw new Error('Missing benchmark reference source');
  for (const name of names) {
    source = source.replace(`function ${name}(`, `function __raw_${name}(`);
    source += `\nfunction ${name}(...args) { const start=performance.now(); try { return __raw_${name}(...args); } finally { const key=${JSON.stringify(name)}+(${JSON.stringify(['visibleRecords','buildVisibleSheet'].includes(name))} ? ':'+args[0].sheet_name : ''); __metrics[key]=(__metrics[key]||0)+performance.now()-start; } }`;
  }
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.__metrics = metrics;
  mod._compile('const __metrics=module.__metrics;\n' + source, filename);
  require.cache[filename] = mod;
  return mod.exports;
}
function seed(db, count) {
  db.exec('BEGIN');
  for (let t=0;t<12;t++) {
    db.prepare('INSERT INTO teachers(name) VALUES (?)').run(`合成教师${t}`);
    const id=db.prepare('SELECT id FROM teachers WHERE name=?').get(`合成教师${t}`).id;
    const table=db.prepare("INSERT INTO salary_tables(name,teacher_id,effective_start,effective_end) VALUES ('合成年度规则',?,'2026-01-01','2026-12-31')").run(id).lastInsertRowid;
    for(const grade of ['初一','初二','初三','高一','高二','高三']) for(const type of ['1V1','1V2','小班课']) db.prepare('INSERT INTO salary_table_rules(salary_table_id,grade,course_type,formula) VALUES (?,?,?,?)').run(table,grade,type,type==='小班课'?'60+30*(n-1)+40*K':'180+40*K');
    db.prepare("INSERT INTO teacher_monthly_performance(teacher_name,month_key,coefficient) VALUES (?,'2026-01-01',0.85)").run(`合成教师${t}`);
  }
  for(let s=0;s<240;s++) {
    const name=`合成学生${s}`, grade=['初一','初二','初三','高一','高二','高三'][s%6];
    db.prepare('INSERT INTO students(name,grade) VALUES (?,?)').run(name,grade);
    db.prepare("INSERT INTO recharge_records(student_name,grade,cur_recharge,cur_gift,recharge_date,month_key) VALUES (?,?,?,100,'2026-01-01','2026-01-01')").run(name,grade,s%7===0?-100:2000);
    db.prepare('INSERT INTO student_opening_balances(student_name,grade,opening_actual_balance) VALUES (?,?,100)').run(name,grade);
  }
  const insert=db.prepare("INSERT INTO lessons(teacher_name,date,time_slot,grade,subject,student_names,status,course_status,course_type,course_type_source,month_key,notes) VALUES (?,?, '09:00-11:00',?,?,?,?,?,?, 'manual',?,?)");
  for(let i=0;i<count;i++) {
    const grade=['初一','初二','初三','高一','高二','高三'][i%6], subject=['数学','物理','英语'][i%3];
    const names=Array.from({length:i%4+1},(_,j)=>`合成学生${(i+j)%240}`).join('、');
    const date=new Date(Date.UTC(2026,0,1+i%360)).toISOString().slice(0,10), status=['已上','已上','待上','请假'][i%4];
    const id=insert.run(`合成教师${i%12}`,date,grade,subject,names,status,status==='已上'?'已上':'未上',i%4===0?'1V1':i%4===1?'1V2':'小班课',date.slice(0,7)+'-01','合成课程备注').lastInsertRowid;
    if(i%5===0) db.prepare('INSERT INTO fee_overrides(lesson_id,student_name,unit_price) VALUES (?,?,?)').run(id,`合成学生${i%240}`,i%10===0?0:188.25);
    if(i<240) for(const student of names.split('、')) db.prepare('INSERT OR IGNORE INTO student_pricing(student_name,grade,subject,student_names,custom_price) VALUES (?,?,?,?,180)').run(student,grade,subject,names);
  }
  const staff=db.prepare("INSERT INTO staff(name,role,base_salary) VALUES ('合成员工','教务',5000)").run().lastInsertRowid;
  db.prepare("INSERT INTO staff_salary_monthly(staff_id,month_key,salary_actual) VALUES (?,'2026-01-01',5000)").run(staff);
  db.prepare("INSERT INTO staff_attendance(staff_id,attendance_date,month_key,status,pay_units) VALUES (?,'2026-01-01','2026-01-01','上班',1)").run(staff);
  db.exec("INSERT INTO operating_expenses(category,expense_date,amount,month_key) VALUES ('办公','2026-01-01',88.25,'2026-01-01'); COMMIT");
}
function run(count, baseline = false) {
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'liming-generation-'));
  try {
    const dbPath=path.join(temporary,'synthetic.sqlite');
    const init=spawnSync(process.execPath,[path.join(root,'src/server.js'),'--init-db'],{env:{...process.env,DB_PATH:dbPath,DATA_DIR:temporary},encoding:'utf8'});
    if(init.status!==0) throw new Error(init.stderr);
    const db=new DatabaseSync(dbPath);seed(db,count);
    // Deterministic synthetic timestamps/hash allow byte-for-byte before/after comparison.
    for(const {name} of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      const columns=db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all().map(row=>row.name);
      for(const column of ['created_at','updated_at']) if(columns.includes(column)) db.exec(`UPDATE ${JSON.stringify(name)} SET ${column}='2026-01-01 00:00:00'`);
    }
    const salt='0123456789abcdeffedcba9876543210';
    db.prepare('UPDATE users SET password_hash=?').run(`pbkdf2$${salt}$${crypto.pbkdf2Sync('synthetic-only-password',salt,120000,32,'sha256').toString('hex')}`);
    db.close();
    const metrics={};
    const codec=instrument('src/excel/xlsx_codec.js',['worksheetXml','zipStore','validateWorkbookStructure'],metrics,baseline);
    const full=instrument('src/excel/full_backup.js',['sourceDataFromDb','visibleRecords','buildVisibleSheet','studentRuleSource'],metrics,baseline);
    let sqlCount=0, writeMs=0;
    const originalPrepare=DatabaseSync.prototype.prepare, originalWrite=fs.writeFileSync;
    DatabaseSync.prototype.prepare=function(...args){sqlCount++;return originalPrepare.apply(this,args);};
    fs.writeFileSync=function(...args){const start=performance.now();try{return originalWrite.apply(this,args);}finally{writeMs+=performance.now()-start;}};
    const start=performance.now();
    const result=full.exportFullData({dbPath,outputPath:path.join(temporary,'output.xlsx'),createdAt:new Date('2026-01-01T00:00:00Z'),appVersion:'synthetic-benchmark'});
    const total_ms=performance.now()-start;
    const peak_rss_kib=process.resourceUsage().maxRSS;
    const generationMetrics={...metrics};
    DatabaseSync.prototype.prepare=originalPrepare;fs.writeFileSync=originalWrite;
    const entries=Object.fromEntries([...codec.readZip(result.buffer)].map(([name,bytes])=>[name,crypto.createHash('sha256').update(bytes).digest('hex')]));
    const verified=full.verifyFullData(path.join(temporary,'output.xlsx'));
    return {count,baseline,total_ms,phases_ms:generationMetrics,write_ms:writeMs,sql_prepares:sqlCount,bytes:result.buffer.length,peak_rss_kib,sheets:result.sheets.length,verified:verified.version,entries};
  } finally {fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
if(require.main===module) process.stdout.write(JSON.stringify(run(Number(process.argv[2]||1000),process.argv.includes('--baseline')))+'\n');
module.exports={seed,run,instrument,BASELINE};
