---
'@narduk-enterprises/narduk-app-tools': minor
---

Add `narduk-app foundation:check:shared-ui-pinned` (components-library-plan.md
§2 item 6, narduk-libs#253): checks that a UI app (a `nuxt` dependency or a
`nuxt.config.*` file) pins `@narduk-enterprises/narduk-shell`,
`@narduk-enterprises/narduk-ui`, and `@narduk-enterprises/narduk-charts` exactly
wherever it depends on them, so a fleet-wide bump lands as one Dependabot PR per
app instead of drifting one package at a time. narduk-shell's presence
requirement is gated on a live registry read (`unknown`, never a guessed `fail`,
until narduk-shell is actually published); narduk-ui and narduk-charts presence
is never required, only their pin when present. This ships as its OWN command
and JSON artefact (`foundation:check:shared-ui-pinned`,
`tool: '@narduk-enterprises/narduk-app-tools/shared-ui-pinned'`), not as an
eighth item folded into `foundation:check`'s seven-item artefact: that artefact
is the exact contract company-hq's `check-web-foundation.py` mirrors and
validates for the weekly fleet rollup (`FOUNDATION_ITEM_COUNT` is fixed at 7,
and item ids outside `1..7` are a rollup-red `F3 ARTEFACT` finding), so widening
it here would break every other app's rollup on upgrade. See the README's
"Shared UI pinned" section for the full rule table and the deviation record.
