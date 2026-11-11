const crypto = require("node:crypto");
const STATUSES = ["未登记", "出勤", "请假", "缺勤", "停课", "不适用"];
const TABLES = [
  "tg_periods",
  "tg_rules",
  "tg_calendar",
  "tg_attendance",
  "tg_ledger",
  "tg_requests",
  "tg_audit",
  "tg_imports",
];
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function date(value) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value || "") ||
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
  )
    fail("日期无效");
  return value;
}
function cents(value) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > 10000000000)
    fail("金额必须为整数分且不超过一亿元");
  return value;
}
function migrate(db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS tg_periods(id INTEGER PRIMARY KEY,student_id INTEGER NOT NULL REFERENCES students(id),grade TEXT NOT NULL,class_name TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT,status TEXT NOT NULL DEFAULT '在托',notes TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1);
 CREATE INDEX IF NOT EXISTS tg_period_dates ON tg_periods(student_id,start_date,end_date);
 CREATE TABLE IF NOT EXISTS tg_rules(id INTEGER PRIMARY KEY,student_id INTEGER REFERENCES students(id),effective_date TEXT NOT NULL,present INTEGER NOT NULL,leave_fee INTEGER NOT NULL,absent INTEGER NOT NULL,notes TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS tg_calendar(date TEXT PRIMARY KEY,enabled INTEGER NOT NULL,teacher_id INTEGER REFERENCES teachers(id),time_slot TEXT NOT NULL DEFAULT '18:30—21:30',leave_deadline TEXT NOT NULL DEFAULT '17:30',notes TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS tg_attendance(id INTEGER PRIMARY KEY,student_id INTEGER NOT NULL REFERENCES students(id),date TEXT NOT NULL,status TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',grade TEXT NOT NULL,class_name TEXT NOT NULL,rule_json TEXT NOT NULL,fee INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,pending INTEGER NOT NULL DEFAULT 0,UNIQUE(student_id,date));
 CREATE TABLE IF NOT EXISTS tg_ledger(id INTEGER PRIMARY KEY,student_id INTEGER NOT NULL REFERENCES students(id),date TEXT NOT NULL,kind TEXT NOT NULL,amount INTEGER NOT NULL,method TEXT NOT NULL DEFAULT '',voucher TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL,actor TEXT NOT NULL,attendance_id INTEGER REFERENCES tg_attendance(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS tg_ledger_student_date ON tg_ledger(student_id,date);
 CREATE TABLE IF NOT EXISTS tg_requests(key TEXT PRIMARY KEY,payload TEXT NOT NULL,result TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS tg_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS tg_imports(id TEXT PRIMARY KEY,payload TEXT NOT NULL,result TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 `);
}
function createStore(db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p),
    get = (sql, ...p) => db.prepare(sql).get(...p),
    run = (sql, ...p) => db.prepare(sql).run(...p);
  const audit = (actor, action, payload) =>
    run(
      "INSERT INTO tg_audit(actor,action,payload) VALUES (?,?,?)",
      actor,
      action,
      JSON.stringify(payload),
    );
  function atomic(key, payload, fn) {
    if (typeof key !== "string" || key.length < 8 || key.length > 150)
      fail("缺少有效请求编号");
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    db.exec("BEGIN IMMEDIATE");
    try {
      const old = get("SELECT * FROM tg_requests WHERE key=?", key);
      if (old) {
        if (old.payload !== hash) fail("请求编号已用于不同内容", 409);
        db.exec("COMMIT");
        return JSON.parse(old.result);
      }
      const result = fn();
      run(
        "INSERT INTO tg_requests VALUES (?,?,?)",
        key,
        hash,
        JSON.stringify(result),
      );
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function student(id) {
    if (!get("SELECT id FROM students WHERE id=?", id)) fail("学生不存在");
  }
  function rule(id, day) {
    return get(
      "SELECT * FROM tg_rules WHERE (student_id=? OR student_id IS NULL) AND effective_date<=? ORDER BY (student_id IS NOT NULL) DESC,effective_date DESC,id DESC LIMIT 1",
      id,
      day,
    );
  }
  function period(id, day) {
    return get(
      "SELECT * FROM tg_periods WHERE student_id=? AND start_date<=? AND (end_date IS NULL OR end_date>=?) ORDER BY start_date DESC LIMIT 1",
      id,
      day,
      day,
    );
  }
  function attendance(b, actor) {
    date(b.date);
    if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 500)
      fail("请选择1至500名学生");
    if (new Set(b.rows.map((r) => r.student_id)).size !== b.rows.length)
      fail("重复学生");
    if (!get("SELECT date FROM tg_calendar WHERE date=? AND enabled=1", b.date))
      fail("请先在托管日历启用该日期");
    return b.rows.map((r) => {
      if (!STATUSES.includes(r.status)) fail("考勤状态无效");
      const old = get(
        "SELECT * FROM tg_attendance WHERE student_id=? AND date=?",
        r.student_id,
        b.date,
      );
      if ((old?.version || 0) !== r.version)
        fail("记录已被他人修改，请刷新后重试", 409);
      if (old?.pending) fail("历史考勤尚待核对，请先处理导入核对");
      const p = period(r.student_id, b.date);
      if (!p) fail("学生当天不在托管周期内");
      const rules =
        old && Object.hasOwn(JSON.parse(old.rule_json), "present")
          ? JSON.parse(old.rule_json)
          : rule(r.student_id, b.date);
      if (!rules && !["未登记", "停课", "不适用"].includes(r.status))
        fail("当天没有有效收费规则");
      const fee =
        { 出勤: rules?.present, 请假: rules?.leave_fee, 缺勤: rules?.absent }[
          r.status
        ] || 0;
      const notes = String(r.notes || "").slice(0, 2000);
      if (old && old.status === r.status && old.notes === notes) return old;
      if (old)
        run(
          "UPDATE tg_attendance SET status=?,notes=?,fee=?,version=version+1 WHERE id=?",
          r.status,
          notes,
          fee,
          old.id,
        );
      else
        run(
          "INSERT INTO tg_attendance(student_id,date,status,notes,grade,class_name,rule_json,fee) VALUES (?,?,?,?,?,?,?,?)",
          r.student_id,
          b.date,
          r.status,
          notes,
          p.grade,
          p.class_name,
          JSON.stringify(rules || {}),
          fee,
        );
      const saved = get(
        "SELECT * FROM tg_attendance WHERE student_id=? AND date=?",
        r.student_id,
        b.date,
      );
      if (old?.fee)
        run(
          "INSERT INTO tg_ledger(student_id,date,kind,amount,notes,actor,attendance_id) VALUES (?,?,'考勤冲正',?,?,?,?)",
          r.student_id,
          b.date,
          old.fee,
          "更正原考勤",
          actor,
          saved.id,
        );
      if (fee)
        run(
          "INSERT INTO tg_ledger(student_id,date,kind,amount,notes,actor,attendance_id) VALUES (?,?,'考勤扣费',?,?,?,?)",
          r.student_id,
          b.date,
          -fee,
          notes,
          actor,
          saved.id,
        );
      audit(actor, "考勤", { before: old || null, after: saved });
      return saved;
    });
  }
  function mutate(action, b, actor) {
    return atomic(b.request_id, { action, b, actor }, () => {
      let result;
      if (action === "attendance") result = attendance(b, actor);
      else if (action === "resolve") {
        const old = get("SELECT * FROM tg_attendance WHERE id=?", b.id);
        if (!old || !old.pending || old.version !== b.version)
          fail("待核对记录已变更", 409);
        if (!b.notes || !STATUSES.includes(b.status))
          fail("请填写确认状态和核对依据");
        for (const k of ["present", "leave_fee", "absent"])
          if (cents(b[k]) < 0) fail("收费标准不能为负");
        const rules = {
          present: b.present,
          leave_fee: b.leave_fee,
          absent: b.absent,
        };
        const fee =
          { 出勤: b.present, 请假: b.leave_fee, 缺勤: b.absent }[b.status] || 0;
        run(
          "UPDATE tg_attendance SET status=?,notes=?,rule_json=?,fee=?,pending=0,version=version+1 WHERE id=?",
          b.status,
          b.notes,
          JSON.stringify(rules),
          fee,
          b.id,
        );
        if (fee)
          run(
            "INSERT INTO tg_ledger(student_id,date,kind,amount,notes,actor,attendance_id) VALUES (?,?,'考勤扣费',?,?,?,?)",
            old.student_id,
            old.date,
            -fee,
            b.notes,
            actor,
            old.id,
          );
        result = { ok: true };
      } else if (action === "period") {
        student(b.student_id);
        date(b.start_date);
        if (b.end_date) date(b.end_date);
        if (b.end_date && b.end_date < b.start_date)
          fail("退托日期不能早于入托日期");
        if (!b.grade || !b.class_name) fail("请填写年级和班级");
        if (!["在托", "暂停", "退托"].includes(b.status)) fail("托管状态无效");
        if (b.status !== "在托" && !b.end_date)
          fail("暂停或退托需填写最后在托日期；恢复请新增周期");
        const old = b.id
          ? get("SELECT * FROM tg_periods WHERE id=?", b.id)
          : null;
        if (
          b.id &&
          (!old || old.version !== b.version || old.student_id !== b.student_id)
        )
          fail("周期已变更，请刷新", 409);
        if (
          old &&
          all(
            "SELECT date FROM tg_attendance WHERE student_id=? AND date>=? AND date<=?",
            b.student_id,
            old.start_date,
            old.end_date || "9999-12-31",
          ).some(
            (r) =>
              r.date < b.start_date || r.date > (b.end_date || "9999-12-31"),
          )
        )
          fail("新周期范围不能排除已有考勤");
        if (
          get(
            "SELECT id FROM tg_periods WHERE student_id=? AND id!=? AND start_date<=? AND COALESCE(end_date,'9999-12-31')>=?",
            b.student_id,
            b.id || 0,
            b.end_date || "9999-12-31",
            b.start_date,
          )
        )
          fail("托管周期重叠");
        if (old)
          run(
            "UPDATE tg_periods SET grade=?,class_name=?,start_date=?,end_date=?,status=?,notes=?,version=version+1 WHERE id=?",
            b.grade,
            b.class_name,
            b.start_date,
            b.end_date || null,
            b.status,
            b.notes || "",
            b.id,
          );
        else
          run(
            "INSERT INTO tg_periods(student_id,grade,class_name,start_date,end_date,status,notes) VALUES (?,?,?,?,?,?,?)",
            b.student_id,
            b.grade,
            b.class_name,
            b.start_date,
            b.end_date || null,
            b.status,
            b.notes || "",
          );
        result = { ok: true };
      } else if (action === "money") {
        student(b.student_id);
        date(b.date);
        cents(b.amount);
        if (!["充值", "退款", "优惠", "调整", "期初核定"].includes(b.kind))
          fail("资金类型无效");
        if (!b.notes || !b.amount) fail("请填写非零金额及原因/核对依据");
        if (b.kind !== "调整" && b.kind !== "期初核定" && b.amount < 0)
          fail("充值、退款、优惠请填写正金额");
        if (
          b.kind === "期初核定" &&
          get(
            "SELECT id FROM tg_ledger WHERE student_id=? AND kind='期初核定'",
            b.student_id,
          )
        )
          fail("已核定期初，请使用有凭据的调整");
        run(
          "INSERT INTO tg_ledger(student_id,date,kind,amount,method,voucher,notes,actor) VALUES (?,?,?,?,?,?,?,?)",
          b.student_id,
          b.date,
          b.kind,
          b.kind === "退款" ? -b.amount : b.amount,
          b.method || "",
          b.voucher || "",
          b.notes,
          actor,
        );
        result = { ok: true };
      } else if (action === "rule") {
        date(b.effective_date);
        for (const k of ["present", "leave_fee", "absent"])
          if (cents(b[k]) < 0) fail("收费标准不能为负");
        if (b.student_id) student(b.student_id);
        run(
          "INSERT INTO tg_rules(student_id,effective_date,present,leave_fee,absent,notes,created_by) VALUES (?,?,?,?,?,?,?)",
          b.student_id || null,
          b.effective_date,
          b.present,
          b.leave_fee,
          b.absent,
          b.notes || "",
          actor,
        );
        result = { ok: true };
      } else if (action === "calendar") {
        date(b.date);
        const old = get("SELECT * FROM tg_calendar WHERE date=?", b.date);
        if ((old?.version || 0) !== b.version) fail("日历已变更，请刷新", 409);
        if (![0, 1].includes(b.enabled)) fail("日历状态无效");
        if (
          !b.enabled &&
          get(
            "SELECT id FROM tg_attendance WHERE date=? AND status NOT IN ('停课','不适用','未登记')",
            b.date,
          )
        )
          fail("请先更正当日考勤再停用日期");
        run(
          "INSERT INTO tg_calendar(date,enabled,teacher_id,time_slot,leave_deadline,notes) VALUES (?,?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET enabled=excluded.enabled,teacher_id=excluded.teacher_id,time_slot=excluded.time_slot,leave_deadline=excluded.leave_deadline,notes=excluded.notes,version=tg_calendar.version+1",
          b.date,
          b.enabled,
          b.teacher_id || null,
          b.time_slot || "18:30—21:30",
          b.leave_deadline || "17:30",
          b.notes || "",
        );
        result = { ok: true };
      } else fail("不支持的操作", 404);
      audit(actor, action, b);
      return result;
    });
  }
  function snapshot(month, finance) {
    if (!/^\d{4}-\d{2}$/.test(month)) fail("月份无效");
    date(month + "-01");
    const start = month + "-01",
      end = month + "-31";
    const students = all("SELECT id,name,grade FROM students ORDER BY name");
    const periods = all("SELECT * FROM tg_periods ORDER BY start_date DESC");
    const attendance = all(
      "SELECT * FROM tg_attendance WHERE date BETWEEN ? AND ?",
      start,
      end,
    );
    const calendar = all(
      "SELECT * FROM tg_calendar WHERE date BETWEEN ? AND ? ORDER BY date",
      start,
      end,
    );
    const data = {
      students,
      periods,
      calendar,
      attendance: finance
        ? attendance
        : attendance.map(({ fee, rule_json, ...r }) => r),
      teachers: all("SELECT id,name FROM teachers"),
      finance,
    };
    if (finance) {
      data.rules = all(
        "SELECT * FROM tg_rules ORDER BY effective_date DESC,id DESC",
      );
      data.ledger = all(
        "SELECT * FROM tg_ledger WHERE date BETWEEN ? AND ? ORDER BY date DESC,id DESC",
        start,
        end,
      );
      data.imports = all("SELECT * FROM tg_imports");
      data.audit = all("SELECT * FROM tg_audit ORDER BY id DESC LIMIT 300");
      data.summary = students
        .filter((s) => periods.some((p) => p.student_id === s.id))
        .map((s) => {
          const sums = get(
            `SELECT COALESCE(SUM(CASE WHEN date<? THEN amount ELSE 0 END),0) opening,COALESCE(SUM(amount),0) balance,COALESCE(SUM(CASE WHEN date>=? AND kind='充值' THEN amount ELSE 0 END),0) recharge,COALESCE(SUM(CASE WHEN date>=? AND kind='退款' THEN -amount ELSE 0 END),0) refund,COALESCE(SUM(CASE WHEN date>=? AND kind IN ('考勤扣费','考勤冲正') THEN -amount ELSE 0 END),0) fee,COALESCE(SUM(CASE WHEN date>=? AND kind IN ('优惠','调整','期初核定') THEN amount ELSE 0 END),0) adjustment FROM tg_ledger WHERE student_id=? AND date<=?`,
            start,
            start,
            start,
            start,
            start,
            s.id,
            end,
          );
          const unregistered = calendar.filter(
            (c) =>
              c.enabled &&
              period(s.id, c.date) &&
              !attendance.some(
                (a) =>
                  a.student_id === s.id &&
                  a.date === c.date &&
                  a.status !== "未登记",
              ),
          ).length;
          return {
            ...s,
            ...sums,
            unregistered,
            pending: attendance.filter(
              (a) => a.student_id === s.id && a.pending,
            ).length,
          };
        });
    }
    return data;
  }
  return { mutate, snapshot, atomic, audit, all, get, run };
}
module.exports = { STATUSES, TABLES, migrate, createStore, date, cents, fail };
