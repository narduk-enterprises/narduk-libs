# Narduk Libs Explorer

A browsable showcase of this workspace: the shared components, the design
foundations and a catalog of every package. It is increment 1 of
[`docs/plans/libs-explorer-plan.md`](../../../docs/plans/libs-explorer-plan.md);
the plan's target is a public site at `libs.nard.uk`, which is not deployed yet.

This package is private and publishes nothing. It adds no public API to any
library: it reads package sources through relative paths and `workspace:*`
devDependencies, the same way `design-system-build` does.

## Commands

From the workspace root:

```sh
pnpm run explorer:dev    # nuxt dev
pnpm run explorer:build  # prerender every page into .output/public
pnpm run explorer:test   # coverage check unit tests, then build + Playwright suite
```

`test:e2e` prerenders the site and runs the Playwright suite against it (desktop
and a mobile profile, Chromium). CI's `package / browser tests` job runs it
whenever this package is affected.
`pnpm --filter @narduk-enterprises/libs-explorer preview` serves the build at
<http://localhost:4317> with no network dependency.

## What it reads

| Source                                           | Becomes                                                      |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `pnpm-workspace.yaml` and each manifest          | The package catalog: version, exports, peers, dependencies   |
| `inventory/catalog.mts`                          | Curated kind, capability words, prerequisites and demo links |
| `narduk-ui/tokens.css`, `narduk-shell/theme.css` | Foundations: every token, light and dark                     |
| `narduk-shell/src/registry.ts`                   | The components that must each have a demo                    |
| `narduk-shell/src/design-cards/*.card.vue`       | Baseline previews, rendered unchanged                        |
| `inventory/examples.mts` + `app/examples/`       | Demo pages; interactive ones get controls and an event log   |

`modules/explorer-inventory.ts` assembles all of it at build time into the
`#explorer-inventory` virtual module, so every page is static.

## The coverage check

`inventory/check.mts` fails the build, and `test:unit`, when:

- a workspace package has no `catalog.mts` entry, or an entry names a package
  that no longer exists;
- a component `narduk-shell` registers has no example;
- an example id is duplicated or not kebab-case, names a missing design card, or
  is marked interactive without its `app/examples/<id>.vue` (or the reverse);
- a catalog entry links a demo id that does not exist.

Each message names the file to edit. Adding a package or a shell component
therefore means adding its catalog entry or example in the same pull request.

## Adding an interactive demo

1. Write `app/examples/<id>.vue`. Keep every control in the route query so a
   state can be shared as a link, and emit `event` (`name`, `detail`) for
   anything worth showing in the event log.
2. Set `interactive: true` on the example in `inventory/examples.mts`.
3. Cover the interaction in `e2e/explorer.spec.ts`.

`app/examples/ne-data-table.vue` is the reference: sorting through
`update:sort`, missing values last, day grouping, loading and empty states, and
CSV export of the rows in view.

## Known limits of this increment

- Width presets constrain the demo frame. Media-query behaviour (the data
  table's phone column switch) follows the browser window.
- Charts, the map lab, composed examples and the Workers deployment are
  increments 2 to 4 of the plan.

Validation: `typecheck`, `lint`, `test:unit` and `build` (the package gates CI
runs), plus `test:e2e`.
