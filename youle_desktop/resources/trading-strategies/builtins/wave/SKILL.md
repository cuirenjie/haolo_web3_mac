---
name: wave
description: Analyze deterministic Elliott Wave candidates under hard motive and corrective-structure rules, preserve main and alternate counts, draw a controlled primary count, and produce a conditional execution plan. Use for wave counts, Fibonacci relationships, invalidation, current-chart analysis, or plan generation.
---

# Elliott Wave Analysis

Reject any count that violates a hard rule. Use ratios to rank valid candidates, never to rescue an invalid structure.

## Workflow

1. Verify structured K-line coverage and expand older history only through the host's bounded auto-expansion flow.
2. Treat the requested chart interval as the analysis degree. Load the mapped structure and execution degrees from real closed lower-timeframe candles (for example, 4H → 1H → 15m); never simulate them by merely shrinking the pivot radius on 4H candles.
3. Distinguish confirmed pivots from the tentative terminal pivot at every available degree.
4. Validate motive position, price rules, wedge evidence, and lower-degree internal structure. Never accept an arbitrary larger odd pivot count as a 3/5 subdivision; noise-filter and boundedly reduce it to a hard-valid canonical skeleton or require explicit 7/9 grouped validation. If a fresh 1–5 price sequence passes every motive hard rule but its parent window is too short to expose all lower-degree 5-3-5-3-5 segments, keep the engine's `hard_price_rules_pending_lower_degree_structure` candidate as tentative and draw the six points while waiting for child confirmation. Then link only child waves that fit the active parent-wave time/price envelope and projected direction.
5. Validate ABC or W-X-Y internal structure before naming a correction.
6. Keep analysis-degree confirmation/invalidation as macro scenario boundaries. Prefer an aligned, confirmed execution-degree wave for the tactical entry; when lower-degree evidence is incomplete but a candidate, current price, and ATR are available, still create a single-side conditional execution plan from the nearest confirmed structure, wave invalidation, or volatility anchor and label the fallback basis. Put the stop beyond the structural zone with a noise buffer, keep the distance inside the broad safety envelope, and preserve an acceptable net risk/reward.
7. Draw the primary count plus only the latest aligned structure/execution child waves, required macro boundaries, and tactical levels; keep alternate counts in text.
8. Finish with `ExecutionPlanV1`, retaining the structural support/resistance stop basis, explicit Fibonacci/structural target basis, waiting, expiry, false-breakout, and macro-invalidation cancellation semantics. Whenever the final target leaves enough directional room, prefer T1 at 1:0.4–1:0.6 and T2 at 1:0.8–1:1, and use the measured final target as T3. If the final target also falls in 1:1.3–1:1.5, preserve that preferred third band; if it falls outside, retain the measured final ratio and still keep any executable preferred earlier exits. When price space or the user's minimum prevents a complete ladder, retain the current valid ratios so the setup remains executable. The user's explicit minimum risk/reward value has priority, including values below 1:0.4; use 1:0.4 only as the default when the user has not set one.

Read [references/rules.md](references/rules.md) for the frozen hard-rule checklist.

## Boundaries

- Do not force a complete count from insufficient pivots.
- Do not treat a 1/4 overlap as a diagonal without position, wedge, and internal evidence.
- Do not describe projections as guaranteed targets.
- Do not emit a target whose Fibonacci or structural measurement basis is missing from the report and execution plan.
- Do not relabel a distant analysis-degree confirmation or invalidation boundary as a tactical entry.
- Do not invent an arbitrary price. When lower-timeframe waves are missing, tentative, stale, directionally conflicting, or farther than the preferred ATR distance, use the nearest confirmed structure, wave invalidation, or volatility anchor, explicitly label the fallback, and keep the conditional plan. Only return an observing or armed non-trading plan when current price, direction, or ATR is unavailable.
- Do not use a single execution-wave pivot as the only preferred stop basis. For a 4H/1H analysis, prefer the nearest unbroken analysis/structure-degree resistance or support around the current price; execution pivots are only secondary. If no higher-degree zone is available, use the nearest confirmed pivot or wave invalidation with an explicit fallback label. Keep the stop at least 0.6 ATR away (0.8–2 ATR preferred); higher-degree structural stops may use up to 6% of the trigger when the zone is within 5% of current price, while execution-only stops retain the 3.5 ATR / 3% envelope. Expand a too-tight stop outward rather than discarding the plan, and treat an exceptional distance as a warning.
- Do not place orders.
