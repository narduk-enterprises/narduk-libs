---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

New `@narduk-enterprises/narduk-core/server/wait-until`, the background-work helper five apps hand-rolled (#991). `resolveWaitUntil(event)` returns the runtime's `waitUntil` bound to its owner, looking at `event.waitUntil`, then the Cloudflare `ExecutionContext`, then `event.context.waitUntil`, and walks a Nitro internal fetch to its SSR parent event. `runInBackground(event, task, { onError, fallback })` hands the task to it with its rejection observed, and detaches or awaits it when no `waitUntil` exists; it never rejects. `withD1Cache` now uses the same resolver for its stale refresh, so the refresh also survives an internal fetch.
