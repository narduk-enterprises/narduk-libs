---
'@narduk-enterprises/narduk-shell': minor
---

Ship the component surface check and the design-card mechanism
(components-library backlog item 3, narduk-libs#250; backlog narduk-libs#247).

The plan's standard done-when says every component in the suite arrives with a
README section, a mount test, an SSR test and an NE Base card. Nothing enforced
any of the four, and the card lived in a different package from the component.
Both change here:

- `scripts/check-component-surface.mjs` (wired into the repository's
  `quality:artifacts` gate as `surface:check`) reads the real surface — every
  `NE_SHELL_COMPONENTS` entry and every named export of `./format`, by importing
  the TypeScript rather than parsing it — and requires the evidence for each
  name. A miss prints one line per rule with the exact fix and exits 1. Scoped
  to this package; the existing design packages join in backlog item 22.
- A design card now ships **beside its component**, as
  `src/design-cards/<Name>.card.vue` with `data-design-card="<kebab-name>"`.
  `src/design-cards/template/NeExample.card.vue` is the documented file a
  component item copies, and `test/design-cards.test.ts` server-renders every
  card and asserts that each registered component has one and each card a
  registered component. The private `design-system-build` renderer discovers and
  renders them instead of carrying a hand-written section per component; its
  output shape, and therefore `/design-sync`, is unchanged, and its existing
  hand-authored narduk-ui and Nuxt UI cards keep working until item 22 migrates
  them.

Two new README sections, "Component surface check" and "Shipping a design card",
document the rules and the recipe. `PENDING_CARDS` in the check script is a
reviewed allowlist that waives only the card rule for the four parallel
component lanes (#254, #255, #256, #263) so they can land before the follow-up
card PR empties the list. No component, registry entry or runtime behaviour
changes: the registry is still empty, and the check passes over it.
