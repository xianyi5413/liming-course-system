#!/usr/bin/env node
const path = require("node:path");
const { BackupService } = require("../../src/backup/backup_service");
const { loadBackupSettings } = require("../../src/backup/scheduler");
const { BaiduBackupManager } = require("../../src/backup/baidu_provider");

async function main() {
  const backupId = Number(process.argv[2] || 0);
  if (!Number.isInteger(backupId) || backupId <= 0) throw Object.assign(new Error("备份任务 ID 无效"), { code: "BACKUP_JOB_ID_INVALID" });
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "../../data"));
  const dbPath = path.resolve(process.env.DB_PATH || path.join(dataDir, "liming-local.sqlite"));
  const settings = loadBackupSettings(dbPath);
  const remote = new BaiduBackupManager({ dataDir });
  const service = new BackupService({
    dbPath,
    dataDir,
    appVersion: process.env.APP_VERSION || "unknown",
    appGitCommit: process.env.APP_GIT_COMMIT || "",
    remoteUploader: (options) => remote.upload({ ...options, remoteDirectory: settings.remote_directory }),
  });
  const database = service.database();
  let record;
  try { record = service.record(database, backupId); } finally { database.close(); }
  if (!record || record.trigger !== "remote_manual" || record.job_status !== "queued") throw Object.assign(new Error("备份任务不存在或状态不允许执行"), { code: "BACKUP_JOB_NOT_QUEUED" });
  service.markJobStage(backupId, "preflight", "", process.pid);
  const result = await service.create({
    existingRecordId: backupId,
    trigger: "remote_manual",
    retentionClass: "remote",
    createdByUserId: record.created_by_user_id,
    remoteEnabled: true,
    includeOperationLogs: Number(record.operation_logs_included ?? 1) === 1,
  });
  if (result.record.remote_status === "success") await service.applyRemoteRetention(settings.remote_retention, (item) => remote.delete(item));
  if (result.record.job_status !== "success") process.exitCode = 1;
}

main().catch((error) => {
  const backupId = Number(process.argv[2] || 0);
  try {
    const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "../../data"));
    const dbPath = path.resolve(process.env.DB_PATH || path.join(dataDir, "liming-local.sqlite"));
    new BackupService({ dbPath, dataDir }).markJobStage(backupId, "failed", error.code || "BACKUP_JOB_FAILED", 0);
  } catch {}
  process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "BACKUP_JOB_FAILED" })}\n`);
  process.exitCode = 1;
});
