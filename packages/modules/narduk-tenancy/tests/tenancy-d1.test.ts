import { readFileSync } from 'node:fs'

import { drizzle } from 'drizzle-orm/d1'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createTenancy } from '../server/utils/tenancy'

import { MIGRATION_PATH } from './support/database'

describe('D1 transaction integration', () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("tenancy test"); } }',
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
  })
  let binding: Awaited<ReturnType<Miniflare['getD1Database']>>

  beforeAll(async () => {
    binding = await runtime.getD1Database('DB')
    const statements = readFileSync(MIGRATION_PATH, 'utf8')
      .replaceAll(/--[^\n]*/g, '')
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean)
    await binding.batch(statements.map((statement) => binding.prepare(statement)))
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await runtime.dispose()
  })

  it('admits one presenter and preserves the last owner on the actual D1 driver', async () => {
    const tenancy = createTenancy(drizzle(binding))
    const org = await tenancy.createOrg({ slug: 'd1', name: 'D1', createdByUserId: 'owner-a' })
    await tenancy.addMember({ orgId: org.id, userId: 'owner-b', role: 'owner' })
    const owners = await Promise.allSettled(
      ['owner-a', 'owner-b'].map((userId) =>
        tenancy.setMemberRole({ orgId: org.id, userId, role: 'viewer' }),
      ),
    )
    expect(owners.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)

    const { token } = await tenancy.createInvite({
      orgId: org.id,
      invitedByUserId: 'owner-a',
      email: 'a@example.com',
      role: 'operator',
    })
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
    const hash = vi.spyOn(globalThis.crypto.subtle, 'digest').mockResolvedValue(digest)
    try {
      const results = await Promise.allSettled(
        ['viewer-a', 'viewer-b'].map((userId) => tenancy.acceptInvite({ token, userId })),
      )
      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    } finally {
      hash.mockRestore()
    }
    const members = await Promise.all(
      ['viewer-a', 'viewer-b'].map((userId) => tenancy.resolveRole({ orgId: org.id, userId })),
    )
    expect(members.filter(({ role }) => role === 'operator')).toHaveLength(1)
  })

  it('rolls back every statement when a D1 membership write fails', async () => {
    const tenancy = createTenancy(drizzle(binding))
    const org = await tenancy.createOrg({
      slug: 'd1-rollback',
      name: 'D1 rollback',
      createdByUserId: 'owner',
    })
    const { token } = await tenancy.createInvite({
      orgId: org.id,
      invitedByUserId: 'owner',
      email: 'a@example.com',
      role: 'viewer',
    })
    await binding
      .prepare(
        "CREATE TRIGGER fail_d1_member BEFORE INSERT ON tenancy_memberships WHEN NEW.user_id = 'failed-member' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END",
      )
      .run()
    await expect(tenancy.acceptInvite({ token, userId: 'failed-member' })).rejects.toThrow()
    expect(
      (await tenancy.listAuditEvents({ orgId: org.id })).some(
        ({ action }) => action === 'invite.accept',
      ),
    ).toBe(false)
    await binding.prepare('DROP TRIGGER fail_d1_member').run()
    expect((await tenancy.acceptInvite({ token, userId: 'failed-member' })).alreadyAccepted).toBe(
      false,
    )
  })
})
