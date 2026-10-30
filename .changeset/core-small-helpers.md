---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core adds explicit-import helpers the fleet kept hand-rolling:

- `shared/utils/text`: `slugify`, `plural`, `pluralWord`, `ordinal`, `initials` and `escapeRegExp`.
- `shared/utils/numbers`: `clamp` and `median`.
- `shared/utils/zoned-date`: `zonedDateParts` and `zonedDateKey`, which compute local-day keys in a named zone.
- `app/media-query`: a hydration-safe `useMediaQuery`.
- `app/download`: `downloadFile`, which revokes the object URL on the next task.

None of them is auto-imported, so existing app copies keep working.
