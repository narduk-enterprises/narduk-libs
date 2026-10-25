import { describe, expect, it } from 'vitest'

import { TENANCY_SYSTEM_ACTOR } from '../server/utils/tenancy'

import { createTestHarness } from './support/database'

/**
 * Ponytail-5 s8 repros for #2003 auth-tenancy-pg #4 and #5: a membership change
 * whose second statement failed used to commit the first anyway.
 */
const ACME = { slug: 'acme', name: 'Acme', createdByUserId: 'user-1' }
const VESSEL = { kind: 'vessel', id: 'vessel-1' } as const

async function orgWithAdmin() {
  const harness = createTestHarness()
  const org = await harness.tenancy.createOrg(ACME)
  await harness.tenancy.addMember({
    actorUserId: TENANCY_SYSTEM_ACTOR,
    orgId: org.id,
    userId: 'user-2',
    role: 'admin',
  })
  return { ...harness, org }
}

describe('membership writes are all-or-nothing', () => {
  it('#4 keeps the member when clearing their overrides fails', async () => {
    const { tenancy, sqlite, org } = await orgWithAdmin()
    await tenancy.setResourceRoleOverride({
      actorUserId: TENANCY_SYSTEM_ACTOR,
      orgId: org.id,
      userId: 'user-2',
      resource: VESSEL,
      role: 'viewer',
    })
    sqlite.exec(
      "CREATE TRIGGER fail_override BEFORE DELETE ON tenancy_resource_role_overrides BEGIN SELECT RAISE(ABORT, 'simulated failure'); END",
    )
    await expect(
      tenancy.removeMember({ actorUserId: TENANCY_SYSTEM_ACTOR, orgId: org.id, userId: 'user-2' }),
    ).rejects.toThrow(/simulated failure/u)
    expect(await tenancy.resolveRole({ orgId: org.id, userId: 'user-2' })).toMatchObject({
      role: 'admin',
    })

    sqlite.exec('DROP TRIGGER fail_override')
    await tenancy.removeMember({
      actorUserId: TENANCY_SYSTEM_ACTOR,
      orgId: org.id,
      userId: 'user-2',
    })
    const left = sqlite
      .prepare('SELECT COUNT(*) AS n FROM tenancy_resource_role_overrides')
      .get() as { n: number }
    expect(left.n).toBe(0)
  })

  it('#5 does not change a role whose audit row fails to write', async () => {
    const { tenancy, sqlite, org } = await orgWithAdmin()
    sqlite.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON tenancy_audit_events BEGIN SELECT RAISE(ABORT, 'simulated failure'); END",
    )
    await expect(
      tenancy.setMemberRole({
        actorUserId: TENANCY_SYSTEM_ACTOR,
        orgId: org.id,
        userId: 'user-2',
        role: 'viewer',
      }),
    ).rejects.toThrow(/simulated failure/u)
    expect(await tenancy.resolveRole({ orgId: org.id, userId: 'user-2' })).toMatchObject({
      role: 'admin',
    })
  })
})
