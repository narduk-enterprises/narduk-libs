// @vitest-environment happy-dom
/*
 * NeProse, mounted (narduk-libs#1005): a markdown document rendered as real
 * elements — never `v-html` — in the suite's type scale.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import NeProse from '../src/runtime/components/NeProse.vue'
import { parseProse } from '../src/index'

import type { NeProseProps } from '../src/index'

function render(props: NeProseProps) {
  return mount(NeProse, { props })
}

const DOC = `# Runbook

Intro with \`code\`, **bold**, *italic* and a [link](https://example.test/a).

## Install

1. First
   - nested bullet
2. Second

### Details

\`\`\`ts
const answer = 42
\`\`\`

| Name | Count |
| :--- | ----: |
| a    | 1     |

> A quote.

---
`

describe('NeProse', () => {
  it('renders every construct as its element, inside one root', () => {
    const wrapper = render({ source: DOC })
    const root = wrapper.get('[data-testid="ne-prose"]')
    expect(root.classes()).toContain('ne-prose')

    expect(root.find('h1').exists()).toBe(false)
    expect(root.findAll('h2').map((h) => [h.attributes('id'), h.text()])).toEqual([
      ['runbook', 'Runbook'],
      ['install', 'Install'],
    ])
    expect(root.get('h3').attributes('id')).toBe('details')

    const intro = root.get('p')
    expect(intro.get('code').text()).toBe('code')
    expect(intro.get('strong').text()).toBe('bold')
    expect(intro.get('em').text()).toBe('italic')
    expect(intro.get('a').attributes('href')).toBe('https://example.test/a')

    const code = root.get('pre > code')
    expect(code.text()).toBe('const answer = 42')
    expect(code.classes()).toContain('language-ts')
    expect(root.get('pre').attributes('data-lang')).toBe('ts')

    expect(root.get('blockquote').text()).toBe('A quote.')
    expect(root.find('hr').exists()).toBe(true)
  })

  it('nests lists as lists inside list items and keeps an ordered start', () => {
    const wrapper = render({ source: '3. three\n   - inner\n4. four' })
    const ol = wrapper.get('ol')
    expect(ol.attributes('start')).toBe('3')
    const items = ol.findAll(':scope > li')
    expect(items).toHaveLength(2)
    expect(items[0]?.get('ul > li').text()).toBe('inner')

    const plain = render({ source: '1. one' })
    expect(plain.get('ol').attributes('start')).toBeUndefined()
  })

  it('renders a table with header cells and per-column alignment', () => {
    const wrapper = render({ source: '| A | B | C |\n| :-: | --: | --- |\n| 1 | 2 | 3 |' })
    const heads = wrapper.findAll('thead th')
    expect(heads.map((th) => th.text())).toEqual(['A', 'B', 'C'])
    expect(heads.map((th) => (th.element as HTMLElement).style.textAlign)).toEqual([
      'center',
      'right',
      '',
    ])
    expect(heads[0]?.attributes('scope')).toBe('col')
    const cells = wrapper.findAll('tbody td')
    expect(cells.map((td) => td.text())).toEqual(['1', '2', '3'])
    expect((cells[1]?.element as HTMLElement).style.textAlign).toBe('right')
  })

  it('never creates markup from the source: HTML in it is text', () => {
    const wrapper = render({
      source: '<script>window.pwned = 1</script>\n\n<img src=x onerror="alert(1)">\n\n`<b>`',
    })
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.text()).toContain('<script>window.pwned = 1</script>')
    expect(wrapper.get('code').text()).toBe('<b>')
  })

  it('drops unsafe hrefs: the text renders, the anchor does not', () => {
    const wrapper = render({
      source:
        '[bad](javascript:alert(1)) [data](data:text/html,x) [ok](#install) [mail](mailto:a@b.test)',
    })
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toEqual(['#install', 'mailto:a@b.test'])
    expect(wrapper.html()).not.toContain('javascript:')
    expect(wrapper.html()).not.toContain('data:')
    expect(wrapper.text()).toContain('bad')
  })

  it('re-checks hrefs in a pre-parsed AST, which may not have come from parseProse', () => {
    const wrapper = render({
      blocks: [
        {
          type: 'paragraph',
          children: [
            { type: 'link', href: 'javascript:alert(1)', children: [{ type: 'text', value: 'x' }] },
          ],
        },
      ],
    })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toBe('x')
  })

  it('renders a pre-parsed AST from `blocks`, which wins over `source`', () => {
    const blocks = parseProse('## From blocks')
    const wrapper = render({ blocks, source: '## From source' })
    expect(wrapper.get('h2').text()).toBe('From blocks')
    expect(wrapper.get('h2').attributes('id')).toBe('from-blocks')
  })

  it('re-renders when the source changes', async () => {
    const wrapper = render({ source: '## One' })
    await wrapper.setProps({ source: '## Two\n\ntext' })
    expect(wrapper.get('h2').text()).toBe('Two')
    expect(wrapper.get('p').text()).toBe('text')
  })

  it('renders an empty root for an empty or missing source, without a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(render({}).get('[data-testid="ne-prose"]').element.children).toHaveLength(0)
    expect(render({ source: '' }).get('[data-testid="ne-prose"]').text()).toBe('')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('turns a hard line break into <br>', () => {
    expect(render({ source: 'a  \nb' }).find('br').exists()).toBe(true)
  })
})
