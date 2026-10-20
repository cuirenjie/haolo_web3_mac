---
name: trading-plan-present
description: Show the verified native plan card or position-management plan from an existing Haolo analysis. Use after strategy analysis, for position-adjustment advice, or to redisplay a result.
---

Call `haolo_plan_present` with the same analysisRef used for drawing. The original cloud report and account rules remain authoritative; never construct replacement prices, leverage, quantities or risk/reward values. Waiting, no-trade and missing-data outcomes are valid. Position management is presented separately from new-entry plans.

Rendering a card does not save, activate, or execute it. Explain the useful conclusion without repeating the entire card. Saving and reminders use the plan-management workflow and existing authorization.
