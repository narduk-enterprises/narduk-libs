---
'@narduk-enterprises/eslint-config': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add web-app audit rules. `core` now reports redirect-like query reads that skip a same-origin guard (`narduk/require-safe-redirect-query`, with `guards`/`params` options), native `alert`/`confirm`/`prompt` in app code, and `vue/no-v-html` without the community layer. `design-system` reports `vh` in inline styles (`narduk/no-viewport-vh-units`). The opt-in `a11y` pack knows Nuxt and Nuxt UI links, labels and controls, and replaces upstream's static-element rules with `narduk/no-static-element-interactions`. Each is `warn`, so an app that adopts this version can go red until its findings are fixed.
