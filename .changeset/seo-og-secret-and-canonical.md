---
'@narduk-enterprises/narduk-seo': patch
---

Require a stable OG signing secret, and stop protocol-relative paths from
poisoning `og:url` / canonical.

**OG images.** With no `security.secret`, `nuxt-og-image` auto-generates one per
build, so every previously signed `/_og/d/<params>.png` URL stops verifying: a
rolling Worker release serves two secrets at once and cached signed URLs 403
until they are regenerated. Signing is resolved at build time, so the secret
belongs in a Workers Builds Build variable rather than a runtime Worker secret.
Non-dev builds that still enable runtime generation now fail unless
`NUXT_OG_IMAGE_SECRET` is a non-empty value (whitespace does not count).
`nuxt dev` and `nuxt prepare` stay permissive. Operators: set
`NUXT_OG_IMAGE_SECRET` in every deployed environment, or set
`ogImage.enabled: false` / `ogImage.zeroRuntime: true` if the app only uses the
static `defaultOgImage`. The committed CI placeholder
(`narduk-test-only-og-image-secret-000000`) is rejected on any build the estate
deploys -- Workers Builds (`WORKERS_CI` / `WORKERS_CI_BRANCH`) and a local
`wrangler deploy` behind `NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY` -- so it cannot
sign a live Worker. Builds that produce nothing deployable (`nuxt dev`, GitHub
Actions `build:ci`, packed-consumer fixture apps) may still use it.

**Canonical URLs.** `new URL('//attacker.example', site)` was accepted as HTTPS
with no userinfo. Router paths and explicit `canonicalUrl` values are now
sanitized to a same-origin path (or a same-origin absolute URL) before
resolution; poisoned input falls back to `/` and never throws.
