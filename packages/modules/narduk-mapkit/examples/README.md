# Examples

These examples are small integration patterns, not standalone apps.

- `hono-token-route.ts`: Fetch-style token endpoint for Hono or Worker-style
  servers.
- `nuxt-mapkit-token.get.ts`: Nuxt/H3 token endpoint that can read Cloudflare
  bindings.
- `browser-markers.ts`: Browser MapKit JS initialization, marker annotations,
  clustering, and shared region framing.
- `tile-overlay-crossfade.ts`: Animated MapKit tile overlay replacement for
  time-series raster layers.
- `layer-registry.ts`: Multiple live AOI tile overlays with independent opacity
  and replacement fades.
- `temporal-layer-controller.ts`: Date-strip scrub plus readiness-gated looping
  over a dated tile layer.
- `pointer-probe.ts`: Hover, click/tap, long-press, and drag probe plumbing for
  a map readout.
- `annotation-registry.ts`: Keyed marker reconciliation so an unchanged marker
  is never rebuilt.
- `render-coalescing.ts`: One flush per frame, skipped identical HTML writes,
  and focus preserved across a rewrite.
- `fullscreen.ts`: Viewport-overlay and native fullscreen for a map wrapper,
  with the fallback path wired up.
- `pin-scaling.ts`: Zoom-adaptive pin size, dot/symbol collapse, and rank
  culling over a keyed annotation set.
- `annotation-callouts.ts`: Anchored callouts for keyed markers, with in-place
  updates and a render/cleanup contract.

Copy the pattern that matches your runtime, then keep app-specific data
fetching, styles, and marker HTML in the app.
