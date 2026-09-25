---
'@narduk-enterprises/narduk-testkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `narduk-testkit e2e check|setup|run` (narduk-libs#997), the shared
replacement for the `scripts/setup-playwright-browsers.mjs` and
`scripts/run-web-e2e.mjs` copies in 13 apps. `check` launches Chromium headless
(an existing executable is not proof it starts) and quotes the launch error;
`setup` runs the app's `playwright install chromium` into the ambient
`PLAYWRIGHT_BROWSERS_PATH` or Playwright's shared machine cache, never a
per-checkout one; `run` checks, then runs `playwright test` with the default
config, `--project=web` only when the caller chose no project (Playwright
accumulates repeated `--project` flags), and `--import tsx` once when the app
has tsx. `playwright/config` also exports `resolveBrowserCachePath(env)` and
`withDefaultProject(args, project)` for apps that keep a custom runner.
