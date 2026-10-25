import { createError } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GoogleApiError } from '../server/utils/google'

/**
 * Ponytail-5 s8 repro for #2003 analytics-seo-devices #10: a Google API 403
 * reached the caller as 500 because the handler read `statusCode`, which
 * `GoogleApiError` does not have.
 */
vi.mock('@narduk-enterprises/narduk-core/server/utils/auth', () => ({
  requireAdmin: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('#narduk-analytics-server/utils/runtimeConfig', () => ({
  analyticsRuntimeConfig: () => ({}),
}))
vi.mock('#narduk-analytics-server/utils/siteConfig', () => ({
  resolveGscSiteUrl: () => 'https://farm.example/',
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Google API errors', () => {
  it('keeps the Google status on the GSC sitemaps route', async () => {
    vi.resetModules()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', createError)
    vi.stubGlobal('GSC_SCOPES', [])
    vi.stubGlobal('GoogleApiError', GoogleApiError)
    vi.stubGlobal('googleApiFetch', async () => {
      throw new GoogleApiError('denied', 403, 'Forbidden', {})
    })
    const handler = (await import('../server/admin/api/admin/gsc/sitemaps.get.ts')).default as (
      event: unknown,
    ) => Promise<unknown>
    await expect(handler({})).rejects.toMatchObject({ statusCode: 403 })
  })
})
