/**
 * Reviewed allowlist of registered component names that may land before their
 * NE Base card. This waiver is spent: the four parallel component lanes it
 * covered (#254 NeStatePanel, #255 NeStatusBadge, #256 NePageHeader +
 * NeSectionHeader, #263 NeConfirmDialog) all ship their card in the same
 * change now, in `src/design-cards/`. It stays empty going forward — a new
 * component ships its card in the same PR that registers it (see the
 * README's "Adding a component" section), not by adding a name here.
 *
 * Only the `card` rule was ever waived. README, mount and SSR still fail
 * closed. `scripts/check-component-surface.mjs` re-exports this list.
 */
export const PENDING_CARDS: readonly string[] = []
