// @vitest-environment happy-dom
/*
 * NeStatePanel, mounted.
 *
 * The assertions that matter here are not "it renders": they are that the five
 * readings stay *distinguishable*. A panel that renders `absent` the way it
 * renders `empty` is the bug this component exists to foreclose
 * (operator-portal#183, #162, #100, #21, #282), and a panel that signals a
 * failure only with a red border is unreadable to anyone using a screen reader
 * or a grayscale display. Both are pinned below.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NeStatePanel from '../src/runtime/components/NeStatePanel.vue'
import { nuxtUiStubs } from './nuxt-ui-stubs'

import type { NeStateValue } from '../src/runtime/types'

const componentSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/runtime/components/NeStatePanel.vue'),
  'utf8',
)

type Props = Record<string, unknown>
type Slots = Record<string, string>

function render(props: Props = {}, slots: Slots = {}) {
  return mount(NeStatePanel, { global: { components: nuxtUiStubs }, props, slots })
}

function panelOf(wrapper: ReturnType<typeof render>, state: NeStateValue) {
  return wrapper.get(`[data-testid="ne-state-panel-${state}"]`)
}

describe('NeStatePanel: which reading is on screen', () => {
  it('renders the default slot and no panel when no state is given', () => {
    const wrapper = render({}, { default: '<p class="rows">4 runners</p>' })

    expect(wrapper.find('.rows').exists()).toBe(true)
    expect(wrapper.find('[data-ne-state]').exists()).toBe(false)
  })

  it('renders the default slot on a successful read, because success is not a state', () => {
    const wrapper = render({ status: 'success' }, { default: '<p class="rows">4 runners</p>' })

    expect(wrapper.find('.rows').exists()).toBe(true)
    expect(wrapper.find('[data-ne-state]').exists()).toBe(false)
  })

  it.each<[NeStateValue, string]>([
    ['empty', 'Empty'],
    ['loading', 'Loading'],
    ['error', 'Error'],
    ['blocked', 'Blocked'],
    ['absent', 'Not reported'],
  ])('names %s in text, so the reading never depends on colour', (state, eyebrow) => {
    const wrapper = render({ state })

    expect(panelOf(wrapper, state).get('.ne-state-panel__eyebrow').text()).toBe(eyebrow)
  })

  it('lets a caller override the eyebrow wording without losing the state hook', () => {
    const wrapper = render({ eyebrow: 'Nothing published', state: 'absent' })
    const panel = panelOf(wrapper, 'absent')

    expect(panel.get('.ne-state-panel__eyebrow').text()).toBe('Nothing published')
    expect(panel.attributes('data-ne-state')).toBe('absent')
  })
})

describe('NeStatePanel: title, message and icon reach the wrapped primitive', () => {
  it('passes empty through UEmpty with the default inbox icon', () => {
    const wrapper = render({
      message: 'No runner has registered.',
      state: 'empty',
      title: 'No runners',
    })
    const empty = wrapper.get('[data-stub="UEmpty"]')

    expect(empty.get('[data-stub-slot="title"]').text()).toBe('No runners')
    expect(empty.get('[data-stub-slot="description"]').text()).toBe('No runner has registered.')
    expect(empty.attributes('data-stub-icon')).toBe('i-lucide-inbox')
  })

  it('passes absent through UEmpty with its own icon, not empty’s', () => {
    const wrapper = render({ state: 'absent', title: 'Not published' })

    expect(wrapper.get('[data-stub="UEmpty"]').attributes('data-stub-icon')).toBe(
      'i-lucide-circle-dashed',
    )
  })

  it('lets the caller replace the icon', () => {
    const wrapper = render({ icon: 'i-lucide-server', state: 'empty', title: 'No runners' })

    expect(wrapper.get('[data-stub="UEmpty"]').attributes('data-stub-icon')).toBe('i-lucide-server')
  })

  it('renders loading as skeletons, with the title and message as real text', () => {
    const wrapper = render({
      message: 'Asking the fleet.',
      state: 'loading',
      title: 'Loading runners',
    })
    const panel = panelOf(wrapper, 'loading')

    expect(panel.findAll('[data-stub="USkeleton"]').length).toBeGreaterThan(0)
    expect(panel.get('.ne-state-panel__title').text()).toBe('Loading runners')
    expect(panel.get('.ne-state-panel__message').text()).toBe('Asking the fleet.')
    // The shimmer itself carries no information, so it is hidden from AT.
    expect(panel.get('.ne-state-panel__skeletons').attributes('aria-hidden')).toBe('true')
  })

  it('passes error through UAlert in the error colour', () => {
    const wrapper = render({
      message: 'HTTP 500.',
      state: 'error',
      title: 'Could not load runners',
    })
    const alert = wrapper.get('[data-stub="UAlert"]')

    expect(alert.get('[data-stub-slot="title"]').text()).toBe('Could not load runners')
    expect(alert.get('[data-stub-slot="description"]').text()).toBe('HTTP 500.')
    expect(alert.attributes('data-stub-color')).toBe('error')
    expect(alert.attributes('data-stub-icon')).toBe('i-lucide-circle-alert')
  })

  it('passes blocked through UAlert in a different colour and icon from error', () => {
    const wrapper = render({ state: 'blocked' })
    const alert = wrapper.get('[data-stub="UAlert"]')

    expect(alert.attributes('data-stub-color')).toBe('warning')
    expect(alert.attributes('data-stub-icon')).toBe('i-lucide-unplug')
    // A caller with nothing to say still gets a sentence, not an empty frame.
    expect(alert.get('[data-stub-slot="title"]').text()).not.toBe('')
  })
})

describe('NeStatePanel: accessibility by construction', () => {
  it('announces a failure assertively via UAlert, not a nested wrapper alert', () => {
    const wrapper = render({ state: 'error' })
    const panel = panelOf(wrapper, 'error')
    const alert = wrapper.get('[data-stub="UAlert"]')

    expect(alert.attributes('role')).toBe('alert')
    expect(panel.attributes('role')).toBeUndefined()
    expect(panel.attributes('aria-busy')).toBeUndefined()
  })

  it('announces a pending read politely and marks it busy', () => {
    const panel = panelOf(render({ state: 'loading' }), 'loading')

    expect(panel.attributes('role')).toBe('status')
    expect(panel.attributes('aria-live')).toBe('polite')
    expect(panel.attributes('aria-busy')).toBe('true')
  })

  it.each<NeStateValue>(['empty', 'absent', 'blocked'])(
    'gives %s a status role and no busy flag',
    (state) => {
      const panel = panelOf(render({ state }), state)

      expect(panel.attributes('role')).toBe('status')
      expect(panel.attributes('aria-busy')).toBeUndefined()
    },
  )

  it('renders as the element the caller asks for', () => {
    const wrapper = render({ as: 'section', state: 'empty' })

    expect(panelOf(wrapper, 'empty').element.tagName).toBe('SECTION')
  })
})

describe('NeStatePanel: unknown is never rendered as zero', () => {
  it('gives the three no-content readings three different shapes', () => {
    const shapeOf = (state: NeStateValue): string =>
      panelOf(render({ state }), state).attributes('class') ?? ''

    const empty = shapeOf('empty')
    const absent = shapeOf('absent')
    const loading = shapeOf('loading')

    expect(new Set([empty, absent, loading]).size).toBe(3)
    // Shape, not hue: a dashed box is a placeholder for a set, a dotted left
    // rule is a fact nobody publishes, a solid box is a read still in flight.
    expect(empty).toContain('border-dashed')
    expect(absent).toContain('border-dotted')
    expect(loading).not.toContain('border-dashed')
    expect(loading).not.toContain('border-dotted')
  })

  it.each<NeStateValue>(['absent', 'blocked'])(
    '%s never renders as an empty list',
    (state) => {
      const wrapper = render({ state, title: 'Runners' })
      const panel = panelOf(wrapper, state)

      // The reading keeps its own name. An empty collection is `empty`'s job.
      expect(panel.attributes('data-ne-state')).toBe(state)
      expect(wrapper.find('[data-ne-state="empty"]').exists()).toBe(false)
      expect(panel.get('.ne-state-panel__eyebrow').text()).not.toBe('Empty')
      expect(panel.text()).not.toMatch(/\b0\b/)
      // No collection list — only the optional named-gaps list uses `<ul>`,
      // and these cases have none.
      expect(panel.findAll('ul')).toHaveLength(0)
    },
  )

  it('does not let blocked collapse into UEmpty, the empty-list primitive', () => {
    const wrapper = render({ state: 'blocked', title: 'Runners' })

    expect(wrapper.find('[data-stub="UEmpty"]').exists()).toBe(false)
    expect(wrapper.find('[data-stub="UAlert"]').exists()).toBe(true)
  })

  it('keeps absent on UEmpty but not with empty’s inbox icon or dashed box', () => {
    const wrapper = render({ state: 'absent', title: 'Runners' })

    expect(wrapper.get('[data-stub="UEmpty"]').attributes('data-stub-icon')).toBe(
      'i-lucide-circle-dashed',
    )
    expect(panelOf(wrapper, 'absent').classes()).not.toContain('border-dashed')
  })
})

describe('NeStatePanel: the useAsyncData status mapping', () => {
  it.each<[string, NeStateValue]>([
    ['idle', 'loading'],
    ['pending', 'loading'],
    ['error', 'error'],
  ])('maps status=%s onto the %s reading', (status, state) => {
    const wrapper = render({ status })

    expect(wrapper.get('[data-ne-state]').attributes('data-ne-state')).toBe(state)
  })

  it('lets an explicit state win over a bound status', () => {
    // The documented composition: a successful read with no rows is `empty`,
    // and only the caller can know that.
    const wrapper = render({ state: 'empty', status: 'success' })

    expect(wrapper.get('[data-ne-state]').attributes('data-ne-state')).toBe('empty')
  })
})

describe('NeStatePanel: gaps, the unblocker, and the action slot', () => {
  it('renders named gaps as a list, never folded into prose', () => {
    const wrapper = render({
      gaps: [
        { id: 'runners.heartbeat', need: 'no producer publishes a heartbeat' },
        { id: 'runners.capacity', need: 'capacity is not reported' },
      ],
      state: 'absent',
    })

    const items = wrapper.findAll('.ne-state-panel__gaps li')
    expect(items).toHaveLength(2)
    expect(items[0]?.get('.ne-state-panel__gap-id').text()).toBe('runners.heartbeat')
    expect(items[0]?.text()).toContain('no producer publishes a heartbeat')
  })

  it('accepts plain strings for the simple case', () => {
    const wrapper = render({ gaps: ['no heartbeat', 'no capacity'], state: 'absent' })

    const items = wrapper.findAll('.ne-state-panel__gaps li')
    expect(items.map((item) => item.text())).toEqual(['no heartbeat', 'no capacity'])
    expect(wrapper.find('.ne-state-panel__gap-id').exists()).toBe(false)
  })

  it('renders no gaps list when there are none', () => {
    expect(render({ state: 'empty' }).find('.ne-state-panel__gaps').exists()).toBe(false)
  })

  it('renders the unblocking condition as plain text when there is no link', () => {
    const wrapper = render({ state: 'blocked', unblocksOn: 'a runner reports in' })

    expect(wrapper.get('.ne-state-panel__unblocks-label').text()).toBe('Unblocks on')
    expect(wrapper.get('.ne-state-panel__unblocks-condition').text()).toBe('a runner reports in')
    expect(wrapper.find('.ne-state-panel__unblocks a').exists()).toBe(false)
  })

  it('links the condition itself when only an href is given', () => {
    const wrapper = render({
      state: 'blocked',
      unblocksHref: 'https://example.invalid/152',
      unblocksOn: 'a runner reports in',
    })
    const link = wrapper.get('.ne-state-panel__unblocks-condition')

    expect(link.element.tagName).toBe('A')
    expect(link.attributes('href')).toBe('https://example.invalid/152')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })

  it('links the reference beside the condition when both are given', () => {
    const wrapper = render({
      state: 'blocked',
      unblocksHref: 'https://example.invalid/152',
      unblocksOn: 'a runner reports in',
      unblocksRef: 'operator-portal#152',
    })

    expect(wrapper.get('.ne-state-panel__unblocks-condition').element.tagName).toBe('SPAN')
    const ref = wrapper.get('.ne-state-panel__unblocks-ref')
    expect(ref.element.tagName).toBe('A')
    expect(ref.text()).toBe('operator-portal#152')
  })

  it('renders no unblocker line when there is nothing to say', () => {
    expect(render({ state: 'empty' }).find('.ne-state-panel__unblocks').exists()).toBe(false)
  })

  it('renders the action slot inside the panel', () => {
    const wrapper = render(
      { state: 'empty', title: 'No runners' },
      { action: '<button class="add">Add one</button>' },
    )

    expect(panelOf(wrapper, 'empty').find('.add').exists()).toBe(true)
  })

  it('renders no action wrapper when the slot is unused', () => {
    expect(render({ state: 'empty' }).find('.ne-state-panel__action').exists()).toBe(false)
  })

  it('does not render the default slot while a state is on screen', () => {
    const wrapper = render({ state: 'loading' }, { default: '<p class="rows">4 runners</p>' })

    expect(wrapper.find('.rows').exists()).toBe(false)
  })
})

describe('NeStatePanel: tokens are the only styling contract', () => {
  it('does not hardcode a colour, radius, shadow or font', () => {
    const template = componentSource.split('<template>')[1] ?? componentSource
    const script = componentSource.split('<script')[1]?.split('</script>')[0] ?? ''

    for (const source of [template, script]) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      // Quoted hex only — issue refs like operator-portal#183 are not colours.
      expect(code).not.toMatch(/['"`]#[0-9a-f]{3,8}\b/i)
      expect(code).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch)\(/)
      expect(code).not.toMatch(/font-family\s*:/)
      expect(code).not.toMatch(/box-shadow\s*:/)
      expect(code).not.toMatch(/border-radius\s*:/)
      expect(code).not.toMatch(/\b(?:rounded-md|rounded-lg|rounded-xl|shadow-md|shadow-lg)\b/)
    }
  })
})
