---
'@narduk-enterprises/narduk-auth': patch
---

Backfill the registered Auth* cards (`AuthLoginCard`, `AuthRegisterCard`,
`AuthExchangePanel`, `AuthPasskeysPanel`, `AuthApiKeysPanel`) to the shared
component suite bar: README props, slots, events and example for each, plus
mount and `renderToString` SSR tests. Existing source-regex guardrails stay. NE
Base cards wait for #250.
