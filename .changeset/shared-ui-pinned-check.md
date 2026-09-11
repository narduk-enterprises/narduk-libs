---
'@narduk-enterprises/narduk-app-tools': minor
---

Add `narduk-app foundation:check:shared-ui-pinned` (components-library-plan.md
§2 item 6, narduk-libs#253): item 8 `shared-ui-pinned` checks that a UI app (a
`nuxt.config.*` at a known path plus a pages/components directory) pins
`@narduk-enterprises/narduk-shell`, `@narduk-enterprises/narduk-ui`, and
`@narduk-enterprises/narduk-charts` exactly wherever they are already
dependencies. Presence is not required -- narduk-shell is not yet published, so
requiring it would fail every UI app for a package that cannot be installed.
This ships as its own command and JSON artefact, not as an eighth item inside
`foundation:check`'s seven-item artefact (company-hq's `check-web-foundation.py`
rejects item ids outside `1..7` as F3 ARTEFACT).
