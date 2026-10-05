// @vitest-environment happy-dom
/*
 * NeCommandPalette, mounted: it opens from the shared state, searches static
 * and async groups, walks with the keyboard, navigates, remembers recents and
 * tells a failed provider from an empty one. The look and the focus trap are
 * the browser's; libs-explorer's Playwright suite covers them.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import NeCommandPalette from '../src/runtime/components/NeCommandPalette.vue'
import { useCommandPalette } from '../src/runtime/composables/use-command-palette'

import type {
  NeCommandGroup,
  NeCommandPaletteProps,
} from '../src/runtime/components/ne-command-palette-types'

const STATES: NeCommandGroup = {
  id: 'states',
  items: [
    { id: 'MO', keywords: ['MO'], label: 'Missouri', to: '/states/mo', icon: 'i-lucide-map' },
    { id: 'MS', keywords: ['MS'], label: 'Mississippi', to: '/states/ms' },
    { id: 'TX', keywords: ['TX'], label: 'Texas', to: '/states/tx' },
  ],
  label: 'States',
}

const PAGES: NeCommandGroup = {
  id: 'pages',
  idleLimit: 2,
  items: [
    { id: 'map', label: 'Map', to: '/map' },
    { id: 'rivers', label: 'Rivers', to: '/rivers' },
    { id: 'about', label: 'About', to: '/about' },
  ],
  label: 'Pages',
}

function rivers(search: NeCommandGroup['search']): NeCommandGroup {
  return { id: 'rivers', label: 'Rivers', search }
}

const navigate = vi.fn(async () => {})

function mountPalette(groups: NeCommandGroup[], extra: Partial<NeCommandPaletteProps> = {}) {
  return mount(NeCommandPalette, {
    attachTo: document.body,
    props: { groups, navigate, recentsKey: 'test:recents', ...extra },
  })
}

async function openPalette() {
  useCommandPalette().open()
  await nextTick()
  await nextTick()
}

async function type(wrapper: ReturnType<typeof mountPalette>, text: string) {
  const input = wrapper.get('[data-ne-command-input]')
  await input.setValue(text)
  await flushPromises()
}

const labels = (wrapper: ReturnType<typeof mountPalette>) =>
  wrapper.findAll('[data-ne-command-row] .ne-cmd__label').map((node) => node.text())

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  navigate.mockClear()
  window.localStorage.clear()
  useCommandPalette().close()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('NeCommandPalette', () => {
  it('is a closed dialog until the shared state opens it', async () => {
    const wrapper = mountPalette([STATES])
    const dialog = wrapper.get('dialog').element as HTMLDialogElement
    expect(dialog.open).toBe(false)
    await openPalette()
    expect(dialog.open).toBe(true)
    wrapper.unmount()
  })

  it('opens at once when it is mounted after the open (the lazy chunk arrives late)', async () => {
    useCommandPalette().open()
    const wrapper = mountPalette([STATES])
    await nextTick()
    expect((wrapper.get('dialog').element as HTMLDialogElement).open).toBe(true)
    wrapper.unmount()
  })

  it('is a named dialog with a combobox that owns a listbox', async () => {
    const wrapper = mountPalette([STATES], { title: 'Search River Status' })
    await openPalette()
    expect(wrapper.get('dialog').attributes('aria-label')).toBe('Search River Status')
    const input = wrapper.get('[data-ne-command-input]')
    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-autocomplete')).toBe('list')
    const listbox = wrapper.get('[role="listbox"]')
    expect(input.attributes('aria-controls')).toBe(listbox.attributes('id'))
    wrapper.unmount()
  })

  it('before typing, shows each group cut to its idle limit and a hint when none offers rows', async () => {
    const wrapper = mountPalette([PAGES, STATES])
    await openPalette()
    expect(labels(wrapper)).toEqual(['Map', 'Rivers'])
    wrapper.unmount()

    const hint = mountPalette([STATES], { idleHint: 'Type a river or a state.' })
    await openPalette()
    expect(hint.get('.ne-cmd__idle').text()).toBe('Type a river or a state.')
    hint.unmount()
  })

  it('groups the results under headings, as options inside groups', async () => {
    const wrapper = mountPalette([PAGES, STATES])
    await openPalette()
    await type(wrapper, 'miss')
    const groups = wrapper.findAll('[role="group"]')
    expect(groups).toHaveLength(1)
    expect(groups[0]?.get('.ne-cmd__heading').text()).toBe('States')
    expect(labels(wrapper)).toEqual(['Missouri', 'Mississippi'])
    const options = wrapper.findAll('[role="option"]')
    expect(options.map((option) => option.attributes('aria-selected'))).toEqual(['true', 'false'])
    wrapper.unmount()
  })

  it('wraps the matched text in a mark', async () => {
    const wrapper = mountPalette([STATES])
    await openPalette()
    await type(wrapper, 'miss')
    expect(wrapper.get('.ne-cmd__label mark').text()).toBe('Miss')
    wrapper.unmount()
  })

  it('moves the active option with the arrow keys and keeps aria-activedescendant on it', async () => {
    const wrapper = mountPalette([STATES])
    await openPalette()
    await type(wrapper, 'mis')
    const input = wrapper.get('[data-ne-command-input]')
    const first = wrapper.findAll('[role="option"]')[0]!
    expect(input.attributes('aria-activedescendant')).toBe(first.attributes('id'))

    await input.trigger('keydown', { key: 'ArrowDown' })
    const second = wrapper.findAll('[role="option"]')[1]!
    expect(second.attributes('aria-selected')).toBe('true')
    expect(input.attributes('aria-activedescendant')).toBe(second.attributes('id'))

    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.findAll('[role="option"]')[0]?.attributes('aria-selected')).toBe('true')
    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(wrapper.findAll('[role="option"]')[1]?.attributes('aria-selected')).toBe('true')
    wrapper.unmount()
  })

  it('Enter goes to the active row, closes, emits select, and remembers it', async () => {
    const wrapper = mountPalette([STATES])
    await openPalette()
    await type(wrapper, 'texas')
    await wrapper.get('[data-ne-command-input]').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(navigate).toHaveBeenCalledWith('/states/tx')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({
      groupId: 'states',
      item: { id: 'TX' },
    })
    expect(useCommandPalette().isOpen.value).toBe(false)
    const stored = JSON.parse(window.localStorage.getItem('test:recents') ?? '[]')
    expect(stored[0]).toMatchObject({ groupId: 'states', item: { id: 'TX', label: 'Texas' } })
    wrapper.unmount()
  })

  it('a click on a row goes to it', async () => {
    const wrapper = mountPalette([STATES])
    await openPalette()
    await type(wrapper, 'mis')
    await wrapper.findAll('[role="option"]')[1]!.trigger('click')
    await flushPromises()
    expect(navigate).toHaveBeenCalledWith('/states/ms')
    wrapper.unmount()
  })

  it('shows remembered rows first the next time it opens', async () => {
    window.localStorage.setItem(
      'test:recents',
      JSON.stringify([{ groupId: 'states', item: { id: 'TX', label: 'Texas', to: '/states/tx' } }]),
    )
    const wrapper = mountPalette([PAGES, STATES])
    await openPalette()
    const headings = wrapper.findAll('.ne-cmd__heading').map((node) => node.text())
    expect(headings).toEqual(['Recent', 'Pages'])
    expect(labels(wrapper)[0]).toBe('Texas')
    wrapper.unmount()
  })

  it('keeps recents off when maxRecents is 0', async () => {
    const wrapper = mountPalette([STATES], { maxRecents: 0 })
    await openPalette()
    await type(wrapper, 'texas')
    await wrapper.get('[data-ne-command-input]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(window.localStorage.getItem('test:recents')).toBeNull()
    wrapper.unmount()
  })

  it('runs a row action: Cmd+Enter and a click on the action both take its target', async () => {
    const group: NeCommandGroup = {
      id: 'gauges',
      items: [
        {
          actions: [{ id: 'map', label: 'Show on map', to: '/map?gauge=1' }],
          id: '1',
          label: 'Hermann',
          to: '/gauges/1',
        },
      ],
      label: 'Gauges',
    }
    const wrapper = mountPalette([group])
    await openPalette()
    await type(wrapper, 'herm')
    const input = wrapper.get('[data-ne-command-input]')
    await input.trigger('keydown', { key: 'Enter', metaKey: true })
    await flushPromises()
    expect(navigate).toHaveBeenLastCalledWith('/map?gauge=1')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ action: { id: 'map' } })

    await openPalette()
    await type(wrapper, 'herm')
    await wrapper.get('[data-ne-command-action]').trigger('click')
    await flushPromises()
    expect(navigate).toHaveBeenLastCalledWith('/map?gauge=1')
    wrapper.unmount()
  })

  it('shows a badge with its colour', async () => {
    const group: NeCommandGroup = {
      id: 'r',
      items: [{ badge: { color: '#d33', label: 'Flooding' }, id: '1', label: 'Missouri River' }],
      label: 'Rivers',
    }
    const wrapper = mountPalette([group])
    await openPalette()
    await type(wrapper, 'missouri')
    expect(wrapper.get('.ne-cmd__badge').text()).toBe('Flooding')
    expect(wrapper.get('.ne-cmd__dot').attributes('style')).toContain('background-color')
    wrapper.unmount()
  })

  it('shows the empty state for a query nothing answers, with a slot to replace it', async () => {
    const wrapper = mountPalette([STATES])
    await openPalette()
    await type(wrapper, 'zzzz')
    expect(wrapper.get('[data-ne-command-empty]').text()).toContain('No results for “zzzz”')
    wrapper.unmount()

    const slotted = mount(NeCommandPalette, {
      attachTo: document.body,
      props: { groups: [STATES], navigate },
      slots: { empty: '<p class="custom">Nothing here</p>' },
    })
    await openPalette()
    await type(slotted, 'zzzz')
    expect(slotted.find('.custom').exists()).toBe(true)
    slotted.unmount()
  })

  it('announces how many results arrived in a polite live region', async () => {
    const wrapper = mountPalette([STATES])
    await openPalette()
    await type(wrapper, 'mis')
    const status = wrapper.get('[role="status"]')
    expect(status.attributes('aria-live')).toBe('polite')
    expect(status.text()).toBe('2 results: 2 states')
    wrapper.unmount()
  })

  describe('with an async group', () => {
    it('waits for the debounce, then lists the answer', async () => {
      const search = vi.fn(async (q: string) => [
        { id: q, label: `${q} River`, to: `/rivers/${q}` },
      ])
      const wrapper = mountPalette([rivers(search)])
      await openPalette()
      await type(wrapper, 'miss')
      expect(search).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(150)
      await flushPromises()
      expect(search).toHaveBeenCalledTimes(1)
      expect(labels(wrapper)).toEqual(['miss River'])
      wrapper.unmount()
    })

    it('passes an abort signal, and aborts it when the palette closes', async () => {
      let seen: AbortSignal | undefined
      const search = vi.fn(
        (_q: string, { signal }: { signal: AbortSignal }) =>
          new Promise<never[]>(() => {
            seen = signal
          }),
      )
      const wrapper = mountPalette([rivers(search)])
      await openPalette()
      await type(wrapper, 'miss')
      await vi.advanceTimersByTimeAsync(150)
      expect(seen?.aborted).toBe(false)
      useCommandPalette().close()
      await nextTick()
      await nextTick()
      expect(seen?.aborted).toBe(true)
      wrapper.unmount()
    })

    it('says a group could not be loaded instead of saying there were no matches', async () => {
      const wrapper = mountPalette([
        STATES,
        rivers(async () => {
          throw new Error('503')
        }),
      ])
      await openPalette()
      await type(wrapper, 'xx')
      await vi.advanceTimersByTimeAsync(150)
      await flushPromises()
      expect(wrapper.get('[data-ne-command-error]').text()).toContain('could not be loaded')
      expect(wrapper.find('[data-ne-command-empty]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('still shows the static groups while the async group is out', async () => {
      const wrapper = mountPalette([STATES, rivers(() => new Promise(() => {}))])
      await openPalette()
      await type(wrapper, 'miss')
      await vi.advanceTimersByTimeAsync(150)
      expect(labels(wrapper)).toEqual(['Missouri', 'Mississippi'])
      expect(wrapper.get('[role="listbox"]').attributes('aria-busy')).toBe('true')
      wrapper.unmount()
    })
  })

  it('closing resets the query for the next time', async () => {
    const wrapper = mountPalette([PAGES, STATES])
    await openPalette()
    await type(wrapper, 'miss')
    useCommandPalette().close()
    await nextTick()
    await nextTick()
    await openPalette()
    expect((wrapper.get('[data-ne-command-input]').element as HTMLInputElement).value).toBe('')
    expect(labels(wrapper)).toEqual(['Map', 'Rivers'])
    wrapper.unmount()
  })

  it('the close button closes it', async () => {
    const wrapper = mountPalette([STATES])
    await openPalette()
    await wrapper.get('.ne-cmd__close').trigger('click')
    expect(useCommandPalette().isOpen.value).toBe(false)
    wrapper.unmount()
  })
})
