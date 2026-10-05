---
'@narduk-enterprises/narduk-core': patch
---

`00-canonical-host` in named-host mode (`CANONICAL_REDIRECT_HOSTS`) now answers a `308` to the https URL when a document navigation reaches the canonical host over plain http, keeping path, query and hash. Canonical https requests, `*.workers.dev` hosts and sub-resource fetches are served as before (narduk-libs#1483).
