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
