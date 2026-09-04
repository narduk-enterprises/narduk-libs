import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  resolveNardukCatalogBaseUrl,
  resolveNardukNetworkDirectory,
  resolveNardukNetworkDirectoryUrl,
} from '../server/utils/nardukNetworkDirectory'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('Narduk network directory', () => {
  it('has no default endpoint — an unconfigured directory resolves to null', () => {
    expect(resolveNardukNetworkDirectoryUrl()).toBeNull()
    expect(resolveNardukNetworkDirectoryUrl(null)).toBeNull()
    expect(resolveNardukNetworkDirectoryUrl('')).toBeNull()
    expect(resolveNardukNetworkDirectoryUrl('   ')).toBeNull()
  })

  it('uses the injected endpoint verbatim and rejects non-HTTPS values', () => {
    expect(resolveNardukNetworkDirectoryUrl('https://example.com/api/network.json')).toBe(
      'https://example.com/api/network.json',
    )
    expect(resolveNardukNetworkDirectoryUrl('  https://example.com/api/network.json  ')).toBe(
      'https://example.com/api/network.json',
    )
    expect(resolveNardukNetworkDirectoryUrl('http://example.com/api/network.json')).toBeNull()
    expect(resolveNardukNetworkDirectoryUrl('not a url')).toBeNull()
  })

  it('resolves the catalog base URL without a built-in default', () => {
    expect(resolveNardukCatalogBaseUrl()).toBeNull()
    expect(resolveNardukCatalogBaseUrl('')).toBeNull()
    expect(resolveNardukCatalogBaseUrl('https://example.com/')).toBe('https://example.com')
  })

  it('ships no hardcoded operator-console hostname in the directory runtime', () => {
    const sources = [
      'server/utils/nardukNetworkDirectory.ts',
      'server/api/narduk-network/sites.get.ts',
      'app/composables/useNardukNetworkDirectory.ts',
      'app/components/shared/LayerNetworkFooter.vue',
    ].map((relativePath) => readFileSync(join(packageRoot, relativePath), 'utf-8'))

    for (const source of sources) {
      expect(source).not.toContain('command.nard.uk')
      expect(source).not.toContain('catalog.nard.uk')
    }
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
