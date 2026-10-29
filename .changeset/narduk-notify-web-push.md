---
'@narduk-enterprises/narduk-notify': minor
---

Add Web Push: `sendWebPush` with VAPID (RFC 8292) authentication and `aes128gcm`
payload encryption (RFC 8291), `encryptWebPushPayload`,
`createVapidAuthorization`, `generateVapidKeys`, and an SSRF endpoint allowlist
(`DEFAULT_WEB_PUSH_HOSTS`, `isAllowedPushEndpoint`). Web Crypto only, no new
dependencies; verified against the RFC 8291 Appendix A vector.
