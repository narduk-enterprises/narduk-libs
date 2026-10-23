---
'@narduk-enterprises/narduk-app': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `@narduk-enterprises/narduk-app/server/security-headers`: `buildSecurityHeaders()` and `applySecurityHeaders()` give any h3/Nitro app the baseline response headers (nosniff, frame options, referrer policy, HSTS on https, optional Permissions-Policy and `X-Robots-Tag`) and an app-allowlisted Content-Security-Policy served only as report-only.

The generator's pinned `narduk-auth` moves with its `narduk-app` dependency.
