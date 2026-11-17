---
'@narduk-enterprises/narduk-logging': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-logging: a new `./client-errors` entry point, the client half of
`./server-health`. A browser reports unhandled errors through
`createClientErrorReporter` (four fields: message, path, release, request id; no
stack, no contents, five a page load); the app's route validates them strictly
with `parseClientErrorReport` and keeps one deduplicated, scrubbed row per error
in its own D1 (`BROWSER_ERRORS_DDL`, `clientErrorEntry`, `recordClientError`,
`listClientErrors`). A native app posts the same shape. Moved from pacc-trac,
which runs it in production. No other entry point changes.
