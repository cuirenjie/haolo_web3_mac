---
name: chart-patterns
description: Detect traditional multi-bar chart patterns with independent reversal, continuation, and bilateral engines; require prior-trend, geometric-touch, closed-candle breakout, false-breakout, target, and invalidation checks; draw the validated structure and boundaries; and produce a conditional execution plan. Use for head-and-shoulders, double/triple tops or bottoms, wedges, flags, pennants, cup-and-handle, triangles, rectangles, support/resistance breakouts, or traditional chart-pattern analysis on the current market chart.
---

# Chart Patterns

## Purpose

Run deterministic traditional chart-pattern analysis on the current closed-candle snapshot. Treat the model as an explanation layer only: geometry, points, breakout state, prices, targets, invalidation, and drawings must come from the rule engine.

## Workflow

1. Read `references/rules.md` before changing or interpreting pattern rules.
2. Preserve the three independent subengines: reversal, continuation, and bilateral.
3. Require the applicable prior trend, geometric touches, minimum depth, and duration before naming a pattern.
4. Keep a qualified structure `developing` until a closed candle breaks the deterministic boundary.
5. Mark a breakout `failed` when price closes back through the broken boundary within the defined confirmation window.
6. Draw current validated structure with solid lines and boundaries with dashed lines. Keep recent completed/failed/expired structures as dotted historical references without execution levels; show at most three distinct structures and reserve detailed labels for the primary one.
7. Build `ExecutionPlanV1` from engine-owned triggers, stops, height/flagpole targets, validity, and cancellation rules.
8. Respect parent-framework room restrictions per direction in reports, conditional plans and native drawings. A blocked candidate remains visible for observation; never reconstruct its suppressed entry from geometric levels. Retest contraction and climactic-volume retests are context only.

## Safety Boundaries

- Never invent a pattern to avoid a no-candidate result.
- Never use an intrabar wick alone as breakout confirmation.
- Never present a developing bilateral pattern as directional; expose both conditional scenarios until a close selects direction.
- Never call gaps, candlesticks, harmonic ratios, Elliott waves, or single-bar formations a traditional multi-bar chart-pattern candidate.
- Never guarantee a reversal, continuation, target, or profit.
- Do not create orders. Output analysis, controlled drawings, and a conditional plan only.

## Output Contract

Return the strategy envelope through the host coordinator. The report must state:

- category, pattern, direction, and lifecycle state;
- validated points, boundaries, and breakout evidence;
- whether the prior trend and geometry passed;
- long/short trigger conditions as applicable;
- stop/invalidation, two projected targets, risk/reward, observation conditions, expiry, and cancellation rules;
- data limitations and false-breakout risk.
- retest, volume availability, same-timeframe nesting and opposing active scenarios when present; never equate swing scales with independently fetched timeframes.

Version 2.1 covers 28 definitions including channels, broadening structures, rounding tops/bottoms, inverse cup and handle, diamonds and the MA5/10/60 old-duck-head convention. See the rulebook for supported versus research-only families. Human interpretation and unreviewed video material are not deterministic signals.

