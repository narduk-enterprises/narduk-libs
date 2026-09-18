---
'@narduk-enterprises/narduk-core': minor
---

Rate limiting and CSRF hardening.

- Rate-limit counters key an IPv6 caller by its `/64` instead of the full
  address, in `defineRateLimitedHandler` (window and Cloudflare binding) and in
  `enforceRateLimit` / `enforceRateLimitPolicy`. IPv4 keys are unchanged;
  `getClientIp` still returns the full address (#430).
- An `'ip-path'` route counts `/path/`, `/path?x=1` and a percent-encoded
  spelling in the same bucket as `/path` (#433).
- New `shared/rate-limit-namespace` helper (`rateLimitNamespaceId`,
  `rateLimitNamespacePrefix`, `RATE_LIMIT_SCAFFOLD_NAMESPACE_IDS`) and README
  guidance: Cloudflare `namespace_id` is account-unique, so the pasteable `1001`
  example is gone (#433).
- New `nardukCore.csrf.exemptPaths` option lets an app declare credential-free
  device routes CSRF-exempt (exact paths or `/prefix/*`); over-broad or
  ambiguous entries fail the build and are ignored at runtime (#239).
- The CSP report route exemption also accepts the trailing-slash and query
  spellings the router dispatches to it (#415).
