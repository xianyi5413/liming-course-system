# 黎明教育课程管理系统

面向单店教培机构的本地后台 MVP。`node src/server.js` 单进程跑起，`http://localhost:5177` 直接用。

技术栈：Node.js 24 内置 `http` + `node:sqlite` + 单文件 `public/app.js` + 单文件 `public/styles.css`。无前端框架，无构建步骤，无第三方运行时依赖。数据全部落 `data/liming-local.sqlite`。

## 运行

```bash
npm start              # 启动服务（端口 5177）
npm run init           # 仅初始化数据库后退出（不开服务）
python scripts/import_workbook.py <xlsx-path> --month YYYY-MM-01  # 从月度总表导入
```

数据库文件、上传文件、备份都在 `data/` 下：

- `data/liming-local.sqlite`：主库（WAL 模式）
- `data/backups/`：每次审计/月份强删/审计修复前自动留底的快照
- `data/uploads/`：xlsx 对账时上传的文件

## 数据模型

| 表 | 用途 |
| --- | --- |
| `lessons` | 月度课程总表，每行一节课，`student_names` 用顿号分隔多个学生，`status` 是规范化后的状态机字段，`teacher_salary` 是手填课时费 |
| `fee_overrides` | 单节课、单个学生的手动单价覆盖（最高优先级） |
| `student_pricing` | 学生×科目级的专享单价 |
| `pricing_standards` | 年级×班型（1对1/1对2/1对3/1对多）的标准单价 |
| `students` / `teachers` | 档案，软删除字段 `status` 标记在读/在职/离校/离职 |
| `recharge_records` | 学生月度充值/结转记录，以 `(student_name, month_key)` 为唯一键，`source='carry_over'` 标识自动结转 |
| `staff` / `staff_salary_monthly` | 非教师员工档案与月薪流水 |
| `teacher_adjustments_monthly` | 教师每月四周车贴，参与教师薪资合计 |
| `operating_expenses` | 房租/水电/食材等运营开销 |
| `audit_logs` / `audit_ignores` | 审计问题流水与忽略名单 |
| `settings` | 当前选定月份等系统配置 |

所有按月数据用 `month_key='YYYY-MM-01'` 分区，月份切换不影响历史数据。

## 已完成功能与对应逻辑

### 1. 排课（📅）

- **课程总表 `lessons`**：按月分页，可在表内直接改授课老师、日期、状态、时间、教室、年级、科目、学生名单、课时费、备注。
- **状态机**：唯一权威字段是 `status`（待上 / 已上 / 请假 / 试课 / 考试 / 未缴费），`lesson_status` + `course_status` 是兼容旧 xlsx 的双字段（`legacyStatusFields` / `deriveStatus` 双向同步）。
- **批量复制课程**：`POST /api/lessons/copy` 接受 `pairs:[{source_id, target_date}]` 或 `(source_lesson_ids[] × target_dates[])` 笛卡尔积，单次最多 200 行。复制的目标日期会按 `MAX(sort_order)+1` 追加，默认重置为「待上」。
- **冲突检测 `scheduleConflicts(monthKey)`**：跨课程同日同时段若同一老师/教室/共同学生，会标 `teacher` / `classroom` / `student` 三类冲突，时间段无法解析时标 `invalid_time`。
- **周课表**：把月份切成 4 周（`[1,8] [9,15] [16,22] [23,月末]`），按老师 / 学生两种受众生成可读视图，支持文本下载、SVG 图片包、PNG manifest 三种导出。

### 2. 学生（👥）

- **费用明细 `feeDetails`**：把每节课按学生展开成一行，每行的单价由 `unitPriceFor` 决定优先级 —— **手动覆盖 → 考试（强制 0） → 学生专享价 → 标准价**。`price_source` 字段把这个判定结果带回前端供调试。
- **学生费用汇总 `studentSummary`**：核心金额逻辑见下面 [金额结算口径](#金额结算口径)。
- **充值记录**：表内编辑 `prev_actual / prev_gift / cur_recharge / cur_gift / recharge_date / notes`，提交时按 `(student_name, month_key)` upsert。
- **从上月结转**：`/api/recharges/rollover?from=...&to=...` 把 `fromMonth` 的月末余额作为 `toMonth` 的 `prev_actual / prev_gift`。`shouldRefreshCarryOver` 决定哪些行可被覆盖：自动结转的行、或 `prev_actual=prev_gift=0` 的空行；任何手填非空记录会被跳过，UI 二次确认后允许 `force=1` 强刷。
- **学生查询**：选中学生后，`renderStudentQuery` 带出当月汇总 + 当月明细 + `studentHistoryRows` 跨月历史对比表。
- **学生单价 `student_pricing`**：可设置学生×科目专享价，UI 显示「当月用过 N 节 / 历史 M 节」帮助识别孤儿配置；偏离标准价 50% 以上会在保存时提示加备注（`pricingWarnings`）。
- **价格重算 `POST /api/pricing-recompute`**：把当月该学生该科目所有 `fee_overrides` 删除，让单价回到「专享价/标准价」，并把变更前后总价记入审计日志。

### 3. 教师（👨‍🏫）

- **教师薪资汇总**：`teacherSummary(monthKey)` 按老师汇总「有效课时数」、「课时合计」、四周车贴、备注；只有 `已上 / 未缴费` 状态的课才算入有效课时与课时合计（`isEffective`）。
- **教师明细**：选中老师查看当月课程明细及合计课时费。
- **车票 `teacher_adjustments_monthly`**：每老师每月四周车贴单独存，月份切换互不影响；`weightedTeacherTransport` 在自定义区间下按区间天数线性分摊。
- **xlsx 导出**：`/api/export/teacher-salary.xlsx` 直接由 `xlsxBuffer` 拼包，无第三方依赖。

### 4. 运营（💼）

- **员工档案 `staff`**：教学主管 / 教务主管 / 小助手 / 做饭阿姨 / 前台 / 其他六类。删除有薪资历史的员工会软删（保留状态=离职），无历史的硬删。
- **员工薪资 `staff_salary_monthly`**：访问月份时 `ensureStaffSalaryRows` 自动 `INSERT OR IGNORE` 把所有「在职/暂停」员工 seed 进当月，初值取员工档案的 `base_salary`，`bonus / deduction` 默认 0。
- **日常开销 `operating_expenses`**：按 `category` 分类，按 `expense_date` 时间筛选，支持 vendor/notes 模糊搜索。
- **创建月份/删除月份**：`POST /api/months` 会从最早数据月起一路 `ensureCarryOver` 到目标月，把每个中间月份的余额结转都补全；`DELETE /api/months/:key?force=1` 会把该月 `lessons / recharge_records / teacher_adjustments_monthly / staff_salary_monthly / operating_expenses` 清空，并自动备份 db。

### 5. 经营概览（📊）

- **`financeBase(range)`** 是入口，输出 `revenue / gift_consumption / teacher_cost / transport_cost / operating_cost / gross_profit / gross_margin / cash_in / gift_issued / net_cash_flow`。
- **环比 `previousEqualRange(range)`** 取相邻等长区间。
- **分布 `financeBreakdowns`**：年级×收入、科目×收入、班型×收入×毛利率、Top 10 学生消费、老师 ROI（贡献/课时费）、低余额名单（实际余额 < 平均单次课费）、未缴费课时清单。
- **6 个月趋势 `financeTrend6m`**：以 `range.end` 所在月为锚，往前数 6 个月，每月独立跑一次 `financeBase(monthRange)`。
- **`balance_sheet`**：月末沉淀现金 `total_actual_balance`、月末赠送余额 `total_gift_balance`、应收账款 `accounts_receivable`（仅统计 `状态=未缴费` 的课）。
- **导出 CSV**：`/api/export/finance-summary.csv` 输出当期快照。

### 6. 设置 / 数据对账（⚙️）

- **费用标准 `pricing_standards`**：可改单价。年级 + 班型 → 单价的两维表（高/初年级班型档位略有差异，见 `priceBucket`）。
- **数据对账（审计）**：
  - **内部审计 `internalAudit(monthKey)`**：检测多年级学生、缺年级学生、相似的老师/学生姓名（Levenshtein ≤ 1）、孤儿专享价、专享价偏离标准价 30% 以上、有效课时单价 0。
  - **xlsx 对账 `runNodeXlsxAudit`**：上传 xlsx「N月总表」，按 `(date, teacher, time_slot)` 三元组比对每节课的字段差异，输出可一键回填的 patch。
  - **审计修复 `applyAuditIssues`**：批量应用 patch；CRITICAL 默认拒绝，需要 `confirm_critical=true`。
  - **忽略 `audit_ignores`**：用 `issue_key`（来源/类型/实体/字段/前后值的拼串）记忆已忽略的问题，下一次审计直接跳过。
- **档案管理**：教师/学生/员工档案的 CRUD，软删除策略统一。

### 通用基础设施

- **xlsx / zip 自实现**：服务端 `unzipXlsx` / `zipStore` 直接处理 ZIP 文件结构，没有 `xlsx` / `archiver` 之类依赖。前端 `zipStoreFiles` 镜像同样的实现，用于客户端 PNG 打包。
- **审计日志去重**：用 `issue_key` 做去重 key，相同问题再次出现时只更新 `run_at` 不新建条目。
- **多月结转链 `ensureCarryOverChain`**：进入任何月份页面前，自动从最早数据月推导到当前月，确保中间月份的结转记录都齐。
- **暗色 / 亮色主题**：顶栏切换，`localStorage` 持久化，`prefers-color-scheme` 跟随系统。

## 金额结算口径

每个月每个学生的余额按下式结算（见 `studentSummary`）：

```
actualBase       = prevActual + curRecharge + min(prevGift, 0)
allFunds         = prevActual + curRecharge + prevGift + curGift
actualConsumption = min(totalFee, max(0, actualBase))
giftConsumption   = min(max(0, totalFee - actualConsumption), max(0, prevGift) + curGift)

if actualBase ≥ totalFee:
   actualBalance = actualBase - totalFee
   giftBalance   = max(prevGift, 0) + curGift
else:
   actualBalance = min(0, allFunds - totalFee)   # 总资金不够时为负
   giftBalance   = max(0, allFunds - totalFee)
```

口径要点：

- **现金优先消费，赠送兜底**：实际现金（含上月结转 + 本月充值）先消耗课程费用，不足部分用赠送余额顶。
- **负的上月赠送结转会扣减实际余额**（`+ min(prevGift, 0)`），避免赠送账户成为永久"负债悬空"。
- **总资金不足时**实际余额变负、赠送余额清零；正常情况下两边的余额拆分都保证 `actual + gift == 总充值 - 总费用`。
- **finance.revenue 是收入认现口径**：`revenue += unit_price × (actual_consumption / total_fee)`，按「学生当月实际消费占学生当月应付」的比例把每节课计入收入。学生没付钱的课时不计收入，仅在余额上体现为负数或在 `accounts_receivable` 体现（限 `状态=未缴费` 的课）。

## 已知 bug / 风险（重点关注金额相关）

按严重程度排序。复审过 `unitPriceFor / studentSummary / financeBase / weightedTeacherTransport / weightedStaffSalary / ensureCarryOver / rolloverRecharges / recomputePricing / patchExpense / upsertStaffSalary / deleteMonth` 等所有金额触达点。

### 高（建议尽快修）

1. **应收账款口径不全**
   `balance_sheet.accounts_receivable` 只统计 `状态=未缴费` 的课；状态为「已上」但学生账户余额不足造成的 `actual_balance < 0` 没被并进应收，仅以负余额形式藏在 `total_actual_balance` 内。月底对账容易漏估真实欠款。建议把 `actual_balance` 的负值之和也并入应收，或在 UI 单独列出来。

2. **专享价 `custom_price = 0` 会强制把课时价覆盖为 0**
   `unitPriceFor` 里 `if (custom && custom.custom_price !== "")` —— 0 不等于空串，所以专享单价 0 元会越过标准价。`internalAudit` 的 `price_zero` 兜底告警，但创建/修改专享价时没有阻止 0 元保存，对账时容易误以为是专享免单。建议在 `POST /api/student-pricing` 拒绝 `custom_price <= 0`，或显式让 0 元 fall back 到标准价。

3. **`recomputePricing` 静默删除手填覆盖**
   学生单价的「重算」按钮会把这个学生该科目下**所有**节课的 `fee_overrides` 一并删除，但 UI 措辞是「重算」，容易让人以为只是刷新。审计日志里有记一笔且把清除条数返回给前端，但 UI 上没有显式的二次确认。建议在执行前弹窗显示要清除几条手填覆盖。

4. **强删月份会破坏后续月份的结转链**
   `DELETE /api/months/:key?force=1` 会把该月 `recharge_records` 也删掉。后一个月里源自被删月的 `prev_actual / prev_gift` 仍是旧值，系统不会自动重算。如果用户没意识到这一点直接强删，会出现"金额对不上"。备份是兜底，但需要 UI 显式提示「会让 X 月的结转失效，是否一起重算？」。

### 中（语义不一致或边界数据可能踩坑）

5. **`previousEqualRange` 用滑动窗口而不是自然月**
   月度视图下，"上期"对比是当前区间起点之前 N 天（N=本期天数）。例如 4 月 30 天，"上月"会拿到 3.2–3.31 30 天的窗口，不包含 3.1。环比百分比会和直觉对不上。建议在 `range` 等于自然月时改用真实的上一自然月，自定义区间再用滑动窗口。

6. **未填 `recharge_date` 时 fall back 到月初**
   `rechargesInRange` 用 `COALESCE(NULLIF(recharge_date, ''), month_key)`。在半月级 finance 自定义区间（如 4.16–4.30）下，本月里没填日期的充值会落到 4.1，被错排除。建议要么在录入时强制日期，要么 fall back 到月末。

7. **Finance 自定义区间下，员工薪资和老师车贴按"日数线性比例"**
   `weightedStaffSalary` 和 `weightedTeacherTransport` 用 `overlapDays / monthDays` 做权重。但员工工资是月度发放、不可日切，半月视图会显示一半工资，半月利润分析会被低估。建议自定义区间下显式提示"成本按时间分摊"，或允许用户在 UI 选择"成本不分摊"。

8. **`gross_margin` 也走 `pctChange`**
   毛利率（百分数）也跑 month-over-month 百分比。25% → 30% 报"+20.0%"，意思是"毛利率本身上升 20%"，不是"+5pp"。经营者容易误读。建议比例类指标改成 `pp`（百分点）差。

9. **同步学生年级会被 lesson 上的错误年级覆盖**
   `syncStudentsFromLessons` 用 `COALESCE(NULLIF(excluded.grade,''), students.grade)`，最后一次遍历到的非空 lesson 年级会写入档案。某节课误录入错年级，会污染学生档案。审计的 `grade_inconsistency` 能兜底，但同步本身仍写入。建议只在 `students.grade` 为空时填年级，不要覆盖。

10. **`staff_salary_monthly.salary_actual` 和 `expected_salary` 双源**
    存储字段 `salary_actual` 取 INSERT 时的 `base_salary` 快照，但 SELECT 同时返回 `expected_salary`（用当前 `base_salary` 重算）。员工调薪后历史月份的两栏会不一致，UI 上一旦展示 `expected` 会让历史月看起来"工资变了"。`weightedStaffSalary` 用的是 stored salary_actual，所以经营概览的运营成本是稳定的。建议 UI 上明确区分"按当时基薪"和"按当前基薪"，或干脆不返回 `expected_salary`。

11. **试课 / 考试的老师课时费完全靠手填**
    `teacherSummary` 只把 `已上 / 未缴费` 计入老师课时合计；试课、考试不计入。`lessons.teacher_salary` 是手填字段，没有跟单价或学生数联动。如果机构对试课/监考有薪资政策，目前需要在每节课的 `teacher_salary` 单元格里手动维护。

### 低（边界 / 体验）

12. **`upsertStaffSalary` 对离职员工的保护过严**
    只要 `staff.status='离职'` 且当月已经存在 salary 行，任何修改都被拒。即使要修复历史录入错误也得先把员工恢复在职。

13. **`expense q` 模糊查询不转义 `%` `_`**
    用户搜 `2_` 之类时会触发 SQL LIKE 通配。本地工具，影响小。

14. **`splitStudents` 不规范化中间空格**
    "小 明" 与 "小明" 被当成两个学生。审计的 `student_typo` 用 levenshtein 兜底，但平时录入时不会自动合并。

15. **`audit_logs` 用 severity='info' 等非标准值时不计入 `severityCounts`**
    `pricing_recompute` 写日志的 severity 不在 `CRITICAL/HIGH/MEDIUM/LOW/WARN` 之列，前端汇总时会被吞掉。

## 受限范围（不在 MVP 内）

- 多机构 / 多分店 / 多用户登录
- 移动端 / 离线 / 同步到云
- 微信、企业微信、电话、短信集成
- 财务凭证 / 发票 / 税务
- 学生学习记录 / 错题本 / 测评
