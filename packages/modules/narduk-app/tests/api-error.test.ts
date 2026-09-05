import { describe, expect, it } from 'vitest'

import {
  apiErrorCode,
  apiErrorMessage,
  apiErrorStatus,
  describeApiError,
  isZodIssueDump,
} from '../src/client/api-error'

/** A caught `$fetch` rejection: ofetch puts the parsed response body on `data`. */
const rejection = (body: unknown) => ({ data: body })

/** The exact shape Nitro sends for a Zod-issue-dump refusal -- `message` is
 *  the pretty-printed issue array, `data` the serialized ZodError. */
const zodRefusal = rejection({
  data: { message: 'Invalid input', name: 'ZodError' },
  message:
    '[\n  {\n    "expected": "object",\n    "code": "invalid_type",\n    "path": [],\n    "message": "Invalid input: expected object, received undefined"\n  }\n]',
  statusCode: 400,
  statusMessage: 'Bad Request',
})

describe('apiErrorMessage', () => {
  it('renders the server sentence verbatim when a person wrote one', () => {
    expect(
      apiErrorMessage(
        rejection({ message: 'Nothing to undo', statusCode: 409 }),
        "Couldn't step that back.",
      ),
    ).toBe('Nothing to undo')
  })

  it('falls back to the caller sentence for a Zod issue-array dump', () => {
    expect(apiErrorMessage(zodRefusal, "Couldn't step that back.")).toBe("Couldn't step that back.")
  })

  it('recognizes a dump by its message alone -- a compact issue array, no data', () => {
    const body = rejection({
      message: '[{"code":"invalid_type","path":[],"message":"Invalid input"}]',
      statusCode: 400,
    })
    expect(apiErrorMessage(body, 'Try again.')).toBe('Try again.')
  })

  it('falls back to statusMessage when message is absent, never an empty string', () => {
    expect(
      apiErrorMessage(
        rejection({ message: '', statusCode: 404, statusMessage: 'Not Found' }),
        'Try again.',
      ),
    ).toBe('Not Found')
  })

  it('falls back to the caller fallback for a network failure with no body', () => {
    expect(apiErrorMessage(new TypeError('Failed to fetch'), 'Something went wrong.')).toBe(
      'Something went wrong.',
    )
  })
})

describe('isZodIssueDump', () => {
  it('is false for undefined', () => {
    expect(isZodIssueDump(undefined)).toBe(false)
  })

  it('is true when data.name is ZodError even without a bracketed message', () => {
    expect(isZodIssueDump({ data: { name: 'ZodError' } })).toBe(true)
  })
})

describe('apiErrorCode / apiErrorStatus', () => {
  it('reads the machine-readable code and status a refusal was tagged with', () => {
    const err = rejection({ data: { code: 'bay_occupied' }, statusCode: 409 })
    expect(apiErrorCode(err)).toBe('bay_occupied')
    expect(apiErrorStatus(err)).toBe(409)
  })

  it('returns undefined for a code/status that is not present', () => {
    expect(apiErrorCode(new Error('boom'))).toBeUndefined()
    expect(apiErrorStatus(new Error('boom'))).toBeUndefined()
  })
})

describe('describeApiError', () => {
  it('prefers message over statusMessage', () => {
    expect(
      describeApiError(
        rejection({ message: 'Nothing to undo', statusCode: 409, statusMessage: 'Conflict' }),
      ),
    ).toEqual({ message: 'Nothing to undo', statusCode: 409 })
  })

  it('strips a given literal prefix', () => {
    expect(
      describeApiError(
        rejection({ message: 'Validation error: name is required', statusCode: 422 }),
        'Validation error: ',
      ),
    ).toEqual({ message: 'name is required', statusCode: 422 })
  })

  it('returns nulls for an error with no readable body', () => {
    expect(describeApiError(new Error('network down'))).toEqual({ message: null, statusCode: null })
  })
})
