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

### NeStatusBadge

Wraps Nuxt UI's `UBadge` with a fixed tone → semantic-colour mapping, so no app
hand-rolls its own tone map again — the motivating bug,
[operator-portal#156](https://github.com/narduk-enterprises/operator-portal/issues/156),
landed the identical tone-map mistake twice in one evening, in two different
components, because the mapping lived twice.

```vue
<NeStatusBadge tone="warn" label="Degraded" />
```

#### Props

| Prop       | Type                                                            | Default                | Notes                                                                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tone`     | `'ok' \| 'warn' \| 'error' \| 'info' \| 'neutral' \| 'pending'` | —, required            | Drives the Nuxt UI semantic colour (tone table below) and is folded into the accessible name.                                                                                                                                     |
| `label`    | `string`                                                        | —, required            | Visible text, and the core of the accessible name.                                                                                                                                                                                |
| `icon`     | `string`                                                        | —                      | Overrides the tone's default icon. Only `pending` has one by default.                                                                                                                                                             |
| `size`     | `'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl'`                          | `UBadge`'s own default | Passed straight through to `UBadge`.                                                                                                                                                                                              |
| `variant`  | `'solid' \| 'outline' \| 'soft' \| 'subtle'`                    | —                      | Overrides the tone's default variant. Only `pending` has one: `subtle`.                                                                                                                                                           |
| `truncate` | `boolean`                                                       | `false`                | Opt into ellipsis truncation. By default the label never wraps mid-word or truncates — it stays on one line and the badge grows to fit ([operator-portal#156](https://github.com/narduk-enterprises/operator-portal/issues/156)). |

No slots, no emitted events — `NeStatusBadge` is a controlled, presentation-only
wrapper; pass a new `tone`/`label` to change what it shows.

#### Tone → colour

| Tone      | Nuxt UI colour | Default variant | Default icon             |
| --------- | -------------- | --------------- | ------------------------ |
| `ok`      | `success`      | —               | —                        |
| `warn`    | `warning`      | —               | —                        |
| `error`   | `error`        | —               | —                        |
| `info`    | `info`         | —               | —                        |
| `neutral` | `neutral`      | —               | —                        |
| `pending` | `neutral`      | `subtle`        | `i-lucide-loader-circle` |

#### Accessibility

Colour is never the only signal that carries the tone. `NeStatusBadge` sets
`aria-label="<tone>: <label>"` on the root element, so assistive tech always
hears the tone even when the visible label is domain-specific and says nothing
about severity on its own (`"Major"` vs. `"error: Major"`).

#### `defineStatusMap`

Most consumers have their own status vocabulary — a flood stage, a device health
enum, a job state — that needs to become a `{ tone, label }` pair.
`defineStatusMap` builds that mapping once, typed so a missing union member is a
compile-time error and an unrecognised runtime value falls back to `neutral`
instead of throwing:

```ts
// no import needed -- defineStatusMap is a Nuxt auto-import
type FloodStage = 'normal' | 'action' | 'major'

const floodStatus = defineStatusMap<FloodStage>({
  normal: ['ok', 'Normal'],
  action: ['warn', 'Action'],
  major: ['error', 'Major'],
})
```

```vue
<NeStatusBadge v-bind="floodStatus(stage)" />
```

`floodStatus('major')` returns `{ tone: 'error', label: 'Major' }`. Omitting a
union member from the map (e.g. leaving out `major`) is a TypeScript error at
the `defineStatusMap<FloodStage>({ ... })` call site. A value that reaches the
map at runtime but isn't one of its keys — an API handing back a stage this
union doesn't know about yet — falls back to
`{ tone: 'neutral', label: '<the raw value>' }` rather than throwing.

#### Boundary with `narduk-ui`'s `NsFreshnessChip`

`narduk-ui` already ships `NsFreshnessChip`, a narrower, domain-specific
instrument for the status apps' one specific "how stale is this reading"
indicator. `NeStatusBadge` does not replace, wrap or duplicate it:
`NeStatusBadge` is the general app-tier "here is a tone and a label" primitive,
and `narduk-ui` keeps owning `Ns*` status instruments for the status apps (this
package's own opening boundary note, above). Freshness has its own thresholds
and recency-formatting rules that belong in `NsFreshnessChip`, not in a
`defineStatusMap` map.

#### Deferred

The NE Base card treatment (a standard bordered/padded card shell around a
component) is item 3's mechanism and is not part of this release —
`NeStatusBadge` ships as a standalone component today and adopts the card
convention once item 3 lands it.

---

Each further component arrives with its own backlog item, and each adds its own
section here — props, slots, events and one example — alongside a mount test and
an SSR test. The ordered backlog is
[narduk-libs#247](https://github.com/narduk-enterprises/narduk-libs/issues/247)
and the plan it tracks is
[`docs/plans/components-library-plan.md`](../../../docs/plans/components-library-plan.md).

## Publication

Source is TypeScript, Vue and CSS with no build step — the same shape
`narduk-core`, `narduk-analytics` and `narduk-ui` publish. The module adds
`@narduk-enterprises/narduk-shell` to the consuming app's `build.transpile`, so
the app's own Vite build compiles what it imports.
