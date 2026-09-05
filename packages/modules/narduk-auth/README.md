# @narduk-enterprises/narduk-auth

Auth, user session, protected-route capabilities, and self-service API token
management for Narduk Nuxt applications.

First-class layer package source in this workspace.

This layer now includes:

- User-session auth flows and protected auth pages
- Supabase-backed authentication where an app selects `AUTH_BACKEND=supabase`
- An additive local email/password setup and recovery pathway where an app
  selects `AUTH_BACKEND=local`
- API routes for personal API token create/list/revoke
- Shared settings UI for users to mint and revoke their own tokens

Server code imports core-owned user, session, notification, and API-key tables
through the private `#narduk-core/schema` alias registered by the core module.
Apps continue to use their app-owned `#narduk-db` alias for combined schemas.

## Migrations

Apply every SQL file in `drizzle/` to the app database, in order:

1. `drizzle/0001_auth_bridge.sql`
2. `drizzle/0002_local_email_auth.sql`
3. `drizzle/0003_webauthn_credentials.sql`

As of 1.20.0, `0002_local_email_auth.sql` is **required for the default local
backend**, not just the optional email-link feature: every local email/password
login reads and writes the `auth_local_email_attempts` lockout table it creates.
Upgrading a local-backend app past 1.19.x without applying it breaks every login
with an HTTP 500 that names the missing table. Sequence the migration with the
version bump so it runs on deploy before traffic.

`0003_webauthn_credentials.sql` is required only by apps that enable the
`passkey` provider (see [Passkeys](#passkeys)). It is purely additive —
`CREATE TABLE IF NOT EXISTS` plus indexes, no changes to existing tables — so
applying it on an app that never enables passkeys is a no-op. There is no
down-migration; reverting means dropping `auth_webauthn_credentials` and
`auth_webauthn_challenges` by hand, which destroys every enrolled passkey.

The shipped migrations use the D1/SQLite dialect only. This module does not
publish a Postgres schema or migrations for the auth bridge tables
(narduk-libs#94) — it is D1-only.

## Additive local email pathway

The local email pathway establishes an application session, identifies the
signed-in email, and supports password setup or recovery. It can run **behind**
an edge gate such as Cloudflare Access, or — as of company-hq `D-AUTH-2`
(2026-09-03) — **instead of one**: that entry records the estate decision to
leave Cloudflare Access for app-level narduk-auth, starting with the Operator
Portal (`AUTH_BACKEND=local`, an `AUTH_EMAIL_ALLOWLIST` of exactly one address,
direct cutover once staging is proven). Earlier releases of this README asserted
that the pathway was "a complement to Cloudflare Access, not a replacement for
it"; that is no longer the estate's position, and the sentence is corrected here
rather than left to contradict the decision record.

What has not changed is this module's blast radius.

This module does not create, remove, weaken, bypass, or reconfigure any
Cloudflare Access application or policy, and it does not change the existing
Supabase pathway. Where an app keeps an edge gate, this package remains additive
underneath it. Where an app removes one, removing it is that app's own
deploy-time change, not something this module performs.

This design explicitly distills reusable ideas from two Narduk applications:

- PACC TRAC informed the email/password model, one-shot setup and reset links,
  generic anti-enumeration response, request-scoped mail credentials, and the
  rule that previewing a link must not consume it.
- Harvest Tracker informed digest-only tokens, exact email binding, sanitized
  local `next` redirects, explicit redemption, and the rule that app-owned roles
  must not be escalated or demoted by a generic auth package.

The shared implementation hardens those precedents: raw link tokens are never
stored, identity-plus-IP throttle keys are hashed, and redemption is claimed by
one conditional database update. Harvest-specific farm membership and role
ceilings remain in Harvest Tracker; PACC-specific tenant and prototype-provider
logic remains in PACC TRAC.

The pathway is email plus password, not passwordless sign-in. Existing local
users may request a reset link. A new local user may receive a setup link only
when their normalized address exactly matches `AUTH_EMAIL_ALLOWLIST`; public
registration remains governed separately by `AUTH_PUBLIC_SIGNUP`. Browser page
loads never consume a link—the password completion POST does.

### Configuration

Apply all package migrations, including `drizzle/0002_local_email_auth.sql`,
then configure server-only runtime values:

| Variable                       | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_EMAIL_ALLOWLIST`         | Optional comma-separated exact addresses allowed to create a local account from a setup link.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `AUTH_EMAIL_APP_URL`           | Trusted application origin used to build links; defaults to public `appUrl`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `AUTH_EMAIL_RESEND_API_KEY`    | Resend credential; falls back to `RESEND_API_KEY`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `AUTH_EMAIL_FROM`              | Verified sender; falls back to `MAIL_FROM`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `AUTH_EMAIL_TOKEN_TTL_MINUTES` | Link lifetime, bounded to 5–60 minutes; defaults to 15.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `AUTH_EMAIL_SELF_SERVE_LINKS`  | Explicit local/demo escape hatch that returns a link button instead of sending mail. Never enable for a production app.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `AUTH_LOCAL_PROVIDERS`         | Optional comma-separated opt-in to advertise additional providers (from `apple`, `passkey`) alongside the always-on `email` provider on the local backend. Unknown names are silently dropped. Unset, the local backend advertises exactly `['email']`, unchanged from prior versions. Adding `passkey` is what turns on the WebAuthn ceremonies (see [Passkeys](#passkeys)), which additionally require `AUTH_WEBAUTHN_RP_ID` and `AUTH_WEBAUTHN_ORIGIN`. Adding `apple` still only advertises the provider; native Sign in with Apple on the local backend is not implemented. |

Email requests return the same public message for existing, preauthorized, and
unknown addresses. Stored links contain only a SHA-256 token digest and expire
after one use. Repeated credential attempts use persistent exponential lockout
in addition to the package's outer IP rate limit.

Application-specific authorization, membership, and roles remain app-owned.
Machine access such as `/mcp` should continue to use a scoped API key or another
explicit machine credential; browser email sessions are not a machine-auth
substitute.

## Passkeys

Passkeys (WebAuthn discoverable credentials) sit **beside** email + password on
the local backend — not in place of it. Password sign-in is never removed by
enabling them, so a lost or unenrolled authenticator is not a lockout
(narduk-libs#125, D2 "Passkeys beside email+password").

Passkeys are **local-backend only**. The Supabase backend owns its own session
model (`auth_sessions` rows, refresh tokens, AAL) and is untouched.

Verification uses [`@simplewebauthn/server`](https://simplewebauthn.dev) on the
server and `@simplewebauthn/browser` in the client, both **exact-pinned** — a
security-critical verifier is not a `^` range (D3).

### Enabling

1. Apply `drizzle/0003_webauthn_credentials.sql`.
2. Add `passkey` to `AUTH_LOCAL_PROVIDERS`.
3. Set the Relying Party variables below.

If any of these is missing or invalid, the ceremonies **fail closed**: every
passkey route answers `501` with the specific reason, the login card does not
offer the passkey button, and email + password is unaffected. There is no
partially-configured RP.

| Variable                              | Purpose                                                                                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_WEBAUTHN_RP_ID`                 | The Relying Party ID — a bare hostname, no scheme, port or path (e.g. `ops.example.com`), or `localhost` for development. Credentials are scoped to this value and cannot be used outside it.                                    |
| `AUTH_WEBAUTHN_ORIGIN`                | Comma-separated list of full origins (`https://host[:port]`) permitted to run ceremonies. Every entry's host must equal `AUTH_WEBAUTHN_RP_ID` or be a subdomain of it. Plaintext `http://` is refused except `http://localhost`. |
| `AUTH_WEBAUTHN_RP_NAME`               | Optional display name shown by the authenticator; defaults to the RP ID.                                                                                                                                                         |
| `AUTH_WEBAUTHN_CHALLENGE_TTL_SECONDS` | Optional challenge lifetime, clamped to 60–900 seconds; defaults to 300.                                                                                                                                                         |

These are read from the **running Worker's** environment (Cloudflare `vars` and
secrets), not only from build-time `runtimeConfig`.

### Do not widen the RP ID to the registrable parent

A staging host and a production host are different origins, and a credential
registered under `staging.ops.example.com` will not work at `ops.example.com`.
The correct answer is **one enrolment per environment** — register a passkey on
staging and again on production.

Setting `AUTH_WEBAUTHN_RP_ID` to the registrable parent (`example.com`) to share
one credential across the zone makes that credential presentable to **every host
in the zone**, including any future or compromised subdomain. Do not do it
(narduk-libs#125 risk R4).

### What the ceremonies guarantee

- **Registration requires an existing session.** The options and verify routes
  are `defineUserMutation`, so an anonymous caller cannot enrol an authenticator
  onto an account even where a consuming app treats the whole `/api/auth/`
  prefix as public at its own boundary.
- **API-key principals cannot manage passkeys.** `requireAuth` accepts an API
  key as a first-class principal; the passkey management routes refuse one with
  `403`, so a leaked machine token cannot be upgraded into a persistent
  interactive login.
- **Challenges are single-use and stored hashed.** A challenge row is deleted
  before verification runs, so a failed attempt burns it, and a challenge issued
  for one ceremony is refused by the other.
- **User verification is required** on both ceremonies, and `residentKey` is
  `required` so sign-in needs no identifier.
- **Sign-in reveals nothing.** The authentication endpoints take no email, send
  no `allowCredentials`, and answer every failure with one generic `401`.
- **Clone detection fails closed.** A signature counter that does not strictly
  increase is refused, except for the authenticator that reports `0` always; the
  new counter is written conditionally on the counter that was verified against.

### Managing enrolled passkeys

`/settings/passkeys` lists a user's credentials (name, created, last used) and
revokes them. Up to 20 credentials per user.
