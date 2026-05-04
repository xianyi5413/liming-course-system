const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "liming-local.sqlite");
const exportDir = path.join(dataDir, "exports");

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

if (!fs.existsSync(dbPath)) {
  console.error(`SQLite database not found: ${dbPath}`);
  process.exit(1);
}

fs.mkdirSync(exportDir, { recursive: true });
const db = new DatabaseSync(dbPath);
const tables = db.prepare(`
  SELECT name
  FROM sqlite_schema
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all().map((row) => row.name);

const output = {
  exported_at: new Date().toISOString(),
  source: dbPath,
  tables: {},
};
for (const table of tables) {
  output.tables[table] = db.prepare(`SELECT * FROM "${table}"`).all();
}
db.close();

const target = path.join(exportDir, `sqlite_export_${stamp()}.json`);
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(target);
