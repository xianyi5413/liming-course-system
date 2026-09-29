const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {test,after}=require('node:test');
const {BackupService}=require('../src/backup/backup_service');
const {BackupCleanupService}=require('../src/backup/cleanup_service');
const {loadBackupSettings,saveBackupSettings}=require('../src/backup/scheduler');
const {localRetentionSelection,localPolicy}=require('../src/backup/retention');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'liming-total-retention-'));
after(async()=>{await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:30,retryDelay:100});});
async function fixture(name,count=3){
  const dataDir=path.join(temp,name);fs.mkdirSync(dataDir);const dbPath=path.join(dataDir,'synthetic.sqlite');
  const env={...process.env,DATA_DIR:dataDir,DB_PATH:dbPath,BAIDU_APP_KEY:'',BAIDU_APP_SECRET:'',BAIDU_REDIRECT_URI:''};
  const init=spawnSync(process.execPath,[path.join(root,'src/server.js'),'--init-db'],{env,encoding:'utf8',windowsHide:true});assert.equal(init.status,0,init.stderr);
  saveBackupSettings(dbPath,{daily_retention:365,monthly_retention:120,manual_retention:200,total_retention:1000});
  const service=new BackupService({dataDir,dbPath});
  const first=(await service.create({createdAt:new Date('2026-01-01T00:00:00Z')})).record;
  const bytes=fs.readFileSync(path.join(dataDir,first.managed_relative_path));
  const db=service.database();db.prepare("UPDATE backup_records SET backup_time='2026-01-01 00:00:00' WHERE id=?").run(first.id);
  for(let i=1;i<count;i++){
    const filename='黎明教育_全量数据_合成'+i+'.xlsx',relative=path.join('backups','full-excel',filename),date=new Date(Date.UTC(2026,0,i+1)).toISOString();
    fs.writeFileSync(path.join(dataDir,relative),bytes);fs.writeFileSync(path.join(dataDir,relative)+'.sha256',first.sha256+'  '+filename+'\n');
    db.prepare("INSERT INTO backup_records(backup_time,filename,managed_relative_path,backup_format,status,verified_at,sha256,file_size,retention_class,trigger) VALUES(?,?,?,'full_data_excel','success',CURRENT_TIMESTAMP,?,?,'manual','manual')").run(date,filename,relative,first.sha256,bytes.length);
  }
  const rows=db.prepare('SELECT * FROM backup_records ORDER BY id').all();db.close();
  return {dataDir,dbPath,env,service,rows};
}
const count=f=>{const db=f.service.database();try{return db.prepare("SELECT COUNT(*) n FROM backup_records WHERE status<>'deleted' AND COALESCE(deleted_at,'')='' AND COALESCE(managed_relative_path,'')<>''").get().n;}finally{db.close();}};
const policy={daily:365,monthly:120,manual:200,total:50};

test('total cap 50: 49 plus new keeps 50; 50 plus new removes the oldest pair and its record',async()=>{
  for(const initial of [49,50]){
    const f=await fixture('boundary'+initial,initial);saveBackupSettings(f.dbPath,{total_retention:50});
    const result=await f.service.create({createdAt:new Date('2026-09-29T00:00:00Z')});assert.equal(result.ok,true);assert.equal(count(f),50);assert.equal(result.retention.removed.length,initial===49?0:1);
    assert.equal(fs.existsSync(path.join(f.dataDir,f.rows[0].managed_relative_path)),initial===49);assert.equal(fs.existsSync(path.join(f.dataDir,f.rows[0].managed_relative_path)+'.sha256'),initial===49);
  }
});
test('55 to 50 removes five oldest deletable rows and respects fixed/running protection',async()=>{
  const f=await fixture('oldest',55),db=f.service.database();db.prepare('UPDATE backup_records SET pinned=1 WHERE id=?').run(f.rows[0].id);db.prepare("UPDATE backup_records SET job_status='queued' WHERE id=?").run(f.rows[1].id);db.close();
  const result=f.service.applyRetention(policy);assert.equal(count(f),50);assert.deepEqual(result.removed.map(row=>row.id),f.rows.slice(2,7).map(row=>row.id));assert.equal(result.warning,'');
});
test('classification runs before the final cap, timestamp ordering handles UTC and Beijing offsets',async()=>{
  const f=await fixture('phases',6),db=f.service.database();
  db.prepare("UPDATE backup_records SET backup_time='2026-09-29T01:00:00+08:00' WHERE id=?").run(f.rows[0].id);
  db.prepare("UPDATE backup_records SET backup_time='2026-09-28T18:00:00Z' WHERE id=?").run(f.rows[1].id);
  db.close();
  const result=f.service.applyRetention({...policy,manual:2,total:1});assert.equal(count(f),1);assert.equal(result.removed.filter(row=>row.reason==='manual_limit').length,4);assert.equal(result.removed.at(-1).reason,'total_limit');
  assert.equal(f.service.list()[0].id,f.rows[1].id);
});
test('protected records may exceed the cap; last verified copy and partial files cannot substitute each other',async()=>{
  const f=await fixture('protected',3),db=f.service.database();db.exec('UPDATE backup_records SET pinned=1');db.close();
  let result=f.service.applyRetention({...policy,total:1});assert.equal(count(f),3);assert.match(result.warning,/受保护备份/);
  const database=f.service.database();database.exec("UPDATE backup_records SET pinned=0; UPDATE backup_records SET status='delete_partial' WHERE id>1");
  assert.equal(f.service.localDeletionPolicy(database,database.prepare('SELECT * FROM backup_records WHERE id=1').get()).code,'BACKUP_LAST_VALID');database.close();
  result=f.service.applyRetention({...policy,total:1});assert.equal(count(f),1);assert.equal(f.service.list()[0].id,1);
});
test('new successful backup records expose a warning if pins prevent the configured cap',async()=>{
  const f=await fixture('warning',3),db=f.service.database();db.exec('UPDATE backup_records SET pinned=1');db.close();saveBackupSettings(f.dbPath,{total_retention:1});
  const result=await f.service.create({createdAt:new Date('2026-09-29T00:00:00Z')});assert.equal(result.ok,true);assert.equal(count(f),4);assert.match(result.record.retention_warning,/暂时超过设置上限/);assert.match(f.service.list().find(row=>row.id===result.record.id).retention_warning,/受保护/);
});
test('shared references, unverified/unknown records and unsafe paths stay protected',async()=>{
  const f=await fixture('references',4),db=f.service.database();
  db.prepare('UPDATE backup_records SET managed_relative_path=? WHERE id=?').run(f.rows[0].managed_relative_path,f.rows[1].id);
  db.prepare("UPDATE backup_records SET verified_at='' WHERE id=?").run(f.rows[2].id);
  db.prepare("UPDATE backup_records SET retention_class='unknown_history' WHERE id=?").run(f.rows[3].id);
  assert.equal(f.service.localDeletionPolicy(db,db.prepare('SELECT * FROM backup_records WHERE id=1').get()).code,'CLEANUP_SHARED_REFERENCE');db.close();
  const result=f.service.applyRetention({...policy,total:1});assert.equal(count(f),4);assert.equal(result.removed.length,0);assert.match(result.warning,/受保护/);
});
test('physical deletion failure is recorded and planner continues with another deletable backup',async()=>{
  const f=await fixture('failure',4),target=path.join(f.dataDir,f.rows[0].managed_relative_path),original=fs.rmSync;
  fs.rmSync=(file,...args)=>{if(String(file)===target)throw Object.assign(new Error('synthetic'),{code:'EPERM'});return original(file,...args);};
  let result;try{result=f.service.applyRetention({...policy,total:2});}finally{fs.rmSync=original;}
  assert.equal(count(f),2);assert.equal(result.skipped[0].reason,'BACKUP_LOCAL_DELETE_PARTIAL');assert.equal(result.removed.length,2);assert.ok(result.warning);assert.ok(fs.existsSync(target));assert.equal(f.service.list().find(row=>row.id===f.rows[0].id).status,'delete_partial');
});
test('every successful local creator calls unified retention, including automatic monthly and pre-restore',async()=>{
  for(const trigger of ['manual','automatic','remote_manual','pre_restore']){
    const f=await fixture('creator-'+trigger,3);saveBackupSettings(f.dbPath,{total_retention:3});
    const result=await f.service.create({trigger,retentionClass:trigger==='automatic'?'daily':trigger==='pre_restore'?'pre_restore':trigger==='remote_manual'?'remote':'manual',createdAt:new Date('2026-09-29T00:00:00Z'),...(trigger==='automatic'?{scheduleKey:'full-data:2026-09-29',scheduledDate:'2026-09-29'}:{})});
    assert.equal(result.retention.removed.length,1,trigger);assert.equal(count(f),3);assert.ok(fs.existsSync(path.join(f.dataDir,result.record.managed_relative_path)));if(trigger==='automatic')assert.equal(result.record.retention_class,'monthly');
  }
});
test('migration default protects existing counts; saving a smaller limit performs no cleanup',async()=>{
  const f=await fixture('migration',60),db=f.service.database();db.exec("UPDATE settings SET value='1' WHERE key IN ('full_backup_daily_retention','full_backup_monthly_retention','full_backup_manual_retention'); DELETE FROM settings WHERE key='full_backup_total_retention'");db.close();
  assert.equal(loadBackupSettings(f.dbPath).total_retention,60);assert.equal(count(f),60);
  saveBackupSettings(f.dbPath,{total_retention:5});assert.equal(loadBackupSettings(f.dbPath).total_retention,5);assert.equal(count(f),60);
  const g=await fixture('migration-sum',2),other=g.service.database();other.exec("DELETE FROM settings WHERE key='full_backup_total_retention'");other.close();assert.equal(loadBackupSettings(g.dbPath).total_retention,685);
  const invalid=g.service.database();invalid.exec("DELETE FROM settings WHERE key='full_backup_total_retention'; UPDATE settings SET value='Infinity' WHERE key='full_backup_daily_retention'");invalid.close();assert.equal(loadBackupSettings(g.dbPath).total_retention,334);
});
test('manual cleanup reuses local planner/executor without touching Baidu or losing remote indexes',async()=>{
  const f=await fixture('manual',3),db=f.service.database();db.exec("UPDATE backup_records SET remote_path='/apps/synthetic/file-'||id||'.xlsx',remote_checksum_path='/apps/synthetic/file-'||id||'.xlsx.sha256',remote_status='success'");db.close();saveBackupSettings(f.dbPath,{total_retention:1});
  let calls=0,deletedLocal=0;const remote={configurationStatus:()=>({authorized:false}),delete:()=>{calls++;throw new Error('must not call');}};
  const cleanup=new BackupCleanupService({service:f.service,settings:()=>loadBackupSettings(f.dbPath),remote});const preview=await cleanup.scan(1);assert.equal(preview.entries.length,2);assert.ok(preview.entries.every(row=>row.kind==='backup_local'));assert.equal(preview.summary.remote_files,0);
  const original=f.service.deleteLocalBackup.bind(f.service);f.service.deleteLocalBackup=(...args)=>{deletedLocal++;return original(...args);};
  const result=await cleanup.execute(1,preview.preview_id,true);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(deletedLocal,2);assert.equal(calls,0);assert.equal(count(f),1);assert.equal(f.service.list().length,3);assert.ok(f.service.list().every(row=>row.remote_status==='success'));assert.equal(f.service.list().filter(row=>row.status==='deleted').length,2);
});
test('template Excel v7 settings roundtrip includes the optional total retention setting',async()=>{
  const f=await fixture('excel',1),{exportFullData,verifyFullData}=require('../src/excel/full_backup');saveBackupSettings(f.dbPath,{total_retention:77});
  const output=path.join(f.dataDir,'synthetic-export.xlsx');exportFullData({dbPath:f.dbPath,outputPath:output});const result=verifyFullData(output);assert.equal(result.version,7);assert.equal(result.data.settings.find(row=>row.key==='full_backup_total_retention').value,'77');
});
