---
'@narduk-enterprises/narduk-platform': minor
'@narduk-enterprises/narduk-core': patch
---

Tolerate an unknown list-query key for one release instead of rejecting it with
a 400 (Logan, 2026-09-11). `.strict()` unknown-key rejection shipped as a
`minor` in the list-query contract (narduk-libs#257) but is
compatibility-narrowing for live fleet callers that were sending an extra query
parameter which used to be silently ignored — that is not an approved breaking
change, so this restores the previously-accepted behaviour for one release with
a warning attached, and keeps the stricter behaviour reachable for a route that
wants it today.

**narduk-platform** (`./list-query`):

- `listQuerySchema()` gains a `strict` option, default `false`. With
  `strict: false` (the default) an unknown query key no longer fails parsing:
  the request still succeeds with the known keys parsed exactly as before, and
  the caller-sent keys this route does not declare come back on the parsed
  result's new `unknownKeys: string[]` field (`[]` when there are none, or when
  `strict: true` rejected them before this field would ever be produced).
  `strict: true` restores exactly today's `.strict()` behaviour — a 400 naming
  the offending keys.
- The next major flips the `strict` default to `true`, so a route that wants
  today's rejection behaviour to survive that flip unchanged should pass
  `strict: true` now rather than relying on the current default.

**narduk-core** (`server/utils/listQuery`):

- `parseListQuery` forwards `strict` to the schema unchanged.
- When an unknown key is tolerated, `parseListQuery` logs one structured `warn`
  per request through narduk-logging (`useLogger(event)`, not a dev-only
  `console.warn`, so it reaches a fleet operator's normal log aggregation in
  production) naming every ignored key and stating they will be rejected with a
  400 once `strict` defaults to `true` in the next major. The warning never
  fires when there are no unknown keys.

**Compatibility.** This is a fix to the `.strict()` `minor` shipped in
narduk-libs#257/#282, not a new breaking change: a caller relying on today's
400-on-unknown-key behaviour keeps it by passing `strict: true`; every other
caller regains the pre-`.strict()` tolerance. narduk-auth's
`GET /api/admin/users` and `GET /api/notifications`, and narduk-ai's
`GET /api/admin/system-prompts`, all use the default (non-strict) mode, so an
unknown query key sent to any of them now answers 200 with a logged warning
again, matching `.changeset/list-routes-migrated.md`'s "previously-accepted
query keys stay accepted" framing, which this text now restates accurately
instead of contradicting.

Refs narduk-libs#247, narduk-libs#257.
