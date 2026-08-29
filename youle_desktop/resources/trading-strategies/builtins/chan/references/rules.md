# Chan runtime rules

- Preserve the host engine's inclusion processing, confirmed fractals, pen endpoints, centers, stable IDs, and version.
- A structure can be `confirmed`, `tentative`, or `invalidated`; do not silently rewrite its historical state.
- Use the latest confirmed center, nearby pen extrema, recent support/resistance, and volatility-derived distance only when supplied by the engine.
- Require the current interval's closed candle to confirm a breakout. Treat a quick return to the waiting range as a false breakout.
- Keep `ai/chan` isolated from manual drawings and other strategy layers.
- Use only `chan-pen`, `chan-center`, `chan-top`, `chan-bottom`, and `chan-note` semantic colors.
- When evidence is insufficient, return `wait`, `no_trade`, or `insufficient_data` instead of creating a complete-looking setup.
