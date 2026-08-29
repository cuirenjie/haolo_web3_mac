---
name: price-action
description: "Analyze a clean OHLC chart with deterministic price-action and candlestick-pattern rules: classify market structure and key zones; recognize top/bottom fractals, doji families, hammer/shooting-star, engulfing, harami, piercing/dark-cloud, morning/evening stars, three soldiers/crows, inside/outside confirmations, and multi-candle continuation patterns; circle and label only complete evidence; and produce a conditional execution plan. Use for 裸K分析, 价格行为学, K线形态, candlestick patterns, Price Action, market structure, or indicator-free chart analysis."
---

# Price Action

## Purpose

Run deterministic OHLC-only price-action analysis on the current closed-candle snapshot. Use `references/rules.md` and `references/candlestick-patterns.md` as the frozen knowledge boundary; the language model may explain the result but must not create structure points, patterns, zones, signals, prices, or drawings.

## Workflow

1. Classify the current market as HH/HL uptrend, LH/LL downtrend, range, or transition from confirmed swings.
2. Build price zones from repeated swing reactions and preserve support/resistance role reversal.
3. Scan the frozen 54-name candlestick catalog; validate relative body/wick geometry, prior trend, true gaps, and completion without future data.
4. Separate a complete named pattern from an actionable setup. Require context, location, and closed-candle confirmation before a pattern may strengthen a trade scenario.
5. Circle and label at most four recent, complete, de-duplicated patterns; state whether directional confirmation remains pending.
6. Require context plus location plus a closed signal bar before admitting a pullback, rejection, breakout-retest, failed-breakout, or Inside Bar scenario.
7. Keep the scenario conditional until a closed candle crosses the signal trigger. Expire or retire it after invalidation, targets, or the frozen age limit.
8. Draw structure with solid paths, patterns with controlled ellipses and text, zones and conditional levels with dashed shapes, and signal evidence with controlled arrows or notes.
9. Build `ExecutionPlanV1` only from engine-owned triggers, structural stops, two targets, validity, observation, and cancellation rules.

## Safety Boundaries

- Read time/open/high/low/close only. Do not use volume, moving averages, MACD, RSI, order flow, funding, open interest, or hidden indicators.
- OHLC can suggest buying or selling pressure; it cannot prove actual fund flow, institutional action, or aggressor volume.
- Never force a fractal, doji, hammer, star, engulfing, harami, Inside Bar, Outside Bar, or multi-candle name into a directional trade without qualified structure, location, and confirmation.
- Never relax a required real/body gap for continuous crypto data merely to make rare gap patterns appear.
- Never draw a completed, invalidated, or expired historical setup as a current opportunity.
- A no-candidate result is a successful analysis and must remain `wait`/no-trade without invented prices.
- Do not create orders or promise a reversal, continuation, target, win rate, or profit.

## Output Contract

Return the host strategy envelope with market regime, confirmed swings, key zones, candle facts, current setup/lifecycle if any, evidence-bound drawings, and a standard conditional execution plan. State the OHLC-only limitation explicitly.
