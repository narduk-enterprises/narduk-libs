import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as H3 from 'h3'
import type { H3Event } from 'h3'

/**
 * narduk-libs#164: `POST /api/callbacks/auth/apple` always answers a redirect —
 * 303 to `next` on success, or to the auth callback page with an error.
 */

const state = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  forms: [] as unknown[],
  outcome: null as null | { error: unknown } | { redirectTo: string },
  rateLimited: [] as string[],
}))

vi.mock('#layer/server/utils/mutation', async () => {
  const stub = await import('./stubs/layer-mutation')
  return { ...stub, defineCallbackMutation: stub.definePublicMutation }
})

vi.mock('h3', async (importOriginal) => ({
  ...(await importOriginal<typeof H3>()),
  getRequestURL: () => new URL('https://app.example/api/callbacks/auth/apple'),
  sendRedirect: (_event: unknown, location: string, status: number) => ({ location, status }),
}))

vi.mock('#narduk-auth-server/utils/auth-runtime-env', () => ({
  resolveAppleSignInForEvent: () => ({ webEnabled: true, servicesId: 'com.example.web' }),
}))

vi.mock('#narduk-auth-server/lib/app-auth/apple-local', () => ({
  completeLocalAppleWebSignIn: async (_event: unknown, _apple: unknown, form: unknown) => {
    state.forms.push(form)
    if (state.outcome && 'error' in state.outcome) throw state.outcome.error
    return { redirectTo: (state.outcome as { redirectTo: string }).redirectTo, user: {} }
  },
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ public: { authCallbackPath: '/auth/callback' } }),
}))

async function callback() {
  const { default: route } = await import('../server/api/callbacks/auth/apple.post')
  const captured = route as unknown as {
    __handler: (context: {
      body: unknown
      event: H3Event
    }) => Promise<{ location: string; status: number }>
    __options: { parseBody: (input: unknown) => unknown; rateLimit: unknown }
  }
  state.rateLimited.push((captured.__options.rateLimit as { key: string }).key)
  return captured.__handler({
    event: { context: {} } as H3Event,
    body: captured.__options.parseBody(state.body),
  })
}

describe('POST /api/callbacks/auth/apple (#164)', () => {
  beforeEach(() => {
    state.body = { state: 's', id_token: 'a.b.c', user: '{}', code: 'ignored' }
    state.forms = []
    state.outcome = null
    state.rateLimited = []
  })

  it('takes the login throttle, keeps only the form fields it reads, and 303s to next', async () => {
    state.outcome = { redirectTo: '/farm/1' }
    await expect(callback()).resolves.toEqual({ location: '/farm/1', status: 303 })
    expect(state.rateLimited).toEqual(['authLogin'])
    expect(state.forms).toEqual([{ error: undefined, id_token: 'a.b.c', state: 's', user: '{}' }])
  })

  it('sends an Apple refusal to the callback page with its user-facing message', async () => {
    state.outcome = {
      error: {
        statusCode: 409,
        statusMessage:
          'An account with this email already exists. Sign in with your password instead.',
        data: { code: 'apple_link_refused' },
      },
    }
    const result = await callback()
    expect(result.status).toBe(303)
    const url = new URL(result.location)
    expect(url.pathname).toBe('/auth/callback')
    expect(url.searchParams.get('error')).toBe('apple_sign_in_failed')
    expect(url.searchParams.get('error_description')).toContain('already exists')
  })

  it('keeps any other failure generic', async () => {
    state.outcome = { error: new Error('database exploded: secret detail') }
    const url = new URL((await callback()).location)
    expect(url.searchParams.get('error_description')).not.toContain('secret detail')
  })
})
