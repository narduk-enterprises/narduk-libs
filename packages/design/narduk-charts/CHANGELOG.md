# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `NardukCandleChart` (OHLC, zoom/pan/box, pinch zoom, optional volume + brush minimap, `v-model:domain`), `useCandleStream`, `largestTriangleThreeBuckets`, candle aggregation helpers, `narduk-charts/candle` entry.
- Marketing site + per–use-case examples under `site/` (`npm run dev`, `npm run build:site`); `npm run dev:playground` for the full interactive lab only.
- Site: `/examples/trading` showcases dual synced candle panes, `useCandleStream` live bars, volume, brush, and terminal dark mode; `/examples/candle` redirects there.
- `NardukCandleChart`: linear Y-scale without forcing zero (readable quotes), padded domain, crosshair + magnetic X + axis price tag, last-price line, close trace, optional session grid, OHLC HUD, `formatPrice`, and sharper candle styling. `createYAxisMap` gains `linearFromZero` (default unchanged for line/bar).
- Accessibility: figure/labels, SVG `<title>`/`<desc>`, keyboard navigation (line SVG, bar rects, pie slices), `aria-live` summaries on line charts, fieldset legend + `aria-pressed` on legend toggles.
- `NardukScatterChart`, `NardukHistogramChart`; bar `stackedPercent`; line `maxRenderPoints` (category decimation via `decimateCategoryData`).
- `ChartLineAnnotationsV1` type alias; `useStreamingSeries` `maxUpdatesPerSecond` throttle.
- Per-chart ESM entry points: `narduk-charts/line`, `/bar`, `/pie` (import `narduk-charts/style.css` once).
- Playwright harness (`e2e/`), visual snapshot for line section (local), `size-limit` budgets, GitHub Actions CI (typecheck, tests, build, size, Playwright, audit).
- Docs: `docs/API.md`, `docs/MIGRATIONS.md`, `docs/recipes/nuxt.md`, `SECURITY.md`.
- Initial public structure: line, bar, and pie charts (Vue 3 + TypeScript + SVG); themes, Tailwind v4–compatible chart tokens (`--color-chart-*`), playground, Histoire stories, Vitest math/util tests, export helpers (SVG/PNG).
