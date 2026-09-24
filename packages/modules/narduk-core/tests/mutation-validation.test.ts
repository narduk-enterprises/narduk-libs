/**
 * narduk-libs#371 follow-up: mutation helpers must use the same 400 shape as
 * `defineValidatedHandler`, and must not fold caller key names into
 * `statusMessage`.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { describeValidationFailure } from '../runtime/server/utils/mutationValidation'

describe('describeValidationFailure (narduk-libs#371)', () => {
  it('maps a ZodError onto the validated-handler 400, without key names in statusMessage', () => {
    const parsed = z.strictObject({ name: z.string() }).safeParse({
      name: 'buoy',
      'hunter2-key': 'hunter2-secret',
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) return

    const described = describeValidationFailure(parsed.error)

    expect(described.kind).toBe('http')
    if (described.kind !== 'http') return

    const error = described.error as {
      data?: { code?: string; issues?: Array<{ message: string; path: string }> }
      statusCode?: number
      statusMessage?: string
    }

    expect(error.statusCode).toBe(400)
    expect(error.statusMessage).toBe('Bad Request')
    expect(String(error.statusMessage)).not.toContain('hunter2-key')
    expect(JSON.stringify(described.error)).not.toContain('hunter2-secret')
    expect(error.data).toEqual({
      code: 'VALIDATION_FAILED',
      issues: [{ message: 'Unrecognized key', path: 'body.hunter2-key' }],
    })
  })

  it('rethrows an existing HTTP error as-is', () => {
    const http = { statusCode: 401, statusMessage: 'Unauthorized' }
    expect(describeValidationFailure(http)).toEqual({ error: http, kind: 'http' })
  })

  it('keeps a non-Zod failure as a generic 400 message', () => {
    expect(describeValidationFailure(new Error('boom'))).toEqual({
      kind: 'message',
      statusCode: 400,
      statusMessage: 'Invalid request body',
    })
  })
})
