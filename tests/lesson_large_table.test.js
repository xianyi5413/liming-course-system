const assert = require('node:assert/strict');
const { test } = require('node:test');
const { benchmark } = require('./helpers/lesson_benchmark');

test('500/2000/6000 lessons retain full-result selection, pagination, editing and responsive menus', { timeout: 180000 }, async t => {
  const result = await benchmark({ verify: async (browser, measurements) => {
    for (const item of measurements) await t.test(`${item.count} courses mount bounded rows and operable menus`, () => {
      assert.equal(item.rows, 100);
      assert.ok(item.nodes < 15000, JSON.stringify(item));
      assert.ok(item.menus.teacher_names < 500, JSON.stringify(item));
      assert.ok(item.menus.student_names < 500, JSON.stringify(item));
    });
    await t.test('all-select includes unmounted IDs and the last page keeps display numbering', async () => {
      await browser.click('.lesson-select-all');
      assert.equal(await browser.evaluate('selectedLessonIds.size'), 6000);
      await browser.click('[data-lesson-page="60"]');
      assert.equal(await browser.evaluate('document.querySelector("#lessons-tbody tr[data-row-id] .col-serial").textContent.trim()'), '5901');
      assert.equal(await browser.evaluate('document.querySelectorAll(".lesson-select-row:checked").length'), 100);
      assert.equal(await browser.evaluate('selectedLessonIds.size'), 6000);
      await browser.click('.lesson-select-all');
      assert.equal(await browser.evaluate('selectedLessonIds.size'), 0);
      await browser.evaluate('scheduleMode=true;lessonPage=1;reRenderLessonsTbody();');
      await browser.click('#lessons-tbody .schedule-student-popover .multi-select-toggle');
      assert.equal(await browser.evaluate("document.querySelectorAll('.floating-multi-select-menu').length"),1);
      await browser.click('[data-lesson-page="2"]');
      assert.equal(await browser.evaluate("document.querySelectorAll('.floating-multi-select-menu').length"),0);

    });
    await t.test('inline editors are exclusive in both directions and paging information is right aligned', async () => {
      await browser.evaluate('scheduleMode=false;lessonPage=1;reRenderLessonsTbody();');
      assert.equal(await browser.evaluate("document.querySelectorAll('#lessons-tbody .schedule-student-popover,#lessons-tbody [data-lesson-edit-trigger]').length"),0);
      await browser.evaluate('scheduleMode=true;reRenderLessonsTbody();');
      for (const field of ['subject','grade','teacher_name','time_slot','classroom','status']) {
        await browser.click('#lessons-tbody .schedule-student-popover .multi-select-toggle');
        await browser.click(`#lessons-tbody [data-field="${field}"][data-lesson-edit-trigger]`);
        assert.equal(await browser.evaluate("document.querySelectorAll('.floating-multi-select-menu').length"),0);
        assert.equal(await browser.evaluate('Boolean(activeScheduleInlinePicker)'),true);
        await browser.click('#lessons-tbody .schedule-student-popover .multi-select-toggle');
        assert.equal(await browser.evaluate('Boolean(activeScheduleInlinePicker)'),false);
        assert.equal(await browser.evaluate("document.querySelectorAll('.floating-multi-select-menu').length"),1);
        await browser.evaluate('closeOpenMultiSelectMenus()');
      }
      await browser.click('#lessons-tbody [data-field="subject"][data-lesson-edit-trigger]');
      await browser.evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}))");
      assert.equal(await browser.evaluate('Boolean(activeScheduleInlinePicker)'),false);
      await browser.click('#lessons-tbody [data-field="subject"][data-lesson-edit-trigger]');
      await browser.evaluate("document.body.click()");
      assert.equal(await browser.evaluate('Boolean(activeScheduleInlinePicker)'),false);
      await browser.click('#lessons-tbody [data-field="subject"][data-lesson-edit-trigger]');
      await browser.evaluate("setActiveView('dashboard');render();setActiveView('lessons');render()");
      assert.equal(await browser.evaluate('Boolean(activeScheduleInlinePicker)'),false);
      const footer=await browser.evaluate("({text:document.querySelector('.lesson-pagination').textContent,align:getComputedStyle(document.querySelector('.lesson-pagination')).justifyContent})");
      assert.match(footer.text,/共6000节，显示1–100节/);assert.doesNotMatch(footer.text,/全选作用/);assert.equal(footer.align,'flex-end');
    });
    await t.test('both modes, long sets, bounded notes, sticky headers and outer scroll at five widths', async () => {
      for (const width of [1920,1440,1280,1024,390]) {
        await browser.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
        for (const editing of [false,true]) {
          await browser.evaluate(`scheduleMode=${editing};lessonPage=1;reRenderLessonsTbody();`);
          const layout = await browser.evaluate(`(()=>{const table=document.querySelector('.lesson-table'),wrap=table.closest('.table-wrap'),rows=[...table.querySelectorAll('tbody tr[data-row-id]')];wrap.scrollTop=150;wrap.scrollLeft=200;return {rows:rows.length,page:document.documentElement.scrollWidth<=innerWidth,outer:wrap.scrollWidth>wrap.clientWidth,scroll:getComputedStyle(wrap).overflowX,white:rows.every(row=>[...row.cells].every(cell=>getComputedStyle(cell).whiteSpace==='nowrap')),sets:rows.every(row=>{const badges=[...row.querySelectorAll('.lesson-student-badges .student-badge')];return badges.length===6&&new Set(badges.map(b=>b.getBoundingClientRect().top)).size===1}),heights:rows.map(r=>r.getBoundingClientRect().height),sticky:[...table.tHead.rows[0].cells].every(c=>getComputedStyle(c).position==='sticky'),aligned:[...rows[0].cells].every((cell,i)=>Math.abs(cell.getBoundingClientRect().left-table.tHead.rows[0].cells[i].getBoundingClientRect().left)<2)};})()`);
          assert.equal(layout.rows,100); assert.ok(layout.page,JSON.stringify({width,editing,layout}));
          assert.ok(layout.outer); assert.match(layout.scroll,/auto|scroll/);
          assert.ok(layout.white); assert.ok(layout.sets,JSON.stringify({width,editing,layout}));
          assert.ok(layout.sticky); assert.ok(layout.aligned);
          assert.ok(Math.max(...layout.heights)-Math.min(...layout.heights)<=1,JSON.stringify(layout.heights));
        }
      }
    });
    await t.test('filter search and rapid field changes use latest full-result data', async () => {
      await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
      await browser.evaluate('scheduleMode=false;render();');
      await browser.click('.lesson-filter-region .multi-select[data-field="student_names"] .multi-select-toggle');
      assert.ok(await browser.evaluate(`(()=>{const owner=document.querySelector('.lesson-filter-region .multi-select[data-field="student_names"]');const input=multiSelectMenuFor(owner).querySelector('.multi-select-search');input.value='测试学生19';input.dispatchEvent(new Event('input',{bubbles:true}));return owner.classList.contains('open')&&document.activeElement===input;})()`));
      await browser.waitFor(`(()=>{const menu=multiSelectMenuFor(document.querySelector('.lesson-filter-region .multi-select[data-field="student_names"]'));return menu.querySelectorAll('.multi-select-option').length===1&&menu.querySelector('.multi-select-option').dataset.value==='测试学生19';})()`);
      await browser.send('Page.bringToFront');
      await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await browser.evaluate(`(()=>{for(const grade of ['初一','高一']){const input=document.querySelector('.lesson-filter-region .multi-select[data-field="grade"] .multi-select-value');input.value=grade;input.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
      await browser.waitFor(`visibleLessonRows().length===3000&&[...document.querySelectorAll('#lessons-tbody tr[data-row-id]')].every(r=>r.querySelector('.col-grade').textContent==='高一')`);
      assert.equal(await browser.evaluate('lessonPage'),1);
      await browser.click('.lesson-select-all'); assert.equal(await browser.evaluate('selectedLessonIds.size'),3000);
      await browser.evaluate(`lessonFilter.grade='';selectedLessonIds.clear();updateLessonsViewDom();`);
    });
    await t.test('stale date responses and navigation cannot replace current data', async () => {
      const outcome = await browser.evaluate(`(async()=>{const original=request,oldFilter={...lessonFilter},pending=[];request=(url)=>new Promise(resolve=>pending.push(resolve));try{lessonFilter.start_date='2026-01-01';const old=loadLessonRangeOnly();lessonFilter.start_date='2026-02-01';const latest=loadLessonRangeOnly();pending[1]({lessons:[{id:77}]});await latest;pending[0]({lessons:[{id:66}]});await old;const first=state.lessons[0].id;const leaving=loadLessonRangeOnly();setActiveView('dashboard');pending[2]({lessons:[{id:88}]});await leaving;return [first,state.lessons[0].id];}finally{request=original;lessonFilter=oldFilter;state.lessons=benchmarkLessons.slice();setActiveView('lessons');render();}})()`);
      assert.deepEqual(outcome,[77,77]);
    });
    await t.test('editing a later page persists the real ID and preserves selection and filters', async () => {
      const expectedPage=await browser.evaluate(`(async()=>{const created=await request('/api/lessons',{method:'POST',body:{teacher_name:'分页编辑教师',date:'2026-12-31',time_slot:'20:00-21:00',classroom:'分页编辑教室',grade:'高一',subject:'数学',student_names:'分页编辑学生',status:'待上',month_key:'2026-12-01'}});appendLessonToState(created);scheduleMode=true;lessonPage=Math.floor(visibleLessonRows().findIndex(row=>row.id===created.id)/LESSON_PAGE_SIZE)+1;reRenderLessonsTbody();window.pageEditId=created.id;return lessonPage;})()`);
      assert.ok(expectedPage>1);
      const id=await browser.evaluate(`(()=>{const field=document.querySelector('#lessons-tbody .lesson-field[data-id="'+pageEditId+'"][data-field="notes"]');const id=Number(field.dataset.id);selectedLessonIds.add(id);field.value='分页备注修改';field.dispatchEvent(new Event('change',{bubbles:true}));return id;})()`);
      await browser.waitFor(`state.lessons.find(row=>row.id===${id})?.notes==='分页备注修改'`);
      const saved=await browser.evaluate(`(async()=>{const response=await fetch('/api/lessons-range?start=2026-01-01&end=2026-12-31');const data=await response.json();return {note:data.lessons.find(row=>row.id===${id}).notes,page:lessonPage,selected:selectedLessonIds.has(${id}),start:lessonFilter.start_date};})()`);
      assert.deepEqual(saved,{note:'分页备注修改',page:expectedPage,selected:true,start:'2026-01-01'});
    });
    await t.test('date-bucket conflict checks and cache include unmounted records and changed fields', async () => {
      const checked=await browser.evaluate(`(()=>{const base={date:'2026-01-01',time_slot:'09:00-11:00',teacher_name:'甲',student_names:'张三',classroom:'A',status:'已上'};const rows=[{...base,id:1},{...base,id:2},{...base,id:3,date:'2026-01-02'},{...base,id:4,status:'请假',lesson_status:'请假',course_status:'请假'}];const initial=lessonConflictState(rows).issues.map(issue=>[issue.type,issue.lesson_ids]);rows[1].date='2026-01-03';const changed=lessonConflictState(rows).issues.length;return {initial,changed};})()`);
      assert.deepEqual(checked.initial.map(item=>item[0]).sort(),['classroom','student','teacher']);
      checked.initial.forEach(item=>assert.deepEqual(item[1],[1,2]));
      assert.equal(checked.changed,0);
    });
  }});
  assert.equal(result.api.rows,6000);
  assert.deepEqual(result.exceptions,[]);
  assert.deepEqual(result.consoleErrors,[]);
});
