# 六种手动形态绘图对齐记录（2026-10-19）

按用户提供的连续截图，依次处理 XABCD、赛福、头肩、ABCD、三角和三驱，每种完成后运行该形态的几何测试及 Electron 交互测试。

## 绘制规则

| 工具 | 点击数 | 默认样式 | 辅助结构 |
| --- | --- | --- | --- |
| XABCD | 5 | 蓝色 `#2962ff`、2px | XAB/BCD 两块半透明三角形；XB、AC、BD、XD 比率 |
| 赛福 Cypher | 5 | 蓝色 `#2962ff`、2px | 同样的双三角结构，AC 与 XD 使用赛福的计算基准 |
| 头肩 | 7 | 绿色 `#089981`、2px | 左肩、头部、右肩标签；两谷点决定颈线；三瓣区域逐步填充 |
| ABCD | 4 | 绿色 `#089981`、2px | AC、BD 两条点线及比率，无区域填充 |
| 三角 | 4 | 紫色 `#673ab7`、2px | AC、BD 边界延伸，A 所在横坐标闭合左边界，区域半透明 |
| 三驱 | 7 | 紫色 `#673ab7`、2px | 第 2–4、4–6 点连接点线和比率，无字母标签或填充 |

自由取点，数值标签反馈实际价格比率。比率使用价格差，缩放或切换对数坐标不会改变测量值。分母为零显示 `—`。普通比率保留最多三位小数，三驱最多两位小数，去除末尾零。

令 `|PQ| = abs(price(Q) - price(P))`：

- XABCD：XB 标签为 `|AB| / |XA|`，AC 为 `|BC| / |AB|`，BD 为 `|CD| / |BC|`，XD 为 `|AD| / |XA|`。
- 赛福：XB、BD 同上；AC 为 `|XC| / |XA|`，XD 为 `|CD| / |XC|`。用户截图 C=2290.26 时，AC 应为 0.727。
- ABCD：AC 为 `|BC| / |AB|`，BD 为 `|CD| / |BC|`。截图价格得到 0.639、1.779。
- 三驱：按 P1…P7 编号，P2–P4 标签为 `|P3P4| / |P2P3|`，P4–P6 为 `|P5P6| / |P4P5|`。截图价格得到 0.89、0.6。

头肩颈线穿过第 3、5 点。第五个预览点出现时显示颈线与前两瓣填充，第七点出现时补齐右肩填充。填充裁在头部一侧，适用于头肩顶和头肩底。未完成时颈线投影到图表边缘，完成后截止到末点横坐标。

三角在第四点预览时建立 AC/BD 包络。前方交点位于可见图表内时在交点闭合；交点在屏幕外、平行或发散时延伸到可见边缘。同横坐标等退化情况保留折线，避免无效交点。

## 交互和设置

- 一次点击固定一个锚点，下一点随指针实时预览；预览点显示文字，圆形控制柄只显示在已经确认的锚点上。
- 第 N 次点击完成工具对应的 N 点，随后回到选择模式；右键逐点回退，Esc 取消未完成形态。
- 支持逐点拖动、整体拖动、坐标编辑、锁定、隐藏和删除；选中时控制柄保持可见。
- 价格轴和时间轴显示已确认锚点及选区；邻近价格标签错位排列以免相互遮挡。
- 浮动工具栏提供线色、线型、线宽、文字样式、设置；有填充的形态另有背景颜色入口，可调透明度或关闭背景。
- 形态样式复用已有同步字段，刷新后保留；没有新增存储版本。

## 实现入口

- `src/renderer/trading-patterns.ts`：独立比率、颈线、三角包络及 SVG 渲染/命中区域。
- `src/renderer/trading-expert-drawing.ts`：接入逐点绘制、控制柄、轴标记、工具栏和命中处理。
- `src/renderer/trading-horizontal-line-settings.ts`：形态的背景、文字及锚点坐标编辑。
- `test/trading-patterns.test.mjs`：参考价格、预览阶段、反向/退化几何和分母为零的回归。
- `scripts/trading-patterns-qa.cjs`：隔离账户的 Electron 合成行情场景，通过原生鼠标事件逐个工具测试。

## 验证记录

六种形态均完成独立浅色/深色交互测试，截图位于 `.cache/patterns-qa/<tool>/`。覆盖逐点预览、每个锚点独立拖动、整体平移、坐标设置、取消/回退、锁定、删除、样式持久化、缩放和对数坐标。三角额外验证点击投影边界选中形态；头肩额外验证英文标签。

共用控件回归还检查不透明红色 `#ff0000` 与带零透明度的 `#ff000000` 的区别，避免背景开关误判。

最终结果：六种工具各自的 `report.json` 均为 PASS，共 12 组浅色/深色交互场景；14 项形态专项测试以及相关存储、轴标记、绘图控件等测试合计 104 项全部通过。TypeScript 检查通过，Vite 生产构建通过，产物位于 `.cache/patterns-build/`。构建仅提示现有主包体积较大的优化警告。

根目录运行相关单元测试：

```powershell
node --test youle_desktop/test/trading-patterns.test.mjs youle_desktop/test/trading-expert-drawing-tools.test.mjs youle_desktop/test/trading-drawing-defaults.test.mjs youle_desktop/test/trading-drawing-language.test.mjs youle_desktop/test/trading-horizontal-line.test.mjs youle_desktop/test/trading-drawing-labels.test.mjs youle_desktop/test/trading-drawing-pane-clipping.test.mjs youle_desktop/test/trading-drawing-crosshair.test.mjs youle_desktop/test/trading-drawing-visibility.test.mjs youle_desktop/test/manual-drawing-sync.test.mjs
node youle_desktop/scripts/typecheck.mjs
```

Electron 测试需要本地 Vite 端口 5196，随后以 `--tool=xabcd` 等参数运行脚本。可用工具参数：`xabcd`、`cypher`、`head-shoulders`、`abcd`、`triangle-pattern`、`three-drives`。每次执行清除该工具上次的结果/失败标记，最新 `report.json` 中的 PASS 表示本轮成功。

## 对照资料

细节以用户连续截图为准，并参考 TradingView 的工具说明：[XABCD](https://www.tradingview.com/support/solutions/43000569909-xabcd-pattern-drawing-tool/)、[Cypher](https://in.tradingview.com/support/solutions/43000791680-cypher-harmonic-pattern-drawing-tool/)、[头肩](https://www.tradingview.com/support/solutions/43000570149-head-and-shoulders-drawing-tool/)、[ABCD](https://www.tradingview.com/support/solutions/43000570202-abcd-pattern-drawing-tool/)、[三角](https://www.tradingview.com/support/solutions/43000570208-triangle-pattern-drawing-tool/)、[三驱](https://www.tradingview.com/support/solutions/43000570172-three-drives-pattern-drawing-tool/)。
