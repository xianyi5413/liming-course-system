const { fork } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");

// One scan at a time. Heavy filesystem, SQLite and checksum work stays off HTTP's event loop.
class CleanupPreviewJobs {
  constructor({ cleanup, workerFactory = data => { const child = fork(path.join(__dirname, "cleanup_worker.js"), [], { stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true }); child.send(data); return child; } }) {
    this.cleanup = cleanup;
    this.workerFactory = workerFactory;
    this.jobs = new Map();
  }
  public(job) {
    return { job_id: job.id, status: job.status, progress: job.progress, preview: job.preview || null, code: job.code || "" };
  }
  get(owner, id) {
    const job = this.jobs.get(id);
    return job && job.owner === owner && job.expires > Date.now() ? this.public(job) : null;
  }
  start(owner) {
    for (const [id, job] of this.jobs) {
      if (job.status === "running") {
        if (job.owner === owner) return this.public(job);
        throw Object.assign(new Error("已有清理扫描正在运行"), { code: "CLEANUP_BUSY" });
      }
      if (job.expires < Date.now()) this.jobs.delete(id);
    }
    const job = { id: crypto.randomBytes(16).toString("hex"), owner, status: "running", progress: "正在扫描本地文件", expires: Date.now() + 15 * 60_000 };
    this.jobs.set(job.id, job);
    const fail = () => { if (job.status === "running") { job.status = "failed"; job.code = "CLEANUP_SCAN_FAILED"; job.progress = "扫描失败，请重试"; } };
    try {
      const worker = this.workerFactory({ owner, dbPath: this.cleanup.service.dbPath, dataDir: this.cleanup.service.dataDir });
      worker.on("message", message => {
        if (message.progress) job.progress = message.progress;
        if (message.preview && message.plan) {
          for (const [token, plan] of this.cleanup.plans) if (plan.owner === owner || plan.expires < Date.now()) this.cleanup.plans.delete(token);
          this.cleanup.plans.set(message.preview.preview_id, message.plan);
          job.preview = message.preview; job.status = "completed"; job.progress = "扫描完成，请核对预览";
        }
      });
      worker.once("error", fail);
      worker.once("exit", fail);
    } catch { fail(); }
    return this.public(job);
  }
}
module.exports = { CleanupPreviewJobs };
