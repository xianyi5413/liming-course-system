# 课程状态候选与空值规则

实现与定向验收完成时间：2026-11-20 10:37（北京时间）。版本 `20261120-detail-permission-status`。

## 根因

旧bootstrapLookups返回的是全库课程实际用过的statuses；前端statusValues直接采用该数组，即使它为空，也不会使用defaultCourseStatuses。编辑候选因此可能缺少“待上”或其他尚未使用的内置状态。配置的自定义状态也可能尚未进入已用状态集合。

scheduleInlinePickerOptions复用了默认附加“未选”的manualSelectOptions。选择“未选”提交空status，原服务端允许保存；rowStatus依据旧lesson_status／course_status回退，无已上等标志时显示“待上”。这不是颜色把文字隐藏，也不是下拉选项的label/value被交换。

隔离库仅有“已上”和历史自定义课程时，旧候选缺少“待上”；直接执行基线函数得到候选[已上]、空值显示待上，复现了两段链路。

## 统一规则

1. bootstrap候选合并六个内置状态、settings.custom_course_statuses和历史实际状态并去重；前端statusValues再合并默认值，兼容旧的缺项响应。
2. getStatusOptions保留当前值；rowStatus优先显示非空真实值，不再让候选列表是否包含它决定历史课程显示。只有历史空值继续使用旧字段兼容回退。
3. 课程总表、批量复制的状态编辑不提供空选项；新建及冲突编辑原本已禁止空选项，保持一致。其他可空字段仍可“未选”。
4. normalizeLessonPersistenceInput对显式status空串、空白和null返回400。省略状态的新建流程仍按原规则默认待上；未修改的历史空值不迁移。
5. 保留原deriveStatus计费推导、历史课程数量、数据库状态及Excel恢复内容。对未在配置字典登记的旧自定义状态，本轮保留显示及原有财务解释，不擅自重新定义计费。
6. insertLesson保存非空原状态，新建及批量复制不把手填／历史自定义值覆盖为待上。copyLessons遇到源课程历史空值时，只为新副本采用原旧字段推导的显示状态；不修改源课程，也不影响直接提交空状态仍返回400的规则。

## 验证与线上限制

Edge 157验证六个内置状态和配置自定义状态在排课下拉中可见，选择后SQLite值准确；普通浏览显示一致，刷新保持，明暗主题正常。额外检查手填状态、旧空值兼容、显式空值拒绝、共享弹窗浮层关闭、班级管理及家长／老师课程PNG生成。完整Excel v14保存真实状态和自定义配置；未批量改写课程。

对[正式站点](https://www.limingedu.fun/)仅GET首页、资源和/api/version：线上仍返回20261113-tuoguan-grade-hover-summary，Git SHA为空。下载的app.js、tuoguan.js和styles.css与基线规范化换行后相同，原始哈希差异仅来自换行。业务/api/bootstrap返回401，无法确认线上实际候选内容、历史空值数量或用户浏览器缓存。没有登录生产系统、修改真实课程或部署。

若正式发布后仍异常，人工重新登录并检查新资源参数、/api/version及bootstrap的lookups.status；不应通过编辑真实课程、清空浏览器全部数据或批量改历史状态来验收。
