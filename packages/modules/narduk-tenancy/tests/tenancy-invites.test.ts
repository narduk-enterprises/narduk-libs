import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { tenancyInvites } from '../server/database/tenancy-schema'
import { TenancyError } from '../server/utils/tenancy-error'

import { createTestHarness } from './support/database'

const VESSEL = { kind: 'vessel', id: 'vessel-1' } as const

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    throw new Error('expected the call to reject')
  } catch (error) {
    expect(error).toBeInstanceOf(TenancyError)
    return (error as TenancyError).code
  }
}

describe('invites', () => {
  it('returns the raw token once and stores only its digest', async () => {
    const { tenancy, db } = createTestHarness({ tokens: ['secret-token'] })
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })
    const { invite, token } = await tenancy.createInvite({
      orgId: org.id,
      email: ' Crew@Example.COM ',
      role: 'crew',
      invitedByUserId: 'user-1',
    })

    expect(token).toBe('secret-token')
    expect(invite.email).toBe('crew@example.com')
    expect(invite.tokenHash).not.toContain(token)
    expect(invite.tokenHash).toMatch(/^[0-9a-f]{64}$/u)

    const stored = await db.select().from(tenancyInvites).where(eq(tenancyInvites.id, invite.id)).all()
    expect(JSON.stringify(stored)).not.toContain('secret-token')
  })

  it('creates a membership on acceptance and binds it to the accepting user, not the email', async () => {
    const { tenancy } = createTestHarness({ tokens: ['t1'] })
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })
    await tenancy.createInvite({
      orgId: org.id,
      email: 'crew@example.com',
      role: 'crew',
      invitedByUserId: 'user-1',
    })

    // Documented contract: an invite records the email it was addressed to, but
    // acceptance binds to whoever presents the token. The consumer decides
    // whether to require a matching verified email before calling acceptInvite.
    const result = await tenancy.acceptInvite({ token: 't1', userId: 'user-9' })
    expect(result.alreadyAccepted).toBe(false)
    expect(result.membership).toMatchObject({ userId: 'user-9', role: 'crew' })
    expect(result.invite.acceptedByUserId).toBe('user-9')
    expect(result.override).toBeNull()
  })

  it('is idempotent for the accepting user and a conflict for anyone else', async () => {
    const { tenancy } = createTestHarness({ tokens: ['t1'] })
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })
    await tenancy.createInvite({
      orgId: org.id,
      email: 'crew@example.com',
      role: 'crew',
      invitedByUserId: 'user-1',
    })

    await tenancy.acceptInvite({ token: 't1', userId: 'user-9' })
    const again = await tenancy.acceptInvite({ token: 't1', userId: 'user-9' })
    expect(again.alreadyAccepted).toBe(true)
    expect(again.membership.userId).toBe('user-9')

    expect(await codeOf(tenancy.acceptInvite({ token: 't1', userId: 'user-8' }))).toBe('conflict')
  })

  it('rejects an unknown, expired or revoked token', async () => {
    const { tenancy, clock } = createTestHarness({ tokens: ['expired', 'revoked'] })
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })

    expect(await codeOf(tenancy.acceptInvite({ token: 'nope', userId: 'user-9' }))).toBe('not_found')

    await tenancy.createInvite({
      orgId: org.id,
      email: 'a@example.com',
      role: 'crew',
      invitedByUserId: 'user-1',
      ttlMs: 1000,
    })
    clock.advance(1001)
    expect(await codeOf(tenancy.acceptInvite({ token: 'expired', userId: 'user-9' }))).toBe('expired')

    const { invite } = await tenancy.createInvite({
      orgId: org.id,
      email: 'b@example.com',
      role: 'crew',
      invitedByUserId: 'user-1',
    })
    const revoked = await tenancy.revokeInvite({ inviteId: invite.id, actorUserId: 'user-1' })
    expect(revoked.revokedAt).toBe(clock.now())
    expect(await codeOf(tenancy.acceptInvite({ token: 'revoked', userId: 'user-9' }))).toBe('invalid')

    // Revoking twice is idempotent; revoking an accepted invite is a conflict.
    expect((await tenancy.revokeInvite({ inviteId: invite.id })).revokedAt).toBe(revoked.revokedAt)
    expect(await codeOf(tenancy.revokeInvite({ inviteId: 'ghost' }))).toBe('not_found')
  })

  it('refuses a malformed email, a past expiry and an unknown org', async () => {
    const { tenancy, clock } = createTestHarness()
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })

    expect(
      await codeOf(
        tenancy.createInvite({
          orgId: org.id,
          email: 'not-an-email',
          role: 'crew',
          invitedByUserId: 'user-1',
        }),
      ),
    ).toBe('invalid')
    expect(
      await codeOf(
        tenancy.createInvite({
          orgId: org.id,
          email: 'a@example.com',
          role: 'crew',
          invitedByUserId: 'user-1',
          expiresAt: clock.now(),
        }),
      ),
    ).toBe('invalid')
    expect(
      await codeOf(
        tenancy.createInvite({
          orgId: 'missing',
          email: 'a@example.com',
          role: 'crew',
          invitedByUserId: 'user-1',
        }),
      ),
    ).toBe('not_found')
  })

  it('creates a narrowing override for a resource-scoped invite', async () => {
    const { tenancy } = createTestHarness({ tokens: ['t1'] })
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })
    await tenancy.addMember({ orgId: org.id, userId: 'user-9', role: 'admin' })
    await tenancy.createInvite({
      orgId: org.id,
      email: 'crew@example.com',
      role: 'viewer',
      resource: VESSEL,
      invitedByUserId: 'user-1',
    })

    const result = await tenancy.acceptInvite({ token: 't1', userId: 'user-9' })
    // The existing higher org role is preserved; the invite only narrows the vessel.
    expect(result.membership.role).toBe('admin')
    expect(result.override).toMatchObject({ role: 'viewer', resourceId: 'vessel-1' })
    expect(
      await tenancy.resolveRole({ orgId: org.id, userId: 'user-9', resource: VESSEL }),
    ).toMatchObject({ role: 'viewer', source: 'override' })
  })

  it('promotes an existing member when the invite role is higher', async () => {
    const { tenancy } = createTestHarness({ tokens: ['t1'] })
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'user-1' })
    await tenancy.addMember({ orgId: org.id, userId: 'user-9', role: 'viewer' })
    await tenancy.createInvite({
      orgId: org.id,
      email: 'crew@example.com',
      role: 'operator',
      invitedByUserId: 'user-1',
    })

    const result = await tenancy.acceptInvite({ token: 't1', userId: 'user-9' })
    expect(result.membership.role).toBe('operator')
  })
})
