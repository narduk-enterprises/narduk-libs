/**
 * `requireCronAuth` (narduk-libs#871): the bearer token is compared with a
 * constant-time routine, not `!==`, and still accepts exactly the secret.
 */
import { readFileSync } from 'node:fs'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createEvent } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requireCronAuth } from '../runtime/server/utils/cron'

import type { H3Event } from 'h3'

const SECRET = 'cron-secret-0123456789abcdef'

const { runtime } = vi.hoisted(() => ({ runtime: { cronSecret: '' } }))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => runtime }))

function cronEvent(authorization?: string): H3Event {
  const request = new IncomingMessage(new Socket())
  request.method = 'POST'
  request.url = '/api/cron/job'
  request.headers = authorization === undefined ? {} : { authorization }
  return createEvent(request, new ServerResponse(request))
}

function statusOf(authorization?: string): number {
  try {
    requireCronAuth(cronEvent(authorization))
    return 200
  } catch (error) {
    return (error as { statusCode?: number }).statusCode ?? 0
  }
}

describe('requireCronAuth', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', undefined)
    runtime.cronSecret = SECRET
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accepts exactly the configured secret, with or without the Bearer prefix', () => {
    expect(statusOf(`Bearer ${SECRET}`)).toBe(200)
    expect(statusOf(`bearer   ${SECRET} `)).toBe(200)
    expect(statusOf(SECRET)).toBe(200)
  })

  it.each([
    ['a missing header', undefined],
    ['an empty token', 'Bearer '],
    ['a same-length wrong token', `Bearer ${SECRET.slice(0, -1)}X`],
    ['a strict prefix of the secret', `Bearer ${SECRET.slice(0, 8)}`],
    ['the secret plus a suffix', `Bearer ${SECRET}x`],
    ['a non-ASCII token of the same UTF-16 length', `Bearer ${'é'.repeat(SECRET.length)}`],
  ])('rejects %s with 401', (_label, authorization) => {
    expect(statusOf(authorization)).toBe(401)
  })

  it('does not compare the secret with a short-circuiting operator', () => {
    const utils = join(dirname(fileURLToPath(import.meta.url)), '../runtime/server/utils')
    // requireCronAuth delegates to the shared-secret guard (#979).
    expect(readFileSync(join(utils, 'cron.ts'), 'utf8')).toContain('requireSharedSecret(event, {')
    const source = readFileSync(join(utils, 'shared-secret.ts'), 'utf8')
    expect(source).not.toMatch(/presented\s*!==?\s*secret|secret\s*!==?\s*presented/)
    expect(source).toContain('timingSafeEqualText(presented, secret)')
  })

  it('answers 500 when CRON_SECRET is unset outside dev', () => {
    runtime.cronSecret = ''
    expect(statusOf(`Bearer ${SECRET}`)).toBe(500)
  })
})
