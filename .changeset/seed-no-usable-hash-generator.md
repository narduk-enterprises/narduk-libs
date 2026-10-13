---
'@narduk-enterprises/create-narduk-app': patch
---

Pairs with the `@narduk-enterprises/narduk-core` seed change (seed files no longer ship a usable password hash). A new test fails if any generated file carries a `salt:hash` string or binds `password_hash` to a value other than NULL.
