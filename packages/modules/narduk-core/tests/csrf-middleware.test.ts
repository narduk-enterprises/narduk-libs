import { createServer } from 'node:http'

import { createApp, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import csrf from '../runtime/server/middleware/csrf'
import { DEFAULT_REPORT_ROUTE } from '../runtime/shared/security-headers'

const CSP_REPORT_HEADERS = { 'content-type': 'application/csp-report' }

const { runtime, logger } = vi.hoisted(() => {
  const logger = {
    warn: vi.fn(),
    child: () => logger,
  }
  return {
    runtime: {
      nardukSecurityHeaders: {
        mode: 'report-only' as string,
        reportRoute: '/api/_security/csp-report' as string | false,
      },
      nardukCsrf: { exemptPaths: [] as unknown },
    },
    logger,
  }
})

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => runtime }))
vi.mock('../runtime/server/utils/logger', () => ({ useLogger: () => logger }))

async function post(path: string, headers: Record<string, string> = {}): Promise<Response> {
  const app = createApp()
    .use(csrf)
    .use(() => 'ok')
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers,
    })
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

afterEach(() => {
  runtime.nardukSecurityHeaders.mode = 'report-only'
  runtime.nardukSecurityHeaders.reportRoute = DEFAULT_REPORT_ROUTE
  runtime.nardukCsrf.exemptPaths = []
  logger.warn.mockClear()
})

describe('csrf middleware — CSP report exemption', () => {
  it('lets a browser CSP report through without X-Requested-With', async () => {
    const response = await post(DEFAULT_REPORT_ROUTE, CSP_REPORT_HEADERS)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
  })

  it('still rejects an unrelated POST that is missing X-Requested-With', async () => {
    const response = await post('/api/settings', {
      'content-type': 'application/json',
    })
    expect(response.status).toBe(403)
  })

  it('tracks the configured reportRoute rather than only the default path', async () => {
    runtime.nardukSecurityHeaders.reportRoute = '/csp'
    const custom = await post('/csp', CSP_REPORT_HEADERS)
    expect(custom.status).toBe(200)

    const formerDefault = await post(DEFAULT_REPORT_ROUTE, CSP_REPORT_HEADERS)
    expect(formerDefault.status).toBe(403)
  })

  it('does not CSRF-skip the default report path when security headers are off', async () => {
    runtime.nardukSecurityHeaders.mode = 'off'
    const response = await post(DEFAULT_REPORT_ROUTE, CSP_REPORT_HEADERS)
    expect(response.status).toBe(403)
  })
})

describe('csrf middleware — CSP report route spellings (narduk-libs#415)', () => {
  it.each([`${DEFAULT_REPORT_ROUTE}/`, `${DEFAULT_REPORT_ROUTE}?source=browser`])(
    'lets %s through, since the router dispatches it to the same sink',
    async (path) => {
      const response = await post(path, CSP_REPORT_HEADERS)
      expect(response.status).toBe(200)
    },
  )

  it('does not exempt a sibling of the report route', async () => {
    const response = await post(`${DEFAULT_REPORT_ROUTE}-extra`, CSP_REPORT_HEADERS)
    expect(response.status).toBe(403)
  })
})

describe('csrf middleware — app-declared exemptions (narduk-libs#239)', () => {
  const deviceLegs = ['/api/edge/v1/claim/start', '/api/edge/v1/claim/handoff']

  it('lets a declared device leg through without X-Requested-With', async () => {
    runtime.nardukCsrf.exemptPaths = deviceLegs
    for (const path of deviceLegs) {
      const response = await post(path, { 'content-type': 'application/json' })
      expect(response.status).toBe(200)
    }
  })

  it('keeps the session-bearing sibling protected', async () => {
    runtime.nardukCsrf.exemptPaths = deviceLegs
    const response = await post('/api/edge/v1/claim/complete', {
      'content-type': 'application/json',
    })
    expect(response.status).toBe(403)
  })

  it('honours a declared prefix', async () => {
    runtime.nardukCsrf.exemptPaths = ['/api/devices/*']
    const response = await post('/api/devices/abc/telemetry')
    expect(response.status).toBe(200)
  })

  it('ignores an over-broad entry supplied at runtime', async () => {
    runtime.nardukCsrf.exemptPaths = ['/api/*', '/']
    const response = await post('/api/settings', { 'content-type': 'application/json' })
    expect(response.status).toBe(403)
  })

  it('protects every route when the config block is absent', async () => {
    runtime.nardukCsrf.exemptPaths = undefined
    const response = await post('/api/edge/v1/claim/start')
    expect(response.status).toBe(403)
  })
})
