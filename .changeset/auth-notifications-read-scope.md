---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

Security: `GET /api/notifications` and `GET /api/notifications/unread-count` no
longer answer any API key. A session still reads without a scope; an `nk_` key
now needs the new `auth:notifications:read` scope (or `*`), and a key that has
other scopes, such as an app's household MCP key, or none gets 403. Previously
only the mutation routes (`auth:notifications:write`) were scoped, so any key
could read its owner's notifications (harbor#841).
`AUTH_NOTIFICATION_SCOPES.read` is exported beside `.write`. Consumers that read
notifications with a key must add `auth:notifications:read` to that key; no
in-repo consumer does.
