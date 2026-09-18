---
'@narduk-enterprises/narduk-tenancy': minor
---

**BREAKING (0.x minor): `actorUserId` is required, and identified actors are
ranked (narduk-libs#213).**

Rank floor. An identified actor may grant a role, or act on a member who holds
one, only at or below their own org role, or the call throws
`TenancyError('forbidden')`. It covers `addMember`, `setMemberRole`,
`removeMember`, `setResourceRoleOverride`, `clearResourceRoleOverride`,
`createInvite` and, new, `acceptInvite`: an invite is refused `forbidden` once
its inviter is no longer a member holding the invite's role or above, checked
before the claim and again inside it. An admin can no longer make itself an
owner, or demote, remove or narrow an owner, and an actor who is not a member of
the org is refused before anything about the target is read. `setMemberRole` and
`removeMember` re-assert both roles inside the write and answer `conflict` if
either moved. Apps that want "strictly below" or an admin floor keep that check
in their routes; the package enforces only the floor.

Mandatory actor. `actorUserId` is now required on `addMember`, `setMemberRole`,
`removeMember`, `setResourceRoleOverride`, `clearResourceRoleOverride`,
`revokeInvite` and `revokeSupportGrant`. Omitting it no longer means a system
call: a missing, `null`, empty or blank value throws `TenancyError('invalid')`
before anything is read. A call no user makes passes the new exported marker
`TENANCY_SYSTEM_ACTOR` (a `Symbol.for` symbol, so no request input can equal
it); it is not ranked and is audited with a null actor, exactly as an omitted
actor was before.

Migration:

- Every mutation above now needs `actorUserId`. Pass the signed-in user's id
  from the route, as most routes already do. TypeScript flags each call that
  omits it.
- For seeding, migrations, backfills and platform tooling, pass
  `actorUserId: TENANCY_SYSTEM_ACTOR`, imported from
  `@narduk-enterprises/narduk-tenancy/server/utils/tenancy` (Nitro auto-imports
  it too). Do not substitute a made-up string such as `'system'`: a string is
  ranked as a user id and refused as a non-member.
- Callers that passed `actorUserId: null` for a system call must switch to the
  marker.
- Fixtures whose actor or inviter is not a member, or ranks below the role it
  hands out, now get `forbidden` and need a real member of sufficient rank.
- An outstanding invite whose inviter has since been demoted below its role or
  removed can no longer be accepted; re-issue it from a member in rank.
