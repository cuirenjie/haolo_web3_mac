# M1-361／M1-362 云端计划卡片统一与移动端布局对齐

2026-10-18，固定仓库 `C:\Users\潘艳芳\Documents\ChatGPT\haolo_windows_web3`。

## M1-361 初次变更（当前展示以文末 M1-362 为准）

- `entry-v2` 原先在 `cloudPlanCard` 拼装逐行文字 HTML；现在与原右侧计划共用标题、方向／策略标签、大号入场／止损价格和分档止盈组件。
- 结构化价格直接参与展示，不借助旧报告的自由文本价格解析。触发区间显示上下界；入场确认、突破回踩、快照确认、实时证据、失效条件和 UTC 到期原文全部保留，条件中的小数不经过自由文本舍入。
- 保持原 `title`、`content`、服务端回执、计划 ID、条件哈希及交易规则。未知市场标题保留原市场身份，分钟 `1m` 和月份 `1M` 不混同。
- 补齐均线、布林带、MACD、RSI、KDJ、VPVR 的策略 ID 展示名。云端条件卡片无账户／盈亏比列，使用等宽价格列及跨列止盈行，修复英文长标签在 300px／20px 便利贴中的横向溢出。

## 覆盖范围与结果

按 `OFFICIAL_TRADING_CATALOG` 枚举全部 17 个入口：缠论、MACD、均线、布林带、订单流、ICT / SMC、SMT 背离、RSI、波浪理论、KDJ、VPVR、威科夫、谐波形态、图表形态学、裸 K、道氏理论、江恩理论。

- 85 项相关测试通过，零失败／跳过。包含 17 入口 × 2 协议（entry-v2／right-legacy-v1）× 3 语言 × 2 方向 × 3 展示位置的实际生产渲染器回归，以及历史恢复、原文不变、混合卡片身份、全部价格谓词、三种确认方式、精度和 HTML 转义。
- 408 组隔离 Electron 布局通过：17 入口 × 2 协议 × 3 语言 × 2 主题 × 2 宽度／字号（410px／12px、300px／20px），每组检查聊天、计划列表、便利贴，共 1,224 个卡片实例。检查横向溢出、标题与价格区位置、价格和目标数量；抽查保存的简中暗色常规卡片、英文亮色窄卡片截图。
- TypeScript 检查通过。Vite 构建通过，保留既有大 chunk 提示。最初两次构建命令分别使用了无效 `--root` 参数和错误入口覆盖；已改为仓库配置文件指定 renderer root 的命令并通过。
- 第一轮视觉检查发现英文均线窄便利贴 2px 溢出；修复后完整 408 组重跑通过。隐藏窗口截图曾返回旧画面，验证运行器改用 offscreen 渲染后重新生成全部截图与布局回执。

命令（均从固定仓库根目录执行）：

```powershell
node --test youle_desktop/test/cloud-plan-card-view.test.mjs youle_desktop/test/execution-plan-card-view.test.mjs youle_desktop/test/cloud-right-compatibility.test.mjs youle_desktop/test/cloud-result-restoration.test.mjs youle_desktop/test/execution-plan-sticky.test.mjs youle_desktop/test/execution-plan-context.test.mjs youle_desktop/test/execution-plans.test.mjs
node youle_desktop/scripts/cloud-plan-card-visual-qa.mjs
node youle_desktop/scripts/typecheck.mjs
node youle_desktop/node_modules/vite/bin/vite.js build --config youle_desktop/vite.config.mjs
```

证据：`.cache/cloud-plan-card-qa/tests.log`、`report.json`、`build.log` 和按策略／语言／协议／主题／宽度命名的 PNG。

## 验收边界

本次验证使用固定公开计划契约样例及实际生产渲染器，覆盖所有入口的卡片展示，不是重新调用 17 次真实云端模型或策略算法。未改后端、账号偏好、提醒规则，未激活计划或下单，未打包／发布／提交 Git。

Computer Use 已确认开发客户端显示“开发代码已更新”提示。用户按物理 Esc 停止桌面操作，随即停止窗口控制，没有点击重启。因此当前运行实例的真实历史卡片换样式尚未实机确认；点击“立即重启”后加载修复源码，已有云端计划通过同一渲染器更新显示。


## M1-362：按移动端补齐信息并精简固定说明块

- 对照 Windows 历史提交 b79ec878：原共享卡片可有灰色盈亏比、账户金额或未识别条件，但不存在云端新增的整块入场方式／周期／入场条件／失效／UTC 到期／提醒说明。只精简 entry-v2 固定块，原始 content、报告、条件精度与云端回执均保持。
- 只读参考移动仓库 apps/mobile/lib/features/plans/execution_plan_card.dart、core/models/execution_plan_display.dart 和 core/time/relative_date.dart：在入场标签旁添加有效至，窄列自动换行，两侧价格保持同一行；灰色标签加粗日期。Windows 使用设备本地绝对日期时间，避免长期打开的便利贴跨午夜后保留过时的“今天”。ISO 毫秒保留在 time.datetime 和原始数据中。
- entry-v2 与 right-legacy-v1 的聊天、列表、便利贴全部接入有效期；已保存列表的 executing 隐藏入场期限，待执行／已结束保留。旧记录缺少有效期限时不补造日期。
- 结构化卡片补齐逐档盈亏比，按移动端优先读取同方向引擎值，再用场景值，缺值显示“—”，不按展示价格重算。账户可用且场景方向／价格／目标完全匹配、可执行时，显示开仓／已有／减仓金额、止盈仓位、累计净盈利与预计止损；缺前序目标数据时不显示不完整的累计盈利。结构化 estimatedStopLoss 是非负损失幅度，显示为负数，原版文本金额的符号解析不变。
- 88 项相关回归最终全部通过；TypeScript 检查与 Vite 构建通过。新增有效时间位置／本地时间／无效日期／执行中列表例外、盈亏比来源和账户绑定／缺失前序盈利／止损符号回归。
- 420 组 Electron 隔离布局覆盖 17 官方入口 × 两协议 × 三语言 × 明暗 × 常规／窄大字（408 组），外加带大额账户金额与累计盈亏的 12 组；共 1,260 个聊天／列表／便利贴实例。检查有效时间、盈亏比、价格齐平、标题位置和横向溢出。
- 实机打开现有威科夫历史计划，确认底部固定灰字块移除，有效至显示本地 2026-10-19 00:34，盈亏比显示原值 1:0.63，完整条件仍在报告。最后补充账户金额非负幅度保护后，用户物理 Esc 中止 Computer Use，立即停止界面输入；该最后调整的源码测试／构建通过，但未确认运行实例再次重载。开发版保持打开供用户测试。

证据：.cache/cloud-plan-mobile-parity-tests.log、.cache/cloud-plan-mobile-parity-build.log、.cache/cloud-plan-card-mobile-qa/report.json 与对应 PNG。先前一次测试断言误匹配便利贴 style 内的 CSS 类名，改为匹配实际 HTML class 后全部复测通过。

本次未修改移动仓库或后端，未重新请求全部 17 个真实云端分析。没有提交、发布或激活计划。


## M1-363：有效期单行与时区标记（当前展示）

- 用户要求有效期一行展示并追加时区。改为位于入场／止损标签下方、跨两列的独立行，示例：有效至 2026-10-19 00:34 (UTC+8)。共享 CSS 保持两侧价格齐平；该行按卡片宽度限制字号，单行显示完整文案，无省略或横向溢出。
- 日期与偏移均从同一到期瞬间的设备本地时区取得，支持非整小时偏移与夏令时；原始 ISO、报告与实际期限不变。执行中列表隐藏有效期的既有规则保持。
- 41 项定向回归通过，其中时区用独立进程验证上海、UTC、印度、尼泊尔、纽芬兰及纽约夏／冬时间共 7 例。420 组 Electron 布局／1,260 实例通过，新增单行高度、完整宽度与时区标记检查；抽查简中亮色常规和英文暗色窄大字截图。TypeScript 与 Vite 构建通过（保留既有大 chunk 提示）。
- 证据：.cache/cloud-plan-expiry-single-line-tests.log、.cache/cloud-plan-expiry-single-line-build.log、.cache/cloud-plan-card-expiry-qa/report.json 和对应 PNG。本轮未调用 Computer Use，未重启用户正在使用的开发版；需加载更新后生效。未提交／发布。


## M1-364：有效期短日期与右列边距（当前展示）

- 有效期显示为 10-19 00:34 (UTC+8)，去掉可见年份，保留单行／实际时区；完整年份仍在 title、datetime、原报告与数据中。
- 云端条件卡片右列从固定半宽改为 fit-content(50%)，按止损／盈亏比／预计盈利的内容宽度整体靠右，列内左对齐；左列使用剩余空间，窄屏保留换行和宽度约束。原右侧协议已采用内容宽度列，保持其表现。
- 41 项定向回归、420 组／1,260 实例 Electron 布局、类型检查与 Vite 构建通过。布局新增右列共同左起点、常规卡片左右文字边距误差不超过 1px，以及日期省略年份检查；查看简中常规与英文窄大字截图确认结果。
- 证据：.cache/cloud-plan-inset-tests.log、.cache/cloud-plan-inset-build.log、.cache/cloud-plan-card-inset-qa/report.json 及 PNG。本轮未操作正在使用的开发版，加载更新后生效；未提交／发布。

## M1-366：有效期移至标题下方（当前展示）

- 将有效期放在“BTC · 1h 做空 威科夫”等标题下方、入场／止损标签上方，跨两列单行显示，与下方价格标签间隔 6px。共享样式同时适用于聊天、计划列表及便利贴。
- 仅调整 CSS 网格顺序；短日期、实际时区、价格齐平及原始期限不变。
- 现有定向回归 41 项通过，Electron 布局 420 组／1,260 实例通过；抽查简中亮色常规与英文暗色窄大字截图确认位置。Vite 构建通过（既有大 chunk 提示）。
- 证据：.cache/cloud-plan-expiry-heading-qa/report.json 与对应 PNG。未操作运行中的用户窗口、未提交或发布，开发版加载更新后生效。

## M1-367：标题与有效期间距缩至三分之一（当前展示）

按用户圈选，标题与有效期之间的 14px 间距改为约 4.67px，其他行间距不变。共享规则作用于聊天、计划列表与便利贴的对应布局。420 组／1,260 实例 Electron 布局和 Vite 构建通过，简中亮色截图确认；证据在 .cache/cloud-plan-expiry-gap-qa/ 与 .cache/cloud-plan-expiry-gap-build.log。开发版加载更新后生效，未提交或发布。

## M1-368：有效期下方间距扩大为两倍（当前展示）

按用户圈选，将有效期与入场／止损标签之间的间距从 6px 调至 12px，标题与有效期之间仍为约 4.67px。420 组／1,260 实例 Electron 布局及 Vite 构建通过，简中亮色截图确认。证据：.cache/cloud-plan-expiry-price-gap-qa/ 与 .cache/cloud-plan-expiry-price-gap-build.log。开发版加载更新后生效，未提交或发布。

## M1-369：修复账户数据适配与仓位／净盈亏展示

- 根因：实际 entry-v2 的 positionSizing 只包含账户测算与风险字段，方向／入场／止损／目标属于其外层 scenario；M1-362 的卡片却要求在 sizing 内再出现同一组字段。此前带账户测试使用旧字段形状，漏掉了真实新版账户返回。
- 新增展示适配器 cloud-plan-account-view.mjs。新版通过场景方向、条件内容与哈希、远端计划场景、账户入场价和数量／名义金额一致性绑定；缺失、未绑定、不可用、阻止执行及错误场景不借用其他账户数据。旧版重复字段仍按原完整绑定校验。
- 三处共享卡片展示计划数量（保留八位小数）、币种、杠杆、名义开仓金额与预计止损，金额注明 USDT。没有 targetOrders 时，服务端原始 netRiskReward × estimatedStopLoss 只转换为各目标独立的全仓净盈亏，包含原报告成本，明确标注且不累加；不推算分批比例。有明确 targetOrders 的旧记录继续展示分档金额和累计净盈利。缺失收益不补造。
- 突破回踩使用实际 retest 入场区间显示并绑定测算，不把突破确认价当成入场价。执行中列表隐藏期限时仍共享标签／价格网格，修复英文窄窗口价格不齐。
- 测试数据通过业务仓库真实 risk_check 函数，使用截图对应的合成输入生成；test/fixtures/cloud-entry-account-sizing.json 保存生产者路径和 SHA-256，没有账户标识或凭据。没有调用实时账户、模型或交易接口，也没有修改业务后端。
- 111 项回归全部通过，包含17入口×三语言×多空×聊天／列表／便利贴的新版账户展示、历史恢复、冻结数据不变、错误绑定、缺失盈亏、显式分批、回踩区间。TypeScript 与 Vite 构建通过，保留既有大 chunk 提示。
- 468 组实际 Electron 隔离布局、1,404 个卡片实例通过：原420组加48组新版多空账户，覆盖简中／繁中／英文、明暗、410px／12px与300px／20px，以及待执行／执行中列表。自动检查账户文字／金额存在、溢出、价格对齐与有效期规则；查看简中亮色常规和英文暗色窄大字截图。
- 初轮回归发现测试未对英文 & 做 HTML 转义、非有限输入的相等比较过度隐藏有效金额；初轮布局发现执行中英文窄卡片价格错位。均修复并完整复验，初始日志／布局回执保留。
- 证据：.cache/cloud-account-card-tests-final.log、.cache/cloud-account-card-build.log、.cache/cloud-account-card-final-qa/report.json及对应PNG。源码与隔离验证无阻塞；未操作运行中的用户窗口，开发版重新加载后生效。未提交Git、打包、发布、修改偏好或激活计划。

## M1-370：恢复原版账户文案，保留当前有效期

- 对照 b79ec878 的真实共享组件，恢复建议开仓／预计止损／盈亏比／预计盈利、两位小数、原有颜色与对齐。移除 M1-369 新增的计划数量／杠杆行、金额币种后缀和全仓净盈亏文字；不增加替代说明。聊天、计划页和便利贴共用此展示。
- 用户补充要求保留当前有效期行。有效至短日期、UTC 偏移、标题下位置、标题间距约 4.67px 和价格上方间距 12px 均保持；执行中列表原有期限显隐规则保持。
- M1-369 的账户适配、场景绑定与原始数值保持。新版独立目标金额继续使用原始止损幅度乘净盈亏比，不变成累计收益；旧版显式分批仍按原规则累计。只恢复可见文字与数字格式。
- 111 项相关回归、TypeScript 与 Vite 构建通过。494 组／1,482 卡片实例 Electron 布局通过，覆盖三语言、明暗、多空、执行状态、三处展示及截图对应 266px CSS 宽度；有效期存在、单行、时区和短日期纳入验收。查看简中截图及英文暗色窄大字截图。
- 额外与 b79ec878 直接逐段比较：三语言的四段账户金额 HTML 和两段盈亏比 HTML 完全一致。截图对应数值显示为建议开仓 65.67、预计止损 -1.38、预计盈利 +1.08／+2.29，没有新增文字。
- 证据：.cache/cloud-account-original-style-tests.log、cloud-account-original-style-build.log、cloud-account-original-style-parity.json、cloud-account-original-style-qa/report.json 及 PNG。未操作运行中的用户窗口，需重新加载开发版；未请求实时账户、提交、打包或发布。

## M1-371：补齐止盈仓位和当前动作（当前展示）

- 用户进一步对照旧卡片，要求保留止盈仓位和当前动作。M1-369／M1-370 的新版独立全仓预计收益展示在本次替换为旧版分档累计展示；有效期的文字、位置、时区及间距保持。
- 根因：新版服务端只返回总仓位及各目标净盈亏比，没有旧版 targetOrders；原先适配只换算独立全仓收益，故没有分档仓位。旧版渲染器还主动过滤等待动作，新版结构卡片没有动作行。
- 将旧引擎的等整百分比分档规则提取为共享 defaultTakeProfitPercent：两档 50／50，三档 33／33／34。新版账户展示缺少显式退出档位时，以冻结账户名义金额按旧版向下保留两位小数、末档补余量，生成仅供展示的 targetEstimates 与 allocationNotional；不写入 targetOrders、冻结报告或服务端计划。已有显式 targetOrders（包括空或无效值）不被默认分配覆盖，失效／未绑定账户仍不生成仓位。
- 预计盈利按各档名义金额占原始账户金额的比例换算原始净收益，包含原净盈亏比中的成本，再按旧版累计显示；缺少前档收益不拼出后档累计值。原始账户数量、金额和风险值保留，显示分档以分为单位守恒，不使用实时余额或舍入后的价格重新计算风险。
- 复用原版灰色详情行显示当前动作。旧文本保留原动作（含等待）；新版条件计划显示等待条件触发，已有硬性限制显示暂不交易，不把条件计划写成现价下单。动作是冻结计划的动作，未查询交易成交状态。
- 120 项相关回归通过，覆盖17入口／三语言／多空／三处显示、1／2／3档分配、末档余量、分档累计收益、显式档位优先、账户绑定、历史不变、动作限制及有效期。初轮两项旧测试仍要求隐藏等待动作，按本次用户要求更新断言后全通过。TypeScript 与 Vite 构建通过（既有大 chunk 提示）。
- 494 组／1,482 实例 Electron 隔离布局通过，覆盖明暗、三语言、窄大字和截图宽度。截图对应样例：建议开仓 65.66，两档止盈仓位各 32.83，累计预计盈利 +0.53／+1.67，当前动作等待条件触发；所有三处保留有效期。查看简中亮色截图及英文暗色窄大字截图确认布局。
- 证据：.cache/cloud-target-action-tests.log、cloud-target-action-typecheck.log、cloud-target-action-build.log、cloud-target-action-qa/report.json 及 PNG。未操作运行中的用户窗口，开发版需重新加载；未调用真实账户、交易或模型接口，未提交、打包或发布。
