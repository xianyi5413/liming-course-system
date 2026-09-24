const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync, spawn } = require("node:child_process");
const { test, before, after } = require("node:test");
const { BackupService } = require("../src/backup/backup_service");
const { BackupCleanupService } = require("../src/backup/cleanup_service");
const { freePort } = require("./helpers/chrome_cdp");
const root = path.resolve(__dirname, "..");
let temp;
before(() => { temp = fs.mkdtempSync(path.join(os.tmpdir(), "liming-cleanup-")); });
after(async () => { await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 }); });
async function fixture(name, count = 3) {
  const dataDir = path.join(temp, name); fs.mkdirSync(dataDir);
  const dbPath = path.join(dataDir, "synthetic.sqlite");
  const env = { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath, SESSION_COOKIE_SECURE: "false", BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "" };
  const init = spawnSync(process.execPath, [path.join(root,"src/server.js"), "--init-db"], { env, encoding: "utf8", windowsHide: true }); assert.equal(init.status, 0, init.stderr);
  const service = new BackupService({ dataDir, dbPath }), records = [];
  for (let i=0;i<count;i++) records.push((await service.create({ createdAt: new Date(Date.UTC(2026,8,i+1)), trigger: "manual", retentionClass: "manual" })).record);
  const settings = { daily_retention: 1, monthly_retention: 1, manual_retention: 1, remote_retention: 1, remote_directory: "/apps/synthetic" };
  const remote = { configurationStatus: () => ({ authorized: false }) };
  return { dataDir, dbPath, env, service, records, settings, remote, cleanup: new BackupCleanupService({ service, settings: () => settings, remote }) };
}
function orphan(f, name = "黎明教育_全量数据_孤立.xlsx") {
  const bytes = fs.readFileSync(path.join(f.dataDir, f.records.at(-1).managed_relative_path));
  const filename = path.join(f.service.root, name), checksum = `${crypto.createHash("sha256").update(bytes).digest("hex")}  ${name}\n`;
  fs.writeFileSync(filename, bytes); fs.writeFileSync(filename + ".sha256", checksum);
  return { filename, bytes, checksum, name };
}
test("scan is read-only, retention candidates reuse policy, fixed/busy/latest/unknown/symlink files stay protected", async () => {
  const f = await fixture("policy",5); f.service.updateMetadata(f.records[0].id, { pinned: true });
  const db=f.service.database(); db.prepare("UPDATE backup_records SET job_status='queued' WHERE id=?").run(f.records[1].id); db.close();
  const extra = orphan(f); orphan(f,"historical.xlsx"); orphan(f,"黎明教育_全量数据_不安全.xlsx");
  fs.writeFileSync(path.join(f.dataDir,"outside.xlsx"),"protected"); fs.mkdirSync(path.join(f.service.root,".secrets"),{recursive:true}); fs.writeFileSync(path.join(f.service.root,".secrets","private.xlsx"),"protected");
  const lstat = fs.lstatSync;
  fs.lstatSync = (target,...args) => String(target).includes("不安全") ? { isSymbolicLink: () => true } : lstat(target,...args);
  let preview; try { preview=await f.cleanup.scan(1); } finally { fs.lstatSync=lstat; }
  assert.deepEqual(preview.entries.filter(e=>e.kind==="backup").map(e=>e.backup_id).sort(),[f.records[2].id,f.records[3].id].sort());
  assert.equal(preview.summary.orphan_files,2); assert.equal(preview.summary.local_files,6); assert.equal(preview.summary.backups,2);
  assert.ok(fs.existsSync(extra.filename)); assert.equal(f.service.list().length,5);
  assert.doesNotMatch(JSON.stringify(preview), /absolute_path|dlink|token|secret|cookie|session|synthetic\.sqlite|不安全|historical/);
  let called=0; const original=f.service.deleteBackup.bind(f.service); f.service.deleteBackup=(...args)=>{called++;return original(...args);};
  await assert.rejects(f.cleanup.execute(2,preview.preview_id,true),e=>e.code==="CLEANUP_PREVIEW_REQUIRED");
  const result=await f.cleanup.execute(1,preview.preview_id,true); assert.equal(result.ok,true,JSON.stringify(result)); assert.equal(called,2); assert.equal(result.deleted_files,6);
  assert.ok(!fs.existsSync(extra.filename)); assert.ok(fs.existsSync(path.join(f.dataDir,"outside.xlsx"))); assert.ok(fs.existsSync(path.join(f.service.root,"historical.xlsx")));
  assert.equal(f.service.list().length,3); await assert.rejects(f.cleanup.execute(1,preview.preview_id,true));
});
test("confirmation rechecks new references, pin changes, stale files and the last recovery copy", async () => {
  const f=await fixture("stale"); const extra=orphan(f); const preview=await f.cleanup.scan(1);
  f.service.updateMetadata(f.records[0].id,{pinned:true}); fs.appendFileSync(extra.filename,"changed");
  const result=await f.cleanup.execute(1,preview.preview_id,true); assert.equal(result.ok,false); assert.ok(result.results.some(r=>r.reason==="BACKUP_PINNED")); assert.ok(result.results.some(r=>r.reason==="CLEANUP_STALE_FILE"));
  const lone=await fixture("last",1); orphan(lone);
  let db=lone.service.database(); db.exec("DELETE FROM backup_records"); db.close();
  assert.equal((await lone.cleanup.scan(1)).entries.length,0);
  const referenced=await fixture("referenced",1); const file=orphan(referenced); const plan=await referenced.cleanup.scan(1);
  db=referenced.service.database(); db.prepare("INSERT INTO backup_records(filename,managed_relative_path,backup_format,status,pinned) VALUES (?,?,'full_data_excel','failed',1)").run(file.name,"backups/full-excel/"+file.name); db.close();
  assert.equal((await referenced.cleanup.execute(1,plan.preview_id,true)).results[0].reason,"CLEANUP_NOW_REFERENCED");
});
test("record cleanup protects shared references and files appearing after preview", async () => {
  const f = await fixture("record-races");
  const row = f.records[0], sidecar = path.join(f.dataDir, row.managed_relative_path + ".sha256");
  const bytes = fs.readFileSync(sidecar); fs.unlinkSync(sidecar);
  const preview = await f.cleanup.scan(1); fs.writeFileSync(sidecar, bytes);
  const result = await f.cleanup.execute(1, preview.preview_id, true);
  assert.equal(result.results.find(item => item.backup_id === row.id).reason, "CLEANUP_STALE_FILE");
  assert.ok(fs.existsSync(sidecar));
  const db = f.service.database();
  db.prepare("INSERT INTO backup_records(filename,managed_relative_path,backup_format,status,pinned) VALUES (?,?,'full_data_excel','failed',1)").run(row.filename, row.managed_relative_path); db.close();
  assert.ok(!(await f.cleanup.scan(1)).entries.some(item => item.backup_id === row.id));
});
test("orphan pair partial deletion is explicit and is never reported as complete", async () => {
  const f=await fixture("partial",1), file=orphan(f), preview=await f.cleanup.scan(1), unlink=fs.unlinkSync;
  fs.unlinkSync=target=>{if(String(target)===file.filename+".sha256") throw Object.assign(new Error("synthetic"),{code:"EPERM"}); return unlink(target);};
  let result; try { result=await f.cleanup.execute(1,preview.preview_id,true); } finally { fs.unlinkSync=unlink; }
  assert.equal(result.ok,false); assert.equal(result.deleted_files,1); assert.equal(result.failed_files,1); assert.ok(fs.existsSync(file.filename+".sha256"));
});
test("Baidu orphan cleanup verifies content, preserves huge fs_id and never escapes the configured directory", async () => {
  const f=await fixture("remote",1), file=orphan(f); fs.unlinkSync(file.filename); fs.unlinkSync(file.filename+".sha256");
  const root=f.settings.remote_directory, files=new Map(), calls=[]; let id=9007199254740993000n;
  function add(name,bytes){const remotePath=root+"/"+name, fs_id=String(id++); files.set(remotePath,{path:remotePath,fs_id,isdir:0,size:bytes.length,server_mtime:1770000000,bytes});return fs_id;}
  const safeName=f.records[0].filename;
  const sid=add(safeName,file.bytes), scid=add(safeName+".sha256",Buffer.from(file.checksum.replace(file.name,safeName)));
  const oid=add(file.name,file.bytes); add(file.name+".sha256",Buffer.from(file.checksum));
  files.set("/apps/other/outside.xlsx",{path:"/apps/other/outside.xlsx",fs_id:String(id++),size:1,isdir:0});
  const db=f.service.database(); db.prepare("UPDATE backup_records SET remote_status='success',remote_integrity_status='verified',remote_path=?,remote_checksum_path=?,remote_file_id=?,remote_checksum_file_id=? WHERE id=?").run(root+"/"+safeName,root+"/"+safeName+".sha256",sid,scid,f.records[0].id); db.close();
  const remote={configurationStatus:()=>({authorized:true}),client:{listDirectory:async()=>({list:[...files.values()],has_more:false}),downloadFile:async({fileId,remotePath})=>{assert.equal(files.get(remotePath).fs_id,fileId);return files.get(remotePath).bytes;},deleteFile:async(p,id)=>{assert.ok(p.startsWith(root+"/"));assert.equal(typeof id,"string");calls.push(id);files.delete(p);}}};
  const cleanup=new BackupCleanupService({service:f.service,settings:()=>f.settings,remote});const preview=await cleanup.scan(1);
  assert.equal(preview.summary.remote_files,2);assert.equal(preview.summary.local_files,0);assert.equal(preview.summary.backups,0);
  const result=await cleanup.execute(1,preview.preview_id,true);assert.equal(result.ok,true);assert.equal(result.deleted_files,2);assert.ok(calls.includes(oid));assert.ok(files.has(root+"/"+safeName));assert.ok(files.has("/apps/other/outside.xlsx"));
});
test("cleanup API requires delete privilege, confirmation and an owner-bound preview", async () => {
  const f=await fixture("api",1), file=orphan(f), db=f.service.database();
  const hash=db.prepare("SELECT password_hash FROM users WHERE username='boss'").get().password_hash;
  const id=db.prepare("INSERT INTO users(username,display_name,role,readonly_override,password_hash,status,permission_override_enabled) VALUES ('reader','合成只读','teacher',1,?,'active',1)").run(hash).lastInsertRowid;
  db.prepare("INSERT INTO user_page_permissions(user_id,permission_key,enabled) VALUES (?,'audit',1)").run(id);db.close();
  const port=await freePort(), server=spawn(process.execPath,[path.join(root,"src/server.js")],{env:{...f.env,PORT:String(port)},stdio:"ignore",windowsHide:true});
  const base=`http://127.0.0.1:${port}`;
  try {
    for(let i=0;i<200;i++){try{if((await fetch(base+"/api/version")).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
    const login=async username=>(await fetch(base+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,password:"123456"})})).headers.get("set-cookie").split(";")[0];
    const reader=await login("reader"),boss=await login("boss");
    const post=(route,cookie,body={})=>fetch(base+"/api/data-center/cleanup/"+route,{method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify(body)});
    assert.equal((await post("preview",reader)).status,403);assert.equal((await post("execute",reader,{confirmed:true})).status,403);
    assert.equal((await post("execute",boss,{confirmed:true})).status,409);
    const preview=await (await post("preview",boss)).json();assert.ok(fs.existsSync(file.filename));assert.equal(preview.summary.orphan_files,2);
    assert.equal((await post("execute",boss,{preview_id:preview.preview_id})).status,409);
    const result=await (await post("execute",boss,{preview_id:preview.preview_id,confirmed:true})).json();assert.equal(result.ok,true);assert.ok(!fs.existsSync(file.filename));
    const audit=f.service.database();const logs=audit.prepare("SELECT operation_content,extra_json FROM operation_logs WHERE operation_type='清理多余备份文件'").all();audit.close();assert.equal(logs.length,1);assert.doesNotMatch(JSON.stringify(logs),/dlink|token|secret|cookie|session|synthetic\.sqlite/i);
  } finally { if(server.exitCode==null){const exited=new Promise(r=>server.once("exit",r));server.kill();await exited;} }
});
