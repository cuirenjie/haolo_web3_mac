---
name: trading-personal-strategy
description: Create or revise a user's own trading strategy from text, documents, images or public links, and list saved personal strategies. Use for strategy authoring and rule clarification.
---

Use `haolo_personal_strategy` operation `prepare`. Host preserves the real user message, source attachments and existing conversation. The existing understanding model and deterministic compiler retain their validation and clarification workflow.

When a draftRef is returned, call trading-simulation then trading-chart-draw with that same reference. Relay the preview, wait for a NEW user reply, then use operation `confirm`. Only the validated creation receipt means the strategy is active. Cancel or a rule revision must never reuse approval for an earlier simulation.

Use `cancel` without a draftRef to clear this conversation's incomplete or expired draft after a failed preparation, then prepare again if requested.

Use operation `list` to discover saved strategies. To analyze the market with one, read its enabled exact ID from `haolo_market` catalog, then use account read -> `haolo_analysis` with that ID -> chart draw -> plan present. Preserve the original cloud/runtime capabilities; never invent a local copy of the strategy algorithm.
