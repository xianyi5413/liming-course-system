# 黎明教育教务管理系统

单店教培机构使用的 Node.js + SQLite 教务系统，覆盖排课、学生费用、充值、教师薪资、员工、开销、账号权限、操作日志以及数据备份。正式部署使用 Docker Compose；SQLite 和全量 Excel 备份都位于 `liming_data` 持久卷内。

## 数据中心

`设置 → 数据中心` 沿用原 `audit` 页面权限键，避免既有角色权限失效，但页面只保留三个区域：

1. 数据导入导出：导出唯一的全量 Excel、下载空白模板、上传预检、空系统初始化、完整覆盖恢复。
2. 备份设置：手动备份、每日调度、Asia/Shanghai 时区、失败重试、服务器保留数、百度网盘授权与目录。
3. 备份记录：本地状态、远端状态、大小、SHA-256、创建账号、备注、固定、下载、校验、重试上传和受保护删除。

旧的按月份核心导出和全部月份 ZIP 已取消。它们混合了汇总结果与原始数据，不能独立恢复数据库，而且长期维护两套字段口径容易产生偏差。课程、费用、薪资等底层业务计算仍保留；旧 `backup_records`、旧文件及旧下载接口继续兼容，但不会再生成新的 `legacy_core_zip`，也不会被新保留策略清理。

### 页面加载、兼容与故障降级

`fb604cf` 版本曾存在“数据中心打不开”的阻断问题：旧备份记录进入列表渲染后，前端调用了在清理旧月度页面时被误删的 `backupStatusLabel()` 和 `formatFileSize()`，浏览器因此抛出 `ReferenceError`。空备份列表不会执行该分支，所以早期静态契约和单接口测试没有发现。修复后这两个显示函数由数据中心自行提供，并增加了执行真实 `public/app.js`、登录、导航、网络请求和 DOM 渲染的 Chromium 回归测试。

页面加载顺序为：登录并取得账号权限 → 沿用 `audit` 视图键切换到数据中心 → `loadActiveViewData()` 调用 `refreshBackupData()` → `GET /api/data-center` → 规范化缺失设置和记录数组 → `renderAudit()` 先渲染三个固定区域 → `wireEvents()` 绑定重新加载和各操作按钮。导航加载和刷新异常均会被捕获，不再产生未处理的 Promise 异常。

`GET /api/data-center` 只依赖当前 SQLite、`backup_records`、备份设置以及对受管目录和百度配置的只读状态检查。应用启动及每次备份记录读取前都会幂等执行 `backup_records` 增量列检查；旧表缺失的新列会补齐，旧记录保留并显示为 `legacy_core_zip`。不要求删除旧库、旧记录或旧文件。

- 未配置百度应用时显示“百度网盘：未配置”，不会读取或创建 Token 文件，也不影响页面和本地备份状态。
- 未配置 `BACKUP_ENCRYPTION_KEY` 时显示“备份加密密钥：未配置”，只禁止远端加密上传，不影响页面打开。
- 受管备份目录不存在时显示“尚未创建（首次备份时创建）”；不可写或路径类型错误时显示“暂不可写”或“路径无效”。状态检查不会为了打开页面而创建目录。
- `/api/data-center` 临时失败时仍渲染“数据导入导出、备份设置、备份记录”三个区域，并显示“数据中心加载失败：安全错误摘要”和“重新加载”按钮。
- 老板兼容角色 `owner、boss、admin、老板、管理员` 均由后端规范为老板权限；其他账号必须在现有个人权限覆盖中明确拥有 `audit`。无权限账号不显示数据中心入口，API 同时返回 403。

本地浏览器验收：使用合成数据库启动服务，以老板账号登录，展开“设置”并点击“数据中心”；确认三个区域、未配置状态和空/旧记录提示均可见，`/api/data-center` 为 200，Console 无未捕获异常。随后可临时模拟接口 5xx，确认错误区域和重新加载按钮仍可使用。自动化命令为 `npm.cmd run test:data-center-page`，需要本机 Chrome/Chromium；也可用 `CHROME_PATH` 指定浏览器。

正式部署前必须用正式数据库的只读副本完成同一路径验收，核对旧表增量列和旧记录数量，再检查老板及显式 `audit` 账号、无权限账号、空配置、目录权限、接口失败提示和浏览器 Console。该验收通过前不得启用自动备份或百度上传。

## 唯一全量 Excel 格式

- 文件名：`黎明教育_全量数据_YYYYMMDD_HHmmss.xlsx`
- `file_type=liming_full_data_excel`
- `format_version=1`
- 用途：人工查看、日常导出、本地备份、百度网盘加密备份、空系统初始化和完整覆盖恢复。
- 不按月份拆文件；历史记录按各表的月份、日期、业务排序和原始 ID 排序。
- 不含宏、公式、图表和外部链接。以 `= + - @` 开头的用户文本写成普通字符串，防止公式注入。

全量 Excel 尽量保存数据库原始行，不保存可重新计算的汇总。`所有学生费用明细` 和 `所有课时明细` 是人工参考明细，标记 `restore_source=0`；恢复依赖课程、价格规则、单节覆盖等原始表。`backup_records` 是外部文件索引，不进入 Excel，否则恢复后会产生无效下载记录。

工作表固定顺序：

1. 所有课程数据
2. 所有学生费用明细
3. 所有充值记录
4. 期初余额
5. 所有学生单价
6. 所有班级管理
7. 学生档案
8. 所有教师车费明细
9. 所有课时明细
10. 所有薪资规则
11. 教师档案
12. 员工
13. 所有员工薪资
14. 所有员工考勤
15. 所有日常开销
16. 学生年级阶段
17. 费用标准
18. 单节费用覆盖
19. 教师月度调整
20. 系统设置
21. 角色
22. 角色权限
23. 用户账号
24. 账号认证数据
25. 账号教师绑定
26. 账号页面权限
27. 角色筛选预设
28. 账号筛选预设
29. 家长群问候记录
30. 课程通知完成记录
31. 数据检查记录
32. 数据检查忽略项
33. 审计事件
34. 操作日志
35. 导出说明
36. 字段定义
37. 教师调整兼容数据

`教师调整兼容数据` 对应仍存在的持久化兼容表，因此追加在说明表之后，不能因它未出现在初始清单中而遗漏。

### 课程列和状态

`所有课程数据` 的人工可见列固定为：`授课老师、日期、星期、时间、教室、状态、年级、科目、学生、备注`。之后才是课程 ID、月份、排序、教师薪资、薪资来源、薪资规则 ID、历史兼容状态及时间字段。

人工区域只显示一个“状态”。允许值来自系统实际定义：`待上、已上、请假、试课、考试、未缴费` 以及设置中的自定义课程状态。`lesson_status`、`course_status` 和原始 `status` 仅作为隐藏技术字段恢复，不能在人工区域冒充第二个状态列。排序为日期、当日排序、时间、授课老师、课程 ID。

### 字段格式

- 日期：`YYYY-MM-DD`；日期时间：`YYYY-MM-DD HH:mm:ss`。
- 金额：人民币元，保持数值精度，不转成分。
- 布尔：`0` 或 `1`。
- 数据库 `NULL`：使用保留标记编码，从而与空文本区分；普通查看时仍显示为空白。
- 每个字段定义包含 `source_table、field_key、source_field、display_name、column_order、data_type、nullable、restore_required、restore_source、primary_key、relation_field、sensitive、user_visible、enum_values、date_format、amount_unit`。
- 导出、模板、验证、导入、备份和测试全部复用 [field_definitions.js](src/excel/field_definitions.js)，禁止各自复制列名。

## 空白模板

文件名为 `黎明教育_全量数据导入模板_v1.xlsx`。模板的数据工作表和列顺序与全量 Excel 完全一致，不含真实业务行；最后增加 `填写说明`。账号认证表把隐藏的 `password_hash` 替换为 `初始密码`，导入时立即使用 PBKDF2-SHA256（120000 次）生成随机盐哈希，明文不会写入数据库或日志。

```powershell
npm.cmd run excel:template -- --output "D:\backup\黎明教育_全量数据导入模板_v1.xlsx"
```

## 导出、验证与导入 CLI

```powershell
npm.cmd run excel:full:export -- --db data/liming-local.sqlite --output output.xlsx
npm.cmd run excel:full:verify -- --input output.xlsx
npm.cmd run excel:import -- --db target.sqlite --input output.xlsx --mode initialize
npm.cmd run excel:import -- --db target.sqlite --input output.xlsx --mode overwrite --pre-backup-dir pre-import
```

网页导入分两步：上传预检只读取 Excel 并验证类型、版本、工作表、列顺序、枚举、日期、金额、主键、唯一键和关系；执行时要求老板密码及确认文字。初始化模式要求业务表为空。覆盖模式必须先成功生成全量 Excel 备份，然后进入维护状态，在单个 SQLite 事务中删除并按依赖顺序恢复；完整性或关系检查失败时整体回滚。成功后清除所有 Session，并要求重新登录。

恢复验收采用：源库 A 导出 → 仅含结构的空库 B → 只用该 Excel 导入 → 对所有恢复表逐字段比较。账号认证数据属于恢复源，因此测试账号应能继续使用原密码登录。

## 手动服务器备份

“立即备份”执行：创建互斥任务 → 生成全量 Excel → 格式和关系验证 → SHA-256 → 同文件系统 staging → 原子重命名 `.xlsx` 与 `.xlsx.sha256` → 更新 `backup_records` → 按配置尝试百度网盘上传。

目录为 `DATA_DIR/backups/full-excel/`。当前 Compose 把 `liming_data` 挂载到 `/app/data`，所以容器内目录为 `/app/data/backups/full-excel/`。目录与 staging 使用 `0700`，Excel、校验文件和 Token 文件使用 `0600`。Nginx 容器没有挂载 `liming_data`，无法直接读取备份；下载只能经过已认证 API，并返回 `Cache-Control: no-store`。

同一时间只允许一个手动或自动任务。目标已存在时拒绝覆盖；失败只清理本任务 staging，不删除已有文件或无关文件。页面和普通日志只显示 `backups/full-excel/...` 相对路径，不显示宿主机 Volume mountpoint。

## 自动备份

应用启动一个轻量检查器，每分钟检查一次；真正导出在独立 Node 子进程执行，不阻塞 HTTP。计划日期按 `Asia/Shanghai` 计算，数据库时间使用 UTC。默认关闭，默认时间 `02:30`。

- `schedule_key=full-data:YYYY-MM-DD`；成功记录有唯一约束。
- 到点后执行，服务重启会补做当天已经到点但尚未成功的任务。
- 不伪造过去日期的历史备份。
- 失败后默认等待 10、30、120 分钟，最多重试设置指定的次数。
- 手动和自动任务共用文件锁。

默认保留：每日 14、每月 12、手动 20，固定永久保留。每月第一份成功自动备份原地晋升为月度备份，不复制文件。清理只处理新体系、已验证、未固定、未使用且在受管根目录内的文件；永不删除最后一份有效全量备份。文件删除成功后才把记录标为 `deleted`，旧备份永不参与。

## backup_records 增量字段

继续复用原表，启动时以幂等 `ALTER TABLE` 增加：`backup_format、format_version、trigger、retention_class、managed_relative_path、sha256、verified_at、schedule_key、created_by_user_id、note、pinned、remote_status、remote_file_id、remote_path、remote_error_safe、remote_updated_at、deleted_at`。原 `file_size` 和 `status` 继续使用。

- `backup_format` 区分 `legacy_core_zip` 与 `full_data_excel`。
- `status` 是服务器本地副本状态；`remote_status` 独立表示百度副本。
- 本地成功、远端失败时，本地仍是成功，页面仅提示远端上传失败。
- 删除文件保留记录，以 `status=deleted/missing` 和 `deleted_at` 表示。

## 百度网盘

接入采用百度开放平台 OAuth 2.0，不保存百度账号密码。授权请求使用随机、十分钟有效且一次性的 `state` 防止 CSRF；授权码只在服务端换 Token。Access Token/Refresh Token 只保存在 `DATA_DIR/backups/full-excel/.secrets/baidu-token.json`，权限 `0600`，不进入数据库、Excel、Git 或普通日志。

百度网盘只接收 `.xlsx.enc`。上传前用 AES-256-GCM 流式加密，每个文件使用随机 12 字节 IV，并保存认证标签；密钥只来自 `BACKUP_ENCRYPTION_KEY`。明文 Excel 只保留在服务器受保护目录，临时密文上传后删除。密钥遗失将永久无法恢复网盘副本，必须把密钥离线保存在独立安全位置。

```powershell
npm.cmd run backup:encrypt -- --input backup.xlsx --output backup.xlsx.enc
npm.cmd run backup:encrypted:verify -- --input backup.xlsx.enc
npm.cmd run backup:decrypt -- --input backup.xlsx.enc --output restored.xlsx
```

本地成功和百度状态分别记录。未配置是中性状态，不影响服务器备份健康；启用后才把上传失败标为告警。页面支持连接/重新授权、解除授权、测试连接、远端目录和失败重试。服务器删除与远端删除分别记录，远端失败不能反向改写本地删除结果。

## 权限与安全

数据中心沿用 `audit` 权限键；老板角色始终可访问，其他账号必须有明确页面权限。普通老师和员工默认不能访问。所有完整导出、模板、导入、备份、下载、验证、百度管理和删除接口都执行后端权限校验，不能依赖按钮隐藏。

完整备份删除仅老板可执行，并要求重新输入密码和确认文字 `删除备份`。不能删除最后一份有效备份、旧版非受管文件或创建/验证/上传/恢复中的备份。导入覆盖同样要求重新认证和确认文字。

全量 Excel 的 `账号认证数据` 是敏感隐藏表，包含密码哈希以保证完整恢复；页面永不显示它。Session、Cookie、登录 Token、百度 Token、OAuth Secret、加密密钥、服务器绝对路径、Docker/SSH 信息、`.env` 和运行时临时文件永不导出。日志只记录稳定错误码、记录 ID、相对文件名和结果，不记录密码、哈希、Token、Secret、Cookie、密钥或 SQL 业务内容。

## 环境变量

```text
NODE_ENV
PORT
DATA_DIR
DB_PATH（可选，默认 DATA_DIR/liming-local.sqlite）
SESSION_COOKIE_SECURE
APP_VERSION（可选）
APP_GIT_COMMIT（可选）
BAIDU_APP_KEY
BAIDU_APP_SECRET
BAIDU_REDIRECT_URI
BACKUP_ENCRYPTION_KEY
```

`BACKUP_ENCRYPTION_KEY` 必须是 32 字节 Base64 或 64 位十六进制值。`.env.example` 只列变量名；真实值只放生产服务器 `.env` 或受控 Secret 管理系统。OAuth 回调必须与百度开放平台登记值完全一致。

## 本地测试

所有测试只用合成 SQLite、系统临时目录和模拟百度接口，不读取正式业务数据或真实 Token。

```powershell
npm.cmd run test:full-excel
npm.cmd run test:excel-import
npm.cmd run test:data-center
npm.cmd run test:backup-scheduler
npm.cmd run test:baidu-backup
node --check src/server.js
git diff --check
```

测试覆盖工作表/字段顺序、历史数据、原始关系、公式注入、空库恢复、原密码登录、模板、事务回滚、手动和自动备份、互斥、重启补做、同日去重、SHA-256、路径边界、保留策略、OAuth state、Token 刷新、模拟分块上传、AES-GCM、错误密钥、篡改和敏感日志检查。

## 正式部署与验收

本分支不代表已部署。正式上线前必须：

1. 备份当前 SQLite 和 Volume，并记录当前镜像/Commit。
2. 配置四个百度/加密环境变量；把加密密钥离线备份。
3. 核对 OAuth 回调和网盘应用权限。
4. 构建镜像，确认 `liming_data:/app/data` 不变；不要挂载或迁移旧备份目录。
5. 先关闭自动/远端开关启动，完成 schema 增量迁移和业务冒烟。
6. 人工创建、下载、验证一份全量 Excel，在隔离空库恢复并验证登录。
7. 再授权百度，上传测试密文、下载并离线解密验证。
8. 最后启用每日任务，观察调度、重试和保留日志。

当前正式服务器没有因本分支发生任何变化。Docker Hub 固定 digest 的供应链复现仍需在正式部署前独立完成；主 `Dockerfile` 仍使用浮动 `node:24-alpine`，这是已知上线阻塞项之一。

回滚代码时切回部署前 Commit 并重建应用镜像；`backup_records` 新增列无需删除，旧代码会忽略它们。回滚数据时只能使用上线前备份或已经隔离验证通过的全量 Excel，禁止直接覆盖活动 SQLite。新备份目录不应在代码回滚时删除。

## 工作表字段附录

下列顺序由统一字段定义生成；“恢复源=否”的工作表只供人工参考。

<!-- FIELD_APPENDIX -->
### 所有课程数据

- 来源：lessons；恢复源：是；排序：date → sort_order → time_slot → teacher_name → id。
- 列：授课老师、日期、星期、时间、教室、状态、年级、科目、学生、备注、课程ID、月份、排序、教师薪资、教师薪资来源、薪资规则ID、lesson_status（历史兼容字段）、course_status（历史兼容字段）、status（原始技术字段）、创建时间、更新时间。

### 所有学生费用明细

- 来源：lessons；恢复源：否；排序：date → lesson_id → student_name。
- 列：课程ID、学生姓名、授课老师、日期、星期、时间、教室、状态、年级、科目、课程学生名单、备注、费用来源、价格规则ID、单节覆盖金额、行级费用、是否恢复源。

### 所有充值记录

- 来源：recharge_records；恢复源：是；排序：month_key → recharge_date → id。
- 列：学生姓名、年级、上月实际结转、上月赠送结转、本月实际充值、本月赠送学费、充值日期、备注、ID、来源、月份。

### 期初余额

- 来源：student_opening_balances；恢复源：是；排序：month_key → student_name → id。
- 列：学生姓名、年级、实际余额、赠送余额、备注、ID、月份、创建时间、更新时间。

### 所有学生单价

- 来源：student_pricing；恢复源：是；排序：student_name → grade → subject → id。
- 列：学生姓名、年级、科目、组合学生、自定义单价、备注、ID。

### 所有班级管理

- 来源：class_groups；恢复源：是；排序：teacher → grade → subject → id。
- 列：班级名称、教师、年级、科目、学生显示名单、班级ID、学生名单键、创建时间、更新时间。

### 学生档案

- 来源：students；恢复源：是；排序：name → id。
- 列：学生姓名、年级、监护人、联系电话、状态、入学日期、离校日期、备注、ID。

### 所有教师车费明细

- 来源：teacher_travel_fees；恢复源：是；排序：month_key → week_start → teacher_name → id。
- 列：教师姓名、周序号、周开始日期、周结束日期、金额、备注、ID、月份、创建时间、更新时间。

### 所有课时明细

- 来源：lessons；恢复源：否；排序：date → lesson_id。
- 列：课程ID、授课老师、日期、时间、状态、年级、科目、学生、课时数、是否恢复源。

### 所有薪资规则

- 来源：teacher_salary_rules；恢复源：是；排序：teacher_name → is_active → id。
- 列：教师姓名、年级、科目、学生组合、单次薪资、单位课时、是否启用、备注、ID、创建时间、更新时间。

### 教师档案

- 来源：teachers；恢复源：是；排序：name → id。
- 列：教师姓名、联系电话、状态、入职日期、离职日期、备注、ID。

### 员工

- 来源：staff；恢复源：是；排序：name → id。
- 列：员工姓名、岗位、薪资类型、基本工资、日薪、标准工作天数、联系电话、状态、入职日期、离职日期、备注、ID。

### 所有员工薪资

- 来源：staff_salary_monthly；恢复源：是；排序：month_key → staff_id → id。
- 列：员工姓名、实际工资、奖金、扣款、备注、ID、员工ID、月份。

### 所有员工考勤

- 来源：staff_attendance；恢复源：是；排序：attendance_date → staff_id → id。
- 列：员工姓名、考勤日期、状态、计薪单位、工时、原因、备注、ID、员工ID、月份、更新时间。

### 所有日常开销

- 来源：operating_expenses；恢复源：是；排序：expense_date → id。
- 列：日期、类别、金额、商家、备注、ID、月份。

### 学生年级阶段

- 来源：student_grade_stages；恢复源：是；排序：student_name → start_date → id。
- 列：学生姓名、年级阶段、开始日期、结束日期、ID、创建时间、更新时间。

### 费用标准

- 来源：pricing_standards；恢复源：是；排序：grade → student_count → id。
- 列：年级、学生人数、单价、说明、ID。

### 单节费用覆盖

- 来源：fee_overrides；恢复源：是；排序：lesson_id → student_name。
- 列：学生姓名、单节费用、课程ID、更新时间。

### 教师月度调整

- 来源：teacher_adjustments_monthly；恢复源：是；排序：month_key → teacher_name。
- 列：教师姓名、月份、第1周车费、第2周车费、第3周车费、第4周车费、备注。

### 系统设置

- 来源：settings；恢复源：是；排序：key。
- 列：设置项、设置值。

### 角色

- 来源：roles；恢复源：是；排序：id。
- 列：角色代码、角色名称、说明、是否系统角色、是否只读、ID、创建时间、更新时间。

### 角色权限

- 来源：role_permissions；恢复源：是；排序：role_code → permission_key。
- 列：角色代码、权限代码、是否启用、创建时间、更新时间。

### 用户账号

- 来源：users；恢复源：是；排序：id。
- 列：用户名、显示名称、账号状态、角色代码、兼容教师姓名、只读覆盖、个人权限覆盖已启用、ID、创建时间、更新时间。

### 账号认证数据

- 来源：users；恢复源：是；排序：id。
- 列：用户ID、密码哈希。

### 账号教师绑定

- 来源：user_teacher_bindings；恢复源：是；排序：user_id → id。
- 列：用户ID、教师姓名、ID、创建时间。

### 账号页面权限

- 来源：user_page_permissions；恢复源：是；排序：user_id → permission_key。
- 列：用户ID、权限代码、是否启用、创建时间、更新时间。

### 角色筛选预设

- 来源：role_filter_presets；恢复源：是；排序：role_code → view_key → filter_key。
- 列：角色代码、页面代码、筛选项代码、筛选值JSON、ID、创建时间、更新时间。

### 账号筛选预设

- 来源：user_filter_presets；恢复源：是；排序：user_id → view_key → filter_key。
- 列：用户ID、页面代码、筛选项代码、筛选值JSON、创建时间、更新时间。

### 家长群问候记录

- 来源：parent_message_greetings；恢复源：是；排序：id。
- 列：发送对象、对象类型、学生、问候语、统一尾句、完整消息、ID、发送对象键、更新时间。

### 课程通知完成记录

- 来源：course_notice_completion_records；恢复源：是；排序：date → time → id。
- 列：年级、科目、学生、教师、日期、时间、状态、教室、发送对象、对象类型、完成人、ID、唯一键、发送对象键、完成时间。

### 数据检查记录

- 来源：audit_logs；恢复源：是；排序：run_at → id。
- 列：来源、严重程度、对象、字段、原值、新值、状态、备注、ID、检查时间、检查批次ID、问题键。

### 数据检查忽略项

- 来源：audit_ignores；恢复源：是；排序：ignored_at → issue_key。
- 列：来源、对象、字段、备注、问题键、忽略时间。

### 审计事件

- 来源：audit_events；恢复源：是；排序：created_at → id。
- 列：操作账号、操作角色、操作、对象类型、对象ID、操作前JSON、操作后JSON、ID、操作用户ID、IP、User-Agent、创建时间。

### 操作日志

- 来源：operation_logs；恢复源：是；排序：created_at → id。
- 列：校区、操作人、操作账号、操作类型、操作内容、目标类型、目标ID、结果状态、ID、客户端IP、User-Agent、创建时间、扩展JSON。

### 教师调整兼容数据

- 来源：teacher_adjustments；恢复源：是；排序：teacher_name。
- 列：教师姓名、第1周车费、第2周车费、第3周车费、第4周车费、备注。
