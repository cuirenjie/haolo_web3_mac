---
name: trading-alerts
description: Create or revise a Haolo trading alert from the user's conditions, or list, pause, resume and delete existing alerts. Use for price, indicator, strategy or combined-condition monitoring requests.
---

Use `haolo_alerts` with operation `prepare`. Host reads the actual user message and current chart; do not supply rewritten approval or fabricated rule parameters. Relay missing-data questions and wait for the user when preparation needs clarification.

Once a draftRef exists, load trading-simulation and run `haolo_simulation`, then trading-chart-draw with that SAME draftRef. Show the verified simulation and ask the user to check it. Stop for a new user reply before `haolo_alerts` operation `confirm`. A tool call is not user approval.

Any condition change requires prepare -> simulation -> chart preview again. Never confirm an older draft after revision, failure or cancellation. Use `cancel` for the current draftRef. If a draft expired, preparation failed or the runtime cleared it after restart, use `cancel` without draftRef to clear this conversation's pending state, then prepare and preview a new draft.

For existing alerts, list first and use the exact alertId with pause/resume/delete as requested. Report the actual receipt; deletion retains the existing in-app confirmation. Never claim monitoring is active merely because a draft or simulation exists.
