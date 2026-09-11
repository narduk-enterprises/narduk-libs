// @vitest-environment happy-dom
/*
 * NeConfirmDialog mount proofs — components backlog item 16, narduk-libs#263.
 *
 * These run against a REAL `UModal` (and therefore a real Reka UI `Dialog`),
 * not a stub: `vitest.config.ts` loads `@nuxt/ui/vite` so the `#build/ui/*`
 * and `#imports` virtuals Nuxt UI's own single-file components import are
 * resolvable outside Nuxt. An accessibility assertion against a stubbed modal
 * would prove nothing, which is the whole point of operator-portal#134 — a
 * dialog that DECLARED `aria-modal` while Tab walked straight out of it.
 *
 * What a DOM-in-JS environment can and cannot prove is called out per test.
 * happy-dom dispatches real keyboard and focus events, so initial focus,
 * Escape handling and the `aria-hidden` inertness Reka applies to everything
 * outside the dialog are all observable here. Tab CONTAINMENT is not: it is
 * the browser's own sequential-navigation behaviour, which no DOM shim
 * implements. That half is delegated to Reka's `FocusScope` and is stated as
 * delegated in the README rather than asserted here.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

import NeConfirmDialog from '../src/runtime/components/NeConfirmDialog.vue'

const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

/** Reka portals the dialog to `document.body`, so queries run against the document. */
async function open(props: Record<string, unknown> = {}, slots: { body?: string } = {}) {
  const wrapper = mount(NeConfirmDialog, {
    props: {
      open: true,
      title: 'Close all positions?',
      message: 'This cannot be undone.',
      ...props,
    },
    slots,
    attachTo: document.body,
  })
  mounted.push(wrapper)
  // One macrotask: Reka mounts the portal and runs its auto-focus on mount.
  await new Promise((resolve) => setTimeout(resolve, 0))
  return wrapper
}

function dialog(): HTMLElement {
  const element = document.body.querySelector<HTMLElement>('[role="dialog"]')
  if (!element) throw new Error('no dialog rendered')
  return element
}

const confirmButton = () => document.body.querySelector<HTMLElement>('[data-ne-confirm-confirm]')!
const cancelButton = () => document.body.querySelector<HTMLElement>('[data-ne-confirm-cancel]')!

function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

describe('NeConfirmDialog rendering', () => {
  it('renders the title, the message and both labels', async () => {
    await open({ confirmLabel: 'Close all', cancelLabel: 'Keep them' })

    const text = dialog().textContent ?? ''
    expect(text).toContain('Close all positions?')
    expect(text).toContain('This cannot be undone.')
    expect(confirmButton().textContent).toContain('Close all')
    expect(cancelButton().textContent).toContain('Keep them')
  })

  it('defaults the labels to Confirm and Cancel', async () => {
    await open()

    expect(confirmButton().textContent).toContain('Confirm')
    expect(cancelButton().textContent).toContain('Cancel')
  })

  it('renders nothing while closed', async () => {
    await open({ open: false })

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders the body component with its props, and the #body slot', async () => {
    const TradeSummary = defineComponent({
      props: {
        symbol: { type: String, required: true },
        quantity: { type: Number, required: true },
      },
      setup: (props) => () =>
        h('p', { 'data-test': 'summary' }, `${props.quantity} x ${props.symbol}`),
    })

    await open(
      { body: TradeSummary, props: { symbol: 'AAPL', quantity: 12 } },
      { body: '<span data-test="slot">and one more thing</span>' },
    )

    expect(dialog().querySelector('[data-test="summary"]')?.textContent).toBe('12 x AAPL')
    expect(dialog().querySelector('[data-test="slot"]')?.textContent).toBe('and one more thing')
  })

  it('surfaces the error prop as a live region rather than swallowing it', async () => {
    await open({ error: 'The venue rejected the order.' })

    const alert = dialog().querySelector<HTMLElement>('[data-ne-confirm-error]')
    expect(alert?.getAttribute('role')).toBe('alert')
    expect(alert?.textContent).toContain('The venue rejected the order.')
  })
})

describe('NeConfirmDialog accessibility', () => {
  it('declares aria-modal AND actually makes the rest of the page inert', async () => {
    // Both halves in one test on purpose. operator-portal#134's bug is exactly
    // the first half without the second, so they must not be separable here:
    // deleting the inertness would have to delete this assertion too.
    await open()

    expect(dialog().getAttribute('aria-modal')).toBe('true')

    const outside = Array.from(document.body.children).filter(
      (element) => element !== dialog() && !element.contains(dialog()),
    )
    expect(outside.length).toBeGreaterThan(0)
    for (const element of outside) {
      expect(element.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('is named by the title and described by the message', async () => {
    await open()

    const labelledBy = dialog().getAttribute('aria-labelledby')
    const describedBy = dialog().getAttribute('aria-describedby')
    expect(labelledBy).toBeTruthy()
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(labelledBy!)?.textContent).toContain('Close all positions?')
    expect(document.getElementById(describedBy!)?.textContent).toContain('This cannot be undone.')
  })

  it('drops aria-describedby rather than dangling it when there is no message', async () => {
    await open({ message: '' })

    expect(dialog().hasAttribute('aria-describedby')).toBe(false)
    expect(dialog().getAttribute('aria-labelledby')).toBeTruthy()
  })

  it('carries the Reka dialog role, which is the focus trap that backs the claim', async () => {
    await open()

    // Reka's DialogContent renders role="dialog" on the same element its
    // FocusScope wraps (trapped + loop). Tab containment itself is browser
    // behaviour a DOM shim does not implement; see the file header.
    expect(dialog().getAttribute('role')).toBe('dialog')
    expect(dialog().getAttribute('data-state')).toBe('open')
    expect(dialog().hasAttribute('data-dismissable-layer')).toBe(true)
  })
})

describe('NeConfirmDialog initial focus', () => {
  it('lands on Confirm for the default tone', async () => {
    await open()

    expect(document.activeElement).toBe(confirmButton())
  })

  it('lands on Cancel — the least destructive button — for tone="danger"', async () => {
    await open({ tone: 'danger' })

    expect(document.activeElement).toBe(cancelButton())
  })

  it('keeps focus inside the dialog either way', async () => {
    await open({ tone: 'danger' })

    expect(dialog().contains(document.activeElement)).toBe(true)
  })
})

describe('NeConfirmDialog tone', () => {
  it('colours the confirm button with the error semantic colour when danger', async () => {
    await open({ tone: 'danger' })

    // Semantic Nuxt UI colour tokens, never a hardcoded palette value —
    // theming is backlog item 2's to own.
    expect(confirmButton().className).toMatch(/\bbg-error\b/)
    expect(confirmButton().className).not.toMatch(/\bbg-primary\b/)
  })

  it('colours it with the primary semantic colour by default', async () => {
    await open()

    expect(confirmButton().className).toMatch(/\bbg-primary\b/)
    expect(confirmButton().className).not.toMatch(/\bbg-error\b/)
  })
})

describe('NeConfirmDialog events', () => {
  it('emits confirm and deliberately stays open, so the owner can go pending', async () => {
    const wrapper = await open()

    confirmButton().click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('emits cancel, closes, and resolves the overlay with false', async () => {
    const wrapper = await open()

    cancelButton().click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('close')).toEqual([[false]])
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('cancels on Escape', async () => {
    const wrapper = await open()

    pressEscape()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('close')).toEqual([[false]])
  })
})

describe('NeConfirmDialog pending', () => {
  it('ignores Escape while pending', async () => {
    const wrapper = await open({ pending: true })

    pressEscape()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.emitted('cancel')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('disables the cancel button and puts the confirm button in its loading state', async () => {
    await open({ pending: true })

    expect(cancelButton().hasAttribute('disabled')).toBe(true)
    expect(confirmButton().hasAttribute('disabled')).toBe(true)
    expect(confirmButton().querySelector('[data-slot="leadingIcon"]')).not.toBeNull()
  })

  it('does not re-emit confirm while pending', async () => {
    const wrapper = await open({ pending: true })

    confirmButton().click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('confirm')).toBeUndefined()
  })
})
