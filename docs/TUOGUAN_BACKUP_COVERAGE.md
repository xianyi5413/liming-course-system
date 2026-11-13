# 完整Excel v14覆盖核对清单

核对日期：2026-11-13。对应本轮 `feature/tuoguan-primary-pricing-audit-sync`；核对当前数据库52张业务/运行表、46张恢复源表。只记录结构，不包含学生、账户或资金明细。

| 来源表 | 人工查看位置 | 恢复位置/说明 |
|---|---|---|
| tg_students | 托管学生 | __关系映射 |
| tg_legacy_student_map | 隐藏恢复数据 | __关系映射 |
| tg_periods | 隐藏恢复数据 | __关系映射 |
| tg_rules | 托管收费规则 | __关系映射 |
| tg_calendar | 隐藏恢复数据 | __关系映射 |
| tg_attendance | 托管每日签到 | __关系映射 |
| tg_ledger | 托管充值流水 | __关系映射；含扣费/冲正/作废/替代，显示表只列有效充值/退款 |
| tg_requests | 隐藏恢复数据 | __关系映射 |
| tg_audit | 隐藏恢复数据 | __关系映射；包含原始审计及origin_json |
| tg_imports | 隐藏恢复数据 | __关系映射 |
| tg_import_sources | 隐藏恢复数据 | __关系映射 |
| tg_transfer_meta | 隐藏恢复数据 | __关系映射 |
| tg_transfer_keys | 隐藏恢复数据 | __关系映射 |
| tg_transfer_baselines | 隐藏恢复数据 | __关系映射；目标同步基线与移除标记 |
| settings | 系统设置 | 可见表＋__关系映射；只纳入业务设置白名单，排除凭据/外部配置 |
| teachers | 教师档案 | 可见表＋__关系映射 |
| students | 学生档案 | 可见表＋__关系映射 |
| student_grade_stages | 隐藏恢复数据 | __关系映射 |
| pricing_standards | 费用标准 | 可见表＋__关系映射 |
| student_pricing | 所有学生单价 | 可见表＋__关系映射 |
| teacher_salary_rules | 所有教师薪资规则 | 可见表＋__关系映射 |
| salary_tables | 隐藏恢复数据 | __关系映射 |
| salary_table_rules | 隐藏恢复数据 | __关系映射 |
| teacher_monthly_performance | 隐藏恢复数据 | __关系映射 |
| salary_table_templates | 隐藏恢复数据 | __关系映射 |
| salary_table_template_rules | 隐藏恢复数据 | __关系映射 |
| class_groups | 所有班级管理 | 可见表＋__关系映射 |
| lessons | 所有课程数据 | 可见表＋__关系映射 |
| fee_overrides | 隐藏恢复数据 | __关系映射 |
| recharge_records | 所有充值记录 | 可见表＋__关系映射 |
| student_opening_balances | 期初余额 | 可见表＋__关系映射 |
| teacher_adjustments | 隐藏恢复数据 | __关系映射 |
| teacher_adjustments_monthly | 隐藏恢复数据 | __关系映射 |
| teacher_travel_fees | 所有教师车费明细 | 可见表＋__关系映射 |
| staff | 员工 | 可见表＋__关系映射 |
| staff_salary_monthly | 所有员工薪资 | 可见表＋__关系映射 |
| staff_attendance | 所有员工考勤 | 可见表＋__关系映射 |
| operating_expenses | 所有日常开销 | 可见表＋__关系映射 |
| roles | 角色管理 | 可见表＋__关系映射 |
| role_permissions | 隐藏恢复数据 | __关系映射 |
| role_filter_presets | 隐藏恢复数据 | __关系映射 |
| users | 账号管理 | 可见表＋__关系映射；认证哈希在__账号认证数据 |
| user_teacher_bindings | 隐藏恢复数据 | __关系映射 |
| user_page_permissions | 隐藏恢复数据 | __关系映射 |
| user_filter_presets | 隐藏恢复数据 | __关系映射 |
| operation_logs | 操作日志 | 可见表＋__关系映射；按包含操作日志选项 |

所有学生费用明细、所有课时明细等计算查看表由源数据生成；不替代课程、费用规则、覆盖金额和工资数据。四张托管查看表不参与修改式恢复，原始整数分、ID、快照与完整历史始终由隐藏映射还原。长文本保留在__长文本分片，__恢复元数据校验各表摘要。

## 明确排除的表

| 表 | 原因 |
|---|---|
| backup_records | 外部文件路径不能随Excel恢复。 |
| audit_events | 包含原始请求前后快照，非核心业务恢复源。 |
| audit_logs | 可以重新执行数据检查生成。 |
| audit_ignores | 不影响核心业务恢复。 |
| parent_message_greetings | 不属于核心教务数据。 |
| course_notice_completion_records | 不属于核心教务数据。 |

操作日志可选不等于托管审计可选：tg_audit始终保留。会话、Token、外部云盘授权不应通过业务Excel传播。实际导出/校验/隔离恢复、权限及金额逐条比对见[TUOGUAN_MANAGEMENT.md](TUOGUAN_MANAGEMENT.md)。
