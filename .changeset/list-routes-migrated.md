---
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/narduk-ai': minor
'@narduk-enterprises/narduk-testkit': minor
---

Migrate this repo's three list endpoints onto the shared list-query contract
(`parseListQuery` + `listResponse`, narduk-libs#257). Each route keeps its own
page ceiling and its own sort allowlist. None of the three implements free-text
search, so all three declare `searchable: false` and answer 400 for a non-empty
`q` rather than accepting it and returning an unnarrowed page.

**Compatibility.** Previously-accepted query keys and response fields stay
accepted / present. New contract fields are additive. Drop the deprecated
aliases in the next major of each package, once fleet apps read `items`.

**`GET /api/admin/users`** (narduk-auth)

- Request: `page` is still accepted and converted to
  `offset = (page - 1) * limit`. `offset` is the new key. Sending both with
  disagreeing values answers 400. `limit` above the route's ceiling of 100 is
  now **clamped to 100** instead of answering 400 (more permissive). `sort`
  accepts `createdAt:asc|desc`, defaulting to `createdAt:desc` (previously the
  descending order was fixed). Unknown keys now answer 400.
- Response: the contract shape `{ items, total, limit, offset, sort, q }` plus
  the deprecated aliases `{ users, page }` so existing consumers keep working.

**`GET /api/notifications`** (narduk-auth)

- Request: `unreadOnly` is still any string; only `'true'` filters (the
  pre-contract behaviour). `offset` is now honoured (it was previously ignored).
  Unknown query keys answer 400. `limit` ceiling stays 100, default 50.
- Response: the contract shape plus the deprecated alias `{ notifications }`.
  `total` is `null` — this route deliberately does not count, which keeps a page
  to a single statement.

**`GET /api/admin/system-prompts`** (narduk-ai)

- Request: previously accepted no parameters (extras were ignored). It now
  accepts `limit` (ceiling and default 500), `offset`, and `sort` over `name`
  and `updatedAt`. Unknown query keys answer 400.
- Response: a bare `AdminSystemPrompt[]` cannot also be a `{ items, … }` object,
  so the wire shape is the contract envelope with `total: null`. The bundled
  `useAdminAi` composable still exposes `AdminSystemPrompt[]` (and still accepts
  a bare array from an older server). No fleet app `$fetch`es this route
  directly (GitHub search, 2026-09-11); stonx, operator-portal and riverstatus
  do not consume it. Ordering is now deterministic (`name:asc` by default).

**Migration (optional).** New callers read `data.items` and page with `offset`.
Apps using the bundled composables and components (`useNotifications`,
`useAdminAi`, `AdminUsersTab`) keep their existing public shapes.

**narduk-testkit**'s e2e contracts follow the new shapes and still assert the
legacy aliases: `expectNotificationList` expects `{ items, notifications }`, and
the users-api spec accepts `page`, asserts `{ items, users, page }`, and checks
that `limit=9999` now returns 200 with `limit: 100`.
