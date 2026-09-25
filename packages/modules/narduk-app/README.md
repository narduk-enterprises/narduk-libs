# @narduk-enterprises/narduk-app

Small runtime helpers for Narduk Cloudflare/Nuxt apps.

This package owns app-runtime compatibility code that should not be repeated in
individual apps or feature packages.

## Scope

narduk-app is a standalone package. It will not be folded into narduk-core or
narduk-auth. That fold was planned on 2026-09-04, when the package looked
unused, and was dropped on 2026-09-25 (#1032).

It owns the small wire-level helpers that every app route and client needs no
matter which feature packages the app uses:

- structural request, response and cookie handling
- `apiError()` refusals
- body and query readers
- the client reader for those refusals

Feature behavior belongs in the feature package, and layer and runtime wiring
belongs in narduk-core.

## Exports

- `@narduk-enterprises/narduk-app/server/http` - structural request, response,
  and cookie helpers that tolerate H3/Nitro runtime shape differences.
- `@narduk-enterprises/narduk-app/server/errors` - `apiError()` /
  `reasonPhrase()`, so a refusal's copy survives the wire in `message` (never
  `statusMessage`, which h3 sanitizes and HTTP/2 does not carry to the browser
  at all).
- `@narduk-enterprises/narduk-app/server/request-body` - `readJsonBody()` /
  `readQuery()` / `readRawJsonBody()`, so a Zod-validated route treats an absent
  body as an empty one and refuses with a sentence (an app's own copy for a
  refusal, `RequestBodyRefusals`, is a required argument) rather than a raw Zod
  issue-array dump.
- `@narduk-enterprises/narduk-app/client/api-error` - `apiErrorMessage()` /
  `apiErrorCode()` / `apiErrorStatus()` / `describeApiError()`, the client-side
  reader for a caught `$fetch` rejection carrying an error built with
  `apiError()`.
