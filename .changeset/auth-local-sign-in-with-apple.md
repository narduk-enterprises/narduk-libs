---
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth: Sign in with Apple on the local D1 backend (narduk-libs#164,
library side). New `GET /api/auth/apple/start` and `POST /api/callbacks/auth/apple`
run Apple's web flow (`form_post`, state cookie, SHA-256 nonce) and verify the
identity token natively against Apple's JWKS (`iss`, `aud`, `exp`, nonce), with
no hosted auth and no client-secret JWT. `startOAuthFlow` and
`signInWithNativeApple` no longer 501 on the local backend when
`AUTH_APPLE_SERVICES_ID` / `AUTH_APPLE_NATIVE_CLIENT_IDS` are set, and
`users.apple_id` is populated. `/api/auth/runtime-public` reports `appleEnabled`,
which the login and register cards use instead of requiring the Supabase backend.
An existing account links to an Apple ID only when the app has proven its email.
