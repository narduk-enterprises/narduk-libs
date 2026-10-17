/**
 * What an agent or a bot wrote, as NeProse blocks (`NeMessageProse`): the
 * parser, the AST and the rendering are `parseProse`'s and NeProse's; the rules
 * here are a message's.
 *
 * - A heading is not a heading in a message. It becomes a bold paragraph, so
 *   no message draws a type step above bold weight and no id is minted (a
 *   stream holds many messages, and two `## Plan` headings would otherwise
 *   share one).
 * - Only an `https:` link stays a link. A `#fragment` link points at a heading
 *   of a document that is not on this page, a relative link resolves against
 *   nothing, and `http:`, `mailto:` and `javascript:` are not what a message
 *   may open: each renders as its text.
 * - A list whose line breaks a producer flattened ("Still open: - **A:** … -
 *   **B:** …", "1. … 2. …") gets them back, so it renders as a list and not as
 *   one paragraph with its markers showing. Only text with no line break at
 *   all, and at least two markers each after a sentence end or a colon, is
 *   touched: a lone " - " in prose stays a dash.
 * - Nothing throws. A marker a producer cut off (a dangling `**` or backtick)
 *   is text the parser has no rule for, so it stays visible text.
 *
 * Framework-free like `prose.ts`: no Vue, no DOM.
 */
import { parseInline, parseProse, prosePlainText } from './prose'

import type { NeProseBlock, NeProseInline } from '../components/ne-prose-types'

/** A base no relative link resolves against. */
const NO_LINK_BASE = 'urn:message-prose:none'

/** Whether a link a message carries stays a link: an absolute `https:` URL. */
export function isMessageHref(href: string): boolean {
  return /^https:\/\/[^/?#\s]/i.test(href)
}

/** The runs with each adjacent pair of text runs made one, as the parser leaves them. */
function mergeText(runs: readonly NeProseInline[]): NeProseInline[] {
  const out: NeProseInline[] = []
  for (const run of runs) {
    const last = out.at(-1)
    if (run.type === 'text' && last?.type === 'text')
      out[out.length - 1] = { type: 'text', value: last.value + run.value }
    else out.push(run)
  }
  return out
}

/** Keeps `https:` links only, and never a link inside a link (an anchor in an anchor is invalid HTML). */
function onlyHttpsLinks(runs: readonly NeProseInline[], inLink = false): NeProseInline[] {
  return mergeText(
    runs.flatMap((run): NeProseInline[] => {
      if (run.type === 'link') {
        const keep = !inLink && isMessageHref(run.href)
        const children = onlyHttpsLinks(run.children, inLink || keep)
        return keep ? [{ ...run, children }] : children
      }
      if (run.type === 'strong' || run.type === 'em') {
        return [{ ...run, children: onlyHttpsLinks(run.children, inLink) }]
      }
      return [run]
    }),
  )
}

function messageBlock(block: NeProseBlock): NeProseBlock {
  switch (block.type) {
    case 'heading': {
      return {
        type: 'paragraph',
        children: [{ type: 'strong', children: onlyHttpsLinks(block.children) }],
      }
    }
    case 'paragraph': {
      return { ...block, children: onlyHttpsLinks(block.children) }
    }
    case 'list': {
      return {
        ...block,
        items: block.items.map((item) => ({
          children: item.children.map((child) => messageBlock(child)),
        })),
      }
    }
    case 'blockquote': {
      return { ...block, children: block.children.map((child) => messageBlock(child)) }
    }
    case 'table': {
      return {
        ...block,
        head: block.head.map((cell) => onlyHttpsLinks(cell)),
        rows: block.rows.map((row) => row.map((cell) => onlyHttpsLinks(cell))),
      }
    }
    case 'code':
    case 'rule': {
      return block
    }
  }
}

// A marker follows a sentence end or a colon, which may be closed by `)`, a backtick or `*` ("done.)", "`x`.", "**Next:**"). A bare
// closer is not enough: "**Plan** - Foo" and "`a` - Foo" are a label and its text, not two list items.
const FLAT_BULLET = /(?<=[.:!?][)`*]*)\s+-\s+(?=\*\*|[A-Z`[])/g
const FLAT_NUMBER = /(?<=[.:!?][)`*]*)\s+(\d{1,2})\.\s+(?=\*\*|[A-Z`[])/g

/** Restores the line breaks of a list a producer flattened into one line; any other text comes back unchanged. */
export function unflattenLists(text: string): string {
  if (/[\n\r]/.test(text)) return text
  let out = text
  if ((out.match(FLAT_BULLET) ?? []).length >= 2) out = out.replaceAll(FLAT_BULLET, '\n- ')
  const numbers = [...out.matchAll(FLAT_NUMBER)].map((match) => Number(match[1]))
  // Numbers that count up (1. 2. 3.) or all repeat one number (markdown's "1. 1. 1." style) are a list; any other run of numbers is prose.
  const counting = numbers.every((n, i) => i === 0 || n === numbers[i - 1]! + 1)
  const repeating = numbers.every((n) => n === numbers[0])
  if (numbers.length >= 2 && (counting || repeating)) out = out.replaceAll(FLAT_NUMBER, '\n$1. ')
  // A list opens after a blank line, so the sentence before it stays a paragraph of its own.
  return out.replace(/\n(- |\d{1,2}\. )/, '\n\n$1')
}

/**
 * Past these, a message is shown as the text it is, not parsed: a nesting NeProse's render would overflow the stack on (2000 `>` is a
 * 500 on the server), and a length the parser's worst case takes seconds on. No message a person or an agent writes comes near either.
 */
const MAX_DEPTH = 32
const MAX_BLOCK_LENGTH = 50_000
const MAX_INLINE_LENGTH = 10_000

function runsDeeperThan(runs: readonly NeProseInline[], limit: number): boolean {
  if (limit < 0) return true
  return runs.some((run) => 'children' in run && runsDeeperThan(run.children, limit - 1))
}

function blocksDeeperThan(blocks: readonly NeProseBlock[], limit: number): boolean {
  if (limit < 0) return true
  return blocks.some((block) => {
    switch (block.type) {
      case 'paragraph':
      case 'heading': {
        return runsDeeperThan(block.children, limit - 1)
      }
      case 'list': {
        return block.items.some((item) => blocksDeeperThan(item.children, limit - 1))
      }
      case 'blockquote': {
        return blocksDeeperThan(block.children, limit - 1)
      }
      case 'table': {
        return [...block.head, ...block.rows.flat()].some((cell) => runsDeeperThan(cell, limit - 1))
      }
      case 'code':
      case 'rule': {
        return false
      }
    }
  })
}

/** What `messageProseBlocks()` can be asked. */
export interface MessageProseOptions {
  /** Restore a flattened list's line breaks (`unflattenLists`). Default `true`; `false` for text known to keep its own. */
  unflatten?: boolean
}

/** A message as blocks. Never throws: text the parser has no rule for is a paragraph of text. */
export function messageProseBlocks(
  text: string | null | undefined,
  options: MessageProseOptions = {},
): NeProseBlock[] {
  const source = String(text ?? '')
  try {
    if (source.length > MAX_BLOCK_LENGTH) throw new RangeError('message too long to parse')
    const markdown = options.unflatten === false ? source : unflattenLists(source)
    const blocks = parseProse(markdown, { linkBase: NO_LINK_BASE }).map((block) =>
      messageBlock(block),
    )
    if (blocksDeeperThan(blocks, MAX_DEPTH))
      throw new RangeError('message nests too deep to render')
    return blocks
  } catch {
    return source.trim() === ''
      ? []
      : [{ type: 'paragraph', children: [{ type: 'text', value: source }] }]
  }
}

/**
 * One line of a message as inline runs: bold, em, code and `https:` links. A
 * line break is a space, and no block element is ever produced. Never throws.
 */
export function messageProseInline(text: string | null | undefined): NeProseInline[] {
  const source = String(text ?? '')
  try {
    if (source.length > MAX_INLINE_LENGTH) throw new RangeError('message too long to parse')
    const runs = squashWhitespace(onlyHttpsLinks(parseInline(source, { linkBase: NO_LINK_BASE })))
    if (runsDeeperThan(runs, MAX_DEPTH)) throw new RangeError('message nests too deep to render')
    return runs
  } catch {
    return source === '' ? [] : [{ type: 'text', value: source.replaceAll(/\s+/g, ' ') }]
  }
}

/** A break is a space, and every run of whitespace is one space: joined first, so a space at a seam is not doubled. */
function squashWhitespace(runs: readonly NeProseInline[]): NeProseInline[] {
  const joined = mergeText(
    runs.map((run): NeProseInline => (run.type === 'break' ? { type: 'text', value: ' ' } : run)),
  )
  return joined.map((run): NeProseInline => {
    if (run.type === 'text') return { type: 'text', value: run.value.replaceAll(/\s+/g, ' ') }
    if (run.type === 'code') return { type: 'code', value: run.value.replaceAll(/\s+/g, ' ') }
    if (run.type === 'break') return run
    return { ...run, children: squashWhitespace(run.children) }
  })
}

/** The plain words of `messageProseInline(text)`: markers removed, one line. What a `title` reads. */
export function messageProseText(text: string | null | undefined): string {
  return prosePlainText(messageProseInline(text)).trim()
}
