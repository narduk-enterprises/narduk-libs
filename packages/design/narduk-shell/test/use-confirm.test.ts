// @vitest-environment happy-dom
/*
 * useConfirm() proofs — components backlog item 16, narduk-libs#263.
 *
 * The composable is driven the way an app drives it: through Nuxt UI's real
 * `useOverlay`, with a real `UOverlayProvider` mounted (which is what `UApp`
 * renders in every Narduk app). Nothing here is stubbed, so what is asserted
 * is the actual resolution contract — `await confirm(...)` is `true` only on
 * the confirm path.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'

import UOverlayProvider from '@nuxt/ui/components/OverlayProvider.vue'

import { useConfirm, type NeConfirmOptions } from '../src/runtime/composables/use-confirm'

interface Harness {
  confirm: (options?: NeConfirmOptions) => Promise<boolean>
}

const HarnessComponent = defineComponent({
  name: 'ConfirmHarness',
  setup(_props, { expose }) {
    expose({ confirm: useConfirm() })
    return () => h(UOverlayProvider)
  },
})

const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

function harness(): Harness {
  const wrapper = mount(HarnessComponent, { attachTo: document.body })
  mounted.push(wrapper)
  return wrapper.vm as unknown as Harness
}

/** Long enough for the overlay to mount and Reka to run its open sequence. */
async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
const confirmButton = () => document.body.querySelector<HTMLElement>('[data-ne-confirm-confirm]')!
const cancelButton = () => document.body.querySelector<HTMLElement>('[data-ne-confirm-cancel]')!

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn
    reject = rejectFn
  })
  return { promise, resolve, reject }
}

describe('useConfirm()', () => {
  it('renders the options it was given', async () => {
    const { confirm } = harness()
    void confirm({
      title: 'Close all positions?',
      message: 'Every open position closes at the current market price.',
      confirmLabel: 'Close all',
      cancelLabel: 'Keep them',
      tone: 'danger',
    })
    await settle()

    expect(dialog()?.textContent).toContain('Close all positions?')
    expect(dialog()?.textContent).toContain(
      'Every open position closes at the current market price.',
    )
    expect(confirmButton().textContent).toContain('Close all')
    expect(cancelButton().textContent).toContain('Keep them')
    // tone="danger" also moves initial focus to the least destructive button.
    expect(document.activeElement).toBe(cancelButton())
  })

  it('renders a body component with its props', async () => {
    const TradeSummary = defineComponent({
      props: { symbol: { type: String, required: true } },
      setup: (props) => () => h('p', { 'data-test': 'summary' }, props.symbol),
    })

    const { confirm } = harness()
    void confirm({ title: 'Execute order?', body: TradeSummary, props: { symbol: 'AAPL' } })
    await settle()

    expect(dialog()?.querySelector('[data-test="summary"]')?.textContent).toBe('AAPL')
  })

  it('resolves true when the user confirms', async () => {
    const { confirm } = harness()
    const result = confirm({ title: 'Close all positions?', message: 'No undo.' })
    await settle()

    confirmButton().click()

    await expect(result).resolves.toBe(true)
  })

  it('resolves false when the user cancels', async () => {
    const { confirm } = harness()
    const result = confirm({ title: 'Close all positions?', message: 'No undo.' })
    await settle()

    cancelButton().click()

    await expect(result).resolves.toBe(false)
  })

  it('resolves false on Escape', async () => {
    const { confirm } = harness()
    const result = confirm({ title: 'Close all positions?', message: 'No undo.' })
    await settle()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    await expect(result).resolves.toBe(false)
  })

  it('holds the dialog pending while an async onConfirm is in flight, then closes true', async () => {
    const work = deferred<void>()
    const { confirm } = harness()
    const result = confirm({
      title: 'End game?',
      message: 'Positions are closed at market.',
      onConfirm: () => work.promise,
    })
    await settle()

    confirmButton().click()
    await settle()

    // Still open, and visibly pending: cancel disabled, confirm in its
    // loading state, Escape ignored.
    expect(dialog()).not.toBeNull()
    expect(cancelButton().hasAttribute('disabled')).toBe(true)
    expect(confirmButton().hasAttribute('disabled')).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(dialog()).not.toBeNull()

    work.resolve()

    await expect(result).resolves.toBe(true)
  })

  it('keeps the dialog open and surfaces the failure when onConfirm rejects', async () => {
    const work = deferred<void>()
    const { confirm } = harness()
    const result = confirm({
      title: 'End game?',
      message: 'Positions are closed at market.',
      onConfirm: () => work.promise,
    })
    await settle()

    confirmButton().click()
    await settle()

    work.reject(new Error('The venue rejected the order.'))
    await settle()

    expect(dialog()).not.toBeNull()
    const alert = dialog()?.querySelector<HTMLElement>('[data-ne-confirm-error]')
    expect(alert?.getAttribute('role')).toBe('alert')
    expect(alert?.textContent).toContain('The venue rejected the order.')
    // No longer pending, so the user can retry or back out.
    expect(cancelButton().hasAttribute('disabled')).toBe(false)

    cancelButton().click()
    await expect(result).resolves.toBe(false)
  })

  it('resolves two sequential confirms independently', async () => {
    const { confirm } = harness()

    const first = confirm({ title: 'Close all positions?', message: 'No undo.' })
    await settle()
    expect(dialog()?.textContent).toContain('Close all positions?')
    confirmButton().click()
    await expect(first).resolves.toBe(true)
    await settle()
    expect(dialog()).toBeNull()

    const second = confirm({ title: 'End game?', message: 'Standings are final.' })
    await settle()
    expect(dialog()?.textContent).toContain('End game?')
    expect(dialog()?.textContent).not.toContain('Close all positions?')
    cancelButton().click()
    await expect(second).resolves.toBe(false)
    await settle()
    expect(dialog()).toBeNull()
  })

  it('clears the previous call’s error and pending state on the next call', async () => {
    const failing = deferred<void>()
    const { confirm } = harness()

    const first = confirm({
      title: 'End game?',
      message: 'No undo.',
      onConfirm: () => failing.promise,
    })
    await settle()
    confirmButton().click()
    await settle()
    failing.reject(new Error('boom'))
    await settle()
    expect(dialog()?.querySelector('[data-ne-confirm-error]')).not.toBeNull()
    cancelButton().click()
    await expect(first).resolves.toBe(false)
    await settle()

    const second = confirm({ title: 'End game?', message: 'No undo.' })
    await settle()

    expect(dialog()?.querySelector('[data-ne-confirm-error]')).toBeNull()
    expect(cancelButton().hasAttribute('disabled')).toBe(false)

    confirmButton().click()
    await expect(second).resolves.toBe(true)
  })
})
