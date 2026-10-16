'use strict';
// End-to-end synthetic export job responsiveness. No production paths accepted.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {seed}=require('./benchmark_generation');
const {freePort}=require('../../tests/helpers/chrome_cdp');
async function run(count) {
  const root=path.resolve(__dirname,'../..'), dir=fs.mkdtempSync(path.join(os.tmpdir(),'liming-export-job-benchmark-'));
  let server;
  try {
    const dbPath=path.join(dir,'synthetic.sqlite'),env={...process.env,DATA_DIR:dir,DB_PATH:dbPath,SESSION_COOKIE_SECURE:'false',BAIDU_APP_KEY:'',BAIDU_APP_SECRET:'',BAIDU_REDIRECT_URI:''};
    const init=spawnSync(process.execPath,[path.join(root,'src/server.js'),'--init-db'],{env,encoding:'utf8'});
    if(init.status!==0)throw new Error(init.stderr);
    const db=new DatabaseSync(dbPath);seed(db,count);db.close();
    const port=await freePort(),base=`http://127.0.0.1:${port}`;
    server=spawn(process.execPath,[path.join(root,'src/server.js')],{env:{...env,PORT:String(port)},stdio:'ignore',windowsHide:true});
    for(let i=0;i<100;i++){try{if((await fetch(base+'/api/version')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'boss',password:'123456'})});
    if(!login.ok)throw new Error('Synthetic login failed');
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const start=performance.now();
    const created=await fetch(base+'/api/data-center/jobs/export',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'});
    if(created.status!==202)throw new Error('Export job was not accepted');
    let job=await created.json();const accepted_ms=performance.now()-start, latencies=[],stages=new Set();
    while(['pending','running'].includes(job.status)) {
      if(performance.now()-start>180000)throw new Error('Synthetic export timed out');
      const began=performance.now();const online=await fetch(base+'/api/teachers',{headers:{cookie}});await online.arrayBuffer();
      if(!online.ok)throw new Error('Online query failed');latencies.push(performance.now()-began);
      await new Promise(r=>setTimeout(r,200));
      job=await (await fetch(base+`/api/data-center/jobs/${job.job_id}`,{headers:{cookie,'X-Task-Receipt':job.receipt}})).json();stages.add(job.stage);
    }
    if(job.status!=='success')throw new Error(JSON.stringify(job.error));
    const downloaded=await fetch(base+`/api/data-center/jobs/${job.job_id}/download`,{headers:{cookie}});
    if(!downloaded.ok)throw new Error('Download failed');
    const bytes=(await downloaded.arrayBuffer()).byteLength;
    latencies.sort((a,b)=>a-b);
    return {count,accepted_ms,total_ms:performance.now()-start,online_requests:latencies.length,online_median_ms:latencies[Math.floor(latencies.length/2)],online_max_ms:latencies.at(-1),bytes,stages:[...stages],progress:job.progress};
  }finally{
    if(server?.exitCode===null){const exited=new Promise(r=>server.once('exit',r));server.kill();await exited;}
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
}
if(require.main===module)run(Number(process.argv[2]||1000)).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
