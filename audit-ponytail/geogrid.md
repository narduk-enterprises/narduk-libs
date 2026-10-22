# Ponytail audit: `@narduk-enterprises/geogrid-web`

What this repo does: `narduk-libs` publishes shared packages for Narduk apps. This audit covers only `packages/modules/geogrid-web`. That package decodes gridded geo payloads and draws them as one canvas over a basemap, or as Web-Mercator tiles, using WebGL2 with a CPU fallback.

Load I assumed: a browser map on the main thread. One overlay, plus bursts of tile requests from MapKit, MapLibre, or Leaflet. Grids up to the caps already in the code (10 million float samples, temporal frames up to 8192×8192, inflate capped at 512 MiB). Zoom roughly 0–18. One tab. A Worker may decode bytes or bake tiles where `OffscreenCanvas` and `DecompressionStream` exist. The overlay needs a document. Other packages in this repo are out of scope.

I read the README, the package entry points, and the source under `src/` (decode, math, color, stretch, both renderers, the overlay, and the tile baker). I used the tests to see what is pinned. I did not execute them.

Findings: 8. Must fix 2, Should fix 5, Nice to have 1. I left out 6 smaller items (listed at the end).

## Must fix

### 1. Overview mode drops pixels that sit inside a real cell

`src/core/math.ts:97-121`, `src/core/reference-render.ts:390-394` and `467-476`, `src/render/gl.ts:523-551`

What this is: v2 RGB composition (`base-observed-confidence-v2-area-anchor`) at zoom 7 and below sets `supportModulatesWeight`. Each CSS pixel then averages the source cells whose centers fall in that pixel. The weight of the observation is that support fraction. The CPU path and the WebGL2 shader both do this.

Problem: a pixel can lie entirely inside a valid cell and still get an empty bucket, because the cell center belongs to a neighbor pixel. Empty means weight 0 and "not valid", so the nearest-cell check is skipped.

Take a 2×2 grid, anchor `cell-edge`, every observed mask byte 1, every base mask byte 0, drawn at 4×4 CSS pixels, with `supportModulatesWeight` true. Cell (0,0) covers the top-left 2×2 pixels. Only the one pixel that holds the cell center gets a bucket. The other three pixels of that cell come back transparent. The README says a real one-sided sample stays visible. Here three quarters of the cell vanish.

The same function special-cases a 1-cell axis on the CPU (`size <= 1` returns the whole cell). The shader does not. A 1×1 observed cell drawn at 2×2 CSS pixels is fully colored on Canvas2D and on `referenceRenderRgbCompositionTile`. On WebGL2 the pixel over UV `[0, 0.5)` has an empty bucket and is transparent.

This is the normal overview, not a huge zoom. `supportModulatesWeight` is on for every zoom `<= 7`. A 4 km cell is about 3 CSS pixels wide at z7, and about 1.6 at z6. Most of those pixels do not contain the center. Below about z4 the buckets fill up and the average works.

Fix: if the footprint has area but the center bucket is empty, use the one cell the footprint sits on (mask 1 → support 1). Port the CPU `size <= 1` short-circuit into `areaBoundary` in the shader. Leave buckets that already contain centers alone, so the existing half-open test stays valid.

If we skip it: at z6–z7 a v2 layer shows the observation as sparse specks, or punches holes through observed water where the base is missing. Canvas2D and WebGL2 disagree on a 1-cell grid. No test draws a pixel smaller than a cell with `supportModulatesWeight` on.

### 2. A restored WebGL context can keep serving the previous tile

`src/tile/baker.ts:429-445`, cache hits at `628-636` and `733-735`, readback at `766-770`

What this is: one shared `GridTileRenderer` bakes every tile. `render` copies the framebuffer into a reused `readback` array. The comment above the `isContextLost` check says why: after a lost context, `readPixels` does not write, so the array still holds the previous tile, and that image would be returned for every later tile.

Problem: the check runs only while `isContextLost()` is true. Browsers restore the context and then that flag is false. Textures, the program, the buffer, and the framebuffer from before the loss are invalid, but the JS fields still point at them.

Case: bake the Gulf tile. The tab is backgrounded, the context is lost, and it is restored before the next bake (normal for mobile Safari). The next tile is a different `z/x/y`. `isContextLost()` is false. `ensureFrame` returns the cached textures. `ensureTarget` returns immediately because the size matches. The draw does not paint. `readPixels` errors and leaves `readback` unchanged. The host receives the Gulf image for the new tile, and every tile after that, until reload.

`dropContextState` also never drops `this.framebuffer` or `this.buffer`. A loss that is noticed falls through to the CPU path and then stays there, because the next bake still binds the dead framebuffer.

Fix: on `webglcontextlost`, drop every GPU object, including the framebuffer and the buffer, and do it before the restore. On the next bake, create them again. Do not call `readPixels` unless the framebuffer is complete. The overlay has the same hole (`src/render/webgl2.ts:505-518`): after restore it draws with dead textures and the canvas stays blank, and nothing tells the host to rebuild it. The 0.1.1 note says the host must recreate the overlay. The host is never told.

If we skip it: after a backgrounded tab, tile layers show the wrong geography with no error. The overlay shows no data. The CPU fallback does not take over once the context is already restored.

## Should fix

### 3. Canvas2D leaves the previous frame up when the draw is rejected

`src/render/canvas2d.ts:157-158` (WebGL clears at `src/render/webgl2.ts:217-225`)

What this is: both backends refuse a frame whose `renderMode` does not match the overlay, and a scalar blend whose two sides are not the same value kind.

Problem: WebGL calls `clearIfDrawn()` and the canvas goes transparent. Canvas2D returns and the old pixels stay. Case: a scalar overlay has already drawn a Kd490 frame. The host then calls `renderAt` with an RGB frame on that same overlay. WebGL goes blank. Canvas2D (the fallback when WebGL2 is missing) still shows Kd490. The same split happens for a float32 frame blended with an encoded-u16 frame. Changelog 0.1.1 fixed the stale WebGL frame and not these two Canvas2D returns. Later returns in the same function do call `clear()`.

Fix: call the existing `clear()` on those two returns, as WebGL already does.

If we skip it: on machines without WebGL2, a bad frame swap looks like a successful paint of the previous dataset.

### 4. `renderAt` moves the picture and leaves the stretch behind

`src/overlay/grid-overlay.ts:383-414`

What this is: `setScalarFrame` is what registers the float grid with the stretch controller. The comment at `378-382` says a stretch that samples a different rectangle than the one on screen returns a plausible range for cells nobody is looking at.

Problem: only `setScalarFrame` updates that rectangle, and only when `options.bbox` is passed. `renderAt` stores the new bbox and paints it. The controller is not updated.

Case: `setScalarFrame(dataset)` for a grid whose centers run from lon `-90` to `-80.1`. Then `renderAt(frame, frame, 0, [-90, 25, -70, 35])`. The pixels are placed on the wider box. Viewport percentiles still come from the header rectangle. Values between `-80.1` and `-70` are colored with a range measured on other cells. A later `renderAt` that also changes `anchor` has the same split (cell-center sampling, cell-edge paint).

Fix: when `renderAt` paints a float32 frame that is the current stretch source, pass the new bbox and anchor into `setSource`. Do not let an encoded temporal frame clear that source. The README already says those frames do not drive stretch.

If we skip it: the legend and the ramp follow a region the map is no longer showing. The colors still look like a real stretch.

### 5. Temporal headers accept bytes that are not UTF-8

`src/core/decode/temporal.ts:411-414` (`src/core/decode/grid.ts:311-316` does not)

What this is: both decoders parse a length-prefixed JSON header from an untrusted buffer. The grid decoder uses `TextDecoder('utf-8', { fatal: true })` and rejects bad bytes. The temporal decoder uses `new TextDecoder()` with the default, which replaces bad bytes and continues.

Problem: a chunk whose `dates` string contains a lone `0xFF` still decodes. `JSON.parse` succeeds. The date text contains U+FFFD. Planes and masks are whatever followed the header. The frame is returned. A player that keys frames by date shows the wrong label, or drops the frame because it no longer matches the manifest.

Fix: use `TextDecoder('utf-8', { fatal: true })` and throw the same kind of error the grid decoder throws.

If we skip it: a corrupt or hostile chunk can rename a frame without failing the decode.

### 6. An inverted bbox blanks the layer and does not throw

`src/core/math.ts:270-273`, `src/overlay/stencil.ts:13-37`, `src/core/decode/temporal.ts:461-482`

What this is: `viewportDataProjection` turns a bbox into scale factors. `bboxHeight` is `Math.max(1e-9, north - south)`. The `/grid` decoder rejects an inverted bbox. The temporal manifest check and `loadCoastlineStencil` do not.

Problem: stencil bbox `[-90, 40, -80, 30]` has south `40` and north `30`. `north - south` is `-10`, so the height used is `1e-9`. Data `v` is huge and fails the `0…1` test. Stencil alpha is 0 everywhere, which clears the overlay (`destination-in` on Canvas2D, `stencilAlpha` on WebGL2). The same bbox passed as a temporal `manifest.bbox` into `renderAt` blanks the data the same way. Decode still returns the frames. No error is thrown.

Fix: in `decodeTemporalChunk` and `loadCoastlineStencil`, reject a bbox whose edges are not finite or whose south is greater than north or west is greater than east.

If we skip it: a swapped pair in a manifest makes the whole layer disappear. The samples themselves are fine, so the failure looks like a render bug.

## Nice to have

### 7. The zoomed-out Canvas2D path ignores the cell-center anchor

`src/render/canvas2d.ts:160-161` and `186-210`

What this is: when a grid cell is at most 1.5 CSS pixels, Canvas2D colors one pixel per cell and `drawImage` scales that image onto the bbox. The screen-space path, which runs when a cell is larger, does use `bboxAnchor`.

Problem: the scaled image is correct for `cell-edge` (the temporal default): each cell's pixel fills that cell. It is wrong for `cell-center` (the `/grid` default). The bbox runs from the first center to the last, but the bitmap is stretched edge to edge across it. On a 100-column grid the first center lands about half a cell in from the west edge. WebGL2 places that center on the west edge (`webgl2.ts:285`).

The path only runs when a cell is ≤ 1.5 CSS pixels, so the shift is ≤ 0.75 CSS pixels (about one device pixel at 2×). Above that threshold the screen-space path matches WebGL.

Fix: when the anchor is `cell-center` and this fast path is used, inset the blit by half a cell, or use the screen-space path for that anchor.

If we skip it: with WebGL2 off, a zoomed-out `/grid` layer sits under one pixel off the basemap at the edges.

## Left out

6 smaller items, no separate finding:

- Dateline-crossing boxes. The README lists this as a v1 limit.
- `core/math.ts` `normalizeValue` returns a number for an inverted range. The render path uses `color/normalize.ts`, which throws. The core function is the deprecated export.
- `displayValueFromEncoded` uses linear math when a log range is not positive. The canonical normalize then returns null, so the pixel is transparent.
- Stretch stride can skip the last row or column. That is the documented subsampling, pinned to the Swift stride.
- Legacy Canvas2D RGB ignores `style.sampling`. The README says that on purpose.
- `tileProjection` does `2 ** z`. A `z` of 1024 makes the span `Infinity`. Real hosts do not send that.

## Verdict

Fix the overview buckets and the tile context-restore path before this package is trusted for a v2 water layer or a map that stays open. The decode caps, the scalar kernel, and the Mercator viewport math are in good shape. The other items mislead an operator only on a bad frame, a bad bbox, or the CPU fallback.

Not checked: I did not run the unit tests, a browser, or a real WebGL context. I did not byte-compare the parity PNGs or regenerate the Swift and Python fixtures. I did not measure shader float error at z16–z20 (the README already points at GeoGridWeb issue 17). I did not read every assertion in the large test files. Public exports are treated as used by other repos. Every other path in `narduk-libs` is another lane.
