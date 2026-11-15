---
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth: native apps can sign in with a passkey or Sign in with Apple and
get native tokens directly, without the `/auth/native` browser page.
`POST /api/auth/native/passkey` (`{ clientId, response }`, a challenge from
`POST /api/auth/passkeys/authentication/options`) and
`POST /api/auth/native/apple`
(`{ clientId, identityToken, nonce, displayName? }`, a single-use nonce from
`POST /api/auth/native/apple/nonce`) verify the credential as the cookie
sign-ins do and answer like `POST /api/auth/native/token`. An Apple-only account
with no password is accepted on the Apple route. New exports:
`verifyPasskeyAssertion`, `resolveAppleIdentityUser`,
`verifyNativeAppleIdentity`, and `createNativeAuth(...).issueSession`.
