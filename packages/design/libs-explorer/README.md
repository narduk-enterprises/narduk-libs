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
| `app/usage/<id>.usage.vue`                       | The usage example: shown as source and rendered live         |

`modules/explorer-inventory.ts` assembles all of it at build time into the
`#explorer-inventory` virtual module, so every page is static.

## Preview frames

Each preview (the interactive demo, the design card, the usage example) renders
alone at `/frame/<id>/<surface>`, embedded in the component page as a
same-origin iframe. The full, tablet (768px) and phone (375px) presets set the
iframe's width, so the preset is the preview document's real viewport: media
queries, such as the data table's phone column switch, respond to it.

The page owns the URL. `width` is its own parameter; every other parameter is
the demo's state. The two sides talk over `postMessage` (`demo/frame.mts`
defines and validates the messages): the page sends the theme and the demo's
query, the frame reports its height, its events and its canonical state. A
control change in the frame becomes a history entry; a correction of a malformed
or repeated parameter replaces the URL in place. Reset recreates every frame,
returns to the default query and full width, and clears the event log; the
reader's colour preference is kept.

Usage examples are files named `<id>.usage.vue`: the suffix keeps the example
from resolving its own component tag to itself, so `vue-tsc` checks the props it
passes. Setup (install, `nuxt.config` module, stylesheet) is documented once on
each package page, from `catalog.mts`, and linked from the component pages.

## The coverage check

`inventory/check.mts` fails the build, and `test:unit`, when:

- a workspace package has no `catalog.mts` entry, or an entry names a package
  that no longer exists;
- a component `narduk-shell` registers has no example;
- an example id is duplicated or not kebab-case, names a missing design card, or
  is marked interactive without its `app/examples/<id>.vue` (or the reverse);
- an example has no `app/usage/<id>.usage.vue`, or a usage file is misnamed;
- a package's documented setup names a module or stylesheet it does not export;
- a catalog entry links a demo id that does not exist.

Each message names the file to edit. Adding a package or a shell component
therefore means adding its catalog entry or example in the same pull request.

## Adding an interactive demo

1. Write `app/examples/<id>.vue`. It takes its state as a `query` prop, emits
   `canonical` with the canonical form of every query it is given, `state` with
   the next query on each control change, and `event` (`name`, `detail`) for
   anything worth showing in the event log. Keep parsing in a tested module
   beside `demo/table.mts`.
2. Set `interactive: true` on the example in `inventory/examples.mts`.
3. Cover the interaction in `e2e/explorer.spec.ts`.

`app/examples/ne-data-table.vue` is the reference: sorting through
`update:sort`, missing values last, day grouping, loading and empty states, and
CSV export of the rows in view.

## Known limits of this increment

- Package pages show the workspace version from each manifest. The registry is
  not queried, so a registry-verified published version is increment 4 work.
- The usage examples use auto-imported components and module-provided styles.
  Whether a consumer app needs its own Tailwind `@source` line for a package's
  classes is not verified here.
- `@narduk-enterprises/narduk-shell`'s README shows a value import from the
  module entry point (`parseSort`); Nuxt refuses that inside an app that
  registers the module, so the sort-header example parses the wire form inline.
- Charts, the map lab, composed examples and the Workers deployment are
  increments 2 to 4 of the plan.

Validation: `lint`, `typecheck`, `build`, `test:unit` and `check:package` (the
package gates CI runs), plus `test:e2e`. The package publishes nothing, so
`check:package` checks the built site instead: every catalog and demo route has
a prerendered page, and no shipped file carries a private key, a registry or
GitHub token, or an absolute build-machine path.
