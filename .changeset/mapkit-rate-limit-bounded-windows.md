---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

`createMapKitFixedWindowRateLimit` no longer keeps a window for every client it has ever seen. Expired windows are dropped as time passes, and a new `maxKeys` option (default 10,000) caps the live windows; past the cap the oldest is dropped and that client starts a fresh window. The per-client `cf-connecting-ip` keying in the docs is now bounded under traffic from many addresses.
