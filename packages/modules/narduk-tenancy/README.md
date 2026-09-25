# @narduk-enterprises/narduk-tenancy

Generic multi-tenancy for Narduk Nuxt apps on Cloudflare D1: organizations,
memberships, roles, per-resource role overrides, invitations, time-boxed support
grants, and an audit trail.

The package is deliberately generic (company-hq D-7, narduk-libs#171). It knows
nothing about vessels, boats, fleets, or any other product noun: a resource is a
`resource_kind` plus an opaque `resource_id`, and the first consumer maps
`resource_kind: 'vessel'`. It also knows nothing about identity: users are
opaque `user_id` text owned by the consuming app (narduk-core / narduk-auth
`users.id`), there is no foreign key across that boundary, and this package
imports nothing from narduk-auth.

## Non-goals

- No authentication, session, or user table. The consumer resolves the caller.
- No Postgres schema. D1/SQLite only — a Postgres-backed consumer gets a clear
  absence rather than a type-checked non-functional path (narduk-libs#94).
- No pages, components, or runtime config. The Nuxt module wires server code.

## Install

```bash
pnpm add @narduk-enterprises/narduk-tenancy
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-tenancy/nuxt'],
})
```

The module registers `server/` for Nitro auto-imports and inlines the package
for the Nitro build. Pass `{ server: false }` to import everything explicitly
instead.

## Migrations

The package ships its own additive D1 migrations. Register the directory in the
app's `migrations.sources.json`:

```json
{
  "schemaVersion": 1,
  "sources": [
    {
      "id": "@narduk-enterprises/narduk-core",
      "dir": "node_modules/@narduk-enterprises/narduk-core/runtime/drizzle"
    },
    {
      "id": "@narduk-enterprises/narduk-tenancy",
      "dir": "node_modules/@narduk-enterprises/narduk-tenancy/drizzle"
    },
    { "id": "app", "dir": "drizzle" }
  ]
}
```

`drizzle/0001_tenancy.sql` is `CREATE TABLE IF NOT EXISTS` throughout and
`drizzle/0002_org_list_indexes.sql` is `CREATE INDEX IF NOT EXISTS` throughout,
neither with a down-migration, so a Worker rolled back to a version without
tenancy simply ignores the tables.

### Indexes for an org console (0002)

`0002` adds three indexes for reads a _consuming app_ issues -- this package
ships no paged member or invite list, but it owns the schema, so it owns the
schema's indexes rather than leaving every app to carry them (narduk-libs#229):

| Index                                    | Serves                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `tenancy_memberships_org_created_at_idx` | `WHERE org_id = ? ORDER BY created_at, ... LIMIT ?`                                  |
| `tenancy_invites_org_created_at_idx`     | the same shape over invitations                                                      |
| `tenancy_invites_org_pending_idx`        | `WHERE org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?` |

Neither read was ever a full table scan -- `0001`'s `(org_id, user_id)` and
`(org_id, email)` indexes already narrow to one org. What `0002` changes is the
work done _inside_ the org, which `tests/tenancy-org-list-indexes.test.ts`
measures by counting the rows each query visits:

| Read                         | Axis                                   | Before `0002`     | After `0002`  |
| ---------------------------- | -------------------------------------- | ----------------- | ------------- |
| one 200-member page          | org grows 200 -> 1 000 -> 5 000        | 200, 1 000, 5 000 | 200, 201, 201 |
| one 200-invite page          | org grows 200 -> 1 000 -> 5 000        | 200, 1 000, 5 000 | 200, 201, 201 |
| live invitations (5 of them) | accepted invites 0 -> 50 -> 500        | 5, 55, 505        | 5, 5, 5       |
| live invitations             | live invites 1 -> 5 -> 25, 50 accepted | 51, 55, 75        | 1, 5, 25      |

So a member or invite page costs the page rather than the org, and the
live-invite list and its `count(*)` cost the invitations that are still live
rather than every invitation the org has ever issued. The last row is the
control that the index is not simply hiding work: a larger live set is still
larger, because those rows are the answer.

An app already carrying these verbatim in its own migration finds them present
rather than duplicated: package sources are ordered before app sources, and
every statement is `IF NOT EXISTS`.

## Schema

Six tables, all prefixed `tenancy_`. Timestamps are millisecond epoch integers.

| Table                             | Holds                                                           |
| --------------------------------- | --------------------------------------------------------------- |
| `tenancy_orgs`                    | org identity: unique `slug`, `name`, creator                    |
| `tenancy_memberships`             | one role per (org, user); `UNIQUE(org_id, user_id)`             |
| `tenancy_resource_role_overrides` | a narrowed role for one (org, resource_kind, resource_id, user) |
| `tenancy_invites`                 | digest-only, single-use, TTL-bounded invitations                |
| `tenancy_support_grants`          | time-boxed read-only diagnostic access (ADR-0010)               |
| `tenancy_audit_events`            | one row per mutation                                            |

The drizzle schema is exported from
`@narduk-enterprises/narduk-tenancy/server/database/tenancy-schema`, and
`tests/schema-migration-parity.test.ts` keeps it in step with the SQL.

## Roles

```ts
import {
  TENANCY_ROLES,
  roleAtLeast,
} from '@narduk-enterprises/narduk-tenancy/shared/utils/roles'

TENANCY_ROLES // ['owner', 'admin', 'operator', 'crew', 'viewer'] — most privileged first
roleAtLeast('admin', 'crew') // true
```

`support` is **not** a role. Support access is a time-boxed, read-only
diagnostic grant (ADR-0010) with a reason, a scope list, a granter, and a hard
expiry the service enforces (TTL in `(0, 86400]` seconds). None of that survives
being modelled as a membership row.

**Overrides narrow, never raise.** `setResourceRoleOverride` rejects (`invalid`)
any role more privileged than the member's org role, so an override can only
reduce access on one resource. An override equal to the org role is allowed: it
is not a raise, and it is what a resource-scoped invite records.

**The rank floor.** An identified actor may grant a role, or act on a member who
holds one, only at or below their own org role (`roleAtLeast`), or the call is
refused `forbidden`. It applies to `addMember`, `setMemberRole` (both the
member's current role and the new one), `removeMember`,
`setResourceRoleOverride`, `clearResourceRoleOverride` and `createInvite`, and
again when an invite is accepted. So an admin cannot make itself or anybody else
an owner, cannot demote, remove, narrow or un-narrow an owner, and nobody can
raise their own role. Anybody may still lower their own role or leave, subject
to the last-owner rule. An actor is ranked by their org membership, never by a
role an override narrowed, and an actor who is not a member is refused before
anything about the target is read.

The floor is the least the package enforces, not a hierarchy. Whether an admin
may manage another admin, or whether managing anybody needs at least admin, is
route policy: consumers answer it differently, so a route that wants "strictly
below" or an admin floor checks it itself before calling the service
(narduk-libs#213).

Every mutation asserts its rank inputs again **inside** the write, so a role
that moves between the check and the write cannot let one change through against
the roles as they were read (narduk-libs#213, narduk-libs#537):

- `setMemberRole` and `removeMember` carry them into the UPDATE/DELETE;
  `addMember` and `createInvite` into an `INSERT … SELECT … WHERE`;
  `setResourceRoleOverride` into whichever of its UPDATE or INSERT it makes; and
  `clearResourceRoleOverride` into its DELETE.
- What each one asserts: the actor still holds exactly the org role the check
  read, and the member still stands exactly as it read them — at that role, or
  still not a member at all, since a membership _appearing_ in the window would
  be handed a role the check ranked against nobody.
- If any of that moved, the call answers `conflict` and writes nothing. The
  caller retries, and the check then runs against the new state. `not_found`,
  `forbidden` and `last_owner` still answer for a state that was already true
  when the service read it; `conflict` means only that it changed underneath.
- `acceptInvite` re-checks that the inviter is still a member holding the
  invite's role or above, both before the claim and inside it, so an invite does
  not outlive its inviter's demotion or departure. It answers `forbidden` (or
  `conflict` if the demotion races the claim).

The re-checks are pinned by deterministic interleaves
(`tests/support/interleave.ts` runs a concurrent change at the moment of the
write) on both the better-sqlite3 and the Miniflare D1 driver.

## Service

```ts
import { createTenancy } from '@narduk-enterprises/narduk-tenancy/server/utils/tenancy'

const tenancy = createTenancy(db) // db: the app's D1-shaped drizzle database

const org = await tenancy.createOrg({
  slug: 'acme',
  name: 'Acme',
  createdByUserId: userId,
})
await tenancy.addMember({
  orgId: org.id,
  userId: mateId,
  role: 'crew',
  actorUserId: userId, // required: the acting user, ranked (see Roles)
})

const { role, source, supportGrant } = await tenancy.resolveRole({
  orgId: org.id,
  userId: mateId,
  resource: { kind: 'vessel', id: vesselId },
})
```

**`actorUserId` is required** on every mutation that takes it: `addMember`,
`setMemberRole`, `removeMember`, `setResourceRoleOverride`,
`clearResourceRoleOverride`, `revokeInvite` and `revokeSupportGrant`. Pass the
acting user's id, or `TENANCY_SYSTEM_ACTOR` for a call no user makes, such as
seeding, a migration or platform tooling:

```ts
import {
  createTenancy,
  TENANCY_SYSTEM_ACTOR,
} from '@narduk-enterprises/narduk-tenancy/server/utils/tenancy'

await tenancy.addMember({
  orgId,
  userId,
  role: 'owner',
  actorUserId: TENANCY_SYSTEM_ACTOR,
})
```

A system call is not ranked and is audited with a null actor. A missing, `null`,
empty or blank `actorUserId` is refused `invalid` before anything is read, so
leaving the field out never silently becomes a system call. The marker is a
symbol, so no request input can equal it. `createOrg`, `createInvite` and
`createSupportGrant` already name their actor (`createdByUserId`,
`invitedByUserId`, `grantedByUserId`) and have no system path.

`createTenancy(db, options)` accepts `{ now, idGenerator, tokenGenerator }` so
tests own time, ids, and tokens. Operations:

- orgs: `createOrg`, `getOrg`, `listOrgsForUser`
- members: `addMember`, `setMemberRole`, `removeMember`
- overrides: `setResourceRoleOverride`, `clearResourceRoleOverride`
- resolution: `resolveRole`
- invites: `createInvite`, `acceptInvite`, `revokeInvite`
- support: `createSupportGrant`, `revokeSupportGrant`, `listActiveSupportGrants`
- audit: `listAuditEvents`

Failures throw `TenancyError` with `code` in
`not_found | forbidden | conflict | invalid | expired | last_owner`. The last
owner of an org can be neither demoted nor removed, including concurrent changes
to different owners. The final-owner predicate executes inside the mutation.

### Invites

`createInvite` returns `{ invite, token }`; the raw token is returned exactly
once and only its SHA-256 digest is stored. `acceptInvite({ token, userId })` is
single-use, expiry-checked, revocation-checked, and idempotent for the accepting
user — a second user presenting the same token gets `conflict`.

**The consumer owns email verification.** Pass the identity provider's verified
address as `acceptInvite({ token, userId, verifiedEmail })` to enforce a
matching invite address before any mutation. Never populate `verifiedEmail` from
an unverified request body. Omitting it preserves the bearer-invitation
contract: acceptance binds to the token presenter without an email comparison.

Claiming an invitation, granting membership, applying an optional override, and
recording their audit events execute in one transaction. Concurrent presenters
cannot both win; a failed write rolls back the claim so it can be retried. A
replayed accepted token never restores a subsequently removed membership.

Accepting promotes an existing membership when the invite role is higher, and
never demotes. A resource-scoped invite additionally writes a narrowing override
for that resource.

### Database typing

The service accepts the D1-shaped drizzle database (`LayerDatabase` in
narduk-core). Atomic invitation acceptance uses Drizzle's D1 `batch()`; direct
better-sqlite3 consumers use their driver's synchronous transaction. Pass the
real database object, including its batch/client capability, rather than a
wrapper exposing only query-builder methods. Unsupported adapters fail before
claiming an invitation. Tests run the shipped migration against real in-memory
SQLite behind one documented type adapter.

## Guards

```ts
import { requireOrgRole } from '@narduk-enterprises/narduk-tenancy/server/utils/guards'

export default defineEventHandler(async (event) => {
  const { userId, role } = await requireOrgRole(event, {
    orgId,
    minimum: 'operator',
    resource: { kind: 'vessel', id: vesselId },
    tenancy,
    resolveUserId: (e) => getSessionUserId(e),
  })
})
```

`requireOrgRole` throws 401 `{ errorCode: 'unauthenticated' }` when the resolver
returns no user and 403 `{ errorCode: 'entitlement_denied' }` when the effective
role is below `minimum`. A support grant never satisfies it.

`requireSupportGrantOrRole` additionally passes an active support grant carrying
the named `scope`. Use it on read paths only; mutations keep `requireOrgRole`.

Both guards take the tenancy service and the user resolver as arguments — they
depend on no session package and no ambient state.

## Audit

Every mutation writes one `tenancy_audit_events` row: `org.create`,
`membership.add|change|remove`, `override.set|clear`,
`invite.create|accept|revoke`, `support_grant.create|revoke`. Raw invite tokens
are never recorded. `listAuditEvents` returns newest first with a clamped limit
(default 50, max 200) and a `(before, beforeId)` cursor. To fetch the next page,
pass the last row's `createdAt` as `before` and its `id` as `beforeId`.
`acceptInvite` writes two or three rows with the same `createdAt`, so `before`
alone skips whatever part of that group falls past a page boundary.
