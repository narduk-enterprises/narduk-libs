import { describe, expect, it } from 'vitest'

import { SUPPORT_GRANT_MAX_TTL_SECONDS, TENANCY_SYSTEM_ACTOR } from '../server/utils/tenancy'

import { createTestHarness } from './support/database'
import { codeOf } from './support/expect'

const ACME = { slug: 'acme', name: 'Acme', createdByUserId: 'user-1' }
const VESSEL = { kind: 'vessel', id: 'vessel-1' } as const

describe('support grants', () => {
  it('bounds the TTL to (0, 86400] whole seconds', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg(ACME)
    const base = {
      orgId: org.id,
      granteeUserId: 'support-1',
      grantedByUserId: 'user-1',
      reason: 'Ticket 42',
    }

    expect(await codeOf(tenancy.createSupportGrant({ ...base, ttlSeconds: 0 }))).toBe('invalid')
    expect(await codeOf(tenancy.createSupportGrant({ ...base, ttlSeconds: -1 }))).toBe('invalid')
    expect(await codeOf(tenancy.createSupportGrant({ ...base, ttlSeconds: 1.5 }))).toBe('invalid')
    expect(
      await codeOf(
        tenancy.createSupportGrant({ ...base, ttlSeconds: SUPPORT_GRANT_MAX_TTL_SECONDS + 1 }),
      ),
    ).toBe('invalid')
    expect(
      await codeOf(tenancy.createSupportGrant({ ...base, ttlSeconds: 60, reason: '  ' })),
    ).toBe('invalid')
    expect(
      await codeOf(tenancy.createSupportGrant({ ...base, ttlSeconds: 60, scope: ['reads', '  '] })),
    ).toBe('invalid')
    expect(
      await codeOf(
        tenancy.createSupportGrant({
          orgId: 'missing',
          granteeUserId: 'support-1',
          grantedByUserId: 'user-1',
          reason: 'Ticket 42',
          ttlSeconds: 60,
        }),
      ),
    ).toBe('not_found')

    const grant = await tenancy.createSupportGrant({
      ...base,
      ttlSeconds: SUPPORT_GRANT_MAX_TTL_SECONDS,
    })
    expect(grant.expiresAt).toBe(grant.createdAt + SUPPORT_GRANT_MAX_TTL_SECONDS * 1000)
  })

  it('is not a role: it never grants one, and it expires on its own', async () => {
    const { tenancy, clock } = createTestHarness()
    const org = await tenancy.createOrg(ACME)
    await tenancy.createSupportGrant({
      orgId: org.id,
      granteeUserId: 'support-1',
      grantedByUserId: 'user-1',
      reason: 'Ticket 42',
      scope: ['diagnostics:read'],
      ttlSeconds: 3600,
    })

    const active = await tenancy.resolveRole({ orgId: org.id, userId: 'support-1' })
    expect(active.role).toBeNull()
    expect(active.source).toBe('none')
    expect(active.supportGrant?.reason).toBe('Ticket 42')
    expect(JSON.parse(active.supportGrant?.scopeJson ?? '[]')).toEqual(['diagnostics:read'])

    clock.advance(3_600_001)
    expect(await tenancy.resolveRole({ orgId: org.id, userId: 'support-1' })).toEqual({
      role: null,
      source: 'none',
    })
    expect(await tenancy.listActiveSupportGrants({ orgId: org.id })).toEqual([])
  })

  it('scopes a resource grant to that resource only', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg(ACME)
    await tenancy.createSupportGrant({
      orgId: org.id,
      granteeUserId: 'support-1',
      grantedByUserId: 'user-1',
      reason: 'Ticket 42',
      ttlSeconds: 600,
      resource: VESSEL,
    })

    expect(
      (await tenancy.resolveRole({ orgId: org.id, userId: 'support-1', resource: VESSEL }))
        .supportGrant,
    ).toBeDefined()
    // Org-wide and other-resource lookups must not see a vessel-scoped grant.
    expect(
      (await tenancy.resolveRole({ orgId: org.id, userId: 'support-1' })).supportGrant,
    ).toBeUndefined()
    expect(
      (
        await tenancy.resolveRole({
          orgId: org.id,
          userId: 'support-1',
          resource: { kind: 'vessel', id: 'vessel-2' },
        })
      ).supportGrant,
    ).toBeUndefined()
  })

  it('revokes a grant idempotently and drops it from the active list', async () => {
    const { tenancy, clock } = createTestHarness()
    const org = await tenancy.createOrg(ACME)
    const grant = await tenancy.createSupportGrant({
      orgId: org.id,
      granteeUserId: 'support-1',
      grantedByUserId: 'user-1',
      reason: 'Ticket 42',
      ttlSeconds: 600,
    })
    expect(
      await tenancy.listActiveSupportGrants({ orgId: org.id, userId: 'support-1' }),
    ).toHaveLength(1)

    const revoked = await tenancy.revokeSupportGrant({ grantId: grant.id, actorUserId: 'user-1' })
    expect(revoked.revokedAt).toBe(clock.now())
    expect(await tenancy.listActiveSupportGrants({ orgId: org.id })).toEqual([])
    expect(
      (await tenancy.revokeSupportGrant({ actorUserId: TENANCY_SYSTEM_ACTOR, grantId: grant.id }))
        .revokedAt,
    ).toBe(revoked.revokedAt)
    expect(
      await codeOf(
        tenancy.revokeSupportGrant({ actorUserId: TENANCY_SYSTEM_ACTOR, grantId: 'ghost' }),
      ),
    ).toBe('not_found')
  })

  it('keeps a member role untouched while a grant is attached', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg(ACME)
    await tenancy.createSupportGrant({
      orgId: org.id,
      granteeUserId: 'user-1',
      grantedByUserId: 'user-1',
      reason: 'Ticket 42',
      ttlSeconds: 600,
    })

    const resolution = await tenancy.resolveRole({ orgId: org.id, userId: 'user-1' })
    expect(resolution).toMatchObject({ role: 'owner', source: 'membership' })
    expect(resolution.supportGrant).toBeDefined()
  })
})
