---
'@narduk-enterprises/journeys': patch
---

`WebJourneyContext` gains `see`, `hasControl`, `noControl`, `gone`, `fill` and
`attach`. `see` and `hasControl` wait for a visible match — a hidden DOM node
is not enough — and `see` matches exact text rather than a substring. Absence
is by accessible name and a `count()` poll, not `hasText` or
`waitFor({ state: 'detached' })` (narduk-libs#67).
