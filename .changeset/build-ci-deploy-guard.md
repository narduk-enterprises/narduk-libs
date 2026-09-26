---
'@narduk-enterprises/create-narduk-app': patch
---

Generated `build:ci` refuses to run under Workers Builds (`WORKERS_CI`, `WORKERS_CI_BRANCH`) or a local wrangler deploy (`NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY`). When it does run, it marks `apps/web/.output/.narduk-build-ci`, and the generated `cf:deploy`, `cf:deploy:preview`, `deploy`, and `deploy:dry-run` scripts refuse to upload that output. `pnpm run quality:static` followed by `pnpm run cf:deploy` therefore cannot publish the public test-only `NUXT_OG_IMAGE_SECRET` and `NUXT_SESSION_PASSWORD`. A later real build replaces `.output` and clears the marker. GitHub Actions `build:ci` is unchanged.
