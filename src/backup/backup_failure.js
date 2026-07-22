const FAILURE_PREFIX = "BACKUP_FAILURE_V1:";

const FAILURE_MESSAGES = Object.freeze({
  BACKUP_DATA_PREFLIGHT_FAILED: "数据完整性预检未通过",
  DATA_PREFLIGHT_FAILED: "数据完整性预检未通过",
  STUDENT_GRADE_STAGE_OVERLAP: "学生年级阶段时间冲突",
  ACCOUNT_ROLE_INVALID: "账号角色关系无效",
  BACKUP_ALREADY_RUNNING: "已有备份或恢复任务正在执行",
  BACKUP_ROOT_INVALID: "受管备份目录无效",
  BACKUP_ROOT_UNWRITABLE: "受管备份目录不可写",
  BACKUP_TARGET_EXISTS: "备份目标文件已存在",
  BACKUP_FILE_MISSING: "备份文件不存在",
  BACKUP_SHA256_MISMATCH: "备份 SHA-256 校验不匹配",
  BAIDU_NOT_CONFIGURED: "百度网盘尚未配置",
  BAIDU_AUTHORIZATION_REQUIRED: "百度网盘需要授权",
  BAIDU_AUTHORIZATION_EXPIRED: "百度网盘授权已过期",
  BAIDU_REMOTE_FILE_ID_MISSING: "百度网盘文件 ID 缺失",
  BAIDU_API_FAILED: "百度网盘接口调用失败",
  BAIDU_DOWNLOAD_FAILED: "百度网盘文件下载失败",
  BAIDU_FILE_DOWNLOAD_FAILED: "百度网盘 Excel 下载失败",
  BAIDU_CHECKSUM_DOWNLOAD_FAILED: "百度网盘 SHA-256 文件下载失败",
  BAIDU_FILE_METADATA_FAILED: "获取百度 Excel 文件元信息失败",
  BAIDU_CHECKSUM_METADATA_FAILED: "获取百度 SHA-256 文件元信息失败",
  BAIDU_REMOTE_SHA256_MISMATCH: "百度网盘 Excel 与 SHA-256 校验文件不匹配",
  BAIDU_REMOTE_DELETE_PARTIAL: "百度网盘文件仅部分删除成功",
});

function cleanCode(value, fallback = "BACKUP_FAILED") {
  return String(value || fallback).replace(/[^A-Z0-9_-]/gi, "_").slice(0, 100) || fallback;
}

function cleanText(value, limit = 500) {
  return String(value || "")
    .replace(/\b(password|passcode|token|secret|cookie|authorization|session|sid)\s*[:=]\s*[^\s,，;；]+/gi, "$1=[已脱敏]")
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s,，;；]+[\\/])+[^\s,，;；]*/g, "[路径已隐藏]")
    .replace(/https?:\/\/[^\s]+/gi, "[地址已隐藏]")
    .trim()
    .slice(0, limit);
}

function safeConflictRecord(record = {}) {
  return Object.fromEntries([
    "student_id", "student_name", "current_grade", "stage_a", "start_a", "end_a",
    "stage_b", "start_b", "end_b", "overlap_start", "overlap_end", "reason",
  ].map((key) => [key, typeof record[key] === "number" ? record[key] : cleanText(record[key], 160)]));
}

function safePreflightDetails(preflight = {}) {
  const issues = Array.isArray(preflight.issues) ? preflight.issues : [];
  return {
    issue_count: Number(preflight.issue_count || 0),
    issues: issues.slice(0, 100).map((issue) => ({
      code: cleanCode(issue.code, "DATA_PREFLIGHT_FAILED"),
      label: cleanText(issue.label, 160),
      count: Number(issue.count || 0),
      records: (Array.isArray(issue.records) ? issue.records : []).slice(0, 100).map(safeConflictRecord),
    })),
  };
}

function mappedFailureMessage(code) {
  return FAILURE_MESSAGES[cleanCode(code)] || `备份失败（错误代码：${cleanCode(code)}）`;
}

function safeBackupFailure(error, { stage = "local" } = {}) {
  const code = cleanCode(error?.code || error);
  const preflight = error?.details?.preflight;
  const details = {};
  let message = mappedFailureMessage(code);
  if (preflight && typeof preflight === "object") {
    details.preflight = safePreflightDetails(preflight);
    const conflictIssue = details.preflight.issues.find((issue) => issue.code === "STUDENT_GRADE_STAGE_OVERLAP");
    const first = conflictIssue?.records?.[0];
    if (first?.student_name) {
      message = `数据完整性预检未通过：${first.student_name}的${first.stage_a}与${first.stage_b}阶段时间重叠，共发现${details.preflight.issue_count}个问题`;
    } else {
      message = `数据完整性预检未通过，共发现${details.preflight.issue_count}个问题`;
    }
  }
  const providerCode = cleanText(error?.details?.provider_code, 80);
  if (providerCode) {
    details.provider_code = providerCode;
    if (/METADATA_FAILED$/.test(code)) message = `${mappedFailureMessage(code)}（错误码${providerCode}）`;
  }
  const httpStatus = Number(error?.details?.http_status || 0);
  if (httpStatus > 0 && httpStatus < 600) details.http_status = httpStatus;
  const causeCode = cleanText(error?.details?.cause_code, 100);
  if (causeCode) details.cause_code = cleanCode(causeCode);
  return { code, message: cleanText(message) || mappedFailureMessage(code), stage: cleanText(stage, 40) || "local", details };
}

function serializeBackupFailure(failure) {
  return `${FAILURE_PREFIX}${JSON.stringify(failure)}`;
}

function parseBackupFailure(value, { stage = "local" } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith(FAILURE_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(FAILURE_PREFIX.length));
      const code = cleanCode(parsed.code);
      return {
        code,
        message: cleanText(parsed.message) || mappedFailureMessage(code),
        stage: cleanText(parsed.stage, 40) || stage,
        details: parsed.details && typeof parsed.details === "object" ? parsed.details : {},
      };
    } catch {}
  }
  const code = cleanCode(raw);
  return { code, message: mappedFailureMessage(code), stage, details: {}, legacy: true };
}

function backupFailureDisplay(row = {}) {
  if (row.status && !["success", "deleted"].includes(row.status)) {
    const failure = parseBackupFailure(row.message, { stage: "local" }) || safeBackupFailure(row.message || "BACKUP_FAILED", { stage: "local" });
    if (failure.legacy) failure.message = `${failure.message}；旧记录未保存详细信息`;
    return failure;
  }
  if (["failed", "partial_failed", "delete_failed", "delete_partial"].includes(row.remote_status)) {
    const persisted = parseBackupFailure(row.message, { stage: "remote" });
    if (persisted?.stage === "remote") return persisted;
    const failure = parseBackupFailure(row.remote_error_safe, { stage: "remote" }) || safeBackupFailure("BAIDU_API_FAILED", { stage: "remote" });
    if (failure.legacy) failure.message = `${failure.message}；旧记录未保存详细信息`;
    return failure;
  }
  return null;
}

module.exports = {
  FAILURE_MESSAGES,
  backupFailureDisplay,
  mappedFailureMessage,
  parseBackupFailure,
  safeBackupFailure,
  serializeBackupFailure,
};
