---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': minor
---

Add `narduk-app e2e-serve <port>`, the shared prebuilt-Worker Playwright
launcher the estate `nuxt-cloudflare` callable assumes every narduk-app has
(narduk-libs#447).

It serves an already-built `.output/server/index.mjs` through the app's own
`wrangler` (`unstable_startWorker`, watch off), binds 127.0.0.1 only, refuses to
compile a fallback, and writes `[e2e-serve]` startup notes to stderr so a
stalled start is visible in Playwright's webServer log. Real worker errors pass
through; the only filtered stderr is workerd's client-abort
`kj::getCaughtExceptionAsKj() … Broken pipe` block, lifted with its tests from
Buoys `fix/e2e-workerd-epipe-filter` (buoys#124).

`create-narduk-app` now scaffolds `playwright.config.ts` so
`E2E_PREBUILT_ARTIFACT=1` runs `narduk-app e2e-serve <port>` and the default
stays `nuxt dev`, and documents that path in the generated e2e guide.
