---
'@narduk-enterprises/narduk-tenancy': minor
---

`revokeInvite` and `revokeSupportGrant` now check the actor belongs to the
record's org before revealing anything (#1061). An identified actor from
another org gets the same `not_found` a made-up id gets, whatever state the
record is in, and nothing is revoked or audited. A support grant's own grantor
and grantee may still revoke it without a membership. Both accept an optional
`orgId`: pass the route's org and a record from any other org is `not_found`.
