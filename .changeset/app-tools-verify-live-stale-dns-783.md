---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`verify --live` diagnoses a stale local NXDOMAIN (narduk-libs#783). When the
system lookup fails with `ENOTFOUND` / `EAI_AGAIN` but 1.1.1.1 / 8.8.8.8 resolve
the host, the report adds a distinct `dns` UNKNOWN assertion ("local resolver
has a stale negative answer") with the public addresses and the remedies,
instead of reading like a dead deployment; the exit code stays 2. The new
`--resolver public` probes through the public resolvers' answer while keeping
the hostname for TLS SNI and `Host`. Live probe responses also carry the
transport's `errorCode`.
