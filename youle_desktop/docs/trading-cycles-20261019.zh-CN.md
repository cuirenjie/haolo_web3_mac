# 循环线、时间循环、正弦线对照实现（2026-10-19）

工作目录与 Git 根目录：`C:\Users\潘艳芳\Documents\ChatGPT\haolo_windows_web3`。
范围：交易专家手动画线的三个循环工具，保留原工具 ID、同步和图层归属。

## 参考与绘图规则

以用户提供的六张 TradingView 截图为视觉验收依据。循环线的向未来等距重复规则参考 [官方说明](https://www.tradingview.com/support/solutions/43000518161-cyclic-lines-drawing-tool/)；时间循环和正弦线的默认样式核对 [Timecycles 覆盖属性](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.TimecyclesLineToolOverrides/) 和 [Sineline 覆盖属性](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.SinelineLineToolOverrides/)。当前官网另有使用竖线描述时间循环的帮助文案，本次按用户截图采用连续半圆。

| 工具 | 两点含义 | 显示规则 |
| --- | --- | --- |
| 循环线 | 两点时间差决定间隔；各自保留价格 | 从较早锚点向右等距重复贯穿当前绘图窗格的竖线；默认截图采样浅蓝 `#80ccdb`、2px。仅预览/选中时显示两锚点间灰色虚线。没有斐波那契序列或数字标签。 |
| 时间循环 | 两点横向距离为直径，共用第一点基线 | 左右无限重复上半圆，半径为直径的一半；绿色 `#159980`、2px，填充 `#6aa84f80`。填充闭合但不描基线。 |
| 正弦线 | 两点分别是相邻极值，横向距离为半周期 | `y(x)=(y1+y2)/2+(y1-y2)/2*cos(π*(x-x1)/abs(x2-x1))`，左右重复；绿色 `#159980`、2px，无填充或锚点连接线。 |

坐标保存为市场时间/价格，渲染时重投影；周期对应图表柱间距。两次点击完成，第一点后实时预览；循环线预览显示两个圆点，时间循环/正弦线只显示已确认圆点。选中后显示两圆点及轴标签，时间循环只显示一个基线价格标签。

时间循环创建第二点时忽略鼠标纵向偏移；编辑任意端点时两点共享新的基线价格，另一端时间不变。旧数据中不参与绘制的第二价格统一投影至第一价格。循环线与正弦线两端独立编辑。零时间间隔不能完成创建或从坐标设置保存。

所有重复部分均可选中、整体拖动及擦除。整体拖动保持屏幕形状，兼容对数价格轴；拖动后仍保存时间/价格坐标。选中圆点不会因闲置计时器消失，工具栏初始位于图表上方并可独立拖动。线色、线宽、线型，以及时间循环的填充颜色/透明度沿用持久化与同步字段。

只枚举当前可见周期，不从远处的历史锚点循环计算；极密集的亚像素周期有数量上限并保持相位。正弦线按相位和像素距离采样，额外包含精确极值点。

## 验收证据

- `node --test`：本次七个相关测试文件共 **87 项通过**，含循环几何、原画线工具、默认样式、语言、设置与手动画线同步。
- `node youle_desktop/scripts/typecheck.mjs`：通过。
- Vite renderer 构建：通过；保留现有大文件体积提示。
- `scripts/trading-cycles-qa.cjs`：三个工具均通过浅色/深色 Electron 实际鼠标回归。涵盖分阶段预览、两端拖动、重复部分整体拖动、设置、无效坐标拒绝、重载、对数拖动、缩放、零间隔、Esc、锁定、橡皮擦、现有重做恢复和删除。
- 报告：`.cache/cycles-qa/report.json`；截图：同目录 `{tool}-{theme}-preview.png`、`{tool}-{theme}-selected.png`、`{tool}-{theme}-deselected.png`、`{tool}-zoom-log.png`。

从仓库根目录启动独立 QA 服务：

```powershell
node youle_desktop/node_modules/vite/bin/vite.js --config youle_desktop/vite.config.mjs --port 5198 --strictPort
node youle_desktop/node_modules/electron/cli.js youle_desktop/scripts/trading-cycles-qa.cjs
```

未修改版本号，未制作或上传安装包。
