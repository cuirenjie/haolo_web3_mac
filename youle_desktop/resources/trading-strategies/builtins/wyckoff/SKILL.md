---
name: wyckoff
description: Analyze deterministic Wyckoff trading ranges, volume-price evidence, phases, and events; distinguish accumulation, distribution, and unconfirmed ranges; draw trusted candidates and produce a conditional execution plan. Use for Wyckoff questions, chart analysis, event labeling, or execution planning.
---

# Wyckoff Analysis

Treat a range as accumulation or distribution only when deterministic volume-price and event evidence supports it. Never fill missing phases for narrative completeness.

## Workflow

1. Treat the visible range as the starting window only; if it is below the hard minimum or cannot form a range, let the host expand leftward and load older history before deciding that the structure is insufficient. Confirm that the market forms a rotational range rather than a one-way trend.
2. Review spread, volume, boundary tests, breakout quality, and engine-provided event IDs.
3. Mark events as confirmed or tentative and preserve alternate scenarios.
4. Explain the range, preferred bias, confirmation, invalidation, and first target in plain language.
5. Draw only trusted range, event, projection, and note intents through the host gateway.
6. Finish with `ExecutionPlanV1`, requiring closed-candle confirmation and post-break retest evidence.

Read [references/rules.md](references/rules.md) when reviewing complete A-E phase or event claims.

## Boundaries

- Do not equate every sideways range with accumulation or distribution.
- Do not label PS/SC/AR/ST/Spring/UTAD/SOS/SOW/LPS/LPSY without matching evidence.
- Do not present OHLCV structure as real order flow.
- Do not place orders.
