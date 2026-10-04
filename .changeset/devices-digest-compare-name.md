---
'@narduk-enterprises/narduk-devices': patch
---

Rename the server auto-imports that collided with another module's, so `nuxt prepare` no longer prints `Duplicated imports "timingSafeEqualText"` (narduk-libs#1404). The async hash-then-compare helper is now `timingSafeEqualDigestText`; narduk-core keeps the synchronous `timingSafeEqualText`, whose callers could otherwise have been handed a `Promise` (always truthy) by the shadowing. `AUDIT_EVENTS_DEFAULT_LIMIT` and `AUDIT_EVENTS_MAX_LIMIT`, which narduk-tenancy also exports, become `DEVICES_AUDIT_EVENTS_DEFAULT_LIMIT` and `DEVICES_AUDIT_EVENTS_MAX_LIMIT`. A new `scripts/server-export-collisions.test.mjs` fails CI when two modules export the same server auto-import name.
