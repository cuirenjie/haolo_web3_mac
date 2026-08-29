---
name: smt-divergence
description: "Validate bullish or bearish SMT divergence between demonstrably correlated markets using synchronized closed candles, Hyperliquid comparison data, explicit correlation and alignment gates, chart evidence, and a confirmation-only execution plan. Use for SMT divergence, Smart Money Technique, correlated-market non-confirmation, ES/NQ-style divergence, BTC/ETH divergence, or cross-venue confirmation. Do not treat SMT as an independent entry signal or proof of manipulation."
---

# SMT Divergence

Read `references/rules.md`, then run the deterministic cross-market engine.

1. Use synchronized, fully closed candles and reject insufficient alignment.
2. Verify recent return correlation before comparing highs or lows.
3. Mark bearish SMT only when one market makes a higher high and the other fails; mark bullish SMT only when one makes a lower low and the other fails.
4. Use Hyperliquid same-asset data only as cross-venue quality confirmation; use a correlated asset for classic SMT.
5. Require local displacement, MSS and a PD Array retest before any execution scenario. SMT alone always means wait.
