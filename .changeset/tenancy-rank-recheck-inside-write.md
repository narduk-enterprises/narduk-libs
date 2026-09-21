---
'@narduk-enterprises/narduk-tenancy': patch
---

Re-check rank inside the write for every remaining tenancy mutation

`addMember`, `setResourceRoleOverride`, `clearResourceRoleOverride` and
`createInvite` ranked from a read made just before the write, not inside it. A
role change landing in that window let one change through against the roles as
they were read: a demoted admin could still add a member, set or clear a
resource override, or mint an invite.

Each now carries the rank inputs into the statement itself — an
`INSERT … SELECT … WHERE` for the two inserts, and a guarded `UPDATE`/`DELETE`
for the overrides — asserting that the actor still holds exactly the role the
check read and that the member still stands exactly as it read them. If either
moved, the call answers `conflict` and writes nothing, matching `setMemberRole`
and `removeMember`. In-rank callers are unaffected.
