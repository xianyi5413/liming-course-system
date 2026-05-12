# 黎明教育课程管理系统

面向单店教培机构的课程、学生、充值、教师薪资和经营核对后台。`node src/server.js` 可本地单进程运行，也可以用 Docker 部署到云服务器。

技术栈：Node.js 24 内置 `http` + `node:sqlite` + 单文件 `public/app.js` + 单文件 `public/styles.css`。无前端框架，无构建步骤；服务端无第三方运行时依赖。前端经营图表通过 ECharts CDN 加载。默认数据落 `data/liming-local.sqlite`，云端部署时通过 Docker volume 挂载到 `/app/data`。

## 运行

```bash
npm start              # 启动服务（端口 5177）
npm run init           # 仅初始化数据库后退出（不开服务）
python scripts/import_workbook.py <xlsx-path>  # 自动识别月份并导入总表、充值、学生单价、费用标准、教师车票
```

Docker 试用部署：

```bash
cp .env.example .env
docker compose up -d --build
```

详细服务器、域名、HTTPS 和数据库迁移说明见 [docs/deployment.md](docs/deployment.md)。
审计核实与本轮修复记录见 [docs/audit-phase2-verification.md](docs/audit-phase2-verification.md)。

## 仓库与本地文件边界

GitHub 只保留系统运行、部署和维护所必需的源码、脚本、配置模板和文档：

- 应上传：`src/`、`public/`、`scripts/`、`docs/`、`deploy/`、`Dockerfile`、`docker-compose.yml`、`package.json`、`.env.example`、`.gitignore`、`.dockerignore`。
- 不上传：`data/*.sqlite*`、`data/backups/`、`data/source-workbooks/`、`data/uploads/`、`data/.audit-temp/`、压缩包、Python 缓存、设计系统原始目录、本地 AI/设计工具上下文。
- 本地保留但不提交：`AUDIT-REPORT-*.md`、`AUDIT-PHASE*.md`、`data/audit_*.md`。这些报告可能包含业务数据或审计线索，只用于本地排查。
- `.impeccable.md`、`CLAUDE.md` 属于本地工具说明，不再跟随 GitHub 发布。

数据库和源 Excel 是业务数据，不走 GitHub。上线代码通过 `git push` / `git pull` 更新；线上数据库通过 Docker volume 和备份脚本维护。

Excel 工作簿权威同步：

```bash
# 把 data/source-workbooks/ 下的多个月一次性同步进数据库（含同步前整体备份 + 每月单独备份）
node scripts/sync_source_workbooks.js --months=2026-02-01,2026-03-01,2026-04-01,2026-05-01

# 复核源表 vs 系统：默认输出到 data/audit_source_vs_summary.md
node scripts/audit_source_vs_summary.js

# 在临时 SQLite 副本里模拟重放，不动正式库
node scripts/audit_source_vs_summary.js --simulate-sync=2026-02-01,2026-03-01,2026-04-01,2026-05-01
```

跨月课程（例如 2026年5月.xlsx 5月总表中日期为 4-30 的行）会被识别为 `month_key=2026-04-01`，归入 4 月费用汇总。审计脚本同时按行的实际日期月份做跨工作簿去重。

服务器更新：

```powershell
# 在本机 PowerShell 一键提交、推送 GitHub，并让服务器拉取重建
.\scripts\publish-and-update.ps1 -Message "本次更新说明"
```

脚本会先运行基础语法检查，再提交本地变更、推送 `origin/main`，最后通过 SSH 进入服务器执行 `scripts/server-update.sh`。如果本地存在 `scripts\黎明教育.pem`，脚本会自动用它登录；也可以用 `-KeyPath <pem路径>` 指定其他密钥。`*.pem` 已加入忽略规则，不要把服务器密码或私钥内容提交到 GitHub。

也可以在服务器上手动更新：

```bash
cd /root/liming-course-system
sh scripts/server-update.sh
```

该脚本会自动执行“备份 SQLite -> 拉取 GitHub -> 重建 Docker -> 检查 HTTPS -> 检查数据库计数”。服务器文件清点使用：

```bash
sh scripts/server-inventory.sh
```

如果「教师薪资汇总」页 A 列是未计算出来的动态公式（导入时报无法识别教师姓名），先用 Excel/WPS 打开并保存一次；或临时用 `--teacher-order 老师1,老师2,...` 指定第 3 行起的老师顺序。

数据库文件、上传文件、备份都在 `data/` 下：

- `data/liming-local.sqlite`：主库（WAL 模式）
- `data/backups/`：每次审计/月份强删/审计修复前自动留底的快照
- `data/uploads/`：xlsx 对账时上传的文件

运行时可用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `5177` | HTTP 服务端口 |
| `DATA_DIR` | `data/` | 数据目录，Docker 中为 `/app/data` |
| `DB_PATH` | `DATA_DIR/liming-local.sqlite` | SQLite 主库路径 |
| `SESSION_COOKIE_SECURE` | `true` | HTTPS 正式部署保持 `true`；纯 HTTP 临时试用才改为 `false` |

Docker 线上环境中，代码在 `/root/liming-course-system`；数据库通过 Docker 数据卷挂载到容器内的 `/app/data/liming-local.sqlite`。更新代码不会覆盖数据卷，但不要执行 `docker compose down -v` 或 `docker volume prune`，除非已经确认要销毁数据库。

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
| `audit_events` | 操作审计日志，记录谁改了课程、充值、价格、薪资、账号等关键数据 |
| `users` | 登录账号、角色、绑定老师姓名和账号状态 |
| `parent_message_greetings` | 家长群课程通知的发送对象称呼、全局尾句和完整文案缓存 |
| `course_notice_completion_records` | 家长群课程通知完成记录，按“年级 + 科目 + 学生名单 + 老师 + 日期 + 时间”唯一识别已发送课程 |
| `settings` | 当前选定月份等系统配置 |

所有按月数据用 `month_key='YYYY-MM-01'` 分区，月份切换不影响历史数据。

权限角色：`Qing(owner)` 和管理员有全量权限；教务主要负责排课、学生费用、充值、档案和老师账号；财务看经营概览、充值、学生查询和日常开销；老师只能看自己的矩阵课表与教师明细。老师档案删除时会自动停用绑定的老师登录账号，但账号权限表保留 `disabled` 记录，便于恢复、重置密码和审计追溯。

## 已完成功能与对应逻辑

### 模块总览

| 模块 | 入口 | 核心职责 | 主要数据表 |
| --- | --- | --- | --- |
| 排课 | 📅 | 月度课程录入、状态管理、冲突检测、周课表导出、家长群课程通知截图 | `lessons` / `parent_message_greetings` / `course_notice_completion_records` |
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
| 周课表 / 矩阵课表 | 前端按自然周和日期范围展示 | 当前用于查看和冲突排查；服务端仍保留旧周课表导出辅助函数，但未暴露 API |
| 家长群课程截图 | 页面「排课 / 家长群课程截图」+ `/api/course-notice` | 按日期范围直接读取数据库课程，支持“只选择上课”、生成发送对象、修改称呼、复制文案、复制/下载课程截图、完成打勾和清除所有打勾记录 |

#### 1.1 家长群课程截图与文案生成

用于教务每周或每阶段向家长群发送课程安排，不再需要手动上传 Excel。

| 能力 | 说明 |
| --- | --- |
| 筛选课程 | 每次打开默认本周一到本周日；选择起始日期、终末日期和“只选择上课”后，页面自动按当前条件刷新发送对象 |
| 发送对象 | 1V1 学生会生成“个人群”，并展示该学生在日期范围内的所有课程；1V2 及以上仍按班级生成“班级群”，避免混入其他班级 |
| 班级唯一标识 | 使用 `年级 + 科目 + 标准化学生完整名单 + 授课老师`，学生名单去空格、排序后用顿号拼接；老师不同会被识别为不同班级 |
| 课程截图 | 前端 canvas 绘制简洁课程表，第一行居中显示“课程通知”，表格单元格文字居中，列宽按内容自适应，可复制到微信或下载 PNG；截图使用 `--shot-*` 专用变量跟随当前 `data-palette`，但不跟随暗色主题变黑 |
| 截图视觉 | 课程截图仅保留标题区域 + 课程表格；不显示发送对象副标题、节数徽标和底部说明行；表头使用浅品牌底，正文仅按行隔行变色，时间 / 年级 / 科目只做文字强调 |
| 文案生成 | 每个发送对象独立称呼 + 全局统一尾句，默认尾句为“这是我们本周的上课安排哦[玫瑰]”；修改称呼或尾句后文案即时更新 |
| 称呼持久化 | 称呼、发送对象信息、尾句和完整文案保存到 `parent_message_greetings`，下次进入自动恢复 |
| 完成标记 | 复制截图成功后写入 `course_notice_completion_records`，发送对象变为淡绿色并在课程区域最上层显示大对勾；右侧状态显示“✓ 该发送对象已完成”；刷新后如果该对象全部课程已完成，会自动恢复打勾状态 |
| 清除记录 | 页面提供“清除所有打勾记录”，仅清空完成记录，不影响称呼和文案 |
| 页面体验 | 切换到其他页面时会自动回到顶部，避免继承课程通知页或其他长页面的滚动位置 |

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
| 分布 | `financeBreakdowns` | 年级×收入、科目×收入、班型×收入×毛利率、Top 10 学生消费、老师 ROI（贡献/课时费）、低余额名单（实际余额 < 平均单次课费）、未缴费课时清单；收入拆分统一引用 `allocated_revenue`，与顶部收入口径一致 |
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
| 多月结转链 | `ensureCarryOverChain`：进入任何月份页面前，自动从最早数据月推导到当前月，确保中间月份的结转记录齐全；上游充值或费用补录后，`refreshCarryOverAfter` 会清理已经失效的下游自动结转记录，避免旧欠款继续滚到后续月份 |
| 设计系统 | `public/styles.css` 维护品牌 token、语义别名、字体工具类、亮色侧栏、蓝黑暗色后台，以及课程截图专用 `--shot-*` 浅色家长版变量 |
| 主题切换 | 左侧导航底部切换亮色 / 暗色，`localStorage` key 为 `liming:theme`，默认跟随系统 `prefers-color-scheme`；暗色模式采用近黑 / 蓝黑基底 |
| 配色方案 | 左侧导航底部独立选择 `data-palette`，`localStorage` key 为 `liming:palette`，默认 `liming-blue`（品牌色 `#002147`）；明暗主题与配色方案互不混用，配色方案主要影响品牌色、按钮、选中态、截图强调色 |
| 矩阵课表 | 10 天以内保留原有宽松矩阵尺寸，时间段之间有明显横向分隔；超过 10 天自动切换为按时间段分组的有课日期卡片；同日重叠时间会标记老师 / 学生 / 教室冲突 |

## 界面与交互优化（近期更新）

### 配色方案

- 新增 `data-palette` 配色体系，默认品牌色为黎明蓝 `#002147`
- 支持 12 套配色方案：黎明蓝 / 青绿原版 / 暖日 / 薰衣草 / 水墨 / 密林 / 冰川 / 咖啡 / 香料土 / 莫奈花园 / 睡莲柔粉 / Bauhaus
- 配色方案保存到 `localStorage`（key: `liming:palette`），独立于明暗主题
- `data-theme` 继续负责亮色 / 暗色 / 跟随系统的切换

### 暗色模式优化

- 暗色模式从灰绿 / 墨绿调整为近黑 / 蓝黑后台风格
- 优化背景、面板、表格、侧栏、文字、边框等暗色 CSS 变量
- 暗色下交互色改为更克制的蓝色系

### 课程通知截图优化

- 截图默认固定黎明蓝 `#002147`，使用 `--shot-*` 专用变量
- 新增「课程截图跟随当前配色方案」开关（`localStorage` key: `liming:shot-follow-palette`），默认关闭
- 开启后截图跟随 `data-palette` 配色方案变化，关闭后始终为黎明蓝
- 截图不跟随暗色模式，始终保持适合发给家长的浅色风格
- 设置入口：设置 → 外观设置 → 课程截图配色
- 简化版式：只保留居中标题"课程通知"+ 课程表格，删除底部说明行
- 表格正文取消时间、年级、科目等字段的单独深色背景，改为统一隔行变色

### 冲突检查增强

- 新增「忽略教室为 1 的教室冲突」开关（`localStorage` key: `liming:ignore-room-one-conflict`）
- 能识别 `1` / `"1"` / `" 1 "` / `"1.0"` 等教室编号变体
- 只忽略教室都为 1 且时间重叠的教室冲突，老师冲突、学生冲突、真实教室冲突等其它问题不受影响

### 周课表暗色高亮修复

- 修复暗色模式下周课表老师分组结束行 `group-break` 过亮的问题
- 暗色分组行颜色调整为更克制的深蓝灰：`--group: #132033` / `--group-hover: #172033` / `--group-fg: #cbd5e1`

### 右上角用户菜单

- 将用户信息、修改密码、退出登录从左侧栏迁移到右上角用户菜单
- 右上角显示头像首字母、用户名和下拉箭头
- 下拉菜单包含：用户名、角色、修改密码、退出系统
- 复用原有修改密码和退出登录的业务逻辑

### 外观设置迁移

- 主题和配色方案选择从左侧栏迁移到「设置 → 外观设置」页面
- 右上角用户菜单增加「外观设置」入口
- 保持原有 `THEME_KEY` / `PALETTE_KEY` / `applyTheme()` / `applyPalette()` 逻辑不变

### 月份工具栏迁移

- 月份选择、新建月份、删除月份从左侧栏迁移到全局 topbar
- 位置在页面操作按钮之后、用户菜单之前，所有页面都能看到当前月份上下文
- 复用原有 `.month-select` / `.new-month` / `.delete-month` 事件绑定
- `activeMonth` 和 `localStorage` 记忆逻辑保持不变

### 侧栏折叠与滚动模型 🚧

- 正在引入左侧栏折叠布局，使用 `#app.sidebar-collapsed` 控制折叠状态
- 新增 `localStorage` key：`liming:sidebar-collapsed`
- 展开时显示图标 + 文字，收缩时只显示图标
- `navGroups` 增加 `icon` 字段
- topbar 左侧增加折叠按钮
- 调整 sidebar、main、content 的滚动模型
- **该部分目前仍在继续打磨和验证，尚未完全稳定**

### Bugfix

- 修复课程总表筛选栏因 `.lesson-filter-bar` sticky 定位导致悬浮在表格上方的问题，删除 sticky 属性使筛选栏重新跟随内容区滚动

## 金额结算口径

每个月每个学生的余额按下式结算（见 `studentSummary`）：

```
actualBase       = prevActual + curRecharge + min(prevGift, 0)
giftBase         = max(prevGift, 0) + curGift
actualConsumption = min(totalFee, max(0, actualBase))
remainingFee      = totalFee - actualConsumption
giftConsumption   = min(remainingFee, max(0, giftBase))
unpaidFee         = remainingFee - giftConsumption
actualBalance     = actualBase - actualConsumption - unpaidFee
giftBalance       = giftBase - giftConsumption
```

口径要点：

- **现金优先消费，赠送兜底**：实际现金（含上月结转 + 本月充值）先消耗课程费用，不足部分用赠送余额顶。
- **负的上月赠送结转会扣减实际余额**（`+ min(prevGift, 0)`），避免赠送账户成为永久"负债悬空"。
- **总资金不足时**未覆盖的课费写入 `actualBalance` 负数，赠送余额清零；正常情况下两边的余额拆分都保证 `actual + gift == 总充值 - 总费用`。
- **finance.revenue 是收入认现口径**：每条有效课时先算 `allocated_revenue = unit_price × (actual_consumption / total_fee)`、`allocated_gift_consumption = unit_price × (gift_consumption / total_fee)`，再汇总到经营概览。学生没付钱的课时不计现金收入，仅在余额上体现为负数或在 `accounts_receivable` 体现（限 `状态=未缴费` 的课）。
- **经营拆分同口径**：老师人效、年级/科目/班型收入、Top 学生贡献均使用 `allocated_revenue`，避免顶部收入按现金认现、底部排行按课程标价的口径混用。

## 数据流向图与审计

金额相关数据流向图见 [docs/money-data-flow.svg](docs/money-data-flow.svg)。

本轮代码和金额口径审计记录见 [docs/financial-data-flow-audit.md](docs/financial-data-flow-audit.md)，其中列明了已修复的口径问题、仍保留的低风险冗余项、服务器清理边界和后续建议。

## 已知 bug / 风险（重点关注金额相关）

按严重程度排序。已复审 `unitPriceFor / studentSummary / financeBase / weightedTeacherTransport / weightedStaffSalary / ensureCarryOver / rolloverRecharges / recomputePricing / patchExpense / upsertStaffSalary / deleteMonth` 等所有金额触达点。

### 修复历史摘要

下表列出已通过代码修复的历史问题，仅供回溯：

| 历史问题 | 修复方式 | 相关代码 |
| --- | --- | --- |
| 跨月课程被丢弃或被错误归入工作簿月份 | 改为按「课程实际日期」决定 `month_key`，跨月行不再被丢弃；导入时按 (date, month_key) 精确删除，不会误覆盖其他月份 | `readXlsxTotalRowsForImport` / `importLessonsFromWorkbook` / `import_workbook.py:lesson_rows` |
| Excel 充值表的「上月实际/赠送结转」被硬编码为 0 | 导入时读取 C/D 列写入 `prev_actual` / `prev_gift`，并标记 `source='source-workbook:*'`；含 source-workbook 充值的月份不再被自动结转覆盖 | `upsertRechargeFromWorkbook` / `monthUsesSourceWorkbookOpening` / `import_recharges` |
| Excel「学生费用明细」手填单价不会回写到系统 | 导入工作簿时按 (lesson_id, student_name) 写入 `fee_overrides`，让历史 Excel 单价成为系统计费的权威值；`findLessonForFeeOverride` 按行实际日期月份匹配，跨月课也能命中 | `importFeeOverridesFromWorkbook` / `findLessonForFeeOverride` |
| Excel 充值/费用核对脚本只能比对单月，无法跨工作簿 | 新增 `scripts/sync_source_workbooks.js` 一键同步多月 + 整体备份；审计脚本支持 `--simulate-sync=YYYY-MM-01,...` 临时库重放；新增「相邻 Excel 结转核对」与跨月汇总去重 | `scripts/sync_source_workbooks.js` / `scripts/audit_source_vs_summary.js` |
| 中文姓名输入框每输入一个字符就整页刷新 | `bindSafeTextInput` 改为输入时只更新草稿，按 Enter / 失焦 / change 才提交并重渲染；增加 IME composition 状态判断，不在合成中触发 | `public/app.js` `bindSafeTextInput` |
| 应收账款口径只统计「状态=未缴费」 | 拆出 `account_debt_receivable` + `unpaid_lesson_receivable`，`accounts_receivable` 按学生取最大值合并去重 | `financeBreakdowns` |
| 专享价 `custom_price = 0` 会强制覆盖课时价为 0 | POST/PATCH 拒绝 `≤ 0`；存量 0 显式归为 `price_source='waiver'`，备注含「试」字时回退至标准价 | `unitPriceFor` / `/api/student-pricing` |
| `recomputePricing` 静默删除手填覆盖 | UI 弹窗显式显示「将清除 N 条手填价格、重算 M 节课」 | `app.js` `.pricing-recompute` |
| 强删月份无确认 | UI 二次确认弹窗，需手输 `month_key` 字符串才能解锁删除按钮；同时 `ensureCarryOver` 在下次访问下游月时按新的 `previousDataMonth` 自动刷新自动结转行 | `deleteMonth` / `month-delete-confirm` |
| `previousEqualRange` 用滑动窗口处理自然月 | 当 `range` 是完整自然月时，改用真实的上一自然月；自定义区间仍走滑动窗口 | `previousEqualRange` |
| `gross_margin` 用 `pctChange` 误导 | 增加 `mom_pp`（百分点差），UI 切换到 pp 显示 | `metricOverview` |
| `severityCounts` 吞掉非标准 severity | 动态新增桶，`pricing_recompute` 等写入的 `info` 也会被汇总 | `severityCounts` |
| 上游充值补录后，下游旧自动结转不会消失 | `ensureCarryOver` / `rolloverRecharges` 会删除余额已归零学生的失效自动结转；`POST /api/recharges` 保存后级联刷新后续月份，学生历史页也会先刷新结转链 | `refreshCarryOverAfter` / `isAutoCarryOverRecord` / `/api/recharges` |
| 主题选择占用顶栏空间 | 主题下拉移到左侧导航底部，顶栏只保留月份和当前页面操作 | `renderNav` / `renderTopbar` |
| 配色方案与课程截图未联动 | 新增 `data-palette` / `liming:palette` 和 12 套配色；课程通知截图预览、复制图片、下载 PNG 统一读取 `--shot-*` 变量，暗色模式下仍保持浅色家长版 | `public/styles.css` / `courseNoticeCanvas` |
| 暗色模式偏绿偏脏 | 暗色基础变量改为近黑 / 蓝黑后台风格，大面积背景不再使用绿色系；配色方案在暗色下只影响局部强调 | `:root[data-theme="dark"]` / `prefers-color-scheme` |
| 短范围矩阵课表时间段界限弱 | 保留原有宽松列宽和单元格高度，只用符合设计系统的边框色做时间段分组分隔；暗色 / 亮色都可见 | `week-grid-table` CSS |
| 生产样式未完整应用 `_ Design System` | 同步品牌主色、`brand-pale`、语义 token、字体工具类、暖胡桃 system dark，并将亮色侧栏改为 UI Kit 的温暖纸色方案 | `public/styles.css` |

### 高（建议尽快修）

1. **强删月份的业务语义仍需 UI 明确提示**
   `ensureCarryOver` / `refreshCarryOverAfter` 会按当前存在的数据月重算后续自动结转；但 `previousDataMonth` 是基于 `availableMonths()` 的，如果中间月份被删，下游月会跳过被删月直接结转上上月余额。技术上已能刷新，业务上仍需 UI 显式提示「下一月的结转将基于 X 月而不是被删月」。

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
