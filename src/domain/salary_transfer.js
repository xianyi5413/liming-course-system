'use strict';

const W = require('./salary_workflow');
const TYPE = 'liming_salary_tables';
const VERSION = 1;

function exportTables(store, teacher) {
  return { type: TYPE, version: VERSION, exported_at: new Date().toISOString(), teacher: { teacher_id: teacher.id, teacher_name: teacher.name }, tables: store.list(teacher.id).map(({ name, effective_start, effective_end, rules }) => ({ name, effective_start, effective_end, rules: rules.map(({ grade, course_type, formula }) => ({ grade, course_type, formula })) })) };
}

function previewTables(store, teachers, input, selectedTeacherId = null) {
  let bundle;
  try { bundle = typeof input === 'string' ? JSON.parse(input) : input; } catch { throw new Error('薪资表文本不是有效 JSON'); }
  if (!bundle || bundle.type !== TYPE || bundle.version !== VERSION) throw new Error('薪资表文本类型或版本不支持');
  if (!Array.isArray(bundle.tables) || !bundle.tables.length || bundle.tables.length > 100) throw new Error('每次请导入 1～100 张薪资表');
  const identity = bundle.teacher || {}, name = String(identity.teacher_name || '').trim();
  const byId = teachers.find(row => row.id === identity.teacher_id);
  const matches = teachers.filter(row => row.name === name);
  // IDs are not globally unique across installations. An ID/name collision must
  // never silently assign a different person's salary rules.
  let teacher = byId && byId.name === name ? byId : matches.length === 1 ? matches[0] : null;
  if (!teacher && matches.length > 1) {
    teacher = matches.find(row => row.id === Number(selectedTeacherId));
    if (!teacher) throw Object.assign(new Error('存在同名教师，请明确选择导入教师'), { candidates: matches.map(({ id, name }) => ({ id, name })) });
  }
  if (!teacher) throw new Error('找不到匹配教师，不能导入薪资表');
  const tables = bundle.tables.map(table => W.normalizeTable(table));
  const ordered = [...tables].sort((a, b) => a.effective_start.localeCompare(b.effective_start));
  for (let i = 1; i < ordered.length; i++) if (ordered[i].effective_start <= ordered[i - 1].effective_end) throw new Error(`待导入时间冲突：${ordered[i - 1].effective_start}～${ordered[i - 1].effective_end} 与 ${ordered[i].effective_start}～${ordered[i].effective_end}`);
  const existing = store.list(teacher.id);
  for (const table of tables) {
    const conflict = existing.find(row => row.effective_start <= table.effective_end && row.effective_end >= table.effective_start);
    if (conflict) throw new Error(`日期冲突；待导入：${table.effective_start}～${table.effective_end}；已有：${conflict.effective_start}～${conflict.effective_end}`);
  }
  return { teacher: { id: teacher.id, name: teacher.name }, tables, message: `将导入至：${teacher.name}`, matched_by: byId?.id === teacher.id && byId.name === name ? 'id' : 'name' };
}

function importTables(store, preview) {
  return store.atomic(() => preview.tables.map(table => store.save({ ...table, teacher_id: preview.teacher.id })));
}

const TEMPLATE_TYPE = 'liming_salary_templates';
const BusinessTime = require('../../public/business-time');
function exportTemplates(store, ids = null, now = new Date()) {
  const available = store.templates();
  if (ids != null && (!Array.isArray(ids) || !ids.length || ids.some(id => !Number.isSafeInteger(id) || !available.some(row => row.id === id)))) throw new Error('请选择有效薪资模板');
  return { type: TEMPLATE_TYPE, version: VERSION, exported_at: BusinessTime.formatTimestamp(now).replace(' ', 'T') + '+08:00', templates: available.filter(row => ids == null || ids.includes(row.id)).map(W.normalizeTemplate) };
}
const rulesKey = rules => JSON.stringify([...rules].sort((a, b) => a.grade.localeCompare(b.grade) || a.course_type.localeCompare(b.course_type)));
function previewTemplates(store, input) {
  let bundle;
  try { bundle = typeof input === 'string' ? JSON.parse(input) : input; } catch { throw new Error('薪资模板文本不是有效 JSON'); }
  if (!bundle || bundle.type !== TEMPLATE_TYPE || bundle.version !== VERSION) throw new Error('薪资模板文本类型或版本不支持');
  if (!Array.isArray(bundle.templates) || !bundle.templates.length || bundle.templates.length > 100) throw new Error('每次请导入 1～100 个模板');
  const templates = bundle.templates.map(W.normalizeTemplate);
  const existing = store.templates().map(W.normalizeTemplate), seen = [...existing];
  const items = templates.map(template => {
    const matches = seen.filter(row => row.name === template.name);
    const conflict = matches.some(row => rulesKey(row.rules) !== rulesKey(template.rules));
    const status = conflict ? 'conflict' : matches.length ? 'skip' : 'create';
    seen.push(template);
    return { ...template, status, message: conflict ? '同名模板规则不同，禁止覆盖' : matches.length ? '已存在，可跳过' : '将新增' };
  });
  return { templates: items, allowed: items.every(row => row.status !== 'conflict'), message: '机构共用模板，不改变教师薪资表' };
}
function importTemplates(store, preview) {
  return store.atomic(() => {
    // Revalidate names and contents under the same write transaction: a preview
    // never authorizes overwriting a template added or changed in the meantime.
    const current = previewTemplates(store, { type: TEMPLATE_TYPE, version: VERSION, templates: preview.templates });
    if (!current.allowed) throw new Error('同名模板规则冲突，请重新预览；本批未导入');
    const created = current.templates.filter(row => row.status === 'create').map(row => store.saveTemplate(row));
    return { count: created.length, skipped: current.templates.length - created.length };
  });
}

module.exports = { TYPE, TEMPLATE_TYPE, VERSION, exportTables, previewTables, importTables, exportTemplates, previewTemplates, importTemplates };
