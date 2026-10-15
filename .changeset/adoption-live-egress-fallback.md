---
'@narduk-enterprises/narduk-app-tools': patch
---

`narduk-app doctor --adoption --live` now sends its build-version, security-header and health probes through the same Cloudflare challenge fallback as `verify --live`: a `403` with `cf-mitigated: challenge` is retried once through `NARDUK_APP_EGRESS_PROXY`, and fails closed without one. The report records `egress: direct|residential` in its JSON and text, and a check whose only answer was a challenge page is UNKNOWN rather than FAIL or PASS (#1887).
