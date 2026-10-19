# 斐波那契与江恩绘图核对记录

日期：2026-10-19。根据用户提供的 TradingView 创建中、完成后和拖拽截图，按下表顺序逐项实现、验证后再继续下一项。

工作目录：`C:\Users\潘艳芳\Documents\ChatGPT\haolo_windows_web3`。

## 逐项实现

| 顺序 | 工具 | 关键行为 | 单项核对 |
| --- | --- | --- | --- |
| 1 | 斐波那契趋势扩展 | 三点；AB 价格差从 C 投射，C 为 0 位；分档水平线、价格标签和填充 | 通过 |
| 2 | 斐波那契通道 | 三点；AB 确定方向，C 确定 1 倍通道；平行档位与色带 | 通过 |
| 3 | 斐波那契时区 | 两点确定时间间距；0、1、2、3、5、8…竖线与底部标签 | 通过 |
| 4 | 斐波那契速度阻力扇 | 价格、时间两组射线；矩形网格、四侧比率、分区填充 | 通过 |
| 5 | 斐波那契趋势时间 | 三点；AB 时间跨度从 C 投射；灰色虚线折线与全高时间色带 | 通过 |
| 6 | 斐波那契圈 | 两个边界控制点确定中心及横纵半径；同心环带；Shift 约束为圆 | 通过 |
| 7 | 斐波那契螺旋 | 两点确定中心、尺度和朝向；黄金比例对数螺旋、半径射线；可切换旋向 | 通过 |
| 8 | 斐波那契速度阻力弧 | 第一点为中心，AB 距离为半径；上下半圆及分档填充；支持完整圆 | 通过 |
| 9 | 斐波那契楔形 | 三点；AB 决定半径，C 决定角度；同心扇形分档，角点贴合外弧 | 通过 |
| 10 | 倾斜扇形 | 三点；从 A 向 BC 的四等分位置发射五条射线；红色中线及横连线 | 通过 |
| 11 | 江恩箱 | 两点确定矩形；时间、价格双向网格及色带；四角均可调整，辅助角点保持对角不动 | 通过 |
| 12 | 固定江恩正方 | AB 距离为一个单位，边长五个单位；五格网格、扇线、成组四分之一圆弧 | 通过 |
| 13 | 江恩正方 | 两点独立控制横纵跨度；网格、椭圆弧和扇线；显示 K 线间隔、价格差及比率 | 通过 |
| 14 | 江恩扇 | AB 校准 1/1；8/1、4/1、3/1、2/1、1/1、1/2、1/3、1/4、1/8 射线与色带 | 通过 |

## 核对方式

每种工具都运行独立 Electron 会话，在浅色、深色主题下核对创建预览、点击定点、全部控制点拖拽、坐标修改、设置开关、重载恢复、对数坐标、整图移动、锁定、撤销重做、非控制点线条擦除、Esc 取消和右键回退。使用合成 K 线，避免写入用户图表会话。

几何测试覆盖标准方向、反向、起点在屏幕外、重合端点、有限坐标、擦除线段的视口裁切、同步格式往返以及独立线条样式。额外核对江恩箱的两个辅助角点、江恩正方的跨度读数、楔形缩放后的外弧控制点。

最终结果：14 个工具的浅色、深色交互回归均通过；相关自动化测试 **95 项通过、0 项失败**；TypeScript 类型检查和 Vite 前端构建通过。

核对过程中修正了江恩箱辅助角点误触发整体移动、楔形切换坐标比例后控制点偏离弧线，以及独立设置开关未保存的问题。整体移动按屏幕位移反算坐标，保持对数坐标下的图形形状。

对于旧版仅保存两个锚点的三点工具，保留历史锚点和原渲染，不推测第三点。新建图形使用本次三点交互。

## 代码与验证入口

- `src/renderer/trading-fibonacci-projections.ts`：时间、趋势投射、通道和扇形。
- `src/renderer/trading-fibonacci-radial.ts`：圈、螺旋、阻力弧、楔形。
- `src/renderer/trading-gann-projections.ts`：江恩箱、两种正方、江恩扇。
- `src/renderer/trading-fibonacci.ts`、`trading-fibonacci-settings.ts`：各工具默认档位、样式、坐标和模板。
- `test/trading-fibonacci-projections.test.mjs`：几何与边界测试。
- `scripts/trading-fibonacci-projections-qa.cjs`：真实鼠标输入及持久化回归；参数为工具 ID。
- `.cache/fibonacci-projections-qa/<工具 ID>/report.json`：逐项结果；同目录存放浅色/深色预览、完成及对数坐标截图。
- `.cache/fib-final-tests.log`、`.cache/fib-build.log`：回归测试及前端构建输出。

所有命令在仓库根目录运行。例如：

```powershell
node youle_desktop/scripts/typecheck.mjs
node --test youle_desktop/test/trading-fibonacci-projections.test.mjs
node youle_desktop/node_modules/electron/cli.js youle_desktop/scripts/trading-fibonacci-projections-qa.cjs gann-fan
```

UI 回归脚本使用本地 `5183` 端口的 Vite 测试页面；脚本会在首个失败处停止，不继续下一工具。

## 规则参考

外观和交互以用户截图为依据。工具定义另核对 TradingView 官方说明：

- [趋势扩展](https://www.tradingview.com/support/solutions/43000518137-trend-based-fib-extension-drawing-tool/)、[通道](https://www.tradingview.com/support/solutions/43000791610/)、[时区](https://www.tradingview.com/support/solutions/43000518155-fib-time-zone/)、[速度阻力扇](https://www.tradingview.com/support/solutions/43000518156-fib-speed-resistance-fan/)、[趋势时间](https://www.tradingview.com/support/solutions/43000518136-trend-based-fib-time-drawing-tool/)。
- [圈](https://www.tradingview.com/support/solutions/43000518159-fib-circles/)、[螺旋](https://www.tradingview.com/support/solutions/43000791611-fibonacci-spiral-drawing-tool/)、[速度阻力弧](https://www.tradingview.com/support/solutions/43000518157-fib-speed-resistance-arcs-drawing-tool/)、[楔形](https://www.tradingview.com/support/solutions/43000518153-fib-wedge-drawing-tool/)、[倾斜扇形](https://www.tradingview.com/support/solutions/43000518143-pitchfan-drawing-tool/)。
- [江恩箱](https://www.tradingview.com/support/solutions/43000518152-gann-box-drawing-tool/)、[固定江恩正方](https://www.tradingview.com/support/solutions/43000791675-gann-square-fixed-drawing-tool/)、[江恩正方](https://www.tradingview.com/support/solutions/43000518149-gann-square-drawing-tool/)、[江恩扇](https://www.tradingview.com/support/solutions/43000518151-gann-fan/)。
