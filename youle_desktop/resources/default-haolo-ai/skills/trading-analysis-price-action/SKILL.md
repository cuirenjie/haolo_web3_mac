---
name: trading-analysis-price-action
description: "Analyze current markets using Haolo's 裸K分析 cloud strategy. Use when the user selects or requests 裸K分析, 裸K, 价格行为学, 价格行为, Price Action. Default for position adjustment without an explicitly selected strategy."
---

Read `haolo_market` context/catalog and load trading-account-read; call `haolo_account_read` before analysis. Read effective trading preferences via personal_context. Call `haolo_analysis` with `analysisKind: "strategy"`, exact strategyId `price-action`, the user's trading instruction, and `positionManagementRequested: true` for actual position management.

Ordinary market explanations and continuation questions without a requested strategy or trading plan belong to trading-market-data and `analysisKind: "general"` without strategyId. Do not turn those questions into a strategy plan.

Before live desktop analysis, load trading-chart-open and call `haolo_chart_open` for the requested pair and candle interval (default one hour). Wait for `ready: true`; use the returned chart, not the old send-time market. A chart-loading failure stops dependent analysis and drawing. Headless runs without a chart keep the explicit-market path.

Preserve the requested exchange, spot/futures, symbol, interval and horizon. Default to drawingRequested true for live decisions; explicit no-drawing wins. Then load trading-chart-draw and trading-plan-present and consume the SAME analysisRef. Cloud engine facts, model selection, risk controls, left/right/automatic entry and original price levels remain authoritative. Missing coverage, unsupported markets and no-candidate results must remain explicit; never substitute another strategy silently or invent executable levels.

For a concept-only question explain the theory without running live analysis. For multiple explicitly selected strategies run each separately and summarize their agreements/conflicts; do not blend their prices into a new executable plan. Reuse existing analysis for display-only follow-ups. This skill never creates orders.
