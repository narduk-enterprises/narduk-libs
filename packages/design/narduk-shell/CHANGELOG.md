# @narduk-enterprises/narduk-shell

## 0.5.0

### Minor Changes

- 159e762: Add `NeFilterBar`: the filter row above a collection (item 14, #261),
  promoted from operator-portal's `FilterBar.vue`. Three kinds share one DOM
  shape and differ in meaning — `chips` and `facets` carry `aria-pressed`,
  `tabs` is a real `tablist` with the APG keyboard model (arrows wrap, Home and
  End jump, exactly one tab in the page's tab order).

  A control whose producer does not exist yet stays in the row as
  `aria-disabled` rather than being dropped, with the row's `note` saying when
  it lands — removing it would make a product look finished and be silently
  narrower than it claims. It is `aria-disabled` and not the `disabled`
  attribute, so a keyboard user can still reach the reason in its `title`.

  Counts are the caller's figures, rendered and never derived; an omitted count
  renders no element at all, because `0` is a measurement and "not counted" is
  not.

  `NeSearchInput`, the other half of #261, is not in this change.

## 0.4.0

### Minor Changes

- c1c8b42: Add the narduk-shell data-table family — `NeDataTable` (UTable preset
  with column groups, units, tabular numerals, the missing dash, day/group rows,
  a pinned first column, the phone column-set switch, the break row, and
  loading), `NeSortHeader`, `NeCsvDownload`, plus `toCsv` / `parseSort` from the
  package root — and extend `NePager` with `pageSizes`, `mode` (`pages` | `more`
  | `auto`), `moreStep`, `maxLimit` and `update:limit`. narduk-timeseries gains
  `bucketReadings` (1h / 3h / 1d min/avg/max; missing is `null`, not `0`).
  create-narduk-app is patched because it pins narduk-shell (narduk-libs#528).

## 0.3.2

### Patch Changes

- 31a43a7: Correct published packaging declarations so they match what these
  packages already require at install time. This is not a runtime change.

  Nine Nuxt modules already depend on `@nuxt/kit` `^4.0.0`, which does not run
  on Nuxt 3, but advertised `peerDependencies.nuxt` as `>=3.16.0`. The peer is
  now `>=4.0.0`, matching narduk-shell and narduk-mapkit-nuxt. `narduk-core` and
  `narduk-realtime` also raise `@nuxt/schema` to `>=4.0.0` so it matches `nuxt`.
  `narduk-core` and `narduk-analytics` add exact `./app/types/*` entries for the
  `.ts` files that the `*.d.ts` export pattern could not resolve. The analytics
  key exports runtime `const`s, so it carries `types` then `import` then
  `default`. Core `./app/types/api` stays types-only because that file is
  interfaces. `narduk-app` declares `zod` `^4.4.3` as an optional peer (kept in
  `devDependencies`) so consumers that typecheck `./server/request-body` can
  resolve `z.ZodType` without warning HTTP-only consumers. `narduk-shell`
  tightens `vue-router` to `^5.3.1` so the published package matches `@nuxt/ui`
  `4.8.1` and the workspace override.

  ## Operator action

  The Nuxt 4 peer (`nuxt` and, where declared, `@nuxt/schema`) is a
  consumer-visible floor raise, so the nine modules that advertised Nuxt 3 ship
  as `minor`. Every narduk-app in the estate is already on Nuxt 4; Buoys is on
  4.5.2. A remaining Nuxt 3 app cannot take this release — and already could not
  run these modules, because they depend on `@nuxt/kit` `^4.0.0`.
  `create-narduk-app` is a companion patch so generator pins move with the
  minors. `narduk-app` (optional zod peer) and `narduk-shell` (vue-router
  already at UI 4.8.1) stay `patch`.

- 31a43a7: Format `NePager` and `NeSectionHeader` counts through pinned `en-US`
  `formatNumber` so SSR cannot pick up the host locale's grouping. Tests spy
  `Intl.NumberFormat` and require the locale argument to be `en-US`, so they
  fail on the old host-default constructor even under an en-US CI locale.
- e8e6892: Patch release alongside the `@narduk-enterprises/narduk-logging`
  minor release (request ID `cf-ray` fallback, `Server-Timing` emitter,
  slow-route logging) so `@narduk-enterprises/create-narduk-app` can refresh its
  pinned `narduk-logging` version in `src/manifest.ts`
  (`scripts/check-generator-release-plan.mjs` requires a generator release
  whenever a package it pins changes version). No generator behavior changes.
  `narduk-app-tools`, `narduk-realtime`, `narduk-shell`, and `narduk-testkit`
  release together with the generator per the workspace's own linked-release
  contract; none of them changed.

  `@narduk-enterprises/narduk-mapkit-nuxt` is deliberately **not** in that list.
  It is frozen at 2.0.x (`packages/modules/narduk-mapkit/docs/api-2.1.md` §a)
  and its source on `main` is now the 2.1 contract, so any release from `main`
  would publish a 2.1 adapter under a 2.0.x version number. The freeze is
  enforced by the Changesets `ignore` entry in `.changeset/config.json`; this
  changeset only stops naming it.

## 0.3.1

### Patch Changes

- 906b5f3: Fix `NeStatusBadge`'s tinted variants, which could not carry a
  readable label.

  `soft`, `subtle` and `outline` paint `--ui-<color>` text on a 10% tint of that
  same colour, and `--ui-<color>` is shade 500. Axe measured it on a live app
  (buoys, 2026-09-17) at 2.04:1 for `success`, 1.79:1 for `warning`, 3.30:1 for
  `error` and 3.34:1 for `info` — against the 4.5:1 a badge label needs, since
  badge text is small. On an elevated surface each is worse again. Every status
  this component exists to report was failing WCAG 1.4.3 in every app that used
  a tinted variant.

  The badge now sets its own text colour to `--ui-color-<color>-800` for those
  variants. Shade 800 is the first that clears 4.5:1 on both a white and an
  elevated ground (worst case 5.71:1, `warning` on elevated); shade 700 passes
  on white and lands at 4.02:1 on elevated, which is the near-miss that reads as
  fixed and is not. The shade is read through the colour ALIAS rather than a
  literal `text-green-800`, so an app that points `success` at a different ramp
  gets its own ramp's shade 800. It is applied to the badge root rather than the
  label span, so the leading icon is recoloured with the words — an icon left at
  shade 500 on its own tint is about 1.8:1, under the 3:1 floor non-text content
  has to clear, and axe has no rule that would have reported it.

  Two deliberate omissions, both named in the component and the README so they
  read as scope rather than oversight. Dark mode is unchanged: `dark:` restores
  `--ui-<color>` exactly, because a dark tint wants a lighter ink rather than a
  darker one and nothing has measured it. `solid` is unchanged: it paints white
  on the full colour, so a dark ink would be unreadable rather than
  low-contrast, and no audited surface uses it.

## 0.3.0

### Minor Changes

- 8f693b1: Pin `@nuxt/ui` at `4.8.1` everywhere the layer pins it: the
  `narduk-core` dependency, the `narduk-shell` peer and dev pins, the
  `narduk-ai` and `design-system-build` dev pins, and the `create-narduk-app`
  generator manifest.

  `@nuxt/ui` 4.6.1 added `build.transpile.push('reka-ui')` (nuxt/ui#6286), which
  makes Vite bundle `reka-ui` per importer on the server as well as the client.
  Without it, an app that also declares `reka-ui` directly renders SSR markup
  from its own copy while hydrating against Nuxt UI's pinned copy, which
  produced the `Hydration node mismatch` failures in buoys. 4.8.1 also carries
  the fix for GHSA-gj2h-2fpw-fhv9 (medium, `@nuxt/ui < 4.8.1`) and widens the
  `typescript` peer to `^5.6.3 || ^6.0.0`. The only breaking change between
  4.6.0 and 4.8.1 is `UInputMenu`'s `autocomplete` prop being renamed to `mode`,
  which nothing in this workspace uses.

  Consumer migration: an app that declares `@nuxt/ui` itself must move its own
  pin to `4.8.1` in the same change that takes this release. `narduk-shell`'s
  peer is exact, so any other version is a peer conflict, and `narduk-core`
  carries `@nuxt/ui` as a dependency, so a different app-level pin resolves a
  second copy — the duplicate-copy failure this release removes.

## 0.2.0

### Minor Changes

- 45ff93c: Fix the package root (`.`) failing a production `nuxt build` for any
  app that imports a documented value export (narduk-libs#295).

  `.` used to resolve straight to `src/module.ts`, the Nuxt module definition,
  which imports `@nuxt/kit`. Nuxt's import-protection plugin exists precisely to
  stop a build-time-only import like that from reaching a client bundle, so
  `import { defineStatusMap } from '@narduk-enterprises/narduk-shell'` — exactly
  as documented in this README — failed every consuming app's production build.
  The first real adopter (`narduk-enterprises/buoys` PR #44) hit this within an
  hour of the 0.1.0 publish and worked around it with a hand-copied local shim
  (buoys#61) rather than a real fix.

  **The fix**: `src/module.ts` now holds only the Nuxt module definition and is
  reachable through a new `./module` subpath — internal, not meant for an app to
  import directly, but where `@nuxt/kit`'s own `loadNuxtModuleInstance` suffix
  resolution (`module`/`module/index`, tried before the bare specifier) finds it
  via an unchanged `modules: ['@narduk-enterprises/narduk-shell']`. `.` is now
  `src/index.ts`, a new barrel that re-exports the exact values and types `.`
  always documented (`defineStatusMap`, `NARDUK_SHELL_APP_CONFIG`, and the
  suite's public types) and never imports `@nuxt/kit` or `src/module.ts` by
  value — a dedicated "root barrel reachability" test (`test/module.test.ts`)
  walks its value-import graph and fails the moment either becomes reachable
  again.

  This was chosen over changing what a consumer writes: both documented entry
  points keep working completely unchanged —
  `modules: ['@narduk-enterprises/narduk-shell']` in `nuxt.config.ts`, and
  `import { defineStatusMap } from '@narduk-enterprises/narduk-shell'` — so no
  adopter has to touch an import specifier, and buoys's local shim (buoys#61)
  can be deleted once this ships.

  `scripts/release-packages.mjs`'s packed-consumer-smoke pipeline now also
  generates an app page that imports `defineStatusMap` and
  `NARDUK_SHELL_APP_CONFIG` as values from the package root and asserts (via
  Playwright) that they render correctly — closing the actual gap: the
  pipeline's existing checks proved the packed tarball installs, not that a
  documented root import survives a real `nuxt build`.

## 0.1.0

### Minor Changes

- 8634651: Ship the component surface check and the design-card mechanism
  (components-library backlog item 3, narduk-libs#250; backlog narduk-libs#247).

  The plan's standard done-when says every component in the suite arrives with a
  README section, a mount test, an SSR test and an NE Base card. Nothing
  enforced any of the four, and the card lived in a different package from the
  component. Both change here:

  - `scripts/check-component-surface.mjs` (wired into the repository's
    `quality:artifacts` gate as `surface:check`) reads the real surface — every
    `NE_SHELL_COMPONENTS` entry and every named export of `./format`, by
    importing the TypeScript rather than parsing it — and requires the evidence
    for each name. A miss prints one line per rule with the exact fix and
    exits 1. Scoped to this package; the existing design packages join in
    backlog item 22.
  - A design card now ships **beside its component**, as
    `src/design-cards/<Name>.card.vue` with `data-design-card="<kebab-name>"`.
    `src/design-cards/template/NeExample.card.vue` is the documented file a
    component item copies, and `test/design-cards.test.ts` server-renders every
    card and asserts that each registered component has one and each card a
    registered component. The private `design-system-build` renderer discovers
    and renders them instead of carrying a hand-written section per component;
    its output shape, and therefore `/design-sync`, is unchanged, and its
    existing hand-authored narduk-ui and Nuxt UI cards keep working until item
    22 migrates them.

  Two new README sections, "Component surface check" and "Shipping a design
  card", document the rules and the recipe. `PENDING_CARDS` in
  `src/pending-cards.ts` (re-exported by the check script) is a reviewed
  allowlist that waives only the card rule for the four parallel component lanes
  (#254, #255, #256, #263) so they can land before the follow-up card PR empties
  the list. No component, registry entry or runtime behaviour changes: the
  registry is still empty, and the check passes over it.

- 76e22a8: Add `NeConfirmDialog` and `useConfirm()` — the estate's "are you
  sure?" dialog (components-library backlog item 16, narduk-libs#263; backlog
  narduk-libs#247).

  `NeConfirmDialog` wraps Nuxt UI's `UModal`, so the containment
  operator-portal#134 was filed about — a declared `aria-modal` with Tab not
  trapped — comes from Reka UI's `FocusScope` by construction rather than being
  re-implemented per app.

  - Props `open` (`v-model:open`), `title`, `message`, `confirmLabel`,
    `cancelLabel`, `tone` (`default` | `danger`), `pending`, `error`, `body` (a
    component) and `props`, plus a `#body` slot. Emits `confirm`, `cancel`,
    `close` and `after:leave`.
  - `pending` is `preventClose`: the confirm button goes loading, cancel is
    disabled, and Escape and outside clicks are ignored until the work settles.
  - Initial focus lands on the least destructive button — Cancel for
    `tone="danger"`, Confirm otherwise.
  - `useConfirm()` is auto-imported and built on `useOverlay`:
    `await confirm({ title, message, confirmLabel, cancelLabel, tone, body, props })`
    resolves `true` on confirm and `false` on cancel, Escape or dismissal. An
    optional async `onConfirm` holds the dialog pending until it settles,
    closing on success; on rejection the dialog stays open with the failure
    surfaced through the `error` prop so the user can retry or back out.

  Supersedes narduk-core's `AppConfirmModal`, deprecated in the same release.

- f4215d1: Fix four defects found reviewing the suite's first components
  (narduk-libs#282).

  - `useConfirm()` is re-entrant instead of silently broken. Nuxt UI's overlay
    keeps one resolver per overlay and `open()` overwrites it on every call, so
    a second `confirm()` started before the first settled orphaned the first
    resolver: that `await confirm(...)` never resolved, never rejected and never
    timed out — on a double-click of a row-level "Delete?", the case the
    composable exists for. A second call now supersedes the first, which
    resolves `false`, except when its `onConfirm` is still in flight: that
    promise is kept and settles with the real outcome, because the work cannot
    be unrun. A stale handler can no longer close or repaint the dialog a newer
    call owns.
  - `NePageHeader` emits one breadcrumb landmark. `UBreadcrumb` is itself a
    `nav` and the `aria-label` passed to it lands on that same root, so the
    enclosing `<nav aria-label="Breadcrumb">` put two identically named
    navigation landmarks on every page using the shared header. The wrapper is
    gone and the accessible name is unchanged.
  - The styling contract covers every registered component. Its source list is
    derived from `src/registry.ts` rather than written by hand, so registering a
    component covers it and none can be silently omitted; blocks are read with
    `vue/compiler-sfc` instead of a regex that stopped at the first nested
    `</template>`, and the script block is scanned too. Tailwind's type scale is
    recognised as a token read — `text-sm` compiles to `var(--text-sm)` — so the
    rule now forbids display type (`text-lg` and up, `font-semibold` and
    heavier) rather than the whole scale, and the two per-component copies of
    the same check are consolidated into it.
  - `NeConfirmOptions` and `NeConfirmTone` are named exports of the package root
    (`.`), so a wrapper can state its signature outside Nuxt's auto-import
    transform. `useConfirm`'s own auto-import no longer sits behind the
    `components: false` early return: that option opts out of the suite's global
    component names, and the composable does not use them.

  No API removals. The reserved export map stays `.`, `./format`, `./theme.css`.

- 548fa01: Add `NeStatePanel`, the suite's first component (components-library
  backlog item 7, narduk-libs#254; backlog narduk-libs#247; standing decision
  company-hq D-WEBFOUND-2 and its 2026-09-11 amendment).

  One panel for the five readings a data surface actually has — **empty ·
  loading · error · blocked · absent** — wrapping `UEmpty` (`empty`/`absent`),
  `USkeleton` (`loading`) and `UAlert` (`error`/`blocked`) rather than
  reimplementing them.

  It has five readings rather than the usual "empty or not" because of the bug
  class that forecloses: a surface that cannot tell **unknown** from **zero**
  renders a confident `0`, a green "queue clear" nothing can know is clear, or a
  red `UNKNOWN` on a thirty-second-old feed (operator-portal#183, #162, #100,
  #21; #282 asks for exactly this component). `absent` — no producer publishes
  this fact at all — is therefore a distinct reading with its own wording, its
  own icon and its own shape, and never looks like `empty` or `loading`.

  - `state` takes one of `'empty' | 'loading' | 'error' | 'blocked' | 'absent'`,
    or bind `useAsyncData()`'s `status` straight through: `idle` and `pending`
    render `loading`, `error` renders `error`, and `success` renders the default
    slot, because success is not a state. `state` wins over `status` whenever it
    is set, so the two compose.
  - `title`, `message`, `icon` and `eyebrow`, plus `gaps`, `unblocksOn`,
    `unblocksRef` and `unblocksHref` ported from operator-portal's `StatePanel`.
  - Slots: `default` (the content the panel replaces) and `#action`.
  - Accessibility by construction: `loading` is a polite `role="status"` live
    region with `aria-busy="true"`, `error` is `role="alert"` via `UAlert`, and
    `empty`/`absent`/`blocked` are `role="status"`. Every state renders its own
    name as text, so no reading depends on colour. `absent` and `blocked` never
    render as an empty list. Both the mount suite and the SSR suite assert this
    in the server output as well as after hydration.
  - Public types `NeStateValue`, `NeAsyncDataStatus`, `NeStateGap` and
    `NeStatePanelProps` are re-exported from the package entry.

  Supersedes `narduk-core`'s `AppEmptyState`, deprecated in the same release
  (D4).

- f17e8c3: Add `NePageHeader` and `NeSectionHeader` to
  `@narduk-enterprises/narduk-shell` (components-library backlog item 9,
  narduk-libs#256).

  `NePageHeader` wraps Nuxt UI `UPageHeader` and `UBreadcrumb`: `title`,
  `description`, `eyebrow`, `breadcrumbs` (UBreadcrumb item shape, rendered
  above the title and omitted when empty), `#actions` (right-aligned), and a
  pass-through of `UPageHeader`'s default slot. The heading is an `h1` by
  default and is configurable via `as`.

  `NeSectionHeader` takes `title`, optional `count` (a token-themed `UBadge`
  next to the title, hidden when `undefined`), and `#actions`. The heading is an
  `h2` by default and is configurable via `as`.

  Both components read Nuxt UI semantic tokens and do not hardcode colour,
  radius, shadow or font.

- e35f10a: Add `@narduk-enterprises/narduk-shell`, the home of the app-tier
  `Ne*` component suite (components-library backlog item 1, narduk-libs#248;
  backlog narduk-libs#247; standing decision company-hq D-WEBFOUND-2 and its
  2026-09-11 amendment).

  This release is the skeleton, not the furniture. It ships:

  - a Nuxt module (meta name `narduk-shell`, config key `nardukShell`) that
    registers components from a static registry with one explicit `addComponent`
    call per entry and **never** calls `addComponentsDir`, so an app-local
    `NeStatePanel.vue` collides loudly at build time instead of silently
    shadowing the shared component;
  - the three reserved subpath exports `.`, `./format` and `./theme.css`.
    `./format` is an empty module reserved for the shared `Intl`-based
    formatters (item 5, narduk-libs#252) and `./theme.css` an empty sheet
    reserved for the NE token layer mapped onto Nuxt UI's `--ui-*` variables
    (item 2, narduk-libs#249). Both resolve from an external consumer today, so
    no app has to change an import specifier when the content arrives;
  - peers `nuxt >=4.0.0`, `vue >=3.5.0` and `@nuxt/ui` at exactly `4.6.0`, the
    version `@narduk-enterprises/narduk-core` pins.

  The component registry is deliberately empty: each later backlog item adds its
  component together with its registry entry, README section and tests.

- f1d82d8: Add `NeStatusBadge` and `defineStatusMap` (components-library backlog
  item 8, narduk-libs#255; backlog narduk-libs#247; standing decision company-hq
  D-WEBFOUND-2 and its 2026-09-11 amendment).

  - `NeStatusBadge` wraps Nuxt UI's `UBadge` with a fixed
    `tone -> semantic colour` mapping (`ok`/`warn`/`error`/`info`/`neutral` to
    `success`/`warning`/`error`/`info`/`neutral`, `pending` to `neutral` with a
    `subtle` variant and a default leading icon), so no app hand-rolls its own
    tone map again (operator-portal#156). The label never wraps mid-word or
    truncates unless the `truncate` prop is explicitly set, and the tone is
    always folded into the accessible name (`aria-label="<tone>: <label>"`), so
    colour is never the only signal.
  - `defineStatusMap<T extends string>(map)` turns a domain-specific status
    union into a typed `(key: T) => { tone, label }` lookup: a map missing a
    union member is a compile-time error, and an unmapped runtime value falls
    back to `{ tone: 'neutral', label: '<raw key>' }` instead of throwing. It is
    a named export of the package root (`src/module.ts`) and a Nuxt auto-import
    via `addImports`. No fourth subpath.
  - Adds a `{ name: 'NeStatusBadge', filePath: ... }` entry to the shared
    registry (`src/registry.ts`).

  The NE Base card treatment is deferred to item 3's mechanism; `NeStatusBadge`
  ships as a standalone component in this release.

- 7b5247a: Fill `@narduk-enterprises/narduk-shell/theme.css` with the NE token
  layer and bridge it onto Nuxt UI (components-library backlog item 2,
  narduk-libs#249; backlog narduk-libs#247; standing decision company-hq
  D-WEBFOUND-2 and its 2026-09-11 amendment).

  - **`theme.css`** now declares 42 `--ne-*` tokens — ground and the four-step
    surface scale, the six-step ink scale, hairline/divider/strong line, the
    `--ne-accent` and `--ne-structure` brand hooks, radius, shadow, the type
    scale and two layout tokens — for light (`:root, .light`) and dark
    (`.dark`), and points Nuxt UI's own `--ui-bg*`, `--ui-text*`,
    `--ui-border*`, `--ui-radius`, `--ui-container` and `--ui-header-height` at
    them. Every `U*` primitive and every future `Ne*` wrapper therefore takes
    its look from this one sheet. The declarations are unlayered, so they beat
    Nuxt UI's `@layer theme` defaults regardless of stylesheet order, and an
    app's own sheet still wins over them. Schemes follow Nuxt UI's class switch
    rather than a bare media query; a page with no colour-mode runtime opts in
    with `data-ne-scheme="auto"`.
  - **`src/app-config.ts`** exports `NARDUK_SHELL_APP_CONFIG`, the Nuxt UI
    colour aliases the suite needs (`primary: 'sky'`, `neutral: 'slate'`). The
    colour aliases are deliberately _not_ bridged in CSS: Nuxt UI expands each
    into an eleven-shade scale that every button variant reads, so brand colour
    stays `app.config`'s job.
  - **Module option `nardukShell.theme`** (default `true`) unshifts the sheet
    onto `nuxt.options.css` and merges the preset with `defu`, so anything the
    app or another module already set survives. `false` is the escape hatch.
  - **Contrast is a regression test, not a claim.** `test/theme.test.ts`
    computes WCAG 2.2 relative luminance over the shipped values and asserts
    every body ink clears 4.5:1 on every surface in both schemes, reproducing
    the operator-portal#238 pair (`#62748e` on `#edf0f4`, 4.16:1) to prove the
    helper measures something real. It also proves every `--ui-*` bridge target
    is a variable the _installed_ Nuxt UI actually reads, parsed out of the
    package on disk rather than copied into the test.

  The NE Base Foundations card in `design-system-build` now shows both schemes
  side by side (surfaces, inks, the `accent`/`structure` hooks, radius and type)
  and the `text-muted` class that failed in operator-portal#238. The preview
  extractor treats `--ne-*` as coded tokens alongside `--ns-*`.

  No component is registered by this release; the registry is still empty.

- dd9e6ce: Ship the NE Base design cards for the five components registered
  ahead of their card (`NePageHeader`, `NeSectionHeader`, `NeStatusBadge`,
  `NeConfirmDialog`, `NeStatePanel`) — components backlog item 3
  (narduk-libs#250), closing out the parallel lanes that registered them (#254,
  #255, #256, #263). Each card server-renders the real component with realistic
  props: `NeStatePanel`'s five `state` readings, `NeStatusBadge`'s six tones,
  breadcrumbs and an action slot on `NePageHeader`/`NeSectionHeader`, and
  `NeConfirmDialog`'s two calling shapes (with a note that reka-ui's Teleport
  gating means no dialog markup renders during SSR — documented, pre-existing
  component behavior, not a regression).

  `PENDING_CARDS` — the reviewed allowlist that let those four lanes register a
  component before its card shipped — is now empty. It stays empty going
  forward: a new component ships its card in the same change that registers it
  (see the narduk-shell README's "Adding a component" section).

  Fixes the surface-check false pass this waiver left behind:
  `design-system-build`'s `build.mts` computed `coverage.missing` (the manifest
  field `check-package.mts` asserts is empty) without filtering through
  `PENDING_CARDS`, unlike its own `shellCardPlan`, which already did. A
  component waived onto the allowlist satisfied `shellCardPlan` while still
  tripping `check-package.mts`'s assertion on `coverage.missing` — the exact
  crossed wire that had the shared-suite integration CI red. `build.mts` now
  filters `coverage.missing` through `PENDING_CARDS` the same way, keeping the
  `NE_SHELL_COMPONENTS.length === 0` sentinel message intact for an empty
  registry.

- 13e8c83: Fill the reserved `./format` subpath with the suite's shared
  formatters (components-library backlog item 5, narduk-libs#252): `formatDate`,
  `formatDateTime`, `formatRelative`, `formatDuration`, `formatNumber`,
  `formatCompact`, `formatPercent`, `formatMoney`, `formatQuantity` and
  `createFormatters`.

  `Intl` and nothing else — no Vue, no Nuxt, no dependency — so the same
  function is callable from a component, a Nitro route, a plain Node script and
  `nuxt.config.ts`.

  **Nothing here reads the ambient clock or the host time zone.** `timeZone` is
  required by the types on every date formatter and `formatRelative` requires
  `now`; neither is defaulted, because the default is the bug. A Nuxt page
  renders once on a server (UTC, in a Worker) and again in the reader's browser
  (their zone, their locale), so a formatter that consults either produces two
  strings for one value and Vue's hydration check turns that into a flicker or a
  dropped server render — operator-portal#262 and #268, stonx#674 and #675, and
  riverstatus's hand-rolled DST table. `test/format.ssr.test.ts` proves the
  property in a child process under four `TZ` and three `LC_ALL` settings,
  requiring byte-identical output, and carries a canary showing the host
  environment does move an unpinned `Intl` formatter.

  Two behaviours differ from the prior art they replace, on purpose.
  `formatPercent` reads its argument as a **fraction** by default (`0.055` is
  5.5%), which is `Intl`'s convention and the opposite of stonx's `fromDecimal`
  default, so the reading is spelled out at the call site (`input: 'percent'`)
  rather than silently inherited and wrong by 100x. `formatCompact` uses `Intl`
  compact notation with one fraction digit (`1.2K`) rather than stonx's
  English-only `K`/`M`/`B`/`T` ladder with two; `{ digits: 2 }` restores the old
  shape.

  `formatDuration` never climbs above a day, since a month is not a fixed span,
  and keeps the sign of a negative span instead of laundering clock skew into
  `'unknown'`. `formatQuantity` appends an unsanctioned unit after a space
  (riverstatus's `cfs`) instead of letting `Intl` throw a `RangeError`.
  `Intl.*Format` instances are memoised per kind, keyed by locale plus the full
  sorted option set, capped at 256 entries.

  The formatters are deliberately **not** auto-imported by the Nuxt module:
  every pilot app already has its own `formatDate` in `app/utils/`, and
  shadowing it with a different required signature is not an upgrade anyone
  asked for.

  Also adds `src/surface-cards.ts`, the second and much smaller list that may
  authorise an NE Base design card, so that `Formatters.card.vue` can preview an
  export subpath rather than a component without weakening the card/registry
  pairing rule in either direction.

- d606e70: Add `NeForm`, `NeFormSection` and `NeSettingsPage`
  (components-library backlog item 19, narduk-libs#266; backlog
  narduk-libs#247), and deprecate `narduk-core`'s `AppSettingsProfile`.

  `NeForm` wraps Nuxt UI's `UForm` with a save bar that does not lie, closing
  three named bug classes by construction:

  - **Double-submit (stonx#37).** A capture-phase `submit` listener on a real
    DOM ancestor of `UForm`'s `<form>` drops a second submit while the first is
    still in flight, so two rapid submits issue exactly one `onSubmit` call.
  - **A save bar that lies about dirtiness (stonx#36).** `Unsaved changes` is
    driven by `UForm`'s own `dirty` state, which only clears once `onSubmit`'s
    promise resolves — a rejected save leaves it dirty, with no optimistic
    "saved" flash to walk back.
  - **Errors that do not scroll into view (stonx#350).** A schema (or
    `validate`) failure blocks submission and focuses the first invalid field,
    scrolled into view.

  `UButton`'s own `loading-auto` drives the save button's spinner and disabled
  state for the duration of the `onSubmit` promise — no ref to wire.
  `NeFormSection` is a titled group of fields (a thin wrapper around
  `NeSectionHeader`); `NeSettingsPage` composes `NePageHeader` with a `NeForm`
  whose save bar is sticky by default, for a full settings screen built from one
  or more sections.

  Supersedes `narduk-core`'s `AppSettingsProfile`, deprecated in the same
  release (D4, Logan 2026-09-11: "Deprecate, remove next major"). No behaviour
  change and no removal: the component gains an `@deprecated` JSDoc block and a
  one-time, dev-only `console.warn` pointing at `NeSettingsPage`. The migration
  mapping is in narduk-core's README under "Deprecated components".

- 8d0212a: Add `NeKpiTile` and `NeKpiBand` (components-library backlog item 15,
  narduk-libs#262; backlog narduk-libs#247; standing decision company-hq
  D-WEBFOUND-2 and its 2026-09-11 amendment).

  - `NeKpiTile` renders one measured metric in a `UCard`: a label, a value, and
    an optional signed delta with a caption. `value` and `delta` are formatted
    through the `./format` subpath's `formatNumber` (item 5, narduk-libs#252)
    when given as a `number` — never `Number.prototype.toLocaleString` — or
    rendered as-is when a caller passes an already-formatted `string` (e.g. from
    `formatMoney`/`formatPercent`/`createFormatters()`). Colour is never the
    only signal for the delta's direction: the text always carries an explicit
    sign (`signDisplay: 'always'`) and a ▲/▼ glyph, and `tone` colours the delta
    span only — it never changes what the delta says. An optional `#spark` slot
    leaves a sparkline (e.g. a `narduk-charts` chart) entirely to the caller;
    `narduk-shell` does not depend on `narduk-charts`.
  - `NeKpiBand` lays out a responsive grid of `NeKpiTile`s via a `columns` prop
    (`Partial<Record<'base'|'sm'|'md'|'lg'|'xl', 1|2|3|4|5|6>>`, default
    `{ base: 1 }`). It only lays out — no card, border or background of its own.
    Every `grid-cols-*` class is a literal string in a lookup table rather than
    a computed template, so Tailwind's build-time scanner sees every class the
    component could ever apply.
  - Adds `{ name: 'NeKpiTile', ... }` and `{ name: 'NeKpiBand', ... }` entries
    to the shared registry (`src/registry.ts`), each with an NE Base design card
    (`PENDING_CARDS` is spent, so both ship their card in this release).

- 20eae46: Add `useCollection<T>()` and `NePager` — the suite's paged-list state
  machine and the control at the foot of the list (components backlog item 11,
  narduk-libs#258).

  `useCollection()` consumes the
  `@narduk-enterprises/narduk-platform/list-query` contract rather than
  restating it, and enforces five rules every list in the estate had solved
  separately or not at all: one request in flight with coalesced triggers and
  the superseded request aborted; a response whose scope no longer matches
  discarded rather than rendered; a debounced `q`; `page` reset to 1 whenever
  `q`, a filter, `sort` or `limit` changes; and `page` clamped from the response
  that landed, so a delete emptying the last page costs exactly one extra
  request to reach the new last page. `syncQuery: true` mirrors
  `page`/`q`/`sort` in the route query, reading the URL before the first request
  and omitting defaults so page one has one canonical URL. Each rule is pinned
  by a test that asserts a request count.

  `NePager` wraps `UPagination`, owns no state, and can write back only the page
  number. With `:to` every control renders as a real `<a href>`, proven in the
  server output against the real `UPagination`. A route that does not count
  (`total: null`) gets Previous/Next instead of invented page numbers.

  `vue-router` becomes a declared peer (`^4.5.0 || ^5.0.0`, matching Nuxt UI's
  own range): `syncQuery` calls `useRoute()`/`useRouter()` directly and `:to`
  resolves through the router.

### Patch Changes

- Updated dependencies [0f45d4b]
- Updated dependencies [fdb9c15]
  - @narduk-enterprises/narduk-platform@2.1.0
