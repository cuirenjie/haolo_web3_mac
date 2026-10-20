---
name: trading-analysis-price-action
description: "Analyze current markets using Haolo's 裸K分析 cloud strategy. Use when the user selects or requests 裸K分析, 裸K, 价格行为学, 价格行为, Price Action. Default for position adjustment without an explicitly selected strategy."
---

Read `haolo_market` context/catalog and load trading-account-read; call `haolo_account_read` before analysis. Read effective trading preferences via personal_context. Call `haolo_analysis` with exact strategyId `price-action`, the user's trading instruction, and `positionManagementRequested: true` for actual position management.

Preserve the requested exchange, spot/futures, symbol, interval and horizon. Default to drawingRequested true for live decisions; explicit no-drawing wins. Then load trading-chart-draw and trading-plan-present and consume the SAME analysisRef. Cloud engine facts, model selection, risk controls, left/right/automatic entry and original price levels remain authoritative. Missing coverage, unsupported markets and no-candidate results must remain explicit; never substitute another strategy silently or invent executable levels.

For a concept-only question explain the theory without running live analysis. For multiple explicitly selected strategies run each separately and summarize their agreements/conflicts; do not blend their prices into a new executable plan. Reuse existing analysis for display-only follow-ups. This skill never creates orders.
