const { splitStoredStudents } = require("./teacher_salary_rule");

const STUDENT_EXIT_STATUSES = new Set(["已流出", "已毕业"]);

function normalizedExactName(value) {
  return String(value ?? "").trim();
}

function validLessonDate(value) {
  const date = String(value ?? "").trim();
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? date
    : "";
}

function resolution(found, row, reason) {
  return {
    found: Boolean(found),
    date: found ? row.date : "",
    lesson_id: found ? Number(row.id) : null,
    reason,
  };
}

function latestMatchingLesson(db, predicate) {
  let latest = null;
  for (const row of db.prepare("SELECT id,date,teacher_name,student_names FROM lessons").all()) {
    const date = validLessonDate(row.date);
    if (!date || !predicate(row)) continue;
    if (!latest || date > latest.date || (date === latest.date && Number(row.id) > Number(latest.id))) {
      latest = { id: Number(row.id), date };
    }
  }
  return latest;
}

function resolveTeacherExitDate(db, teacherName) {
  const target = normalizedExactName(teacherName);
  if (!target) return resolution(false, null, "empty_teacher_name");
  const row = latestMatchingLesson(db, (lesson) => normalizedExactName(lesson.teacher_name) === target);
  return row
    ? resolution(true, row, "latest_valid_lesson")
    : resolution(false, null, "no_matching_lesson");
}

function resolveStudentExitDate(db, studentName) {
  const target = normalizedExactName(studentName);
  if (!target) return resolution(false, null, "empty_student_name");
  const row = latestMatchingLesson(db, (lesson) => splitStoredStudents(lesson.student_names).includes(target));
  return row
    ? resolution(true, row, "latest_valid_lesson")
    : resolution(false, null, "no_matching_lesson");
}

function backfillBlankExitDates(db) {
  const report = { teachers_updated: 0, students_updated: 0, teachers_without_lesson: 0, students_without_lesson: 0 };
  const updateTeacher = db.prepare("UPDATE teachers SET left_at=? WHERE id=? AND status='离职' AND TRIM(COALESCE(left_at,''))=''");
  const updateStudent = db.prepare("UPDATE students SET left_at=? WHERE id=? AND status IN ('已流出','已毕业') AND TRIM(COALESCE(left_at,''))=''");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const teacher of db.prepare("SELECT id,name FROM teachers WHERE status='离职' AND TRIM(COALESCE(left_at,''))=''").all()) {
      const result = resolveTeacherExitDate(db, teacher.name);
      if (!result.found) {
        report.teachers_without_lesson += 1;
        continue;
      }
      report.teachers_updated += Number(updateTeacher.run(result.date, teacher.id).changes || 0);
    }
    for (const student of db.prepare("SELECT id,name,status FROM students WHERE status IN ('已流出','已毕业') AND TRIM(COALESCE(left_at,''))=''").all()) {
      if (!STUDENT_EXIT_STATUSES.has(student.status)) continue;
      const result = resolveStudentExitDate(db, student.name);
      if (!result.found) {
        report.students_without_lesson += 1;
        continue;
      }
      report.students_updated += Number(updateStudent.run(result.date, student.id).changes || 0);
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
  return report;
}

module.exports = {
  STUDENT_EXIT_STATUSES,
  backfillBlankExitDates,
  normalizedExactName,
  resolveStudentExitDate,
  resolveTeacherExitDate,
  validLessonDate,
};
