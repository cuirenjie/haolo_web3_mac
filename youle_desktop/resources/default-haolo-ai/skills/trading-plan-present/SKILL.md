---
name: trading-plan-present
description: Show the verified native plan card or position-management plan from an existing Haolo analysis. Use after strategy analysis, for position-adjustment advice, or to redisplay a result.
---

Call `haolo_plan_present` with the same analysisRef used for drawing. The original cloud report and account rules remain authoritative; never construct replacement prices, leverage, quantities or risk/reward values. Waiting, no-trade and missing-data outcomes are valid. Position management is presented separately from new-entry plans.

The native report and card are already the user-visible answer. If they complete the request, end with a brief acknowledgement only; do not repeat the conclusion, prices, risk text or card. Set `hasRemainingWork: true` when another requested deliverable remains, including another strategy, a comparison, explanation or file, and then complete that work. Set it on every intermediate presentation; do not mark the last card complete if a requested comparison still follows.

Rendering a card does not save, activate, or execute it. Saving and reminders use the plan-management workflow and existing authorization.
