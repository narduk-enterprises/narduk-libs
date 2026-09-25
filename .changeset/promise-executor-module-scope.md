---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/create-narduk-app': patch
---

The Cloudflare Workers module-scope analyzer treats a `new Promise(executor)`
executor as running during module evaluation, which it does: the executor
runs synchronously during construction (narduk-libs#887). The four rules built
on it (`no-worker-global-scope-operations`, `no-worker-global-scope-db-clients`,
`no-supabase-client-in-global-scope`, and the rest) now report a `fetch`,
`new Pool` or `createClient` inside a module-scope `new Promise((resolve) => …)`,
whether the executor is inline or a named function. Work the executor defers
(`setTimeout`, `.then`) stays unreported. `create-narduk-app` is a companion
patch because it pins eslint-config.
