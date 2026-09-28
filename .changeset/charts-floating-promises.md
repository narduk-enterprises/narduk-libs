---
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/create-narduk-app': patch
---

`NardukBarChart` and `NardukPieChart` keyboard navigation no longer detach the focus tick: an error while moving focus now reaches the app's `errorHandler` instead of surfacing as an unhandled promise rejection.
