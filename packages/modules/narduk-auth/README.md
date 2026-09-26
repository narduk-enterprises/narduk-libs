# @narduk-enterprises/narduk-auth

## Native app sign-in (opt-in, local backend)

Apply `drizzle/0004_native_auth.sql` after the existing auth migrations, then
configure explicit native clients and optional persistent email verification:

```ts
runtimeConfig: {
  authBackend: 'local',
  authNativeClients: [{
    id: 'my-mac-app',
    name: 'My Mac App',
    redirectUris: ['com.example.myapp:/auth'],
  }],
  authLocalEmailVerification: true,
}
```

An empty client list disables native endpoints. Existing apps need neither the
new migration nor new behavior unless they opt in. Native sessions currently
support the local backend only; Supabase sessions and their MFA lifecycle are
not silently converted into independent native credentials.

The native client creates a cryptographically random state and PKCE verifier,
then opens `/auth/native` in the system authentication browser with query fields
`clientId`, `redirectUri`, `state`, `codeChallenge`, and
`codeChallengeMethod=S256`. The challenge is the unpadded base64url SHA-256 of
the verifier. The signed-in user explicitly connects the named client. The
server checks the exact configured callback, same-origin browser POST, current
account, recovery state, and configured MFA requirement before issuing a code.

Validate the callback origin/path and original state in the native app. Exchange
the code within 60 seconds using `POST /api/auth/native/token` with JSON fields
`clientId`, `redirectUri`, `code`, and `codeVerifier`. Token responses contain
`tokenType`, `accessToken`, `refreshToken`, `expiresIn`, `refreshExpiresAt`, and
`sessionId`. Send `X-Requested-With: XMLHttpRequest` on native POST requests to
satisfy the shared CSRF middleware; code issuance additionally requires a real
same-origin browser `Origin` header. These are app authentication endpoints, not
a general OAuth authorization server or discovery protocol.

Access credentials last five minutes. `POST /api/auth/native/refresh` accepts
`clientId` and `refreshToken` and atomically rotates both credentials. Serialize
refreshes in the client; the previous credentials immediately stop working. The
absolute session lifetime is 30 days. Keep credentials in Keychain or the
platform's equivalent, never preferences, logs, or URLs. A lost refresh response
requires browser sign-in again. `POST /api/auth/native/revoke` takes the same
body and revokes that session. Password reset/change revokes all native sessions
when the feature is enabled; deleting an account cascades to its credentials.

Protected product APIs explicitly call `getNativeAuthSession(event)` from
`server/utils/native-auth`, load the current account, and apply their own
membership/resource permissions. Native bearer credentials do not implicitly
authorize existing browser routes, API-key routes, or organization operations.
Long-lived media connections must separately revalidate current membership and
session revocation. Never replace those checks with UI visibility.

The public `createNativeAuth` service in `server/lib/app-auth/native-core`
supports a Drizzle SQLite/D1 database for controlled server consumers. The
caller must authenticate the `userId` supplied to `issueCode`. Code exchange and
refresh each use one conditional SQL update, preventing replay and partial
claims. Only credential digests are persisted.

With `authLocalEmailVerification: true`, a successful emailed password setup or
reset stores proof tied to the user and normalized email. Password login only
reads that proof. Consumers accepting email-bound invitations must call
`getLocalEmailVerification(event, userId, currentAccountEmail)` from
`server/utils/verified-email`; a supplied address or ordinary password login is
not email proof. Existing accounts establish proof by completing an emailed
password reset. Changing the address invalidates the old proof.

The protocol follows the system-browser and PKCE protections described by
[RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) and
[RFC 7636](https://www.rfc-editor.org/rfc/rfc7636).

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

narduk-auth needs an app database: users, sessions and API keys live there. An
app that declares narduk-core's `databaseBackend: 'none'` cannot install it, and
its build fails with a message naming the conflict. When narduk-auth is
installed, narduk-core's `/api/health` also checks for its tables on D1.

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
| `AUTH_EMAIL_SELF_SERVE_LINKS`  | Local fixture shortcut that returns a password link instead of sending mail. Requires an exact matching request and `AUTH_EMAIL_APP_URL` origin on `localhost`, `127.0.0.1`, or `[::1]`; public/mismatched origins fail with 503 before token issuance. Forwarded host/protocol headers cannot enable it.                                                                                                                                                                                                                                                                        |
| `AUTH_LOCAL_PROVIDERS`         | Optional comma-separated opt-in to advertise additional providers (from `apple`, `passkey`) alongside the always-on `email` provider on the local backend. Unknown names are silently dropped. Unset, the local backend advertises exactly `['email']`, unchanged from prior versions. Adding `passkey` is what turns on the WebAuthn ceremonies (see [Passkeys](#passkeys)), which additionally require `AUTH_WEBAUTHN_RP_ID` and `AUTH_WEBAUTHN_ORIGIN`. Adding `apple` still only advertises the provider; native Sign in with Apple on the local backend is not implemented. |

Email requests return the same public message for existing, preauthorized, and
unknown addresses. Stored links contain only a SHA-256 token digest and expire
after one use. Repeated credential attempts use persistent exponential lockout
in addition to the package's outer IP rate limit.

### Branded password emails

The setup and reset emails are plain by default. An app replaces them with a
Nitro plugin on the `narduk-auth:email` hook:

```ts
// server/plugins/auth-email.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('narduk-auth:email', (context) => {
    context.message = renderMyPasswordEmail(context) // { subject, text, html }
  })
})
```

The context carries `purpose` (`setup` or `reset`), `actionUrl`, `appName`,
`appUrl`, `email`, `ttlMinutes` and the default `message`. A template must keep
`actionUrl` in both the text and the HTML part (HTML-escaped). A handler that
throws or drops the link is ignored, and the default email is sent instead, so a
template bug never costs a user their link.

`sendAuthEmail(event, readLocalEmailSettings(event), { to, message })` from
`@narduk-enterprises/narduk-auth/server/utils/auth-email` sends an app's own
account email (an invitation, say) from the same verified sender. It returns
whether the provider accepted the message and never logs the recipient.

### Accounts for an address the app already proved

`registerLocalUserWithProvenEmail(event, { email, name, password })` and
`confirmSessionEmailWithProof(event, email)` from
`@narduk-enterprises/narduk-auth/server/utils/proven-email` are for an app that
has just redeemed a single-use token it emailed to that address, such as an
invitation link. Holding the token proves the inbox, so the account is created
confirmed and signed in, with no second confirmation email. The first answers
409 for an address that already has an account. The second confirms only the
signed-in user's own address and returns null for any other. Both work while
`publicSignup` is off, so a closed app still admits the people it invites. Never
pass an address the visitor merely typed.

Application-specific authorization, membership, and roles remain app-owned.
Machine access such as `/mcp` should continue to use a scoped API key or another
explicit machine credential; browser email sessions are not a machine-auth
substitute.

The admin routes take an admin-owned API key only where its scopes allow it.
`GET /api/admin/users` (and its `/api/users` alias) needs
`auth:admin:users:read` on the key, and `PUT /api/admin/users/role` is
session-only: no API key can grant or revoke admin, whatever its scopes. Admin
sessions need no scope.

## nuxt-auth-utils' session route

nuxt-auth-utils serves `GET /api/_auth/session`, which
`useUserSession().fetch()` calls, straight from the sealed cookie, without the
session-grant validator. narduk-auth's `auth-session-refresh` middleware checks
the grant first: when the cookie carries a user whose `auth_sessions` row is
gone, expired or unreadable, the route answers `{}` (signed out) instead of that
user. A live session, a cookie with no user, and `DELETE /api/_auth/session` are
left to nuxt-auth-utils. The route is a client display hint, never a grant:
server authorization goes through `requireAuth`, which asks the validator.

## Restricted sessions (recovery and MFA)

The session-grant validator (registered on every request) is the per-request
enforcement point. A live `auth_sessions` row that is in recovery mode, or a
Supabase session that is below AAL2 while `AUTH_REQUIRE_MFA=true`, can only call
the allowlisted routes below. Everything else that goes through `requireAuth` /
`requireAdmin` fails closed with 403 (`recovery_mode` / `mfa_required`).

**Recovery allowlist:** `GET /api/auth/me`, `POST /api/auth/change-password`,
`POST /api/auth/logout`. Successful password change clears `recovery_mode`.

**MFA step-up allowlist:** `GET /api/auth/me`, `POST /api/auth/logout`,
`POST /api/auth/mfa/enroll`, `POST /api/auth/mfa/verify`.

`AUTH_REQUIRE_MFA` is **ignored on the local backend**. Local auth has no TOTP
enroll/verify stack; treating the flag as a lockout would brick password
sessions. A startup warning is logged when the flag is on and the backend is
local. Passkey user-verification is not treated as AAL2.

Notification mutations require the API-key scope `auth:notifications:write`.
Account deletion, password change, profile update, and MFA enroll/verify refuse
API-key principals entirely.

**Account deletion re-authentication (Supabase backend).** An account with the
`email` provider proves its current Supabase password; the sign-in that checks
it is signed out again (`scope: 'local'`). Supabase reports an invited or
magic-link user as `email` whether or not they chose a password, so such a user
resets their password before deleting — deliberately, since skipping them would
let any `email` session through unproven. A social-only account has no password,
so its session must have signed in within the last 10 minutes
(`RECENT_SIGN_IN_WINDOW_SECONDS`); otherwise the route answers 403
`reauthentication_required` and the client signs the user in again and retries.

**Setting a first password (Supabase backend).** The same recent-sign-in rule
applies when a social-only session sets its first password through
`change-password`: otherwise a stolen, old session could choose a password, sign
in with it, and so pass the deletion window above. An older session gets 403
`reauthentication_required`. A recovery session (from the reset link) is exempt,
since it has just proved control of the inbox.

## Request principal for tenancy guards

Guards that choose their own answer for an anonymous caller (narduk-tenancy's
`resolveUserId`, a route that answers 404 rather than disclose that a resource
exists) need "who is calling, or `null`". `requireAuth` throws 401 instead, and
reading `useRefreshedSessionUser` directly skips the restricted-session rules
above, so a recovery-mode or MFA-step-up session would pass.

```ts
import {
  resolveRequestPrincipal,
  resolveTenancyUserId,
} from '@narduk-enterprises/narduk-auth/server/utils/request-principal'

// narduk-tenancy guard: sessions only, privilege rules applied.
await requireOrgRole(event, {
  orgId,
  minimum: 'member',
  tenancy,
  resolveUserId: resolveTenancyUserId,
})

// Wider principal set, opted into per route.
const principal = await resolveRequestPrincipal(event, {
  allowApiKey: true, // Authorization: Bearer nk_…
  requiredApiKeyScopes: ['farm:read'], // a key without them resolves to null
  allowNative: true, // native-app bearer
  refuseNeedsPasswordSetup: true,
})
// → { userId, email, emailVerified, method: 'session' | 'native' | 'api-key', sessionId?, apiKeyScopes } | null
```

It returns `null` for an anonymous caller, a session the recovery or MFA
allowlist refuses for this request, a bearer the call does not accept or that
does not authenticate, and a key missing `requiredApiKeyScopes`. As in
`requireAuth`, an accepted bearer takes precedence over the session cookie and
never falls back to it. `emailVerified` is narduk-auth's proof, not the raw
session field: the Supabase confirmation on a Supabase session, otherwise the
local `auth_verified_emails` record for the user's current address (so it is
`false` unless `authLocalEmailVerification` is on). The 401-versus-404 choice,
org selection and app roles stay in the app.

## Sign in with Apple on the local backend

The local D1 backend verifies Apple's identity token itself (narduk-libs#164,
decision D4); no hosted auth is involved. It is enabled only when the app both
advertises the provider and names its Apple client ids; otherwise the button is
hidden and the routes answer 501.

| Variable                       | Purpose                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `AUTH_LOCAL_PROVIDERS=apple`   | Advertise the provider (with `passkey`, comma-separated).                                |
| `AUTH_APPLE_SERVICES_ID`       | The Services ID: the web flow's `client_id` and the identity token's required `aud`.     |
| `AUTH_APPLE_NATIVE_CLIENT_IDS` | Comma-separated bundle ids whose native identity tokens `signInWithNativeApple` accepts. |

`GET /api/auth/runtime-public` reports `appleEnabled`, and the login and
register cards show "Continue with Apple" from it.

**Web flow.** `POST /api/auth/oauth/start` with `provider: 'apple'` returns
`/api/auth/apple/start?next=…`. That route binds a random `state` and nonce to
the browser in an `HttpOnly`, `SameSite=None; Secure` cookie scoped to `/api`
(Apple's `form_post` is a cross-site POST, so a Lax cookie would not return),
then redirects to Apple with `response_type=code id_token`,
`response_mode=form_post`, `scope=name email` and the nonce's SHA-256. Apple
posts back to `/api/callbacks/auth/apple` (under `/api/callbacks/`, which
narduk-core's header CSRF check exempts, since Apple's POST cannot carry one).
The cookie is single-use; the callback refuses a `state` that is not this
browser's, then verifies the identity token against Apple's JWKS (cached for an
hour) — RS256 signature, `iss`, `aud` = the Services ID, `exp`/`iat`, and the
nonce — and redirects to `next`, or to the auth callback page with an error.
Register `https://<app>/api/callbacks/auth/apple` as the Services ID's return
URL.

The authorization code is not redeemed, so sign-in needs no Apple client-secret
JWT and carries no six-month rotation. A later feature that needs Apple's
refresh tokens or token revocation (for example on account deletion) would add
that credential and its rotation.

**Native.** `signInWithNativeApple(event, { identityToken, nonce })` on the
local backend requires `nonce`, the raw value whose SHA-256 hex the app passed
to Apple, and a token whose `aud` is one of `AUTH_APPLE_NATIVE_CLIENT_IDS`.

**Accounts.** A user is found by `users.apple_id`. A first Apple sign-in with an
Apple-verified address links to an existing account with that address only when
this app has also proven it (`auth_verified_emails`, so
`authLocalEmailVerification` must be on); otherwise it is refused with 409
rather than letting whoever registered the address first share the account. With
no match, a password-less account is created when public sign-up is open (403
when closed), named from the name Apple posts on first authorization. Password
login stays available to accounts that have a password.

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

On a Cloudflare Workers build the module loads a Reflect metadata polyfill
before `@simplewebauthn/server` evaluates. That package pulls `tsyringe`, which
throws at import time unless `Reflect.getMetadata` exists; Workers does not
provide it, and Nitro will tree-shake a bare `import 'reflect-metadata'` unless
`reflect-metadata` is on `nitro.moduleSideEffects` (narduk-libs#786). Consuming
apps should not add their own `00.reflect-metadata` plugin or allowlist entry —
remove any app-local stopgap after this package ships the fix.

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
- **The challenge table has an absolute ceiling.** The sign-in options endpoint
  is necessarily public and inserts a row per call, and its rate limit is keyed
  on the client IP — so a caller rotating addresses is otherwise bounded only by
  how many they hold. Past 5,000 live challenges, ceremonies refuse with 503;
  email + password login touches neither table and keeps working.
- **Clone detection fails closed.** A signature counter that does not strictly
  increase is refused, except for the authenticator that reports `0` always; the
  new counter is written conditionally on the counter that was verified against.

### Managing enrolled passkeys

`/settings/passkeys` lists a user's credentials (name, created, last used) and
revokes them. Up to 20 credentials per user.

## Auth card components

The module registers everything under `app/components` with `addComponentsDir`
(`pathPrefix: false`). The `Auth*` surface is five cards. Source-regex
guardrails (`auth-card-autocomplete`, `auth-login-card-contrast`) stay in place;
this section is the suite-bar API. NE Base `data-design-card` entries are
deferred until the card mechanism in
[#250](https://github.com/narduk-enterprises/narduk-libs/issues/250) lands.

The stonx `AuthBackground` / `AuthLegalFooter` rename and the been-sober-for and
bluebonnet `auth/*` copies are app-repo work, not this package.

The module registers `app/` as a Tailwind source in Nuxt UI's `ui.css`, and when
an app turns on `ui.experimental.componentDetection`, it adds the Nuxt UI
components its pages and cards render (`src/nuxt-ui-components.ts`, `UAlert` and
`UCard` among them) to the detection list. An app does not list this package's
files or components itself (narduk-libs#700).

### `AuthLoginCard`

Email/password sign-in, with optional Apple and passkey buttons when the runtime
advertises them.

#### Props

| Prop           | Default         | Purpose                                                                                         |
| -------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `title`        | `Welcome back`  | Card heading.                                                                                   |
| `subtitle`     | resolved copy   | Overrides the backend-aware subtitle (`loginCopy`). Omit to keep the package default.           |
| `redirectPath` | runtime default | Same-origin path to enter after success. Falls back to `?next=` then `public.authRedirectPath`. |

#### Slots

None.

#### Events

| Event     | Payload                                     |
| --------- | ------------------------------------------- |
| `success` | `{ email, id, name }` — the signed-in user. |

#### Example

```vue
<template>
  <AuthLoginCard
    title="Operator sign-in"
    redirect-path="/dashboard/"
    @success="(user) => console.log(user.email)"
  />
</template>
```

### `AuthRegisterCard`

Public signup. Apple is offered only on the Supabase backend when `apple` is in
`authProviders`.

#### Props

| Prop           | Default                                                  | Purpose                                                                                         |
| -------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `title`        | `Create an account`                                      | Card heading.                                                                                   |
| `subtitle`     | `Start with Apple, then fall back to email when needed.` | Card subtitle.                                                                                  |
| `redirectPath` | runtime default                                          | Same-origin path to enter after success. Falls back to `?next=` then `public.authRedirectPath`. |

#### Slots

None.

#### Events

| Event     | Payload                                              |
| --------- | ---------------------------------------------------- |
| `success` | `{ email, id, name }` — the created, signed-in user. |

#### Example

```vue
<template>
  <AuthRegisterCard title="Join" @success="(user) => console.log(user.id)" />
</template>
```

### `AuthExchangePanel`

Finishes an OAuth or emailed-link callback (`code`, or `token_hash` + `type`)
into an app session. Used by `/auth/callback` and `/auth/confirm`.

#### Props

| Prop          | Default                                                              | Purpose        |
| ------------- | -------------------------------------------------------------------- | -------------- |
| `title`       | `Finishing sign-in`                                                  | Card heading.  |
| `description` | `We are validating the auth callback and creating your app session.` | Card subtitle. |

#### Slots

None.

#### Events

None. A successful exchange `navigateTo`s `result.redirectTo` or
`public.authRedirectPath`.

#### Example

```vue
<template>
  <AuthExchangePanel
    title="Confirming your email"
    description="We are finishing account confirmation and creating your app session."
  />
</template>
```

### `AuthPasskeysPanel`

Lists, adds, and revokes the signed-in user's passkeys. Renders on
`/settings/passkeys`.

#### Props

None.

#### Slots

None.

#### Events

None. Toasts report add/remove; failures stay on the card.

#### Example

```vue
<template>
  <AuthPasskeysPanel />
</template>
```

### `AuthApiKeysPanel`

Mints and revokes personal API tokens. Renders on `/settings/api-keys`.

A token whose scopes include `*` is a boundary-class credential
(narduk-libs#168): `POST /api/auth/api-keys` refuses `expiresInDays: null` and
caps the lifetime at 90 days. Narrow machine scopes may still omit expiry. The
unique index on `api_keys.key_hash` lives in narduk-core (migration 0007).

A key minted by another API key may hold only scopes the calling key holds
(narduk-libs#858), and may not outlive it (narduk-libs#920). With no
`expiresInDays`, the child's expiry is clamped to the calling key's. An explicit
expiry past the calling key's, or `null` under a key that expires, gets a 403.
Revoking a key does not revoke the keys it minted.

`GET /api/auth/me` is session-only: it answers `{"user":null}` for a valid API
key, so it cannot prove one. Prove a key with `GET /api/auth/api-keys`, which
answers 401 without a key, 200 with a key holding `auth:api-keys:read`, and 403
(missing scope) with any other live key. For an agent key on its own non-login
user, use `narduk-app auth agent-key create` (narduk-app-tools).

#### Props

| Prop                    | Default | Purpose                                                                                         |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `availableScopes`       | `[]`    | Extra scope chips merged with the package's `auth:api-keys:read` / `auth:api-keys:write` pair.  |
| `tokenProfiles`         | `[]`    | Recommended `{ id, label, description, scopes?, expiresInDays? }` presets shown above the form. |
| `defaultTokenProfileId` | `null`  | When set, applies that profile to the create form on first mount.                               |

#### Slots

None.

#### Events

None. Toasts report create/revoke; the raw token is shown once on the card.

#### Example

```vue
<script setup lang="ts">
const tokenProfiles = [
  {
    id: 'registry-read',
    label: 'Registry reader',
    description: 'Read-only registry access.',
    scopes: ['registry:read'],
    expiresInDays: 30,
  },
]
</script>

<template>
  <AuthApiKeysPanel
    :token-profiles="tokenProfiles"
    default-token-profile-id="registry-read"
  />
</template>
```
