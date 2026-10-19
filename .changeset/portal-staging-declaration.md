---
"@narduk-enterprises/narduk-app-tools": patch
"@narduk-enterprises/create-narduk-app": patch
---

Resolve the required staging deployment declaration through the shared app-config resolver, including portal-only checkouts. Preserve staging authority checks and return invalid-config before Worker I/O when the selected declaration is unreadable.
