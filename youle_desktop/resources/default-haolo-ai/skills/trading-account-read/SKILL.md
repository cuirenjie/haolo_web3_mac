---
name: trading-account-read
description: Read the current Haolo user's Binance balance, positions, open orders and recent position history. Use before strategy/indicator analysis and whenever the user asks about their holdings or position adjustment.
---

Call `haolo_account_read` with only relevant sections. For strategy or position analysis include summary and positions; include orders/history when they affect the question. Preserve timestamps, warnings and unavailable sources. Unbound/unavailable is not zero holdings. Read effective trading preferences with `personal_context` before personalized planning. Cloud analysis independently freezes and validates account facts and risk limits.

Return facts to the root Codex workflow; this capability cannot trade or change account settings. Never put credentials or invented balances into another tool.
