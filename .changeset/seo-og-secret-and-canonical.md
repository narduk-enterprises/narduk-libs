---
'@narduk-enterprises/narduk-seo': patch
---

Stop shipping an unsigned OG renderer, and stop protocol-relative paths from
poisoning `og:url` / canonical.

**OG images.** `nuxt-og-image` treats an empty `security.secret` as unset and
skips URL signatures, so `/_og/d/<params>.png` rendered attacker-chosen images.
Non-dev builds that still enable runtime generation now fail unless
`NUXT_OG_IMAGE_SECRET` is a non-empty value (whitespace does not count).
`nuxt dev` and `nuxt prepare` stay permissive. Operators: set
`NUXT_OG_IMAGE_SECRET` in every deployed environment, or set
`ogImage.enabled: false` / `ogImage.zeroRuntime: true` if the app only uses the
static `defaultOgImage`.

**Canonical URLs.** `new URL('//attacker.example', site)` was accepted as HTTPS
with no userinfo. Router paths and explicit `canonicalUrl` values are now
sanitized to a same-origin path (or a same-origin absolute URL) before
resolution; poisoned input falls back to `/` and never throws.
