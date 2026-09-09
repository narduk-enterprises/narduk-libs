import { describe, expect, it } from 'vitest'

import { TenancyError } from '../server/utils/tenancy-error'

import { createTestHarness } from './support/database'

const VESSEL = { kind: 'vessel', id: 'vessel-1' } as const

describe('resource role overrides', () => {
  it('narrows the org role on one resource only', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })
    await tenancy.addMember({ orgId: org.id, userId: 'user-2', role: 'admin' })
    await tenancy.setResourceRoleOverride({
      orgId: org.id,
      userId: 'user-2',
      resource: VESSEL,
      role: 'viewer',
    })

    expect(await tenancy.resolveRole({ orgId: org.id, userId: 'user-2' })).toMatchObject({
      role: 'admin',
      source: 'membership',
    })
    expect(
      await tenancy.resolveRole({ orgId: org.id, userId: 'user-2', resource: VESSEL }),
    ).toMatchObject({ role: 'viewer', source: 'override' })
    expect(
      await tenancy.resolveRole({
        orgId: org.id,
        userId: 'user-2',
        resource: { kind: 'vessel', id: 'vessel-2' },
      }),
    ).toMatchObject({ role: 'admin', source: 'membership' })
  })

  it('refuses an override more privileged than the org role', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })
    await tenancy.addMember({ orgId: org.id, userId: 'user-2', role: 'crew' })

    const raise = tenancy.setResourceRoleOverride({
      orgId: org.id,
      userId: 'user-2',
      resource: VESSEL,
      role: 'admin',
    })
    await expect(raise).rejects.toBeInstanceOf(TenancyError)
    await raise.catch((error: unknown) => {
      expect((error as TenancyError).code).toBe('invalid')
    })

    // An equal role is not a raise, so it is allowed and records the intent.
    const same = await tenancy.setResourceRoleOverride({
      orgId: org.id,
      userId: 'user-2',
      resource: VESSEL,
      role: 'crew',
    })
    expect(same.role).toBe('crew')
  })

  it('requires a membership before an override exists', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })
    const missing = tenancy.setResourceRoleOverride({
      orgId: org.id,
      userId: 'ghost',
      resource: VESSEL,
      role: 'viewer',
    })
    await missing.catch((error: unknown) => {
      expect((error as TenancyError).code).toBe('not_found')
    })
    await expect(missing).rejects.toBeInstanceOf(TenancyError)
  })

  it('updates an existing override in place and clears it', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })
    await tenancy.addMember({ orgId: org.id, userId: 'user-2', role: 'admin' })

    const first = await tenancy.setResourceRoleOverride({
      orgId: org.id,
      userId: 'user-2',
      resource: VESSEL,
      role: 'operator',
    })
    const second = await tenancy.setResourceRoleOverride({
      orgId: org.id,
      userId: 'user-2',
      resource: VESSEL,
      role: 'viewer',
    })
    expect(second.id).toBe(first.id)
    expect(second.role).toBe('viewer')

    await tenancy.clearResourceRoleOverride({ orgId: org.id, userId: 'user-2', resource: VESSEL })
    expect(
      await tenancy.resolveRole({ orgId: org.id, userId: 'user-2', resource: VESSEL }),
    ).toMatchObject({ role: 'admin', source: 'membership' })

    const clearAgain = tenancy.clearResourceRoleOverride({
      orgId: org.id,
      userId: 'user-2',
      resource: VESSEL,
    })
    await clearAgain.catch((error: unknown) => {
      expect((error as TenancyError).code).toBe('not_found')
    })
    await expect(clearAgain).rejects.toBeInstanceOf(TenancyError)
  })

  it('reports no role at all for a non-member', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })
    expect(await tenancy.resolveRole({ orgId: org.id, userId: 'stranger' })).toEqual({
      role: null,
      source: 'none',
    })
  })
})
