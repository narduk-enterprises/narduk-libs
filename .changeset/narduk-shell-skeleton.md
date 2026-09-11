---
'@narduk-enterprises/narduk-shell': minor
---

Add `@narduk-enterprises/narduk-shell`, the home of the app-tier `Ne*` component
suite (components-library backlog item 1, narduk-libs#248; backlog
narduk-libs#247; standing decision company-hq D-WEBFOUND-2 and its 2026-09-11
amendment).

This release is the skeleton, not the furniture. It ships:

- a Nuxt module (meta name `narduk-shell`, config key `nardukShell`) that
  registers components from a static registry with one explicit `addComponent`
  call per entry and **never** calls `addComponentsDir`, so an app-local
  `NeStatePanel.vue` collides loudly at build time instead of silently shadowing
  the shared component;
- the three reserved subpath exports `.`, `./format` and `./theme.css`.
  `./format` is an empty module reserved for the shared `Intl`-based formatters
  (item 5, narduk-libs#252) and `./theme.css` an empty sheet reserved for the NE
  token layer mapped onto Nuxt UI's `--ui-*` variables (item 2,
  narduk-libs#249). Both resolve from an external consumer today, so no app has
  to change an import specifier when the content arrives;
- peers `nuxt >=4.0.0`, `vue >=3.5.0` and `@nuxt/ui` at exactly `4.6.0`, the
  version `@narduk-enterprises/narduk-core` pins.

The component registry is deliberately empty: each later backlog item adds its
component together with its registry entry, README section and tests.
