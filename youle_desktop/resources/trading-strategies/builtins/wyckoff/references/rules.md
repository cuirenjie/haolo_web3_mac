# Wyckoff runtime rules

- A valid candidate requires a deterministic rotational trading range and sufficient volume-price evidence.
- Label PS/PSY, SC/BC, AR, ST, Spring/UTAD, Test, SOS/SOW, and LPS/LPSY only when the engine supplies the event ID and evidence.
- Preserve candidate direction, phase boundaries, range support/resistance, target, confirmation, invalidation, and stable IDs.
- Require a closed-candle boundary break and prefer a successful retest before execution.
- Treat a return inside the range after a trigger as invalidation or a false breakout.
- Keep `ai/wyckoff` and its semantic token whitelist isolated from other theories and manual drawing.
- Fail closed on a one-way trend or insufficient rotational evidence.
