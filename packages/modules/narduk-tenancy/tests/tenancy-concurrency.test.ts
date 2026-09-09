import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTestHarness } from './support/database'

afterEach(() => vi.restoreAllMocks())

describe('concurrent membership changes', () => {
  it.each(['demote', 'remove'] as const)(
    'keeps an owner when two owners concurrently %s',
    async (operation) => {
      const { tenancy } = createTestHarness()
      const org = await tenancy.createOrg({ slug: 'nvr', name: 'NVR', createdByUserId: 'owner-a' })
      await tenancy.addMember({ orgId: org.id, userId: 'owner-b', role: 'owner' })

      const results = await Promise.allSettled(
        ['owner-a', 'owner-b'].map((userId) =>
          operation === 'demote'
            ? tenancy.setMemberRole({ orgId: org.id, userId, role: 'admin' })
            : tenancy.removeMember({ orgId: org.id, userId }),
        ),
      )

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const roles = await Promise.all(
        ['owner-a', 'owner-b'].map((userId) => tenancy.resolveRole({ orgId: org.id, userId })),
      )
      expect(roles.filter(({ role }) => role === 'owner')).toHaveLength(1)
    },
  )

  it('allows only one user to accept the same invitation concurrently', async () => {
    const { tenancy } = createTestHarness({ tokens: ['one-invitation'] })
    const org = await tenancy.createOrg({ slug: 'nvr', name: 'NVR', createdByUserId: 'owner' })
    const { token } = await tenancy.createInvite({
      orgId: org.id,
      email: 'invitee@example.com',
      role: 'viewer',
      invitedByUserId: 'owner',
    })
    // Both callers present the same token. Resolve their hashes together so
    // their reads overlap even when the platform hashes on separate threads.
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockResolvedValue(digest)

    const results = await Promise.allSettled(
      ['user-a', 'user-b'].map((userId) => tenancy.acceptInvite({ token, userId })),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const roles = await Promise.all(
      ['user-a', 'user-b'].map((userId) => tenancy.resolveRole({ orgId: org.id, userId })),
    )
    expect(roles.filter(({ role }) => role !== null)).toHaveLength(1)
  })
})
