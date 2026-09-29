const ACTIVE_BACKUP_JOB_STATUSES = new Set(["queued", "preflight", "exporting", "hashing", "uploading", "uploading_excel", "uploading_checksum", "verifying_metadata", "downloading_for_verification", "integrity_check"]);
const busy = row => ACTIVE_BACKUP_JOB_STATUSES.has(row.job_status) || ["creating", "verifying", "uploading", "restoring"].includes(row.status) || row.remote_status === "uploading";
const { instant } = require('../../public/business-time');
const timestamp = row => instant(row.backup_time || row.created_at).getTime();
const newest = rows => [...rows].sort((a,b) => (timestamp(b) - timestamp(a) || b.id-a.id));
const localCounted = row => row.backup_format === 'full_data_excel' && !!row.managed_relative_path && !row.deleted_at && row.status !== 'deleted';
function ensureLocalRetentionSetting(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'").get()) return;
  if (db.prepare("SELECT 1 FROM settings WHERE key='full_backup_total_retention'").get()) return;
  const count = db.prepare("SELECT COUNT(*) n FROM backup_records WHERE backup_format='full_data_excel' AND COALESCE(managed_relative_path,'')<>'' AND COALESCE(deleted_at,'')='' AND status<>'deleted'").get().n;
  const sum = [['daily',14,365],['monthly',12,120],['manual',20,200]].reduce((n,[kind,fallback,maximum]) => {
    const value = Number(db.prepare('SELECT value FROM settings WHERE key=?').get('full_backup_' + kind + '_retention')?.value);
    return n + (Number.isSafeInteger(value) && value > 0 ? Math.min(maximum,value) : fallback);
  },0);
  db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('full_backup_total_retention',?)").run(String(Math.max(50, count, sum)));
}
const localPolicy = settings => ({ daily: settings.daily_retention, monthly: settings.monthly_retention, manual: settings.manual_retention, total: settings.total_retention });
function localRetentionSelection(rows, policy = {}, canDelete = () => true) {
  const limits = { daily: Math.max(1, Number(policy.daily || 14)), monthly: Math.max(1, Number(policy.monthly || 12)), manual: Math.max(1, Number(policy.manual || 20)) };
  const total = Number.isSafeInteger(Number(policy.total)) && Number(policy.total) > 0 ? Number(policy.total) : Infinity;
  const successful = newest(rows.filter(row => row.backup_format === "full_data_excel" && ["success", "delete_partial"].includes(row.status) && !row.deleted_at));
  const eligible = successful.filter(row => !Number(row.pinned || 0) && row.verified_at && !busy(row) && Number.isFinite(timestamp(row)));
  const categoryCandidates = policy.totalOnly ? [] : ["daily", "monthly", "manual"].flatMap(kind => eligible.filter(row => (row.retention_class === "remote" ? "manual" : row.retention_class) === kind).slice(limits[kind])).filter(canDelete);
  const selected = new Set(categoryCandidates.map(row => row.id));
  const counted = rows.filter(localCounted);
  const excess = Math.max(0, counted.filter(row => !selected.has(row.id)).length - total);
  const totalCandidates = [...eligible].reverse().filter(row => localCounted(row) && canDelete(row) && !selected.has(row.id) && ['daily','monthly','manual','remote','pre_restore'].includes(row.retention_class) && Number.isFinite(timestamp(row))).slice(0, excess);
  return { limits: { ...limits, ...(Number.isFinite(total) ? { total } : {}) }, successful, counted, categoryCandidates: newest(categoryCandidates).reverse(), totalCandidates, candidates: [...newest(categoryCandidates).reverse(), ...totalCandidates], excess };
}
function remoteRetentionSelection(records, limit = 20) {
  const keep = Math.max(1, Math.min(200, Number(limit) || 20));
  const allRows = newest(records.filter(row => row.backup_format === "full_data_excel" && ["success", "delete_partial"].includes(row.remote_status) && row.remote_path));
  const rows = allRows.filter(row => !/\.enc$/i.test(row.remote_path));
  return { keep, allRows, rows, candidates: rows.filter(row => !Number(row.pinned || 0) && !busy(row)).reverse() };
}
module.exports = { ACTIVE_BACKUP_JOB_STATUSES, busy, localRetentionSelection, remoteRetentionSelection, localPolicy, localCounted, ensureLocalRetentionSetting };
