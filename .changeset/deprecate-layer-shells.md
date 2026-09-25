---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Deprecate `LayerAppShell`, `LayerChromelessShell` and `LayerDashboardShell` in
favour of narduk-shell's `NeAppShell` (components backlog item 18,
narduk-libs#265). They will be removed in the next narduk-core major. Behaviour
is unchanged: this adds `@deprecated` JSDoc and a README migration mapping only,
with no runtime warning, since core's own `app.vue` and `dashboard` layout still
render them.
