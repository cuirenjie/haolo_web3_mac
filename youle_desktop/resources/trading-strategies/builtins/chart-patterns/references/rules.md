# Traditional chart-pattern rulebook v1

## Evidence hierarchy

The deterministic rules are frozen from the following primary or established educational references:

- Fidelity, *Identifying Chart Patterns*: https://media.fidelity.com/assets/Fidelity.com_VMS/904/347/TA_Session_3_Identifying_Chart_Patterns.pdf
- Fidelity, *Getting Started with Technical Analysis*: https://www.fidelity.com/learning-center/trading-investing/technical-analysis/what-is-technical-analysis
- Fidelity chart-pattern webinar transcript: https://www.fidelity.com/bin-public/060_www_fidelity_com/documents/learning-center/Transcript_Chart-patterns_v2.pdf
- StockCharts ChartSchool pattern index: https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-patterns
- StockCharts ChartSchool introduction: https://chartschool.stockcharts.com/table-of-contents/chart-analysis/introduction-to-chart-patterns
- StockCharts Flag/Pennant: https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-patterns/flag-pennant
- IFTA CFTe syllabus and reading framework: https://www.ifta.org/assets/docs/IFTA_CFTe_Syllabus_Reading_Material.pdf

## Cross-pattern invariants

1. Use closed OHLC candles only and retain the input hash.
2. A visual resemblance is not enough. Validate prior trend where the pattern definition requires it, alternating pivots, touch count, duration, minimum ATR-normalized depth, and boundary geometry.
3. A pattern remains `developing` until a candle closes beyond its calculated neckline or boundary plus a volatility buffer.
4. A wick without a qualifying close is not confirmation.
5. A close back through the broken boundary within three bars is a failed breakout; do not issue an active directional plan.
6. Project T1 at 61.8% and T2 at 100% of pattern height from the breakout. Flags and pennants use 61.8% and 100% of the flagpole.
7. Place structural invalidation beyond the opposite boundary or terminal swing with an ATR buffer.
8. Never select a lower-scoring duplicate over the same pivots. Prefer confirmed, more recent, more geometrically symmetric candidates.

## Reversal subengine

Supported IDs:

- `head-and-shoulders-top`, `inverse-head-and-shoulders`
- `double-top`, `double-bottom`
- `triple-top`, `triple-bottom`
- `rising-wedge`, `falling-wedge`

Rules:

- Tops require an established rise before the first structural point; bottoms require a decline.
- Double structures require two approximately equal terminal extremes separated by a reaction swing and complete only on a close through that reaction level.
- Triple structures require three approximately equal extremes and two intervening reactions; completion is the close through their neckline.
- Head-and-shoulders requires a higher head/lower inverse head, comparable shoulders, two neckline reactions, and a neckline close.
- Wedges require at least five alternating touches. Both boundaries slope in the same direction and converge; a rising wedge confirms down, a falling wedge confirms up.

## Continuation subengine

Supported IDs:

- `bull-flag`, `bear-flag`
- `bull-pennant`, `bear-pennant`
- `cup-and-handle`

Rules:

- Flags and pennants require a sharp ATR-normalized flagpole before a short consolidation. The consolidation must not retrace more than half the pole.
- A flag uses approximately parallel boundaries that normally slope against the pole. A pennant uses converging boundaries.
- Confirmation must be a close in the flagpole direction. Opposite breaks fail the continuation thesis.
- Cup-and-handle requires a prior rise, a rounded/deep cup with comparable lips, a shallower handle in the upper half, and a close above both lips. Reject sharp V-shaped approximations.

## Bilateral subengine

Supported IDs:

- `symmetrical-triangle`
- `ascending-triangle`
- `descending-triangle`
- `rectangle`

Rules:

- Require at least two upper and two lower touches.
- Symmetrical triangles have a falling upper and rising lower boundary.
- Ascending triangles have a near-horizontal upper and rising lower boundary.
- Descending triangles have a falling upper and near-horizontal lower boundary.
- Rectangles have near-horizontal support and resistance and sufficient ATR-normalized height.
- Before confirmation direction is neutral and both breakout scenarios are conditional. A closed break selects the direction; the product must not assign direction from the name alone.

## Explicit v1 exclusions

Broadening formations, diamonds, bump-and-run, rounding top/bottom, islands, gaps, candlestick patterns, V formations, harmonic patterns, and Elliott/Wyckoff structures are not silently approximated. They need separate deterministic specifications and fixtures before being advertised as supported.

