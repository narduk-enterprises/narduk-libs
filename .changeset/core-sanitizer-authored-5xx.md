---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

The production error sanitizer no longer masks a 5xx the app authored on purpose (narduk-libs#1714).

`shouldSanitizeProductionError` now follows Nitro's own `isSensitive` rule: it sanitizes only an error flagged `unhandled` or `fatal`, so `createError({ statusCode: 503, message })` keeps its message, `statusMessage` and `data` in production while an unhandled `throw new Error(...)` (which h3 flags `unhandled: true`) is still scrubbed to "Server Error". Previously every status of 500 or more was scrubbed, so an authored refusal reached a REST client as "Server Error" and was diagnosable only through paths that format errors themselves.

Behaviour change for fleet apps: a `createError` with a 5xx status now shows its message to the client, so do not put an internal detail (a SQL error, a binding name) in the message of an error you throw on purpose. `previewSafeMode` and 4xx handling are unchanged.
