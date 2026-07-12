# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.2.0] - 2026-07-12

### Added

- `NardukBrandBackdrop`: optional SVG-only marketing/hero backdrop (grid, series, candle hints) driven by `--color-chart-*` tokens—no bitmap assets. Histoire story **Brand backdrop** demonstrates usage behind a line chart.
- `NardukLineChart` accepts `chrome` (default `true`), `showTooltip` (default `true`), and `focusable` (default `true`) for decorative/sparkline embedding: `chrome={false}` drops the card border/shadow/background wrapper, `showTooltip={false}` disables the built-in cursor tooltip, and `focusable={false}` removes the SVG root's `tabindex`/keyboard handling and marks it `aria-hidden`. Replaces `:deep()` CSS overrides and inert wrappers consumers were reaching for.
- `NardukCandleChart` emits `reachedStart` with `{ earliestTime }` when the visible domain's start reaches/nears (within ~2 bars of) the earliest loaded bar—mirrors lightweight-charts' `subscribeVisibleTimeRangeChange` left-edge load-more pattern. Fires once per dataset identity and re-arms when earlier bars are prepended (the bars array's first `t` changes).
- `NardukPieChart` emits `sliceHover(index: number | null)` on slice `pointerenter`/`pointerleave`, and accepts `showLegend` / `showCenterLabel` / `showTooltip` (all default `true`) so consumers stop hiding built-ins with `display: none` on internal class names.

### Changed

- **Registry:** CI and publish target **GitHub Packages** (`npm.pkg.github.com`) using `tools/configure-package-registry-auth.mjs` and org secrets (`NARDUK_PLATFORM_GH_PACKAGES_*`), aligned with [`narduk-template`](https://github.com/narduk-enterprises/narduk-nuxt-template). Legacy Forgejo registry workflows and URLs were removed.

## [2.1.4] — 2026-05-15

### Added

- `NardukLineChart` accepts `linearPaddingRatio` for proportional headroom and footroom on linear Y domains.

## [2.1.3] — 2026-05-15

### Added

- `NardukLineChart` accepts `linearFromZero={false}` for data-relative positive linear Y domains.

## [2.1.2] — 2026-05-15

### Added

- `NardukLineChart` accepts `padding` overrides for compact chart previews that hide axes or need tighter plot bounds.

## [2.1.1] — 2026-05-15

### Added

- `NardukLineChart` supports opt-in adaptive time-series X axes with `xAxisType="time"`, aligned `times`, `formatTime`, and `xAxisMinLabelPx`.
- Shared X-axis tick selection helpers with regression coverage for dense line and candle time labels.

### Fixed

- CI audit now passes at the configured high-severity threshold after refreshing vulnerable transitive dev-tooling packages in the lockfile.

## [2.1.0] — 2026-04-19

### Added

- **`NardukBarChart` horizontal orientation:** new optional prop `orientation?: 'vertical' | 'horizontal'` (default `'vertical'`). Horizontal mode lays categories along the Y axis and draws bars extending along +X from the left gutter—ideal for long category labels (e.g. leaderboards). Optional `categoryLabelMaxWidth` caps the left gutter (`min` of estimated width and cap). Rounded horizontal bars animate in with `scaleX` (CSS `transform`); sharp horizontal rects animate `width`/`x` like other bar charts. Keyboard: ArrowUp/ArrowDown move between categories; ArrowLeft/ArrowRight move between series within a category.

### Changed

- Exported types `NardukBarChartOrientation` and `NardukBarChartProps` from the package entrypoint.
- **Removed** the in-repo Vite **gallery** (`site/`) and **playground**; runnable demos and flagship examples belong on the companion marketing site. Local library work uses **Histoire** (`npm run dev` / `npm run story:dev`). Dropped the Playwright **ui-quality** job and `aaplMarketingDemo` file-path scaffold test that targeted `site/`.

## [2.0.2] — 2026-03-27

### Fixed

- **Bar chart:** `stacked-percent` without `stacked` now lays out as stacked (100% composition was a no-op when `stacked` stayed false).

### Changed

- **`useChartFullscreen`:** `enter` and `toggle` return `Promise<boolean>` so apps can detect denial or unsupported APIs.
- **Site `HomeView`:** example/playground links target the public marketing site (`charts.nard.uk` showcase and docs) instead of removed in-repo routes.

## [2.0.1] — 2026-03-27

### Changed

- Gallery site: skip link, main landmark, focus-visible styles, touch-friendly nav, reduced-motion button transitions, clearer hero sample labeling.
- Chart styles: `prefers-reduced-motion` overrides for bar, pie, tooltip, and legend transitions; histogram bar transitions respect reduced motion.
- Candle chart and math utilities: minor fixes (see git history).

## [2.0.0] — 2026-03-26

### Changed

- **Breaking:** Package name is now **`@narduk-enterprises/narduk-charts`** (scoped). Subpath imports use the same scope (for example `@narduk-enterprises/narduk-charts/style.css`, `@narduk-enterprises/narduk-charts/candle`).
- Publish to the platform **Forgejo npm registry** via tag-driven package workflows (`.forgejo/workflows/publish-package.yml` canonical, `.github/workflows/publish.yml` compatibility mirror).

### Added

- `NardukCandleChart` (OHLC, zoom/pan/box, pinch zoom, optional volume + brush minimap, `v-model:domain`), `useCandleStream`, `largestTriangleThreeBuckets`, candle aggregation helpers, `@narduk-enterprises/narduk-charts/candle` entry.
- Development gallery + per-route examples under `site/` (`npm run dev`, `npm run build:site`); public marketing site lives at [charts.nard.uk](https://charts.nard.uk). `npm run dev:playground` runs the full interactive lab.
- Site: `/examples/trading` showcases dual synced candle panes, `useCandleStream` live bars, volume, brush, and terminal dark mode; `/examples/candle` redirects there.
- `NardukCandleChart`: linear Y-scale without forcing zero (readable quotes), padded domain, crosshair + magnetic X + axis price tag, last-price line, close trace, optional session grid, OHLC HUD, `formatPrice`, and sharper candle styling. `createYAxisMap` gains `linearFromZero` (default unchanged for line/bar).
- Accessibility: figure/labels, SVG `<title>`/`<desc>`, keyboard navigation (line SVG, bar rects, pie slices), `aria-live` summaries on line charts, fieldset legend + `aria-pressed` on legend toggles.
- `NardukScatterChart`, `NardukHistogramChart`; bar `stackedPercent`; line `maxRenderPoints` (category decimation via `decimateCategoryData`).
- `ChartLineAnnotationsV1` type alias; `useStreamingSeries` `maxUpdatesPerSecond` throttle.
- Per-chart ESM entry points: `@narduk-enterprises/narduk-charts/line`, `/bar`, `/pie` (import `@narduk-enterprises/narduk-charts/style.css` once).
- Playwright harness (`e2e/`), visual snapshot for line section (local), `size-limit` budgets, CI workflows for typecheck, tests, build, size, Playwright, and audit.
- Docs: `docs/API.md`, `docs/MIGRATIONS.md`, `docs/recipes/nuxt.md`, `SECURITY.md`.
- Initial public structure: line, bar, and pie charts (Vue 3 + TypeScript + SVG); themes, Tailwind v4–compatible chart tokens (`--color-chart-*`), playground, Histoire stories, Vitest math/util tests, export helpers (SVG/PNG).
