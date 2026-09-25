---
'@narduk-enterprises/narduk-tenancy': minor
---

`requireSupportGrantOrRole` now passes when any active support grant on the org
covers the requested `scope`. It reads up to the 100 latest-expiring grants and
fails closed past that. It used to check only the latest-expiring grant, so a
support user holding a short `diagnostics:read` grant and a longer `logs:read`
grant was refused diagnostics. On a scoped check, the returned `supportGrant`
is now the grant that covers the scope. `resolveRole` accepts an optional
`supportScope` for the same selection, and `supportGrantScopes(grant)` is
exported. Grants that share an expiry are ordered by id, so selection is
deterministic.
