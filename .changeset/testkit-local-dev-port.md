---
'@narduk-enterprises/narduk-testkit': minor
---

Add `@narduk-enterprises/narduk-testkit/playwright/dev-port`:
`resolveLocalDevPort`, `shouldReuseExistingServer`,
`assertLocalDevPortAvailable`, `isLinkedWorktree`, `isPortInUse` and
`normalizePort`.

One scaffolded local dev port per app was one port per machine: every worktree
of the app shared it, so Playwright's `reuseExistingServer` attached to
whichever worktree's `nuxt dev` got there first and the suite silently tested
the wrong branch (narduk-libs#417). A linked git worktree now derives its own
port from a stable hash of the checkout path, and does not reuse a server it did
not start. The primary checkout and every CI run keep the declared port
unchanged, so muscle memory, bookmarks and localhost allowlists still work;
`PLAYWRIGHT_PORT` (then `NUXT_PORT`) still overrides everything.

Subpath-only, like `e2e/fixture-server`: it is imported from a Playwright config
before the runner exists, so it stays out of the root barrel.
