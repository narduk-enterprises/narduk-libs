---
'@narduk-enterprises/narduk-seo': minor
'@narduk-enterprises/create-narduk-app': patch
---

`@narduk-enterprises/narduk-seo/shared/hostAwareIndexing` exports
`canonicalRobotsPolicy(hostname, canonicalHostname, options)`, which returns
the full robots directive for a request host:
`'index, follow, max-image-preview:large'` (exported as `hostAwareIndexRule`)
on the canonical host and `'noindex, nofollow'` everywhere else. Options cover route-level
`indexable: false`, `additionalCanonicalHostnames` for aliases such as `www.`,
and overrides for both directive strings. Apps that carry their own
`robotsForHostname` and hardcoded canonical hostname can use it instead
(narduk-libs#836).
