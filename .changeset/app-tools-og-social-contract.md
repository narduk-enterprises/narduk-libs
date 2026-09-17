---
'@narduk-enterprises/narduk-app-tools': patch
---

The social-preview check no longer requires `twitter:card=summary_large_image` or
`twitter:image`, because the estate stopped emitting every `twitter:*` meta name
(narduk-libs#349). The Open Graph contract is unchanged and still strict: exactly
one non-empty `og:title`, `og:description`, `og:type`, `og:image:alt` and `og:url`,
a canonical `og:url` on the declared origin, declared `og:image:width` /
`og:image:height` of 1200x630, and an `og:image` from a declared origin. Both the
Twitterbot and Applebot profiles still probe every sampled route.
