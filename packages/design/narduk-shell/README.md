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

**First components.** Backlog item 9
([narduk-libs#256](https://github.com/narduk-enterprises/narduk-libs/issues/256))
ships `NePageHeader` and `NeSectionHeader` on the item 1 skeleton
([narduk-libs#248](https://github.com/narduk-enterprises/narduk-libs/issues/248)).
Tokens (item 2) and the NE Base card mechanism (item 3) are still follow-ups;
these two components read Nuxt UI semantic tokens and `UBadge` colour/variant
props, and do not hardcode a colour, radius, shadow or font. Each later item
adds its own component, README section, tests and NE Base card.

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

1. Add the SFC at `src/runtime/components/NeThing.vue`. Wrap a Nuxt UI
   primitive. Read tokens; never hardcode a colour, radius, shadow or font.
2. Append `{ name: 'NeThing', filePath: './runtime/components/NeThing.vue' }` to
   `NE_SHELL_COMPONENTS`. That is the only registration path. Do not call
   `addComponentsDir` and do not add a directory scan.
3. Document props, slots, events and one example in this README.
4. Add a mount test (`@vue/test-utils`) and an SSR test (`renderToString` in
   vitest's node environment, no `document`; pattern:
   `packages/design/narduk-charts/src/ssr.test.ts`).
5. Add a changeset (`minor` while the package is `0.x`).

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

Each component arrives with its own backlog item, and each adds its section here
— props, slots, events and one example — alongside a mount test, an SSR test and
an NE Base card. The ordered backlog is
[narduk-libs#247](https://github.com/narduk-enterprises/narduk-libs/issues/247)
and the plan it tracks is
[`docs/plans/components-library-plan.md`](../../../docs/plans/components-library-plan.md).

### NePageHeader

Wraps Nuxt UI `UPageHeader` and `UBreadcrumb`. Breadcrumbs render above the
title in a labelled `nav` and are omitted when the list is empty or absent. The
heading is an `h1` by default; set `as` to render a different heading level
without nesting a second heading inside `UPageHeader`'s own `<h1>`.

#### Props

| Prop           | Type                                               | Default | Description                                                                 |
| -------------- | -------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `title`        | `string`                                           | —       | Page title. Required.                                                       |
| `description`  | `string`                                           | —       | Supporting copy below the title.                                            |
| `eyebrow`      | `string`                                           | —       | Small label above the title (maps to `UPageHeader`'s `headline`).           |
| `breadcrumbs`  | `NeBreadcrumbItem[]`                               | —       | `UBreadcrumb` items (`label`, optional `to` / `icon`). Hidden when empty.   |
| `as`           | `'h1' \| 'h2' \| 'h3' \| 'h4' \| 'h5' \| 'h6'`     | `'h1'`  | Heading level for the title.                                                |

`NeBreadcrumbItem` is the `UBreadcrumb` item shape this wrapper accepts:
`{ label?: string, to?: string, icon?: string }` plus any extra fields
`UBreadcrumb` already understands.

#### Slots

| Slot          | Description                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `actions`     | Right-aligned actions next to the title (maps to `UPageHeader`'s `links` slot). Never inside the heading. |
| `default`     | Pass-through of `UPageHeader`'s default slot, below the title/description block.                     |
| `title`       | Overrides the title text. Still rendered inside the heading element.                                 |
| `description` | Overrides the description text.                                                                      |

#### Events

None.

#### Example

```vue
<NePageHeader
  title="Runners"
  description="Every self-hosted runner class."
  eyebrow="Infrastructure"
  :breadcrumbs="[
    { label: 'Infrastructure', to: '/infrastructure' },
    { label: 'Runners' },
  ]"
>
  <template #actions>
    <UButton>New</UButton>
  </template>
</NePageHeader>
```

### NeSectionHeader

A section heading for use below `NePageHeader`. The optional `count` renders as
a Nuxt UI `UBadge` (`color="neutral"`, `variant="subtle"`) next to the title and
is hidden when `count` is `undefined`. Zero is a real, visible count. The
heading is an `h2` by default.

#### Props

| Prop          | Type                                           | Default | Description                                                         |
| ------------- | ---------------------------------------------- | ------- | ------------------------------------------------------------------- |
| `title`       | `string`                                       | —       | Section title. Required.                                            |
| `count`       | `number`                                       | —       | Item count shown as a token-themed badge. Hidden when `undefined`.  |
| `description` | `string`                                       | —       | Supporting copy below the title.                                    |
| `as`          | `'h1' \| 'h2' \| 'h3' \| 'h4' \| 'h5' \| 'h6'` | `'h2'`  | Heading level for the title.                                        |

#### Slots

| Slot      | Description                                                                              |
| --------- | ---------------------------------------------------------------------------------------- |
| `actions` | Right-aligned actions next to the title. Never rendered inside the heading element.      |
| `default` | Extra content below the title/description row.                                           |

#### Events

None.

#### Example

```vue
<NeSectionHeader title="Recent" :count="12">
  <template #actions>
    <UButton variant="ghost">View all</UButton>
  </template>
</NeSectionHeader>
```

## Publication

Source is TypeScript, Vue and CSS with no build step — the same shape
`narduk-core`, `narduk-analytics` and `narduk-ui` publish. The module adds
`@narduk-enterprises/narduk-shell` to the consuming app's `build.transpile`, so
the app's own Vite build compiles what it imports.
