---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
---

`./format` adds `calendarDateIn` and `isSameCalendarDay`: the calendar date of an instant in a named zone as a sortable `YYYY-MM-DD` key, read from `Intl`'s parts rather than the `en-CA` formatted-string trick five apps hand-rolled. Both are also on `createFormatters()`'s bound set (narduk-libs#992).
