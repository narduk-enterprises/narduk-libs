import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveSecurityTxtBody, SECURITY_TXT_CONTENT_TYPE } from '../shared/securityTxt'

const CONTACT = 'mailto:security@example.com'

interface StubbedEvent {
  __headers: Map<string, string>
}

/**
 * `securityTxt.get.ts` relies on Nitro's ambient `defineEventHandler`,
 * `useRuntimeConfig`, `setResponseHeader`, and `createError` globals, which a
 * plain vitest module load does not provide. Stub them before importing the
 * handler so the real handler code runs end to end (route, status, headers,
 * body) rather than just its pure helpers.
 */
function stubH3Globals(runtimeConfig: Record<string, unknown>) {
  vi.stubGlobal('defineEventHandler', (handler: (event: StubbedEvent) => unknown) => handler)
  vi.stubGlobal('useRuntimeConfig', () => runtimeConfig)
  vi.stubGlobal('setResponseHeader', (event: StubbedEvent, name: string, value: string) => {
    event.__headers.set(name, value)
  })
  vi.stubGlobal(
    'createError',
    (options: { statusCode: number; statusMessage: string }): Error & { statusCode: number } => {
      const error = new Error(options.statusMessage) as Error & { statusCode: number }
      error.statusCode = options.statusCode
      return error
    },
  )
}

function makeEvent(): StubbedEvent {
  return { __headers: new Map() }
}

async function loadHandler() {
  vi.resetModules()
  return (await import('../server/handlers/securityTxt.get')).default as (
    event: StubbedEvent,
  ) => unknown
}

describe('security.txt server handler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serves the RFC 9116 body with a 200, the right content-type, and the exact body', async () => {
    const body = resolveSecurityTxtBody({ contact: CONTACT }, new Date('2026-09-17T00:00:00.000Z'))
    stubH3Globals({ nardukSeoSecurityTxt: body })
    const handler = await loadHandler()
    const event = makeEvent()

    const result = handler(event)

    expect(result).toBe(body)
    expect(event.__headers.get('content-type')).toBe(SECURITY_TXT_CONTENT_TYPE)
  })

  it('throws a 404 when security.txt is disabled', async () => {
    stubH3Globals({ nardukSeoSecurityTxt: null })
    const handler = await loadHandler()

    expect(() => handler(makeEvent())).toThrow(
      expect.objectContaining({ statusCode: 404, message: 'Not Found' }),
    )
  })

  it('warns once per isolate when Expires is at or past its warning window', async () => {
    const expiredBody = resolveSecurityTxtBody({ contact: CONTACT }, new Date('2000-01-01'))
    stubH3Globals({ nardukSeoSecurityTxt: expiredBody })
    const handler = await loadHandler()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    handler(makeEvent())
    handler(makeEvent())
    handler(makeEvent())

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain('security.txt')
    warnSpy.mockRestore()
  })

  it('does not warn when Expires is comfortably in the future', async () => {
    const freshBody = resolveSecurityTxtBody({ contact: CONTACT }, new Date())
    stubH3Globals({ nardukSeoSecurityTxt: freshBody })
    const handler = await loadHandler()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    handler(makeEvent())

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
