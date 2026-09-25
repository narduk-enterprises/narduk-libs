---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk/no-raw-define-event-handler-in-mutation-routes` stops its "composed
inside an approved wrapper" exemption at a function boundary
(narduk-libs#886). `defineUserMutation(defineEventHandler(…))` is still the
wrapper's own composition, but a raw `defineEventHandler` declared inside the
wrapped route's callback is a new, unwrapped handler and is now reported.
`create-narduk-app` is a companion patch because it pins eslint-config.
