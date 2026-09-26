---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth (#1060):

- `resolveRequestPrincipal(event, { allowNative: true })` no longer throws 404
  or 503 on an app without native sign-in (no native clients, or not the local
  backend). A request carrying a bearer that is not an `nk_` key now resolves
  the session, or `null`, as the README says.
- Starting a passkey ceremony answers the fixed 503 and logs the cause when
  `@simplewebauthn/server` throws while generating options, not only when it
  fails to load. Before, the caller got an opaque 500.
- The `clientDataJSON` decoder is strict base64url. Whitespace, standard
  base64's `+` and `/`, a lone trailing character and surplus padding are
  refused. Both decoders already failed closed, and tests now pin this one.
- Tests cover the 503 on both finish ceremonies and on a failed
  `@simplewebauthn/server/helpers` load.
