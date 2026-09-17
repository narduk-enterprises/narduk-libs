---
'@narduk-enterprises/narduk-charts': patch
---

Pin default time-axis labels to `en-US` / `UTC` (optional `timeZone` prop) so
SSR and the browser cannot disagree on tick text or the tick set.

## Operator action / behaviour change

Default labels moved from the host locale and zone to `en-US` / UTC with a
12-hour clock. Pass `timeZone` (IANA) for local labels. `formatTime` still
overrides both.
