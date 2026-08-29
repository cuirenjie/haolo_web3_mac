# SMT 背离冻结规则 v1.0

## 定义

- SMT 在本产品中指 Smart Money Technique 的相关市场非同步确认。
- 看跌 SMT：一个相关市场创出更高高点，另一个没有同步创出更高高点。
- 看涨 SMT：一个相关市场创出更低低点，另一个没有同步创出更低低点。
- SMT 是方向确认线索，不是独立入场信号，也不能证明操纵或“陷阱”。

## 数据门槛

- 两市场必须使用相同周期的已收盘 K 线，至少对齐 60 根，对齐率不低于 85%。
- 最近最多 160 根对齐收盘价计算对数收益 Pearson 相关系数，低于 0.45 时拒绝输出 SMT。
- 摆动固定左右各 2 根确认；两市场对应摆动最多相差 5 根；信号超过 18 根即不作为当前 SMT。
- Hyperliquid 同品种数据只做 Binance/Hyperliquid 跨场所质量检查；经典 SMT 使用 BTC/ETH 等相关但不同的市场。两者不得混写。

## 执行

- SMT 后必须在主市场等待同向位移与已收盘 MSS，再等待有效 FVG/OB 回踩。
- 触发、失效和目标仅从主市场已确认结构生成；相关市场价格不得画到主图价格轴。
- 相关性跌破门槛、两市场随后同步创新高/低、主市场结构反向或两周期内未确认时取消。
- 数据请求失败必须降级为 `insufficient_data`，不得回退到猜测，也不得影响订单流或其他策略。

## 资料基线

- [ICT 官方站](https://www.theinnercircletrader.com/index.html)
- [ICT 官方 SMT 示例（ES/NQ）](https://www.linkedin.com/posts/inner-circle-trader-a40364261_the-only-indicator-on-my-charts-smt-divergence-activity-7023696261191004161-0iX9)
- [Hyperliquid 官方 Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [Hyperliquid 官方 Rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)
