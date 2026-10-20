---
name: trading-market-data
description: Resolve the send-time market/chart, inspect captured candles, find pending trading workflows and discover exact available strategy/indicator IDs in Haolo.
---

Use `haolo_market` operation `context`, `data` or `catalog`. Captured chart candles describe what the user was viewing; cloud analysis fetches authoritative data. Do not reuse another conversation's active chart. Preserve explicit exchange, spot/futures, symbol, interval and visible range. A forecast horizon is not a candle interval.

If no chart exists, use an explicit market/symbol for analysis; clarify genuinely ambiguous targets. An explicit USDT/USDC pair retains the product default Binance perpetual / one hour unless overridden. Only run available catalog IDs; personal IDs must come from the current catalog.
