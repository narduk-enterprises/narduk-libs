---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

The production error sanitizer lets an authored 5xx through on an explicit
opt-in. `createError({ statusCode: 503, message, data: { expose: true } })` keeps
its message, statusMessage and data; `cause` and `stack` are still dropped. Every
other 5xx stays "Server Error" (SSR crashes and re-wrapped caught errors are
handled H3Errors, so nothing is inferred from `unhandled` or `fatal`).
