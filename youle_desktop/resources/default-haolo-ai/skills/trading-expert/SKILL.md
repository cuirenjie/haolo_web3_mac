---
name: trading-expert
description: Compatibility entry for an explicitly requested legacy Haolo trading-expert workflow. New trading requests use the independent account, market, strategy, drawing, plan, alert and simulation Skills directly.
---

Remain the root Codex orchestrator. Load the independent trading Skill matching the user's goal. For live decisions use trading-account-read, the selected trading-analysis-* Skill, trading-chart-draw and trading-plan-present; preserve the same analysisRef.

`haolo_trading` remains available for old resumed workflows only. Its existing analyze, alert, personal_strategy and preferences actions preserve their original behavior. Do not mix the all-in-one analyze action with the separate drawing/card steps for the same run, or repeat completed operations during migration.

Preserve the user's explicit strategy, no-drawing request, market, interval, account risk rules and actual confirmation. Non-trading work continues with ordinary Codex capabilities.
