---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Persist sealed user-session cookies for 30 days by default so mobile browsers do
not discard authentication when the browser is backgrounded or reclaimed.
Callers can still provide a shorter or longer `maxAge` override.
