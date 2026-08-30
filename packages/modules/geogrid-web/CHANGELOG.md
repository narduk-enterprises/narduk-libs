# Changelog

## 0.5.1 — 2026-08-30

### Fixed

- Temporal decoding and both render backends now use the water-quality
  product's canonical z9 observation weight of `0.40`. This completes the
  coordinated visual-contract change begun by the producer; other weight
  profiles still fail closed and legacy scalar/RGB paths remain unchanged.

## 0.5.0 — 2026-08-30

### Added

- Temporal RGB manifests can opt into the additive
  `base-observed-confidence-v1` composition contract: base RGB, observed RGB,
  one observed-confidence plane, and distinct base/observed validity masks.
  Legacy scalar (`1` plane / `1` mask) and legacy RGB (`3` planes / `1` mask)
  decode and render through their existing paths unchanged.
- Scale-aware RGB uses an exact continuous zoom curve: `0` through z7, `0.25`
  at z8, `0.60` at z9, and `1` at z10 and above, linearly interpolated between
  anchors. An explicit finite host zoom wins; when zoom is absent, both
  backends derive it from CSS width and viewport longitude span. Invalid input
  fails safely to base-only.
- WebGL2 packs each composed date into two nearest-filtered RGBA8 textures,
  including an uninterpolated validity byte (`bit 0 = base`, `bit 1 =
  observed`). Two dates plus the coastline stencil require five fragment
  texture units, within WebGL2's minimum of sixteen. Canvas2D runs the same CPU
  reference math for the additive path.

### Changed

- Base/observed composition and lower/upper temporal playback now blend in
  linear-sRGB for opted-in frames, then encode to display-sRGB once. Each
  component retains its own mask; one real side is never mixed with black and
  a gap in both masks remains transparent.
- Temporal decoding now validates the fixed plane/mask mapping, mirrored chunk
  layout, runtime manifest envelope, integer geometry, compressed and decoded
  size caps, and stops inflation as soon as bytes exceed the declared layout.

### Notes for callers

- This is an intentional render change only for manifests carrying
  `rgbComposition`. Coordinate regeneration of the SHA-pinned render-parity
  fixtures in all consuming repositories; do not hand-edit their pins.

## 0.4.2 — 2026-08-30

### Fixed

- Precolored RGB WebGL now samples a mask-aware 2×2 neighborhood instead of
  combining hardware-LINEAR color planes with a NEAREST validity mask. Missing
  colors are never read or substituted with black; real weights are
  renormalized, so coarse coastlines no longer carry dark bleed or hard
  nearest-mask stair-steps.
- WebGL2 RGB coverage defaults to the honest `coastal` alpha feather already
  implied by the Canvas2D fallback; `sampling: 'soft'` selects its explicit
  crisp-edge kernel. The existing Canvas2D premultiplied-alpha resample remains
  unchanged and always feathers RGB edges; it does not apply the RGB sampling
  hint. Both paths preserve temporal fallback, gaps, and channel bounds.
- Added CPU RGB reference renderers plus shader, temporal-blend, honest-gap,
  channel-bound, and adjacent-viewport seam tests.

## 0.4.1 — 2026-08-30

### Fixed

- RGB temporal decoding now aliases the scalar-compatibility `values` plane to
  `channels[0]` instead of retaining a duplicate red plane. Decoded pixels,
  masks, channel order, and renderer behavior are unchanged; retained RGB frame
  storage drops from five to four bytes per pixel. Decoded sample planes are
  now documented as immutable, matching the renderer cache contract already in
  force.

## 0.4.0 — 2026-08-28

Two features, one release: the **Web-Mercator tile baker** and the **dynamic
display range**. They met in the merge rather than in the plan, and they compose
— a baked tile is stretched through `style.displayRange` exactly as the overlay
is, because both now run the same fragment shader.

Additive on both counts. `displayRange` defaults to `valueRange`, no existing
export changed shape, and a caller that asks for neither renders byte-for-byte
what it rendered in 0.3.0.

### Added

- **`./tile` subpath.** `createGridTileImageSource(...)` returns the
  `(x, y, z, scale, data?) => Promise<OffscreenCanvas | null>` function a tiled
  host consumes; `renderGridTile(source, style, { z, x, y, side })` bakes one
  tile; `referenceRenderGridTile(...)` does it on the CPU and returns raw RGBA.
  Also exported from the package root.
- **Structural fit with narduk-mapkit, with zero new package edges.** The
  returned function *is* `MapKitTileOverlayImageSource<OffscreenCanvas>`
  structurally, by agreement rather than by import — neither package depends on
  the other. `tests/tile-image-source.test.ts` restates narduk-mapkit's type
  verbatim and assigns to it, so a signature change on either side fails this
  repository's typecheck.
- **Web-Mercator tile geometry** (`lonLatForTilePixel`, `tileBounds`,
  `tileProjection`, `tileIntersectsBBox`), ported from GeoGridKit
  `Sources/GeoGridRender/GridTileMath.swift` and pinned to
  `tests/fixtures/tile-math-parity-v1.json` — 107 lon/lat/bounds values produced
  by calling GeoGridKit itself through
  `tests/fixtures/generate_tile_math_parity.sh`. Asserting a port against its own
  arithmetic proves nothing; a tile whose pixel centers land half a pixel off the
  Swift renderer's is two clients disagreeing about where the coastline is.
- **`GridTileRenderer`** — a shared WebGL2 context, FBO and texture cache. One
  renderer for a whole layer, because a browser caps live contexts near sixteen
  and one grid should upload once rather than once per tile. Falls back to the
  CPU path wherever OffscreenCanvas WebGL2 is unavailable.
- **`toGridTileLayer`** places a decoded `/grid` dataset on its own
  `gridBounds(header)` geometry — the same extent `overlay.setScalarFrame`
  chooses, so a tile and the overlay cannot disagree about where a grid sits.
- **`GridStyle.displayRange`** — the render stretch, distinct from
  `GridStyle.valueRange`, which stays the wire/decode domain. This split is the
  point of the release: narrowing `valueRange` to "make the image pop" does not
  re-spread the ramp, it re-decodes every `encoded-u16` cell to a value the
  publisher never wrote. `tests/display-range-render.test.ts` pins both
  behaviors side by side. Mirrors GeoGridKit's
  `GridDatasetDescriptor.displayRange` / `effectiveDisplayRange`.
- **`core/stretch.ts`** — the calculator, a mirror of GeoGridKit
  `Sources/GeoGridCore/Stretch.swift` (`b13d61d`):
  - `GridRangeStretch`: `fixed`, `manual`, `viewport-minmax`,
    `viewport-percentile`, `date-percentile`.
  - `percentileHF7` — Hyndman–Fan **type 7**, numpy's default.
  - `stretchStride` — `max(1, ceil(sqrt(candidates / 65536)))`, applied on
    **both** axes. One-axis striding disagrees with Swift about the sample
    population by a factor of the stride, which moves a percentile.
  - `sampleGridValues` / `gridIndexRange` — candidates are the cells whose
    **centers** fall in the viewport∩grid intersection.
  - `paddedRange` — padding in the normalized space of the layer's own scale, so
    a 5% pad on a log layer widens by 5% of the decade span.
  - `stretchDisplayRange` — the dispatch, returning `{ range, tier, sampleCount }`.
- **`GridStretchController`, wired into `GridOverlay`.** New overlay API:
  `setStretch`, `currentStretch`, `currentDisplayRange`, `onDisplayRangeChange`,
  `setPlaying`. It recomputes on viewport idle behind a **250 ms** debounce,
  applies a range only when an endpoint moves more than **2%** of the current
  span, and stays **frozen while playing** — anything requested mid-playback is
  applied on pause.
- **`tests/fixtures/grid-stretch-parity-v1.json`** and its generator. The
  percentile cases come from numpy, and the **first eight are byte-identical to
  the fixture GeoGridKit's own `StretchTests` reads** — same generator code, same
  seed, same draw order — so the two languages are pinned to literally the same
  numbers rather than to two samples of the same idea.

### Changed

- The scalar fragment shader, the kernel, and the WebGL helpers moved to
  `src/render/gl.ts` and are now shared by the overlay backend and the tile
  baker rather than copied. The two differ in exactly one function — how a
  screen UV becomes a data UV — which is the `projection` parameter. The GLSL is
  otherwise unchanged, so the overlay renders the same pixels it did in 0.3.0.
  This is also what makes the two features in this release compose for free:
  `displayRange` landed in that one shader, so the tile baker got the stretch
  without a second implementation to keep in step.
- `script/check_package_exports.mjs` now also fails on the *reverse* drift: a
  `src/<dir>/index.ts` with no matching subpath in the export map. The export map
  is the one place a subpath's absence is invisible from inside the repo.
- The WebGL2 scalar shader normalizes over a new `displayRange` uniform;
  `valueRange` keeps its one job, decoding an `encoded-u16` sample. Both are
  guarded, and they collapse onto the same numbers on an unstretched layer.
- The Canvas2D raster cache key now carries the display range, as defense in
  depth rather than as the invalidation mechanism: `setStyle` already drops the
  cached raster and both cache keys, which is what actually makes a stretch take
  effect. Same-instance invalidation is asserted; the key line is belt to that
  brace.
- **`GridOverlay` is the single writer of `style.displayRange`.** A hand-set
  `style.displayRange` — through the constructor or `setStyle` — is adopted as
  the `{ mode: 'manual', range }` stretch it amounts to, rather than written
  straight into the style. Writing it directly let `currentDisplayRange()`
  report one range while the picture showed another, and left the controller's
  hysteresis comparing against a range it had never computed, which could
  silently stop a running stretch from ever applying again.
- **`setScalarFrame`'s `bbox` override now reaches the stretch.** The effective
  extent is handed to the sampler as its geometry, so a relocated plane is
  sampled where it is drawn. Previously the sampler used the header's own
  `lon0`/`dx` while the renderer used the override, and the resulting range was
  computed from cells nobody was looking at — plausible, wrong, and unbounded in
  the size of the override.
- `setScalarFrame` accepts `dateStatistics`, so a `date-percentile` stretch can
  consume a server-published table once one exists (#15).

### Fixed

- **`setPlaying(true)` no longer discards a viewport recompute that was still
  debouncing.** Panning and starting playback inside the 250 ms window dropped
  the pending request outright, so pausing afterwards never recomputed —
  directly contradicting the freeze contract, which promises the request is
  deferred rather than lost.
- A `manual` stretch now applies before any frame has arrived. It needs no data,
  and GeoGridKit's dispatch ignores the dataset for that case, so making an
  operator-set range wait for a frame was this side's own invention.
- An inverted or zero-width row in a published `dateStatistics` table is
  reported `insufficient` and falls back to `valueRange`, rather than being
  handed to the renderer as a range that would blank the layer.
- `GridStretchController.destroy()` clears the applied range, so
  `currentDisplayRange()` cannot keep reporting a stale one after teardown.

### Notes for callers

- **A tile carries its opacity in its pixels.** The overlay puts
  `style.opacity` on the canvas element as CSS; a tile has no element, so it is
  composed into the alpha. A host that also sets its own layer opacity squares
  it — leave the host at `1`, or pass `opacity: 1` and let the host own it.
- **`null` is reserved for "the grid for this tile could not be obtained".** An
  empty tile — all nodata, or entirely outside the grid — is a fully transparent
  canvas. A host reads the first non-null image as the layer becoming ready
  (narduk-mapkit's `onFirstImage`, which `MapKitLayerRegistry` waits 1500 ms
  for), and a basin-sized grid leaves most of the world's tiles empty.
- Tile baking is scalar-only in 0.4.0; a precolored (`rgb`) frame throws. There
  is no temporal blend in the tile path.
- **The WebGL tile path's deep-zoom precision is bounded, not pinned.** The
  README carries the table: registration error is ~0.11–0.15 px at `z15` and
  ~3.7–5.3 px at `z20`. A range, because two independent float32 simulations
  landed that far apart — and they also disagreed on which operation dominates
  the error and on whether the per-tile reformulation beats the naive form at
  low zoom. Nothing in this package can execute GLSL, so those two questions are
  open (#17) rather than answered. What is not in doubt: a fraction of a pixel
  through `z15` reaches no real layer, `z15` is far past any estate grid's
  native resolution, and the CPU path is double throughout.
- `createGridTileImageSource` throws `RangeError` for a `side * scale` above
  8192px rather than attempting the bake.
- **A tile bakes through `style.displayRange` too.** Hand the same style to
  `createGridTileImageSource` that you hand the overlay and the two agree; the
  stretch is not an overlay-only feature. What the tile path does *not* have is
  `GridStretchController` — a tile source has no viewport and no idle event, so
  a caller wanting a computed stretch on tiles reads
  `overlay.currentDisplayRange()` (or calls `stretchDisplayRange` itself) and
  passes the result in through the style resolver.
- The stretch samples the float32 `/grid` dialect, the one carrying the geometry
  a viewport intersection needs. A temporal `encoded-u16` frame set through
  `setFrame` / `renderAt` renders exactly as before and drives no stretch.
- The WebGL2 path has no Node coverage — there is no GL context in this
  environment and this package takes on no dependency to invent one. What is
  asserted is the shader's *structure*: that it normalizes over `displayRange`,
  decodes over `valueRange`, and guards both the way the CPU reference does.
  Pixel parity against a real GPU remains the browser leg's job.
- One deliberate divergence from the Swift sampler, in the web client's favor:
  gaps are decided by the decoder's per-plane mask rather than by `isFinite`
  alone, so a grid naming a numeric `nodata` sentinel excludes it. GeoGridKit's
  decoder stores `GridHeader.missing` as a `String` and never applies it, so on
  every grid whose `missing` is `NaN` the two rules are the same rule.

## 0.3.0 — 2026-08-28

The client-side scalar render path: plain `/grid` Float32 grids now render on
web through the same value-space math GeoGridKit's Metal renderer uses.

Existing callers keep compiling and keep working. The temporal player's *pixels*
change, deliberately — see **Changed** below before assuming a regression.

### Added

- **`float32` frames render.** One `GridFrame` model
  (`{ key, width, height, renderMode, valueKind, values, mask, channels? }`)
  now serves both dialects: `encoded-u16` for the temporal raster and `float32`
  for `/grid`. The backends accept either a `GridFrame` or a
  `TemporalRasterFrame`; `gridFrameFromTemporal` is a rename, not a copy.
- **`overlay.setScalarFrame(dataset, planeIndex?, options?)`** — the float32
  front door. Defaults its extent to `gridBounds(header)` and its cache identity
  to a content fingerprint of the plane.
- **`sampleScalarBilinearSoft`** in `core/math.ts` — the 2×2 NaN-aware kernel
  both backends and the reference renderer share, a literal port of GeoGridKit's
  `sampleScalarBilinearSoft` / `sampleScalarBilinearCoastal`. Missing neighbors
  are dropped and the surviving weights renormalized.
- **`style.sampling: 'soft' | 'coastal'`.** `soft` (the default) draws a pixel
  only where every contributing neighbor is finite; `coastal` reports the
  surviving weight sum and feathers it with `smoothstep(0, 0.55, …)`, exactly as
  GeoGridKit's `scalarFragment` does.
- **`referenceRenderScalarTile` / `referenceRenderScalarViewport` /
  `referenceScalarPixel`** in `core/reference-render.ts` — the whole scalar path
  on the CPU with no canvas and no GL. Until now the render math had no Node
  coverage at all, because every path into it required a browser. Canvas2D calls
  `referenceScalarPixel` itself, so the fallback and the reference cannot drift.
- **`GridBBoxAnchor`.** `/grid` extents span cell **centers** (`header.bbox`
  equals `gridBounds(header)`, which the decoder's own tests assert, and which is
  how GeoGridKit maps them); temporal manifests span cell **edges**. The two
  differ by half a cell, so the anchor is now explicit — defaulted per value kind,
  overridable per render — rather than assumed.
- `style.rampStops` accepts canonical normalized-position stops directly.
- `texelPositionFromUv`, `coastalFeather`, `sampleLutLinear`, `resolveRampStops`,
  `styleLut`, `styleScale`, `RAMP_LUT_COUNT`, and the `core/frame.ts` adapters.

### Changed

- **The scalar kernel narrowed from a 3×3 radius-1.5 tent to 2×2 bilinear, and
  the temporal player's pixels change accordingly. This is sharpening, not a
  regression.** The old tent pulled in cells up to a cell and a half away and
  smeared fronts the data resolves cleanly; the server's tiles and GeoGridKit
  both use the 2×2 form, so the wider kernel was the web client disagreeing with
  every other renderer in the estate about what the same bytes look like.

  Measured on a synthetic 96×96 kd490-like scene with a sharp front and a ragged
  coastline (script in the PR):

  | | linear layer | log layer |
  |--|--|--|
  | pixels differing | 69.4% | 92.3% |
  | mean channel delta | 3.24 | 32.49 |
  | partially-transparent pixels | 101 → 0 | 101 → 0 |

  The linear column is the kernel change alone, because on a linear layer the
  old and new ramp interpolations are algebraically identical. The log column
  carries the ramp-space correction below on top of it.

- **Ramp interpolation moved from value space into position space.** The old
  fragment shader lerped between two stops by raw data value; the canonical
  engine — and `shared/colorramp.py`, which colored every published tile —
  normalizes first and interpolates by position. On a log layer those are very
  different curves, which is the bulk of the 32.49 mean delta above. Legacy
  value-domain `style.ramp` stops are converted with `normalizeWireStops` rather
  than sampled in place.
- **The ramp is a 256×1 RGBA8 LUT texture, not a pair of uniform arrays.** The
  old `MAX_RAMP_STOPS = 16` cap was already exactly filled by the CDL ramp, so
  the next stop anyone added would have been dropped in silence. Per-stop alpha
  now reaches the output; the old `vec3` uniform could not carry it. (GeoGridKit
  drops LUT alpha because its `ColorStop` is RGB-only — this is a deliberate
  divergence, not a porting slip.)
- **Coverage no longer runs through `smoothstep(0.30, 0.70, …)`.** With the 2×2
  kernel, `soft` coverage is binary and the smoothstep was shaping nothing;
  `coastal` carries GeoGridKit's own `smoothstep(0, 0.55, …)` instead.
- **Canvas2D rasterizes in screen space when magnified** past ~1.5 CSS pixels
  per grid cell. It used to color cells and let `drawImage` scale the result,
  which interpolates between *colors* — and a ramp is not a linear function of
  value, so the midpoint between a blue cell and a red one came out muddy purple
  where the ramp puts bright green. Below the threshold the cheap path stands.
- **`frameContentKey` no longer collides, for two independent reasons.** Both
  mattered, and only one of them was about floats:
  1. *Truncation.* The integer mixer folds values in with `| 0`, which discards
     a KD490 grid's entire fractional part and maps `NaN` — most of a gulf grid,
     over land — onto `0`. Float planes now hash by their IEEE bits.
  2. *Sampling density.* The hash walked a stride of `n / 64`, inspecting about
     65 of a 512×512 grid's 262,144 cells. Two grids differing in **52,416**
     cells were verified to fingerprint identically. It now reads every element.

  The second is the more dangerous of the two: a temporal frame is keyed by its
  date and the hash only guards against a re-decode, but a `/grid` frame has no
  date, so the hash *is* the identity and a collision means the GPU keeps
  drawing the previous dataset.

  Reading every element costs ~5 ms on a 512×512 plane, which is free once per
  decode and ruinous per frame, so `frameCacheKey` memoizes on plane identity —
  ~0.00006 ms warm. Sound because neither decoder rewrites a plane in place; a
  caller who does should pass its own `ScalarFrameOptions.key`, which is now
  documented as the route for a publisher-supplied identity (ETag, `releaseId`).
  Integer planes of 64 elements or fewer hash exactly as before, and the
  temporal dialect's keys are pinned to a literal in a test.
- **An unusable value range draws nothing instead of throwing or inverting.**
  `normalizeValue` raises on `lo >= hi`, matching the server — right for a pure
  function, fatal in a render loop, where the exception escapes through
  `requestAnimationFrame` and takes the frame with it. Both CPU paths now guard
  first. The GPU had the opposite bug: it tested only `x == y`, so an *inverted*
  range fell through and rendered the ramp backwards. Both guards are written
  `!(lo < hi)` so that a `NaN` bound is refused too, and so that a corrupt range
  produces the same nothing on both backends rather than one painting and one
  not.
- **A non-finite normalized position can no longer index the LUT.** The shader's
  `normalized < 0.0` test is false for `NaN` and let it through. `GridFrame` is
  public, so a caller can hand over a mask claiming a `NaN` cell is real; the
  test is now negated, which costs one token and needs no `isnan()`.
- A missing WebGL uniform no longer throws. A driver may legitimately optimize
  out a uniform, and `gl.uniform*` on a null location is a defined no-op; the
  old behavior turned an optimizer difference into a dead overlay.
- Shader compile/link failures no longer leak GL objects. `pipeline()` swallows
  the throw and falls back to drawing nothing, so a shader failing on some
  driver would otherwise leak a shader object per render attempt, forever.
- Texture filtering is now chosen per uploaded format rather than per mode.
  Unchanged in effect — the `rgb` pass keeps the hardware `LINEAR` magnification
  it has had since 0.1.1, and every scalar plane stays `NEAREST` because
  `texelFetch` ignores filter state — but stated explicitly, because `LINEAR` on
  an `R16UI`/`R8UI` texture makes it *incomplete* and it samples black.
- `GridStyle.ramp` and `GridOverlayStyleInput.ramp` are optional now that
  `rampStops` exists. Code that *passes* `ramp` is unaffected; code that *reads*
  `style.ramp` must handle `undefined`.

### Deferred

- The WebGL2 and Canvas2D backends are asserted against the reference renderer
  by construction and by unit test, but not yet by a browser-context golden
  harness — that is the C7 lane's, and it is why `referenceRenderScalar*` exists
  in this one. No headless-GL dependency was added; the package stays
  zero-runtime-dependency.
- GeoGridKit's grid-edge feathering (`gridEdgeFade`, `gridEdgeFeatherCoverage`)
  is not ported. It is driven by tile uniforms this package has no analogue for,
  and the coastline stencil plays that role on web.
- `bboxAnchor` is scalar-only. The `rgb` pass samples precolored planes with a
  plain normalized `texture()` read and has no texel-space step to anchor, so
  the field is accepted and ignored there; documented on the type.
- Reviewed and deliberately left alone: the sample position is taken from the
  lower frame's geometry when two frames disagree on size (no producer emits
  that, and the alternative is guessing which is authoritative);
  `getAttribLocation` runs per draw (one cached call per program would save
  microseconds against a full-screen pass); `styleKey` fingerprints the stop
  *count* rather than the stops (every `setStyle` already invalidates the raster
  wholesale, so the key only has to separate frames within one style); and the
  resolved ramp is recomputed rather than memoized (it is a handful of stops).

## 0.2.1 — 2026-08-28

Post-merge adversarial-review fix-forward for `./color` and the `/grid` decoder
(0.2.0). No public API additions or removals; one public export's edge-case
behavior changes.

### Fixed

- **`normalizeValue`'s degenerate-range guard now matches the server exactly.**
  It was `if (!(lo < hi)) throw`, which diverges from narduk-data
  `shared/colorramp.py`'s `if lo >= hi: raise` on a `NaN` bound: `!(lo < hi)`
  is `true` for `NaN` (threw) while `lo >= hi` is `false` for `NaN` (the server
  clamps instead of raising). The guard is now the literal `if (lo >= hi)`.
  Fixing the guard alone surfaced a second, narrower divergence: with a `NaN`
  bound let through, the final `Math.min(1, Math.max(0, raw))` clamp answers
  `NaN` where the server's `min(1.0, max(0.0, raw))` answers `0.0` — Python's
  builtin `max`/`min` keep their first argument on a `NaN` comparison, `Math.max`/
  `Math.min` do not. `normalizeValue` now reproduces that order-sensitive
  clamp so a degenerate `NaN` bound is byte-exact with the server end to end.
- **`generate_ramp_parity.py`'s `wire_stop_case` now calls the real
  `earth_data_pipeline.catalog.ramp_stop_value`** instead of re-deriving its
  formula inline, restoring this file's own "nothing here re-implements ramp
  math" contract. Regenerating `ramp-parity-v1.json` against the real function
  produced a byte-identical fixture — the inline copy was accurate, just an
  unnecessary and driftable duplicate.
- **`roundHalfToEven` now throws `RangeError` on a non-finite input** (`NaN`,
  `+Infinity`, `-Infinity`) instead of silently returning `NaN`/`Infinity`.
  Python's `round()` — the reference this ports — raises on all three
  (`ValueError` for `NaN`, `OverflowError` for `Infinity`), so a public export
  documented as matching Python was quietly diverging exactly where Python is
  loudest. The three internal call sites (the channel interpolation in
  `sampleRamp01`) only ever pass an already-finite interpolated 8-bit channel
  value, so this is a public-export contract fix with no internal-caller
  fallout.

### Added

- A test pinning `decodeGridBinary`'s `planeCount` default: a header that
  omits `planeCount` entirely now has an explicit assertion that it decodes as
  `1`, matching `parseHeader`'s `raw.planeCount ?? 1`.
- A direct test for `denormalizePosition` against the `wireStopCases` fixture.
  Its docstring already claimed this coverage ("that round trip is pinned by
  the wireStopCases fixture"), but no test called the function — every
  existing `wireStopCases` consumer exercises the opposite direction
  (`normalizeWireStops`).
- A test for `normalizeValue`'s `NaN`-range-bound behavior, with the expected
  value captured by running narduk-data's own `shared/colorramp.py`.


## 0.2.0 — 2026-08-28

Canonical color-ramp engine and the `/grid` binary decoder. Nothing existing was
removed; 0.1.2 code keeps compiling and behaving as it did.

### Added

- **`./color` subpath — the canonical Narduk ramp engine.** Stops carry a
  normalized position in `0…1` with 8-bit RGBA, and interpolation rounds **half
  to even**, matching narduk-data `shared/colorramp.py` — the engine every
  published tile was colored with. Exports `normalizeValue`,
  `denormalizePosition`, `normalizeWireStops`, `sampleRamp01`,
  `sampleRampValue`, `rampLut`, and `roundHalfToEven`.
- **`normalizeWireStops`** converts catalog wire stops (raw data values) into the
  normalized-position model — the same conversion GeoGridKit's `CatalogClient`
  performs, and the exact inverse of the pipeline's `catalog.py::ramp_stop_value`.
  Sampling a catalog ramp without it puts every color in the wrong place. Alpha
  is preserved, which GeoGridKit's RGB-only `ColorStop` cannot do.
- **`ramp-parity-v1.json`** — a fixture generated by *running* the server engine
  (generator checked in beside it), asserting the TypeScript engine byte-exact
  across mid-segment samples, both clamp directions, `NaN`, non-positive values
  on a log scale, a ramp whose first stop is transparent, a ramp whose last stop
  sits below position 1.0, and full 256-entry LUTs for `sst` and `kd490`.
- **`decodeGridBinary`** for the narduk-data `/grid` contract: 4-byte LE header
  length, JSON header, little-endian Float32 planes. Ported from gonogo's two
  production decoders and cross-checked against GeoGridKit's Swift decoder.
  Emits a companion `Uint8Array` finite mask per plane, reads plane names from
  either `variables` or `planeOrder`, and copies the payload rather than viewing
  it — the float region after a JSON header is not 4-byte aligned.
- **`decimatedGridUrl` / `readGridStride`** for the server's `maxCells`
  decimation and its `X-Grid-Stride` response header.
- **`gridBounds(header)`** — geographic extent derived from the sample geometry,
  the twin of GeoGridKit's `GridHeader.bounds`. `bbox` is optional on the wire,
  so without this a publisher that omits it leaves a decoded grid with no extent
  at all, and a renderer with no extent cannot place a pixel.
- Grid fixtures copied byte-for-byte from GeoGridKit's
  `GridHeaderConformanceTests`, with their SHA-256s pinned here. GeoGridWeb is
  now the fourth leg of that cross-language contract.
- `RampStop` in `core/models.ts`; `check:package` now pins every export subpath
  to its source barrel so the export map cannot outlive its source.

### Changed

- **A non-positive value on a log-scale layer is now transparent, not colored.**
  The canonical `normalizeValue` answers `null` there and `sampleRampValue`
  renders nothing, matching the server. The deprecated `core/color.ts`
  `sampleRamp` clamped such a sample to the ramp's first stop, painting a zero
  or negative retrieval with the "clearest water" color. That is fabricated
  data, so the canonical engine drops it.
- The canonical engine rounds **half to even**; the deprecated `core` sampler
  rounds half up and stays that way. The two disagree by one count on any
  channel interpolation that lands on an exact `.5`.

### Deprecated

- `core/color.ts` (`sampleRamp`, `rampLut`, `RGB`) — behaviorally frozen for
  0.1.x consumers. Use `./color`.
- `core/math.ts` `normalizeValue` — natural logs, and a different answer for a
  degenerate range. Use `./color`'s.

`./color` is deliberately **not** re-exported from the package root, because
`normalizeValue` and `rampLut` exist in both engines with different meanings.

## 0.1.2 — 2026-07-21

Post-review hardening (round 1).

### Fixed

- Pre-inflate size check so oversized frame dimensions cannot allocate past `maxDecompressedBytes`
- RGB planes included in `frameContentKey` so G/B-only updates bust GPU/CPU caches
- Partial WebGL texture upload failures free already-created textures

## 0.1.1 — 2026-07-21

Production-hardening pass after multi-agent review.

### Fixed

- WebGL plane/mask uploads set `UNPACK_ALIGNMENT=1` so odd widths and non-multiple-of-4 R8 rows no longer skew textures
- Scalar temporal blend mixes in **encoded** space on WebGL (matches Canvas2D and log-scale wire quantization)
- Canvas2D coastline stencil zeros alpha outside the stencil geo bbox (matches WebGL)
- Failed/skipped WebGL `render` clears a previously drawn frame instead of leaving stale pixels
- GPU/CPU caches key by frame content fingerprint, not date alone
- Scalar `dtype: 'uint8'` rejected at decode (unsupported combination)
- Decode fails closed on oversized headers, dimensions, frame counts, and decompressed payloads
- `GridOverlay.destroy()` drops `lastRender` so frame buffers are not retained

### Known remaining limitations

- Dateline-crossing bboxes unsupported
- No tiled `renderTile` baker / float `.bin` grid-tile wire format (GeoGridKit contract 1)
- WebGPU not implemented
- No `webglcontextlost` recovery (host must recreate the overlay)
- Color stops use **display units** (earthdata chart compatibility), not GeoGridKit normalized 0…1 locations
- RGB WebGL still uses hardware LINEAR on value planes (mask-aware neighborhood sampling is scalar-only)

## 0.1.0 — 2026-07-21

Initial extract from `earthdata-viewer` temporal playback (`temporalRaster`, `temporalWebGL`, `temporalCanvas`).

### Added

- `@narduk-enterprises/geogrid-web` with `core` / `render` / `overlay` exports
- `decodeTemporalChunk` for `NARDUKTR1` / `earth-data-temporal-raster-v1`
- `createGridOverlay` — WebGL2 primary, Canvas2D fallback
- Shared `normalizeValue` / ramp sampling aligned with GeoGridKit intent
- Coastline stencil on both WebGL2 and Canvas2D backends
