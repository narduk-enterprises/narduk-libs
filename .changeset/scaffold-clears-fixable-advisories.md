---
'@narduk-enterprises/create-narduk-app': patch
---

A freshly scaffolded app now passes its own CI dependency audit. The root `pnpm.overrides` floors `simple-git` at `^4.0.2`, `@simple-git/argv-parser` at `^2.0.1` and `sharp` at `^0.35.5`, which clears the five fixable high and critical advisories (simple-git and argv-parser through `@nuxt/devtools`, sharp through miniflare), and `apps/web/nuxt.config.ts` sets `devtools: { enabled: false }`, because devtools 3.x default-imports simple-git and 4.x has no default export, so the floor breaks `nuxt prepare` with devtools on (#1531).
