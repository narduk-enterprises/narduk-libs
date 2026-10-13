---
'@narduk-enterprises/eslint-config': minor
---

Add `narduk/e2e-timeout-ceiling` to the `e2e` pack at `warn`, upstreamed from operator-portal#2392. On `tests/e2e/**` and `e2e/**` (never `playwright.config.*`) it flags a literal `test.setTimeout(n)` over `testTimeoutMs` (default 60 000), any literal `{ timeout: n }` over `waitTimeoutMs` (default 30 000), and `new Promise((resolve) => setTimeout(resolve, n))` sleeps, which `playwright/no-wait-for-timeout` cannot see. Non-literal budgets such as `routes.length * 10_000` are left alone. An app with a spec that really waits out a server window turns the rule off for that file in its own flat config. Apps lint at `--max-warnings 0`, so an app that adopts this release sees new warnings for any spec over the ceilings.
