# 托管管理实施与验收记录

## 2026-11-13 托管排序、年级分界、费用范围与矩阵定位

完成时间：2026-11-13 20:45（北京时间）。基线 `edab4992ad17bc1422bd44dd5cd6bcb18d0997e4`，分支 `feature/tuoguan-sorting-grade-hover-summary`，版本 `20261113-tuoguan-grade-hover-summary`。本节覆盖本轮变化，保留既有收费、同步和备份实现及下方历史记录。

### 展示与历史保护

- `renderLedger`先使用原筛选，后用共享年级/姓名比较器排序，再按业务日期、账本ID排序；同名按student_id分组，不合并档案。gradeFor缓存每条记录的“业务日参与年级→档案年级→未记录”，同时供列、筛选、统计和排序使用。排序不改账本ID、日期或财务重放顺序，复选框仍按真实ID。
- 年级标签打开现有紧凑表单及自定义下拉框，和档案编辑、状态保存共用saveProfile。grade改变必须传grade_effective_date；前端默认北京时间今天，保存时禁用提交，失败保留旧列表并显示原因。需要tgStudents且账号可写，后端同样校验。
- student事务中检查所有受影响参与周期。如果生效日及之后的待改年级区间内存在任何已保存考勤或资金证据（含零费用/作废证据），返回409，整批不变。没有业务时，将跨界周期截到前一天，新建后半段并复制状态、默认值和备注；尚未开始的不同年级周期按分界更新，既有同年级周期不重复创建。没有参与周期只改档案，不自动入托。已有业务的周期也不能通过旧period接口直接改年级。版本校验、request_id幂等与事务沿用原实现。
- 档案显示所选年级；如选择未来生效日期，参与年级在生效前仍旧、生效后才新。月内跨年级时矩阵/费用行继续采用现有月度历史标签口径，每格收费仍以当天周期及已存grade/rule_json为准。历史参与信息确实缺失的资金按用户要求回退当前档案，不凭空补历史周期；金额和资金证据不改变。
- 年级变更同时保留档案before/after、周期分界审计及生效日期，操作日志显示旧/新年级与日期。历史考勤、规则快照、充值和已结算扣费均不改写，也不自动产生考勤、消费。
- 费用snapshot复用既有月末以前账本分组与account，新增has_month_business（当月重叠周期、保存考勤、有效账本三者任一）。前端使用该标记或opening_actual非零或opening_gift非零；不按档案状态剔除。统计与表格共用最终rows，未增加财务接口或重写结算算法。

### 矩阵定位与性能

每次render预建列索引；矩阵上委托pointerover/leave/cancel/down及focus/keydown。只切换旧/新行、列与交叉格的CSS类；同格内部移动不写DOM，不监听mousemove重建表格。前四冻结列及两层日期表头使用同一类和系统surface-hover，交叉格加细内边框，业务标签颜色和尺寸不变。触摸清除临时高亮，切月/筛选生成新表后不继承旧定位。

Edge实际指针验证了行名、日期名、状态格、横纵滚动、明暗主题、离开清除、触摸清除及键盘定位；单格保存、行列批量、筛选清空选择仍有效。40余学生矩阵同格20次真实指针移动耗时331毫秒（包含CDP往返），DOM修改0次；不是纯渲染基准，也不声称任意规模零耗时。截图仅留本地忽略目录。

### v6同步、权限、Excel v14

不改协议、表结构或权限树。两隔离库完成首次导入、重复跳过，随后档案升年级/拆周期、新考勤/改状态、充值新增/编辑/作废和新规则同步；汇总与分账一致。B的独立学生保留，双方年级及周期独立修改产生冲突，整批阻止。旧预览失效、非法关联/资金及强制SQL中途失败均被拒绝，业务、来源键和基线完整回滚。

规模样本40档案、400格考勤及400条扣费，v6文本1,902,622字节，预览+原生备份+导入401毫秒；备份独立打开、签名一致、integrity_check通过。重复导入签名不变。没有正式线上操作；兼容性/权限/关联错误须在目标预览阶段处理，不允许整库覆盖或强制跳过冲突。

五页API逐项允许/拒绝及只读限制通过，普通教师未获得托管权限；Edge角色树保存后即时生效，个人权限裁剪、财务信息隔离及年级修改的权限限制通过。收费范围读取遵循tgSummary，高亮无需新权限。

完整Excel v14导出并恢复隔离库，比对全部14张托管表、roles、role_permissions、user_page_permissions，包含周期分界、当前/历史年级、规则快照、有效与作废资金、审计、来源UUID、基线及映射；恢复后月度消费/分账相同，无外键或完整性错误。四张可见表继续正确显示，没有费用汇总Sheet，本轮不新增冗余Sheet。权限/备份代码经验证完整，故不做无意义修改。

### 文件与实际定向验收

修改文件：public/tuoguan.js、public/styles.css、src/domain/tuoguan.js、src/domain/tuoguan_log.js；public/index.html与src/server.js更新缓存/版本标识；tests/tuoguan_stage_sync.test.js、tests/tuoguan_stage_ui.test.js新增覆盖；tests/tuoguan_batch_ui.test.js适配年级生效日期；README、本实施文档及备份清单补充记录。无数据库迁移、收费引擎或第三方依赖变更。

以下为实际执行命令（名称筛选分次运行，同一用例重跑不重复计数）：

```powershell
node --test --test-name-pattern='stage pricing|grade boundary|month business' tests/tuoguan_stage_sync.test.js
node --test --test-name-pattern='grade boundary|month business' tests/tuoguan_stage_sync.test.js
node --test --test-name-pattern='40 students' tests/tuoguan_stage_sync.test.js
node --test --test-name-pattern='five permissions|Edge grade|Edge sorted|Edge fee scope|Edge matrix locator|v14 grade' tests/tuoguan_stage_ui.test.js
node --test --test-name-pattern='Edge grade' tests/tuoguan_stage_ui.test.js
node --test --test-name-pattern='Edge sorted|Edge matrix locator' tests/tuoguan_stage_ui.test.js
node --test --test-name-pattern='stale previews|tampered format' tests/tuoguan_transfer.test.js
node --test --test-name-pattern='row/column intersection|role tree|ledger uses' tests/tuoguan_batch_ui.test.js
```

去重后：领域5、API/Edge/新Excel6、同步保护2、既有矩阵/角色/历史年级回归3，共16项通过，未解决失败0。首次新增用例发现测试夹具取错money返回值、漏填调整依据、日志范围过宽，以及档案页没有月份控件、受限账号无设置导航等测试假设，均已修正并仅重跑受影响用例；没有掩盖未解决失败。另执行node --check（相关JS）、git diff --check及离线Prettier。零合计但实际/赠送分别非零的前端显示用合成响应验证；真实结算器可能先抵债，未为测试改变账务算法。

### 本地数据与边界

更新5177前核对监听PID、工作目录及DB_PATH=data/liming-local.sqlite，使用原生SQLite备份；最终切换另建停止写入后的最新备份，以保护工作期间正常业务变更。真实页面验收只读，测试签到/充值均在隔离库。备份、截图、验收JSON与凭据临时文件留在忽略目录，凭据使用后删除，不进入Git。

本轮无未完成开发项。管理员需根据真实升学日期选择生效日；若提示已有业务，不能用改年级回写旧账。正式环境部署与导入由管理员另行安排，先升级相同兼容版本并核对冲突预览；本轮只模拟线上。

## 2026-11-13 托管分学段收费、操作日志与同步

完成时间：2026-11-13 20:06（北京时间）。基线 `962d715da79e365be7cd82cadec636627c33f366`，分支 `feature/tuoguan-primary-pricing-audit-sync`，版本 `20261113-tuoguan-stage-audit-sync`。本节保留当轮实现，当前变化以文首最新章节为准。

### 收费及历史保护

`public/tuoguan_config.js`由前后端共用，明确“三年级→小学、初一/初二/初三→初中”。四处学生新增/编辑/管理入口、筛选、排序、标签和导入校验共用年级列表。小学30/25元、初中50/25元，放假/不适用0元。设置追加不可变规则，按学段、生效日期、同日记录顺序选择；负数、小数分、无效学段拒绝。已保存考勤以grade及rule_json为准，修改状态仍按同一快照收费；未来或历史未保存日期根据对应参与年级和日期选择规则。修改当前档案年级不会回改过去。

`tuoguan_settlement`沿用一套plan/apply/settle及原账务分配器。有效旧快照不会因JSON格式不同重新结算，旧50/25规则原字节保留。普通签到、批量签到、导入和恢复共用结算路径；保留冲正链、实际/赠送抵扣及跨月结转。默认不适用与未保存出勤仍只显示，不自动生成考勤或消费。旧pending及异常占位的既有迁移规则继续保留。

### 页面权限与接口

五个键分别为tgAttendance/tgStudents/tgLedger/tgSummary/tgSettings。navGroups（本项目实际导航配置）、PERMISSION_TREE、PAGE_PERMISSION_KEYS、AREA_PERMISSION_KEYS及首次访问页面一致；同时校准“托管、日常开销、经营概览/期间概览”名称。studentPricing及teacherSalaryRules仍是实际存在的次级编辑页，保留；feeDetails仅作为历史兼容键，不显示为新页面。

`tuoguan_permissions.migrate`使用可嵌套savepoint，将role_permissions和user_page_permissions中的tgFinance等价展开为四个管理页面，支持重复启动及Excel恢复。仅签到用户、普通教师和原默认角色不扩权。前端兼容旧权限缓存；后端逐动作校验，快照按请求页面裁剪：签到/档案响应不含金额、账本或收费快照。即使省略view参数，非管理员汇总用户也不能读取设置规则。历史充值接口仅对tgLedger/tgSummary开放；批量考勤还需tgAttendance，资金操作需tgLedger，规则需tgSettings。复制/导入要求四个管理权限同时具备，沿用全局只读。原角色权限变更日志继续记录。

### 交互与审计

全选遍历可用行、列并同步集合；额外记录用户选择过的维度，防止“曾选列→最后一列取消”被空集合通配符解释成所有日期。只选行/只选列/交集保持，筛选和切月重新初始化，选择本身不请求保存。

单格成功清空旧提示，仅原位更新格子，保持焦点和行高；批量成功复用showToast。充值删除复用同一Toast，2.6秒消失，连续调用替换提示。学生详情在同一弹窗底部单独请求历史资金，按ID、倒序、有效手工充值/退款过滤；金额沿用原格式，长表内滚动。切月不替换弹窗或历史区，重新打开重新请求。

考勤tg_audit在事务内保存before/after、当时姓名和默认状态；不变更、不成功和幂等重放不产生虚假成功日志。操作主日志只记录摘要及审计起止编号，详情接口按权限读取已提交审计，避免4000字符限制截断大批量明细。80格用例验证完整展开；普通状态、未保存默认状态、备注变更准确区分。档案、日期、参与、充值修改/删除、收费和复制/导入补充对象及金额/状态。系统其他模块日志没有重构。

### 文本同步v6

保留UUID、checksum、预览签名、原生SQLite备份与事务机制。业务包包含学生、参与范围/default_status、学段规则、日历、考勤快照、全量账本及更正/作废、历史导入/来源和审计。财务记录保持原消费链，不调用额外扣费。

新增接收端tg_transfer_baselines，以来源UUID＋表＋行UUID记录来源hash和接收后的本地hash。来源变、目标未变时更新；双方变且不同则整批报冲突；来源未变而目标有独立修改时保留目标，且不错误前移基线。首次相同内容可建立基线；老导入缺基线且内容不同不会猜测覆盖。未知身份的同名学生仍需人工核对。已知版本倒退拒绝。

来源移除空参与周期可安全同步删除；保留UUID墓碑，旧导出不能复活已移除周期。其他业务记录缺失不会自动硬删除。充值删除通过voided状态同步，账本证据始终保留。合并前后核对参与重叠、考勤与消费链、作废替代关系及账户重放；任何失败全事务回滚。教师ID不跨库照搬，v6提供日历教师姓名关联，目标唯一对应后使用目标ID，缺失/歧义阻止。旧文本没有教师信息时明确提示并保留目标已有教师。

审计原payload不改写，origin_json在首次导出时保存来源实例及涉及的原编号→UUID词典；后续经B再次导出仍保留A证据。文本不携带课程、角色、账户或教师业务表，也不复制本地RPC幂等缓存、旧补课学生映射、接收端同步基线。UUID及来源标识由包提供，目标本地同步状态独立保存；完整Excel则保留这些本地恢复表。预览金额是来源包统计，不是覆盖整个目标数据库后的总额。

### 数据库与Excel

新增tg_rules.stage、tg_audit.origin_json、tg_transfer_baselines；原表/记录和外键不破坏。升级前原生备份，迁移可重复运行。旧rules.stage空值是历史证据，新增两条学段默认规则；不把旧统一规则改写为小学。

Excel v14新增四张只读查看Sheet，签到为长表，资金表区分实际/赠送，规则显示学段及生效日期。隐藏恢复映射仍是托管原始数据源，包含完整账本及审计。完整文件先进入自身版本校验，修复导入入口原先误用空白模板版本门槛拒绝v13的问题；实际走previewImport/importFullExcel验收。v13缺新字段时补默认值，恢复后迁移旧权限并种入学段规则，旧费用快照不变。[覆盖清单](TUOGUAN_BACKUP_COVERAGE.md)核对52张实际表：46张核心源表，6张有明确排除原因。操作日志可选；tg_audit始终随托管恢复。密码哈希仅在原有veryHidden认证表，不在可见Sheet；外部密钥、Token及路径配置继续排除。

真实库的完整Excel验证发现reconstructData每个可见行重复扫描全部映射，改为一次构造“表页/行/来源表”索引，保留重复候选检查，减少大文件恢复等待；没有改变恢复优先级和摘要校验。

### 验收与实测命令

按风险分组执行，修改后只补测受影响范围；按不同用例统计54项通过，未解决失败0：auto_consumption 9、batch 16、transfer 8、stage_sync 8、batch_ui 7、stage_ui 6。没有运行整个项目全量测试。

实际执行的主要命令（部分批次包含后来新增的用例，补测不重复计数）：

```powershell
node --test --test-concurrency=1 tests/tuoguan_batch.test.js tests/tuoguan_transfer.test.js tests/tuoguan_auto_consumption.test.js
node --test --test-concurrency=1 tests/tuoguan_stage_sync.test.js tests/tuoguan_batch.test.js
node --test --test-concurrency=1 tests/tuoguan_stage_ui.test.js tests/tuoguan_batch_ui.test.js
node --test --test-concurrency=1 tests/tuoguan_stage_sync.test.js tests/tuoguan_stage_ui.test.js
node --test --test-concurrency=1 --test-name-pattern='five permissions|committed attendance|large batch' tests/tuoguan_stage_ui.test.js
node --test --test-concurrency=1 --test-name-pattern='v14 visible' tests/tuoguan_stage_ui.test.js
node --check src/server.js
node --check public/app.js
node --check public/tuoguan.js
git diff --check
```

涵盖小学/初三混合批量、30/50/25元、规则调整与跨月/历史年级、有效快照逐字节保留、重复迁移、v5文本、v13布局、v14恢复、来源更正/作废/空周期移除、双方冲突、教师缺失/歧义、审计跨库来源、无权限/只读、80格日志、Edge矩阵/详情/Toast/规则输入/角色树/旧布局回归。v13合成备份实际去除新增Sheet及字段，并重新计算元数据摘要，不是只改版本号。

额外私有脚本 `.tuoguan-local/pricing-isolation.cjs`及其resume、`pricing-real-sync.cjs`和`pricing-daily.cjs`，分别完成真实库副本迁移与Excel恢复、A→B及重复文本同步、本地5177只读Edge验收。数据库、Excel、浏览器档案和详细记录留在忽略目录，未提交。初始副本649考勤/630流水/40周期迁移、重复启动、完整恢复后逐条一致，9—11月实际/赠送消费与结转余额一致；约2MB文本首次导入及重复导入成功，其他模块hash未变。期间用户正常修改业务，重启前再次备份，以649考勤/631流水/39周期为新基线逐条比对，未覆盖这些更新。

确认5177原进程CWD、DATA_DIR、DB_PATH后才重启。Edge 157使用既有tests/helpers/chrome_cdp；真实库验收拦截所有业务写请求，实测业务写入0，9/10/11月全选330/216/216格，设置默认值正确，详情切月历史区节点保持，控制台无异常。正式服务器未访问、未部署，main未合并。

### 使用边界与后续

- 新版来源与目标均应升级后再使用v6；老包能读，但旧包不含教师关联，缺同步基线的差异需核对。没有后台强制覆盖或自动解决双方资金冲突。
- 调整收费不追溯重算已保存考勤；确需历史调价应另走明确、可审计的更正流程。
- 完整Excel不是SQLite镜像：外部备份索引、技术诊断历史、运行缓存及外部凭据不在核心恢复范围。系统当前远端自动备份因百度应用未配置而暂停；本轮没有修改该配置。
- 值得后续做逐学生同步净变化预览和冲突辅助核对；暂无必要另建收费系统、逐按钮权限、无人值守双向同步或自动覆盖冲突。

## 2026-11-13 托管图标、左侧选择与居中布局

完成时间：2026-11-13 18:52（北京时间）。基线 `71d49aca5076c66685ed62598250f9aefd552784`；分支 `feature/tuoguan-matrix-layout-icons`；版本 `20261113-tuoguan-matrix-layout`。本轮仅调整UI及运行版本标识，batch-attendance、考勤、收费、数据库和备份格式不改。

### 实现

- NAV_ICONS仅替换tuoguan为签到表：圆角矩形内一枚勾选、三条记录线。保留24×24 viewBox，复用.nav-icon的18px尺寸、currentColor、1.8px描边及圆角线端，不新增依赖；首页、排课、学生等图标保留。检查public/index.html现有主题初始化，无须改动。
- renderMatrix复用table已有selectable列及序号插入机制，允许选择列表头传入文字“选择”；充值表原true参数仍显示资金全选。学生复选框整体移到行首，序号插在其后，末列为日期。空列表colspan按Boolean(selectable)计数，避免文字表头转Number得到NaN。第一表头行是全选、三个空格、各日期复选框；第二行是选择、序号、学生、年级、日期。
- frozenColumns改为4，uniformFrom／uniformUntil从第5列开始；原adaptiveHeaderRow仍为1。通用列宽函数在四列冻结时追加前三列实际宽度之和作为--frozen-third-edge，沿用原两个偏移；CSS同步第4列sticky、背景及表头层级。未另建宽度测量或状态管理。
- 删除学生列左对齐例外，矩阵th／td统一text-align:center与vertical-align:middle。Edge实测原状态按钮76px最小宽度超出格内可用空间，标签中心偏移约8.5px；改为100%格内宽度、border-box及flex居中，保留36px最小高度。复选框block＋自动水平外边距，标签vertical-align:middle；消除日期复选框约1.22px的行内基线偏移。未新增!important或空格／固定margin补偿。
- selectedStudents／selectedDates、paintSelection／clearSelection、批量预览与请求、版本／幂等／事务、局部更新、备注和结算全部沿用。选择框仍只作为前端临时状态；没有重复事件监听或新增业务字段。

### 定向验证

本轮8项独立用例最终通过，未解决失败0，没有重跑上一轮全部25项或全量财务回归。

1. `node --test --test-name-pattern='checklist icon|four frozen|matrix row|role tree|v13 Excel' tests/tuoguan_batch_ui.test.js`：涉及5项，初跑4通过、居中项失败。通过项为图标、批量主路径、权限及Excel恢复。居中检查定位到状态按钮实际偏移与复选框基线问题，修复后定向复测。
2. `node --test --test-name-pattern='four frozen' tests/tuoguan_batch_ui.test.js`：最终1项通过；中间将“保存提示推动整张表”的原行为与单元格行高／居中区分，修正测试比较口径，没有为通过测试删除原提示。悬停、打开选择器前后的绝对边界仍严格相等。
3. `node --test --test-name-pattern='matrix row|four frozen' tests/tuoguan_batch_ui.test.js`：最终2项通过，补查批量更新后的标签中心及手机收起侧栏布局。含行／列／交叉选择、全选清空、预览数量、四状态局部保存、未选格不变、滚动和筛选保持、切月清空；四列冻结偏移、两行表头对齐、序号、44px选择列、无右侧复选框、空学生、无日期、纵向表头冻结及横向滚动均通过。
4. PowerShell `$env:TEST_BROWSER='edge'; node --test tests/adaptive_table_columns.test.js`：2项通过，既有录入、教师、账号表及1100行测量无回归。
5. `node --test --test-name-pattern='Edge recharge has' tests/tuoguan_protection_ui.test.js`：1项通过，通用table的原充值全选、表头顺序、标签、金额对齐和刷新保持。
6. public/tuoguan.js、public/app.js、src/server.js的`node --check`及`git diff --check`通过。

边界框测试覆盖1440／1024／390宽度、浅色／深色、侧栏展开／收起；检查全部单元格计算样式、姓名／年级／四状态／复选框真实中心，偏差在1.1px内（含边框像素）。横向滚动后前四列位置不变且边缘相接，表头／正文对应；纵向两层表头间距30px。悬停、打开／关闭选择器不改变单元格行高，普通保存成功／失败及批量保存后仍居中。SVG实际getBBox在viewBox内，颜色／线宽／尺寸与其他导航一致，并检查了明暗主题截图。

### 权限、备份与真实数据

PERMISSION_TREE、authorizeApi、userHasAnyPermission及托管路由已检查，仍是tgAttendance与tgFinance两项；本轮没有修改授权。复用角色管理Edge用例验证勾选保存、会话即时生效、只读界面禁用；签到写权限可调用普通及批量接口，缺少签到权限、只读、仅财务权限均被拒绝，默认角色权限不扩大。

full_backup.js的FORMAT_VERSION仍为13，field_definitions继续包含13张托管表、角色及角色权限、账号及账号权限。复用上轮隔离恢复用例，批量出勤／请假／不适用、备注、停用日期、充值更正链和扣费／冲正证据、档案状态／参与周期、便携标识、审计及权限逐字段一致；9／10月汇总和账户余额一致，恢复settlement.updated=0，外键0错误、完整性ok，v5文本记录一致。复选框状态未入库，也未加入Excel字段。

本地5177更新前读取原PID72820的真实工作目录与环境，确认本仓库及data/liming-local.sqlite。私有备份位于`.tuoguan-local/matrix-layout-20261113/before.sqlite`。更新后Edge157只读打开9／10／11月、选择预览后取消，验证左侧顺序、前四列冻结、列数及居中；可编辑范围仍为330／234／312格，业务写入0。51张表指纹仅roles启动时间戳及operation_logs登录记录变化，角色其他字段一致；18档案、40周期、565格考勤、499条账本及各月金额不变，补课与教师薪资等业务表未修改。临时凭据已删除，数据库、截图和学生信息不提交。

### 文件、价值与后续

主要修改：public/app.js（托管图标、第四列偏移）、public/tuoguan.js（复用左侧选择列、表头和空态列数）、public/styles.css（冻结层级、居中与按钮宽度）、src/server.js（仅版本标识）、tests/tuoguan_batch_ui.test.js（更新列序及新增图标／布局验证），以及README和本实施文档。无新增依赖，无本轮未完成项或未解决失败。

1. 改动值得做，主要改善识别、选择位置与对齐，价值在日常操作一致性，不改变业务能力。
2. 签到表图标与房屋、日历、人物明显不同，小尺寸及主题验证通过；辨识手感仍有个人偏好。
3. 左侧选择更符合现有充值等表格习惯，并可与固定学生信息一起保持可见。
4. 实际列宽驱动偏移，窗口变化和横向滚动已验证；窄屏四列占用较多空间，日期仍需横向滚动，不宜再增加冻结列。
5. 状态居中由真实边界框验证，已消除按钮宽度导致的偏移，没有用文字空格伪造。
6. 复用table和列宽机制，只有最小补充，没有新增测量循环、框架或选择状态副本。
7. 原批量规则保持，主路径和局部更新回归通过。
8. 权限结构无需调整，沿用原签到写权限和后端校验。
9. Excel无需升级，现有v13已覆盖业务数据；临时选择不应备份。
10. 后续可根据手机实际使用反馈调整紧凑程度，优先维持统一表格组件。
11. 暂不建议新增图标库、更多冻结列、逐格复选框、独立权限键或重写批量收费。

### Obsidian总结（200字以内）

```text
教务系统｜托管图标与签到矩阵布局优化
1. 托管改用签到表SVG，与首页、排课和学生图标区分。
2. 学生复选框移至最左侧，顶部日期选择保留，前四列冻结，表头与标签统一居中。
3. 批量规则、收费和权限保持；Excel v13隔离恢复通过，8项定向测试通过，历史业务数据未变。
```

## 2026-11-13 托管批量签到与权限备份优化（历史记录）

完成时间：2026-11-13 18:37（北京时间）。基线 `6e52e0ea975d5e0a685e01e03a8414b0bf2de075`；分支 `feature/tuoguan-batch-attendance-ui`；版本 `20261113-tuoguan-batch-attendance`。本节保留当轮记录；当前交互以文首最新章节为准，年级与结算规则继续沿用。

### 实现与复用

1. 管理学生：先用隔离数据和Edge CDP MutationObserver复现，点1张卡片会改写4张卡片的属性／图标文本节点；没有发现全部禁用或卡片整体重建。当时测得弹窗高度始终453px，因此未把高度跳动当成已证实的唯一根因。paint现在先比较属性和图标值，只有变化时写DOM；修复后同一用例仅目标卡片发生变更。保存提示和错误提示预留行高，图标固定宽度，保存卡片不再透明度闪变，不增加动画。accept仍仅在档案内容变化时重建四个状态分区，参与周期变化保留节点。连续不同卡片队列、失败重读、版本与页面身份保护不变。
2. 删除tg-unsaved-dot的HTML和CSS，沿用四种状态颜色。数据库仍区分没有记录的默认值和已保存记录；选择框、预览及页面读取均不保存考勤。
3. 矩阵复用原table／colgroup，在日期文字上方增加30px选择行，最右侧增加学生选择列。只选行／只选列／行列交叉作用于当前筛选的可编辑格；半选、全选／清空、月份／筛选清空均已实现。选择不建立参与周期，不显示已停用日期。通用自适应列宽仅新增可选adaptiveHeaderRow与uniformUntil，默认行为不变，前3列冻结，末列窄且不冻结。
4. 批量弹窗复用CourseDetails.dialog、自定义下拉及badge。预览显示有效学生／日期／格数、已保存状态变化、首次保存、相同状态及不可编辑排除数。确认冻结本次目标和版本；接口成功后仅补丁更新对应按钮和本地考勤，保留表格节点／滚动／筛选，清空选择，只提示一次。失败不改本地格子，冲突提示刷新后重选；异步返回仍检查账号、源数据、月份及DOM归属。
5. batch-attendance接收month、status、cells；集中验证有效月份、四种状态、整数ID和版本、不重复目标、同月范围，最多15500格。按日期分组调用attendance，每日沿用500人上限、日历启用和参与周期校验、原备注继承及版本校验。外层复用mutate的BEGIN IMMEDIATE：考勤、日历物化、扣费／冲正、审计和tg_requests全部同事务，任一失败回滚。请求编号及payload哈希保证重放幂等，已保存同状态不重复扣费；整数分、现金／赠送分摊、欠费、跨月结转仍由原settlement与account模块处理。
6. 充值gradeFor缓存同一条记录的年级：有效业务周期年级优先，其次student_id对应档案的有效年级，否则未记录。展示、筛选、统计、学生标签共用。无新增字段、不改历史资金；此前“无周期一律未记录”的历史说明已被本节替代。

### 权限与备份核对

PERMISSION_TREE保持“托管管理 → 托管签到／托管学生、财务与设置”，不新增批量键，不修改默认角色权限。全局只读拦截、authorizeApi与托管路由共同工作；普通attendance和batch-attendance明确要求tgAttendance，财务权限不再隐式授权考勤写入。仅签到账号得到不含金额／计费规则的考勤响应，不能调用充值等财务接口。Edge实际勾选保存角色权限；同一已登录会话立即获得／失去写权限，角色改为只读后立即拒绝写入；只读界面无批量入口且选择框禁用。

完整Excel v13已有13张托管源表、roles、role_permissions、users、user_page_permissions等，无须改动field_definitions或full_backup，无新增数据库字段。隔离副本内构造跨日批量出勤、请假、不适用、跨月消费、充值更正及停用日期，再导出并恢复到另一隔离副本。13张托管表与4张账号权限表逐字段一致，包括档案状态、周期、考勤备注、日期状态、全部现金／赠送／扣费／冲正／更正证据、审计、请求及便携ID；9／10月费用与余额一致。恢复settlement.updated为0，外键检查0条、完整性ok。v5文本导出记录恢复前后相同。限制权限没有变成全开放。未为了新增选择框升级版本。

### 实际验证

- `node --test --test-concurrency=1 tests/tuoguan_batch.test.js tests/tuoguan_batch_ui.test.js`：21项通过（16项领域测试、4项Edge综合用例、1项Excel恢复）。覆盖四状态、备注／未选格保留、同请求幂等、同状态重试、净收费与冲正、冲突／停用／周期外／跨月／重复／非法输入／结算故障整批回滚，10格出勤500元，普通与批量的现金／赠送／欠费及跨月账户结果一致。Edge覆盖管理弹窗局部DOM、连续点击、保存失败、新建学生、四分区；行列／交叉选择、首次保存和排除预览、四状态单请求、滚动／筛选保留、切月清空、1440和390宽度对齐与冻结、权限和年级回退。
- `node --test --test-concurrency=1 --test-name-pattern='Edge recharge has|Edge statistics share' tests/tuoguan_protection_ui.test.js tests/tuoguan_dropdown_stats.test.js`：2项通过，历史年级、档案回退后的标签／筛选／统计、编辑删除及失败后的统计保持。原测试预期按新业务规则更新。
- PowerShell `$env:TEST_BROWSER='edge'; node --test tests/adaptive_table_columns.test.js`：2项通过，确认自适应列宽对既有录入／教师／账号页面和1100行场景无回归。
- public/tuoguan.js、public/app.js、src/domain/tuoguan.js、src/server.js的`node --check`及`git diff --check`通过。
- 合计25项独立测试最终通过、未解决失败0。开发中先观察到卡片无关DOM更新，再修复；测试编写期间修正了选择器、登录端点、编码及“空账号权限覆盖回退角色”的既有语义造成的测试夹具预期错误，未因此修改系统默认授权。

真实库使用`.tuoguan-local/batch-attendance-20261113/before.sqlite`作本地私有备份。通过进程环境核实5177工作目录为本仓库，DATA_DIR为data，DB_PATH为data/liming-local.sqlite，后更新本地实例。Edge157只读验收9／10／11月，实际可编辑格330／234／312；10月已停用日期保持排除。只打开批量预览并取消，所有业务写请求另行拦截，实际业务写入0；11月充值年级未记录0条。51张表指纹比较仅operation_logs及roles变化，前者为登录日志，后者仅启动updated_at，角色权限字段一致；18档案、40周期、565格考勤、499条账本及各月汇总不变，补课与教师薪资等业务表未动。截图、数据库、测试浏览器资料和临时凭据未加入Git，临时凭据已清除。

### 文件与交付范围

主要文件：public/tuoguan.js（矩阵／卡片／年级）、public/app.js（可选表头与列宽范围）、public/styles.css（提示占位、选择表头、小点删除）、src/domain/tuoguan.js（批量编排）、src/server.js（显式权限、操作日志及版本）；新增tests/tuoguan_batch.test.js、tests/tuoguan_batch_ui.test.js；同步tests/tuoguan_protection_ui.test.js、tests/tuoguan_dropdown_stats.test.js的年级预期；package.json增加test:tuoguan-batch入口；README与本实施文档保留历史并追加本轮记录。没有新增依赖。

没有未完成的本轮功能，也没有未解决的测试失败。Git仅提交源码、合成测试及文档，推送功能分支，不合并main、不部署正式环境。用户可体验真实业务下的布局与滚动手感；不需要为验收制造真实批量收费。

### 价值及后续判断

1. 闪烁根因：全卡片重复写属性／图标，保存状态和图标宽度另有布局波动可能；本次观测未出现整体DOM重建或全部禁用。
2. 修复效果：参与状态改变保留所有节点，MutationObserver由4张变1张；没有声称修复前重建过整个弹窗。
3. 批量修改值得做：同一批学生请假、放假或补录可以一次确认。
4. 行列复选比逐格更省操作，交叉规则仍能限制范围；少量单格继续沿用原编辑。
5. 误操作风险仍存在，因此只取可见可编辑格、清理过期选择，并在确认前显示实际范围；没有静默跨月写入。
6. 收费／冲正复用已存在算法，事务、幂等、版本及故障回滚测试提供依据，前端不计算资金。
7. 年级以ID和有效历史周期为准，无历史才回退档案；回退代表当前已知年级，并不伪造历史凭据。
8. 已覆盖普通／批量写入口、财务隔离、角色保存与只读拦截，未新增或扩大默认权限。
9. 当前v13完整恢复验证了本轮证据与权限，v5便携记录保持；不代表备份服务的外部存储配置已改变。
10. 没有重复实现收费、账户、弹窗或权限系统，只新增选择范围与跨日期编排；普通单格和批量保留各自轻量DOM更新。
11. 后续可观察真实操作量，再评估是否需要可检索的批量操作记录详情与更明确的历史年级来源提示。
12. 暂不建议增加独立复核状态、单元格复选框、跨月一键批改、独立批量权限或第二套财务算法。

### Obsidian总结（200字以内）

```text
教务系统｜托管批量签到与权限备份优化
1. 管理学生仅更新变化卡片，移除签到小点。
2. 日期列、学生行支持交叉选择，预览后一次批量保存，自动扣费与冲正。
3. 充值年级优先历史周期，缺失回退托管档案，筛选统计一致。
4. 复用签到权限，验证只读拦截及Excel恢复；25项测试通过，历史业务数据未变。
```

## 2026-11-13 托管保护规则、占位考勤规范与充值标签（历史记录）

完成时间：2026-11-13 18:08（北京时间）。基线 `d466581da58c9f0c16a27c22353963c1ccc4ddc6`；分支 `feature/tuoguan-protection-ledger-badges`；版本 `20261113-tuoguan-protection-badges`。本节保留当轮记录，当前规则以文首最新章节为准。

### 充值展示与成功反馈

充值表现在为复选框、序号、日期、学生、年级、类型、实际金额、赠送金额、支付方式、备注十列。姓名复用studentBadge／renderStudentBadge，独立年级复用renderGradeBadge。真实历史周期提供年级；无可靠周期显示未记录，姓名颜色沿用档案已有配色，仅作为姓名标签样式，不据此补填历史年级或改变统计分组。

检查发现早期学生标签原为6px圆角，后来共享entity-badge规则将其覆盖为胶囊。本轮在共享样式增加学生／年级的圆角变量，恢复两类标签的6px矩形；课程、学生档案和托管统一读取，不另写托管专属组件。其他类型标签保留原默认圆角，字号、内边距、24px高度与年级主题颜色沿用现有配置。

table支持最小列配置label/alignment，充值两项金额声明right，移除旧[5,6]硬编码。其余表格字符串列定义兼容。新增资金moneyForm的当前范围成功消息返回空字符串，原form仍关闭并refresh一次；范围外告知保留，编辑仍有原成功反馈。通用message、幂等请求、金额和权限校验不变。

### 保护根因与统一判断

原matrixChange、participationSnapshot和calendarSnapshot均把任意考勤／流水当作保护依据；旧calendar直接写入口又排除了放假，形成不同口径。前端renderMatrix再将全部历史考勤日期并入可见日期，绕过已停用标志。

新增简单tuoguan_protection模块，批量读取当月考勤及关联自动账本，用Map分组检查；各快照和两种日期写入口、学生移除共用该结果。后端在原BEGIN IMMEDIATE事务内最终重查，原日期／周期版本、请求幂等和权限校验保留。前端仅展示服务端protected_*及原因，不另算一套规则；每次打开管理弹窗读最新结果，冲突后重新获取。

| 当前情况 | 日期／本月学生是否保护 |
| --- | --- |
| 已保存出勤、请假、放假 | 保护，放假即使0元也保护 |
| 未保存默认状态 | 不作为保护依据 |
| 仅不适用／无效占位，费用0且账本安全 | 不因这些状态锁定 |
| 仅独立充值、退款等人工资金 | 不因独立资金锁定，资金原样保留 |
| 原扣费与冲正完整配对、当前不适用且费用0 | 不因历史审计链锁定 |
| 尚有有效扣费、未冲正或fee不为0 | 保护并提示费用原因 |
| 自动账本断链、金额顺序错误、学生／日期关联不符、非法作废或分账 | 保护并提示关联／冲正链异常 |
| 旧停课／缺勤 | 停课沿用现有放假显示并保护；缺勤含义不明确，保留并提示核对 |

从既有Billing.plan抽出chargedAmount供结算和保护复用，仍按原顺序验证负扣费与等额正冲正，不用简单净额相加代替链检查。跨日期错误关联也纳入检查，断开attendance_id的自动流水不被误当作独立充值。正式50／25／0元标准、FIFO、实际／赠送分配、欠费与结转算法没有重写。

日期只写tg_calendar.enabled=0并提高版本，不删除考勤、来源或任何账本。tuoguan_calendar.defaults本来已优先保留显式停用行，本轮修正前端只渲染enabled日期，不再自行补回旧考勤日期。详情和完整备份仍保留历史证据。

移除学生复用原周期拆分、版本及删除墓碑，只排除选中月，保留全局档案及其他月份；考勤不删除，所以冲正外键和来源稳定。重新加入创建唯一当月周期、默认不适用，已有不适用记录及版本继续使用，后续改出勤仍经统一结算。既有savePeriod范围维护校验未放宽；日常月度移除走上述安全路径。

### 历史规范化及导入恢复

首次扫描真实库：未登记41、空白状态0、非法状态0；raw_status异常来源共43条，其中41条仍未登记，2条已人工改为不适用。没有当前缺勤／停课，没有曾异常后改为出勤／请假／放假的真实行；合成测试覆盖了这些人工更正不得覆盖的情况。

tuoguan_normalization仅根据当前status挑选占位，绝不因raw_status异常重置已更正状态。只处理fee=0且完整链当前净消费0的候选：status改不适用、pending清0、rule_json设统一零费适用规则、version加1；原raw_status、source_cell、source_import_id、source_key、reference_fee、notes及ID不改。完整before／after进入tg_audit。特殊业务状态及不安全依赖列入skipped，不猜出勤或请假，不自动消账。

仍使用原schema迁移事务与原生备份机制，不新增数据库列或表。规范化在Billing.settle前执行；本次41条没有产生任何扣费或冲正。再次运行候选0、无重复审计；合成SQL失败验证整批回滚。旧历史Excel导入、完整Excel恢复事务及托管文本解析共用该规范化计划。文本先验原摘要，转换使用确定性审计UID，重复导入不会重复转换或收费；来源、目标已有不同更正仍按原整批冲突机制拒绝覆盖。

完整Excel继续v13、托管文本继续v5，原字段结构未变；升级目标系统后再导入，可兼容现有旧格式。已停用日期与已移除月份周期随原数据保留，导入不会依据保留的不适用考勤重建它们。旧停课／缺勤仅报告保留，不凭名称当成空白。

### 真实迁移与数据安全

开始时进程PID49592的工作目录、DATA_DIR、DB_PATH均指向当前项目data/liming-local.sqlite。首先原生备份到 `.tuoguan-local/protection-20261113/before.sqlite`，在isolated.sqlite预览并转换41条；其余49张表一致，9／10／11月全部费用及实际／赠送余额汇总一致。完整v13导出和独立恢复、v5复制到另一隔离库及重复导入通过，完整性ok、外键错误0。

开始扫描为18档案、28周期、565考勤、499账本；工作期间存在正常参与操作，执行日常迁移前已变为40周期。实际更新前再次核实进程，停服务后重新备份最新库到daily-before-apply.sqlite，按最新数据重新预览41条，确认无其他待自动结算记录，再执行迁移。没有用早期28周期副本覆盖最新40周期。

日常迁移前后：18档案、40周期、565考勤、499账本保持；未登记41→0，不适用45→86；出勤466、请假13均不改，原来源不改。新增规范化审计1条，新增扣费／冲正0。9月消费14,650元、10月8,975元、11月0元，与本轮最新迁移前逐项相同；不能沿用上一轮9,025元的历史数字。所有学生的实际消费、赠送消费、实际／赠送余额和结转不变；补课学生、课程、充值和教师薪资保持。

迁移后另有2026-10-01停用操作：enabled 1→0、version 1→2，新增对应remove-dates审计和幂等记录。最终核对已单独检查并保留该正常业务差异，其余考勤除41条预期转换外不变，全部499条账本和月度汇总未变。启动更新roles时间戳、登录增加operation_logs，权限不改；没有把上述业务操作算作迁移副作用。

真实Edge只读验收：9月330格／22个保护日／15名保护学生，10月235格／18个保护日／12名保护学生，11月无真实考勤、无受保护项。矩阵与详情的规范化记录显示不适用，充值十列、矩形标签、金额对齐及弹窗清理正常。未新增测试充值、未替用户操作日期或学生移除；私有验收脚本的旧页面名、月份及数字ID选择器修正后通过，Console与JavaScript异常0。

私有执行命令依次为 `node .tuoguan-local/protection-baseline.cjs`、`node .tuoguan-local/protection-isolated.cjs`、`node .tuoguan-local/protection-apply.cjs`、`node .tuoguan-local/protection-daily.cjs`、`node .tuoguan-local/protection-data-check.cjs`。迁移自动备份为 `data/backups/liming-local.sqlite.pre-tuoguan-schema-1794564087799.sqlite`；私有文件、真实资料、数据库、截图和凭据均不提交，临时登录凭据已删除。

回滚前先保存当前库并在独立路径验证配套旧代码与daily-before-apply.sqlite。已有后续业务操作，不应直接覆盖全库；如需撤销规范化，应依据审计和当前版本制定保留新操作的定向恢复方案。本轮未执行真实覆盖恢复，未操作正式服务器。

### 定向测试与文件

独立用例共53项最终通过，未解决失败0；分批补强和失败复测不重复计数。

| 实际命令／测试范围 | 独立通过 |
| --- | ---: |
| `node --test tests/tuoguan_protection.test.js`，后续用 `--test-name-pattern='old text\|historical workbook'` 及单项补测 | 10 |
| `node --test tests/tuoguan_protection_ui.test.js`，补测 `--test-name-pattern='Edge correction'`、`--test-name-pattern='full Excel'` | 3 |
| `node --test tests/tuoguan_auto_consumption.test.js tests/tuoguan_transfer.test.js` | 17 |
| `node --test --test-concurrency=1 tests/tuoguan_matrix.test.js tests/tuoguan_student_management.test.js tests/tuoguan_finance_ui.test.js` | 17 |
| `node --test --test-name-pattern='synthetic September\|historical import conflict' tests/tuoguan.test.js` | 2 |
| `node --test tests/tuoguan_dropdown_stats.test.js` | 3 |
| `node --test --test-name-pattern='gift visibility' tests/ui_consistency_workflow.test.js` | 1 |

旧断言把不适用／独立充值视为保护、表格仍按九列取值，已按新合同调整；旧自动计费测试同步允许未登记规范化。一次接口连接重置复测通过。新测试中来源fixture、浏览器选择器转义及导入成功数断言修正后通过。仅复测受影响项：`--test-name-pattern='historical effective'`，以及 `--test-name-pattern='Edge indices|calendar metadata|Edge calendar queue|Edge manual ledger|status and monthly|Edge profile status|Edge simplified recharge'`。没有运行全部历史套件。

覆盖真实三状态、混合学生、默认值、不适用、原始空白／数字、完整冲正、缺损链和跨日期关联、独立充值保留、日期版本冲突、期间拆分及重复加入、只读拒绝、规范化幂等／回滚／来源保留／人工更正保护、旧Excel和文本恢复。Edge覆盖更正后即时解锁、删除后刷新不复现、金额右对齐、选择与整行编辑、筛选统计、新增成功静默与失败保留，1440px／390px明暗主题及截图检查通过。修改JS的node --check及git diff --check通过。

主要源码：public/tuoguan.js、public/styles.css；src/domain/tuoguan.js、tuoguan_protection.js、tuoguan_normalization.js、tuoguan_settlement.js、tuoguan_schema.js、tuoguan_import.js、tuoguan_transfer.js；src/excel/full_backup.js。另更新public/index.html、src/server.js版本、package.json、两份新测试、四份相关旧测试及两份文档。public/app.js原标签组件不改，没有依赖或复杂规则引擎。

### 价值与待办

1. 值得：减少错误锁定、重复日期和无意义成功提示，充值字段更易核对。
2. 原问题是将历史记录存在等同于当前真实出勤／费用，并由前端重新补出停用日。
3. 读快照和事务写校验共用判断，前端展示同一原因，降低规则漂移。
4. 出勤、请假和零费放假继续保护；并发写、未结费用和异常链仍拒绝。
5. 独立资金、完整扣费冲正证据和账户余额保持，移除不是清账。
6. 去掉三套宽泛SQL和金额列硬编码，批量聚合关联并复用原结算链检查、标签与日历。
7. 后续优先凭真实凭据维护历史期初／充值，以及出现特殊旧状态时核实含义；必要时增加只读来源／更正链查看。
8. 暂不建议自动猜补出勤、自动删除审计、另建规则引擎、复杂审批或重写账务。

本轮真实库无剩余占位候选或特殊状态，未完成代码修复0。历史凭据真实性仍需人工核账。

## 2026-11-13 共享弹窗浮层清理与托管充值统计（历史记录）

完成时间：2026-11-13 13:11（北京时间）。基线 `6316999249e55b63134a33cba3b28841eb900c41`；分支 `feature/tuoguan-dropdown-recharge-stats`；版本 `20261113-tuoguan-dropdown-stats`。本节记录当轮设计，现行补充见顶部章节及文末“实际使用”。

### 真实复现与共享修复

先用现有Edge CDP在合成库复现：充值编辑支付方式菜单的父节点确为document.body，owner位于共享弹窗；点击右上角关闭后，弹窗0个、失效Portal 3个，其中仍可见1个。原 `CourseDetails.dialog()` 只执行element.remove，document委托的外部点击关闭逻辑无法找到已移除的owner；清理要等下一次增强选择器或换页，不能保证立即消失。

历史提交 `a430095` 已增加页面切换的closeAllFloatingOverlays，以及增强选择器前的孤立菜单清理。本轮不是另造清理组件，而是补上共享弹窗关闭这条漏掉的生命周期路径。

closeCustomSelects增加可选scope，原调用默认仍为document；共享弹窗先关闭自身选择器，再移除弹窗，调用cleanupCustomSelectPortals(element)只移除本弹窗owner关联的Portal，清空owner/menu/native引用。无scope的旧调用仍仅清失效owner。关闭函数幂等，焦点仅回到仍连接的元素；延迟RAF不再聚焦已关闭菜单，openCustomSelect拒绝离线节点。document上的委托监听原本由customSelectEventsBound只绑定一次，不新增逐弹窗全局监听，也不移除其他选择器需要的委托。没有CSS掩盖或逐托管弹窗补丁。

保存失败不触发close，选择器保留可继续操作。另一个仍连接的弹窗菜单经过专门验证，不会被定向清理误删。页面切换仍复用原全局浮层关闭；本轮没有改变页面切换时共享弹窗本身的存留策略。

### 统计与布局口径

页面顺序为统计面板、筛选工具栏、操作按钮、表格。复用rechargeAnalysisMarkup、rechargeAnalysisSplitMarkup和全部现有recharge-analysis样式，仅为共享markup增加可选summary/cards/标题参数，原学生充值调用和rechargeAnalysis算法保持。无新CSS、依赖、图表库或统计API。

renderLedger筛选后的同一rows同时生成表格与统计，仅有效人工充值／退款；作废、自动消费／冲正及旧调整不混入。一次遍历按整数分聚合，展示时才转元。学生索引使用Map，按记录缓存业务年级，避免筛选、展示和聚合重复查找同一记录的周期。

| 项目 | 口径 |
| --- | --- |
| 实际充值合计 | 有效充值actual_amount之和 |
| 赠送充值合计 | 有效充值gift_amount之和，不作为实际现金收入 |
| 退款合计 | 退款负数实际金额与赠送金额之和取相反数，以正数表示退回 |
| 净账户资金变动 | 实际充值＋赠送充值－退款；明确含赠送，不命名为净收款 |
| 充值记录数 | 仅充值的记录数量 |
| 充值学生数 | 仅充值的student_id集合大小；同名不同ID分开，重复充值只算一人 |
| 业务年级标签 | 当日参与周期grade；含赠送的净账户变动、全部资金笔数及涉及ID人数 |
| 支付渠道标签 | 仅充值的实际金额、充值笔数及充值ID人数，不混入赠送或退款 |

年级筛选、表格标签与年级统计共用业务日期周期，不能用当前档案年级替代缺失历史；无周期归“未记录”，筛选初一等年级不会混入无法确认的记录。微信／现金／支付宝直接归类，自定义文字归其他，空渠道为未记录。未分账旧格式沿用既有接口的兼容分账值和“旧账归属待核对”标记，统计不能代替凭据核账，也不改写旧账；本轮真实库人工资金均可分账。

月份、姓名、年级、类型、日期范围复用既有筛选；仅筛选不额外请求统计接口。新增、金额／渠道／日期编辑、批量删除成功后由原refresh一起刷新；取消、网络失败、版本冲突不预先修改金额或统计。冲突维持上次确认的表格和统计，提示刷新重开，不实现实时推送他人修改。

### 定向测试及只读安全核对

按独立用例去重共5项最终通过，未解决失败0。实际命令：

| 命令 | 独立通过 |
| --- | ---: |
| `node --test tests/tuoguan_dropdown_stats.test.js` | 3 |
| `node --test --test-name-pattern='Edge statistics' tests/tuoguan_dropdown_stats.test.js` | 上述统计项补强后复测，不重复计数 |
| `node --test --test-name-pattern='gift visibility' tests/ui_consistency_workflow.test.js` | 1 |
| `node --test --test-name-pattern='inline channel overlay' tests/recharge_channel_inline.test.js` | 1 |

修复前实际复现用例失败，修复后失效Portal及可见残留均为0。覆盖右上角、取消、菜单Esc／弹窗Esc、成功关闭、失败保留、同一及另一记录重开、连续关闭、双弹窗归属隔离、换页、其他渠道搜索与学生状态选择器、明暗主题。代表性原界面回归包含学生充值统计、渠道行内编辑、班级选择及教师相关表格，不声明逐页完整回归。

统计合成样例涵盖重复充值、同名不同ID、退款分账、作废排除、真实自动扣费排除、历史年级变化、无历史周期及空渠道、筛选、跨月、新增、编辑金额／渠道／日期、取消、网络失败、真实409版本冲突、整批作废及空结果。1440px／390px和明暗主题检查有数据截图，无统计面板横向溢出。冲突用例预期出现且只允许1条HTTP 409资源日志，JavaScript异常0；普通路径Console错误0。

初期测试金额解析遗漏¥已修正；补测冲突后须按实际提示刷新再继续编辑，测试同步修正；预期409日志与真正异常分开断言。一次旧用例筛选名称不匹配的命令没有执行有效测试，已结束该测试子进程，未计入通过数。没有重跑全部财务套件；修改后只复测受影响用例。各修改JS的node --check及git diff --check通过。

真实5177原进程PID11900的CWD、DATA_DIR及DB_PATH已确认指向当前项目data/liming-local.sqlite，再更新本地实例。使用Edge 157只读验收，9／10月表格及六项统计均为空／零，11月2条有效人工记录与同一接口独立计算的六项指标一致；仅打开、关闭、取消，没有新增或修改真实资金，失效Portal及浏览器错误0。临时登录凭据已删除。

无数据库迁移或账务写入代码变更；完整Excel仍v13，托管文本仍v5。开始时实际为18档案、28周期、565格考勤、483条账本，不能沿用上一轮481条。前后51表指纹检查：49张业务表完全一致；roles除启动更新时间外一致，operation_logs仅正常登录日志。9／10／11月全部学生费用及实际／赠送余额汇总逐项不变，9／10月消费14,650元／9,025元。补课、原资金、考勤扣费冲正、教师绩效及薪资不变，完整性ok、外键错误0。

私有命令 `node .tuoguan-local/dropdown-baseline.cjs`、`node .tuoguan-local/dropdown-daily.cjs`、`node .tuoguan-local/dropdown-data-check.cjs` 保存与核对证据；真实数据、指纹、截图及凭据不提交。仅更新本地5177、推送功能分支，不合并main、不部署正式服务器、不操作线上数据库。

修改文件：public/app.js（共享选择器及统计markup）、public/course-details.js（关闭生命周期）、public/tuoguan.js（同源统计及历史年级）、public/index.html与src/server.js（缓存／版本）、tests/tuoguan_dropdown_stats.test.js、package.json及两份文档。public/styles.css无修改，账户／结算领域文件无修改。

### 修改价值与后续

1. 值得：关闭弹窗立即恢复干净界面，充值汇总减少人工相加。
2. 真实根因是body Portal独立于弹窗DOM，原共享关闭未清owner关联菜单。
3. 在共享生命周期修复，不是支付方式局部补丁。
4. 影响共享弹窗，按owner范围收敛；双弹窗隔离及原控件代表性回归通过，仍不等于所有历史页面全量验收。
5. 六项卡片与年级／渠道标签便于每日核对，净额明确含赠送。
6. 与表格共用已筛选rows，同步刷新、同样排除作废和自动消费。
7. 无重复markup、CSS、API或第二套账户算法，聚合一次；历史年级按记录缓存。
8. 优先按真实凭据核对43格异常、历史期初充值及缺失周期／渠道；如实际需要，再考虑只读更正链查看。
9. 暂不需要图表库、复杂统计后台、浮层框架重写、自动猜补历史资料或重新开发财务结算。

本轮无待修复失败。历史未知信息不会自动补齐；人工核账仍按既有规则进行。

## 2026-11-13 托管充值编辑、批量作废与新加入月份默认签到（历史记录）

完成时间：2026-11-13 10:52（北京时间）。基线 `b65e9c91e7de14a9f8b395988ed57b574b28a659`；分支 `feature/tuoguan-ledger-edit-student-defaults`；版本 `20261113-tuoguan-ledger-edit`。本节记录当轮设计，现行补充见顶部章节和文末“实际使用”；旧“充值只能新增”“管理学生不能新建”“所有未保存格显示出勤”已替代。

### 资金编辑和批量删除

复用同一moneyForm、新增资金保存校验、共享复选框select-col、rowIndex序号及bulkActionText数量样式。表格九列为复选框、序号、日期、学生、类型、实际金额、赠送金额、渠道、备注。普通区域点击／Enter编辑，复选框点击不打开弹窗；仅更新勾选和按钮状态，不因每次选择重画表格。筛选后剔除不可见选择，全选仅操作可见且可编辑记录，切页／账号清空选择。复用原统一弹窗进行删除确认；只读用户前后端均禁止写入。

`tg_ledger` 增加version、voided_at、voided_by、replaces_id（自关联外键）。资金字段修改在原atomic事务中作废原行、追加有效替代行，原金额、日期、学生、经办人、凭证均留在历史行；替代链进入复制和备份。仅备注／渠道变更保持原ID、提高version并记录前后值，避免改变账本顺序或无意义重放。主表只读有效人工充值／退款；完整snapshot与备份保留作废证据。未分账旧格式给出原因，不强行猜测实际／赠送。

`tuoguan_money.change` 校验真实ID、类型、分账、版本与作废状态，批量先检查所有记录；任一无效、已更改或SQL失败，整批及审计一起回滚。原请求编号防重复保存／删除。tg_audit记录before、after、replacement、操作人和时间，operation_logs记录业务操作，不重复记成功日志。禁止作废考勤扣费／冲正，未修改考勤结算链。

资金写入抽成复用函数，仍按整数分、原退款限制和渠道校验保存。账户继续使用 `tuoguan_account`／`account_balance` 按日期回放，只排除作废人工记录。金额更正保留原同日FIFO位置，避免因新行ID改变实际／赠送分配；跨学生或日期移动按新位置回放。对全部受影响学生回放至最后业务月，额外校验后续每笔退款的实际／赠送可退余额；删除充值造成正常欠费可以成功，若导致既有退款超额则拒绝并提示退款日期，须先核对退款。账户未保存派生余额，不存在仅隐藏行却保留旧余额的缓存；费用和详情下次读取自动取得新结果。

### 建档、参与与默认签到

管理学生顶部增加新建入口，复用原表单壳、student接口及参与事务。在同一原子操作内创建独立tg_students和当月起止周期，默认在托，成功后更新四分区与选中状态；关闭管理弹窗后一次重绘矩阵，筛选保留。失败无半份档案。加入／新建共用串行队列及页面身份保护，同名只有明确确认并填写可辨认备注才可新建，永不自动关联旧资金或考勤。

选择方案B：只增加 `tg_periods.default_status`，限定出勤／不适用，旧周期默认出勤。本轮通过管理学生的新建或已有档案加入只建立选中月周期并设为不适用。该周期内未保存的已启用日期（含之后再启用日期）读取默认值；真实考勤永远优先，不创建自动零费考勤。因此刚加入仍可移出，默认不参与“已保存签到”的费用范围、首日或上次在托计算。原有周期未保存格仍显示出勤，历史未登记／异常原样保留。人工保存后继续走原50／25／0元结算。周期拆分保留default_status，不影响其他月份。

学生页与矩阵都读取同一独立档案，无额外同步表或补课身份。新档案没有出勤时日期显示“—”。默认不适用复用原黄色状态，无新增收费、组件依赖或复杂状态管理。

### 安全迁移、复制及恢复

检测缺少ledger更正字段或period默认字段时，先VACUUM INTO原生备份，再在迁移事务中加字段，完整性／外键通过后提交；失败回滚，重复启动无重复迁移。新增字段不修改原业务列。完整Excel v13兼容v4—v12，托管文本v5兼容v1—v4；旧格式补正常有效流水版本1和周期默认出勤，来源缺字段不能变成新规则。更正关联必须指向已作废人工资金，禁止重复替代、前向／循环链或作废自动消费。跨库通过UUID映射关联，不能拿本地整数ID当成跨库身份。

真实副本已完成迁移、v13导出与独立恢复、v5复制导入。51张表按原Excel范围核对，业务数据一致；IP／User-Agent与非便携设置仍按既有规则排除。原生SQLite备份保留全部字段。复制按可移植UUID及完整业务字段核对，原数据库ID存在间隙时允许重新编号。已有来源记录更正后与目标旧内容不同，沿用整批冲突阻止覆盖，不静默改写另一环境的资金。

更新本地5177前核实PID77936的工作目录、DATA_DIR、DB_PATH均指向当前项目 `data/liming-local.sqlite`，停止后再次原生备份并迁移。备份位于被忽略的 `.tuoguan-local/ledger-edit-20261113/`：`before.sqlite`、`daily-before-apply.sqlite`、`isolated.sqlite`、`isolated-v13.xlsx`、`restored.sqlite`、`transfer.sqlite`及私有核对结果。自动迁移备份 `data/backups/liming-local.sqlite.pre-tuoguan-schema-1794538075155.sqlite`。

本轮开始时真实库已有481条账本，其中11月1笔人工充值；未沿用上一轮480条的统计。完成后18档案、28周期、565格考勤、481条账本及全部原业务字段一致。9／10月考勤330／235格，消费14,650元／9,025元；原480条自动流水及11月充值均未改动。补课学生、课程、充值、绩效与薪资未变。启动／登录仅增加操作日志并更新roles时间戳，权限不变。真实Edge只打开11月已有资金编辑弹窗、勾选后取消删除，没有测试写入。未操作正式服务器。

回滚先停止经核实的实例、保存当前原生库，在独立路径验证迁移前备份及配套旧代码。只有无新增业务才能全库回退；存在新增／更正记录时不能用旧备份覆盖。此次覆盖恢复全部在隔离副本完成。私有证据、真实资料、截图与凭据不提交；临时登录凭据已删除。

### 实际定向验证

共49项独立测试最终通过、未解决失败0；重复运行不累计数量。只运行受影响的账务回放、复制、备份、矩阵与界面测试，没有跑全部历史套件。

| 实际命令 | 独立通过 |
| --- | ---: |
| `node --test tests/tuoguan_ledger_edit.test.js` | 10 |
| `node --test tests/tuoguan_finance.test.js tests/tuoguan_transfer.test.js` | 28 |
| `node --test tests/tuoguan_student_management.test.js` | 6 |
| `node --test --test-name-pattern='Edge manual ledger\|full v13' tests/tuoguan_finance_ui.test.js` | 2 |
| `node --test --test-name-pattern='matrix adds\|matrix keyboard' tests/tuoguan_integration.test.js` | 2 |
| `node --test --test-name-pattern='full export uses v13' tests/full_excel_restore.test.js` | 1 |

失败后仅复测对应项：`--test-name-pattern='v3 transfer'` 修正新版格式断言后通过；`--test-name-pattern='Edge manual ledger'` 修复复选框前序号插入后通过。新测试初期内存教师fixture缺name字段已补齐；补测连续序号、同日FIFO、多人批量SQL失败回滚与后续退款约束。真实复制核对先误用整数ID逐行比较，后改为UUID与业务字段比较通过，没有因此改写数据。

覆盖金额／赠送／日期／学生／充值退款类型修改、备注渠道轻量修改、历史欠费与补缴、跨月结转、全选范围、取消、失败保留草稿、只读、版本冲突、幂等、批量回滚、审计、自动流水保护、旧格式兼容、原子建档、同名区分、默认不适用刷新与移出、真实考勤优先及50／25元计费。Edge桌面1440px／手机390px浅深主题通过，并检查截图。`node --check`、`git diff --check`通过。

私有命令 `node .tuoguan-local/ledger-edit-isolated.cjs` 完成迁移与恢复，`node .tuoguan-local/ledger-edit-isolated-check.cjs` 完成跨库身份核对；`node .tuoguan-local/ledger-edit-apply.cjs`、`node .tuoguan-local/ledger-edit-daily.cjs`、`node .tuoguan-local/ledger-edit-data-check.cjs`验证实际迁移、Edge只读与原字段保留。浏览器异常及Console错误0。

### 价值和后续

1. 值得：能够纠正误录资金，并减少新生建档与入月操作。
2. 资金编辑有跨月分账风险，采用保留原证据、替代关联及原账户回放处理，不直接覆盖原金额。
3. 批量删除使用真实ID、版本、类型、权限、幂等及单事务，任一失败整批回滚。
4. 后续退款校验和相同日期FIFO保护可避免此次操作引入错误余额；不替代人工核实凭据真实性。
5. 一次建档并加入月度矩阵，减少跨页往返及漏加入。
6. 默认不适用符合先建档、再确认实际出勤的流程，不误计费；已保存签到仍有保护。
7. 新增与编辑共用表单和资金校验，复用选择样式／序号／结算引擎，无第二套账户系统。
8. 优先核对既有43格异常、档案状态和历史期初／充值凭据；如有实际需求再加只读更正链查看。
9. 暂不需要自动猜测历史出勤、批量自动退款、复杂审批工作流或可随意物理清账的入口。

本轮无未完成代码修复。日常财务纠错由获授权管理员按真实凭据操作；未擅自编辑或删除现有真实充值。

## 2026-11-13 托管学生状态、矩阵学生管理与充值精简（历史记录）

完成时间：2026-11-13 10:13（北京时间）。基线 `d2acd135cfc27d6dc08ca7c63d49f0cc4ca74f89`；分支 `feature/tuoguan-student-status-management`；版本 `20261113-tuoguan-student-status`。本节记录当轮设计，后续日期章节仅保留历史。旧添加／删除学生、最近托管、五类人工资金、v11／v3格式说明已被本轮替代。

### 设计与复用

`tg_students.status` 是独立托管身份的当前状态，NOT NULL、默认在托，CHECK限定在托／暂停／已流出／已毕业。`tg_periods.status` 保留在托／暂停／退托旧语义，用于历史参与判断。既不从缺勤或空月推断状态，也不把移除某月当作退托。状态修改沿用student事务、version校验、tg_audit与操作日志；补课students不参与。档案无可靠状态依据时只加默认值，不猜毕业／流出。

学生表复用原 `cell-select inline-status-select`、状态颜色与只读行为；在托复用在读绿色。按四状态、初一至初三、姓名自然排序，序号按可见结果重排。“托管首日／上次在托”只由保存的出勤记录计算。失败恢复旧选择，成功重新排序。

“管理学生”复用 `CourseDetails.dialog`、学生／年级标签、原period及remove-students后端能力。四块矩形分区不受外层筛选限制，同名依旧按ID操作，界面不暴露内部编号。新加入仅建立选中月首至月末的周期，其他月份不延长。移除沿用周期拆分、删除墓碑和任何考勤／资金保护。非在托未选中卡片提示先在学生页明确改为在托，不隐式改档案。

`students_only=1` 一次读取全部档案、周期及本月保护ID，不读取余额或逐学生请求。串行队列与busy集合防重复写，版本冲突重新读取元数据；同页、同月、同用户与快照身份保护迟到响应。关闭等待队列，变更后仅重绘矩阵一次，恢复滚动和焦点，没有变化保持节点。并发档案变更会更新四分区。旧添加／删除弹窗代码及无用选择列表样式已清理。

充值表为八列，只有充值、退款两种日常类型；经办人及凭证仍存底层。金额仍以整数分保存，保留实际／赠送分账、退款上限、幂等、事务与审计。仅充值退款备注选填，兼容的历史调整接口仍要求依据。未更改结算或账户引擎。

支付方式直接复用 `rechargeChannelOptions` 和服务端 `normalizeRechargeChannel`，支持微信／现金／支付宝／其他，其他说明必填且最多100字。托管仍使用既有method列保存规范中文名称及其他说明，不扩大为另一套渠道表；历史method原样保留。表单默认北京时间今天，超出当前范围仍正确保存并显示提示。

日期范围复用 `dateRangePickerControl`、原弹层／快捷范围／清空绑定。选择方案B：选定范围优先于月份，服务器 `ledger_only=1` 按真实start/end读取跨月充值退款；清空或切月返回月份范围。保留请求序号，旧响应不覆盖新范围。完整snapshot、导出／恢复仍包含旧优惠、调整、期初核定及自动考勤账本。

定向回归同时修复签到409后的缓存遗漏：以前只更新格子Map，关闭学生管理重绘后可能显示旧值；现同步更新对应的source.attendance记录，不覆盖其他正在编辑的格子。

### 迁移、兼容与真实数据保护

schema检测旧库缺status时，先VACUUM INTO原生备份，再在原事务中加列；失败回滚，重复启动不再迁移或备份。完整Excel为v12，兼容v4—v11；托管文本为v4，兼容v1—v3。校验原文本checksum后为缺状态的旧档案补默认值，状态合法性、自动结算要求、身份冲突与幂等仍保留。目标须先升级，避免旧代码静默丢弃新状态。

实际先备份日常库，在隔离副本迁移、导出v12并恢复到另一副本；再用v4文本导入空托管库。恢复核对51张表：除Excel原有的IP／User-Agent和非便携设置排除规则外，业务数据完全一致，两个月全部费用汇总一致；51张表逐项核对不等于导出所有运行环境设置。原生SQLite备份不排除这些内容。

本地5177更新前读取PID72236的实际工作目录、DATA_DIR及DB_PATH，确认当前项目 `data/liming-local.sqlite`，停止该实例后再备份和迁移。迁移前后所有原字段不变，只新增18个默认在托状态；28条周期、565格考勤、480条账本完整，9／10月分别330／235格、297／183条账本、消费14,650元／9,025元。补课学生、课程、资金、教师绩效与薪资逐表不变。启动／登录仅有原roles时间戳与operation_logs变动，权限字段未变。

私有证据保存在被忽略的 `.tuoguan-local/student-status-20261113/`：`before.sqlite`、`daily-before-apply.sqlite`、`isolated.sqlite`、`isolated-v12.xlsx`、`restored.sqlite`、`transfer.sqlite`以及迁移／浏览器／指纹结果。实际迁移自动备份为 `data/backups/liming-local.sqlite.pre-tuoguan-schema-1794535705498.sqlite`。不提交真实资料、数据库、截图、凭据或资金明细，临时登录凭据已删除。未连接正式服务器或线上数据库。

回滚时先停止经核实的本地实例，完整保存当前库，在独立路径验证迁移前原生备份与配套代码；仅当迁移后无新增业务才可恢复旧全库。有新业务时须先制定保留方案，不直接覆盖。此次只在隔离库测试恢复，没有对日常库执行覆盖恢复。

### 实际定向测试

按独立用例去重，共25通过、未解决失败0。没有运行全套历史测试。Windows PowerShell实际命令如下：

| 命令 | 通过 |
| --- | ---: |
| `node --test tests/tuoguan_student_management.test.js` | 6 |
| `node --test --test-name-pattern='Edge indices\|Edge manual ledger\|full v12' tests/tuoguan_finance_ui.test.js` | 3 |
| `node --test --test-name-pattern='matrix adds\|matrix keyboard\|Edge streamlined' tests/tuoguan_integration.test.js`，修复后用 `--test-name-pattern='matrix keyboard'` 重跑失败项 | 3 |
| `node --test tests/tuoguan_transfer.test.js` | 8 |
| `node --test --test-name-pattern='v3 transfer' tests/tuoguan_finance.test.js` | 1 |
| `node --test --test-name-pattern='full export uses v12' tests/full_excel_restore.test.js` | 1 |
| `node --test --test-name-pattern='legacy FK upgrade\|invalid legacy references\|late migration foreign' tests/tuoguan_independent.test.js` | 3 |

新测试覆盖四状态排序／修改／回退／日志、同名身份、跨月边界、连续增删、重复点击、保护、版本冲突与并发档案分区、只读、原表数据隔离、v1—v4文本与v11／v12Excel、四渠道、其他校验、空备注、超额退款拒绝、日期默认今天、真实跨月、清空与迟到响应。Edge桌面1440px／手机390px、浅深主题通过，已查看截图。

早期验证发现日期范围按钮缺少异步挂载后的绑定、签到409缓存遗漏并已修复；测试同步等待与SQLite结果对象原型断言也已校正。真实恢复核对首次按原始全字段比较而失败，经确认是既有Excel隐私排除规则及无主键设置行顺序，按既有规则排序、排除后51表通过，未为比较更改备份数据或原库。

`node --check` 检查修改的前后端JS，`git diff --check`通过。私有命令 `node .tuoguan-local/status-isolated-check.cjs`、`node .tuoguan-local/status-apply.cjs`、`node .tuoguan-local/status-daily.cjs`、`node .tuoguan-local/status-data-check.cjs`通过。实际Edge157只读登录5177验证六列档案、18份默认状态、四分区与无变化不重绘、八列充值空状态、默认今天及统一范围控件，浏览器异常／Console错误0。

### 价值、取舍与人工事项

1. 值得：当前档案分类与历史事实分开，减少误删历史和重复身份，简化高频资金录入。
2. 四状态便于保留流出／毕业学生并查询历史，比按空月猜状态可靠。
3. 一次开窗连续增删减少操作；已有记录仍受保护，效率不以放宽财务约束换取。
4. 两种状态仍可能被误解，文案明确档案分类不改变历史周期；返托先明确改状态。
5. 今天默认日期、可选备注及两种操作更贴近日常充值退款。
6. 渠道选项和服务端校验真正复用，托管继续用原method存储；不是复制另一份候选配置。
7. 已删除旧学生增删弹窗与无用样式；资金及日期控件保持共享，不新增框架或缓存层。
8. 优先人工核对当前18人状态、43格异常／空白及历史充值／期初凭据；有实际需求再做状态筛选和只读消费追溯。
9. 暂无必要做批量自动毕业／流出、复杂学生日历、自动推断期初或第二套资金账本。

本轮无未完成代码修复。上述现有业务资料仍需人工确认，未擅自补历史事实。

## 2026-11-12 充值流水口径与详情切月修复（历史记录）

完成时间：2026-11-12 23:33（北京时间）。基线 `e0e0f49cb9338835c9407ecca53e3b8c23cb62fe`；分支 `feature/tuoguan-ledger-modal-fix`；版本 `20261112-tuoguan-ledger-modal-fix`。本节记录当轮设计；现行规范见最新章节与“实际使用”。“充值流水查询所有消费／冲正”及“切月时清空旧金额”的旧说明不再适用。

### 根因与最小修复

`renderLedger()`原先直接遍历snapshot的完整 `data.ledger`，类型筛选也从完整账本枚举，导致自动考勤扣费和冲正混入人工资金页面。现定义唯一前端 `manualMoneyKinds`（充值、退款、优惠、调整、期初核定），同时用于类型筛选及新增资金表单。表格用 `isManualMoney()` 按类型和无attendance_id关联筛选，不依赖金额正负，也不修改data.ledger。空状态为“暂无充值记录”。金额列明确指定原自适应表格的right对齐，避免布局计算覆盖数字样式。没有增加接口或账务表。

人工资金保存、幂等编号、事务、权限和操作日志仍使用原实现。自动扣费和冲正保留在tg_ledger及完整snapshot，继续供tuoguan_account／account_balance计算；费用汇总与余额不受展示筛选影响。人工操作与自动结算不在同一张界面表混排，操作日志仍由设置页负责。

`studentDetail()`旧切月先 `render(null,true)`，整段content.innerHTML重写，删除统计卡和日历，随后重建节点、按钮监听并重复触发表格尺寸计算。现只在打开时创建结构，卡片、金额节点、导航、星期行、日历容器及图例持续存在；成功后同步更新七项数字、月份文字、必要费用说明和日历内部日期。加载期间仍显示旧月份的完整有效内容，导航仅显示省略号及无障碍忙碌状态。

请求目标月份与已显示月份分离，保留sequence与用户／宿主校验；AbortController终止被替代的请求，关闭也中止请求。新学生详情打开时关闭旧详情，迟到响应不能更新其他学生。最新请求失败时保留已有内容并将导航基准退回已显示月份，错误简短显示。按钮只绑定一次，详情不再反复调用自适应表格计算，也未添加动画或依赖。

详情日历保持七列并预留六周，每行76px，可容纳手机端两行异常状态，消除四／五／六周及状态换行带来的高度差。费用说明与错误区预留小块行高；提交新月份后恢复弹窗scrollTop。原1040px响应式宽度和考勤配色不变，管理日期日历不受该专用样式影响。

修改文件共7个：`public/tuoguan.js`、`public/styles.css`、`public/index.html`、`src/server.js`（仅版本号）、`tests/tuoguan_finance_ui.test.js`、`README.md`、本文件。未修改结算、账户引擎、数据库结构、备份格式或依赖。

### 实际测试与结果

最终4项独立定向测试通过，未解决失败0；重复执行不累计计数，没有运行无关财务全量回归。

1. `node --test --test-name-pattern='Edge manual ledger|Edge stable detail|Edge indices|HTTP split funds' tests/tuoguan_finance_ui.test.js`：既有HTTP资金权限与Edge详情测试2项通过；新测试发现金额对齐覆盖及手机日历行高差，随后修复。
2. `node --test --test-name-pattern='Edge manual ledger|Edge stable detail' tests/tuoguan_finance_ui.test.js`：延迟切月稳定性通过；资金用例需等待保存后的异步列表刷新，修正测试等待。
3. `node --test --test-name-pattern='Edge manual ledger' tests/tuoguan_finance_ui.test.js`：最终通过。中间一次重放测试因辅助函数调整JSON字段顺序触发原幂等摘要409，已改为原请求原样重放；并按实际日志字段验证“托管充值”。未为测试更改账务机制。
4. `node --check public/tuoguan.js`、测试与server语法检查、`git diff --check`通过。

合成用例同时具备五类人工资金、自动扣费和冲正，验证类型／姓名／年级／月份／日期范围筛选、连续序号、金额右对齐、无人工记录空状态；实际1000元＋赠送100元同条保存，双击与原请求重放仅新增一条，余额按两类金额增加，原消费和历史记录保留，操作日志存在，原只读权限拦截有效。

慢请求用例在实际响应后主动延迟，检查加载前后DOM节点身份、旧金额与日期不消失；桌面1440px、手机390px的浅色／深色均验证弹窗宽高、日历高度和滚动偏差不超过1px，检查截图。另验证9↔10月、跨年、旧响应晚到、网络失败、失败后重试、关闭后打开另一学生和外层筛选保持。七项金额直接与后端snapshot比对，脚本错误0。

### 本地只读验收与数据保护

更新5177前读取进程的实际工作目录、DATA_DIR、DB_PATH，确认当前项目的 `data/liming-local.sqlite`。无数据库迁移。私有验收命令 `node .tuoguan-local/ledger-modal-daily.cjs` 使用Edge 157，确认9／10月充值流水均为“暂无充值记录”，底层仍分别保留297／183条账本；消费分别14,650元／9,025元。真实详情延迟切月保留节点，外层月份不变，浏览器错误0。

`node .tuoguan-local/ledger-modal-data-check.cjs` 比较本轮修改前后全业务表摘要：18份托管档案、28条参与记录、565格考勤、480条账本不变，补课学生、课程、资金、教师薪资亦不变，完整性／外键检查正常。启动和登录仅更新roles时间戳及operation_logs。所有私有验收脚本、数据摘要和截图留在被忽略目录，临时凭据已删除，不提交真实资料。

### 价值与后续

1. 本轮值得：修正充值流水的业务含义，并消除慢请求下真实可见的内容清空。
2. 根因是把用于计算余额的完整账本直接当作人工资金列表，不是历史数据错误。
3. 人工资金按明确类型筛选，自动消费保留在费用统计与底层账本，职责清楚。
4. 闪屏来自整块DOM销毁重建，不是缺少动画；局部同步更新解决根因。
5. 卡片、导航、日历容器持续存在，取消重复监听和详情表格自适应调用。
6. 共用一份人工类型和现有月份网格，保留公共table、metrics和请求工具，无需重构整个托管模块。
7. 不影响财务计算；仅筛选展示，人工新增、自动扣费、分账和审计仍走原链路。
8. 后续优先按真实凭据补录历史充值与期初；确有核账需求时，可单独设计只读消费追溯入口。
9. 暂无必要新增框架、缓存层、动画或另一套资金账本；不把自动结算重新塞回充值流水。

本轮无未完成修复。已有43格异常／空白考勤及历史充值、期初凭据仍需机构按实际情况维护。

## 2026-11-12 托管日期管理与详情精简（历史记录）

完成时间：2026-11-12 22:48（北京时间）。基线 `33d9189caf2a3a4445545554301b959a0e543896`；分支 `feature/tuoguan-calendar-management`；应用版本 `20261112-tuoguan-calendar-management`。本节记录当轮操作；后续旧章节保留历史事实，不再按旧按钮、日期表头删除或详情流水表操作。

### 实现、复用与清理

复用 `CourseDetails.dialog`、日期按钮及星期行样式，抽出 `monthCalendar(month, renderDay)`，管理日历和详情日历共享月首星期、完整日期及七列网格。管理日历用系统success颜色表达启用状态，考勤仍使用原状态色，二者业务含义独立。原有关闭按钮、Tab焦点循环、Escape关闭沿用，不另加确认窗或日历依赖。

沿用add-dates／remove-dates、幂等请求、版本校验、事务及记录保护。`calendarSnapshot()`复用defaults，只读当月日历、已保存考勤及资金日期；snapshot支持 `calendar_only=1`，财务权限才能读取，响应不包含金额或账户计算。增删成功响应附同份日历状态。零费、未知考勤及仅有资金的日期同样受保护，后端仍作最终拦截。

前端仅使用一个Map、保护集合、忙碌集合和请求队列。点击后不预先改变业务状态，成功才更新颜色；同日忙碌阻止重复请求，不同日期按最新版本顺序保存。失败读取服务器现状，409后不使用旧版本重试；重新读取失败时禁止操作并提示关闭重开。页面、月份、用户及快照身份保护阻止旧响应覆盖新页面。

弹窗内只更新日期按钮；关闭等待已提交队列，必要时仅重绘一次矩阵并恢复滚动与焦点。打开前收尾180ms筛选任务，考勤尚在保存时暂不打开，避免未完成写入被重绘。没有日期变化时不刷新。不调用全页load或账户重算，也不新增考勤、学生行或账本。

删除旧addMatrixDate／removeMatrixDates／deleteMatrixDate、tg-date-header、data-remove-date、对应事件和悬停CSS。保留学生移除共用chooseRemoval、各页共用table及账务接口。详情保留原month／sequence与用户校验，只重排七项metrics到月份上方，移除重复流水HTML；七项金额直接读取后端，不改变实际／赠送分配。

主要文件：`public/tuoguan.js`、`public/styles.css`、`public/index.html`、`src/domain/tuoguan.js`、`src/server.js`、`tests/tuoguan_finance_ui.test.js`、`tests/tuoguan_integration.test.js`、`README.md`、本文件。没有修改schema、结算引擎、账户算法或依赖。

### 定向验证与数据保护

实际命令（Windows PowerShell），最终6项独立测试通过：

- `node --test --test-name-pattern='Edge indices' tests/tuoguan_finance_ui.test.js`：1项通过。后续筛选收尾修改后，用 `node --test --test-name-pattern='Edge calendar|Edge indices' tests/tuoguan_finance_ui.test.js` 复测2项通过。
- `node --test --test-name-pattern='calendar metadata|Edge calendar' tests/tuoguan_finance_ui.test.js`：元数据测试1项通过；Edge测试首次失败，修复筛选延迟重绘，并修正CDP原生Enter需传回车文本及只读账号无设置导航的测试等待条件。最终上述2项Edge复测全部通过，无遗留失败。
- `node --test --test-name-pattern='defaults cover|date removal persists' tests/tuoguan_transfer.test.js`：2项通过。
- `node --test --test-name-pattern='Edge streamlined' tests/tuoguan_integration.test.js`：1项通过。
- `node --check public/tuoguan.js`、`node --check src/domain/tuoguan.js`、测试文件语法检查及 `git diff --check` 通过。不将重复执行累计计数，未跑无关财务全量回归。

测试使用合成学生及隔离SQLite。覆盖28／29／30／31天、月首星期、跨年、默认周日到周五、周六添加、停用持久化、保护零费用／未知／仅资金日期、重复点击、连续请求、网络失败、409刷新、关闭时等待保存、旧月份响应、筛选保留、只读前后端、键盘Enter、桌面1440px与手机390px的明暗主题。检查了截图，日历七列和详情1040px宽度正常。七项详情金额与snapshot一致，加载中无旧金额，底部无table。合成日期变更前后学生、周期、考勤、资金和补课表逐行相同。

本轮不迁移数据库，不操作线上库。日常5177更新前已读取进程工作目录、DATA_DIR和DB_PATH，确认指向当前项目的 `data/liming-local.sqlite`。只读数据指纹及浏览器核验留在被忽略的 `.tuoguan-local/calendar-management-20261112/`，不提交真实资料、截图、账号或数据库。

日常5177通过 `node .tuoguan-local/calendar-daily-browser.cjs` 完成Edge 157只读验收：9／10月日期保护、七项详情金额、1040px面板及10月183条流水正常，脚本／接口错误均为0。通过 `node .tuoguan-local/calendar-data-check.cjs` 对比修改前后各业务表指纹：18档案、28参与记录、565考勤、480资金流水及补课数据均不变；9月消费14,650元、10月9,025元、净消费23,675元保持。启动和登录仅更新roles时间戳及operation_logs，完整性及外键检查正常。凭据使用已有授权账号，临时文件已删除。私有验收脚本含本地路径，不纳入提交，以上6项合成测试可在仓库复现。

### 价值与后续取舍

1. 值得：日期是否开放直观可见，详情先看金额，符合本轮日常操作目标。
2. 日历增删比选日期再确认更快；连续操作只开一次弹窗。关闭后一次刷新是稳定性与即时反馈的折中。
3. 删除重复入口和每次删除确认；只保留保存状态、保护与错误提示，不弹成功通知。
4. 两种日历复用日期计算及布局，分别保留启用状态和考勤语义。
5. 移除详情表不影响充值流水查询全部充值、消费、赠送、调整与冲正，后端账本完整保留。
6. 已清理本轮失效函数、事件及CSS，共用工具保留，不重构无关模块。
7. 后续优先处理真实历史凭据补录与异常考勤；若确有高频整周维护需求，再考虑批量日期选择。
8. 暂不增加日历依赖、拖拽、复杂状态框架或新的账务展示层；当前逐日点击足以满足规模。

本轮功能无待开发项。历史43格异常／空白及真实充值、期初凭据仍需机构按实际情况处理，与本轮界面无关。

## 2026-11-12 托管自动结算与宽版详情

完成时间：2026-11-12 12:43（北京时间）。基线 `ea3a93ddb418fcae5ecacab47e7244ff37728674`；分支 `feature/tuoguan-auto-consumption-ui`；应用版本 `20261112-tuoguan-auto-consumption`。本节记录当轮计费与备份规范，其余旧章节保留历史事实；旧待核定计费、参考费并列展示、托管CSV及旧列名已停用。

### 根因、界面与日期口径

旧 `attendance()` 遇到pending只改状态与参考金额，不生成账本，汇总又取正式流水，导致有效出勤消费为0。已删除该分支、独立resolve核定操作及日志标签、规则查询的pending门槛、汇总中的pending/reference_pending和前端未核定提示。保留旧数据库字段、原始单元格、来源、旧规则及审计用于兼容和追溯。

保留CourseDetails.dialog，只给托管学生详情面板增加专用宽度1040px和视口上限；公共弹窗不统一改宽。七列日历、图例、原切月和请求竞态保护不变，桌面统计卡分两行，手机自动排布，状态长文本可换行，流水与长内容在内部滚动。

费用主表采用单层完整列名，复用现有自适应列宽，避免为三个字段引入多层表头复杂度。最终12列：序号、学生、年级、本月托管消费、本月实际消费、本月赠送消费、上月实际结转、上月赠送结转、本月实际充值、本月赠送充值、月末实际余额、月末赠送余额。金额右对齐、负值样式及人民币格式沿用系统。主表、详情都直接读同一后端fee/actual_consumption/gift_consumption；统计卡只聚合当前可见学生。

“托管首日／最近托管”通过一次分组查询取所有月份已保存出勤的MIN/MAX(date)，不新增数据库字段，不按开放周期结束日或“持续参与”显示。只请假、放假、不适用或只有档案／周期时为“—”。这两个日期表示真实到托，不等同于合同参与范围。

删除本页CSV按钮、绑定、转义、拼接、Blob和下载代码；其他页面导出及托管复制导入保留。收费设置集中展示四状态统一标准，旧费率记录仍在数据库与备份中，移除会产生不同口径的自由费率表单；兼容rule写接口拒绝偏离50／25的标准。

### 自动结算与幂等设计

`tuoguan_settlement.js` 只负责统一费率与考勤—流水对账，不复制余额算法。统一规则为出勤5000分、请假2500分、放假／不适用0分，并在原tg_rules记录当前统一标准；前端由接口获取费用，不再硬编码金额。实际／赠送消费仍由原 `tuoguan_account.js → account_balance.js` 分配，批次FIFO、每批实际先于赠送、实际欠费、赠送抵欠和跨月规则不变。

结算先按attendance_id分组读取原扣费／冲正链，检查学生、日期和完整反向关联，得到已有有效净消费。应计与已计相同则不新增资金流水；不同时先全额冲正已有有效扣费，再写正确扣费。异常链拒绝处理，不删除旧账重建。保存、更正、启动迁移、旧Excel导入与完整恢复复用此路径；迁移批量读取，避免逐名汇总查询。

有效考勤的fee、规则快照、版本及退出业务使用的pending标记一并更新，旧值完整归档至审计；reference_fee、raw_status、source_cell及来源字段不抹去。未登记、数字、空白、旧缺勤／停课不自动转换或补记新消费；已有旧状态账务也不擅自删除。修改为正式状态后按现行规则结算。

每次保存继续校验版本和请求幂等，同一状态、备注和正确账务再次保存无新增消费。考勤更正与结算在同一事务中，晚期SQL失败时考勤、账本、审计、迁移标识一起回滚。自动流水以考勤稳定UUID和链内序号生成迁移标识；导入已有已结算消费不再重放。三项消费满足fee=actual_consumption+gift_consumption，实际侧包含按原规则归类的未付款，不能作为现金实收。

### 迁移结果与资金核验

私有目录 `.tuoguan-local/auto-consumption-20261112/` 保存原生备份、逐考勤预迁移差异和迁移前后摘要。先在isolated.sqlite完成补记、逐学生逐月金额校验、重复执行与完整恢复，再对当前日常库重新备份并迁移，未替换整个数据库。日常备份为daily-before-apply.sqlite；另有自动schema备份。

| 项目 | 9月 | 10月 |
| --- | ---: | ---: |
| 已保存考勤／费用页人数 | 330格／15人 | 235格／13人 |
| 出勤／请假 | 289／8 | 178／5 |
| 不适用／未登记异常空白 | 33／0 | 9／43 |
| 本月托管消费 | 14,650元 | 9,025元 |
| 本月实际消费／赠送消费 | 14,650／0元 | 9,025／0元 |
| 当月费用页可见学生实际月末余额合计 | -14,650元 | -19,300元 |

共522条正式四状态记录完成账务／规则快照规范化，新增479条扣费，净补记23,625元，保留已有50元原流水，总流水480条、净消费23,675元。重复迁移updated=0、entries=0，数据摘要不再变化。18档案、28周期、565考勤的学生、日期、状态、备注、年级、原始来源不变，原流水所有字段保持；38张非托管表（含补课、课程、充值、教师薪资）迁移前后摘要一致。日常启动／登录仅增加预期操作日志及更新角色时间，角色业务值未变。

所有18名学生10月末实际余额合计-23,675元；费用页仅显示10月签到的13人，其上月实际结转合计-10,275元，月末-19,300元。没有签到的其他学生仍保留历史余额，故这两个合计口径不同。当前无托管充值／核定期初，赠送余额为0，负数是现有账本结果；后续补录真实历史资金后由同一引擎重算，不能将负余额直接当成已确认的应追缴额。

9月旧费率与10月参考差额已按本次明确统一规则处理：保留依据，不另加参考差额。仍需实际核实的是43格异常／空白和未录入的历史期初、充值，而非逐条核定正常出勤才能收费。

### 复制导入与完整恢复

文本v3表示自动结算语义，兼容v1/v2。旧文本先按原摘要、关联和原消费链校验，再调用同一差异计划生成规范化考勤、必要冲正／补记及保留旧值的审计；预览只读，显示本次将新增的净结算金额。重复导入全部跳过时净补记为0。稳定标识、冲突阻止、预览失效保护、确认前备份和事务继续保留，原实际／赠送充值不变。来源或目标出现不同记录仍拒绝覆盖，不自动猜测同名身份。旧文本兼容派生记录以来源导出时间定位，实际导入时间及操作者另保存在本地导入审计。

没有新增表或字段，完整Excel维持v11及v4—v10兼容。旧考勤在恢复事务内自动结算，失败恢复原目标，包括其原有pending记录；恢复前仅做结构迁移，不提前写目标消费。新版完整备份恢复后13张托管表加补课／薪资／账号权限等22张关键表所有字段值及两个月汇总一致，外键为空、完整性ok。已经结算的新备份恢复不会再次收费。旧一次性零入账SQLite搬运脚本只属于历史修复记录，当前跨环境迁移使用v3文本或本版完整恢复。

### 实际测试

77个独立node:test用例最终通过，未解决失败0；只运行相关文件及失败范围复测，没有运行全项目测试。

| 实际命令（均使用node --test --test-concurrency=1） | 独立通过数 |
| --- | ---: |
| `tests/tuoguan_finance.test.js tests/tuoguan_transfer.test.js` | 28 |
| `tests/tuoguan_auto_consumption.test.js tests/tuoguan.test.js tests/tuoguan_matrix.test.js tests/tuoguan_integration.test.js tests/tuoguan_finance_ui.test.js`（Edge） | 35（含后续增加的恢复回滚1项） |
| `tests/tuoguan_independent.test.js` | 10 |
| `--test-name-pattern='full export uses\|legacy v4\|legacy v6\|full restore fills' tests/full_excel_restore.test.js` | 4 |

失败后定向复测的pattern为`debt then recharge 3000/0|v3 transfer`（2项）、`historical correction|uniform rates reject|all statuses|synthetic September|saved four|four statuses|v8 backup|monthly matrix edits|Edge streamlined`（9项）、`Edge indices|failed old backup`（2项）、`v1/v2 pending`（1项）。更新了被新业务替代的“不入账／核定”断言、格式版本及日期列名；修正了派生零金额的负零输出和测试DOM选择器。以上复测不重复计数。

覆盖四状态、默认格不扣费、历史pending、异常保留、旧50元防重、差额冲正、赠送／欠费／跨月、来源导入、逐学生保存点、版本冲突、迁移幂等／失败回滚、v1/v2/v3复制、v4/v6/v7/v8/v9/v10/v11恢复。Edge检查1040px宽版、390px手机、明暗主题、七列日历、三项消费位置及与接口一致、真实日期、无CSV、独立切月与竞态。实际5177现有账号只读验收9/10月人数和逐行三项金额，Console／未捕获／HTTP错误均0。凭据已删除，真实截图、数据库和费用报告不进入Git。

### 价值与后续

自动计费减少重复确认，三项消费让赠送抵扣和欠费归类可核查，是本轮主要价值；加宽弹窗改善阅读，删CSV则减少当前不用的维护入口。重复收费风险通过关联链、稳定标识、事务、版本和重放测试降低，但外部手工改库仍可能制造冲突，遇到坏链会拒绝结算。原余额算法没有复制，新增结算模块统一承担历史修复和日常保存；保留的旧字段只用于来源兼容。优先补真实期初／充值依据及43格考勤；以后有实际需求再做月度封账与历史修改提示。暂不建议复杂费率、优惠引擎、自动跨环境覆盖或重新开发UI组件。

---

以下为历次开发记录；其中“待核对后入账”“参考金额不入账”“导出CSV”等旧行为均已停用，不作为现行操作说明。

## 2026-11-12 托管费用、资金分账与详情日历

完成时间：2026-11-12 12:07（北京时间）。基线 `3ecf7b6e5d17acba87a65febf4c998d7c09ac37c`；分支 `feature/tuoguan-finance-calendar-detail`；应用版本 `20261112-tuoguan-finance-calendar`。以下旧章节保留当时行为与数据；当前功能以本节为准。代码推送、日常本地库迁移、正式部署是不同操作；本轮仅完成前两项。

### 使用与复用

四表复用 `rowIndexColumn / rowIndexHeader / renderRowIndex`，序号不入库。矩阵冻结前三列，公共自适应列宽按实际宽度设置第二、三列偏移；背景不透明。日期表头使用原生按钮及统一详情确认弹窗，完整日期明确显示，取消不写入，确认复用 `remove-dates` 的版本校验与数据关联保护。

`tgSummary` 内部路由保留，面向用户改为托管费用。费用表十列依次为序号、学生、年级、实际／赠送结转、实际／赠送充值、已消费托管费、实际／赠送月末余额。仅当月有保存的有效考勤才显示；出勤、请假、放假、不适用和兼容旧有效状态计入，只有未登记记录不计入。历史年级优先取当月考勤，再取当月周期，最后回退档案。姓名、年级筛选、统计卡与CSV使用同一可见集合，无签到学生的资金仍在流水中。

托管学生页不再有明细和操作列，姓名按钮复用基础资料表单，使无签到档案仍可维护。仅费用整行打开业务详情，Enter／空格可用，行内其他交互目标不会触发详情。复用 `sharedCourseDetails.dialog` 和既有 `snapshot` 接口，按真实ID匹配同名学生。关闭保持外层筛选及滚动。

详情为基础标签、七列日历、当月资金三部分。日历按周日到周六及真实首日星期、月份天数、跨年和闰年排列；只呈现已保存记录，无记录为“—”，历史异常保留原始值及备注。月份请求有序号、账号、页面和弹窗存活校验；旧响应不能覆盖新月份，加载时不混用旧资金。单元格、系统自定义选择器、日历及图例共用状态映射：绿出勤、蓝请假、中性放假、黄不适用。金额复用系统人民币格式及右对齐。

### 最小数据库升级与统一账务

13张托管表不变，仅向 `tg_ledger` 增加可空整数分字段 `actual_amount / gift_amount`。原 `amount`、备注、经办、关联、时间、请求及审计记录均保留。新充值、退款、调整、优惠、期初操作同一事务写入金额对，满足两类之和等于原合计；重复请求幂等、不同请求内容冲突、权限与乐观并发规则沿用。

迁移前生成SQLite原生备份；DDL、外键检查与完整性检查在事务内完成，失败回滚。再次启动不重复迁移或生成新账。旧记录新字段保持NULL，绝不批量归为赠送。非考勤旧资金通过原单余额兼容计算，并显示归属待核对；这只是保存旧余额的兼容口径，不代表确认了现金收款或赠送来源。确认后应以有凭据的调整纠正，不能覆盖旧流水。

从原 `src/server.js` 原样提取批次、扣款、欠费结算与消费归类函数到 `src/domain/account_balance.js`，补课 `calculateStudentAccountTimeline` 仍使用原参数和元制舍入。托管 `tuoguan_account.js` 用同一引擎，输入和计算全部为整数分；独立托管表与补课账户不混用。托管适配层只负责不可变流水重放、冲正关联、月度聚合及旧账标记，前端不计算另一套账户余额。

具体规则：

1. 按业务日期排序，同日资金先于消费；同日资金按原流水顺序。消费按批次FIFO，每批先实际再赠送，早批赠送可早于后批实际被消费。
2. 不足部分记实际负余额，赠送不为负。后续入账先抵实际欠费，再用可用赠送抵欠；不会长期闲置赠送同时保持实际欠费。
3. 当月赠送抵当月消费欠费，会把对应消费归类从实际转为赠送；赠送抵结转或调整欠费另返回 `prior_debt_gift_offset`，不增加本月消费。实际消费包含本月未付款，`fee = actual_consumption + gift_consumption` 是费用发生口径，不是收款口径。详情提示本月未付金额。
4. 月末分别结转实际、赠送；下月以一个结转批次开始，对齐补课。无签到月份也继续计算资金，费用页隐藏行不删除数据。
5. 修改考勤保留原扣费、全额冲正及新扣费链，按原业务日期重放计算，历史补录会改变后续结转；重复保存同一状态不重复扣费。已核定流水不物理删除。
6. 退款按业务日已有的各类可退余额分别限额，负调整沿用公共引擎；赠送扣减不足转实际扣减或欠费。显式调整可实际减、赠送增且合计为0；充值两项不能同时为0。
7. 资金原始拆分存库；考勤消费拆分由后端按查询月份重放得出并随流水返回，原始考勤扣费的分账列仍为NULL。这样后续抵欠、历史冲正不会造成持久化派生值失真。

### 复制、备份及真实数据

托管文本v2保留稳定UUID、摘要、预览签名、事务、冲突保护及导入前备份。预览展示实际／赠送充值、将新增金额和旧账待核对条数。v1先校验原摘要，再把缺失分账字段兼容为空；不静默丢弃已带分账的伪v1。金额合计、方向、关联、扣费冲正链均校验，重复导入不重复充值，目标内容不同时整批阻止，不覆盖补课数据。

完整Excel v11包含两字段及稳定身份，保留原22个可见表；旧v4—v10恢复时补缺失字段为空，旧独立身份和班级转换继续生效。新版须用本版或更新版恢复。全库恢复会覆盖其管理范围，托管文本是增量合并，两者用途不同。

私有核验目录：`.tuoguan-local/finance-calendar-20261112/`。`before.sqlite`、`isolated.sqlite`、`daily-before-apply.sqlite` 和自动schema备份均未提交。先在隔离库逐表比较51张表全部原字段，迁移幂等；再在隔离库分配文本迁移标识并导出v11，恢复后13张托管表及补课学生、课程、充值、绩效、薪资规则、账号权限共22张关键表字段值一致，两个月的分账汇总也一致。外键检查为空、完整性ok。

日常库执行前另备份当前数据，迁移后51张表原字段不变，仅新增两列；未分配日常库迁移标识或执行真实资金写入。启动及登录仅出现预期的角色更新时间与操作日志变化，角色业务值不变。

重新实查为18份独立档案、28条参与记录、9月330格（15人）、10月235格（13人）。原564格仍待核定；10月另有本轮开发前已存在的一格正式签到及50元扣费，原样保留，现有流水共1条。43格未登记／异常、9月规则争议、10月100元参考差异、历史期初均未擅自处理。待核定记录没有因本次分账升级转为正式费用。

### 定向测试及边界

共63个独立 `node:test` 用例最终通过，未解决失败0；另外原补课 `--verify-student-balances` 10个内置案例通过。没有运行全项目全量测试。首轮新增测试修复了合成教师表字段缺失及JavaScript负零断言；Edge危险删除按设计返回400，改为验证该预期错误，再要求后续错误为0。失败后仅重跑受影响范围。

| 实际命令／测试文件 | 独立通过数 | 验证范围 |
| --- | ---: | --- |
| `node --test --test-concurrency=1 tests/tuoguan_finance.test.js tests/tuoguan.test.js tests/tuoguan_transfer.test.js tests/tuoguan_matrix.test.js` | 38（20+7+8+3，含后续补测） | 资金边界、欠费抵扣、FIFO、冲正、补录、幂等、权限、身份隔离、文本版本与迁移 |
| `node --test --test-concurrency=1 tests/tuoguan_finance_ui.test.js` | 3 | HTTP安全；Edge四表序号、三冻结、彩色选项、删除保护、双资金表单、同名ID、历史年级、独立日历与竞态；v11/v10恢复 |
| `$env:TEST_BROWSER='edge'; node --test --test-concurrency=1 tests/tuoguan_integration.test.js tests/recharge_month.test.js` | 16 | 原矩阵、资料维护、文本复制导入、权限事务、v7/v8/v9、补课充值日期及跨月 |
| `node --test --test-concurrency=1 --test-name-pattern='full export uses\|v9 retains\|legacy v6\|legacy v4\|full restore fills\|password hashes' tests/full_excel_restore.test.js` | 6 | v11、v4/v6旧备份、薪资及完整恢复、认证信息隐藏 |

针对修复实际执行：财务文件修复后重跑及失败分支单独复测；随后 `--test-name-pattern='legacy nonzero|historical grade|failed split migration'` 补测迁移回滚和只有异常记录的筛选，共3项通过；Edge以 `--test-name-pattern='Edge indices'` 单独重跑1项通过。另以 `--test-name-pattern='v2 transfer'` 补测v1实际导入与重复导入1项通过。以上重复运行不重复计数。

补课账务命令以隔离合成库的 `DB_PATH / DATA_DIR` 执行 `node src/server.js --verify-student-balances`，没有拿真实库做测试写入。真实5177另用Edge 157和现有管理员账号只读核验四页、9/10月人数、详情及1440／390px明暗布局，Console错误0、未捕获异常0、本地HTTP错误0。凭据文件验收后删除，截图与带学生数据的报告均留在忽略目录。

### 价值与后续取舍

最值得的是分账、真实签到筛选和安全迁移，可直接减少对账错误；日期快捷删除与序号改善日常操作。日历便于找连续出勤、请假和空白，但长跨度对账仍应使用流水。存在赠送业务时分账必要；两业务共用真实公共抵扣算法，月度数据适配保持各自职责和独立账户。已去掉重复详情入口与无用费用列；工具栏删除与表头删除提供批量／单日两种用途，保留合理。

引擎提取和不可变账本重放增加了一定代码，但避免重复金融规则，无新依赖或新账表。目前全历史重放适合单店规模，后续有实际性能证据再考虑缓存。优先补历史收费凭据与异常确认流程、明确旧账分账调整，再考虑按月对账导出。暂不建议自动跨环境同步、强制覆盖冲突、复杂优惠营销、会计总账或重新开发弹窗／日历组件库。

## 2026-11-12 托管精简、月度矩阵与安全文本迁移

完成时间：2026-11-12 11:13（北京时间）。基线 `49b7aeb143849351a3079d9530857d4f6d9d92ba`；分支 `feature/tuoguan-ux-data-transfer`；应用版本 `20261112-tuoguan-ux-transfer`。未合并main、未部署、未对正式服务器执行导入。下方旧日期章节为历史开发记录。

### 使用与复用

学生和年级直接复用renderStudentBadge、renderGradeBadge、badgeColorStyle；独立托管ID选取档案，不按姓名连接补课档案。出勤使用既有已上绿色，不适用使用暂停黄色，请假使用待上蓝色，放假使用低强调灰色，历史状态未改写。复用原日期控件、date-range-nav、CourseDetails.dialog、薪资文本框及自适应表格，没有新增框架或运行依赖。

日期用UTC计算周日到周五，默认日期只在snapshot组装；历史日历与考勤日期并入，周六保留。首次明确保存考勤才在同一事务写入该日历日期。删除默认日写enabled=0，后续加载不再补回；新增日期支持周六，重复拒绝。任何已保存考勤或当日资金均阻止日期删除，批选整批回滚。

remove-students只处理当前月份：无考勤／资金才允许，对跨月周期截断或拆分，完整落在月内的空周期才移除。档案、其他月份和资金保留；版本检查防并发。已导出的被移除周期保留迁移删除标识，旧文本不能复活该记录，数据库本地ID复用也不会串身份。重新加入月内空档时自动截止到下一段已有参与范围之前，仍由后端拒绝重叠。周期取参与关系，不用MIN/MAX考勤推断退托。

矩阵姓名、年级双冻结；自适应工具按第一列实际测量宽度更新CSS变量，第二列用此偏移。日期列统一使用内容测量的最大宽度，不按滚动或单格保存反复测量。两列与表头使用不透明主题背景。姓名180ms防抖且本地筛选，年级即刻筛选；保存未结束时排队应用筛选，避免销毁待保存格。月份加载检查序号、宿主和月份，保留姓名／年级条件，跨年及迟到请求已验收。

学生主表一人一行，初一／初二／初三后按姓名排序，显示学生、年级、首次参与、最近参与、详情；首次与最近来自参与范围，开放周期显示持续参与。去掉状态筛选、周期编辑、列表资料编辑及已有学生入托重复入口，详情仍可编辑基本资料。设置移除日历／值班、历史Excel核对及其前端事件代码，旧后端、来源表和备份转换保留兼容。资金页去掉最近操作，实际资金表不变。

### 文本迁移协议与限制

三个受登录、托管财务权限和只读限制保护的POST接口：`/api/tuoguan/transfer-export`、`transfer-preview`、`transfer-confirm`。补充矩阵POST动作：`add-dates`、`remove-dates`、`remove-students`；沿用request_id幂等和记录version。旧student／period／attendance／money等接口保持兼容。

JSON类型liming_custody、格式1，包含exported_at、source UUID、records和规范化SHA-256校验摘要。按白名单复制9张业务表：学生、周期、规则、日历、考勤、资金、历史导入批次、来源映射、内部审计。日期排除和历史原始状态、费用快照一并保留。金额为整数分。排除请求缓存、旧补课身份映射、账号、会话、普通课程与薪资；日历旧教师外键不跨库迁移，目标已有教师绑定保留，历史时段及备注保留。来源／审计中的原始JSON作为证据保留，不将内部旧数字当作目标外键。

新增tg_transfer_meta保存来源标识，tg_transfer_keys保存表名、稳定UUID及本地行键（含删除标识）。首次复制会为现有业务行分配标识，不改变财务或考勤。再次导出、跨库再转出及完整Excel恢复保留稳定身份；目标按UUID重映射学生、考勤、周期和资金关联。独立来源的同名学生列为冲突，不猜测合并；同一来源内容改变也列冲突，不能静默覆盖。源中缺失的记录不会删除目标。此功能支持新增记录的安全增量搬运，不提供冲突自动合并或双向实时同步。

预览在内存进行，检查类型、版本、摘要、完整白名单、字段类型、日期／金额、关联和考勤账本净额；展示学生、月份范围、考勤、规则、资金及新增／跳过／冲突数量。最多12MB／10万记录，服务端同时保留最多20份预览，凭据绑定操作者且10分钟有效。请求体使用UTF-8流式解码，跨网络分块的中文不会破坏摘要。摘要用于完整性检测，不是数字签名或加密。

确认再次校验权限、摘要、表结构及目标托管数据签名，使用原生SQLite backup备份整个目标库并检查完整性，再BEGIN IMMEDIATE内复查签名、生成合并计划及写入；任何冲突、SQL或外键失败全部回滚。预览到确认期间发生托管变化必须重新预览。导入直接复制已验证账本，不调用充值／考勤扣费逻辑；重复数据跳过，源考勤冲正／退款不会重放。

浏览器仅在弹窗内存持有文本，关闭清空；不写localStorage、URL或控制台。安全剪贴板失败提供选中文本框。正式操作应由用户在HTTPS目标中登录执行，本轮仅用两个合成数据库模拟来源与目标，没有向线上导入。备份保存在目标DATA_DIR/backups的custody-transfer-UUID.sqlite，响应不暴露服务器备份路径。

### 操作日志与教师类型

托管档案、参与、日期、考勤、资金、导入写入原operation_logs，统一在设置→操作日志查看；保留tg_audit内部证据。正常请求重试不重复写业务操作日志，重复导入没有新记录时不追加“导入完成”日志。普通日志只记录动作、日期、月份、数量和结果，不含姓名、资金原文或完整导入文本。失败日志也只记动作和失败结果。旧历史内部审计没有批量复制到通用日志，仍通过完整备份保留。

教师详情复用ClassCourseUI.saveType，新增selection模式：提交当前弹窗实际课程ID以及原类型、updated_at。后端检查角色、可见范围、同一组合和年级允许类型；逐行带原值条件更新，冲突整批回滚，记录每节修改前后类型。取消不提交；原class／lesson模式保持。班级键不含类型，修改不拆班。成功使课程、课时、基础课薪、绩效及财务缓存失效。详见[教师说明](SALARY_MONTH_ISOLATION.md)。

### 数据迁移、备份与真实核验

新标识表创建前自动VACUUM INTO备份；事务创建、外键与integrity_check通过才提交，再次运行不重复迁移。日常库迁移前另做原生backup并核对摘要。隔离及日常迁移均验证原49张表逐表不变，38张非托管表完全保留；仅新增2张空标识表。保留18档案、28周期、40日历、564考勤，其中9月330、10月234，全部pending=1、fee=0，资金0，43格未登记／异常不补齐。

私有文件均在`.tuoguan-local/ux-transfer-20261112/`，未进入Git：before.sqlite、isolated.sqlite、daily-before-apply.sqlite及迁移／浏览器报告。真实副本仅在隔离库分配689个迁移标识并导出full-private-v10.xlsx，在restored-v10.sqlite恢复后，13张托管表加补课学生、课程、充值、绩效、薪资规则、账号权限等22张关键表全部字段值一致；已按字段名归一化，避免列顺序产生假差异。v10完整备份覆盖13表，仍保留原22个可见表，兼容恢复v4—v9。

日常5177以Edge157只读核验18人列表、9—11月矩阵、设置和流水；9月330格、10月234格已保存记录不变，11月只有默认日期、没有自动新增参与行。1440px／390px和明暗主题双冻结偏移均正确、无页级溢出、最后日期可见。异常、Console错误及本地HTTP失败均0。启动只更新原角色时间戳，登录／访问新增通用日志，除此之外业务摘要不变；角色权限和其他字段逐字段一致。

回滚时先停止明确对应此数据库的本地服务，并另备份现库；只在确认迁移后没有新业务时，才可使用迁移前完整备份配套恢复旧版本。已有新业务时先制定保留方案，不能直接覆盖。此次只验证独立恢复，没有执行破坏性回滚。

### 定向验收（46项去重通过，未解决失败0）

统一前缀：`node --test --test-concurrency=1`。浏览器命令前设置`$env:TEST_BROWSER='edge'`。实际按功能集中运行，修复后只复查受影响项；没有重复运行全部历史套件。

| 文件／名称筛选 | 独立通过 | 覆盖 |
| --- | ---: | --- |
| tests/tuoguan.test.js | 7 | 收费、冲正、历史未核定、幂等 |
| tests/tuoguan_matrix.test.js | 3 | 旧结构迁移、默认显示与历史保护 |
| tests/salary_month_isolation.test.js | 3 | 月份／教师隔离及请求时序 |
| tests/tuoguan_transfer.test.js | 8 | 日历边界、增删、双库ID映射、余额、重复／增量、冲突、回滚及删除标识 |
| tests/tuoguan_integration.test.js（Edge） | 12 | v7／v8／v9／v10兼容、身份标识恢复、权限、日志、UTF-8分块、两阶段导入、剪贴板回退、日期／学生增删、延迟请求与保存中筛选、双冻结及主题 |
| --test-name-pattern='selection course type\|monthly salary UI' tests/salary_workflow_api.test.js（Edge） | 2 | 取消／单节／筛选内批量、精确范围、并发与事务回滚、薪资及财务汇总 |
| --test-name-pattern='full export uses\|v9 retains\|legacy v6\|legacy v4\|full restore fills\|password hashes' tests/full_excel_restore.test.js | 6 | v10、旧格式、关键恢复及隐藏认证数据 |
| tests/tuoguan_history_merge.test.js | 4 | 旧合并脚本备份、幂等、冲突、回滚 |
| --test-name-pattern='class IDs' tests/salary_template_course_type.test.js | 1 | 既有整班／单课模式兼容 |

验收中修正过金额汇总SQL、默认日期旧断言、页面选择器及Edge临时目录占用清理；只复测相关项。补充发现并修正了被移除记录再次导入、移除后月内重新加入、中文网络分块及课程更新事务内冲突。真实数据验收与22表恢复比较另计，不混入46项数量。

### 价值、边界与后续

最值得的是不落账的默认矩阵、自动筛选／双冻结、精确课程范围和有冲突阻断的迁移。当前18人规模手动复制足够，不建议立即做自动同步。前端仍是原生页面分发，少量表单拼接可以接受；summary金额已由逐生SQL改为一次分组查询，移除snapshot冗余来源／审计大文本。迁移计划仍以内存逐条比对，适合当前小机构，未宣称大规模压测。

日常冗余入口已清理；底层历史兼容不是可直接删除的冗余。手机侧栏、宽表滚动和浏览器日期控件沿用原系统，长姓名只能横向查看。优先核对历史43格异常、100元差额、9月规则、真实参与范围及期初资金；旧核对UI已按要求下线，后续如确需集中处理历史争议，再单独设计小范围核对入口。导入冲突目前只有预览和拒绝，没有自动解决、强制覆盖、自动同步或加密平台。上线升级和真实迁移仍由用户另行安排。


## 2026-11-12 月度矩阵与班级移除

完成时间：2026-11-12 01:02（北京时间）。基线为 `985fd817b3159f01af04b6b51ddd768ebbbaca65`，分支 `feature/tuoguan-matrix-salary-month-fix`。先使用日常库备份生成隔离副本验证，再迁移本地5177；未连接正式服务器、未修改原Excel或自动核定历史金额。

### 最终业务与界面

托管只有初一、初二、初三三个年级。删除档案、周期、考勤的班级输入、筛选、展示及业务匹配，补课班级不受影响。导航改为「托管」，复用原SVG尺寸与描边。姓名直接显示，只有同名选择时追加年级及备注/入托日期等辅助信息，身份仍按独立ID区分。

每日签到只保留月度矩阵，删除单日页、双模式切换、旧草稿和批量选择逻辑。日期取当月启用日历与实际历史考勤的并集，周末记录保留；按历史年级、系统姓名排序。周期外不可编辑。默认出勤带圆点，仅显示，不产生考勤或收费；明确选择后才保存。无日期或无学生时保留添加与设置指引。

单格复用 `openInlineCustomPicker`，日常选项仅出勤、请假、放假、不适用。键盘Enter/空格打开，原选择器支持方向键及确认。保存保留请求幂等键和版本，成功更新本格及内存记录，不重画整表；网络失败恢复原值，409冲突读取最新格并提示。捕获宿主、数据对象、账号与月份，切页后迟到结果不污染当前页面。

「添加学生」复用小表单及原student/period接口，新身份与首周期在同一事务保存，已有身份只建新周期，重叠拒绝。返回学生复用原档案；同名新建须先核对，在学生页用备注明确区分。添加成功清除会遮住新行的筛选，不自动建考勤，也不延长其他月份周期。

历史pending、source_cell、raw_status、rule_json及审计不清除。历史停课仅显示为放假；缺勤与未登记保持原记录，后者显示原始空白/异常。人工更正pending考勤只更新状态、备注、参考金额和版本，收费仍为0；显式「核对并入账」仍在设置内。已入账记录沿用不可变费率快照与冲正流水。签到权限响应剔除费用、参考金额和规则JSON，返回安全的已保存行供界面刷新；只读限制前后端均保留。

滚动问题来自公共 `smooth-table-wrap` 的双侧scrollbar-gutter预留与托管sticky列叠加。托管容器使用auto gutter，表格采用分离边框、连续宽度，固定姓名列始终用不透明主题背景；表头和左上角分层。未增加!important、外部组件或全局滚动补丁。

### 迁移、备份与回滚

`tuoguan_schema.js` 检测三张表的class_name。对文件库先VACUUM INTO完整备份，再在BEGIN IMMEDIATE事务内删除列；逐行比较除班级外所有字段，保留全部ID、周期、收费及来源，旧班级值归档为一条tg_audit记录。外键及integrity_check通过才提交，失败回滚结构与数据。再次启动检测不到列，不再备份、重复迁移或追加审计。内存测试另验证含索引阻塞的DROP失败可完整回滚。

完整Excel为v9，支持v4—v9。v4—v7仍先转换旧托管身份，v8保持独立身份；三张表的旧class_name在恢复时忽略。只读导出旧SQLite同样在内存转换，来源文件不变。原导入工作簿有班级列也可解析，班级不再参与跨月匹配；历史来源JSON可继续保留。导入限定三年级，错误学生单独回滚并报告冲突。

本次私有目录为 `.tuoguan-local/matrix-salary-20261112/`：

- `daily-before.sqlite`：本轮开始时原生全库备份；`isolated.sqlite`：迁移验证副本。
- `daily-before-apply.sqlite`：停止确认过的本地服务后、实际迁移前新增并验证的完整备份。
- 自动迁移备份：`data/backups/liming-local.sqlite.pre-tuoguan-schema-1794416083832.sqlite`。
- `daily-migration-private.json`、`daily-browser-private.json`：迁移前后摘要、浏览器只读结果；真实截图也只存此目录。
- `full-private-v9.xlsx`、`restored-v9.sqlite`：隔离副本完整导出和独立恢复，11张托管表加补课学生、课程、充值、绩效、薪资规则及账号权限等20张关键表的全部字段一致。比较按字段名归一化，避免新旧建库字段顺序不同造成假差异。

事务内失败自动回滚。提交后如需恢复，先核对5177进程与DB_PATH，停止写入并备份当前库；用daily-before-apply.sqlite在独立路径打开，检查完整性和全部业务表，再配套恢复迁移前应用版本。确认迁移后没有新增业务才可恢复旧全库，否则必须按新增业务制定保留方案，不能直接覆盖。不要运行旧代码连接已删列的新库。本轮实际完成隔离恢复验证，未对现库执行破坏性回滚。

### 真实数据与薪资安全

隔离迁移和实际迁移均验证18份托管档案、28周期、9月330格及10月234格逐字段保留；564格pending=1、fee=0，流水0，40个日历日期保留；43格未登记/异常未补齐。迁移新增1条班级字段归档审计，原审计、请求和导入来源不变。38张非托管表完全一致，包括158名补课学生、1864条课、355条充值和16个账号。

正常启动与登录后，角色表原有初始化逻辑更新updated_at，操作日志新增访问记录；角色其他字段和权限逐字段一致，其余业务表摘要不变。9—10月绩效及原课薪没有被写入或重算。只读历史审计见[教师绩效说明](SALARY_MONTH_ISOLATION.md)，不能把未找到旧值当作已经恢复旧值。

实际Edge157在5177登录后读取两个月矩阵、验证薪资输入月份归属；桌面1440px、手机390px及明暗主题均检查固定列、最后日期、页级溢出和截图。Console、未捕获异常、本地HTTP失败均0。Chrome另用合成库验证同样布局。用户日常Edge配置不变，测试实例及临时凭据已清理。

### 本轮定向测试

下表按独立测试去重：45通过，未解决失败0；另在Chrome运行矩阵同一测试1次通过。执行中仅修复、复测失败项和新补充断言，没有反复跑无关全量套件。以下命令可重现对应覆盖，实际执行曾按名称分批筛选。

| 命令（省略统一前缀 `node --test --test-concurrency=1`） | 独立测试通过 | 覆盖 |
| --- | ---: | --- |
| `tests/tuoguan.test.js` | 7 | 收费、冲正、四状态、幂等、周期、导入 |
| `tests/tuoguan_independent.test.js` | 10 | 独立身份、旧外键、失败回滚、跨月来源、忽略旧班级、非法年级隔离 |
| `tests/tuoguan_matrix.test.js` | 3 | 删列备份/幂等/回滚、默认显示不写入、历史更正不入账 |
| `tests/salary_month_isolation.test.js` | 3 | 错月保存复现、旧响应覆盖复现、月度/教师独立与清空及分摊 |
| `tests/tuoguan_integration.test.js`（Edge） | 9 | 权限、v7/v8/v9恢复、档案、矩阵、键盘、冲突、网络失败、返回学生、跨页保存 |
| `tests/tuoguan_history_merge.test.js` | 4 | 现有合并工具对新结构的备份、幂等、冲突和事务保护 |
| `--test-name-pattern='full export uses|v9 retains|legacy v6|legacy v4' tests/full_excel_restore.test.js` | 4 | 新格式、旧格式和薪资字段兼容 |
| `--test-name-pattern='monthly salary UI' tests/salary_workflow_api.test.js`（Edge） | 1 | 快速切月、刷新持久化、两教师、清空、单课类型和薪资/财务汇总一致 |
| `--test-name-pattern='templates validate|class IDs|automatic types|Chromium template' tests/salary_template_course_type.test.js`（Edge） | 4 | 原公共编辑组件、类型权限、年级限制、模板和旧界面回归 |

浏览器命令前设置 `$env:TEST_BROWSER='edge'`；Chrome补验设置为 `'chrome'` 并运行 `--test-name-pattern='monthly matrix' tests/tuoguan_integration.test.js`。`npm.cmd run test:tuoguan` 已加入矩阵领域测试，便于后续复验。

两项绩效复现测试在修改前失败，修复后通过。验收中补齐了课时详情共享选择器绑定和矩阵显式键盘处理；旧测试夹具中的class_name、备份版本断言、键盘/网络拦截测试写法也已更新。此前单日签到专属测试随功能删除，以矩阵的同类权限、异常和跨页测试替代。完整恢复最初按列顺序哈希误报课程差异，逐字段核验无数据差异，已修正私有核验方式。

### 取舍与仍待人工处理

价值顺序：薪资月份准确性、直接签到效率、历史安全、界面一致性、减少重复维护。没有必要恢复单日入口或增加复杂批量工具栏。下一步先确认历史异常、100元差额、9月规则和期初资金，再考虑简单的批量日历维护；新增11月周期必须依据真实入托日期。暂缓班级体系、新财务表、额外签到模式、自动确认历史金额与大规模前端改造。

以下按日期标记的章节保留前轮开发记录；现行架构、操作与备份章节已同步本轮行为。

## Edge与日常数据库修复（2026-11-11）

### 实际根因与环境证据

只读检查确认5177原监听进程PID 71368，命令 `node src/server.js`，可执行文件 `D:\Program Files\nodejs\node.exe`，工作目录为本项目；进程未设置 `DATA_DIR`、`DB_PATH`、`PORT`、`NODE_ENV`，按代码默认打开 `data/liming-local.sqlite`。32856原进程PID 62892明确设置隔离目录、历史库路径及 `HOST=127.0.0.1`。两个接口原均返回 `20261111-tuoguan-independent`，不是旧服务代码导致差异。两库均为本机普通文件，项目目录和数据路径不是重解析链接；未发现生产数据库连接或双向同步映射。本地库已有自动本地/远程备份设置，属于备份归档而非生产库同步，本轮未修改这些设置、未部署生产服务。

Windows TCP表实际能读到5177监听PID；初始 `-State Listen` 筛选未返回记录，去掉该筛选按端口定位后得到监听进程，且HTTP持续可达，因此没有误判服务不存在。对两个Node进程只读取工作目录及数据库相关环境变量，没有打印其他环境凭据。停止服务前再次核对端口、PID、命令及此前确认的工作目录，只重启该项目5177进程。运行日志保存在本地忽略目录。

Edge实际路径 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，版本157.0.4341.42；HKLM/HKCU未发现配置的Edge远程调试限制项。内置浏览器工具在执行浏览器初始化前报 `codex/sandbox-state-meta: missing field sandboxPolicy`，故该失败不能归因为页面、Edge版本、端口或用户配置冲突。直接CDP实际返回 `Edg/157.0.4341.42`、协议1.3，并可正常登录5177；这验证了当前本机Edge/CDP可用，不能据此推断所有安全软件均不存在，也不代表内置工具缺失字段已修复。

现有 `tests/helpers/chrome_cdp.js` 原按路径顺序优先Chrome，缺少明确Edge选择。现保留 `launchChrome` 兼容导出并新增同一函数的 `launchBrowser` 别名，支持 `TEST_BROWSER=edge|chrome|auto`、`EDGE_PATH`、`CHROME_PATH`。指定Edge不会静默回退Chrome，连接后还校验产品名。始终在调用方目录内新建独立子配置目录，使用 `--remote-debugging-port=0` 和回环地址，通过该目录的 `DevToolsActivePort` 获取本次实例端口，避免预选端口的竞争及误连旧浏览器。启动、HTTP、WebSocket和命令有超时；`close()` 清理本次进程和临时配置，失败路径也清理。没有终止所有Edge进程、修改注册表、复用日常Cookie或重装浏览器。

实现依据：[Microsoft Edge DevTools Protocol](https://learn.microsoft.com/en-us/microsoft-edge/devtools/protocol/)（独立配置、HTTP目标与WebSocket），[OpenAI插件排障](https://developers.openai.com/plugins/deploy/troubleshooting)（区分客户端、工具服务与组件故障）。官方资料未提供此次 `sandboxPolicy` 缺失的确切修复；该层仍需工具宿主修复后重新验收。

### 两库差异及选择的合并方案

| 托管表 | 日常库合并前 | 源库及日常库合并后 |
| --- | ---: | ---: |
| tg_students | 0 | 18 |
| tg_periods | 0 | 28 |
| tg_attendance | 0 | 564 |
| tg_rules | 0 | 2 |
| tg_calendar | 0 | 40 |
| tg_ledger | 0 | 0 |
| tg_imports | 0 | 2 |
| tg_import_sources | 0 | 28 |
| tg_requests | 0 | 4 |
| tg_audit | 0 | 6 |
| tg_legacy_student_map | 0 | 0 |

9月15人、330格、参考14650元；10月13人、234格、逐日参考8975元，原表9075元及100元差异保留。全部564格 `pending=1, fee=0`；10月43格未登记包含3个原始数字和40个空白，原状态、来源单元格、规则争议、28条身份映射完整保留。两库合并前后完整性均为ok，外键检查均无异常。日常库包含真实补课业务，源库还有上轮临时核对账号；没有复制该账号或覆盖日常库文件。

比较重新解析Excel与复制已核对托管快照后，选择后者：本次目标11张托管表全空、结构相同，可原样保留已确认ID及嵌入JSON中的映射，避免重新推测身份或改变导入结果。`scripts/merge_tuoguan_history.js` 是本次场景的有限工具，不是通用数据库合并器：

1. 默认只读预检两库完整性、表/外键/索引结构和待核对、零入账边界。源库含资金、旧补课映射或值班教师关联时拒绝直接搬运。
2. 仅允许空托管目标，或来源所有记录在目标中已经逐字段一致的重复执行。其他已有数据、部分合并或ID冲突一律明确停止，保留原记录；不得通过删除目标记录绕过检查，须另做人工身份与ID对照。
3. 使用SQLite原生备份产生源库稳定快照和目标完整备份；校验备份，再开启 `BEGIN IMMEDIATE`，比较目标与备份的全部业务表摘要，发现备份后的并发写入就取消，防止覆盖新数据。
4. 仅按外键顺序插入11张托管表；事务内复查完整性、源/目标逐行一致及38张非托管表数量和SHA-256。任何失败整体回滚。没有数据库文件替换、没有重新分配或猜测身份、没有金额入账。
5. 本次实际执行后再执行一次返回 `already_present`，新增记录0。若后续人工修改了来源对应记录，再执行会报告冲突而非覆盖。

预检命令：

```powershell
node scripts/merge_tuoguan_history.js --source .tuoguan-local/independent-import-20261111/liming-history.sqlite --target data/liming-local.sqlite
```

首次实际合并使用同一命令加 `--apply --backup-dir .tuoguan-local/edge-data-fix-20261111`。本次已完成，无需再次导入。CLI输出包含本地路径和表摘要，应保留在私有日志。

### 保护、备份与回滚

实际备份：`.tuoguan-local/edge-data-fix-20261111/history-5zRmt2/source.sqlite` 与 `target-before.sqlite`。该目录的核验清单及 `.tuoguan-local/edge-merge-result-private.json` 记录事务前后每表数量和摘要；后者明确记录提交完成。备份已用SQLite重新打开验证完整性，并在独立恢复副本核对所有表，未覆盖现用数据库。

合并事务中的38张非托管表完全不变，包括158名补课学生、1864条课程、355条充值、16个现有账号及所有权限表。随后正常重启和登录产生两种预期元数据变化：原系统启动逻辑刷新5条内置角色的 `updated_at`，浏览器登录/访问增加操作日志。已单独逐字段验证角色除时间戳外完全一致；账户、角色权限、课程、充值等业务内容和数量仍一致，托管表未因页面浏览变化。

事务内失败自动回滚，无需替换文件。已提交后的人工回滚先核对端口进程与工作目录、暂停写入并再备份现库；如果合并后没有其他业务写入，才可在停止该项目服务后使用已验证的 `target-before.sqlite` 完整恢复。若已有新业务或人工托管核对，不能直接拿旧全库覆盖，需按本次来源映射制定只撤销本次托管数据的方案并验证；不得盲删后重导。保留源库和两份备份，不对生产环境执行恢复。

### 实际验收与剩余边界

Edge在 `http://localhost:5177/` 用用户提供的现有管理员账号登录，通过真实导航点击查看全部/历史周期、今天空状态、9月20日和10月8日签到、两个月矩阵、费用汇总及导入核对。DOM验证18个唯一托管ID/28行周期、9月330格、10月234格及各格待核对标记；没有将历史学生带入今天。真实截图位于 `.tuoguan-local/edge-data-fix-20261111/daily-*.png`；浏览器报告记录Console 0、未捕获异常0、本地HTTP失败0，数据库另核对43格异常/空白、流水0。凭据及真实学生信息不进入Git。

定向命令与结果：

```powershell
$env:TEST_BROWSER='edge'
node --test --test-concurrency=1 tests/browser_selection.test.js tests/tuoguan_history_merge.test.js
# 7通过：选择/错误路径、实际Edge/清理、双实例端口隔离、备份/幂等、ID冲突、事务回滚、账务/结构拒绝
node --test --test-concurrency=1 --test-name-pattern='HTTP permission|five routes|edge cases|creates and edits|save completion' tests/tuoguan_integration.test.js
# 5通过：HTTP权限、独立档案隔离、5页面操作、跨页异步保存、空状态/草稿/只读
```

共12项自动化测试通过；真实库合并、再次执行及5177浏览器验收另行执行，不与上轮95项测试重复计数。数据库与页面权限边界未变；原课程业务通过38表事务校验和浏览器后的业务字段校验保护，没有无关全量重测。

本轮价值在于把已经正确的历史数据放进实际使用的数据库，并建立可区分Edge与内置工具故障的验收路径。多个数据库来自刻意隔离的测试/核对流程，不能把“隔离库导入成功”当作“日常系统可用”。以后导入前核对端口、PID、启动日志SQLite路径和 `/api/version`，导入后在同一实际地址复核。新增启动日志仅在本机终端显示路径；公开版本接口只返回版本、Git提交和启动时工作树标志。

优先人工核对100元差异、异常考勤、9月规则、实际入退托日期及期初资金，然后补齐11月真实周期；不要自动延长历史周期。内置浏览器限制保留为工具环境问题。暂不引入新浏览器框架、数据库管理后台、自动双库同步或大规模UI重构；已有工具和现有页面足以覆盖当前工作。

## 架构与边界

沿用 Node.js 24、SQLite、原生前端，不增加运行依赖。学生身份使用独立的 `tg_students.id`；`tg_periods`、`tg_attendance`、`tg_ledger` 和学生专属 `tg_rules` 均引用该表，不再引用补课 `students`。教师安排仍复用 `teachers.id`。不生成普通课程、不计教师课薪、不读取或抵扣学科余额。复用认证、数据库连接、页面外壳和完整备份，身份与资金独立。

入口为首页之后的“托管”，含每日签到、托管学生、充值流水、费用汇总、托管设置五个子页面；文本复制导入位于托管设置内，旧Excel核对UI已下线。仅按初一、初二、初三管理，周期和考勤保存当时的年级，不再使用班级。

| 表 | 用途 |
| --- | --- |
| tg_students | 独立姓名、当前年级、备注、时间及版本；姓名不唯一，无跨业务关联 |
| tg_legacy_student_map | 旧学生ID至独立托管ID的迁移凭据；不建立指向补课表的外键 |
| tg_periods | 入托、暂停、退托、恢复后的新周期；含最后在托日期，拒绝重叠 |
| tg_rules | 全局或学生专属规则，按生效日期追加 |
| tg_calendar | 人工确认／排除日期；保留旧教师、时段及请假依据供兼容 |
| tg_attendance | 学生与日期唯一，保存规则快照、金额和版本；旧pending仅作兼容归档 |
| tg_ledger | 整数分资金流水；考勤更正追加冲正和新扣费 |
| tg_requests | 请求编号、内容摘要、已完成结果；重试不重复入账 |
| tg_audit | 操作人、时间、操作及变更记录 |
| tg_imports | 工作簿 SHA-256、排除餐费后的预览、异常和导入结果 |
| tg_import_sources | 每个来源工作簿/来源行的身份映射、处理状态及依据 |
| tg_transfer_meta | 本库稳定来源UUID |
| tg_transfer_keys | 可迁移记录UUID、本地映射及移除标识 |

首次升级迁移托管外键，不修改旧课程数据。`BEGIN IMMEDIATE` 包住每个批次及流水，记录版本不符返回 409。规则调整不重算已有考勤；日常放假、不适用为零，历史未登记不自动计费。原始流水没有删除接口。现金充值、退款、优惠、调整和期初核定分别统计。余额允许为负；历史核定期初只能创建一次，后续差异使用有依据的调整。

## 2026-11-11 独立档案与实际导入（历史记录）

### 数据迁移

`tuoguan_schema.js` 集中维护11张表。检测四张业务表的实际外键，仅复制被旧托管记录引用的补课身份；旧ID原样保留为托管ID，并记录映射，避免破坏账本考勤引用、审计JSON及已完成请求的返回值。独立身份后续变化不再同步补课。年级、班级的当前资料可编辑，历史周期与考勤快照分别保留；没有第二套入退托状态或删除接口。

文件数据库升级前使用 `VACUUM INTO` 生成同目录 `backups/` 中的一致备份。外键重建在独立事务内进行：先复制临时表、逐行摘要核对，再替换旧表并重建索引；提交前检查补课学生摘要、外键和数据库完整性。任一步失败均回滚，恢复原外键开关。重复启动不会重新复制身份；无法定位原学生或出现混合身份结构时停止迁移，不猜测修复。本次本地原库的旧托管表为空，真实旧身份迁移数为0；有数据的迁移及替换表后失败回滚由合成库验证。

### 档案与来源身份

`POST /api/tuoguan/student` 新建或编辑独立档案；可在同一事务创建首个周期，编辑档案使用版本校验。原 `period` 接口继续处理入托、暂停、退托、重新入托。所有托管选择框只读取 `tg_students`；未入托但有预缴款的档案也参与汇总。

历史导入以工作簿SHA-256和原总览行号定位来源，编号只作为单月参考。无同名档案时可以建立新档案；跨月合并要求姓名、年级、班级一致，来源及现有档案唯一，且有前月已导入映射作为依据。同名多候选、年级班级变化或同月重名均留待人工选择。已完成来源映射不可通过重复导入改绑；基本资料允许同名，不建立姓名唯一约束。

导入页面使用 `partial:true`，在整个请求事务中以每名来源学生为保存点：该学生的档案、周期、日期及考勤全部成功或全部回滚；业务冲突保留来源原因，不覆盖原记录，不影响其他学生。没有开启部分导入的调用仍整批失败回滚。历史规则只在来源月份范围生效；参数冲突或与已有规则范围重叠时标记待核对，不用于自动计费。考勤保存原始单元格、原值、参考金额、规则快照及来源身份，`fee=0,pending=1`，仅人工核对后入账。

### 实际副本与验证

真实Excel只读解析，跳过Excel临时锁文件。原库通过SQLite在线备份生成 `.tuoguan-local/independent-import-20261111/before-original.sqlite`，另建 `liming-history.sqlite` 副本执行迁移与导入。实际结果：9月15人/330格全部导入，10月3人新建、10人跨月复用、234格全部导入，共18份档案、28条历史周期、564格考勤；无待确认身份和考勤覆盖冲突，历史资金入账0。精确逐人依据、原始期初和逐日差异仅写本地报告，公开仓库只记录汇总。

10月异常单元格为初一考勤表E13的26、初二考勤表E20/E21的10/10，日期均为10月8日。另有40格空白。100元差异定位到初二两行，各自原表缓存出勤5次、逐日文本4次，参考250元、重算200元；不能推定哪天缺记，保留待核对。原表费用参考与逐日重算分别保存，不将期初或差额当作充值，所有订餐列都排除。

迁移及导入前后，原非托管表逐表计数和SHA-256一致；浏览器启动后另核对32张业务表不变（副本中的临时核对账号、角色初始化、会话及关闭自动/远端备份的设置另计）。原库和Excel再次只读核验不变，外键错误0；用新请求编号重复两次导入也未增加档案、周期或考勤。真实副本完整v8导出并恢复后，11张托管表逐行一致。

内置浏览器仍因连接配置错误不可用，沿用仓库Chrome CDP工具。实际页面已验证独立新建/编辑、只读与权限、9月与10月签到及矩阵、待核对标记、来源映射与费用分栏。截图及本地访问凭据位于上述忽略目录；核对服务使用 `HOST=127.0.0.1`，不连接正式服务器。

本轮共95项不同自动化用例最终通过，失败修复后只复测受影响部分，未反复跑全库：

- `node --test tests/tuoguan.test.js tests/tuoguan_independent.test.js`：核心业务及独立档案迁移、回滚、匹配、冲突隔离、预缴款展示，共16项；新增及修复项用 `--test-name-pattern` 定向验证。旧待核对考勤从原规则快照补充参考金额，不入账；未提交的旧导入预览可更新规则冲突信息。
- `node --test --test-concurrency=1 tests/tuoguan_integration.test.js tests/full_excel_restore.test.js tests/recharge_month.test.js tests/salary_store.test.js`：79项；集中验收时67项通过，11项失败涉及恢复时重复嵌套事务、遗漏旧v7入口判断及测试依赖列表首行，修复后11项全部通过；另新增“旧SQLite只读导出v8”1项定向通过。
- 真实副本检查另计：原库/文件摘要、重复导入、页面实际数据及11表备份恢复；不将这些本地检查重复计入自动化用例数。

应用和资源版本为 `20261111-tuoguan-independent`。旧版SQLite在新版启动时迁移；完整Excel现为v8，旧v4—v7在读取阶段补出被托管引用的独立身份，再按父表先于子表恢复。直接导出旧SQLite时仅在内存转换托管身份，不修改来源库。旧程序不能读取v8，必须使用本版或更新版恢复。

## 2026-11-11 界面优化实现（前轮记录）

`app.js` 沿用现有导航与页面分发，新增 `tgStudents`、`tgLedger`、`tgSummary`、`tgSettings` 视图；这四个视图映射原 `tgFinance` 权限，旧本地视图值自动转至托管学生，不增加服务端权限种类。托管页面不再生成通用顶部月份栏，各业务页面自行显示必要的日期或月份。

`tuoguan.js` 的 `mount(el, page)` 选择页面，页内只保留日/月签到切换及设置内导入入口。复用 `CourseDetails.dialog`、`enhanceCustomSelects`、`enhanceCustomDateInputs`、状态标签及公共表格/统计/筛选类。样式替换原托管块，集中使用主题变量，没有增加框架或运行依赖。前端缓存版本为 `20261111-tuoguan-ui`。

筛选按页面保存在内存，签到草稿按日期与学生保存状态、备注和原始版本，选择集独立记录。切换页面不会把草稿版本替换为服务器新版本，保留 409 冲突保护；“放弃当天修改”清除当天草稿并重新请求。刷新/关闭有未保存提示，但没有持久化草稿。更换账号清空前账号状态；请求序号与宿主有效性检查避免异步结果覆盖已切换的页面。保存时禁用写控件，结束后恢复原禁用状态；加载失败清除旧记录并提供重试。

当日统计按当前日期和全部筛选结果计算，月汇总卡片仅合计当前显示的学生行。资金日期范围限定于所选月份的数据集，输入框提供当月起止约束；跨月查询需切换月份。周期状态是展示层推导，未修改后端周期、费用或记账规则。

本轮按影响范围验证，未反复运行全库测试：

- `node --test --test-name-pattern='HTTP permission|full Excel' tests/tuoguan_integration.test.js`：权限隔离、乐观并发、完整备份恢复，2 项通过。
- `node --test --test-name-pattern='custody UI:' tests/tuoguan_integration.test.js`：五路由、菜单顺序与折叠、共用控件/弹窗、筛选、草稿跨页面保留、批量保存、矩阵、汇总、主题、390px 视口和教师权限，1 项通过；原三类页面渲染也检查通过。
- `node --test --test-name-pattern='UI edge cases' tests/tuoguan_integration.test.js`：跨页面草稿仍触发版本冲突、放弃草稿、无在托学生、网络失败重试、空汇总及只读控件，1 项通过。
- `node --test --test-name-pattern='custody mobile' tests/tuoguan_integration.test.js`：批量下拉框宽度与实际选择、页面无横向溢出，1 项通过；复核浅/深色截图。
- `node --test --test-name-pattern='custody save completion' tests/tuoguan_integration.test.js`：延迟保存期间切页，完成后仅清除原日期草稿，不覆盖其他页面，1 项通过。

内置浏览器连接配置错误，使用仓库已有 Chrome CDP 工具替代；测试库及截图保存在系统临时目录，未操作真实业务库。最终另检查 JavaScript 语法及 Git 差异空白。下文“验证与待办”保留的是核心开发轮的 80 项历史结果，不代表本轮重复执行。

仍有边界：月份采用现有原生月份输入样式，班级尚无统一托管基础数据维护；手机签到宽表需要横向滚动；日历仍逐日维护，导入仍逐条核对。优先改进这两项高频业务操作，再按实际人数评估服务端分页、班级授权；暂缓整套前端迁移和更多看板。

## API 与权限

`GET /api/tuoguan/snapshot?month=YYYY-MM` 提供当月考勤、日历及独立托管档案。`POST /api/tuoguan/{student,period,attendance,money,rule,calendar,resolve}` 写入业务；`preview` 接受 XLSX base64，`import` 接受预览批次及身份映射（`auto`自动判断、`new`明确新建、具体托管ID人工确认、空值暂缓）。写操作必须携带 `request_id`；档案、考勤、周期、日历和历史核对使用 `version`。

新增 `tgAttendance`（签到）和 `tgFinance`（托管学生、财务与设置）权限。老板沿用完整权限；其他账号由管理员显式授予。签到权限返回的数据不含费用、规则、余额、充值、导入期初或审计资金内容；普通教师无财务权限时不能调用财务写接口。只读账号前后端都禁止写入。当前签到权限表示机构范围的托管签到授权，不增加班级授权模型。

## 工作簿核对与字段映射（历史导入记录，旧计费机制已停用）

两个文件各含收费规则、学生信息、教师安排、三个年级考勤订餐、收费流水、收费总览，共八张表。含共享公式和缓存结果；总览通过学生编号、INDEX/MATCH、SUMIFS 等引用身份和流水。解析只读取缓存与原始考勤，不运行公式，也不修改 Excel。

| 原字段 | 处理 |
| --- | --- |
| 学生编号 | 只用于同一文件内部定位；不跨月认定身份 |
| 姓名、年级 | 收费总览与逐日考勤交叉定位，再按唯一来源证据识别独立托管档案；旧班级列忽略，不确定时人工确认 |
| 学生信息中的联系方式、入退托日期 | 因表头与部分内容错位，不盲目自动写入；人工检查档案 |
| 考勤日期 | Excel 日期序号转换，保留周末；空白为未登记 |
| 出勤、请假、缺勤、停课、不适用 | 导入历史考勤，初始全部待核对 |
| 非法考勤值 | 原值留在预览，按未登记进入待核对，不收费 |
| 正常费、请假费、缺勤费 | 用于独立重算和差异报告，正式核定前不入账 |
| 期初余额 | 单独保留待核对值，不能自动作为充值或连续月份结转 |
| 托管费总览 | 校验依据，不生成一笔汇总扣费 |
| 期末余额、净收款、总消费 | 不用于正式托管账本，可能包含餐费 |
| 所有订餐状态、数量、餐费 | 不保存、不导入、不参与计算 |
| 教师安排 | 非姓名内容存在异常，人工关联已有教师；不生成课薪 |
| 收费流水 | 两个原文件没有实际充值记录，不虚构流水 |

本地原始文件只读解析，档案与考勤已实际写入独立本地副本；默认主库和生产库未导入。历史资金仍需机构确认。

| 月份 | 学生 | 日期 | 考勤格 | 出勤 | 请假 | 不适用 | 未登记 | 独立重算 | 总览参考 | 差异 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-09 | 15 | 22 | 330 | 289 | 8 | 33 | 0 | 14650元 | 14650元 | 0元 |
| 2026-10 | 13 | 18 | 234 | 177 | 5 | 9 | 43 | 8975元 | 9075元 | -100元 |

两月10组同名来源已结合相同年级班级、来源唯一性匹配成功，不能仅靠编号或同名自动合并。9月20日、10月10日均保留。9月缺勤参数25元与文字50元冲突，虽然当前未发现缺勤状态，仍需确认规则。10月初一考勤 E13、初二考勤 E20/E21 分别为数字26、10、10，属于非法考勤；上述43格未登记包含3格非法值和40格空白。100元差异不能直接补成费用。

## 实际使用

1. 托管学生页新建独立档案或点姓名修改，状态为在托／暂停／已流出／已毕业，按状态、年级、姓名排序。首日／上次在托只取真实已保存出勤，无出勤为“—”。
2. 每日签到“管理学生”展示全部档案四分区，点卡片加入／移出本月。顶部“新建托管学生”一次建档并加入本月，同名不同人须备注并确认。已保存出勤／请假／放假或未解决费用依赖不能移出；仅不适用或独立资金不锁定，非在托先明确修改档案状态。
3. 新加入本月的周期默认不适用，不自动保存考勤、不收费，刷新保持且未签到可移出。真实考勤优先，原周期默认不改。老师按实际情况保存出勤50元、请假25元、放假／不适用0元。
4. “管理日期”点选添加／停用，已保存出勤／请假／放假及不安全费用依赖锁定，零费安全占位可停用，刷新不补回。费用整行打开七项费用及日历详情；详情切月保留旧内容，成功后同步更新。
5. 充值流水学生后有独立历史年级列，两者共用矩形标签。新增资金在当前范围成功后静默刷新，失败或超范围仍提示。点击行或Enter编辑；复选框在序号左侧，全选仅当前筛选可操作记录，批量删除需要确认。编辑删除保留历史证据及筛选，整批失败不改数据，冲突刷新重开。日期默认北京时间今天、备注选填，渠道共用微信／现金／支付宝／其他，其他须说明。
6. 顶部六项统计与表格同源，净账户变动及退款含赠送；年级按业务日期周期，渠道只汇总实际充值，无资料归未记录。关闭资金弹窗同步清理其下拉菜单，保存失败保留控件。日期范围优先于月份并真实跨月，清空返回所选月。日常只显示有效充值退款，旧调整、作废证据与消费留后台和完整备份，账户排除作废记录后回放；引发后续超额退款的更正会被拒绝。
7. 来源复制v5托管文本，目标先升级，再粘贴、预览、确认。兼容v1—v4，旧周期默认出勤，旧资金默认有效；已有差异阻止覆盖，重复导入不重复记账。原41条未登记已规范为不适用，来源保留；历史期初充值仍按真实凭据维护。

## 备份与恢复

原生SQLite备份包含全部托管及原业务数据。完整Excel为v13，兼容v4—v12，22个可见业务表及隐藏托管恢复数据保留档案状态、周期默认值、资金版本／作废／替代关联；旧版安全补默认值。有效旧考勤在原恢复事务中结算，已结算记录不重复扣费。Excel继续排除运行凭据／路径、IP及User-Agent，不是原生全库镜像。完整恢复覆盖其管理范围，托管文本用于增量合并，两者不能混用；先保留原生备份并核对目标路径。

## 参考项目与取舍

- [Tutora](https://github.com/suvrat007/tutora)：MIT；参考考勤、收费、课次关联和日常任务集中入口。
- [ScholarOS](https://github.com/Harshit-Mudgal/ScholarOS)：MIT；参考学生档案、考勤与费用按角色分区。仓库提交历史较短，不能据README自称生产可用就认定成熟。
- [CampusCore](https://github.com/campuscore-app/campuscore)：AGPL-3.0；参考学生、考勤和费用的模块边界。
- [Dojo](https://github.com/DojoUK/Dojo)：AGPL-3.0；参考成员、出勤和账单关联，以及独立付款记录。

只借鉴设计，不复制项目代码，也不引入其框架。资金准确性以本项目事务、幂等、版本校验和合成测试为依据，不以参考项目宣传作为保证。

## 核心开发轮验证记录与待办

自动化覆盖全部考勤状态、未登记零扣费、冲正、充值退款优惠调整、跨月结转、专属费率生效日期、暂停与恢复、重复请求、并发冲突、合成9/10月导入、重复导入、权限隔离、完整备份恢复。浏览器实际操作覆盖导航、周期弹窗、逐人更正、月矩阵、汇总和390px手机视口。原有完整Excel、课程充值月份和教师薪资领域测试同时回归通过。全部测试资料为虚构学生；真实文件和本地分析均被Git忽略。

结果：新增托管测试10项通过，原有相关回归70项通过，共80项。命令为 `npm run test:tuoguan`，以及 `node --test --test-concurrency=1 tests/full_excel_restore.test.js tests/recharge_month.test.js tests/salary_store.test.js`。Windows PowerShell若限制npm脚本，使用 `npm.cmd run test:tuoguan`。内置浏览器连接不可用，界面验证使用仓库已有Chrome测试工具。

尚需人工确认：真实身份映射、历史实际入退托日期、全部历史期初资金、9月缺勤规则、10月3格数字考勤和100元差异。它们没有写入正式账本。

后续优先项：批量日历维护及历史逐人核对汇总，减少逐条点击；针对更大规模增加分页和服务端条件查询。目前接口按月获取考勤与流水，但学生、周期、导入批次仍整体读取；适合当前机构规模，不宣称已完成大规模性能验收。请假截止时间目前作为制度展示，不自动判断家长是否超时；记录员据实际凭据选择状态。
