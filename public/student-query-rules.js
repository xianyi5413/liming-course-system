"use strict";

function syncQueryRuleSelection() {
  const ids = studentQueryRules.map(row => Number(row.id));
  const count = ids.filter(id => queryRuleSelection.has(id)).length;
  document.querySelectorAll('.query-rule-select').forEach(input => { input.checked = queryRuleSelection.has(Number(input.dataset.id)); });
  const all = document.querySelector('.query-rule-select-all');
  if (all) { all.checked = ids.length > 0 && count === ids.length; all.indeterminate = count > 0 && count < ids.length; }
  const button = document.querySelector('.query-rule-batch');
  if (button) button.disabled = !count || !canEditStudentPricing();
  const label = document.querySelector('.query-rule-selection-count');
  if (label) label.textContent = count ? `已选${count}条` : '';
}

function openQueryRuleBatch() {
  if (!canEditStudentPricing()) return;
  const ids = studentQueryRules.filter(row => queryRuleSelection.has(Number(row.id))).map(row => Number(row.id));
  if (!ids.length) return;
  const key = studentStatementCacheKey(), account = auth.user?.id;
  let closed = false;
  queryRuleBatchDialog?.close();
  const dialog = queryRuleBatchDialog = CourseDetails.dialog('批量设置规则费用', `<p>已选${ids.length}条规则</p>
    <p>规则跨月份共用：将修改这些规则在全部月份的对账费用，不只影响当前日期范围。新建且跟随规则的课程会同步计算实际费用和余额；旧课程收费方式及手动覆盖不变。0元沿用未设置候选语义。单次最多500条规则。</p>
    <label>新的规则费用 ${currencyInputMarkup('', {className:'query-batch-price', attrs:'required min="0" max="100000" step="0.01"'})}</label>
    <div class="modal-actions"><button class="btn primary query-batch-confirm">确认</button><button class="btn query-batch-cancel">取消</button></div>`, {onClose:()=>{closed=true;queryRuleBatchDialog=null;}});
  dialog.element.querySelector('.query-batch-cancel').onclick = dialog.close;
  dialog.element.querySelector('.query-batch-confirm').onclick = async event => {
    const input = dialog.element.querySelector('input');
    if (!input.reportValidity() || event.currentTarget.disabled) return;
    if (key !== studentStatementCacheKey() || account !== auth.user?.id || view !== 'studentQuery') { dialog.close(); return; }
    const button = event.currentTarget; button.disabled = true;
    try {
      await request('/api/student-pricing/batch?' + new URLSearchParams({student:selectedStudent,...currentStudentQueryRange()}), {method:'PATCH',body:{ids,price:input.value}});
      if (closed || account !== auth.user?.id || key !== studentStatementCacheKey() || view !== 'studentQuery') return;
      dialog.close();
      await refreshStudentQueryOnly({force:true});
      for (const page of ['studentSummary','summary','finance']) markDirty(page);
      showToast('所选规则费用已更新');
    } catch(error) { if (!closed) { showToast(error.message, 'error'); button.disabled=false; } }
  };
}

async function expandQueryRuleCourses() {
  const token = ++queryExpansionGeneration, key = studentStatementCacheKey();
  const parent = document.querySelector('.student-pricing-table > tbody');
  if (!parent || !queryRulesExpanded || !studentQueryRules.length) return;
  const current = () => token === queryExpansionGeneration && queryRulesExpanded && view === 'studentQuery' && key === studentStatementCacheKey() && parent.isConnected;
  parent.querySelectorAll('.query-rule-details').forEach(row => row.remove());
  try {
    const result = await request('/api/student-pricing-query?' + new URLSearchParams({student:selectedStudent,...currentStudentQueryRange(),include_courses:'1'}), {cache:false});
    if (!current()) return;
    const ruleRows = new Map([...parent.children].filter(row => row.classList.contains('student-pricing-rule-row')).map(row => [Number(row.dataset.ruleId), row]));
    const tables = [], pendingGroups = [];
    const flushGroups = () => { for (const [row, child] of pendingGroups) row.after(child); pendingGroups.length=0; };
    let rowsSinceYield = 0, lastYield = performance.now();
    for (const rule of studentQueryRules) {
      if (!current()) return;
      const row = ruleRows.get(Number(rule.id));
      if (!row) continue;
      const lessons = result.courses?.[rule.id] || [];
      const child = document.createElement('tr'); child.className='query-rule-details';
      const cell = document.createElement('td'); cell.colSpan=13; child.append(cell);
      if (lessons.length > 48) row.after(child); else pendingGroups.push([row, child]);
      const fees = item => `<td class="right ${item.rule_fee != null && Math.round(item.unit_price*100)!==Math.round(item.rule_fee*100) ? 'negative' : ''}">${item.unit_price == null ? '—（不计费）' : formatMoney(item.unit_price)}</td><td class="right">${item.rule_fee == null ? '—' : formatMoney(item.rule_fee)}</td>`;
      cell.innerHTML = '<div class="query-rule-detail-progress">正在加载课程…</div>' + CourseDetails.table([], {feeCells:fees, selection:result.can_edit_fee});
      const body = cell.querySelector('tbody');
      for (let start=0; start<lessons.length; start+=48) {
        if (!current()) return;
        const holder=document.createElement('div');
        holder.innerHTML=CourseDetails.table(lessons.slice(start,start+48),{feeCells:fees,selection:result.can_edit_fee});
        [...holder.querySelector('tbody').children].forEach((item,index)=>{ item.children[result.can_edit_fee ? 1 : 0].innerHTML=String(start+index+1); body.append(item); });
        rowsSinceYield += Math.min(48, lessons.length-start);
        if (rowsSinceYield >= 48 || performance.now()-lastYield >= 8) {
          await new Promise(resolve=>setTimeout(resolve,0)); rowsSinceYield=0; lastYield=performance.now();
        }
      }
      if (!current()) return;
      cell.querySelector('.query-rule-detail-progress').remove();
      if(result.can_edit_fee) bindCourseFeeSelection(cell,{student_name:result.student_name,lessons},()=>refreshStudentQueryOnly({force:true}));
      if (pendingGroups.length >= 24) flushGroups();
      const table = cell.querySelector('table'); table.dataset.adaptiveGroup='student-query-courses'; tables.push(table);
      if (performance.now()-lastYield >= 8) {
        await new Promise(resolve=>setTimeout(resolve,0)); rowsSinceYield=0; lastYield=performance.now();
      }
    }
    if (!current()) return;
    flushGroups();
    if (tables.length) applyAdaptiveTableColumns({table:tables[0],peerTables:tables.slice(1)});
  } catch(error) { if (current()) showToast(error.message || '课程展开失败，请重试','error'); }
}

// Both inline groups and dialogs use this selection, preview and transaction UI.
function bindCourseFeeSelection(root, result, onSaved, {beforePreview = () => true} = {}) {
  const selected=new Set(), account=auth.user?.id, key=studentStatementCacheKey();
  const toolbar=document.createElement('div'); toolbar.className='query-course-toolbar';
  toolbar.innerHTML='<button class="btn query-course-batch" disabled>批量设置实际费用</button><span class="query-course-count"></span>';
  root.prepend(toolbar);
  const button=toolbar.querySelector('button');
  const valid=()=>root.isConnected && auth.user?.id===account && key===studentStatementCacheKey() && view==='studentQuery';
  const eligible=()=>result.lessons.filter(row=>row.can_edit_fee).map(row=>Number(row.id));
  let busy=false;
  const sync=()=>{
    root.dataset.feeBatchBusy=String(busy);
    const ids=eligible();
    root.querySelectorAll('.query-course-select').forEach(input=>{input.checked=selected.has(Number(input.dataset.id));input.disabled=busy || !ids.includes(Number(input.dataset.id));});
    const all=root.querySelector('.query-course-select-all');
    if(all){all.checked=ids.length>0 && ids.every(id=>selected.has(id));all.indeterminate=selected.size>0&&!all.checked;all.disabled=busy||!ids.length;}
    button.disabled=busy||!selected.size;
    toolbar.querySelector('span').textContent=selected.size ? `已选${selected.size}节` : '';
  };
  root.addEventListener('change',event=>{
    const input=event.target.closest('.query-course-select,.query-course-select-all');
    if(!input||busy||!valid())return;
    const ids=input.classList.contains('query-course-select-all')?eligible():[Number(input.dataset.id)];
    for(const id of ids)if(eligible().includes(id)){if(input.checked)selected.add(id);else selected.delete(id);}
    sync();
  });
  button.onclick=async()=>{
    if(busy||!valid()||!selected.size)return;
    if (!beforePreview()) return;
    busy=true;sync();
    const endpoint='/api/fee-overrides/restore-rule?'+new URLSearchParams(currentStudentQueryRange());
    try{
      const preview=await request(endpoint,{method:'POST',body:{action:'preview',lesson_ids:[...selected],student_name:result.student_name}});
      if(!valid())return;
      const changed=preview.items.filter(item=>item.action==='restore'),same=preview.items.filter(item=>item.action==='unchanged'),skipped=preview.items.filter(item=>item.action==='skip');
      let closed=false;
      const confirmation=CourseDetails.dialog('确认批量设置实际费用',`<p>确认后，将可恢复课程的实际费用调整为各自的规则费用。</p><p class="negative">${escapeHtml(preview.warning)}</p><p>已选${preview.items.length}节；需修改${changed.length}节；已一致${same.length}节；无法处理${skipped.length}节。</p>
        <div class="table-wrap"><table class="uniform-table nowrap-table"><thead><tr><th>日期</th><th>课程ID</th><th>原实际费用</th><th>规则费用</th><th>差额</th><th>处理方式或原因</th></tr></thead><tbody>${preview.items.map(item=>`<tr><td>${escapeHtml(item.date)}</td><td>${item.lesson_id}</td><td>${formatMoney(item.actual)}</td><td>${item.target==null?'—':formatMoney(item.target)}</td><td>${item.difference==null?'—':formatMoney(item.difference)}</td><td>${escapeHtml(item.reason)}</td></tr>`).join('')}</tbody></table></div>
        <div class="modal-actions"><button class="btn primary query-fee-confirm" ${changed.length?'':'disabled'}>确认恢复${changed.length}节</button><button class="btn query-fee-cancel">取消</button></div>`,{onClose:()=>{closed=true;busy=false;queryFeeConfirmDialogs.delete(confirmation);sync();}});
      queryFeeConfirmDialogs.add(confirmation);
      confirmation.element.querySelector('.query-fee-cancel').onclick=confirmation.close;
      confirmation.element.querySelector('.query-fee-confirm').onclick=async event=>{
        if(event.currentTarget.disabled||closed)return;
        if(!valid()){confirmation.close();return;}
        const confirmButton=event.currentTarget;confirmButton.disabled=true;
        try{
          const saved=await request(endpoint,{method:'POST',body:{action:'apply',token:preview.token}});
          if(!closed)confirmation.close();
          if(!valid())return;
          for(const item of changed){const row=result.lessons.find(row=>row.id===item.lesson_id);if(row)row.unit_price=item.target;}
          selected.clear();sync();
          for(const page of ['studentSummary','summary','finance'])markDirty(page);
          await onSaved();
          showToast(`恢复${saved.updated}节，已一致${saved.unchanged}节，未处理${saved.skipped}节`);
        }catch(error){if(!closed){showToast(error.message,'error');confirmation.close();}}
      };
    }catch(error){if(valid())showToast(error.message,'error');busy=false;sync();}
  };
  sync();
  return {sync};
}
