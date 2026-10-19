# 成交量与范围绘图：2026-10-19

本次在 Windows 客户端实现六项工具的截图交互和样式。主要代码位于 `trading-volume-drawings.ts`、`trading-range-tools.ts`、`trading-volume-settings.ts`，由现有绘图控制器负责选择、拖动、坐标轴标记和保存。

## 交互和显示

| 工具 | 放置方式 | 完成后的显示 |
| --- | --- | --- |
| 锚定 VWAP | 单击已有 K 线的时间位置 | 蓝色主线、绿色上下轨、浅绿色填充；计算延伸到最新 K 线 |
| 固定范围成交量分布图 | 两次点击或按下拖动，选择两个时间端点 | 约 1 秒后显示左侧青色/粉色横条、浅蓝区间背景、区间内 POC 横线 |
| 锚定成交量分布图 | 单击确定一条起始竖线 | 约 1 秒后显示靠右价格轴的青色/粉色横条，POC 横贯主图；新 K 线自动纳入统计 |
| 价格范围 | 两点或拖动，包括纯垂直拖动 | 上下边线、中央竖向箭头、半透明填充；卡片显示价差、百分比、最小跳动数 |
| 日期范围 | 两点或拖动 | 左右边线、中央横向箭头；卡片显示 K 线间隔数、时间跨度、累计成交量 |
| 日期和价格范围 | 两点或拖动 | 横向和竖向中央箭头；三行综合测量卡片 |

成交量工具的时间端点吸附到实际 K 线，最右只能到最新一根，最左只能到当前已加载的第一根。点击高度不改变计算结果，完成后的价格坐标由真实数据决定。固定范围保留结束时间，锚定范围持续跟随最新数据。

三种范围测量允许进入未来空白区域。时间跨度和间隔数包含这部分；成交量仅累加范围内已经存在的 K 线。反向拖动、端点修改、整体移动、锁定、删除、撤销/重做和本机重启恢复均沿用绘图系统。

## 计算方法与数据边界

VWAP 默认价格源为 `HLC3 = (high + low + close) / 3`，从锚点开始累计：

```text
VWAP = Σ(price × volume) / Σ(volume)
variance = Σ(volume × (price − VWAP)²) / Σ(volume)
upper / lower = VWAP ± multiplier × sqrt(variance)
```

实现使用加权 Welford 递推，避免高价格、小波动时的浮点相减误差。默认标准差倍数为 1；设置支持其他价格源、百分比带、颜色、线宽和不透明度。无有效成交量时显示无数据提示，不生成虚构曲线。

成交量分布默认目标 24 行、70% 价值区域。先确定所选 K 线的实际 high/low，再根据交易所 `PRICE_FILTER.tickSize` 把行高取整到整数跳动数；在向下/向上取整方案中选择总行数更接近目标的一种，最后不足一整行的部分保留，实际行数可能不等于设置值。也支持“每行跳动数”布局。每根来源 K 线按价格区间与档位的重叠比例分摊成交量，平价 K 线全部归入所属档。POC 是总量最高的档位中心。多根范围中 `close >= open` 归入上涨成交量；单根范围使用 `close > open`。价值区域从 POC 扩展到相邻高成交量档，同量时优先近档、再优先上档，新增档会超出目标时停止。

**低周期数据已接入：** 主图和分屏通过原有行情适配器读取同一市场的低周期历史，按时间反向分页，包含最后一根选中 K 线的全部有效子周期。期货日线的固定范围和锚定分布均使用 4 小时数据；其余期货周期取低一档。普通品种的锚定分布按 `1/3/5/15/30/60/240/1D` 选择少于 5000 根的周期；固定范围按官方列出的 `1/5/15/30/60/240/1D` 选择。秒级或不超过 5 分钟的固定范围使用 1 秒数据（目前只有 Binance 现货适配器提供真实秒级历史）。固定范围文档中的示例和显式列表对 3 分钟存在矛盾，此处采用显式列表。

低周期数据必须逐根与父 K 线的 OHLC 和成交量合计核对。匹配的父 K 线由子 K 线替换；不完整或过时的部分只使用该根父 K 线一次，保证不丢量、不重复累加。实时尾段每 5 秒更新，已结束的固定范围复用缓存；每个控制器最多 2 个并发请求，历史上限 50000 根，切换市场/周期或销毁时取消旧请求。暂不可用时保留图表周期结果，图形悬停信息显示低周期覆盖率。采用原始 OHLCV，而不是 Heikin Ashi 变换后的价格。

**仍存在的数据边界：** 未提供 TradingView 每档成交量导出，无法证明所有柱长与内部算法逐值相同。截图当时的实时 K 线也与稍后下载的数据不同。截图为 `ETHUSDZ2026`，已通过 Binance COIN-M 的 `ETHUSD_261225` 公共数据核对；本次没有扩展客户端的 COIN-M 市场目录或把该合约替换为 ETHUSDT 永续。不同市场的数据不能直接用于截图数值对比。固定范围截图顶部标签 2838.67 与交易所实际最高价 2838.65 相差 0.02，本实现保留实际 high/low，没有硬编码截图坐标。

## 2026-10-19 数值校准结果

用户确认以截图和默认参数继续。从 Binance 公开接口取得 `ETHUSD_261225` 的日线及 4 小时 K 线，最小跳动 0.01，记录时间为 `2026-10-19T08:38:52Z`。

| 锚点 | 截图 POC | 校准结果 | 仅日线计算 | 普通品种自动周期口径 |
| --- | --- | --- | --- | --- |
| 2026-08-26 | 2701.73 | **2701.73** | 2722.80 | 30 分钟数据为 2491.02 |
| 2026-09-23 | 2709.29 | **2709.29** | 2709.29 | 30 分钟数据为 2709.29 |

AVP 官方页面没有写期货低一档的例外；本次依据同一合约的实测和两张截图，采用与 FRVP 相同的期货规则。两个锚点分别核对了 55/55、27/27 根日线的低周期数据，分档合计与区间成交量保持一致。固定范围 8 月 20 日至 9 月 25 日的 POC 为 2476.46，延伸至 10 月 19 日为 2701.28；截图没有可直接逐值核对的固定范围 POC 标签。

`test/fixtures/ethusd-261225-volume-reference.json` 保存公开行情快照，离线测试核对两个已知 POC。`scripts/trading-volume-reference-check.mjs` 可重新抓取同一合约并输出全部档位、POC、VAH/VAL、覆盖率及总量，结果在 `.cache/volume-profile-accuracy/report.json`。实时成交量更新会改变部分档位，因此不把截图的实时总量硬编码进计算。

价格范围的三个数分别为 `终价 − 起价`、`价差 / 起价 × 100%`、`价差 / minMove`。例如截图中的 `2506.39 → 2219.14`、`minMove = 0.01`，结果为 `−287.25 (−11.46%) −28,725`。日期间隔用图表逻辑索引差，成交量累加包含两个有效端点。

## 保存与同步

`vwap`、`volumeProfile` 参数及测量样式保存在本地绘图和样式记录中。现有后端手动画线协议尚未接纳锚定工具及这两个参数字段，这些记录保留在持久本地副本，不发送会使整批绘图同步失败的操作。普通范围绘图和未带扩展参数的固定范围绘图继续使用已有协议。本次没有修改或发布业务后端。

## 初次实现的验证证据

- 相关回归用例共 97 项通过：计算、绘图入口、样式、语言、坐标标记、窗格裁剪及手动绘图同步。
- `node youle_desktop/scripts/typecheck.mjs` 通过。
- Vite renderer 构建通过；仅保留现有大包体提示。
- `scripts/trading-volume-range-qa.cjs` 使用隔离 Electron profile 和真实鼠标事件，覆盖六项工具的浅色/深色共 12 组放置与截图。
- 实际交互覆盖：最新 K 线限位、1 秒生成、锚点重定位、垂直移动不改变成交量计算、设置确认/取消、锁定、本机重启恢复、实时新增 K 线、缩放、未来范围测量、纯垂直放置、整体拖动、对数价格轴、窄窗口、删除及撤销/重做。
- 结果和截图可由脚本再生成至 `.cache/volume-range-qa/`，汇总为 `report.json`。

所有命令从仓库根目录运行。界面验证先启动隔离 Vite 端口，再运行 Electron 脚本：

```powershell
$env:HAOLO_DESKTOP_MANUAL_RESTART='1'
node youle_desktop/node_modules/vite/bin/vite.js --config youle_desktop/vite.config.mjs --host 127.0.0.1 --port 5194
# 另一个终端，工作目录仍为仓库根目录：
node youle_desktop/node_modules/electron/cli.js youle_desktop/scripts/trading-volume-range-qa.cjs
```

本次数值校准新增验证：

- 类型检查、renderer 构建通过；49 项相关单元测试通过，包括真实合约离线快照、周期选择、跳动取整、守恒、缺失子周期、历史分页、取消、市场切换、实时尾段更新和失败退避。
- `scripts/trading-volume-accuracy-qa.cjs` 通过真实鼠标放置，重放同一公开快照，验证生产 renderer 加载器请求 4 小时数据，两个锚定 POC 的曲线、控制点和价格轴都使用同一计算值；交易所 0.01 跳动覆盖图表显示格式中的 0.1，行布局设置可保存。
- 该 UI 验证使用隔离的模拟行情桥接，不表示生产客户端已经接入 COIN-M 市场目录。结果为 `.cache/volume-profile-accuracy/ui-report.json`，含 3 张实际界面截图。
- 六项工具的浅色/深色 12 组完整交互回归通过，包括整体拖动、重启、设置、缩放及对数坐标。整体拖动测试从填充区域抓取，避开箭头悬停后出现的“添加文字”按钮。
- 扩展绘图目录回归曾出现 1 项与本次成交量无关的断言失败：旧用例仍期望 `note` 单击放置，当前实现已是两次点击；本次不改动注释工具或其预期。

```powershell
node youle_desktop/scripts/trading-volume-reference-check.mjs
node youle_desktop/node_modules/electron/cli.js youle_desktop/scripts/trading-volume-accuracy-qa.cjs
node --test youle_desktop/test/trading-volume-history.test.mjs youle_desktop/test/trading-volume-range-tools.test.mjs
```

## 官方参考

- [Anchored VWAP drawing tool](https://www.tradingview.com/support/solutions/43000669764-anchored-vwap-drawing-tool/)
- [VWAP](https://www.tradingview.com/support/solutions/43000502018-volume-weighted-average-price-vwap/)
- [Fixed range volume profile drawing tool](https://www.tradingview.com/support/solutions/43000707985-fixed-range-volume-profile-drawing-tool/)
- [Anchored volume profile drawing tool](https://www.tradingview.com/support/solutions/43000707989-anchored-volume-profile-drawing-tool/)
- [Volume profile basic concepts](https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/)
