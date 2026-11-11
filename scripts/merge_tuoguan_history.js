// Deliberately limited to a verified pending-history snapshot and an empty custody
// namespace (or an exact replay). Never replaces a database or guesses identities.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const { TABLES } = require('../src/domain/tuoguan_schema');
const quote = name => '"' + name.replaceAll('"', '""') + '"';
function rows(db, table) { return db.prepare(`SELECT * FROM ${quote(table)} ORDER BY rowid`).all(); }
function fingerprint(db) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name}) => {
    const data = rows(db, name);
    return [name, { count: data.length, sha256: crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex') }];
  }));
}
function check(db) {
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('DATABASE_INTEGRITY_FAILED');
}
function plan(source, target) {
  check(source); check(target);
  for (const table of TABLES) {
    for (const pragma of ['table_info', 'foreign_key_list', 'index_list']) {
      if (JSON.stringify(source.prepare(`PRAGMA ${pragma}(${table})`).all()) !== JSON.stringify(target.prepare(`PRAGMA ${pragma}(${table})`).all())) throw Error(`SCHEMA_MISMATCH: ${table}`);
    }
  }
  if (rows(source, 'tg_ledger').length || rows(source, 'tg_legacy_student_map').length || source.prepare('SELECT 1 FROM tg_attendance WHERE pending<>1 OR fee<>0 OR source_import_id IS NULL LIMIT 1').get() || source.prepare('SELECT 1 FROM tg_calendar WHERE teacher_id IS NOT NULL LIMIT 1').get()) throw Error('SOURCE_NOT_PENDING_HISTORY');
  const data = Object.fromEntries(TABLES.map(t => [t, rows(source, t)]));
  if (!data.tg_imports.length || !data.tg_students.length) throw Error('SOURCE_HISTORY_EMPTY');
  const empty = TABLES.every(t => rows(target, t).length === 0);
  // Exact source rows may coexist with later target additions; never overwrite them.
  const same = TABLES.every(t => {
    const primary = target.prepare(`PRAGMA table_info(${t})`).all().find(c => c.pk)?.name;
    return data[t].every(row => JSON.stringify(target.prepare(`SELECT * FROM ${t} WHERE ${quote(primary)}=?`).get(row[primary])) === JSON.stringify(row));
  });
  if (!empty && !same) throw Error('TARGET_CUSTODY_CONFLICT: preserve existing data; explicit identity/ID reconciliation required');
  return { data, result: { action: same ? 'already_present' : 'insert', counts: Object.fromEntries(TABLES.map(t => [t, data[t].length])), months: source.prepare("SELECT substr(date,1,7) month,count(*) attendance,count(distinct student_id) students,sum(pending) pending,sum(fee) posted,sum(reference_fee) reference FROM tg_attendance GROUP BY 1").all() } };
}
async function mergeHistory({sourcePath, targetPath, backupDir, apply = false}) {
  sourcePath = fs.realpathSync(sourcePath); targetPath = fs.realpathSync(targetPath);
  if (sourcePath.toLowerCase() === targetPath.toLowerCase()) throw Error('SOURCE_EQUALS_TARGET');
  let source = new DatabaseSync(sourcePath, {readOnly:true});
  let target = new DatabaseSync(targetPath, {readOnly:true});
  try {
    const preview = plan(source, target).result;
    if (!apply || preview.action === 'already_present') return { ...preview, applied:false };
    if (!backupDir) throw Error('BACKUP_DIRECTORY_REQUIRED');
    fs.mkdirSync(backupDir, {recursive:true});
    const dir = fs.mkdtempSync(path.join(path.resolve(backupDir), 'history-'));
    const sourceBackup = path.join(dir, 'source.sqlite'), targetBackup = path.join(dir, 'target-before.sqlite');
    await backup(source, sourceBackup); await backup(target, targetBackup);
    source.close(); source = new DatabaseSync(sourceBackup, {readOnly:true});
    target.close(); target = new DatabaseSync(targetBackup, {readOnly:true});
    check(source); check(target);
    const before = fingerprint(target);
    target.close(); target = new DatabaseSync(targetPath);
    target.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    try {
      if (JSON.stringify(fingerprint(target)) !== JSON.stringify(before)) throw Error('TARGET_CHANGED_SINCE_BACKUP: retry after reviewing concurrent writes');
      const {data, result} = plan(source, target);
      for (const table of TABLES) {
        if (!data[table].length) continue;
        const columns = Object.keys(data[table][0]);
        const insert = target.prepare(`INSERT INTO ${table} (${columns.map(quote)}) VALUES (${columns.map(() => '?')})`);
        for (const row of data[table]) insert.run(...columns.map(c => row[c]));
      }
      check(target);
      const after = fingerprint(target);
      for (const t of Object.keys(before).filter(t => !TABLES.includes(t))) if (JSON.stringify(before[t]) !== JSON.stringify(after[t])) throw Error(`PROTECTED_TABLE_CHANGED: ${t}`);
      if (plan(source, target).result.action !== 'already_present') throw Error('COPY_VERIFICATION_FAILED');
      const report = { ...result, applied:true, sourcePath, targetPath, sourceBackup, targetBackup, before, after, protectedTables:Object.keys(before).filter(t => !TABLES.includes(t)).length };
      // Report is prepared before commit; only returned success confirms completion.
      fs.writeFileSync(path.join(dir, 'verification-private.json'), JSON.stringify({...report, status:'prepared'}, null, 2), {mode:0o600});
      target.exec('COMMIT');
      try { fs.writeFileSync(path.join(dir, 'verification-private.json'), JSON.stringify({...report, status:'committed'}, null, 2), {mode:0o600}); }
      catch { report.warning = 'Committed; report status could not be refreshed. Verify live rows against source snapshot.'; }
      return report;
    } catch (error) { target.exec('ROLLBACK'); throw error; }
  } finally { source.close(); target.close(); }
}
if (require.main === module) {
  const args = process.argv.slice(2), value = key => args[args.indexOf(key)+1];
  if (!args.includes('--source') || !args.includes('--target')) {
    console.error('Usage: node scripts/merge_tuoguan_history.js --source <sqlite> --target <sqlite> [--apply --backup-dir <private-directory>]');
    process.exitCode = 1;
  } else mergeHistory({sourcePath:value('--source'), targetPath:value('--target'), backupDir:args.includes('--backup-dir') ? value('--backup-dir') : undefined, apply:args.includes('--apply')}).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {console.error(error.message); process.exitCode=1;});
}
module.exports = {mergeHistory, fingerprint};
