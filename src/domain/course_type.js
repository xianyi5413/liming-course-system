const { splitStoredStudents } = require('./teacher_salary_rule');

const COURSE_TYPE_GRADES = Object.freeze({ 初一: 'junior', 初二: 'junior', 初三: 'junior', 高一: 'senior', 高二: 'senior', 高三: 'senior' });
const COURSE_TYPE_DEFAULTS = Object.freeze({ junior: ['1V1', '1V2', '小班课'], senior: ['1V1', '1V2', '1V3', '小班课'] });
function defaultCourseType(grade, students) {
  const scope = COURSE_TYPE_GRADES[String(grade || '').trim()];
  const count = new Set(splitStoredStudents(students)).size;
  if (!scope || !count) return '';
  return count <= (scope === 'junior' ? 2 : 3) ? `1V${count}` : '小班课';
}
function courseTypeOptions(grade, settings = {}) {
  const scope = COURSE_TYPE_GRADES[String(grade || '').trim()];
  if (!scope) return [];
  let custom = settings[`custom_course_types_${scope}`] || [];
  if (typeof custom === 'string') { try { custom = JSON.parse(custom); } catch { custom = []; } }
  return [...new Set([...COURSE_TYPE_DEFAULTS[scope], ...(Array.isArray(custom) ? custom : [])].map(v => String(v).trim()).filter(Boolean))];
}
function migrateCourseTypes(db, { backfill = true } = {}) {
  const report = { lessons: 0, class_groups: 0 };
  db.exec('SAVEPOINT course_types_migration');
  try {
    for (const [table, students] of [['lessons', 'student_names'], ['class_groups', 'students_key']]) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'course_type')) db.exec(`ALTER TABLE ${table} ADD COLUMN course_type TEXT DEFAULT ''`);
      if (!backfill) continue;
      const update = db.prepare(`UPDATE ${table} SET course_type=? WHERE id=? AND TRIM(COALESCE(course_type,''))=''`);
      for (const row of db.prepare(`SELECT id,grade,${students} AS students FROM ${table} WHERE TRIM(COALESCE(course_type,''))=''`).all()) {
        const value = defaultCourseType(row.grade, row.students);
        if (value) report[table] += Number(update.run(value, row.id).changes);
      }
    }
    db.exec('RELEASE course_types_migration');
    return report;
  } catch (error) { db.exec('ROLLBACK TO course_types_migration; RELEASE course_types_migration'); throw error; }
}
module.exports = { COURSE_TYPE_GRADES, COURSE_TYPE_DEFAULTS, defaultCourseType, courseTypeOptions, migrateCourseTypes };
