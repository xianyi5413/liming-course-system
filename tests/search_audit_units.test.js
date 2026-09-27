const { test } = require('node:test');
const assert = require('node:assert/strict');
const search = require('../public/search');
const { formatAuditChange, formatSetDiff } = require('../src/domain/audit_change');

test('shared search supports Chinese, full pinyin, initials, case, spaces, English and numbers', () => {
  for (const query of ['蔡文姬','caiwenji','cwj',' CAI  WEN JI ','']) assert.ok(search.matchesSearchQuery('蔡文姬',query),query);
  for (const query of ['wuchangze','WCZ']) assert.ok(search.matchesSearchQuery('吴昌泽',query));
  assert.ok(search.matchesSearchQuery('Alice 2026','ALICE 2026'));
  assert.ok(search.matchesSearchQuery('Alice 2026','2026'));
  assert.equal(search.matchesSearchQuery('蔡文姬','wcz'),false);
});

test('pinyin index reuses conversions across rapid input and refreshes without stale names', () => {
  search.clear();
  const values = Array.from({length:1500},(_,i)=>`蔡文姬${i}`);
  search.prime(values);
  const before = search.stats().conversions, started = performance.now();
  for(const query of ['c','ca','cai','caiw','caiwenji','cwj']) assert.equal(values.filter(value=>search.matchesSearchQuery(value,query)).length,1500);
  assert.equal(search.stats().conversions,before);
  console.log(JSON.stringify({searchRows:values.length,queries:6,ms:performance.now()-started,repeatedConversions:0}));
  search.clear(); search.prime(['吴昌泽']);
  assert.equal(search.matchesSearchQuery('吴昌泽','cwj'),false);assert.ok(search.matchesSearchQuery('吴昌泽','wcz'));
});

test('audit student-set changes describe additions, removals and reorder-only no-ops', () => {
  assert.equal(formatSetDiff('蔡文姬、王昭君','蔡文姬、王昭君、貂蝉'),'在学生集合中加入“貂蝉”');
  assert.equal(formatSetDiff('蔡文姬、王昭君','蔡文姬'),'从学生集合中移除“王昭君”');
  assert.equal(formatSetDiff('蔡文姬、王昭君','蔡文姬、貂蝉'),'学生集合加入“貂蝉”，移除“王昭君”');
  assert.equal(formatSetDiff('蔡文姬、王昭君','王昭君,蔡文姬,蔡文姬'),'');
  assert.equal(formatSetDiff('["蔡文姬","Alice Li"]',['Alice Li','蔡文姬']), '');
});

test('audit formatter uses business names and excludes credentials and internal IDs', () => {
  const before={teacher_name:'何君',date:'2026-07-01',time_slot:'10:00-12:00',classroom:'C3',status:'待上',grade:'初二',subject:'数学',course_type:'1V1',notes:'旧备注'};
  const after={teacher_name:'吴昌泽',date:'2026-07-03',time_slot:'13:30-15:30',classroom:'B4',status:'已上',grade:'初三',subject:'物理',course_type:'1V2',notes:'',password:'synthetic-secret',token:'synthetic-token',teacher_id:45};
  const output=formatAuditChange(before,after);
  for(const label of ['授课老师','上课日期','上课时间','教室','课程状态','年级','科目','课程类型','清空课程备注'])assert.ok(output.includes(label),label);
  assert.doesNotMatch(output,/teacher_id|password|token|synthetic-secret|synthetic-token|notes|subject_id/);
});
