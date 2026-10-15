---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

Recover a tab that outlived a deploy. A new client plugin handles
`vite:preloadError`, Nuxt's `app:chunkError` and router errors that carry
"Importing a module script failed" (Safari), "Failed to fetch dynamically
imported module" (Chrome) or "error loading dynamically imported module"
(Firefox), and does one hard reload to the page being opened instead of showing
a 500. A `sessionStorage` guard allows one reload per 10 seconds so a deploy that
is really missing a chunk cannot loop, and it fails closed when storage is
unavailable.

Opt out with `appConfig.narduk.chunkReload = false`. The pure matcher and guard
(`isChunkLoadError`, `claimChunkReload`, `reloadForChunkError`,
`isChunkReloadEnabled`, `CHUNK_RELOAD_STORAGE_KEY`, `CHUNK_RELOAD_WINDOW_MS`) are
exported from `@narduk-enterprises/narduk-core/shared/chunk-reload` so an app's
error page can reuse them.
