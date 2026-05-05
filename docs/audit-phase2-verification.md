# 2026-05-05 审计报告核实记录

本记录对应 `AUDIT-REPORT-20260504.md` 和 `AUDIT-PHASE2-20260505.md`。审计报告本身包含业务数据和安全线索，保持本地不提交。

## 已核实并修复

| 问题 | 处理 |
| --- | --- |
| 导入按日期删除课程，可能误删其他月份 | 已把 Node 导入和 Python 导入脚本改为 `date + month_key` 双条件删除；导入时按行实际日期分别 DELETE，不会误删其他月份；跨月行（如 2026年5月.xlsx 5月总表中日期为 4-30 的行）按真实日期写入 `month_key=2026-04-01`，不再被丢弃 |
| 审计读取和导入读取行集不一致 | 审计端按学生×(日期+老师+时段+教室+科目) 去重跨工作簿汇总，源表与系统在 student_summary 层面 0 差异 |
| Excel 充值「上月结转」被硬编码为 0 | 导入读取 C/D 列写入 `prev_actual` / `prev_gift`，标记 `source='source-workbook:*'`；含源表的月份不再被系统自动结转覆盖 |
| 中文姓名输入框每打一个字就整页刷新 | `bindSafeTextInput` 改为输入只更新草稿，按 Enter / blur / change 才 commit 并重渲染；compositionstart/end 期间不触发 commit |
| `applyAuditIssues` / `recordAuditIssues` / `ignoreAuditIssues` 无事务 | 已用 `withTransaction()` 包裹批量写入和批量应用 |
| 审计插入课程不创建学生/教师 | 已在 `insert_lesson` patch 前补建老师与学生档案 |
| 审计修复影响结转后不刷新 | 已收集受影响月份并在批量修复后刷新后续结转 |
| 审计不比较 `teacher_salary` | 已加入教师薪资对比，差异等级为 `MEDIUM`，并生成可应用 patch |
| 文件上传默认 50MB | xlsx 对账上传改为 10MB 限制 |
| Cookie 安全默认值 | `SESSION_COOKIE_SECURE` 改为默认启用，仅显式 `0` 或 `false` 时关闭；Cookie 改为 `SameSite=Strict` |
| 基础安全响应头 | 所有请求统一添加 `X-Content-Type-Options: nosniff` 和 `X-Frame-Options: DENY` |
| 考勤批量操作逐条请求 | 新增 `/api/staff-attendance-batch`，前端批量填充/清空改为一次请求 |
| 金额合理性校验 | 充值/赠送金额允许负数但限制绝对值不超过 100000；学生单价禁止负数且限制不超过 10000；负数充值前端二次确认 |
| 冗余死代码 | 已删除未使用的周课表导出函数、`/api/derived`、`renderProfiles()`、`renderStaffProfiles()` |
| 服务器更新流程缺失 | 新增 `scripts/server-update.sh`，执行备份、拉取、重建、HTTPS 和数据库验证 |
| 服务器文件清点缺失 | 新增 `scripts/server-inventory.sh`，只读列出目录、容器、镜像、数据卷、证书和清理候选 |

## 已核实但暂不处理

| 问题 | 原因 |
| --- | --- |
| 登录无速率限制 | 用户指定最后再调整 |
| 默认密码/首次登录强制改密 | 用户指定最后再调整；上线期间先靠账号分发和手动改密控制风险 |
| 每月每学生仅一条充值记录 | 当前业务模型以月度汇总为准，改为多流水会影响对账、结转和界面，需要单独设计 |
| 结转逻辑重构 | 属核心金额链路，现有逻辑已经可用；重构需配套测试后单独做 |
| SQLite 迁 MySQL/PostgreSQL | 需要先稳定当前线上 Docker + 备份流程；迁移属于后续阶段 |
| Session 持久化 | 当前单机试用可接受；多实例或重启免登录再改为数据库/Redis |

## 数据库与代码位置

线上代码目录：

```text
/root/liming-course-system
```

线上 SQLite 数据库在 Docker 数据卷中，容器内路径为：

```text
/app/data/liming-local.sqlite
```

这意味着更新代码不会覆盖数据库。但以下命令会有删库风险：

```bash
docker compose down -v
docker volume prune
```

## 服务器冗余判断

优先用只读脚本清点：

```bash
cd /root/liming-course-system
sh scripts/server-inventory.sh
```

通常可删除的候选：

```text
/root/liming-course-system-deploy.tar.gz
/root/liming-db*.tar.gz
/tmp/liming-local.sqlite
/tmp/check.sqlite
已确认不用的 /root/liming-course-system.pre-* 目录
```

必须保留：

```text
/root/liming-course-system
/root/liming-backups
/etc/letsencrypt
Docker volume: *liming_data*
```
