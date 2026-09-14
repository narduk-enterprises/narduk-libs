# operator-portal — component-usage survey (L6)

SHA `fe1192d` on `main`. Single Nuxt 4 app at repo root (`app/`), Nuxt UI 4.9,
no Tailwind/tanstack-table direct deps, narduk-core/auth/charts adopted
(versions in JSON). Read-model-driven: server APIs serve pre-aggregated
snapshots, no page/limit/cursor params anywhere.

## The table story (this is the flagship case)

The lane brief anticipated "~11 raw `<table>` usages" to classify individually.
Reality at this SHA: **there is exactly one table primitive**,
`app/components/CollectionTable.vue` (421 loc), used by 17 consumer files. All
the historical hand-rolled tables were already consolidated onto it across PRs
#155, #159, #186, #269, #276 (`git log`/`gh pr list` evidence in JSON
`defect_history`). Issue #168 ("Dead CSS: `.v4-table` rule family has zero
consumers after the last CollectionTable migration") is the tombstone for the
old approach.

What CollectionTable does today:

- Real `<table>`/`role="table"` markup, `th scope="col"`,
  `<caption class="sr-only">` — a11y-reviewed by design (doc comment at top of
  file explains why: implicit table semantics can be lost across the responsive
  reflow, so roles are explicit).
- Mobile: **not** cards, **not** horizontal-scroll, **not** hidden-columns.
  Below 1000px it keeps the exact same DOM/cells, drops only the visual header,
  one cell per line. Horizontal scroll and hidden columns are explicitly
  prohibited in the component's own doc comment
  (`app/components/CollectionTable.vue:18-25`), and I confirmed no `overflow-x`
  anywhere in the file.
- Grouped rows (`groups` prop, `scope="rowgroup"` headers) and flat `rows`, a
  `more` bounded-read footer (`<tfoot>`, caller-supplied label/href — explicitly
  **not** a pager).
- Per-column named slots (`#<column.key>`) for custom cell rendering (badges,
  links).

What it does **not** do: sort, paginate, or search are entirely absent from the
component. One consumer (`app/pages/projects/index.vue:49`) does its own inline
`[...].sort()`; no page paginates (full read-model snapshot is rendered);
`FilterBar.vue` (173 loc, 8 consumers) renders filter chips but explicitly does
not own the search input itself, per its own doc comment.

Tests: `tests/e2e/09-collection-table.spec.ts` (232 loc),
`tests/e2e/21-mobile-collection-tables.spec.ts` (415 loc),
`tests/unit/documents-collection-table.test.ts` — 647+ lines of coverage, the
strongest test coverage of any pattern found in this repo.

A shared narduk-libs table replacing this must cover: real semantic `<table>`
a11y under responsive reflow (not just visual restyling), the grouped-rows +
bounded-read-footer shape, per-column slot API, and — since this component has
none — add sort/paginate/search, which operator-portal currently does per-page
or not at all (open issues #330, #201 show unaddressed sort needs).

## Other reusable things this app hand-rolls (path / LOC / consumers)

1. `app/components/CollectionTable.vue` — 421 loc, 17 consumers. See above.
   `duplicates_lib: none` (narduk-libs ships no table).
2. `app/components/StatePanel.vue` — 89 loc, **22 consumers** (highest reuse in
   the repo). `variant: empty|blocked|clear|absent`. Plausibly overlaps
   narduk-core's `AppEmptyState` by name/purpose; not prop-compared (out of lane
   scope).
3. `app/components/FreshnessStamp.vue` — 30 loc, 16 consumers. Figure-bearing
   freshness stamp; issue #253 tracks formalizing it. Plausibly overlaps
   narduk-ui's `NsFreshnessChip`; not prop-compared.
4. `app/components/FilterBar.vue` — 173 loc, 8 consumers. Chips/facets only, not
   the search input.
5. `app/components/SparkTile.vue` — 471 loc, 1 consumer. KPI tile wrapping
   `NardukLineChart`; low reuse today but the only stat-tile-with-sparkline
   shape in the app.
6. Status chip family — `DomainChip.vue` (13 loc, 1 consumer),
   `clients/KindChip.vue`, `products/AnalyticsChip.vue`, `products/Badges.vue` —
   four separate small badge components, no shared generic badge, and
   narduk-libs ships none either.
7. `app/components/CommandPalette.vue` (487 loc) and
   `app/components/EvidenceDrawer.vue` (157 loc) — `role="dialog"` overlays,
   domain-specific, not confirm-modal/toast patterns; noted for completeness,
   not a lane-target pattern.

## What has broken (evidence in JSON `defect_history`)

- #167 (closed): three tables horizontal-scrolled on phones pre-migration
  (Documents, Analytics, Decisions).
- #180 (closed): `/portfolio/analytics` sideways-scrolled at 390px (a CSS
  `min-width:auto` trap, not the table itself).
- #236 (closed): e2e gaps — `/login` and `/portfolio/property` missing from the
  mobile CollectionTable sweep, since fixed by PR #242.
- #273 (open): e2e flake — products State-column word-break assertion reads a
  detached node.
- #279 (closed): pagination/search tap targets under the 44px floor (predates
  current no-pagination state, or refers to a different control — flagged, not
  resolved by this survey).
- #330, #201 (open): sort needs unaddressed (YAML file order instead of
  alphabetical; heartbeat chronology).
- #156 (closed): `overflow-wrap: anywhere` split state words in two separate
  components — the root cause behind CollectionTable's explicit `op-word-safe`
  handling today.

## Counts

vue_files_total 60, components 32, pages 25, layouts 1, composables 9. Commands
in JSON `counts.commands`.
