---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

Record local auth throttling and Sign in with Apple web-callback refusals through narduk-core's
request logger. Each failed local email/password attempt writes an `info` record, a lockout that
begins writes a `warn` with the failure count and lock length, and a request refused while locked
writes a `warn` with the `Retry-After` it sent; records name the attempt kind and never the email
address, link token, client IP or attempt key. The Apple web callback records a refusal with its
fixed code (`apple_state_mismatch`, `apple_token_missing`) or token-verification reason
(`nonce_mismatch`, `wrong_audience`, ...) and a user cancel at `info`, never the identity token or
its claims. Responses are unchanged.
