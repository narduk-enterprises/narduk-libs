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

_Intentionally empty._ This release registers no components.

Each component arrives with its own backlog item, and each adds its section here
— props, slots, events and one example — alongside a mount test, an SSR test and
an NE Base card. The ordered backlog is
[narduk-libs#247](https://github.com/narduk-enterprises/narduk-libs/issues/247)
and the plan it tracks is
[`docs/plans/components-library-plan.md`](../../../docs/plans/components-library-plan.md).

## Publication

Source is TypeScript, Vue and CSS with no build step — the same shape
`narduk-core`, `narduk-analytics` and `narduk-ui` publish. The module adds
`@narduk-enterprises/narduk-shell` to the consuming app's `build.transpile`, so
the app's own Vite build compiles what it imports.
