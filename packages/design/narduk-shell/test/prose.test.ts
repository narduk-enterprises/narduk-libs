/*
 * NeProse's markdown-subset parser (narduk-libs#1005). Pure: no Vue, no DOM.
 * The package root re-exports `parseProse` and `proseOutline`, so they are
 * asserted from there; the two smaller helpers from their own module.
 */
import { describe, expect, it } from 'vitest'

import { parseProse, proseOutline } from '../src/index'
import { createProseSlugger, safeProseHref } from '../src/runtime/utils/prose'

import type { NeProseBlock, NeProseInline } from '../src/index'

function text(value: string): NeProseInline {
  return { type: 'text', value }
}

function paragraph(...children: NeProseInline[]): NeProseBlock {
  return { type: 'paragraph', children }
}

/** The inline runs of the only paragraph `source` parses to. */
function inline(source: string): NeProseInline[] {
  const blocks = parseProse(source)
  expect(blocks).toHaveLength(1)
  const [block] = blocks
  if (block?.type !== 'paragraph') throw new Error(`expected a paragraph, got ${block?.type}`)
  return block.children
}

describe('parseProse: headings', () => {
  it('parses h2 and h3 with their inline content and a slug id', () => {
    expect(parseProse('## Install the *module*\n\n### Options')).toEqual([
      {
        type: 'heading',
        level: 2,
        id: 'install-the-module',
        children: [text('Install the '), { type: 'em', children: [text('module')] }],
      },
      { type: 'heading', level: 3, id: 'options', children: [text('Options')] },
    ])
  })

  it('demotes h1 to h2 (the page header owns the h1) and clamps h4-h6 to h3', () => {
    const levels = parseProse('# Title\n\n#### Deep\n\n###### Deeper').map((block) =>
      block.type === 'heading' ? block.level : null,
    )
    expect(levels).toEqual([2, 3, 3])
  })

  it('reads setext headings and strips a closing hash run', () => {
    expect(parseProse('Title\n=====\n\nPart\n----\n\n## Closed ##')).toEqual([
      { type: 'heading', level: 2, id: 'title', children: [text('Title')] },
      { type: 'heading', level: 2, id: 'part', children: [text('Part')] },
      { type: 'heading', level: 2, id: 'closed', children: [text('Closed')] },
    ])
  })

  it('requires a space after the hashes', () => {
    expect(parseProse('#hashtag')).toEqual([paragraph(text('#hashtag'))])
  })
})

describe('heading ids', () => {
  it('slugs lowercase words joined by hyphens, punctuation dropped', () => {
    const slug = createProseSlugger()
    expect(slug('Hello, World! (v2)')).toBe('hello-world-v2')
    expect(slug('  Über   café  ')).toBe('über-café')
    expect(slug('snake_case and kebab-case')).toBe('snake_case-and-kebab-case')
    expect(slug('!!!')).toBe('section')
  })

  it('keeps ids unique within a document by suffixing repeats', () => {
    const ids = parseProse('## Setup\n\n## Setup\n\n### Setup\n\n## Setup-1').map((block) =>
      block.type === 'heading' ? block.id : null,
    )
    expect(ids).toEqual(['setup', 'setup-1', 'setup-2', 'setup-1-1'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is stable: the same source always yields the same ids', () => {
    const source = '## A\n\n## A\n\n### B'
    expect(parseProse(source)).toEqual(parseProse(source))
  })
})

describe('proseOutline', () => {
  it('lists every heading with its level, id and plain text, in document order', () => {
    const blocks = parseProse(
      '# Guide\n\nIntro.\n\n## Install `pnpm`\n\n### With **npm**\n\n> ## Quoted heading\n\n## [Linked](https://x.test)',
    )
    expect(proseOutline(blocks)).toEqual([
      { level: 2, id: 'guide', text: 'Guide' },
      { level: 2, id: 'install-pnpm', text: 'Install pnpm' },
      { level: 3, id: 'with-npm', text: 'With npm' },
      { level: 2, id: 'linked', text: 'Linked' },
    ])
  })

  it('accepts a source string directly', () => {
    expect(proseOutline('## One\n\ntext\n\n## Two')).toEqual([
      { level: 2, id: 'one', text: 'One' },
      { level: 2, id: 'two', text: 'Two' },
    ])
  })
})

describe('parseProse: paragraphs', () => {
  it('joins consecutive lines and splits on blank lines', () => {
    expect(parseProse('one\ntwo\n\nthree')).toEqual([
      paragraph(text('one\ntwo')),
      paragraph(text('three')),
    ])
  })

  it('turns a trailing double space or backslash into a hard break', () => {
    expect(inline('one  \ntwo\\\nthree')).toEqual([
      text('one'),
      { type: 'break' },
      text('two'),
      { type: 'break' },
      text('three'),
    ])
  })

  it('returns no blocks for an empty or blank source', () => {
    expect(parseProse('')).toEqual([])
    expect(parseProse('  \n\n \t\n')).toEqual([])
  })

  it('normalises CRLF line endings', () => {
    expect(parseProse('## A\r\n\r\nb')).toEqual(parseProse('## A\n\nb'))
  })

  it('keeps raw HTML as text; nothing is ever interpreted as markup', () => {
    expect(inline('<script>alert(1)</script> <b>x</b>')).toEqual([
      text('<script>alert(1)</script> <b>x</b>'),
    ])
  })
})

describe('parseProse: inline', () => {
  it('parses inline code verbatim, with no emphasis inside it', () => {
    expect(inline('run `pnpm **i**` now')).toEqual([
      text('run '),
      { type: 'code', value: 'pnpm **i**' },
      text(' now'),
    ])
    expect(inline('``a ` b``')).toEqual([{ type: 'code', value: 'a ` b' }])
  })

  it('parses bold and italic with both delimiters, and nests them', () => {
    expect(inline('**b** __b__ *i* _i_')).toEqual([
      { type: 'strong', children: [text('b')] },
      text(' '),
      { type: 'strong', children: [text('b')] },
      text(' '),
      { type: 'em', children: [text('i')] },
      text(' '),
      { type: 'em', children: [text('i')] },
    ])
    expect(inline('*a **b** c*')).toEqual([
      {
        type: 'em',
        children: [text('a '), { type: 'strong', children: [text('b')] }, text(' c')],
      },
    ])
    expect(inline('***both***')).toEqual([
      { type: 'em', children: [{ type: 'strong', children: [text('both')] }] },
    ])
  })

  it('leaves intraword underscores, lone and spaced delimiters as text', () => {
    expect(inline('snake_case_name')).toEqual([text('snake_case_name')])
    expect(inline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')])
    expect(inline('**unclosed')).toEqual([text('**unclosed')])
  })

  it('honours backslash escapes', () => {
    expect(inline('\\*not em\\* \\`not code\\`')).toEqual([text('*not em* `not code`')])
  })

  it('parses links with inline content and an optional title', () => {
    expect(inline('see [the **docs**](https://example.test/docs "Docs") now')).toEqual([
      text('see '),
      {
        type: 'link',
        href: 'https://example.test/docs',
        children: [text('the '), { type: 'strong', children: [text('docs')] }],
      },
      text(' now'),
    ])
  })

  it('parses angle-bracket autolinks and bare http(s) URLs', () => {
    expect(inline('<https://a.test/x> and <ops@narduk.test>')).toEqual([
      { type: 'link', href: 'https://a.test/x', children: [text('https://a.test/x')] },
      text(' and '),
      { type: 'link', href: 'mailto:ops@narduk.test', children: [text('ops@narduk.test')] },
    ])
    expect(inline('Go to https://b.test/path?q=1. Then stop.')).toEqual([
      text('Go to '),
      {
        type: 'link',
        href: 'https://b.test/path?q=1',
        children: [text('https://b.test/path?q=1')],
      },
      text('. Then stop.'),
    ])
  })

  it('renders an image as its alt text (images are out of scope)', () => {
    expect(inline('![a chart](https://x.test/c.png)')).toEqual([text('a chart')])
  })
})

describe('links: only safe hrefs survive', () => {
  it.each([
    'https://example.test',
    'http://example.test/a?b#c',
    'mailto:ops@example.test',
    'MAILTO:ops@example.test',
    '/docs/install',
    './sibling',
    '../up',
    'relative/path',
    '#install',
    '?page=2',
  ])('keeps %s', (href) => {
    expect(safeProseHref(href)).toBe(href)
  })

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    '\u0000javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.test',
    'tel:+15550100',
  ])('drops %j', (href) => {
    expect(safeProseHref(href)).toBeNull()
  })

  it('renders an unsafe link as its text, with no link node and no trace of the href', () => {
    const runs = inline('[click me](javascript:alert(1)) and <javascript:alert(2)>')
    expect(runs.some((run) => run.type === 'link')).toBe(false)
    expect(JSON.stringify(runs)).not.toContain('alert(1)')
    expect(runs).toEqual([text('click me and <javascript:alert(2)>')])
  })
})

describe('parseProse: lists', () => {
  it('parses an unordered list, one paragraph per item', () => {
    expect(parseProse('- one\n* two\n+ three')).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [
          { children: [paragraph(text('one'))] },
          { children: [paragraph(text('two'))] },
          { children: [paragraph(text('three'))] },
        ],
      },
    ])
  })

  it('parses an ordered list and keeps its start number', () => {
    expect(parseProse('3. three\n4) four')).toEqual([
      {
        type: 'list',
        ordered: true,
        start: 3,
        items: [{ children: [paragraph(text('three'))] }, { children: [paragraph(text('four'))] }],
      },
    ])
    const [list] = parseProse('1. one')
    expect(list).toMatchObject({ type: 'list', ordered: true, start: 1 })
  })

  it('nests an indented list inside its parent item, mixing kinds', () => {
    expect(parseProse('- parent\n  - child\n    1. grandchild\n- sibling')).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [
          {
            children: [
              paragraph(text('parent')),
              {
                type: 'list',
                ordered: false,
                items: [
                  {
                    children: [
                      paragraph(text('child')),
                      {
                        type: 'list',
                        ordered: true,
                        start: 1,
                        items: [{ children: [paragraph(text('grandchild'))] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { children: [paragraph(text('sibling'))] },
        ],
      },
    ])
  })

  it('nests under an ordered item indented by two spaces, as most authors write it', () => {
    const [list] = parseProse('1. step\n  - detail\n2. next')
    expect(list).toMatchObject({
      type: 'list',
      ordered: true,
      items: [
        { children: [paragraph(text('step')), { type: 'list', ordered: false }] },
        { children: [paragraph(text('next'))] },
      ],
    })
  })

  it('keeps continuation lines and indented blocks inside the item', () => {
    expect(parseProse('- first line\n  second line\n\n  another paragraph\n- next')).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [
          {
            children: [
              paragraph(text('first line\nsecond line')),
              paragraph(text('another paragraph')),
            ],
          },
          { children: [paragraph(text('next'))] },
        ],
      },
    ])
  })

  it('ends the list at an unindented paragraph after a blank line', () => {
    expect(parseProse('- a\n\nAfter.')).toEqual([
      { type: 'list', ordered: false, items: [{ children: [paragraph(text('a'))] }] },
      paragraph(text('After.')),
    ])
  })

  it('starts a new list when the marker kind changes', () => {
    const blocks = parseProse('- a\n1. b')
    expect(blocks.map((block) => block.type === 'list' && block.ordered)).toEqual([false, true])
  })

  it('lets a list interrupt a paragraph', () => {
    expect(parseProse('Steps:\n- one')).toEqual([
      paragraph(text('Steps:')),
      { type: 'list', ordered: false, items: [{ children: [paragraph(text('one'))] }] },
    ])
  })
})

describe('parseProse: fenced code', () => {
  it('keeps the language and the content verbatim', () => {
    expect(parseProse('```ts title="x"\nconst a = **b** <script>\n\n  indented\n```')).toEqual([
      { type: 'code', lang: 'ts', value: 'const a = **b** <script>\n\n  indented' },
    ])
  })

  it('accepts tildes, a fence with no language, and a longer closing fence', () => {
    expect(parseProse('~~~\nplain\n~~~~')).toEqual([{ type: 'code', lang: null, value: 'plain' }])
  })

  it('does not close on a shorter fence, and runs an unclosed fence to the end', () => {
    expect(parseProse('````md\n```\ninner\n```\n````')).toEqual([
      { type: 'code', lang: 'md', value: '```\ninner\n```' },
    ])
    expect(parseProse('```sh\necho hi')).toEqual([{ type: 'code', lang: 'sh', value: 'echo hi' }])
  })

  it('works inside a list item', () => {
    const [list] = parseProse('- run:\n\n  ```sh\n  pnpm i\n  ```')
    expect(list).toMatchObject({
      type: 'list',
      items: [
        { children: [paragraph(text('run:')), { type: 'code', lang: 'sh', value: 'pnpm i' }] },
      ],
    })
  })
})

describe('parseProse: tables', () => {
  it('parses head, rows and per-column alignment', () => {
    expect(
      parseProse(
        '| Name | Kind | Count |\n| :--- | :---: | ---: |\n| a | `b` | 1 |\n| c | d | 2 |',
      ),
    ).toEqual([
      {
        type: 'table',
        align: ['left', 'center', 'right'],
        head: [[text('Name')], [text('Kind')], [text('Count')]],
        rows: [
          [[text('a')], [{ type: 'code', value: 'b' }], [text('1')]],
          [[text('c')], [text('d')], [text('2')]],
        ],
      },
    ])
  })

  it('accepts a table without outer pipes and an unaligned column', () => {
    expect(parseProse('a | b\n--- | ---\n1 | 2')).toEqual([
      {
        type: 'table',
        align: [null, null],
        head: [[text('a')], [text('b')]],
        rows: [[[text('1')], [text('2')]]],
      },
    ])
  })

  it('pads short rows, drops extra cells and honours an escaped pipe', () => {
    const [table] = parseProse('| a | b |\n|---|---|\n| 1 |\n| x \\| y | 2 | 3 |')
    expect(table).toMatchObject({
      type: 'table',
      rows: [
        [[text('1')], []],
        [[text('x | y')], [text('2')]],
      ],
    })
  })

  it('is a paragraph when the delimiter row does not match the header', () => {
    expect(parseProse('| a | b |\n| --- |')[0]?.type).toBe('paragraph')
  })
})

describe('parseProse: blockquotes and rules', () => {
  it('parses a blockquote as nested blocks', () => {
    expect(parseProse('> quoted **text**\n> continues\n>\n> - item')).toEqual([
      {
        type: 'blockquote',
        children: [
          paragraph(
            text('quoted '),
            { type: 'strong', children: [text('text')] },
            text('\ncontinues'),
          ),
          { type: 'list', ordered: false, items: [{ children: [paragraph(text('item'))] }] },
        ],
      },
    ])
  })

  it('parses a thematic break', () => {
    expect(parseProse('a\n\n---\n\n* * *\n\nb')).toEqual([
      paragraph(text('a')),
      { type: 'rule' },
      { type: 'rule' },
      paragraph(text('b')),
    ])
  })
})
