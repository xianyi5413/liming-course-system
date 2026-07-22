const { spawn } = require("node:child_process");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { ensureBackupColumns } = require("./backup_service");

const DEFAULT_BACKUP_SETTINGS = Object.freeze({
  enabled: false, time: "02:30", timezone: "Asia/Shanghai", daily_retention: 14,
  monthly_retention: 12, manual_retention: 20, retry_count: 3,
  local_include_operation_logs: false,
  remote_enabled: false, remote_frequency: "weekly", remote_time: "03:30", remote_timezone: "Asia/Shanghai",
  remote_weekday: 3, remote_monthday: 1, remote_retention: 20, remote_retry_count: 3,
  remote_include_operation_logs: true, remote_directory: "/apps/liming-course-system", remote_plaintext_acknowledged: false,
});
const SETTING_KEYS = Object.freeze({
  enabled: "full_backup_auto_enabled", time: "full_backup_time", timezone: "full_backup_timezone",
  daily_retention: "full_backup_daily_retention", monthly_retention: "full_backup_monthly_retention",
  manual_retention: "full_backup_manual_retention", retry_count: "full_backup_retry_count",
  local_include_operation_logs: "full_backup_local_include_operation_logs",
  remote_enabled: "full_backup_remote_enabled", remote_directory: "full_backup_remote_directory",
  remote_frequency: "full_backup_remote_frequency", remote_time: "full_backup_remote_time",
  remote_weekday: "full_backup_remote_weekday", remote_monthday: "full_backup_remote_monthday",
  remote_timezone: "full_backup_remote_timezone", remote_retention: "full_backup_remote_retention",
  remote_retry_count: "full_backup_remote_retry_count", remote_include_operation_logs: "full_backup_remote_include_operation_logs",
  remote_plaintext_acknowledged: "full_backup_remote_plaintext_acknowledged",
});

function normalizeSettings(values = {}) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(values.time || "")) ? String(values.time) : DEFAULT_BACKUP_SETTINGS.time;
  const remoteTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(values.remote_time || "")) ? String(values.remote_time) : DEFAULT_BACKUP_SETTINGS.remote_time;
  const remoteFrequency = ["manual", "daily", "weekly", "monthly"].includes(String(values.remote_frequency || "")) ? String(values.remote_frequency) : DEFAULT_BACKUP_SETTINGS.remote_frequency;
  const bounded = (value, fallback, minimum, maximum) => { const number = Number(value); return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback)); };
  return {
    enabled: values.enabled === true || values.enabled === 1 || values.enabled === "1" || values.enabled === "true",
    time, timezone: values.timezone === "Asia/Shanghai" ? values.timezone : DEFAULT_BACKUP_SETTINGS.timezone,
    daily_retention: bounded(values.daily_retention, DEFAULT_BACKUP_SETTINGS.daily_retention, 1, 365),
    monthly_retention: bounded(values.monthly_retention, DEFAULT_BACKUP_SETTINGS.monthly_retention, 1, 120),
    manual_retention: bounded(values.manual_retention, DEFAULT_BACKUP_SETTINGS.manual_retention, 1, 200),
    retry_count: bounded(values.retry_count, DEFAULT_BACKUP_SETTINGS.retry_count, 0, 10),
    local_include_operation_logs: values.local_include_operation_logs === true || values.local_include_operation_logs === 1 || values.local_include_operation_logs === "1" || values.local_include_operation_logs === "true",
    remote_enabled: values.remote_enabled === true || values.remote_enabled === 1 || values.remote_enabled === "1" || values.remote_enabled === "true",
    remote_frequency: remoteFrequency, remote_time: remoteTime,
    remote_timezone: values.remote_timezone === "Asia/Shanghai" ? values.remote_timezone : DEFAULT_BACKUP_SETTINGS.remote_timezone,
    remote_weekday: bounded(values.remote_weekday, DEFAULT_BACKUP_SETTINGS.remote_weekday, 1, 7),
    remote_monthday: bounded(values.remote_monthday, DEFAULT_BACKUP_SETTINGS.remote_monthday, 1, 28),
    remote_retention: bounded(values.remote_retention, DEFAULT_BACKUP_SETTINGS.remote_retention, 1, 200),
    remote_retry_count: bounded(values.remote_retry_count, DEFAULT_BACKUP_SETTINGS.remote_retry_count, 0, 10),
    remote_include_operation_logs: values.remote_include_operation_logs === undefined ? DEFAULT_BACKUP_SETTINGS.remote_include_operation_logs : (values.remote_include_operation_logs === true || values.remote_include_operation_logs === 1 || values.remote_include_operation_logs === "1" || values.remote_include_operation_logs === "true"),
    remote_directory: String(values.remote_directory || DEFAULT_BACKUP_SETTINGS.remote_directory).trim().slice(0, 500),
    remote_plaintext_acknowledged: values.remote_plaintext_acknowledged === true || values.remote_plaintext_acknowledged === 1 || values.remote_plaintext_acknowledged === "1" || values.remote_plaintext_acknowledged === "true",
  };
}

function loadBackupSettings(dbPath) {
  const db = new DatabaseSync(path.resolve(dbPath));
  try {
    const rows = Object.entries(SETTING_KEYS).map(([field, key]) => [field, db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value]);
    return normalizeSettings(Object.fromEntries(rows));
  } finally { db.close(); }
}

function saveBackupSettings(dbPath, values = {}) {
  const merged = normalizeSettings({ ...loadBackupSettings(dbPath), ...values }); const db = new DatabaseSync(path.resolve(dbPath));
  try { const put = db.prepare("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"); db.exec("BEGIN"); try { for (const [field, key] of Object.entries(SETTING_KEYS)) put.run(key, ["enabled", "local_include_operation_logs", "remote_enabled", "remote_include_operation_logs", "remote_plaintext_acknowledged"].includes(field) ? (merged[field] ? "1" : "0") : String(merged[field])); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; } }
  finally { db.close(); }
  return merged;
}

function shanghaiParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  const dateString = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = new Date(`${dateString}T12:00:00+08:00`).getUTCDay() || 7;
  return { date: dateString, time: `${parts.hour}:${parts.minute}`, weekday, monthday: Number(parts.day), month: `${parts.year}-${parts.month}` };
}

function scheduleKey(dateString) { return `full-data:${dateString}`; }
function remoteScheduleKey(settings, local) {
  if (settings.remote_frequency === "monthly") return `full-data-remote:monthly:${local.month}`;
  if (settings.remote_frequency === "weekly") return `full-data-remote:weekly:${local.date}`;
  return `full-data-remote:daily:${local.date}`;
}
function dueState(dbPath, settings, now = new Date()) {
  const local = shanghaiParts(now); const key = scheduleKey(local.date);
  if (!settings.enabled) return { due: false, reason: "disabled", key, scheduled_for: local.date };
  if (local.time < settings.time) return { due: false, reason: "before_time", key, scheduled_for: local.date };
  const db = new DatabaseSync(path.resolve(dbPath));
  try {
    ensureBackupColumns(db);
    if (db.prepare("SELECT 1 FROM backup_records WHERE schedule_key=? AND status='success' LIMIT 1").get(key)) return { due: false, reason: "already_successful", key, scheduled_for: local.date };
    const failures = db.prepare("SELECT backup_time FROM backup_records WHERE schedule_key=? AND status='failed' ORDER BY id DESC").all(key);
    if (failures.length > settings.retry_count) return { due: false, reason: "retry_exhausted", key, scheduled_for: local.date };
    if (failures.length) {
      const delays = [10, 30, 120]; const waitMinutes = delays[Math.min(failures.length - 1, delays.length - 1)];
      const last = Date.parse(`${String(failures[0].backup_time).replace(" ", "T")}Z`);
      if (Number.isFinite(last) && now.getTime() - last < waitMinutes * 60_000) return { due: false, reason: "retry_wait", key, scheduled_for: local.date, wait_minutes: waitMinutes };
    }
    return { due: true, reason: failures.length ? "retry" : "scheduled", key, scheduled_for: local.date, attempt: failures.length + 1 };
  } finally { db.close(); }
}

function remoteDueState(dbPath, settings, now = new Date()) {
  const local = shanghaiParts(now); const key = remoteScheduleKey(settings, local);
  if (!settings.remote_enabled) return { due: false, reason: "disabled", key, scheduled_for: local.date };
  if (settings.remote_frequency === "manual") return { due: false, reason: "manual", key, scheduled_for: local.date };
  if (settings.remote_frequency === "weekly" && local.weekday !== Number(settings.remote_weekday)) return { due: false, reason: "wrong_weekday", key, scheduled_for: local.date };
  if (settings.remote_frequency === "monthly" && local.monthday !== Number(settings.remote_monthday)) return { due: false, reason: "wrong_monthday", key, scheduled_for: local.date };
  if (local.time < settings.remote_time) return { due: false, reason: "before_time", key, scheduled_for: local.date };
  const db = new DatabaseSync(path.resolve(dbPath));
  try {
    ensureBackupColumns(db);
    const existing = db.prepare("SELECT id,remote_status,remote_attempt_count,remote_updated_at,backup_time FROM backup_records WHERE schedule_key=? AND status='success' ORDER BY id DESC LIMIT 1").get(key);
    if (existing?.remote_status === "success") return { due: false, reason: "already_successful", key, scheduled_for: local.date };
    const failures = existing ? Number(existing.remote_attempt_count || 1) : Number(db.prepare("SELECT COUNT(*) AS count FROM backup_records WHERE schedule_key=? AND status='failed'").get(key).count || 0);
    if (failures > settings.remote_retry_count) return { due: false, reason: "retry_exhausted", key, scheduled_for: local.date };
    if (existing) {
      const delays = [10, 30, 120]; const waitMinutes = delays[Math.min(failures - 1, delays.length - 1)];
      const last = Date.parse(`${String(existing.remote_updated_at || existing.backup_time).replace(" ", "T")}Z`);
      if (Number.isFinite(last) && now.getTime() - last < waitMinutes * 60_000) return { due: false, reason: "retry_wait", key, scheduled_for: local.date, wait_minutes: waitMinutes, retry_backup_id: Number(existing.id) };
      return { due: true, reason: "retry", key, scheduled_for: local.date, attempt: failures + 1, retry_backup_id: Number(existing.id) };
    }
    return { due: true, reason: "scheduled", key, scheduled_for: local.date, attempt: 1 };
  } finally { db.close(); }
}

function startBackupScheduler({ dbPath, dataDir, intervalMs = 60_000, timeoutMs = 15 * 60_000, childScript = path.resolve(__dirname, "../../scripts/excel_backup/run_scheduled_backup.js"), logger = console } = {}) {
  let child = null; let childTimeout = null; let stopped = false;
  const check = () => {
    if (stopped || child) return;
    try {
      const settings = loadBackupSettings(dbPath); const localDue = dueState(dbPath, settings); const remoteDue = remoteDueState(dbPath, settings); const due = localDue.due ? { ...localDue, kind: "local" } : remoteDue.due ? { ...remoteDue, kind: "remote" } : null;
      if (!due) return;
      const args = [childScript, "--scheduled-for", due.scheduled_for, "--schedule-key", due.key, "--kind", due.kind];
      if (due.retry_backup_id) args.push("--retry-backup-id", String(due.retry_backup_id));
      child = spawn(process.execPath, args, { cwd: path.resolve(__dirname, "../.."), env: { ...process.env, DB_PATH: dbPath, DATA_DIR: dataDir }, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (chunk) => logger.info?.(`[backup-job] ${String(chunk).trim().slice(0, 500)}`));
      child.stderr.on("data", (chunk) => logger.error?.(`[backup-job] ${String(chunk).trim().slice(0, 500)}`));
      const launched = child; childTimeout = setTimeout(() => { if (child === launched) { logger.error?.("[backup-job] timeout"); launched.kill("SIGTERM"); } }, Math.max(1_000, timeoutMs)); childTimeout.unref();
      child.on("exit", (code) => { if (childTimeout) clearTimeout(childTimeout); childTimeout = null; logger.info?.(`[backup-job] exit=${Number(code)}`); if (child === launched) child = null; });
    } catch (error) { logger.error?.(`[backup-scheduler] ${String(error.code || error.name || "CHECK_FAILED")}`); }
  };
  const timer = setInterval(check, Math.max(1_000, intervalMs)); timer.unref(); setImmediate(check);
  return { check, stop() { stopped = true; clearInterval(timer); if (childTimeout) clearTimeout(childTimeout); if (child) child.kill("SIGTERM"); }, running() { return Boolean(child); } };
}

module.exports = { DEFAULT_BACKUP_SETTINGS, SETTING_KEYS, normalizeSettings, loadBackupSettings, saveBackupSettings, shanghaiParts, scheduleKey, remoteScheduleKey, dueState, remoteDueState, startBackupScheduler };
