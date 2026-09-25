import { describe, expect, it } from 'vitest'

import { TENANCY_ERROR_CODES, TenancyError } from '../server/utils/tenancy-error'
import {
  TENANCY_DEFAULT_MESSAGES,
  TENANCY_HTTP_STATUS,
  toTenancyHttpError,
  withTenancyErrors,
} from '../server/utils/tenancy-http'

import { createTestHarness } from './support/database'

interface ThrownH3Error {
  data?: { errorCode?: string; message?: string }
  message: string
  statusCode: number
  statusMessage?: string
}

async function thrown(promise: Promise<unknown>): Promise<ThrownH3Error> {
  try {
    await promise
  } catch (error) {
    return error as ThrownH3Error
  }
  throw new Error('expected the operation to reject')
}

const ORG_ID = '65346ffc-1c1f-4ad2-a5ae-5f5b0a8e9c11'

describe('TENANCY_HTTP_STATUS (#981)', () => {
  it('maps every TenancyError code, with 410 for expired and 409 for last_owner', () => {
    expect(Object.keys(TENANCY_HTTP_STATUS).sort()).toEqual([...TENANCY_ERROR_CODES].sort())
    expect(Object.keys(TENANCY_DEFAULT_MESSAGES).sort()).toEqual([...TENANCY_ERROR_CODES].sort())
    expect(TENANCY_HTTP_STATUS).toEqual({
      not_found: 404,
      forbidden: 403,
      conflict: 409,
      invalid: 400,
      expired: 410,
      last_owner: 409,
    })
    expect(Object.isFrozen(TENANCY_HTTP_STATUS)).toBe(true)
  })
})

describe('toTenancyHttpError (#981)', () => {
  it('never forwards TenancyError.message, which embeds internal ids', () => {
    const error = toTenancyHttpError(
      new TenancyError('last_owner', `Org ${ORG_ID} must keep at least one owner.`),
    ) as unknown as ThrownH3Error

    expect(error.statusCode).toBe(409)
    expect(error.statusMessage).toBe('Conflict')
    expect(error.data).toEqual({
      errorCode: 'last_owner',
      message: TENANCY_DEFAULT_MESSAGES.last_owner,
    })
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(ORG_ID)
  })

  it('uses a per-call message for the answered code', () => {
    const error = toTenancyHttpError(new TenancyError('conflict', 'raw'), {
      messages: { conflict: 'That web address is taken.' },
    }) as unknown as ThrownH3Error
    expect(error.statusCode).toBe(409)
    expect(error.data?.message).toBe('That web address is taken.')
    expect(error.message).toBe('That web address is taken.')
  })

  it('answers hidden codes as not_found, with the not_found status and message', () => {
    for (const code of ['forbidden', 'invalid', 'expired'] as const) {
      const error = toTenancyHttpError(new TenancyError(code, 'raw'), {
        hideAsNotFound: ['forbidden', 'invalid', 'expired'],
        messages: { not_found: 'No such farm.' },
      }) as unknown as ThrownH3Error
      expect(error.statusCode).toBe(404)
      expect(error.data).toEqual({ errorCode: 'not_found', message: 'No such farm.' })
    }
    const conflict = toTenancyHttpError(new TenancyError('conflict', 'raw'), {
      hideAsNotFound: ['forbidden'],
    }) as unknown as ThrownH3Error
    expect(conflict.statusCode).toBe(409)
  })

  it('hands status, code and message to an app envelope builder', () => {
    const calls: unknown[][] = []
    const error = toTenancyHttpError(new TenancyError('expired', 'raw'), {
      toError: (...args) => {
        calls.push(args)
        return new Error('app envelope')
      },
    })
    expect(error.message).toBe('app envelope')
    expect(calls).toEqual([[410, 'expired', TENANCY_DEFAULT_MESSAGES.expired]])
  })
})

describe('withTenancyErrors (#981)', () => {
  it('returns the operation result', async () => {
    await expect(withTenancyErrors(async () => 42)).resolves.toBe(42)
  })

  it('passes a non-tenancy error through unchanged', async () => {
    const original = new Error('database down')
    await expect(
      withTenancyErrors(async () => {
        throw original
      }),
    ).rejects.toBe(original)
  })

  it('maps a real service failure without leaking its ids', async () => {
    const { tenancy } = createTestHarness()
    const org = await tenancy.createOrg({ slug: 'acme', name: 'Acme', createdByUserId: 'owner-1' })

    const error = await thrown(
      withTenancyErrors(() =>
        tenancy.removeMember({ actorUserId: 'owner-1', orgId: org.id, userId: 'owner-1' }),
      ),
    )
    expect(error.statusCode).toBe(409)
    expect(error.data?.errorCode).toBe('last_owner')
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(org.id)
  })
})
