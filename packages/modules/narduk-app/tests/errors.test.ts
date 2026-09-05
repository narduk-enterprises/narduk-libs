import { describe, expect, it } from 'vitest'

import { apiError, DEFAULT_REASON_PHRASES, reasonPhrase } from '../src/server/errors'

describe('reasonPhrase', () => {
  it('returns the IANA phrase for a known status', () => {
    expect(reasonPhrase(404)).toBe('Not Found')
    expect(reasonPhrase(409)).toBe('Conflict')
  })

  it('falls back to a generic phrase by status class', () => {
    expect(reasonPhrase(418)).toBe('Request Error')
    expect(reasonPhrase(599)).toBe('Server Error')
  })

  it('accepts an app-specific table without losing the built-in phrases', () => {
    const table = { ...DEFAULT_REASON_PHRASES, 418: "I'm a Teapot" }
    expect(reasonPhrase(418, table)).toBe("I'm a Teapot")
    expect(reasonPhrase(404, table)).toBe('Not Found')
  })
})

describe('apiError', () => {
  it('puts the sentence in message and the reason phrase in statusMessage', () => {
    const err = apiError(409, 'Station A has order #12 on it — move the trailer off the bay first.')
    expect(err.statusCode).toBe(409)
    expect(err.statusMessage).toBe('Conflict')
    // h3's createError keeps the free-text message untouched, including the
    // em-dash a sanitized statusMessage would have deleted.
    expect(err.message).toBe('Station A has order #12 on it — move the trailer off the bay first.')
  })

  it('omits data entirely when none is given, rather than serializing undefined', () => {
    const err = apiError(404, 'Not found here.')
    expect(err.data).toBeUndefined()
  })

  it('carries machine-readable data the client can branch on', () => {
    const err = apiError(409, 'Nothing to undo.', { code: 'bay_occupied' })
    expect(err.data).toEqual({ code: 'bay_occupied' })
  })

  it('uses an app-supplied reason table when given one', () => {
    const err = apiError(418, "I won't brew coffee.", undefined, { 418: "I'm a Teapot" })
    expect(err.statusMessage).toBe("I'm a Teapot")
  })
})
