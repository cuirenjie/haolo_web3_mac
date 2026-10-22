---
name: trading-simulation
description: Generate deterministic synthetic K-line demonstrations for prepared Haolo alerts or personal strategies. Use after a draft is ready and before showing its confirmation preview.
---

Call `haolo_simulation` with the current draftRef returned by trading-alerts or trading-personal-strategy. The existing rule engine computes legal OHLCV and validates the trigger path. Do not fabricate candles, change thresholds or treat synthetic data as market evidence.

After successful simulation call `haolo_chart_draw` with the SAME draftRef. If the originating conversation is not visible, ask the user to open it before preview/confirmation. Simulation failure requires fixing the draft or retrying the simulator; never skip to creation.

This demonstration is not a backtest or a forecast. No alert or active strategy is created until a new actual user reply confirms the displayed simulation.
