---
'@narduk-enterprises/narduk-auth': minor
---

Add a storage-agnostic passkey (WebAuthn) ceremony module at `@narduk-enterprises/narduk-auth/server/lib/app-auth/webauthn-ceremony`. `beginPasskeyRegistration`, `finishPasskeyRegistration`, `beginPasskeyAuthentication`, `finishPasskeyAuthentication`, `listPasskeys` and `removePasskey` take an injected `PasskeyStore` (credential and challenge persistence), a `ResolvedWebauthnConfig`, a `WebauthnServer` from `loadWebauthnServer`, and an optional logger, so an app with its own tables can run the same verified ceremonies without the Nuxt layer. Additive: the existing `webauthn-core` routes are unchanged.
