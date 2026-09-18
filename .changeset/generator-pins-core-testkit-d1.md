---
'@narduk-enterprises/create-narduk-app': patch
---

Pin generated apps to the narduk-core release with `useSsrNow` and migration
`0006_user_id_indexes.sql`, and the narduk-testkit release with the `./d1`
query harness. A newly generated app applies `0006` with its first
`db:migrate:local` / `cf:deploy`.
