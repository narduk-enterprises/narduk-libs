---
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/narduk-ai': minor
'@narduk-enterprises/narduk-testkit': minor
---

Migrate this repo's three list endpoints onto the shared list-query contract
(`parseListQuery` + `listResponse`, narduk-libs#257). Each route keeps its own
page ceiling and its own sort allowlist; what changes is the wire shape, so
**consumers must be updated together with the module**.

**`GET /api/admin/users`** (narduk-auth)

- Request: `page` is gone — page with `offset` (`offset = (page - 1) * limit`).
  `limit` above the route's ceiling of 100 is now **clamped to 100** instead of
  answering 400. Unknown query keys now answer 400. `sort` accepts
  `createdAt:asc|desc`, defaulting to `createdAt:desc` (previously the
  descending order was fixed).
- Response: `{ users, page, limit, total }` →
  `{ items, total, limit, offset, sort, q }`. `total` is still a real count.

**`GET /api/notifications`** (narduk-auth)

- Request: `offset` is now honoured (it was previously ignored, so every caller
  got page one). `unreadOnly` must be the string `'true'` or `'false'`; any
  other value answers 400 rather than being coerced to `false`. Unknown query
  keys answer 400. `limit` ceiling stays 100, default 50.
- Response: `{ notifications }` → `{ items, total, limit, offset, sort, q }`,
  with `total: null` — this route deliberately does not count, which keeps a
  page to a single statement.

**`GET /api/admin/system-prompts`** (narduk-ai)

- Request: previously accepted no parameters. It now accepts `limit` (ceiling
  and default 500), `offset`, `q` and `sort` over `name` and `updatedAt`.
  Unknown query keys answer 400.
- Response: a bare `AdminSystemPrompt[]` →
  `{ items, total, limit, offset, sort, q }` with `total: null`. Ordering is now
  deterministic (`name:asc` by default); it previously relied on the database's
  natural order.

**Migration.** An app consuming these endpoints directly reads `data.items`
instead of `data.users` / `data.notifications` / the bare array, and pages with
`offset` instead of `page`. The bundled composables and components
(`useNotifications`, `useAdminAi`, `AdminUsersTab`) are already updated and keep
their existing public shapes, so apps using those need no change.

**narduk-testkit**'s e2e contracts follow the new shapes:
`expectNotificationList` expects `{ items }`, and the users-api spec pages by
`offset` and asserts the contract's validation behaviour (including `limit=9999`
now returning 200 with `limit: 100`, where it previously asserted a 400).
