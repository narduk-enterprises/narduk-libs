---
'@narduk-enterprises/narduk-shell': patch
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

Widen the `@nuxt/ui` peer dependency from exactly `4.11.1` to `>=4.11.1 <5`, matching narduk-core and narduk-auth, so apps on Nuxt UI 4.12 can install these packages (narduk-libs#1981).
