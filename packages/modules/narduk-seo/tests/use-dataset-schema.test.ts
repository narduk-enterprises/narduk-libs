import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DatasetSchemaInput } from '../app/composables/useDatasetSchema'
import type { MaybeRefOrGetter } from 'vue'

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.doUnmock('#imports')
})

type DatasetNode = Record<string, unknown>

const STATION = 'Station 41002'

async function runUseDatasetSchema(
  input: MaybeRefOrGetter<DatasetSchemaInput>,
): Promise<DatasetNode | undefined> {
  // Each run needs its own module instance: a second `await import` in one test
  // would otherwise resolve from cache and keep writing to the first mock.
  vi.resetModules()
  const useSchemaOrg = vi.fn()
  vi.doMock('#imports', () => ({
    toValue: (value: unknown) => (typeof value === 'function' ? value() : value),
    useSchemaOrg,
  }))
  const composables = await import('../app/composables/useDatasetSchema')
  composables.useDatasetSchema(input)
  const nodes = useSchemaOrg.mock.calls[0]?.[0] as DatasetNode[] | undefined
  return nodes?.[0]
}

describe('useDatasetSchema', () => {
  it('emits a Dataset node and omits every field that was not supplied', async () => {
    const node = await runUseDatasetSchema({ name: 'NDBC station 41002' })

    expect(node).toEqual({ '@type': 'Dataset', name: 'NDBC station 41002' })
  })

  it('does not register anything without a name', async () => {
    const node = await runUseDatasetSchema({ name: '' })

    expect(node).toBeUndefined()
  })

  it('resolves a getter so a page can pass reactive data', async () => {
    const node = await runUseDatasetSchema(() => ({ name: 'Resolved late' }))

    expect(node?.name).toBe('Resolved late')
  })

  it('maps both string and object variables to PropertyValue nodes', async () => {
    const node = await runUseDatasetSchema({
      name: STATION,
      variableMeasured: [
        'Significant wave height',
        { name: 'Water temperature', unitText: '°C', unitCode: 'CEL', minValue: -2, maxValue: 35 },
      ],
    })

    expect(node?.variableMeasured).toEqual([
      { '@type': 'PropertyValue', name: 'Significant wave height' },
      {
        '@type': 'PropertyValue',
        name: 'Water temperature',
        unitText: '°C',
        unitCode: 'CEL',
        minValue: -2,
        maxValue: 35,
      },
    ])
  })

  it('keeps a zero bound rather than dropping it as falsy', async () => {
    const node = await runUseDatasetSchema({
      name: STATION,
      variableMeasured: [{ name: 'Wave height', minValue: 0, maxValue: 0 }],
    })

    expect(node?.variableMeasured).toEqual([
      { '@type': 'PropertyValue', name: 'Wave height', minValue: 0, maxValue: 0 },
    ])
  })

  it('drops variables and distributions that carry nothing identifying', async () => {
    const node = await runUseDatasetSchema({
      name: STATION,
      variableMeasured: ['', { name: '' }],
      distribution: [{ contentUrl: '' }],
    })

    expect(node).not.toHaveProperty('variableMeasured')
    expect(node).not.toHaveProperty('distribution')
  })

  it('maps distributions to DataDownload nodes', async () => {
    const node = await runUseDatasetSchema({
      name: STATION,
      distribution: [
        {
          contentUrl: 'https://www.ndbc.noaa.gov/data/realtime2/41002.txt',
          encodingFormat: 'text/plain',
          name: 'Realtime standard meteorological data',
        },
        { contentUrl: 'https://example.com/41002.json' },
      ],
    })

    expect(node?.distribution).toEqual([
      {
        '@type': 'DataDownload',
        contentUrl: 'https://www.ndbc.noaa.gov/data/realtime2/41002.txt',
        name: 'Realtime standard meteorological data',
        encodingFormat: 'text/plain',
      },
      { '@type': 'DataDownload', contentUrl: 'https://example.com/41002.json' },
    ])
  })

  it('credits an Organization unless the creator says otherwise', async () => {
    const asOrganization = await runUseDatasetSchema({
      name: STATION,
      creator: { name: 'NOAA NDBC', url: 'https://www.ndbc.noaa.gov' },
    })
    const asPerson = await runUseDatasetSchema({
      name: 'Field notes',
      creator: { '@type': 'Person', name: 'A. Researcher' },
    })

    expect(asOrganization?.creator).toEqual({
      '@type': 'Organization',
      name: 'NOAA NDBC',
      url: 'https://www.ndbc.noaa.gov',
    })
    expect(asPerson?.creator).toEqual({ '@type': 'Person', name: 'A. Researcher' })
  })

  it('wraps a catalog URL in a DataCatalog node', async () => {
    const node = await runUseDatasetSchema({
      name: STATION,
      includedInDataCatalogUrl: 'https://buoys.nard.uk/stations',
    })

    expect(node?.includedInDataCatalog).toEqual({
      '@type': 'DataCatalog',
      url: 'https://buoys.nard.uk/stations',
    })
  })

  it('preserves isAccessibleForFree: false instead of treating it as unset', async () => {
    const node = await runUseDatasetSchema({ name: 'Paywalled series', isAccessibleForFree: false })

    expect(node?.isAccessibleForFree).toBe(false)
  })

  it('carries the licence, coverage and identifier fields through unchanged', async () => {
    const node = await runUseDatasetSchema({
      name: STATION,
      description: 'South Hatteras',
      url: 'https://buoys.nard.uk/stations/41002',
      identifier: '41002',
      keywords: ['buoy', 'wave height'],
      license: 'https://creativecommons.org/publicdomain/zero/1.0/',
      temporalCoverage: '2020-01-01/..',
      spatialCoverage: 'South Hatteras, Atlantic Ocean',
      dateModified: '2026-09-20T00:00:00Z',
      sameAs: ['https://www.ndbc.noaa.gov/station_page.php?station=41002'],
    })

    expect(node).toMatchObject({
      description: 'South Hatteras',
      url: 'https://buoys.nard.uk/stations/41002',
      identifier: '41002',
      keywords: ['buoy', 'wave height'],
      license: 'https://creativecommons.org/publicdomain/zero/1.0/',
      temporalCoverage: '2020-01-01/..',
      spatialCoverage: 'South Hatteras, Atlantic Ocean',
      dateModified: '2026-09-20T00:00:00Z',
      sameAs: ['https://www.ndbc.noaa.gov/station_page.php?station=41002'],
    })
  })
})
