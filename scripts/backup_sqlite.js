const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "liming-local.sqlite");
const backupDir = path.join(dataDir, "backups");

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

if (!fs.existsSync(dbPath)) {
  console.error(`SQLite database not found: ${dbPath}`);
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });
const target = path.join(backupDir, `manual_${stamp()}.sqlite`);
const db = new DatabaseSync(dbPath);
try {
  db.exec("PRAGMA wal_checkpoint(FULL)");
  db.exec(`VACUUM INTO ${sqlQuote(target)}`);
} finally {
  db.close();
}

const manifest = {
  created_at: new Date().toISOString(),
  source: dbPath,
  backup: target,
};
fs.writeFileSync(`${target}.json`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(target);
