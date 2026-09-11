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

  /*
   * Re-entrancy. Nuxt UI's overlay keeps ONE resolver per overlay id and
   * `open()` overwrites it unconditionally, so before the composable took
   * ownership of its own resolution a second `confirm()` orphaned the first
   * one's resolver permanently: the first `await confirm(...)` never resolved,
   * never rejected and never timed out. Every test below fails by *timing out*
   * against that version, which is the point — a hang has no error message.
   */
  describe('a second call while the first is open', () => {
    it('settles both promises instead of orphaning the first', async () => {
      const { confirm } = harness()

      // Deliberately not awaited: a double-click on a row-level "Delete?" is
      // two synchronous calls, which is the bug's real trigger.
      const first = confirm({ title: 'Delete runner?', message: 'No undo.' })
      const second = confirm({ title: 'Delete runner?', message: 'No undo.' })
      await settle()

      // One dialog, and it is the second call's.
      expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1)

      cancelButton().click()

      await expect(first).resolves.toBe(false)
      await expect(second).resolves.toBe(false)
    })

    it('resolves the superseded call false and lets the live one confirm true', async () => {
      const { confirm } = harness()

      const first = confirm({ title: 'Delete runner?', message: 'No undo.' })
      await settle()
      const second = confirm({ title: 'Delete every runner?', message: 'Still no undo.' })
      await settle()

      // The superseded caller is told the user did not confirm — without
      // waiting on the dialog, because that dialog is gone.
      await expect(first).resolves.toBe(false)

      expect(dialog()?.textContent).toContain('Delete every runner?')

      confirmButton().click()
      await expect(second).resolves.toBe(true)
    })

    it('shows the second call’s options rather than a mix of the two', async () => {
      const { confirm } = harness()

      void confirm({ title: 'First question', confirmLabel: 'Do the first thing', tone: 'danger' })
      void confirm({ title: 'Second question', confirmLabel: 'Do the second thing' })
      await settle()

      expect(dialog()?.textContent).toContain('Second question')
      expect(dialog()?.textContent).not.toContain('First question')
      expect(confirmButton().textContent).toContain('Do the second thing')
      expect(confirmButton().textContent).not.toContain('Do the first thing')
      // The tone came from the second call too: the default tone focuses
      // Confirm, where the superseded `danger` would have focused Cancel.
      expect(document.activeElement).toBe(confirmButton())
    })

    it('does not run the superseded call’s onConfirm from the new dialog', async () => {
      let firstRan = 0
      let secondRan = 0
      const { confirm } = harness()

      void confirm({ title: 'First question', onConfirm: () => void firstRan++ })
      const second = confirm({ title: 'Second question', onConfirm: () => void secondRan++ })
      await settle()

      confirmButton().click()
      await expect(second).resolves.toBe(true)

      expect(firstRan).toBe(0)
      expect(secondRan).toBe(1)
    })

    it('keeps an in-flight onConfirm’s promise and settles it with the real outcome', async () => {
      const work = deferred<void>()
      const { confirm } = harness()

      const first = confirm({ title: 'Close all positions?', onConfirm: () => work.promise })
      await settle()
      confirmButton().click()
      await settle()
      expect(confirmButton().hasAttribute('disabled')).toBe(true)

      // Superseded mid-flight. The work cannot be unrun, so `first` is not
      // guessed at: it waits for its own handler.
      const second = confirm({ title: 'End game?' })
      await settle()
      expect(dialog()?.textContent).toContain('End game?')
      // The new dialog is not wearing the superseded call's pending state.
      expect(cancelButton().hasAttribute('disabled')).toBe(false)

      work.resolve()
      await expect(first).resolves.toBe(true)

      // And the superseded handler did not close or repaint the live dialog.
      await settle()
      expect(dialog()?.textContent).toContain('End game?')
      cancelButton().click()
      await expect(second).resolves.toBe(false)
    })

    it('settles a superseded in-flight call false when its work fails', async () => {
      const work = deferred<void>()
      const { confirm } = harness()

      const first = confirm({ title: 'Close all positions?', onConfirm: () => work.promise })
      await settle()
      confirmButton().click()
      await settle()

      const second = confirm({ title: 'End game?' })
      await settle()

      work.reject(new Error('The venue rejected the order.'))
      await expect(first).resolves.toBe(false)

      // The failure belongs to a dialog that is no longer on screen, so it must
      // not be painted into the live one.
      await settle()
      expect(dialog()?.querySelector('[data-ne-confirm-error]')).toBeNull()
      expect(cancelButton().hasAttribute('disabled')).toBe(false)

      cancelButton().click()
      await expect(second).resolves.toBe(false)
    })

    it('settles every call in a burst of three', async () => {
      const { confirm } = harness()

      const results = [
        confirm({ title: 'One' }),
        confirm({ title: 'Two' }),
        confirm({ title: 'Three' }),
      ]
      await settle()

      expect(dialog()?.textContent).toContain('Three')
      confirmButton().click()

      await expect(Promise.all(results)).resolves.toEqual([false, false, true])
    })
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
