# @narduk-enterprises/narduk-app

Small runtime helpers for Narduk Cloudflare/Nuxt apps.

This package owns app-runtime compatibility code that should not be repeated in
individual apps or feature packages.

## Exports

- `@narduk-enterprises/narduk-app/server/http` - structural request, response,
  and cookie helpers that tolerate H3/Nitro runtime shape differences.
