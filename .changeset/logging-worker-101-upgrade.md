---
'@narduk-enterprises/narduk-logging': patch
---

Fix `logRequest` throwing a `RangeError` on a 101 WebSocket upgrade response.

`logRequest` re-wrapped every handler response with
`new Response(response.body, response)` to attach correlation headers.
`new Response(body, init)` only accepts a status in 200–599, so a handler
returning a 101 Switching Protocols response (the normal shape for a Durable
Object WebSocket endpoint, as `@narduk-enterprises/narduk-realtime` uses) made
`logRequest` throw before the upgrade ever reached the client. The re-wrap would
also have dropped `webSocket`, the Cloudflare Workers upgrade extension carrying
the actual socket pair — the whole payload of an upgrade in workerd.

`logRequest` now returns a 101 (or any response carrying `webSocket`) untouched,
skipping the correlation-header and Server-Timing stamp it would otherwise add —
a protocol switch has no body to stream and nothing useful to attach one to.
