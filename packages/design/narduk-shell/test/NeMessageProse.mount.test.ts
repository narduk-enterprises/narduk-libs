// @vitest-environment happy-dom
/*
 * NeMessageProse, mounted: an agent's or a bot's text rendered as real
 * elements (never `v-html`) in a compact skin, clamped by a measured height
 * with a Show more button that exists only once the text overflows, or as one
 * inline line.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import NeMessageProse from '../src/runtime/components/NeMessageProse.vue'

import type { NeMessageProseProps } from '../src/index'

function render(props: NeMessageProseProps) {
  return mount(NeMessageProse, { props })
}

/** happy-dom does no layout: stand in for one by giving every element these heights. */
function layout(scrollHeight: number, clientHeight: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('NeMessageProse block mode', () => {
  it('renders markdown as elements inside one root, with no h1 or heading at all', () => {
    const wrapper = render({
      text: '# Plan\n\nDone **now**, see `x` and [the PR](https://example.test/pr).\n\n- one\n- two',
    })
    const root = wrapper.get('[data-testid="ne-message-prose"]')
    expect(root.classes()).toContain('ne-message-prose')
    expect(root.find('h1, h2, h3, h4').exists()).toBe(false)
    expect(root.get('p strong').text()).toBe('Plan')
    expect(root.findAll('p strong').map((strong) => strong.text())).toEqual(['Plan', 'now'])
    expect(root.get('code').text()).toBe('x')
    expect(root.findAll('li').map((li) => li.text())).toEqual(['one', 'two'])
    expect(root.html()).not.toContain('**')
  })

  it('opens an https link in a new tab and shows every other link as its text', () => {
    const wrapper = render({
      text: '[a](https://example.test/a) [b](http://example.test/b) [c](docs/c.md) [d](#d) [e](javascript:alert(1)) [f](mailto:a@b.test)',
    })
    const links = wrapper.findAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]!.attributes()).toMatchObject({
      href: 'https://example.test/a',
      target: '_blank',
      rel: 'noopener',
    })
    expect(wrapper.text()).toBe('a b c d e f')
  })

  it('shows markup in the text as text, never as elements', () => {
    const wrapper = render({ text: '<img src=x onerror=alert(1)> and <b>raw</b>' })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
  })

  it('keeps a cut marker visible and the words after it', () => {
    const wrapper = render({ text: 'Fixed **three things, then `ran the gate and it passed' })
    expect(wrapper.text()).toBe('Fixed **three things, then `ran the gate and it passed')
    expect(wrapper.find('strong, code').exists()).toBe(false)
  })

  it('mounts a message nested far past what the renderer could recurse, as text', () => {
    const text = '> '.repeat(2000) + 'deep'
    expect(() => render({ text })).not.toThrow()
    expect(render({ text }).text()).toBe(text)
  })

  it('renders nothing for null, undefined and empty text, and no button', () => {
    for (const text of [null, undefined, '']) {
      const wrapper = render({ text, clamp: 7 })
      expect(wrapper.text()).toBe('')
      expect(wrapper.find('button').exists()).toBe(false)
    }
  })

  it('has no clamp and no button without `clamp`, or with one that is not positive', () => {
    layout(500, 100)
    for (const clamp of [undefined, 0, -1, Number.NaN]) {
      const wrapper = render({ text: 'a\n\nb', clamp })
      expect(wrapper.get('.ne-message-prose__box').attributes('style') ?? '').not.toContain(
        'max-height',
      )
      expect(wrapper.find('button').exists()).toBe(false)
    }
  })

  it('clamps to the line count as a height, not a hover rule', () => {
    layout(100, 100)
    const box = render({ text: 'a\n\nb', clamp: 7 }).get('.ne-message-prose__box')
    expect(box.attributes('style')).toContain('max-height: 7lh')
    expect(box.classes()).toContain('ne-message-prose__box--clamped')
  })

  it('has no Show more when the text fits', async () => {
    layout(100, 100)
    const wrapper = render({ text: 'short', clamp: 7 })
    await nextTick()
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.get('.ne-message-prose__box').classes()).not.toContain(
      'ne-message-prose__box--cut',
    )
  })

  it('shows Show more when the text overflows, and toggles Show less', async () => {
    layout(300, 100)
    const wrapper = render({ text: 'a\n\nb\n\nc', clamp: 2 })
    await nextTick()
    const toggle = wrapper.get('[data-testid="ne-message-prose-toggle"]')
    expect(toggle.text()).toBe('Show more')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-controls')).toBe(
      wrapper.get('.ne-message-prose__box').element.id,
    )
    expect(wrapper.get('.ne-message-prose__box').classes()).toContain('ne-message-prose__box--cut')

    await toggle.trigger('click')
    expect(toggle.text()).toBe('Show less')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    const box = wrapper.get('.ne-message-prose__box')
    expect(box.attributes('style') ?? '').not.toContain('max-height')
    expect(box.classes()).not.toContain('ne-message-prose__box--clamped')

    await toggle.trigger('click')
    expect(toggle.text()).toBe('Show more')
    expect(wrapper.get('.ne-message-prose__box').attributes('style')).toContain('max-height: 2lh')
  })

  it('closes again, and re-measures, when the text changes', async () => {
    layout(300, 100)
    const wrapper = render({ text: 'a\n\nb\n\nc', clamp: 2 })
    await nextTick()
    await wrapper.get('button').trigger('click')
    layout(100, 100)
    await wrapper.setProps({ text: 'short' })
    await nextTick()
    await nextTick()
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.get('.ne-message-prose__box').attributes('style')).toContain('max-height: 2lh')
  })

  it('measures again when the box is resized, and stops watching when it unmounts', async () => {
    const observers: Array<{ cb: () => void; disconnect: ReturnType<typeof vi.fn> }> = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        disconnect = vi.fn()
        constructor(cb: () => void) {
          observers.push({ cb, disconnect: this.disconnect })
        }
      },
    )
    layout(100, 100)
    const wrapper = render({ text: 'a\n\nb', clamp: 2 })
    await nextTick()
    expect(wrapper.find('button').exists()).toBe(false)

    layout(300, 100)
    observers[0]!.cb()
    await nextTick()
    expect(wrapper.find('button').exists()).toBe(true)

    wrapper.unmount()
    expect(observers[0]!.disconnect).toHaveBeenCalled()
  })

  it('takes its type from its container: it sets no font size or colour of its own', () => {
    const wrapper = render({ text: 'plain' })
    expect(wrapper.get('.ne-message-prose').attributes('style')).toBeUndefined()
    expect(wrapper.get('.ne-prose').classes()).toContain('ne-message-prose__prose')
  })
})

describe('NeMessageProse inline mode', () => {
  it('renders bold, em, code and an https link in one span, and no block element', () => {
    const wrapper = render({
      mode: 'inline',
      text: '# **Rotate** *the* `KEY`\n- at [policy](https://example.test/p)\n\n```\nfence\n```',
    })
    expect(wrapper.element.tagName).toBe('SPAN')
    expect(
      wrapper.find('p, ul, ol, li, pre, h1, h2, h3, h4, blockquote, table, div').exists(),
    ).toBe(false)
    expect(wrapper.get('strong').text()).toBe('Rotate')
    expect(wrapper.get('em').text()).toBe('the')
    expect(wrapper.get('code').text()).toBe('KEY')
    expect(wrapper.get('a').attributes()).toMatchObject({
      href: 'https://example.test/p',
      target: '_blank',
      rel: 'noopener',
    })
    expect(wrapper.text()).toBe('# Rotate the KEY - at policy fence')
  })

  it('turns a line break into a space', () => {
    expect(render({ mode: 'inline', text: 'one\ntwo  \nthree\\\nfour' }).text()).toBe(
      'one two three four',
    )
  })

  it('titles itself with the plain text, and lets the caller override it', () => {
    const wrapper = render({
      mode: 'inline',
      text: '**Rotate** the `KEY` [now](https://example.test)',
    })
    expect(wrapper.attributes('title')).toBe('Rotate the KEY now')
    const own = mount(NeMessageProse, {
      props: { mode: 'inline', text: '**a**' },
      attrs: { title: 'mine' },
    })
    expect(own.attributes('title')).toBe('mine')
  })

  it('renders every link but https as its text, and a cut marker as text', () => {
    const wrapper = render({ mode: 'inline', text: '[a](http://x.test) [b](#b) **cut' })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toBe('a b **cut')
  })

  it('ignores `clamp` and shows no button', async () => {
    layout(300, 100)
    const wrapper = render({ mode: 'inline', text: 'a\n\nb', clamp: 2 })
    await nextTick()
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('has no title and no content for empty text', () => {
    const wrapper = render({ mode: 'inline', text: null })
    expect(wrapper.text()).toBe('')
    expect(wrapper.attributes('title')).toBeUndefined()
  })

  it('keeps the caller class for its ellipsis', () => {
    const wrapper = mount(NeMessageProse, {
      props: { mode: 'inline', text: 'x' },
      attrs: { class: 'truncate' },
    })
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['ne-message-prose', 'truncate']))
  })
})
