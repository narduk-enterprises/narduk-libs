---
'@narduk-enterprises/narduk-auth': minor
---

Set `runtimeConfig.nardukHealth.authTables`, so narduk-core's `/api/health`
checks the auth tables only in apps that install narduk-auth, and narduk-core
fails the build when such an app also declares `databaseBackend: 'none'`. The
README now states that narduk-auth needs an app database.
