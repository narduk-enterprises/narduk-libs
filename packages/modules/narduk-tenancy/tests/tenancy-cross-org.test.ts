import { describe, expect, it } from 'vitest'

import { createTestHarness } from './support/database'
import { codeOf } from './support/expect'

/**
 * Two orgs in one database, holding deliberately colliding data.
 *
 * Every other suite here proves an invariant inside one org. This one proves the
 * boundary between two, which is the guarantee a consumer actually buys: the
 * package's queries are all `org_id`-scoped, and nothing here is asserting that
 * for the first time by accident. The collisions are the point — the same user
 * ids, the same resource ref, the same invited address, the same role names and
 * the same clock instant appear in both orgs, so a query that forgot its
 * `org_id` predicate returns the wrong org's row rather than nothing at all.
 *
 * Read the failures as scoping failures, not as authorization failures. These
 * service reads take no actor and are not the gate — `requireOrgRole` is, and
 * `tests/guards.test.ts` covers it. What is asserted here is that a correctly
 * gated caller asking about their own org can never be handed another org's
 * rows.
 */

const FIELD = { kind: 'field', id: 'field-1' } as const
const SHARED_EMAIL = 'agronomist@example.test'

/** One identity holding a membership in both orgs, at different standings. */
const SHARED = 'shared'
const NORTH_OWNER = 'owner-north'
const SOUTH_OWNER = 'owner-south'

/**
 * `shared` is an owner in north and a viewer in south, which is the arrangement
 * a single database of independent tenants has to support: one identity, two
 * memberships, two different standings, no bleed between them.
 */
async function twoOrgs(options: { tokens?: string[] } = {}) {
  const { tenancy } = createTestHarness(options)

  const north = await tenancy.createOrg({
    slug: 'north',
    name: 'North',
    createdByUserId: NORTH_OWNER,
  })
  const south = await tenancy.createOrg({
    slug: 'south',
    name: 'South',
    createdByUserId: SOUTH_OWNER,
  })

  await tenancy.addMember({
    orgId: north.id,
    userId: SHARED,
    role: 'owner',
    actorUserId: NORTH_OWNER,
  })
  await tenancy.addMember({
    orgId: south.id,
    userId: SHARED,
    role: 'viewer',
    actorUserId: SOUTH_OWNER,
  })

  return { tenancy, north: north.id, south: south.id }
}

describe('cross-org isolation', () => {
  it('resolves one identity to its own standing in each org, and to nothing in an org it does not belong to', async () => {
    const { tenancy, north, south } = await twoOrgs()

    expect(await tenancy.resolveRole({ orgId: north, userId: SHARED })).toMatchObject({
      role: 'owner',
      source: 'membership',
    })
    expect(await tenancy.resolveRole({ orgId: south, userId: SHARED })).toMatchObject({
      role: 'viewer',
      source: 'membership',
    })

    // The owner of one org is a stranger to the other. `role` is null, not a
    // default, and `source` is 'none' rather than a role a caller could mistake
    // for access.
    expect(await tenancy.resolveRole({ orgId: south, userId: NORTH_OWNER })).toEqual({
      role: null,
      source: 'none',
    })
    expect(await tenancy.resolveRole({ orgId: north, userId: SOUTH_OWNER })).toEqual({
      role: null,
      source: 'none',
    })
  })

  it('keeps an override on an identically named resource in one org out of the other', async () => {
    const { tenancy, north, south } = await twoOrgs()

    // The same resource ref exists in both orgs. UNIQUE(org_id, resource_kind,
    // resource_id, user_id) permits that, so 'field-1' is two different fields
    // and an override on one must not narrow the other.
    await tenancy.setResourceRoleOverride({
      orgId: north,
      userId: SHARED,
      resource: FIELD,
      role: 'viewer',
      actorUserId: NORTH_OWNER,
    })

    expect(
      await tenancy.resolveRole({ orgId: north, userId: SHARED, resource: FIELD }),
    ).toMatchObject({ role: 'viewer', source: 'override' })

    // South has no override of its own, so south's answer is south's membership
    // — it must not pick up north's row for the same ref.
    expect(
      await tenancy.resolveRole({ orgId: south, userId: SHARED, resource: FIELD }),
    ).toMatchObject({ role: 'viewer', source: 'membership' })

    // And clearing north's override leaves south untouched in the other
    // direction.
    await tenancy.clearResourceRoleOverride({
      orgId: north,
      userId: SHARED,
      resource: FIELD,
      actorUserId: NORTH_OWNER,
    })
    expect(
      await tenancy.resolveRole({ orgId: north, userId: SHARED, resource: FIELD }),
    ).toMatchObject({ role: 'owner', source: 'membership' })
  })

  it('lists only the orgs an identity actually belongs to', async () => {
    const { tenancy, north, south } = await twoOrgs()

    const shared = await tenancy.listOrgsForUser(SHARED)
    expect(shared.map((org) => org.id).sort()).toEqual([north, south].sort())

    expect(await tenancy.listOrgsForUser(NORTH_OWNER)).toMatchObject([{ id: north }])
    expect(await tenancy.listOrgsForUser(SOUTH_OWNER)).toMatchObject([{ id: south }])
    expect(await tenancy.listOrgsForUser('nobody')).toEqual([])
  })

  it('confines the audit trail to its own org even when both orgs record the same action at the same instant', async () => {
    const { tenancy, north, south } = await twoOrgs()

    // Same actor, same action, same subject shape, same clock reading: the only
    // thing separating these rows is org_id.
    await tenancy.setMemberRole({
      orgId: north,
      userId: SHARED,
      role: 'admin',
      actorUserId: NORTH_OWNER,
    })
    await tenancy.setMemberRole({
      orgId: south,
      userId: SHARED,
      role: 'crew',
      actorUserId: SOUTH_OWNER,
    })

    const northEvents = await tenancy.listAuditEvents({ orgId: north })
    const southEvents = await tenancy.listAuditEvents({ orgId: south })

    expect(northEvents.length).toBeGreaterThan(0)
    expect(southEvents.length).toBeGreaterThan(0)
    expect(northEvents.every((event) => event.orgId === north)).toBe(true)
    expect(southEvents.every((event) => event.orgId === south)).toBe(true)

    // The two trails share no row, and neither carries the other's actor.
    const northIds = new Set(northEvents.map((event) => event.id))
    expect(southEvents.some((event) => northIds.has(event.id))).toBe(false)
    expect(northEvents.some((event) => event.actorUserId === SOUTH_OWNER)).toBe(false)
    expect(southEvents.some((event) => event.actorUserId === NORTH_OWNER)).toBe(false)
  })

  it('confines support grants to their own org even with an identical grantee and resource', async () => {
    const { tenancy, north, south } = await twoOrgs()

    await tenancy.createSupportGrant({
      orgId: north,
      granteeUserId: 'support-person',
      grantedByUserId: NORTH_OWNER,
      reason: 'north incident',
      resource: FIELD,
      ttlSeconds: 3600,
    })

    const northGrants = await tenancy.listActiveSupportGrants({ orgId: north })
    expect(northGrants).toHaveLength(1)
    expect(northGrants[0]).toMatchObject({ orgId: north, granteeUserId: 'support-person' })

    // South granted nothing. A query keyed on grantee or resource alone would
    // hand north's grant to south, since both match exactly.
    expect(await tenancy.listActiveSupportGrants({ orgId: south })).toEqual([])
    expect(
      await tenancy.listActiveSupportGrants({ orgId: south, userId: 'support-person' }),
    ).toEqual([])
    expect(await tenancy.listActiveSupportGrants({ orgId: south, resource: FIELD })).toEqual([])

    // A grant is not a role in either org, and least of all in the other one.
    expect(await tenancy.resolveRole({ orgId: south, userId: 'support-person' })).toEqual({
      role: null,
      source: 'none',
    })
  })

  it('lands an invitation in the org that issued it and nowhere else', async () => {
    const { tenancy, north, south } = await twoOrgs({ tokens: ['token-north', 'token-south'] })

    // The same address is invited to both orgs. Each token must resolve to its
    // own org's membership and grant nothing in the other.
    const northInvite = await tenancy.createInvite({
      orgId: north,
      email: SHARED_EMAIL,
      role: 'crew',
      invitedByUserId: NORTH_OWNER,
    })
    await tenancy.createInvite({
      orgId: south,
      email: SHARED_EMAIL,
      role: 'viewer',
      invitedByUserId: SOUTH_OWNER,
    })

    const accepted = await tenancy.acceptInvite({
      token: northInvite.token,
      userId: 'invitee',
      verifiedEmail: SHARED_EMAIL,
    })

    expect(accepted.membership).toMatchObject({ orgId: north, role: 'crew', userId: 'invitee' })
    expect(await tenancy.resolveRole({ orgId: north, userId: 'invitee' })).toMatchObject({
      role: 'crew',
    })

    // South's invitation is still outstanding: accepting north's did not consume
    // it, and the invitee has no standing in south.
    expect(await tenancy.resolveRole({ orgId: south, userId: 'invitee' })).toEqual({
      role: null,
      source: 'none',
    })
    expect(await tenancy.listOrgsForUser('invitee')).toMatchObject([{ id: north }])
  })

  it('removes a membership from one org without touching the same identity in the other', async () => {
    const { tenancy, north, south } = await twoOrgs()

    // An override on the same resource ref in each org. removeMember clears
    // overrides alongside the membership, so a cascade keyed on user_id alone
    // would take the other org's row with it.
    await tenancy.setResourceRoleOverride({
      orgId: north,
      userId: SHARED,
      resource: FIELD,
      role: 'crew',
      actorUserId: NORTH_OWNER,
    })
    await tenancy.setMemberRole({
      orgId: south,
      userId: SHARED,
      role: 'admin',
      actorUserId: SOUTH_OWNER,
    })
    await tenancy.setResourceRoleOverride({
      orgId: south,
      userId: SHARED,
      resource: FIELD,
      role: 'viewer',
      actorUserId: SOUTH_OWNER,
    })

    await tenancy.removeMember({ orgId: north, userId: SHARED, actorUserId: NORTH_OWNER })

    expect(await tenancy.resolveRole({ orgId: north, userId: SHARED })).toEqual({
      role: null,
      source: 'none',
    })
    expect(await tenancy.resolveRole({ orgId: north, userId: SHARED, resource: FIELD })).toEqual({
      role: null,
      source: 'none',
    })

    // South is untouched: the membership stands and its identically keyed
    // override still narrows.
    expect(await tenancy.resolveRole({ orgId: south, userId: SHARED })).toMatchObject({
      role: 'admin',
      source: 'membership',
    })
    expect(
      await tenancy.resolveRole({ orgId: south, userId: SHARED, resource: FIELD }),
    ).toMatchObject({ role: 'viewer', source: 'override' })
    expect(await tenancy.listOrgsForUser(SHARED)).toMatchObject([{ id: south }])
  })

  it('refuses a stranger the same way whether the org exists or not', async () => {
    const { tenancy, south } = await twoOrgs()

    // The owner of north is an owner of nothing in south. Their refusal must be
    // indistinguishable from the refusal for an org id that does not exist,
    // otherwise the error itself tells a stranger which orgs are real.
    const realOrgRefusal = await codeOf(
      tenancy.addMember({
        orgId: south,
        userId: 'planted',
        role: 'owner',
        actorUserId: NORTH_OWNER,
      }),
    )
    const unknownOrgRefusal = await codeOf(
      tenancy.addMember({
        orgId: 'org-that-does-not-exist',
        userId: 'planted',
        role: 'owner',
        actorUserId: NORTH_OWNER,
      }),
    )

    expect(realOrgRefusal).toBe('forbidden')
    expect(unknownOrgRefusal).toBe(realOrgRefusal)

    // The refused write left nothing behind in the org it named.
    expect(await tenancy.resolveRole({ orgId: south, userId: 'planted' })).toEqual({
      role: null,
      source: 'none',
    })

    // The same holds for the other mutations a stranger might probe with.
    expect(
      await codeOf(
        tenancy.setResourceRoleOverride({
          orgId: south,
          userId: SHARED,
          resource: FIELD,
          role: 'viewer',
          actorUserId: NORTH_OWNER,
        }),
      ),
    ).toBe('forbidden')
    expect(
      await codeOf(
        tenancy.removeMember({ orgId: south, userId: SHARED, actorUserId: NORTH_OWNER }),
      ),
    ).toBe('forbidden')
    expect(
      await codeOf(
        tenancy.createInvite({
          orgId: south,
          email: SHARED_EMAIL,
          role: 'viewer',
          invitedByUserId: NORTH_OWNER,
        }),
      ),
    ).toBe('forbidden')
  })
})
