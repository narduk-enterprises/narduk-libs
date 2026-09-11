/**
 * Reviewed allowlist of registered component names that may land before their
 * NE Base card. The four parallel component lanes (#254 NeStatePanel,
 * #255 NeStatusBadge, #256 NePageHeader + NeSectionHeader, #263 NeConfirmDialog)
 * were written against a follow-up card PR. Empty this array in that follow-up.
 *
 * Only the `card` rule is waived. README, mount and SSR still fail closed.
 * Unused names — listed here before the component is registered — are ignored.
 * `scripts/check-component-surface.mjs` re-exports this list.
 */
export const PENDING_CARDS: readonly string[] = [
  'NeStatePanel',
  'NeStatusBadge',
  'NePageHeader',
  'NeSectionHeader',
  'NeConfirmDialog',
]
