import { describe, expect, it } from 'vitest'

import {
  NARDUK_DEFAULT_CATALOG_BASE_URL,
  resolveNardukNetworkDirectory,
  resolveNardukNetworkDirectoryUrl,
} from '../server/utils/nardukNetworkDirectory'

describe('Narduk network directory', () => {
  it('uses the independent catalog origin by default', () => {
    expect(NARDUK_DEFAULT_CATALOG_BASE_URL).toBe('https://catalog.nard.uk')
    expect(resolveNardukNetworkDirectoryUrl()).toBe('https://catalog.nard.uk/api/network.json')
    expect(resolveNardukNetworkDirectoryUrl('https://example.com/catalog')).toBe(
      'https://example.com/catalog/api/network.json',
    )
  })

  it('filters private, unsafe, duplicate, and current-app entries', () => {
    expect(
      resolveNardukNetworkDirectory(
        {
          updatedAt: '2026-07-14T00:00:00.000Z',
          sites: [
            {
              slug: 'current',
              name: 'Current',
              url: 'https://current.example.com',
              description: 'Current app',
            },
            {
              slug: 'public',
              name: 'Public',
              url: 'https://public.example.com/',
              description: 'Public app',
            },
            {
              slug: 'duplicate',
              name: 'Duplicate',
              url: 'https://public.example.com',
              description: 'Duplicate app',
            },
            {
              slug: 'private',
              name: 'Private',
              url: 'https://private.example.com',
              description: 'Private app',
              public: false,
            },
            {
              slug: 'unsafe',
              name: 'Unsafe',
              url: 'http://unsafe.example.com',
              description: 'Unsafe app',
            },
          ],
        },
        { currentAppUrl: 'https://current.example.com/page' },
      ),
    ).toEqual({
      updatedAt: '2026-07-14T00:00:00.000Z',
      sites: [
        {
          slug: 'public',
          name: 'Public',
          url: 'https://public.example.com',
          description: 'Public app',
        },
      ],
    })
  })
})
