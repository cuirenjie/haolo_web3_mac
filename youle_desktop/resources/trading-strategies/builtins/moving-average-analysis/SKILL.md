---
name: moving-average-analysis
description: "Analyze a simple moving-average system from closed OHLC candles using deterministic MA5, MA20, and MA60 rules. Detect bullish/bearish alignment, confirmed golden/death crosses, ribbon compression and expansion, and trend-aligned pullback or rally rejection; show the native MA overlay, draw confirmed evidence, and produce a conditional execution plan. Use for 均线、MA、SMA、移动平均线、均线系统、多头排列、空头排列、金叉、死叉、均线粘合、发散、回踩 or 反抽 analysis."
---

# Moving Average Analysis

## Purpose

Run deterministic moving-average analysis on the current chart. Read `references/rules.md` as the frozen knowledge boundary. The model may explain engine results, but must not invent averages, slopes, crosses, alignments, support/resistance, prices, patterns, or drawings.

## Workflow

1. Use only closed candles and calculate the native simple moving averages MA5, MA20, and MA60 from close prices.
2. Classify price position, three-line ordering, normalized slopes, ribbon width, compression percentile, and trend regime.
3. Detect persisted golden/death crosses, compression followed by ordered expansion, and trend-aligned MA20 pullback/rejection confirmations. Report no-pattern when requirements do not hold.
4. Auto-display the native MA overlay and draw only confirmed evidence, leader lines, triggers, invalidations, and targets owned by this Skill.
5. Generate a conditional `ExecutionPlanV1`. A price/MA touch, one-bar crossover, or alignment state alone never creates an order.

## Safety Boundaries

- Do not use an unfinished candle to confirm a cross, alignment, expansion, retest, drawing, or execution trigger.
- Treat moving averages as lagging trend evidence, not predictors or exact support/resistance prices.
- Require a cross to persist for another closed candle; downgrade crosses against MA60 direction and price context to observation only.
- Treat a moving average as a dynamic zone with volatility tolerance, never an exact guaranteed barrier.
- Keep SMA and EMA semantics separate. This Skill uses SMA5/SMA20/SMA60 and must match the native MA overlay.
- A valid no-pattern result is successful analysis and remains wait/no-trade.
- Never create orders, promise profit, or use future candles.

## Output Contract

Return the shared strategy envelope with regime, confirmed structures, closed-candle coverage, isolated drawings, and a standard conditional execution plan.
