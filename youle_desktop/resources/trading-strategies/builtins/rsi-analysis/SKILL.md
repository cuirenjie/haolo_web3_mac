---
name: rsi-analysis
description: "Analyze Wilder RSI(14) from closed OHLC candles with deterministic rules. Classify 70/30 extremes, the 50 centerline and trend ranges; detect confirmed regular/hidden divergences and bullish/bearish failure swings; draw evidence in the RSI pane; and produce a conditional execution plan. Use for RSI 指标分析、相对强弱指标、超买超卖、顶背离、底背离、隐藏背离或失败摆动。"
---

# RSI Analysis

## Purpose

Run deterministic RSI analysis on the current chart. Read `references/rules.md` as the frozen knowledge boundary. The model may explain engine results, but must not invent RSI values, threshold events, pivots, divergences, failure swings, prices, or drawings.

## Workflow

1. Use only closed candles and calculate Wilder RSI(14), matching the native RSI pane and alert evaluator.
2. Classify 70/30 location, 50-centerline relation, current slope, and bullish/bearish/neutral RSI range regime.
3. Detect regular and hidden bullish/bearish divergence only from confirmed price pivots with bounded spacing and material RSI separation.
4. Detect bullish and bearish failure swings as a complete four-stage RSI sequence ending with a closed-bar break of the intervening swing.
5. Auto-display the RSI pane and place divergence, failure-swing, and threshold evidence only in that pane. Anchor every annotation with a small point, arrange labels downward in separate low-RSI rows, and connect each label back to its exact point with a thin near-vertical dashed leader whose endpoint is one second later. This strict-time epsilon satisfies the chart renderer while remaining visually vertical and prevents leaders from crossing. Keep label text anchored to the original candle, suppress the label anchor shape, and do not use oversized or overlapping default markers. Keep the price chart limited to conditional trigger, invalidation, and targets.
6. Generate a conditional `ExecutionPlanV1`. RSI remains supporting evidence; require a closed price-structure trigger before execution.

## Safety Boundaries

- Do not use an unfinished candle to confirm a threshold event, pivot, divergence, failure swing, or trigger.
- Do not equate RSI above 70 with an automatic short or below 30 with an automatic long. Strong trends can remain extreme.
- Do not force a divergence by pairing unrelated highs/lows or by using unconfirmed right-edge pivots.
- Do not confuse RSI with relative-strength comparison against a benchmark.
- A valid no-pattern/no-divergence result is successful analysis and remains wait/no-trade.
- Never create orders, promise profit, or use future candles.

## Output Contract

Return the shared strategy envelope with RSI state, threshold events, failure swings, divergence evidence, coverage, isolated RSI-pane drawings, and a standard conditional execution plan.
