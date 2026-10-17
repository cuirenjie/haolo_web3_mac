# 画线侧栏与工具补齐验收记录

## 绘图工具栏关闭按钮（2026-10-17）

- 所有绘图与文字选项栏右上角增加圆形“×”，直接复用图表操作栏关闭按钮的颜色、尺寸、悬停和键盘焦点样式。
- 点击仅隐藏选项栏并关闭其弹出菜单，保留图形、选中状态、文字和样式；行情重绘不会重新弹出，重新点击图形恢复。原垃圾桶继续用于删除图形。
- 工具栏定位和拖动为外侧关闭按钮预留 12 CSS px，避免靠近图表上／右边缘时被裁切。增加完整英文提示。
- 离屏 Electron 验证：浅／深主题真实鼠标关闭及重新选中；全部 98 个可绘制工具隐藏／恢复且图形数据不变；29 个默认样式入口及保存重载继续通过。英文界面 16 个菜单／主题、104 项工具、19 种绘制状态通过；类型检查和开发资源构建通过。
- 复跑脚本仍为 `scripts/trading-drawing-style-qa.cjs`，证据在 `.cache/drawing-style-audit-20261017/`，本轮构建及英文日志以 `toolbar-close-` 开头。未重启用户客户端或发布安装包。

## 第四轮默认绘图样式（2026-10-17）

根据用户提供的趋势线对比截图，以及 TradingView 官方 [Trendline](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.TrendlineLineToolOverrides/)、[Brush](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.BrushLineToolOverrides/)、[Highlighter](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.HighlighterLineToolOverrides/)、[Rectangle](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.RectangleLineToolOverrides/) 等工具默认值核对。

- 新建集中默认样式表 `trading-drawing-defaults.ts`。趋势线及基础直线默认改为 `#2962FF`、2 CSS px、实线；浅色和深色主题使用相同绘图色。用户显式选择的颜色、线宽和线型继续优先，并可保存、恢复和重置。
- 按工具设置默认颜色、粗细和透明度，例如画笔为青色 2 px，荧光笔为红色 20 px／20% 不透明度，矩形为紫色 2 px／20% 填充；同时调整通道、分叉线、斐波那契层级、圆／椭圆／三角形、波浪、范围和 VWAP 等已有渲染入口的默认样式。保留 Haolo 特有工具和原有工具 ID。
- 选择端点统一为空心蓝色细边，移除原阴影；选中后的价格／时间轴标签改为蓝底白字。浮动工具栏显示当前颜色和明确线宽，例如 `2px`，调色板能选中各工具默认色。
- 线宽存储支持荧光笔超过 4 px 的设置。自定义颜色继续覆盖斐波那契多色层级；重置恢复对应工具默认值。AI 语义颜色和原有默认回退仍保留。

验证：

- 独立离屏 Electron 真实鼠标创建趋势线，浅／深主题均验证实际 SVG 色值、2 px 线宽、实线、端点、轴标签和工具栏。
- 另外 29 个工具渲染入口检查默认颜色和线宽；验证自定义颜色／4 px／虚线保存重载、重置、后续同类工具样式记忆、荧光笔 30 px 保存重载和斐波那契颜色覆盖。
- 英文界面回归通过：16 个菜单／主题组合、104 项工具、19 种绘制状态、编辑器和用户文字保护。
- Node 回归 **79 项，78 通过，1 项已有失败**：仍为此前记录的分屏 AI 源码正则断言。本轮未改动对应 AI 实现。TypeScript 类型检查和 Vite 构建通过，仅保留已有大分块提示。
- 脚本：`scripts/trading-drawing-style-qa.cjs`。截图、`report.json`、官方默认值核对数据及测试／构建日志位于 `.cache/drawing-style-audit-20261017/`。脚本使用合成行情和独立用户目录。

本轮完成源码及开发资源构建，未重启当前 Haolo 窗口，未打包发布或提交 Git。本轮验收针对默认绘图样式；整个交易界面的逐像素一致性及原有工具几何算法差异，仍以此前记录为准。

## 第三轮英文术语与界面检查（2026-10-17）

按用户提供的 TradingView 英文趋势菜单截图，以及官方 [Drawings List](https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/Drawings-List/) 和[绘图工具清单](https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/)核对。

- 全部 104 项工具／光标模式使用完整专业术语。截图中的错误修正为 `Trendline`、`Info line`、`Extended line`、`Trend angle`、`Crossline`、`Parallel channel`、`Regression trend`、`Flat top/bottom`、`Disjoint channel`、`Pitchfork`、`Schiff pitchfork`、`Modified Schiff pitchfork`、`Inside pitchfork`。
- 新建绘图专用词表 `app-language-en-drawing.mjs`，按完整术语和完整动态模板翻译，避免通用翻译拆词造成的“min叉线”“不相Hand it over.通道”等问题。局部作用域避免影响其他模块的同名词，例如置顶操作与 Pin 绘图工具。
- 区分分组标题与具体工具名，例如 `PITCHFORKS` / `Pitchfork`、`BRUSHES` / `Brush`、`MEASUREMENT` / `Measure`。同步覆盖收藏、快捷键帮助、状态栏、逐点绘制／撤销、编辑框、颜色／线宽、会话和分屏清空确认，以及图形内的目标、止损、时长、默认表格和空成交量提示。
- 修正工具提示的语言源文保留，支持英文、简中、繁中之间实时切换。收藏／取消收藏、锁定／解锁全部绘图、隐藏／显示全部绘图的提示随状态更新。
- 英文菜单单独设置宽度，给长名称、快捷键和收藏星标留足空间。没有删减工具或改动原有绘图算法。用户输入的文字、笔记和表格不进入界面自动翻译。

验证：

- 独立 Electron 渲染验收通过：8 个菜单 × 2 种主题；扫描包括隐藏菜单在内的全部绘图 UI 文本、title、aria-label、placeholder，未发现中文残留；检查每行名称不与快捷键或收藏按钮重叠。
- 104 项工具选择、19 个真实鼠标触发的端点状态、动态收藏／锁定／隐藏提示、图形系统标签、文字编辑、会话／副图清空确认、小窗口菜单通过。语言切换 `en → zh-CN → en → zh-TW → en` 后，英文提示正确，用户输入中文保持原样。
- 语言及扩展工具测试 **41/41 通过**。扩大到原绘图工具回归共 **91 项、90 通过、1 项已有失败**；仍是前两轮记录的分屏 AI 源码正则断言，本轮未修改该实现。
- TypeScript 类型检查通过，Vite 开发资源构建通过，仅保留已有大分块提示；`git diff --check` 通过。
- 复跑脚本：`scripts/trading-drawing-language-qa.cjs`，沿用 5183 端口和合成行情测试页，不访问真实账户／绘图同步。界面截图和 `report.json` 位于 `.cache/drawing-language-audit-20261017/`；测试、类型检查及构建日志位于 `.cache/drawing-icon-audit-20261017/language-*.log`。

本轮完成源码及开发资源构建，未重启用户当前 Haolo 窗口，未打包发布或提交 Git。全界面逐像素一致性及原工具算法差异仍遵循下方前两轮所记范围，不因英文验收而视为已完成。

## 第二轮全图标检查（2026-10-17）

根据用户圈出的画笔／文字图标，再次实际打开 TradingView Desktop 3.4.1，逐项查看光标、趋势、江恩／斐波那契、形态、预测／测量、几何和注释菜单，并核对官方[绘图工具清单](https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/)。以下为当前结果，下方“第一轮记录”保留此前验收历史。

- 当前 **104 项工具／模式，98 项可绘制**。原有 77 项的 ID、类型和自由绘制行为继续由基线快照保护。
- 将所有工具及工具栏按钮归入一套显式 SVG 图标。取消旧图标兜底，补齐空心锚点；分别绘制 5 种艾略特波浪、江恩扇与速度阻力扇、两种成交量分布、三种范围测量、三角形与三角形态、文字与笔记等图标。
- 按本轮截图要求，主分组入口保持固定，画笔、T 不再被最近选择的矩形、标注替换。具体选择仍由菜单和绘图状态表达。此项是为避免用户指出的入口漂移而作出的交互选择，不声称 TradingView 在所有用户设置下都固定分组图标。
- 未锁定显示开锁、已锁定显示闭锁；继续绘图按钮和隐藏绘图按钮补齐相应状态图标。绘图完成返回用户选择的光标，默认十字线不再自动变成箭头。
- 统一工具栏／菜单的浅色和深色背景、分隔线、空心锚点填充和悬停配色。保留现有 52 CSS px 侧栏、38 px 间距、24 px 图标、40 px 菜单行高。
- 根据 [Path](https://www.tradingview.com/support/solutions/43000791739-path-drawing-tool/) 和 [Polyline](https://www.tradingview.com/support/solutions/43000516986-polyline-drawing-tool/) 补充真正逐点绘制的“路径”和“折线”。连续点击加点，双击／右键／Enter／Esc 完成并排除未确认的预览端点；折线点回起点闭合，其他完成方式保持开放。路径带末端箭头，折线不带箭头。可编辑全部端点，闭合形状支持内部拖动，闭合锚点在拖动和保存后保持关联。
- 原自由路径、预设折线、向左／向右箭头、锚定文本／笔记保留在相应分组“更多”。增加官方清单中的魔法光标，使用会自动消失的星光轨迹，不生成持久绘图，并尊重减少动态效果设置。
- 修复图表双击最大化抢占多点工具完成事件的问题。

验证：

- 104 个工具图标生成并检查；8 个菜单 × 浅／深主题通过；98 个绘图工具的实际鼠标创建、有限几何、撤销／重做通过。
- 新增开放／闭合折线、Esc／Enter／右键完成、端点／图形内部拖动、14 个端点、存储重载、魔法轨迹清理通过。原收藏、长菜单滚动、分屏共享状态、本机图片重载检查继续通过。
- 类型检查通过；Vite 构建通过，仅有已有的大分块提示。
- 绘图、导航、窗格裁切、同步相关 Node 回归：**121 项，120 通过、1 项已有失败**。仍为下文第一轮已记录的分屏 AI 源码正则断言；本轮未改动分屏 AI 源码。
- 脚本：`scripts/trading-drawing-reference-qa.cjs`；证据：`.cache/drawing-icon-audit-20261017/` 下的菜单截图、`all-tool-icons.png`、`closed-polyline.png`、`report.json`、`interactions-report.json`、`tests.log`、构建日志。

边界：这是绘图工具栏、图标和上述新增工具的对照验收，未完成整个交易界面的逐像素一致性验收。原有部分绘图算法、行情与社区内容集成仍有第一轮记录中的差异。用户按 Esc 停止桌面控制后未继续操作真实 Haolo 窗口，当前窗口未重启到本轮源码；未打包、发布或提交 Git。

## 第一轮记录

日期：2026-10-17。工作目录与 Git 根目录均为 `C:\Users\潘艳芳\Documents\ChatGPT\haolo_windows_web3`。

## 范围与保留约束

按用户提供的四张截图，并实际打开 TradingView Windows 客户端，查看了光标、线、通道、分叉线、斐波那契、江恩、形态、波浪、循环、预测、成交量、测量、几何图形、文本和图标菜单。

原有 **77 项工具全部保留**，工具 ID、绘图类型和自由绘制行为有基线快照测试保护。没有替换原有绘图算法。旧工具的中文显示名称与图标按参考菜单调整，旧图形仍按原 ID 加载。

当前目录 **101 项工具／模式**，其中 96 项可绘制，另有光标、圆点、十字光标、荧光光标、橡皮擦。Haolo 的价格投影、测量放在“预测和测量工具 → 更多”；缩小、撤销、重做保留在“视图与历史”，键盘撤销／重做也保留。

## 界面

- 52 CSS px 侧栏，38 px 工具间距，24 px 单色细线 SVG 图标。
- 8 个主分组；线、通道、分叉线合并，画笔、箭头、几何图形合并。
- 展开菜单按小标题分区，40 px 行高，14 px 正文，快捷键、悬停帮助和收藏星标。
- 菜单使用视口定位，避免被图表容器裁切；超高菜单滚动，浅色／深色主题均验证。
- 收藏可跨重启恢复；方向键、Home、End、Escape 支持菜单操作。
- 图标选择器包含表情、贴纸、图标三类。使用系统字形和本地 SVG，并非复制 TradingView 的资源文件。

## 新增 24 项

圆点、荧光笔光标、斐波那契趋势时间、斐波那契速度阻力弧、固定江恩正方、艾略特双重组合浪、艾略特三重组合浪、时间循环、正弦线、锚定 VWAP、锚定成交量分布图、扇形、锚定笔记、置顶、表格、价格标签、图片、帖子、观点、向左箭头、向右箭头、表情符号、贴纸、图标。

新增工具接入现有端点、选择、拖动、撤销／重做、存储与分屏工具状态。趋势时间使用三个锚点；组合浪逐点绘制并显示 W/X/Y/X/Z 标签；VWAP 使用选定时间起的 HLC3 × 成交量累计。

成交量分布使用实际 OHLCV，将每根 K 线成交量按价格区间重叠比例分配，保持总量守恒；它不是逐笔成交价格数据。零成交量有明确空数据提示。

图片可从本机选择 PNG/JPEG/WebP/GIF，缩放至最长边不超过 1024 后存储，也可通过文本编辑器填写图片 URL。本机图片内容保留在当前设备，绘图同步仅传引用和锚点；其他设备不会自动获得图片文件。帖子、观点为本地文字／链接标注，没有接入 TradingView 社区帐号或远端帖子抓取。表情、贴纸为当前客户端的本地选择集。

新增几何参考：[趋势斐波那契时间](https://www.tradingview.com/support/solutions/43000518136-trend-based-fib-time-drawing-tool/)、[速度阻力弧](https://www.tradingview.com/support/solutions/43000518157-fib-speed-resistance-arcs-drawing-tool/)、[固定江恩正方](https://www.tradingview.com/support/solutions/43000791675-gann-square-fixed-drawing-tool/)、[锚定 VWAP](https://www.tradingview.com/support/solutions/43000669764-anchored-vwap-drawing-tool/)。

## 验证

- TypeScript 类型检查通过；Vite 构建通过（已有大分块提示，不阻止构建）。
- 自动化桌面渲染：16 个分组／主题组合，96 个绘制工具的实际点击／拖动创建、有限坐标、撤销和重做通过。
- 长菜单末项命中检查、小窗口滚动、收藏持久化、锚定笔记恢复、新工具第三端点拖动、分屏符号状态、本机图片保存与重新加载通过。
- Node 测试 70 项：69 通过，1 项历史断言失败。失败项为 `every visible split pane runs the requested analysis and plays its own drawing patch`，期望源码出现 `playAiDrawingPatch(patch, options)`；同一正则对改动前 Git HEAD 源码也不匹配。本次未改动被测的分屏 AI 实现。
- 原工具清单快照：`test/fixtures/haolo-drawing-tools-before-reference.json`，记录来源提交和 77 项工具。

可复跑脚本：`scripts/trading-drawing-reference-qa.cjs`。先从仓库根目录启动 Vite（`--config youle_desktop/vite.config.mjs --port 5183`），然后用仓库 Electron 执行脚本。脚本使用独立离屏窗口、测试用户目录和合成行情，不修改实际会话数据。

验收截图与日志位于 `.cache/drawing-reference-qa/`：`light-trend.png`、`light-gann-fib.png`、`dark-*.png`、`drawing-*.png`、`report.json`、`interactions-report.json`、`tests-final.log`、`build-final.log`。

用户按 Esc 停止了桌面控制，此后未操作或重启实际 Haolo 窗口。代码和开发构建已完成，未打包、发布或 Git 提交。
