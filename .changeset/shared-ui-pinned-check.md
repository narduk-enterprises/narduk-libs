---
'@narduk-enterprises/narduk-app-tools': minor
---

Add `narduk-app foundation:check:shared-ui-pinned` (components-library-plan.md
§2 item 6, narduk-libs#253): item 8 `shared-ui-pinned` requires a UI app to
depend on `@narduk-enterprises/narduk-shell`, `narduk-ui`, and `narduk-charts`
as exact pins once each package is published. Presence is registry-gated
(`RegistryReality.publicationOf`): unpublished → `not-applicable`; registry
unreadable → `unknown`; published and absent → `fail`. narduk-shell is not yet
published, so it is `not-applicable` today; narduk-ui and narduk-charts are
published, so a UI app without them fails. Ships as its own command and JSON
artefact, not as an eighth item inside `foundation:check`'s seven-item artefact
(company-hq's `check-web-foundation.py` rejects item ids outside `1..7` as F3
ARTEFACT).
