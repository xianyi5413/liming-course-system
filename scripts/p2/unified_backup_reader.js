"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { ERROR_CODES, P2Error } = require("./errors");
const { safeErrorMessage } = require("./model");
const { pageOptions } = require("./repository");
const { tableExists } = require("./migrations");

function sortTime(value) {
  if (!value) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const milliseconds = new Date(normalized).getTime();
  return Number.isNaN(milliseconds) ? 0 : milliseconds;
}

function legacyBasename(value) {
  return String(value || "").split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
}

function scanLegacySqliteSnapshots(directory) {
  const summary = { count: 0, size: 0, latest_modified_at: null };
  try {
    if (!directory || !fs.existsSync(directory)) return summary;
    const root = path.resolve(directory);
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return summary;
    const pending = [root];
    let latest = 0;
    while (pending.length) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const candidate = path.join(current, entry.name);
        const stat = fs.lstatSync(candidate);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          pending.push(candidate);
          continue;
        }
        const lower = entry.name.toLowerCase();
        if (!stat.isFile() || !lower.endsWith(".sqlite") || lower.endsWith("-wal") || lower.endsWith("-shm")) continue;
        summary.count += 1;
        summary.size += stat.size;
        latest = Math.max(latest, stat.mtimeMs);
      }
    }
    summary.latest_modified_at = latest ? new Date(latest).toISOString() : null;
    return summary;
  } catch (error) {
    throw new P2Error(ERROR_CODES.LEGACY_READ_FAILED, "Legacy SQLite snapshot summary could not be read", { cause: error });
  }
}

class UnifiedBackupReader {
  constructor(database, options = {}) {
    this.database = database;
    this.legacyBackupDirectory = options.legacyBackupDirectory || null;
  }

  _systemBackups() {
    if (!tableExists(this.database, "backup_sets")) return [];
    return this.database.prepare("SELECT * FROM backup_sets ORDER BY created_at DESC, id DESC").all().map((row) => ({
      kind: "system_full",
      source: "backup_sets",
      id: `system:${row.backup_id}`,
      backup_id: row.backup_id,
      backup_type: row.backup_type,
      trigger: row.trigger,
      status: row.status,
      verification_status: row.verification_status,
      created_at: row.created_at,
      completed_at: row.completed_at,
      size: row.package_size,
      package_filename: row.package_filename,
      pinned: Boolean(row.pinned),
      note: row.note,
      warning_count: Number(row.warning_count),
    }));
  }

  _legacyArchives() {
    if (!tableExists(this.database, "backup_records")) return [];
    try {
      return this.database.prepare(`
        SELECT id, backup_time, backup_type, included_months, filename, file_size, status, message, scheduled_date, created_at
        FROM backup_records
        ORDER BY backup_time DESC, id DESC
      `).all().map((row) => ({
        kind: "legacy_business_archive",
        source: "backup_records",
        id: `legacy:${row.id}`,
        backup_type: "legacy_business_archive",
        legacy_backup_type: row.backup_type || "unknown",
        status: row.status === "success" ? "available" : "failed",
        verification_status: "not_applicable",
        created_at: row.backup_time || row.created_at || null,
        scheduled_date: row.scheduled_date || null,
        included_months: Number(row.included_months || 0),
        size: Number(row.file_size || 0),
        filename: legacyBasename(row.filename),
        message_safe: safeErrorMessage(row.message),
      }));
    } catch (error) {
      throw new P2Error(ERROR_CODES.LEGACY_READ_FAILED, "Legacy backup records could not be read", { cause: error });
    }
  }

  list(options = {}) {
    const { page, pageSize, offset } = pageOptions(options);
    const system = this._systemBackups();
    const legacy = this._legacyArchives();
    const snapshot = scanLegacySqliteSnapshots(this.legacyBackupDirectory);
    const snapshots = snapshot.count ? [{
      kind: "legacy_sqlite_snapshot_summary",
      source: "legacy_files_summary",
      id: "legacy-sqlite-snapshots",
      backup_type: "legacy_sqlite_snapshot_summary",
      status: "preserved_unmanaged",
      verification_status: "not_applicable",
      created_at: snapshot.latest_modified_at,
      count: snapshot.count,
      size: snapshot.size,
    }] : [];
    const combined = [...system, ...legacy, ...snapshots].sort((left, right) => {
      const byTime = sortTime(right.created_at) - sortTime(left.created_at);
      return byTime || String(left.id).localeCompare(String(right.id), "en");
    });
    return {
      items: combined.slice(offset, offset + pageSize),
      total: combined.length,
      page,
      page_size: pageSize,
      counts: {
        system_full: system.length,
        legacy_business_archive: legacy.length,
        legacy_sqlite_snapshot_summary: snapshot.count,
      },
    };
  }
}

module.exports = { UnifiedBackupReader, legacyBasename, scanLegacySqliteSnapshots, sortTime };
