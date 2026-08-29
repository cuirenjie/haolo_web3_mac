---
name: dow-theory
description: "Analyze the current market with deterministic Dow Theory rules: separate primary, secondary, and minor trends; classify confirmed HH/HL or LH/LL structure; require closing-price confirmation; treat volume as secondary evidence; distinguish higher-timeframe alignment from classic inter-market averages confirmation; draw trend structure; and produce a conditional execution plan. Use for 道氏理论, 道氏趋势, Dow Theory, primary trend, secondary reaction, trend continuation/reversal confirmation, or when another strategy needs an independent trend-regime context. Do not use merely to name Elliott waves, chart patterns, or candlestick patterns."
---

# Dow Theory

## Purpose

Run the independent deterministic Dow trend-context engine. Read `references/rules.md` before explaining or applying its terminology. Let the engine own all pivots, trend states, confirmations, prices, drawings, and execution levels; use the language model only to route the request and explain frozen results.

## Workflow

1. Exclude unclosed candles before calculating any structure or confirmation.
2. Separate primary, secondary, and minor movement with independent confirmed-pivot scales.
3. Classify the primary trend from successive reaction highs and lows; preserve neutral/transition when the sequences disagree.
4. Require a candle close beyond the latest reaction level. Treat a wick-only breach as unconfirmed.
5. Read optional higher-timeframe candles as product context. Never call them classic Dow averages confirmation.
6. Use volume only as auxiliary confirmation; never let it create or reverse the price trend by itself.
7. Mark classic inter-market confirmation unavailable unless a qualified companion market/average is actually supplied.
8. Draw the primary trend as a solid path, secondary movement as a dotted path, confirmed swing labels, and conditional trigger/stop/target levels.
9. Produce `ExecutionPlanV1` from engine-owned structure levels. Keep the action at wait until closed-candle and retest conditions are satisfied.

## Composition Boundary

- Invoke this Skill independently when the user asks for trend regime, primary/secondary movement, or Dow confirmation.
- Allow wave, chart-pattern, harmonic, and price-action strategies to consume its future stable context output only through an explicit capability declaration.
- Do not make those strategies depend on Dow output implicitly, and do not use Dow to rename their structures.
- Prefer a more specific strategy when the request is specifically about Elliott wave counts, named chart patterns, harmonic ratios, or candlestick combinations.

## Safety Boundaries

- Do not infer a classic paired-average confirmation from BTC/ETH correlation or multiple timeframes.
- Do not label accumulation, public participation, distribution, or panic phases from OHLC alone; report the phase as indeterminate unless the dedicated evidence contract is available.
- Do not count intrabar highs/lows as closing confirmation.
- Do not invent a trigger, stop, target, probability, win rate, market phase, or companion market.
- A neutral or conflicting structure is a successful analysis and must remain wait/no-trade.
- Do not create, modify, or submit orders.

## Output Contract

Return the host strategy envelope with three trend scales, close-confirmation state, optional higher-timeframe context, auxiliary volume state, explicit classic-confirmation coverage, evidence-bound drawings, and a standard conditional execution plan.
