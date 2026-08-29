---
name: order-flow
description: Analyze Haolo-provided real aggregate trades, order-book depth, open interest, and deterministic ICT/SMC structure; draw only verified order-flow evidence and produce a conditional execution plan. Use for order-flow, Delta/CVD, POC, liquidity, imbalance, or current-chart execution analysis.
---

# Order-flow Analysis

Require real structured order-flow inputs. Never substitute OHLCV, screenshots, or model guesses for trades, depth, open interest, or liquidation data.

## Workflow

1. Treat the visible candle range as the starting context only; let the host expand the chart leftward when the candle background is below its minimum before reading venue, market type, time window, and coverage for trades, depth, open interest, and liquidations.
2. Fail closed when required trade or depth coverage is missing.
3. Use deterministic Delta/CVD, POC, imbalance, large-trade, depth, OI, and ICT/SMC candidate IDs.
4. Keep live micro-window evidence on its actual execution candle; do not project it onto unrelated history.
5. Select only the most important structure and order-flow evidence for drawing.
6. Finish with `ExecutionPlanV1`, using closed-candle confirmation and explicit data-loss cancellation.

Read [references/rules.md](references/rules.md) for complete coverage and drawing constraints.

## Boundaries

- Do not run as real order flow on unsupported markets.
- Do not invent liquidation coverage.
- Do not expose raw credentials or bypass the host data broker.
- Do not place orders.
