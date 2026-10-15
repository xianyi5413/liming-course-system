const {test}=require('node:test');
const assert=require('node:assert/strict');
const W=require('../src/domain/salary_workflow');
test('class ordering uses grades then subjects and normalized type sets without changing identity',()=>{
 const base={teacher:'张三',subject:'数学',students_key:'李四、王五'};
 const grades=['高三','初三','高一','初一','高二','初二'].map((grade,id)=>({...base,grade,id,course_types:['1V1']}));
 assert.deepEqual(grades.sort(W.compareClasses).map(r=>r.grade),W.GRADES);
 const rows=[['1V3'],['自定义乙'],['小班课'],['1V2','1V1'],['1V1'],['自定义甲'],['1V2']].map((course_types,id)=>({...base,grade:'高一',id,course_types}));
 const ordered=rows.slice().sort(W.compareClasses);
 assert.deepEqual(ordered.slice(0,5).map(r=>W.courseTypes(r.course_types)),[['1V1'],['1V1','1V2'],['1V2'],['1V3'],['小班课']]);
 assert.deepEqual(rows.slice().reverse().sort(W.compareClasses),ordered);
 const mixed={lesson_ids:[]};for(const [id,course_type] of ['1V3','1V1','1V2'].entries())W.addClassLesson(mixed,{id,course_type});
 assert.equal(mixed.course_count,3);assert.deepEqual(mixed.course_types,['1V1','1V2','1V3']);
 assert.equal(W.classKey({...base,teacher_name:base.teacher,student_names:'王五、李四',course_type:'1V1'}),W.classKey({...base,teacher_name:base.teacher,student_names:'李四、王五',course_type:'1V3'}));
 assert.ok(W.compareClasses({...base,grade:'初一',subject:'物理'},{...base,grade:'初一',subject:'英语'})<0);
 assert.ok(W.compareClasses({...base,grade:'高三'},{...base,grade:''})<0);
});
