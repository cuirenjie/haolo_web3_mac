# 江恩理论冻结规则 v1.0

## 1. 产品边界

本策略只自动化能由同一份 OHLC 时间序列复算的价格—时间几何：确认转折点、价格/Bar 标尺、九条角度线、等分方格、嵌套方格以及 Square of Nine 平方根价位。占星、行星位置、星盘、不可复算日期神秘数和主观选号均不进入引擎、绘图或执行条件。

本策略不是道氏趋势、艾略特波浪、传统图表形态、谐波 XABCD、裸 K 组合或威科夫阶段引擎。跨策略使用必须经过显式能力声明，不能复制算法或暗中形成依赖。

## 2. 资料基线

- [TradingView：Gann Fan drawing tool](https://www.tradingview.com/support/solutions/43000518151-gann-fan-drawing-tool/)：冻结九条角度线、1x1 的价格/时间单位定义、重要转折点锚定和正确尺度要求。
- [TradingView：Gann Square drawing tool](https://www.tradingview.com/support/solutions/43000518149-gann-square-drawing-tool/)：冻结价格—时间对称、精确 Bar/Price 坐标和价格/Bar 比例。
- [TradingView：Gann Box drawing tool](https://www.tradingview.com/support/solutions/43000518152-gann-box-drawing-tool/)：冻结从主要高低点出发、同时等分价格与时间范围的工具语义。
- [CMT Association：Core Framework](https://cmtassociation.org/wp-content/uploads/2024/01/kevinhaggerty-062210-1.pdf)：冻结 Square of Nine 的平方根算法、45° 至 360° 因子表、重要高低点基准及高低价品种移动小数尺度的做法。

资料用于定义工具和公式，不构成有效性或收益背书。

## 3. 输入、收盘与确认锚点

- 输入只要求时间与 OHLC；成交量、技术指标、新闻和模型猜测不参与几何计算。
- 所有锚点、标尺和确认只消费在 `snapshotTime` 前完整结束的 K 线。
- 默认局部确认半径为左右各 3 根，且局部跨度至少为近期 K 线中位高低范围的 1.15 倍。
- 交替高低点的位移至少为 1.10 个近期中位范围；连续同类点只保留更极端者。
- 局部点不足时按最近 120 根已收盘 K 线分段提取确认极值，并把锚点质量标为降级；不能因此让整次分析失败。

## 4. 标尺与 1x1

标尺优先取最近两个同类确认转折点：

`pricePerBar = abs(anchorPrice - controlPrice) / abs(anchorIndex - controlIndex)`

- 同类点至少相隔 6 Bar，价格差至少为 1.5 个近期中位范围。
- 同类点不合格时，使用最近反向确认点的完整摆动降级校准；仍不合格时使用 24 Bar 与 6 个中位范围保底。
- 基础周期限制在 8 至 96 Bar；投影最多延长三个基础周期，使当前价格仍位于可读的活动方格附近。
- 1x1 永远表示 `pricePerBar`，与窗口大小、纵轴缩放或屏幕视觉角度无关。

## 5. 江恩角度线

固定九条比率：`1x8, 1x4, 1x3, 1x2, 1x1, 2x1, 3x1, 4x1, 8x1`。

- 低点锚定时向上投影，高点锚定时向下投影。
- 每条线斜率为 `pricePerBar × ratio`。
- 为避免极陡角度把图表价格轴压缩，所有线在同一活动方格边界处截断；数值斜率不受截断影响。
- 价格位于上升 1x1 上方或下降 1x1 下方只说明相对强弱，不直接生成订单。

## 6. 江恩方格与轮中轮

- 外层方格以活动锚点为起点，横轴为投影 Bar 数，纵轴为同标尺价格范围。
- 价格和时间轴都在 `1/4, 1/2, 3/4` 位置画分割线，并画两条对角线。
- 轮中轮固定表达为共享同一锚点、同一标尺的 1/2 与 1/4 嵌套方格。
- 嵌套方格是可复算的图表表示，不宣称复刻实体占星轮盘，也不引入第二套隐藏周期。

## 7. Square of Nine 与数字螺旋

因 CMT 资料明确提示高低价品种要移动小数尺度，v1 自动把锚点标准化到 `[100, 1000)`：

`priceUnit = 10 ^ (floor(log10(anchorPrice)) - 2)`

`normalizedAnchor = anchorPrice / priceUnit`

`level = ((sqrt(normalizedAnchor) ± factor) ^ 2) × priceUnit`

| 角度 | 因子 |
|---:|---:|
| 45° | 0.25 |
| 90° | 0.50 |
| 135° | 0.75 |
| 180° | 1.00 |
| 225° | 1.25 |
| 270° | 1.50 |
| 315° | 1.75 |
| 360° | 2.00 |

- 引擎同时计算锚点上下两侧完整 16 个层级，并在图上只显示距离当前价最近的上方三层与下方三层，避免文字和其他元素重叠。
- 图上的“数字螺旋”是精确水平价位投影，不画与时间/价格坐标无关的装饰性螺旋。
- 单独触及层级不构成反转或延续确认。

## 8. 执行与风险

- 最近确认低点锚定时只建立条件式偏多场景；最近确认高点锚定时镜像为条件式偏空场景。
- 触发位取锚点前最近反向确认点外加/减小幅 OHLC 缓冲；结构失效位在锚点外侧。
- 目标优先选择位于触发后至少 0.45R 的最近 Square of Nine 层级；没有合格层级时退化为 1R/2R。
- 即使已收盘突破，也必须等待回踩/反抽守住；影线、触线、视觉共振均不能单独确认。
- 新确认主摆动替代锚点、收盘越过失效位、周期结束未触发、数据降级或假突破时取消。
- `ExecutionPlanV1.action=wait`；没有账户、合约和最小下单单位时不生成数量，也不自动下单。

## 9. 绘图语法

- 1x1：`strategy-primary` 2px 实线；其他角度线：`strategy-note` 0.8px 点线，只标注五条主比率以减少重叠。
- 外层方格：`strategy-primary` 1.2px 虚线；轮中轮、分割线和对角线：`strategy-note` 0.8px 点线。
- 数字螺旋层级：上方使用 `strategy-resistance`、下方使用 `strategy-support`，0.8px 虚线并显示角度与价格。
- 触发、失效和目标使用统一 `strategy-entry/stop/target`；全部对象锁定在 `ai/strategy/gann-theory`，不得修改其他策略图层。
