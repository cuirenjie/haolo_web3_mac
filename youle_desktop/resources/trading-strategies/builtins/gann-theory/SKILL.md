---
name: gann-theory
description: "Analyze a chart with deterministic, scale-aware Gann methods: choose a confirmed pivot, calibrate price per bar, draw the nine Gann fan angles, partition a Gann square/box, render nested time-price squares as wheel-in-wheel, calculate Square of Nine numeric-spiral price levels, and produce a conditional execution plan. Use for 江恩理论, 江恩角度线, 1x1, 江恩方格, 轮中轮, Square of Nine, 数字螺旋, price-time symmetry, or Gann time/price cycles. Do not use merely for ordinary trendlines, Fibonacci ratios, Elliott waves, astrology, or untestable date numerology."
---

# Gann Theory

## Purpose

Run the independent deterministic Gann time-price geometry engine. Read `references/rules.md` before explaining or applying the strategy. Let the engines own candle closure, confirmed pivots, scale calibration, angles, squares, spiral levels, drawings, and execution prices; use the language model only to route the request and explain frozen results.

## Workflow

1. Exclude every unclosed candle before anchor selection, calibration, confirmation, or execution planning.
2. Select the most recent confirmed material high or low as the active anchor. Prefer a prior same-type pivot for scale calibration and explicitly downgrade when a fallback is required.
3. Freeze `pricePerBar = calibrated price range / calibrated bar count`. Never infer 1x1 from the line's screen angle.
4. Draw the nine fan ratios `1x8, 1x4, 1x3, 1x2, 1x1, 2x1, 3x1, 4x1, 8x1` from the same anchor and scale.
5. Draw a time-price square over the active projection, divide both axes at 1/4, 1/2 and 3/4, and show nested 1/2 and 1/4 squares as the wheel-in-wheel representation.
6. Normalize the anchor's decimal scale, calculate Square of Nine levels with the frozen square-root formula and project only the nearest readable levels onto the chart.
7. Treat every angle, square boundary, time division and spiral price as a candidate support/resistance or timing reference. Require closed-candle price-action confirmation.
8. Produce the standard conditional execution plan from confirmed structure boundaries, invalidation and deterministic targets. Keep the current action at wait.

## Composition Boundary

- Invoke this Skill independently for Gann angles, squares, price-time symmetry, wheel-in-wheel or Square of Nine questions.
- Other strategies may consume a future stable Gann context only through an explicit capability declaration. They must not duplicate these formulas or depend on this adapter implicitly.
- Prefer Dow Theory for trend-regime classification, chart-patterns for named geometric formations, wave for Elliott counts, harmonic for Fibonacci XABCD ratios, and price-action for candlestick combinations.

## Safety Boundaries

- Do not use screen pixels or an apparent 45° line as the 1x1 definition.
- Do not select an unclosed candle as an anchor or let an intrabar wick confirm a trigger.
- Do not draw a decorative spiral and call it a Square of Nine calculation. Draw exact calculated price levels and disclose the price unit.
- Do not introduce astrology, planetary positions, horoscope dates or untestable mystical rules into automatic analysis.
- Do not treat a touch of any Gann level as a standalone entry signal, probability, win rate or guarantee.
- Do not invent an anchor, scale, price, date, target, account size or order quantity.
- Do not create, modify or submit orders.

## Output Contract

Return the host strategy envelope with calibration provenance, active anchor, nine-angle fan, divided square, nested wheel representation, complete Square of Nine factor table, nearest chart levels, evidence-bound drawings, explicit limitations and a standard conditional execution plan.
