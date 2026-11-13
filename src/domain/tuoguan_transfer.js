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
  replaces_id: "tg_ledger",
  source_import_id: "tg_imports",
  import_id: "tg_imports",
};
const TYPE = "liming_custody";
const VERSION = 6;
const Billing = require("./tuoguan_settlement");
const Normalization = require("./tuoguan_normalization");
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
    teachers: db.prepare("SELECT id,name FROM teachers ORDER BY id").all(),
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
          if (t === "tg_audit" && !record.origin_json) {
            // Preserve the original audit payload AND the original ID vocabulary
            // when an imported audit is later exported from a different database.
            const values = new Set();
            function collect(v) {
              if (v && typeof v === "object") Object.values(v).forEach(collect);
              else if (v != null) values.add(String(v));
            }
            try {
              collect(JSON.parse(row.payload));
            } catch {}
            const references = Object.fromEntries(
              [...keys].filter(([key]) =>
                values.has(key.slice(key.indexOf(":") + 1)),
              ),
            );
            record.origin_json = JSON.stringify({ source, references });
            db.prepare("UPDATE tg_audit SET origin_json=? WHERE id=?").run(
              record.origin_json,
              row.id,
            );
          }
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
      teacher_links: data.tg_calendar
        .filter((r) => r.teacher_id != null)
        .map((r) => {
          const teacher = db
            .prepare("SELECT name FROM teachers WHERE id=?")
            .get(r.teacher_id);
          if (!teacher) fail("托管日期引用的教师不存在");
          return {
            calendar_uid: keys.get("tg_calendar:" + r.date),
            name: teacher.name,
          };
        }),
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
  if (
    bundle?.type !== TYPE ||
    ![1, 2, 3, 4, 5, VERSION].includes(bundle.version)
  )
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
        ...(bundle.version >= 6 ? ["teacher_links"] : []),
      ].sort(),
    )
  )
    fail("托管文本包含未支持的字段");
  if (
    canonical(Object.keys(bundle.records || {}).sort()) !==
    canonical([...TABLE_ORDER].sort())
  )
    fail("托管数据范围不完整或包含其他业务");
  if (bundle.version >= 6) {
    if (!Array.isArray(bundle.teacher_links)) fail("教师关联清单缺失");
    const linked = new Set();
    for (const link of bundle.teacher_links) {
      if (
        !link ||
        !uuid(link.calendar_uid) ||
        typeof link.name !== "string" ||
        !link.name.trim() ||
        linked.has(link.calendar_uid) ||
        !bundle.records.tg_calendar.some((r) => r.uid === link.calendar_uid)
      )
        fail("教师关联清单无效");
      linked.add(link.calendar_uid);
    }
  }
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
      if (bundle.version === 1 && t === "tg_ledger") {
        if (
          Object.hasOwn(r, "actual_amount") ||
          Object.hasOwn(r, "gift_amount")
        )
          fail("旧版文本包含不兼容的分账字段");
        r.actual_amount = null;
        r.gift_amount = null;
      }
      if (
        bundle.version < 4 &&
        t === "tg_students" &&
        !Object.hasOwn(r, "status")
      )
        r.status = "在托";
      if (bundle.version < 6 && t === "tg_audit") r.origin_json ??= "";
      if (bundle.version < 6 && t === "tg_rules") r.stage ??= "";
      if (t === "tg_rules" && !["", "小学", "初中"].includes(r.stage))
        fail("收费学段无效");
      if (t === "tg_rules" && r.stage && r.absent !== 0)
        fail("放假与不适用费用必须为零");
      if (bundle.version < 5 && t === "tg_periods") r.default_status ??= "出勤";
      if (bundle.version < 5 && t === "tg_ledger") {
        r.version ??= 1;
        r.voided_at ??= null;
        r.voided_by ??= "";
        r.replaces_id ??= null;
      }
      if (t === "tg_periods" && !["出勤", "不适用"].includes(r.default_status))
        fail("参与默认状态无效");
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
      if (
        t === "tg_students" &&
        !require("./tuoguan_schema").PROFILE_STATUSES.includes(r.status)
      )
        fail("档案状态无效");
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
        if (
          (!HISTORY_STATUSES.includes(r.status) &&
            !require("./tuoguan_protection").isPlaceholder(r.status)) ||
          (r.pending && r.fee !== 0)
        )
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
        const split = r.actual_amount !== null || r.gift_amount !== null;
        if (
          split &&
          (r.actual_amount === null ||
            r.gift_amount === null ||
            cents(r.actual_amount) + cents(r.gift_amount) !== r.amount)
        )
          fail("实际与赠送金额不一致");
        if (split && r.attendance_id !== null) fail("考勤分配应由统一账务计算");
        if (
          split &&
          ((["充值", "优惠"].includes(r.kind) &&
            (r.actual_amount < 0 || r.gift_amount < 0)) ||
            (r.kind === "退款" && (r.actual_amount > 0 || r.gift_amount > 0)))
        )
          fail("分账方向无效");
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
  require("./tuoguan_money").validateEvidence(
    bundle.records.tg_ledger.map((i) => ({ id: i.uid, ...i.record })),
  );
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
  const ledgerIds = new Map(
    bundle.records.tg_ledger.map((item, i) => [
      item.uid,
      Number(item.source_key) || i + 1,
    ]),
  );
  const ledgers = new Map();
  for (const [i, item] of bundle.records.tg_ledger.entries()) {
    const r = {
      ...item.record,
      id: Number(item.source_key) || i + 1,
      replaces_id:
        item.record.replaces_id == null
          ? null
          : ledgerIds.get(item.record.replaces_id),
    };
    if (!ledgers.has(r.student_id)) ledgers.set(r.student_id, []);
    ledgers.get(r.student_id).push(r);
  }
  for (const list of ledgers.values())
    require("./tuoguan_account").account(
      list,
      list
        .map((r) => r.date.slice(0, 7))
        .sort()
        .at(-1),
    );
  // Normalize legacy evidence before planning, so a repeated old import compares
  // against the same settled records instead of generating consumption twice.
  const attendanceRows = bundle.records.tg_attendance.map((i) => ({
    ...i.record,
    id: i.uid,
  }));
  const ledgerRows = bundle.records.tg_ledger.map((i, n) => ({
    ...i.record,
    id: Number(i.source_key) || n + 1,
  }));
  const normalization = Normalization.plan(attendanceRows, ledgerRows);
  let nextNormalizationAudit =
    Math.max(
      0,
      ...bundle.records.tg_audit.map((i) => Number(i.source_key) || 0),
    ) + 1;
  for (const change of normalization.changes) {
    const { id, ...after } = change.after;
    Object.assign(attendance.get(id), after);
    bundle.records.tg_audit.push({
      uid: Billing.entryUid(id, "placeholder-normalization:" + after.version),
      source_key: String(nextNormalizationAudit++),
      record: {
        actor: "auto-migration",
        action: "规范占位考勤",
        payload: JSON.stringify(change),
        created_at: bundle.exported_at,
      },
    });
  }
  const changes = Billing.plan(
    bundle.records.tg_attendance.map((i) => ({ ...i.record, id: i.uid })),
    ledgerRows,
  );
  if (bundle.version >= 3 && changes.length)
    fail("自动计费文本包含未结算考勤，请在来源升级后重新复制");
  let nextLedger = Math.max(0, ...ledgerRows.map((r) => r.id)) + 1;
  let nextAudit =
    Math.max(
      0,
      ...bundle.records.tg_audit.map((i) => Number(i.source_key) || 0),
    ) + 1;
  for (const c of changes) {
    const item = bundle.records.tg_attendance.find(
      (i) => i.uid === c.before.id,
    );
    const { id, ...after } = c.after;
    item.record = after;
    for (const [index, e] of c.entries.entries())
      bundle.records.tg_ledger.push({
        uid: Billing.entryUid(item.uid, c.ordinal + index),
        source_key: String(nextLedger++),
        record: {
          student_id: after.student_id,
          date: after.date,
          ...e,
          method: "",
          voucher: "",
          notes: "旧文本自动结算",
          actor: "auto-migration",
          attendance_id: item.uid,
          created_at: bundle.exported_at,
          actual_amount: null,
          gift_amount: null,
        },
      });
    bundle.records.tg_audit.push({
      uid: Billing.entryUid(
        item.uid,
        "audit:" + c.ordinal + ":" + after.version,
      ),
      source_key: String(nextAudit++),
      record: {
        actor: "auto-migration",
        action: "旧文本自动结算",
        payload: JSON.stringify(c),
        created_at: bundle.exported_at,
      },
    });
  }
  bundle.settlement = {
    attendance: changes.map((c) => c.before.id),
    ledger: changes.flatMap((c) =>
      c.entries.map((e, index) =>
        Billing.entryUid(c.before.id, c.ordinal + index),
      ),
    ),
  };
  for (const item of bundle.records.tg_ledger) {
    item.record.version ??= 1;
    item.record.voided_at ??= null;
    item.record.voided_by ??= "";
    item.record.replaces_id ??= null;
  }
  for (const item of bundle.records.tg_audit) item.record.origin_json ??= "";
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
  const baselines = new Map(
    rows(db, "tg_transfer_baselines")
      .filter((b) => b.source === bundle.source)
      .map((b) => [b.table_name + ":" + b.uid, b]),
  );
  // Only participation rows are physically removed by the custody UI. All other
  // missing source records require review; financial evidence is never deleted.
  for (const base of baselines.values()) {
    if (
      bundle.records[base.table_name]?.some((r) => r.uid === base.uid) ||
      base.deleted
    )
      continue;
    const t = base.table_name,
      existing = local[t]?.find((r) => String(r[keyField(t)]) === base.row_key);
    if (
      t !== "tg_periods" ||
      !existing ||
      hash(existing) !== base.target_hash
    ) {
      conflicts.push({
        table: t,
        source_key: base.row_key,
        reason: "来源移除记录，但目标不可安全删除",
      });
      continue;
    }
    actions.push({
      table: t,
      uid: base.uid,
      id: existing.id,
      record: existing,
      status: "delete",
      source_hash: base.source_hash,
    });
    local[t] = local[t].filter((r) => r !== existing);
  }
  for (const t of TABLE_ORDER) {
    let next = Math.max(0, ...local[t].map((r) => Number(r.id) || 0)) + 1;
    const incoming = [...bundle.records[t]].sort(
      (a, b) =>
        Number(keys.has(t + ":" + b.uid)) - Number(keys.has(t + ":" + a.uid)),
    );
    for (const item of incoming) {
      const r = { ...item.record };
      const source_hash = hash({
        record: item.record,
        teacher:
          (bundle.teacher_links || []).find((l) => l.calendar_uid === item.uid)
            ?.name || null,
      });
      const base = baselines.get(t + ":" + item.uid);
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
        if (t === "tg_rules") {
          const peers = local[t].filter(
            (x) =>
              x.student_id === r.student_id &&
              x.effective_date === r.effective_date &&
              x.stage === r.stage,
          );
          existing = peers.find(
            ({ id, ...other }) => canonical(other) === canonical(r),
          );
          if (
            !existing &&
            peers.some(
              (x) =>
                !(
                  [...baselines.values()].some(
                    (base) =>
                      base.table_name === t && base.row_key === String(x.id),
                  ) || actions.some((a) => a.table === t && a.id === x.id)
                ),
            )
          )
            conflict = "目标在同一学段生效日有独立规则，请核对";
        }
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
      if (t === "tg_calendar") {
        if (bundle.version < 6) r.teacher_id = existing?.teacher_id ?? null;
        else {
          const link = bundle.teacher_links.find(
            (l) => l.calendar_uid === item.uid,
          );
          const matches = link
            ? db.prepare("SELECT id FROM teachers WHERE name=?").all(link.name)
            : [];
          if (link && matches.length !== 1)
            conflict = "教师姓名缺失或同名不唯一，请先核对：" + link.name;
          r.teacher_id = matches[0]?.id ?? null;
        }
      }
      const target = t === "tg_calendar" ? r : { id, ...r };
      let status = existing ? "skip" : "create",
        preserveBaseline = false;
      if (existing && canonical(existing) !== canonical(target)) {
        if (base && !base.deleted && base.source_hash === source_hash) {
          preserveBaseline = true; // Source unchanged: preserve independent target edits.
        } else if (
          base &&
          !base.deleted &&
          hash(existing) === base.target_hash
        ) {
          if (r.version != null && r.version < existing.version)
            conflict = "来源版本较旧，禁止回退";
          else status = "update";
        } else conflict = "双方内容不同且无安全同步基线，禁止覆盖";
      }
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
        status: conflict ? "conflict" : status,
        source_hash,
        preserveBaseline,
      });
      // Subsequent incoming records also take part in overlap/unique checks.
      if (!conflict && status === "update")
        local[t][local[t].indexOf(existing)] = target;
      if (!existing && t !== "tg_students") local[t].push(target);
    }
  }
  if (!conflicts.length) {
    try {
      validateMerged(local);
    } catch (e) {
      conflicts.push({ table: "tg_ledger", reason: e.message });
    }
  }
  const dates = TABLE_ORDER.flatMap((t) =>
    bundle.records[t].flatMap(({ record: r }) =>
      [r.date, r.start_date, r.end_date, r.effective_date].filter(Boolean),
    ),
  ).sort();
  const convertedAttendance = new Set(bundle.settlement?.attendance || []);
  const convertedLedger = new Set(bundle.settlement?.ledger || []);
  return {
    actions,
    conflicts,
    summary: {
      settlement: {
        updated: actions.filter(
          (a) =>
            a.table === "tg_attendance" &&
            a.status === "create" &&
            convertedAttendance.has(a.uid),
        ).length,
        net_change:
          -actions
            .filter(
              (a) =>
                a.table === "tg_ledger" &&
                a.status === "create" &&
                convertedLedger.has(a.uid),
            )
            .reduce((n, a) => n + a.record.amount, 0) || 0,
      },
      actual_recharge: bundle.records.tg_ledger
        .filter((i) => i.record.kind === "充值" && !i.record.voided_at)
        .reduce((n, i) => n + (i.record.actual_amount ?? i.record.amount), 0),
      gift_recharge: bundle.records.tg_ledger
        .filter((i) => i.record.kind === "充值" && !i.record.voided_at)
        .reduce((n, i) => n + (i.record.gift_amount || 0), 0),
      new_actual_recharge: actions
        .filter(
          (a) =>
            a.table === "tg_ledger" &&
            a.status === "create" &&
            a.record.kind === "充值" &&
            !a.record.voided_at,
        )
        .reduce((n, a) => n + (a.record.actual_amount ?? a.record.amount), 0),
      new_gift_recharge: actions
        .filter(
          (a) =>
            a.table === "tg_ledger" &&
            a.status === "create" &&
            a.record.kind === "充值" &&
            !a.record.voided_at,
        )
        .reduce((n, a) => n + (a.record.gift_amount || 0), 0),
      legacy_unallocated: bundle.records.tg_ledger.filter(
        (i) =>
          i.record.attendance_id === null && i.record.actual_amount === null,
      ).length,
      students: bundle.records.tg_students.length,
      attendance: bundle.records.tg_attendance.length,
      rules: bundle.records.tg_rules.length,
      ledger: bundle.records.tg_ledger.length,
      months: dates.length
        ? [dates[0].slice(0, 7), dates.at(-1).slice(0, 7)]
        : [],
      updated: actions.filter((a) => a.status === "update").length,
      deleted: actions.filter((a) => a.status === "delete").length,
      warnings:
        bundle.version < 6
          ? ["旧文本不包含教师关联，保留目标现有教师；首次存在差异时需人工核对"]
          : [],
      created: actions.filter((a) => a.status === "create").length,
      skipped: actions.filter((a) => a.status === "skip").length,
      conflicts: conflicts.length,
    },
  };
}
function validateMerged(local) {
  require("./tuoguan_money").validateEvidence(local.tg_ledger);
  for (const a of local.tg_attendance) {
    const ledger = local.tg_ledger.filter((r) => r.attendance_id === a.id);
    if (Billing.chargedAmount(a, ledger) !== a.fee)
      fail("合并后考勤与流水不一致，整批取消");
  }
  for (const p of local.tg_periods)
    if (
      local.tg_periods.some(
        (q) =>
          q.id !== p.id &&
          q.student_id === p.student_id &&
          q.start_date <= (p.end_date || "9999-12-31") &&
          (q.end_date || "9999-12-31") >= p.start_date,
      )
    )
      fail("合并后参与周期重叠");
  for (const id of new Set(local.tg_ledger.map((r) => r.student_id))) {
    const ledger = local.tg_ledger.filter((r) => r.student_id === id);
    require("./tuoguan_account").account(
      ledger,
      ledger
        .map((r) => r.date.slice(0, 7))
        .sort()
        .at(-1),
    );
  }
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
      if (a.status === "update") {
        const fields = Object.keys(a.record).filter(
          (f) => f !== keyField(a.table),
        );
        db.prepare(
          "UPDATE " +
            a.table +
            " SET " +
            fields.map((f) => f + "=?").join(",") +
            " WHERE " +
            keyField(a.table) +
            "=?",
        ).run(...fields.map((f) => a.record[f]), a.id);
      }
      if (a.status === "delete") {
        db.prepare(
          "DELETE FROM " + a.table + " WHERE " + keyField(a.table) + "=?",
        ).run(a.id);
        db.prepare(
          "UPDATE tg_transfer_keys SET row_key='removed:'||uid WHERE table_name=? AND row_key=?",
        ).run(a.table, String(a.id));
      }
      if (!a.preserveBaseline)
        db.prepare(
          "INSERT INTO tg_transfer_baselines(source,table_name,uid,source_hash,target_hash,row_key,deleted) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source,table_name,uid) DO UPDATE SET source_hash=excluded.source_hash,target_hash=excluded.target_hash,row_key=excluded.row_key,deleted=excluded.deleted",
        ).run(
          bundle.source,
          a.table,
          a.uid,
          a.source_hash,
          hash(a.record),
          String(a.id),
          a.status === "delete" ? 1 : 0,
        );
      db.prepare(
        "INSERT OR IGNORE INTO tg_transfer_keys(table_name,row_key,uid) VALUES (?,?,?)",
      ).run(a.table, String(a.id), a.uid);
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      fail("导入关联校验失败");
    validateMerged(
      Object.fromEntries(TABLE_ORDER.map((t) => [t, rows(db, t)])),
    );
    if (
      current.summary.created ||
      current.summary.updated ||
      current.summary.deleted
    )
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
