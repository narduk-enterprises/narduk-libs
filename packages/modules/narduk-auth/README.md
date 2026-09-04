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

As of 1.20.0, `0002_local_email_auth.sql` is **required for the default local
backend**, not just the optional email-link feature: every local email/password
login reads and writes the `auth_local_email_attempts` lockout table it creates.
Upgrading a local-backend app past 1.19.x without applying it breaks every login
with an HTTP 500 that names the missing table. Sequence the migration with the
version bump so it runs on deploy before traffic.

The shipped migrations use the D1/SQLite dialect only. This module does not
publish a Postgres schema or migrations for the auth bridge tables
(narduk-libs#94) — it is D1-only.

## Additive local email pathway

The local email pathway is an application-level complement to Cloudflare Access,
not a replacement for it. An app can and should keep Cloudflare Access (CFA) as
its outer edge gate while using this package to establish an application
session, identify the signed-in email, and support password setup or recovery.
This module does not create, remove, weaken, bypass, or reconfigure any
Cloudflare Access application or policy. It also does not change the existing
Supabase pathway.

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

| Variable                       | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_EMAIL_ALLOWLIST`         | Optional comma-separated exact addresses allowed to create a local account from a setup link.                                                                                                                                                                                                                                                                                                                                          |
| `AUTH_EMAIL_APP_URL`           | Trusted application origin used to build links; defaults to public `appUrl`.                                                                                                                                                                                                                                                                                                                                                           |
| `AUTH_EMAIL_RESEND_API_KEY`    | Resend credential; falls back to `RESEND_API_KEY`.                                                                                                                                                                                                                                                                                                                                                                                     |
| `AUTH_EMAIL_FROM`              | Verified sender; falls back to `MAIL_FROM`.                                                                                                                                                                                                                                                                                                                                                                                            |
| `AUTH_EMAIL_TOKEN_TTL_MINUTES` | Link lifetime, bounded to 5–60 minutes; defaults to 15.                                                                                                                                                                                                                                                                                                                                                                                |
| `AUTH_EMAIL_SELF_SERVE_LINKS`  | Explicit local/demo escape hatch that returns a link button instead of sending mail. Never enable for a production app.                                                                                                                                                                                                                                                                                                                |
| `AUTH_LOCAL_PROVIDERS`         | Optional comma-separated opt-in to advertise additional providers (from `apple`, `passkey`) alongside the always-on `email` provider on the local backend. Unknown names are silently dropped. Unset, the local backend advertises exactly `['email']`, unchanged from prior versions. This flag only affects what `authProviders` advertises to the UI; it does not itself add passkey or Apple sign-in support to the local backend. |

Email requests return the same public message for existing, preauthorized, and
unknown addresses. Stored links contain only a SHA-256 token digest and expire
after one use. Repeated credential attempts use persistent exponential lockout
in addition to the package's outer IP rate limit.

Application-specific authorization, membership, and roles remain app-owned.
Machine access such as `/mcp` should continue to use a scoped API key or another
explicit machine credential; browser email sessions are not a machine-auth
substitute.
