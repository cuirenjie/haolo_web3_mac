# M1-316：TradingView K 线交互审查

日期：2026-09-19。范围：M1-314/M1-315 的画布导航、主图/分屏接入、绘图事件、设置迁移及明暗主题；不包含其他并行任务的网关、更新器和安装包改动。本轮仅审查与复现，没有修改产品代码。

后续状态：用户已授权 M1-317 修复。以下为原始审查记录，修复实现及验收在文末追加。

## 已确认问题

### P1：窄幅行情的对数换算会改变价格数量级并使 K 线消失

位置：`src/renderer/trading-chart-navigation.ts:55-57`，影响 `scaleRange()` 和 `applySelection()`。

`tradingLogCoordinateOffset()` 用 `(x*z-y*y)/(2*y-x-z)` 推算底层对数偏移量。价格相对波幅较小时，两次浮点相减丢失有效位，返回错误偏移或回退到 4；但 lightweight-charts 5.1.0 的真实偏移会随自动适配时的价差变化。把错误的对数范围传入 `setVisibleRange()` 后，价格坐标整体偏移。

实际 Electron 图表使用 500 根窄幅模拟 K 线：中心价 100000、正弦振幅 0.1（约 99999.87–100000.13），切换对数后在价格轴滚轮一次，范围变成约 9999.99–10000.01。真实内部偏移为 5，计算得到 4，100000 的像素坐标从约 264.74 变为 -485765908，画布不再显示 K 线。中心价 1、振幅 0.0001 的样本也出现错误（真实偏移 8，推算 6）；幅度较大的对照样本未触发。

建议：替换病态数值推算，建立经过往返校验的转换方式，异常时不能写入错误范围；补充真实图表中价差很小而价格非零的对数滚轮和框选用例。现有用例覆盖价格量级，却没有覆盖价格与波幅相差很大的情形。

### P2：分屏的 L、Alt+L、Alt+P 和菜单模式切换没有实际生效

位置：`src/renderer/trading-expert-split-pane.ts:1005-1007`，相关比较在 `updateSettings():1536`。

回调先更新 `this.settings.priceScaleMode`，再把同一设置传给 `updateSettings()`；因此 `scaleModeChanged` 总为 false，`rightPriceScale.mode` 被跳过。亮暗主题均复现：Alt+L 后设置为 `logarithmic`、Alt+P 后设置为 `percentage`，实际图表 mode 始终为 0，L 按钮也不能改变这一状态。主图的实现没有这项先赋值再比较的问题。

建议：将新设置作为参数传入，由 `updateSettings()` 在比较旧值后统一提交，或比较实际价格轴 mode；用真实分屏检查设置、图表和按钮状态一致。

### P2：测量结果在时间轴缩放后与当前 K 线不再对应

位置：`src/renderer/trading-chart-navigation.ts:237-238`，相关提前返回在 `pointerDown():156-162`。

测量结束后仅保存 DOM，选区的逻辑/价格锚点被清空。随后拖动时间轴会直接交给原生图表处理，不清除或重定位测量结果。亮暗主题均复现：Shift 拖出标签为“41 根 K 线”的测量，时间轴横拖 120px 后矩形覆盖 48 根 K 线，而矩形位置、41 根标签和成交量均保持旧值。

建议：保留时间与价格锚点，在视口变化时同步重绘；若只提供临时测量，至少在轴操作及其他视口变化时清除结果。应一并覆盖导航按钮、键盘缩放和窗口尺寸改变。

## 验证与边界

- `node --experimental-strip-types --test test/trading-chart-navigation.test.mjs test/trading-expert-chart-settings.test.mjs`：43 项中 42 通过。导航 18/18；唯一失败为此前已在 HEAD 复现的收藏栏源码断言，不属于本轮新增问题。
- 隐藏 Electron 39 窗口、真实 lightweight-charts 5.1.0、原生鼠标/键盘输入、隔离模拟行情；分屏与测量问题均在明暗主题复现，窄幅对数专项另检查 9 组价格/振幅组合并查看空图截图。
- 新控件 CSS 使用主题语义变量，已有主题状态回归通过；没有发现本轮新增的硬编码浅色控件问题。
- 本地复现脚本 `.cache/tradingview-review.cjs`，数据 `.cache/tradingview-review/report.json`，日志 `.cache/tradingview-review.log`；截图 `dark-log-empty.png`、`light-stale-measurement.png`、`dark-stale-measurement.png` 位于同一报告目录。
- 当前测试通过不能证明完全对齐 TradingView；以上三个问题应先修复，并将相应真实集成场景纳入持久回归。未运行生产账户或长时间行情验收，未打包、提交、推送、部署。

## M1-317 修复实现（2026-09-19）

- **对数范围**：删除 `tradingLogCoordinateOffset()` 及内部坐标推算。滚轮直接在当前轴像素位置采样目标原始价格，框选使用两端原始价格。`setTradingLogPriceRange()` 暂时提供明确原始价格区间，借助公开 `autoscaleInfoProvider` 和原生自动适配完成转换，同步读取以触发惰性计算，再冻结范围。`finally` 恢复所有序列的原 provider；原来没有 provider 的序列恢复为调用默认计算的函数，因为库的 `applyOptions()` 会忽略 undefined。输入范围有限且有序才允许提交，失败恢复原 Auto 状态。
- **分屏模式**：局部切换先把新设置传入统一 `applySettings()`，由实际坐标轴 mode 判断是否切换，不再先覆盖旧状态而跳过应用。另记录上次共享模式，主题或其他样式变化保留局部选择；共享模式真正改变时正常同步。补齐 L 按钮、Alt+L/P、右键菜单的双向切换和按钮状态验收。
- **临时测量**：测量是当前视口的临时结果。时间/价格轴、导航按钮、键盘平移缩放、时间范围变化、画布尺寸及源序列数据变化会清除测量；绘制调度还检查窗格几何与价格映射。时间轴、ResizeObserver 和数据订阅在取消或销毁时释放，避免悬挂监听。未改动持久测量图形和撤销栈。
- **主题**：延续语义色，不新增硬编码 UI 颜色。主图/分屏在明暗主题下检查测量、坐标状态、轴缩放及主题切换保持。

持久回归：`test/trading-chart-navigation.test.mjs`（20 项）与 `scripts/trading-chart-navigation-regression-qa.cjs`。集成脚本使用独立测试 profile，并清空其存储、暂停模拟行情后台轮询；数据刷新由用例明确触发，避免样本被默认模拟报价覆盖。报告输出 `.cache/tradingview-regression/report.json`，原有交互验收继续使用 `scripts/trading-chart-navigation-visual-qa.cjs`。

最终验收：

- 导航单测 20/20；扩大到图表、设置、绘图、布局、指标和历史恢复的 197 项回归，192 通过，5 项为 M1-315 已在 HEAD 复现的既有源码断言（收藏栏、分屏分析调用、提及 token、旧加号菜单、VPVR reload 签名），未出现新增失败。
- 新增 Electron 原生输入集成 100 组全部通过：明暗主题 × 主图/分屏的 36 组窄幅价格转换、32 组测量失效清理，24 次分屏模式/主题同步状态检查，以及 8 组负值/跨零/反转指标轴检查。连续滚轮、框选、行情刷新、主题切换及恢复 Auto 均验证，未出现意外 Renderer 错误。
- 原有 Electron 交互验收通过，三种坐标模式 × 两种价格量级 × 两种主题的 12 组框选继续通过；两条模拟币种目录为空的日志仍为夹具预期条件。
- 类型检查、193 modules 生产构建、脚本语法和差异检查通过；构建只保留原有大 chunk 提示。日志：`.cache/tradingview-fix-typecheck.log`、`.cache/tradingview-fix-build.log`、`.cache/tradingview-fix-unit.log`、`.cache/tradingview-fix-regression-qa.log`、`.cache/tradingview-fix-visual.log`。
- 三项审查问题已完成本地源码修复，分屏局部坐标被主题覆盖的关联问题一并修复。未更改发行版本，未打包安装程序、安装、提交、推送或部署。
