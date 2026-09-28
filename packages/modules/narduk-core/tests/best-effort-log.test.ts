import { afterEach, describe, expect, it, vi } from 'vitest'

import { warnBestEffort } from '../runtime/internal/best-effort-log'

import type { H3Event } from 'h3'

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({}),
}))

function requestEvent(): H3Event {
  return { context: {}, method: 'GET', path: '/x' } as unknown as H3Event
}

describe('warnBestEffort', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes one warn record through the request logger, scoped by the prefix', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    warnBestEffort(requestEvent(), 'KVCache', 'GET error cache:a', { bindingName: 'KV' })

    // narduk-logging's console sink carries the record, not a bare console.warn
    // from the call site: one structured line with the level, message and data.
    expect(warn).toHaveBeenCalledOnce()
    const record = JSON.parse(String(warn.mock.calls[0]?.[0])) as Record<string, unknown>
    expect(record).toMatchObject({
      data: { bindingName: 'KV' },
      level: 'warn',
      message: '[KVCache] GET error cache:a',
    })
  })

  it('never throws when no request logger can be built', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // No `context` at all: the request logger has nowhere to live.
    expect(() => warnBestEffort({}, 'KV', 'Failed to parse JSON for key')).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
  })
})
