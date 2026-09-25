import { describe, expect, it } from 'vitest'

import {
  readRuntimeBoolean,
  readRuntimeString,
  readRuntimeStringFromKeys,
  readRuntimeStringList,
} from '../runtime/server/utils/runtime-env'

import type { H3Event } from 'h3'

// Wrangler `vars` may be JSON values; Workers hand them to `env` unstringified
// (narduk-libs#935). Keys are unique so the Node env overlay cannot collide.
function eventWithEnv(env: Record<string, unknown>): H3Event {
  return { context: { cloudflare: { env } } } as unknown as H3Event
}

describe('runtime-env readers with non-string wrangler vars', () => {
  it('reads a JSON boolean var as that boolean', () => {
    const on = eventWithEnv({ T935_FLAG: true })
    const off = eventWithEnv({ T935_FLAG: false })

    expect(readRuntimeBoolean(on, 'T935_FLAG')).toBe(true)
    expect(readRuntimeBoolean(off, 'T935_FLAG', { fallback: true, defaultValue: true })).toBe(false)
  })

  it('reads a numeric var as a boolean word', () => {
    expect(readRuntimeBoolean(eventWithEnv({ T935_FLAG: 1 }), 'T935_FLAG')).toBe(true)
    expect(
      readRuntimeBoolean(eventWithEnv({ T935_FLAG: 0 }), 'T935_FLAG', { fallback: true }),
    ).toBe(false)
  })

  it('falls through to the fallback when the var is not a recognisable boolean', () => {
    const event = eventWithEnv({ T935_FLAG: { nested: true } })
    expect(readRuntimeBoolean(event, 'T935_FLAG', { fallback: true })).toBe(true)
    expect(
      readRuntimeBoolean(eventWithEnv({ T935_FLAG: 'maybe' }), 'T935_FLAG', { fallback: 'on' }),
    ).toBe(true)
    expect(readRuntimeBoolean(event, 'T935_FLAG', { defaultValue: true })).toBe(true)
  })

  it('still honours a string var, as before', () => {
    expect(readRuntimeBoolean(eventWithEnv({ T935_FLAG: ' Yes ' }), 'T935_FLAG')).toBe(true)
    expect(
      readRuntimeBoolean(eventWithEnv({ T935_FLAG: 'off' }), 'T935_FLAG', { fallback: true }),
    ).toBe(false)
  })

  it('stringifies numeric and boolean vars for the string readers', () => {
    const event = eventWithEnv({ T935_PORT: 8080, T935_ON: true })

    expect(readRuntimeString(event, 'T935_PORT', { fallback: '1' })).toBe('8080')
    expect(readRuntimeStringFromKeys(event, ['T935_MISSING', 'T935_ON'])).toBe('true')
    expect(readRuntimeStringList(event, 'T935_PORT', { fallbackList: ['x'] })).toEqual(['8080'])
  })

  it('falls through to the fallback for an object var', () => {
    const event = eventWithEnv({ T935_OBJ: { a: 1 } })

    expect(readRuntimeString(event, 'T935_OBJ', { fallback: 'from-config' })).toBe('from-config')
    expect(readRuntimeStringFromKeys(event, ['T935_OBJ'], { fallbacks: ['first'] })).toBe('first')
    expect(readRuntimeStringList(event, 'T935_OBJ', { fallbackList: ['a', 'b'] })).toEqual([
      'a',
      'b',
    ])
  })

  it('keeps an explicit empty string var authoritative for string reads', () => {
    expect(
      readRuntimeString(eventWithEnv({ T935_EMPTY: '' }), 'T935_EMPTY', { fallback: 'x' }),
    ).toBe('')
  })
})
