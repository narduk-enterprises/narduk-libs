---
'@narduk-enterprises/narduk-auth': minor
---

Let the local backend advertise additional auth providers through an explicit
opt-in `AUTH_LOCAL_PROVIDERS` env var (comma-separated, filtered against a known
allowlist of `apple` and `passkey`). Unset, `authProviders` still resolves to
exactly `['email']` for every existing consumer — this is preparatory plumbing
for upcoming passkey (narduk-libs#125) UI work and adds no new authentication
behavior on its own.
