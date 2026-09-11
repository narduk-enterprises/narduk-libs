# @narduk-enterprises/narduk-shell

The home of the app-tier `Ne*` component suite: one shared set of tables, empty
states, status chips, page headers, KPI tiles, filter bars, confirm dialogs,
card lists, form pages, admin pages and shells, so that no Nuxt app in the
estate writes its own again.

The suite **wraps Nuxt UI rather than reimplementing it**. Every `Ne*` component
composes `U*` primitives from `@nuxt/ui` (`UEmpty`, `UTable`, `UPageHeader`,
`UDashboardSidebar`, `UPagination`, `UModal`, `UBadge`, `UForm` and friends) and
reads its look from the shared token sheet. It is not a component kit that forks
Nuxt UI, and it is not `narduk-ui`'s replacement — `narduk-ui` keeps owning the
`Ns*` status instruments for the status apps.

Standing decision: company-hq `DECISIONS.md` **D-WEBFOUND-2** and its
**2026-09-11 amendment**. The suite lives here in
`packages/design/narduk-shell`, the `Ne*` prefix is provisional under
D-WEBFOUND-2 Q7's parked renames, and list routes use the `parseListQuery`
contract. The amendment's table-first wave ordering is superseded by the
components backlog in
[`docs/plans/components-library-plan.md`](../../../docs/plans/components-library-plan.md).

## Status

**Skeleton only.** This release is backlog item 1 of 22
([narduk-libs#248](https://github.com/narduk-enterprises/narduk-libs/issues/248)):
the package, the module, the registration model and the reserved subpaths. It
ships no components and no tokens yet. Each later item adds its own component,
README section, tests and NE Base card.

## Install

Published to GitHub Packages under `@narduk-enterprises`. Pin an exact version;
never use a path or workspace-protocol dependency from an app.

```bash
pnpm add -E @narduk-enterprises/narduk-shell
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-shell'],
})
```

Peers: `nuxt >=4.0.0`, `vue >=3.5.0`, and `@nuxt/ui` at exactly `4.6.0` — the
version `@narduk-enterprises/narduk-core` pins, so an app on the Narduk core
layer already has the right one.

### Module options

```ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-shell'],
  nardukShell: {
    // Register the suite's components globally. Default: true.
    // `false` keeps the package installed and the ./format and ./theme.css
    // subpaths importable, but registers no global names.
    components: true,
  },
})
```

## Explicit registration, and why shadowing is loud

The module registers components with one **explicit `addComponent` call per
entry** in a static registry (`src/registry.ts`), and never calls
`addComponentsDir`.

That is deliberate. `addComponentsDir` points Nuxt at a directory and lets it
scan. Nuxt's component resolution then prefers the app's own `app/components/`
over a scanned module directory, so an app that happens to have its own
`app/components/NeStatePanel.vue` **silently** wins: the app renders its local
copy, the suite's copy is never used, and nothing in the build says so. That is
precisely the failure this suite exists to remove — apps quietly keeping their
own fork of a shared component.

An explicit `addComponent` registration collides instead of losing. The conflict
surfaces at build time, in the app, on the name, and whoever added the local
file decides consciously whether to delete it, rename it, or keep it and drop
the shared one.

Adding a component to the suite is therefore two edits, both in this package:
the SFC itself, and its `{ name, filePath }` entry in `src/registry.ts`. Nothing
is registered by being in a folder.

## Adding a component (later backlog items)

Each later lane adds one `Ne*` export with these edits, all in this package. The
module API (`NE_SHELL_COMPONENTS` and `NeComponentRegistration` in
`src/registry.ts`, and the `addComponent` loop in `src/module.ts`) stays
additive: new entries only, no renames or signature changes.
`pnpm run surface:check` (inside `quality:artifacts`) reads that registry — not
a hardcoded list — and fails one line per miss, naming the artefact and the file
to add.

1. Add the SFC at `src/runtime/components/NeThing.vue`. Wrap a Nuxt UI
   primitive. Read tokens; never hardcode a colour, radius, shadow or font.
2. Append `{ name: 'NeThing', filePath: './runtime/components/NeThing.vue' }` to
   `NE_SHELL_COMPONENTS`. That is the only registration path. Do not call
   `addComponentsDir` and do not add a directory scan.
3. Document props, slots, events and one example in this README under a heading
   that names the component (`### NeThing`). A mention in a paragraph or a table
   row does not satisfy the surface check.
4. Add a mount test (`@vue/test-utils`: a `*.test.ts` containing
   `mount(NeThing`; convention `src/runtime/components/NeThing.test.ts`) and an
   SSR test (`renderToString` in vitest's node environment, no `document`;
   `src/runtime/components/NeThing.ssr.test.ts` or a shared `ssr.test.ts` that
   names the component. Pattern:
   `packages/design/narduk-charts/src/ssr.test.ts`).
5. Add `src/design-cards/NeThing.card.vue` with `data-design-card="ne-thing"` —
   copy the template; see **Shipping a design card**.
   `design-system-build/app/app.vue` discovers every `*.card.vue` and renders it
   into the NE Base gallery, so the lane does **not** hand-edit `app.vue`.
6. Add a changeset (`minor` while the package is `0.x`).

A new `./format` export needs (3) and a `*.test.ts` that imports it from
`format` and asserts its output. Mount, SSR and a card are not required of a
function; see **Component surface check**.

`PENDING_CARDS` in `src/pending-cards.ts` (re-exported by
`scripts/check-component-surface.mjs`) is a reviewed, temporary allowlist that
waives **only** (5) for the four parallel component lanes that were written
against a follow-up card PR: `NeStatePanel` (#254), `NeStatusBadge` (#255),
`NePageHeader` and `NeSectionHeader` (#256), `NeConfirmDialog` (#263). README,
mount and SSR still fail closed. The follow-up that adds those cards empties the
list. It is not a way to skip the card forever.

Do not add this package to `create-narduk-app`'s default module list. That is
backlog item 4
([narduk-libs#251](https://github.com/narduk-enterprises/narduk-libs/issues/251)).

## Reserved subpaths

Exactly three subpaths are exported. Two of them are reserved placeholders in
this release: they resolve from an external install today (the release
pipeline's consumer fixture proves it) and are filled by the backlog items
below, so that no app has to change an import specifier when the content
arrives.

| Subpath                                      | Today                      | Filled by                                                                                                               |
| -------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@narduk-enterprises/narduk-shell`           | The Nuxt module            | Every component item adds a registry entry                                                                              |
| `@narduk-enterprises/narduk-shell/format`    | Empty module (`export {}`) | Item 5, shared `Intl`-based formatters ([#252](https://github.com/narduk-enterprises/narduk-libs/issues/252))           |
| `@narduk-enterprises/narduk-shell/theme.css` | Empty stylesheet           | Item 2, NE tokens mapped onto Nuxt UI's `--ui-*` ([#249](https://github.com/narduk-enterprises/narduk-libs/issues/249)) |

## Components

_Intentionally empty._ This release registers no components.

Each component arrives with its own backlog item, and each adds its section here
— props, slots, events and one example — alongside a mount test, an SSR test and
an NE Base card. The ordered backlog is
[narduk-libs#247](https://github.com/narduk-enterprises/narduk-libs/issues/247)
and the plan it tracks is
[`docs/plans/components-library-plan.md`](../../../docs/plans/components-library-plan.md).

## Component surface check

`node scripts/check-component-surface.mjs`, from the repository root, reads the
surface this package actually exports — every entry in `src/registry.ts` and
every named export of `./format` — and requires the evidence for each name to
exist. It runs in `pnpm run quality` (inside `quality:artifacts`, straight after
`format:check`) and can be run on its own:

```bash
pnpm run surface:check            # this package
node scripts/check-component-surface.mjs --json   # machine-readable, for CI
```

A **registered component** must satisfy four rules. A miss prints one line per
rule with the exact fix, and the command exits 1.

| Rule     | Satisfied by                                                                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readme` | a Markdown heading in this file naming the component (`### NeStatePanel`). A mention in a paragraph or a table row does not count — the point is a section with props, slots, events and an example. |
| `mount`  | a `*.test.ts` anywhere in this package containing `mount(<Name>` — by convention `src/runtime/components/<Name>.test.ts`, using `@vue/test-utils`.                                                   |
| `ssr`    | a test file named `<Name>.ssr.test.ts` (or the shared `ssr.test.ts`) that names the component and calls `renderToString`, in vitest's `node` environment.                                            |
| `card`   | `src/design-cards/<Name>.card.vue` containing `data-design-card="<kebab-name>"` — see **Shipping a design card** below.                                                                              |

A **`./format` export** must satisfy two: `readme`, and `unit` — a `*.test.ts`
in this package that imports it from the `format` module and asserts its output.
The plan's sentence applies all four rules to format exports too; three of them
cannot exist for a pure function (`mount()` takes a component, an SSR render
needs something to render, a card is a rendered preview), so requiring them
would only produce fictions. That deviation is deliberate and recorded here and
in
[narduk-libs#250](https://github.com/narduk-enterprises/narduk-libs/issues/250).

The check reads the registry and `format` by **importing the TypeScript
directly** — Node strips types natively and these modules are plain erasable
TypeScript — so it sees the real export list rather than whatever a regex
matches. If a module cannot be loaded it fails closed with the loader error
instead of reporting an empty, trivially passing surface.

Scope today is this package. The owned directories live in
`CHECKED_PACKAGE_DIRS` in `scripts/check-component-surface.mjs` — item 22
appends `packages/design/narduk-ui` and `packages/design/narduk-charts` there,
one line each. Naming one of them now is an error rather than a silent pass.
What a later lane must add is listed under **Adding a component**.

## Shipping a design card

An NE Base card ships **with its component**, in this package, not as a
hand-written section in another one. Copy the template and edit it:

```bash
cp packages/design/narduk-shell/src/design-cards/template/NeExample.card.vue \
   packages/design/narduk-shell/src/design-cards/NeStatePanel.card.vue
```

The card is an ordinary single-file component whose root element is a
`<section>` carrying three attributes:

```vue
<script setup lang="ts">
// Import the component explicitly: the renderer mounts this file outside the
// Nuxt module, so `addComponent` registration does not apply there (and an
// unimported component is a `vue/no-undef-components` lint failure).
import NeStatePanel from '../runtime/components/NeStatePanel.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-state-panel"
    data-name="State panel"
    data-group="Shell"
  >
    <h2>State panel</h2>
    <div class="preview-row"><NeStatePanel title="Ordinary" /></div>
    <div class="preview-row"><NeStatePanel title="Busy" loading /></div>
    <div class="preview-row">
      <NeStatePanel title="Nothing to show" empty />
    </div>
  </section>
</template>
```

- `data-design-card` is the **kebab-case of the registered name**
  (`NeStatePanel` → `ne-state-panel`). The surface check asserts exactly this.
- `data-name` and `data-group` are the card's title and section in NE Base.
  `design-system-build` refuses a card section missing either.
- Show the states a reviewer has to see, with fixed demonstration values. Cards
  are prerendered statically: no scripts, no network, no external assets.
- `src/design-cards/template/` is deliberately **not** discovered. Only
  `src/design-cards/*.card.vue` at the top level becomes a card.

Nothing else registers the card. `packages/design/design-system-build` globs
`src/design-cards/*.card.vue`, renders each one into the NE Base gallery, and
fails its build when a registered component has no card (unless the name is on
`PENDING_CARDS`), when a card has no registered component, when two cards claim
the same id, or when an authored card does not reach the prerendered output.
`test/design-cards.test.ts` in this package server-renders every card —
including the template — and asserts the same pairing, so a card that only works
after hydration fails here rather than showing up blank in NE Base.

The hand-authored cards for `narduk-ui` and the Nuxt UI baseline stay in
`design-system-build/app/app.vue` and keep working unchanged; backlog item 22
migrates them to this mechanism. `/design-sync` is unaffected: the renderer's
output shape (`@dsCard` previews, `tokens.css`, `styles.css`,
`_ds_manifest.json`, `build-manifest.json`) is exactly what it was.

## Publication

Source is TypeScript, Vue and CSS with no build step — the same shape
`narduk-core`, `narduk-analytics` and `narduk-ui` publish. The module adds
`@narduk-enterprises/narduk-shell` to the consuming app's `build.transpile`, so
the app's own Vite build compiles what it imports.
