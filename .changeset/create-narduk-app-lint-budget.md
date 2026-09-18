---
'@narduk-enterprises/create-narduk-app': minor
---

Generated apps lint through `narduk-lint`: `apps/web`'s lint script is
`nuxt prepare && narduk-lint` (no more `--max-warnings 0`), and the generator
emits an empty `apps/web/lint-budget.json` (`{ "rules": {} }`).
