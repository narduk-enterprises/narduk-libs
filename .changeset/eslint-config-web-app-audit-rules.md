---
'@narduk-enterprises/eslint-config': minor
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-auth': patch
---

Add web-app audit rules. `core` now reports redirect-like query reads that skip a same-origin guard (`narduk/require-safe-redirect-query`, with `guards`/`params` options), native `alert`/`confirm`/`prompt` in app code, and `vue/no-v-html` without the community layer. `design-system` reports `vh` in inline styles (`narduk/no-viewport-vh-units`). The raw palette, arbitrary colour and `vh`/`screen` class bans move from `better-tailwindcss/no-restricted-classes`, which switched itself off when `tailwindcss` did not resolve from the lint cwd, to `narduk/no-restricted-utility-classes`, which needs no Tailwind and now sees variants (`hover:text-slate-500`), `!` and `/opacity` modifiers, and arbitrary colours. `createAppLintConfig` takes `allowedRawPaletteFiles` for chart palettes. A native `<header>` in a page is no longer reported. The opt-in `a11y` pack knows Nuxt and Nuxt UI links, labels and controls, and replaces upstream's static-element rules with `narduk/no-static-element-interactions`. Each is `warn`, so an app that adopts this version can go red until its findings are fixed.

`narduk-auth` annotates `AuthExchangePanel.vue`'s `next` read, which its exchange route sanitizes server-side, for the new redirect rule.
