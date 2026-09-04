---
'@narduk-enterprises/narduk-auth': minor
---

Consolidate the package's four divergent same-origin redirect guards onto one
hardened implementation, `sanitizeSameOriginPath` in
`shared/utils/same-origin-path.ts`.

`app/utils/safeRedirectPath.ts`, `server/lib/app-auth/helpers.ts`,
`server/lib/app-auth/local-email-core.ts` and
`server/api/auth/session/exchange.get.ts` each carried their own copy of the "is
this a safe same-origin path?" check, and they did not agree. Only the
client-side copy rejected a bare (non-`/`-prefixed) value or a percent-encoded
backslash, so the advisory client check was strictly stricter than the
authoritative server checks it was meant to mirror — the weaker check sat on the
trust boundary that matters.

The consolidated guard takes the strictest rule any copy had, so the accepted
set can only narrow:

- a value that does not start with `/` is rejected rather than coerced into a
  path (`next=example.com` no longer becomes `/example.com`);
- a percent-encoded backslash (`%5c`, any case) is rejected on the server as it
  already was on the client;
- protocol-relative (`//host`), literal-backslash, and raw-control-character
  values are rejected by explicit checks rather than only as a side effect of
  URL normalization;
- malformed percent-encoding (`/%zz`, `/ok%`, `/a%2`) is rejected everywhere, as
  only the local-email copy did (as a side effect of decoding);
- a non-string value is rejected rather than coerced.

`sanitizeLocalRedirectPath`, `sanitizeNextPath` and `sanitizeLocalEmailRedirect`
keep their names and signatures and now delegate to the shared guard, so no
importer has to change.

The auth-callback failure branch in `server/api/auth/session/exchange.get.ts`
now also runs the caller-supplied `next` through the guard before re-emitting it
on the error redirect, instead of passing it through verbatim.
