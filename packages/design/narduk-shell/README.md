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

**First component.** Backlog item 7
([narduk-libs#254](https://github.com/narduk-enterprises/narduk-libs/issues/254))
ships `NeStatePanel` on the item 1 skeleton
([narduk-libs#248](https://github.com/narduk-enterprises/narduk-libs/issues/248)).
Tokens (item 2) and the NE Base card mechanism (item 3) are still follow-ups;
`NeStatePanel` reads Nuxt UI semantic tokens and does not hardcode a colour,
radius, shadow or font. Each later item adds its own component, README section,
tests and NE Base card.

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

### NeStatePanel

One panel for the five readings a data surface actually has: **empty · loading ·
error · blocked · absent**. It wraps `UEmpty` (`empty`/`absent`), `USkeleton`
(`loading`) and `UAlert` (`error`/`blocked`).

It has five readings rather than the usual "empty or not" because of the bug
class that forecloses. A surface that cannot tell **unknown** from **zero**
renders a confident `0`, a green "queue clear" that nothing can know is clear,
or a red `UNKNOWN` on a thirty-second-old feed — and the operator learns to
ignore the cell (operator-portal
[#183](https://github.com/narduk-enterprises/operator-portal/issues/183),
[#162](https://github.com/narduk-enterprises/operator-portal/issues/162),
[#100](https://github.com/narduk-enterprises/operator-portal/issues/100),
[#21](https://github.com/narduk-enterprises/operator-portal/issues/21);
[#282](https://github.com/narduk-enterprises/operator-portal/issues/282) asks
for exactly this component). So:

| Reading   | Means                                         | Not                   |
| --------- | --------------------------------------------- | --------------------- |
| `loading` | the read has not answered yet                 | a zero                |
| `empty`   | the read answered and found nothing           | a failure             |
| `absent`  | **no producer publishes this fact at all**    | a zero, and not a bug |
| `blocked` | a read this surface depends on did not answer | a zero                |
| `error`   | the read failed                               | an empty set          |

`absent` is visually and textually distinct from `empty` and from `loading`, by
shape as well as by hue: a dashed box is a placeholder for a set, a dotted left
rule is a fact nobody publishes sitting beside facts that are, and a solid box
is a read still in flight. A mount test pins that the three differ.

#### Example

```vue
<NeStatePanel
  :state="status"
  title="No runners"
  message="No runner has registered with the fleet yet."
  icon="i-lucide-server"
>
  <template #action><UButton to="/runners/new">Add one</UButton></template>
</NeStatePanel>
```

#### Props

| Prop           | Type                                  | Default   | What it does                                                                    |
| -------------- | ------------------------------------- | --------- | ------------------------------------------------------------------------------- |
| `state`        | `NeStateValue`                        | —         | `'empty' \| 'loading' \| 'error' \| 'blocked' \| 'absent'`. Wins over `status`. |
| `status`       | `NeAsyncDataStatus`                   | —         | `useAsyncData()`'s status, bound straight through. See the mapping below.       |
| `title`        | `string`                              | `''`      | The headline.                                                                   |
| `message`      | `string`                              | `''`      | The sentence under it.                                                          |
| `icon`         | `string`                              | per state | Overrides the state's own icon.                                                 |
| `eyebrow`      | `string`                              | per state | The state's name, rendered as text. Override the wording, not the presence.     |
| `gaps`         | `ReadonlyArray<string \| NeStateGap>` | `[]`      | Named provisioning gaps, rendered as a list — never folded into prose.          |
| `unblocksOn`   | `string`                              | `''`      | The condition that would end this state.                                        |
| `unblocksRef`  | `string`                              | `''`      | An issue or file reference beside the condition, e.g. `operator-portal#152`.    |
| `unblocksHref` | `string`                              | `''`      | Links the reference if there is one, otherwise the condition itself.            |
| `as`           | `string`                              | `'div'`   | `'section'` when the panel **is** the section's content.                        |

`NeStateGap` is `{ id: string; need: string }`; a plain string is the same thing
without an identifier. `gaps`, `unblocksOn`, `unblocksRef` and `unblocksHref`
are ported from operator-portal's `StatePanel.vue`.

#### Slots

| Slot      | When it renders                                                      |
| --------- | -------------------------------------------------------------------- |
| `default` | when there is **no** state — this is the content the panel replaces. |
| `action`  | inside the panel, under everything else. A `UButton`, usually.       |

#### Events

None. The panel is a reading, not a control; anything clickable goes in
`#action`.

#### Binding `useAsyncData`

```vue
<script setup lang="ts">
const { data, status } = await useAsyncData('runners', () =>
  $fetch('/api/runners'),
)
</script>

<template>
  <NeStatePanel
    :status="status"
    :state="status === 'success' && !data?.length ? 'empty' : undefined"
    title="No runners"
    message="No runner has registered with the fleet yet."
  >
    <RunnerTable :rows="data" />
  </NeStatePanel>
</template>
```

| `status`    | Renders                                       |
| ----------- | --------------------------------------------- |
| `'idle'`    | `loading` — the read has not started          |
| `'pending'` | `loading`                                     |
| `'error'`   | `error`                                       |
| `'success'` | **the default slot** — success is not a state |

`success` is deliberately not a state: a successful read with rows is the
default slot's job, and a successful read with **none** is `empty`, which only
the caller can know. That is why `state` takes precedence over `status` whenever
it is set — the two compose, as above.

#### Accessibility

By construction, not by caller discipline:

- `loading` → `role="status"`, `aria-live="polite"`, `aria-busy="true"`; the
  shimmer itself is `aria-hidden`.
- `error` → `role="alert"` **via `UAlert`** (assertive, and only on the alert
  itself, so roles do not nest).
- `empty` / `absent` / `blocked` → `role="status"`.
- Every state renders its own name as text, so no reading depends on colour.
- `absent` and `blocked` never render as an empty list.

Both the mount suite and the SSR suite assert these, the SSR one because a
`role="alert"` that appears only after hydration is not there when it matters.

#### Types

```ts
import type {
  NeAsyncDataStatus,
  NeStateGap,
  NeStatePanelProps,
  NeStateValue,
} from '@narduk-enterprises/narduk-shell'
```

#### Supersedes

`narduk-core`'s `AppEmptyState` (D4, Logan 2026-09-11: "Deprecate, remove next
major"). It is deprecated in the same release as this component and removed in
the next `narduk-core` major; the migration mapping is in
[that package's README](../../modules/narduk-core/README.md#deprecated-components).

## Publication

Source is TypeScript, Vue and CSS with no build step — the same shape
`narduk-core`, `narduk-analytics` and `narduk-ui` publish. The module adds
`@narduk-enterprises/narduk-shell` to the consuming app's `build.transpile`, so
the app's own Vite build compiles what it imports.
