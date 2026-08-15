# VPVR Rules v1.0.0

## Authoritative definitions

- TradingView defines Volume Profile as volume activity displayed at price levels over a specified period. Its visible-range variant calculates the profile within the chart's visible price range.
- POC is the row with the greatest volume. Value Area is normally 70% of profile volume; VAH and VAL are its upper and lower boundaries.
- Value Area starts at POC and expands by comparing the neighboring rows above and below, choosing the larger available volume until the target is covered.
- HVN is a local volume peak associated with acceptance, consolidation, and slower traversal. LVN is a volume valley associated with rejection or quicker traversal.
- Volume Profile is reactive: it describes where volume previously traded and can identify potential support/resistance; it does not predict a guaranteed reaction.

Primary references:

- TradingView, *Volume profile indicators: basic concepts*: https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/
- TradingView, *Visible Range Volume Profile*: https://www.tradingview.com/support/solutions/43000703076-visible-range-volume-profile/

## Frozen calculation

1. Input is the current visible window, capped at 600 candles, including positive OHLCV volume from a developing right-edge candle when present.
2. Use 96 equal price rows spanning the visible low to visible high.
3. For each candle, distribute its entire volume across all intersecting rows in proportion to the amount of price overlap. A zero-range candle assigns volume to its containing row.
4. POC is the first row containing the maximum volume.
5. The value area starts at POC and repeatedly adds whichever next adjacent row has more volume; equal volume prefers the upper row. Stop when accumulated volume reaches or exceeds 70%.
6. Smooth row volume with weights 0.25/0.50/0.25. An HVN is a separated local maximum at or above the 68th percentile. An LVN is a separated local minimum outside the value area at or below the 32nd percentile.
7. Candidate levels come from POC, VAH, VAL, profile extremes, and separated HVNs. Merge levels within 1.25 rows. Keep at most three support and three resistance zones.
8. A candidate entirely below current price is support; entirely above is resistance; overlapping current price is current acceptance and is not duplicated into both lists.

## Interpretation boundary

- `near-poc`, current HVN, or an overlapping material zone means greater acceptance/balance.
- Outside value area or near LVN means lower acceptance; price may traverse or reject it quickly, but direction is unknown.
- Volume above/below current price describes distribution weight only. It is not buy/sell volume and not a directional signal.
- Reports must contain no execution advice. The shared runtime may keep a neutral observation object internally, but it must not prepend a standard execution plan to the visible VPVR report.
