---
'@narduk-enterprises/create-narduk-app': patch
---

Generated `build:ci` refuses to run under Workers Builds (`WORKERS_CI`, `WORKERS_CI_BRANCH`) or a local wrangler deploy (`NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY`), so its public test-only `NUXT_OG_IMAGE_SECRET` and `NUXT_SESSION_PASSWORD` cannot be baked into a deployed Worker. GitHub Actions `build:ci` is unchanged.
