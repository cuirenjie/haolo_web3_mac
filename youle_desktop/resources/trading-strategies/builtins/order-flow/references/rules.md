# Order-flow runtime rules

- First-party runtime support is limited to markets with verified trade and depth data; the current built-in implementation uses Binance perpetual inputs.
- Preserve coverage labels: `available`, `delayed`, `partial`, and `unavailable`.
- Require at least the engine's existing minimum active trades and bilateral depth levels. Missing required coverage must produce `TRADING_ORDER_FLOW_INSUFFICIENT_DATA`.
- Static REST depth is partial, not a historical order-book replay. Liquidations remain unavailable unless an actual source is supplied.
- Align live order-flow facts to their real time window. Historical OB/FVG/liquidity structures are OHLCV-derived ICT/SMC facts, not historical order flow.
- Keep the existing `ai/order-flow` layer, semantic token whitelist, structure budget, and final drawing-operation cap.
- Treat loss of required coverage as an execution-plan cancellation condition.
