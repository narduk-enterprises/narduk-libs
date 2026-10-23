---
'@narduk-enterprises/eslint-config': patch
---

`no-process-env-in-worker-runtime` sees an imported `node:process` and `global.process`; `require-limit-on-drizzle-list-queries` no longer treats `or()` with one primary-key arm as a single row and checks a stored select that is later returned or awaited; `require-validated-query` reports a raw read of a query that is also parsed; `require-fetch-timeout` ignores `timeout`/`signal` set to `undefined`, `null` or `void 0`.
