---
name: trading-chart-open
description: Open a Haolo trading pair and candle interval before live chart analysis, drawing and plan presentation, or when asked to switch a chart. Defaults to one hour when the user omits the candle interval.
---

Read `haolo_market` context and resolve the requested trading pair and candle interval. Preserve explicit exchange and spot/perpetual selection. Resolve names such as 以太坊/ETH to ETHUSDT; an unqualified pair uses Binance perpetual. Without a named pair, use this conversation's captured market. An omitted candle interval means `1h`; a forecast such as “未来4小时” does not select 4h candles.

Known Chinese names may be passed directly as `symbol`: 闪迪 → SNDKUSDT, 海力士 → SKHYNIXUSDT, 美光 → MUUSDT, 黄金 → XAUUSDT, 谷歌 → GOOGLUSDT. 原油/WTI原油 defaults to CLUSDT; explicit 布伦特原油 uses BZUSDT. The host resolves aliases and verifies availability; these names do not imply a real equity or physical commodity purchase. Preserve an explicit different market and the user's saved alias preferences. For an unknown or ambiguous name, resolve the exact catalog identity or clarify rather than inventing a symbol.

Call `haolo_chart_open` with `symbol` or the exact `marketId`, and `interval` when specified. It reuses a matching loaded chart or opens the requested market/period. A different pair OR period requires switching. Wait for `ready: true` and verify the returned `chart` before live analysis. Do not treat a submitted navigation or a cloud analysis result as proof that the visible chart is ready.

For example, from BTCUSDT 1h, “分析ETH 4小时的行情” opens ETHUSDT 4h; “分析以太坊” opens ETHUSDT 1h. From ETHUSDT 4h, “分析ETH 1小时” changes the interval even though the pair matches.

Continue the user's requested work in the same turn: account read → selected analysis Skill → chart drawing → plan presentation. All use the returned chart and the SAME analysisRef. Omit redundant market/interval arguments to analysis after opening, or pass exactly the returned target. Preserve no-drawing requests; a chart-switch-only request stops after opening.

The Host safely rebinds a rebuilt chart within the same account and conversation, with at most one internal retry if it is replaced during loading. On loading failure or cancellation, stop dependent analysis/drawing and report the failure. Never recover by taking screenshots, using shell/UI automation or repeatedly calling chart open. A terminal error requires a new user request before retrying. Explicitly name any strategy that did not complete and retain completed strategy results; chart interpretation cannot replace a failed strategy result. If the user switched conversations, do not borrow or change the other conversation's chart. Headless scheduled/channel work without a desktop chart uses its existing explicit-market analysis path and must not claim a chart was opened.
