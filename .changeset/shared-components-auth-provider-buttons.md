---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-app-tools': patch
---

Add narduk-auth's AuthProviderButtons to the shared component list so the
shadow rule and foundation:check:no-local-copy know it, and the drift test
matches narduk-auth's real components again.
