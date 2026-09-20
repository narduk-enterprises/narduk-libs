---
'@narduk-enterprises/narduk-mapkit': minor
---

Export `useMapKitView()` and `useMapKitFullscreen()` from a new
`@narduk-enterprises/narduk-mapkit/nuxt/composables` subpath.

Both are public API already: the Nuxt module registers them with `addImports`,
and `./nuxt` exports their option and result types. Only the functions were
unreachable by an explicit import -- the exports map has no pattern entry, so a
caller outside Nuxt's auto-import had no door at all. That bites a unit test
under plain vitest, an app running with `imports.autoImport` off, and any module
that wants the function rather than the ambient name.

`useMapKit()` is deliberately not on the new subpath: it reads the module's
runtime options through `#imports`, a specifier that resolves only inside a Nuxt
build, so a subpath carrying it would throw on import anywhere else. The two
that are exported need Vue and nothing more, because `useMapKitView()` takes its
MapKit namespace from the `map-ready` payload rather than from the kit handle.

`./nuxt` itself is unchanged: it stays the module entry and must not drag Vue's
runtime into the graph Nuxt loads modules from.
