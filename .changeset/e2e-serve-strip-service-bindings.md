---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app e2e-serve` strips `services` from a sibling Wrangler config before
`unstable_startWorker` so a service binding whose target Worker is not in the
E2E run no longer prevents the local worker from booting (narduk-libs#788).
Each dropped binding is logged by name. Set `E2E_KEEP_SERVICE_BINDINGS=1` to
leave the app config as written.
