---
'@narduk-enterprises/narduk-charts': patch
---

The packed `dist/index.d.ts` (and the `dist/index.d.cts` copy) again exports the public surface, including `NardukLineChart` and `ChartSeries`. TypeScript 6 was emitting those declarations under `dist/src/` and leaving the types entry as `export {}`.

Refs narduk-libs#1161
