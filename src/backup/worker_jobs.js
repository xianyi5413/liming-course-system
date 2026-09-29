const { fork } = require('node:child_process');
const crypto = require('node:crypto');

// Shared process runner for cleanup and data-center jobs. Only worker messages
// advance progress; polling never manufactures a percentage.
class WorkerJobs {
  constructor({ workerPath, workerFactory, ttl = 15 * 60_000, onExpire = () => {} }) {
    this.workerFactory = workerFactory || (data => {
      const child = fork(workerPath, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
      child.send(data); return child;
    });
    this.ttl = ttl; this.jobs = new Map(); this.onExpire = onExpire;
  }
  public(job) {
    return { job_id: job.id, receipt: job.receipt, kind: job.kind, status: job.status, stage: job.stage, progress: job.progress, message: job.message, started_at: job.started_at, updated_at: job.updated_at, error: job.error, result: job.result };
  }
  prune() {
    for (const [id, job] of this.jobs) if (!['pending', 'running'].includes(job.status) && job.expires < Date.now()) { this.onExpire(job); this.jobs.delete(id); }
  }
  get(owner, id) { this.prune(); const job = this.jobs.get(id); return job && job.owner === owner ? this.public(job) : null; }
  start(owner, key, data, hooks = {}) {
    this.prune();
    for (const job of this.jobs.values()) if (['pending', 'running'].includes(job.status)) {
      if (job.owner === owner && job.key === key) return this.public(job);
      throw Object.assign(new Error('已有后台任务正在运行，请稍后重试'), { code: 'JOB_BUSY' });
    }
    const now = new Date().toISOString();
    const job = { id: crypto.randomBytes(16).toString('hex'), receipt: crypto.randomBytes(24).toString('hex'), owner, key, kind: data.kind, status: 'pending', stage: 'pending', progress: 0, message: '任务已创建', started_at: now, updated_at: now, error: null, result: null, expires: Date.now() + this.ttl };
    this.jobs.set(job.id, job);
    let timer, child, timeoutError;
    const finish = (error, message) => {
      if (!['pending', 'running'].includes(job.status)) return;
      clearTimeout(timer);
      try {
        if (error) throw error;
        job.artifact = message.artifact;
        job.result = message.result;
        hooks.success?.(job, message);
        job.status = 'success'; job.stage = 'complete'; job.progress = 100; job.message = '完成';
      } catch (failure) {
        job.status = 'failed'; job.stage = 'failed'; job.error = { code: failure.code || 'JOB_FAILED', message: failure.message || '后台任务失败' }; job.message = job.error.message;
      } finally {
        job.updated_at = new Date().toISOString(); job.expires = Date.now() + this.ttl;
        hooks.finish?.(job);
      }
    };
    try {
      child = this.workerFactory({ ...data, jobId: job.id });
      child.on('message', message => {
        message = hooks.decode ? hooks.decode(message) : message;
        if (!['pending', 'running'].includes(job.status)) return;
        job.updated_at = new Date().toISOString();
        if (message.error) return finish(message.error);
        if (Object.hasOwn(message, 'result')) return finish(null, message);
        job.status = 'running'; job.stage = message.stage || job.stage;
        if (Number.isFinite(message.progress)) job.progress = Math.max(job.progress, Math.min(99, message.progress));
        job.message = message.message || job.message;
      });
      child.once('error', () => finish({ code: 'JOB_WORKER_FAILED', message: '后台进程启动失败，请重试' }));
      child.once('exit', () => finish(timeoutError || { code: 'JOB_WORKER_EXITED', message: '后台进程异常退出，请重试' }));
      timer = setTimeout(() => {
        timeoutError = { code: 'JOB_TIMEOUT', message: '后台任务超时，请检查结果后重试' };
        // Keep the maintenance lock until the worker has actually stopped.
        if (child.kill) child.kill(); else child.terminate();
      }, this.ttl);
      timer.unref?.();
    } catch { finish({ code: 'JOB_WORKER_FAILED', message: '后台进程启动失败，请重试' }); }
    return this.public(job);
  }
}
module.exports = { WorkerJobs };
