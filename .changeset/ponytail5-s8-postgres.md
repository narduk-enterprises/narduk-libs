---
'@narduk-enterprises/narduk-postgres': patch
---

`redactSecrets` now redacts the password of a DSN with an empty username. Node driver `options` escape whitespace and backslashes, so an application name can no longer add its own `-c` flag.
