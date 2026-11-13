const Config = require("../../public/tuoguan_config");
const pages = ["tgAttendance", ...Config.management];
function migrate(db) {
  db.exec("SAVEPOINT custody_permissions");
  try {
    for (const [table, owner] of [
      ["role_permissions", "role_code"],
      ["user_page_permissions", "user_id"],
    ]) {
      if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name=?").get(table))
        continue;
      for (const row of db
        .prepare(`SELECT * FROM ${table} WHERE permission_key='tgFinance'`)
        .all()) {
        for (const key of Config.management)
          db.prepare(
            `INSERT INTO ${table}(${owner},permission_key,enabled) VALUES(?,?,?) ON CONFLICT(${owner},permission_key) DO UPDATE SET enabled=MAX(enabled,excluded.enabled)`,
          ).run(row[owner], key, row.enabled);
      }
      db.exec(`DELETE FROM ${table} WHERE permission_key='tgFinance'`);
    }
    db.exec("RELEASE custody_permissions");
  } catch (error) {
    db.exec("ROLLBACK TO custody_permissions; RELEASE custody_permissions");
    throw error;
  }
}
module.exports = { pages, migrate, expand: Config.permissions };
