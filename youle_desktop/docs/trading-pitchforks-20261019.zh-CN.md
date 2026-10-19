# 分叉线四种类型：计算和交互验收

日期：2026-10-19。工作目录及 Git 根目录：`C:\Users\潘艳芳\Documents\ChatGPT\haolo_windows_web3`。

## 范围与依据

本次修正普通分叉线、希夫干草叉、改良希夫干草叉、内部分叉线。依据用户提供的各工具绘制中、完成后截图，交叉核对 TradingView 官方说明：

- [Auto Pitchfork：四种斜率公式](https://www.tradingview.com/support/solutions/43000657911-auto-pitchfork/)
- [普通分叉线](https://www.tradingview.com/support/solutions/43000518141-pitchfork-drawing-tool/)
- [希夫干草叉](https://www.tradingview.com/support/solutions/43000518140-schiff-pitchfork-drawing-tool/)
- [改良希夫干草叉](https://www.tradingview.com/support/solutions/43000791609-modified-schiff-pitchfork-drawing-tool/)
- [内部分叉线](https://www.tradingview.com/support/solutions/43000518146-inside-pitchfork-drawing-tool/)
- [默认样式参数](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.PitchforkLineToolOverrides/)

注意：部分较旧的帮助页面把 Schiff 和 Modified Schiff 的起点文字描述写成相同。这里采用四类型公式页，并以用户截图中的实际起点位置核对；不能照抄这处矛盾描述。分层来自三点几何比例，不采用回归趋势的 K 线残差标准差。

## 三点几何

按点击顺序命名 A、B、C。令 N 为 AB 中点，M 为 BC 中点。在图表投影坐标中计算，每次缩放或切换价格刻度重新投影，存储的仍是三个时间、价格锚点。

| 工具 | 方向 | 红色中线与辅助线 |
| --- | --- | --- |
| 普通分叉线 | A → M | 中线从 A 出发，穿过 M；BC 为叉口 |
| 希夫干草叉 | S → M；S 的时间与 A 相同，高度为 A、B 的平均高度 | 保留 AB；中线从 S 出发；BC 为叉口 |
| 改良希夫干草叉 | N → M | 保留 AB；中线从 N 出发；BC 为叉口 |
| 内部分叉线 | N → C | 保留 AB 和 N→C 辅助线；中线从 M 出发，平行于 N→C；BC 为叉口 |

所有类型的外侧蓝线分别经过 B、C；内侧绿线经过 MB、MC 的中点，比例为 ±0.5，外侧为 ±1。红线 `#f23645`、蓝线 `#2962ff`、绿线 `#089981`，默认 2px 实线。三块互不重叠的填充分别是蓝、绿、蓝，不透明度 20%。线条和填充沿方向向前延伸到主图边界；不进入成交量副图或坐标轴。

内部类型不能套用改良希夫公式：它的辅助线终点是 C，中线方向也取 N→C，而不是 N→M。测试用用户截图的像素锚点作为独立预期，检查这一区别。

## 操作

1. 第一次点击固定 A，鼠标移动预览第一段。希夫、内部初始为红线段；改良希夫按参考图预览延伸红线。
2. 第二次点击固定 B，保持绘制状态。此时 C 暂时与 B 重合，红色构造线后接蓝色延伸线，不提前生成固定宽度通道。
3. 移动鼠标放置 C，叉口、方向和填充实时变化；第三次点击完成。
4. 草稿仅给已确认点显示蓝色控制圆与轴标签；完成后显示三个真实控制点。
5. 三个控制点独立拖动，其他两点不动；点击线条或填充区域可整体移动。坐标设置可以编辑全部三个点。
6. 右键撤销上一已确认点；Esc 取消草稿。第一段也支持按住拖动、松开确认 B，然后点击 C。
7. 擦除工具可命中延伸线，不能只检测原始两点之间的线段。

## 兼容和边界

新图形直接保存三点，不增加存储或同步字段。旧版仅保存两点，无法恢复用户未指定的第三个转折点，因此保留旧记录原样；重新绘制后使用新三点逻辑，不自动篡改旧锚点。通用颜色、线宽、线型和三点坐标设置继续可用；仅编辑坐标或线宽不会把默认蓝绿分层变成全红。

本次实现截图中的默认分层，不新增 TradingView 的九组自定义比例、逐层样式和反向延伸设置面板。未打包或发布安装程序。

## 验证

- `test/trading-pitchfork.test.mjs`：四张完成图对应的起点、斜率、辅助线；三次落点与回退；三轴标签；分层、着色；反向、竖向、视口外裁剪；退化点和无效 SVG 防护。
- 与通用绘图、平行通道、形状通道、回归趋势测试合计 **85 项通过**。
- `scripts/trading-pitchfork-qa.cjs`：真实 Electron 鼠标事件，四种工具 × 明暗主题；三阶段预览、独立拖动三个端点、整体移动、第三点坐标编辑、刷新恢复、缩放、通过客户端切换对数刻度、延伸线擦除、右键回退、Esc 取消、拖动第一段，全部通过。
- Electron 报告及截图：`.cache/pitchfork-qa/report.json`、`.cache/pitchfork-qa/*-complete.png`。
- Vite 前端构建通过；新分叉线模块独立 TypeScript 检查通过；修改文件的 `git diff --check` 通过。
- 仓库全量类型检查当前未通过：同时变化的 `src/renderer/trading-fibonacci.ts` 第 51、76 行引用了尚未在 `TradingDrawingModel` 上声明的 `fibonacci` 字段（TS2344、TS2345）。本次没有修改该模块或覆盖其他工作；分叉线模块没有类型诊断。

核心实现：`src/renderer/trading-pitchfork.ts`；控制器接入：`src/renderer/trading-expert-drawing.ts`。
