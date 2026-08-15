# ICT / SMC 冻结规则 v1.0

## 边界

- 本 Skill 是 OHLCV 市场结构引擎，与订单流 Skill 并列。它不读取逐笔成交、盘口深度、CVD 或持仓量，也不修改订单流引擎。
- “流动性”是明显摆动高低点、等高/等低附近可能聚集订单的价格行为术语；自动分析不得声称已知机构主观意图。
- FVG 是三根 K 线留下的价格不平衡，不等于该区间没有成交，也不保证回补。
- OB 必须是引发位移和 BOS/MSS 前的最后反向 K 线区域；没有结构后果的反向 K 线不命名为 OB。

## 确认顺序

1. 仅使用已收盘 K 线确认摆动与结构。
2. 识别 BSL/SSL、等高/等低与清扫/收回。
3. 识别位移，再区分延续 BOS、初步 CHoCH 与带位移的 MSS。
4. 只保留可追溯到结构事件的 OB、Breaker 与有效 FVG。
5. 通过 Dealing Range 的 EQ 划分 Premium/Discount；OTE 固定使用 0.618–0.786 回撤区。
6. 执行必须等待“清扫 → 位移/MSS → 有效 PD Array 回踩 → 收盘确认”，缺一步即保持等待。

## 绘图与执行

- 独立图层 `ai/strategy/ict-smc`；结构实线、流动性点线、OB/FVG 虚线矩形、EQ 虚线。
- 触发、失效和目标均来自已确认结构高低点；有效期最多四个当前周期。
- 缺少结构高低点时不编造价位。任何方案都不自动下单，不承诺区域生效或目标到达。

## 资料基线

- [The Inner Circle Trader 官方站](https://www.theinnercircletrader.com/index.html)
- [ICT 2022 Mentorship Episode 6](https://www.youtube.com/watch?v=Bkt8B3kLATQ)
