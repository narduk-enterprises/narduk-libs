# NardukCharts

**NardukCharts** is the product name for this Vue 3 SVG charting
stack—TypeScript-first, themeable, accessible, built without D3 or Chart.js.

**npm package:**
[`@narduk-enterprises/narduk-charts`](https://github.com/narduk-enterprises/narduk-libs/tree/main/packages/design/narduk-charts)
(published to **GitHub Packages**; not the public npm registry).

**Companion marketing site** (broader Narduk narrative, enterprise pages, SEO):
[charts.nard.uk](https://charts.nard.uk)

**Source:** this package directory in
[narduk-libs](https://github.com/narduk-enterprises/narduk-libs) holds the
library source, tests, markdown API notes (`docs/`), and **Histoire** component
stories (`pnpm --filter @narduk-enterprises/narduk-charts run dev`). Runnable
demos and flagship examples live on the companion **charts** site. The former
standalone `narduk-enterprises/narduk-charts` repository is retired; it
published its last release, 2.6.0, on 2026-09-23, and narduk-libs carries
everything in it.

## Install

```bash
npm install @narduk-enterprises/narduk-charts
```

For private org packages, configure the `@narduk-enterprises` scope to **GitHub
Packages** (`@narduk-enterprises:registry=https://npm.pkg.github.com`) and
authenticate with a GitHub token that has `read:packages`.

## Publishing

narduk-libs publishes this package with the rest of the monorepo, through
Changesets and the repository's release workflow. There is no per-package tag or
publish workflow. See [docs/RELEASE.md](./docs/RELEASE.md).

## Setup

Import the CSS once in your app entry:

```ts
import '@narduk-enterprises/narduk-charts/style.css'
```

### Theming (Tailwind v4 tokens)

The bundled `style.css` is compiled with **Tailwind CSS v4**. Semantic colors
are **`--color-chart-*`** variables (declared on `:root` / `:host`, and
overridden on `.narduk-chart--dark` and preset `theme` classes).

| Token                              | Used for                            |
| ---------------------------------- | ----------------------------------- |
| `--color-chart-text`               | Primary text, pie labels            |
| `--color-chart-muted`              | Axis labels, secondary text         |
| `--color-chart-grid`               | Grid lines, crosshair, legend hover |
| `--color-chart-axis`               | Axis lines                          |
| `--color-chart-surface`            | Point/outline contrast (e.g. halos) |
| `--color-chart-accent`             | Default band / zoom box accent      |
| `--color-chart-tooltip-bg`         | Tooltip background                  |
| `--color-chart-tooltip-foreground` | Tooltip text                        |
| `--color-chart-tooltip-border`     | Tooltip border                      |
| `--color-chart-series-1` … `-10`   | Categorical series palette          |

#### Series palette

The ten `--color-chart-series-*` tokens are the categorical palette. Every chart
resolves an unstyled series to `var(--color-chart-series-N)`, so overriding the
token repaints the data — and so each preset `theme` can carry its own palette.
Passing an explicit `colors` prop bypasses the tokens entirely.

```css
/* Recolour every chart in the app, in every theme that doesn't override it. */
:root {
  --color-chart-series-1: var(--color-brand-600);
  --color-chart-series-2: var(--color-brand-400);
}
```

Each token also carries a literal fallback
(`var(--color-chart-series-1, oklch(…))`) so a chart still renders in the
default palette where the stylesheet isn't present — most importantly in a
standalone `exportChartSvg` file.

**Tailwind app:** extend your design system in global CSS (after
`@import "tailwindcss"`):

```css
@theme {
  --color-chart-text: var(--color-slate-900);
  --color-chart-muted: var(--color-slate-500);
  --color-chart-grid: var(--color-slate-200);
  --color-chart-axis: var(--color-slate-300);
  --color-chart-accent: var(--color-violet-500);
  --color-chart-series-1: var(--color-indigo-500);
}
```

**Any stack:** set variables on a wrapper so they inherit into the chart, or
override `:root` after importing `narduk-charts/style.css`.

> **Note:** Older releases used `--nc-*` variables; those are replaced by
> `--color-chart-*`.

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

Default time-axis labels used to follow the host locale and zone. They are now
pinned to `en-US` / UTC with a 12-hour clock. Pass `timeZone` (IANA) for local
labels, or `formatTime` to own the string.

#### Props

| Prop                              | Type                    | Default                                        | Description                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ----------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `series`                          | `ChartSeries[]`         | _required_                                     | `{ name, data, color?, yAxis?, spanGaps?, mode?, marker?, opacity?, showValues?, formatValue? }` — use `yAxis: 'secondary'` with `dualYAxis`; see **Sparse and point-only series** below                                                                                                                            |
| `labels`                          | `string[]`              | _required_                                     | X-axis labels                                                                                                                                                                                                                                                                                                       |
| `width`                           | `number`                | auto                                           | Fixed width in px (responsive if omitted)                                                                                                                                                                                                                                                                           |
| `height`                          | `number`                | `400`                                          | Chart height in px                                                                                                                                                                                                                                                                                                  |
| `smooth`                          | `boolean`               | `true`                                         | Catmull-Rom curve smoothing                                                                                                                                                                                                                                                                                         |
| `showGrid`                        | `boolean`               | `true`                                         | Show horizontal grid lines                                                                                                                                                                                                                                                                                          |
| `showPoints`                      | `boolean`               | `false`                                        | Always show data points                                                                                                                                                                                                                                                                                             |
| `showIsolatedPoints`              | `boolean`               | `true`                                         | Draw a marker for a value whose neighbours on both sides are `null`. Such a value has no line to belong to, so without this it renders as nothing at all. Ignored when `showPoints` already draws every value                                                                                                       |
| `pointRadius`                     | `number`                | `3`                                            | Radius (px) of `showPoints` / isolated-value markers                                                                                                                                                                                                                                                                |
| `showArea`                        | `boolean`               | `false`                                        | Fill area under each line to the plot bottom                                                                                                                                                                                                                                                                        |
| `showXAxis`                       | `boolean`               | `true`                                         | Draw the X axis line and its tick labels                                                                                                                                                                                                                                                                            |
| `showYAxis`                       | `boolean`               | `true`                                         | Draw the Y axis line(s) and their tick labels                                                                                                                                                                                                                                                                       |
| `showLegend`                      | `boolean`               | `true`                                         | Render the legend. `chrome: false` does not reach it; set `false` when the surrounding surface already names the series                                                                                                                                                                                             |
| `yMin` / `yMax`                   | `number`                | —                                              | Pin the primary Y domain. Either end may be given alone. The value is used **exactly** — it is not rounded out to a nice tick — so charts handed the same bound share one scale to the pixel                                                                                                                        |
| `yMinSecondary` / `yMaxSecondary` | `number`                | —                                              | The same pins for the right-hand scale under `dualYAxis`                                                                                                                                                                                                                                                            |
| `yTickCount`                      | `number`                | `6`                                            | Y tick / gridline count, clamped to 2–12                                                                                                                                                                                                                                                                            |
| `volume`                          | `(number \| null)[]`    | —                                              | Volume values aligned index-for-index with `labels`. Applies to `series[0]` only in multi-series charts (documented, no runtime warning). Omit to leave rendering unchanged                                                                                                                                         |
| `showVolume`                      | `boolean`               | `false`                                        | Render a bottom volume histogram pane when `volume` has data—mirrors `NardukCandleChart`'s volume pane sizing, bar styling, and bull/bear coloring. Bars decimate/window identically to the plotted series (same `maxRenderPoints` index pipeline), so they stay aligned under downsampling and `zoomable` pan/zoom |
| `volumeFraction`                  | `number`                | `0.22`                                         | Fraction of plot height reserved for the volume pane when `showVolume` is set (clamped 0.12–0.45, same semantics as `NardukCandleChart`)                                                                                                                                                                            |
| `referenceLines`                  | `ChartReferenceLine[]`  | —                                              | Horizontal guides; optional `yAxis` when `dualYAxis`; right-side labels stack when close together                                                                                                                                                                                                                   |
| `colors`                          | `string[]`              | built-in palette                               | Custom color palette                                                                                                                                                                                                                                                                                                |
| `animate`                         | `boolean`               | `true`                                         | Animate line draw-in on mount                                                                                                                                                                                                                                                                                       |
| `respectReducedMotion`            | `boolean`               | `true`                                         | Honor `prefers-reduced-motion` for animations                                                                                                                                                                                                                                                                       |
| `theme`                           | `ChartTheme`            | `default`                                      | `high-contrast`, `print`, `colorblind-safe`                                                                                                                                                                                                                                                                         |
| `dark`                            | `boolean`               | auto-detect                                    | Force dark/light mode                                                                                                                                                                                                                                                                                               |
| `dualYAxis`                       | `boolean`               | `false`                                        | Right-hand Y scale for `series` with `yAxis: 'secondary'`                                                                                                                                                                                                                                                           |
| `yScale`                          | `ChartYScaleMode`       | `linear`                                       | `linear` · `log` (positive values) · `symlog`                                                                                                                                                                                                                                                                       |
| `yScaleSecondary`                 | `ChartYScaleMode`       | `linear`                                       | Right axis scale when `dualYAxis`                                                                                                                                                                                                                                                                                   |
| `symlogLinthresh`                 | `number`                | `1`                                            | Linear threshold for `symlog`                                                                                                                                                                                                                                                                                       |
| `yBands`                          | `ChartYBand[]`          | —                                              | Horizontal bands (`y0`, `y1`, optional `color`, `opacity`, `yAxis`)                                                                                                                                                                                                                                                 |
| `annotations`                     | `ChartLineAnnotation[]` | —                                              | `vline`, `point`, or `label` markers; `point` takes `ring: true` for a ringed marker                                                                                                                                                                                                                                |
| `zoomable`                        | `boolean`               | `false`                                        | X zoom: **drag** a box on the plot, **Ctrl/Cmd + wheel**, **Shift + drag** to pan, **double-click** to reset; emits `zoom`                                                                                                                                                                                          |
| `zoomAutoY`                       | `boolean`               | `true`                                         | When `zoomable`, rescale Y from series values in the visible X window                                                                                                                                                                                                                                               |
| `zoomMinPoints`                   | `number`                | `3`                                            | Minimum points visible along X when zoomed in                                                                                                                                                                                                                                                                       |
| `xAxisType`                       | `'category' \| 'time'`  | `'category'`                                   | Opt into adaptive time-axis labels                                                                                                                                                                                                                                                                                  |
| `times`                           | `number[]`              | —                                              | Unix ms timestamps aligned with labels/series when `xAxisType="time"`                                                                                                                                                                                                                                               |
| `formatTime`                      | `(timestamp) => string` | `en-US` / `timeZone`                           | Override time-axis labels and tooltip titles. The default is pinned `en-US` in `timeZone` (default `'UTC'`), never the host locale or zone                                                                                                                                                                          |
| `timeZone`                        | `string`                | `'UTC'`                                        | IANA zone for the default time-axis labels. Ignored when `formatTime` is set. Required for SSR: workerd is UTC, the browser is the reader's zone                                                                                                                                                                    |
| `xAxisMinLabelPx`                 | `number`                | `112` time / `50` category                     | Minimum horizontal spacing per X label                                                                                                                                                                                                                                                                              |
| `xTickIndices`                    | `number[]`              | —                                              | Label exactly these category indices (e.g. month starts on a day-of-year axis); ticks closer than `xAxisMinLabelPx` (default `36` here) to the previous one are skipped                                                                                                                                             |
| `padding`                         | `Partial<ChartPadding>` | `{ top: 24, right: 24, bottom: 48, left: 56 }` | Override plot padding, useful for compact previews with hidden axes                                                                                                                                                                                                                                                 |
| `linearFromZero`                  | `boolean`               | `true`                                         | Include zero in positive linear Y domains; set `false` for relative trend/detail charts                                                                                                                                                                                                                             |
| `linearPaddingRatio`              | `number`                | `0`                                            | Add proportional headroom/footroom to linear Y domains                                                                                                                                                                                                                                                              |
| `chrome`                          | `boolean`               | `true`                                         | Card border/shadow/background wrapper styling; set `false` for decorative/sparkline usage embedded in another surface                                                                                                                                                                                               |
| `showTooltip`                     | `boolean`               | `true`                                         | Built-in hover/keyboard-focus cursor tooltip; set `false` when a consumer renders its own                                                                                                                                                                                                                           |
| `focusable`                       | `boolean`               | `true`                                         | Keyboard focusability/interaction on the SVG root; set `false` for purely decorative charts (removes `tabindex`, adds `aria-hidden`)                                                                                                                                                                                |

#### Events

| Event        | Payload                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `pointClick` | `{ index, label, values: { seriesName, value \| null }[] }` — click near an x index              |
| `zoom`       | `LineZoomRange` — `{ start, end }` fractional indices along `labels` (`0` … `labels.length - 1`) |

#### Slots

| Slot          | Scope                       | Description                                         |
| ------------- | --------------------------- | --------------------------------------------------- |
| `empty`       | —                           | Custom content when there is no plottable data      |
| `tooltip`     | `{ title, items, visible }` | Replace default tooltip body                        |
| `legend-item` | `{ item, toggle }`          | Custom legend row (`toggle` shows/hides the series) |

#### Recipe: sparkline

A trend mark small enough to sit inside a tile whose surrounding markup already
carries the label, the value and the scale legend. `chrome: false` drops the
card wrapper, `showXAxis` / `showYAxis` drop the axis lines **and** their tick
labels, and `padding` reclaims the gutters they were holding.

```vue
<NardukLineChart
  :series="[{ name: domain, data }]"
  :labels="labels"
  :height="46"
  :y-min="0"
  :y-max="gridMax"
  :padding="{ top: 4, right: 4, bottom: 4, left: 4 }"
  :chrome="false"
  :show-x-axis="false"
  :show-y-axis="false"
  :show-legend="false"
  :show-grid="false"
  :show-tooltip="false"
  :smooth="false"
  :point-radius="1.5"
  :chart-title="`${domain}: ${value}`"
/>
```

`yMax` is the load-bearing prop when a **grid** of these is drawn together.
Without it each tile derives its own domain, so a property with four events and
one with four thousand draw the same shape and the set reads as unrelated
pictures wearing a shared layout. Compute the maximum once across the whole grid
and hand every tile the same number.

Pair it with a `null` per missing entry rather than a compacted array: `null`
breaks the line where the data breaks, and `showIsolatedPoints` (on by default)
draws the values that end up with no measured neighbour, which would otherwise
be invisible.

When the tile only needs an SVG `path` — no Vue chart, no CSS — import
`sparkAxis`, `sparkPath`, and `trailingSparkWindow` from
`@narduk-enterprises/narduk-charts/spark`. `sparkAxis` picks a Y domain,
`sparkPath` turns a series into a `d` string, and `trailingSparkWindow` keeps
the last 24h / 7d / 30d of `{ t }` samples. Pass those timestamps as `times` so
X follows `t` instead of array index. The window helper keeps input order; sort
by `t` first if the feed is unsorted.

```ts
import {
  sparkAxis,
  sparkPath,
  trailingSparkWindow,
} from '@narduk-enterprises/narduk-charts/spark'

const windowed = trailingSparkWindow(samples, '24h')
const values = windowed.map(point => point.v)
const times = windowed.map(point => point.t)
const d = sparkPath(values, 80, 24, {
  axis: sparkAxis(values),
  times,
})
```

#### Sparse and point-only series

Per-series options (line chart only; all opt-in):

| Field                        | Type                                   | Default                     | Description                                                                                                                                                                                          |
| ---------------------------- | -------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spanGaps`                   | `boolean \| number`                    | —                           | Join values across `null`s. `true` bridges every gap; a number bridges only when the two values are at most that many label slots apart (`40` on a day-of-year axis never draws across a longer gap) |
| `mode`                       | `'line' \| 'points'`                   | `'line'`                    | `'points'` draws a marker per value and no line or area                                                                                                                                              |
| `marker`                     | `{ radius?, filled? }`                 | chart `pointRadius`, filled | `filled: false` draws a ring in the series colour over the plot background                                                                                                                           |
| `opacity`                    | `number`                               | `1`                         | Opacity for everything the series draws                                                                                                                                                              |
| `showValues` / `formatValue` | `boolean` / `(value, index) => string` | —                           | Always-visible value text above each point                                                                                                                                                           |

```vue
<NardukLineChart
  :labels="dayOfYearLabels"
  :series="[
    { name: '2024', data: clear, spanGaps: 40, color: 'var(--farm-accent)' },
    {
      name: '2024 cloudy',
      data: cloudy,
      mode: 'points',
      marker: { filled: false, radius: 2.5 },
      opacity: 0.5,
    },
  ]"
  :annotations="[
    {
      type: 'point',
      xIndex: peakDay - 1,
      y: peak,
      ring: true,
      color: 'var(--farm-accent)',
      label: 'Peak',
    },
  ]"
  :x-tick-indices="[0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]"
  :y-min="0"
  :y-max="0.8"
  :y-tick-count="5"
/>
```

Colours may be CSS custom properties. A hollow marker's or ring's colour is set
on the element's `style`, so it outranks the stylesheet's marker stroke.

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

| Prop                      | Type                    | Default          | Description                                                                                   |
| ------------------------- | ----------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `series`                  | `ChartSeries[]`         | _required_       | `{ name, data, color? }` (`yAxis` is ignored on bar charts)                                   |
| `labels`                  | `string[]`              | _required_       | X-axis category labels                                                                        |
| `width`                   | `number`                | auto             | Fixed width in px                                                                             |
| `height`                  | `number`                | `400`            | Chart height in px                                                                            |
| `stacked`                 | `boolean`               | `false`          | Stack bars instead of grouping                                                                |
| `colors`                  | `string[]`              | built-in palette | Custom color palette                                                                          |
| `animate`                 | `boolean`               | `true`           | Animate bars growing on mount                                                                 |
| `barRadius`               | `number`                | `4`              | Border radius on bars                                                                         |
| `referenceLines`          | `ChartReferenceLine[]`  | —                | Horizontal guides (extends scale when needed)                                                 |
| `respectReducedMotion`    | `boolean`               | `true`           | Honor `prefers-reduced-motion`                                                                |
| `theme`                   | `ChartTheme`            | `default`        | Preset visual theme                                                                           |
| `dark`                    | `boolean`               | auto-detect      | Force dark/light mode                                                                         |
| `yScale`                  | `ChartYScaleMode`       | `linear`         | `linear` · `log` · `symlog` for bar height                                                    |
| `symlogLinthresh`         | `number`                | `1`              | Used when `yScale` is `symlog`                                                                |
| `yBands`                  | `ChartYBand[]`          | —                | Horizontal bands behind bars                                                                  |
| `annotations`             | `ChartLineAnnotation[]` | —                | `vline` entries draw vertical guides at category centers                                      |
| `yMin` / `yMax`           | `number`                | —                | Pin the value-axis domain; either end alone, used exactly                                     |
| `showXAxis` / `showYAxis` | `boolean`               | `true`           | Draw the bottom / left axis line and labels (whichever role it carries in the orientation)    |
| `showGrid`                | `boolean`               | `true`           | Draw the value gridlines                                                                      |
| `showLegend`              | `boolean`               | `true`           | Render the legend                                                                             |
| `padding`                 | `Partial<ChartPadding>` | —                | Override chart padding, e.g. `{ top: 0, right: 0, bottom: 0, left: 0 }` for a thin inline bar |

#### Events

| Event      | Payload                               |
| ---------- | ------------------------------------- |
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

| Prop                   | Type            | Default          | Description                                                          |
| ---------------------- | --------------- | ---------------- | -------------------------------------------------------------------- |
| `data`                 | `PieDataItem[]` | _required_       | Array of `{ label, value, color? }`                                  |
| `width`                | `number`        | auto             | Fixed width in px                                                    |
| `height`               | `number`        | `400`            | Chart height in px                                                   |
| `donut`                | `boolean`       | `false`          | Render as donut chart                                                |
| `innerRadius`          | `number`        | `0.6`            | Inner radius ratio (0–1) for donut                                   |
| `showLabels`           | `boolean`       | `true`           | Show labels on slices                                                |
| `colors`               | `string[]`      | built-in palette | Custom color palette                                                 |
| `animate`              | `boolean`       | `true`           | Animate slices on mount                                              |
| `respectReducedMotion` | `boolean`       | `true`           | Honor `prefers-reduced-motion`                                       |
| `theme`                | `ChartTheme`    | `default`        | Preset visual theme                                                  |
| `dark`                 | `boolean`       | auto-detect      | Force dark/light mode                                                |
| `showLegend`           | `boolean`       | `true`           | Render the built-in legend below the chart                           |
| `showCenterLabel`      | `boolean`       | `true`           | Render the donut center total/label (only when `donut` is also true) |
| `showTooltip`          | `boolean`       | `true`           | Built-in hover/keyboard-focus cursor tooltip                         |

#### Events

| Event        | Payload                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `sliceClick` | `{ label, value, percentage }`                                           |
| `sliceHover` | `index: number \| null` — slice pointer enter (`index`) / leave (`null`) |

#### Slots

Same as line chart: `empty`, `tooltip`, `legend-item`.

---

### NardukScatterChart

Numeric X/Y scatter plot with per-point click and keyboard activation.

```vue
<script setup lang="ts">
import { NardukScatterChart } from '@narduk-enterprises/narduk-charts'

const series = [
  {
    name: 'Cohort A',
    points: [
      { x: 1, y: 4 },
      { x: 2, y: 7 },
      { x: 3, y: 5 },
    ],
  },
]
</script>

<template>
  <NardukScatterChart :series="series" chart-title="Cohort A" />
</template>
```

#### Props

| Prop                   | Type              | Default          | Description                                                                             |
| ---------------------- | ----------------- | ---------------- | --------------------------------------------------------------------------------------- |
| `series`               | `ScatterSeries[]` | _required_       | `{ name, points: { x, y, label? }[], color? }`                                          |
| `width`                | `number`          | auto             | Fixed width in px (responsive if omitted)                                               |
| `height`               | `number`          | `400`            | Chart height in px                                                                      |
| `pointRadius`          | `number`          | `4`              | Point radius in px                                                                      |
| `colors`               | `string[]`        | built-in palette | Custom color palette, applied per series when no per-series `color` is set              |
| `animate`              | `boolean`         | `true`           | Animate points growing in on mount                                                      |
| `respectReducedMotion` | `boolean`         | `true`           | Honor `prefers-reduced-motion`                                                          |
| `theme`                | `ChartTheme`      | `default`        | Preset visual theme                                                                     |
| `dark`                 | `boolean`         | auto-detect      | Force dark/light mode                                                                   |
| `dir`                  | `'ltr' \| 'rtl'`  | —                | Text direction on the chart root                                                        |
| `chartTitle`           | `string`          | generated        | Visible caption and accessible name; falls back to a generated `Scatter chart: …` label |
| `chartDescription`     | `string`          | —                | Longer accessible description (`<desc>` + `aria-describedby`)                           |

#### Events

| Event        | Payload                                                               |
| ------------ | --------------------------------------------------------------------- |
| `pointClick` | `{ pointIndex, seriesName, x, y }` — click, Enter or Space on a point |

#### Slots

None.

---

### NardukHistogramChart

Histogram from raw samples (auto-binned) or explicit bins.

```vue
<script setup lang="ts">
import { NardukHistogramChart } from '@narduk-enterprises/narduk-charts'

const values = [12, 15, 14, 18, 22, 19, 25, 30, 28, 21]
</script>

<template>
  <NardukHistogramChart
    :values="values"
    :bin-count="6"
    chart-title="Response times"
  />
</template>
```

#### Props

| Prop                   | Type             | Default            | Description                                                                                      |
| ---------------------- | ---------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| `values`               | `number[]`       | _required_         | Raw samples; gates the empty state even when `bins` is also given                                |
| `bins`                 | `HistogramBin[]` | —                  | Explicit `{ start, end, count }[]`; overrides `binCount`/`values`-derived binning when non-empty |
| `binCount`             | `number`         | `8`                | Bin count for auto-binning `values`; ignored once `bins` is set                                  |
| `barColor`             | `string`         | chart accent token | Bar fill color                                                                                   |
| `width`                | `number`         | auto               | Fixed width in px (responsive if omitted)                                                        |
| `height`               | `number`         | `400`              | Chart height in px                                                                               |
| `animate`              | `boolean`        | `true`             | Animate bars growing in on mount                                                                 |
| `respectReducedMotion` | `boolean`        | `true`             | Honor `prefers-reduced-motion`                                                                   |
| `theme`                | `ChartTheme`     | `default`          | Preset visual theme                                                                              |
| `dark`                 | `boolean`        | auto-detect        | Force dark/light mode                                                                            |
| `dir`                  | `'ltr' \| 'rtl'` | —                  | Text direction on the chart root                                                                 |
| `chartTitle`           | `string`         | generated          | Visible caption and accessible name; falls back to a generated `Histogram, N bins` label         |
| `chartDescription`     | `string`         | —                  | Longer accessible description (`<desc>` + `aria-describedby`)                                    |

#### Events

None.

#### Slots

None.

---

### NardukCandleChart

OHLCV candlestick chart: zoom/pan/box/pinch, volume pane, brush navigator,
crosshair, drawings, and multi-chart domain sync via `v-model:domain`.

```vue
<script setup lang="ts">
import { NardukCandleChart } from '@narduk-enterprises/narduk-charts'

const bars = [
  { t: 1_700_000_000_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 1200 },
  { t: 1_700_003_600_000, o: 1.5, h: 2.5, l: 1.2, c: 2, v: 900 },
]
</script>

<template>
  <NardukCandleChart :bars="bars" chart-title="AAPL" zoomable show-volume />
</template>
```

#### Props

| Prop                                             | Type                                        | Default                     | Description                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `bars`                                           | `CandleBar[]`                               | _required_                  | `{ t, o, h, l, c, v? }[]`                                                                                                      |
| `width` / `height`                               | `number`                                    | auto / `400`                | Fixed size in px (responsive width if omitted)                                                                                 |
| `domain`                                         | `CandleTimeDomain \| null`                  | —                           | Controlled visible time window (ms); pair with `v-model:domain` to sync multiple charts (see `NardukChartStack`)               |
| `zoomable`                                       | `boolean`                                   | `false`                     | Drag-box / Ctrl-or-Cmd+wheel / Shift+drag-pan / double-click-reset zoom; emits `zoom` and `update:domain`                      |
| `zoomWheelFree` / `zoomMinPoints`                | `boolean` / `number`                        | `false` / `3`               | Free (non-modified) wheel zoom; minimum visible bars when zoomed in                                                            |
| `showVolume` / `volumeFraction`                  | `boolean` / `number`                        | `false` / `0.22`            | Bottom volume pane and its plot-height fraction                                                                                |
| `showBrush`                                      | `boolean`                                   | `false`                     | Time navigator strip under the plot                                                                                            |
| `showCrosshair` / `crosshairMagnetic`            | `boolean`                                   | `true` / `true`             | Pointer crosshair; magnetic snap to the hovered bar's X                                                                        |
| `showLastPrice` / `showCloseLine`                | `boolean`                                   | `true` / `true`             | Latest-close axis line/label; faint close-price polyline across the window                                                     |
| `showSessionGrid`                                | `boolean`                                   | `false`                     | Faint verticals when the UTC hour/day changes between bars                                                                     |
| `showOhlcHud`                                    | `boolean`                                   | `true`                      | Top-left OHLC panel while hovering/focusing a bar                                                                              |
| `showGrid`                                       | `boolean`                                   | `true`                      | Horizontal gridlines                                                                                                           |
| `candleStyle`                                    | `CandleBarStyle`                            | `'candle'`                  | `candle` (filled body) · hollow (bull outline) · OHLC bar ticks                                                                |
| `bullColor` / `bearColor`                        | `string`                                    | theme default               | Up/down candle colors                                                                                                          |
| `yScale` / `symlogLinthresh`                     | `ChartYScaleMode` / `number`                | `'linear'` / `1`            | `linear` · `log` · `symlog`; linear threshold used when `symlog`                                                               |
| `priceDisplayMode`                               | `CandlePriceDisplayMode`                    | `'absolute'`                | Rebase OHLC into `%`/indexed units (forces linear Y)                                                                           |
| `yPadFraction`                                   | `number`                                    | `0.06`                      | Extra Y padding as a fraction of visible high−low                                                                              |
| `highlightFormingBar`                            | `boolean`                                   | `false`                     | Emphasize the rightmost (forming) bucket in the visible window                                                                 |
| `maxDrawBars`                                    | `number`                                    | `512`                       | Cap drawn buckets from the visible window (aggregation)                                                                        |
| `drawings` / `drawingTool`                       | `CandleDrawing[]` / `CandleDrawingTool`     | `[]` / `null`               | Serializable price/time overlays; setting a tool turns plot-drag into drawing instead of zoom                                  |
| `formatPrice` / `formatTickValue` / `formatTime` | `(value) => string`                         | built-in                    | Override OHLC/HUD, axis-tick and time-label formatting                                                                         |
| `timeZone`                                       | `string`                                    | `'UTC'`                     | IANA zone for the default time-axis labels (`en-US`). Ignored when `formatTime` is set                                         |
| `animate` / `respectReducedMotion`               | `boolean`                                   | `true` / `true`             | Animate on mount; honor `prefers-reduced-motion`                                                                               |
| `theme` / `dark` / `dir`                         | `ChartTheme` / `boolean` / `'ltr' \| 'rtl'` | `default` / auto-detect / — | Preset theme; force dark/light mode; text direction                                                                            |
| `chartTitle` / `chartDescription`                | `string`                                    | generated / —               | Visible caption + accessible name (falls back to a generated `Candlestick chart, N bars` label); longer accessible description |

#### Events

| Event             | Payload                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `barClick`        | `CandleClickPayload` — click/activate a bar                                                           |
| `zoom`            | `CandleZoomRange` — visible range after a zoom/pan gesture                                            |
| `update:domain`   | `CandleTimeDomain` — visible window changed (zoom/pan, or brush drag)                                 |
| `update:drawings` | `CandleDrawing[]` — a drawing was added/edited via `drawingTool`                                      |
| `reachedStart`    | `CandleReachedStartPayload` — the visible domain neared the earliest loaded bar (left-edge load-more) |

#### Slots

| Slot      | Scope         | Description                                                                            |
| --------- | ------------- | -------------------------------------------------------------------------------------- |
| `empty`   | —             | Custom content when `bars` is empty (default: `No data`)                               |
| `overlay` | `{ metrics }` | Draw custom overlays in plot pixel space via `getCandlePlotMetrics()`-shaped `metrics` |

---

### NardukChartStack

Layout wrapper that links multiple panes (typically a `NardukCandleChart` and
companion `NardukLineChart`/volume rows) to one shared visible time window.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import {
  NardukChartStack,
  NardukCandleChart,
  type CandleTimeDomain,
} from '@narduk-enterprises/narduk-charts'

const domain = ref<CandleTimeDomain | null>(null)
const bars = [
  { t: 1_700_000_000_000, o: 1, h: 2, l: 0.5, c: 1.5 },
  { t: 1_700_003_600_000, o: 1.5, h: 2.5, l: 1.2, c: 2 },
]
</script>

<template>
  <NardukChartStack v-model:domain="domain">
    <NardukCandleChart :bars="bars" v-model:domain="domain" zoomable />
  </NardukChartStack>
</template>
```

Bind the same `v-model:domain` on `NardukChartStack` and on each child chart
(`NardukCandleChart`); derive `NardukLineChart` rows' `v-model:x-window` from
that shared domain via `candleIndexAtTime` / `candleTimeAtIndex`.

#### Props

| Prop     | Type                       | Default | Description                                               |
| -------- | -------------------------- | ------- | --------------------------------------------------------- |
| `domain` | `CandleTimeDomain \| null` | `null`  | The linked visible time window; use with `v-model:domain` |

#### Events

| Event           | Payload                                                           |
| --------------- | ----------------------------------------------------------------- |
| `update:domain` | `CandleTimeDomain \| null` — standard `v-model` sync for `domain` |

#### Slots

| Slot      | Scope                     | Description                                                                                                                                                |
| --------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default` | `{ domain, domainModel }` | Both keys expose the current `domain` value (read-only via the slot; write through each child chart's own `v-model:domain` bound to the same external ref) |

---

### NardukBrandBackdrop

Optional full-bleed decorative SVG hero/marketing layer — grid, trend polylines,
and candle hints on a fixed 1200×640 canvas. Reads `--color-chart-*` CSS
variables so it tracks app theming; no bitmap assets. Takes no props and renders
no interactive content (`aria-hidden="true"`).

```vue
<script setup lang="ts">
import { NardukBrandBackdrop } from '@narduk-enterprises/narduk-charts'
</script>

<template>
  <section class="relative overflow-hidden">
    <NardukBrandBackdrop />
    <div class="relative z-10"><!-- hero content --></div>
  </section>
</template>
```

Absolutely positioned and inset to fill its nearest positioned ancestor
(`position: relative` on the wrapping section, as above) — pair it with `z-10`+
content so the backdrop stays behind.

#### Props

None.

#### Events

None.

#### Slots

None.

## Utilities

### Export (browser only)

`getChartSvgElement(chartRoot)` returns the first `<svg>` inside your chart
container. Pass it to:

- **`exportChartSvg(svg, { filename?, embeddedCss? })`** — download SVG.
- **`exportChartPng(svg, { filename?, scale?, embeddedCss? })`** — rasterize to
  PNG. For fills/strokes that come from CSS classes, pass **`embeddedCss`** (use
  the **built** stylesheet text from `narduk-charts/style.css` as shipped in
  `dist/`, not the unpublished source file with `@import` / `@theme`
  directives).

### Live data helper

**`useStreamingSeries(maxPoints, initial?)`** —
`{ values, push, setWindow, clear }` for rolling numeric buffers (see realtime
docs on the marketing site).

### Theme class

**`chartThemeClass(theme)`** — maps `ChartTheme` to the CSS module class if you
build a custom wrapper.

### Y-axis helpers

**`createYAxisMap(mode, dataValues, extraValues, plotHeight, options?)`** —
builds `{ yFromBottom, ticks, domain }` for `linear` / `log` / `symlog` scales
(used internally by charts; useful for custom SVG layers).

### Micro-sparkline helpers

DOM-free path helpers for KPI / marine tiles that draw their own `<path>`:

- **`sparkAxis(values, options?)`** — Y domain. Non-negative series whose floor
  sits close to zero pin `min` at 0 (`fromZero`); tight bands far from zero stay
  `linear`. Override with `mode` / `padRatio` (default `0.08`).
- **`sparkPath(values, width, height, options?)`** — SVG path `d`. Null / NaN
  break the line. Default `inset` is `1` so a 1px stroke is not clipped. Pass
  `times` (same length as `values`) to space X by timestamp; otherwise X is
  index-spaced.
- **`trailingSparkWindow(points, window, now?)`** — keep `{ t }` samples in the
  last `24h` / `7d` / `30d`. When `now` is omitted, the latest finite `t` is the
  window end so a stale station still shows its own last window. Preserves input
  order.
- **`SPARK_WINDOWS`**, **`SPARK_WINDOW_MS`**, **`sparkWindowMs(window)`** — the
  three inclusive trailing windows.

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
  // NardukLineChart only:
  spanGaps?: boolean | number
  mode?: 'line' | 'points'
  marker?: { radius?: number; filled?: boolean }
  opacity?: number
  showValues?: boolean
  formatValue?: (value: number, index: number) => string
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
  | {
      type: 'vline'
      xIndex: number
      color?: string
      dashed?: boolean
      label?: string
    }
  | {
      type: 'point'
      xIndex: number
      y: number
      color?: string
      label?: string
      yAxis?: ChartYAxisId
      radius?: number
      ring?: boolean
    }
  | {
      type: 'label'
      xIndex: number
      y: number
      text: string
      color?: string
      yAxis?: ChartYAxisId
      dx?: number
      dy?: number
    }

interface PieDataItem {
  label: string
  value: number
  color?: string
}
```

## Features

- **Responsive** — omit `width` to fill container; auto-resizes via
  ResizeObserver (when available)
- **Dark mode** — auto-detects `prefers-color-scheme`, or set `dark` prop
  explicitly
- **Reduced motion** — respects `prefers-reduced-motion` for entry animations
  (override per chart with `respectReducedMotion={false}`)
- **Animations** — smooth entry animations: line draw-in, bar growth, pie unfurl
- **Line gaps** — use `null` in `series.data` to split the stroke
- **Area & reference lines** — optional fill under lines and horizontal guide
  lines on line and bar charts
- **Phase 2 scales** — dual Y-axis on line charts, `log` / `symlog` Y scales,
  horizontal **bands**, and **annotations** (vertical guides, points, labels);
  bar charts support alternate Y scales, bands, and vertical guides
- **Click events** — `pointClick`, `barClick`, `sliceClick` for dashboards and
  drill-down
- **Tooltips** — hover to see values; auto-flips near edges
- **Legends** — click to toggle series visibility; scales recalculate
  automatically
- **Zero dependencies** — only requires Vue 3 as a peer dependency

## Local development

```bash
npm install
npm run dev
```

Runs **Histoire** with library stories (same as `npm run story:dev`). For
full-page examples, AAPL stream demos, and showcase routes, use the companion
**marketing site** repository.

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
