---
'@narduk-enterprises/create-narduk-app': minor
---

Scaffold a `.github/dependabot.yml` with one Dependabot group (`narduk-libs`,
patterns `@narduk-enterprises/*`) for the npm ecosystem
(components-library-plan.md §2 item 6, narduk-libs#253), so a fleet-wide bump of
narduk-shell / narduk-ui / narduk-charts / narduk-core / etc. lands as one PR
per generated app instead of one per package. Its `registries:` block reuses the
same GitHub Packages registry URL as the committed `.npmrc`
(`https://npm.pkg.github.com`) and reads the org-level Dependabot secret
`NARDUK_PLATFORM_GH_PACKAGES_READ` (Dependabot secrets are a separate store from
Actions secrets; the org already holds one under that name), so Dependabot
resolves private `@narduk-enterprises/*` versions. The existing `renovate.json`
scaffold is unchanged; `foundation:check` item 5.2 already accepts either.
