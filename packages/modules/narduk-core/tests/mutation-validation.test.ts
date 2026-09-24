/**
 * narduk-libs#371 follow-up: mutation helpers must use the same 400 shape as
 * `defineValidatedHandler`, and must not fold caller key names into
 * `statusMessage`.
 *
 * `mutationValidation.ts` is not in `tsconfig.layer-tooling.json` (owned by
 * draft #819). Importing it from `tests/**` trips TS6307. Assert the source
 * wiring here; exercise the shared 400 builder through `validatedHandler`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createValidationFailedError } from '../runtime/server/utils/validatedHandler'

const mutationValidationSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../runtime/server/utils/mutationValidation.ts'),
  'utf8',
)

describe('describeValidationFailure (narduk-libs#371)', () => {
  it('routes a ZodError through createValidationFailedError, not statusMessage prose', () => {
    expect(mutationValidationSource).toContain('createValidationFailedError')
    expect(mutationValidationSource).not.toContain('Validation error:')
    expect(mutationValidationSource).not.toContain('formatValidationError')
  })

  it('builds the validated-handler 400 without key names in statusMessage', () => {
    const parsed = z.strictObject({ name: z.string() }).safeParse({
      name: 'buoy',
      'hunter2-key': 'hunter2-secret',
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) return

    const error = createValidationFailedError('body', parsed.error.issues) as {
      data?: { code?: string; issues?: Array<{ message: string; path: string }> }
      statusCode?: number
      statusMessage?: string
    }

    expect(error.statusCode).toBe(400)
    expect(error.statusMessage).toBe('Bad Request')
    expect(String(error.statusMessage)).not.toContain('hunter2-key')
    expect(error.data).toEqual({
      code: 'VALIDATION_FAILED',
      issues: [{ message: 'Unrecognized key', path: 'body.hunter2-key' }],
    })
  })
})
