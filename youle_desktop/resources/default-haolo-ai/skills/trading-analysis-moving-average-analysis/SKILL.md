---
name: trading-analysis-moving-average-analysis
description: "Analyze current markets using Haolo's 均线 cloud indicator. Use when the user selects or requests 均线, MA, MA指标, 移动平均线, 均线系统. Preserve explicit selection of this strategy."
---

Read `haolo_market` context/catalog and load trading-account-read; call `haolo_account_read` before analysis. Read effective trading preferences via personal_context. Call `haolo_analysis` with exact strategyId `moving-average-analysis`, the user's trading instruction, and `positionManagementRequested: true` for actual position management.

Preserve the requested exchange, spot/futures, symbol, interval and horizon. Default to drawingRequested true for live decisions; explicit no-drawing wins. Then load trading-chart-draw and trading-plan-present and consume the SAME analysisRef. Cloud engine facts, model selection, risk controls, left/right/automatic entry and original price levels remain authoritative. Missing coverage, unsupported markets and no-candidate results must remain explicit; never substitute another strategy silently or invent executable levels.

For a concept-only question explain the theory without running live analysis. For multiple explicitly selected strategies run each separately and summarize their agreements/conflicts; do not blend their prices into a new executable plan. Reuse existing analysis for display-only follow-ups. This skill never creates orders.
