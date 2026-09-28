---
"@narduk-enterprises/narduk-shell": minor
---

`NeStatusBadge` gains an `unreported` tone: neutral colour, the
`--ne-hatch-soft` material over `--ne-surface` (the same material
`NeKpiTile`'s `ne-kpi-tile__value--unreported` paints), no default icon, and
an optional `label` that defaults to `NE_UNREPORTED_TEXT` ("Not reported")
when left empty (narduk-libs#602's unreported treatment, extended to the
badge). `NeStatusTone` and `defineStatusMap` accept the new tone; every
existing tone is unchanged.
