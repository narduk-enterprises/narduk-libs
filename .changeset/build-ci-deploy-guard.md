---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app deploy deploy` and `narduk-app deploy versions-upload` refuse an `.output` that contains `.narduk-build-ci`. That file means `build:ci` baked the public test-only `NUXT_SESSION_PASSWORD` and `NUXT_OG_IMAGE_SECRET` into the Worker. The message names `.narduk-build-ci` and `cf:build`. `deploy-local`, `deploy-hotfix`, and `development deploy` publish through those commands, so a marked output cannot go out on those paths either. `--dry-run` prints the same fact and exits 0, because a dry run publishes nothing.

`build:ci` writes `.narduk-build-ci` next to the Nitro output it just produced: `apps/web/.output` on the apps/web layout, and `.output` on a root-layout app. `upgrade` picks the directory from the layout it already infers, so an upgraded app gets the marker without a generated deploy-script guard. A later `cf:build` replaces `.output` and drops the marker. `build:ci` still refuses to run when `WORKERS_CI`, `WORKERS_CI_BRANCH`, or `NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY` is set. GitHub Actions `build:ci` is unchanged.
