const { BackupService } = require("./backup_service");
const { BackupCleanupService } = require("./cleanup_service");
const { loadBackupSettings } = require("./scheduler");
const { BaiduBackupManager } = require("./baidu_provider");

async function main(workerData) {
  const { owner, dbPath, dataDir } = workerData;
  const cleanup = new BackupCleanupService({ service: new BackupService({ dbPath, dataDir }), settings: () => loadBackupSettings(dbPath), remote: new BaiduBackupManager({ dataDir }) });
  const preview = await cleanup.scan(owner, progress => process.send({ progress }));
  process.send({ preview, plan: cleanup.plans.get(preview.preview_id) }, () => process.disconnect());
}
process.once("message", data => main(data).catch(() => { process.exitCode = 1; if (process.connected) process.disconnect(); }));
