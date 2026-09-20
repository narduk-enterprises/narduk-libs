import { readFileSync } from 'node:fs'

import { drizzle } from 'drizzle-orm/d1'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { tenancyInvites, tenancyMemberships } from '../server/database/tenancy-schema'
import { createTenancy, TENANCY_SYSTEM_ACTOR } from '../server/utils/tenancy'

import { MIGRATION_PATH } from './support/database'
import { codeOf } from './support/expect'
import { interleaveBeforeWrite } from './support/interleave'

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
    await tenancy.addMember({
      actorUserId: TENANCY_SYSTEM_ACTOR,
      orgId: org.id,
      userId: 'owner-b',
      role: 'owner',
    })
    const owners = await Promise.allSettled(
      ['owner-a', 'owner-b'].map((userId) =>
        tenancy.setMemberRole({
          actorUserId: TENANCY_SYSTEM_ACTOR,
          orgId: org.id,
          userId,
          role: 'viewer',
        }),
      ),
    )
    expect(owners.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)

    // The owner whose demotion was refused invites: the other is a viewer now,
    // and a viewer may not issue an operator invitation (narduk-libs#213).
    const survivor = owners[0]?.status === 'rejected' ? 'owner-a' : 'owner-b'
    const { token } = await tenancy.createInvite({
      orgId: org.id,
      invitedByUserId: survivor,
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

  it('enforces actor rank, re-checked inside the write, on the actual D1 driver', async () => {
    const tenancy = createTenancy(drizzle(binding))
    const org = await tenancy.createOrg({
      slug: 'd1-rank',
      name: 'D1 rank',
      createdByUserId: 'owner',
    })
    for (const [userId, role] of [
      ['admin', 'admin'],
      ['crew-a', 'crew'],
      ['crew-b', 'crew'],
    ] as const) {
      await tenancy.addMember({ actorUserId: TENANCY_SYSTEM_ACTOR, orgId: org.id, userId, role })
    }
    const roleOf = async (userId: string) =>
      (await tenancy.resolveRole({ orgId: org.id, userId })).role

    expect(
      await codeOf(
        tenancy.setMemberRole({
          orgId: org.id,
          userId: 'admin',
          role: 'owner',
          actorUserId: 'admin',
        }),
      ),
    ).toBe('forbidden')
    expect(
      await codeOf(tenancy.removeMember({ orgId: org.id, userId: 'owner', actorUserId: 'admin' })),
    ).toBe('forbidden')

    // In rank, the statements carrying the re-check land on D1...
    await tenancy.setMemberRole({
      orgId: org.id,
      userId: 'crew-a',
      role: 'viewer',
      actorUserId: 'admin',
    })
    expect(await roleOf('crew-a')).toBe('viewer')

    // ...and a member promoted to owner between the check and the write stays.
    const racing = createTenancy(
      interleaveBeforeWrite(drizzle(binding), 'delete', tenancyMemberships, () =>
        binding
          .prepare(
            "UPDATE tenancy_memberships SET role = 'owner' WHERE org_id = ? AND user_id = 'crew-b'",
          )
          .bind(org.id)
          .run(),
      ),
    )
    expect(
      await codeOf(racing.removeMember({ orgId: org.id, userId: 'crew-b', actorUserId: 'admin' })),
    ).toBe('conflict')
    expect(await roleOf('crew-b')).toBe('owner')

    await tenancy.removeMember({ orgId: org.id, userId: 'crew-a', actorUserId: 'admin' })
    expect(await roleOf('crew-a')).toBeNull()
  })

  /**
   * narduk-libs#537 moved the rank re-check for `addMember`,
   * `setResourceRoleOverride`, `clearResourceRoleOverride` and `createInvite`
   * into the write, which for the two inserts means an `INSERT … SELECT …
   * WHERE`. That statement shape is the one most likely to behave differently
   * on the real D1 driver than on better-sqlite3, so both halves are proven
   * here: it writes when the rank holds, and writes nothing when a demotion
   * lands between the check and the write.
   */
  it('carries the in-write rank re-check into INSERT statements on the actual D1 driver', async () => {
    const tenancy = createTenancy(drizzle(binding))
    const org = await tenancy.createOrg({
      slug: 'd1-insert-rank',
      name: 'D1 insert rank',
      createdByUserId: 'owner',
    })
    await tenancy.addMember({
      actorUserId: TENANCY_SYSTEM_ACTOR,
      orgId: org.id,
      userId: 'admin',
      role: 'admin',
    })
    const demoteAdmin = () =>
      binding
        .prepare(
          "UPDATE tenancy_memberships SET role = 'viewer' WHERE org_id = ? AND user_id = 'admin'",
        )
        .bind(org.id)
        .run()
    const countOf = async (table: string, column: string, value: string) =>
      (
        await binding
          .prepare(`SELECT COUNT(*) AS counted FROM ${table} WHERE org_id = ? AND ${column} = ?`)
          .bind(org.id, value)
          .first<{ counted: number }>()
      )?.counted

    // In rank, the INSERT … SELECT lands on D1.
    await tenancy.addMember({
      actorUserId: 'admin',
      orgId: org.id,
      userId: 'crew-a',
      role: 'crew',
    })
    expect((await tenancy.resolveRole({ orgId: org.id, userId: 'crew-a' })).role).toBe('crew')
    await tenancy.createInvite({
      orgId: org.id,
      invitedByUserId: 'admin',
      email: 'in-rank@example.com',
      role: 'crew',
    })
    expect(await countOf('tenancy_invites', 'email', 'in-rank@example.com')).toBe(1)

    // Demoted at the write, neither insert writes anything.
    expect(
      await codeOf(
        createTenancy(
          interleaveBeforeWrite(drizzle(binding), 'insert', tenancyMemberships, demoteAdmin),
        ).addMember({ actorUserId: 'admin', orgId: org.id, userId: 'crew-b', role: 'crew' }),
      ),
    ).toBe('conflict')
    expect(await countOf('tenancy_memberships', 'user_id', 'crew-b')).toBe(0)

    await binding
      .prepare("UPDATE tenancy_memberships SET role = 'admin' WHERE org_id = ? AND user_id = ?")
      .bind(org.id, 'admin')
      .run()
    expect(
      await codeOf(
        createTenancy(
          interleaveBeforeWrite(drizzle(binding), 'insert', tenancyInvites, demoteAdmin),
        ).createInvite({
          orgId: org.id,
          invitedByUserId: 'admin',
          email: 'raced@example.com',
          role: 'crew',
        }),
      ),
    ).toBe('conflict')
    expect(await countOf('tenancy_invites', 'email', 'raced@example.com')).toBe(0)
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

  it('rolls back createOrg when the owner membership write fails', async () => {
    await binding
      .prepare(
        "CREATE TRIGGER fail_d1_create_org_owner BEFORE INSERT ON tenancy_memberships WHEN NEW.user_id = 'failed-owner' BEGIN SELECT RAISE(ABORT, 'simulated membership failure'); END",
      )
      .run()
    const tenancy = createTenancy(drizzle(binding))
    await expect(
      tenancy.createOrg({
        slug: 'd1-ownerless',
        name: 'Ownerless',
        createdByUserId: 'failed-owner',
      }),
    ).rejects.toThrow()

    const leftover = await binding
      .prepare('SELECT slug FROM tenancy_orgs WHERE slug = ?')
      .bind('d1-ownerless')
      .all()
    expect(leftover.results).toEqual([])

    await binding.prepare('DROP TRIGGER fail_d1_create_org_owner').run()
    const created = await tenancy.createOrg({
      slug: 'd1-ownerless',
      name: 'Ownerless',
      createdByUserId: 'failed-owner',
    })
    expect(created.slug).toBe('d1-ownerless')
    expect(await tenancy.resolveRole({ orgId: created.id, userId: 'failed-owner' })).toMatchObject({
      role: 'owner',
      source: 'membership',
    })
  })
})
