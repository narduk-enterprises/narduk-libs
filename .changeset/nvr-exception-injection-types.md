---
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

Type both exception-reporting injections against their common structural client
contract. This keeps consumer Nuxt typechecks working when dynamically provided
analytics injections are inferred as unknown, without changing transport priority
or delayed-client behavior.
