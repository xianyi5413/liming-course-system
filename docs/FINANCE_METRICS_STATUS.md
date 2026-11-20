# 课程状态与财务统计卡片实施记录

实现与定向验收完成时间：2026-11-20 15:00（北京时间）。版本`20261120-finance-metrics`，功能分支`feature/finance-metrics-course-status-refine`。

## 起点与版本核实

- 开始时工作区干净，基线为上一轮`0a83c4917207b17a891fe04afee4facf4fa4a672`。fetch后origin/main为`8a38925`，已经合入上一轮，二者源码无差异；新分支从有效功能提交创建。
- 本地5177启动PID为8748，核实CWD为本项目、DATA_DIR为项目data、DB_PATH为`data/liming-local.sqlite`，运行上一轮版本。重启前对真实库做SQLite在线备份和52张表内容摘要核对；测试数据库、Edge资料目录和截图全部独立。
- 正式站点仅GET诊断：版本和首页资源参数均为`20261120-detail-permission-status`，Git SHA为空。app.js、tuoguan.js、styles.css规范化换行后均与上一轮提交一致。生产业务API未登录；未读取实际候选配置、未检查用户缓存、未修改真实课程、未部署。
- 收尾尝试重启本地5177时，自动审批返回“blocked by policy”，整条命令未执行。PID 8748继续运行上一轮后端；静态文件已随工作区更新，尚不能把5177作为本轮前后端完整验收环境。需要人工正常停止原服务后从本项目重启，并核对/api/version为新版本。没有改用其他方式绕过限制。

## 实现与边界

课程状态问题来自前后端都把未缴费列为默认项，加上配置／历史候选合并，因此该项会重新出现。新增一个无依赖的共享课程状态模块统一五项默认值、有效自定义候选和显示映射；没有第二套下拉组件。前后端均拒绝新指定历史欠费名称，旧字段通过受信任的导入／恢复及源课复制继续保留。详见[课程状态说明](COURSE_STATUS.md)。

财务计算不使用展示转换。历史状态解释、课程收费、余额和薪资函数保持旧口径。旧欠费课程显示为已上后，保存相同展示值仍保留原欠费和薪资字段。原系统仅对财务状态已上计费，历史未缴费课时的应收项可能为0；本轮不自行补收。需要按单价追收历史欠费时，应另行确认业务及迁移方案。

两处充值页继续共用rechargeAnalysisMarkup、rechargeAnalysisSplitMarkup，托管ledgerAnalysis和普通rechargeAnalysis计算未改。CSS统一到已有块，删除后段固定84px／96px高度、164px标签宽度和放大字号等冲突；未加!important。1440px合成样本两页统计区均274→162px（减少约41%），六卡均56px高，内边距7px 9px、间隔3px、金额17.6px；手机两列，分组自然换行。两页原有统计口径不同的地方仍保持，例如托管渠道只统计实际充值。

托管详情仍只有studentDetail(id,{showSummary})。fields及对应节点从7改4，按原字段分别读取消费、充值和月末余额，不合计实际与赠送。学生页面无汇总模式、动态日历、历史一次读取及异步请求保护不变。切月失败提示改为导航下的提示浮层，不再撑高缩小后的弹窗。

学生查询仍由studentStatementMetricCards提供数据，返回5卡，HTML初次渲染和updateStudentQueryResultsOnly共用金额对渲染。formatActualGift分别调用formatMoney，actualGiftMarkup为负值单独加已有负数样式，保留0、千位分隔和两位小数。局部刷新保留卡片节点；长值在卡内换行。

PNG继续复用相同卡片数据与drawShotMetricCards，五卡一行，月份汇总标题由y=342上移至246，高度随新位置计算。正常金额单行；极长金额分两行并按可用宽度适配字号，不使用省略号。家长端“相关赠送金额全为0才隐藏”的规则不变，隐藏时标题也不再带赠送。Excel账单XML与文件名不变。

没有新增业务字段、权限种类或依赖，没有修改账户算法、默认角色或数据库结构。托管学生、费用、充值流水、学生查询及全局只读仍按原权限控制。

## 实际验证

均为PowerShell命令，写入只在临时合成库执行。Edge通过现有tests/helpers/chrome_cdp.js连接；截图保存在被忽略的`.tuoguan-local/finance-metrics-status/`，不提交。

| 实际命令 | 结果与范围 |
|---|---|
| `node --test --test-concurrency=1 tests/tuoguan_detail_permission_status.test.js` | 12通过：权限、详情、四卡金额、切月、状态、自定义、班级和截图、v14 |
| `node --test --test-concurrency=1 tests/finance_metrics_status.test.js` | 首轮1通过、3失败；下列定向复测解决全部失败，本文件4个独立用例最终通过 |
| `node --test --test-name-pattern='reserved\|Edge both\|Edge five' tests/finance_metrics_status.test.js` | 3通过 |
| `node --test --test-name-pattern='Edge both\|Edge five' tests/finance_metrics_status.test.js` | 2通过，核对超长PNG分行及手机截图 |
| `node --test --test-name-pattern='reserved\|Excel v14' tests/finance_metrics_status.test.js` | 2通过，包含历史财务及自动薪资保护、恢复 |
| `node --test --test-name-pattern='Edge five' tests/finance_metrics_status.test.js` | 1通过，补充实际费用编辑后五卡局部刷新和历史课程标签 |
| `node --test --test-name-pattern='Edge stable detail' tests/tuoguan_finance_ui.test.js` | 首次发现错误提示撑高弹窗；修复后1通过 |
| `$env:TEST_BROWSER='edge'; $env:CAPTURE_QUERY_BASELINE='1'; node --test --test-name-pattern='student statement Excel XML' tests/student_query_integration.test.js` | 1通过；更新合成PNG几何／像素基线前，逐项确认原Excel XML、文件名不变 |
| `node --test --test-name-pattern='API stores dictionaries\|statement subject counts' tests/course_type_ui_query_backup.test.js` | 2通过：班级类型、复制与已计费课程汇总；旧欠费改为隔离历史夹具建立，不再通过新增接口创建 |

上述重复复测不重复计数：共20个独立用例通过，未解决失败0，其中9个Edge用例。新专测首轮失败分别为误把旧欠费零价规则预期为120、托管退款卡次序断言错误、测试在页面加载完成前选择学生；已按实际架构修正测试，未据此改账户算法。

另执行`node --check`检查app.js、tuoguan.js、course-status.js、server.js，及`git diff --check`。没有重复跑全部历史套件。

只读基线对照脚本`node .tuoguan-local/finance-metrics-status/compare-baseline.cjs`使用上一轮独立checkout和同一合成数据库副本，确认旧下拉确含未缴费，新旧课费、实际／赠送余额、应收、教师成本完全相同。真实库摘要脚本`local-check.cjs before/after`核对52张表、完整性及外键；开发期间业务记录无变化。

## 数据、恢复及主要文件

完整Excel仍v14。恢复逐表核对lessons、fee_overrides、students、recharge_records、student_opening_balances、tg_students、tg_attendance、tg_ledger、roles、role_permissions、users、user_page_permissions及custom_course_statuses；另有原详情测试覆盖参与周期和作废资金。重复初始化不增加扣费，不改变托管月度快照。原有导出系统未改。

真实本地只读统计：1864条课程、18名托管学生、649条签到、635条账本；原始未缴费status、旧lesson_status欠费、二者冲突、自定义未缴费配置均未发现。生产库未访问，不能用此结果推断线上历史情况。

主要源码：public/course-status.js、public/app.js、public/tuoguan.js、public/styles.css、public/index.html、src/server.js。测试：finance_metrics_status、tuoguan_detail_permission_status、tuoguan_finance_ui、student_query_integration、course_type_ui_query_backup及合成PNG基线JSON。文档：README、本文、COURSE_STATUS、TUOGUAN_MANAGEMENT、TUOGUAN_BACKUP_COVERAGE和Obsidian纯文本总结。

## 价值与后续

本轮有明确价值：课程状态选择符合业务概念，财务解释不因显示变化而被改写；充值统计明显紧凑，两种金额保持邻近可比较；只有一个详情组件和一套共享统计样式，冲突CSS减少，维护成本下降。五卡PNG已同步，没有新增财务系统或卡片框架。

大金额在手机上仍可能换行，这是完整显示所需；截图金额很长时也会分行。后续值得根据真实使用继续调整窄屏导航占用，并明确历史欠费课时是否需要另行追收。暂不需要重写账户算法、重新开发Excel、增加复杂缴费状态系统或全面重构卡片。

人工事项：先手工重启本地5177，确认原DB_PATH不变且/api/version为`20261120-finance-metrics`；再按正常流程审核分支、发布正式站点，核对版本／资源参数和实际候选。生产历史欠费记录及真实用户缓存未验收。若要求把历史欠费课时纳入收费，先确认口径与迁移范围。本轮不自动合并main、不强推、不部署。
