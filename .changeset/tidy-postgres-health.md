---
'@narduk-enterprises/narduk-postgres': patch
---

Fix health extension lookups through postgres.js unprepared connections by
binding scalar names, and preserve successful connectivity when a later
statement fails. Add an opt-in unprepared text-parameter fake guard and a
read-only real PostgreSQL regression suite.
