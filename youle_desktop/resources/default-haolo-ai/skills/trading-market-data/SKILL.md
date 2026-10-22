---
name: trading-market-data
description: Answer ordinary market questions about price changes, trends and continuation using current evidence; resolve the chart, inspect candles and discover available strategies and pending workflows in Haolo.
---

Use `haolo_market` operation `context`, `data` or `catalog`. Captured chart candles describe what the user was viewing; cloud analysis fetches authoritative data. Do not reuse another conversation's active chart. Preserve explicit exchange, spot/futures, symbol, interval and visible range. A forecast horizon is not a candle interval.

If no chart exists, use an explicit market/symbol for analysis; clarify genuinely ambiguous targets. An explicit USDT/USDC pair retains the product default Binance perpetual / one hour unless overridden. Only run available catalog IDs; personal IDs must come from the current catalog.

For ordinary market questions (for example, "why did Bitcoin suddenly rise?" or "can it keep rising?"), answer the actual question in final text. If candles alone are insufficient, read the account and call `haolo_analysis` with `analysisKind: "general"` and no `strategyId`. General analysis does not automatically draw or create a plan; request drawing only if the user asks. Do not call `haolo_plan_present` for a general result. Explain observed facts, supported hypotheses and continuation/invalidation conditions. Read relevant news or positioning data before claiming a news catalyst, liquidations or open-interest change; otherwise state the evidence limit.

Use a matching trading-analysis-* Skill and `analysisKind: "strategy"` for a requested strategy/indicator, trading plan or position-management task. A question about future direction alone is not a request to open a position.

For position management set `positionManagementRequested: true`, read real positions and open orders, and combine the complete report with returned `positionReview` in your final answer. It is not a completed position card. An open chart never makes unrelated writing, code, knowledge or file questions trading requests. Tools supply evidence; final text must address every requested question and disclose any unresolved evidence gaps.

For live desktop analysis load trading-chart-open first. Open and verify the requested pair and candle interval (default one hour) before analysis. After successful opening, context/data reflects that verified chart for this turn; never continue using the old send-time pair or period.
