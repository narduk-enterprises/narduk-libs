import { describe, expect, it } from 'vitest'

import type { DevelopmentComponent } from '../src/development-config.js'
import { DevelopmentCloudflare } from '../src/development-provider.js'

/**
 * narduk-libs#1096: a Cloudflare request that never completed used to throw one
 * fixed message, so a timeout, a DNS failure and a reset connection looked the
 * same in the error and in the deploy receipt (which records `error.message`).
 */

const TOKEN = 'cf-token-must-not-leak'

const component = {
  accountId: 'account-1',
  workerName: 'operator-portal',
  deploymentCredential: { item: 'deploy' },
  buildsCredential: { item: 'builds' },
} as unknown as DevelopmentComponent

function providerRejectingWith(error: unknown): DevelopmentCloudflare {
  const fetchImpl = (async () => {
    throw error
  }) as unknown as typeof fetch
  return new DevelopmentCloudflare(component, () => TOKEN, fetchImpl)
}

describe('a Cloudflare request that did not complete keeps its cause (#1096)', () => {
  it('names the method, the path and TimeoutError for a timed-out GET', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    const failure = await providerRejectingWith(timeout)
      .workerTag()
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    const message = (failure as Error).message
    expect(message).toContain('Cloudflare GET /workers/scripts did not complete')
    expect(message).toContain('TimeoutError')
    expect(message).toContain('inspect provider state before retrying a write')
    expect((failure as Error).cause).toBe(timeout)
    expect(message).not.toContain(TOKEN)
    expect(message).not.toContain('account-1')
  })

  it('reports a network error code from the cause', async () => {
    const reset = new TypeError('fetch failed', {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    })
    const failure = await providerRejectingWith(reset)
      .workerTag()
      .catch((error: unknown) => error)

    const message = (failure as Error).message
    expect(message).toContain('TypeError: fetch failed')
    expect(message).toContain('cause ECONNRESET')
  })
})
