'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {test}=require('node:test');
const {seed,instrument}=require('../scripts/excel_backup/benchmark_generation');
const full=require('../src/excel/full_backup');
const codec=require('../src/excel/xlsx_codec');
const root=path.resolve(__dirname,'..');
test('optimized full export preserves every baseline XML byte and full v7 restore data',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'liming-export-parity-'));
  try {
    const dbPath=path.join(dir,'synthetic.sqlite');
    const initialized=spawnSync(process.execPath,[path.join(root,'src/server.js'),'--init-db'],{env:{...process.env,DATA_DIR:dir,DB_PATH:dbPath},encoding:'utf8'});
    assert.equal(initialized.status,0,initialized.stderr);
    const db=new DatabaseSync(dbPath);seed(db,100);
    const options={createdAt:new Date('2026-01-01T00:00:00Z'),appVersion:'synthetic-parity'};
    const optimized=full.buildFullDataBuffer(db,options);
    instrument('src/excel/xlsx_codec.js',[],{},true);
    const baseline=instrument('src/excel/full_backup.js',[],{},true).buildFullDataBuffer(db,options);
    assert.deepEqual(codec.readZip(optimized.buffer),codec.readZip(baseline.buffer),'all XML, styles, values, sheet order and recovery digests');
    assert.deepEqual(optimized.buffer,baseline.buffer,'compression parameters and bytes unchanged');
    const file=path.join(dir,'export.xlsx');fs.writeFileSync(file,optimized.buffer);db.close();
    const before=full.verifyFullData(file);assert.equal(before.version,7);assert.equal(before.workbook.sheets.length,26);
    assert.equal(before.workbook.sheets.filter(sheet=>sheet.state==='veryHidden').length,4);
    const target=path.join(dir,'target.sqlite');fs.copyFileSync(dbPath,target);
    full.restoreFullData({inputPath:file,dbPath:target,mode:'overwrite'});
    const restored=path.join(dir,'restored.xlsx');full.exportFullData({dbPath:target,outputPath:restored,...options});
    const after=full.verifyFullData(restored);
    for(const table of ['lessons','student_pricing','fee_overrides','pricing_standards','recharge_records','student_opening_balances','salary_tables','salary_table_rules','teacher_monthly_performance','staff_salary_monthly','operating_expenses']) assert.deepEqual(after.data[table],before.data[table],table);
  } finally {fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

test('optimized XML reader retains entities, rich text, numerical types and malformed-content rejection',()=>{
  const old=instrument('src/excel/xlsx_codec.js',[],{},true);
  const bytes=codec.createWorkbook([{name:'兼容',rows:[['表头','金额'],['&<😀\r中文',0],['',188.25],['123',-5]]}]);
  assert.deepEqual(codec.parseWorkbook(bytes).sheets,old.parseWorkbook(bytes).sheets);
  for(const malformed of ['<f>1+1</f><v>2</v>','<is><t>\u0001</t></is>']) {
    const entries=codec.readZip(bytes);
    entries.set('xl/worksheets/sheet1.xml',Buffer.from(entries.get('xl/worksheets/sheet1.xml').toString().replace('<is><t xml:space="preserve">表头</t></is>',malformed)));
    assert.throws(()=>codec.validateWorkbookStructure(codec.zipStore([...entries].map(([name,data])=>({name,data})))));
  }
});
