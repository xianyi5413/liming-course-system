# 黎明教育课程管理系统

面向单店教培机构的本地后台 MVP。`node src/server.js` 单进程跑起，`http://localhost:5177` 直接用。

技术栈：Node.js 24 内置 `http` + `node:sqlite` + 单文件 `public/app.js` + 单文件 `public/styles.css`。无前端框架，无构建步骤，无第三方运行时依赖。数据全部落 `data/liming-local.sqlite`。

## 运行

```bash
npm start              # 启动服务（端口 5177）
npm run init           # 仅初始化数据库后退出（不开服务）
python scripts/import_workbook.py <xlsx-path>  # 自动识别月份并导入总表、充值、学生单价、费用标准、教师车票
```

如果「教师薪资汇总」页 A 列是未计算出来的动态公式（导入时报无法识别教师姓名），先用 Excel/WPS 打开并保存一次；或临时用 `--teacher-order 老师1,老师2,...` 指定第 3 行起的老师顺序。

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

### 模块总览

| 模块 | 入口 | 核心职责 | 主要数据表 |
| --- | --- | --- | --- |
| 排课 | 📅 | 月度课程录入、状态管理、冲突检测、周课表导出 | `lessons` |
| 学生 | 👥 | 学生档案、费用明细、充值结转、专享价管理 | `students` / `recharge_records` / `student_pricing` / `fee_overrides` |
| 教师 | 👨‍🏫 | 教师薪资汇总、四周车贴、xlsx 导出 | `teachers` / `teacher_adjustments_monthly` |
| 运营 | 💼 | 员工档案与薪资、日常开销、月份生命周期 | `staff` / `staff_salary_monthly` / `operating_expenses` |
| 经营概览 | 📊 | 财务汇总、环比、分布、6 月趋势、资产负债 | 跨表只读 |
| 设置 / 数据对账 | ⚙️ | 标准单价、内部审计、xlsx 对账、档案 CRUD | `pricing_standards` / `audit_logs` / `audit_ignores` |

---

### 1. 排课（📅）

核心数据表 `lessons`，每行 = 一节课，多个学生用顿号分隔写在 `student_names`。

| 子功能 | 实现 | 说明 |
| --- | --- | --- |
| 月度总表 | 表内直接编辑 | 字段：授课老师 / 日期 / 状态 / 时间 / 教室 / 年级 / 科目 / 学生名单 / 课时费 / 备注 |
| 状态机 | 权威字段 `status` | 取值：待上 / 已上 / 请假 / 试课 / 考试 / 未缴费；`legacyStatusFields` + `deriveStatus` 与旧 xlsx 的 `lesson_status` / `course_status` 双向同步 |
| 批量复制课程 | `POST /api/lessons/copy` | 接受 `pairs:[{source_id, target_date}]` 或 `(source_lesson_ids[] × target_dates[])` 笛卡尔积；单次 ≤ 200 行；目标日期按 `MAX(sort_order)+1` 追加，状态重置为「待上」 |
| 冲突检测 | `scheduleConflicts(monthKey)` | 同日同时段同老师 / 教室 / 共同学生 → `teacher` / `classroom` / `student` 三类；时间段无法解析 → `invalid_time` |
| 周课表导出 | 月份切 4 周（`[1,8] [9,15] [16,22] [23,月末]`） | 按老师 / 学生两种受众生成可读视图；支持文本下载、SVG 图片包、PNG manifest 三种导出 |

---

### 2. 学生（👥）

#### 2.1 单价决定优先级（`unitPriceFor`）

按下列顺序逐级回退（高 → 低），命中即停止；`feeDetails` 把每节课按学生展开成一行，`price_source` 字段把命中的优先级带回前端供调试：

| 优先级 | 触发条件 | 单价 | `price_source` |
| --- | --- | --- | --- |
| 1 | `lessons.status = '试课'` | 0 | `trial` |
| 2 | `fee_overrides` 命中 `(lesson_id, student_name)` | 取覆盖值 | `manual` |
| 3 | `lessons.status = '考试'` | 0 | `exam` |
| 4 | `student_pricing.custom_price > 0` | 取专享价 | `custom` |
| 5 | `student_pricing.custom_price = 0` 且备注不含「试」字 | 0（视为免单） | `waiver` |
| 6 | 兜底 | `pricing_standards`（年级 × 班型） | `standard` |

> 录入约束：`POST/PATCH /api/student-pricing` 拒绝 `custom_price ≤ 0`；规则 5 仅作为存量数据兜底语义，新建/编辑专享价时无法保存 0。

> 收入计入口径：`isBillableDetail` 控制是否计入 `revenue` —— 默认只看 `已上 / 未缴费`；考试课例外，仅当 `price_source='manual'` 且单价 > 0 时才参与（用于「考试也按节收费」的特殊场景）。

#### 2.2 子功能

| 子功能 | 实现 | 说明 |
| --- | --- | --- |
| 学生费用汇总 | `studentSummary` | 详见下文 [金额结算口径](#金额结算口径) |
| 充值记录 | 表内编辑 + upsert | 字段：`prev_actual / prev_gift / cur_recharge / cur_gift / recharge_date / notes`；以 `(student_name, month_key)` 唯一键 upsert |
| 上月结转 | `GET /api/recharges/rollover?from=...&to=...` + `ensureCarryOver` 自动刷新 | 把上月月末余额作为本月 `prev_actual / prev_gift`；`shouldRefreshCarryOver` 决定可覆盖范围（自动结转行 / 全空行）；上游月数据变化后，下游月自动结转行会在下次访问时被刷新；任何手填非空记录会被跳过，UI 二次确认后允许 `force=1` 强刷 |
| 学生查询 | `renderStudentQuery` | 选中学生 → 当月汇总 + 当月明细 + `studentHistoryRows` 跨月历史对比 |
| 学生专享价 | `student_pricing` | 学生×科目；UI 支持按学生/备注、科目、价格状态、本月/历史影响筛选，并显示「当月用过 N 节 / 历史 M 节」识别孤儿配置；偏离标准价 ≥ 50% 时保存提示加备注（`pricingWarnings`） |
| 价格重算 | `POST /api/pricing-recompute` | 删除当月该学生该科目所有 `fee_overrides`（让单价回到专享/标准价）；变更前后总价写入审计日志 |

---

### 3. 教师（👨‍🏫）

| 子功能 | 实现 | 说明 |
| --- | --- | --- |
| 教师薪资汇总 | `teacherSummary(monthKey)` | 输出：有效课时数 / 课时合计 / 四周车贴 / 备注；只有 `已上 / 未缴费` 计入有效课时（`isEffective`） |
| 教师明细 | 选老师 → 当月课程明细 | 表底显示合计课时费 |
| 四周车贴 | `teacher_adjustments_monthly` | 每老师每月四周分别存；自定义区间下 `weightedTeacherTransport` 按区间天数线性分摊 |
| xlsx 导出 | `GET /api/export/teacher-salary.xlsx` | 由 `xlsxBuffer` 自实现拼包，无第三方依赖 |

---

### 4. 运营（💼）

| 子功能 | 实现 | 说明 |
| --- | --- | --- |
| 员工档案 | `staff` | 六类：教学主管 / 教务主管 / 小助手 / 做饭阿姨 / 前台 / 其他；有薪资历史 → 软删（status = 离职），无历史 → 硬删 |
| 员工薪资 | `staff_salary_monthly` + `ensureStaffSalaryRows` | 访问月份时 `INSERT OR IGNORE` 把所有「在职/暂停」员工 seed 进当月；初值取档案 `base_salary`，`bonus / deduction` 默认 0 |
| 日常开销 | `operating_expenses` | 按 `category` 分类、`expense_date` 时间筛选、`vendor` / `notes` 模糊搜索 |
| 创建月份 | `POST /api/months` | 从最早数据月起一路 `ensureCarryOver` 到目标月，补全所有中间月份的余额结转 |
| 删除月份 | `DELETE /api/months/:key?force=1` | 有数据时返回 `blocked: 'has_data'` + 各表行数；UI 弹出二次确认弹窗，需手输 `month_key` 字符串才能解锁删除按钮；执行时清空 `lessons` / `recharge_records` / `teacher_adjustments_monthly` / `staff_salary_monthly` / `operating_expenses`，并写入 `pre_month_delete` 备份 |

---

### 5. 经营概览（📊）

入口：`financeBase(range)`，输出 10 项核心指标。

#### 5.1 核心指标（`financeBase`）

| 指标 | 含义 |
| --- | --- |
| `revenue` | 收入（按学生当月实付占比认现，详见金额口径） |
| `gift_consumption` | 赠送余额消耗 |
| `teacher_cost` | 教师课时费 |
| `transport_cost` | 教师车贴 |
| `operating_cost` | 员工薪资 + 日常开销 |
| `gross_profit` | 毛利 = `revenue` − `teacher_cost` − `transport_cost` − `operating_cost` |
| `gross_margin` | 毛利率 |
| `cash_in` | 当期现金充值 |
| `gift_issued` | 当期赠送发放 |
| `net_cash_flow` | 净现金流 |

#### 5.2 衍生分析

| 板块 | 实现 | 说明 |
| --- | --- | --- |
| 环比 | `previousEqualRange(range)` | 取相邻等长区间 |
| 分布 | `financeBreakdowns` | 年级×收入、科目×收入、班型×收入×毛利率、Top 10 学生消费、老师 ROI（贡献/课时费）、低余额名单（实际余额 < 平均单次课费）、未缴费课时清单 |
| 6 月趋势 | `financeTrend6m` | 以 `range.end` 所在月为锚，往前 6 个月，每月独立跑一次 `financeBase(monthRange)` |
| 资产负债 | `balance_sheet` | 四档拆分：`total_actual_balance`（月末沉淀正现金）/ `total_gift_balance`（月末赠送余额）/ `unpaid_lesson_receivable`（`状态=未缴费` 的课时金额）/ `account_debt_receivable`（学生 `actual_balance` 负值合计，即已上但欠款）；`accounts_receivable` = 按学生取 `unpaid` 与 `debt` 的最大值后求和，避免双重计入 |
| CSV 导出 | `GET /api/export/finance-summary.csv` | 当期快照 |

---

### 6. 设置 / 数据对账（⚙️）

#### 6.1 子功能

| 子功能 | 实现 | 说明 |
| --- | --- | --- |
| 标准单价 | `pricing_standards` | 年级 × 班型 → 单价；高/初年级班型档位略有差异（见 `priceBucket`） |
| 内部审计 | `internalAudit(monthKey)` | 检测项见下表；离校 / 已流出学生不参与姓名相似 / 孤儿专享价检查 |
| xlsx 对账 | `runNodeXlsxAudit` | 上传 xlsx「N月总表」，按 `(date, teacher, time_slot)` 三元组比对每节课字段差异，输出可一键回填的 patch |
| 审计修复 | `applyAuditIssues` | 批量应用 patch；CRITICAL 默认拒绝，需 `confirm_critical=true` |
| 问题去重 | `auditIssueKey` + `visibleAuditIssues` | 用 `issue_key`（来源/类型/实体/字段/前后值的拼串）做主键，相同问题重复出现时复用同一条 |
| 忽略列表 | `audit_ignores` | 用同一 `issue_key` 持久化已忽略问题，跨审计运行保留，UI 侧显示「已忽略」分组 |
| 档案管理 | 教师 / 学生 / 员工 CRUD | 软删除策略统一 |

#### 6.2 内部审计检测项

| 类型 | 严重度 | 触发条件 |
| --- | --- | --- |
| `grade_inconsistency` | CRITICAL | 同一学生同月出现在多个年级 |
| `missing_grade` | MEDIUM | 学生有当月课程，但 `students.grade` 为空（自动建议最后一节课的年级） |
| `teacher_typo` | WARN | 两个老师姓名 Levenshtein 距离 ≤ 1（去空格后比较） |
| `student_typo` | WARN | 两个学生姓名 Levenshtein ≤ 1，且共享某个已知年级或一方年级缺失，且双方均非离校 / 已流出 |
| `orphan_pricing` | WARN | `student_pricing` 行历史从未在任何 `lessons.subject` 中出现，且学生未离校 |
| `zero_custom_pricing` | HIGH / MEDIUM | `custom_price ≤ 0`；当月有非试课节课命中 → HIGH，否则 MEDIUM |
| `price_outlier` | WARN | 专享价相对标准价偏离 ≥ 30% |
| `price_zero` | HIGH | 有效课时（已上 / 未缴费）单价 = 0 |

---

### 通用基础设施

| 项 | 说明 |
| --- | --- |
| xlsx / zip 自实现 | 服务端 `unzipXlsx` / `zipStore` 直接处理 ZIP 文件结构，无 `xlsx` / `archiver` 依赖；前端 `zipStoreFiles` 镜像同实现，用于客户端 PNG 打包 |
| 审计日志去重 | 用 `issue_key` 做去重 key，相同问题再次出现时只更新 `run_at`，不新建条目 |
| 多月结转链 | `ensureCarryOverChain`：进入任何月份页面前，自动从最早数据月推导到当前月，确保中间月份的结转记录齐全 |
| 主题切换 | 顶栏切换亮色 / 暗色，`localStorage` 持久化，默认跟随系统 `prefers-color-scheme` |

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

按严重程度排序。已复审 `unitPriceFor / studentSummary / financeBase / weightedTeacherTransport / weightedStaffSalary / ensureCarryOver / rolloverRecharges / recomputePricing / patchExpense / upsertStaffSalary / deleteMonth` 等所有金额触达点。

### 修复历史摘要

下表列出已通过代码修复的历史问题，仅供回溯：

| 历史问题 | 修复方式 | 相关代码 |
| --- | --- | --- |
| 应收账款口径只统计「状态=未缴费」 | 拆出 `account_debt_receivable` + `unpaid_lesson_receivable`，`accounts_receivable` 按学生取最大值合并去重 | `financeBreakdowns` |
| 专享价 `custom_price = 0` 会强制覆盖课时价为 0 | POST/PATCH 拒绝 `≤ 0`；存量 0 显式归为 `price_source='waiver'`，备注含「试」字时回退至标准价 | `unitPriceFor` / `/api/student-pricing` |
| `recomputePricing` 静默删除手填覆盖 | UI 弹窗显式显示「将清除 N 条手填价格、重算 M 节课」 | `app.js` `.pricing-recompute` |
| 强删月份无确认 | UI 二次确认弹窗，需手输 `month_key` 字符串才能解锁删除按钮；同时 `ensureCarryOver` 在下次访问下游月时按新的 `previousDataMonth` 自动刷新自动结转行 | `deleteMonth` / `month-delete-confirm` |
| `previousEqualRange` 用滑动窗口处理自然月 | 当 `range` 是完整自然月时，改用真实的上一自然月；自定义区间仍走滑动窗口 | `previousEqualRange` |
| `gross_margin` 用 `pctChange` 误导 | 增加 `mom_pp`（百分点差），UI 切换到 pp 显示 | `metricOverview` |
| `severityCounts` 吞掉非标准 severity | 动态新增桶，`pricing_recompute` 等写入的 `info` 也会被汇总 | `severityCounts` |

### 高（建议尽快修）

1. **强删月份不会重算后续月份的结转链**
   UI 已有二次确认且 `ensureCarryOver` 在访问下游月时刷新自动结转行；但 `previousDataMonth` 是基于 `availableMonths()` 的，如果中间月份被删，下游月会跳过被删月直接结转上上月余额，业务语义上未必对。仍需 UI 显式提示「下一月的结转将基于 X 月而不是被删月」。

### 中（语义不一致或边界数据可能踩坑）

2. **未填 `recharge_date` 时 fall back 到月初**
   `rechargesInRange` 用 `COALESCE(NULLIF(recharge_date, ''), month_key)`。在半月级 finance 自定义区间（如 4.16–4.30）下，本月里没填日期的充值会落到 4.1，被错排除。建议要么在录入时强制日期，要么 fall back 到月末。

3. **Finance 自定义区间下，员工薪资和老师车贴按"日数线性比例"**
   `weightedStaffSalary` 和 `weightedTeacherTransport` 用 `overlapDays / monthDays` 做权重。但员工工资是月度发放、不可日切，半月视图会显示一半工资，半月利润分析会被低估。建议自定义区间下显式提示"成本按时间分摊"，或允许用户在 UI 选择"成本不分摊"。

4. **同步学生年级会被 lesson 上的错误年级覆盖**
   `syncStudentsFromLessons` 用 `COALESCE(NULLIF(excluded.grade,''), students.grade)`，最后一次遍历到的非空 lesson 年级会写入档案。某节课误录入错年级会污染学生档案。审计的 `grade_inconsistency` 能兜底告警，但同步本身仍写入。建议只在 `students.grade` 为空时填年级，不要覆盖。

5. **`staff_salary_monthly.salary_actual` 和 `expected_salary` 双源**
   存储字段 `salary_actual` 取 INSERT 时的 `base_salary` 快照，但 SELECT 同时返回 `expected_salary`（用当前 `base_salary` 重算）。员工调薪后历史月份两栏会不一致，UI 上一旦展示 `expected` 会让历史月看起来"工资变了"。`weightedStaffSalary` 用的是 stored `salary_actual`，所以经营概览的运营成本是稳定的。建议 UI 上明确区分"按当时基薪"和"按当前基薪"，或干脆不返回 `expected_salary`。

6. **试课 / 考试的老师课时费完全靠手填**
   `teacherSummary` 只把 `已上 / 未缴费` 计入老师课时合计；试课、考试不计入。`lessons.teacher_salary` 是手填字段，没有跟单价或学生数联动。如果机构对试课/监考有薪资政策，目前需要在每节课的 `teacher_salary` 单元格里手动维护。

### 低（边界 / 体验）

7. **`upsertStaffSalary` 对离职员工的保护过严**
   只要 `staff.status='离职'` 且当月已经存在 salary 行，任何修改都被拒。即使要修复历史录入错误也得先把员工恢复在职。

8. **`expense q` 模糊查询不转义 `%` `_`**
   用户搜 `2_` 之类时会触发 SQL LIKE 通配。本地工具，影响小。

9. **`splitStudents` 不规范化中间空格**
   "小 明" 与 "小明" 被当成两个学生。审计 `student_typo` 通过 `normalizeAuditName` 去空格后做 Levenshtein 兜底，但平时录入时不会自动合并。

## 受限范围（不在 MVP 内）

- 多机构 / 多分店 / 多用户登录
- 移动端 / 离线 / 同步到云
- 微信、企业微信、电话、短信集成
- 财务凭证 / 发票 / 税务
- 学生学习记录 / 错题本 / 测评
