const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { WorkerJobs } = require('../src/backup/worker_jobs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('shared job runner only advances on worker messages and isolates owners, deduplicates and releases failures', async () => {
  let child;
  const jobs = new WorkerJobs({ workerFactory: () => (child = new EventEmitter()) });
  const first = jobs.start(1, 'export', { kind: 'export' });
  assert.equal(first.progress, 0); assert.equal(first.status, 'pending');
  assert.equal(jobs.start(1, 'export', { kind: 'export' }).job_id, first.job_id);
  assert.throws(() => jobs.start(2, 'export', {}), /已有后台任务/); assert.equal(jobs.get(2, first.job_id), null);
  await delay(20); assert.equal(jobs.get(1, first.job_id).progress, 0);
  child.emit('message', { stage: 'read', progress: 25, message: '正在读取数据库' });
  child.emit('message', { stage: 'parse', progress: 20, message: '正在解析数据' });
  assert.equal(jobs.get(1, first.job_id).progress, 25);
  child.emit('message', { error: { code: 'TEST_FAILURE', message: '测试文件损坏' } });
  assert.equal(jobs.get(1, first.job_id).status, 'failed'); assert.equal(jobs.get(1, first.job_id).error.message, '测试文件损坏');
  const next = jobs.start(1, 'export', { kind: 'export' });
  child.emit('message', { result: { filename: 'synthetic.xlsx' }, artifact: 'private-artifact' });
  const complete = jobs.get(1, next.job_id); assert.equal(complete.progress, 100); assert.equal(complete.status, 'success');
  assert.equal(Object.hasOwn(complete, 'artifact'), false);
});

test('timeout keeps the completion hook and maintenance lock pending until worker exit', async () => {
  let killed = false, finished = false;
  const child = new EventEmitter();
  child.kill = () => { killed = true; setTimeout(() => child.emit('exit', 1), 50); };
  const jobs = new WorkerJobs({ ttl: 20, workerFactory: () => child });
  const task = jobs.start(1, 'restore', { kind: 'restore' }, { finish: () => { finished = true; } });
  await delay(35); assert.equal(killed, true); assert.equal(finished, false);
  await delay(60); assert.equal(finished, true);
  const failed = jobs.jobs.get(task.job_id); assert.equal(failed.status, 'failed'); assert.equal(failed.error.code, 'JOB_TIMEOUT');
});
