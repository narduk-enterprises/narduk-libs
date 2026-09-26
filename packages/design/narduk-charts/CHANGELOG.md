# Changelog

## 2.7.3

### Patch Changes

- c8ab502: The packed `dist/index.d.ts` (and the `dist/index.d.cts` copy) again
  exports the public surface, including `NardukLineChart` and `ChartSeries`.
  TypeScript 6 was emitting those declarations under `dist/src/` and leaving the
  types entry as `export {}`.

  Refs narduk-libs#1161

## 2.7.2

### Patch Changes

- b565b01: narduk-charts: `niceScale` no longer loops forever when a domain
  spans only a few ULPs (#927). It widens such a range the same way as
  `min === max`, and it builds ticks by index.

  narduk-charts: domain and histogram math no longer spreads every value into
  `Math.min`/`Math.max`, which threw a RangeError past ~100k values (#929).
  Internal `arrayMin`/`arrayMax` loop helpers replace those calls.

  narduk-charts: `useChart` starts observing its container again when `width`
  goes from set to unset (#934), so a chart that was pinned to a fixed width no
  longer sticks at 600px.

  narduk-charts: `NardukBarChart` bars grow from zero instead of the domain
  floor (#928), so negative values hang below (or left of) the zero line.
  Stacked bars keep separate positive and negative totals, and the stacked
  domain covers both.

## 2.7.1

### Patch Changes

- f43caf2: Fix two narduk-charts rendering bugs. `macd()` no longer returns
  signal values before the MACD line exists; the signal now starts
  `signalPeriod` samples after the line's first real value (#867).
  `NardukBarChart` with `stacked` or `stackedPercent` on a `log` or `symlog`
  axis now ends each stack where the axis places its total, so equal totals line
  up regardless of how they split across series (#873). Linear stacks are
  unchanged.

## 2.7.0

### Minor Changes

- 7484b7d: Carry the options the retired standalone narduk-charts repository
  published as 2.6.0 on 2026-09-23: line-series `spanGaps`, `mode: 'points'`,
  `marker` (`radius`, `filled: false` rings), `opacity` and `showValues` /
  `formatValue`; point annotations' `ring`; `xTickIndices` with thinning on
  narrow charts; and bar `yMin` / `yMax`, `showXAxis`, `showYAxis`, `showGrid`,
  `showLegend` and `padding`. narduk-libs continues from 2.6.0, the registry's
  `latest`, so this release is the first to ship those options together with
  narduk-libs' 2.5.x fixes and the `./spark` export. The package docs now name
  narduk-libs as the only source and release path. `create-narduk-app` releases
  alongside because it pins narduk-charts.
- 1df13cb: Add `@narduk-enterprises/narduk-charts/spark`: axis choice, SVG path
  generation (optional timestamp X via `times`), and 24h/7d/30d trailing-window
  helpers for micro-sparklines. The Vue line-chart sparkline recipe is
  unchanged. `create-narduk-app` releases alongside because it pins
  narduk-charts.

### Patch Changes

- 8226f05: Address narduk-charts lint findings deferred at eslint-config
  adoption (#131). `create-narduk-app` releases alongside because it pins
  narduk-charts.

## 2.6.0

Published on 2026-09-23 from the retired standalone
`narduk-enterprises/narduk-charts` repository (its PR #38, for narduk-charts#37
and narduk-farm#358), after the source had moved into narduk-libs at 2.5.6. That
artifact was built from the standalone line (2.5.0 plus these options), so it
does not contain narduk-libs' 2.5.1–2.5.6 changes. narduk-libs now carries the
same options on top of 2.5.6 and continues from 2.6.0; the next release from
here is the first to ship both.

Shapes Acre Oracle (narduk-farm) drew as hand-rolled SVG — a sparse day-of-year
greenness line, per-crop small multiples, a thin "% of normal" bar and a
year-dot timeline — now draw with the library. Everything is additive and
opt-in.

### Minor Changes

- **`NardukLineChart` per-series `spanGaps`** (`true | number`). A number joins
  two values across `null`s only when they are at most that many label slots
  apart, so a satellite-pass series never draws a line across a long cloudy gap.
  `segmentLinePoints` gains the matching optional `maxGap` argument.
- **`NardukLineChart` per-series `mode: 'points'`, `marker: { radius, filled }`
  and `opacity`**, for observations that must not read as a trend (e.g.
  half-opacity hollow rings for cloudy passes). A hollow marker's ring colour is
  applied through `style`, because the stylesheet's marker `stroke` outranks a
  presentation attribute.
- **`NardukLineChart` per-series `showValues` / `formatValue`** — always-visible
  value labels above each point, drawn outside the plot clip.
- **`NardukLineChart` `xTickIndices`** — label exact category indices (month
  starts on a 366-slot axis), thinned by `xAxisMinLabelPx` (default `36`) so
  labels never overlap on a narrow chart.
- **`point` annotation `ring: true`** — a ringed marker over the plot
  background, for a single value such as a season peak.
- **`NardukBarChart` `yMin` / `yMax`, `showXAxis`, `showYAxis`, `showGrid`,
  `showLegend` and `padding`**, mirroring `NardukLineChart`, so a horizontal bar
  can be a thin inline mark with a reference tick.
- Histoire story **Farm shapes (narduk-charts#37)**, unit tests for each option,
  and SSR coverage of all four shapes in `src/ssr.test.ts`.

## 2.5.6

### Patch Changes

- 42019f6: Pin SSR hydration for `NardukLineChart` and `ChartTooltip`. The
  components are unchanged; these are the first hydration tests in the package,
  added while narrowing riverstatus#204 — they server-render each component,
  hydrate that exact markup and assert that Vue raised no warning, which is the
  only place a hydration mismatch is visible.

  `create-narduk-app` releases alongside because it pins narduk-charts.

## 2.5.5

### Patch Changes

- 5ac629e: The off-screen data table that `show-data-table` renders no longer
  widens its container (narduk-libs#296). The visually-hidden class now sits on
  a wrapping `div` instead of the `<table>`. `overflow` does not apply to a
  table box, and an auto-layout table grows to its content's width whatever its
  declared `1px`. In a 320px box the line and bar charts' hidden tables used to
  reach 669px, and they pushed Buoys' 390px station page out to 652px. The table
  and its caption are unchanged, so screen readers still announce it as a table.
  Buoys can turn `show-data-table` back on.

## 2.5.4

### Patch Changes

- 92835a1: Lint through `narduk-lint` with a checked-in `lint-budget.json`
  recording the package's current warning counts (narduk-mapkit also marks
  fire-and-forget limiter calls in its tests with `void`). No runtime change;
  the release gate requires a changeset for any changed package file.

## 2.5.3

### Patch Changes

- 31a43a7: Pin default time-axis labels to `en-US` / `UTC` (optional `timeZone`
  prop) so SSR and the browser cannot disagree on tick text or the tick set.

  ## Operator action / behaviour change

  Default labels moved from the host locale and zone to `en-US` / UTC with a
  12-hour clock. Pass `timeZone` (IANA) for local labels. `formatTime` still
  overrides both.

## 2.5.2

### Patch Changes

- 98a199b: Add an NE Base design card (`src/design-cards/<Name>.card.vue`) for
  every registered chart component (`NardukLineChart`, `NardukBarChart`,
  `NardukPieChart`, `NardukScatterChart`, `NardukHistogramChart`,
  `NardukCandleChart`, `NardukChartStack`, `NardukBrandBackdrop`), completing
  the suite bar's last requirement alongside the existing README sections and
  mount/SSR tests. `scripts/check-component-surface.mjs` now checks this package
  (components backlog item 22, narduk-libs#269).
- 22a6303: Document `NardukScatterChart`, `NardukHistogramChart`,
  `NardukChartStack` and `NardukBrandBackdrop` to the suite bar (props, slots,
  events, one example) and add mount plus no-DOM SSR coverage so every exported
  chart component has both.

## 2.5.1

### Patch Changes

- e2e3a50: Fold the standalone `narduk-charts` repository into this monorepo at
  `packages/design/narduk-charts`, per company-hq D-WEBFOUND-2 (2026-09-04)
  Q2(a) "One monorepo, four families." Full commit history was preserved via
  `git filter-repo --to-subdirectory-filter` (confirmed with `git log --follow`
  on a moved file, unlike `git subtree add`, whose default rename-detection does
  not traverse the merge boundary for this case).

  The package keeps its published name and version line
  (`@narduk-enterprises/narduk-charts`, continuing from 2.5.0) and is now a
  first-class libs package: it adopts the shared `eslint-config`, Prettier,
  Turbo tasks, and Changesets, and its `exports["."]` map was restructured
  (nesting `types` inside each of the `import`/`require` conditions, with a
  matching `dist/index.d.cts`) to satisfy `publint --strict`, which the
  standalone repo never ran. No runtime behavior changes; first-time lint
  findings that touch real behavior are deferred to narduk-libs#131 rather than
  fixed in this move. Part of company-hq#552.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.5.0] - 2026-09-04

### Added

- **`NardukLineChart` can render a sparkline.** `showXAxis` and `showYAxis`
  (both default `true`) suppress an axis line _and_ its tick labels; under
  `dualYAxis`, `showYAxis: false` takes the right-hand axis with it. Previously
  the two `narduk-axis` groups had no guard at all — `showGrid` covered only the
  gridlines and `chrome: false` only the card wrapper — so a small axis-free
  trend mark was impossible and consumers kept hand-rolled SVG instead.
  (narduk-charts#28)
- **`NardukLineChart` accepts a pinned Y domain.** `yMin` / `yMax` (and
  `yMinSecondary` / `yMaxSecondary`, matching the existing `yScale` /
  `yScaleSecondary` pairing) are threaded into `createYAxisMap` as new
  `domainMin` / `domainMax` options. A pinned end is used **exactly** and does
  not pass through `niceScale`, so a grid of charts handed one bound shares a
  scale to the pixel, and a ceiling stated as a series' own maximum stays that
  number instead of the round one above it. Either end may be pinned alone;
  unset ends keep today's derived behaviour. Honoured in all three scale modes —
  `log` clamps a non-positive floor it cannot represent, and `symlog` transforms
  the bounds before spacing ticks evenly in transformed space.
  (narduk-charts#29)
- `NardukLineChart` `showLegend` (default `true`). `chrome: false` never reached
  the legend, so a single-series chart embedded in a surface that already names
  its series carried a duplicate label — and, since a legend row is a series
  toggle, a duplicate focusable control per chart. On a grid of small tiles the
  legend could be taller than the mark it labelled. (narduk-charts#34)
- `NardukLineChart` `yTickCount` (default `6`, clamped 2–12) forwards to
  `createYAxisMap`'s `maxTicks`, which the component previously never passed.
  (narduk-charts#30)
- `NardukLineChart` `pointRadius` (default `3`) sizes `showPoints` and
  isolated-value markers; the `point` annotation takes an optional
  per-annotation `radius` (default `5`). Both exist so a compact chart is not
  forced to carry desktop-sized markers.
- **SSR render coverage.** A new `src/ssr.test.ts` renders all seven exported
  components through `@vue/server-renderer` in the `node` environment — no
  `window`, no `document` — and asserts real markup, the server-side accessible
  `<title>`/`<desc>`, and the sparkline configuration. The library's DOM-free
  posture was previously inspection-only: every other suite gives the components
  a DOM. (narduk-charts#31)
- README: a **sparkline recipe** under `NardukLineChart`, and props-table rows
  for all of the above.

### Fixed

- **A value isolated between two `null`s rendered as nothing at all.**
  `segmentLinePoints` splits the series at every `null` and
  `lineSegmentsToPaths` returns `''` for a run shorter than two points, so a
  sparse series whose measured entries never neighbour one another drew a
  completely blank plot beside a real, non-zero total — the data silently
  invisible, with no gap, no marker and no absent state. Such values are now
  drawn as markers (`showIsolatedPoints`, default `true`; ignored when
  `showPoints` already draws every value). A point rather than a line, because a
  line asserts the entries between its ends while a point asserts only itself.
  **This changes the appearance of charts that currently render nothing for such
  values — which is the defect.** (narduk-charts#27)
- `main`'s `package.json` said `2.3.0` while `2.4.0` was tagged and published:
  the `2.4.0` release commit was cut on a branch that never merged back, so the
  repository misreported its own released version and 2.4.0's shipped notes sat
  under `## [Unreleased]`. Those notes are filed under `## [2.4.0]` below and
  the version now leads the registry. `docs/RELEASE.md` gains the step that was
  skipped. No library source was missing from `main`. (narduk-charts#32)

## [2.4.0] - 2026-07-26

### Added

- Categorical series palette is now themable: ten `--color-chart-series-1` …
  `--color-chart-series-10` tokens are declared in `@theme` and re-declared by
  `.narduk-chart--dark` and every preset `theme` class. Series colors resolve to
  `var(--color-chart-series-N, <literal>)` instead of a hard-coded array, so
  overriding a token repaints the data. An explicit `colors` prop still wins and
  is used verbatim. Each `var()` carries a literal fallback so a stylesheet-less
  `exportChartSvg` still renders the default palette.
- Histoire story **Series palette**: all ten series under `default`, `dark`,
  `high-contrast`, `print`, `colorblind-safe` and `colorblind-safe · dark`.

### Fixed

- `theme="colorblind-safe"` repainted only text, grid and axis — the series kept
  the default palette and stayed exactly as unsafe. It now declares eight hues
  separated by lightness as well as hue (slots 9–10 wrap to 1–2), with a lifted
  variant for `dark` so the two darkest members aren't near-black on a
  near-black plot. `theme="high-contrast"` and `theme="print"` likewise carry
  their own series palettes.

### Changed

- **Series palette values.** The default palette moves from the Tailwind-ish hex
  array to a ten-hue OKLCH ramp. Series 1 and 2 are no longer blue and red: the
  most common two-series chart read as good vs bad and vibrated on white. Charts
  that never set `colors` will change appearance.
- **Semantic token values** re-tuned on the same names: `--color-chart-text` and
  `--color-chart-muted` darker (axis labels legible at 10px),
  `--color-chart-grid` lighter so the grid recedes behind the data,
  `--color-chart-axis` and `--color-chart-frame` unified to one hairline value,
  `--color-chart-plot-tint` flattened to the surface color,
  `--color-chart-accent` aligned to series 1, and `--color-chart-up` /
  `--color-chart-down` matched in lightness. The dark block is retuned to the
  same neutral hue family.
- Grid lines are a solid hairline — `stroke-dasharray`, `stroke-linecap` and the
  `0.72` opacity are gone. The dashes competed with `referenceLines` and
  `annotations`, which are genuinely dashed.
- The volume pane's plot surface mixes further toward `--color-chart-grid`; with
  a flat plot tint the previous mix resolved to the same color as the price pane
  and the split disappeared.

## [2.3.0] - 2026-07-13

### Added

- `NardukLineChart` accepts `volume` (aligned index-for-index with `labels`),
  `showVolume` (default `false`), and `volumeFraction` (default `0.22`, same
  clamp range and semantics as `NardukCandleChart`) to render a bottom volume
  histogram pane. Mirrors `NardukCandleChart`'s volume pane sizing, bar styling
  (`narduk-line-volume` / `narduk-line-volume__bg` / `narduk-line-volume__bar`),
  and bull/bear coloring (close vs. previous close, neutral fallback at index 0
  or for null volume). Volume decimates/windows identically to the plotted
  series (same `maxRenderPoints` index pipeline), so bars stay aligned under
  downsampling and `zoomable` pan/zoom. In multi-series charts, volume applies
  to `series[0]` only (documented; no runtime warning).

## [2.2.0] - 2026-07-12

### Added

- `NardukBrandBackdrop`: optional SVG-only marketing/hero backdrop (grid,
  series, candle hints) driven by `--color-chart-*` tokens—no bitmap assets.
  Histoire story **Brand backdrop** demonstrates usage behind a line chart.
- `NardukLineChart` accepts `chrome` (default `true`), `showTooltip` (default
  `true`), and `focusable` (default `true`) for decorative/sparkline embedding:
  `chrome={false}` drops the card border/shadow/background wrapper,
  `showTooltip={false}` disables the built-in cursor tooltip, and
  `focusable={false}` removes the SVG root's `tabindex`/keyboard handling and
  marks it `aria-hidden`. Replaces `:deep()` CSS overrides and inert wrappers
  consumers were reaching for.
- `NardukCandleChart` emits `reachedStart` with `{ earliestTime }` when the
  visible domain's start reaches/nears (within ~2 bars of) the earliest loaded
  bar—mirrors lightweight-charts' `subscribeVisibleTimeRangeChange` left-edge
  load-more pattern. Fires once per dataset identity and re-arms when earlier
  bars are prepended (the bars array's first `t` changes).
- `NardukPieChart` emits `sliceHover(index: number | null)` on slice
  `pointerenter`/`pointerleave`, and accepts `showLegend` / `showCenterLabel` /
  `showTooltip` (all default `true`) so consumers stop hiding built-ins with
  `display: none` on internal class names.

### Changed

- **Registry:** CI and publish target **GitHub Packages** (`npm.pkg.github.com`)
  using `tools/configure-package-registry-auth.mjs` and org secrets
  (`NARDUK_PLATFORM_GH_PACKAGES_*`). Legacy Forgejo registry workflows and URLs
  were removed.

## [2.1.4] — 2026-05-15

### Added

- `NardukLineChart` accepts `linearPaddingRatio` for proportional headroom and
  footroom on linear Y domains.

## [2.1.3] — 2026-05-15

### Added

- `NardukLineChart` accepts `linearFromZero={false}` for data-relative positive
  linear Y domains.

## [2.1.2] — 2026-05-15

### Added

- `NardukLineChart` accepts `padding` overrides for compact chart previews that
  hide axes or need tighter plot bounds.

## [2.1.1] — 2026-05-15

### Added

- `NardukLineChart` supports opt-in adaptive time-series X axes with
  `xAxisType="time"`, aligned `times`, `formatTime`, and `xAxisMinLabelPx`.
- Shared X-axis tick selection helpers with regression coverage for dense line
  and candle time labels.

### Fixed

- CI audit now passes at the configured high-severity threshold after refreshing
  vulnerable transitive dev-tooling packages in the lockfile.

## [2.1.0] — 2026-04-19

### Added

- **`NardukBarChart` horizontal orientation:** new optional prop
  `orientation?: 'vertical' | 'horizontal'` (default `'vertical'`). Horizontal
  mode lays categories along the Y axis and draws bars extending along +X from
  the left gutter—ideal for long category labels (e.g. leaderboards). Optional
  `categoryLabelMaxWidth` caps the left gutter (`min` of estimated width and
  cap). Rounded horizontal bars animate in with `scaleX` (CSS `transform`);
  sharp horizontal rects animate `width`/`x` like other bar charts. Keyboard:
  ArrowUp/ArrowDown move between categories; ArrowLeft/ArrowRight move between
  series within a category.

### Changed

- Exported types `NardukBarChartOrientation` and `NardukBarChartProps` from the
  package entrypoint.
- **Removed** the in-repo Vite **gallery** (`site/`) and **playground**;
  runnable demos and flagship examples belong on the companion marketing site.
  Local library work uses **Histoire** (`npm run dev` / `npm run story:dev`).
  Dropped the Playwright **ui-quality** job and `aaplMarketingDemo` file-path
  scaffold test that targeted `site/`.

## [2.0.2] — 2026-03-27

### Fixed

- **Bar chart:** `stacked-percent` without `stacked` now lays out as stacked
  (100% composition was a no-op when `stacked` stayed false).

### Changed

- **`useChartFullscreen`:** `enter` and `toggle` return `Promise<boolean>` so
  apps can detect denial or unsupported APIs.
- **Site `HomeView`:** example/playground links target the public marketing site
  (`charts.nard.uk` showcase and docs) instead of removed in-repo routes.

## [2.0.1] — 2026-03-27

### Changed

- Gallery site: skip link, main landmark, focus-visible styles, touch-friendly
  nav, reduced-motion button transitions, clearer hero sample labeling.
- Chart styles: `prefers-reduced-motion` overrides for bar, pie, tooltip, and
  legend transitions; histogram bar transitions respect reduced motion.
- Candle chart and math utilities: minor fixes (see git history).

## [2.0.0] — 2026-03-26

### Changed

- **Breaking:** Package name is now **`@narduk-enterprises/narduk-charts`**
  (scoped). Subpath imports use the same scope (for example
  `@narduk-enterprises/narduk-charts/style.css`,
  `@narduk-enterprises/narduk-charts/candle`).
- Publish to the platform **Forgejo npm registry** via tag-driven package
  workflows (`.forgejo/workflows/publish-package.yml` canonical,
  `.github/workflows/publish.yml` compatibility mirror).

### Added

- `NardukCandleChart` (OHLC, zoom/pan/box, pinch zoom, optional volume + brush
  minimap, `v-model:domain`), `useCandleStream`, `largestTriangleThreeBuckets`,
  candle aggregation helpers, `@narduk-enterprises/narduk-charts/candle` entry.
- Development gallery + per-route examples under `site/` (`npm run dev`,
  `npm run build:site`); public marketing site lives at
  [charts.nard.uk](https://charts.nard.uk). `npm run dev:playground` runs the
  full interactive lab.
- Site: `/examples/trading` showcases dual synced candle panes,
  `useCandleStream` live bars, volume, brush, and terminal dark mode;
  `/examples/candle` redirects there.
- `NardukCandleChart`: linear Y-scale without forcing zero (readable quotes),
  padded domain, crosshair + magnetic X + axis price tag, last-price line, close
  trace, optional session grid, OHLC HUD, `formatPrice`, and sharper candle
  styling. `createYAxisMap` gains `linearFromZero` (default unchanged for
  line/bar).
- Accessibility: figure/labels, SVG `<title>`/`<desc>`, keyboard navigation
  (line SVG, bar rects, pie slices), `aria-live` summaries on line charts,
  fieldset legend + `aria-pressed` on legend toggles.
- `NardukScatterChart`, `NardukHistogramChart`; bar `stackedPercent`; line
  `maxRenderPoints` (category decimation via `decimateCategoryData`).
- `ChartLineAnnotationsV1` type alias; `useStreamingSeries`
  `maxUpdatesPerSecond` throttle.
- Per-chart ESM entry points: `@narduk-enterprises/narduk-charts/line`, `/bar`,
  `/pie` (import `@narduk-enterprises/narduk-charts/style.css` once).
- Playwright harness (`e2e/`), visual snapshot for line section (local),
  `size-limit` budgets, CI workflows for typecheck, tests, build, size,
  Playwright, and audit.
- Docs: `docs/API.md`, `docs/MIGRATIONS.md`, `docs/recipes/nuxt.md`,
  `SECURITY.md`.
- Initial public structure: line, bar, and pie charts (Vue 3 + TypeScript +
  SVG); themes, Tailwind v4–compatible chart tokens (`--color-chart-*`),
  playground, Histoire stories, Vitest math/util tests, export helpers
  (SVG/PNG).
