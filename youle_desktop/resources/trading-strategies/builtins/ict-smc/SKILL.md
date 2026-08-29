---
name: ict-smc
description: "Analyze liquidity pools and sweeps, displacement, BOS/CHoCH/MSS, fair value gaps, order blocks, breakers, dealing ranges, premium/discount and OTE with deterministic ICT/SMC rules, chart drawings, and a conditional execution plan. Use for ICT, SMC, Smart Money Concepts, 聪明钱概念, 流动性清扫, FVG, OB, MSS, BOS, CHoCH, Breaker or OTE. Do not use for real trades, depth, CVD, footprint, open interest, or classic cross-market SMT divergence."
---

# ICT / SMC

Read `references/rules.md`, then run the independent deterministic ICT/SMC chain. Let the engine own closed-candle structure, zones, liquidity, drawings and price levels; use the model only to route and explain frozen evidence.

1. Classify liquidity, displacement and confirmed structure before any zone.
2. Accept an OB only when linked to displacement and a structure break; treat FVG as imbalance, never proof of zero trading.
3. Keep historical ICT labels explicitly OHLCV-derived. Never call them real order-flow evidence.
4. Require liquidity event, displacement/MSS and PD Array retest in sequence before execution.
5. Return a wait-first `ExecutionPlanV1`; never create or submit orders.
