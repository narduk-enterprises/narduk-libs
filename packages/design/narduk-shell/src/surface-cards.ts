/**
 * NE Base cards that preview an export subpath rather than a component.
 *
 * `src/registry.ts` is the authority on components, and the card machinery
 * pairs it with `src/design-cards/*.card.vue` in both directions: a registered
 * component with no card fails the design-system build, and so does a card
 * with no registered component. That second rule is the right one — a card NE
 * Base shows for something no app can import is worse than no card — but it
 * assumes every card previews a component.
 *
 * `./format` (components backlog item 5, narduk-libs#252) is the first export
 * this package ships that is not a component. It is worth a card for exactly
 * the reason the components have one: the card is where a designer or an app
 * author sees what the house date, money and unit formats actually look like,
 * without reading the source. So the pairing rule gains a second authority
 * rather than an exception — a card named here must exist, a card named
 * nowhere is still an error, and nothing is waived.
 *
 * `subject` is documentation, not machinery: it says what the card previews so
 * that a reader of this list does not have to open the card to find out.
 */
export type NeSurfaceCard = {
  /** Card file base name: `<name>.card.vue`, rendered at id `kebab-case(name)`. */
  readonly name: string
  /** What the card previews, for a human reading this list. */
  readonly subject: string
}

export const NE_SHELL_SURFACE_CARDS: readonly NeSurfaceCard[] = [
  { name: 'Formatters', subject: 'the ./format subpath' },
]
