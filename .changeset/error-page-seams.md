---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core: the estate error page (`./app/error-page`) gains seams so apps
wrap it instead of forking it (narduk-libs#976): `copy` (title and description
per status, with a `default`), `links`, `homeLabel`, `homeTo`, `retryLabel`,
`layout`, `ui` colour classes in place of hardcoded `text-primary`, an awaited
`onBeforeClear(error, action)` hook whose failures never block recovery, and an
`#actions` slot. The detail redaction outside `previewSafeMode`,
`noindex, nofollow`, and the request id cannot be overridden. With no new prop
set, the page renders as before. The export's type declaration covers every
new prop.
