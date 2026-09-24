---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

`defineValidatedHandler` now accepts `authorize`, which runs after params and query pass and before the body is read, so an unauthenticated caller never pays for the payload or the body schema (narduk-libs#371). Mutation helpers map a `ZodError` onto the same `VALIDATION_FAILED` 400, so caller key names no longer land in `statusMessage`. `create-narduk-app` is a companion patch so the generator pin moves with core.
