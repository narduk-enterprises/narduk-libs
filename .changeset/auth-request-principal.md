---
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/narduk-tenancy': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth: add `server/utils/request-principal` (narduk-libs#980).
`resolveRequestPrincipal(event, options)` returns the caller, or `null` for an
anonymous caller or a recovery-mode / MFA-step-up session that the
restricted-session allowlists refuse for this request, so tenancy guards keep
their own 401/404 choice without skipping the rules `requireAuth` applies. API
keys (`allowApiKey`, with optional `requiredApiKeyScopes`) and native bearers
(`allowNative`) are opt-in; `emailVerified` comes from narduk-auth's proof, not
the raw session field. `resolveTenancyUserId` is a ready-made narduk-tenancy
`resolveUserId`. `session-privilege` also exports `sessionPrivilegeRefusal`, the
non-throwing form of `assertSessionPrivilegeAllowsRequest`. The narduk-tenancy
README's guard example now uses `resolveTenancyUserId`.
