---
'@narduk-enterprises/narduk-seo': minor
---

Add host-aware runtime indexing (`hostAwareIndexing` module option /
`NARDUK_SEO_HOST_AWARE_INDEXING` env). Production-target builds that opt in
ship a runtime guard — a nitro middleware plus an app plugin — that serves
`noindex, nofollow` (response header and robots meta) on any non-canonical
request host, such as an immutable route-free `workers.dev` preview alias,
while the canonical site host stays fully indexable. This enables the
build-once contract where one exact Worker version is preview-safe on its
preview URL and indexable on the production domain, instead of baking
noindex into a separate preview build. Non-production deployment targets are
unchanged (the existing build-time noindex safety still applies), and the
feature is off by default.
