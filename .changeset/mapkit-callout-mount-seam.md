---
'@narduk-enterprises/narduk-mapkit-nuxt': patch
---

Add a mount test for `AppMapKit`'s callout wiring (`selectedId` open/close,
`calloutMode`/`calloutPlacement` forwarding, Escape-dismiss syncing back to
`selectedId`) via a new `isClientEnvironment()` seam around the
`import.meta.client` guard in `ensureCalloutController()`. No production
behavior changes — the seam still reads the same macro — this only makes the
client-only branch reachable from a plain Vite/vitest mount test.
