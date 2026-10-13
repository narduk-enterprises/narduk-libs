/**
 * NeProse's public shapes (narduk-libs#1005): the props, and the small AST the
 * markdown-subset parser in `../utils/prose.ts` produces and the component
 * renders.
 *
 * Separate from the SFC for the same reason `ne-meter-types.ts` is: a consumer
 * that only wants the types — or the design kit, which mirrors these props —
 * should not have to import a component to get them. The AST is plain JSON
 * data, so a page can parse once, build a table of contents from it with
 * `proseOutline()`, and hand the same array to `blocks`.
 */

/** A table column's alignment, from its delimiter row. `null`: not set. */
export type NeProseAlign = 'center' | 'left' | 'right' | null

/** One inline run: text and the inline constructs the subset reads. */
export type NeProseInline =
  | { type: 'break' }
  | { type: 'code'; value: string }
  | { type: 'em'; children: NeProseInline[] }
  | { type: 'link'; children: NeProseInline[]; href: string }
  | { type: 'strong'; children: NeProseInline[] }
  | { type: 'text'; value: string }

/** A list item: its own blocks, so it can hold paragraphs, code and lists. */
export interface NeProseListItem {
  children: NeProseBlock[]
}

/** One block of the document. */
export type NeProseBlock =
  | { type: 'blockquote'; children: NeProseBlock[] }
  | { type: 'code'; lang: string | null; value: string }
  | {
      type: 'heading'
      children: NeProseInline[]
      /** Unique within the document; what a table of contents links to. */
      id: string
      /**
       * `#` is demoted to 2 (the page header owns the h1). `####` and deeper
       * clamp to 3, or to 4 when the document is parsed with `maxHeadingLevel: 4`.
       */
      level: 2 | 3 | 4
    }
  | { type: 'list'; items: NeProseListItem[]; ordered: false }
  | { type: 'list'; items: NeProseListItem[]; ordered: true; start: number }
  | { type: 'paragraph'; children: NeProseInline[] }
  | { type: 'rule' }
  | {
      type: 'table'
      /** One entry per column. */
      align: NeProseAlign[]
      /** One inline run list per header cell. */
      head: NeProseInline[][]
      /** Rows of cells, each padded or cut to the header's column count. */
      rows: NeProseInline[][][]
    }

/** One entry of a document's outline, for a table of contents. */
export interface NeProseHeading {
  id: string
  level: 2 | 3 | 4
  /** The heading's plain text, markup removed. */
  text: string
}

/**
 * What `parseProse()` (and `parseProseInline()`) can be asked. Every option
 * defaults to the parser's earlier behaviour.
 */
export interface ParseProseOptions {
  /**
   * Make heading ids exactly GitHub's slug: marks kept, and each whitespace
   * character one hyphen, so "a & b" is `a--b` and "x — y" is `x--y`, which
   * is what a document's own `#anchor` links were written against. Default
   * `false`: a run of whitespace collapses to one hyphen (`a-b`), the ids
   * earlier releases produced.
   */
  githubSlugs?: boolean
  /**
   * Put in front of every heading id (`sec-` makes `install` into
   * `sec-install`), so a document body can never collide with the page's own
   * ids. The document's own `#fragment` links are rewritten to match, using
   * GitHub's slug rule, so `[see](#a-b)` still lands. Default `''`: ids and
   * fragment links are left as written. Fragment links are slugged by the
   * same rule as the ids (`githubSlugs`).
   */
  headingIdPrefix?: string
  /**
   * An absolute URL a relative link (`docs/a.md`, `/root`, `../up`, `?query`)
   * resolves against, e.g. a skill directory's GitHub URL. A relative link
   * that does not resolve to `http(s)` renders as its text. `#fragment` links
   * are never resolved against it. Default: unset, relative links are kept as
   * written.
   */
  linkBase?: string
  /**
   * The deepest heading level. `3` (the default) clamps `####` and deeper to
   * h3; `4` keeps `####` as h4 and clamps `#####` and `######` to it.
   */
  maxHeadingLevel?: 3 | 4
}

/** What the `#table` slot of NeProse receives for each table in the document. */
export interface NeProseTableSlotProps {
  /** The table, as `parseProse()` produced it. */
  block: Extract<NeProseBlock, { type: 'table' }>
  /** Zero-based position among all the document's tables, in reading order. */
  index: number
  /**
   * The plain text of the nearest heading above the table, or `null` for a
   * table before any heading: what a caption can say it sits under.
   */
  heading: string | null
  /** One-based position of the table among those under the same heading. */
  ordinal: number
}

export interface NeProseProps extends ParseProseOptions {
  /**
   * A pre-parsed document, e.g. from `parseProse()` on the server or a kit
   * mapping. When set it wins over `source`, and the `ParseProseOptions` props
   * (which shape parsing) do nothing.
   */
  blocks?: NeProseBlock[]
  /**
   * Render an absolute `http(s)` link with `target="_blank"` and
   * `rel="noopener"`. Default `false`: every link renders the same way.
   */
  externalLinksNewTab?: boolean
  /** The markdown to render. Parsed with `parseProse()`. */
  source?: string
}
