import { createServer } from 'node:http'

import { createApp, toNodeListener } from 'h3'
import { describe, expect, it, vi } from 'vitest'

import csrf from '../runtime/server/middleware/csrf'

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    nardukSecurityHeaders: { mode: 'report-only', reportRoute: '/api/_security/csp-report' },
    nardukCsrf: { enabled: undefined, exemptPaths: [] },
  }),
}))
vi.mock('../runtime/server/utils/logger', () => {
  const logger = { warn: vi.fn(), child: () => logger }
  return { useLogger: () => logger }
})

async function send(method: string, path: string, headers: Record<string, string> = {}) {
  const app = createApp()
    .use(csrf)
    .use(() => 'ok')
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('ponytail-5 csrf hard-coded skips (core-tests #7)', () => {
  it('skips /api/owner-tag when the URL has a query string', async () => {
    expect((await send('POST', '/api/owner-tag?x=1')).status).toBe(200)
  })
  it('still denies /api/webhooks-evil (boundary pin)', async () => {
    expect((await send('POST', '/api/webhooks-evil')).status).toBe(403)
  })
  it('still denies PUT and DELETE without the header (boundary pin)', async () => {
    expect((await send('PUT', '/api/settings')).status).toBe(403)
    expect((await send('DELETE', '/api/settings')).status).toBe(403)
  })
})
