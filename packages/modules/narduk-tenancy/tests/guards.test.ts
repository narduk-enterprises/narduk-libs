import { describe, expect, it, vi } from 'vitest'

import {
  requireOrgRole,
  requireSupportGrantOrRole,
  TENANCY_DENIED_ERROR_CODE,
  TENANCY_UNAUTHENTICATED_ERROR_CODE,
  type TenancyRoleResolver,
} from '../server/utils/guards'
import { TENANCY_SYSTEM_ACTOR } from '../server/utils/tenancy'

import { createTestHarness } from './support/database'

import type { H3Event } from 'h3'

const event = {} as H3Event
const ACME = { slug: 'acme', name: 'Acme', createdByUserId: 'owner-1' }
const DIAGNOSTICS_SCOPE = 'diagnostics:read'
const VESSEL = { kind: 'vessel', id: 'vessel-1' } as const

interface ThrownH3Error {
  data?: { errorCode?: string }
  statusCode: number
}

async function thrown(promise: Promise<unknown>): Promise<ThrownH3Error> {
  try {
    await promise
    throw new Error('expected the guard to reject')
  } catch (error) {
    return error as ThrownH3Error
  }
}

async function seed() {
  const harness = createTestHarness()
  const org = await harness.tenancy.createOrg(ACME)
  await harness.tenancy.addMember({
    actorUserId: TENANCY_SYSTEM_ACTOR,
    orgId: org.id,
    userId: 'crew-1',
    role: 'crew',
  })
  await harness.tenancy.setResourceRoleOverride({
    actorUserId: TENANCY_SYSTEM_ACTOR,
    orgId: org.id,
    userId: 'crew-1',
    resource: VESSEL,
    role: 'viewer',
  })
  return { ...harness, org }
}

describe('requireOrgRole', () => {
  it('401s an anonymous request without consulting the tenancy service', async () => {
    const { org } = await seed()
    const tenancy: TenancyRoleResolver = { resolveRole: vi.fn() }

    const error = await thrown(
      requireOrgRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        tenancy,
        resolveUserId: () => null,
      }),
    )
    expect(error.statusCode).toBe(401)
    expect(error.data?.errorCode).toBe(TENANCY_UNAUTHENTICATED_ERROR_CODE)
    expect(tenancy.resolveRole).not.toHaveBeenCalled()
  })

  it('403s a non-member and an under-privileged member', async () => {
    const { org, tenancy } = await seed()

    const stranger = await thrown(
      requireOrgRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        tenancy,
        resolveUserId: () => 'stranger',
      }),
    )
    expect(stranger.statusCode).toBe(403)
    expect(stranger.data?.errorCode).toBe(TENANCY_DENIED_ERROR_CODE)

    const crew = await thrown(
      requireOrgRole(event, {
        orgId: org.id,
        minimum: 'admin',
        tenancy,
        resolveUserId: () => 'crew-1',
      }),
    )
    expect(crew.statusCode).toBe(403)
  })

  it('passes a member at or above the minimum and honours a narrowing override', async () => {
    const { org, tenancy } = await seed()

    await expect(
      requireOrgRole(event, {
        orgId: org.id,
        minimum: 'crew',
        tenancy,
        resolveUserId: () => Promise.resolve('crew-1'),
      }),
    ).resolves.toMatchObject({ userId: 'crew-1', role: 'crew' })

    // The same member is only a viewer on the overridden vessel.
    const denied = await thrown(
      requireOrgRole(event, {
        orgId: org.id,
        minimum: 'crew',
        resource: VESSEL,
        tenancy,
        resolveUserId: () => 'crew-1',
      }),
    )
    expect(denied.statusCode).toBe(403)
    await expect(
      requireOrgRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        resource: VESSEL,
        tenancy,
        resolveUserId: () => 'crew-1',
      }),
    ).resolves.toMatchObject({ role: 'viewer' })
  })

  it('never lets a support grant stand in for a role', async () => {
    const { org, tenancy } = await seed()
    await tenancy.createSupportGrant({
      orgId: org.id,
      granteeUserId: 'support-1',
      grantedByUserId: 'owner-1',
      reason: 'Ticket 42',
      scope: [DIAGNOSTICS_SCOPE],
      ttlSeconds: 600,
    })

    const error = await thrown(
      requireOrgRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        tenancy,
        resolveUserId: () => 'support-1',
      }),
    )
    expect(error.statusCode).toBe(403)
  })
})

describe('requireSupportGrantOrRole', () => {
  it('401s an anonymous request', async () => {
    const { org, tenancy } = await seed()
    const error = await thrown(
      requireSupportGrantOrRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        tenancy,
        resolveUserId: () => null,
      }),
    )
    expect(error.statusCode).toBe(401)
  })

  it('passes a role holder without needing a grant', async () => {
    const { org, tenancy } = await seed()
    await expect(
      requireSupportGrantOrRole(event, {
        orgId: org.id,
        minimum: 'crew',
        scope: DIAGNOSTICS_SCOPE,
        tenancy,
        resolveUserId: () => 'crew-1',
      }),
    ).resolves.toMatchObject({ userId: 'crew-1', role: 'crew' })
  })

  it('passes an in-scope grant holder and refuses an out-of-scope or expired one', async () => {
    const { org, tenancy, clock } = await seed()
    await tenancy.createSupportGrant({
      orgId: org.id,
      granteeUserId: 'support-1',
      grantedByUserId: 'owner-1',
      reason: 'Ticket 42',
      scope: [DIAGNOSTICS_SCOPE],
      ttlSeconds: 600,
    })

    await expect(
      requireSupportGrantOrRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        scope: DIAGNOSTICS_SCOPE,
        tenancy,
        resolveUserId: () => 'support-1',
      }),
    ).resolves.toMatchObject({
      role: null,
      supportGrant: expect.objectContaining({ reason: 'Ticket 42' }),
    })

    const wrongScope = await thrown(
      requireSupportGrantOrRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        scope: 'billing:write',
        tenancy,
        resolveUserId: () => 'support-1',
      }),
    )
    expect(wrongScope.statusCode).toBe(403)
    expect(wrongScope.data?.errorCode).toBe(TENANCY_DENIED_ERROR_CODE)

    clock.advance(600_001)
    const expired = await thrown(
      requireSupportGrantOrRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        scope: DIAGNOSTICS_SCOPE,
        tenancy,
        resolveUserId: () => 'support-1',
      }),
    )
    expect(expired.statusCode).toBe(403)
  })
})
