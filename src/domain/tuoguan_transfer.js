// Custody-only, explicit snapshot merge. Never match a student by a name or a
// database-local integer ID. Portable UUIDs survive onward exports and backups.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");
const {
  TABLES,
  fail,
  date,
  cents,
  HISTORY_STATUSES,
  GRADES,
} = require("./tuoguan");
const TABLE_ORDER = [
  "tg_students",
  "tg_imports",
  "tg_periods",
  "tg_rules",
  "tg_calendar",
  "tg_attendance",
  "tg_ledger",
  "tg_import_sources",
  "tg_audit",
];
const REFS = {
  student_id: "tg_students",
  attendance_id: "tg_attendance",
  source_import_id: "tg_imports",
  import_id: "tg_imports",
};
const TYPE = "liming_custody";
const VERSION = 1;
const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const canonical = (value) => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, normalize(value[k])]),
    );
  return value;
}
const hash = (value) =>
  crypto.createHash("sha256").update(canonical(value)).digest("hex");
const rows = (db, t) =>
  db.prepare("SELECT * FROM " + t + " ORDER BY rowid").all();
const keyField = (t) => (t === "tg_calendar" ? "date" : "id");
function signature(db) {
  return hash({
    schema: db
      .prepare(
        "SELECT name,sql FROM sqlite_schema WHERE name LIKE 'tg_%' ORDER BY name",
      )
      .all(),
    version: db.prepare("PRAGMA user_version").get(),
    data: Object.fromEntries(TABLES.map((t) => [t, rows(db, t)])),
  });
}
function exportData(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    let source = db
      .prepare("SELECT value FROM tg_transfer_meta WHERE id='source'")
      .get()?.value;
    if (!source) {
      source = crypto.randomUUID();
      db.prepare("INSERT INTO tg_transfer_meta VALUES (?,?)").run(
        "source",
        source,
      );
    }
    const data = Object.fromEntries(TABLE_ORDER.map((t) => [t, rows(db, t)]));
    const keys = new Map();
    for (const row of rows(db, "tg_transfer_keys"))
      if (!keys.has(row.table_name + ":" + row.row_key))
        keys.set(row.table_name + ":" + row.row_key, row.uid);
    for (const t of TABLE_ORDER)
      for (const row of data[t]) {
        const key = t + ":" + row[keyField(t)];
        if (!keys.has(key)) {
          const uid = crypto.randomUUID();
          db.prepare(
            "INSERT INTO tg_transfer_keys(table_name,row_key,uid) VALUES (?,?,?)",
          ).run(t, String(row[keyField(t)]), uid);
          keys.set(key, uid);
        }
      }
    const records = Object.fromEntries(
      TABLE_ORDER.map((t) => [
        t,
        data[t].map((row) => {
          const record = { ...row };
          if (t !== "tg_calendar") delete record.id;
          for (const [field, parent] of Object.entries(REFS))
            if (record[field] != null) {
              const uid = keys.get(parent + ":" + record[field]);
              if (!uid) fail("来源关联不完整，无法复制");
              record[field] = uid;
            }
          if (t === "tg_calendar") record.teacher_id = null; // No cross-business teacher IDs.
          return {
            uid: keys.get(t + ":" + row[keyField(t)]),
            source_key: String(row[keyField(t)]),
            record,
          };
        }),
      ]),
    );
    const bundle = {
      type: TYPE,
      version: VERSION,
      exported_at: new Date().toISOString(),
      source,
      records,
    };
    bundle.checksum = hash(bundle);
    db.exec("COMMIT");
    return bundle;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function parse(db, text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 12000000)
    fail("托管文本无效或超过12MB");
  let bundle;
  try {
    bundle = JSON.parse(text);
  } catch {
    fail("托管文本不是有效JSON");
  }
  if (bundle?.type !== TYPE || bundle.version !== VERSION)
    fail("托管文本格式或版本不兼容");
  const { checksum, ...content } = bundle;
  if (typeof checksum !== "string" || hash(content) !== checksum)
    fail("托管文本校验摘要不匹配");
  if (!uuid(bundle.source) || !Number.isFinite(Date.parse(bundle.exported_at)))
    fail("来源标识或导出时间无效");
  if (
    canonical(Object.keys(bundle).sort()) !==
    canonical(
      [
        "type",
        "version",
        "exported_at",
        "source",
        "records",
        "checksum",
      ].sort(),
    )
  )
    fail("托管文本包含未支持的字段");
  if (
    canonical(Object.keys(bundle.records || {}).sort()) !==
    canonical([...TABLE_ORDER].sort())
  )
    fail("托管数据范围不完整或包含其他业务");
  const indices = new Map();
  let count = 0;
  for (const t of TABLE_ORDER) {
    const fields = new Map(
      db
        .prepare("PRAGMA table_info(" + t + ")")
        .all()
        .map((c) => [c.name, c]),
    );
    if (!Array.isArray(bundle.records[t])) fail("记录格式无效");
    const seen = new Set();
    indices.set(t, seen);
    for (const item of bundle.records[t]) {
      if (++count > 100000) fail("记录过多");
      if (
        !item ||
        !uuid(item.uid) ||
        seen.has(item.uid) ||
        typeof item.source_key !== "string"
      )
        fail("记录标识无效或重复");
      seen.add(item.uid);
      const r = item.record;
      if (!r || typeof r !== "object" || Array.isArray(r)) fail("记录格式无效");
      const expected = [...fields.keys()].filter((k) => k !== "id");
      if (canonical(Object.keys(r).sort()) !== canonical(expected.sort()))
        fail("记录字段与当前版本不一致：" + t);
      for (const [k, v] of Object.entries(r)) {
        const f = fields.get(k);
        if (v === null) {
          if (f.notnull) fail("必填字段为空");
          continue;
        }
        if (REFS[k]) {
          if (typeof v !== "string") fail("关联标识无效");
        } else if (f.type === "INTEGER" && !Number.isSafeInteger(v))
          fail("整数字段无效");
        else if (
          f.type === "TEXT" &&
          (typeof v !== "string" || v.length > 2000000)
        )
          fail("文本字段无效");
      }
      for (const k of ["date", "start_date", "end_date", "effective_date"])
        if (r[k]) date(r[k]);
      if (r.start_date && r.end_date && r.start_date > r.end_date)
        fail("参与范围无效");
      if (r.effective_date && r.end_date && r.effective_date > r.end_date)
        fail("规则范围无效");
      if (r.grade && !GRADES.includes(r.grade)) fail("托管年级无效");
      for (const k of [
        "fee",
        "reference_fee",
        "present",
        "leave_fee",
        "absent",
        "amount",
      ])
        if (r[k] != null) {
          cents(r[k]);
          if (k !== "amount" && r[k] < 0) fail("费用不能为负");
        }
      if (r.version != null && r.version < 1) fail("记录版本无效");
      if (r.pending != null && ![0, 1].includes(r.pending))
        fail("核定标志无效");
      if (t === "tg_students" && (!r.name.trim() || r.name.length > 80))
        fail("姓名无效");
      if (t === "tg_periods" && !["在托", "暂停", "退托"].includes(r.status))
        fail("参与状态无效");
      if (
        t === "tg_calendar" &&
        (![0, 1].includes(r.enabled) || r.teacher_id !== null)
      )
        fail("日期记录无效");
      if (t === "tg_attendance") {
        if (!HISTORY_STATUSES.includes(r.status) || (r.pending && r.fee !== 0))
          fail("历史考勤或核定金额无效");
        let rule;
        try {
          rule = JSON.parse(r.rule_json);
        } catch {
          fail("收费快照无效");
        }
        if (!rule || Array.isArray(rule) || typeof rule !== "object")
          fail("收费快照无效");
        for (const k of ["present", "leave_fee", "absent"])
          if (rule[k] != null && cents(rule[k]) < 0) fail("收费快照无效");
      }
      if (t === "tg_ledger") {
        if (
          ![
            "充值",
            "退款",
            "优惠",
            "调整",
            "期初核定",
            "考勤扣费",
            "考勤冲正",
          ].includes(r.kind)
        )
          fail("资金类型无效");
        if (
          (["充值", "优惠", "考勤冲正"].includes(r.kind) && r.amount <= 0) ||
          (["退款", "考勤扣费"].includes(r.kind) && r.amount >= 0)
        )
          fail("资金方向无效");
        if (
          ["考勤扣费", "考勤冲正"].includes(r.kind) !=
          (r.attendance_id != null)
        )
          fail("资金考勤关联无效");
      }
    }
  }
  for (const t of TABLE_ORDER)
    for (const { record: r } of bundle.records[t])
      for (const [f, parent] of Object.entries(REFS))
        if (r[f] != null && !indices.get(parent).has(r[f]))
          fail("关联记录缺失：" + t);
  const fees = new Map(),
    attendance = new Map(
      bundle.records.tg_attendance.map((i) => [i.uid, i.record]),
    );
  for (const { record: r } of bundle.records.tg_ledger)
    if (r.attendance_id) {
      const a = attendance.get(r.attendance_id);
      if (a.student_id !== r.student_id || a.date !== r.date)
        fail("资金与考勤身份或日期不一致");
      fees.set(r.attendance_id, (fees.get(r.attendance_id) || 0) + r.amount);
    }
  for (const [uid, a] of attendance)
    if ((fees.get(uid) || 0) !== -a.fee) fail("考勤金额与资金流水不一致");
  return bundle;
}
function plan(db, bundle) {
  const local = Object.fromEntries(
    TABLE_ORDER.map((t) => [t, rows(db, t).map((r) => ({ ...r }))]),
  );
  const keys = new Map(
    rows(db, "tg_transfer_keys").map((r) => [
      r.table_name + ":" + r.uid,
      r.row_key,
    ]),
  );
  const mappings = new Map(),
    actions = [],
    conflicts = [];
  for (const t of TABLE_ORDER) {
    let next = Math.max(0, ...local[t].map((r) => Number(r.id) || 0)) + 1;
    for (const item of bundle.records[t]) {
      const r = { ...item.record };
      for (const [f, parent] of Object.entries(REFS))
        if (r[f] != null) r[f] = mappings.get(parent + ":" + r[f]);
      const known = keys.get(t + ":" + item.uid),
        key = keyField(t);
      let existing =
        known == null ? null : local[t].find((r) => String(r[key]) === known);
      let conflict = known != null && !existing ? "来源记录在目标已移除" : "";
      if (!existing && !conflict) {
        if (t === "tg_calendar")
          existing = local[t].find((x) => x.date === r.date);
        if (t === "tg_attendance")
          existing = local[t].find(
            (x) => x.student_id === r.student_id && x.date === r.date,
          );
        if (t === "tg_import_sources")
          existing = local[t].find(
            (x) => x.import_id === r.import_id && x.source_key === r.source_key,
          );
        if (t === "tg_students" && local[t].some((x) => x.name === r.name))
          conflict = "目标已有同名档案但来源标识不同，需人工核对身份";
        if (t === "tg_periods")
          existing = local[t].find(
            (x) =>
              x.student_id === r.student_id &&
              x.start_date <= (r.end_date || "9999-12-31") &&
              (x.end_date || "9999-12-31") >= r.start_date,
          );
        if (t === "tg_rules")
          existing = local[t].find(
            (x) =>
              x.student_id === r.student_id &&
              x.effective_date === r.effective_date,
          );
        if (
          t === "tg_ledger" &&
          r.kind === "期初核定" &&
          local[t].some(
            (x) => x.student_id === r.student_id && x.kind === r.kind,
          )
        )
          conflict = "目标已存在期初核定";
      }
      let id =
        existing?.[key] ??
        (t === "tg_calendar"
          ? r.date
          : ["tg_imports", "tg_import_sources"].includes(t)
            ? item.uid
            : next++);
      if (t === "tg_calendar" && existing) r.teacher_id = existing.teacher_id;
      const target = t === "tg_calendar" ? r : { id, ...r };
      if (existing && canonical(existing) !== canonical(target))
        conflict = "同一来源或业务位置内容不同，禁止覆盖";
      if (conflict)
        conflicts.push({
          table: t,
          source_key: item.source_key,
          reason: conflict,
        });
      mappings.set(t + ":" + item.uid, id);
      actions.push({
        table: t,
        uid: item.uid,
        id,
        record: target,
        status: conflict ? "conflict" : existing ? "skip" : "create",
      });
      // Subsequent incoming records also take part in overlap/unique checks.
      if (!existing && t !== "tg_students") local[t].push(target);
    }
  }
  const dates = TABLE_ORDER.flatMap((t) =>
    bundle.records[t].flatMap(({ record: r }) =>
      [r.date, r.start_date, r.end_date, r.effective_date].filter(Boolean),
    ),
  ).sort();
  return {
    actions,
    conflicts,
    summary: {
      students: bundle.records.tg_students.length,
      attendance: bundle.records.tg_attendance.length,
      rules: bundle.records.tg_rules.length,
      ledger: bundle.records.tg_ledger.length,
      months: dates.length
        ? [dates[0].slice(0, 7), dates.at(-1).slice(0, 7)]
        : [],
      created: actions.filter((a) => a.status === "create").length,
      skipped: actions.filter((a) => a.status === "skip").length,
      conflicts: conflicts.length,
    },
  };
}
async function confirm(db, text, expected, backupDir, actor) {
  const bundle = parse(db, text);
  if (signature(db) !== expected) fail("目标托管数据已变化，请重新预览", 409);
  const preview = plan(db, bundle);
  if (preview.conflicts.length) fail("存在冲突，本批未导入", 409);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    "custody-transfer-" + crypto.randomUUID() + ".sqlite",
  );
  await backup(db, backupPath);
  const saved = new DatabaseSync(backupPath, { readOnly: true });
  try {
    if (
      signature(saved) !== expected ||
      saved.prepare("PRAGMA integrity_check").get().integrity_check !== "ok"
    )
      fail("备份校验失败或数据变化，请重新预览", 409);
  } finally {
    saved.close();
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    if (signature(db) !== expected) fail("目标托管数据已变化，请重新预览", 409);
    const current = plan(db, bundle);
    if (current.conflicts.length) fail("存在冲突，本批未导入", 409);
    for (const a of current.actions) {
      if (a.status === "create") {
        const fields = Object.keys(a.record);
        db.prepare(
          "INSERT INTO " +
            a.table +
            "(" +
            fields.join(",") +
            ") VALUES (" +
            fields.map(() => "?").join(",") +
            ")",
        ).run(...fields.map((f) => a.record[f]));
      }
      db.prepare(
        "INSERT OR IGNORE INTO tg_transfer_keys(table_name,row_key,uid) VALUES (?,?,?)",
      ).run(a.table, String(a.id), a.uid);
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      fail("导入关联校验失败");
    if (current.summary.created)
      db.prepare(
        "INSERT INTO tg_audit(actor,action,payload) VALUES (?,?,?)",
      ).run(
        actor,
        "托管文本导入",
        JSON.stringify({
          source: bundle.source,
          checksum: bundle.checksum,
          ...current.summary,
        }),
      );
    db.exec("COMMIT");
    return { ...current.summary, backup: backupPath };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
module.exports = {
  exportData,
  parse,
  plan,
  confirm,
  signature,
  TABLE_ORDER,
  hash,
};
