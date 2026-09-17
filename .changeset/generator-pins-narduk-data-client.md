---
'@narduk-enterprises/create-narduk-app': patch
---

Re-pin the generated app's layer versions so a newly generated app starts on the
narduk-core release that carries the narduk-data product client.

No generator behaviour changes: the templates, prompts and generated files are
identical. This is the pin refresh `scripts/check-generator-release-plan.mjs`
requires whenever a generator-owned package is released, so a generated app does
not start life on a narduk-core older than the one the estate just shipped.
