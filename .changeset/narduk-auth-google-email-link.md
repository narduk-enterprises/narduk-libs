---
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth: Google sign-in (OIDC code flow with PKCE, state and nonce, ID token
verified against Google's JWKS) and passwordless email-link sign-in on the local
backend, on D1 and Postgres. Both are off until configured
(`AUTH_LOCAL_PROVIDERS=google` with
`AUTH_GOOGLE_CLIENT_ID`/`AUTH_GOOGLE_CLIENT_SECRET`; `AUTH_EMAIL_LINK_SIGNIN`).
Apply migration `0006_identities_and_signin_links.sql` (D1 rebuilds
`auth_email_links`).
