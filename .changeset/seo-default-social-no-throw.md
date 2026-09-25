---
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/create-narduk-app': patch
---

The default social image plugin no longer throws from its `useHead` getter (narduk-libs#874). An app with `defaultOgImage` and no usable site URL (unset, unparsable, or plain HTTP on a public host) used to fail SSR on every page. It now renders the page without the default `og:*` tags and logs one `[narduk-seo] Default social metadata skipped: …` warning per process. `defaultSocialMeta()` itself still rejects unsafe input, now with a clear message when the site URL is missing.
