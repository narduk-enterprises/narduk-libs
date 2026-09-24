---
'@narduk-enterprises/narduk-testkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

Add tag-based E2E quarantine to `@narduk-enterprises/narduk-testkit/playwright/config`: `@quarantine` via `quarantineDetails`, `grepInvert` on the `pr` / `web` projects so a tagged spec is excluded from the PR project, a `quarantine` project that collects the tag, and `assertPlaywrightQuarantineCollection` so a vitest guard fails when Playwright collects an untagged or wrongly tagged file (narduk-libs#520). `create-narduk-app` is a companion patch so the generator pin moves with the testkit release.
