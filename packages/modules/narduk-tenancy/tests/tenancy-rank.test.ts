import { describe, expect, it } from 'vitest'

import {
  tenancyInvites,
  tenancyMemberships,
  tenancyResourceRoleOverrides,
} from '../server/database/tenancy-schema'
import { createTenancy, TENANCY_SYSTEM_ACTOR, type TenancyService } from '../server/utils/tenancy'
import { claimInviteMembership } from '../server/utils/tenancy-accept-invite'
import { roleAtLeast, TENANCY_ROLES, type TenancyRole } from '../shared/utils/roles'

import { createTestHarness, type TestHarness } from './support/database'
import { codeOf } from './support/expect'
import { interleaveBeforeWrite } from './support/interleave'

const VESSEL = { kind: 'vessel', id: 'vessel-1' } as const
const NEW_EMAIL = 'new@example.com'

/** What `codeOf` answers for a call that did not reject. */
const ALLOWED = 'did-not-reject'

interface RankedOrg extends TestHarness {
  orgId: string
  roleOf: (userId: string) => Promise<TenancyRole | null>
}

/**
 * An org with two members at every rank: `${role}-1` acts and `${role}-2` is
 * acted on. Two owners, so the last-owner rule never answers for the rank
 * rule. Set up entirely by system calls, made as `TENANCY_SYSTEM_ACTOR`.
 */
async function rankedOrg(): Promise<RankedOrg> {
  const harness = createTestHarness()
  const { tenancy } = harness
  const org = await tenancy.createOrg({ slug: 'fleet', name: 'Fleet', createdByUserId: 'owner-1' })
  for (const role of TENANCY_ROLES) {
    for (const userId of [`${role}-1`, `${role}-2`]) {
      if (userId !== 'owner-1')
        await tenancy.addMember({ actorUserId: TENANCY_SYSTEM_ACTOR, orgId: org.id, userId, role })
    }
  }
  return {
    ...harness,
    orgId: org.id,
    roleOf: async (userId) => (await tenancy.resolveRole({ orgId: org.id, userId })).role,
  }
}

/** Every row of every table a mutation writes, so a refusal can be shown to write none. */
function snapshot(harness: TestHarness): unknown[] {
  return [
    'tenancy_memberships',
    'tenancy_resource_role_overrides',
    'tenancy_invites',
    'tenancy_audit_events',
  ].map((table) => harness.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
}

function expectedCode(allowed: boolean): string {
  return allowed ? ALLOWED : 'forbidden'
}

describe('actor rank (narduk-libs#213)', () => {
  it('stops the takeover: an admin can neither promote itself to owner nor demote or remove an owner', async () => {
    const org = await rankedOrg()
    const { orgId, tenancy } = org
    const before = snapshot(org)

    expect(
      await codeOf(
        tenancy.setMemberRole({ orgId, userId: 'admin-1', role: 'owner', actorUserId: 'admin-1' }),
      ),
    ).toBe('forbidden')
    expect(
      await codeOf(
        tenancy.setMemberRole({ orgId, userId: 'owner-1', role: 'viewer', actorUserId: 'admin-1' }),
      ),
    ).toBe('forbidden')
    expect(
      await codeOf(tenancy.removeMember({ orgId, userId: 'owner-1', actorUserId: 'admin-1' })),
    ).toBe('forbidden')

    expect(snapshot(org)).toEqual(before)
  })

  it('refuses an admin who adds, invites, narrows or un-narrows an owner', async () => {
    const org = await rankedOrg()
    const { orgId, tenancy } = org
    await tenancy.setResourceRoleOverride({
      orgId,
      userId: 'owner-2',
      resource: VESSEL,
      role: 'crew',
      actorUserId: 'owner-1',
    })
    const before = snapshot(org)

    expect(
      await codeOf(
        tenancy.addMember({ orgId, userId: 'newcomer', role: 'owner', actorUserId: 'admin-1' }),
      ),
    ).toBe('forbidden')
    expect(
      await codeOf(
        tenancy.createInvite({
          orgId,
          email: NEW_EMAIL,
          role: 'owner',
          invitedByUserId: 'admin-1',
        }),
      ),
    ).toBe('forbidden')
    expect(
      await codeOf(
        tenancy.setResourceRoleOverride({
          orgId,
          userId: 'owner-1',
          resource: VESSEL,
          role: 'viewer',
          actorUserId: 'admin-1',
        }),
      ),
    ).toBe('forbidden')
    expect(
      await codeOf(
        tenancy.clearResourceRoleOverride({
          orgId,
          userId: 'owner-2',
          resource: VESSEL,
          actorUserId: 'admin-1',
        }),
      ),
    ).toBe('forbidden')

    expect(snapshot(org)).toEqual(before)
  })

  // One test per actor role: the whole 5x5x5 matrix in one test sat on the 5 s
  // default under load (narduk-libs#675), and a failure now names the actor.
  it.each(TENANCY_ROLES)(
    'lets an actor change another member only within their own rank: %s',
    async (actor) => {
      const mismatches: string[] = []
      for (const target of TENANCY_ROLES) {
        for (const next of TENANCY_ROLES) {
          const org = await rankedOrg()
          const allowed = roleAtLeast(actor, target) && roleAtLeast(actor, next)
          const code = await codeOf(
            org.tenancy.setMemberRole({
              orgId: org.orgId,
              userId: `${target}-2`,
              role: next,
              actorUserId: `${actor}-1`,
            }),
          )
          const role = await org.roleOf(`${target}-2`)
          if (code !== expectedCode(allowed) || role !== (allowed ? next : target)) {
            mismatches.push(`${actor} sets ${target} to ${next}: ${code}, now ${role}`)
          }
        }
      }
      expect(mismatches).toEqual([])
    },
  )

  it('lets a member lower their own role, never raise it', async () => {
    const mismatches: string[] = []
    for (const role of TENANCY_ROLES) {
      for (const next of TENANCY_ROLES) {
        const org = await rankedOrg()
        const allowed = roleAtLeast(role, next)
        const code = await codeOf(
          org.tenancy.setMemberRole({
            orgId: org.orgId,
            userId: `${role}-1`,
            role: next,
            actorUserId: `${role}-1`,
          }),
        )
        const now = await org.roleOf(`${role}-1`)
        if (code !== expectedCode(allowed) || now !== (allowed ? next : role)) {
          mismatches.push(`${role} sets itself to ${next}: ${code}, now ${now}`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })

  it('lets an actor remove only members within their own rank, and anybody leave', async () => {
    const mismatches: string[] = []
    for (const actor of TENANCY_ROLES) {
      for (const target of TENANCY_ROLES) {
        const org = await rankedOrg()
        const allowed = roleAtLeast(actor, target)
        const code = await codeOf(
          org.tenancy.removeMember({
            orgId: org.orgId,
            userId: `${target}-2`,
            actorUserId: `${actor}-1`,
          }),
        )
        const role = await org.roleOf(`${target}-2`)
        if (code !== expectedCode(allowed) || role !== (allowed ? null : target)) {
          mismatches.push(`${actor} removes ${target}: ${code}, now ${role}`)
        }
      }

      const org = await rankedOrg()
      const left = await codeOf(
        org.tenancy.removeMember({
          orgId: org.orgId,
          userId: `${actor}-1`,
          actorUserId: `${actor}-1`,
        }),
      )
      const role = await org.roleOf(`${actor}-1`)
      if (left !== ALLOWED || role !== null)
        mismatches.push(`${actor} leaves: ${left}, now ${role}`)
    }
    expect(mismatches).toEqual([])
  })

  it('lets an actor add or invite somebody only within their own rank', async () => {
    const mismatches: string[] = []
    for (const actor of TENANCY_ROLES) {
      for (const role of TENANCY_ROLES) {
        const org = await rankedOrg()
        const allowed = roleAtLeast(actor, role)
        const added = await codeOf(
          org.tenancy.addMember({
            orgId: org.orgId,
            userId: 'newcomer',
            role,
            actorUserId: `${actor}-1`,
          }),
        )
        const invited = await codeOf(
          org.tenancy.createInvite({
            orgId: org.orgId,
            email: NEW_EMAIL,
            role,
            invitedByUserId: `${actor}-1`,
          }),
        )
        const joined = await org.roleOf('newcomer')
        const invites = org.sqlite.prepare('SELECT role FROM tenancy_invites').all()
        if (
          added !== expectedCode(allowed) ||
          invited !== expectedCode(allowed) ||
          joined !== (allowed ? role : null) ||
          invites.length !== (allowed ? 1 : 0)
        ) {
          mismatches.push(`${actor} grants ${role}: add ${added}, invite ${invited}`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })

  it('lets an actor narrow, or lift a narrowing of, only members within their own rank', async () => {
    const mismatches: string[] = []
    const vesselRole = async (org: RankedOrg, userId: string) =>
      (await org.tenancy.resolveRole({ orgId: org.orgId, userId, resource: VESSEL })).role

    for (const actor of TENANCY_ROLES) {
      for (const target of TENANCY_ROLES) {
        const allowed = roleAtLeast(actor, target)

        const narrowing = await rankedOrg()
        const narrowed = await codeOf(
          narrowing.tenancy.setResourceRoleOverride({
            orgId: narrowing.orgId,
            userId: `${target}-2`,
            resource: VESSEL,
            role: 'viewer',
            actorUserId: `${actor}-1`,
          }),
        )
        const afterNarrowing = await vesselRole(narrowing, `${target}-2`)

        const lifting = await rankedOrg()
        await lifting.tenancy.setResourceRoleOverride({
          actorUserId: TENANCY_SYSTEM_ACTOR,
          orgId: lifting.orgId,
          userId: `${target}-2`,
          resource: VESSEL,
          role: 'viewer',
        })
        const lifted = await codeOf(
          lifting.tenancy.clearResourceRoleOverride({
            orgId: lifting.orgId,
            userId: `${target}-2`,
            resource: VESSEL,
            actorUserId: `${actor}-1`,
          }),
        )
        const afterLifting = await vesselRole(lifting, `${target}-2`)

        if (
          narrowed !== expectedCode(allowed) ||
          lifted !== expectedCode(allowed) ||
          afterNarrowing !== (allowed ? 'viewer' : target) ||
          afterLifting !== (allowed ? target : 'viewer')
        ) {
          mismatches.push(`${actor} on ${target}: narrow ${narrowed}, lift ${lifted}`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })

  it('refuses an identified actor who is not a member before revealing anything about the org', async () => {
    const org = await rankedOrg()
    const { orgId, tenancy } = org
    await tenancy.createOrg({ slug: 'elsewhere', name: 'Elsewhere', createdByUserId: 'outsider' })
    await tenancy.createSupportGrant({
      orgId,
      granteeUserId: 'support-1',
      grantedByUserId: 'owner-1',
      reason: 'Diagnose a sync fault',
      ttlSeconds: 600,
    })
    const before = snapshot(org)

    // An owner of another org and a support grantee (ADR-0010: support is
    // never a role). Without the rank check each call below answers not_found
    // or conflict, telling a stranger who is and is not a member.
    for (const actorUserId of ['outsider', 'support-1']) {
      expect(
        await codeOf(
          tenancy.setMemberRole({ orgId, userId: 'ghost', role: 'viewer', actorUserId }),
        ),
      ).toBe('forbidden')
      expect(await codeOf(tenancy.removeMember({ orgId, userId: 'ghost', actorUserId }))).toBe(
        'forbidden',
      )
      expect(
        await codeOf(tenancy.addMember({ orgId, userId: 'crew-2', role: 'viewer', actorUserId })),
      ).toBe('forbidden')
      expect(
        await codeOf(
          tenancy.setResourceRoleOverride({
            orgId,
            userId: 'ghost',
            resource: VESSEL,
            role: 'viewer',
            actorUserId,
          }),
        ),
      ).toBe('forbidden')
      expect(
        await codeOf(
          tenancy.clearResourceRoleOverride({
            orgId,
            userId: 'ghost',
            resource: VESSEL,
            actorUserId,
          }),
        ),
      ).toBe('forbidden')
    }
    for (const invitedByUserId of ['outsider', 'support-1']) {
      expect(
        await codeOf(
          tenancy.createInvite({
            orgId,
            email: NEW_EMAIL,
            role: 'viewer',
            invitedByUserId,
          }),
        ),
      ).toBe('forbidden')
    }

    expect(snapshot(org)).toEqual(before)
  })

  it('ranks both sides by org role, never by a per-resource narrowing', async () => {
    const org = await rankedOrg()
    const { orgId, tenancy } = org
    await tenancy.setResourceRoleOverride({
      orgId,
      userId: 'owner-1',
      resource: VESSEL,
      role: 'viewer',
      actorUserId: 'owner-2',
    })

    // Narrowed to viewer on the vessel, owner-1 is still an owner of the org...
    expect(
      await codeOf(
        tenancy.setResourceRoleOverride({
          orgId,
          userId: 'admin-2',
          resource: VESSEL,
          role: 'crew',
          actorUserId: 'owner-1',
        }),
      ),
    ).toBe(ALLOWED)
    expect(
      await codeOf(
        tenancy.setMemberRole({
          orgId,
          userId: 'admin-2',
          role: 'operator',
          actorUserId: 'owner-1',
        }),
      ),
    ).toBe(ALLOWED)

    // ...so an admin may not touch them, on that vessel or anywhere else.
    expect(
      await codeOf(
        tenancy.clearResourceRoleOverride({
          orgId,
          userId: 'owner-1',
          resource: VESSEL,
          actorUserId: 'admin-1',
        }),
      ),
    ).toBe('forbidden')
    expect(
      await codeOf(tenancy.removeMember({ orgId, userId: 'owner-1', actorUserId: 'admin-1' })),
    ).toBe('forbidden')
  })

  it('leaves a call made as TENANCY_SYSTEM_ACTOR unranked', async () => {
    const org = await rankedOrg()
    expect(
      await codeOf(
        org.tenancy.setMemberRole({
          actorUserId: TENANCY_SYSTEM_ACTOR,
          orgId: org.orgId,
          userId: 'viewer-2',
          role: 'owner',
        }),
      ),
    ).toBe(ALLOWED)
    expect(await org.roleOf('viewer-2')).toBe('owner')
  })

  it('still answers last_owner, not conflict, when an owner in rank is the last one', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg({ slug: 'solo', name: 'Solo', createdByUserId: 'owner-1' })

    expect(
      await codeOf(
        tenancy.setMemberRole({
          orgId: org.id,
          userId: 'owner-1',
          role: 'admin',
          actorUserId: 'owner-1',
        }),
      ),
    ).toBe('last_owner')
    expect(
      await codeOf(
        tenancy.removeMember({ orgId: org.id, userId: 'owner-1', actorUserId: 'owner-1' }),
      ),
    ).toBe('last_owner')
  })

  describe('re-checked inside the write', () => {
    function racingChange(
      org: RankedOrg,
      write: 'delete' | 'update',
      sneak: string,
    ): Promise<unknown> {
      const racing: TenancyService = createTenancy(
        interleaveBeforeWrite(org.db, write, tenancyMemberships, () =>
          org.sqlite.prepare(sneak).run(),
        ),
      )
      return write === 'update'
        ? racing.setMemberRole({
            orgId: org.orgId,
            userId: 'crew-2',
            role: 'viewer',
            actorUserId: 'admin-1',
          })
        : racing.removeMember({ orgId: org.orgId, userId: 'crew-2', actorUserId: 'admin-1' })
    }

    it.each(['update', 'delete'] as const)(
      'an admin cannot %s a member promoted to owner after the rank check read them',
      async (write) => {
        const org = await rankedOrg()
        const code = await codeOf(
          racingChange(
            org,
            write,
            "UPDATE tenancy_memberships SET role = 'owner' WHERE user_id = 'crew-2'",
          ),
        )
        expect(code).toBe('conflict')
        expect(await org.roleOf('crew-2')).toBe('owner')
      },
    )

    it.each(['update', 'delete'] as const)(
      'an admin demoted after the rank check read them cannot %s anybody',
      async (write) => {
        const org = await rankedOrg()
        const code = await codeOf(
          racingChange(
            org,
            write,
            "UPDATE tenancy_memberships SET role = 'viewer' WHERE user_id = 'admin-1'",
          ),
        )
        expect(code).toBe('conflict')
        expect(await org.roleOf('crew-2')).toBe('crew')
      },
    )

    /**
     * narduk-libs#537. `addMember`, `setResourceRoleOverride`,
     * `clearResourceRoleOverride` and `createInvite` ranked from a read made
     * just before the write rather than inside it, so a demotion or promotion
     * landing in that window let one change through against the roles as they
     * were read. Each case below sneaks exactly that change in at the write,
     * deterministically, and asserts the call writes nothing.
     */
    function racing(
      org: RankedOrg,
      write: 'delete' | 'insert' | 'update',
      table: object,
      sneak: string,
    ) {
      return createTenancy(
        interleaveBeforeWrite(org.db, write, table, () => org.sqlite.prepare(sneak).run()),
      )
    }
    const DEMOTE_ADMIN = "UPDATE tenancy_memberships SET role = 'viewer' WHERE user_id = 'admin-1'"
    const PROMOTE_CREW = "UPDATE tenancy_memberships SET role = 'owner' WHERE user_id = 'crew-2'"
    const countOf = (org: RankedOrg, sql: string, ...bind: string[]) =>
      (org.sqlite.prepare(sql).get(...bind) as { counted: number }).counted

    it('an admin demoted after the rank check read them adds nobody', async () => {
      const org = await rankedOrg()
      expect(
        await codeOf(
          racing(org, 'insert', tenancyMemberships, DEMOTE_ADMIN).addMember({
            orgId: org.orgId,
            userId: 'newcomer',
            role: 'crew',
            actorUserId: 'admin-1',
          }),
        ),
      ).toBe('conflict')
      expect(await org.roleOf('newcomer')).toBeNull()
      expect(await org.roleOf('admin-1')).toBe('viewer')
    })

    it('addMember writes nothing when the user is added concurrently', async () => {
      const org = await rankedOrg()
      expect(
        await codeOf(
          racing(
            org,
            'insert',
            tenancyMemberships,
            `INSERT INTO tenancy_memberships (id, org_id, user_id, role, created_at, updated_at)
               VALUES ('sneaked', '${org.orgId}', 'newcomer', 'owner', 1, 1)`,
          ).addMember({
            orgId: org.orgId,
            userId: 'newcomer',
            role: 'crew',
            actorUserId: 'admin-1',
          }),
        ),
      ).toBe('conflict')
      // The concurrent row stands untouched, and no second one was written
      // behind it — the UNIQUE index is not what refused this.
      expect(await org.roleOf('newcomer')).toBe('owner')
      expect(
        countOf(
          org,
          'SELECT COUNT(*) AS counted FROM tenancy_memberships WHERE user_id = ?',
          'newcomer',
        ),
      ).toBe(1)
    })

    it.each([
      ['a member promoted to owner', PROMOTE_CREW],
      ['the acting admin demoted', DEMOTE_ADMIN],
    ])('narrows nobody with %s at the write', async (_case, sneak) => {
      const org = await rankedOrg()
      expect(
        await codeOf(
          racing(org, 'insert', tenancyResourceRoleOverrides, sneak).setResourceRoleOverride({
            orgId: org.orgId,
            userId: 'crew-2',
            resource: VESSEL,
            role: 'viewer',
            actorUserId: 'admin-1',
          }),
        ),
      ).toBe('conflict')
      expect(countOf(org, 'SELECT COUNT(*) AS counted FROM tenancy_resource_role_overrides')).toBe(
        0,
      )
    })

    it('does not re-narrow an existing override when the member is promoted at the write', async () => {
      const org = await rankedOrg()
      await org.tenancy.setResourceRoleOverride({
        orgId: org.orgId,
        userId: 'crew-2',
        resource: VESSEL,
        role: 'viewer',
        actorUserId: 'admin-1',
      })
      expect(
        await codeOf(
          racing(org, 'update', tenancyResourceRoleOverrides, PROMOTE_CREW).setResourceRoleOverride(
            {
              orgId: org.orgId,
              userId: 'crew-2',
              resource: VESSEL,
              role: 'crew',
              actorUserId: 'admin-1',
            },
          ),
        ),
      ).toBe('conflict')
      const stored = org.sqlite
        .prepare('SELECT role FROM tenancy_resource_role_overrides WHERE user_id = ?')
        .get('crew-2') as { role: string }
      expect(stored.role).toBe('viewer')
    })

    it('does not lift a narrowing off a member promoted at the write', async () => {
      const org = await rankedOrg()
      await org.tenancy.setResourceRoleOverride({
        orgId: org.orgId,
        userId: 'crew-2',
        resource: VESSEL,
        role: 'viewer',
        actorUserId: 'admin-1',
      })
      expect(
        await codeOf(
          racing(
            org,
            'delete',
            tenancyResourceRoleOverrides,
            PROMOTE_CREW,
          ).clearResourceRoleOverride({
            orgId: org.orgId,
            userId: 'crew-2',
            resource: VESSEL,
            actorUserId: 'admin-1',
          }),
        ),
      ).toBe('conflict')
      expect(countOf(org, 'SELECT COUNT(*) AS counted FROM tenancy_resource_role_overrides')).toBe(
        1,
      )
    })

    /**
     * The branch the pre-write check cannot rank at all: an override whose
     * member is gone narrows nobody, so nothing is ranked — and a membership
     * arriving in that window would be handed its full org role on the
     * resource by a clear that ranked it against nobody. The override row is
     * written directly because the service will not make one for a
     * non-member.
     */
    it('does not lift a narrowing off a membership created at the write', async () => {
      const org = await rankedOrg()
      org.sqlite
        .prepare(
          `INSERT INTO tenancy_resource_role_overrides
             (id, org_id, resource_kind, resource_id, user_id, role, created_at, updated_at)
           VALUES ('orphan', ?, ?, ?, 'stranger', 'viewer', 1, 1)`,
        )
        .run(org.orgId, VESSEL.kind, VESSEL.id)
      expect(
        await codeOf(
          racing(
            org,
            'delete',
            tenancyResourceRoleOverrides,
            `INSERT INTO tenancy_memberships (id, org_id, user_id, role, created_at, updated_at)
               VALUES ('sneaked', '${org.orgId}', 'stranger', 'owner', 1, 1)`,
          ).clearResourceRoleOverride({
            orgId: org.orgId,
            userId: 'stranger',
            resource: VESSEL,
            actorUserId: 'admin-1',
          }),
        ),
      ).toBe('conflict')
      expect(
        countOf(
          org,
          'SELECT COUNT(*) AS counted FROM tenancy_resource_role_overrides WHERE user_id = ?',
          'stranger',
        ),
      ).toBe(1)
    })

    it('an inviter demoted after the rank check read them issues nothing', async () => {
      const org = await rankedOrg()
      expect(
        await codeOf(
          racing(org, 'insert', tenancyInvites, DEMOTE_ADMIN).createInvite({
            orgId: org.orgId,
            email: NEW_EMAIL,
            role: 'crew',
            invitedByUserId: 'admin-1',
          }),
        ),
      ).toBe('conflict')
      expect(countOf(org, 'SELECT COUNT(*) AS counted FROM tenancy_invites')).toBe(0)
    })
  })

  describe('actorUserId is mandatory', () => {
    // Every mutation that takes an actor, called the way a caller that forgot
    // the field (or read it from a nullable column) would call it.
    function mutations(
      tenancy: TenancyService,
      orgId: string,
      actorUserId: unknown,
    ): Array<[string, () => Promise<unknown>]> {
      const actor = actorUserId as string
      return [
        [
          'addMember',
          () => tenancy.addMember({ orgId, userId: 'new-1', role: 'viewer', actorUserId: actor }),
        ],
        [
          'setMemberRole',
          () =>
            tenancy.setMemberRole({ orgId, userId: 'crew-2', role: 'viewer', actorUserId: actor }),
        ],
        [
          'removeMember',
          () => tenancy.removeMember({ orgId, userId: 'crew-2', actorUserId: actor }),
        ],
        [
          'setResourceRoleOverride',
          () =>
            tenancy.setResourceRoleOverride({
              orgId,
              userId: 'crew-2',
              resource: VESSEL,
              role: 'viewer',
              actorUserId: actor,
            }),
        ],
        [
          'clearResourceRoleOverride',
          () =>
            tenancy.clearResourceRoleOverride({
              orgId,
              userId: 'crew-2',
              resource: VESSEL,
              actorUserId: actor,
            }),
        ],
        ['revokeInvite', () => tenancy.revokeInvite({ inviteId: 'invite-x', actorUserId: actor })],
        [
          'revokeSupportGrant',
          () => tenancy.revokeSupportGrant({ grantId: 'grant-x', actorUserId: actor }),
        ],
      ]
    }

    it.each([
      ['missing', undefined],
      ['null', null],
      ['empty', ''],
      ['blank', '   '],
      ['a different symbol', Symbol('system')],
    ])('refuses %s as an actor before reading or writing anything', async (_label, actorUserId) => {
      const org = await rankedOrg()
      const before = snapshot(org)
      const calls = mutations(org.tenancy, org.orgId, actorUserId)
      const codes = await Promise.all(calls.map(async ([, call]) => codeOf(call())))
      expect(codes).toEqual(calls.map(() => 'invalid'))
      expect(snapshot(org)).toEqual(before)
    })

    it('ranks a look-alike string as the user id it is, never as the marker', async () => {
      const org = await rankedOrg()
      const before = snapshot(org)
      const calls = mutations(org.tenancy, org.orgId, 'TENANCY_SYSTEM_ACTOR')
      const codes = await Promise.all(calls.map(async ([, call]) => codeOf(call())))
      // Not a member, so every ranked mutation is refused; the two revokes are
      // not ranked and find nothing to revoke.
      expect(codes).toEqual([...calls.slice(0, 5).map(() => 'forbidden'), 'not_found', 'not_found'])
      expect(snapshot(org)).toEqual(before)
    })

    it('treats only the exported marker as a system call, and audits it with no actor', async () => {
      const org = await rankedOrg()
      await org.tenancy.setMemberRole({
        orgId: org.orgId,
        userId: 'crew-2',
        role: 'viewer',
        actorUserId: Symbol.for('@narduk-enterprises/narduk-tenancy/system-actor') as never,
      })
      expect(await org.roleOf('crew-2')).toBe('viewer')
      const changes = (await org.tenancy.listAuditEvents({ orgId: org.orgId })).filter(
        ({ action }) => action === 'membership.change',
      )
      expect(changes.map(({ actorUserId }) => actorUserId)).toEqual([null])
    })
  })

  describe("acceptInvite re-checks the inviter's rank", () => {
    it('accepts while the inviter still holds the role', async () => {
      const org = await rankedOrg()
      const { token } = await org.tenancy.createInvite({
        orgId: org.orgId,
        email: NEW_EMAIL,
        role: 'admin',
        invitedByUserId: 'admin-1',
      })
      await org.tenancy.acceptInvite({ token, userId: 'new-1' })
      expect(await org.roleOf('new-1')).toBe('admin')
    })

    it.each([
      [
        'demoted below the role',
        "UPDATE tenancy_memberships SET role = 'crew' WHERE user_id = 'admin-1'",
      ],
      ['removed from the org', "DELETE FROM tenancy_memberships WHERE user_id = 'admin-1'"],
    ])('refuses an invite whose inviter was %s', async (_label, change) => {
      const org = await rankedOrg()
      const { token } = await org.tenancy.createInvite({
        orgId: org.orgId,
        email: NEW_EMAIL,
        role: 'admin',
        invitedByUserId: 'admin-1',
      })
      org.sqlite.prepare(change).run()
      const before = snapshot(org)

      expect(await codeOf(org.tenancy.acceptInvite({ token, userId: 'new-1' }))).toBe('forbidden')
      expect(await org.roleOf('new-1')).toBeNull()
      expect(snapshot(org)).toEqual(before)
    })

    it('still accepts an invite at or below the demoted inviter', async () => {
      const org = await rankedOrg()
      const { token } = await org.tenancy.createInvite({
        orgId: org.orgId,
        email: NEW_EMAIL,
        role: 'crew',
        invitedByUserId: 'admin-1',
      })
      org.sqlite
        .prepare("UPDATE tenancy_memberships SET role = 'crew' WHERE user_id = 'admin-1'")
        .run()
      await org.tenancy.acceptInvite({ token, userId: 'new-1' })
      expect(await org.roleOf('new-1')).toBe('crew')
    })

    it('asserts the inviter inside the claim, so a demotion racing the check claims nothing', async () => {
      const org = await rankedOrg()
      const { invite } = await org.tenancy.createInvite({
        orgId: org.orgId,
        email: NEW_EMAIL,
        role: 'admin',
        invitedByUserId: 'admin-1',
      })
      // The service's own check has passed; the demotion lands before the write.
      org.sqlite
        .prepare("UPDATE tenancy_memberships SET role = 'viewer' WHERE user_id = 'admin-1'")
        .run()
      const before = snapshot(org)
      let id = 0
      const claimed = await claimInviteMembership(
        org.db,
        invite,
        'new-1',
        org.clock.now(),
        () => `race-${++id}`,
      )

      expect(claimed).toBe(false)
      expect(snapshot(org)).toEqual(before)
    })
  })
})
