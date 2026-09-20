---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

security.headers: let a first-party-only app opt out of the estate CSP baseline

`security.headers.baseline` selects which third-party origins an app inherits
before its own `allow` is applied. It defaults to `'estate'`, so no existing
app's policy changes.

`baseline: 'self'` inherits none of them: every directive is `'self'` plus
whatever the app names in `allow`. It exists because `allow` can only add, which
left an app reaching no third party unable to enforce the strict nonce policy
without widening its CSP — trading `script-src 'unsafe-inline'` for the eleven
`BASELINE_ALLOWLIST` origins, eight of them on `connect-src`.

The nonce, `'strict-dynamic'`, HSTS, `frame-ancestors`, `form-action`,
`object-src`, the report route and style-src's `'unsafe-inline'` are unchanged,
and the resulting policy is a strict subset of the `'estate'` one.

Closes #560.
