# MACD deterministic rules v1

## Formula and completion

- Fast EMA: 12; slow EMA: 26; `DIF = EMA12 - EMA26`; `DEA = EMA9(DIF)`; histogram: `DIF - DEA`.
- Only closed candles participate. A cross exists when the prior difference is on one side of zero and the current closed value reaches the other side.
- `near zero` and `near DEA` use scale-normalized tolerances derived from the recent MACD range; they are not exact floating-point equality.

## Eight classic combinations

All sequences must finish on closed candles and stay within a bounded recent window.

- 佛手向上: after a bullish cross and advance, DIF pulls back close to DEA without a bearish cross, then turns up and the positive histogram expands.
- 小鸭出水: below/near zero, bullish cross, then bearish cross without a durable move above zero, followed by a second bullish cross.
- 漫步青云: a bearish cross starts above zero, DIF reaches below/near zero, then forms a bullish cross near or above zero.
- 天鹅展翅: below zero after a bullish cross, DIF approaches DEA without crossing; positive bars contract and then expand as DIF turns up.
- 空中缆绳: after rising from a below-zero bullish cross, DIF and DEA run above zero, converge without a bearish cross, then expand upward.
- 空中缆车: DIF/DEA form a bearish cross above zero, remain above zero, then form a new bullish cross above zero.
- 海底电缆: DIF/DEA remain below zero for a long bounded run, form a bullish cross and prolonged near-equality, then expand upward while still near/below zero.
- 海底捞月: two distinct bullish crosses below zero, with an intervening bearish cross, and the second cross is the completion point.

These names are educational aliases for deterministic line geometry, not proof of institutional behavior or a buy order.

## Divergence

- Regular bearish/top divergence: price makes a confirmed higher high while aligned DIF makes a lower high; histogram agreement increases confidence.
- Regular bullish/bottom divergence: price makes a confirmed lower low while aligned DIF makes a higher low.
- Hidden bullish divergence: price makes a higher low while DIF makes a lower low.
- Hidden bearish divergence: price makes a lower high while DIF makes a higher high.
- Pivots require candles to the right, minimum price and indicator separation, and bounded age. Short or shallow structures are candidates, not confirmed divergence.

## Execution

MACD supplies direction and momentum context only. An actionable scenario still waits for a closed price break of the evidence range, uses the opposite structural pivot as invalidation, derives 1R/2R targets, expires after four bars, and is cancelled by indicator reversal, structure invalidation, stale data, or excessive whipsaw.
