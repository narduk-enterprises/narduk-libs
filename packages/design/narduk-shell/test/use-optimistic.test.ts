// @vitest-environment happy-dom
/*
 * useOptimistic(): the change shows at once, a refusal puts the old value back
 * and says so. Mounted in a component, because Nuxt UI's `useToast` reads an
 * injection that only exists in setup.
 */
import { useToast } from '@nuxt/ui/composables/useToast'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

import { useOptimistic } from '../src/runtime/composables/use-optimistic'

import type { NeOptimistic, NeOptimisticOptions } from '../src/runtime/composables/use-optimistic'
import type { Ref } from 'vue'

function harness<T>(initial: T, options?: NeOptimisticOptions) {
  let state!: Ref<T>
  let optimistic!: NeOptimistic<T>
  let toasts!: ReturnType<typeof useToast>['toasts']
  const wrapper = mount(
    defineComponent({
      setup() {
        state = ref(initial) as Ref<T>
        optimistic = useOptimistic(state, options)
        toasts = useToast().toasts
        lastToasts = toasts
        return () => h('div')
      },
    }),
  )
  return { optimistic, state, toasts, wrapper }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

// `useToast()` reads an injection, so it cannot be called here; the harness
// keeps the store it saw and this empties it between cases.
let lastToasts: ReturnType<typeof useToast>['toasts'] | undefined
afterEach(() => {
  if (lastToasts) lastToasts.value = []
})

describe('useOptimistic', () => {
  it('writes the next value before the action settles', async () => {
    const { optimistic, state } = harness(false)
    const request = deferred<string>()

    const result = optimistic.mutate(
      (current) => !current,
      () => request.promise,
    )

    expect(state.value).toBe(true)
    expect(optimistic.pending.value).toBe(true)

    request.resolve('saved')
    await expect(result).resolves.toEqual({ ok: true, value: 'saved' })
    expect(state.value).toBe(true)
    expect(optimistic.pending.value).toBe(false)
    expect(optimistic.error.value).toBeNull()
  })

  it('hands the action the optimistic value', async () => {
    const { optimistic } = harness({ count: 1 })
    const action = vi.fn(async () => {})

    await optimistic.mutate((current) => ({ count: current.count + 1 }), action)

    expect(action).toHaveBeenCalledWith({ count: 2 })
  })

  it('rolls back, records the error and toasts when the action rejects', async () => {
    const { optimistic, state, toasts } = harness('Old name', { errorTitle: 'Could not rename' })
    const failure = new Error('Name already taken')

    const result = await optimistic.mutate(
      () => 'New name',
      async () => {
        throw failure
      },
    )
    await nextTick()
    await nextTick()

    expect(result).toEqual({ ok: false, error: failure })
    expect(state.value).toBe('Old name')
    expect(optimistic.error.value).toBe(failure)
    expect(optimistic.pending.value).toBe(false)
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0]).toMatchObject({
      title: 'Could not rename',
      description: 'Name already taken',
      color: 'error',
    })
  })

  it('rolls back when a synchronous action throws', async () => {
    const { optimistic, state } = harness(1, { toast: false })

    const result = await optimistic.mutate(
      (current) => current + 1,
      () => {
        throw new Error('sync')
      },
    )

    expect(result.ok).toBe(false)
    expect(state.value).toBe(1)
  })

  it('stays quiet with toast: false and still calls onError after the rollback', async () => {
    const seen: unknown[] = []
    let valueAtCallback: number | undefined
    const holder: { state?: Ref<number> } = {}
    const onError = (error: unknown) => {
      seen.push(error)
      valueAtCallback = holder.state?.value
    }
    const { optimistic, state, toasts } = harness(5, { onError, toast: false })
    holder.state = state

    await optimistic.mutate(
      () => 6,
      async () => {
        throw new Error('no')
      },
    )
    await nextTick()
    await nextTick()

    expect(toasts.value).toHaveLength(0)
    expect(seen).toHaveLength(1)
    expect(valueAtCallback).toBe(5)
  })

  it('clears the previous error when the next change starts', async () => {
    const { optimistic } = harness(0, { toast: false })
    await optimistic.mutate(
      () => 1,
      async () => {
        throw new Error('first')
      },
    )
    expect(optimistic.error.value).toBeInstanceOf(Error)

    const next = optimistic.mutate(
      () => 2,
      async () => {},
    )
    expect(optimistic.error.value).toBeNull()
    await next
  })

  it('lets only the newest overlapping change roll back', async () => {
    const { optimistic, state } = harness('a', { toast: false })
    const first = deferred<void>()
    const second = deferred<void>()

    const one = optimistic.mutate(
      () => 'b',
      () => first.promise,
    )
    const two = optimistic.mutate(
      () => 'c',
      () => second.promise,
    )
    expect(state.value).toBe('c')

    // The older change fails after the newer one began: it must not undo it.
    first.reject(new Error('older'))
    await one
    expect(state.value).toBe('c')

    // The newest fails: back to what it saw when it began.
    second.reject(new Error('newer'))
    await two
    expect(state.value).toBe('b')
  })

  it('tracks pending across overlapping changes', async () => {
    const { optimistic } = harness(0, { toast: false })
    const first = deferred<void>()
    const second = deferred<void>()
    const one = optimistic.mutate(
      () => 1,
      () => first.promise,
    )
    const two = optimistic.mutate(
      () => 2,
      () => second.promise,
    )

    first.resolve()
    await one
    expect(optimistic.pending.value).toBe(true)
    second.resolve()
    await two
    expect(optimistic.pending.value).toBe(false)
  })

  it('works outside a component without a toast, and reports through onError', async () => {
    const onError = vi.fn()
    const state = ref(1)
    const optimistic = useOptimistic(state, { onError })

    await optimistic.mutate(
      () => 2,
      async () => {
        throw new Error('outside')
      },
    )

    expect(state.value).toBe(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
