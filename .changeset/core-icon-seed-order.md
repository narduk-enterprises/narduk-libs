---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

The seeded `@nuxt/icon` client bundle now includes `lucide:check`, `lucide:copy`
and `lucide:link`, which `AppCopyButton` and `AppShareButtons` render. The build
now warns when an app lists `@nuxt/icon` before narduk-core without setting
`icon.fallbackToApi: false`: `@nuxt/icon` has then already installed with the
Iconify API fallback, which an enforcing CSP refuses (narduk-libs#467). The
README states the module order.
