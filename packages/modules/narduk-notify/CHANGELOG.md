# @narduk-enterprises/narduk-notify

## 0.2.0

### Minor Changes

- ad0e581: Add Web Push: `sendWebPush` with VAPID (RFC 8292) authentication and
  `aes128gcm` payload encryption (RFC 8291), `encryptWebPushPayload`,
  `createVapidAuthorization`, `generateVapidKeys`, and an SSRF endpoint
  allowlist (`DEFAULT_WEB_PUSH_HOSTS`, `isAllowedPushEndpoint`). Web Crypto
  only, no new dependencies; verified against the RFC 8291 Appendix A vector.

## 0.1.0

### Minor Changes

- 922e148: Add `@narduk-enterprises/narduk-notify`: APNs token-auth delivery
  (alert, background and Live Activity push types) with an ES256 provider-token
  cache and a Node HTTP/2 transport, email through Resend, per-user notification
  preferences, and a delivery audit log on D1. The `.p8` key is taken from a
  secret binding by name; file paths are refused.
