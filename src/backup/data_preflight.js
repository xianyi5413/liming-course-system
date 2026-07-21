const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

class DataPreflightError extends Error {
  constructor(result) {
    super(result.user_message || "完整备份数据预检失败");
    this.name = "DataPreflightError";
    this.code = "BACKUP_DATA_PREFLIGHT_FAILED";
    this.details = { preflight: result };
  }
}

function text(value) { return String(value ?? "").trim(); }
function money(value) { const number = Number(value || 0); return Number.isFinite(number) ? number : 0; }
function validMonth(value) { return MONTH_PATTERN.test(text(value)); }
function validDate(value) { return DATE_PATTERN.test(text(value)); }

function normalizeBusinessMonth(value, { acceptMonthInput = false } = {}) {
  const raw = text(value);
  if (validMonth(raw)) return raw;
  if (acceptMonthInput && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return `${raw}-01`;
  return raw;
}

function runDataPreflight(db, options = {}) {
  const sampleLimit = Math.max(1, Math.min(20, Number(options.sampleLimit || 5)));
  const issues = [];
  const addIssue = (code, label, rows, mapper = (row) => row) => {
    if (!rows.length) return;
    issues.push({ code, label, count: rows.length, records: rows.slice(0, sampleLimit).map(mapper) });
  };
  const all = (sql, ...params) => db.prepare(sql).all(...params);

  addIssue("OPENING_BALANCE_STUDENT_DUPLICATE", "同一学生存在多条期初余额", all(`
    SELECT MIN(id) AS id,student_name,COUNT(*) AS duplicate_count,GROUP_CONCAT(id) AS record_ids
    FROM student_opening_balances
    WHERE TRIM(COALESCE(student_name,''))<>''
    GROUP BY TRIM(student_name)
    HAVING COUNT(*)>1
    ORDER BY student_name
  `), (row) => ({ record_id: Number(row.id), student_name: text(row.student_name), duplicate_count: Number(row.duplicate_count), record_ids: text(row.record_ids), requires_confirmation: true }));

  addIssue("LESSON_DATE_INVALID", "课程日期缺失或格式无效", all("SELECT id,date,teacher_name,grade,subject FROM lessons ORDER BY id").filter((row) => !validDate(row.date)), (row) => ({ record_id: Number(row.id), date: text(row.date), teacher_name: text(row.teacher_name), grade: text(row.grade), subject: text(row.subject) }));
  addIssue("LESSON_TEACHER_MISSING", "课程缺少教师姓名", all("SELECT id,date,grade,subject FROM lessons WHERE teacher_name IS NULL OR TRIM(teacher_name)='' ORDER BY id"), (row) => ({ record_id: Number(row.id), date: text(row.date), grade: text(row.grade), subject: text(row.subject) }));
  addIssue("RECHARGE_DATE_INVALID", "充值日期格式无效", all(`SELECT id,recharge_date,student_name,grade FROM recharge_records
    WHERE COALESCE(cur_recharge,0)<>0 OR COALESCE(cur_gift,0)<>0 ORDER BY id`).filter((row) => text(row.recharge_date) && !validDate(row.recharge_date)), (row) => ({ record_id: Number(row.id), recharge_date: text(row.recharge_date), student_name: text(row.student_name), grade: text(row.grade) }));
  addIssue("RECHARGE_STUDENT_MISSING", "充值记录缺少学生姓名", all(`SELECT id,recharge_date,grade FROM recharge_records
    WHERE (COALESCE(cur_recharge,0)<>0 OR COALESCE(cur_gift,0)<>0) AND (student_name IS NULL OR TRIM(student_name)='') ORDER BY id`), (row) => ({ record_id: Number(row.id), recharge_date: text(row.recharge_date), grade: text(row.grade) }));

  addIssue("STUDENT_NAME_MISSING", "学生档案缺少姓名", all("SELECT id,grade,status FROM students WHERE name IS NULL OR TRIM(name)='' ORDER BY id"), (row) => ({ record_id: Number(row.id), grade: text(row.grade), status: text(row.status) }));
  addIssue("TEACHER_NAME_MISSING", "教师档案缺少姓名", all("SELECT id,status FROM teachers WHERE name IS NULL OR TRIM(name)='' ORDER BY id"), (row) => ({ record_id: Number(row.id), status: text(row.status) }));
  addIssue("STAFF_NAME_MISSING", "员工档案缺少姓名", all("SELECT id,role,status FROM staff WHERE name IS NULL OR TRIM(name)='' ORDER BY id"), (row) => ({ record_id: Number(row.id), role: text(row.role), status: text(row.status) }));

  addIssue("STUDENT_PRICE_KEY_MISSING", "学生单价关键字段缺失", all(`SELECT id,student_name,grade,subject FROM student_pricing
    WHERE student_name IS NULL OR TRIM(student_name)='' OR subject IS NULL OR TRIM(subject)='' OR custom_price IS NULL ORDER BY id`), (row) => ({ record_id: Number(row.id), student_name: text(row.student_name), grade: text(row.grade), subject: text(row.subject) }));
  addIssue("PRICE_STANDARD_KEY_MISSING", "费用标准关键字段缺失", all(`SELECT id,grade,student_count FROM pricing_standards
    WHERE grade IS NULL OR TRIM(grade)='' OR student_count IS NULL OR unit_price IS NULL ORDER BY id`), (row) => ({ record_id: Number(row.id), grade: text(row.grade), student_count: Number(row.student_count || 0) }));
  addIssue("SALARY_RULE_KEY_MISSING", "教师薪资规则关键字段缺失", all(`SELECT id,teacher_name,grade,subject FROM teacher_salary_rules
    WHERE teacher_name IS NULL OR TRIM(teacher_name)='' OR grade IS NULL OR TRIM(grade)='' OR subject IS NULL OR TRIM(subject)='' OR salary_per_unit IS NULL ORDER BY id`), (row) => ({ record_id: Number(row.id), teacher_name: text(row.teacher_name), grade: text(row.grade), subject: text(row.subject) }));
  addIssue("CLASS_GROUP_KEY_MISSING", "班级关键字段缺失", all(`SELECT id,teacher,grade,subject,class_name FROM class_groups
    WHERE teacher IS NULL OR TRIM(teacher)='' OR grade IS NULL OR TRIM(grade)='' OR subject IS NULL OR TRIM(subject)='' ORDER BY id`), (row) => ({ record_id: Number(row.id), teacher: text(row.teacher), grade: text(row.grade), subject: text(row.subject), class_name: text(row.class_name) }));

  addIssue("ACCOUNT_ROLE_INVALID", "账号角色关系无效", all(`SELECT u.id,u.username,u.display_name,u.role FROM users u
    LEFT JOIN roles r ON r.code=u.role WHERE u.status<>'deleted' AND (u.role IS NULL OR TRIM(u.role)='' OR r.code IS NULL) ORDER BY u.id`), (row) => ({ record_id: Number(row.id), username: text(row.username), display_name: text(row.display_name), role: text(row.role) }));
  addIssue("FEE_OVERRIDE_RELATION_INVALID", "单节费用关联课程不存在", all(`SELECT f.lesson_id,f.student_name FROM fee_overrides f
    LEFT JOIN lessons l ON l.id=f.lesson_id WHERE l.id IS NULL ORDER BY f.lesson_id,f.student_name`), (row) => ({ lesson_id: Number(row.lesson_id), student_name: text(row.student_name) }));
  addIssue("STAFF_RELATION_INVALID", "员工薪资或考勤关联无效", all(`SELECT 'salary' AS source,s.id AS record_id,s.staff_id FROM staff_salary_monthly s LEFT JOIN staff f ON f.id=s.staff_id WHERE f.id IS NULL
    UNION ALL SELECT 'attendance',a.id,a.staff_id FROM staff_attendance a LEFT JOIN staff f ON f.id=a.staff_id WHERE f.id IS NULL`), (row) => ({ source: text(row.source), record_id: Number(row.record_id), staff_id: Number(row.staff_id) }));
  addIssue("USER_RELATION_INVALID", "账号权限或教师绑定关系无效", all(`SELECT 'teacher_binding' AS source,b.id AS record_id,b.user_id FROM user_teacher_bindings b LEFT JOIN users u ON u.id=b.user_id WHERE u.id IS NULL
    UNION ALL SELECT 'page_permission',p.rowid,p.user_id FROM user_page_permissions p LEFT JOIN users u ON u.id=p.user_id WHERE u.id IS NULL
    UNION ALL SELECT 'filter_preset',f.rowid,f.user_id FROM user_filter_presets f LEFT JOIN users u ON u.id=f.user_id WHERE u.id IS NULL`), (row) => ({ source: text(row.source), record_id: Number(row.record_id), user_id: Number(row.user_id) }));

  const issueCount = issues.reduce((total, issue) => total + issue.count, 0);
  let userMessage = "完整备份数据预检通过";
  const duplicateOpenings = issues.find((issue) => issue.code === "OPENING_BALANCE_STUDENT_DUPLICATE");
  if (duplicateOpenings) {
    userMessage = `无法创建完整备份：发现${duplicateOpenings.count}名学生存在多条期初余额，请人工确认每名学生唯一的权威记录。`;
  } else if (issueCount) {
    userMessage = `无法创建完整备份：数据完整性预检发现${issueCount}个问题。请查看问题记录并修复后重新检查。`;
  }
  return { ok: issueCount === 0, checked_at_utc: new Date().toISOString(), issue_count: issueCount, issue_types: issues.length, issues, user_message: userMessage };
}

function assertDataPreflight(db, options) {
  const result = runDataPreflight(db, options);
  if (!result.ok) throw new DataPreflightError(result);
  return result;
}

module.exports = {
  MONTH_PATTERN,
  DATE_PATTERN,
  DataPreflightError,
  normalizeBusinessMonth,
  validMonth,
  validDate,
  runDataPreflight,
  assertDataPreflight,
};
