---
'@narduk-enterprises/narduk-seo': patch
---

Fall back to the page's own route when a canonical is refused, instead of to the
site root. `resolveSafeCanonicalUrl` still refuses protocol-relative values,
backslash smuggling and cross-origin absolutes — that part was right — but it
answered the site root, so an app handing `useSeo` a `http://localhost:3000/...`
absolute (what `runtimeConfig.public.siteUrl` resolves to wherever `SITE_URL` is
unset) made every page on the site declare the root as its own `canonical` and
`og:url`. Valid, plausible, and wrong everywhere at once; it shipped to
production in LakeStat and was caught only by a live preview check. The route is
the one thing the refused value and the page agreed on, so it is the fallback;
the site root remains the last resort. In development a refusal now warns and
names both sides.
