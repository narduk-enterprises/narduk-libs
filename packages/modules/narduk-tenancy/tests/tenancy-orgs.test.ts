import { describe, expect, it } from 'vitest'

import { TenancyError } from '../server/utils/tenancy-error'

import { createTestHarness } from './support/database'

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(TenancyError)
  await promise.catch((error: unknown) => {
    expect((error as TenancyError).code).toBe(code)
  })
}

describe('orgs and memberships', () => {
  it('creates an org with its creator as sole owner', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg({ slug: '  ACME-Fleet ', name: ' Acme ', createdByUserId: 'user-1' })

    expect(org.slug).toBe('acme-fleet')
    expect(org.name).toBe('Acme')
    expect(await tenancy.getOrg(org.id)).toMatchObject({ id: org.id, slug: 'acme-fleet' })
    expect(await tenancy.resolveRole({ orgId: org.id, userId: 'user-1' })).toMatchObject({
      role: 'owner',
      source: 'membership',
    })
  })

  it('rejects an invalid slug and a duplicate slug', async () => {
    const { tenancy } = createTestHarness()
    await expectCode(
      tenancy.createOrg({ slug: 'not a slug', name: 'X', createdByUserId: 'user-1' }),
      'invalid',
    )
    await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })
    await expectCode(
      tenancy.createOrg({ slug: 'ACME', name: 'Acme Again', createdByUserId: 'user-2' }),
      'conflict',
    )
  })

  it('returns null for an unknown org and lists only orgs the user belongs to', async () => {
    const { tenancy } = createTestHarness()
    expect(await tenancy.getOrg('missing')).toBeNull()

    const alpha = await tenancy.createOrg({ slug: 'alpha', name: 'Alpha', createdByUserId: 'user-1' })
    const beta = await tenancy.createOrg({ slug: 'beta', name: 'Beta', createdByUserId: 'user-2' })
    await tenancy.addMember({ orgId: beta.id, userId: 'user-1', role: 'crew', actorUserId: 'user-2' })

    expect((await tenancy.listOrgsForUser('user-1')).map((org) => org.id)).toEqual([alpha.id, beta.id])
    expect((await tenancy.listOrgsForUser('user-3'))).toEqual([])
  })

  it('refuses to add an unknown org or a duplicate member', async () => {
    const { tenancy } = createTestHarness()
    await expectCode(
      tenancy.addMember({ orgId: 'missing', userId: 'user-2', role: 'crew' }),
      'not_found',
    )

    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })
    await tenancy.addMember({ orgId: org.id, userId: 'user-2', role: 'crew' })
    await expectCode(
      tenancy.addMember({ orgId: org.id, userId: 'user-2', role: 'admin' }),
      'conflict',
    )
  })

  it('changes a member role and refuses an unknown member', async () => {
    const { tenancy, clock } = createTestHarness()
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })
    const membership = await tenancy.addMember({ orgId: org.id, userId: 'user-2', role: 'crew' })

    clock.advance(1000)
    const updated = await tenancy.setMemberRole({
      orgId: org.id,
      userId: 'user-2',
      role: 'operator',
      actorUserId: 'user-1',
    })
    expect(updated.role).toBe('operator')
    expect(updated.updatedAt).toBeGreaterThan(membership.updatedAt)

    // Setting the same role is a no-op that still returns the membership.
    expect((await tenancy.setMemberRole({ orgId: org.id, userId: 'user-2', role: 'operator' })).role).toBe(
      'operator',
    )
    await expectCode(
      tenancy.setMemberRole({ orgId: org.id, userId: 'ghost', role: 'crew' }),
      'not_found',
    )
  })

  it('protects the last owner from demotion and removal', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })

    await expectCode(
      tenancy.setMemberRole({ orgId: org.id, userId: 'user-1', role: 'admin' }),
      'last_owner',
    )
    await expectCode(tenancy.removeMember({ orgId: org.id, userId: 'user-1' }), 'last_owner')

    // A second owner lifts the protection for the first.
    await tenancy.addMember({ orgId: org.id, userId: 'user-2', role: 'owner' })
    await tenancy.setMemberRole({ orgId: org.id, userId: 'user-1', role: 'admin' })
    expect(await tenancy.resolveRole({ orgId: org.id, userId: 'user-1' })).toMatchObject({
      role: 'admin',
    })
  })

  it('removes a member and clears that member overrides', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })
    await tenancy.addMember({ orgId: org.id, userId: 'user-2', role: 'operator' })
    await tenancy.setResourceRoleOverride({
      orgId: org.id,
      userId: 'user-2',
      resource: { kind: 'vessel', id: 'vessel-1' },
      role: 'viewer',
    })

    await tenancy.removeMember({ orgId: org.id, userId: 'user-2', actorUserId: 'user-1' })
    expect(await tenancy.resolveRole({ orgId: org.id, userId: 'user-2' })).toEqual({
      role: null,
      source: 'none',
    })

    const events = await tenancy.listAuditEvents({ orgId: org.id })
    const removal = events.find((event) => event.action === 'membership.remove')
    expect(JSON.parse(removal?.detailsJson ?? '{}')).toMatchObject({ clearedOverrides: 1 })

    await expectCode(tenancy.removeMember({ orgId: org.id, userId: 'user-2' }), 'not_found')
  })
})
