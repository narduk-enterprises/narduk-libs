// @vitest-environment happy-dom
/*
 * useUndoToast() against Nuxt UI's REAL <UToaster>. The simulated-toaster tests
 * in use-undo-toast.test.ts call the action before the close event; a real
 * toaster does the opposite (Reka's ToastAction closes the toast first, then
 * runs the button's onClick), which once resolved every Undo press as
 * 'committed'. These tests click the rendered button and let real closes
 * happen, so the order that ships is the order that is proven.
 */
import UToaster from '@nuxt/ui/components/Toaster.vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import { useUndoToast } from '../src/runtime/composables/use-undo-toast'

import type { NeUndoToast } from '../src/runtime/composables/use-undo-toast'
import type { VueWrapper } from '@vue/test-utils'

const mounted: VueWrapper[] = []

function harness() {
  let undo!: NeUndoToast
  let toaster!: ReturnType<typeof useToast>
  const wrapper = mount(
    defineComponent({
      setup() {
        undo = useUndoToast()
        toaster = useToast()
        return () => h(UToaster)
      },
    }),
    { attachTo: document.body },
  )
  mounted.push(wrapper)
  // Toast state is shared across tests (Nuxt's useState); start each from empty.
  toaster.clear()
  return { undo, toaster, wrapper }
}

async function flush() {
  for (let i = 0; i < 6; i++) await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 10))
}

function button(label: string) {
  return Array.from(document.body.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

describe('useUndoToast in a real UToaster', () => {
  it("resolves 'undone' when the rendered Undo button is clicked", async () => {
    const { undo } = harness()
    const outcome = undo.show({ title: 'Removed AAPL' })
    await flush()

    const undoButton = button('Undo')
    expect(undoButton).toBeDefined()
    undoButton!.click()

    await expect(outcome).resolves.toBe('undone')
  })

  it("resolves 'committed' when the toast is closed with the close button", async () => {
    const { undo } = harness()
    const outcome = undo.show({ title: 'Removed AAPL' })
    await flush()

    const close = document.body.querySelector('[data-slot="close"] button, button[aria-label="Close"]')
    expect(close).not.toBeNull()
    ;(close as HTMLButtonElement).click()

    await expect(outcome).resolves.toBe('committed')
  })

  it("resolves 'committed' when the toast is removed through useToast().remove()", async () => {
    const { undo, toaster } = harness()
    const outcome = undo.show({ title: 'Removed AAPL' })
    await flush()

    const id = toaster.toasts.value.find((toast) => toast.title === 'Removed AAPL')!.id
    toaster.remove(id)

    await expect(outcome).resolves.toBe('committed')
  })
})
