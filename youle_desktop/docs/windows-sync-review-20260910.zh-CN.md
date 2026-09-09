# Windows→macOS 增量融合审查（2026-09-10）

审查对象：本地 `dev@4f0e143`，远端 `windows/dev@755d29f`，增量 `7762277..755d29f`；关联 M1-291 至 M1-303、M2-019。重新 fetch 后远端仍为 `755d29f`。

在 `4f0e143` 中发现并复现 5 个问题：3 个 P1、2 个 P2。以下保留原始审查证据；用户随后授权最小风险修复，修复记录见文末。

## R1 · P1 · 主图与指标副图互相覆盖手工画线存储

位置：`src/renderer/trading-expert-market.ts:13555`；相关实现为 `src/renderer/trading-expert-drawing.ts:2342`、`:3969`。

新建 RSI/MACD 等副图时，控制器与主图共用 `drawingStorageSessionId`，但每个构造函数分别从 localStorage 读取自己的 `drawings` 数组。`drawingScope` 只参与筛选，持久化键不包含它；`persistDrawings()` 将当前控制器的完整旧副本覆盖写回同一个键。回调 `recordLastDrawingWorkspace()` 只保存工作区布局，不同步这些数组。

复现：同时初始化主图与 RSI 控制器，主图保存 `new-main-line`，再由 RSI 保存 `new-rsi-line`，最终存储仅剩后者。主图当前内存仍保留画线，因此会表现为重启或切换会话后丢线；反方向编辑同样会覆盖副图画线。

建议：让同一会话的控制器共享画线数据源，或按 scope 拆分持久化并迁移旧记录，同时覆盖新增、删除、撤销、重建副图和会话迁移场景。

来源：`e8b76ad → f2e0750` 新增副图控制器时未完成存储隔离。不是本地冲突处理新增的问题。

## R2 · P1 · 月线、年线被按固定 30/360 天分桶

位置：`src/renderer/trading-expert-market.ts:2494`；相关实现为 `:1099`、`:2622`、`:4032` 和 `src/renderer/trading-market-candle-cache.mjs:249`。

新增 `1M`、`12M` 使用 30 天、360 天作为真实聚合周期；REST 聚合、实时价格归并和新鲜度检查沿用固定毫秒计算，没有按日历月、日历年处理边界。

复现结果：

- 已有 2026-08-01、2026-09-01 两根月线时，注入 2026-09-10 的报价，产生第三根 **2026-09-04** K 线；9 月 1 日原月线的 close 没有更新。
- 将 2026 年 12 根月线聚合为 `12M`，得到 **2025-03-13** 和 **2026-03-08** 两个桶，而不是一个 2026-01-01 年线桶。
- 2026-01-31 中午，1 月 1 日开盘的当前月线被新鲜度函数误判为过期。

建议：为月/年周期显式保留日历单位与数量，统一使用 UTC 月初/年初和下一个日历边界；固定时长只能用于估算，不能替代真实分桶、收盘和过期判定。

来源：`ae6637f → 1af98ce` 引入月/年周期，`e8b76ad → f2e0750` 共用分桶函数只补齐周线。完整补丁已导入，问题存在于远端实现。

## R3 · P1 · 月/年预警在服务端被静默变成分钟预警

位置：`src/renderer/trading-expert-market.ts:1160`；相关实现为 `src/main/trading-alerts/protocol.mjs:411`、`market-data-hub.mjs:13`、`binance-market-adapter.mjs:25`。

Renderer 新增转换函数输出 `1M` / `12M`，但预警协议、订阅 Hub、存储和 Binance adapter 仍把 interval 全部转成小写，且 adapter 只支持秒、分、时、日、周。这不是仅显示错误：规则实际使用错误周期的数据进行判断。

复现：将 Renderer 的周期输出送入真实 `normalizeAlertRule`、`normalizeMarketDataSubscription` 和 `planBinanceInterval`：

| 图表周期 | Renderer 输出 | 规则标准化后 | 实际行情计划 |
| --- | --- | --- | --- |
| 1 月 | `1M` | `1m` | 1 分钟，60,000 ms |
| 1 年 | `12M` | `12m` | 12 分钟，720,000 ms，以 3 分钟聚合 |

建议：端到端保留 `m`/`M` 的区别，补齐协议、缓存键、持久化、意图上下文、模拟和 adapter 的日历周期语义；尚未支持的周期应明确拒绝，不能回落成分钟。

来源：`ae6637f → 1af98ce` 新增 Renderer 周期协议后，没有同步扩展预警后端。这属于功能联动遗漏；远端增量本身也没有相应后端修改，不是 cherry-pick 漏掉文件。

## R4 · P2 · 主图绘图边界扩展到整个图表高度

位置：`src/renderer/trading-expert-drawing.ts:3875`；相关实现为 `:4587`、`:4772` 和 `src/renderer/trading-expert-market.ts:13104`。

`plotBounds()` 改成优先取必填的 `this.chartElement`，后面的 `chart.panes()[paneIndex]` 永远不会被使用。副图控制器的 chartElement 是独立绘图区，但主图仍传入包含副图与时间轴的完整 chartElement，导致主图绘图层高度与裁剪边界错误。

复现：完整图表高 600、主 K 线 pane 高 360 时，生产方法返回绘图高度 **600**；融合前方法返回 **360**。`redraw()` 将该高度直接写到 SVG，垂直线、时间区域和注释布局都使用此边界，主图图形可跨入副图区。绘图模式下该 SVG 又启用 pointer-events，存在拦截副图交互的风险；本轮验证了几何和事件配置，未做 Electron 鼠标交互验收。

建议：主图继续使用实际 pane 高度，副图使用其 plot wrapper；分别验证增加/删除副图和调整 pane 高度后的裁剪与命中区域。

来源：`e8b76ad → f2e0750` 改造副图绘图时改变了主图边界选择。

## R5 · P2 · 英文仓位回答被整段替换为通用完成提示

位置：`src/main/trading-analysis/price-action-pipeline.mjs:222`；相关实现为 `src/renderer/trading-expert-market.ts:10370`、`:2551` 和 `src/renderer/main.ts:31576`。

新的仓位管理 report 无论请求语言如何，都拼接“仓位管理”“直接回答”“盘面依据”等中文模板。Renderer 对无指定策略的仓位问题强制选 `analysisPlan.report`，而英文合并逻辑检测到任意汉字就丢弃整个 report。主界面最终持久化的是这个替代文本，不是仍有效的 narrative。

复现：以 `language: "en"`、`positionManagementRequested: true` 调用真实 price-action pipeline，模型边界返回合法的英文仓位回答。报告中保留了该答案，但通过真实合并函数后只剩：

> The market analysis is complete. Review the chart annotations and conditional levels for the detected structure.

建议：报告模板及账户校验文字按分析任务语言生成，避免因模板中的中文丢弃业务答案；增加 pipeline→Renderer 展示路径的英文仓位回归。

来源：`e8b76ad → f2e0750` 的中文仓位模板与 `5df0be4 → 6c9a643` 的英文整段过滤相互作用。两项远端功能均已合入，本地保留完整英文 Coordinator 报告的适配没有覆盖这条独立通用分析路径。

## 融合完整性结论

- 8 个远端提交均有导入提交与来源哈希；代码及语言文件的 `git range-diff` 未发现意外丢失的补丁。提交映射见 `windows-sync-20260909.zh-CN.md`。
- 52 个远端变更文件中，31 个最终 Git blob 与远端相同。其余 21 个差异对应原 Mac 适配、版本、文档、语言、安全修复和测试；版本与 runtime 的取舍有记录，不应当作为漏融合补回 Windows 值。
- Mac 应用仍为用户原有的 0.1.166，Codex 仍为已验证的 0.144.1 双架构运行时；Windows Codex 0.153.4 的代码、清单与 LFS 文件已纳入。未发现本轮覆盖此前六项安全修复的证据。
- 没有发现“漏掉一个远端提交/文件”的问题，但 R3 确认存在月/年周期到预警服务的功能链路缺口。R1/R2/R4/R5 也表明补丁完整不等于功能验收完整。

## 验证与边界

复现脚本：仓库根目录 `.git/windows-sync-review-20260910-repro.mjs`；结果 `.git/windows-sync-review-20260910-repro.json`。执行命令：`node .git/windows-sync-review-20260910-repro.mjs`。脚本直接调用生产函数/控制器方法，对未导出的 report 合并函数使用 TypeScript AST 提取执行；仅替换 localStorage、图表几何及模型边界，未连接真实账户或模型。脚本中的断言确认当前缺陷存在，不代表这些功能通过正确性验收。

上轮桌面全量基线为 2698 项（2694 通过、0 失败、4 跳过），网关 54/54，TypeScript、Vite、Mac runtime 检查通过；本轮无业务修改，没有重复全量执行。现有测试未覆盖多控制器持久化、日历周期端到端预警及英文仓位最终展示，因此全绿不能排除以上缺陷。

本轮未修改生产代码、推送、打包或部署；未执行 Windows 客户端和 Electron 真机交互回归。优先修复 R1–R3，再处理 R4–R5，并用期望正确行为的回归测试验收。


## 用户授权后的最小风险修复

用户要求“最小化风险修复这些问题”后，在现有工作区完成以下实现，应用版本和运行时保持原值。

| 问题 | 修复方式 | 关键回归 |
| --- | --- | --- |
| R1 | 同会话控制器共享手工画线数据；控制器销毁后释放会话引用。沿用原 localStorage 键和数据格式，排除所有窗格未确认的文本。迁移合并当前、已关闭副图和目标会话记录；副图不得覆盖主图 AI 存储。 | 交错保存、冷重载、撤销/重做、重建副图、局部/全局清空、会话隔离与迁移、待输入文本、存储失败保留备份 |
| R2 | 月/年周期仅选择原生 `1M` 数据源，按 UTC 日历月分桶；统一实际收盘时间，覆盖实时报价、主图/分屏、年线聚合、增量分页、历史完成状态、当前分析新鲜度、缺口检查、子周期截止和倒计时。固定 30 日周期继续使用日线源。 | 28/29/30/31 天月份、跨年、2 月/12 月周期、分屏报价、12 月进入当年年线、周线与固定周期不回退 |
| R3 | 预警输入在转小写之前明确拒绝月/年周期，覆盖协议、意图上下文、订阅、编辑、存储、模拟和 adapter。执行计划标题以 `MO` 区分月和既有分钟 `M`，保存后仍明确拒绝创建月/年预警。 | 月/年不再变为 1/12 分钟；既有分钟、小时、日、周和自定义分钟继续可用；保存计划不会覆盖日历周期标题 |
| R4 | 主图使用真实 pane 高度，指标副图使用自身 plot wrapper；恢复原主图裁剪与命中边界。 | 主图/副图尺寸分别正确，调整主图高度后更新，pane 暂不可用时安全回退 |
| R5 | 仓位报告、确定性兜底及账户校验提供英文分支，将语言传入模型提示。仓位回答保留用户问题和合法汉字交易对，不再因这些文字丢弃整份答案。 | 英文回答经过真实 pipeline 和 Renderer 合并后保留；覆盖未绑定/账户不可用/无对应仓位/已有仓位、模型缺少 answer、中文问题引用和副图报告 |

修复范围与边界：

- 月线、年线**图表**保留并修正；月线、年线**预警**本轮采用明确拒绝，不扩展整套预警调度。后续完整支持仍需单独实施与验收。
- 行情缓存从 v3 失效并重建为 v4，以免继续显示已经写入的错误月/年 K 线；用户画线存储格式和已有记录不变。
- 对旧版已丢失的画线、已被保存为小写分钟的错误预警，无法仅凭现有记录可靠还原原意；本轮没有猜测性地改写或删除用户数据。
- 保留 0.1.166 版本文件原有未提交内容，逐字节与原 stash 一致。未修改 `src/renderer/main.ts` 或 Mac runtime 配置，也未推送、打包、部署、调用真实模型/账户或主动重启客户端。

新增行为回归文件：`test/trading-drawing-session-regression.test.mjs`、`test/trading-calendar-regression.test.mjs`、`test/trading-position-language-regression.test.mjs`；另在已有执行计划测试中增加标题回归。修复前 `.git/*repro.mjs` 脚本断言的是缺陷，修复后应以这些期望正确行为的正式测试为准。

最终验收：新增 33 项行为回归；相关测试 258/258，桌面全量 2731 项中 2727 通过、0 失败、4 项按平台跳过，网关 54/54，TypeScript、Vite 184 modules 构建及 `git diff --check` 通过。更新了会话加载/分屏参数的旧源码形状断言、缓存版本断言及原新鲜度测试的生产函数依赖注入；保留原测试行为要求。日志为仓库根目录 `.git/windows-fixes-{related,desktop-tests,gateway-tests,typecheck,build}.log`。未进行 Windows 客户端或 Electron 实际鼠标交互验收；构建保留原有大 chunk 提示。

提交交付：用户随后授权提交最新代码到远端 dev。本次修复、正式行为回归、审查记录与原版本改动一并提交，目标为 `haolo_web3_mac` 的 `origin/dev`，与先前九个融合/兼容提交一起普通推送；远端同步以 `refs/heads/dev` 与本地 HEAD 的核验结果为准。
