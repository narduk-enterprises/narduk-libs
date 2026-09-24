---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Resolve Cloudflare bindings on Nitro internal SSR fetches so a nested
`useFetch` / `$fetch` keeps the Worker `DB` (narduk-libs#49). When an event
carries no `event.context.cloudflare`, the worker-env resolver behind
`useDatabase`, KV, Hyperdrive and rate-limit helpers now falls back to the
isolate env Nitro's cloudflare presets set on `globalThis.__env__` for every
fetch and scheduled event; with neither present it still fails closed. No
`AsyncLocalStorage.enterWith()`, which workerd does not implement.
`create-narduk-app` is a companion patch so the generator pin moves with
core.
