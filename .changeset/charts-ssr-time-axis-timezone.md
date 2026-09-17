---
'@narduk-enterprises/narduk-charts': patch
---

Pin default time-axis labels to `en-US` / `UTC` (optional `timeZone` prop) so
SSR and the browser cannot disagree on tick text or the tick set.
