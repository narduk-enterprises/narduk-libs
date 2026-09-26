// @vitest-environment happy-dom
/*
 * NeAdminDetailPage, mounted — components backlog item 20 (narduk-libs#267).
 *
 * Composition over NePageHeader + NeStatePanel + NeDetailView, plus a delete
 * action that goes through `useConfirm()`. The delete path is driven through
 * Nuxt UI's real overlay stack (a real `UOverlayProvider` beside the page,
 * which is what `UApp` renders in every Narduk app), so "nothing is deleted
 * until the dialog is confirmed" is asserted against the actual dialog.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, type Component, type VNode } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import UOverlayProvider from '@nuxt/ui/components/OverlayProvider.vue'

import NeAdminDetailPage from '../src/runtime/components/NeAdminDetailPage.vue'
import { nuxtUiStubs } from './nuxt-ui-stubs'

import type { NeAdminDetailPageProps } from '../src/index'

const items: NeAdminDetailPageProps['items'] = [
  { label: 'Name', value: 'runner-01' },
  { label: 'Jobs run', format: 'number', value: 1204 },
  { label: 'Last seen', value: null },
]

const Blank: Component = defineComponent({ setup: () => () => h('div') })

const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

function render(
  props: Partial<NeAdminDetailPageProps> = {},
  slots: Record<string, () => VNode | string> = {},
  listeners: Record<string, (...args: unknown[]) => void> = {},
) {
  const Harness = defineComponent({
    setup() {
      return () => [
        h(NeAdminDetailPage, { items, title: 'runner-01', ...props, ...listeners } as never, slots),
        h(UOverlayProvider),
      ]
    },
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: Blank }],
  })
  const wrapper = mount(Harness, {
    attachTo: document.body,
    global: { components: nuxtUiStubs, plugins: [router] },
  })
  mounted.push(wrapper)
  return wrapper
}

/** Long enough for the overlay to mount and Reka to run its open sequence. */
async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await flushPromises()
}

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
const confirmButton = () => document.body.querySelector<HTMLElement>('[data-ne-confirm-confirm]')!
const cancelButton = () => document.body.querySelector<HTMLElement>('[data-ne-confirm-cancel]')!

describe('NeAdminDetailPage', () => {
  it('renders the title as the one h1 and the record through NeDetailView', () => {
    const wrapper = render({ description: 'Self-hosted runner', unavailableMessage: 'Never' })

    const headings = wrapper.findAll('h1')
    expect(headings).toHaveLength(1)
    expect(headings[0]?.text()).toBe('runner-01')
    expect(wrapper.text()).toContain('Self-hosted runner')
    expect(wrapper.find('[data-ne-admin-detail-page]').exists()).toBe(true)
    expect(wrapper.find('[data-ne-detail-view]').exists()).toBe(true)
    expect(wrapper.text()).toContain('1,204')
    expect(wrapper.get('[data-ne-detail-unavailable]').text()).toContain('Never')
  })

  it('renders breadcrumbs as one navigation landmark above the title', () => {
    const wrapper = render({
      breadcrumbs: [{ label: 'Runners', to: '/admin/runners' }, { label: 'runner-01' }],
    })

    expect(wrapper.findAll('nav[aria-label="Breadcrumb"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('Runners')
  })

  it('draws the loading panel instead of the record while the read is pending', () => {
    const wrapper = render(
      { loadingTitle: 'Loading runner', onDelete: vi.fn(), status: 'pending' },
      { actions: () => h('a', { 'data-back': '' }, 'Back') },
    )

    expect(wrapper.find('[data-ne-detail-view]').exists()).toBe(false)
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Loading runner')
    // Nothing to delete yet, but the page's own actions (a back link) stay.
    expect(wrapper.find('[data-ne-admin-delete]').exists()).toBe(false)
    expect(wrapper.find('[data-back]').exists()).toBe(true)
  })

  it('draws the error panel when the read failed', () => {
    const wrapper = render({ errorTitle: 'Runner did not load', status: 'error' })

    expect(wrapper.find('[data-ne-detail-view]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Runner did not load')
  })

  it('takes an explicit panelState over a bound status', () => {
    const wrapper = render({ emptyTitle: 'No such runner', panelState: 'empty', status: 'success' })

    expect(wrapper.find('[data-ne-detail-view]').exists()).toBe(false)
    expect(wrapper.get('[data-stub="UEmpty"]').text()).toContain('No such runner')
  })

  it('renders header actions and extra content below the record', () => {
    const wrapper = render(
      {},
      {
        actions: () => h('a', { 'data-edit': '', href: '/admin/runners/r1/edit' }, 'Edit'),
        default: () => h('section', { 'data-related': '' }, 'Recent jobs'),
      },
    )

    expect(wrapper.get('[data-edit]').text()).toBe('Edit')
    expect(wrapper.get('[data-related]').text()).toBe('Recent jobs')
  })

  it('renders no delete action without an onDelete handler', () => {
    const wrapper = render()
    expect(wrapper.find('[data-ne-admin-delete]').exists()).toBe(false)
  })

  it('asks before deleting, and deletes only on confirm', async () => {
    const onDelete = vi.fn(async () => {})
    const onDeleted = vi.fn()
    const wrapper = render(
      {
        deleteConfirm: { message: 'Jobs already queued on it fail.', title: 'Delete runner-01?' },
        onDelete,
      },
      {},
      { onDeleted },
    )

    await wrapper.get('[data-ne-admin-delete]').trigger('click')
    await settle()

    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain('Delete runner-01?')
    expect(onDelete).not.toHaveBeenCalled()

    confirmButton().click()
    await settle()

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDeleted).toHaveBeenCalledTimes(1)
  })

  it('does not delete when the dialog is cancelled', async () => {
    const onDelete = vi.fn()
    const onDeleted = vi.fn()
    const wrapper = render({ onDelete }, {}, { onDeleted })

    await wrapper.get('[data-ne-admin-delete]').trigger('click')
    await settle()
    cancelButton().click()
    await settle()

    expect(onDelete).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and does not emit deleted when onDelete rejects', async () => {
    const onDelete = vi.fn(async () => {
      throw new Error('Runner is busy')
    })
    const onDeleted = vi.fn()
    const wrapper = render({ onDelete }, {}, { onDeleted })

    await wrapper.get('[data-ne-admin-delete]').trigger('click')
    await settle()
    confirmButton().click()
    await settle()

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDeleted).not.toHaveBeenCalled()
    expect(dialog()!.textContent).toContain('Runner is busy')
  })

  it('mounts on its own, with no overlay provider needed until delete is clicked', () => {
    const wrapper = mount(NeAdminDetailPage, {
      global: { components: nuxtUiStubs },
      props: { items, onDelete: vi.fn(), title: 'runner-01' },
    })
    mounted.push(wrapper)

    expect(wrapper.get('h1').text()).toBe('runner-01')
    expect(wrapper.find('[data-ne-detail-view]').exists()).toBe(true)
    expect(wrapper.get('[data-ne-admin-delete]').text()).toBe('Delete')
  })
})
