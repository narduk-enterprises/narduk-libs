/*
 * messageProseBlocks and its helpers (NeMessageProse): what an agent or a bot
 * wrote, as NeProse blocks. A heading is a bold paragraph with no id, only an
 * `https:` link stays a link, a flattened list gets its line breaks back, and
 * nothing throws. The grammar is parseProse's.
 */
import { describe, expect, it } from 'vitest'

import {
  messageProseBlocks,
  messageProseInline,
  messageProseText,
  unflattenLists,
} from '../src/index'

import type { NeProseBlock, NeProseInline } from '../src/index'

function inlines(runs: readonly NeProseInline[]): NeProseInline[] {
  return runs.flatMap((run) => ('children' in run ? [run, ...inlines(run.children)] : [run]))
}

function allInlines(blocks: readonly NeProseBlock[]): NeProseInline[] {
  return blocks.flatMap((block): NeProseInline[] => {
    if (block.type === 'paragraph' || block.type === 'heading') return inlines(block.children)
    if (block.type === 'list') return block.items.flatMap((item) => allInlines(item.children))
    if (block.type === 'blockquote') return allInlines(block.children)
    if (block.type === 'table') {
      return [...block.head, ...block.rows.flat()].flatMap((cell) => inlines(cell))
    }
    return []
  })
}

function linkHrefs(blocks: readonly NeProseBlock[]): string[] {
  return allInlines(blocks).flatMap((run) => (run.type === 'link' ? [run.href] : []))
}

describe('messageProseBlocks', () => {
  it('reads a numbered list as a list, and inline code and a link as such', () => {
    const blocks = messageProseBlocks(
      'Done:\n\n1. fixed `LaneStream`\n2. opened [#2682](https://github.com/narduk-enterprises/operator-portal/pull/2682)\n',
    )
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'list'])
    const list = blocks[1]!
    expect(list.type === 'list' && list.ordered).toBe(true)
    const runs = allInlines(blocks)
    expect(runs).toContainEqual({ type: 'code', value: 'LaneStream' })
    expect(runs).toContainEqual({
      type: 'link',
      href: 'https://github.com/narduk-enterprises/operator-portal/pull/2682',
      children: [{ type: 'text', value: '#2682' }],
    })
  })

  it('turns every heading into a bold paragraph, so no message draws a type step or an id', () => {
    const blocks = messageProseBlocks('# Plan\n\ntext\n\n#### Detail\n\nmore')
    expect(blocks.some((block) => block.type === 'heading')).toBe(false)
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'strong', children: [{ type: 'text', value: 'Plan' }] }],
    })
    expect(JSON.stringify(blocks)).not.toContain('"id"')
  })

  it('demotes a heading inside a list and a blockquote too', () => {
    const blocks = messageProseBlocks('> ## Quoted\n\n- ## Listed')
    expect(JSON.stringify(blocks)).not.toContain('"heading"')
    expect(JSON.stringify(blocks)).toContain('"strong"')
  })

  it('keeps the text of a #fragment link and drops the link', () => {
    const runs = allInlines(messageProseBlocks('see [the plan](#plan) and **[bold](#b)**'))
    expect(runs.some((run) => run.type === 'link')).toBe(false)
    expect(runs).toContainEqual({ type: 'text', value: 'see the plan and ' })
    expect(runs).toContainEqual({ type: 'strong', children: [{ type: 'text', value: 'bold' }] })
  })

  it('renders a relative link as its text, and keeps an https one', () => {
    const blocks = messageProseBlocks('[a](docs/a.md) [b](https://example.com/b)')
    expect(linkHrefs(blocks)).toEqual(['https://example.com/b'])
    expect(allInlines(blocks)).toContainEqual({ type: 'text', value: 'a ' })
  })

  it('keeps a link only when it is https: http, mailto, tel, ftp and script links are text', () => {
    const blocks = messageProseBlocks(
      [
        '[h](http://example.com/h)',
        '[m](mailto:a@b.test)',
        '[t](tel:+15555550100)',
        '[f](ftp://example.com/f)',
        '[j](javascript:alert(1))',
        '[d](data:text/html,x)',
        '[ok](HTTPS://example.com/ok)',
        'bare http://example.com/bare and <http://example.com/auto> and <a@b.test>',
        'bare https://example.com/bare',
      ].join('\n\n'),
    )
    expect(linkHrefs(blocks)).toEqual(['HTTPS://example.com/ok', 'https://example.com/bare'])
    const text = JSON.stringify(blocks)
    for (const label of ['"h"', '"m"', '"t"', '"f"', '"j"', '"d"']) expect(text).toContain(label)
    expect(text).toContain('http://example.com/bare')
  })

  it('drops a non-https link inside a table cell and a heading, keeping the words', () => {
    const blocks = messageProseBlocks('| a |\n| - |\n| [x](http://x.test) |\n\n## [h](#h)')
    expect(linkHrefs(blocks)).toEqual([])
    expect(JSON.stringify(blocks)).toContain('"x"')
  })

  it('keeps raw HTML as text and takes no input for null, undefined or empty', () => {
    expect(JSON.stringify(messageProseBlocks('<img src=x onerror=alert(1)>'))).toContain(
      '<img src=x',
    )
    expect(messageProseBlocks(null)).toEqual([])
    expect(messageProseBlocks(undefined)).toEqual([])
    expect(messageProseBlocks('')).toEqual([])
  })

  it('never throws, whatever it is given', () => {
    const odd = [
      '\u0000',
      '[[[[[[(((((',
      '`'.repeat(5000),
      '*'.repeat(5000),
      '[a](' + '('.repeat(2000),
      '| a |'.repeat(500),
      '- '.repeat(2000),
      ' - **A.** '.repeat(500),
    ]
    for (const text of odd) expect(() => messageProseBlocks(text)).not.toThrow()
    expect(() => messageProseBlocks(42 as unknown as string)).not.toThrow()
    expect(() => messageProseBlocks({} as unknown as string)).not.toThrow()
  })

  describe('a marker a producer cut off', () => {
    it('shows a dangling ** as text and does not swallow the rest', () => {
      const blocks = messageProseBlocks('Merged the fix, then **Next: wait for CI')
      expect(blocks).toEqual([
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'Merged the fix, then **Next: wait for CI' }],
        },
      ])
    })

    it('shows a dangling backtick as text and does not swallow the rest', () => {
      const blocks = messageProseBlocks('Ran `pnpm run quality and then **passed** it')
      const runs = allInlines(blocks)
      expect(runs).toContainEqual({ type: 'text', value: 'Ran `pnpm run quality and then ' })
      expect(runs).toContainEqual({ type: 'strong', children: [{ type: 'text', value: 'passed' }] })
    })

    it('shows half a link and and a dangling underscore or double backtick as text', () => {
      for (const text of ['see [the PR](docs/a', 'x _y', 'a ``b']) {
        const blocks = messageProseBlocks(text)
        expect(blocks).toHaveLength(1)
        expect(allInlines(blocks).every((run) => run.type === 'text')).toBe(true)
        expect(prose(blocks)).toBe(text)
      }
    })

    it('keeps a cut marker inside a list item to that item', () => {
      const blocks = messageProseBlocks('- **one\n- two `x\n- three')
      const list = blocks[0]
      expect(list?.type === 'list' ? list.items.length : 0).toBe(3)
    })

    it('shows the rest of the message as code after an unclosed fence, never as lost text', () => {
      const blocks = messageProseBlocks('Output:\n\n```\nline one\nline two')
      expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'code'])
      expect(blocks[1]).toMatchObject({ value: 'line one\nline two' })
    })
  })
})

function prose(blocks: readonly NeProseBlock[]): string {
  return allInlines(blocks)
    .map((run) => (run.type === 'text' ? run.value : ''))
    .join('')
}

describe('unflattenLists (a producer that flattened a message onto one line)', () => {
  // Both texts are lane hand-backs as the portal received them on 17 Oct 2026, line breaks already gone.
  const STILL_OPEN =
    'The work is finished. I closed issue #46 with a comment. Still open: - **First scheduled run:** The first unattended run is tomorrow at 13:30 UTC. - **Bid Bot delivery:** I guessed the `grokbot:bid-bot` address. - **Failure alerts:** A failed refresh shows only as a red run.'
  const CHECKED =
    'The brief is complete. The session hook flagged buoys#400 as a red main, so I checked it. - **Main is green now.** CI run 39037509648 on 5d2bc74 succeeded. - **#400 is a separate, older issue.** It was opened 2026-10-13.'

  it('turns " - **x**" markers after a sentence end into a list that renders as one', () => {
    const blocks = messageProseBlocks(STILL_OPEN)
    expect(blocks[0]).toMatchObject({ type: 'paragraph' })
    const list = blocks.find((block) => block.type === 'list')
    expect(list && list.type === 'list' ? list.items.length : 0).toBe(3)
    expect(JSON.stringify(blocks)).not.toContain('**')
  })

  it('keeps the sentence before the list as its own paragraph', () => {
    expect(unflattenLists(CHECKED)).toMatch(/so I checked it\.\n\n- \*\*Main is green now\.\*\*/)
  })

  it('leaves a lone dash, a date range and text that already has line breaks alone', () => {
    const lone = 'Ran the build - it passed on 2026-10-16.'
    expect(unflattenLists(lone)).toBe(lone)
    const lined = 'Done:\n- A\n- B'
    expect(unflattenLists(lined)).toBe(lined)
  })

  it('needs two markers: one bullet after a sentence is prose', () => {
    const one = 'Result: - **Passed** on the first try.'
    expect(unflattenLists(one)).toBe(one)
  })

  it('restores a flattened list numbered markdown-style, every item "1."', () => {
    // The 17 Oct message that still rendered as one paragraph after #2734.
    const text =
      'Blockers found: 1. Reviewed from the diff only, nothing built or run. 1. **City staff direct emails are rendered on the public site.** The source is `apps/web/app/data/city.ts`.'
    const list = messageProseBlocks(text).find((block) => block.type === 'list')
    expect(list && list.type === 'list' ? list.items.length : 0).toBe(2)
  })

  it('restores a flattened numbered list only when the numbers run in order', () => {
    expect(unflattenLists('Two calls: 1. Keep Redis. 2. Move the probe.')).toBe(
      'Two calls:\n\n1. Keep Redis.\n2. Move the probe.',
    )
    const prose = 'Version 2. Then 7. Done.'
    expect(unflattenLists(prose)).toBe(prose)
  })

  it('can be switched off', () => {
    const blocks = messageProseBlocks(STILL_OPEN, { unflatten: false })
    expect(blocks.map((block) => block.type)).toEqual(['paragraph'])
  })
})

describe('messageProseInline and messageProseText', () => {
  it('reads bold, em, code and an https link, and nothing else', () => {
    const runs = messageProseInline(
      '**a** *b* `c` [d](https://example.com/d) [e](#e) [f](http://x.test)',
    )
    expect(runs.map((run) => run.type)).toEqual([
      'strong',
      'text',
      'em',
      'text',
      'code',
      'text',
      'link',
      'text',
    ])
    expect(JSON.stringify(runs)).not.toContain('http://x.test')
  })

  it('never makes a block: a heading, bullet or fence marker is text, and a line break is a space', () => {
    const runs = messageProseInline('# Title\n- one\nline two  \nthree\\\nfour')
    expect(runs.every((run) => ['text', 'strong', 'em', 'code', 'link'].includes(run.type))).toBe(
      true,
    )
    expect(messageProseText('# Title\n- one\nline two  \nthree\\\nfour')).toBe(
      '# Title - one line two three four',
    )
  })

  it('has plain text without markers, for a title', () => {
    expect(messageProseText('**Rotate** the `API_KEY` [now](https://example.com)')).toBe(
      'Rotate the API_KEY now',
    )
    expect(messageProseText(null)).toBe('')
    expect(messageProseText('   ')).toBe('')
  })

  it('shows a cut marker as text', () => {
    expect(messageProseText('Done **mostly and `x')).toBe('Done **mostly and `x')
  })

  it('never throws', () => {
    expect(() => messageProseInline('`'.repeat(5000))).not.toThrow()
    expect(() => messageProseInline(7 as unknown as string)).not.toThrow()
  })
})
