---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core ships three first-paint defaults (#1369), each overridable by the
app's own config and switchable off with `nardukCore.performance`:
`ui.experimental.componentDetection: true` (the entry stylesheet carries only
the Nuxt UI themes the app renders; in the fixture it drops from 194 KB to 57
KB), a `build:manifest` hook that sets `prefetch = false` on every entry and
`preload = false` on script entries (no `modulepreload` or `prefetch` links in
the page head; stylesheet preload stays), and
`experimental.defaults.nuxtLink.prefetchOn: { visibility: false, interaction: true }`.
Detection never scans a module, so core also names the `U*` components that
narduk-ai, narduk-analytics and narduk-seo render when they are installed;
narduk-auth and narduk-shell already name their own. Opt out with
`performance: { componentDetection: false }`, `{ resourceHints: false }` or
`{ linkPrefetch: false }`. An app that renders a Nuxt UI component only through
a module outside this repo lists it:
`ui.experimental.componentDetection: ['UCard']`. create-narduk-app: pin the new
narduk-core.
