---
'@narduk-enterprises/narduk-seo': patch
---

Send `X-Robots-Tag: noindex, nofollow` on 4xx and 5xx responses. A 404 page used
to keep the route's `index, follow` header, which @nuxtjs/robots sets before the
status is known.
