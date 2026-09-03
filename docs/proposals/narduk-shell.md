# Proposal: `@narduk-enterprises/narduk-shell`

**Status:** proposed, not built. Written 2026-09-03 as part of the web-cf docs/libs audit
(narduk-enterprises/company-hq#453). Filed as narduk-libs#\<issue\> for tracking; this file is
the design note that issue points at.

## Why

Logan's verbatim complaint about the operator portal (2026-09-03): *"the user interface... keep
the left nav, but dont make it just icons, i need to see a hierarchical view in there... maybe
not hierarchical but sectioned... and the fonts we use ohhhh they drive me nuts... the thing just
suffers from 5 different redesigns that never actually redesigned."* He separately chose "One new
era, delete the rest" for CSS scope and "Sectioned, labeled, always expanded" for the left rail,
and wants the PACC·TRAC design system pulled into the redesign.

`narduk-libs` has no package that supplies this. `narduk-ui` (0.1.1) is scoped to the **Status
Design System** only — four status-instrument components (gauge, range-bar, tile, chip) for the
five status apps — with no shell, no left-nav, no page-layout primitives (R4 audit finding,
company-hq#453). Every other `web-cf` app, including `operator-portal` itself, currently builds
its own layout from scratch, which is exactly how a portal ends up as "5 different redesigns
that never actually redesigned": there is no shared shell to redesign once and inherit everywhere.

## What it would be

A new, small, narduk-libs package — `@narduk-enterprises/narduk-shell` — supplying the
**sectioned left rail plus PACC·TRAC-derived tokens** as a generic Nuxt app-shell layer, the
same way `narduk-core` supplies runtime primitives and `narduk-ui` supplies status instruments.
Scope is deliberately narrow: layout chrome and design tokens, not business logic, not
auth-gating (that stays `narduk-auth`'s job), not data-fetching.

### 1. Sectioned left rail

- **Always expanded, labeled sections** — not a hierarchical tree, not icon-only. A section is a
  named group (`{ id, label, icon?, items: [{ label, to, badge? }] }`); the rail renders every
  section's items inline, no click-to-expand/collapse interaction to lose state on. This matches
  Logan's "sectioned, labeled, always expanded" call directly — reproduced here so a future reader
  doesn't have to re-derive it from the decisions log.
- **Active-route highlighting** driven by Nuxt's route matching, not manual state.
- **Collapsible only at the viewport breakpoint** (mobile becomes an overlay/drawer), never as a
  persistent icon-only mode on desktop — that icon-only mode is exactly what Logan rejected.
- **A slot for a top-of-rail app switcher/logo** and a slot for a bottom-of-rail user/account
  control, since every portal-shaped app needs both and currently reinvents them.

### 2. PACC·TRAC-derived token layer

`narduk-enterprises-clients/pacc-trac`'s `app/assets/css/main.css` already has a mature,
shipped token set worth generalizing rather than re-deriving: `--pt-navy`/`--pt-green` structure
and accent colors, `--pt-ink`/`--pt-ink-2`/`--pt-ink-3` text scale, `--pt-ground`/`--pt-surface`
surface scale, `--pt-hairline`/`--pt-divider` borders, `--pt-radius-panel`/`--pt-radius-control`/
`--pt-radius-tag`, `--pt-shadow-1`/`--pt-shadow-2`/`--pt-shadow-control`, and Instrument Sans
(self-hosted variable font) with IBM Plex Mono reserved for tabular/fixed-advance data. `narduk-
shell` would extract the **structural** half of this — surfaces, ink, radius, shadow, type scale,
the two brand hooks (a configurable `--ns-accent`/`--ns-structure` pair an app sets to its own
brand color rather than hard-coding PACC·TRAC's navy/green) — as a Tailwind/Nuxt UI `app.config`
preset plus a CSS custom-property sheet, so a consuming app gets one new, deliberate design era
instead of another ad-hoc pass. Product-specific tokens (PACC·TRAC's five stage colors, station
marks) stay in PACC·TRAC; they are functional data-viz colors, not shell chrome, and the source
file says so itself.

### Non-goals

- Not a component kit replacing Nuxt UI — it composes Nuxt UI, it doesn't fork it.
- Not the Status Design System's replacement — `narduk-ui` keeps owning status instruments;
  `narduk-shell` could depend on generalized versions of its radius/shadow tokens if that
  turns out cheaper than re-deriving them, but that's an implementation decision, not scope here.
- Not an auth or routing guard — layout only.

## API sketch

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-shell'],
  narudkShell: {
    accent: '#3BB040',       // app's brand accent, defaults to the narduk-shell neutral
    structure: '#003E73',    // app's brand structure color
    sections: [
      { id: 'ops', label: 'Operations', items: [
        { label: 'Overview', to: '/' },
        { label: 'Health', to: '/health' },
      ] },
      { id: 'admin', label: 'Admin', items: [
        { label: 'Users', to: '/admin/users' },
      ] },
    ],
  },
})
```

```vue
<!-- app/layouts/default.vue in the consuming app -->
<template>
  <NardukShell>
    <slot />
  </NardukShell>
</template>
```

The module registers the layout, injects the token stylesheet, and exposes `<NardukShell>` plus
a `useNardukShellSections()` composable for apps that need to mutate sections at runtime (e.g. a
feature-flagged admin section).

## Which apps would adopt it

- **operator-portal** — the app the redesign work exists for; first adopter, proves the shape.
- **been-sober-for**, **borderwaitstat-us**, **gonogo** — the three `web-cf` examples named in
  `Config/paved-paths.json`; each currently hand-rolls its own nav/layout and would collapse
  onto the shared shell once it exists, directly addressing the R4 finding that the flagship
  `web-cf` apps aren't dogfooding narduk-libs.
- Any future `web-cf` or `apple-multi` web-half app scaffolded by `create-narduk-app` — the
  generator could add `narduk-shell` to its default module list once the package is proven on
  operator-portal, the same way it already defaults in `narduk-core`.
- **Not** the five status-family apps (`status-apps` monorepo lineage) — they intentionally stay
  on the Status Design System's own compact instrument layout, which is a different product
  shape (public-facing single-purpose status pages, not multi-section operator tooling).

## Sizing and sequencing

This is a new-package proposal, not an implementation task for this PR. Building it is real
work: a layout component, a token sheet ported and generalized from PACC·TRAC, a Nuxt module
wrapper, tests, and a design pass with Logan on the section-rail interaction before
`operator-portal` depends on it. It is filed as an issue (see the top of this file) rather than
built here so the redesign lane can reference and prioritize it without this docs/libs lane
guessing at visual design decisions that are explicitly Logan's to make.
