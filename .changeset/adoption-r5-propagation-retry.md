---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`doctor --adoption --live --expect-sha` retries the smoke route it grades for R5 — the build-version header and the document on that route — with the same bound as `verify --live --attempts`: the app's `liveProof.attempts` and `intervalSeconds`, otherwise 6 times 10 seconds apart, inside the 180-second deadline. Each attempt uses a new cache-busting query so a cached copy of the previous release is not replayed. A stamp that still disagrees after that bound fails R5 with the same detail as before. A run with no `--expect-sha` still reads the route once.
