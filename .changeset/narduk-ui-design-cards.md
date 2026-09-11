---
'@narduk-enterprises/narduk-ui': patch
---

Add an NE Base design card (`design-cards/<Name>.card.vue`) for every registered
status instrument (`NsFreshnessChip`, `NsLevelWell`, `NsRangeBar`,
`NsReadoutTile`), completing the suite bar's last requirement alongside the
existing README sections and mount/SSR tests.
`scripts/check-component-surface.mjs` now checks this package (components
backlog item 22, narduk-libs#269).
