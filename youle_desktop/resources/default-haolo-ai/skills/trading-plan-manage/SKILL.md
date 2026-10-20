---
name: trading-plan-manage
description: List, read, add, activate, end or delete Haolo execution plans when the user requests plan management. Use after a verified analysis plan exists or for existing saved plans.
---

Use `haolo_plans` with exact planId from a verified result or list/read receipt. Host obtains the current owned plan, hashes and version; never supply prices, risk values, scenario conditions or account identity.

`add` follows the current Add to plan behavior: save then activate linked reminders. Existing saved pending plans also follow the product's automatic reminder reconciliation. Do not promise a saved plan will remain inactive. `activate` activates reminders for a saved plan. `end` ends a plan with the user's stated reason (otherwise cancelled). `delete` retains the in-app confirmation.

Only invoke mutations for the user's requested plan operation; analysis and displaying a plan do not authorize activation. Report the actual server result. These operations do not place exchange orders.
