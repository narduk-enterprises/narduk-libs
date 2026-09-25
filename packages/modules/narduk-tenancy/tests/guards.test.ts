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
  data?: { errorCode?: string; message?: string }
  message?: string
  statusCode: number
  statusMessage?: string
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

  it('passes on any active grant that covers the scope, not only the longest-lived (#942)', async () => {
    const { org, tenancy } = await seed()
    await tenancy.createSupportGrant({
      orgId: org.id,
      granteeUserId: 'support-1',
      grantedByUserId: 'owner-1',
      reason: 'Logs, a day',
      scope: ['logs:read'],
      ttlSeconds: 86_400,
    })
    await tenancy.createSupportGrant({
      orgId: org.id,
      granteeUserId: 'support-1',
      grantedByUserId: 'owner-1',
      reason: 'Diagnostics, an hour',
      scope: [DIAGNOSTICS_SCOPE],
      ttlSeconds: 3600,
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
      supportGrant: expect.objectContaining({ reason: 'Diagnostics, an hour' }),
    })
    await expect(
      requireSupportGrantOrRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        scope: 'logs:read',
        tenancy,
        resolveUserId: () => 'support-1',
      }),
    ).resolves.toMatchObject({ supportGrant: expect.objectContaining({ reason: 'Logs, a day' }) })

    const uncovered = await thrown(
      requireSupportGrantOrRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        scope: 'billing:write',
        tenancy,
        resolveUserId: () => 'support-1',
      }),
    )
    expect(uncovered.statusCode).toBe(403)
  })

  it('lets a resource grant cover a scope an org-wide grant lacks (#942)', async () => {
    const { org, tenancy } = await seed()
    const vessel = { kind: 'vessel', id: 'vessel-1' } as const
    await tenancy.createSupportGrant({
      orgId: org.id,
      granteeUserId: 'support-1',
      grantedByUserId: 'owner-1',
      reason: 'Org-wide logs',
      scope: ['logs:read'],
      ttlSeconds: 86_400,
    })
    await tenancy.createSupportGrant({
      orgId: org.id,
      granteeUserId: 'support-1',
      grantedByUserId: 'owner-1',
      reason: 'Vessel diagnostics',
      scope: [DIAGNOSTICS_SCOPE],
      resource: vessel,
      ttlSeconds: 3600,
    })

    await expect(
      requireSupportGrantOrRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        scope: DIAGNOSTICS_SCOPE,
        resource: vessel,
        tenancy,
        resolveUserId: () => 'support-1',
      }),
    ).resolves.toMatchObject({
      supportGrant: expect.objectContaining({ reason: 'Vessel diagnostics' }),
    })

    // The resource grant never leaks to an org-level check.
    const orgLevel = await thrown(
      requireSupportGrantOrRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        scope: DIAGNOSTICS_SCOPE,
        tenancy,
        resolveUserId: () => 'support-1',
      }),
    )
    expect(orgLevel.statusCode).toBe(403)
  })

  it('skips a revoked covering grant even when another grant is still active (#942)', async () => {
    const { org, tenancy } = await seed()
    const covering = await tenancy.createSupportGrant({
      orgId: org.id,
      granteeUserId: 'support-1',
      grantedByUserId: 'owner-1',
      reason: 'Diagnostics, revoked',
      scope: [DIAGNOSTICS_SCOPE],
      ttlSeconds: 3600,
    })
    await tenancy.createSupportGrant({
      orgId: org.id,
      granteeUserId: 'support-1',
      grantedByUserId: 'owner-1',
      reason: 'Logs, a day',
      scope: ['logs:read'],
      ttlSeconds: 86_400,
    })
    await tenancy.revokeSupportGrant({ actorUserId: 'owner-1', grantId: covering.id })

    const refused = await thrown(
      requireSupportGrantOrRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        scope: DIAGNOSTICS_SCOPE,
        tenancy,
        resolveUserId: () => 'support-1',
      }),
    )
    expect(refused.statusCode).toBe(403)
  })

  it('fails closed on a grant whose stored scope is not a JSON array (#942)', async () => {
    const { org, sqlite, tenancy } = await seed()
    const grant = await tenancy.createSupportGrant({
      orgId: org.id,
      granteeUserId: 'support-1',
      grantedByUserId: 'owner-1',
      reason: 'Corrupted scope',
      scope: [DIAGNOSTICS_SCOPE],
      ttlSeconds: 3600,
    })
    for (const stored of ['not json', '"diagnostics:read"', '{"0":"diagnostics:read"}']) {
      sqlite
        .prepare('UPDATE tenancy_support_grants SET scope_json = ? WHERE id = ?')
        .run(stored, grant.id)
      const refused = await thrown(
        requireSupportGrantOrRole(event, {
          orgId: org.id,
          minimum: 'viewer',
          scope: DIAGNOSTICS_SCOPE,
          tenancy,
          resolveUserId: () => 'support-1',
        }),
      )
      expect(refused.statusCode).toBe(403)
    }
  })
})

describe('guard messages (#981)', () => {
  it('keeps the bare 401 and 403 when no message is named', async () => {
    const { org, tenancy } = await seed()
    const anonymous = await thrown(
      requireOrgRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        tenancy,
        resolveUserId: () => null,
      }),
    )
    expect(anonymous.statusMessage).toBe('Unauthorized')
    expect(anonymous.data).toEqual({ errorCode: TENANCY_UNAUTHENTICATED_ERROR_CODE })

    const denied = await thrown(
      requireOrgRole(event, {
        orgId: org.id,
        minimum: 'admin',
        tenancy,
        resolveUserId: () => 'crew-1',
      }),
    )
    expect(denied.statusMessage).toBe('Forbidden')
    expect(denied.data).toEqual({ errorCode: TENANCY_DENIED_ERROR_CODE })
  })

  it('carries a named sentence on the 401 and the 403, keeping the error code', async () => {
    const { org, tenancy } = await seed()
    const messages = {
      unauthenticatedMessage: 'Sign in to continue.',
      deniedMessage: 'Only an admin can change billing.',
    }

    const anonymous = await thrown(
      requireOrgRole(event, {
        orgId: org.id,
        minimum: 'viewer',
        tenancy,
        resolveUserId: () => null,
        ...messages,
      }),
    )
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.statusMessage).toBe('Unauthorized')
    expect(anonymous.message).toBe('Sign in to continue.')
    expect(anonymous.data).toEqual({
      errorCode: TENANCY_UNAUTHENTICATED_ERROR_CODE,
      message: 'Sign in to continue.',
    })

    const denied = await thrown(
      requireSupportGrantOrRole(event, {
        orgId: org.id,
        minimum: 'admin',
        tenancy,
        resolveUserId: () => 'crew-1',
        ...messages,
      }),
    )
    expect(denied.statusCode).toBe(403)
    expect(denied.data).toEqual({
      errorCode: TENANCY_DENIED_ERROR_CODE,
      message: 'Only an admin can change billing.',
    })
  })
})
