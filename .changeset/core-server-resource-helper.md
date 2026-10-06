---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `defineServerResource()` and `useSharedNow()`. A server resource is one
keyed server read shared by every screen that shows it: SSR hydration without a
second read, a freshness stamp and TTL, optional polling paused while hidden,
keepAlive, write actions that refresh the keys they declare (with the CSRF
header), and a `loading | ready | absent | error` state that keeps the last good
value beside an error. `useSharedNow()` is the app's one clock: the SSR instant
hydrated, ticking at the fastest mounted cadence, paused while hidden.
