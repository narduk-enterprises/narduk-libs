---
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add an opt-in local email/password setup and recovery pathway informed by the
reusable PACC TRAC and Harvest Tracker patterns: digest-only, email-bound,
single-use links; explicit redemption; safe local redirects; generic request
responses; and persistent lockout. This is additive to local auth, leaves the
Supabase pathway unchanged, and explicitly does not replace or bypass Cloudflare
Access as an app's outer gate.
