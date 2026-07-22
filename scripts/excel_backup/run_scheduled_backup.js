#!/usr/bin/env node
const path = require("node:path");
const { BackupService } = require("../../src/backup/backup_service");
const { loadBackupSettings } = require("../../src/backup/scheduler");
const { BaiduBackupManager } = require("../../src/backup/baidu_provider");

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? String(process.argv[index + 1] || "") : ""; }
async function main() {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "../../data")); const dbPath = path.resolve(process.env.DB_PATH || path.join(dataDir, "liming-local.sqlite"));
  const scheduledFor = option("--scheduled-for"); const scheduleKey = option("--schedule-key"); const kind = option("--kind") || "local"; const retryBackupId = Number(option("--retry-backup-id") || 0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor) || !["local", "remote"].includes(kind) || (kind === "local" ? scheduleKey !== `full-data:${scheduledFor}` : !/^full-data-remote:(daily|weekly|monthly):/.test(scheduleKey))) throw Object.assign(new Error("计划参数无效"), { code: "BACKUP_SCHEDULE_ARGUMENT_INVALID" });
  const settings = loadBackupSettings(dbPath); const remote = new BaiduBackupManager({ dataDir }); const service = new BackupService({ dbPath, dataDir, appVersion: process.env.APP_VERSION || "unknown", remoteUploader: (options) => remote.upload({ ...options, remoteDirectory: settings.remote_directory }) });
  if (kind === "remote") {
    if (!settings.remote_enabled || settings.remote_frequency === "manual" || !remote.configured()) throw Object.assign(new Error("百度自动备份未就绪"), { code: "BAIDU_AUTOMATIC_BACKUP_NOT_READY" });
    const record = retryBackupId
      ? await service.retryRemote(retryBackupId, settings.remote_directory)
      : (await service.create({ trigger: "remote_automatic", retentionClass: "remote", scheduledDate: scheduledFor, scheduleKey, remoteEnabled: true, includeOperationLogs: settings.remote_include_operation_logs })).record;
    if (record.remote_status !== "success") throw Object.assign(new Error("百度网盘上传或远端校验失败"), { code: record.remote_error_safe || "BAIDU_REMOTE_BACKUP_FAILED" });
    const retention = await service.applyRemoteRetention(settings.remote_retention, (item) => remote.delete(item));
    process.stdout.write(`${JSON.stringify({ ok: true, kind, backup_id: record.id, schedule_key: scheduleKey, retention })}\n`);
    return;
  }
  const result = await service.create({ trigger: "automatic", retentionClass: "daily", scheduledDate: scheduledFor, scheduleKey, remoteEnabled: false, includeOperationLogs: settings.local_include_operation_logs });
  service.promoteMonthly(result.record.id, scheduledFor);
  const retention = service.applyRetention({ daily: settings.daily_retention, monthly: settings.monthly_retention, manual: settings.manual_retention });
  process.stdout.write(`${JSON.stringify({ ok: true, kind, backup_id: result.record.id, schedule_key: scheduleKey, retention })}\n`);
}
main().catch((error) => { process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "BACKUP_JOB_FAILED" })}\n`); process.exitCode = 1; });
