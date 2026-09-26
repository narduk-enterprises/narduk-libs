---
'@narduk-enterprises/create-narduk-app': patch
---

`upgrade` appends the `narduk:e2e-policy` block to `docs/e2e-testing.md` when the markers are missing, the same way it appends the router block to `AGENTS.md`. The surrounding prose stays put. A `narduk:unmanaged` header still opts the file out.
