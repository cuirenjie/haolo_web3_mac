# Moving Average deterministic rules v1

## Formula and completion

- Defaults: simple moving averages of 5, 20, and 60 closes.
- `SMA(n) = sum(last n closed prices) / n`; all three series must use the same close-price source as the native MA overlay.
- Only closed candles participate. The current live candle is excluded from state, pattern, drawing, and execution confirmation.
- 所有确认必须来自已收盘 K 线，未收盘 K 线只能显示行情，不能改变结论。
- Normalize slopes and ribbon width by price so thresholds remain comparable across instruments.

## Interpretation

- Moving averages smooth price and describe current trend direction; they lag price and do not predict an exact top or bottom.
- Rising/falling averages and price above/below them are trend evidence. A single price crossing or touching one average is not an order signal.
- Bullish alignment requires `MA5 > MA20 > MA60` to persist and the medium/long averages not to contradict the direction. Bearish alignment is the inverse.
- Averages are dynamic support/resistance zones. Use an ATR-based tolerance and require a closed rejection/reclaim; do not claim an exact support/resistance price.
- Narrow ribbon width describes compression, not future direction. Ordered expansion plus slope and price confirmation supplies direction.

## Confirmed structures

- Golden cross: MA5 crosses above MA20 and remains above it on the following closed candle. It is execution-eligible only when price is above MA60 and MA60 is not materially falling.
- Death cross: MA5 crosses below MA20 and remains below it on the following closed candle. It is execution-eligible only when price is below MA60 and MA60 is not materially rising.
- Draw a golden/death-cross anchor at the linear intersection of the MA5 and MA20 segments between the last pre-cross sample and the first post-cross sample. Keep the confirmation state on the following closed candle; never move the visual anchor from the mathematical intersection to the confirmation candle or an offset label position.
- Bullish expansion: a recent low-percentile ribbon compression is followed by persistent `MA5 > MA20 > MA60`, rising medium/long slopes, and ribbon width expansion.
- Bearish expansion: the inverse ordered and slope-confirmed sequence.
- Bullish MA20 retest: during bullish alignment, price reaches the MA20 tolerance zone, closes back above it, and a later closed candle breaks the retest candle high while retaining MA20.
- Bearish MA20 rejection: during bearish alignment, price reaches the MA20 tolerance zone, closes back below it, and a later closed candle breaks the retest candle low while retaining MA20 resistance.
- Do not name mere proximity, a one-bar cross, unordered expansion, or a cross against the long-period context as an executable pattern.

## Execution

- All scenarios remain `wait` until an additional closed price trigger is satisfied.
- Use the confirmed structure high/low as trigger and the opposite structural extreme beyond the MA zone as invalidation.
- Derive T1 and T2 from 1R and 2R only when entry, invalidation, and targets are positive and correctly ordered.
- If there is alignment without a fresh eligible event, report the regime and wait without fabricated entry, stop, or targets.
- Plans expire after four current-period bars and cancel on opposite alignment, a close through structural invalidation, stale data, or loss of required candle coverage.

## Knowledge boundary

These rules follow standard moving-average definitions and established interpretation: averages smooth past prices, longer periods lag more, crossovers can whipsaw in ranges, and support/resistance is zonal. They do not prove future direction or guarantee a trade outcome.

均线属于滞后型趋势工具：周期越长通常越平滑、反应越慢；横盘时交叉容易产生来回失效，不能单独作为下单依据。
均线提供的是动态支撑阻力区域，不是保证成交或反转的精确价格线。
