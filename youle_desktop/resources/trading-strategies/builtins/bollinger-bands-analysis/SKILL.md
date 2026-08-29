---
name: bollinger-bands-analysis
description: "Analyze Bollinger Bands from closed OHLC candles with deterministic 20-period SMA and 2-standard-deviation rules. Detect BandWidth squeeze and expansion, confirmed band breakouts, upper/lower band walks, head fakes, and classic M-top/W-bottom structures; show the native BOLL overlay, draw evidence, and produce a conditional execution plan. Use for 布林带、布林线、BOLL、Bollinger Bands、缩口/开口、沿上轨/下轨运行、M顶 or W底 analysis."
---

# Bollinger Bands Analysis

## Purpose

Run deterministic Bollinger Bands analysis on the current chart. Read `references/rules.md` as the frozen knowledge boundary. The model may explain engine results, but must not invent band values, BandWidth, %B, squeezes, breakouts, pivots, patterns, prices, or drawings.

## Workflow

1. Use only closed candles and calculate the middle SMA(20), upper/lower bands at two population standard deviations, BandWidth, and %B.
2. Classify price location, middle-band slope, BandWidth percentile, squeeze/normal/expansion regime, and upper/lower band walk.
3. Detect confirmed squeeze breakouts, failed breakouts, classic M tops, and classic W bottoms from bounded price-and-band sequences. Report no-pattern when requirements do not hold.
4. Auto-display the native BOLL overlay and draw only confirmed structure, squeeze ranges, event labels, triggers, invalidations, and targets owned by this Skill.
5. Generate a conditional `ExecutionPlanV1`. A band touch or indicator state alone never creates an order; execution waits for a closed price trigger.

## Safety Boundaries

- Do not use an unfinished candle to confirm a squeeze exit, breakout, band walk, M/W pattern, or execution trigger.
- Do not call an upper-band touch overbought or a lower-band touch oversold. A touch is context, not a signal.
- Treat closes outside a band as initial continuation evidence unless a separate failed-breakout sequence is confirmed.
- A squeeze forecasts potential volatility expansion, not direction. Keep the plan neutral until price confirms direction.
- Use the simple moving average consistently for the middle band and deviation window; do not mix EMA and SMA formulas.
- A valid no-pattern result is successful analysis and remains wait/no-trade.
- Never create orders, promise profit, or use future candles.

## Output Contract

Return the shared strategy envelope with band state, confirmed structures, closed-candle coverage, isolated drawings, and a standard conditional execution plan.
