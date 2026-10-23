import { describe, expect, it } from 'vitest'

import { tenancyAuditEvents } from '../server/database/tenancy-schema'
import { createTenancy, TENANCY_SYSTEM_ACTOR } from '../server/utils/tenancy'
import { TENANCY_ROLES } from '../shared/utils/roles'

import { createTestHarness } from './support/database'
import { codeOf } from './support/expect'
import { interleaveBeforeWrite } from './support/interleave'

const RESOURCE = { kind: 'vessel', id: 'invited' }
const SIBLING = { kind: 'vessel', id: 'sibling' }

describe('resource-scoped invitation boundaries', () => {
  it.each(TENANCY_ROLES)('does not grant a nonmember organization-wide %s access', async (role) => {
    const { tenancy, sqlite } = createTestHarness()
    const org = await tenancy.createOrg({ slug: 'scope', name: 'Scope', createdByUserId: 'owner' })
    const { token, invite } = await tenancy.createInvite({
      orgId: org.id,
      email: 'invitee@example.com',
      role,
      resource: RESOURCE,
      invitedByUserId: 'owner',
    })
    const before = sqlite.serialize()
    expect(await codeOf(tenancy.acceptInvite({ token, userId: 'invitee' }))).toBe('forbidden')
    expect(sqlite.serialize()).toEqual(before)
    for (const resource of [RESOURCE, SIBLING, undefined]) {
      expect(
        (await tenancy.resolveRole({ orgId: org.id, userId: 'invitee', resource })).role,
      ).toBeNull()
    }
    // Refusal leaves the token available if the user later qualifies.
    await tenancy.addMember({
      actorUserId: TENANCY_SYSTEM_ACTOR,
      orgId: org.id,
      userId: 'invitee',
      role,
    })
    const accepted = await tenancy.acceptInvite({ token, userId: 'invitee' })
    expect(accepted.invite.id).toBe(invite.id)
    expect(accepted.alreadyAccepted).toBe(false)
    expect(accepted.membership.role).toBe(role)
    expect(accepted.override?.role).toBe(role)
    expect((await tenancy.acceptInvite({ token, userId: 'invitee' })).alreadyAccepted).toBe(true)
  })

  it('does not promote an existing member through a scoped invitation', async () => {
    const { tenancy, sqlite } = createTestHarness()
    const org = await tenancy.createOrg({ slug: 'scope', name: 'Scope', createdByUserId: 'owner' })
    await tenancy.addMember({
      actorUserId: TENANCY_SYSTEM_ACTOR,
      orgId: org.id,
      userId: 'invitee',
      role: 'viewer',
    })
    const { token } = await tenancy.createInvite({
      orgId: org.id,
      email: 'invitee@example.com',
      role: 'operator',
      resource: RESOURCE,
      invitedByUserId: 'owner',
    })
    const before = sqlite.serialize()
    expect(await codeOf(tenancy.acceptInvite({ token, userId: 'invitee' }))).toBe('forbidden')
    expect(sqlite.serialize()).toEqual(before)
    expect(
      (await tenancy.resolveRole({ orgId: org.id, userId: 'invitee', resource: SIBLING })).role,
    ).toBe('viewer')
  })

  it('preserves the existing organization role and narrows only the invited resource', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg({ slug: 'scope', name: 'Scope', createdByUserId: 'owner' })
    await tenancy.addMember({
      actorUserId: TENANCY_SYSTEM_ACTOR,
      orgId: org.id,
      userId: 'invitee',
      role: 'admin',
    })
    const { token } = await tenancy.createInvite({
      orgId: org.id,
      email: 'invitee@example.com',
      role: 'crew',
      resource: RESOURCE,
      invitedByUserId: 'owner',
    })
    const result = await tenancy.acceptInvite({ token, userId: 'invitee' })
    expect(result.membership.role).toBe('admin')
    expect(
      await tenancy.resolveRole({ orgId: org.id, userId: 'invitee', resource: RESOURCE }),
    ).toMatchObject({ role: 'crew', source: 'override' })
    expect(
      await tenancy.resolveRole({ orgId: org.id, userId: 'invitee', resource: SIBLING }),
    ).toMatchObject({ role: 'admin', source: 'membership' })
  })

  it.each(['demote', 'remove'] as const)(
    'rechecks the recipient inside the claim after a racing %s',
    async (operation) => {
      const { tenancy, db, sqlite, clock } = createTestHarness()
      const org = await tenancy.createOrg({
        slug: 'scope',
        name: 'Scope',
        createdByUserId: 'owner',
      })
      await tenancy.addMember({
        actorUserId: TENANCY_SYSTEM_ACTOR,
        orgId: org.id,
        userId: 'invitee',
        role: 'admin',
      })
      const { token } = await tenancy.createInvite({
        orgId: org.id,
        email: 'invitee@example.com',
        role: 'operator',
        resource: RESOURCE,
        invitedByUserId: 'owner',
      })
      let afterRace: Uint8Array | undefined
      const racing = createTenancy(
        interleaveBeforeWrite(db, 'insert', tenancyAuditEvents, () => {
          sqlite.exec(
            operation === 'demote'
              ? "UPDATE tenancy_memberships SET role = 'viewer' WHERE user_id = 'invitee'"
              : "DELETE FROM tenancy_memberships WHERE user_id = 'invitee'",
          )
          afterRace = sqlite.serialize()
        }),
        { now: clock.now },
      )
      expect(await codeOf(racing.acceptInvite({ token, userId: 'invitee' }))).toBe('conflict')
      expect(afterRace).toBeDefined()
      expect(sqlite.serialize()).toEqual(afterRace)
    },
  )
})
