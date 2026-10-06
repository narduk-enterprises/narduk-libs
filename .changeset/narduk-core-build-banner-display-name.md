---
'@narduk-enterprises/narduk-core': patch
---

The `[build]` console banner reads an optional
`runtimeConfig.public.appDisplayName` and falls back to `appName`, so an app
whose product name differs from its analytics key (Lake Status keeps
`appName: 'LakeStat'` for the PostHog `app` join) can name itself for readers
without moving that key. `window.__NARDUK_BUILD__.appName` is unchanged (#1498).
