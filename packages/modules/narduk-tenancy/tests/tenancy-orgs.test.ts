import { describe, expect, it } from 'vitest'

import { createTestHarness } from './support/database'
import { codeOf } from './support/expect'

const ACME = { slug: 'acme', name: 'Acme', createdByUserId: 'user-1' }
const VESSEL = { kind: 'vessel', id: 'vessel-1' } as const

describe('orgs and memberships', () => {
  it('creates an org with its creator as sole owner', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg({
      slug: '  ACME-Fleet ',
      name: ' Acme ',
      createdByUserId: 'user-1',
    })

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
    expect(await codeOf(tenancy.createOrg({ ...ACME, slug: 'not a slug' }))).toBe('invalid')

    await tenancy.createOrg(ACME)
    expect(await codeOf(tenancy.createOrg({ ...ACME, slug: 'ACME' }))).toBe('conflict')
  })

  it('returns null for an unknown org and lists only orgs the user belongs to', async () => {
    const { tenancy } = createTestHarness()
    expect(await tenancy.getOrg('missing')).toBeNull()

    const alpha = await tenancy.createOrg({ ...ACME, slug: 'alpha', name: 'Alpha' })
    const beta = await tenancy.createOrg({
      slug: 'beta',
      name: 'Beta',
      createdByUserId: 'user-2',
    })
    await tenancy.addMember({
      orgId: beta.id,
      userId: 'user-1',
      role: 'crew',
      actorUserId: 'user-2',
    })

    expect((await tenancy.listOrgsForUser('user-1')).map((org) => org.id)).toEqual([
      alpha.id,
      beta.id,
    ])
    expect(await tenancy.listOrgsForUser('user-3')).toEqual([])
  })

  it('refuses to add an unknown org or a duplicate member', async () => {
    const { tenancy } = createTestHarness()
    expect(
      await codeOf(tenancy.addMember({ orgId: 'missing', userId: 'user-2', role: 'crew' })),
    ).toBe('not_found')

    const org = await tenancy.createOrg(ACME)
    await tenancy.addMember({ orgId: org.id, userId: 'user-2', role: 'crew' })
    expect(
      await codeOf(tenancy.addMember({ orgId: org.id, userId: 'user-2', role: 'admin' })),
    ).toBe('conflict')
  })

  it('changes a member role and refuses an unknown member', async () => {
    const { tenancy, clock } = createTestHarness()
    const org = await tenancy.createOrg(ACME)
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
    const unchanged = await tenancy.setMemberRole({
      orgId: org.id,
      userId: 'user-2',
      role: 'operator',
    })
    expect(unchanged.role).toBe('operator')
    expect(
      await codeOf(tenancy.setMemberRole({ orgId: org.id, userId: 'ghost', role: 'crew' })),
    ).toBe('not_found')
  })

  it('protects the last owner from demotion and removal', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg(ACME)

    expect(
      await codeOf(tenancy.setMemberRole({ orgId: org.id, userId: 'user-1', role: 'admin' })),
    ).toBe('last_owner')
    expect(await codeOf(tenancy.removeMember({ orgId: org.id, userId: 'user-1' }))).toBe(
      'last_owner',
    )

    // A second owner lifts the protection for the first.
    await tenancy.addMember({ orgId: org.id, userId: 'user-2', role: 'owner' })
    await tenancy.setMemberRole({ orgId: org.id, userId: 'user-1', role: 'admin' })
    expect(await tenancy.resolveRole({ orgId: org.id, userId: 'user-1' })).toMatchObject({
      role: 'admin',
    })
  })

  it('removes a member and clears that member overrides', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg(ACME)
    await tenancy.addMember({ orgId: org.id, userId: 'user-2', role: 'operator' })
    await tenancy.setResourceRoleOverride({
      orgId: org.id,
      userId: 'user-2',
      resource: VESSEL,
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
    expect(await codeOf(tenancy.removeMember({ orgId: org.id, userId: 'user-2' }))).toBe(
      'not_found',
    )
  })
})
