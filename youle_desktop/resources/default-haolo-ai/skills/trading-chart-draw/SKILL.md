---
name: trading-chart-draw
description: Draw verified Haolo strategy or indicator results on the native K-line chart, including structures, zones and plan levels. Use after live analysis or when asked to display an existing analysis on the chart.
---

Call `haolo_chart_draw` with the analysisRef returned by `haolo_analysis`. No price, point, chart identity or plan payload is accepted from the model. Drawing Gateway validates and persists the original patches to their original conversation and panes. Honor no-drawing requests. A drawing failure does not invalidate completed analysis: report it, preserve the plan, and retry this step only.

For alert/personal-strategy demonstrations call `haolo_chart_draw` with draftRef after `haolo_simulation`. Supply exactly one analysisRef or draftRef. This displays the simulator's separate layer and confirmation question. If the originating conversation is not visible or preview fails, reopen it and retry this step before confirmation; never mix synthetic candles with real market evidence.
