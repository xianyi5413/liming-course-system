const path = require('node:path');
const { WorkerJobs } = require('./worker_jobs');

// Keep the cleanup preview contract while sharing worker lifecycle and polling.
class CleanupPreviewJobs {
  constructor({ cleanup, workerFactory }) {
    this.cleanup = cleanup;
    this.runner = new WorkerJobs({ workerPath: path.join(__dirname, 'cleanup_worker.js'), workerFactory });
    this.jobs = this.runner.jobs;
  }
  public(job) {
    return job && { job_id: job.job_id, status: job.status === 'success' ? 'completed' : job.status === 'pending' ? 'running' : job.status, progress: job.message, preview: job.result?.preview || null, code: job.error?.code || '' };
  }
  get(owner, id) { return this.public(this.runner.get(owner, id)); }
  start(owner) {
    return this.public(this.runner.start(owner, 'cleanup', { kind: 'cleanup', owner, dbPath: this.cleanup.service.dbPath, dataDir: this.cleanup.service.dataDir }, {
      decode: message => message.preview ? { result: message } : { stage: 'scan', message: message.progress },
      success: (job, message) => {
        const { preview, plan } = message.result;
        for (const [token, previous] of this.cleanup.plans) if (previous.owner === owner || previous.expires < Date.now()) this.cleanup.plans.delete(token);
        this.cleanup.plans.set(preview.preview_id, plan);
      },
    }));
  }
}
module.exports = { CleanupPreviewJobs };
