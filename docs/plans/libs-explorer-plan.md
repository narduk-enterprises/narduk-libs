# Narduk Libs Explorer — plan

> **Status (2026-09-21).** Increment 1 is implemented in
> `packages/design/libs-explorer` (see its README). Increments 2–4 are open. The
> plan below is recorded as Logan approved it; the tracking table at the end is
> the only part that changes as work lands.

## Recommendation

Storybook was the first idea: it provides component previews, controls,
documentation and testing, and its Nuxt integration supports Nuxt 4
([Storybook documentation](https://storybook.js.org/docs/get-started/frameworks/vue3-vite),
[Nuxt integration](https://storybook.nuxtjs.org/getting-started/setup/)).

For the chosen scope, **build a focused Nuxt Explorer at `libs.nard.uk`**, using
the existing Narduk components and testing tools. Its main advantage is bringing
components, complete layouts, maps and nonvisual packages into one coherent
experience.

Reuse the existing static design cards and chart examples. Keep the current
design export and Histoire tooling working; adding a second Storybook
application is outside this release.

## What you'll be able to explore

| Area                  | First-release experience                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Foundations**       | Colors, typography, spacing, surfaces, status signals and chart palettes, with light/dark previews and copyable token names.                                                                          |
| **Components**        | Every supported public visual component: shell, status instruments, core UI, auth and admin UI. Interactive examples, variants, useful prop controls, and loading/empty/error states where supported. |
| **Charts**            | All eight exported chart components, plus examples of streaming, zooming, synchronized panes, annotations, themes and export.                                                                         |
| **Map lab**           | Real Apple basemaps with markers, selection, clustering, callouts, geometry, overlays, playback, pointer probes, fullscreen and GeoGrid rendering.                                                    |
| **Composed examples** | A dashboard, settings/form screen and map-with-details screen showing how the packages work together.                                                                                                 |
| **Package catalog**   | Every workspace package: purpose, capabilities, prerequisites, install/import examples and related demos. Server packages and tooling receive guides and illustrative examples.                       |

Each demo gets a permanent URL, reset button, light/dark switch, viewport
presets, copyable usage example and a bounded event log where useful. Search
covers package names, component names and capabilities such as "CSV", "callout"
or "upload".

Use curated controls and data presets. Arbitrary browser code execution is
outside this release.

## Implementation

- Add a private workspace application at `packages/design/libs-explorer`, using
  the repository's Nuxt 4, Nuxt UI, TypeScript and pnpm versions. Add root
  commands `explorer:dev`, `explorer:build` and `explorer:test`.
- Build the Explorer's own interface with Narduk components. Use searchable
  navigation, category landing pages and dedicated full-width chart/map pages.
- Reuse package-owned design cards for baseline previews. Add interactive
  example wrappers around the actual components, using supported package imports
  and Nuxt module registration. Preserve the deterministic static design export.
- Add an internal typed example registry describing stable IDs, owning package,
  category, documentation, example loader and controls. This is development
  tooling, with no new published library API.
- Generate package inventory from `pnpm-workspace.yaml`. Reuse the existing
  component-surface discovery and extend coverage to public core/auth/admin
  components and registered map scenarios. Fail validation for missing catalog
  entries, missing required demos, duplicate IDs or broken references.
- Use routes `/foundations`, `/components/:id`, `/charts/:id`,
  `/maps/:scenario`, `/patterns/:id` and `/packages/:slug`. Encode selected
  presets in URLs so examples can be shared.
- Render documentation on the server and load heavy demos on demand. Mount maps
  only on map pages and dispose maps, timers and playback resources when
  leaving.
- Run auth/admin examples through an Explorer-owned simulation adapter using
  synthetic users and in-memory state. Display their simulated status clearly;
  exercise the real components without registering operational auth, AI or
  database handlers.
- Publish curated documentation and consumer-ready snippets. Show GitHub
  Packages access requirements and identify the displayed workspace versions and
  source commit.

**Map implementation:** use the current `narduk-mapkit/nuxt` integration, its
existing token route and `geogrid-web`. Keep signing keys server-side, scope
tokens to the showcase origin and apply rate limiting. Ship bounded, labeled
fixture datasets for markers, geometry, rasters and temporal frames. Missing
credentials or Apple failures produce an explicit unavailable state with retry.

## Validation and acceptance

- Every catalog entry and demo route resolves; every supported public visual
  component has a working preview.
- Playwright verifies representative interactions: table sorting/paging/export,
  form validation, dialog focus, chart controls, map selection/callouts,
  playback and reset.
- Test mobile and desktop layouts, both color schemes, keyboard navigation and
  accessibility. Capture deterministic screenshots for components and simulated
  map states.
- Use the existing MapKit fake for offline CI. Separately verify real Apple
  basemaps, token delivery, overlays and recovery on the deployed site;
  fake-based tests do not count as live-map proof.
- Check that simulations make no operational service calls and that public
  assets contain no signing material or internal documentation.
- Run affected-package gates and the Explorer browser suite. Keep the existing
  surface check and static design build passing.

## Delivery and defaults

Deliver in four reviewable increments:

1. Explorer navigation, package catalog, foundations and one complete
   interactive component page.
2. Complete visual-component coverage, charts and composed examples.
3. Live map lab and GeoGrid scenarios.
4. Public deployment, visual polish and acceptance checks.

Host on **Cloudflare Workers at `libs.nard.uk`**. Extend the repo's lifecycle
contract for this hosted surface and deploy verified main commits through a
dedicated workflow. Show build provenance, verify the public URL and share
metadata after deployment, and retain the previous Worker deployment for
rollback.

Confirmed choices: **Libs Explorer; public showcase; all visuals plus the full
catalog; real maps with fixtures; `libs.nard.uk`.** The public site tracks
verified workspace source, clearly identified by commit. Live data feeds and
operational full-stack sandboxes are deferred.

## Tracking

| Increment | State  | Notes                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Landed | Searchable navigation, `/foundations` (tokens parsed from the coded stylesheets), `/packages/:slug` for all 28 workspace packages, `/components/:id` for all 15 registered shell components plus the formatters (design-card previews), and an interactive `NeDataTable` page. The coverage check fails the build. Prerendered as a static site; Playwright covers desktop and mobile. |
| 2         | Open   | narduk-ui instruments, charts (reuse the Histoire stories), core/auth/admin components through the simulation adapter, composed examples, real viewport emulation (an iframe frame, so media queries respond).                                                                                                                                                                         |
| 3         | Open   | Map lab. Needs a server target for the MapKit token route, which is why increment 1 stays static.                                                                                                                                                                                                                                                                                      |
| 4         | Open   | Workers deployment at `libs.nard.uk`, lifecycle contract row, deploy workflow, share metadata, rollback; the browser suite in CI.                                                                                                                                                                                                                                                      |
