/**
 * NeSkipLink's public shapes and the page's main-content id (narduk-libs#977).
 *
 * Separate from the SFC for the same reason `ne-search-input-types.ts` is: a
 * layout that only wants the id, or a consumer that only wants the prop type,
 * should not have to import a component to get it. Plain module, so
 * re-exporting `NE_MAIN_ID` from the root barrel puts neither an SFC nor
 * `@nuxt/ui` in its value-import graph.
 */

/**
 * The id of the page's main content, and `NeSkipLink`'s default target. Put it
 * on the element the link should land on — `<main :id="NE_MAIN_ID">` — so the
 * link and its target cannot drift apart as two hand-typed strings.
 */
export const NE_MAIN_ID = 'main-content'

export interface NeSkipLinkProps {
  /**
   * The id (no `#`) of the element to move focus to. Defaults to
   * `NE_MAIN_ID`. The element needs no `tabindex` of its own: the link adds
   * `tabindex="-1"` when it has none, and keeps one it already has.
   */
  target?: string
  /** The link's text. */
  label?: string
}
