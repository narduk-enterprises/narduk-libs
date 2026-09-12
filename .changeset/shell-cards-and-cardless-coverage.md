---
'@narduk-enterprises/narduk-shell': minor
---

Ship the NE Base design cards for the five components registered ahead of their
card (`NePageHeader`, `NeSectionHeader`, `NeStatusBadge`, `NeConfirmDialog`,
`NeStatePanel`) — components backlog item 3 (narduk-libs#250), closing out the
parallel lanes that registered them (#254, #255, #256, #263). Each card
server-renders the real component with realistic props: `NeStatePanel`'s five
`state` readings, `NeStatusBadge`'s six tones, breadcrumbs and an action slot on
`NePageHeader`/`NeSectionHeader`, and `NeConfirmDialog`'s two calling shapes
(with a note that reka-ui's Teleport gating means no dialog markup renders
during SSR — documented, pre-existing component behavior, not a regression).

`PENDING_CARDS` — the reviewed allowlist that let those four lanes register a
component before its card shipped — is now empty. It stays empty going forward:
a new component ships its card in the same change that registers it (see the
narduk-shell README's "Adding a component" section).

Fixes the surface-check false pass this waiver left behind:
`design-system-build`'s `build.mts` computed `coverage.missing` (the manifest
field `check-package.mts` asserts is empty) without filtering through
`PENDING_CARDS`, unlike its own `shellCardPlan`, which already did. A component
waived onto the allowlist satisfied `shellCardPlan` while still tripping
`check-package.mts`'s assertion on `coverage.missing` — the exact crossed wire
that had the shared-suite integration CI red. `build.mts` now filters
`coverage.missing` through `PENDING_CARDS` the same way, keeping the
`NE_SHELL_COMPONENTS.length === 0` sentinel message intact for an empty
registry.
