import { readdirSync, readFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { createRequire } from 'node:module'
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
      canonicalRedirectHosts: undefined as string | string[] | undefined,
    },
  },
}))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => runtime }))

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const middlewareDirectory = join(packageRoot, 'runtime/server/middleware')

/** Env wins over `runtimeConfig.public`, so a stray value would silently rewrite every case. */
const ENV_KEYS = [
  'SITE_URL',
  'ENFORCE_CANONICAL_HOST',
  'AUTH_ENFORCE_CANONICAL_HOST',
  'CANONICAL_REDIRECT_HOSTS',
]
const HANDLER_RAN = 'handler-ran'

interface Probe {
  cacheControl: string | null
  location: string | null
  status: number
  text: string
  vary: string | null
}

async function probe(
  path: string,
  init: { headers?: Record<string, string>; method?: string } = {},
): Promise<Probe> {
  const app = createApp()
    .use(canonicalHost)
    .use(() => HANDLER_RAN)
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    // node:http rather than fetch: fetch drops a caller-set `host` header, and
    // the host is what the middleware routes on.
    return await new Promise<Probe>((resolve, reject) => {
      const req = request(
        {
          headers: init.headers,
          host: '127.0.0.1',
          method: init.method ?? 'GET',
          path,
          port: address.port,
        },
        (response) => {
          let text = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => (text += chunk))
          response.on('end', () => {
            const header = (name: string) => {
              const value = response.headers[name]
              return value === undefined ? null : Array.isArray(value) ? value.join(', ') : value
            }
            resolve({
              cacheControl: header('cache-control'),
              location: header('location'),
              status: response.statusCode ?? 0,
              text,
              vary: header('vary'),
            })
          })
        },
      )
      req.on('error', reject)
      req.end()
    })
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

function varyTokens(vary: string | null): string[] {
  return (vary ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
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

const PAGE_PATH = '/lakes/superior'
const WWW_HOST = 'www.example.com'
const PREVIEW_HOST = 'app.acct.workers.dev'
const API_PATH = '/api/mapkit/token'
const CANONICAL_PAGE_URL = 'https://www.example.com/lakes/superior'

describe('canonical-host middleware', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) vi.stubEnv(key, undefined)
    runtime.public.appUrl = 'https://www.example.com'
    runtime.public.enforceCanonicalHost = true
    runtime.public.authEnforceCanonicalHost = false
    runtime.public.canonicalRedirectHosts = undefined
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('the redirect never leaves the canonical origin (narduk-libs#444)', () => {
    // A raw dot segment before `//` survives h3's leading-slash collapse and
    // normalises to the pathname `//evil.com`; resolved as a relative
    // reference against the canonical URL that is https://evil.com/.
    it.each(['/.//evil.com', '/a/..//evil.com', '/.//evil.com/x?y=1', '/./\\\\evil.com'])(
      'keeps %s on the canonical host',
      async (path) => {
        const result = await probe(path, { headers: DOCUMENT_NAVIGATION })

        expect(result.status).toBe(308)
        expect(new URL(result.location!).origin).toBe('https://www.example.com')
        expect(result.location).toMatch(/^https:\/\/www\.example\.com\/evil\.com/)
      },
    )
  })

  describe('top-level document navigations still canonicalise', () => {
    it('redirects a page navigation on a non-canonical host', async () => {
      const result = await probe(`${PAGE_PATH}?utm_source=gsc`, {
        headers: DOCUMENT_NAVIGATION,
      })

      expect(result.status).toBe(308)
      expect(result.location).toBe(`${CANONICAL_PAGE_URL}?utm_source=gsc`)
    })

    it('redirects a HEAD navigation', async () => {
      const result = await probe(PAGE_PATH, {
        method: 'HEAD',
        headers: DOCUMENT_NAVIGATION,
      })

      expect(result.status).toBe(308)
      expect(result.location).toBe(CANONICAL_PAGE_URL)
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

    it('sends the 308 private, no-store with Vary: Sec-Fetch-Dest', async () => {
      const result = await probe(PAGE_PATH, { headers: DOCUMENT_NAVIGATION })

      expect(result.status).toBe(308)
      expect(result.location).toBe(CANONICAL_PAGE_URL)
      expect(result.cacheControl).toBe('private, no-store')
      expect(varyTokens(result.vary)).toContain('sec-fetch-dest')
    })

    it('redirects a document form GET and preserves the query string', async () => {
      const result = await probe('/login?email=user%40example.com', {
        headers: {
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',
        },
      })

      expect(result.status).toBe(308)
      expect(result.location).toBe('https://www.example.com/login?email=user%40example.com')
    })
  })

  describe('sub-resource requests are never redirected cross-origin', () => {
    it('lets a same-origin fetch of an API route run on the routed host', async () => {
      const result = await probe(API_PATH, { headers: SAME_ORIGIN_FETCH })

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
      expect(result.text).toBe(HANDLER_RAN)
    })

    it('lets a fetch of a page path run on the routed host', async () => {
      const result = await probe(PAGE_PATH, { headers: SAME_ORIGIN_FETCH })

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

    it('does not redirect an iframe navigation of /auth/callback', async () => {
      const result = await probe('/auth/callback?code=abc123', {
        headers: {
          'sec-fetch-dest': 'iframe',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'cross-site',
        },
      })

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
      expect(result.text).toBe(HANDLER_RAN)
    })

    it('does not redirect a prefetch of a page path', async () => {
      const result = await probe(PAGE_PATH, {
        headers: {
          'sec-fetch-dest': 'empty',
          'sec-purpose': 'prefetch',
        },
      })

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
      expect(result.text).toBe(HANDLER_RAN)
    })
  })

  describe('requests carrying no fetch metadata', () => {
    it('still canonicalises page paths for crawlers and old clients', async () => {
      const result = await probe(PAGE_PATH)

      expect(result.status).toBe(308)
      expect(result.location).toBe(CANONICAL_PAGE_URL)
    })

    it('does not redirect API paths', async () => {
      const result = await probe(API_PATH)

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
      expect(result.text).toBe(HANDLER_RAN)
    })

    it('does not redirect a no-metadata GET of /api/auth/session/exchange', async () => {
      const result = await probe('/api/auth/session/exchange?code=abc123')

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
      expect(result.text).toBe(HANDLER_RAN)
    })

    it('does not redirect framework-internal paths', async () => {
      const result = await probe('/_nuxt/entry.js')

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
    })
  })

  describe('a named host list redirects only those hosts (narduk-libs#515)', () => {
    const onHost = (host: string) => ({ headers: { ...DOCUMENT_NAVIGATION, host } })

    beforeEach(() => {
      runtime.public.appUrl = 'https://example.com'
      runtime.public.enforceCanonicalHost = false
      runtime.public.canonicalRedirectHosts = WWW_HOST
    })

    it('redirects a navigation on a named host without ENFORCE_CANONICAL_HOST', async () => {
      const result = await probe(`${PAGE_PATH}?q=1`, onHost(WWW_HOST))

      expect(result.status).toBe(308)
      expect(result.location).toBe('https://example.com/lakes/superior?q=1')
    })

    it('serves a workers.dev preview where it was asked, even with ENFORCE_CANONICAL_HOST on', async () => {
      runtime.public.enforceCanonicalHost = true

      for (const host of [PREVIEW_HOST, 'a1b2c3d4-app.acct.workers.dev']) {
        const result = await probe(PAGE_PATH, onHost(host))
        expect(result.status, host).toBe(200)
        expect(result.text).toBe(HANDLER_RAN)
      }
    })

    it('ignores a workers.dev entry in the list', async () => {
      runtime.public.canonicalRedirectHosts = [WWW_HOST, PREVIEW_HOST]

      const result = await probe(PAGE_PATH, onHost(PREVIEW_HOST))
      expect(result.status).toBe(200)
    })

    it('serves the canonical host and an unnamed host where they were asked', async () => {
      for (const host of ['example.com', 'staging.example.com']) {
        const result = await probe(PAGE_PATH, onHost(host))
        expect(result.status, host).toBe(200)
      }
    })

    it('reads the list from the env, which beats runtimeConfig', async () => {
      vi.stubEnv('CANONICAL_REDIRECT_HOSTS', ' https://old.example.com/ , WWW.example.net')

      expect((await probe(PAGE_PATH, onHost('old.example.com'))).status).toBe(308)
      expect((await probe(PAGE_PATH, onHost('www.example.net'))).status).toBe(308)
      expect((await probe(PAGE_PATH, onHost(WWW_HOST))).status).toBe(200)
    })

    it('still never redirects a sub-resource fetch on a named host', async () => {
      const result = await probe(API_PATH, {
        headers: { ...SAME_ORIGIN_FETCH, host: WWW_HOST },
      })
      expect(result.status).toBe(200)
    })
  })

  describe('gates that must keep working', () => {
    it('skips non-safe methods', async () => {
      const result = await probe(PAGE_PATH, {
        method: 'POST',
        headers: DOCUMENT_NAVIGATION,
      })

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
    })

    it('skips when canonical host enforcement is disabled', async () => {
      runtime.public.enforceCanonicalHost = false

      const result = await probe(PAGE_PATH, { headers: DOCUMENT_NAVIGATION })

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
    })

    it('skips when the canonical URL is localhost', async () => {
      runtime.public.appUrl = 'http://localhost:3000'

      const result = await probe(PAGE_PATH, { headers: DOCUMENT_NAVIGATION })

      expect(result.status).toBe(200)
      expect(result.location).toBeNull()
    })

    it('does not trust x-forwarded-host to bypass the redirect', async () => {
      const result = await probe(PAGE_PATH, {
        headers: { ...DOCUMENT_NAVIGATION, 'x-forwarded-host': WWW_HOST },
      })

      expect(result.status).toBe(308)
      expect(result.location).toBe(CANONICAL_PAGE_URL)
    })
  })

  describe('exactly one canonical redirect is registered (narduk-libs#409)', () => {
    /**
     * The source with its comments removed, so a middleware whose doc comment
     * only mentions canonicalisation does not read as a second redirect
     * (narduk-libs#682). A redirect still has to be written in code, and code
     * keeps every string and identifier, so the guard loses no strength. A
     * scanner, not a lazy block-comment regex, which is polynomial on an
     * unterminated `/*`. A `//` right after `:` is a URL scheme.
     */
    function withoutComments(source: string): string {
      let code = ''
      let index = 0
      while (index < source.length) {
        if (source.startsWith('/*', index)) {
          const end = source.indexOf('*/', index + 2)
          index = end === -1 ? source.length : end + 2
          code += ' '
        } else if (source.startsWith('//', index) && source[index - 1] !== ':') {
          const end = source.indexOf('\n', index)
          index = end === -1 ? source.length : end
        } else {
          code += source[index]
          index++
        }
      }
      return code
    }

    function mentionsCanonicalInCode(source: string): boolean {
      return /canonical/i.test(withoutComments(source))
    }

    it('leaves one canonical-host middleware in the auto-scanned tree', () => {
      const canonicalMiddleware = readdirSync(middlewareDirectory)
        .filter((entry) => entry.endsWith('.ts'))
        .filter((entry) =>
          mentionsCanonicalInCode(readFileSync(join(middlewareDirectory, entry), 'utf-8')),
        )

      expect(
        canonicalMiddleware,
        'server/middleware files whose code (comments excluded) mentions "canonical"; only one canonical redirect may be auto-scanned (narduk-libs#409)',
      ).toEqual(['00-canonical-host.ts'])
    })

    it('ignores prose about canonicalisation but not a redirect in code (narduk-libs#682)', () => {
      const prose = [
        '/**',
        ' * Runs right after the canonical-host redirect.',
        ' */',
        '// keep ordering with the canonical middleware',
        'export default defineEventHandler(() => {})',
      ].join('\n')
      const redirect = [
        '// a comment that says nothing',
        'const canonicalOrigin = "https://example.com"',
        'export default defineEventHandler((event) => {',
        '  setResponseStatus(event, 308)',
        '  setResponseHeader(event, "location", canonicalOrigin + event.path)',
        '})',
      ].join('\n')

      expect(mentionsCanonicalInCode(prose)).toBe(false)
      expect(mentionsCanonicalInCode(redirect)).toBe(true)
      expect(mentionsCanonicalInCode('/* unterminated canonical')).toBe(false)
      expect(mentionsCanonicalInCode('const url = "https://x.test/canonical"')).toBe(true)
    })

    it('resolves the retired middleware specifier to the live handler', () => {
      const specifier = '@narduk-enterprises/narduk-core/server/middleware/canonicalRedirect'
      const resolved = (
        typeof import.meta.resolve === 'function'
          ? fileURLToPath(import.meta.resolve(specifier))
          : createRequire(import.meta.url).resolve(specifier)
      ).replaceAll('\\', '/')

      expect(resolved.endsWith('runtime/server/handlers/canonicalRedirect.ts')).toBe(true)

      const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
        exports: Record<string, unknown>
      }
      expect(packageJson.exports['./server/middleware/canonicalRedirect']).toEqual({
        import: './runtime/server/handlers/canonicalRedirect.ts',
      })
    })
  })
})
