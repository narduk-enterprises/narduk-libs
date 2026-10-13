---
'@narduk-enterprises/create-narduk-app': minor
---

New apps get `apps/web/Config/brand.json` (one of ten contrast-checked palettes, a layout and a texture picked from the app name) instead of the generic `public/og-source.svg`. `build` and `cf:build` run `narduk-app assets generate --if-missing`, `og:check` and `narduk-app assets check` before `nuxt build`, so a build without a real favicon set and share card fails; `assets:generate`, `assets:check` and `assets:check:live` scripts are added. `narduk-app upgrade` does not change an existing app's build scripts.
