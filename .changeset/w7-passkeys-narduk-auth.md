---
'@narduk-enterprises/narduk-auth': minor
---

Add passkey (WebAuthn) sign-in and enrolment to the local auth backend
(narduk-libs#125, W7 A1–A4).

Passkeys sit **beside** email + password, never in place of it: password sign-in
is unchanged, so an unenrolled or lost authenticator is not a lockout
(narduk-libs#125 D2, "Passkeys beside email+password"). Passkeys are
local-backend only; the Supabase pathway is untouched.

Enable with `passkey` in `AUTH_LOCAL_PROVIDERS` plus `AUTH_WEBAUTHN_RP_ID` and
`AUTH_WEBAUTHN_ORIGIN` (optionally `AUTH_WEBAUTHN_RP_NAME` and
`AUTH_WEBAUTHN_CHALLENGE_TTL_SECONDS`). Anything missing or invalid fails
closed: the routes answer 501 with the specific reason and the login card does
not offer the button.

**Migration.** This release adds `drizzle/0003_webauthn_credentials.sql`, which
is **D1/SQLite only** — this module publishes no Postgres schema or migrations
for the auth bridge tables (narduk-libs#94). It is purely additive
(`CREATE TABLE IF NOT EXISTS` for `auth_webauthn_credentials` and
`auth_webauthn_challenges`, plus indexes; no change to any existing table), so
it is a no-op for an app that never enables passkeys. There is no
down-migration.

Verification uses `@simplewebauthn/server@13.3.3` and
`@simplewebauthn/browser@13.3.0`, **exact-pinned** (narduk-libs#125 D3). The v13
line is chosen deliberately over v14: v14.0.0 is three days old with an
hours-old patch, its only breaking change is raising the minimum Node LTS, and
v13 already carries the GHSA-6hxq-p678-4hr2 x5c trust-anchor fix.

Security properties, each pinned by a test: registration and management routes
require an existing session (`defineUserMutation`) so a consuming app that
treats `/api/auth/` as public at its own boundary still cannot be enrolled
anonymously; API-key principals are refused (403) so a leaked machine token
cannot become a persistent interactive login; challenges are stored hashed,
claimed exactly once before verification, and refused across ceremonies; user
verification is required and credentials are discoverable, so sign-in carries no
identifier, no `allowCredentials`, and one generic 401 for every failure; a
signature counter that does not strictly increase is refused and the new counter
is written conditionally on the one verified against; RP ID and origins never
come from the request host.

Also corrects the README's stale claim that the local email pathway is "a
complement to Cloudflare Access, not a replacement for it" — company-hq
`D-AUTH-2` (2026-09-03) records the estate decision to leave Cloudflare Access
for app-level narduk-auth.
