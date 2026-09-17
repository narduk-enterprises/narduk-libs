---
'@narduk-enterprises/create-narduk-app': minor
---

Bring the generated scaffold to parity with the Buoys reference app shape
(narduk-enterprises/company-hq#745): explicit `@nuxt/icon` module registration
(fixes an `UNLOADABLE_DEPENDENCY` build failure), a pinned `nitro-cloudflare-dev`
devDependency, a `copilot-setup-steps.yml` workflow, a corrected
`.github/dependabot.yml` shape (single `directory`, `github-actions` ecosystem
group), root `build:ci` / `foundation:check` / `manifests:validate` scripts
plus the `@narduk-enterprises/narduk-app-tools` devDependency that back them,
a generated `apps/web/scripts/validate-manifests.mjs` pre-deploy check, new
`CONTRACT.md` and `docs/workers-builds.md` templates, a Playwright
`setup`/`chromium` project split, and a generic `docs/e2e-testing.md` plus
`apps/web/tests/e2e/visual-audit.spec.ts` skeleton built on narduk-testkit's
`playwright/ui-quality` toolkit (`consoleTracker`, full-page and named-locator
capture). Every generated file remains Prettier-canonical under the package's
own format:check.
