# Traditional chart-pattern rulebook v2.1 (M1-444, 2026-10-22)

## Evidence and scope

The original Fidelity/StockCharts rule framework remains the baseline. Version 2 adds explicit, testable definitions and contextual evidence; it does not claim to reproduce every discretionary drawing or predict returns.

- [StockCharts pattern catalogue](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-patterns)
- [TradingView triangle lifecycle](https://www.tradingview.com/support/solutions/43000653217-chart-pattern-triangle/)
- [TradingView cup and handle](https://www.tradingview.com/support/solutions/43000732556-chart-pattern-cup-and-handle/)
- [StockCharts rounding bottom](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-patterns/rounding-bottom)
- [StockCharts price channels](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-patterns/price-channel)
- [StockCharts broadening formations](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-patterns/broadening-top-or-megaphone-top)
- [Changjiang Securities investor education: old duck head](https://www.investor.org.cn/xxzx/tjzl/tjnrgmjytx/bk/kj/jyxl_3455/202303/P020230307504049371861.pdf)
- [Dahuzi-Swingtrader public ideas](https://cn.tradingview.com/u/Dahuzi-Swingtrader/): 275 indexed public idea pages, text/updates and all 275 main images reviewed. One video (MAwSrn1T) was reviewed through its complete local transcript and regular visual frames. At the user's request, further video and supplemental-image review was stopped; the index distinguishes reviewed material from downloaded/transcribed-only material.

Thresholds below are Haolo engineering choices, not thresholds or winning probabilities attributed to an author. Drawings are generated from the user's current candles, never copied historical coordinates.

## Cross-pattern invariants

1. Filter explicitly open and time-incomplete candles before normalization. Respect supplied session closing times. Keep the closed-input hash.
2. Scan pivot radii 2/3/5/8/13/21 where sufficient history exists. Confirm pivots with right-side bars and expose their confirmation index. These are scales of ONE timeframe; never claim independent H4/D1 confirmation without their data.
3. Validate alternating pivots, trend when required, ATR-normalized depth, duration, boundary fitting and candle containment. Use formation-time ATR and breakout buffers; future volatility must not change historical geometry thresholds.
4. Structural waiting windows scale with formation duration: 8..64 bars. Fresh entry windows remain 4..12 bars. Stable identities use market, interval and structural times/prices.
5. Breakout requires a close outside the boundary plus buffer. Wicks alone do not confirm. In the first three bars a close beyond the wrong-side buffer fails the breakout; later returns invalidate it. Sloping boundary returns use the projected line, not a fixed trigger. Triangles, pennants, wedges and the contracting half of a diamond stop searching/drawing at their apex; a later move cannot confirm crossed boundaries.
6. A structural stop crossed before a later breakout invalidates the original setup. Terminal events are chronological; a target reached before failure stays completed. If a stop/return and target share one OHLC bar, conservatively prefer invalidation because intrabar order is unknown.
7. T1/T2 use 61.8%/100% of height, or the flagpole for flags/pennants. A target reached on the breakout bar is already historical, not a fresh entry.
8. Preserve recent historical geometry independently from action-plan selection. Up to three distinct structures are drawn; detailed labels/boundaries belong to the first, and execution levels belong only to the primary active candidate. History uses dotted geometry and explicit historical labels, never entry/stop/target lines.
9. Retest state, formation-volume ratio, breakout-volume ratio, nested frameworks and opposing active candidates are explanatory evidence. Missing/zero volume is unknown, not contraction. No automatic add-on orders or risk-budget changes.
10. A current parent framework must be at least 1.6 times the child's span and contain its pivots within 1 formation ATR. Ignore terminal parents and passed apexes. Project the opposing parent boundary to the current closed bar. If the distance from the proposed trigger to that boundary is below 1 trigger-to-stop risk unit, retain geometry but suppress that direction's plan/level drawings and cloud entry candidate. Evaluate both sides independently for neutral bilateral patterns. A boundary already decisively crossed in the same direction is no longer an obstacle. This is an engineering guard, not the author's stated parameter or an empirical profitability claim.
11. After a held retest, three observed bars with mean true range at most 0.75 formation ATR provide contraction context. Any return inside the boundary removes it. First same-side extremum volume at least twice the prior 20-bar average (minimum 10 observations), a later extremum at least five bars away within 1 ATR, and retest volume at most 70% of the first provide weak-follow-through context. Missing volume makes this unavailable. Neither observation independently confirms a reversal or creates an entry.

## Reversal discovery (12 definitions)

- `head-and-shoulders-top`, `inverse-head-and-shoulders`: comparable shoulders, a clearly displaced head and two neckline reactions. Category is reversal or continuation according to the observed prior trend; the neckline determines confirmation.
- `double-top`, `double-bottom`, `triple-top`, `triple-bottom`: prior opposing trend, comparable extrema and intervening reaction(s); close through the reaction neckline.
- `rising-wedge`, `falling-wedge`: at least five alternating touches, same-direction converging boundaries, 8..240 bars, at least 85% close containment. Both breakout directions are possible; category follows prior trend versus actual break. Searches and drawings stop at the apex.
- `rounding-bottom`, `rounding-top`: 30..240 bars, depth at least 3 ATR, comparable lips, broad middle zone and balanced thirds; reject V approximations.
- `diamond-top`, `diamond-bottom`: 8..9 alternating points, expansion followed by contraction, 24..240 bars, opposing prior trend and at least 85% containment in both halves.

## Continuation discovery (7 definitions)

- `bull-flag`, `bear-flag`, `bull-pennant`, `bear-pennant`: impulse at least 4 ATR over 3..45 bars; 4..7 consolidation touches; retracement at most 52%; parallel countertrend flag or converging pennant; at least 85% containment. Duration cap is min(240, max(60, 16 × pole duration)) bars, accommodating multi-session intraday flags without removing geometric constraints. Confirmation is in the pole direction.
- `cup-and-handle`, `inverse-cup-and-handle`: prior trend, rounded cup of 20..240 bars, comparable lips, handle in the upper/lower half, handle no longer than cup. Close past the lip; render actual sampled curvature instead of a V.
- `old-duck-head`: explicit MA5/10/60 convention applied to current-timeframe bars. Requires a recent short-average transition above MA60, rising MA60, a head, shallower second low, contracted pullback volume and MA60 support. It is a local operational definition; intraday bars are not described as daily averages. Missing volume disqualifies this volume-dependent pattern.

## Bilateral discovery (9 definitions)

- `symmetrical-triangle`, `ascending-triangle`, `descending-triangle`, `rectangle`: alternating touches, valid slopes and height, at least 85% containment; triangles require a future apex. Up to 10 touches covers 5/7/9-point structures.
- `ascending-channel`, `descending-channel`: parallel inclined boundaries, 5..7 touches, 12..240 bars, residual tolerance and 90% containment.
- `broadening-formation`, `ascending-broadening-wedge`, `descending-broadening-wedge`: expanding gap and the corresponding boundary slopes, residual tolerance and 90% containment.
- All remain directionally neutral before a close chooses a side. A bullish-looking name never substitutes for confirmation.

## Other mainstream families and boundaries

Bump-and-run, measured-move up/down, complex/multiple-shoulder variants, scallops, V/spike reversals, islands and true-gap patterns are catalogued research items, not advertised as independently detected by this 28-definition engine. Measured height/flagpole targets are not a separate measured-move detector. Candlestick formations, harmonic ratios, Elliott waves, Wyckoff and indicator-only signals retain their separate strategies. Do not silently rename one of these as a triangle or wedge.

Dahuzi's nested frameworks, retests, competing hypotheses and completed/failed structures inform the implementation. Discretionary pre-breakout entries, averaging, correlated-market judgements, historical macro opinions and astrology are not executable rules. Conditional plans retain the existing account-risk and execution review pipeline.

Price coordinates are numeric and use linear regression in this version. Inverted chart axes do not reverse numeric trading direction. Logarithmic visual trendlines, projected wave paths and ghost candles are not silently treated as observed linear pivots; no independent logarithmic detector or unsupported cross-timeframe data is claimed.
