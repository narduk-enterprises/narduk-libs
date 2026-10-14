---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Retry the portal app-config fetch on an outage, and grant `id-token: write`
where the generated workflows run `narduk-app`.

`narduk-app-tools`: the app-config resolver now makes up to 3 attempts (10 s
each, jittered backoff of about 1 s then 3 s) for a network error, a timeout or
HTTP 429/502/503/504, from the portal or from GitHub's OIDC token endpoint. A
400/401/403/404/409 or a malformed document is an answer and still fails on the
first attempt with its existing message. The failure stays loud (no stale file
or cache fallback), tokens stay scrubbed from every message, and the error says
how many attempts were made. The per-attempt default timeout drops from 15 s to
10 s; `fetch`, `sleep` and `random` are injectable.

`create-narduk-app`: the generated private `ci.yml` calls
`narduk-enterprises/workflows` `nuxt-cloudflare.yml` at
`73e050ae42ece50497ff3140e21767505cca0076` (workflows#199,
`# v2 + id-token (workflows#199)`) and grants the calling job `id-token: write`;
`upgrade` adds the grant to existing callers. The copy-me `docs/deployment`
templates (`preview-d1.yml`, `ci-d1-bundle.job.yml`, `promote-d1.steps.yml`) now
carry the same grant so an adopter can resolve config from the portal.
