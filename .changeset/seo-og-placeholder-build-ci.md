---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/narduk-seo': patch
---

A non-dev build that carries the committed `NUXT_OG_IMAGE_SECRET` placeholder
now fails unless `NARDUK_CLOUDFLARE_BUILD=1` is set and none of `WORKERS_CI`,
`WORKERS_CI_BRANCH`, or `NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY` is. A plain `build`
and a `cf:build` without that variable used to be accepted and are now refused.

The generated `build:ci` sets `NARDUK_CLOUDFLARE_BUILD=1`, and so do most
hand-written `cf:build` scripts and `hotfix:build`. When narduk-seo accepts the
placeholder on that signal, it writes `.narduk-build-ci` into the Nitro output
after compile. `narduk-app deploy` already refuses an output holding that file
(`deploy` and `versions-upload`, and through them `deploy-local`,
`deploy-hotfix`, and `development deploy`), so a placeholder-signed output cannot
be published through `narduk-app` whichever script built it, including with
`NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1`. A plain `wrangler deploy` outside
`narduk-app` does not read the marker. A real secret is accepted and writes no
marker. `nuxt dev` and `nuxt prepare` stay permissive.

narduk-app-tools' refusal message now names both writers of the marker and asks
for a `cf:build` with real secrets. The generator release picks up the new pins.
