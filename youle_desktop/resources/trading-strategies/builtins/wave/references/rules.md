# Elliott Wave runtime rules

- Standard motive: wave 2 must not pass the origin; wave 3 must pass wave 1 and cannot be the shortest motive wave; wave 4 must not fully retrace wave 3 or enter wave 1 territory; wave 5 must progress unless a small, internally verified truncation exists; internal evidence must support 5-3-5-3-5.
- A leading diagonal is valid only in wave 1 or A. An ending diagonal is valid only in wave 5 or C. Position, wedge, retracement, shortest-wave, and internal evidence are all required.
- Zigzag requires 5-3-5. Flat variants require 3-3-5. Double Three requires verified W, X, and Y corrections.
- Preserve stable candidate and point IDs. Keep main and alternate counts, but draw only the primary path.
- Preserve the host's historical-range boundary during auto-expansion; never add candles after a requested historical endpoint.
- Keep `ai/wave` and its five semantic color tokens isolated.
- Return `insufficient_data` rather than packaging an invalid motive as a complete cycle.
