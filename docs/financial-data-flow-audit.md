# 金额数据流和冗余代码核查记录

核查日期：2026-05-05

## 核查结论

当前系统的核心金额链路是清晰的：课程录入到 `lessons`，单价由 `fee_overrides`、`student_pricing`、`pricing_standards` 决定，`feeDetails()` 按学生展开后进入 `studentSummary()` 结算学生余额，再由 `financeBase()` 按区间汇总经营指标。

本轮确认并修正了一处会影响经营分析的口径问题：顶部“收入”使用现金认现口径，但老师、年级、科目、班型和 Top 学生排行此前仍用课程标价汇总。现在有效课时会生成：

- `allocated_revenue`
- `allocated_gift_consumption`

经营拆分统一引用 `allocated_revenue`，和顶部收入保持同一口径。

## 金额数据流向

1. `lessons` 保存课程、状态、老师课时费、学生名单。
2. `unitPriceFor()` 按优先级决定每个学生的课时单价：
   - `试课` 直接 0。
   - `fee_overrides` 单节手动价最高优先级。
   - `考试` 默认 0。
   - `student_pricing` 学生专享价。
   - `pricing_standards` 标准价兜底。
3. `feeDetails(monthKey)` 把一节课拆成多条学生明细。
4. `studentSummary()` 汇总学生当月：
   - `total_fee`
   - `actual_consumption`
   - `gift_consumption`
   - `actual_balance`
   - `gift_balance`
5. `ensureCarryOver()` 把 n 月余额写入 n+1 月 `prev_actual` 和 `prev_gift`。
6. `financeBase(range)` 汇总区间：
   - 现金收入：`allocated_revenue`
   - 赠送消耗：`allocated_gift_consumption`
   - 教师课时费：按 `lesson_id` 去重，避免多学生课重复计薪
   - 教师车贴、员工薪资、日常开销
7. `financeBreakdowns()` 生成经营拆分和风险列表。

图示见 [money-data-flow.svg](money-data-flow.svg)。

## 已核实的计算口径

| 项目 | 当前口径 | 核查结果 |
| --- | --- | --- |
| 学生课消 | 仅有效课时计费；考试课只有手动价大于 0 才计费 | 合理 |
| 学生余额 | 现金优先，赠送兜底；总资金不足时实际余额为负 | 合理 |
| 跨月结转 | 读取上一有数据月的 `actual_balance` 和 `gift_balance`，写入下月上月结转 | 合理 |
| 教师课时费 | `financeBase()` 用 `lesson_id` 去重，避免一节多学生课程重复计入老师成本 | 合理 |
| 教师明细 | 老师角色只看本人矩阵课表和教师明细 | 合理 |
| 员工薪资 | 月薪按标准天数折算，日薪按考勤 pay_units 计算 | 合理 |
| 经营收入 | 按 `allocated_revenue = unit_price * actual_consumption / total_fee` 认现 | 已统一 |
| 经营拆分 | 老师、年级、科目、班型、Top 学生统一按 `allocated_revenue` | 已修复 |
| 应收合计 | 同一学生的未缴费课时和账户欠款取较大值，避免双重计入 | 合理 |

## 仍需注意的边界

1. 自定义日期范围跨半个月时，`financeBase()` 的现金收入分摊仍使用学生所在整月的现金/赠送消费比例。这是当前设计，优点是月度资金口径稳定，缺点是半月报表不是逐日现金核销。
2. `studentSummaryToDate()` 是历史累计视图，累计课消、充值和消费，但最终余额取最新月余额；它不是会计流水，不用于替代每月结转。
3. 负数充值目前没有禁止，因为线上数据中可能用负数表示退费或冲抵。后续应把“退费”做成独立类型，而不是简单禁止负数。

## 冗余代码核查

| 位置 | 结论 | 是否影响运行 | 建议 |
| --- | --- | --- | --- |
| `GET /api/audit-logs` | 与 `/api/audit/logs` 重复 | 不影响，只是维护成本增加 | 本轮已删除旧端点，保留 `/api/audit/logs` |
| `dateKeyFromDay()` 和 `weeklyScheduleRows()` 一组函数 | 当前没有 API 调用 | 不影响 | 若确认不再做旧版周课表导出，可删除 |
| `renderProfiles()` / `renderStaffProfiles()` | 旧视图兼容入口，当前路由已拆分 | 不影响 | 保留作为旧 localStorage 兼容或后续删除 |
| `.profile-tab` 事件绑定 | 当前 DOM 没有 `.profile-tab` 按钮 | 不影响 | 本轮已删除 |
| `.t-*` 排版工具类 | 样式工具类，当前 JS 未直接引用 | 不影响 | 可保留给后续 UI 使用 |
| 服务器 `/root/*.tar.gz`、`/tmp/liming-local.sqlite` | 部署临时文件 | 不影响运行，但含数据库隐私 | 部署确认后删除 |

本轮没有强行删除低风险兼容代码，避免在刚上线试用阶段引入额外行为变化。

## 服务器清理建议

确认网站已能打开、数据库已显示 2026-02 到 2026-05 的课程数据后，可以在服务器执行：

```bash
rm -f /root/liming-course-system-deploy.tar.gz
rm -f /root/liming-db*.tar.gz
rm -f /tmp/liming-local.sqlite /tmp/check.sqlite
```

不要删除：

- `/root/liming-course-system`
- Docker volume `liming-course-system_liming_data`
- 容器 `liming-course-app`、`liming-course-nginx`

## 后续建议

1. 给登录接口加速率限制，避免公网暴力尝试密码。
2. 配域名和 HTTPS 后，把 `SESSION_COOKIE_SECURE` 改回 `true`。
3. 把退费从负数充值拆成独立业务类型。
4. 等试用稳定后再迁 MySQL 或 PostgreSQL。
5. 做每日数据库备份并复制到服务器外部位置。
