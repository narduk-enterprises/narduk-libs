---
'@narduk-enterprises/narduk-mapkit': minor
---

Ship `<AppMapKit>` and `useMapKit()` from a new
`@narduk-enterprises/narduk-mapkit/nuxt` entry — a Nuxt 4 module that registers
the component, the composable, and the same-host token route (narduk-libs#422
§b, §c, §e).

**`itemKey` makes an `items` change a diff, not a rebuild.** This is the
buoys#112 root cause: without a stable key per item the pin layer had no way to
tell "the same 570 stations, three of them moved" from "570 different stations",
so every update tore the annotations off the map and rebuilt them — losing
selection, losing the open callout, and re-running every pin's element factory.
`itemKey` defaults to the item's `id` and the layer reports `added`, `moved`,
`removed`, and `restyled` through `getDiagnostics()`, which is what the
regression test asserts against (570 removes + 570 adds for the 2.0.x shape,
zero of either for a keyed move).

**`pinGeometry` is per pin.** 2.0.x had one global `annotationSize`, so an app
with two pin shapes could anchor only one of them correctly (narduk-libs#305).
`pinGeometry(item)` returns `{ anchor, anchorOffset, size }`; `anchor` defaults
to `'bottom-center'`. MapKit's `anchorOffset` positions the element's _top-left_
at the projected point, so the library derives the offset from the size rather
than leaving each app to rediscover that.

**`#callout` is a scoped slot rendered through a `Teleport`.** MapKit's own
callout can only contain DOM handed to it as an element, which is why a
`NuxtLink` inside one never routes. The slot receives
`{ close, id, item, placement, position }` and renders into a host the library
positions and re-projects on every region change; a host it cannot project is
hidden rather than stranded at a stale position.

**`libraries` is configurable and required.** The module's default is the
`['map', 'annotations', 'overlays']` triple 2.0.x hard-coded, but an app can now
narrow or widen it. It is resolved in `setup` rather than declared in the
module's `defaults`, because `defineNuxtModule` merges those with `defu`, which
concatenates arrays — a default there would make the option impossible to
narrow. An empty list throws at module setup instead of failing later at
`new mapkit.Map(...)`.

**`retry()` is on the exposed API**, and `#error` receives `{ failure, retry }`.
A MapKit failure clears the cached initialization, so recovery has to be the
caller's call.

Three defaults flip, each measured across the existing consumers:
`preserveRegion` (7 of 7 set it) and `suppressSelectionZoom` (4 of 5 selection
users set it) are now `true`, and `showsPointsOfInterest` (6 observed values,
all `false`) is now `false`.

SSR emits `renderHTMLAttributes()` through `useHead` from the _component_, not
from the module into the app head, so a page that renders no map makes no
request to `cdn.apple-mapkit.com`. It carries no token: a token in the tag is
MapKit's static, non-refreshable path.

The token route the module registers resolves its `self` through
`mapKitRoutedOrigin`, so an absolute-form request line cannot name the origin
claim, and `tokenRoutePath` now refuses a `//`-prefixed path at module setup —
it starts with `/` but is protocol-relative, so `fetchMapKitToken` would
otherwise only throw at first paint from inside the loader.

Otherwise it is the same fail-closed handler `/server` exports, plus a
fixed-window ceiling (`rateLimit: { limit: 30, windowSeconds: 60 }`) applied per
routed origin. An app that mounts narduk-core's own limiter on
`event.context.nardukMapKit.rateLimit` still wins; the default only means an
unconfigured JWT-signing route is not an unlimited one. The 2.0.x adapter's
zero-consumer surface is deliberately not carried over.

`@nuxt/schema` becomes an optional peer dependency: `dist/nuxt/index.d.ts` names
`NuxtModule`, which `@nuxt/kit` does not re-export.

Review round (Grok adversarial) on PR 436:

- `tokenRoutePath` and `fetchMapKitToken` now canonicalise `\` to `/` before the
  protocol-relative check. WHATWG treats `/\evil.example/mk` as
  `//evil.example/mk`, so a startsWith('//') check let a backslash path leave
  the serving origin.
- The method catch-all is a re-export of the GET handler. A dummy with empty
  credentials 503'd any GET that landed on it.
- `<AppMapKit>` passes `isRotationEnabled` into the Map constructor. MapKit JS
  defaults rotation on; omitting the flag ignored the documented `false`.
- The pin layer reads `pinGeometry` / `itemKey` from the live props, so a
  geometry-only `setProps` restyles in place instead of keeping the init-time
  anchor.

Review round 2 (Opus finish pass) on PR 436:

- The same canonicalisation now strips ASCII tab, LF and CR first. WHATWG
  removes those from the input BEFORE parsing, so `/<TAB>/evil.example/mk` and
  `/<TAB>\evil.example/mk` were still protocol-relative and the `\`-only fix did
  not see them.
