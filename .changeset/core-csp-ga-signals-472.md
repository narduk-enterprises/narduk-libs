---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Fix the estate CSP baseline refusing GA4's Google-signals beacon
(narduk-libs#472). A GA4 property with Google signals enabled sends a second
`page_view` beacon straight to `https://www.google.com/g/collect` (not a
`*.google-analytics.com` host), with an `<img>` fallback at the same origin
when `fetch`/`sendBeacon` is unavailable. Both the strict nonce-CSP baseline
(`runtime/shared/security-headers.ts` `BASELINE_ALLOWLIST`) and the legacy
enforcing middleware (`runtime/server/middleware/securityHeaders.ts`
`BASELINE_CONNECT_SRC`) now allow `https://www.google.com` on `connect-src`;
the legacy middleware's `img-src` already carries an `https:` wildcard that
covers the same host, so it needed no change. A property that runs with
Google signals off never sends this beacon and does not need the host.

create-narduk-app re-releases so its generated package pins follow the
narduk-core patch and its dependents.
