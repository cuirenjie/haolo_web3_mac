# 五种艾略特手工画线复刻

任务：M1-380。目标仓库：`C:\Users\潘艳芳\Documents\ChatGPT\haolo_windows_web3`。

## 参考与原理

以用户 2026-10-19 提供的八张 TradingView 截图为视觉与分步交互依据；工具分类参照 [TradingView Elliott wave theory and tools](https://www.tradingview.com/support/solutions/43000653212-elliott-wave-theory-and-tools/)，蓝色与 2px 默认宽度核对 [ElliottimpulseLineToolOverrides](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.ElliottimpulseLineToolOverrides/)。

这些是用户手工选择时间／价格锚点的波浪标注工具。连接相邻锚点形成折线，不自动寻找拐点，不验证或强制修正浪型的理论有效性；名称也不会改变用户画出的实际形状。波浪理论识别与 AI 分析链路继续独立。

| 工具 | 点击数 | 波段数 | 编辑时编号 | 默认颜色 |
|---|---:|---:|---|---|
| 脉冲波 | 6 | 5 | (0) (1) (2) (3) (4) (5) | `#3d85c6` |
| 修正浪 | 4 | 3 | (0) (A) (B) (C) | `#3d85c6` |
| 三角波 | 6 | 5 | (0) (A) (B) (C) (D) (E) | `#ff9800` |
| 双重组合浪 | 4 | 3 | (0) (W) (X) (Y) | `#6aa84f` |
| 三重组合浪 | 6 | 5 | (0) (W) (X) (Y) (X) (Z) | `#6aa84f` |

## 样式和交互

- 2 CSS px 实线折线，20 CSS px 常规字重括号编号；文字居中并置于高低拐点外侧。保持用户已有自定义颜色、字号、线宽和线型。
- 无面积填充、无额外三角边界、无永久实心圆点。三角波同样是五段开放折线。
- 第一点击确认起点；移动鼠标仅预览下一段，不提前显示未确认点编号或手柄。每次点击确认一个端点，达到 4／6 点后完成。
- 编辑时显示半径 6px 的蓝色空心锚点，圆心填充随明暗主题适配；右侧价格轴和底部时间轴显示已确认点的蓝色标记及范围背景。预览范围可随鼠标扩展。
- 完成后默认选中，工具栏与锚点不会因空闲计时自动消失。点击画布空白处取消选中，隐藏手柄、起点 (0)、轴标记和范围背景；保留其余编号和折线。再次点线或文字即可选中。
- 每个端点独立拖动；线段与编号均可拖动整组。在普通／对数价格坐标下保持屏幕几何，所有点仍存真实时间和价格。
- 时间落点按 K 线柱对齐，价格磁吸沿用开关；支持最后一根 K 线之后的未来时间，不夹回最新蜡烛。
- 右键逐点撤回草稿；Esc 取消；完成后返回原光标，开启连续绘图则继续使用工具。锁定、删除、撤销／重做、持久化沿用所属画布控制器。
- 坐标面板显示带序号的编号，三重组合浪的 `#2 (X)` 与 `#4 (X)` 是独立端点。修改坐标不会把默认的文字随线颜色锁死；取消设置不保存。

## 实现与验收

独立模块：`src/renderer/trading-elliott-wave.ts`。主控制器只接入该模块、锚点、轴标记、选择状态和原有坐标变换；设置复用现有模态框。

自动化入口：

```powershell
node --test youle_desktop/test/trading-elliott-wave.test.mjs
$env:HAOLO_QA_PORT='5207'
& youle_desktop/node_modules/.bin/electron.cmd youle_desktop/scripts/trading-elliott-wave-qa.cjs --tool=elliott-impulse
```

Electron 使用独立测试用户目录、固定行情夹具和隐藏窗口，原生鼠标／键盘事件覆盖亮暗主题逐点预览、每个端点、线／编号拖动、空白取消选择、设置、存储重载、缩放、对数拖动、右键、Esc、锁定、撤销／重做和连续绘图。三重组合浪额外覆盖未来落点、价格磁吸及设置取消。

每种工具的报告与截图目录：`.cache/elliott-wave-qa/<tool>/`，包含 `report.json`、`preview-*.png`、`light-selected.png`、`light-deselected.png`、`dark-selected.png`、`dark-deselected.png`、`restored-log-scale.png` 和 `falling-wave.png`。

验收状态：2026-10-19 源码与本地验收完成。五种工具分别完成全部 Electron 交互检查，亮／暗主题截图逐一人工核对；单元及相关绘图回归 89／89 通过，TypeScript 检查与开发构建通过（222 个模块）。

| 工具 | 亮／暗主题与完整交互 | 独立端点 | 报告目录 |
| --- | --- | --- | --- |
| 脉冲波 | PASS | 6／6 | `.cache/elliott-wave-qa/elliott-impulse/` |
| 修正浪 | PASS | 4／4 | `.cache/elliott-wave-qa/elliott-correction/` |
| 三角波 | PASS | 6／6 | `.cache/elliott-wave-qa/elliott-triangle/` |
| 双重组合浪 | PASS | 4／4 | `.cache/elliott-wave-qa/elliott-double-combo/` |
| 三重组合浪 | PASS，另含未来落点、价格磁吸和设置取消 | 6／6 | `.cache/elliott-wave-qa/elliott-triple-combo/` |

完整 Node 回归结果保存在 `.cache/elliott-wave-qa/node-tests.log`。共享画线文件更新后，五种 Electron 交互、89 项 Node 回归、类型检查和构建再次全部通过。验收使用本地固定行情与隔离 Electron 用户目录；本轮交付为客户端源码和开发构建，未生成或发布安装包。
