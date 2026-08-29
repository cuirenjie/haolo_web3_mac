# KDJ deterministic rules v1

## Formula and completion

- Parameters: `9,3,3`. For each closed candle, `RSV = (close - lowestLow9) / (highestHigh9 - lowestLow9) × 100`; a zero range yields RSV 50.
- Initialize K and D at 50. Recursively calculate `K = (2 × priorK + RSV) / 3`, `D = (2 × priorD + K) / 3`, and `J = 3K - 2D`.
- K and D are bounded by the RSV smoothing, while J is intentionally unbounded and can exceed 100 or fall below 0. Never clamp J.
- Only closed candles participate. Crosses and threshold events complete on a closed candle; price pivots require two closed candles on the right.

## Zones, crosses, and persistence

- K and D at/above 80 describe an overbought momentum state; at/below 20 describe oversold. These are not automatic reversal signals.
- A golden cross occurs when K moves from at/below D to above D. A death cross is the reverse. The renderer marks the linear interpolation of the two curves, not a candle high/low.
- A golden cross is execution-eligible oscillator evidence only when the crossing pair reaches the low zone (25 or lower). A death cross is eligible only when it reaches the high zone (75 or higher). Middle-zone crosses are observations.
- Three or more consecutive bars with both K and D above 80 or below 20 are persistence/钝化. Persistence warns against fading a trend solely because the oscillator is extreme.
- D exiting below 80 or above 20 is more informative than merely entering an extreme, but still requires price confirmation.

## Divergence

- Use the smoother D line for deterministic divergence comparison; J remains an acceleration aid rather than the pivot series.
- Regular bearish/top divergence: price makes a confirmed higher high while D makes a materially lower high.
- Regular bullish/bottom divergence: price makes a confirmed lower low while D makes a materially higher low.
- Hidden bullish divergence: price makes a higher low while D makes a lower low. Hidden bearish divergence is the inverse at highs.
- Paired pivots require 4–90 bars of separation, material price separation, at least 3 D points of separation, and two closed candles on the right.
- Divergence warns that momentum did not confirm price; it does not itself prove reversal.

## Execution

KDJ supplies momentum evidence only. A scenario still waits for a closed price break of the evidence structure, uses the opposite structural extreme as invalidation, derives 1R/2R targets, expires after four bars, and is cancelled by an opposite K/D cross, loss of the evidence pivot, stale data, or price invalidation.

## Knowledge sources

- StockCharts ChartSchool, Stochastic Oscillator (Fast, Slow, and Full): https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/stochastic-oscillator-fast-slow-and-full
- Fidelity, Trading with momentum transcript: https://www.fidelity.com/bin-public/060_www_fidelity_com/documents/learning-center/trading-with-momentum-transcript.pdf
- Haolo shared alert/native-pane KDJ implementation: `src/main/trading-alerts/indicator-registry.mjs` and `src/renderer/trading-expert-indicators.ts`.
