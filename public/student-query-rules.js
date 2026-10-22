"use strict";

// Money-only refreshes keep table/row identities, selectors, selection and scroll intact.
let queryMoneyViewGeneration = 0, queryMoneyRefreshGeneration = 0;
const queryFeeEditors = new Set(), queryRuleSavingIds = new Set();
function queryMoneyContext() {
  return {key:studentStatementCacheKey(), account:auth.user?.id, generation:queryMoneyViewGeneration, region:document.querySelector('.student-query-results')};
}
function queryMoneyContextCurrent(context) {
  return view === 'studentQuery' && context.account === auth.user?.id && context.key === studentStatementCacheKey()
    && context.generation === queryMoneyViewGeneration && context.region?.isConnected;
}
function syncQueryRuleAmounts(rows) {
  const changed = new Map(rows.map(row=>[Number(row.id),prepareStudentPricingRule(row)]));
  studentQueryRules = studentQueryRules.map(row=>changed.has(Number(row.id)) ? {...row,...changed.get(Number(row.id))} : row);
  studentPricingVisibleRows = studentQueryRules;
  for (const element of document.querySelectorAll('.student-pricing-rule-row')) {
    const row=changed.get(Number(element.dataset.ruleId)); if(!row)continue;
    const notes=element.querySelector('[data-field="notes"]');
    if(notes){notes.parentElement.title=row.notes || '';if(document.activeElement!==notes)notes.value=row.notes || '';}
    const input=element.querySelector('[data-field="custom_price"]'), amount=row.rule_fee ?? row.custom_price;
    if(input && (input.dataset.saving === '1' || document.activeElement !== input)) {
      input.value=moneyInput(amount);
      input.dataset.expectedPrice=String(row.custom_price);
      const display=input.closest('.currency-input-wrap').querySelector('.currency-display');
      const label=row.rule_fee === null ? '—' : formatMoney(amount);
      if(display.textContent!==label)display.textContent=label;
    }
  }
}
async function refreshStudentQueryMoney(context = queryMoneyContext()) {
  if(!queryMoneyContextCurrent(context))return;
  const generation=++queryMoneyRefreshGeneration, revision=requestCacheRevision;
  const editors=[...queryFeeEditors].filter(editor=>editor.root.isConnected && editor.student===selectedStudent);
  const params=new URLSearchParams({student:selectedStudent,...currentStudentQueryRange()});
  if(editors.length)params.set('include_courses','money');
  const [report,pricing]=await Promise.all([fetchStudentStatement(selectedStudent,true),request('/api/student-pricing-query?'+params,{cache:false})]);
  if(!queryMoneyContextCurrent(context) || generation!==queryMoneyRefreshGeneration)return;
  if(revision!==requestCacheRevision)return refreshStudentQueryMoney(context);
  syncQueryRuleAmounts(pricing.rules);
  const byId=new Map((pricing.lessons || []).map(row=>[Number(row.id),row]));
  for(const editor of editors)editor.sync(byId);
  state.student_statement=report;
  updateStudentQueryResultsOnly(report,{preserveDetails:true});
}

function syncQueryRuleSelection() {
  const ids = studentQueryRules.map(row => Number(row.id));
  const count = ids.filter(id => queryRuleSelection.has(id)).length;
  document.querySelectorAll('.query-rule-select').forEach(input => { input.checked = queryRuleSelection.has(Number(input.dataset.id)); });
  const all = document.querySelector('.query-rule-select-all');
  if (all) { all.checked = ids.length > 0 && count === ids.length; all.indeterminate = count > 0 && count < ids.length; }
  const button = document.querySelector('.query-rule-batch');
  if (button) button.disabled = !count || !canEditStudentPricing() || queryRuleSavingIds.size>0;
  document.querySelectorAll('.student-pricing-field').forEach(input=>{input.disabled=!canEditStudentPricing() || queryRuleSavingIds.has(Number(input.dataset.id));});
  const label = document.querySelector('.query-rule-selection-count');
  if (label) label.textContent = count ? `已选${count}条` : '';
}

function openQueryRuleBatch() {
  if (!canEditStudentPricing() || queryRuleSavingIds.size) return;
  const ids = studentQueryRules.filter(row => queryRuleSelection.has(Number(row.id))).map(row => Number(row.id));
  if (!ids.length) return;
  const key = studentStatementCacheKey(), account = auth.user?.id, context=queryMoneyContext();
  const expected_prices=ids.map(id=>({id,custom_price:studentQueryRules.find(row=>Number(row.id)===id).custom_price}));
  let closed = false;
  queryRuleBatchDialog?.close();
  const dialog = queryRuleBatchDialog = CourseDetails.dialog('批量设置规则费用', `<p>已选${ids.length}条规则</p>
    <p>规则跨月份共用：将修改这些规则在全部月份的对账费用，不只影响当前日期范围。新建且跟随规则的课程会同步计算实际费用和余额；旧课程收费方式及手动覆盖不变。0元沿用未设置候选语义。单次最多500条规则。</p>
    <label class="money-form-field">新的规则费用 ${currencyInputMarkup('', {className:'query-batch-price', attrs:'required min="0" max="100000" step="0.01"'})}</label>
    <div class="modal-actions"><button class="btn primary query-batch-confirm">确认</button><button class="btn query-batch-cancel">取消</button></div>`, {size:'compact',onClose:()=>{closed=true;queryRuleBatchDialog=null;}});
  dialog.element.querySelector('.query-batch-cancel').onclick = dialog.close;
  dialog.element.querySelector('.query-batch-confirm').onclick = async event => {
    const input = dialog.element.querySelector('input');
    if (!input.reportValidity() || event.currentTarget.disabled) return;
    if (key !== studentStatementCacheKey() || account !== auth.user?.id || view !== 'studentQuery') { dialog.close(); return; }
    if(queryRuleSavingIds.size)return;
    for(const id of ids)queryRuleSavingIds.add(id); syncQueryRuleSelection();
    const button = event.currentTarget; button.disabled = true;
    try {
      const saved=await request('/api/student-pricing/batch?' + new URLSearchParams({student:selectedStudent,...currentStudentQueryRange()}), {method:'PATCH',body:{ids,price:input.value,expected_prices}});
      for (const page of ['studentSummary','summary','finance']) markDirty(page);
      if (closed || account !== auth.user?.id || key !== studentStatementCacheKey() || view !== 'studentQuery') return;
      if(!queryMoneyContextCurrent(context))return;
      syncQueryRuleAmounts(saved.rows);
      dialog.close();
      try { await refreshStudentQueryMoney(context); } catch(error) { showToast('规则已保存，统计同步失败：'+error.message,'error'); }
      showToast('所选规则费用已更新');
    } catch(error) { if (!closed) { showToast(error.message, 'error'); button.disabled=false; } }
    finally { for(const id of ids)queryRuleSavingIds.delete(id); syncQueryRuleSelection(); }
  };
}

async function expandQueryRuleCourses() {
  const token = ++queryExpansionGeneration, key = studentStatementCacheKey();
  const root = document.querySelector('.query-course-view');
  if (!root || !queryRulesExpanded || !selectedStudent) return;
  const current = () => token === queryExpansionGeneration && queryRulesExpanded && view === 'studentQuery' && key === studentStatementCacheKey() && root.isConnected;
  try {
    const result = await request('/api/student-pricing-query?' + new URLSearchParams({student:selectedStudent,...currentStudentQueryRange(),include_courses:'flat'}), {cache:false});
    if (!current()) return;
    const fees = row => studentCourseFeeCell(row,result)+`<td class="right pricing-course-rule-fee">${row.rule_fee==null?'—':formatMoney(row.rule_fee)}</td>`;
    root.innerHTML = '<div class="query-course-progress">正在加载课程…</div>'+CourseDetails.table([], {feeCells:fees,selection:result.can_edit_fee && canWriteData()});
    const body=root.querySelector('tbody');
    for(let start=0;start<result.lessons.length;start+=48){
      if(!current())return;
      const holder=document.createElement('div');
      holder.innerHTML=CourseDetails.table(result.lessons.slice(start,start+48),{feeCells:fees,selection:result.can_edit_fee && canWriteData(),indexOffset:start});
      body.append(...holder.querySelector('tbody').children);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(!current())return;
    if(!result.lessons.length)body.innerHTML=`<tr><td colspan="${result.can_edit_fee && canWriteData()?15:14}" class="empty">当前范围暂无课程</td></tr>`;
    root.querySelector('.query-course-progress').remove();
    queryCourseEditorCleanup=bindStudentCourseFeeEditor(root,result);
    applyAdaptiveTableColumns({table:root.querySelector('table')});
    root.dataset.renderComplete='true';
  } catch(error) { if(current()){root.querySelector('.query-course-progress').textContent='课程加载失败，请折叠后重试';showToast(error.message,'error');} }
}

// The flat view and dialogs use this selection, preview and transaction UI.
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
    const ids=eligible(), allowed=new Set(ids);
    root.querySelectorAll('.query-course-select').forEach(input=>{input.checked=selected.has(Number(input.dataset.id));input.disabled=busy || !allowed.has(Number(input.dataset.id));});
    const all=root.querySelector('.query-course-select-all');
    if(all){all.checked=ids.length>0 && ids.every(id=>selected.has(id));all.indeterminate=selected.size>0&&!all.checked;all.disabled=busy||!ids.length;}
    button.disabled=busy||!selected.size;
    toolbar.querySelector('span').textContent=selected.size ? `已选${selected.size}节` : '';
  };
  root.addEventListener('change',event=>{
    const input=event.target.closest('.query-course-select,.query-course-select-all');
    if(!input||busy||!valid())return;
    const ids=input.classList.contains('query-course-select-all')?eligible():[Number(input.dataset.id)];
    const allowed=new Set(eligible());
    for(const id of ids)if(allowed.has(id)){if(input.checked)selected.add(id);else selected.delete(id);}
    sync();
  });
  button.onclick=async()=>{
    if(busy||!valid()||!selected.size)return;
    if (!beforePreview()) return;
    busy=true;sync();
    const endpoint='/api/fee-overrides/restore-rule?'+new URLSearchParams(currentStudentQueryRange());
    try{
      const preview=await request(endpoint,{method:'POST',body:{action:'preview',lesson_ids:[...selected],student_name:result.student_name,mode:'set_actual'}});
      if(!valid())return;
      const changed=preview.items.filter(item=>item.action==='set'),same=preview.items.filter(item=>item.action==='unchanged'),skipped=preview.items.filter(item=>item.action==='skip');
      let closed=false;
      const total=items=>Math.round(items.reduce((sum,item)=>sum+Math.round(item.actual*100),0))/100;
      const before=total(preview.items), difference=Math.round(changed.reduce((sum,item)=>sum+Math.round(item.difference*100),0))/100;
      const reasons=[...new Set(skipped.map(item=>item.reason))].join('；');
      const confirmation=CourseDetails.dialog('批量设置实际费用',`<p>已选${preview.items.length}节，预计修改${changed.length}节${same.length ? `，已一致${same.length}节` : ''}。</p>
        <p>将选中课程的实际费用调整为各自对应的规则费用，保存为本次确认的人工金额；不会切换课程收费模式。</p>
        <dl class="fee-change-totals"><dt>原实际费用合计</dt><dd>${formatMoney(before)}</dd><dt>调整后费用合计</dt><dd>${formatMoney(before+difference)}</dd><dt>差额</dt><dd>${difference>0?'+':''}${formatMoney(difference)}</dd></dl>
        ${skipped.length ? `<p class="negative">${skipped.length}节无法处理：${escapeHtml(reasons)}</p>` : ''}
        <details><summary>查看修改明细</summary><div class="table-wrap"><table class="uniform-table nowrap-table"><thead><tr><th>日期</th><th>课程ID</th><th>原实际费用</th><th>规则费用</th><th>差额</th><th>处理方式或原因</th></tr></thead><tbody>${preview.items.map(item=>`<tr><td>${escapeHtml(item.date)}</td><td>${item.lesson_id}</td><td>${formatMoney(item.actual)}</td><td>${item.target==null?'—':formatMoney(item.target)}</td><td>${item.difference==null?'—':formatMoney(item.difference)}</td><td>${escapeHtml(item.reason)}</td></tr>`).join('')}</tbody></table></div></details>
        <div class="modal-actions"><button class="btn primary query-fee-confirm" ${changed.length?'':'disabled'}>确认修改</button><button class="btn query-fee-cancel">取消</button></div>`,{size:'compact',onClose:()=>{closed=true;busy=false;queryFeeConfirmDialogs.delete(confirmation);sync();}});
      queryFeeConfirmDialogs.add(confirmation);
      confirmation.element.querySelector('.query-fee-cancel').onclick=confirmation.close;
      confirmation.element.querySelector('.query-fee-confirm').onclick=async event=>{
        if(event.currentTarget.disabled||closed)return;
        if(!valid()){confirmation.close();return;}
        const confirmButton=event.currentTarget;confirmButton.disabled=true;
        try{
          const saved=await request(endpoint,{method:'POST',body:{action:'apply',token:preview.token}});
          for(const page of ['studentSummary','summary','finance'])markDirty(page);
          if(!closed)confirmation.close();
          if(!valid())return;
          const rowsById=new Map(result.lessons.map(row=>[Number(row.id),row]));
          for(const item of saved.rows){const row=rowsById.get(Number(item.lesson_id));if(row)row.unit_price=item.unit_price;}
          selected.clear();sync();
          try { await onSaved(saved.rows); } catch(error) { showToast('费用已保存，统计同步失败：'+error.message,'error'); }
          showToast(`已修改${saved.updated}节，已一致${saved.unchanged}节，未处理${saved.skipped}节`);
        }catch(error){if(!closed){showToast(error.message,'error');confirmation.close();}}
      };
    }catch(error){if(valid())showToast(error.message,'error');busy=false;sync();}
  };
  sync();
  return {sync};
}
