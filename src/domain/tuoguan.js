const crypto = require("node:crypto");
const STATUSES = ["出勤", "请假", "放假", "不适用"];
const HISTORY_STATUSES = [...STATUSES, "未登记", "缺勤", "停课"];
const GRADES = ["初一", "初二", "初三"];
const { TABLES, PROFILE_STATUSES, migrate } = require("./tuoguan_schema");
const Billing = require("./tuoguan_settlement");
const Protection = require("./tuoguan_protection");
const { account: custodyAccount } = require("./tuoguan_account");
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function date(value) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value || "") ||
    !Number.isFinite(Date.parse(value + "T00:00:00Z")) ||
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
    if (!get("SELECT id FROM tg_students WHERE id=?", id))
      fail("托管学生不存在");
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
    const calendar = get("SELECT * FROM tg_calendar WHERE date=?", b.date);
    if (
      calendar?.enabled === 0 ||
      (!calendar && new Date(b.date + "T00:00:00Z").getUTCDay() === 6)
    )
      fail("请先添加该日期");
    if (!calendar)
      run("INSERT INTO tg_calendar(date,enabled) VALUES (?,1)", b.date);
    return b.rows.map((r) => {
      if (!STATUSES.includes(r.status)) fail("考勤状态无效");
      const old = get(
        "SELECT * FROM tg_attendance WHERE student_id=? AND date=?",
        r.student_id,
        b.date,
      );
      if ((old?.version || 0) !== r.version)
        fail("记录已被他人修改，请刷新后重试", 409);
      const p = period(r.student_id, b.date);
      if (!p) fail("学生当天不在托管周期内");
      const notes = String(r.notes ?? old?.notes ?? "").slice(0, 2000);
      if (old && (old.status !== r.status || old.notes !== notes))
        run(
          "UPDATE tg_attendance SET status=?,notes=?,version=version+1 WHERE id=?",
          r.status,
          notes,
          old.id,
        );
      else if (!old)
        run(
          "INSERT INTO tg_attendance(student_id,date,status,notes,grade,rule_json,fee) VALUES (?,?,?,?,?,'{}',0)",
          r.student_id,
          b.date,
          r.status,
          notes,
          p.grade,
        );
      const current = get(
        "SELECT * FROM tg_attendance WHERE student_id=? AND date=?",
        r.student_id,
        b.date,
      );
      const settlement = Billing.settle(db, actor, {
        attendance: [current],
        bumpVersion: !!old && current.version === old.version,
        reason: "考勤自动结算",
      });
      const saved = get("SELECT * FROM tg_attendance WHERE id=?", current.id);
      if (old && current.version === old.version && !settlement.updated)
        return old;
      audit(actor, "考勤", { before: old || null, after: saved });
      return saved;
    });
  }
  // mutate() owns the single transaction, including every date and settlement.
  function batchAttendance(b, actor) {
    const { start, end } = require("./tuoguan_calendar").bounds(b.month);
    if (!STATUSES.includes(b.status)) fail("考勤状态无效");
    if (!Array.isArray(b.cells) || !b.cells.length || b.cells.length > 15500)
      fail("请选择1至15500个考勤单元格");
    const seen = new Set(),
      grouped = new Map();
    for (const cell of b.cells) {
      if (
        !cell ||
        !Number.isSafeInteger(cell.student_id) ||
        cell.student_id <= 0 ||
        !Number.isSafeInteger(cell.version) ||
        cell.version < 0
      )
        fail("考勤目标或版本无效");
      date(cell.date);
      if (cell.date < start || cell.date > end) fail("批量修改不能跨月份");
      const key = cell.student_id + ":" + cell.date;
      if (seen.has(key)) fail("重复考勤单元格");
      seen.add(key);
      if (!grouped.has(cell.date)) grouped.set(cell.date, []);
      grouped
        .get(cell.date)
        .push({
          student_id: cell.student_id,
          version: cell.version,
          status: b.status,
        });
    }
    return [...grouped]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([date, rows]) => attendance({ date, rows }, actor));
  }
  function savePeriod(b) {
    student(b.student_id);
    date(b.start_date);
    if (b.end_date) date(b.end_date);
    if (b.end_date && b.end_date < b.start_date)
      fail("退托日期不能早于入托日期");
    if (!GRADES.includes(b.grade)) fail("年级仅支持初一、初二、初三");
    if (!["在托", "暂停", "退托"].includes(b.status)) fail("托管状态无效");
    if (b.status !== "在托" && !b.end_date)
      fail("暂停或退托需填写最后在托日期；恢复请新增周期");
    const old = b.id ? get("SELECT * FROM tg_periods WHERE id=?", b.id) : null;
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
        (r) => r.date < b.start_date || r.date > (b.end_date || "9999-12-31"),
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
        "UPDATE tg_periods SET grade=?,start_date=?,end_date=?,status=?,notes=?,version=version+1 WHERE id=?",
        b.grade,
        b.start_date,
        b.end_date || null,
        b.status,
        b.notes || "",
        b.id,
      );
    else
      run(
        "INSERT INTO tg_periods(student_id,grade,start_date,end_date,status,notes,default_status) VALUES (?,?,?,?,?,?,?)",
        b.student_id,
        b.grade,
        b.start_date,
        b.end_date || null,
        b.status,
        b.notes || "",
        b.default_status || "出勤",
      );
  }
  function matrixChange(action, b) {
    const { start, end, previous, next } = require("./tuoguan_calendar").bounds(
      b.month,
    );
    const protection = Protection.snapshot(db, start, end);
    if (action === "remove-students") {
      if (
        !Array.isArray(b.students) ||
        !b.students.length ||
        b.students.length > 500
      )
        fail("请选择学生");
      for (const item of b.students) {
        student(item.id);
        if (protection.protected_student_reasons[item.id])
          fail(protection.protected_student_reasons[item.id]);
        const rows = all(
          "SELECT * FROM tg_periods WHERE student_id=? AND start_date<=? AND COALESCE(end_date,'9999-12-31')>=? ORDER BY id",
          item.id,
          end,
          start,
        );
        if (
          JSON.stringify(rows.map((p) => [p.id, p.version])) !==
          JSON.stringify(item.versions)
        )
          fail("参与范围已变化，请刷新", 409);
        for (const p of rows) {
          const before = p.start_date < start,
            after = !p.end_date || p.end_date > end;
          if (before)
            run(
              "UPDATE tg_periods SET end_date=?,version=version+1 WHERE id=?",
              previous,
              p.id,
            );
          else if (after)
            run(
              "UPDATE tg_periods SET start_date=?,version=version+1 WHERE id=?",
              next,
              p.id,
            );
          else {
            run(
              "UPDATE tg_transfer_keys SET row_key='removed:'||uid WHERE table_name=? AND row_key=?",
              "tg_periods",
              String(p.id),
            );
            run("DELETE FROM tg_periods WHERE id=?", p.id);
          }
          if (before && after)
            run(
              "INSERT INTO tg_periods(student_id,grade,start_date,end_date,status,notes,default_status) VALUES (?,?,?,?,?,?,?)",
              p.student_id,
              p.grade,
              next,
              p.end_date,
              p.status,
              p.notes,
              p.default_status,
            );
        }
      }
    } else {
      if (!Array.isArray(b.dates) || !b.dates.length || b.dates.length > 31)
        fail("请选择日期");
      if (new Set(b.dates.map((r) => r.date)).size !== b.dates.length)
        fail("日期重复");
      for (const item of b.dates) {
        date(item.date);
        if (item.date < start || item.date > end) fail("只能操作当前月份日期");
        const old = get("SELECT * FROM tg_calendar WHERE date=?", item.date);
        if ((old?.version || 0) !== item.version)
          fail("日期已变化，请刷新", 409);
        if (
          action === "remove-dates" &&
          protection.protected_date_reasons[item.date]
        )
          fail(protection.protected_date_reasons[item.date]);
        if (
          action === "add-dates" &&
          (old?.enabled === 1 ||
            (!old && new Date(item.date + "T00:00:00Z").getUTCDay() !== 6))
        )
          fail("日期已在矩阵中");
        run(
          "INSERT INTO tg_calendar(date,enabled) VALUES (?,?) ON CONFLICT(date) DO UPDATE SET enabled=excluded.enabled,version=tg_calendar.version+1",
          item.date,
          action === "add-dates" ? 1 : 0,
        );
      }
    }
    return {
      ok: true,
      ...(action === "remove-students"
        ? participationSnapshot(b.month)
        : calendarSnapshot(b.month)),
    };
  }
  function money(b, actor, replacesId = null) {
    student(b.student_id);
    date(b.date);
    const split = b.actual_amount !== undefined || b.gift_amount !== undefined;
    const actual = split ? cents(b.actual_amount) : cents(b.amount),
      gift = split ? cents(b.gift_amount) : 0;
    const amount = cents(actual + gift);
    if (!["充值", "退款", "优惠", "调整", "期初核定"].includes(b.kind))
      fail("资金类型无效");
    if (!actual && !gift) fail("实际金额或赠送金额至少一项非零");
    if (!["充值", "退款"].includes(b.kind) && !b.notes)
      fail("历史资金调整请填写核对依据");
    if (b.kind !== "调整" && b.kind !== "期初核定" && (actual < 0 || gift < 0))
      fail("充值、退款、优惠请填写正金额");
    if (b.kind === "退款") {
      const balance = custodyAccount(
        all(
          "SELECT * FROM tg_ledger WHERE student_id=? AND date<=?",
          b.student_id,
          b.date,
        ),
        b.date.slice(0, 7),
        b.date,
      );
      if (
        actual > Math.max(0, balance.actual_balance) ||
        gift > balance.gift_balance
      )
        fail("退款不能超过对应的实际或赠送余额");
    }
    if (
      b.kind === "期初核定" &&
      get(
        "SELECT id FROM tg_ledger WHERE student_id=? AND kind='期初核定'",
        b.student_id,
      )
    )
      fail("已核定期初，请使用有凭据的调整");
    const inserted = run(
      "INSERT INTO tg_ledger(student_id,date,kind,amount,method,voucher,notes,actor,actual_amount,gift_amount,replaces_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      b.student_id,
      b.date,
      b.kind,
      b.kind === "退款" ? -amount : amount,
      b.method || "",
      b.voucher || "",
      String(b.notes || "").slice(0, 2000),
      actor,
      (b.kind === "退款" ? -1 : 1) * actual,
      (b.kind === "退款" ? -1 : 1) * gift,
      replacesId,
    );

    return get(
      "SELECT * FROM tg_ledger WHERE id=?",
      Number(inserted.lastInsertRowid),
    );
  }
  function mutate(action, b, actor) {
    return atomic(b.request_id, { action, b, actor }, () => {
      let result;
      if (["remove-students", "add-dates", "remove-dates"].includes(action))
        result = matrixChange(action, b);
      else if (action === "student") {
        const name = String(b.name || "").trim(),
          grade = String(b.grade || "").trim();
        if (!name || name.length > 80 || !GRADES.includes(grade))
          fail("请填写姓名并选择初一、初二或初三");
        const notes = String(b.notes || "").slice(0, 2000);
        if (b.status !== undefined && !PROFILE_STATUSES.includes(b.status))
          fail("档案状态无效");
        let id;
        if (b.id) {
          const old = get("SELECT * FROM tg_students WHERE id=?", b.id);
          if (!old || old.version !== b.version)
            fail("托管档案已变更，请刷新", 409);
          run(
            "UPDATE tg_students SET name=?,grade=?,notes=?,status=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
            name,
            grade,
            notes,
            b.status ?? old.status,
            b.id,
          );
          id = b.id;
        } else {
          if (b.month) {
            const names = all(
              "SELECT grade,notes FROM tg_students WHERE name=?",
              name,
            );
            if (
              names.length &&
              (!b.confirm_same_name ||
                !notes ||
                names.some((r) => r.grade === grade && r.notes === notes))
            )
              fail(
                "已有同名托管档案，请选择已有学生；确为不同学生时填写可辨认备注并确认同名新建",
                409,
              );
          }
          id = Number(
            run(
              "INSERT INTO tg_students(name,grade,notes,status) VALUES (?,?,?,?)",
              name,
              grade,
              notes,
              b.status || "在托",
            ).lastInsertRowid,
          );
          if (b.month) {
            const { start, end } = require("./tuoguan_calendar").bounds(
              b.month,
            );
            if (b.status && b.status !== "在托") fail("新建学生默认在托");
            savePeriod({
              student_id: id,
              grade,
              start_date: start,
              end_date: end,
              status: "在托",
              default_status: "不适用",
            });
          } else if (b.start_date)
            savePeriod({
              student_id: id,
              grade,
              start_date: b.start_date,
              status: "在托",
              notes,
            });
        }
        result = b.month
          ? {
              ok: true,
              student: get("SELECT * FROM tg_students WHERE id=?", id),
              ...participationSnapshot(b.month),
            }
          : get("SELECT * FROM tg_students WHERE id=?", id);
      } else if (action === "attendance") result = attendance(b, actor);
      else if (action === "batch-attendance")
        result = batchAttendance(b, actor);
      else if (action === "period") {
        if (b.month) {
          const { start, end } = require("./tuoguan_calendar").bounds(b.month);
          const profile = get(
            "SELECT * FROM tg_students WHERE id=?",
            b.student_id,
          );
          if (!profile || profile.version !== b.student_version)
            fail("档案已变化，请刷新", 409);
          if (profile.status !== "在托")
            fail("请先在托管学生中将档案状态改为在托");
          if (
            get(
              "SELECT id FROM tg_periods WHERE student_id=? AND start_date<=? AND COALESCE(end_date,'9999-12-31')>=?",
              b.student_id,
              end,
              start,
            )
          )
            fail("学生已加入本月，请刷新", 409);
          savePeriod({
            student_id: b.student_id,
            grade: profile.grade,
            start_date: start,
            end_date: end,
            status: "在托",
            default_status: "不适用",
          });
          result = { ok: true, ...participationSnapshot(b.month) };
        } else {
          savePeriod(b);
          result = { ok: true };
        }
      } else if (action === "money") {
        money(b, actor);
        result = { ok: true };
      } else if (["money-edit", "money-delete"].includes(action)) {
        result = require("./tuoguan_money").change(
          db,
          action,
          b,
          actor,
          (values, replacesId) => money(values, actor, replacesId),
        );
      } else if (action === "rule") {
        date(b.effective_date);
        if (
          b.present !== Billing.RULE.present ||
          b.leave_fee !== Billing.RULE.leave_fee
        )
          fail("当前统一标准为出勤50元、请假25元");
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
        if (!b.enabled) {
          const reason = Protection.snapshot(db, b.date, b.date)
            .protected_date_reasons[b.date];
          if (reason) fail(reason);
        }
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
      if (!["money-edit", "money-delete"].includes(action))
        audit(actor, action, b);
      return result;
    });
  }
  function participationSnapshot(month) {
    const { start, end } = require("./tuoguan_calendar").bounds(month);
    const { protected_students, protected_student_reasons } =
      Protection.snapshot(db, start, end);
    return {
      students: all("SELECT * FROM tg_students ORDER BY id"),
      periods: all("SELECT * FROM tg_periods ORDER BY start_date DESC,id"),
      protected_students,
      protected_student_reasons,
    };
  }
  function ledgerSnapshot(month, start, end) {
    const bounds = require("./tuoguan_calendar").bounds(month);
    start = start || bounds.start;
    end = end || bounds.end;
    date(start);
    date(end);
    if (start > end) fail("起始日期不能晚于截止日期");
    return {
      finance: true,
      students: all("SELECT * FROM tg_students ORDER BY id"),
      periods: all("SELECT * FROM tg_periods ORDER BY start_date DESC"),
      ledger: all(
        "SELECT * FROM tg_ledger WHERE kind IN ('充值','退款') AND attendance_id IS NULL AND voided_at IS NULL AND date BETWEEN ? AND ? ORDER BY date DESC,id DESC",
        start,
        end,
      ).map((r) => ({
        ...r,
        editable: r.actual_amount != null && r.gift_amount != null,
        actual_amount: r.actual_amount ?? r.amount,
        gift_amount: r.gift_amount ?? 0,
      })),
    };
  }
  function calendarSnapshot(month, attendance = null, protection = true) {
    const { start, end } = require("./tuoguan_calendar").bounds(month);
    const saved =
      attendance ||
      all("SELECT * FROM tg_attendance WHERE date BETWEEN ? AND ?", start, end);
    const calendar = require("./tuoguan_calendar").defaults(
      month,
      all(
        "SELECT * FROM tg_calendar WHERE date BETWEEN ? AND ? ORDER BY date",
        start,
        end,
      ),
      saved,
    );
    if (!protection) return { calendar };
    const { protected_dates, protected_date_reasons } = Protection.snapshot(
      db,
      start,
      end,
      saved,
    );
    return { calendar, protected_dates, protected_date_reasons };
  }
  function snapshot(month, finance) {
    if (!/^\d{4}-\d{2}$/.test(month)) fail("月份无效");
    date(month + "-01");
    const start = month + "-01",
      end = month + "-31";
    const students = all(
      "SELECT s.*,a.first_attendance_date,a.last_attendance_date FROM tg_students s LEFT JOIN (SELECT student_id,MIN(date) first_attendance_date,MAX(date) last_attendance_date FROM tg_attendance WHERE status='出勤' GROUP BY student_id) a ON a.student_id=s.id ORDER BY s.name,s.id",
    );
    const periods = all("SELECT * FROM tg_periods ORDER BY start_date DESC");
    const attendance = all(
      "SELECT * FROM tg_attendance WHERE date BETWEEN ? AND ?",
      start,
      end,
    );
    const calendarState = calendarSnapshot(month, attendance, finance);
    const data = {
      students: finance
        ? students
        : students.map(({ id, name, grade, status }) => ({
            id,
            name,
            grade,
            status,
          })),
      periods,
      ...calendarState,
      attendance: finance
        ? attendance
        : attendance.map(({ fee, reference_fee, rule_json, ...r }) => r),
      teachers: all("SELECT id,name FROM teachers"),
      finance,
    };
    if (finance) {
      data.billing_rule = Billing.FEES;
      data.rules = all(
        "SELECT * FROM tg_rules ORDER BY effective_date DESC,id DESC",
      );
      const ledgerByStudent = new Map();
      for (const row of all(
        "SELECT * FROM tg_ledger WHERE date<=? ORDER BY date,id",
        end,
      )) {
        if (!ledgerByStudent.has(row.student_id))
          ledgerByStudent.set(row.student_id, []);
        ledgerByStudent.get(row.student_id).push(row);
      }
      const accounts = new Map(
        students.map((s) => [
          s.id,
          custodyAccount(ledgerByStudent.get(s.id) || [], month),
        ]),
      );
      data.ledger = [...accounts.values()]
        .flatMap((a) => a.ledger)
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      data.ledger.push(
        ...all(
          "SELECT * FROM tg_ledger WHERE voided_at IS NOT NULL AND date BETWEEN ? AND ?",
          start,
          end,
        ),
      );
      data.summary = students.map((s) => {
        const { ledger, ...sums } = accounts.get(s.id);
        const saved = attendance
          .filter((a) => a.student_id === s.id)
          .sort((a, b) => a.date.localeCompare(b.date));
        const historicalGrade =
          saved.find((a) => a.grade)?.grade ||
          periods.find(
            (p) =>
              p.student_id === s.id &&
              p.start_date <= end &&
              (!p.end_date || p.end_date >= start),
          )?.grade ||
          s.grade;
        return {
          ...s,
          ...sums,
          grade: historicalGrade,
          has_attendance: saved.some((a) => a.status !== "未登记"),
        };
      });
    }
    return data;
  }
  return {
    db,
    mutate,
    snapshot,
    calendarSnapshot,
    participationSnapshot,
    ledgerSnapshot,
    atomic,
    audit,
    all,
    get,
    run,
  };
}
module.exports = {
  GRADES,
  HISTORY_STATUSES,
  STATUSES,
  TABLES,
  migrate,
  createStore,
  date,
  cents,
  fail,
};
