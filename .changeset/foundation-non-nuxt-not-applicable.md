---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/create-narduk-app': patch
---

`foundation:check` no longer holds an app without Nuxt to the Nuxt modules (#157). An app with no `nuxt.config.*` at a known path and no `nuxt` dependency gets sub-check 2.1 on `narduk-testkit`, `narduk-app-tools` and `eslint-config` only, and 2.1c (`narduk-core`), 2.3 (when `narduk-core` is not a dependency) and 3.1/3.2/3.3 report `not-applicable`, with "not a Nuxt app" and the reason in the detail. They never report `pass`. The eslint-config README names `composeSharedConfigs()` as the supported ESLint route for an app without Nuxt.
