---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core: with the `security.headers` preset on, non-HTML responses (API,
sitemap, robots) now carry the preset's `Permissions-Policy`. Under
`enforce: true` they also get a nonce-free copy of the preset CSP. nuxt-security
sets both only on rendered documents, so these responses previously served
neither. HTML responses and headers that are already set (route rules, handlers)
are left untouched. The serialiser is exported from
`./server/non-document-security-headers`. After upgrading, delete the app-local
copies in riverstatus, borderwaitstat-us, lakestat-us and gonogo (#1216).
