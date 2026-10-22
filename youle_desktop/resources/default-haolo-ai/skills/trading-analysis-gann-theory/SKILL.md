---
name: trading-analysis-gann-theory
description: "Analyze current markets using Haolo's 江恩理论 cloud strategy. Use when the user selects or requests 江恩理论, 江恩, 江恩角度线, Gann Theory. Preserve explicit selection of this strategy."
---

Read `haolo_market` context/catalog and load trading-account-read; call `haolo_account_read` before analysis. Read effective trading preferences via personal_context. Call `haolo_analysis` with `analysisKind: "strategy"`, exact strategyId `gann-theory`, the user's trading instruction, and `positionManagementRequested: true` for actual position management.

Ordinary market explanations and continuation questions without a requested strategy or trading plan belong to trading-market-data and `analysisKind: "general"` without strategyId. Do not turn those questions into a strategy plan.

Before live desktop analysis, load trading-chart-open and call `haolo_chart_open` for the requested pair and candle interval (default one hour). Wait for `ready: true`; use the returned chart, not the old send-time market. A chart-loading failure stops dependent analysis and drawing. Headless runs without a chart keep the explicit-market path.

Preserve the requested exchange, spot/futures, symbol, interval and horizon. Default to drawingRequested true for live decisions; explicit no-drawing wins. Load trading-chart-draw and consume the SAME analysisRef. For requested strategy/new-entry plans also load trading-plan-present. Cloud engine facts, model selection, risk controls, left/right/automatic entry and original price levels remain authoritative. Missing coverage, unsupported markets and no-candidate results must remain explicit; never substitute another strategy silently or invent executable levels.

For existing-position health/adjustment, read summary, positions and open_orders; analyze each requested holding, not just the visible chart. Use the full report and returned positionReview in a substantive final answer: health, add/reduce/hold/exit conclusion with reasons, actual entry/quantity, measured net loss against account-equity limits, relevant reference prices and data gaps. Never substitute a new-entry trigger for the actual entry, a hypothetical stop for a verified protective order, or wait/no-trade for a safety judgment. Reduction estimates include loss realized at the current mark. Do not call trading-plan-present for position evidence. Missing/unavailable/stale facts cannot establish safety or justify invented quantities.

Tool success, drawings and cards are evidence/artifacts; they never complete the user's whole request. Always answer the actual questions in final text, including requested comparisons and non-trading work. Do not just say the answer was displayed or repeat the scan notification. Avoid copying a complete price table already visible in a plan card.

For a concept-only question explain the theory without running live analysis. For multiple explicitly selected strategies run each separately and summarize their agreements/conflicts; do not blend their prices into a new executable plan. Reuse existing analysis for display-only follow-ups. This skill never creates orders.
