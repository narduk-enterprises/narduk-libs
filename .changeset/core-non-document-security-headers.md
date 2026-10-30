---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core: with the `security.headers` preset on, API, sitemap and robots
responses now carry the preset's `Permissions-Policy`, and under `enforce: true`
a nonce-free copy of the preset CSP. nuxt-security sets both only on rendered
documents, so these responses previously served neither. The serialiser is
exported from `./server/non-document-security-headers`, and the app-local copies
in riverstatus, borderwaitstat-us, lakestat-us and gonogo can be deleted after
upgrading (#1216).
