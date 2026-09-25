import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LocalBusinessOptions } from '../app/composables/useLocalBusinessSchema'

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.doUnmock('#imports')
})

type LocalBusinessNode = Record<string, unknown>

const ADDRESS = {
  addressLocality: 'Austin',
  addressRegion: 'TX',
  postalCode: '78701',
  streetAddress: '1 Congress Ave',
}

async function runUseLocalBusinessSchema(
  options: LocalBusinessOptions,
): Promise<LocalBusinessNode | undefined> {
  vi.resetModules()
  const useSchemaOrg = vi.fn()
  vi.doMock('#imports', () => ({ useSchemaOrg }))
  const composables = await import('../app/composables/useLocalBusinessSchema')
  composables.useLocalBusinessSchema(options)
  const nodes = useSchemaOrg.mock.calls[0]?.[0] as LocalBusinessNode[] | undefined
  return nodes?.[0]
}

describe('useLocalBusinessSchema', () => {
  // narduk-libs#944: the text form ("Mo-Fr 09:00-17:00") belongs under
  // schema.org `openingHours`. `openingHoursSpecification` takes
  // OpeningHoursSpecification objects, so strings there are invalid JSON-LD.
  it('emits opening-hours strings as openingHours, not openingHoursSpecification', async () => {
    const node = await runUseLocalBusinessSchema({
      name: 'Shop',
      address: ADDRESS,
      openingHours: ['Mo-Fr 09:00-17:00', 'Sa 10:00-14:00'],
    })

    expect(node?.openingHours).toEqual(['Mo-Fr 09:00-17:00', 'Sa 10:00-14:00'])
    expect(node).not.toHaveProperty('openingHoursSpecification')
  })

  it('omits opening hours when none are given', async () => {
    const node = await runUseLocalBusinessSchema({
      name: 'Shop',
      address: ADDRESS,
      openingHours: [],
    })

    expect(node).not.toHaveProperty('openingHours')
    expect(node).not.toHaveProperty('openingHoursSpecification')
  })

  it('defaults the address country to US', async () => {
    const node = await runUseLocalBusinessSchema({ name: 'Shop', address: ADDRESS })

    expect(node?.['@type']).toBe('LocalBusiness')
    expect(node?.address).toMatchObject({ '@type': 'PostalAddress', addressCountry: 'US' })
  })
})
