---
name: macd-analysis
description: "Analyze MACD from closed OHLC candles with deterministic 12/26/9 rules. Detect signal/zero-axis crosses, histogram expansion and contraction, the eight Chinese classic combinations (佛手向上、小鸭出水、漫步青云、天鹅展翅、空中缆绳、空中缆车、海底电缆、海底捞月), regular and hidden price divergences, and produce evidence-bound drawings plus a conditional execution plan. Use for MACD 指标分析、MACD 形态、顶背离、底背离 or momentum/trend confirmation."
---

# MACD Analysis

## Purpose

Run deterministic MACD analysis on the current chart. Read `references/rules.md` as the frozen knowledge boundary. The model may explain engine results, but must not invent DIF, DEA, histogram, pivots, crossings, patterns, divergence, prices, or drawings.

## Workflow

1. Use only closed candles and calculate EMA(12), EMA(26), DIF, DEA(9), and histogram `DIF - DEA`.
2. Classify zero-axis location, DIF/DEA cross state, histogram sign, expansion/contraction, and whipsaw risk.
3. Scan the eight classic Chinese combination patterns as ordered state sequences; report confirmed, forming, or absent without forcing a name.
4. Detect regular and hidden bullish/bearish divergence from confirmed price pivots and aligned DIF/histogram extrema.
5. Auto-display the MACD pane and draw only price-side evidence, trigger, invalidation, and targets owned by this Skill.
6. Generate a conditional `ExecutionPlanV1`. MACD alone remains supporting evidence; require a closed price trigger before execution.

## Safety Boundaries

- Do not use an unfinished candle to confirm a cross, pattern, divergence, or trigger.
- Do not call MACD overbought/oversold; it is a trend/momentum oscillator.
- Do not claim institutions, accumulation, distribution, or guaranteed reversal from a named pattern.
- Do not substitute the Chinese `2 * (DIF - DEA)` bar convention for this product's normalized `DIF - DEA`; sign and cross timing are equivalent, magnitude is not.
- Downgrade shallow/short divergence and frequent signal crosses in ranges.
- A valid no-pattern/no-divergence result is successful analysis and remains wait/no-trade.
- Never create orders, promise profit, or use future candles.

## Output Contract

Return the shared strategy envelope with indicator state, classic patterns, divergence evidence, coverage, isolated drawings, and a standard conditional execution plan.
