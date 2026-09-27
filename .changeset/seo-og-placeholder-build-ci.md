---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-seo': patch
---

A non-dev build refuses the committed `NUXT_OG_IMAGE_SECRET` placeholder unless
it is an explicit `build:ci`. The signal is `NARDUK_CLOUDFLARE_BUILD=1`, which
the generated `build:ci` script already exports, and none of `WORKERS_CI`,
`WORKERS_CI_BRANCH`, or `NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY`. A `build` or
`cf:build` that defaults the placeholder is refused, so that output cannot be
deployed with the public value baked in. A real secret is still accepted.
`nuxt dev` and `nuxt prepare` stay permissive. The generator release picks up
the new narduk-seo pin.
