---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Batch remote D1 migration introspection into ordered multi-statement read commands, avoiding one Wrangler startup per PRAGMA or ledger read while preserving drift checks and migration lock and write behavior.
