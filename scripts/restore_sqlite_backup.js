const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "liming-local.sqlite");
const backupArg = process.argv[2];

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

if (!backupArg) {
  console.error("Usage: node scripts/restore_sqlite_backup.js data/backups/manual_YYYYMMDDHHMMSS.sqlite");
  process.exit(1);
}

const backupPath = path.resolve(rootDir, backupArg);
if (!backupPath.startsWith(path.join(dataDir, "backups"))) {
  console.error("Refusing to restore from outside data/backups.");
  process.exit(1);
}
if (!fs.existsSync(backupPath)) {
  console.error(`Backup not found: ${backupPath}`);
  process.exit(1);
}

fs.mkdirSync(path.join(dataDir, "backups"), { recursive: true });
if (fs.existsSync(dbPath)) {
  const safety = path.join(dataDir, "backups", `pre_restore_${stamp()}.sqlite`);
  fs.copyFileSync(dbPath, safety);
  console.log(`Current database copied to ${safety}`);
}

for (const suffix of ["", "-wal", "-shm"]) {
  const file = `${dbPath}${suffix}`;
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}
fs.copyFileSync(backupPath, dbPath);
console.log(`Restored ${backupPath} -> ${dbPath}`);
