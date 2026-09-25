import { describe, expect, it, vi } from 'vitest'

import { resolveWaitUntil, runInBackground } from '../runtime/server/wait-until'

import type { H3Event } from 'h3'

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({}),
}))

/**
 * An `ExecutionContext` whose `waitUntil` throws when it is called detached
 * from its context, the way workerd's does. A copy that pulls the function
 * into a local and calls it bare fails here.
 */
function strictExecutionContext() {
  const kept: Array<Promise<unknown>> = []
  const ctx = {
    kept,
    waitUntil(this: unknown, task: Promise<unknown>) {
      if (this !== ctx) throw new TypeError('Illegal invocation')
      kept.push(task)
    },
  }
  return ctx
}

function asEvent(value: Record<string, unknown>): H3Event {
  return value as unknown as H3Event
}

describe('resolveWaitUntil (narduk-libs#991)', () => {
  it("prefers Nitro's event.waitUntil over the Cloudflare context", () => {
    const own = strictExecutionContext()
    const cloudflare = strictExecutionContext()
    const event = asEvent({
      waitUntil: (task: Promise<unknown>) => own.waitUntil(task),
      context: { cloudflare: { context: cloudflare } },
    })
    const waitUntil = resolveWaitUntil(event)
    const task = Promise.resolve()
    waitUntil?.(task)
    expect(own.kept).toEqual([task])
    expect(cloudflare.kept).toEqual([])
  })

  it('falls back to context.cloudflare.context and calls it as a method', () => {
    const cloudflare = strictExecutionContext()
    const waitUntil = resolveWaitUntil(
      asEvent({ context: { cloudflare: { context: cloudflare } } }),
    )
    const task = Promise.resolve()
    expect(() => waitUntil?.(task)).not.toThrow()
    expect(cloudflare.kept).toEqual([task])
  })

  it('falls back to context.waitUntil last', () => {
    const context = strictExecutionContext()
    const waitUntil = resolveWaitUntil(asEvent({ context }))
    const task = Promise.resolve()
    waitUntil?.(task)
    expect(context.kept).toEqual([task])
  })

  it('calls event.waitUntil as a method too', () => {
    const own = strictExecutionContext()
    const waitUntil = resolveWaitUntil(asEvent(own as unknown as Record<string, unknown>))
    const task = Promise.resolve()
    expect(() => waitUntil?.(task)).not.toThrow()
    expect(own.kept).toEqual([task])
  })

  it('walks a Nitro internal fetch to its SSR parent event', () => {
    const cloudflare = strictExecutionContext()
    const parent = asEvent({ context: { cloudflare: { context: cloudflare } } })
    const internal = asEvent({ context: { nuxt: { ssrContext: { event: parent } } } })
    const task = Promise.resolve()
    resolveWaitUntil(internal)?.(task)
    expect(cloudflare.kept).toEqual([task])
  })

  it('returns null when no host carries waitUntil, and survives a parent cycle', () => {
    expect(resolveWaitUntil(asEvent({ context: {} }))).toBeNull()
    const loop: Record<string, unknown> = { context: {} }
    ;(loop.context as Record<string, unknown>).nuxt = { ssrContext: { event: loop } }
    expect(resolveWaitUntil(asEvent(loop))).toBeNull()
    expect(resolveWaitUntil(undefined as unknown as H3Event)).toBeNull()
  })
})

describe('runInBackground (narduk-libs#991)', () => {
  it('hands a guarded task to waitUntil and resolves without waiting for it', async () => {
    const cloudflare = strictExecutionContext()
    let finish!: () => void
    const task = new Promise<void>((resolve) => {
      finish = resolve
    })
    await runInBackground(asEvent({ context: { cloudflare: { context: cloudflare } } }), task)
    expect(cloudflare.kept).toHaveLength(1)
    finish()
    await expect(cloudflare.kept[0]).resolves.toBeUndefined()
  })

  it('routes a rejection to onError, and the handed-off promise never rejects', async () => {
    const cloudflare = strictExecutionContext()
    const onError = vi.fn()
    const failure = new Error('write failed')
    await runInBackground(
      asEvent({ context: { cloudflare: { context: cloudflare } } }),
      Promise.reject(failure),
      { onError },
    )
    await expect(cloudflare.kept[0]).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it("awaits the task when there is no waitUntil and fallback is 'await'", async () => {
    const order: string[] = []
    const task = new Promise<void>((resolve) => {
      setTimeout(() => {
        order.push('task')
        resolve()
      }, 5)
    })
    await runInBackground(asEvent({ context: {} }), task, { fallback: 'await' })
    order.push('returned')
    expect(order).toEqual(['task', 'returned'])
  })

  it('detaches by default with onError attached, so a failure is observed, not unhandled', async () => {
    const onError = vi.fn()
    const failure = new Error('lost')
    await runInBackground(asEvent({ context: {} }), Promise.reject(failure), { onError })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('falls back when the resolved waitUntil itself throws', async () => {
    const onError = vi.fn()
    const event = asEvent({
      waitUntil() {
        throw new Error('context already finished')
      },
    })
    await expect(
      runInBackground(event, Promise.resolve('ok'), { fallback: 'await', onError }),
    ).resolves.toBeUndefined()
    expect(onError).not.toHaveBeenCalled()
  })

  it('never rejects, even when onError throws', async () => {
    const onError = vi.fn(() => {
      throw new Error('handler broke')
    })
    await expect(
      runInBackground(asEvent({ context: {} }), Promise.reject(new Error('x')), {
        fallback: 'await',
        onError,
      }),
    ).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledOnce()
  })

  it('does not reject when the default request-logger report is used', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      runInBackground(
        asEvent({ context: {}, path: '/x', method: 'GET' }),
        Promise.reject(new Error('boom')),
        {
          fallback: 'await',
        },
      ),
    ).resolves.toBeUndefined()
    errorSpy.mockRestore()
  })
})
