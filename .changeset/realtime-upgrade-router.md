---
'@narduk-enterprises/narduk-realtime': minor
---

Route WebSocket upgrades to a Durable Object from the generated Worker entry.
`realtime.upgrades` declares each upgradeable route with its binding, the route
parameter that names the object, and an `authorize` module that normally re-uses
the app's own guards through an in-process `authorizeViaRoute` probe. A refusal
is returned to the client verbatim.

The router fails closed. An entry that declares no `authorize` fails
`nuxt build` naming the option's index and the field, and only an explicit
`allowUnauthenticated: true` -- for an object that authorises the socket itself
-- forwards an unchecked handshake; a hand-written `createUpgradeRouter` refuses
the same configuration. Only a `GET` is routed, so the object never sees a
method the authorising probe did not use. Each route carries an origin policy,
compared before the authoriser: same-origin over https by default, an
`allowedOrigins` allowlist in its place (`*` rejected), and a request with no
`Origin` refused unless `allowMissingOrigin: true` -- a WebSocket handshake is
exempt from CORS, so on a cookie-authorised socket that comparison is the only
cross-site check there is.

A forwarded request keeps the upgrade headers and `cf`, drops credentials and
the client-connection headers unless `forwardHeaders` names them, and carries
only the principal the authoriser returned -- which may only be in the router's
own `x-narduk-` namespace, any other header name being a 500. Every inbound
`x-narduk-*` header is stripped from every request the router sees, the ones it
hands back to the Nitro app included. No 101 is produced outside the object's
own hibernating `acceptWebSocket`, so `nitro.experimental.websocket` and crossws
stay out of it.
