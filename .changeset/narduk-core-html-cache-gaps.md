---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-core': minor
---

narduk-core `nardukCore.htmlCache` gaps for app-local cache swaps, source-compatible with
existing `{ routes: string[], ttlSeconds }` configs: a route entry may be
`{ path, ttlSeconds }` with its own TTL (the first matching entry wins); `skipHtmlCache(event)`
(Nitro auto-import) and `useSkipHtmlCache()` (app composable, no-op in the browser) mark a
render as not storable (`x-html-cache: skip`); a render with
`event.context.nardukPreferencesInfluenced === true` is never stored; nothing is read or
written when `runtimeConfig.public.previewSafeMode === true`; paths over 200 characters
(`HTML_CACHE_MAX_PATH_LENGTH`) always render.
