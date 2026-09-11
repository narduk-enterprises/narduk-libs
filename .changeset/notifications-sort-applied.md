---
'@narduk-enterprises/narduk-auth': patch
---

Fix `GET /api/notifications?sort=` accepting and echoing the `sort` parameter
without ever applying it to the query — the response's `sort` field and the
actual row order silently disagreed (narduk-libs PR #282 review).
`ListNotificationOptions.sort` now threads through to `getUserNotifications`'s
Drizzle `orderBy`, honoring every key in the route's `SORTABLE` allowlist
(currently just `createdAt`, ascending or descending). This is a fix to
previously-declared contract behavior (the `sort` parameter has been part of
the shared list-query contract since narduk-libs#247), not new request/response
surface, hence patch.

Audited every other `parseListQuery` call site in narduk-auth and narduk-ai for
the same defect class (a declared sortable/searchable/filter key that never
reaches the query): `GET /api/admin/users` (narduk-auth) and
`GET /api/admin/system-prompts` (narduk-ai) already apply their `sort` option
correctly — no other fix needed.
