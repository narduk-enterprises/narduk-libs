---
'@narduk-enterprises/narduk-tenancy': patch
---

Prove cross-org isolation with a suite built on deliberately colliding data: two
orgs in one database sharing an identity, a resource id, an email, an actor, and
a clock, so a passing assertion can only come from org scoping rather than from
the fixtures happening to differ. It covers per-org role resolution for one
identity, resource-role overrides not bleeding across orgs, `listOrgsForUser`
returning only real memberships, the audit trail and support grants each
confined to their own org, an invitation landing only in the issuing org,
`removeMember` leaving the other org's membership and identically keyed override
intact, and a stranger being refused identically whether the org exists or not,
so the refusal is no existence oracle. Mutation-tested four ways to prove the
suite can fail.

Test-only: no runtime behaviour, no exported surface, and no published file
changes — `tests/` is outside the package's `files` list, so this release ships
an identical tarball.
