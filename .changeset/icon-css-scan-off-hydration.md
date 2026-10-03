---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core: the `@nuxt/icon` css-mode stylesheet scan leaves the hydration path
(#1379). Stock `NuxtIconCss` reads every rule of every stylesheet on the first
client icon mount (about 10% of the hydration task on a 194 KB Tailwind and Nuxt
UI app at 4x CPU throttle, 10.4 to 11.2 ms median); a client-only Vite transform
now looks the icon class up in the inline `<style>` text instead, where the
server's icon style and any client-injected one live. Markup, CSS and pixels are
unchanged (built fixture: identical first paint with JavaScript off, identical
hydrated screenshot and DOM, zero `cssRules` reads versus three), and an icon
the server did not render is mounted exactly as before. The app's `icon` config
is untouched. The transform stands down under UnoCSS, when `@nuxt/icon`'s
`css.js` no longer matches the pinned 2.5.1 source (build warning), or with
`NARDUK_ICON_CSS_SCAN=upstream` at build time. create-narduk-app: pin the new
narduk-core.
