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
      /** `#` is demoted to 2 (the page header owns the h1); `####` and deeper clamp to 3. */
      level: 2 | 3
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
  level: 2 | 3
  /** The heading's plain text, markup removed. */
  text: string
}

export interface NeProseProps {
  /**
   * A pre-parsed document, e.g. from `parseProse()` on the server or a kit
   * mapping. When set it wins over `source`.
   */
  blocks?: NeProseBlock[]
  /** The markdown to render. Parsed with `parseProse()`. */
  source?: string
}
