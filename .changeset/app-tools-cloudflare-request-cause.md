---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app development` deploys: a Cloudflare request that never completed now says which request and why, e.g. `Cloudflare GET /workers/scripts did not complete (TimeoutError: …; cause none)`, and keeps the original error as `cause`. The deploy receipt's `failure` records the same text, so a timeout, a DNS failure and a reset connection can be told apart (narduk-libs#1096). No token, account id or response body is included, and writes are still never retried.
