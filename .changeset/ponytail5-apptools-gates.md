---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`versions-promote` refuses (stale-promote) when production has no single visible live version (split traffic, or a live version outside the listed window), unless `--force`.
`ship` re-reads production before a failed-proof rollback and never rolls back over a version another writer deployed.
`ship -m` checks the deploy token and Access variables before committing, and undoes its commit on any refusal or error before the push.
`ship` treats `*API_KEY*` environment values (except `NUXT_PUBLIC_*`) as secrets in the public-asset leak scan.
A derived staging config refuses a production Durable Object binding that names another Worker (`script_name`).
`db migrate`/`db status` check the database id bound in `--wrangler-config` against contract-owned databases.
The node fetch transport drops `authorization`, `cookie` and `proxy-authorization` on a cross-origin redirect.
