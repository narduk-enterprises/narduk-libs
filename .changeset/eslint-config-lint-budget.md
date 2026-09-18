---
'@narduk-enterprises/eslint-config': minor
---

Add `narduk-lint`, an ESLint runner that holds warnings to a checked-in
`lint-budget.json` instead of `--max-warnings 0`: errors fail, a rule over its
budget fails, an unbudgeted rule passes, local runs only ratchet budgets down,
and CI never writes. Add `narduk/no-render-clock`,
`narduk/no-secret-in-public-runtime-config`, `narduk/require-fetch-timeout` and
`narduk/prefer-db-batch`; turn on type-aware promise rules (errors in
`server/**`, warnings elsewhere), `await-thenable`,
`switch-exhaustiveness-check`, `sonarjs/sql-queries`, server `no-console` and
unused-directive reporting; widen `require-limit-on-drizzle-list-queries` to
`.where(eq(<non-key column>))` with a `// narduk-bounded: <reason>` escape.
`createAppLintConfig()` now uses the `@typescript-eslint` plugin paired with its
own parser.

**This release turns consumer lint red on purpose.** The new error-severity
rules (server `no-floating-promises` / `no-misused-promises`, `no-render-clock`,
`no-secret-in-public-runtime-config`, and the wider
`require-limit-on-drizzle-list-queries`) report real defects, and an app that
has them fails lint after the bump. That is intended: warnings are budgeted, the
super offenders go red and get fixed. See the README, "Upgrading to the budget
release".
