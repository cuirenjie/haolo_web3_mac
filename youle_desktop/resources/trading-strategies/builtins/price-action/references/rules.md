# 裸K / Price Action 冻结规则 v1.1

## 1. 术语与适用范围

本策略把“裸K分析”“价格行为学”和 `Price Action` 视为同一方法族：输入是干净的时间与 OHLC，输出是对市场结构、关键价格区域、K线压力和条件式交易场景的可复算解释。裸K强调输入边界，Price Action 强调分析流程；二者在本 Skill 中共享同一确定性规则。

首版支持：

- HH/HL 上升结构、LH/LL 下降结构、横向区间和结构转换；
- 确认摆动、支撑/阻力区域、突破后的角色互换；
- 实体强弱、上下影线拒绝、收盘位置、十字/犹豫K、实体吞没、Inside Bar、Outside Bar 和强方向收盘K；
- 独立蜡烛形态子引擎、54 个中英文映射名称、形态完整度、前置趋势、位置与后续确认；详见 [candlestick-patterns.md](candlestick-patterns.md)；
- 趋势回调、区间边缘拒绝、突破—回踩、向上/向下假突破后收回、Inside Bar 双向压缩突破；
- 发展中、已触发、已失效、第一目标到达、完成和过期生命周期。

## 2. 权威资料基线

- [CME Group：Chart Types—Candlestick, Line, Bar](https://www.cmegroup.com/education/courses/technical-analysis/chart-types-candlestick-line-bar)：OHLC、实体、影线和收盘位置表达该周期内的买卖压力；长影线表示双方都曾控制价格，不能单凭影线命名方向。
- [CME Group：Support and Resistance](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)：先前高低点和趋势线形成支撑/阻力，价格水平应按反应区域而非绝对单点理解。
- [Fidelity Trading Strategy Desk：Support and Resistance](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/support-and-resistance?print=true)：关键区反映供需相遇；突破后支撑/阻力可以互换角色；技术分析不是精确科学。
- [Fidelity：Basic concepts of trend](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/basic-concepts-trend)：上升趋势线连接两个以上抬高低点，下降趋势线连接两个以上降低高点；趋势线破坏只是变化警告，需要其他证据确认。
- [Fidelity：How to read a crypto chart](https://www.fidelity.com/learning-center/trading-investing/crypto/how-to-read-a-crypto-chart)：上升趋势定义为 higher highs/higher lows，下降趋势定义为 lower highs/lower lows，横向为 consolidation；加密市场 24/7，不能机械套用股票开盘缺口。
- [CMT Association 2025 Program Guide](https://cmtassociation.org/wp-content/uploads/2025/02/2025-Detailed-CMT-Program-Guide.pdf)：蜡烛必须区分单K/多K、确认/未确认、完整/不完整，并结合支撑阻力和更广泛图表上下文。
- [Thomas Bulkowski：Investment Candles](https://www.fidelity.com/bin-public/060_www_fidelity_com/documents/InvestmentCandles2.pdf)：同一蜡烛组合的含义取决于先前趋势；部分教科书名称在统计中并不按名称方向运行，因此本引擎不把名字当作概率保证。
- [Brooks Trading Course：Price Action Glossary](https://www.brookstradingcourse.com/price-action-trading-terms-glossary/)：Inside Bar 属于突破模式；突破后 1–5 根的小回测可视为 breakout pullback；无延续并重回区间时应按 failed breakout 处理。本 Skill 只采用可由 OHLC 复算的术语，不采用均线或主观概率。

资料用于冻结语义和测试规则，不构成收益背书。商用课程中的经验百分比不进入引擎，也不显示为胜率。

## 3. 输入不变量

- 唯一业务输入：`time/open/high/low/close`。
- `volume` 即使存在于宿主快照也必须忽略；不得计算或引用成交量均值、量比、OBV 等。
- 不计算 SMA/EMA、MACD、RSI、BOLL、ATR 等交易指标。
- 为跨币种归一化阈值，可以取最近 OHLC 真波幅的中位数作为无方向的 `rangeUnit`。它只用于判断“相对大小”和绘图缓冲，不参与多空打分，不得在报告中冒充 ATR 或信号。
- 所有摆动和场景只消费输入快照；不得读取未来 K 线。局部摆动必须有左右确认半径，因此最右端尚未确认的极值不能标成确定 HH/HL/LH/LL。

## 4. 市场结构

三尺度并行：

| 尺度 | 左右确认半径 | 最小交替位移 | 用途 |
|---|---:|---:|---|
| trigger | 2 根 | 0.32 `rangeUnit` | 信号与短回测 |
| structure | 4 根 | 0.58 `rangeUnit` | 主 HH/HL、LH/LL |
| context | 7 根 | 0.90 `rangeUnit` | 更大背景与区域 |

- 同类连续高点只保留更高者，同类连续低点只保留更低者。
- 高点相对上一确认高点：`HH / LH / EQH`；低点相对上一确认低点：`HL / LL / EQL`。
- `HH + HL` 为上升结构；`LH + LL` 为下降结构；一高一低相互矛盾为转换；未形成方向优势为区间。
- 最新已收盘 K 线越过最后确认高/低及 OHLC 缓冲，可以登记结构突破；影线单独越过不登记。
- 结构突破不是立即下单信号，仍需位置和信号/回测条件。

## 5. 关键价格区域

- 合并不同尺度、价格相距不超过 `max(0.55 rangeUnit, 当前价 0.055%)` 的确认摆动。
- 两个以上不同时间触点形成合格区域；最近 36 根内的单一极值可作为低分观察区，但不能单独提高交易评分。
- 区域上下边界由触点极值和 `0.18 rangeUnit` 缓冲组成，不画成无限精确的单价。
- 当前价在区域上方时该区按支撑观察；在区域下方时按阻力观察；处于区域内部时为决策区。
- 突破后的第一次回测允许角色互换，但必须由已收盘 K 线守住原边界。

## 6. K线事实

以下名称只记录 OHLC 几何事实，不独立构成交易：

- 十字/犹豫K：实体不超过整根 15%。
- 看涨拒绝：下影至少是实体两倍且占整根至少 50%，收盘位于整根上方 38% 区域。
- 看跌拒绝：上影镜像，收盘位于整根下方 38% 区域。
- 强势多/空收盘K：实体至少 62%，收盘位于整根顶部/底部 22%，且整根不小于局部 OHLC 中位波幅的 90%。
- 实体吞没：当前实体覆盖前一根反向实体，当前实体至少占整根 48%；影线不要求吞没。
- Inside Bar：当前最高不高于母 K 最高、最低不低于母 K 最低；它代表压缩，突破前方向必须保持中性。
- Outside Bar：当前高低覆盖前一根高低；只有收盘靠近对应端且方向一致时才记录看涨/看跌 Outside Bar。

相等边界按包含处理，避免浮点噪声制造假突破。

## 7. 可执行场景

每个方向场景必须同时通过：`结构背景 + 关键区位置 + 方向K线事实 + 当前有效期`。

完整命名蜡烛形态可以作为方向 K 线证据，但不能绕过关键区和生命周期。形态圆圈只确认几何完整，不代表可执行；只有形态方向、前置趋势、关键区域和后续收盘确认同时成立时，`actionable=true`。

### 7.1 趋势回调

- 上升结构只在支撑/角色互换区接受看涨拒绝、看涨吞没、看涨 Outside 或强多收盘K；下降结构镜像。
- 触发为信号 K 高/低外加 OHLC 缓冲；失效为信号极值与区域外沿更远者再加缓冲。

### 7.2 区间边缘拒绝

- 非趋势背景下只在支撑区考虑偏多、阻力区考虑偏空；区间中部任何 pin/engulfing 不形成场景。

### 7.3 突破—回踩

- 第一根已收盘 K 线越过至少两个触点区域；随后 1–5 根内回测原边界；回测K收盘守在突破方向并出现方向事实。
- 没有回测或回测直接收回区域，不命名为 breakout-retest。

### 7.4 假突破后收回

- 价格影线/整根越过区域外沿及缓冲，但同一根已收盘 K 线回到区域另一侧，并出现相反方向拒绝/吞没/强收盘。
- 只触及边界而没有明显越界，或越界后仍收在外侧，不属于假突破收回。

### 7.5 Inside Bar 压缩突破

- 母 K 高低是双向触发边界；突破前同时给出多空条件，不提前选边。
- 多头失效位在母 K 低下方，空头失效位在母 K 高上方。
- Inside Bar 离开上下文仍可作为观察压缩，但评分较低；重叠拥挤区不得宣称高概率。

## 8. 目标、评分与生命周期

- T1 优先取下一个合格结构区，但不得低于约 1R；T2 优先取后续结构区或 2R，以更保守且方向正确者归一。
- 场景评分只用于候选排序：关键区质量、结构一致、K线实体质量和当前性；不得显示为胜率。
- 信号触发前最多保留 4 根当前周期；未触发即过期。
- 触发后最多保留 4 根当前周期；收盘触及结构止损为失效；T1 到达后原入场不再作为当前追价机会；T2 到达为完成；超时为过期。
- `active / awaiting-breakout / awaiting-confirmation` 才能成为当前候选。其余只进入历史集合，不生成当前场景或旧结构绘图。

## 9. 绘图语法

- 已确认市场结构：`strategy-primary` 2.5px 实线，并标注 HH/HL/LH/LL/EQH/EQL。
- 支撑/阻力区域：`strategy-support/resistance` 虚线矩形，必须有上下边界而不是单条精确线。
- 方向信号：受控上/下箭头；Inside Bar 使用中性备注。
- 完整蜡烛形态：使用 `strategy-support/resistance/note` 2px 实线椭圆包围全部组成 K 线的时间与高低范围，并在上方标注中文名称和“已确认/待确认”；最近最多四个，重叠形态先按特异性和质量去重。
- 触发、失效、T1/T2：对应 `strategy-entry/stop/target` 虚线。
- 全部对象固定在 `ai/strategy/price-action`，最多 64 项；拒绝原始颜色、CSS、HTML、任意工具或跨策略图层。

## 10. 输出与明确不支持

报告必须包含结构、关键区域、最新K线事实、当前场景/无场景、确认、失效、两档目标、有效期、取消条件和 OHLC 局限。

首版明确不支持：

- 用 OHLC 猜测真实资金流、订单流、吸筹派发、机构席位或主力成本；
- FVG、Order Block、BOS/CHOCH 的 ICT/SMC 专属定义；这些属于订单流/ICT-SMC 策略，不偷偷混入裸K；
- 依赖交易时段的 Opening Range、VWAP、成交量分布、市场轮廓；
- 自动识别新闻、基本面、宏观事件或跨市场相关性；
- 以历史命中率、经验百分比或模型置信度伪装回测胜率；
- 自动下单、改仓、撤单、收益保证。

无候选是业务成功状态：展示当前结构和观察条件，`ExecutionPlanV1.action=wait`，不生成方向价位。
