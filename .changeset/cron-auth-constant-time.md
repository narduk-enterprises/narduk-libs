---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

`requireCronAuth` now compares the bearer token with `CRON_SECRET` in constant time instead of with `!==`, which exits at the first differing character (narduk-libs#871).
