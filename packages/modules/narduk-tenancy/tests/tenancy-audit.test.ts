import { describe, expect, it } from 'vitest'

import { AUDIT_EVENTS_MAX_LIMIT, TENANCY_SYSTEM_ACTOR } from '../server/utils/tenancy'
import { TENANCY_AUDIT_ACTIONS } from '../shared/types/tenancy'

import { createTestHarness } from './support/database'

const ACME = { slug: 'acme', name: 'Acme', createdByUserId: 'owner-1' }
const VESSEL = { kind: 'vessel', id: 'vessel-1' } as const

describe('audit trail', () => {
  it('writes a row for every mutation the package performs', async () => {
    const { tenancy, clock } = createTestHarness({ tokens: ['t1', 't2'] })

    const org = await tenancy.createOrg(ACME)
    clock.advance(1)
    await tenancy.addMember({
      orgId: org.id,
      userId: 'user-2',
      role: 'admin',
      actorUserId: 'owner-1',
    })
    clock.advance(1)
    await tenancy.setMemberRole({
      orgId: org.id,
      userId: 'user-2',
      role: 'operator',
      actorUserId: 'owner-1',
    })
    clock.advance(1)
    await tenancy.setResourceRoleOverride({
      orgId: org.id,
      userId: 'user-2',
      resource: VESSEL,
      role: 'viewer',
      actorUserId: 'owner-1',
    })
    clock.advance(1)
    await tenancy.clearResourceRoleOverride({
      orgId: org.id,
      userId: 'user-2',
      resource: VESSEL,
      actorUserId: 'owner-1',
    })
    clock.advance(1)
    const { invite } = await tenancy.createInvite({
      orgId: org.id,
      email: 'a@example.com',
      role: 'crew',
      invitedByUserId: 'owner-1',
    })
    clock.advance(1)
    await tenancy.revokeInvite({ inviteId: invite.id, actorUserId: 'owner-1' })
    clock.advance(1)
    await tenancy.createInvite({
      orgId: org.id,
      email: 'b@example.com',
      role: 'crew',
      invitedByUserId: 'owner-1',
    })
    clock.advance(1)
    await tenancy.acceptInvite({ token: 't2', userId: 'user-3' })
    clock.advance(1)
    const grant = await tenancy.createSupportGrant({
      orgId: org.id,
      granteeUserId: 'support-1',
      grantedByUserId: 'owner-1',
      reason: 'Ticket 42',
      ttlSeconds: 600,
    })
    clock.advance(1)
    await tenancy.revokeSupportGrant({ grantId: grant.id, actorUserId: 'owner-1' })
    clock.advance(1)
    await tenancy.removeMember({ orgId: org.id, userId: 'user-2', actorUserId: 'owner-1' })

    const events = await tenancy.listAuditEvents({ orgId: org.id, limit: AUDIT_EVENTS_MAX_LIMIT })
    const actions = new Set(events.map((event) => event.action))
    expect([...actions].sort()).toEqual([...TENANCY_AUDIT_ACTIONS].sort())

    for (const event of events) {
      expect(event.orgId).toBe(org.id)
      expect(event.subjectId).not.toBe('')
      expect(() => JSON.parse(event.detailsJson) as unknown).not.toThrow()
    }
  })

  it('never records the raw invite token', async () => {
    const { tenancy } = createTestHarness({ tokens: ['super-secret-token'] })
    const org = await tenancy.createOrg(ACME)
    await tenancy.createInvite({
      orgId: org.id,
      email: 'a@example.com',
      role: 'crew',
      invitedByUserId: 'owner-1',
    })

    const events = await tenancy.listAuditEvents({ orgId: org.id })
    expect(JSON.stringify(events)).not.toContain('super-secret-token')
  })

  it('returns newest first, clamps the limit, and pages with before', async () => {
    const { tenancy, clock } = createTestHarness()
    const org = await tenancy.createOrg(ACME)
    clock.advance(10)
    await tenancy.addMember({
      actorUserId: TENANCY_SYSTEM_ACTOR,
      orgId: org.id,
      userId: 'user-2',
      role: 'crew',
    })

    const newestFirst = await tenancy.listAuditEvents({ orgId: org.id })
    expect(newestFirst[0]?.action).toBe('membership.add')
    expect(newestFirst[0]?.createdAt).toBeGreaterThanOrEqual(newestFirst[1]?.createdAt ?? 0)

    expect(await tenancy.listAuditEvents({ orgId: org.id, limit: 1 })).toHaveLength(1)
    // A limit below 1 or above the ceiling is clamped, never passed through.
    expect((await tenancy.listAuditEvents({ orgId: org.id, limit: 0 })).length).toBeGreaterThan(0)
    expect(
      (await tenancy.listAuditEvents({ orgId: org.id, limit: 10_000 })).length,
    ).toBeLessThanOrEqual(AUDIT_EVENTS_MAX_LIMIT)

    const older = await tenancy.listAuditEvents({ orgId: org.id, before: clock.now() })
    expect(older.every((event) => event.createdAt < clock.now())).toBe(true)
    expect(await tenancy.listAuditEvents({ orgId: 'other-org' })).toEqual([])
  })
})
