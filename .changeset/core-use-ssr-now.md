---
'@narduk-enterprises/narduk-core': minor
---

New auto-imported composable `useSsrNow(key, { tickMs? })`: a render-safe
"now" for relative times. The server reads `Date.now()` once into
`useState('narduk:now:<key>')`, the client hydrates with that same value (no
hydration mismatch across a minute boundary), and after mount it switches to
the browser clock, optionally re-reading it every `tickMs` and clearing the
interval on unmount. Returns a readonly `Ref<number>`. It generalises Buoys'
`useStationPageClock`, `map:now` and `stations:now`. The lifecycle half is also
exported as `createSsrNowClock(stateRef, options)` from `./app/utils/ssrNowClock`.
