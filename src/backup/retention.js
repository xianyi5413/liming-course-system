const ACTIVE_BACKUP_JOB_STATUSES = new Set(["queued", "preflight", "exporting", "hashing", "uploading", "uploading_excel", "uploading_checksum", "verifying_metadata", "downloading_for_verification", "integrity_check"]);
const busy = row => ACTIVE_BACKUP_JOB_STATUSES.has(row.job_status) || ["creating", "verifying", "uploading", "restoring"].includes(row.status) || row.remote_status === "uploading";
const newest = rows => [...rows].sort((a,b) => String(b.backup_time || "").localeCompare(String(a.backup_time || "")) || b.id-a.id);
function localRetentionSelection(rows, policy = {}) {
  const limits = { daily: Math.max(1, Number(policy.daily || 14)), monthly: Math.max(1, Number(policy.monthly || 12)), manual: Math.max(1, Number(policy.manual || 20)) };
  const successful = newest(rows.filter(row => row.backup_format === "full_data_excel" && ["success", "delete_partial"].includes(row.status) && !row.deleted_at));
  const eligible = successful.filter(row => !Number(row.pinned || 0) && row.verified_at && !busy(row));
  return { limits, successful, candidates: ["daily", "monthly", "manual"].flatMap(kind => eligible.filter(row => (row.retention_class === "remote" ? "manual" : row.retention_class) === kind).slice(limits[kind])) };
}
function remoteRetentionSelection(records, limit = 20) {
  const keep = Math.max(1, Math.min(200, Number(limit) || 20));
  const allRows = newest(records.filter(row => row.backup_format === "full_data_excel" && ["success", "delete_partial"].includes(row.remote_status) && row.remote_path));
  const rows = allRows.filter(row => !/\.enc$/i.test(row.remote_path));
  return { keep, allRows, rows, candidates: rows.filter(row => !Number(row.pinned || 0) && !busy(row)).reverse() };
}
module.exports = { ACTIVE_BACKUP_JOB_STATUSES, busy, localRetentionSelection, remoteRetentionSelection };
