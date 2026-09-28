'use strict';

// Uses the application's existing selectors, date picker, money inputs and modal
// styles. Financial values are supplied by the shared server resolver.
const SalaryUI = (() => {
  let range = null, hideDeparted = true, data = { tables: [], classes: [], lessons: [] };
  let modal = null, draft = null, tables = [], activeClass = '', returnFocus = null;
  let legacyDetail = false;
  let sessionGeneration = 0;
  let tablesWritable = false, templateDialog = null;
  const tableDisabled = () => tablesWritable ? '' : 'disabled';
  const manager = () => ['owner', 'admin', 'boss', 'academic', 'jiaowu'].includes(auth.user?.role);
  const writable = () => manager() && canWriteData() && (['owner', 'admin', 'boss'].includes(auth.user?.role) || canView('teacherSalary'));
  const disabled = () => writable() ? '' : 'disabled';
  const bounds = () => range || monthBounds(state?.settings?.month_key || activeMonth);
  function close() { templateDialog?.close(); templateDialog = null; closeDateRangePicker(); modal?.remove(); modal = null; draft = null; activeClass = ''; returnFocus?.focus(); }
  function show(title, body, extra = '') {
    if (!modal) returnFocus = document.activeElement;
    modal?.remove();
    modal = document.createElement('div');
    modal.className = 'modal-backdrop salary-workflow-modal';
    modal.innerHTML = `<div class="modal-panel salary-workflow-panel ${extra}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><div class="modal-head"><div class="modal-title">${escapeHtml(title)}</div><button class="btn" data-salary-action="close">关闭</button></div>${body}</div>`;
    document.body.appendChild(modal);
    bindDateRangePickerControls(modal);
    modal.querySelector('button')?.focus();
    scheduleAdaptiveTableColumns();
  }
  async function refresh() {
    await load({ refreshGlobal: true });
    if (activeClass) showClass(activeClass);
  }
  function renderDetail() {
    if (legacyDetail) return renderLegacyTeacherDetail();
    const teachers = (state.teacher_detail_teachers || []).map(row => row.name);
    const rows = data.lessons || [], options = dynamicTeacherDetailFilterOptions(rows);
    const visibleIds = new Set(rows.filter(row => teacherDetailMatchesFilter(row)).map(row => row.id));
    const classes = selectedTeacherDetail ? data.classes.filter(row => row.lesson_ids.some(id => visibleIds.has(id))) : [];
    const legacy = classes.some(row => row.rules.legacy);
    const date = bounds();
    renderTopbar('课时明细', '按班级查看课程与基础课薪；规则金额按每 2 小时计价', '<button class="btn export-teacher-detail-image" type="button">复制图片</button>');
    contentEl.innerHTML = `<div class="band"><div class="filter-bar compact unified-filter-bar"><div class="filter-controls">
      ${unifiedFilterField({ label: '教师', className: 'teacher-detail-teacher-select', field: 'teacher', value: selectedTeacherDetail, values: teachers, placeholder: '请选择教师', emptyLabel: '清空选择' })}
      <label class="filter-field"><span>教师范围</span><span class="control"><input type="checkbox" id="salary-hide-departed" ${hideDeparted ? 'checked' : ''}> 隐藏离职</span></label>
      ${manager() ? '<button class="btn" data-salary-action="tables">薪资表</button>' : ''}
      ${canView('teacherSalaryRules') ? '<button class="btn" data-salary-action="legacy">历史规则</button>' : ''}
      ${manager() ? '<button class="btn" data-salary-action="legacy-detail">历史课时操作</button>' : ''}
      <label class="filter-field filter-date-range"><span>日期范围</span>${dateRangePickerControl({ scope: 'teacher-detail-salary', start: date.start, end: date.end })}</label>
      ${unifiedFilterField({ label: '年级', className: 'teacher-detail-filter-input', field: 'grade', value: teacherDetailFilter.grade, values: options.grades })}
      ${unifiedFilterField({ label: '科目', className: 'teacher-detail-filter-input', field: 'subject', value: teacherDetailFilter.subject, values: options.subjects })}
      ${unifiedFilterField({ label: '学生', className: 'teacher-detail-filter-input', field: 'student', value: teacherDetailFilter.student, values: options.students })}
      </div><div class="filter-summary"><span>${classes.length} 个班级 · ${rows.length} 节课程</span><button class="btn reset-teacher-detail-filter">清空筛选</button></div></div>
      <div class="table-wrap"><table class="teacher-detail-table teacher-class-summary-table uniform-table nowrap-table" data-adaptive-table="true" data-adaptive-natural="true"><colgroup>${rowIndexColumn()}<col data-column-type="name"><col data-column-type="short"><col data-column-type="short"><col data-column-type="short"><col data-column-type="full" data-alignment="center">${data.tables.map(() => '<col data-column-type="full" data-alignment="right">').join('')}${legacy ? '<col data-column-type="full" data-alignment="right">' : ''}</colgroup>
      <thead><tr>${rowIndexHeader()}<th>老师</th><th>年级</th><th>科目</th><th>类型</th><th>学生</th>${data.tables.map((table, i) => `<th>规则薪资${i + 1}<br><small>${escapeHtml(table.effective_start)}～${escapeHtml(table.effective_end)}</small></th>`).join('')}${legacy ? '<th>历史规则</th>' : ''}</tr></thead>
      <tbody>${classes.map((row, i) => `<tr data-salary-class="${escapeHtml(row.key)}" tabindex="0" role="button" aria-label="查看${escapeHtml(row.student_names)}的课程">${renderRowIndex(i)}<td>${escapeHtml(row.teacher_name)}</td><td>${escapeHtml(row.grade)}</td><td>${escapeHtml(row.subject)}</td><td>${escapeHtml(row.course_type)}</td><td class="student-set-cell">${renderStudentSetBadges(row.student_names, { fallbackGrade: row.grade })}</td>${data.tables.map(table => `<td>${escapeHtml(row.rules[table.id] || '—（无课程）')}</td>`).join('')}${legacy ? `<td>${escapeHtml(row.rules.legacy || '—（无课程）')}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${6 + data.tables.length + Number(legacy)}" class="empty">${selectedTeacherDetail ? '此日期范围暂无课程' : '请先选择教师'}</td></tr>`}</tbody></table></div></div>`;
  }
  function showClass(key) {
    const group = data.classes.find(row => row.key === key);
    if (!group) { close(); return; }
    activeClass = key;
    const ids = new Set(group.lesson_ids), rows = data.lessons.filter(row => ids.has(row.id));
    const salaryCells = row => {
      const special = ['manual', 'legacy', 'import'].includes(row.teacher_base_salary_source);
      return `<td class="price-cell-wrap ${special ? 'salary-special' : ''}"><span class="price-inline">${currencyInputMarkup(row.teacher_base_salary, { className: 'salary-base-input', displayValue: row.teacher_base_salary == null ? '未设置' : null, attrs: `data-id="${row.id}" step="0.01" min="0" ${disabled()}`, inputValue: row.teacher_base_salary == null ? '' : Number(row.teacher_base_salary).toFixed(2) })}<span class="status-badge">${special ? '特' : row.teacher_base_salary_source === 'auto' ? '自' : '—'}</span></span>${writable() ? `<button class="btn salary-auto-button" data-salary-action="auto" data-id="${row.id}">恢复自动</button>` : ''}</td><td title="${escapeHtml(row.salary_rule_reason || '')}">${escapeHtml(row.salary_rule_expression)}</td>`;
    };
    show(`${group.teacher_name} · ${group.grade} · ${group.subject} · ${group.course_type} · ${group.student_names}`, '<p class="section-subtitle">教师薪资为实际基础课薪，不含绩效；规则金额已按课程时长折算。</p>' + CourseDetails.table(rows, { salaryCells, className: 'teacher-class-lessons' }), 'salary-lessons-panel');
  }

  async function showTables() {
    draft = null; activeClass = '';
    const generation = sessionGeneration;
    const result = await request('/api/salary-tables', { cache: false });
    if (generation !== sessionGeneration || !auth.user) return;
    tables = result.tables;
    tablesWritable = Boolean(result.can_manage) && writable();
    const today = todayDate();
    show('薪资表', `<div class="salary-table-actions"><button class="btn primary" data-salary-action="new" ${tableDisabled()}>新增薪资表</button></div><div class="salary-table-cards">${tables.map(table => `<button class="salary-table-card btn" data-salary-action="edit" data-id="${table.id}"><b>${escapeHtml(table.name || '薪资表')}</b><span>${escapeHtml(table.effective_start)} ～ ${escapeHtml(table.effective_end)}</span><span>更新：${escapeHtml(table.updated_at)}</span><span>${today < table.effective_start ? '未生效' : today > table.effective_end ? '已结束' : '生效中'}</span></button>`).join('') || '<p class="empty">暂无薪资表，未覆盖的课程继续使用历史薪资。</p>'}</div>`);
  }
  function editTable(id) {
    draft = id ? structuredClone(tables.find(row => row.id === id)) : { name: '', effective_start: '', effective_end: '', rules: [] };
    const grades = ['初一', '初二', '初三', '高一', '高二', '高三'], types = ['1V1', '1V2', '1V3', '小班课'];
    show(id ? '编辑薪资表' : '新增薪资表', `<div class="salary-editor-controls"><label class="filter-field"><span>名称（选填）</span><input class="control" id="salary-table-name" maxlength="80" value="${escapeHtml(draft.name)}" ${tableDisabled()}></label><label class="filter-field"><span>生效日期（必填）</span>${dateRangePickerControl({ scope: 'salary-table-editor', start: draft.effective_start, end: draft.effective_end, disabled: !tablesWritable })}</label><button class="btn" data-salary-action="template-add" ${tableDisabled()}>添加为模板</button><button class="btn" data-salary-action="template-use" ${tableDisabled()}>使用模板</button></div><p>每 2 小时计价；n 为实际学生人数，K 为教师当月绩效系数。留空表示未配置规则。</p><div class="table-wrap"><table class="uniform-table salary-formula-table"><thead><tr><th>年级</th><th>1V1</th><th>1V2</th><th>1V3</th><th>小班公式</th><th>小班6人</th></tr></thead><tbody>${grades.map(grade => `<tr><th>${grade}</th>${types.map(type => grade.startsWith('初') && type === '1V3' ? '<td>—</td>' : `<td><input class="cell-input salary-formula-input" data-grade="${grade}" data-type="${type}" aria-label="${grade}${type}薪资公式" value="${escapeHtml(draft.rules.find(rule => rule.grade === grade && rule.course_type === type)?.formula || '')}" ${tableDisabled()}></td>`).join('')}<td data-salary-preview="${grade}">—</td></tr>`).join('')}</tbody></table></div><p class="salary-editor-error" role="alert"></p><div class="salary-table-actions"><button class="btn primary" data-salary-action="save" ${tableDisabled()}>保存</button><button class="btn" data-salary-action="tables">返回列表</button>${id ? `<button class="btn danger" data-salary-action="delete" data-id="${id}" ${tableDisabled()}>删除薪资表</button>` : ''}</div>`);
    previews();
  }
  function gridRules() {
    return [...modal.querySelectorAll('.salary-formula-input')].map(input => ({ grade: input.dataset.grade, course_type: input.dataset.type, formula: input.value }));
  }
  function templateNameDialog() {
    const generation = sessionGeneration, editor = modal;
    // Validate without requiring dates or persisting the active salary table.
    const rules = gridRules();
    for (const rule of rules) if (rule.formula.trim()) SalaryFormula.validate(rule.formula, { allowN: rule.course_type === '小班课' });
    templateDialog = CourseDetails.dialog('添加为模板', '<form class="salary-template-form"><label class="filter-field"><span>模板名称</span><input class="control" name="name" maxlength="80" required placeholder="例如：2026暑期薪资模板"></label><p class="salary-editor-error" role="alert"></p><button class="btn primary" type="submit">保存模板</button></form>');
    templateDialog.element.classList.add('salary-template-dialog');
    const dialog = templateDialog;
    const form = templateDialog.element.querySelector('form');
    form.elements.name.focus();
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('button'); button.disabled = true;
      try {
        await request('/api/salary-templates', { method: 'POST', body: { name: form.elements.name.value, rules } });
        if (generation !== sessionGeneration || editor !== modal || templateDialog !== dialog || !dialog.element.isConnected) return;
        templateDialog.close(); templateDialog = null; showToast('薪资模板已保存');
      } catch (error) { form.querySelector('[role=alert]').textContent = error.message; }
      finally { button.disabled = false; }
    };
  }
  async function templatePicker() {
    const generation = sessionGeneration, editor = modal;
    const result = await request('/api/salary-templates', { cache: false });
    if (generation !== sessionGeneration || editor !== modal || !draft) return;
    templateDialog = CourseDetails.dialog('使用模板', `<div class="salary-table-cards">${result.templates.map(row => `<button class="btn salary-table-card" data-template-id="${row.id}"><b>${escapeHtml(row.name)}</b><span>更新：${escapeHtml(row.updated_at)}</span></button>`).join('') || '<p class="empty">暂无薪资模板</p>'}</div>`);
    templateDialog.element.classList.add('salary-template-dialog');
    const dialog = templateDialog;
    templateDialog.element.querySelectorAll('[data-template-id]').forEach(button => { button.onclick = async () => {
      if (gridRules().some(rule => rule.formula.trim()) && !confirm('使用模板将覆盖当前已填写的薪资规则，是否继续？')) return;
      button.disabled = true;
      try {
        const result = await request(`/api/salary-templates/${button.dataset.templateId}/use`, { method: 'POST', body: {} });
        if (generation !== sessionGeneration || editor !== modal || templateDialog !== dialog || !dialog.element.isConnected) return;
        modal.querySelectorAll('.salary-formula-input').forEach(input => { input.value = result.template.rules.find(rule => rule.grade === input.dataset.grade && rule.course_type === input.dataset.type)?.formula || ''; });
        previews(); templateDialog.close(); templateDialog = null;
      } catch (error) { showToast(error.message, 'error'); }
      finally { button.disabled = false; }
    }; });
  }
  function previews() {
    modal?.querySelectorAll('[data-salary-preview]').forEach(cell => {
      const input = [...modal.querySelectorAll('.salary-formula-input')].find(input => input.dataset.grade === cell.dataset.salaryPreview && input.dataset.type === '小班课');
      try { cell.textContent = input?.value.trim() ? SalaryFormula.format(SalaryFormula.evaluate(input.value, 6)) : '—'; }
      catch (error) { cell.textContent = error.message; }
    });
  }
  async function action(event) {
    const button = event.target.closest('[data-salary-action]');
    const row = event.target.closest('[data-salary-class]');
    if (row && !button) return showClass(row.dataset.salaryClass);
    if (!button) return;
    const task = button.dataset.salaryAction;
    try {
      if (task === 'close') return close();
      if (task === 'legacy-detail' || task === 'classes') { legacyDetail = task === 'legacy-detail'; render(); return; }
      if (task === 'tables') return await showTables();
      if (task === 'legacy') { close(); setActiveView('teacherSalaryRules'); await load({ refreshGlobal: false }); return; }
      if (task === 'new' || task === 'edit') return editTable(Number(button.dataset.id) || null);
      if (!writable() || (['save', 'delete'].includes(task) && !tablesWritable)) return;
      if (task === 'template-add' && tablesWritable) return templateNameDialog();
      if (task === 'template-use' && tablesWritable) return await templatePicker();
      button.disabled = true;
      if (task === 'auto') {
        await request(`/api/teacher-detail/salary/${button.dataset.id}`, { method: 'PATCH', body: { source: 'auto' } });
        await refresh();
      }
      if (task === 'save') {
        const body = { ...draft, name: modal.querySelector('#salary-table-name').value, rules: [...modal.querySelectorAll('.salary-formula-input')].map(input => ({ grade: input.dataset.grade, course_type: input.dataset.type, formula: input.value })) };
        await request(`/api/salary-tables${draft.id ? `/${draft.id}` : ''}`, { method: draft.id ? 'PUT' : 'POST', body });
        await refresh(); await showTables();
      }
      if (task === 'delete') {
        const impact = await request(`/api/salary-tables/${button.dataset.id}/impact`, { cache: false });
        if (!confirm('确认删除这张薪资表？')) return;
        if (impact.affected && !confirm(`将影响 ${impact.affected} 节课程的规则薪资重新计算，特殊薪资保留。是否继续？`)) return;
        await request(`/api/salary-tables/${button.dataset.id}`, { method: 'DELETE', body: { affected: impact.affected, updated_at: impact.updated_at, confirm: true } });
        await refresh(); await showTables();
      }
    } catch (error) { const target = modal?.querySelector('.salary-editor-error'); if (target) target.textContent = error.message; else showToast(error.message, 'error'); }
    finally { if (button.isConnected) button.disabled = false; }
  }
  document.addEventListener('click', action);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal && !activeDateRangePicker) close();
    if (event.key === 'Enter' && event.target.matches('[data-salary-class]')) showClass(event.target.dataset.salaryClass);
    if (event.key === 'Tab' && modal && !templateDialog?.element.isConnected) {
      const items = [...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(node => node.getClientRects().length);
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }
  });
  document.addEventListener('input', event => { if (event.target.matches('.salary-formula-input')) previews(); });
  document.addEventListener('change', async event => {
    const input = event.target;
    try {
      if (input.id === 'salary-hide-departed') { hideDeparted = input.checked; await load({ refreshGlobal: false }); }
      if (input.matches('.salary-base-input')) { await request(`/api/teacher-detail/salary/${input.dataset.id}`, { method: 'PATCH', body: { source: 'manual', amount: input.value } }); await refresh(); }
      if (input.matches('.salary-coefficient-input')) { if (input.validity.badInput) throw new Error('绩效系数必须为 0.00～1.00 的数字'); await request('/api/teacher-monthly-performance', { method: 'PUT', body: { teacher_name: input.dataset.teacher, month_key: state.settings.month_key, coefficient: input.value.trim() === '' ? null : input.value } }); await refresh(); }
    } catch (error) { showToast(error.message, 'error'); }
  });
  return {
    renderDetail, bounds, manager, writable,
    resetView: () => { legacyDetail = false; close(); },
    close,
    resetSession: () => { sessionGeneration++; legacyDetail = false; close(); data = { tables: [], classes: [], lessons: [] }; tables = []; range = null; hideDeparted = true; },
    candidatesUrl: () => `/api/teacher-detail/teachers?include_inactive=${hideDeparted ? 0 : 1}`,
    setData: value => { data = value || { tables: [], classes: [], lessons: [] }; },
    applyRange: async (scope, start, end) => {
      if (scope === 'salary-table-editor') { if (draft) Object.assign(draft, { effective_start: start, effective_end: end }); return true; }
      if (scope === 'teacher-detail-salary') { range = start && end ? { start, end } : null; await load({ refreshGlobal: false }); return true; }
      return false;
    },
  };
})();
