---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

The canonical-host redirect takes a host list: `CANONICAL_REDIRECT_HOSTS` (or
`runtimeConfig.public.canonicalRedirectHosts`) redirects only the named hosts,
such as `www`, to the canonical origin and serves every other host where it was
asked, so `*.workers.dev` previews keep working. It needs no
`ENFORCE_CANONICAL_HOST`, and a `*.workers.dev` entry is ignored (#515).
