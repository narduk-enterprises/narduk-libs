import { createServer } from 'node:http'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createApp, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import canonicalHost from '../runtime/server/middleware/00-canonical-host'

const { runtime } = vi.hoisted(() => ({
  runtime: {
    public: {
      appUrl: 'https://www.example.com',
      enforceCanonicalHost: true as boolean | string,
      authEnforceCanonicalHost: false as boolean | string,
    },
  },
}))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => runtime }))

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const middlewareDirectory = join(packageRoot, 'runtime/server/middleware')

/** Env wins over `runtimeConfig.public`, so a stray value would silently rewrite every case. */
const ENV_KEYS = ['SITE_URL', 'ENFORCE_CANONICAL_HOST', 'AUTH_ENFORCE_CANONICAL_HOST']

interface Probe {
  location: string | null
  status: number
  text: string
}

async function probe(
  path: string,
  init: { headers?: Record<string, string>; method?: string } = {},
): Promise<Probe> {
  const app = createApp()
    .use(canonicalHost)
    .use(() => 'handler-ran')
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: init.method ?? 'GET',
      headers: init.headers,
      redirect: 'manual',
    })
    return {
      location: response.headers.get('location'),
      status: response.status,
      text: await response.text(),
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

/** Chromium 1243, measured: a top-level tab navigation (narduk-libs#408). */
const DOCUMENT_NAVIGATION = {
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
}

/** Chromium 1243, measured: a same-origin `fetch()` (narduk-libs#408). */
const SAME_ORIGIN_FETCH = {
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
}

describe('canonical-host middleware', () => {
  const removedEnv = new Map<string, string | undefined>()

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      removedEnv.set(key, process.env[key])
      delete process.env[key]
    }
    runtime.public.appUrl = 'https://www.example.com'
    runtime.public.enforceCanonicalHost = true
    runtime.public.authEnforceCanonicalHost = false
  })

  afterEach(() => {
    for (const [key, value] of removedEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    removedEnv.clear()
  })

  describe('top-level document navigations still canonicalise', () => {
    it('redirects a page navigation on a non-canonical host', async () => {
      const result = await probe('/lakes/superior?utm_source=gsc', {
        headers: DOCUMENT_NAVIGATION,
      })

      expect(result.status).toBe(308)
      expect(result.location).toBe('https://www.example.com/lakes/superior?utm_source=gsc')
    })

    it('redirects a HEAD navigation', async () => {
      const result = await probe('/lakes/superior', {
        method: 'HEAD',
        headers: DOCUMENT_NAVIGATION,
      })

      expect(result.status).toBe(308)
      expect(result.location).toBe('https://www.example.com/lakes/superior')
    })

    it('redirects the auth callback page so the session cookie lands on the canonical host', async () => {
      runtime.public.enforceCanonicalHost = false
      runtime.public.authEnforceCanonicalHost = true

      const result = await probe('/auth/callback?code=abc123&next=%2Fdashboard', {
        headers: { ...DOCUMENT_NAVIGATION, 'sec-fetch-site': 'cross-site' },
      })

      expect(result.status).toBe(308)
      expect(result.location).toBe(
        'https://www.example.com/auth/callback?code=abc123&next=%2Fdashboard',
      )
    })

    it('redirects a document navigation to an auth route under /api', async () => {
      runtime.public.enforceCanonicalHost = false
      runtime.public.authEnforceCanonicalHost = true

      const result = await probe('/api/auth/session/exchange?code=abc123', {
        headers: { ...DOCUMENT_NAVIGATION, 'sec-fetch-site': 'cross-site' },
      })

      expect(result.status).toBe(308)
      expect(result.location).toBe('https://www.example.com/api/auth/session/exchange?code=abc123')
    })
  })

  describe('sub-resource requests are never redirected cross-origin', () => {
    it('lets a same-origin fetch of an API route run on the routed host', async () => {
      const result = await probe('/api/mapkit/token', { headers: SAME_ORIGIN_FETCH })

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
      expect(result.text).toBe('handler-ran')
    })

    it('lets a fetch of a page path run on the routed host', async () => {
      const result = await probe('/lakes/superior', { headers: SAME_ORIGIN_FETCH })

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
    })

    it('lets framework sub-resources run on the routed host', async () => {
      for (const [path, destination] of [
        ['/_nuxt/entry.js', 'script'],
        ['/_ipx/w_640/hero.png', 'image'],
        ['/__nuxt_island/Hero.json', 'empty'],
      ] as const) {
        const result = await probe(path, { headers: { 'sec-fetch-dest': destination } })

        expect(result.status).toBe(200)
        expect(result.location).toBeNull()
      }
    })
  })

  describe('requests carrying no fetch metadata', () => {
    it('still canonicalises page paths for crawlers and old clients', async () => {
      const result = await probe('/lakes/superior')

      expect(result.status).toBe(308)
      expect(result.location).toBe('https://www.example.com/lakes/superior')
    })

    it('does not redirect API paths', async () => {
      const result = await probe('/api/mapkit/token')

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
      expect(result.text).toBe('handler-ran')
    })

    it('does not redirect framework-internal paths', async () => {
      const result = await probe('/_nuxt/entry.js')

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
    })
  })

  describe('gates that must keep working', () => {
    it('skips non-safe methods', async () => {
      const result = await probe('/lakes/superior', {
        method: 'POST',
        headers: DOCUMENT_NAVIGATION,
      })

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
    })

    it('skips when canonical host enforcement is disabled', async () => {
      runtime.public.enforceCanonicalHost = false

      const result = await probe('/lakes/superior', { headers: DOCUMENT_NAVIGATION })

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
    })

    it('skips when the canonical URL is localhost', async () => {
      runtime.public.appUrl = 'http://localhost:3000'

      const result = await probe('/lakes/superior', { headers: DOCUMENT_NAVIGATION })

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
    })

    it('does not trust x-forwarded-host to bypass the redirect', async () => {
      const result = await probe('/lakes/superior', {
        headers: { ...DOCUMENT_NAVIGATION, 'x-forwarded-host': 'www.example.com' },
      })

      expect(result.status).toBe(308)
      expect(result.location).toBe('https://www.example.com/lakes/superior')
    })
  })

  describe('exactly one canonical redirect is registered (narduk-libs#409)', () => {
    it('leaves one canonical-host middleware in the auto-scanned tree', () => {
      const canonicalMiddleware = readdirSync(middlewareDirectory)
        .filter((entry) => entry.endsWith('.ts'))
        .filter((entry) =>
          /canonical/i.test(readFileSync(join(middlewareDirectory, entry), 'utf-8')),
        )

      expect(canonicalMiddleware).toEqual(['00-canonical-host.ts'])
    })

    it('keeps the retired middleware path importable as an alias for the live handler', async () => {
      const alias =
        (await import('../runtime/server/handlers/canonicalRedirect')) as typeof import('../runtime/server/handlers/canonicalRedirect')

      expect(alias.default).toBe(canonicalHost)

      const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
        exports: Record<string, unknown>
      }
      expect(packageJson.exports['./server/middleware/canonicalRedirect']).toEqual({
        import: './runtime/server/handlers/canonicalRedirect.ts',
      })
    })
  })
})
