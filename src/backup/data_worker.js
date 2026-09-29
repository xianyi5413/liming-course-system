const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { exportFullData } = require('../excel/full_backup');
const { previewImport, importFullExcel } = require('../excel/import_service');
const { runDataPreflight } = require('./data_preflight');
const { BackupService } = require('./backup_service');

async function main(data) {
  const onProgress = (stage, progress, message) => process.send({ stage, progress, message });
  onProgress('starting', 1, '正在启动任务');
  let result, artifact;
  if (data.kind === 'export') {
    const dir = path.join(data.dataDir, 'uploads', 'data-jobs');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    artifact = path.join(dir, data.jobId + '.xlsx');
    const exported = exportFullData({ dbPath: data.dbPath, outputPath: artifact, appVersion: data.appVersion, includeOperationLogs: data.includeOperationLogs, onProgress });
    result = { filename: '黎明教育_全量数据.xlsx', file_size: exported.buffer.length };
  } else if (data.kind === 'preview') {
    onProgress('read_workbook', 20, '正在读取工作簿');
    result = { ...previewImport(data.inputPath, { appVersion: data.appVersion, onProgress }), upload_id: data.uploadId };
  } else if (data.kind === 'preflight') {
    onProgress('preflight', 10, '正在执行数据预检');
    const db = new DatabaseSync(data.dbPath, { readOnly: true });
    try { result = runDataPreflight(db); } finally { db.close(); }
  } else if (data.kind === 'restore') {
    const service = new BackupService({ dbPath: data.dbPath, dataDir: data.dataDir, appVersion: data.appVersion });
    let lock = '';
    try {
      onProgress('pre_backup', 5, '正在保护恢复前数据');
      const before = data.mode === 'overwrite' ? await service.create({ trigger: 'pre_restore', retentionClass: 'pre_restore', createdByUserId: data.owner }) : null;
      lock = service.acquireLock();
      result = importFullExcel({ dbPath: data.dbPath, inputPath: data.inputPath, mode: data.mode, preBackupSatisfied: !!before, appVersion: data.appVersion, onProgress });
      result = { ...result, pre_backup: before ? { id: before.record.id, filename: before.record.filename } : null, sessions_cleared: true };
    } finally { if (lock) service.releaseLock(lock); }
  } else throw new Error('不支持的后台任务');
  process.send({ result, artifact }, () => process.disconnect());
}
process.once('message', data => main(data).catch(error => {
  const code = error.code || String(error.message).split(':')[0];
  const known = /^(FULL_EXCEL_|DATA_PREFLIGHT_|BACKUP_|XLSX_)/.test(code);
  const message = code === 'XLSX_ZIP_INVALID' ? '文件不是有效的 Excel 工作簿（XLSX_ZIP_INVALID）' : known ? error.message : `数据处理失败（${error.code || 'DATA_JOB_FAILED'}），请检查文件或数据库状态后重试`;
  process.send({ error: { code: known ? code : 'DATA_JOB_FAILED', message } }, () => process.disconnect());
}));
