import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('#imports')
})

/**
 * Ponytail-5 s8 repro for #2003 analytics-seo-devices #19: `catalogUrl` (the
 * catalog hub, per the README) replaced the software's own `url` and never
 * produced `isPartOf`.
 */
describe('useSoftwareApplicationSchema', () => {
  it('keeps url and links catalogUrl as isPartOf', async () => {
    const useSchemaOrg = vi.fn()
    vi.doMock('#imports', () => ({ toValue: (value: unknown) => value, useSchemaOrg }))
    const { useSoftwareApplicationSchema } =
      await import('../app/composables/useSoftwareApplicationSchema')
    useSoftwareApplicationSchema({
      name: 'Harbor',
      url: 'https://harbor.example',
      catalogUrl: 'https://catalog.example',
    })
    expect(useSchemaOrg.mock.calls[0]?.[0]?.[0]).toMatchObject({
      url: 'https://harbor.example',
      isPartOf: { '@type': 'WebSite', url: 'https://catalog.example' },
    })
  })
})
