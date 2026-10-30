---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/narduk-logging': patch
'@narduk-enterprises/create-narduk-app': patch
---

Cut per-request and cold-isolate work on the request path (riverstatus#669).

- narduk-logging: the `h3` `useLogger` builds one logger engine per distinct set of options and
  binds each request's identity with `withContext`, instead of creating a consola engine for every
  request. Records are unchanged. The engine's `diagnostics` counters are now shared by the
  requests that use it, and `close()` on a request logger now closes that shared engine for later
  requests with the same options (nothing in this repo calls it).
- narduk-core: `resolveLoggingOptions` reads `LOG_LEVEL` alone instead of copying every Worker
  binding on each call, and the scheduled-jobs default logger is built once per isolate.
- narduk-core: a stored narduk-data artifact is hashed once when read, not a second time after.
- narduk-core: `readBoundedBody` reads a body with a declared `content-length` within the ceiling
  (and no `content-encoding`) in one call. The ceiling is still checked on the bytes received.
