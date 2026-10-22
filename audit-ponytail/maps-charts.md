What this repo does: `@narduk-enterprises/narduk-maps` draws one regional map two ways. An SVG poster renders on the server. An optional MapLibre map fades in over it and is meant to share the same projection, tokens, and mark shapes. `@narduk-enterprises/narduk-charts` is a Vue 3 SVG chart kit for dashboards and trading screens: line, bar, pie, scatter, histogram, and OHLC candles, plus SMA, EMA, VWAP, Bollinger, RSI, and MACD. Both are published packages consumed by Nuxt apps. This lane did not audit the rest of the monorepo.

Load I assumed: charts run in the browser after an SSR pass, with dozens of points up to a few tens of thousands (a trading day of 1-minute bars, or a long dashboard series). Candles stream. Maps are regional GeoJSON (towns, counties): tens to a few thousand polygons, not a planet drawn as SVG. MapLibre is an optional peer and loads only from the `./gl` entry. I did not run the test suites or a browser. The cases below are from the source, checked with a small node script where the result is a number.

18 findings. 5 smaller ones are listed at the end and not written up.

## Must fix

### 1. A zoomed candle chart jumps back to all bars (`NardukCandleChart.vue:202-223`)

What this is. The visible window is `xViewMin` / `xViewMax`. A `domain` prop (and `v-model:domain`, including `NardukChartStack`) is supposed to hold that window in bar times.

Problem. The length watch always sets the window to `0 .. length-1` and then emits that full range. It does not read `props.domain`. The domain watch is not `immediate`, so the first render ignores a domain that was already set. Concrete case: 72 hourly bars, `domain` set to the last 10 bars. On mount the chart draws all 72. Append one new bar (a live candle rolling to the next minute) while the parent still holds the zoomed domain. Length changes, the window becomes the full history, and the microtask emits `update:domain` for that full span. A `v-model` parent stores it, so every linked pane zooms out. The line chart's length watch does reapply `xWindow` (`NardukLineChart.vue:471-478`). The candle tests only change `domain` after mount, or prepend bars with no domain, so they still pass.

Fix. In the length watch, if `domain` is set, convert `domain.start` / `domain.end` with `candleIndexAtTime` and call `clampViewWindow`. Do not emit the full range over a controlled domain. Apply that on the first run too.

If we skip it. Any live candle view that is zoomed, or stacked with another pane, snaps back to all history on every new bar and on first paint.

### 2. Downsampled candles share bars (`math.ts:448-474`)

What this is. `aggregateCandlesDetailed` merges a visible run of OHLC bars into at most `maxBuckets` candles. `NardukCandleChart` uses it for drawing (`NardukCandleChart.vue:470-476`) with a default cap of 512.

Problem. Bucket edges are `floor(b * chunk)` through `ceil((b+1) * chunk) - 1`. Neighbouring buckets overlap, so the same bar is in two candles. Five bars with highs `1, 1, 100, 1, 1` and `maxBuckets` 2 become ranges `[0, 2]` and `[2, 4]`. Both drawn candles have high 100. A split with no shared index would put the spike in one candle. With the default cap, 513 bars become 512 buckets and 511 bars sit in two buckets (`[0, 1]`, `[1, 2]`, `[2, 3]`, ...). 1000 bars into 512 buckets overlap on 504 indexes, and some buckets hold three bars (`[1, 3]`, `[3, 5]`). Volume is summed inside the bucket, so those bars are counted twice in the pane as well. The unit test merges 4 bars into 2, and 4 divides 2, so the ranges do not overlap and the test stays green.

Fix. Partition with no shared index: `i0 = floor(b * n / k)`, `i1 = floor((b + 1) * n / k) - 1`. Add a test where `n` is not divisible by `k`, and assert each source index is in one bucket and the spike high appears once.

If we skip it. Any candle series longer than 512 bars (a session of 1-minute bars) draws smeared OHLC and double-counted volume. The bad ranges also feed hit testing (`g0` / `g1`).

### 3. Aggregated volume bars are scaled to one raw bar (`NardukCandleChart.vue:526-544`)

What this is. The volume rects use the summed `v` on each draw bucket. The scale uses the tallest raw bar in the same index span.

Problem. 1000 bars, each `v` 10, all in view, default `maxDrawBars` 512. A bucket that merges two bars has `v` 20. `volumeMax` stays 10. The rect is twice the volume pane tall. A three-bar bucket from finding 2 is three times tall. The clip path is the whole plot (`NardukCandleChart.vue:1645-1647`), not the volume pane, so the rects run up over the candle bodies. This stays wrong after finding 2 is fixed: a clean split of 1000 into 512 still puts two bars in most buckets.

Fix. Set `volumeMax` from the max of `drawBuckets[].bar.v` (the values actually drawn).

If we skip it. With `showVolume`, a long series paints volume across the price plot. Short series under the cap are fine, because they are not merged.

### 4. One NaN or Infinity crashes the histogram (`math.ts:359-375`)

What this is. `computeHistogramBins` is the public bin helper. `NardukHistogramChart` calls it with `values` and no filter (`NardukHistogramChart.vue:61-64`).

Problem. `arrayMin` / `arrayMax` return `NaN` if any sample is `NaN`. `NaN === NaN` is false, so the single-bin shortcut does not run. The bin width is `NaN`. `Math.floor((v - min) / w)` is `NaN`, and `bins[NaN]` is undefined. `bins[i].count += 1` throws `TypeError: Cannot read properties of undefined (reading 'count')`. The same throw happens for `[1, 2, Infinity]` and bin count 4. The chart's computed then fails and the plot does not render.

Fix. Drop non-finite samples first. If none remain, return `[]`.

If we skip it. One missing sample encoded as `NaN`, or one runaway `Infinity`, takes down the histogram on the page.

## Should fix

### 5. One NaN poisons every later SMA (`sma.ts:5-9`)

What this is. `sma` keeps a running sum and slides the window. `bollinger` uses that average (`bollinger.ts:11-24`).

Problem. `sma([1, NaN, 3, 4, 5, 6, 7], 3)` returns `[null, null, NaN, NaN, NaN, NaN, NaN]`. The last window is `5, 6, 7` and the average should be 6. Subtracting the old `NaN` does `NaN - NaN`, which stays `NaN`, so the bad sample never leaves the sum. Bollinger then emits `NaN` bands for the rest of the series (`NaN === null` is false, so the null branch does not save it). The SMA test only covers `[1, 2, 3, 4, 5]`.

Fix. If the current window has a non-finite value, push `null` and start the running sum again from the next full finite window.

If we skip it. One gap encoded as `NaN` blanks the moving average and the Bollinger bands from that bar to the end.

### 6. Line click index and hover index are not the same sample (`NardukLineChart.vue:1398-1624`)

What this is. `maxRenderPoints` keeps an evenly spaced subset. `effIndexMap` maps a drawn slot back to the original label index. Hover uses that map. Click does not.

Problem. 100 labels, `maxRenderPoints` 10, pointer on the slot whose original index is 77. `activeIndex` and `pointHover` emit 77 (`NardukLineChart.vue:1398-1401`). `pointClick` emits `index: 7` (`1617-1624` and the keyboard path at `1523-1529`). `formatXTick` is passed 77. `formatXLabel` is passed 7 (`1421`). A parent that does `series[0].data[payload.index]` reads the wrong row. The `values` on the payload are taken from the decimated series, so they match original 77 while `index` does not. `chart-consumers.test.ts` checks `activeIndex` under decimation and does not emit `pointClick`.

The same split hits zoom. `LineZoomRange` and the README say `start` / `end` run from 0 to `labels.length - 1`. With 1000 labels and `maxRenderPoints` 100, `xWindow { start: 900, end: 999 }` is clamped with `full === 99` (`471-478`), so the line shows the whole downsampled series. A candle pane synced to those times still shows the tail. The prop comment on `maxRenderPoints` (`122-125`) says zoom then uses decimated indexes. The public type and the stack recipe do not.

Fix. On both click paths, emit `effIndexMap[idx] ?? idx`. Pass that same index to `formatXLabel`. Map `xWindow` / `zoom` through `effIndexMap` in both directions so the public numbers stay original indexes.

If we skip it. Hover and click disagree as soon as decimation is on, and a stacked line pane zoomed from candle times shows the wrong stretch of the series.

### 7. Log scale draws zero and negatives as a tiny positive (`yScale.ts:184-187`)

What this is. Log domains are built from values `> 0`. `yFromBottom` still accepts any number.

Problem. Data `-5, 0, 10` on a log axis. The domain comes from `10` only. `yFromBottom(-5)` and `yFromBottom(0)` both do `log10(1e-12)`. Both points sit on the floor of the plot, as if they were real tiny prices. The README says log is for positive values. A gap is the honest mark. The log tests use positive numbers only.

Fix. Where a series is turned into points, treat `v <= 0` as a gap when the scale is `log` (the same split `null` already causes). Do not plot it at `LOG_FLOOR`.

If we skip it. A zero in a log series looks like a crash to the bottom of the chart.

### 8. One bad coordinate blanks the whole map (`projection.ts:215-236` and `309-317`)

What this is. `resolveBounds` frames every shape and every point, unless the caller passes `bounds`.

Problem. `mergeBounds` uses `Math.min` / `Math.max`. One point `{ lon: NaN, lat: 41.5 }` beside a valid Rhode Island shape yields west/east `NaN`. Mercator of `NaN` is `NaN`, so the view scale is `NaN` and nothing draws. A feature collection whose only polygon is `coordinates: []` returns `[Infinity, Infinity, -Infinity, -Infinity]` and the same blank map. An empty feature list does fall back to `[-1, -1, 1, 1]`. There is no test for either input.

Fix. Ignore non-finite positions in `geometryBounds` and in the point loop. If nothing finite remains, use the existing `[-1, -1, 1, 1]` fallback.

If we skip it. One bad point from a feed takes down every other shape on that map.

### 9. A bounds box that crosses longitude 180 has a NaN zoom (`projection.ts:71-84`)

What this is. `fitBounds` and `createMapView` treat west and east as a simple mercator span. The GL map reuses that zoom.

Problem. Bounds `[170, -10, -170, 10]` (a normal Pacific box). `mercatorX(east) - mercatorX(west)` is about `-0.94`. `Math.log2` of a negative scale is `NaN`. The SVG view and the MapLibre `minZoom` derived from it do not frame the box.

Fix. When east is numerically west of west, add 360 to east before the mercator span so the short crossing is positive. Keep a test with this box and a finite zoom.

If we skip it. Any map whose box crosses the date line renders blank. New England data does not hit this. Pacific or world boxes do.

### 10. GL mark sprites ignore a later radius change (`gl-marks.ts:52-54`)

What this is. Each pin is a canvas image registered with MapLibre. The id is documented as encoding everything that changes the picture. `ensureMarkImages` skips `addImage` when that id already exists (`NardukMap.vue:311-325`).

Problem. The id includes shape, highlight, and colours. It does not include `size` or `markRadius`. The style is replaced only when the `metrics` prop changes identity (`NardukMap.vue:585-590`), not when a field on the same object changes. After the map is `ready`, set `markRadius` on the existing metrics object. The poster math uses the new radius, then CSS hides the poster (`map.css:367-369`). The on-screen GL pin keeps the old bitmap.

Fix. Put the pixel `size` (or the radius inputs) in the image id so the next `ensureMarkImages` registers a new image and the point layer references it.

If we skip it. A control that retunes mark size on the live map does not move the GL pins. Passing a new metrics object still rebuilds the style and hides this.

### 11. Keyboard users lose shape buttons once the GL map is ready (`map.css:367-369`)

What this is. `NardukMap` accepts `interactive` (it extends the SVG props). The poster paths are `role="button"` with `tabindex="0"` (`NardukGeoMap.vue:370-381`). Mouse clicks on the GL canvas still emit `select` (`NardukMap.vue:418-419`).

Problem. `<NardukMap interactive>`. After the first idle, `.narduk-map.is-ready .narduk-map__poster` is `visibility: hidden`. Those buttons leave the tab order. Tab reaches the zoom buttons only. `MapTable` does not emit `select`, and it is not mounted until `ready` (`NardukMap.vue:682`). There is no `NardukMap` test.

Fix. When `interactive` is on, do not hide the poster with `visibility: hidden`. Hide it visually (`opacity: 0`, `pointer-events: none`) so the canvas keeps the pointer and the shape buttons stay in tab order.

If we skip it. Mouse users can select a shape on the live map. Keyboard users cannot.

### 12. Print mode is thrown away when GL fades in (`NardukMap.vue:110-119`)

What this is. `plain` draws `levelText` under each name and turns off tab stops. The prop is on `NardukMap`. The poster receives it (`122-134`). The GL label layout does not.

Problem. `<NardukMap plain :level-text="{ county: '3' }">`. The poster shows the subtitle. `layoutLabels` for GL is called with `plain: false` and `levelText: undefined`. When `ready` flips, the poster is hidden. The live map shows uppercase names, no subtitle, and it still pans and zooms.

Fix. If `plain` is true, do not start MapLibre. Leave the poster. That is the print view the prop describes.

If we skip it. A print or static call that uses `NardukMap` instead of `NardukGeoMap` loses the subtitles as soon as tiles idle.

### 13. A WebGL failure still hides the poster (`NardukMap.vue:476-497`)

What this is. The file comment says a failed GL import or a WebGL failure leaves the poster up. `failed` adds the class `is-failed`. No CSS rule mentions `is-failed`.

Problem. The constructor throw path never sets `ready`, so the poster stays. A later error whose message contains `"WebGL"` (context loss after a good start) sets `failed` and emits `error`, and does not clear `ready`. The idle handler or the 6 second timer (`480-482`) also sets `ready` with no check of `failed`. `is-ready` then applies `visibility: hidden` to the poster. The canvas is blank. Tile errors are ignored on purpose so the shape layers can still show. A dead WebGL context cannot draw those shapes.

Fix. If the error handler sets `failed`, do not set `ready`. Add a rule that keeps the poster visible and the canvas hidden while `is-failed` is set.

If we skip it. After a lost WebGL context the user sees an empty box instead of the SVG map that was already drawn.

### 14. Point links accept a `javascript:` URL (`NardukGeoMap.vue:454-461`)

What this is. A point with `href` becomes an SVG `<a>`. The same string is an "Open" link in the hidden table (`MapTable.vue:30-34`). Labels are text. The URL is not checked.

Problem. `href: 'javascript:alert(1)'` is written onto both anchors. Activating the mark or the table link navigates to that URL. Browsers that still run `javascript:` URLs from an `<a>` run the script.

Fix. Allow `http:`, `https:`, `mailto:`, and same-document relative URLs. Omit `href` for anything else, on both the SVG mark and the table.

If we skip it. A map whose points come from a CMS or another user can put a script URL on a focusable control.

### 15. Two pie slices with the same label collapse (`NardukPieChart.vue:120-129` and `420`)

What this is. Slice groups and percent labels are keyed by `item.label`. Hide/show state is a `Set` of those labels.

Problem. Data `[{ label: 'Other', value: 40 }, { label: 'Other', value: 60 }]`. Both `<g>` nodes use the key `Other`, so Vue reuses one group and the two slices fight one DOM node. Toggling "Other" in the legend hides both, because `hiddenItems` stores the label. The legend also has two buttons with the same name. No test uses duplicate labels.

Fix. Key the slice and the legend row by index (or label plus index). Toggle and `hidden` by that same id.

If we skip it. Two categories that share a name (a common "Other" bucket plus a real "Other") do not both draw, and one legend click removes both.

### 16. Every scatter point is its own tab stop (`NardukScatterChart.vue:201-216`)

What this is. Each point is a `<circle tabindex="0">`. There is no decimation and no roving tabindex. The pie chart in this package uses one tab stop and arrow keys.

Problem. 40 points (the low end of the load) means 40 Tab presses before focus can leave the chart. 10,000 points means 10,000 circles in the DOM, each focusable, recomputed on resize. The scatter tests use a handful of points.

Fix. One tabindex on the plot, arrows to move, like the pie. Above a few thousand points, downsample or refuse the extra circles.

If we skip it. A modest scatter traps the keyboard. A large one janks the page.

## Nice to have

### 17. Negative pie values draw backward slices (`NardukPieChart.vue:184-196`)

What this is. Each slice sweep is `value / total * 2π`, with no sign check. The empty state only trips when the total is `<= 0`.

Problem. Values `30` and `-10`. Total is 20. The slices are 150% and -50%. The negative sweep runs the arc backward. The percents do not add to 100.

Fix. Drop non-positive values before the total. If nothing positive remains, use the empty state.

If we skip it. A negative category renders a backward wedge and a nonsense percent. Callers who only send positive numbers never see it.

### 18. Zoom still builds a path through every off-screen point (`NardukLineChart.vue:956-967`)

What this is. Wheel and pan update `xViewMin` / `xViewMax`. The line path is clipped to the plot. The path is still built from the full series.

Problem. 20,000 points, `zoomable`, no `maxRenderPoints`, zoomed to about 40 categories. Each wheel tick runs `segmentLinePoints` and the curve builder across all 20,000 points, then the clip hides almost all of it. `showPoints` would also emit one circle per point.

Fix. Build the path from the visible index range, plus one point on each side so the curve still joins.

If we skip it. Zoom on a long series hitches. The numbers stay correct. `maxRenderPoints` avoids it only if you accept the decimated index space in finding 6.

## Smaller ones left out

5, not written up as findings:

- Padding larger than the map box makes `fitBounds` scale negative and the zoom `NaN` (`projection.ts:78-84`).
- A point colour that never comes back stays in `map.addImage` until the map is destroyed (`NardukMap.vue:311-325`). A fixed legend does not grow.
- Changing `overlays[i].tiles` on the same overlay id updates opacity and visibility only (`NardukMap.vue:361-364`).
- `trailingSparkWindow([])` with no `now` calls `Date.now()` (`spark.ts:161-167`). No chart component calls it during render.
- `formatValue(999950)` is the string `1000.0K` (`math.ts:275-280`).

## Verdict

Do not trust the candle pane on a long or live series until the bucket split, the volume scale, and the domain watch are fixed. Do not trust the histogram on non-finite samples, or the SMA after a single `NaN`. The SVG map is sound for clean regional GeoJSON that does not cross the date line. The GL wrapper is the risky half: it drops keyboard shape access, print subtitles, a later mark-radius change, and the poster after WebGL context loss.

Not checked: package test runs and browser paint (no install, no build). `chart.css` and the rest of `map.css`. Labs, stories, design cards, e2e snapshots, and the county fixture. Basemap paint stops against `DESIGN.md` (tile URLs and attribution only). Candle drawing tools beyond fib levels using raw price. Bar-chart horizontal and percent templates past the stack cursor. Line annotations, bands, and studio rails past the index map and the series path. MapLibre's runtime image cache across `setStyle`. Spec-compliant polygon holes: SVG uses the default nonzero fill and I did not find a compliant ring that fails, so that is not a finding. `useStreamingSeries` / `useCandleStream` dropping extra pushes is what their comments say, so that is not a finding either.
