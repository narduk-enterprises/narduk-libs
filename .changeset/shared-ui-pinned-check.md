---
'@narduk-enterprises/narduk-app-tools': minor
---

Add `narduk-app foundation:check:shared-ui-pinned` (components-library-plan.md
§2 item 6, narduk-libs#253): item 8 `shared-ui-pinned` requires that wherever a
UI app depends on `@narduk-enterprises/narduk-shell`, `narduk-ui`, or
`narduk-charts`, the pin is an exact version — no range, no `workspace:`
specifier. A shared-UI package the app does not depend on is `not-applicable`,
and an API-only app (no `nuxt.config.*` and no pages/components directory at a
known monorepo path) is `not-applicable` in full. Ships as its own command and
JSON artefact, not as an eighth item inside `foundation:check`'s seven-item
artefact (company-hq's `check-web-foundation.py` rejects item ids outside `1..7`
as F3 ARTEFACT).
