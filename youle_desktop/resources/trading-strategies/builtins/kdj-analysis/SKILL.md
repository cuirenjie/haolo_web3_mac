---
name: kdj-analysis
description: "Analyze KDJ(9,3,3) from closed OHLC candles with deterministic rules. Classify K/D/J state, 80/20 extremes and persistence; detect exact K/D golden/death crosses plus confirmed regular/hidden D-line divergences; draw evidence in the KDJ pane; and produce a conditional execution plan. Use for KDJ 指标分析、随机指标、KDJ 金叉/死叉、超买超卖、钝化、J 线极值、顶背离、底背离或隐藏背离。"
---

# KDJ Analysis

## Purpose

Run deterministic KDJ analysis on the current chart. Read `references/rules.md` as the frozen knowledge boundary. The model may explain engine results, but must not invent K/D/J values, crosses, extreme events, pivots, divergences, prices, or drawings.

## Workflow

1. Use only closed candles and calculate KDJ(9,3,3) with K/D initialized at 50, matching the native KDJ pane and alert evaluator. Preserve the unbounded J value.
2. Classify K/D 80/20 location, D-line direction, K/D/J alignment, J extremes, and multi-bar high/low persistence.
3. Locate each K/D cross at its interpolated geometric intersection. Treat low-zone golden crosses and high-zone death crosses as stronger evidence; middle-zone crosses remain observations.
4. Detect regular and hidden bullish/bearish divergence against the smoother D line only from confirmed price pivots with bounded spacing and material separation.
5. Auto-display the KDJ pane and keep oscillator evidence in that pane. Match the RSI annotation style: a small point at the exact target, a 0.8-width near-vertical dashed leader whose endpoint is one second later so time stays strictly ascending and leaders cannot cross, and unbold text anchored to the original candle and arranged downward in separate low rows with no second label marker. Keep the price chart limited to conditional trigger, invalidation, and targets.
6. Generate a conditional `ExecutionPlanV1`. KDJ remains supporting evidence; require a closed price-structure trigger before execution.

## Safety Boundaries

- Do not use an unfinished candle to confirm a cross, pivot, divergence, extreme exit, or price trigger.
- Do not equate KDJ above 80 with an automatic short or below 20 with an automatic long. Strong trends can remain extreme and persist.
- Do not clamp J to 0–100, and do not use a J extreme as a standalone order signal.
- Do not force divergence by pairing unrelated highs/lows or using an unconfirmed right-edge pivot.
- A valid no-cross/no-divergence result is successful analysis and remains wait/no-trade.
- Never create orders, promise profit, or use future candles.

## Output Contract

Return the shared strategy envelope with KDJ state, exact K/D crosses, extreme/persistence events, D-line divergence evidence, coverage, isolated KDJ-pane drawings, and a standard conditional execution plan.
