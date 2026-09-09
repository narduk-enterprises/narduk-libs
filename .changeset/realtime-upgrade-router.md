---
'@narduk-enterprises/narduk-realtime': minor
---

Route WebSocket upgrades to a Durable Object from the generated Worker entry.
`realtime.upgrades` declares each upgradeable route with its binding, the route
parameter that names the object, and an `authorize` module that normally re-uses
the app's own guards through an in-process `authorizeViaRoute` probe. A refusal
is returned to the client verbatim; a forwarded request keeps the upgrade
headers, drops credentials and the client-connection headers unless
`forwardHeaders` names them, and carries only the principal the authoriser
returned -- every inbound `x-narduk-*` header is stripped first. No 101 is
produced outside the object's own hibernating `acceptWebSocket`, so
`nitro.experimental.websocket` and crossws stay out of it.
