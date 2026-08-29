# Harmonic v3 frozen rules

This file freezes Haolo's supported topology, ratio, confirmation, and execution-policy boundaries. It summarizes implementation rules and sources; it does not reproduce source illustrations or long passages.

## Supported subengines

The aggregator compares candidates from three independently versioned deterministic subengines. Every candidate contains five chronological alternating pivots. A bullish candidate alternates `low-high-low-high-low`; a bearish candidate is its mirror. A rule from one topology must never be borrowed to make another topology pass.

### Classic XABCD subengine

B and C remain inside their preceding legs. Gartley and Bat complete as XA retracements; Butterfly, Crab, and Deep Crab complete beyond X as XA extensions.

| Pattern | B/XA | C/AB | D/XA | CD/BC | CD/AB role |
|---|---:|---:|---:|---:|---|
| Gartley | 0.618 ±3% | 0.382–0.886 | 0.786 ±3% | 1.13–1.618 | 1.0–1.27 required |
| Bat | 0.382–0.618 | 0.382–0.886 | 0.886 ±3% | 1.618–2.618 | 1.0 minimum, 1.27 preferred |
| Butterfly | 0.786 ±3% | 0.382–0.886 | 1.27 ±3% | 1.618–2.618 | 1.0–1.618 required |
| Crab | 0.382–0.618 | 0.382–0.886 | 1.618 ±3% | 2.618–3.618 | supporting rather than defining |
| Deep Crab | 0.886 area without violating X | 0.382–0.886 | 1.618 ±3% | 2.24–3.618 | 1.0/1.27/1.618 convergence |

The PRZ uses the defining XA completion plus the nearest permitted BC projection and, except where explicitly supporting, the nearest AB=CD completion. T1/T2 are deterministic 38.2%/61.8% retracements from D toward A.

### Shark 0XABC subengine

Shark is not classic XABCD. Its labels and terminal semantics stay `0-X-A-B-C`.

| Measurement | Frozen rule |
|---|---:|
| A geometry | A lies between 0 and X |
| AB/XA | 1.13–1.618; B extends beyond X |
| BC/AB | 1.618–2.24 |
| C/OX | 0.886 or 1.13, ±3% implementation tolerance |

The PRZ requires convergence of the selected OX completion and the nearest permitted BC projection. C is the Terminal Bar. Because Shark is an impulse structure requiring active management, Haolo's execution policy uses the 50% and 61.8% retracements from C toward B as conditional T1/T2. This target policy is a product risk rule, not a claim that every source defines identical exits.

### Cypher XABCD subengine

Cypher uses XABCD labels but a distinct extended-C and XC-completion topology.

| Measurement | Frozen rule |
|---|---:|
| B/XA | 0.382–0.618; B remains between X and A |
| C/XA | 1.272–1.414; C extends beyond A |
| D/XC | 0.786, ±3% implementation tolerance |

The PRZ is the 0.786 XC completion; it is not an XA completion and does not require AB=CD convergence. D is the Terminal Bar. T1/T2 are Haolo's deterministic 38.2%/61.8% retracements from D toward C, with structural invalidation beyond X plus a volatility buffer.

Cypher is attributed to Darren Oglesbee rather than Scott Carney. No author-controlled primary specification was found during the v2 source freeze, so the above convention was triangulated from consistent public references and is deliberately isolated/versioned. A future primary-source correction can upgrade only the Cypher subengine without altering the classic or Shark engines.

## Common confirmation gate

- Reaching the terminal point or entering the PRZ is not an entry signal.
- Confirmation requires a later closed candle to reverse through the Terminal Bar high for bullish candidates or low for bearish candidates.
- A close through the deterministic structural stop invalidates the candidate.
- Targets are conditional objectives, not guaranteed outcomes. Once targets are reached, the historical terminal point must not be chased.
- Exact-ratio tolerance is an implementation allowance, not a claim that every source assigns the same tolerance.

## Multi-scale discovery and developing candidates

The v3 scanner improves discovery without modifying any completed-pattern ratio above:

- Fine, standard, and structural swing profiles always run after the host's 80-candle minimum; a macro profile joins when at least 160 candles are available.
- Sequence construction is bounded to 2,000 paths per profile. It may skip at most two complete minor high-low pairs, and only when the selected endpoint dominates every skipped endpoint of the same type. This prevents combinatorial search and forbids hiding a more extreme swing.
- Duplicate candidates are keyed by pattern identity plus chronological pivot indexes. A pattern found at multiple scales is reported once.

When no completed candidate exists, the engine may return an explicitly separate `developing` result:

- Classic patterns require valid X-A-B-C topology plus frozen B/XA and C/AB ranges. D is projected only from the pattern's permitted XA completion, BC projection, and AB=CD components.
- Shark requires valid 0-X-A-B topology and AB/XA; C is projected from permitted OX and BC components.
- Cypher requires valid X-A-B-C topology, B/XA, and C/XA; D is projected only at the permitted XC completion.
- The permitted projection components must already converge inside the same PRZ-width gate used by the corresponding completed pattern. Price must have progressed at least 8% of the completion leg and must not have overshot the projected midpoint by more than 20%.
- A developing result contains only confirmed pivots, projected PRZ, progress, and branch ambiguity. It has no Terminal Bar, confirmation, entry, stop, target, position size, risk/reward, or probability.
- The terminal name remains conditional until an actual endpoint pivot forms and the full completed-pattern ratios are recalculated. Shared XABC geometry can legitimately branch into multiple pattern families.

## No-candidate completion policy

- A scan that finds no candidate passing topology, every hard ratio, PRZ convergence, and current invalidation checks is a completed analysis, not an analysis failure.
- Never relax the frozen ratios, move pivots, or fabricate a PRZ merely to return a named pattern.
- The host should prefer the latest 600 closed candles unless the user explicitly requests another range; 80 closed candles remains the hard minimum.
- The report must state that all seven supported patterns were checked and that the current action is no trade. Entry, stop, targets, position size, and risk/reward stay unavailable.
- The chart may show the latest deterministic swings as a purple observation path labelled `未通过七形态全部硬规则`. This path is not a harmonic candidate, PRZ, or trading signal and must remain on the controlled `strategy-note` layer.
- Re-run after a new closed candle or a materially changed swing structure. Do not imply that repeated scans increase validity.

## Professional drawing grammar

Drawing style communicates evidence status and is part of the frozen strategy contract:

- Completed classic and Cypher candidates use a solid X-A-B-C-D path; Shark uses a solid 0-X-A-B-C path. The main path is 3px and uses the bullish support or bearish resistance semantic token.
- Point names are clean inline text anchors next to their exact deterministic pivots. They must not be rendered as displaced note boxes or leader-line callouts.
- Fibonacci measurement chords are dotted 1.5px paths. Classic uses X-B for B/XA, A-C for C/AB, X-D for D/XA, and B-D for CD/BC plus CD/AB. Shark uses X-B, A-C, and 0-C. Cypher uses X-B, X-C, and X-D.
- Each measurement chord has a theme-aware inline midpoint label with its frozen ratio rounded to three decimals. The text halo uses the chart-panel semantic color so it remains legible in both light and dark themes.
- A developing candidate keeps its confirmed partial topology solid and draws only its completion leg as dashed. That projection ends at the latest closed-bar timestamp and projected PRZ midpoint solely to express price direction; it must carry `D?` or `C?` and must never be presented as a predicted completion time or confirmed pivot.
- PRZ borders and conditional confirmation, invalidation, T1, and T2 levels are dashed so they cannot be mistaken for historical topology. No-candidate observation paths retain their tentative, non-pattern presentation.
- The Drawing Gateway accepts only `solid`, `dashed`, or `dotted`, line widths from 1 through 4, enumerated text sizes, semantic color tokens, and controlled `text` anchors. Arbitrary CSS, raw colors, HTML, or renderer access remains forbidden.

## Unsupported scope

5-0, standalone AB=CD, Three Drives, alternate/anti patterns, and unlisted variants are not silently counted as supported. Adding one requires a separate rule freeze, topology evaluator, mirror/boundary/cross-classification tests, drawing semantics, and execution policy.

## Source index and provenance

Primary Scott Carney sources for the classic family and Shark:

- Pattern index: https://harmonictrader.com/harmonic-patterns/
- Gartley: https://harmonictrader.com/harmonic-patterns/gartley-pattern/
- Bat: https://harmonictrader.com/harmonic-patterns/bat-pattern/
- Butterfly: https://harmonictrader.com/harmonic-patterns/butterfly-pattern/
- Crab: https://harmonictrader.com/harmonic-patterns/crab-pattern/
- Deep Crab: https://harmonictrader.com/harmonic-patterns/deep-crab-pattern/
- Shark: https://harmonictrader.com/harmonic-patterns/shark-pattern/
- AB=CD: https://harmonictrader.com/harmonic-patterns/abcd-pattern/
- PRZ confirmation: https://harmonictrader.com/przconfirm/
- Harmonic Trader Pro projection/analyzer: https://harmonictrader.com/harmonic-trader-pro-platform/
- Harmonic pattern origin and Terminal Bar/PRZ workflow: https://harmonictrader.com/harmonicpatternorigin/
- Harmonic Trading Volume Three PDF: https://harmonictrader.com/wp-content/uploads/2020/06/HarmonicTradingV3Carney.pdf

Cypher convention cross-checks:

- EBC harmonic pattern reference: https://www.ebc.com/forex/harmonic-patterns
- TradingView public Cypher example/rule summary: https://www.tradingview.com/chart/DSX/6an1cyIa-Bullish-Cypher-Pattern-Elliott-Wave-Analysis/

## Product and legal boundary

Official source pages identify several names as trademarks and state commercial authorization requirements. Before public marketplace or commercial release, product/legal review must confirm naming and licensing. This implementation stores original summaries and mathematical rules only; it does not bundle source diagrams, course text, or copied examples.
