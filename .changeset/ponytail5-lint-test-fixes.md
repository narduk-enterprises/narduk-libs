---
'@narduk-enterprises/journeys': patch
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-testkit': patch
---

Journeys verify refuses shot/video paths outside the attempt directory, a promote run id that is not the attempt directory name, fused step ids and all-skipped scenarios, digests no longer collide on `;+`, `must()` matches names exactly, and typed text stays one argv element. eslint-config's CSRF and Worker-runtime rules no longer go quiet on a read-method fall-through route, a `logCsrf*` callee, or a served `fixtures/` or `.test.` route. narduk-testkit's fake D1 counts CTE-led writes and rejects multi-statement `prepare()`.
