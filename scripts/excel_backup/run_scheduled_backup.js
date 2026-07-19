#!/usr/bin/env node
const path = require("node:path");
const { BackupService } = require("../../src/backup/backup_service");
const { loadBackupSettings } = require("../../src/backup/scheduler");
const { BaiduBackupManager } = require("../../src/backup/baidu_provider");

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? String(process.argv[index + 1] || "") : ""; }
async function main() {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "../../data")); const dbPath = path.resolve(process.env.DB_PATH || path.join(dataDir, "liming-local.sqlite"));
  const scheduledFor = option("--scheduled-for"); const scheduleKey = option("--schedule-key");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor) || scheduleKey !== `full-data:${scheduledFor}`) throw Object.assign(new Error("计划参数无效"), { code: "BACKUP_SCHEDULE_ARGUMENT_INVALID" });
  const settings = loadBackupSettings(dbPath); const remote = new BaiduBackupManager({ dataDir }); const service = new BackupService({ dbPath, dataDir, appVersion: process.env.APP_VERSION || "unknown", remoteUploader: (options) => remote.upload({ ...options, remoteDirectory: settings.remote_directory }) });
  const result = await service.create({ trigger: "automatic", retentionClass: "daily", scheduledDate: scheduledFor, scheduleKey, remoteEnabled: settings.remote_enabled });
  service.promoteMonthly(result.record.id, scheduledFor);
  const retention = service.applyRetention({ daily: settings.daily_retention, monthly: settings.monthly_retention, manual: settings.manual_retention });
  process.stdout.write(`${JSON.stringify({ ok: true, backup_id: result.record.id, schedule_key: scheduleKey, retention })}\n`);
}
main().catch((error) => { process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "BACKUP_JOB_FAILED" })}\n`); process.exitCode = 1; });
