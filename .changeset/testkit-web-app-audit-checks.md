---
'@narduk-enterprises/narduk-testkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add four web-app audit subpaths. `http-contracts` (no Playwright import, runs in
a plain-Node deploy smoke) checks security headers (HSTS, enforced CSP and
`frame-ancestors`, `nosniff`, `Referrer-Policy`, `noindex` off production) and
that an unauthenticated protected API answers 401 JSON and an unknown path 404
rather than a redirect to sign-in. `playwright/console-guard` is an automatic
fixture that fails a test on `console.error` or `pageerror`, built on
`createConsoleTracker`, which gains a backwards-compatible `levels` option.
`playwright/layout` checks horizontal overflow at 320px and WCAG 2.2
touch-target size against a per-surface baseline, asserted in both directions.
`d1-migration-lint` flags money-named REAL/FLOAT/DOUBLE/NUMERIC/DECIMAL columns
and `DROP TABLE`, `DROP COLUMN` and `RENAME` statements, with hash-pinned
allowances that go stale when nothing matches them.
