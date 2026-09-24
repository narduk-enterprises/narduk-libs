import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderAuthEmail, sendAuthEmail } from '../server/utils/auth-email'

import type { AuthEmailRenderContext } from '../server/utils/auth-email'
import type { H3Event } from 'h3'

type Handler = (context: AuthEmailRenderContext, event: H3Event) => void | Promise<void>
const handlers: Handler[] = []
const hooks = {
  hook: (_name: string, handler: Handler) => handlers.push(handler),
  callHook: async (_name: string, context: AuthEmailRenderContext, event: H3Event) => {
    for (const handler of handlers) await handler(context, event)
  },
  removeAllHooks: () => handlers.splice(0),
}
const logError = vi.fn()

vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks }) }))
vi.mock('#layer/server/utils/logger', () => ({
  useLogger: () => ({ child: () => ({ error: logError }) }),
}))

const event = {} as H3Event
const actionUrl = 'https://app.example.test/reset?recovery=1&token=abc&next=%2F'

function context(): AuthEmailRenderContext {
  return {
    actionUrl,
    appName: 'Test app',
    appUrl: 'https://app.example.test',
    email: 'someone@example.test',
    message: { subject: 'Default', text: `Default ${actionUrl}`, html: '<p>Default</p>' },
    purpose: 'reset',
    ttlMinutes: 15,
  }
}

describe('narduk-auth:email hook', () => {
  beforeEach(() => {
    hooks.removeAllHooks()
    logError.mockClear()
  })

  it('sends the default when no app template is registered', async () => {
    expect((await renderAuthEmail(event, context())).subject).toBe('Default')
  })

  it('sends the app template when it keeps the action link', async () => {
    hooks.hook('narduk-auth:email', (ctx: AuthEmailRenderContext) => {
      ctx.message = {
        subject: `Reset your ${ctx.appName} password`,
        text: `Open ${ctx.actionUrl}`,
        html: `<a href="${ctx.actionUrl.replaceAll('&', '&amp;')}">Reset</a>`,
      }
    })
    expect((await renderAuthEmail(event, context())).subject).toBe('Reset your Test app password')
  })

  it('falls back to the default when a template drops the link', async () => {
    hooks.hook('narduk-auth:email', (ctx: AuthEmailRenderContext) => {
      ctx.message = { subject: 'Branded', text: 'no link', html: '<p>no link</p>' }
    })
    expect((await renderAuthEmail(event, context())).subject).toBe('Default')
    expect(logError).toHaveBeenCalledOnce()
  })

  it('falls back to the default when a template throws', async () => {
    hooks.hook('narduk-auth:email', () => {
      throw new Error('template bug')
    })
    expect((await renderAuthEmail(event, context())).subject).toBe('Default')
  })
})

describe('sendAuthEmail', () => {
  it('refuses to send without a configured sender', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const sent = await sendAuthEmail(
      event,
      { from: '', resendApiKey: '' },
      { message: context().message, to: 'someone@example.test' },
    )
    expect(sent).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('posts one message to the provider and reports acceptance', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    const sent = await sendAuthEmail(
      event,
      { from: 'App <auth@example.test>', resendApiKey: 're_test' },
      { message: context().message, to: 'someone@example.test' },
    )
    expect(sent).toBe(true)
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as { to: string[] }
    expect(body.to).toEqual(['someone@example.test'])
    fetchSpy.mockRestore()
  })
})
