const fs = require("node:fs");
const path = require("node:path");

const MANAGED_RELATIVE_ROOT = path.posix.join("backups", "full-excel");

class ManagedFileBrowserError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ManagedFileBrowserError";
    this.code = code;
  }
}

function slash(value) {
  return String(value || "").split(path.sep).join("/");
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizedManagedRelativePath(value) {
  const raw = String(value || "").replaceAll("\\", "/");
  if (!raw || raw.includes("\0") || path.posix.isAbsolute(raw)) {
    throw new ManagedFileBrowserError("MANAGED_FILE_PATH_INVALID", "文件相对路径无效");
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === MANAGED_RELATIVE_ROOT
    || !normalized.startsWith(`${MANAGED_RELATIVE_ROOT}/`)
    || normalized.split("/").includes("..")
    || !/\.xlsx$/i.test(normalized)) {
    throw new ManagedFileBrowserError("MANAGED_FILE_PATH_INVALID", "只能访问托管目录中的 Excel 文件");
  }
  return normalized;
}

async function safeRegularFile(filename, rootRealPath) {
  try {
    const info = await fs.promises.lstat(filename);
    if (info.isSymbolicLink() || !info.isFile()) return null;
    const real = await fs.promises.realpath(filename);
    if (!contained(rootRealPath, real)) return null;
    return { info, real };
  } catch {
    return null;
  }
}

async function walkExcelFiles(directory, rootRealPath, items) {
  let entries;
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name.startsWith("~$") || /\.(?:tmp|part)\.xlsx$/i.test(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    let info;
    try { info = await fs.promises.lstat(filename); } catch { continue; }
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      await walkExcelFiles(filename, rootRealPath, items);
      continue;
    }
    if (!info.isFile() || !/\.xlsx$/i.test(entry.name)) continue;
    const safe = await safeRegularFile(filename, rootRealPath);
    if (safe) items.push({ filename, info: safe.info });
  }
}

async function listManagedLocalExcel({ dataDir, records = [] }) {
  const root = path.resolve(dataDir, "backups", "full-excel");
  let rootRealPath;
  try {
    const rootInfo = await fs.promises.lstat(root);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
      throw new ManagedFileBrowserError("MANAGED_FILE_ROOT_INVALID", "托管 Excel 目录无效");
    }
    rootRealPath = await fs.promises.realpath(root);
  } catch (error) {
    if (error instanceof ManagedFileBrowserError) throw error;
    if (error?.code === "ENOENT") return { root_status: "not_created", items: [] };
    throw new ManagedFileBrowserError("MANAGED_FILE_ROOT_UNAVAILABLE", "无法读取托管 Excel 目录");
  }

  const recordByPath = new Map();
  for (const record of records) {
    const relative = slash(record.managed_relative_path);
    if (relative) recordByPath.set(relative, record);
  }
  const files = [];
  await walkExcelFiles(root, rootRealPath, files);
  const items = await Promise.all(files.map(async ({ filename, info }) => {
    const relativePath = slash(path.relative(path.resolve(dataDir), filename));
    const record = recordByPath.get(relativePath) || null;
    const sidecar = await safeRegularFile(`${filename}.sha256`, rootRealPath);
    return {
      filename: path.basename(filename),
      relative_path: relativePath,
      size: Number(info.size || 0),
      modified_at: info.mtime.toISOString(),
      checksum_status: sidecar ? "present" : "missing",
      local_file_status: record ? "recorded" : "orphan",
      backup_record: record ? {
        id: Number(record.id),
        status: String(record.status || ""),
        backup_time: String(record.backup_time || ""),
        created_by_label: String(record.created_by_label || ""),
      } : null,
    };
  }));
  items.sort((a, b) => b.modified_at.localeCompare(a.modified_at) || a.filename.localeCompare(b.filename, "zh-CN"));
  return { root_status: "available", items };
}

async function resolveManagedLocalExcel(dataDir, relativePath) {
  const normalized = normalizedManagedRelativePath(relativePath);
  const root = path.resolve(dataDir, "backups", "full-excel");
  const target = path.resolve(dataDir, ...normalized.split("/"));
  if (!contained(root, target)) throw new ManagedFileBrowserError("MANAGED_FILE_PATH_INVALID", "文件不在托管目录中");
  let rootRealPath;
  try {
    const rootInfo = await fs.promises.lstat(root);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("invalid root");
    rootRealPath = await fs.promises.realpath(root);
  } catch {
    throw new ManagedFileBrowserError("MANAGED_FILE_ROOT_UNAVAILABLE", "托管 Excel 目录不可用");
  }
  const safe = await safeRegularFile(target, rootRealPath);
  if (!safe) throw new ManagedFileBrowserError("MANAGED_FILE_NOT_FOUND", "托管 Excel 文件不存在或路径不安全");
  return { filename: path.basename(target), absolute_path: safe.real, relative_path: normalized };
}

module.exports = {
  MANAGED_RELATIVE_ROOT,
  ManagedFileBrowserError,
  listManagedLocalExcel,
  normalizedManagedRelativePath,
  resolveManagedLocalExcel,
};
