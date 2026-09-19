---
'@narduk-enterprises/narduk-testkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

`createConsoleTracker` accepts URL-scoped ignore rules
(`{ text: RegExp; url?: RegExp }`) and records 4xx/5xx response URLs so an
object rule's optional `url` matches the request that actually failed. Bare
`RegExp[]` call sites stay unchanged (narduk-libs#134). `create-narduk-app` is a
companion patch so the generator pin moves with the testkit release.
