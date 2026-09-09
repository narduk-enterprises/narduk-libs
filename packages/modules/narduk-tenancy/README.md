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

The package ships its own additive D1 migration. Register the directory in the
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

`drizzle/0001_tenancy.sql` is `CREATE TABLE IF NOT EXISTS` throughout with no
down-migration, so a Worker rolled back to a version without tenancy simply
ignores the tables.

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
  actorUserId: userId,
})

const { role, source, supportGrant } = await tenancy.resolveRole({
  orgId: org.id,
  userId: mateId,
  resource: { kind: 'vessel', id: vesselId },
})
```

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
owner of an org can be neither demoted nor removed.

### Invites

`createInvite` returns `{ invite, token }`; the raw token is returned exactly
once and only its SHA-256 digest is stored. `acceptInvite({ token, userId })` is
single-use, expiry-checked, revocation-checked, and idempotent for the accepting
user — a second user presenting the same token gets `conflict`.

**An invite records the email it was addressed to; acceptance binds to whoever
presents the token.** This package does not compare the two, because it has no
access to the consumer's verified-email state. If an app wants the invite email
to be binding, it checks that before calling `acceptInvite`.

Accepting promotes an existing membership when the invite role is higher, and
never demotes. A resource-scoped invite additionally writes a narrowing override
for that resource.

### Database typing

The service is typed against the D1-shaped drizzle surface (`LayerDatabase` in
narduk-core is exactly this shape) and only ever awaits `.get()`, `.all()` and
`.run()`. That makes it dialect-neutral in behaviour: the synchronous
better-sqlite3 driver returns values that `await` resolves unchanged, which is
how this package's own tests run the shipped migration against real in-memory
SQLite behind one cast.

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
(default 50, max 200) and a `before` cursor.
