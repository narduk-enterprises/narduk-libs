---
'@narduk-enterprises/narduk-tenancy': patch
---

Create an org, its owner membership, and both audit rows in one
`runTenancyBatch`.

`createOrg` used four separate D1 auto-commits. A failed membership write after
the org insert left an ownerless row that burned the slug and never appeared in
`listOrgsForUser`. Invite acceptance already batched for this reason; org
creation now matches.

This is a patch: exported function signatures are unchanged. The behavior change
is a correctness fix, not a new API.

A concurrent `createOrg` that loses the unique-index race on `tenancy_orgs.slug`
or `tenancy_memberships (org_id, user_id)` now throws `TenancyError('conflict')`
instead of a raw D1/SQLite constraint message. The unique index remains the real
gate; the pre-read is still sequential UX only.
