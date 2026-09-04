---
'@narduk-enterprises/create-narduk-app': patch
---

Make the scaffolded `playwright.config.ts` port overridable via
`PLAYWRIGHT_PORT`, flowing into `baseURL`, the `webServer` url, and the
`webServer` command's `PORT` env. Previously the port was a fixed literal, so
when two or more agent lanes (or a lane plus the developer) worked the same
generated repo concurrently in separate worktrees, the second Playwright run
would silently attach to the first lane's dev server and test the wrong build —
with a green result (narduk-libs#62).
