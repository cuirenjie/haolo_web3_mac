---
name: chan
description: Analyze structured K-line data with Haolo's deterministic Chan Theory engine, explain confirmed and tentative fractals, pens, centers, divergence, and conditional trade levels, and produce an evidence-bound execution plan. Use for Chan Theory questions, current-chart analysis, controlled drawing, or execution-plan generation.
---

# Chan Analysis

Treat the deterministic engine output as the source of truth. Use the model to resolve ambiguity and explain the selected candidates; never invent prices, structures, or drawings.

## Workflow

1. Confirm the market, interval, analysis end time, and data freshness. Treat the visible range as the starting window only; when it cannot form a valid pen structure, let the host expand the chart leftward and retry with more historical candles.
2. Separate confirmed, tentative, and invalidated structures.
3. Reference only engine-provided fractal, pen, center, level, and evidence IDs.
4. Express both the preferred scenario and its invalidation; retain a wait state inside the trigger range.
5. Emit drawing intents only through the host Drawing Gateway.
6. Finish with the host `ExecutionPlanV1`, including trigger, stop/invalidation, target, risk, expiry, and cancellation conditions.

Read [references/rules.md](references/rules.md) when reviewing a complete chart or explaining a disputed structure.

## Boundaries

- Do not interpret a screenshot as precise market data.
- Do not report model confidence as a calibrated win rate.
- Do not claim that a drawing exists unless the host confirms the DrawingPatch.
- Do not place orders or calculate quantity without authorized account and contract data.
