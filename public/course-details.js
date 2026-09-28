'use strict';

// Course lists share field definitions, formatting, sizing and the outer scroll.
const CourseDetails = (() => {
  function table(rows, { salaryCells = null, typeCell = null, className = '' } = {}) {
    const fields = salaryCells
      ? ['teacher_name', 'date', 'weekday', 'time_slot', 'classroom', 'status', 'grade', 'subject', 'course_type', 'student_names', 'notes']
      : ['teacher_name', 'date', 'weekday', 'time_slot', 'classroom', 'course_type', 'status', 'grade', 'subject', 'student_names', 'notes'];
    const labels = { teacher_name: salaryCells ? '老师' : '授课老师', date: '日期', weekday: '星期', time_slot: '时间', classroom: '教室', status: '状态', grade: '年级', subject: '科目', course_type: '类型', student_names: '学生', notes: '备注' };
    const column = field => field === 'notes' ? '<col data-column-type="note">' : `<col data-column-type="full" data-min-width="0" data-alignment="center">`;
    const cell = (row, field) => {
      if (field === 'course_type' && typeCell) return typeCell(row);
      const value = field === 'weekday' ? escapeHtml(weekdayCn(row.date)) : field === 'status' ? statusBadge(rowStatus(row)) : field === 'grade' ? renderGradeBadge(row.grade) : field === 'subject' ? renderSubjectBadge(row.subject) : field === 'student_names' ? renderStudentSetBadges(row.student_names, { fallbackGrade: row.grade }) : escapeHtml(row[field] || '');
      return `<td>${value}</td>`;
    };
    return `<div class="table-wrap business-table-scroll"><table class="uniform-table nowrap-table compact-rows business-sticky-table course-details-table ${className}" data-adaptive-table="true" data-adaptive-natural="true"><colgroup>${rowIndexColumn()}${fields.map(column).join('')}${salaryCells ? '<col data-column-type="full" data-alignment="right"><col data-column-type="full" data-alignment="right">' : ''}</colgroup><thead><tr>${rowIndexHeader()}${fields.map(field => `<th>${labels[field]}</th>`).join('')}${salaryCells ? '<th>教师薪资</th><th>规则薪资</th>' : ''}</tr></thead><tbody>${rows.map((row, index) => `<tr data-course-detail-id="${row.id}">${renderRowIndex(index)}${fields.map(field => cell(row, field)).join('')}${salaryCells ? salaryCells(row) : ''}</tr>`).join('')}</tbody></table></div>`;
  }
  function dialog(title, body, { onClose = () => {} } = {}) {
    const focus = document.activeElement, element = document.createElement('div');
    element.className = 'modal-backdrop shared-course-dialog';
    element.innerHTML = `<div class="modal-panel salary-workflow-panel salary-lessons-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><div class="modal-head"><div class="modal-title">${escapeHtml(title)}</div><button class="btn dialog-close">关闭</button></div>${body}</div>`;
    const close = () => { element.remove(); focus?.focus({ preventScroll: true }); onClose(); };
    element.querySelector('.dialog-close').onclick = close;
    element.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const items = [...element.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(node => node.getClientRects().length);
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
      }
    });
    document.body.appendChild(element); element.querySelector('button').focus(); scheduleAdaptiveTableColumns();
    return { element, close };
  }
  return { table, dialog };
})();

const ClassCourseUI = (() => {
  let active = null, generation = 0;
  const editable = () => canWriteData() && ['owner', 'boss', 'admin', 'academic', 'jiaowu'].includes(auth.user?.role);
  function close() { generation++; active?.close(); active = null; }
  async function details(group) {
    close();
    const token = generation;
    const result = await request('/api/class-groups/courses?' + new URLSearchParams({ key: group.group_key }), { cache: false });
    if (token !== generation || !auth.user || view !== 'classGroups' || !result.lessons.length) return;
    const typeCell = row => `<td class="class-course-type" data-id="${row.id}" ${editable() ? 'role="button" tabindex="0" aria-haspopup="listbox"' : ''}><span class="lesson-inline-picker">${escapeHtml(row.course_type)}</span></td>`;
    active = CourseDetails.dialog(`${group.teacher} · ${group.grade} · ${group.subject} · ${group.course_type}`, CourseDetails.table(result.lessons, { typeCell, className: 'class-course-details' }), { onClose: () => { active = null; generation++; } });
    active.element.querySelectorAll('.class-course-type').forEach(cell => {
      const row = result.lessons.find(row => row.id === Number(cell.dataset.id));
      const open = () => { if (editable()) openInlineCustomPicker(cell, { id: row.id, field: 'course_type', choices: courseTypeSelectOptions(row.grade, row.course_type, false), onChange: async input => { try { await change(group, [row.id], input.value, 'lesson'); await details(group); } catch (error) { showToast(error.message, 'error'); } } }); };
      cell.onclick = event => { if (!event.target.closest('.custom-select')) open(); };
      cell.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); open(); } };
    });
  }
  async function change(group, ids, type, mode) {
    const account = auth.user?.id;
    const result = await request('/api/class-groups/course-type', { method: 'PATCH', body: { group_key: group.group_key, lesson_ids: ids, course_type: type, mode } });
    if (!auth.user || auth.user.id !== account || view !== 'classGroups') return;
    state.class_groups = result.class_groups;
    state.lesson_loaded_range = null;
    markLessonDerivedDataDirty();
    rerenderContent(renderClassGroups);
    showToast(`已更新 ${result.updated} 节课程类型`);
  }
  function bind() {
    document.querySelectorAll('.class-group-row').forEach(element => {
      const group = (state.class_groups || []).find(row => String(row.id) === element.dataset.classGroupId);
      element.onclick = event => {
        if (event.target.closest('button,input,select,textarea,a,[role="button"],.custom-select')) return;
        if (group?.course_count) details(group).catch(error => showToast(error.message, 'error'));
      };
      const cell = element.querySelector('.class-group-type-cell');
      if (!cell || !group?.course_count || !editable()) return;
      const open = () => openInlineCustomPicker(cell, { id: group.id, field: 'course_type', choices: courseTypeSelectOptions(group.grade, group.course_type, false), onChange: async input => {
        if (input.value === group.course_type) return;
        if (group.course_count > 1 && !confirm(`将把该班级下 ${group.course_count} 节课程的类型统一修改为‘${input.value}’，是否继续？`)) return;
        try { await change(group, group.lesson_ids, input.value, 'class'); } catch (error) { showToast(error.message, 'error'); }
      } });
      cell.onclick = event => { event.stopPropagation(); if (!event.target.closest('.custom-select')) open(); };
      cell.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); open(); } };
    });
  }
  return { bind, close, editable };
})();
