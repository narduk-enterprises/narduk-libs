---
'@narduk-enterprises/create-narduk-app': patch
---

Give generated CI a committed test-only `NUXT_OG_IMAGE_SECRET` so `nuxt build`
does not fail closed.

narduk-seo now throws on a non-dev build when runtime OG is enabled and the
secret is empty. Public `quality` / `browser` jobs set the Playwright
placeholders as plain `env:` values (not repository secrets). The private
reusable workflow cannot inherit caller env, so the same placeholders prefix
`build:ci`. The Workers Builds runbook requires `NUXT_OG_IMAGE_SECRET` and
`NUXT_SESSION_PASSWORD` as Build variables — Worker secrets are runtime-only.
