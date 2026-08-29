---
name: vpvr-analysis
description: "Analyze the visible-range volume profile (VPVR/VRVP) from chart OHLCV data with deterministic rules. Calculate POC, a 70% value area with VAH/VAL, high-volume nodes (HVN), low-volume nodes (LVN), and price-relative support/resistance zones; auto-display the native VPVR overlay; and report only support, resistance, market acceptance, and volume-distribution information. Use for VPVR、可见范围成交量分布、Volume Profile、POC、VAH、VAL、HVN、LVN、成交量密集区或基于成交量分布的支撑阻力分析。"
---

# VPVR Analysis

## Purpose

Run deterministic visible-range volume-profile analysis on the current chart. Read `references/rules.md` as the frozen knowledge boundary. The model may explain engine results, but must not invent volume rows, POC, value-area boundaries, nodes, support/resistance levels, or directional trade advice.

## Workflow

1. Use the candles in the currently visible chart range after the host has ensured the minimum profile window; a tiny visible range is only a starting point and may be expanded leftward. An explicit user lookback may replace the visible range; otherwise panning and zooming define the analysis window.
2. Allocate each candle's volume across the price rows intersecting its high-low range in proportion to overlap. Use 96 rows, matching the native VPVR overlay.
3. Identify POC as the maximum-volume row. Starting from POC, expand toward the larger adjacent row until the selected rows contain at least 70% of estimated volume; expose the resulting VAL and VAH.
4. Detect separated HVN peaks and LVN valleys from a lightly smoothed profile. Treat HVN as evidence of acceptance/balance and LVN as evidence of low acceptance or fast traversal/rejection, not as guaranteed future behavior.
5. Classify POC, VAH, VAL, profile extremes, and material HVNs below current price as support candidates and those above current price as resistance candidates. A level overlapping current price is a current acceptance zone, not both support and resistance.
6. Auto-display the native VPVR histogram and draw thin dashed support/resistance level lines. Return only support, resistance, and VPVR market-distribution insights.

## Safety Boundaries

- VPVR is reactive and window-dependent. Panning, zooming, or new volume changes the profile and every derived level.
- OHLCV does not contain exact traded price within each candle. This implementation is an interval-overlap estimate and must not be described as tick-level or lower-timeframe precision.
- A developing candle may be included because visible-range volume profile is a live descriptive distribution. Label it as developing and never convert it into a confirmed trade trigger.
- Do not infer aggressive buyers/sellers, delta, order-book liquidity, or institutional intent from total VPVR volume.
- Do not output bullish/bearish direction, entry, stop, target, risk/reward, position sizing, or an order plan.
- A sparse or nearly uniform profile is a valid result; do not manufacture nodes.

## Output Contract

Return the shared strategy envelope with the native VPVR main-chart indicator enabled, deterministic profile rows, POC/VAH/VAL, HVN/LVN evidence, support/resistance candidates, coverage, and an observation-only action object. The user-facing report contains exactly three domains: support levels, resistance levels, and information revealed by VPVR.
