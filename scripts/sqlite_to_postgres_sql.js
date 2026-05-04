const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "liming-local.sqlite");
const migrationDir = path.join(dataDir, "migrations");

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function ident(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sqlValue(value) {
  if (value == null) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function pgType(sqliteType, pk) {
  const raw = String(sqliteType || "").toUpperCase();
  if (pk && raw.includes("INT")) return "BIGINT";
  if (raw.includes("INT")) return "BIGINT";
  if (raw.includes("REAL") || raw.includes("FLOA") || raw.includes("DOUB")) return "DOUBLE PRECISION";
  return "TEXT";
}

if (!fs.existsSync(dbPath)) {
  console.error(`SQLite database not found: ${dbPath}`);
  process.exit(1);
}

fs.mkdirSync(migrationDir, { recursive: true });
const db = new DatabaseSync(dbPath);
const tables = db.prepare(`
  SELECT name
  FROM sqlite_schema
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all().map((row) => row.name);

const lines = [
  "-- Generated from SQLite. Review constraints/indexes before production import.",
  "BEGIN;",
];

for (const table of tables) {
  const columns = db.prepare(`PRAGMA table_info(${ident(table)})`).all();
  lines.push("", `DROP TABLE IF EXISTS ${ident(table)} CASCADE;`);
  lines.push(`CREATE TABLE ${ident(table)} (`);
  lines.push(columns.map((column) => {
    const parts = [`  ${ident(column.name)}`, pgType(column.type, column.pk)];
    if (column.pk) parts.push("PRIMARY KEY");
    if (column.notnull) parts.push("NOT NULL");
    return parts.join(" ");
  }).join(",\n"));
  lines.push(");");

  const rows = db.prepare(`SELECT * FROM ${ident(table)}`).all();
  if (!rows.length) continue;
  const columnNames = columns.map((column) => column.name);
  for (const row of rows) {
    lines.push(`INSERT INTO ${ident(table)} (${columnNames.map(ident).join(", ")}) VALUES (${columnNames.map((name) => sqlValue(row[name])).join(", ")});`);
  }
}

lines.push("", "COMMIT;", "");
db.close();

const target = path.join(migrationDir, `postgres_import_${stamp()}.sql`);
fs.writeFileSync(target, lines.join("\n"), "utf8");
console.log(target);
