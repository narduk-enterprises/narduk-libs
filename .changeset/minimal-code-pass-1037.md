---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

Minimal-code pass (#1037), no behavior change: narduk-core drops the unused `@internal` `isLinkLocalIPv6Hextet`, moves the Nitro error-handler prepend into one module-side helper that orders the sanitizer and the JSON no-store handler in a single call (the runtime `prependNitroErrorHandler` copy, used only by tests, is gone), and marks the unused `getSessionGrantValidator` deprecated. narduk-auth keeps its per-request session and user row reads in one keyed cache.
