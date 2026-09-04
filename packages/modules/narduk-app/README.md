# @narduk-enterprises/narduk-app

Small runtime helpers for Narduk Cloudflare/Nuxt apps.

This package owns app-runtime compatibility code that should not be repeated in
individual apps or feature packages.

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
