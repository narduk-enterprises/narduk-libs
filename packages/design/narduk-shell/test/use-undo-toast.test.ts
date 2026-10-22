// @vitest-environment happy-dom
/*
 * useUndoToast(): an undoable toast with a countdown, resolving once with
 * 'undone' or 'committed'. Mounted in a component, because Nuxt UI's `useToast`
 * reads an injection that only exists in setup. There is no <UToaster> here, so
 * the tests play the toaster's part: they press the action and report the
 * toast closing, exactly the two events Nuxt UI emits.
 */
import { useToast } from '@nuxt/ui/composables/useToast'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import { NE_UNDO_DURATION_MS, useUndoToast } from '../src/runtime/composables/use-undo-toast'

import type { NeUndoToast } from '../src/runtime/composables/use-undo-toast'

let lastToasts: ReturnType<typeof useToast>['toasts'] | undefined

function harness() {
  let undo!: NeUndoToast
  const wrapper = mount(
    defineComponent({
      setup() {
        undo = useUndoToast()
        lastToasts = useToast().toasts
        return () => h('div')
      },
    }),
  )
  return { undo, wrapper, toasts: lastToasts! }
}

afterEach(() => {
  if (lastToasts) lastToasts.value = []
})

/** The toast `show` queued, once the toaster's queue has flushed. */
async function toastOf(toasts: ReturnType<typeof useToast>['toasts']) {
  await nextTick()
  await nextTick()
  const toast = toasts.value[0]
  expect(toast).toBeDefined()
  return toast as unknown as {
    actions: Array<{ label: string; onClick: () => void }>
    description?: string
    duration: number
    icon?: string
    progress: boolean
    title: string
    'onUpdate:open': (open: boolean) => void
  }
}

describe('useUndoToast', () => {
  it('raises a toast with Undo, a countdown and a 7 second life', async () => {
    const { undo, toasts, wrapper } = harness()
    void undo.show({ title: 'Removed AAPL', description: 'From Watchlist', icon: 'i-lucide-trash' })

    const toast = await toastOf(toasts)
    expect(toast.title).toBe('Removed AAPL')
    expect(toast.description).toBe('From Watchlist')
    expect(toast.icon).toBe('i-lucide-trash')
    expect(toast.duration).toBe(NE_UNDO_DURATION_MS)
    expect(NE_UNDO_DURATION_MS).toBeGreaterThanOrEqual(6000)
    expect(NE_UNDO_DURATION_MS).toBeLessThanOrEqual(8000)
    expect(toast.progress).toBe(true)
    expect(toast.actions.map((action) => action.label)).toEqual(['Undo'])
    wrapper.unmount()
  })

  it('takes a custom duration and action label', async () => {
    const { undo, toasts, wrapper } = harness()
    void undo.show({ title: 'Left the game', duration: 6000, undoLabel: 'Rejoin' })
    const toast = await toastOf(toasts)
    expect(toast.duration).toBe(6000)
    expect(toast.actions[0]!.label).toBe('Rejoin')
    wrapper.unmount()
  })

  it("resolves 'undone' when Undo is pressed, even though the toast then closes", async () => {
    const { undo, toasts, wrapper } = harness()
    const outcome = undo.show({ title: 'Removed AAPL' })
    const toast = await toastOf(toasts)

    // The order a real toaster uses: the close is reported first, then the
    // button's own onClick, in the same task. (use-undo-toast.toaster.test.ts
    // proves it against the real <UToaster>.)
    toast['onUpdate:open'](false)
    toast.actions[0]!.onClick()

    await expect(outcome).resolves.toBe('undone')
    wrapper.unmount()
  })

  it("resolves 'committed' when the toast closes any other way", async () => {
    const { undo, toasts, wrapper } = harness()
    const outcome = undo.show({ title: 'Removed AAPL' })
    const toast = await toastOf(toasts)

    toast['onUpdate:open'](true) // opening is not a verdict
    toast['onUpdate:open'](false) // timeout, close button, swipe, Escape

    await expect(outcome).resolves.toBe('committed')
    wrapper.unmount()
  })

  it('settles once: a late Undo after the commit changes nothing', async () => {
    const { undo, toasts, wrapper } = harness()
    const onUndo = vi.fn()
    const onCommit = vi.fn()
    const outcome = undo.show({ title: 'Removed AAPL', onUndo, onCommit })
    const toast = await toastOf(toasts)

    toast['onUpdate:open'](false)
    await new Promise((resolve) => setTimeout(resolve, 5)) // a later task: the close stands
    toast.actions[0]!.onClick()

    await expect(outcome).resolves.toBe('committed')
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onUndo).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('runs onUndo before it resolves', async () => {
    const { undo, toasts, wrapper } = harness()
    const order: string[] = []
    const outcome = undo
      .show({
        title: 'Removed AAPL',
        onUndo: async () => {
          await Promise.resolve()
          order.push('onUndo')
        },
      })
      .then((value) => {
        order.push(`resolved:${value}`)
        return value
      })
    const toast = await toastOf(toasts)

    toast.actions[0]!.onClick()
    await outcome

    expect(order).toEqual(['onUndo', 'resolved:undone'])
    wrapper.unmount()
  })

  it('keeps simultaneous undos independent', async () => {
    const { undo, toasts, wrapper } = harness()
    const first = undo.show({ title: 'Removed AAPL' })
    const second = undo.show({ title: 'Removed MSFT' })
    await nextTick()
    await nextTick()
    await nextTick()
    const [one, two] = toasts.value as unknown as Array<{
      actions: Array<{ onClick: () => void }>
      'onUpdate:open': (open: boolean) => void
    }>

    two!.actions[0]!.onClick()
    one!['onUpdate:open'](false)

    await expect(first).resolves.toBe('committed')
    await expect(second).resolves.toBe('undone')
    wrapper.unmount()
  })
})
