---
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/create-narduk-app': patch
---

Pin SSR hydration for `NardukLineChart` and `ChartTooltip`. The components are
unchanged; these are the first hydration tests in the package, added while
narrowing riverstatus#204 — they server-render each component, hydrate that
exact markup and assert that Vue raised no warning, which is the only place a
hydration mismatch is visible.

`create-narduk-app` releases alongside because it pins narduk-charts.
