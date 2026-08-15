---
name: harmonic
description: Identify completed and developing harmonic candidates through independent classic XABCD, Shark 0XABC, and Cypher XABCD subengines; project a clearly labelled PRZ without fabricating completion; render professional solid topology, dotted Fibonacci measurement chords, ratio labels, and conditional projections; and produce a conditional execution plan. Use for Gartley, Bat, Butterfly, Crab, Deep Crab, Shark, Cypher, Fibonacci ratio, PRZ, confirmation, invalidation, or current-chart harmonic analysis requests.
---

# Harmonic Pattern Analysis

Treat geometry, ratios, PRZ convergence, and confirmation as separate gates. A visually similar five-point path is not a valid pattern.

## Workflow

1. Use only structured, closed OHLCV candles supplied by the host.
   Unless the user explicitly selects a range, prefer the latest 600 closed candles while keeping 80 as the hard minimum.
2. Scan fine, standard, structural, and (when enough candles exist) macro swing scales. A bounded selector may skip at most two dominated minor high-low pairs; it may not skip a more extreme endpoint.
3. Route five-point sequences to the classic XABCD, Shark 0-X-A-B-C, and Cypher XABCD subengines. A completed candidate must still pass its unchanged topology, every hard ratio, PRZ convergence, recency, and current invalidation gate.
4. If no completed candidate exists, evaluate four-point XABC or 0-X-A-B structures as `developing` only when their frozen early ratios pass, permitted projections converge, and price has begun the completion leg without materially overshooting the projected PRZ.
5. Label a developing result as unfinished. Draw confirmed partial topology with solid legs, early-ratio measurement chords with dotted lines, and the still-unconfirmed completion leg with a dashed projection ending at the latest closed-bar timestamp; this endpoint is only a price guide inside `预测 PRZ`, not a forecast completion time. Make alternative early-pattern branches explicit, skip the model call, and generate no trigger, stop, target, position size, or probability.
6. For a completed candidate, do not treat touching the terminal point or entering the PRZ as entry confirmation; require a later closed candle to reverse through the Terminal Bar trigger.
7. Draw completed topology with a solid 3px directional path; use clean X/A/B/C/D or 0/X/A/B/C text anchors, dotted Fibonacci measurement chords, midpoint ratio labels, and dashed PRZ/execution levels. Use only the controlled strategy layer and semantic theme tokens. Finish with `ExecutionPlanV1`; keep the action at wait/no-trade when completion, confirmation, or fresh entry conditions are absent.
8. If neither completed nor developing candidates survive their gates, complete the analysis as a deterministic no-trade result. Report what was scanned, draw only a clearly labelled observation swing when possible, and never invent a pattern or PRZ to make the request appear successful.

Read [references/rules.md](references/rules.md) before explaining ratios or reviewing a candidate.

## Boundaries

- v3 supports Gartley, Bat, Butterfly, Crab, Deep Crab, Shark, and Cypher through three independently versioned subengines and a bounded multi-scale scanner.
- Shark must remain `0-X-A-B-C`; never relabel its C terminal as a classic D. Cypher is measured against XC at completion and must not inherit a classic XA completion rule.
- 5-0, standalone AB=CD, Three Drives, alternate/anti patterns, and unlisted variants remain unsupported until they receive their own frozen rules and tests.
- AB=CD is a convergence requirement or supporting measurement here, not a standalone entry strategy.
- The model may select and explain engine candidates but may not invent or move pivots, PRZ, prices, or targets.
- A developing candidate is analysis context, not a completed pattern. Its projected terminal price is a zone midpoint for display, never an executable price or time prediction.
- Solid paths mean confirmed historical pivots, dotted chords mean deterministic ratio measurements, and dashed paths mean projections or conditional levels. Do not interchange these semantics for visual effect.
- No qualified candidate is a valid completed outcome, not an engine or model failure. Its execution plan must contain no entry, stop, target, or position-size suggestion.
- Do not claim a calibrated probability, guaranteed reversal, or executed order.
