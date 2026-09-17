---
'@narduk-enterprises/create-narduk-app': patch
---

Generate a `playwright.config.ts` that resolves its local dev port through
`@narduk-enterprises/narduk-testkit/playwright/dev-port` instead of
`Number(process.env.PLAYWRIGHT_PORT) || <scaffolded port>`, and add
`@narduk-enterprises/narduk-testkit` to the generated app's root devDependencies
so the root config can resolve it.

A linked worktree of a generated app now gets its own derived port and refuses
to reuse a server it did not start, which is what stops two lanes on one machine
from silently testing each other's branch (narduk-libs#417). The primary
checkout and CI keep the scaffolded port, so no pipeline behaviour changes.
