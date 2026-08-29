# RSI deterministic rules v1

## Formula and completion

- Period: 14. Seed average gain/loss with the first 14 close-to-close changes, then use Wilder smoothing: `(previous_average * 13 + current_value) / 14`.
- `RS = average gain / average loss`; `RSI = 100 - 100 / (1 + RS)`. If both averages are zero, RSI is 50; if only average loss is zero, RSI is 100.
- Only closed candles participate. All threshold crossings and pattern completion points occur on a closed candle.

## Zones, centerline, and ranges

- Above 70 is traditionally overbought and below 30 oversold. These are momentum states, not automatic reversal or order signals.
- Above/below 50 supplies positive/negative momentum context.
- A bullish range is typically around 40–90 with 40–50 support; a bearish range is typically around 10–60 with 50–60 resistance. The engine reports a range regime only when a bounded recent window materially exhibits it.
- During strong trends RSI can remain above 70 or below 30 for an extended period; never fade an extreme without independent confirmation.

## Divergence

- Regular bearish/top divergence: price makes a confirmed higher high while RSI makes a materially lower high.
- Regular bullish/bottom divergence: price makes a confirmed lower low while RSI makes a materially higher low.
- Hidden bullish divergence: price makes a higher low while RSI makes a lower low.
- Hidden bearish divergence: price makes a lower high while RSI makes a higher high.
- Price pivots require two closed candles on the right. Paired pivots need bounded age, minimum spacing, material price separation, and at least 2.5 RSI points of separation.
- Divergence warns that momentum did not confirm price; it does not itself prove a reversal.

## Failure swings

- Bullish/bottom failure swing: RSI first falls to/below 30, rebounds to a swing high, pulls back to a higher RSI low, then closes above the intervening RSI high.
- Bearish/top failure swing: RSI first rises to/above 70, falls to a swing low, rebounds to a lower RSI high, then closes below the intervening RSI low.
- All four stages must be present in order and complete on closed candles. An incomplete sequence remains absent rather than being labeled early.

## Execution

RSI supplies momentum and exhaustion context only. A scenario still waits for a closed price break of the evidence structure, uses the opposite structural extreme as invalidation, derives 1R/2R targets, expires after four bars, and is cancelled by an opposite RSI sequence, loss of the evidence pivot, stale data, or price invalidation.

## Knowledge sources

- Fidelity Technical Indicator Guide, Relative Strength Index: https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi
- StockCharts ChartSchool, Relative Strength Index: https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi
