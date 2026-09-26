---
'@narduk-enterprises/narduk-app-tools': patch
---

`doctor --adoption` requirement R4 is labeled foundation evidence for items 1-9. Items 10-12 stay on their own requirements. An unreadable deployment block no longer copies one parse error onto R1, R5, R6, and R7: R6 is not-applicable when the app declares no D1 binding, and R7 is not-applicable when it declares no D1, KV, or R2 binding. Bare `doctor` reports `clean: false` when `cf:build` or `db:migrate:remote` is missing. Those checks stay warnings, so the bare-doctor exit stays 0.
