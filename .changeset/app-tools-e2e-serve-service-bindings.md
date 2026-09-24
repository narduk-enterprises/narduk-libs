---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app e2e-serve` now drops service bindings to Workers outside the E2E run
instead of letting workerd refuse to start (`binding "ENGINE" refers to a
service "…", but no such service is defined`), and names each one on stderr. A
binding back to the Worker itself is kept, nothing is written into the app tree,
and `--keep-service-bindings` passes the config through untouched for an app
that runs the target Worker alongside. Dropping needs the app's wrangler at
4.99.0 or later (narduk-libs#788).
