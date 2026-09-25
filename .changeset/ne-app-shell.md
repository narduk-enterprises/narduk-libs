---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `NeAppShell` (components backlog item 18, narduk-libs#265): the opt-in
application frame — a rail of labelled, always-expanded sections whose active
item comes from the router, with ArrowUp/ArrowDown/Home/End focus movement, a
drawer only below Nuxt UI's `lg` breakpoint, `rail-top` / `rail-bottom` /
`navbar` / `navbar-right` slots, and one `<main>` with a skip link. Built on
`UDashboardGroup`, `UDashboardSidebar`, `UDashboardNavbar` and
`UNavigationMenu`. Nothing is registered as a layout and nothing is scaffolded.

New module options `accent`, `structure` and `sections` pass through
`app.config.nardukShell` as a default the app's own `app.config.ts` beats.
`accent` / `structure` set `--ne-accent` / `--ne-structure` app-wide, teleported
overlays included, through one head `<style>`; with neither set nothing is
written. `useNardukShellSections()` is auto-imported (also with
`components: false`): shared, SSR-safe rail state seeded from `sections`.
