---
name: trading-plan-present
description: Show a verified native strategy or new-entry plan card from an existing Haolo analysis, or redisplay that result. Existing-position advice is delivered in the root's written answer.
---

Call `haolo_plan_present` with the same analysisRef used for drawing. The original cloud report and account rules remain authoritative; never construct replacement prices, leverage, quantities or risk/reward values. Waiting, no-trade and missing-data outcomes are valid.

Only present results from requested strategy/indicator analysis or trading plans. General market questions and position-management evidence require a written final answer; their analysisRef cannot be turned into an entry-plan or position-advice card.

The card is a supporting artifact, not proof that the user's request is answered. Always give a substantive final conclusion or explanation, covering all requested work and any limitations. Refer to the displayed card without copying its entire price table. Never merely claim that advice or risk checks were displayed. `hasRemainingWork` is retained for compatibility and cannot suppress the root's final answer.

Rendering a card does not save, activate, or execute it. Saving and reminders use the plan-management workflow and existing authorization.
