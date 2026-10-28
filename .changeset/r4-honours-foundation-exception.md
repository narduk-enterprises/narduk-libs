---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Adoption R4 honours a recorded portal `foundation_exception` row. A failing foundation item that an unexpired row names (explicit per item; `expires_on` is the last covered day on the report's own clock; a row scoped to other repos covers nothing) is no longer counted against R4, which says which decision and issue cover it. The item's own status stays `fail`, `unknown` is never covered, and item 7 stays not-applicable. The row is read from the portal with `OPERATOR_PORTAL_FOUNDATION_EXCEPTION_TOKEN`; with no credential, an error, a malformed or ambiguous row, R4 behaves exactly as before. Never read from the checkout.
