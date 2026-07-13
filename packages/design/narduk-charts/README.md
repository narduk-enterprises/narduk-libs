# NardukCharts

**NardukCharts** is the product name for this Vue 3 SVG charting stack—TypeScript-first, themeable, accessible, built without D3 or Chart.js.

**npm package:** [`@narduk-enterprises/narduk-charts`](https://github.com/narduk-enterprises/narduk-charts) (published to **GitHub Packages**; not the public npm registry).

**Companion marketing site** (broader Narduk narrative, enterprise pages, SEO): [charts.nard.uk](https://charts.nard.uk)

**This repository:** library source, tests, markdown API notes (`docs/`), and **Histoire** component stories (`pnpm dev` / `npm run dev`, same as `npm run story:dev`). Runnable demos and flagship examples live on the companion **charts** site, not in this package repo.

## Install

```bash
npm install @narduk-enterprises/narduk-charts
```

For private org packages, configure the `@narduk-enterprises` scope to **GitHub Packages** (see root `.npmrc`) and authenticate with a GitHub token that has `read:packages` (install) or `write:packages` (publish). Locally, `npm run package-registry:auth` writes `.npmrc.auth` when `NARDUK_PLATFORM_GH_PACKAGES_READ` or `NARDUK_PLATFORM_GH_PACKAGES_RW` is set (same pattern as [narduk-template](https://github.com/narduk-enterprises/narduk-nuxt-template)).

## Publishing

GitHub Actions publishes tags `v*` to GitHub Packages (see `.github/workflows/publish.yml`), matching `narduk-template` publish jobs: org secrets `NARDUK_PLATFORM_GH_PACKAGES_READ` / `NARDUK_PLATFORM_GH_PACKAGES_WRITE` (or `NARDUK_PLATFORM_GH_PACKAGES_RW`).

Release steps live in [docs/RELEASE.md](./docs/RELEASE.md).

## Setup

Import the CSS once in your app entry:

```ts
import '@narduk-enterprises/narduk-charts/style.css'
```

### Theming (Tailwind v4 tokens)

The bundled `style.css` is compiled with **Tailwind CSS v4**. Semantic colors are **`--color-chart-*`** variables (declared on `:root` / `:host`, and overridden on `.narduk-chart--dark` and preset `theme` classes).

| Token | Used for |
|-------|-----------|
| `--color-chart-text` | Primary text, pie labels |
| `--color-chart-muted` | Axis labels, secondary text |
| `--color-chart-grid` | Grid lines, crosshair, legend hover |
| `--color-chart-axis` | Axis lines |
| `--color-chart-surface` | Point/outline contrast (e.g. halos) |
| `--color-chart-accent` | Default band / zoom box accent |
| `--color-chart-tooltip-bg` | Tooltip background |
| `--color-chart-tooltip-foreground` | Tooltip text |
| `--color-chart-tooltip-border` | Tooltip border |

**Tailwind app:** extend your design system in global CSS (after `@import "tailwindcss"`):

```css
@theme {
  --color-chart-text: var(--color-slate-900);
  --color-chart-muted: var(--color-slate-500);
  --color-chart-grid: var(--color-slate-200);
  --color-chart-axis: var(--color-slate-300);
  --color-chart-accent: var(--color-violet-500);
}
```

**Any stack:** set variables on a wrapper so they inherit into the chart, or override `:root` after importing `narduk-charts/style.css`.

> **Note:** Older releases used `--nc-*` variables; those are replaced by `--color-chart-*`.

## Components

### NardukLineChart

Multi-series smooth line chart with hover crosshair and data points.

```vue
<script setup lang="ts">
import { NardukLineChart } from '@narduk-enterprises/narduk-charts'

const series = [
  { name: 'Revenue', data: [30, 40, 35, 50, 49, 60, 70] },
  { name: 'Expenses', data: [20, 25, 30, 28, 32, 35, 40] },
]
const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']
</script>

<template>
  <NardukLineChart :series="series" :labels="labels" />
</template>
```

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `series` | `ChartSeries[]` | *required* | `{ name, data, color?, yAxis? }` — use `yAxis: 'secondary'` with `dualYAxis` |
| `labels` | `string[]` | *required* | X-axis labels |
| `width` | `number` | auto | Fixed width in px (responsive if omitted) |
| `height` | `number` | `400` | Chart height in px |
| `smooth` | `boolean` | `true` | Catmull-Rom curve smoothing |
| `showGrid` | `boolean` | `true` | Show horizontal grid lines |
| `showPoints` | `boolean` | `false` | Always show data points |
| `showArea` | `boolean` | `false` | Fill area under each line to the plot bottom |
| `volume` | `(number \| null)[]` | — | Volume values aligned index-for-index with `labels`. Applies to `series[0]` only in multi-series charts (documented, no runtime warning). Omit to leave rendering unchanged |
| `showVolume` | `boolean` | `false` | Render a bottom volume histogram pane when `volume` has data—mirrors `NardukCandleChart`'s volume pane sizing, bar styling, and bull/bear coloring. Bars decimate/window identically to the plotted series (same `maxRenderPoints` index pipeline), so they stay aligned under downsampling and `zoomable` pan/zoom |
| `volumeFraction` | `number` | `0.22` | Fraction of plot height reserved for the volume pane when `showVolume` is set (clamped 0.12–0.45, same semantics as `NardukCandleChart`) |
| `referenceLines` | `ChartReferenceLine[]` | — | Horizontal guides; optional `yAxis` when `dualYAxis`; right-side labels stack when close together |
| `colors` | `string[]` | built-in palette | Custom color palette |
| `animate` | `boolean` | `true` | Animate line draw-in on mount |
| `respectReducedMotion` | `boolean` | `true` | Honor `prefers-reduced-motion` for animations |
| `theme` | `ChartTheme` | `default` | `high-contrast`, `print`, `colorblind-safe` |
| `dark` | `boolean` | auto-detect | Force dark/light mode |
| `dualYAxis` | `boolean` | `false` | Right-hand Y scale for `series` with `yAxis: 'secondary'` |
| `yScale` | `ChartYScaleMode` | `linear` | `linear` · `log` (positive values) · `symlog` |
| `yScaleSecondary` | `ChartYScaleMode` | `linear` | Right axis scale when `dualYAxis` |
| `symlogLinthresh` | `number` | `1` | Linear threshold for `symlog` |
| `yBands` | `ChartYBand[]` | — | Horizontal bands (`y0`, `y1`, optional `color`, `opacity`, `yAxis`) |
| `annotations` | `ChartLineAnnotation[]` | — | `vline`, `point`, or `label` markers |
| `zoomable` | `boolean` | `false` | X zoom: **drag** a box on the plot, **Ctrl/Cmd + wheel**, **Shift + drag** to pan, **double-click** to reset; emits `zoom` |
| `zoomAutoY` | `boolean` | `true` | When `zoomable`, rescale Y from series values in the visible X window |
| `zoomMinPoints` | `number` | `3` | Minimum points visible along X when zoomed in |
| `xAxisType` | `'category' \| 'time'` | `'category'` | Opt into adaptive time-axis labels |
| `times` | `number[]` | — | Unix ms timestamps aligned with labels/series when `xAxisType="time"` |
| `formatTime` | `(timestamp) => string` | locale date/time | Format time-axis labels and tooltip titles |
| `xAxisMinLabelPx` | `number` | `112` time / `50` category | Minimum horizontal spacing per X label |
| `padding` | `Partial<ChartPadding>` | `{ top: 24, right: 24, bottom: 48, left: 56 }` | Override plot padding, useful for compact previews with hidden axes |
| `linearFromZero` | `boolean` | `true` | Include zero in positive linear Y domains; set `false` for relative trend/detail charts |
| `linearPaddingRatio` | `number` | `0` | Add proportional headroom/footroom to linear Y domains |
| `chrome` | `boolean` | `true` | Card border/shadow/background wrapper styling; set `false` for decorative/sparkline usage embedded in another surface |
| `showTooltip` | `boolean` | `true` | Built-in hover/keyboard-focus cursor tooltip; set `false` when a consumer renders its own |
| `focusable` | `boolean` | `true` | Keyboard focusability/interaction on the SVG root; set `false` for purely decorative charts (removes `tabindex`, adds `aria-hidden`) |

#### Events

| Event | Payload |
|-------|---------|
| `pointClick` | `{ index, label, values: { seriesName, value \| null }[] }` — click near an x index |
| `zoom` | `LineZoomRange` — `{ start, end }` fractional indices along `labels` (`0` … `labels.length - 1`) |

#### Slots

| Slot | Scope | Description |
|------|--------|-------------|
| `empty` | — | Custom content when there is no plottable data |
| `tooltip` | `{ title, items, visible }` | Replace default tooltip body |
| `legend-item` | `{ item, toggle }` | Custom legend row (`toggle` shows/hides the series) |

---

### NardukBarChart

Grouped or stacked bar chart with hover highlighting.

```vue
<script setup lang="ts">
import { NardukBarChart } from '@narduk-enterprises/narduk-charts'

const series = [
  { name: 'Desktop', data: [65, 59, 80, 81, 56] },
  { name: 'Mobile', data: [28, 48, 40, 19, 86] },
]
const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
</script>

<template>
  <NardukBarChart :series="series" :labels="labels" />
  <!-- Stacked mode -->
  <NardukBarChart :series="series" :labels="labels" stacked />
</template>
```

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `series` | `ChartSeries[]` | *required* | `{ name, data, color? }` (`yAxis` is ignored on bar charts) |
| `labels` | `string[]` | *required* | X-axis category labels |
| `width` | `number` | auto | Fixed width in px |
| `height` | `number` | `400` | Chart height in px |
| `stacked` | `boolean` | `false` | Stack bars instead of grouping |
| `colors` | `string[]` | built-in palette | Custom color palette |
| `animate` | `boolean` | `true` | Animate bars growing on mount |
| `barRadius` | `number` | `4` | Border radius on bars |
| `referenceLines` | `ChartReferenceLine[]` | — | Horizontal guides (extends scale when needed) |
| `respectReducedMotion` | `boolean` | `true` | Honor `prefers-reduced-motion` |
| `theme` | `ChartTheme` | `default` | Preset visual theme |
| `dark` | `boolean` | auto-detect | Force dark/light mode |
| `yScale` | `ChartYScaleMode` | `linear` | `linear` · `log` · `symlog` for bar height |
| `symlogLinthresh` | `number` | `1` | Used when `yScale` is `symlog` |
| `yBands` | `ChartYBand[]` | — | Horizontal bands behind bars |
| `annotations` | `ChartLineAnnotation[]` | — | `vline` entries draw vertical guides at category centers |

#### Events

| Event | Payload |
|-------|---------|
| `barClick` | `{ index, label, seriesName, value }` |

#### Slots

Same as line chart: `empty`, `tooltip`, `legend-item`.

---

### NardukPieChart

Pie and donut chart with labels and percentage display.

```vue
<script setup lang="ts">
import { NardukPieChart } from '@narduk-enterprises/narduk-charts'

const data = [
  { label: 'Chrome', value: 65 },
  { label: 'Firefox', value: 15 },
  { label: 'Safari', value: 12 },
  { label: 'Other', value: 8 },
]
</script>

<template>
  <NardukPieChart :data="data" />
  <!-- Donut mode -->
  <NardukPieChart :data="data" donut />
</template>
```

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `PieDataItem[]` | *required* | Array of `{ label, value, color? }` |
| `width` | `number` | auto | Fixed width in px |
| `height` | `number` | `400` | Chart height in px |
| `donut` | `boolean` | `false` | Render as donut chart |
| `innerRadius` | `number` | `0.6` | Inner radius ratio (0–1) for donut |
| `showLabels` | `boolean` | `true` | Show labels on slices |
| `colors` | `string[]` | built-in palette | Custom color palette |
| `animate` | `boolean` | `true` | Animate slices on mount |
| `respectReducedMotion` | `boolean` | `true` | Honor `prefers-reduced-motion` |
| `theme` | `ChartTheme` | `default` | Preset visual theme |
| `dark` | `boolean` | auto-detect | Force dark/light mode |
| `showLegend` | `boolean` | `true` | Render the built-in legend below the chart |
| `showCenterLabel` | `boolean` | `true` | Render the donut center total/label (only when `donut` is also true) |
| `showTooltip` | `boolean` | `true` | Built-in hover/keyboard-focus cursor tooltip |

#### Events

| Event | Payload |
|-------|---------|
| `sliceClick` | `{ label, value, percentage }` |
| `sliceHover` | `index: number \| null` — slice pointer enter (`index`) / leave (`null`) |

#### Slots

Same as line chart: `empty`, `tooltip`, `legend-item`.

## Utilities

### Export (browser only)

`getChartSvgElement(chartRoot)` returns the first `<svg>` inside your chart container. Pass it to:

- **`exportChartSvg(svg, { filename?, embeddedCss? })`** — download SVG.
- **`exportChartPng(svg, { filename?, scale?, embeddedCss? })`** — rasterize to PNG. For fills/strokes that come from CSS classes, pass **`embeddedCss`** (use the **built** stylesheet text from `narduk-charts/style.css` as shipped in `dist/`, not the unpublished source file with `@import` / `@theme` directives).

### Live data helper

**`useStreamingSeries(maxPoints, initial?)`** — `{ values, push, setWindow, clear }` for rolling numeric buffers (see realtime docs on the marketing site).

### Theme class

**`chartThemeClass(theme)`** — maps `ChartTheme` to the CSS module class if you build a custom wrapper.

### Y-axis helpers

**`createYAxisMap(mode, dataValues, extraValues, plotHeight, options?)`** — builds `{ yFromBottom, ticks, domain }` for `linear` / `log` / `symlog` scales (used internally by charts; useful for custom SVG layers).

## Histoire (component stories)

```bash
npm run story:dev
# npm run story:build
```

Stories live under `src/stories/*.story.vue`.

## Types

```ts
type ChartYAxisId = 'primary' | 'secondary'
type ChartYScaleMode = 'linear' | 'log' | 'symlog'

interface ChartSeries {
  name: string
  data: (number | null)[]
  color?: string
  yAxis?: ChartYAxisId
}

type ChartTheme = 'default' | 'high-contrast' | 'print' | 'colorblind-safe'

interface ChartReferenceLine {
  value: number
  label?: string
  color?: string
  dashed?: boolean
  yAxis?: ChartYAxisId
}

interface ChartYBand {
  y0: number
  y1: number
  color?: string
  opacity?: number
  label?: string
  yAxis?: ChartYAxisId
}

type ChartLineAnnotation =
  | { type: 'vline'; xIndex: number; color?: string; dashed?: boolean; label?: string }
  | { type: 'point'; xIndex: number; y: number; color?: string; label?: string; yAxis?: ChartYAxisId }
  | { type: 'label'; xIndex: number; y: number; text: string; color?: string; yAxis?: ChartYAxisId; dx?: number; dy?: number }

interface PieDataItem {
  label: string
  value: number
  color?: string
}
```

## Features

- **Responsive** — omit `width` to fill container; auto-resizes via ResizeObserver (when available)
- **Dark mode** — auto-detects `prefers-color-scheme`, or set `dark` prop explicitly
- **Reduced motion** — respects `prefers-reduced-motion` for entry animations (override per chart with `respectReducedMotion={false}`)
- **Animations** — smooth entry animations: line draw-in, bar growth, pie unfurl
- **Line gaps** — use `null` in `series.data` to split the stroke
- **Area & reference lines** — optional fill under lines and horizontal guide lines on line and bar charts
- **Phase 2 scales** — dual Y-axis on line charts, `log` / `symlog` Y scales, horizontal **bands**, and **annotations** (vertical guides, points, labels); bar charts support alternate Y scales, bands, and vertical guides
- **Click events** — `pointClick`, `barClick`, `sliceClick` for dashboards and drill-down
- **Tooltips** — hover to see values; auto-flips near edges
- **Legends** — click to toggle series visibility; scales recalculate automatically
- **Zero dependencies** — only requires Vue 3 as a peer dependency

## Local development

```bash
npm install
npm run dev
```

Runs **Histoire** with library stories (same as `npm run story:dev`). For full-page examples, AAPL stream demos, and showcase routes, use the companion **marketing site** repository.

```bash
npm test
```

Runs Vitest (math, y-scale helpers, streaming composable).

```bash
npm run story:build
```

Produces a static Histoire build (optional).

## License

MIT
