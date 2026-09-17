import { createServer } from 'node:http'

import { createApp, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import csrf from '../runtime/server/middleware/csrf'
import { DEFAULT_REPORT_ROUTE } from '../runtime/shared/security-headers'

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
  logger.warn.mockClear()
})

describe('csrf middleware — CSP report exemption', () => {
  it('lets a browser CSP report through without X-Requested-With', async () => {
    const response = await post(DEFAULT_REPORT_ROUTE, {
      'content-type': 'application/csp-report',
    })
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
    const custom = await post('/csp', { 'content-type': 'application/csp-report' })
    expect(custom.status).toBe(200)

    const formerDefault = await post(DEFAULT_REPORT_ROUTE, {
      'content-type': 'application/csp-report',
    })
    expect(formerDefault.status).toBe(403)
  })

  it('does not CSRF-skip the default report path when security headers are off', async () => {
    runtime.nardukSecurityHeaders.mode = 'off'
    const response = await post(DEFAULT_REPORT_ROUTE, {
      'content-type': 'application/csp-report',
    })
    expect(response.status).toBe(403)
  })
})
