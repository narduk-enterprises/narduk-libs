---
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/create-narduk-app': patch
---

Fix two narduk-charts rendering bugs. `macd()` no longer returns signal values before the MACD line exists; the signal now starts `signalPeriod` samples after the line's first real value (#867). `NardukBarChart` with `stacked` or `stackedPercent` on a `log` or `symlog` axis now ends each stack where the axis places its total, so equal totals line up regardless of how they split across series (#873). Linear stacks are unchanged.
